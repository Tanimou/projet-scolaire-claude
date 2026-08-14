-- S-E01-1c — LA SURFACE D'ÉCRITURE de l'autorisation : `app_user` peut enfin
-- éditer un rôle CUSTOM, et ne peut RIEN faire à un rôle SYSTÈME.
--
-- Migration RELUE À LA MAIN (ADR-027, G-MIGRATION). Elle n'a été produite ni par
-- `prisma migrate dev` ni par `prisma db push` — aucune des deux chaînes
-- n'apparaît dans ce diff, et Prisma ne sait modéliser ni une policy ni un
-- GRANT, donc ce fichier n'est dérivable d'aucun schéma.
--
-- `schema.prisma` N'EST PAS touché, et c'est une MESURE, pas un espoir : cette
-- migration ne crée aucune colonne, aucune contrainte et aucun index. Elle ne
-- pose que des policies et des GRANTs, que `prisma migrate diff` ne voit pas.
-- Le piège P-05 (`prisma generate` ROUGE sur une modification additive du
-- schéma) n'est donc PAS armé ici — première migration de V3-E01 depuis
-- `S-E01-2c` dont c'est le cas.
--
-- LES DÉCISIONS SONT DANS `docs/adr/ADR-047-authorization-write-surface.md`.
-- Ce fichier les CITE ; il n'en prend aucune. Un commentaire de migration ne
-- peut pas supersédér une décision de record.
--
-- ============================================================================
-- CE QU'ELLE FAIT — ET CE QU'ELLE NE FAIT PAS
-- ============================================================================
--
-- ELLE FAIT, dans l'ordre :
--   1. six policies `AS RESTRICTIVE`, une par commande d'écriture et par table
--      (`system_role_write_guard_insert` / `_update` / `_delete` sur `role` et
--      sur `role_permission`), toutes `TO PUBLIC` ;
--   2. un GRANT `INSERT, UPDATE, DELETE` sur `role` et `INSERT, DELETE` sur
--      `role_permission`, table par table, jeu de privilèges FERMÉ.
--
-- ELLE NE FAIT PAS : basculer la connexion. **Après cette migration,
-- l'application qui tourne N'EST PAS ISOLÉE par RLS.** Elle se connecte comme
-- `pilotage`, PROPRIÉTAIRE des tables, et un propriétaire n'est pas soumis à ses
-- propres policies tant que `FORCE ROW LEVEL SECURITY` est absent — et il l'est
-- toujours, délibérément (ADR-032 §D5). `DATABASE_URL` n'est PAS touché par ce
-- diff. Ce qui reste est la BASCULE DE CONNEXION (`S-E01-1`), et elle porte
-- encore son propre bloqueur, `PF-185` : `register.controller.ts` écrit
-- `tenant`, qui reste `SELECT` seul ici (ADR-047 §D6).
--
-- ELLE NE TOUCHE PAS `tenant_isolation`. Les deux policies posées par
-- `20260814180000` restent l'objet qu'elles étaient : même nom, même prédicat,
-- même `FOR ALL`. Le fichier de cette migration-sœur n'apparaît PAS dans ce
-- diff, ce qui est la forme la plus forte de « le prédicat de SELECT est celui
-- d'aujourd'hui, VERBATIM » — un objet non modifié plutôt qu'un texte relu.
-- Le bloc ci-dessous VÉRIFIE en plus la présence de `tenant_isolation` sur
-- chaque table avant de poser quoi que ce soit : une précondition vaut mieux
-- qu'une promesse.
--
-- ============================================================================
-- PF-193 — LE DÉFAUT QUE CETTE MIGRATION FERME
-- ============================================================================
--
-- `20260814180000` a donné `SELECT` et RIEN d'autre sur `role` et
-- `role_permission`, en NOMMANT la dette : `roles.controller.ts` écrit cette
-- surface (`tx.role.create` :154, `tx.role.update` :242,
-- `tx.rolePermission.deleteMany` :250, `tx.rolePermission.create` :252,
-- `tx.role.delete` :294). Ces cinq écritures marchent AUJOURD'HUI parce que
-- l'application est PROPRIÉTAIRE des tables ; à la bascule, l'éditeur de rôles
-- custom du portail admin perdrait tout chemin d'écriture.
--
-- MESURÉ sur `apps/api/src` + `apps/worker/src` (specs exclues), motif
-- `\b(prisma|tx)\.<modèle>\.<verbe>` : aucun AUTRE écrivain de ces deux tables,
-- et AUCUN site `rolePermission.update*`. `role` a donc besoin de trois verbes
-- d'écriture, `role_permission` de DEUX. Les GRANTs sont asymétriques parce que
-- la mesure l'est ; la symétrie aurait été une commodité de rédaction.
--
-- ============================================================================
-- POURQUOI `AS RESTRICTIVE`, PAR COMMANDE (ADR-047 §D3)
-- ============================================================================
--
-- LA FORME ÉVIDENTE EST UNE PANNE D'AUTORISATION TOTALE. Ajouter
-- `AND is_system = false` au prédicat de `tenant_isolation` — une seule ligne —
-- le mettrait aussi dans `USING`, donc dans SELECT. Or TOUT utilisateur réel
-- détient un rôle SYSTÈME : la jointure d'autorisation rendrait ZÉRO permission
-- pour tout le monde, sur les quatre portails, dès la première requête.
--
-- LA DEUXIÈME FORME ÉVIDENTE NE RESTREINT RIEN. Deux policies PERMISSIVES pour
-- une même commande sont composées par OU. Ajouter une policy « plus stricte »
-- à côté de `tenant_isolation … FOR ALL` sans écrire `AS RESTRICTIVE` livre un
-- garde qui ne fait rien, en silence. `WRITE_GUARD_PERMISSIVE = 0` est asserté
-- par `scripts/rls-isolation-check.js` pour exactement cette raison.
--
-- LA TROISIÈME, `USING`/`WITH CHECK` divergents sur l'unique policy `FOR ALL`,
-- refuse bien l'INSERT d'un rôle système et le passage custom -> système, mais
-- elle NE PEUT PAS refuser le DELETE : `DELETE` ne consulte QUE `USING`.
-- Supprimer un rôle système, et supprimer les `role_permission` d'un rôle
-- système, seraient acceptés. C'est tout le défaut ; la forme est rejetée.
--
-- LA QUATRIÈME, découper `tenant_isolation` en quatre policies permissives par
-- commande, marche sémantiquement et casse TROIS invariants du recensement PAR
-- CONSTRUCTION (`POLICIES`, `WITH_CHECK_NULL`, `QUAL_MISMATCH` : une policy
-- `FOR SELECT` ou `FOR DELETE` a `polwithcheck IS NULL`). Chacun a une
-- réparation locale bon marché qui supprime une protection réelle. La bonne
-- réponse à AC-4 est de NE PAS créer le problème.
--
-- Restent six policies `AS RESTRICTIVE`, composées par ET avec la permissive.
-- Le prédicat effectif d'une ÉCRITURE est donc « le prédicat de
-- `tenant_isolation` ET le garde », composé par le moteur et non par
-- concaténation de chaînes ; SELECT ne reçoit aucune policy restrictive et
-- reste bit pour bit ce qu'il était hier.
--
-- LE REVERS, ÉCRIT PLUTÔT QUE TU : le même filtre par nom qui garde le
-- recensement vert le rend AVEUGLE à ces six policies — toutes ses requêtes
-- filtrent `polname = 'tenant_isolation'`. Elles reçoivent donc leurs propres
-- assertions nommées dans `scripts/rls-isolation-check.js` (nom, `polpermissive`
-- faux, `polroles = '{0}'`, `polcmd`, forme `USING`/`WITH CHECK` par commande,
-- présence de `is_system = false` dans le texte du prédicat). Sans elles, cette
-- migration livrerait des policies qu'aucun cliquet ne voit.
--
-- LES DEUX PRÉDICATS DE GARDE, et rien d'autre dedans :
--
-- `role` :
--   role.is_system = false
--
-- `role_permission` :
--   EXISTS (SELECT 1 FROM public.role r
--            WHERE r.id = role_permission.role_id
--              AND r.is_system = false)
--
-- Le saut vers le parent est ÉCRIT EN ENTIER et ne s'appuie PAS sur la policy
-- de `role` (ADR-042 §D1, clause 3) : exécutée comme `app_user` la sous-requête
-- serait déjà filtrée par la policy de `role`, mais exécutée comme le
-- PROPRIÉTAIRE — qui joue les migrations, les seeds et toute l'application
-- d'aujourd'hui — aucune policy ne s'applique, et le prédicat complet est alors
-- la SEULE chose qui travaille.
--
-- `is_system` est écrit `= false`, jamais `IS NOT TRUE` ni `IS DISTINCT FROM
-- true` : la colonne est `NOT NULL DEFAULT false` (baseline :550, VÉRIFIÉ par le
-- bloc ci-dessous avant tout DDL), donc la logique à trois valeurs n'existe pas
-- ici — et le jour où elle existerait, `= false` échoue FERMÉ là où
-- `IS NOT TRUE` échouerait ouvert.
--
-- G-DNC / DNC-10. Le garde ne contient AUCUN `current_setting` : la moitié
-- tenant reste ENTIÈREMENT dans `tenant_isolation`, où
-- `nullif(current_setting('app.current_tenant_id', true), '')::uuid` est repris
-- VERBATIM d'ADR-032 §D6 et n'est pas re-dérivé. Il n'y a donc, dans ce fichier,
-- aucune branche de contexte nul à écrire de travers. Les policies sont
-- `TO PUBLIC`, jamais `TO app_user` : nommer un rôle exempterait en silence tout
-- AUTRE rôle non-propriétaire. `WITH CHECK` est injecté depuis la MÊME variable
-- que `USING` sur `FOR UPDATE`, là où ils doivent être identiques — et nulle
-- part ailleurs, parce que PG 15 n'accepte QUE `WITH CHECK` sur `FOR INSERT` et
-- QUE `USING` sur `FOR DELETE`.
--
-- `FOR UPDATE` est posé sur `role_permission` bien qu'aucun `UPDATE` n'y soit
-- accordé (aucun site appelant, mesuré). Un garde COMPLET PAR COMMANDE fait
-- qu'un élargissement futur du GRANT ne peut pas ouvrir un trou en une ligne ;
-- l'inverse — un GRANT sans garde correspondant — est la façon dont cette classe
-- de défaut entre.
--
-- ============================================================================
-- LES GRANTS : UN JEU FERMÉ, ASYMÉTRIQUE PARCE QUE MESURÉ (ADR-047 §D1)
-- ============================================================================
--
-- Jamais `ON ALL TABLES IN SCHEMA public` : cette forme donnerait aussi les
-- tables SANS policy. Les GRANTs portent table par table et sont conditionnés à
-- l'EXISTENCE du rôle (`pg_roles`), calculée UNE seule fois dans une constante :
-- les rôles sont à l'échelle du CLUSTER, les migrations s'appliquent à une BASE,
-- et le garde de dérive comme le job CI appliquent le ledger à des bases neuves
-- où `app_user` n'existe pas. La moitié POLICY reste INCONDITIONNELLE : une
-- propriété de sécurité ne dépend d'aucun rôle.
--
-- C'EST UN RÉTRÉCISSEMENT, PAS UN ÉLARGISSEMENT, et c'est l'argument qu'un
-- lecteur objecterait autrement. AUJOURD'HUI l'application se connecte comme le
-- PROPRIÉTAIRE et exécute déjà ces cinq écritures, sur les lignes de TOUS les
-- tenants, sous AUCUN prédicat, sans qu'aucun contrôle `is_system` soit
-- opposable sous le handler. Après cette migration les mêmes écritures sont
-- bornées par une policy. Refuser le GRANT ne garde pas le système sûr : il le
-- garde PROPRIÉTAIRE-PRIVILÉGIÉ, ce qui est strictement pire, et il garde PF-02
-- ouvert indéfiniment.
--
-- ET L'ESCALADE QUI COMPTE VRAIMENT, `role_permission` SUR UN RÔLE SYSTÈME :
-- ce sont les rôles que les utilisateurs réels détiennent. Une écriture qui
-- réécrit leur composition de permissions prend effet à leur prochaine lecture
-- de `effectivePermissions`, sans seconde requête. Cet invariant vit aujourd'hui
-- UNIQUEMENT dans le code applicatif (`roles.controller.ts` :190 et :278 lèvent
-- une `ForbiddenException`) ; `is_system = false` dans une policy le déplace
-- vers la couche qu'un handler futur ne peut pas oublier.
--
-- LE RÉSIDU, ÉNONCÉ PLATEMENT (ADR-047 §Le résidu). Un admin de tenant peut
-- toujours attacher des permissions à un rôle CUSTOM via l'API livrée, borné par
-- `assertWithinCeiling` (PF-09) : c'est du comportement produit, pas un défaut
-- de base, et cette story ne le change pas. ET LA FORME PLUS DURE, MESURÉE :
-- `roles.controller.ts` ne pose JAMAIS `schoolId`, donc tout rôle que le produit
-- sait créer a `school_id` nul, branche que le prédicat de `role` admet pour
-- CHAQUE tenant. Après la bascule, `app_user` sous le tenant A peut donc éditer
-- ou supprimer un rôle CUSTOM du tenant B et réécrire ses permissions. Ce n'est
-- pas une régression (le propriétaire le fait déjà sans aucun prédicat) et ce
-- n'est pas corrigeable ici (les deux seuls remèdes sont ceux qu'ADR-047 §D7
-- refuse). C'est enregistré comme PF-194 et PROUVÉ PAR EXÉCUTION dans
-- `scripts/rls-isolation-check.js`, en `[LIMIT]` accepté, à côté de la forme
-- scopée-école montrée refusée. Une limite prouvée est un fait ; une limite
-- écrite en commentaire est un espoir.
--
-- CE QUI RESTE `SELECT` SEUL, ET POURQUOI CE N'EST PAS UN OUBLI (ADR-047 §D6) :
-- `tenant` (lui donner `INSERT` rendrait le rôle applicatif capable de FABRIQUER
-- des tenants — PF-185 rendu permanent) et `permission` (réellement globale,
-- mesuré dans l'en-tête de la migration-sœur ; rien ne l'écrit hors des seeds
-- connectés comme propriétaire).
--
-- ============================================================================
-- R-11, LA POSTURE DE VERROU, ET LA RE-JOUABILITÉ
-- ============================================================================
--
-- R-11 : le seul prédicat de garde qui traverse une clé étrangère est celui de
-- `role_permission`, par `role_id`. `role_permission_pkey`
-- (`PRIMARY KEY (role_id, permission_id)`) mène DÉJÀ par `role_id` — mesuré, et
-- VÉRIFIÉ ci-dessous avant de poser la moindre policy. Aucun index n'est créé
-- par ce fichier. Le prédicat de `role` ne traverse rien.
--
-- `CREATE POLICY` et `DROP POLICY` prennent un ACCESS EXCLUSIVE, et ce fichier
-- le prend six fois sur deux tables que CHAQUE requête d'autorisation lit.
-- `SET lock_timeout = '5s'` est donc re-énoncé plutôt qu'hérité en silence :
-- posture de reprise, la migration ÉCHOUE proprement au bout de 5 s et se
-- RELANCE telle quelle ; elle n'attend jamais indéfiniment sur une base vivante.
--
-- Re-jouable : PG 15 n'a pas d'`IF NOT EXISTS` sur `CREATE POLICY`, donc chaque
-- `CREATE` est précédé d'un `DROP POLICY IF EXISTS`. Le fichier rejoué ne change
-- rien.
--
-- ============================================================================
-- EXPAND / CONTRACT, ET LE ROLLBACK (G-MIGRATION, ADR-047 §D8)
-- ============================================================================
--
-- EXPAND PUR — et contrairement à sa sœur immédiate, celle-ci l'est vraiment :
-- aucune colonne créée, supprimée ou déplacée, AUCUNE CONTRAINTE, AUCUN INDEX,
-- aucune donnée réécrite, aucun comportement de l'app changé (elle se connecte
-- toujours comme propriétaire, `FORCE ROW LEVEL SECURITY` reste absent,
-- `DATABASE_URL` est intact). Le rollback n'a donc que des policies à retirer et
-- des privilèges à reprendre.
--
-- ROLLBACK — à exécuter tel quel, comme le PROPRIÉTAIRE des tables. Il rend
-- l'état d'AVANT CETTE MIGRATION, pas l'état vide : il ne touche PAS
-- `tenant_isolation`, il ne fait PAS `DISABLE ROW LEVEL SECURITY`, et il ne
-- reprend PAS le `SELECT` que `20260814180000` a accordé — le recopier depuis la
-- sœur laisserait la surface de référence illisible et RLS désactivée sur des
-- tables que la migration PRÉCÉDENTE protège.
--
--   DO $rollback$
--   DECLARE
--     t text;
--     c text;
--     guarded  CONSTANT text[] := ARRAY['role', 'role_permission'];
--     commands CONSTANT text[] := ARRAY['insert', 'update', 'delete'];
--     has_app_user CONSTANT boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user');
--   BEGIN
--     FOREACH t IN ARRAY guarded LOOP
--       FOREACH c IN ARRAY commands LOOP
--         EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'system_role_write_guard_' || c, t);
--       END LOOP;
--     END LOOP;
--     IF has_app_user THEN
--       REVOKE INSERT, UPDATE, DELETE ON public.role FROM app_user;
--       REVOKE INSERT, DELETE ON public.role_permission FROM app_user;
--     END IF;
--   END
--   $rollback$;
--
-- Ce renversement est EXÉCUTÉ par `scripts/rls-isolation-check.js` avant son
-- rollback générique, et asserté par relecture : les six policies de garde ont
-- disparu, `tenant_isolation` est TOUJOURS là sur les deux tables, et `app_user`
-- y détient de nouveau exactement `SELECT`. Un rollback jamais joué est une
-- assertion sur un commentaire.

-- `CREATE POLICY` / `DROP POLICY` prennent un ACCESS EXCLUSIVE : borner
-- l'attente plutôt que faire la queue derrière un lecteur long.
SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- LES SIX POLICIES DE GARDE ET LES DEUX GRANTS.
--
-- UN SEUL bloc, UN SEUL tableau littéral. Deux lignes de TROIS littéraux :
-- table, chaîne de privilèges À ACCORDER, prédicat du garde. Le prédicat est un
-- littéral PAR TABLE : les deux formes sont réellement différentes (comparaison
-- directe, saut vers le parent écrit en entier), et les factoriser produirait
-- une abstraction que personne ne peut relire.
--
-- Le bloc REFUSE de s'appliquer — jamais il ne saute une ligne, et le mot
-- `CONTINUE` n'apparaît nulle part — si : le tableau des tables n'a pas la
-- longueur attendue ; le tableau des commandes non plus ; une table est
-- introuvable ; `is_system` est absente ou NULLABLE ; `tenant_isolation` est
-- absente de la table ; une chaîne de privilèges sort du jeu FERMÉ ; une
-- commande sort du jeu FERMÉ ; un index de tête manque sur une colonne FK
-- qu'un prédicat de garde traverse (R-11).
-- ---------------------------------------------------------------------------
DO $role_write_surface$
DECLARE
  guarded CONSTANT text[][] := ARRAY[
    ARRAY['role', 'INSERT, UPDATE, DELETE', $pred$
      (
        role.is_system = false
      )
    $pred$],
    ARRAY['role_permission', 'INSERT, DELETE', $pred$
      (
        EXISTS (
          SELECT 1
            FROM public.role r
           WHERE r.id = role_permission.role_id
             AND r.is_system = false
        )
      )
    $pred$]
  ];

  -- Le jeu FERMÉ des commandes gardées. `SELECT` n'y est PAS, et c'est la
  -- décision : une policy restrictive `FOR SELECT` (ou `FOR ALL`) rendrait TOUT
  -- rôle système invisible et verrouillerait les quatre portails.
  commands CONSTANT text[] := ARRAY['INSERT', 'UPDATE', 'DELETE'];

  -- La famille de noms. Distincte de `tenant_isolation` par construction : le
  -- recensement compte PAR NOM, et une policy de garde portant ce nom-là ferait
  -- dérailler cinq assertions existantes au lieu d'en ajouter six nouvelles.
  guard_prefix CONSTANT text := 'system_role_write_guard_';

  -- JEU FERMÉ, à DEUX chaînes, et l'asymétrie est une MESURE : il n'existe aucun
  -- site appelant `rolePermission.update*` dans `apps/api/src` ni
  -- `apps/worker/src`. Élargir cette surface doit passer par une ligne de diff
  -- visible ici.
  allowed_privileges CONSTANT text[] := ARRAY['INSERT, UPDATE, DELETE', 'INSERT, DELETE'];

  -- Les colonnes FK que les prédicats de garde traversent réellement, et sur
  -- lesquelles R-11 est vérifié AVANT de poser la policy. Le prédicat de `role`
  -- n'en traverse aucune, donc `role` n'est pas dans cette liste.
  fk_paths CONSTANT text[][] := ARRAY[
    ARRAY['role_permission', 'role_id']
  ];

  expected_guarded  CONSTANT integer := 2;
  expected_commands CONSTANT integer := 3;

  -- Les rôles sont à l'échelle du CLUSTER, les migrations s'appliquent à une
  -- BASE. Calculé UNE fois : deux copies seraient une source de dérive.
  has_app_user CONSTANT boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user');

  i integer;
  j integer;
  target text;
  privileges text;
  predicate text;
  command text;
  policy_name text;
  target_oid oid;
  fk_attnum smallint;
  is_system_nullable boolean;
BEGIN
  IF array_length(guarded, 1) IS DISTINCT FROM expected_guarded THEN
    RAISE EXCEPTION
      'write surface : le tableau des tables gardées porte % lignes au lieu de % ; migration refusée',
      array_length(guarded, 1), expected_guarded;
  END IF;
  IF array_length(commands, 1) IS DISTINCT FROM expected_commands THEN
    RAISE EXCEPTION
      'write surface : le tableau des commandes porte % entrées au lieu de % ; une commande d''écriture '
      'non gardée est exactement le trou que cette migration existe pour fermer',
      array_length(commands, 1), expected_commands;
  END IF;

  -- (1) LA COLONNE DU GARDE. Si `is_system` était NULLABLE, `is_system = false`
  --     rendrait NULL sur une ligne à NULL, la policy la refuserait, et le garde
  --     échouerait FERMÉ — mais un lecteur futur « corrigerait » en
  --     `IS NOT TRUE`, qui échoue OUVERT. On refuse plutôt que de laisser ce
  --     choix se poser.
  IF to_regclass('public.role') IS NULL THEN
    RAISE EXCEPTION 'write surface : la table public.role est introuvable';
  END IF;
  SELECT NOT a.attnotnull INTO is_system_nullable
    FROM pg_attribute a
   WHERE a.attrelid = 'public.role'::regclass AND a.attname = 'is_system'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF is_system_nullable IS NULL THEN
    RAISE EXCEPTION
      'write surface : public.role ne porte pas la colonne is_system ; le garde n''a rien sur quoi porter';
  END IF;
  IF is_system_nullable THEN
    RAISE EXCEPTION
      'write surface : public.role.is_system est NULLABLE ; le garde « is_system = false » deviendrait de '
      'la logique à trois valeurs et la reparation tentante echoue OUVERT. Migration refusee.';
  END IF;

  -- (2) R-11 AVANT tout DDL : un prédicat a chemin FK sans index de tete sur la
  --     colonne FK est un balayage séquentiel a chaque ligne écrite.
  FOR i IN 1 .. array_length(fk_paths, 1) LOOP
    target_oid := to_regclass(format('public.%I', fk_paths[i][1]));
    IF target_oid IS NULL THEN
      RAISE EXCEPTION 'write surface : la table public.% est introuvable', fk_paths[i][1];
    END IF;
    SELECT a.attnum INTO fk_attnum
      FROM pg_attribute a
     WHERE a.attrelid = target_oid AND a.attname = fk_paths[i][2]
       AND a.attnum > 0 AND NOT a.attisdropped;
    IF fk_attnum IS NULL THEN
      RAISE EXCEPTION
        'write surface : public.% ne porte pas la colonne %', fk_paths[i][1], fk_paths[i][2];
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_index x WHERE x.indrelid = target_oid AND x.indkey[0] = fk_attnum
    ) THEN
      RAISE EXCEPTION
        'write surface : aucun index ne mene par public.%.% ; voir R-11 dans l''en-tête',
        fk_paths[i][1], fk_paths[i][2];
    END IF;
  END LOOP;

  -- (3) Les policies de garde, table par table, commande par commande.
  FOR i IN 1 .. array_length(guarded, 1) LOOP
    target     := guarded[i][1];
    privileges := guarded[i][2];
    predicate  := guarded[i][3];

    IF NOT (privileges = ANY (allowed_privileges)) THEN
      RAISE EXCEPTION
        'write surface : privilèges "%" hors du jeu fermé pour public.% ; voir ADR-047 §D1',
        privileges, target;
    END IF;

    target_oid := to_regclass(format('public.%I', target));
    IF target_oid IS NULL THEN
      RAISE EXCEPTION 'write surface : la table public.% est introuvable', target;
    END IF;

    -- La PRÉCONDITION qui remplace la promesse « le prédicat de SELECT est
    -- inchangé » : la policy permissive doit être là AVANT qu'un garde
    -- restrictif s'y compose. Sans elle, une base où `tenant_isolation` aurait
    -- disparu recevrait six gardes restrictifs et AUCUNE policy permissive —
    -- c'est-à-dire zéro ligne accessible, en silence.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy p WHERE p.polrelid = target_oid AND p.polname = 'tenant_isolation'
    ) THEN
      RAISE EXCEPTION
        'write surface : public.% ne porte pas la policy tenant_isolation posée par '
        '20260814180000 ; un garde RESTRICTIVE sans policy permissive ne laisse passer AUCUNE ligne',
        target;
    END IF;

    FOR j IN 1 .. array_length(commands, 1) LOOP
      command     := commands[j];
      policy_name := guard_prefix || lower(command);

      -- PG 15 n'a pas d'`IF NOT EXISTS` sur `CREATE POLICY`.
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, target);

      -- PG 15 n'accepte QUE `WITH CHECK` sur `FOR INSERT` et QUE `USING` sur
      -- `FOR DELETE` : une boucle qui émettrait les deux clauses partout
      -- refuserait de s'appliquer. Sur `FOR UPDATE`, où les deux doivent dire la
      -- même chose, `predicate` est injecté DEUX fois depuis la MÊME variable —
      -- identiques PAR CONSTRUCTION, pas par relecture. `USING` voit l'ANCIENNE
      -- ligne (on n'édite pas un rôle système) et `WITH CHECK` la NOUVELLE (on
      -- ne bascule pas un rôle custom en système).
      IF command = 'INSERT' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO PUBLIC WITH CHECK (%s)',
          policy_name, target, predicate);
      ELSIF command = 'UPDATE' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO PUBLIC USING (%s) WITH CHECK (%s)',
          policy_name, target, predicate, predicate);
      ELSIF command = 'DELETE' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO PUBLIC USING (%s)',
          policy_name, target, predicate);
      ELSE
        RAISE EXCEPTION
          'write surface : commande "%" hors du jeu fermé pour public.% ; migration refusée',
          command, target;
      END IF;
    END LOOP;

    -- La moitié ACCÈS : conditionnelle, table par table, jamais `ON ALL TABLES`.
    -- `%s` est sûr : `privileges` vient d'être validé contre le jeu FERMÉ. Le
    -- `SELECT` de `20260814180000` n'est PAS ré-émis : il est déjà là, et le
    -- ré-émettre serait une seconde source de vérité sur le même privilège.
    IF has_app_user THEN
      EXECUTE format('GRANT %s ON public.%I TO app_user', privileges, target);
    END IF;
  END LOOP;

  IF NOT has_app_user THEN
    RAISE NOTICE
      'write surface : le rôle app_user est absent de ce cluster ; les 6 policies de garde sont posées, '
      'les GRANTs sont sautés. Une policy ne dépend d''aucun rôle.';
  ELSE
    RAISE NOTICE
      'write surface : app_user est PRÉSENT ; INSERT, UPDATE, DELETE accordés sur public.role et '
      'INSERT, DELETE sur public.role_permission, sous les 6 policies de garde.';
  END IF;
END
$role_write_surface$;
