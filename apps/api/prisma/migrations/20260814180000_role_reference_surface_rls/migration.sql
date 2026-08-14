-- S-E01-1b — LA SURFACE DE RÉFÉRENCE de la bascule de connexion : `app_user`
-- peut enfin terminer une jointure d'autorisation, et `role` cesse d'être
-- classée « globale » alors qu'elle porte de la donnée de tenant.
--
-- Migration RELUE À LA MAIN (ADR-027, G-MIGRATION). Elle n'a été produite ni par
-- `prisma migrate dev` ni par `prisma db push` — aucune des deux chaînes
-- n'apparaît dans ce diff, et Prisma ne sait modéliser ni une policy ni un
-- GRANT, donc l'essentiel de ce fichier n'est dérivable d'aucun schéma.
--
-- `schema.prisma` EST touché par cette story, et c'est INÉVITABLE : la clé
-- étrangère `role_school_id_fkey` posée ici, Prisma la VOIT. Sans les deux
-- champs de relation correspondants (`Role.school` / `School.roles`),
-- `prisma migrate diff --exit-code` sort en 2 avec « Removed foreign key on
-- columns (school_id) » — MESURÉ. Le piège `prisma generate` est donc armé par
-- cette story et refermé dans le même diff.
--
-- LES DÉCISIONS SONT DANS `docs/adr/ADR-046-authorization-reference-surface.md`.
-- Ce fichier les CITE ; il n'en prend aucune. Un commentaire de migration ne
-- peut pas supersédér une décision de record.
--
-- ============================================================================
-- CE QU'ELLE FAIT — ET SURTOUT CE QU'ELLE NE FAIT PAS
-- ============================================================================
--
-- ELLE FAIT, dans l'ordre :
--   1. une PRÉ-VÉRIFICATION d'orphelins, puis `role_school_id_fkey`
--      (`role.school_id -> school.id`, ON DELETE CASCADE ON UPDATE CASCADE) ;
--   2. un index `user_role_role_id_idx`, rendu OBLIGATOIRE par (1) — voir §R-11 ;
--   3. `ENABLE ROW LEVEL SECURITY` + une policy `tenant_isolation` (MÊME NOM que
--      les 50 autres, le recensement compte par nom) sur `role`,
--      `role_permission` et `tenant` ;
--   4. un GRANT `SELECT` — et RIEN d'autre — sur la surface de référence :
--      `role`, `role_permission`, `permission`, `tenant`, `_prisma_migrations`.
--
-- ELLE NE FAIT PAS : basculer la connexion. **Après cette migration,
-- l'application qui tourne n'est TOUJOURS PAS isolée par RLS.** Elle se connecte
-- comme `pilotage`, PROPRIÉTAIRE des tables, et un propriétaire n'est pas soumis
-- à ses propres policies tant que `FORCE ROW LEVEL SECURITY` n'est pas posé — et
-- il ne l'est toujours pas, délibérément (ADR-032 §D5). `DATABASE_URL` n'est PAS
-- touché par ce diff. Ce qui reste est la BASCULE DE CONNEXION, pas davantage de
-- travail de policy. Aucune phrase de ce fichier ne doit pouvoir se lire comme
-- « l'app est isolée par RLS » : cette surclamation EST le défaut que PF-02
-- enregistre depuis l'origine.
--
-- ============================================================================
-- PF-191 — LA CLASSIFICATION QUI ÉTAIT FAUSSE
-- ============================================================================
--
-- `20260813120000_tenant_rls_policies` §LE PÉRIMÈTRE classe `role` en
-- « A. RÉELLEMENT GLOBALES — aucun discriminant de tenant, aucune donnée d'un
-- tenant ». MESURÉ : c'est FAUX. `role` porte `school_id UUID` (baseline,
-- `CREATE TABLE "role"`), et `school` porte `tenant_id UUID NOT NULL`. Une ligne
-- de `role` avec un `school_id` non nul appartient donc à UN tenant. Un GRANT
-- `SELECT` nu sur `role` aurait laissé le tenant A lire les rôles CUSTOM du
-- tenant B à la seconde de la bascule. Enregistré comme PF-191 ; le commentaire
-- fautif est corrigé SUR PLACE, en annotation, jamais par réécriture.
--
-- CE QUI RENDAIT LA CLASSIFICATION INVISIBLE, et que la story se trompait aussi
-- en croyant : « la FK de `role` est NULLABLE ». MESURÉ : il n'y a AUCUNE FK.
-- `pg_constraint` ne rend AUCUNE ligne `contype='f'` pour `role`, et `schema.
-- prisma` ne déclarait aucune `@relation`. C'est exactement pourquoi la
-- dérivation structurelle de `scripts/rls-isolation-check.js` ne la voyait pas —
-- et ce fichier avait PRÉDIT le remède, mot pour mot :
--
--   « `role` already carries a `school_id` column with no FK constraint, and the
--     day ADR-015 custom roles add `role_school_id_fkey`, `role` correctly ENTERS
--     the derived set »
--
-- On ne corrige donc PAS le compte à la main. On pose la FK qui manquait, et
-- l'accord du recensement se déplace tout seul (ADR-046 §D2).
--
-- ============================================================================
-- C-1 — `role_permission` : LE RÉSIDU À DEUX SAUTS, PROUVÉ ET REFERMÉ ICI
-- ============================================================================
--
-- La dérivation de `S-E01-2c` était d'UN SEUL NIVEAU, et son propre commentaire
-- le disait. Dès que `role` devient tenant-dérivée, `role_permission` devient le
-- résidu à DEUX sauts : un GRANT nu y exposerait `(role_id, permission_id)` pour
-- les rôles custom d'un autre tenant — leurs identifiants ET leur composition
-- de privilèges complète. C'EST UNE LECTURE INTER-TENANT MESURÉE, pas une
-- crainte : exécutée comme `app_user` sous GUC = tenant A contre une ligne
-- appartenant à un rôle custom du tenant B, elle rendait `1`.
--
-- `role_permission` reçoit donc sa propre policy, dont le prédicat est ÉCRIT EN
-- ENTIER (deux sauts : `role` puis `school`) et ne s'appuie PAS sur la policy de
-- `role`. La raison est celle d'ADR-042 §D1, clause 3 : exécutée comme
-- `app_user` la sous-requête serait déjà filtrée par la policy de `role`, mais
-- exécutée comme le PROPRIÉTAIRE — qui joue les migrations, les seeds et toute
-- l'application d'aujourd'hui — aucune policy ne s'applique, et le prédicat
-- complet est alors la SEULE chose qui travaille.
--
-- Et la dérivation du vérificateur devient TRANSITIVEMENT CLOSE (CTE récursive
-- sur `pg_constraint`, aucun littéral) — sans quoi `role_permission` serait
-- absente des DEUX côtés de l'accord et le recensement resterait vert sur
-- exactement le défaut qu'il existe pour voir.
--
-- ============================================================================
-- LES TROIS PRÉDICATS, ET LE `IS NULL OR` QUI N'EST PAS LA FORME INTERDITE
-- ============================================================================
--
-- `role` :
--   role.school_id IS NULL
--   OR EXISTS (SELECT 1 FROM public.school s
--               WHERE s.id = role.school_id
--                 AND s.tenant_id = <GUC casté>)
--
-- LA DISTINCTION, ARGUMENTÉE ET NON COPIÉE (ADR-046 §D3). La forme BANNIE par
-- DNC-10 est celle où le CONTEXTE nul ouvre la table : le `current_setting(...)`
-- lui-même à gauche du `OR`. Ici, ce qui est nul est une donnée : `school_id`
-- nul est un FAIT — « cette ligne n'appartient à aucune école », c'est-à-dire un
-- rôle SYSTÈME, référence globale par conception (ADR-015). Le contexte, lui, ne
-- relâche RIEN : sans GUC, `<GUC casté>` vaut NULL, l'`EXISTS` est FAUX, et
-- AUCUN rôle rattaché à une école n'est visible. Contexte absent = zéro ligne
-- scopée, sans erreur levée. Les trois ratchets textuels d'
-- `apps/api/src/shared/prisma/prisma.service.spec.ts` ont été VÉRIFIÉS sur ce
-- prédicat : aucun ne le reconnaît, et c'est correct dans les deux sens.
--
-- L'EXPOSITION HONNÊTE, écrite plutôt que tue : SANS AUCUN contexte de tenant,
-- `app_user` lit TOUS les rôles système et TOUTES les lignes de `permission`.
-- C'est VOULU — c'est de la donnée de référence globale — mais il faut l'écrire,
-- parce que c'est la phrase qu'un lecteur futur prendrait autrement pour une
-- fuite, ou pire, pour de la couverture.
--
-- LE RÉSIDU CONNU, NOMMÉ ET NON CORRIGÉ ICI (ADR-046 §D3, PF-08 / ADR-015 D8.6).
-- `roles.controller.ts` ne pose JAMAIS `schoolId` à la création : tout rôle que
-- le produit sait créer aujourd'hui tombe dans la branche `IS NULL` et reste
-- donc visible de tous. La policy ci-dessus n'isole que des rôles que seul un
-- import ou une story future produira. L'écrire est le contraire de la
-- surclamation ; le corriger en silence dans cette story serait un changement de
-- comportement produit déguisé en migration.
--
-- `role_permission` : le même prédicat, précédé du saut `role_permission.role_id
-- -> role.id`, écrit en entier.
--
-- `tenant` :
--   tenant.id = <GUC casté>
--
-- LE POULET ET L'ŒUF D'AC-3 A ÉTÉ MESURÉ, ET IL N'EXISTE PLUS (ADR-046 §D4).
-- L'en-tête de `20260813120000` excluait `tenant` parce que « la couture
-- identité doit la lire PAR SLUG avant qu'un tenant soit résolu ». MESURÉ sur
-- `apps/api/src` APRÈS `S-E01-1a` : il n'existe AUCUNE lecture de `tenant` par
-- slug. Les seules lectures sont `analytics.service.ts` et le générateur CSV du
-- worker, toutes deux `where: { id: tenantId }`. Les lectures par slug sont dans
-- `prisma/seed*.ts`, qui se connectent comme le PROPRIÉTAIRE. La seule ÉCRITURE
-- par slug restante est `register.controller.ts` (`tenant.upsert`), et elle est
-- elle-même le défaut ouvert PF-185, pas une couture à préserver.
--
-- CONSÉQUENCE : la fonction `SECURITY DEFINER` « préférée » par l'énoncé
-- d'origine serait du CODE PRIVILÉGIÉ SANS AUCUN APPELANT — une surface
-- d'escalade permanente ajoutée pour résoudre un problème qui n'existe pas. Elle
-- n'est donc PAS écrite. `tenant` reçoit la policy simple `id = <GUC>`, ce qui
-- ferme aussi l'oracle d'ÉNUMÉRATION que l'épique §10 interdit : sans contexte,
-- `app_user` ne voit AUCUN tenant.
--
-- `nullif(current_setting(…, true), '')::uuid` est REPRIS VERBATIM d'ADR-032 §D6
-- et n'est pas re-débattu : `missing_ok` ne couvre QUE « jamais posé » ; après le
-- COMMIT d'un `set_config(…, true)` le GUC vaut `''` et NON NULL, et un cast nu
-- lèverait 22P02 à la DEUXIÈME requête de CHAQUE connexion du pool.
--
-- `FOR ALL TO PUBLIC`, jamais `TO app_user` : une policy nommant un rôle
-- exempterait en silence tout AUTRE rôle non-propriétaire. `WITH CHECK` est
-- injecté depuis la MÊME variable que `USING` : identiques PAR CONSTRUCTION.
--
-- ============================================================================
-- LES GRANTS : `SELECT` SEUL, ET LE JEU EST FERMÉ (ADR-046 §D5)
-- ============================================================================
--
-- Jamais `ON ALL TABLES IN SCHEMA public` : cette forme donnerait aussi les
-- tables SANS policy. Les GRANTs portent table par table, et la surface entière
-- ne reçoit QUE `SELECT` — jeu fermé à UNE chaîne, vérifié avant tout DDL.
--
-- POURQUOI `SELECT` SEUL. De la donnée de privilège que le rôle applicatif peut
-- ÉCRIRE est un chemin d'escalade : `app_user` pouvant écrire `role_permission`
-- pourrait s'attribuer n'importe quelle permission. ADR-032 §D7 a déjà fixé le
-- principe du privilège minimal.
--
-- ET L'ÉNONCÉ HONNÊTE QUI VA AVEC : « SELECT seul » est un ÉNONCÉ DE PÉRIMÈTRE
-- POUR CETTE STORY, PAS une affirmation que l'application n'écrit jamais ces
-- tables. Elle les écrit : `roles.controller.ts` fait `role.create`,
-- `role.update`, `rolePermission.deleteMany` et `rolePermission.createMany`
-- (création et édition de rôles custom, portail admin). Ces appels fonctionnent
-- aujourd'hui parce que l'app est le PROPRIÉTAIRE ; ils échoueraient après la
-- bascule. Le chemin d'écriture est donc DÉFÉRÉ, nommément, comme PF-193 — il
-- demande sa propre décision (rôle d'administration séparé ? écriture par
-- fonction `SECURITY DEFINER` étroite ?) et pas un élargissement réflexe du
-- GRANT ici.
--
-- MÊME CHOSE POUR `tenant`, et c'est un blocage assumé : `register.controller.ts`
-- fait `tenant.upsert`, une ÉCRITURE. Lui donner `INSERT`/`UPDATE` « pour que
-- l'inscription continue de marcher » rendrait le rôle applicatif capable de
-- FABRIQUER des tenants — PF-185 rendu permanent. Cette écriture est un BLOQUEUR
-- DE BASCULE possédé par PF-185, jamais débloqué en silence ici.
--
-- Les GRANTs sont conditionnés à l'EXISTENCE du rôle (`pg_roles`), calculée UNE
-- seule fois dans une constante : les rôles sont à l'échelle du CLUSTER, les
-- migrations s'appliquent à une BASE, et le garde de dérive comme le job CI
-- appliquent le ledger à des bases neuves où `app_user` n'existe pas. La moitié
-- ENABLE / CREATE POLICY / ADD CONSTRAINT reste INCONDITIONNELLE : ce sont des
-- propriétés de structure et de sécurité, elles ne dépendent d'aucun rôle.
--
-- `_prisma_migrations` porte une SECONDE garde, sur `to_regclass`, et la branche
-- prise est IMPRIMÉE. Raison mesurée : cette table est créée par la CLI Prisma,
-- pas par le SQL, donc elle est ABSENTE des bases scratch où le vérificateur
-- applique le ledger fichier par fichier avec `psql`. Un GRANT nu y lèverait
-- « relation does not exist » et ferait échouer l'application entière du ledger
-- — c'est-à-dire tuerait le harnais de preuve avant sa première assertion.
--
-- POURQUOI ELLE EST DANS LA SURFACE : `apps/api/src/main.ts` appelle
-- `assertMigrationsClean(...)` AU DÉMARRAGE, et `health.controller.ts` appelle
-- `readMigrationState(...)` à CHAQUE sonde de santé. Sans ce `SELECT`, la
-- bascule casserait deux fois : une au boot, une par health check.
--
-- `permission` est la seule table de la surface qui NE REÇOIT PAS de policy, et
-- c'est mesuré, pas concédé : ses colonnes sont `id`, `code`, `label`,
-- `resource_type`, `action`, `description` — aucun discriminant, aucune FK vers
-- une table qui en porte un. Elle est RÉELLEMENT globale, contrairement à `role`.
--
-- AUCUN grant de séquence (mesuré : zéro séquence dans `public`), et AUCUN
-- `GRANT USAGE ON SCHEMA public` : la migration des 44 l'a déjà émis
-- nominativement, le ré-émettre serait une seconde source de vérité.
--
-- ============================================================================
-- LA CLÉ ÉTRANGÈRE : PRÉ-VÉRIFIÉE, JAMAIS `NOT VALID`, JAMAIS `SET NULL`
-- ============================================================================
--
-- `ON DELETE CASCADE ON UPDATE CASCADE` — la convention des 13 autres FK
-- `school_id` du schéma, et la seule forme pour laquelle `prisma migrate diff`
-- rend `No difference detected` face à `onDelete: Cascade` (MESURÉ ; toute autre
-- action rendrait le garde de dérive ROUGE).
--
-- `ON DELETE SET NULL` EST INTERDIT PAR NOM (ADR-046 §D2) : il PROMEUT un rôle
-- scopé à une école en rôle GLOBAL au moment où l'école est supprimée — la forme
-- d'escalade la plus sévère que `legacy-escalation-sweep.ts` sache signaler. Un
-- scan du SQL exécutable de ce fichier l'assertit.
--
-- CE QUE `CASCADE` CHANGE, écrit plutôt que tu : supprimer une école supprime
-- désormais ses rôles custom, alors qu'ils étaient auparavant laissés orphelins.
-- C'est le comportement voulu (un rôle orphelin serait invisible de TOUS sous la
-- policy, donc une perte de privilège SILENCIEUSE — un mauvais résultat, pas un
-- refus). MESURÉ sur la base vivante : `role` porte ZÉRO ligne, donc ni backfill
-- ni risque de validation ici.
--
-- La PRÉ-VÉRIFICATION d'orphelins refuse BRUYAMMENT, avec le compte, plutôt que
-- de poser la contrainte `NOT VALID` (qui laisserait la promesse non tenue) ou
-- de sauter (qui livrerait une policy à chemin FK sans chemin FK).
--
-- ============================================================================
-- R-11 : L'INDEX, ET POURQUOI IL Y EN A EXACTEMENT UN
-- ============================================================================
--
-- `role.school_id` : AUCUN index créé — `role_school_id_slug_key`
-- (`UNIQUE (school_id, slug)`, baseline) mène DÉJÀ par `school_id`. Mesuré, pas
-- supposé, et vérifié ci-dessous avant de poser la policy.
--
-- `role_permission.role_id` : AUCUN index créé — `role_permission_pkey`
-- (`PRIMARY KEY (role_id, permission_id)`) mène déjà par `role_id`.
--
-- `user_role.role_id` : UN index EST créé, et c'est une CONSÉQUENCE MESURÉE de
-- la FK, pas une addition défensive. `user_role` détient `role_id -> role` ;
-- `role` entrant dans l'ensemble dérivé, cette arête entre dans la dérivation
-- structurelle, et le cliquet R-11 du vérificateur exige un index de TÊTE sur
-- toute colonne FK d'une arête dérivée. L'index existant,
-- `user_role_user_profile_id_role_id_school_id_key`, mène par `user_profile_id`
-- — donc PAS par `role_id`. Sans `user_role_role_id_idx`, le vérificateur
-- rougirait, et la « correction » tentante serait d'affaiblir le cliquet.
-- L'index est de toute façon dû : la cascade `role -> user_role` posée ci-dessus
-- est un balayage séquentiel sans lui.
--
-- Le chemin tenant de `user_role` reste `user_profile_id`, JAMAIS `role_id` : un
-- rôle SYSTÈME (`school_id IS NULL`) est visible de tous, donc router `user_role`
-- par `role_id` rendrait ses attributions visibles de tous. L'arête existe dans
-- la dérivation ; elle ne devient pas pour autant le chemin de la policy.
--
-- ============================================================================
-- EXPAND / CONTRACT, ET LE ROLLBACK (G-MIGRATION, ADR-046 §D6)
-- ============================================================================
--
-- EXPAND SEUL. Aucune colonne créée, supprimée ou déplacée, aucune donnée
-- réécrite, aucun comportement de l'app changé (elle se connecte toujours comme
-- propriétaire, `FORCE ROW LEVEL SECURITY` reste absent, `DATABASE_URL` est
-- intact). CE N'EST PAS un expand PUR au sens des deux premières : une CONTRAINTE
-- et un INDEX sont créés, donc le rollback doit les retirer aussi.
--
-- Re-jouable : `CREATE POLICY` n'a pas d'`IF NOT EXISTS` en PG 15, donc chaque
-- `CREATE` est précédé d'un `DROP POLICY IF EXISTS` ; la FK et l'index sont posés
-- sous condition d'absence.
--
-- `SET lock_timeout` : `ENABLE ROW LEVEL SECURITY` et `ADD CONSTRAINT` prennent
-- un ACCESS EXCLUSIVE. Posture de reprise : la migration ÉCHOUE proprement au
-- bout de 5 s et se RELANCE telle quelle ; elle n'attend jamais indéfiniment sur
-- une base vivante.
--
-- ROLLBACK — à exécuter tel quel, comme le PROPRIÉTAIRE des tables. Il est sûr
-- *parce que* rien ne se connecte encore comme `app_user`. Le DROP POLICY vient
-- AVANT le DISABLE : laisser RLS actif sans policy refuserait TOUT à `app_user`.
-- Il faut AUSSI défaire `schema.prisma` (retirer `Role.school`, `School.roles`,
-- `@@index([roleId])` de `UserRole`) et relancer
-- `pnpm --filter @pilotage/api exec prisma generate`, sans quoi le garde de
-- dérive rougirait dans l'autre sens.
--
--   DO $rollback$
--   DECLARE
--     t text;
--     policied CONSTANT text[] := ARRAY['role', 'role_permission', 'tenant'];
--     surface  CONSTANT text[] := ARRAY['role', 'role_permission', 'tenant',
--                                       'permission', '_prisma_migrations'];
--     has_app_user CONSTANT boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user');
--   BEGIN
--     FOREACH t IN ARRAY policied LOOP
--       EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
--       EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
--     END LOOP;
--     IF has_app_user THEN
--       FOREACH t IN ARRAY surface LOOP
--         IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
--           EXECUTE format('REVOKE SELECT, INSERT, UPDATE, DELETE ON public.%I FROM app_user', t);
--         END IF;
--       END LOOP;
--     END IF;
--     ALTER TABLE public.role DROP CONSTRAINT IF EXISTS role_school_id_fkey;
--     DROP INDEX IF EXISTS public.user_role_role_id_idx;
--   END
--   $rollback$;
--
-- Ce renversement est EXÉCUTÉ par `scripts/rls-isolation-check.js`, pas seulement
-- écrit ici : un rollback jamais joué est une assertion sur un commentaire.

-- `ENABLE ROW LEVEL SECURITY` et `ADD CONSTRAINT` prennent un ACCESS EXCLUSIVE :
-- borner l'attente plutôt que faire la queue derrière un lecteur long.
SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- (I) LA STRUCTURE — la clé étrangère qui manquait, et l'index qu'elle impose.
--
-- Ce bloc est INCONDITIONNEL : une contrainte de structure ne dépend d'aucun
-- rôle. Il REFUSE de s'appliquer plutôt que de sauter, et il refuse AVEC LE
-- COMPTE d'orphelins pour qu'un opérateur sache quoi corriger.
-- ---------------------------------------------------------------------------
DO $role_fk$
DECLARE
  orphan_count integer;
BEGIN
  SELECT count(*) INTO orphan_count
    FROM public.role r
   WHERE r.school_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.school s WHERE s.id = r.school_id);

  IF orphan_count > 0 THEN
    -- Le message ne contient PAS la chaîne que le garde textuel interdit
    -- (« la contrainte non validée »), et ce n''est pas de la coquetterie :
    -- `executableSql` ne retire que les commentaires `--`, donc une phrase de
    -- diagnostic citant la forme bannie ferait rougir le garde sur sa propre
    -- documentation, et la « correction » tentante serait de supprimer le garde.
    RAISE EXCEPTION
      'role_school_id_fkey : % ligne(s) orphelines dans public.role pointent vers une école '
      'inexistante ; la contrainte est REFUSÉE plutôt que posée sans validation. Corrigez ou '
      'effacez ces lignes, puis relancez : une policy a chemin FK sans chemin FK ne protege rien.',
      orphan_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'role_school_id_fkey' AND conrelid = 'public.role'::regclass
  ) THEN
    -- Le NOM et la FORME sont ceux que Prisma génère pour
    -- `school School? @relation(fields: [schoolId], references: [id], onDelete: Cascade)`.
    -- Toute divergence rendrait le garde de dérive ROUGE (MESURÉ).
    EXECUTE 'ALTER TABLE public.role ADD CONSTRAINT role_school_id_fkey '
            'FOREIGN KEY (school_id) REFERENCES public.school(id) '
            'ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;

  -- R-11, voir l'en-tête : `role` entrant dans l'ensemble dérivé, l'arête
  -- `user_role.role_id -> role` y entre aussi, et aucun index existant ne mène
  -- par `user_role.role_id`. Nom Prisma de `@@index([roleId])` sur `UserRole`.
  CREATE INDEX IF NOT EXISTS user_role_role_id_idx ON public.user_role (role_id);
END
$role_fk$;

-- ---------------------------------------------------------------------------
-- (II) LES POLICIES ET LES GRANTS.
--
-- UN SEUL bloc, UN SEUL tableau littéral. Trois lignes de TROIS littéraux :
-- table, chaîne de privilèges, prédicat. Le prédicat est un littéral PAR TABLE —
-- contrairement aux cinq dérivées, les trois formes sont réellement différentes
-- (un saut, deux sauts, comparaison directe), et les factoriser en un `format()`
-- commun produirait une abstraction que personne ne peut relire.
--
-- Le bloc REFUSE de s'appliquer — jamais il ne saute une ligne — si : le nombre
-- de lignes n'est pas celui attendu ; une table est introuvable ; une chaîne de
-- privilèges sort du jeu FERMÉ ; un index de tête manque sur une colonne FK
-- utilisée par un prédicat (R-11).
-- ---------------------------------------------------------------------------
DO $rls_reference$
DECLARE
  -- Les tables qui reçoivent une POLICY. `permission` n'y est pas : elle est
  -- réellement globale (aucun discriminant, aucune FK vers une table qui en
  -- porte un), et lui poser une policy serait une fiction.
  policied CONSTANT text[][] := ARRAY[
    ARRAY['role', 'SELECT', $pred$
      (
        role.school_id IS NULL
        OR EXISTS (
          SELECT 1
            FROM public.school s
           WHERE s.id = role.school_id
             AND s.tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid
        )
      )
    $pred$],
    ARRAY['role_permission', 'SELECT', $pred$
      (
        EXISTS (
          SELECT 1
            FROM public.role r
           WHERE r.id = role_permission.role_id
             AND (
               r.school_id IS NULL
               OR EXISTS (
                 SELECT 1
                   FROM public.school s
                  WHERE s.id = r.school_id
                    AND s.tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid
               )
             )
        )
      )
    $pred$],
    ARRAY['tenant', 'SELECT', $pred$
      (
        tenant.id = nullif(current_setting('app.current_tenant_id', true), '')::uuid
      )
    $pred$]
  ];

  -- La surface de RÉFÉRENCE : tout ce que la jointure d'autorisation traverse.
  -- Les trois ci-dessus PLUS les deux qui ne reçoivent aucune policy.
  reference_only CONSTANT text[] := ARRAY['permission', '_prisma_migrations'];

  -- JEU FERMÉ, à UNE seule chaîne. C'est un RÉTRÉCISSEMENT de privilège par
  -- rapport aux deux jeux des migrations précédentes, pas un élargissement :
  -- élargir cette surface doit passer par une ligne de diff visible ici.
  allowed_privileges CONSTANT text[] := ARRAY['SELECT'];

  -- Les colonnes FK que les prédicats ci-dessus traversent réellement, et sur
  -- lesquelles R-11 est vérifié AVANT de poser la policy.
  fk_paths CONSTANT text[][] := ARRAY[
    ARRAY['role', 'school_id'],
    ARRAY['role_permission', 'role_id'],
    ARRAY['user_role', 'role_id']
  ];

  expected_policied  CONSTANT integer := 3;
  expected_reference CONSTANT integer := 2;

  -- Les rôles sont à l'échelle du CLUSTER, les migrations s'appliquent à une
  -- BASE. Calculé UNE fois : deux copies seraient une source de dérive.
  has_app_user CONSTANT boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user');

  i integer;
  target text;
  privileges text;
  predicate text;
  target_oid oid;
  fk_attnum smallint;
BEGIN
  IF array_length(policied, 1) IS DISTINCT FROM expected_policied THEN
    RAISE EXCEPTION
      'reference surface : le tableau des tables sous policy porte % lignes au lieu de % ; migration refusée',
      array_length(policied, 1), expected_policied;
  END IF;
  IF array_length(reference_only, 1) IS DISTINCT FROM expected_reference THEN
    RAISE EXCEPTION
      'reference surface : le tableau des tables sans policy porte % lignes au lieu de % ; migration refusée',
      array_length(reference_only, 1), expected_reference;
  END IF;

  -- (1) R-11 AVANT tout DDL : une policy a chemin FK sans index de tete sur la
  --     colonne FK est un balayage séquentiel a chaque ligne lue.
  FOR i IN 1 .. array_length(fk_paths, 1) LOOP
    target_oid := to_regclass(format('public.%I', fk_paths[i][1]));
    IF target_oid IS NULL THEN
      RAISE EXCEPTION 'reference surface : la table public.% est introuvable', fk_paths[i][1];
    END IF;
    SELECT a.attnum INTO fk_attnum
      FROM pg_attribute a
     WHERE a.attrelid = target_oid AND a.attname = fk_paths[i][2]
       AND a.attnum > 0 AND NOT a.attisdropped;
    IF fk_attnum IS NULL THEN
      RAISE EXCEPTION
        'reference surface : public.% ne porte pas la colonne %', fk_paths[i][1], fk_paths[i][2];
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_index x WHERE x.indrelid = target_oid AND x.indkey[0] = fk_attnum
    ) THEN
      RAISE EXCEPTION
        'reference surface : aucun index ne mene par public.%.% ; voir R-11 dans l''en-tête',
        fk_paths[i][1], fk_paths[i][2];
    END IF;
  END LOOP;

  -- (2) La FK de structure doit être là AVANT que la policy s'appuie dessus.
  --     Le bloc (I) vient de la poser ; le vérifier ici est ce qui distingue une
  --     dépendance ÉNONCÉE d'une dépendance ESPÉRÉE.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'role_school_id_fkey' AND conrelid = 'public.role'::regclass
       AND contype = 'f' AND confrelid = 'public.school'::regclass AND confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION
      'reference surface : role_school_id_fkey est absente ou n''est pas ON DELETE CASCADE ; '
      'la dérivation structurelle du recensement ne verrait pas public.role';
  END IF;

  -- (3) Les policies, table par table.
  FOR i IN 1 .. array_length(policied, 1) LOOP
    target     := policied[i][1];
    privileges := policied[i][2];
    predicate  := policied[i][3];

    IF NOT (privileges = ANY (allowed_privileges)) THEN
      RAISE EXCEPTION
        'reference surface : privilèges "%" hors du jeu fermé pour public.% ; voir ADR-046 §D5',
        privileges, target;
    END IF;

    target_oid := to_regclass(format('public.%I', target));
    IF target_oid IS NULL THEN
      RAISE EXCEPTION 'reference surface : la table public.% est introuvable', target;
    END IF;

    -- Moitié SÉCURITÉ : INCONDITIONNELLE. Pas de `FORCE` — voir l'en-tête.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);

    -- PG 15 n'a pas d'`IF NOT EXISTS` sur `CREATE POLICY`.
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', target);

    -- `predicate` est injecté DEUX fois depuis la MÊME variable : `USING` et
    -- `WITH CHECK` sont identiques PAR CONSTRUCTION, pas par relecture.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I FOR ALL TO PUBLIC USING (%s) WITH CHECK (%s)',
      target, predicate, predicate);

    -- Moitié ACCÈS : conditionnelle, table par table, jamais `ON ALL TABLES`.
    -- `%s` est sûr : `privileges` vient d'être validé contre le jeu FERMÉ.
    IF has_app_user THEN
      EXECUTE format('GRANT %s ON public.%I TO app_user', privileges, target);
    END IF;
  END LOOP;

  -- (4) Les deux tables SANS policy de la surface. `_prisma_migrations` porte la
  --     garde `to_regclass` en PLUS, et la branche prise est IMPRIMÉE.
  IF has_app_user THEN
    FOR i IN 1 .. array_length(reference_only, 1) LOOP
      target := reference_only[i];
      IF to_regclass(format('public.%I', target)) IS NULL THEN
        RAISE NOTICE
          'reference surface : public.% est ABSENTE de cette base (la CLI Prisma la crée, pas le '
          'SQL) ; le GRANT est sauté. C''est la branche attendue sur une base scratch.', target;
      ELSE
        EXECUTE format('GRANT SELECT ON public.%I TO app_user', target);
        RAISE NOTICE 'reference surface : public.% est PRÉSENTE ; SELECT accordé.', target;
      END IF;
    END LOOP;
  END IF;

  IF NOT has_app_user THEN
    RAISE NOTICE
      'reference surface : le rôle app_user est absent de ce cluster ; les 3 policies et la clé '
      'étrangère sont posées, les GRANTs sont sautés. Les policies ne dépendent d''aucun rôle.';
  END IF;
END
$rls_reference$;
