-- S-E01-2c — ROW LEVEL SECURITY sur les tables tenant-DÉRIVÉES : celles qui
-- APPARTIENNENT à un tenant par CLÉ ÉTRANGÈRE sans porter de colonne
-- `tenant_id`. Policies à prédicat `EXISTS` sur le parent, GRANT DML par table,
-- PROUVÉES PAR EXÉCUTION.
--
-- Migration RELUE À LA MAIN (ADR-027, G-MIGRATION). Elle n'a pas été produite
-- par `prisma migrate dev`, et `prisma db push` n'apparaît nulle part dans ce
-- diff : Prisma ne sait modéliser ni une policy ni un GRANT, donc rien ici n'est
-- dérivable de `schema.prisma`.
--
-- `schema.prisma` N'EST PAS TOUCHÉ par cette story, et c'est délibéré : l'y
-- toucher armerait le piège `prisma generate` (typecheck ROUGE tant que le
-- client n'est pas régénéré) pour un fichier que le diff de dérive ne peut de
-- toute façon pas voir.
--
-- LES DÉCISIONS SONT DANS `docs/adr/ADR-042-fk-path-tenant-isolation.md`, et
-- accessoirement dans `ADR-032` §D5–§D8 qu'ADR-042 ÉTEND (il ne supersède rien).
-- Ce fichier les CITE ; il n'en prend aucune. Un commentaire de migration ne
-- peut pas supersédér une décision de record — cette leçon a coûté trois runs.
--
-- ============================================================================
-- CE QUE CETTE MIGRATION FAIT — ET SURTOUT CE QU'ELLE NE FAIT PAS
-- ============================================================================
--
-- ELLE FAIT : `ENABLE ROW LEVEL SECURITY` + une policy `tenant_isolation` (même
-- NOM que celle des 44 — le recensement compte par nom) sur les CINQ tables de
-- `public` qui ne portent AUCUNE colonne `tenant_id` mais détiennent une clé
-- étrangère vers une table qui en porte une ; plus un GRANT DML **par table**,
-- au rôle non-propriétaire `app_user`.
--
-- ELLE NE FAIT PAS : rendre l'application isolée par RLS. **Après cette
-- migration, l'application qui tourne n'est TOUJOURS PAS isolée par RLS.** Elle
-- se connecte comme `pilotage`, PROPRIÉTAIRE des 55 tables, et un propriétaire
-- n'est pas soumis à ses propres policies tant que `FORCE ROW LEVEL SECURITY`
-- n'est pas posé — et il ne l'est toujours pas, délibérément (ADR-032 §D5 :
-- l'app se connectant encore comme propriétaire, `FORCE` rendrait ZÉRO LIGNE à
-- tous les portails). Ce qui reste est la BASCULE DE CONNEXION (`S-E01-1`), pas
-- davantage de travail de policy. Aucune phrase de ce fichier ne doit pouvoir se
-- lire comme « l'app est isolée par RLS » : cette surclamation EST le défaut que
-- PF-02 enregistre depuis l'origine.
--
-- ELLE NE FAIT PAS NON PLUS : protéger `outbox_event`. Voir §« LA SIXIÈME ».
--
-- ============================================================================
-- LES CINQ, MESURÉES SUR LE CATALOGUE — PAS RELAYÉES (ADR-042 §Context)
-- ============================================================================
--
--   enfant                 colonne FK          parent          ON DELETE
--   ---------------------- ------------------- --------------- ---------
--   announcement_receipt   announcement_id     announcement    CASCADE
--   branding               school_id (= la PK) school          CASCADE
--   grade_revision         grade_id            grade           CASCADE
--   import_row             batch_id            import_batch    CASCADE
--   user_role              user_profile_id     user_profile    CASCADE
--
-- `user_role` détient une SECONDE clé étrangère, `role_id -> role`, et `role` ne
-- porte pas de `tenant_id` : c'est une IMPASSE. Le chemin tenant de `user_role`
-- est `user_profile_id`, JAMAIS `role_id` (ADR-042 §D2). Une policy routée par
-- `role_id` évaluerait `p.tenant_id` sur une colonne inexistante.
--
-- `role_permission` détient deux FK (`role`, `permission`) dont AUCUN parent ne
-- porte `tenant_id` : elle reste donc HORS de la dérivation, naturellement — pas
-- par une liste de soustraction. Idem `permission`, `role`, `tenant` et
-- `_prisma_migrations`. Voir §« LE RÉSIDU », et l'assertion d'égalité
-- d'ensembles dans `scripts/rls-isolation-check.js`.
--
-- ============================================================================
-- LE PRÉDICAT : `EXISTS` SUR LE PARENT (ADR-042 §D1)
-- ============================================================================
--
--   EXISTS (
--     SELECT 1
--       FROM public.<parent> p
--      WHERE p.id = <enfant>.<colonne_fk>
--        AND p.tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid
--   )
--
-- 1. `nullif(current_setting(…, true), '')::uuid` est REPRIS VERBATIM d'ADR-032
--    §D6 et n'est PAS re-débattu ici. Rappel de la mesure qui le rend
--    obligatoire : `missing_ok` ne couvre QUE « jamais posé » ; après le COMMIT
--    d'un `set_config(…, true)` le GUC vaut `''` — PAS NULL — et un cast nu
--    lèverait `22P02` à la DEUXIÈME requête de CHAQUE connexion du pool. Prisma
--    mutualise ses connexions : c'est l'état de RÉGIME, pas un cas limite.
--
--    `nullif` n'est PAS un `IS NULL OR` déguisé et ne relâche RIEN : `''` part
--    sur NULL, et NULL ne laisse passer AUCUNE ligne, donc `EXISTS` vaut FAUX.
--    Contexte absent = ne rien voir, sans erreur levée. La forme fail-open
--    `current_setting(…) IS NULL OR …` est INTERDITE (DNC-10) et un ratchet
--    textuel la refuse — pas seulement ce commentaire.
--
-- 2. CAST `::uuid`, JAMAIS comparaison texte. `p.tenant_id::text = …` filtrerait
--    ZÉRO ligne pour un identifiant de tenant en majuscules (PostgreSQL rend un
--    `uuid` en minuscules alors qu'`assertTenantId` préserve la casse) : échec
--    fail-closed mais INVISIBLE, la pire forme. Le sens du cast est ratcheté, et
--    le tenant A du vérificateur est en MAJUSCULES exprès pour l'EXÉCUTER.
--
-- 3. `AND p.tenant_id = …` EST CONSERVÉ MÊME S'IL EST REDONDANT POUR `app_user`.
--    Exécutée comme `app_user`, la sous-requête est déjà filtrée par la policy
--    `tenant_isolation` du parent, donc la clause n'ajoute rien. Exécutée comme
--    le PROPRIÉTAIRE — qui joue les migrations, les seeds et toute
--    l'application d'aujourd'hui — la policy du parent NE S'APPLIQUE PAS, et
--    cette clause est la seule chose qui travaille. La retirer comme « morte »
--    rendrait la policy correcte exactement pour le rôle contre lequel elle est
--    prouvée, et ouverte pour tous les autres. ADR-042 §D1 l'enregistre pour que
--    personne ne l'enlève par économie.
--
-- 4. `FOR ALL TO PUBLIC` — jamais `TO app_user`. Une policy nommant un rôle ne
--    s'applique QU'À lui : tout autre rôle non-propriétaire futur serait EXEMPTÉ
--    en silence. Le recensement assertit `ROLE_SCOPED = 0`.
--
-- 5. `WITH CHECK` écrit EXPLICITEMENT et à l'IDENTIQUE de `USING` — ici garanti
--    par CONSTRUCTION : la même variable `predicate` est injectée deux fois dans
--    le même `format()`. Un `with_check` NULL retomberait sur `USING` : correct
--    aujourd'hui, faux le jour où quelqu'un ajoute un `WITH CHECK` permissif. Le
--    recensement assertit `WITH_CHECK_NULL = 0` ET l'égalité des deux
--    expressions désérialisées (`QUAL_MISMATCH = 0`).
--
-- 6. LE DANGER PROPRE À CETTE FORME, absent des 44 : la ligne enfant ne porte
--    RIEN de tenant-formé. La seule chose entre un appelant et une écriture
--    inter-tenant est la sous-requête `EXISTS`. Et le recensement compte les
--    policies PAR NOM : il ne lit JAMAIS le prédicat. Une policy sur
--    `grade_revision` pointant vers `announcement` serait comptée quand même, et
--    quatre des cinq sont engendrées par le même `format()` sur un tuple
--    transposable. C'est pourquoi `scripts/rls-isolation-check.js` PROUVE PAR
--    EXÉCUTION les CINQ, contrôle positif d'abord, et pas « une par forme ».
--
-- ============================================================================
-- LES GRANTS : DEUX JEUX DE PRIVILÈGES, ET AUCUN `DELETE` (ADR-042 §D5)
-- ============================================================================
--
-- Jamais `ON ALL TABLES IN SCHEMA public` : cette forme donnerait aussi les six
-- tables SANS policy — un accès non filtré offert par le geste même qui prétend
-- restreindre. Les GRANTs portent table par table, et la chaîne de privilèges
-- est le QUATRIÈME littéral de la ligne de chaque table : un relecteur lit le
-- rayon de souffle sur la même ligne que le nom, et il n'y a pas de branche
-- `ELSE` à oublier.
--
--   `SELECT, INSERT`         — `grade_revision` UNIQUEMENT.
--   `SELECT, INSERT, UPDATE` — les quatre autres.
--
-- `grade_revision` EST la piste d'audit des notes (G-AUDIT). `schema.prisma` la
-- déclare « Append-only audit log of grade modifications after publication » :
-- elle porte `previous_value`, `new_value`, `reason`, `revised_by`. Elle est PLUS
-- exposée qu'`audit_log`, pas moins — `audit_log` porte une chaîne
-- `hash`/`prev_hash`, donc une réécriture y est au moins DÉTECTABLE ; ici il n'y
-- a aucune chaîne, une réécriture ne laisserait rien derrière elle. MESURÉ, et
-- c'est ce qui rend le retrait sans risque : les seuls appelants d'écriture sont
-- deux `gradeRevision.create` (`grades.controller.ts:165,245`) — donc `INSERT` —
-- et un `deleteMany` dans `apps/api/prisma/seed-demo.ts:300`, script de seed
-- connecté comme le PROPRIÉTAIRE `pilotage`, que les GRANTs d'`app_user` ne
-- concernent pas.
--
-- AUCUNE DES CINQ NE REÇOIT `DELETE`, et ce n'est pas un oubli mais la décision
-- ADR-042 §D5, prise sur MESURE (grep `apps/**` + `packages/**`, specs et seeds
-- propriétaires exclus) :
--
--   `user_role`            — la révocation est un SOFT DELETE : `updateMany`
--                            posant `revoked_at` (`identity/users.service.ts:228`).
--                            Zéro `userRole.delete|deleteMany` dans tout le dépôt.
--                            Un `DELETE` dur effacerait l'historique d'attribution
--                            sur lequel s'appuie l'échelle de délégation ADR-040.
--   `import_row`           — zéro `importRow.delete|deleteMany`. Le `rollback()`
--                            d'`imports.service.ts` COMPENSE en défaisant les
--                            entités créées et RE-CLASSE les lignes par `update`.
--                            (La story `S-E01-2c.md` §AC-4 justifie un `DELETE`
--                            par « un batch annulé supprime ses lignes » : mesuré,
--                            le code ne fait pas cela. ADR-042 §D5 tranche.)
--   `branding`             — `upsert` / `update` seulement.
--   `announcement_receipt` — le marquage « lu » est un `update`.
--
-- ADR-032 §D7 a déjà fixé le principe : « un privilège inutile est un rayon de
-- souffle élargi ». Un privilège sans appelant est du rayon de souffle pur, et
-- GUARDRAILS §1 impose l'accès minimal sur des données d'enfants.
--
-- CONSÉQUENCE À PROUVER, PAS À CROIRE (ADR-042 §D6, story AC-10). `user_profile`
-- -> `user_role` est `ON DELETE CASCADE`, et `user_role` n'a pas `DELETE`.
-- PostgreSQL exécute les actions référentielles comme le PROPRIÉTAIRE de la
-- table référençante, row security désactivée, donc la cascade DEVRAIT quand
-- même partir — mais c'est une croyance sur le moteur dans un chemin de
-- sécurité, et ce dépôt les EXÉCUTE. `scripts/rls-isolation-check.js` supprime
-- un `user_profile` du tenant A comme `app_user` et assertit que ses `user_role`
-- ont disparu. Si cela échouait, le correctif serait d'ajouter `DELETE` à
-- `user_role` AVEC la raison mesurée écrite ici — jamais de retirer l'assertion.
--
-- LA LIMITE HONNÊTE DE L'APPEND-ONLY (ADR-042 §D6). La même cascade traverse
-- `grade -> grade_revision`. `app_user` détient `DELETE` sur `grade` (une des
-- 44), donc il peut faire disparaître des `grade_revision` en supprimant la note
-- parente, malgré le `SELECT, INSERT` ci-dessus. L'append-only de
-- `grade_revision` vaut contre le DML DIRECT, PAS contre une cascade parente. Ce
-- qu'elle ne peut pas faire, c'est TRAVERSER UN TENANT : pour supprimer le
-- parent il faut d'abord le VOIR, et la policy du parent l'en empêche. La
-- cascade est donc SÛRE EN TENANT et NON SÛRE EN AUDIT. L'écrire est le
-- contraire de la surclamation PF-02 ; le correctif (`ON DELETE RESTRICT` +
-- soft-delete des notes) est un changement de `schema.prisma` ET de
-- comportement, donc sa propre story — enregistré comme PF-186.
--
-- Les GRANTs sont conditionnés à l'EXISTENCE du rôle (`pg_roles`) : les rôles
-- sont à l'échelle du CLUSTER, les migrations s'appliquent à une BASE, et le job
-- CI provisionne un conteneur neuf où `app_user` n'existe pas. La moitié
-- ENABLE / CREATE POLICY reste INCONDITIONNELLE — c'est la propriété de
-- sécurité, elle ne dépend d'aucun rôle.
--
-- AUCUN grant de séquence : mesuré, `information_schema.sequences` compte ZÉRO
-- entrée dans `public` (toutes les clés primaires sont des `uuid`).
-- AUCUN `GRANT USAGE ON SCHEMA public` non plus : la migration des 44 l'a déjà
-- émis nominativement, le ré-émettre serait une seconde source de vérité.
--
-- ============================================================================
-- LA SIXIÈME : `outbox_event` RESTE FAIL-CLOSED, PAR DÉCISION (ADR-042 §D7)
-- ============================================================================
--
-- MESURÉ sur le catalogue : `outbox_event` détient ZÉRO clé étrangère
-- (`pg_constraint` avec `contype='f'` ne rend AUCUNE ligne pour elle). Son
-- couple `aggregate_type` + `aggregate_id` est polymorphe et non contraint. Il
-- n'y a donc AUCUN chemin FK sur lequel écrire une policy, et en inventer un
-- serait de la fiction avec une policy autour.
--
-- `docs/daily-improvement-v3/NEXT.md` écrit que les six tables « dérivent leur
-- tenant par CLÉ ÉTRANGÈRE ». CINQ le font. L'en-tête de la migration des 44
-- était déjà exact (« AUCUNE FK, aucun discriminant de tenant ») ; c'est la
-- prose de NEXT.md qui surclame, et elle est corrigée sur place.
--
-- `outbox_event` ne reçoit donc NI grant NI policy, et ces DEUX absences sont
-- ASSERTÉES PAR EXÉCUTION, avec la raison nommée (`PF-185`) : c'est ce qui
-- empêche le run suivant de « corriger » l'erreur de permission en élargissant
-- le grant — la seule branche que PF-183 exclut explicitement. Mesuré aussi :
-- `outboxEvent.` a ZÉRO appelant dans `apps/**` et `packages/**`, donc le coût
-- de la laisser fail-closed à la bascule est de ZÉRO fonctionnalité cassée.
--
-- ============================================================================
-- R-11 : L'INDEX SUR LA COLONNE FK EST UN PRÉ-REQUIS, VÉRIFIÉ ICI
-- ============================================================================
--
-- Une policy à chemin FK sans index sur la colonne FK est un balayage séquentiel
-- au moindre parcours. MESURÉ : les cinq colonnes FK sont DÉJÀ la colonne DE
-- TÊTE d'un index existant (`grade_revision_grade_id_revised_at_idx`,
-- `announcement_receipt_announcement_id_user_profile_id_key`, `branding_pkey`
-- — la colonne EST la clé primaire —, `import_row_batch_id_row_index_key`,
-- `user_role_user_profile_id_role_id_school_id_key`). Aucun index n'est donc
-- CRÉÉ par cette migration ; la condition est VÉRIFIÉE avant chaque
-- `ENABLE ROW LEVEL SECURITY` (`pg_index.indkey[0]`) et la migration REFUSE de
-- s'appliquer si elle ne l'est pas. Le vérificateur l'assertit une seconde fois.
--
-- Le coût réel, énoncé pour que personne n'ajoute un index en croyant le
-- supprimer : le côté parent est une sonde de CLÉ PRIMAIRE (`p.id = …`), donc un
-- parcours non qualifié de l'enfant coûte « seq scan + une sonde PK par ligne »,
-- et AUCUN index sur l'enfant ne peut retirer cela.
--
-- ============================================================================
-- EXPAND / CONTRACT, ET LE ROLLBACK (G-MIGRATION, ADR-042 §D8)
-- ============================================================================
--
-- EXPAND PUR. Cette migration AJOUTE des policies et des GRANTs. Elle ne crée,
-- ne supprime, ne déplace et ne réécrit AUCUNE colonne, ne reshape AUCUNE
-- donnée, et ne crée AUCUN index. **Il n'y a pas de phase contract.** C'est
-- précisément pourquoi un DROP/DISABLE/REVOKE est un renversement SUFFISANT :
-- il n'y a aucun état de données à reconstruire.
--
-- Elle est RE-JOUABLE : `CREATE POLICY` n'a pas d'`IF NOT EXISTS` en PG 15, donc
-- chaque `CREATE` est précédé d'un `DROP POLICY IF EXISTS`.
--
-- `SET lock_timeout` : `ENABLE ROW LEVEL SECURITY` prend un ACCESS EXCLUSIVE.
-- L'opération est catalogue-seule (aucune réécriture de table) donc immédiate,
-- mais elle FILE DERRIÈRE tout lecteur long — et une fois en attente elle bloque
-- à son tour tous les lecteurs suivants. `import_row` est la plus volumineuse
-- des cinq. Posture de reprise : la migration ÉCHOUE proprement au bout de 5 s
-- et se RELANCE telle quelle (elle est re-jouable) ; elle n'attend jamais
-- indéfiniment sur une base vivante.
--
-- ROLLBACK — à exécuter tel quel, comme le PROPRIÉTAIRE des tables. Il est sûr
-- *parce que* rien ne se connecte encore comme `app_user` : le retrait des
-- GRANTs ne coupe aucun appelant vivant. Le `REVOKE` est écrit UNIFORME, y
-- compris `DELETE` que personne n'a reçu : PostgreSQL traite le retrait d'un
-- privilège non détenu comme un no-op silencieux, et un second tableau ici
-- serait une source de dérive pour zéro effet.
--
--   DO $rollback$
--   DECLARE
--     t text;
--     derived_children CONSTANT text[] := ARRAY[
--       'announcement_receipt','branding','grade_revision','import_row','user_role'
--     ];
--     has_app_user CONSTANT boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user');
--   BEGIN
--     FOREACH t IN ARRAY derived_children LOOP
--       EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
--       EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
--       IF has_app_user THEN
--         EXECUTE format('REVOKE SELECT, INSERT, UPDATE, DELETE ON public.%I FROM app_user', t);
--       END IF;
--     END LOOP;
--   END
--   $rollback$;
--
-- Ce renversement est EXÉCUTÉ par `scripts/rls-isolation-check.js` (applique ->
-- prouve le refus -> renverse -> prouve `AFTER_POLICIES = 0` et `AFTER_RLS = 0`
-- sur les 49), et pas seulement écrit ici : un rollback jamais joué est une
-- assertion sur un commentaire. Son bloc générique itère toute table portant
-- `relrowsecurity`, donc il couvre les cinq — VÉRIFIÉ, pas supposé.
--
-- ============================================================================
-- POURQUOI IL FAUT UN AUTRE GARDE QUE LE GARDE DE DÉRIVE
-- ============================================================================
--
-- `prisma migrate diff --from-schema-datasource --to-schema-datamodel` ignore
-- policies et GRANTs : le diff reste `No difference detected` avec ou sans ce
-- fichier. Bonne nouvelle (aucun faux rouge sur G-MIGRATION) et mauvaise
-- nouvelle, qui est la moitié porteuse : le garde de dérive ne pourra JAMAIS
-- voir une policy supprimée hors bande, ni une sixième table dérivée livrée sans
-- policy. C'est `scripts/rls-isolation-check.js` qui le voit, et son
-- recensement est un ACCORD calculé sur le CATALOGUE
-- (`RLS_ON == TENANT_COLS + DERIVED_EXPECTED`), jamais un 49 en dur.

-- `ENABLE ROW LEVEL SECURITY` prend un ACCESS EXCLUSIVE : borner l'attente
-- plutôt que faire la queue derrière un lecteur long. Voir l'en-tête §EXPAND.
SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- UN SEUL bloc, UN SEUL tableau littéral de CINQ lignes de QUATRE littéraux :
-- enfant, colonne FK, parent, chaîne de privilèges. Les NOMS restent littéraux
-- et diffables ; seule la RÉPÉTITION est factorisée, exactement comme les 44.
--
-- Le bloc REFUSE de s'appliquer — jamais il ne saute une ligne — si : le nombre
-- de lignes n'est pas 5 ; un enfant ou un parent est introuvable ; la colonne FK
-- n'existe pas sur l'enfant ; un parent nommé ne porte PAS `tenant_id` ; la
-- colonne FK ne mène AUCUN index (R-11) ; une chaîne de privilèges sort du jeu
-- FERMÉ de deux. Sauter reviendrait à livrer une policy manquante sous un
-- `migrate deploy` VERT — la forme exacte du défaut que cette story referme.
-- ---------------------------------------------------------------------------
DO $rls_derived$
DECLARE
  derived CONSTANT text[][] := ARRAY[
    ARRAY['announcement_receipt', 'announcement_id', 'announcement', 'SELECT, INSERT, UPDATE'],
    ARRAY['branding',             'school_id',       'school',       'SELECT, INSERT, UPDATE'],
    ARRAY['grade_revision',       'grade_id',        'grade',        'SELECT, INSERT'],
    ARRAY['import_row',           'batch_id',        'import_batch', 'SELECT, INSERT, UPDATE'],
    ARRAY['user_role',            'user_profile_id', 'user_profile', 'SELECT, INSERT, UPDATE']
  ];
  -- JEU FERMÉ de chaînes de privilèges. Il est FERMÉ pour que la seule façon
  -- d'élargir le rayon de souffle d'une table soit d'ajouter ici une chaîne que
  -- le diff montre, et non de retoucher discrètement une ligne du tableau.
  -- AUCUNE ne contient `DELETE` — ADR-042 §D5, voir l'en-tête.
  allowed_privileges CONSTANT text[] := ARRAY[
    'SELECT, INSERT',
    'SELECT, INSERT, UPDATE'
  ];
  -- Un tableau tronqué par une résolution de conflit laisserait des tables sans
  -- policy en silence. On refuse d'appliquer plutôt que d'en protéger quatre.
  expected CONSTANT integer := 5;
  -- Les rôles sont à l'échelle du CLUSTER, les migrations s'appliquent à une
  -- BASE. Calculé UNE fois : deux copies seraient une source de dérive.
  has_app_user CONSTANT boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user');
  i integer;
  child text;
  fk_col text;
  parent text;
  privileges text;
  child_oid oid;
  parent_oid oid;
  fk_attnum smallint;
  predicate text;
BEGIN
  IF array_length(derived, 1) IS DISTINCT FROM expected THEN
    RAISE EXCEPTION
      'tenant_isolation (dérivées) : le tableau porte % lignes au lieu de % ; migration refusée',
      array_length(derived, 1), expected;
  END IF;

  FOR i IN 1 .. array_length(derived, 1) LOOP
    child      := derived[i][1];
    fk_col     := derived[i][2];
    parent     := derived[i][3];
    privileges := derived[i][4];

    -- (1) Le jeu FERMÉ de privilèges. Vérifié AVANT tout DDL : une chaîne
    --     inconnue doit faire échouer la migration entière, pas la moitié.
    IF NOT (privileges = ANY (allowed_privileges)) THEN
      RAISE EXCEPTION
        'tenant_isolation (dérivées) : privilèges "%" hors du jeu fermé pour public.% ; voir ADR-042 §D5',
        privileges, child;
    END IF;

    -- (2) Une table absente est une ERREUR, jamais un saut.
    child_oid := to_regclass(format('public.%I', child));
    IF child_oid IS NULL THEN
      RAISE EXCEPTION 'tenant_isolation (dérivées) : la table enfant public.% est introuvable', child;
    END IF;
    parent_oid := to_regclass(format('public.%I', parent));
    IF parent_oid IS NULL THEN
      RAISE EXCEPTION 'tenant_isolation (dérivées) : la table parente public.% est introuvable', parent;
    END IF;

    -- (3) La colonne FK doit exister sur l'enfant — un tuple transposé
    --     produirait sinon une policy sur une colonne d'un autre sens.
    SELECT a.attnum INTO fk_attnum
      FROM pg_attribute a
     WHERE a.attrelid = child_oid AND a.attname = fk_col AND a.attnum > 0 AND NOT a.attisdropped;
    IF fk_attnum IS NULL THEN
      RAISE EXCEPTION
        'tenant_isolation (dérivées) : public.% ne porte pas la colonne %', child, fk_col;
    END IF;

    -- (4) Le parent DOIT porter `tenant_id`, sinon le prédicat ne compilerait
    --     pas — c'est exactement le piège `user_role -> role` (ADR-042 §D2).
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute a
       WHERE a.attrelid = parent_oid AND a.attname = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION
        'tenant_isolation (dérivées) : le parent public.% ne porte pas de colonne tenant_id ; '
        'ce chemin est une impasse (ADR-042 §D2)', parent;
    END IF;

    -- (5) R-11 : un index dont la colonne DE TÊTE est la colonne FK doit exister
    --     AVANT que la policy soit posée. Mesuré présent pour les cinq ; vérifié
    --     ici pour que l'ajout d'une sixième ligne ne puisse pas l'oublier.
    IF NOT EXISTS (
      SELECT 1 FROM pg_index x
       WHERE x.indrelid = child_oid AND x.indkey[0] = fk_attnum
    ) THEN
      RAISE EXCEPTION
        'tenant_isolation (dérivées) : aucun index ne mène par public.%.% ; une policy à '
        'chemin FK sans index sur la FK est un balayage séquentiel (R-11)', child, fk_col;
    END IF;

    -- Le prédicat est construit UNE fois puis injecté DEUX fois : `USING` et
    -- `WITH CHECK` sont identiques PAR CONSTRUCTION, pas par relecture.
    predicate := format($predicate$
      EXISTS (
        SELECT 1
          FROM public.%I p
         WHERE p.id = %I.%I
           AND p.tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid
      )
    $predicate$, parent, child, fk_col);

    -- Moitié SÉCURITÉ : INCONDITIONNELLE. Pas de `FORCE` — voir l'en-tête.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', child);

    -- PG 15 n'a pas d'`IF NOT EXISTS` sur `CREATE POLICY` : le DROP préalable
    -- rend la migration re-jouable après une application partielle.
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', child);

    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I FOR ALL TO PUBLIC USING (%s) WITH CHECK (%s)',
      child, predicate, predicate);

    -- Moitié ACCÈS : conditionnelle, table par table, jamais `ON ALL TABLES`.
    -- `%s` est sûr ici parce que `privileges` vient d'être validé contre le jeu
    -- FERMÉ ci-dessus (1) — il ne peut porter que l'une des deux chaînes.
    IF has_app_user THEN
      EXECUTE format('GRANT %s ON public.%I TO app_user', privileges, child);
    END IF;
  END LOOP;

  IF NOT has_app_user THEN
    RAISE NOTICE
      'tenant_isolation (dérivées) : le rôle app_user est absent de ce cluster ; les 5 policies '
      'sont posées, les GRANTs sont sautés. Les policies ne dépendent d''aucun rôle.';
  END IF;
END
$rls_derived$;
