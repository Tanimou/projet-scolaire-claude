-- S-E01-2b — ROW LEVEL SECURITY : les policies EXISTENT, s'appliquent à un rôle
-- non-propriétaire RÉEL (`app_user`), et refusent — PROUVÉ PAR EXÉCUTION.
--
-- Migration RELUE À LA MAIN (ADR-027, G-MIGRATION). Elle n'a pas été produite
-- par `prisma migrate dev` et `prisma db push` n'apparaît nulle part dans ce
-- diff : Prisma ne sait modéliser ni une policy ni un GRANT, donc rien ici n'est
-- dérivable de `schema.prisma`. `schema.prisma` n'est pas touché par cette
-- story, et c'est délibéré — l'y toucher armerait le piège `prisma generate`
-- (typecheck ROUGE tant que le client n'est pas régénéré) pour un fichier que le
-- diff de dérive ne peut de toute façon pas voir.
--
-- ============================================================================
-- CE QUE CETTE MIGRATION FAIT — ET SURTOUT CE QU'ELLE NE FAIT PAS
-- ============================================================================
--
-- ELLE FAIT : `ENABLE ROW LEVEL SECURITY` + une policy `tenant_isolation` sur
-- les 44 tables qui portent une colonne `tenant_id`, et un GRANT DML de ces 44
-- tables au rôle `app_user`, qui existe déjà dans le cluster, sait se connecter,
-- n'est PAS propriétaire des tables et n'a pas `BYPASSRLS`. Ce GRANT n'est PAS
-- uniforme : deux tables APPEND-ONLY (`audit_log`, `conversation_message`) ne
-- reçoivent que `SELECT, INSERT` — voir §« DEUX JEUX DE PRIVILÈGES ».
--
-- ELLE NE FAIT PAS : rendre l'application isolée par RLS. **Après cette
-- migration, l'application qui tourne n'est TOUJOURS PAS isolée par RLS.** Elle
-- se connecte comme `pilotage`, qui est le PROPRIÉTAIRE des 55 tables, et un
-- propriétaire n'est pas soumis à ses propres policies tant que
-- `FORCE ROW LEVEL SECURITY` n'est pas posé. Aucune phrase de ce fichier, de
-- l'ADR ou du ledger ne doit pouvoir se lire comme « l'app est isolée » : cette
-- surclamation EST exactement le défaut que PF-02 enregistre depuis l'origine.
--
-- Ce que la story livre, précisément : les policies EXISTENT, leur prédicat est
-- CORRECT, et il est PROUVÉ par exécution qu'elles refusent pour un rôle réel,
-- non-propriétaire, capable de se connecter. Ce qui reste : la BASCULE DE
-- CONNEXION (`DATABASE_URL` → `app_user`), qui appartient à la couture identité.
--
-- ============================================================================
-- POURQUOI PAS `FORCE ROW LEVEL SECURITY` — DÉCISION, PAS OUBLI (ADR-032 §D5)
-- ============================================================================
--
-- `FORCE` soumet le PROPRIÉTAIRE aux policies. Aujourd'hui l'API, les seeds et
-- `prisma migrate` se connectent TOUS comme le propriétaire `pilotage`, et
-- `withTenant` a ZÉRO appelant en production (mesuré : un grep ne rend que sa
-- définition et son spec). Poser `FORCE` maintenant ferait donc rendre ZÉRO
-- LIGNE à *toutes* les requêtes de *toute* l'application — une panne locale
-- immédiate, pas un durcissement.
--
-- Le bon correctif du piège « le propriétaire contourne RLS » n'est pas `FORCE`,
-- c'est que l'application CESSE de se connecter comme propriétaire. `app_user`
-- existe déjà pour cela, et `.env:20` déclare déjà `DATABASE_URL_APP`. Cette
-- migration rend donc les policies réelles CONTRE `app_user` ; l'étape qui
-- reste est une bascule de CONNEXION, pas davantage de travail de policy.
--
-- Ceci supersède partiellement `ADR-032` §Deferred item 1 (« `FORCE ROW LEVEL
-- SECURITY` n'est pas optionnel »). **Ce commentaire n'est PAS ce qui supersède**
-- — un commentaire de migration ne peut pas supersédér une décision de record,
-- c'est exactement la dérive que la règle ADR existe pour arrêter. Le
-- remplacement est écrit DANS la décision elle-même : `ADR-032` §D5 (et son
-- §Deferred item 1, annoté sur place). Ce fichier CITE cette décision, il ne la
-- prend pas. La règle de remplacement : le piège du contournement propriétaire
-- est refermé par la BASCULE DE CONNEXION, et cette bascule n'est pas dans cette
-- story.
--
-- ============================================================================
-- LE PRÉDICAT, ET LE `nullif` QUI N'EST PAS DÉCORATIF — MESURÉ
-- ============================================================================
--
--   nullif(current_setting('app.current_tenant_id', true), '')::uuid = tenant_id
--
-- 1. `current_setting(name, true)` — le second argument (`missing_ok`) est
--    OBLIGATOIRE. Sans lui, toute connexion qui n'a jamais posé le GUC lève
--    `42704 unrecognized configuration parameter`, ce qui casserait migrations,
--    seeds, health checks et chaque job BullMQ dès le premier jour.
--
-- 2. `nullif(…, '')` — OBLIGATOIRE AUSSI, et c'est la correction la plus
--    importante de cette story. `missing_ok` ne couvre QUE le cas « jamais
--    posé ». Mesuré sur ce cluster, dans la session, dans cet ordre :
--
--        -- session neuve, GUC jamais posé
--        current_setting('app.current_tenant_id', true)  -> NULL
--        -- dans une transaction
--        BEGIN; SELECT set_config('app.current_tenant_id', '<uuid>', true);
--        current_setting('app.current_tenant_id', true)  -> '<uuid>'
--        COMMIT;
--        -- MÊME session, APRÈS le COMMIT : le cas qui arrive vraiment
--        current_setting('app.current_tenant_id', true)  -> ''   (PAS NULL)
--        current_setting('app.current_tenant_id', true)::uuid
--          -> ERROR 22P02: invalid input syntax for type uuid: ""
--
--    Une fois le paramètre personnalisé créé dans la session, la fin de
--    transaction le RAMÈNE à la chaîne vide, pas à l'inexistence. Or Prisma
--    MUTUALISE ses connexions : l'état de régime de toute connexion physique
--    ayant servi un `withTenant` est GUC = `''`. Le prédicat sans `nullif`
--    ferait donc lever 22P02 à la DEUXIÈME requête de chaque connexion du pool —
--    health check, job, lecture non-tenant, migration. Le prédicat nu est FAUX
--    dans le seul cas qui se produit en régime établi.
--
--    `nullif` n'est PAS un `IS NULL OR` déguisé et ne relâche RIEN : il envoie
--    `''` sur NULL, et NULL ne laisse passer AUCUNE ligne. La direction reste
--    fail-closed, la forme reste une ÉGALITÉ unique.
--
-- 3. CAST, jamais comparaison texte. `tenant_id::text = current_setting(…)`
--    filtrerait ZÉRO ligne pour un identifiant de tenant en majuscules :
--    PostgreSQL rend un `uuid` en minuscules alors que `assertTenantId` préserve
--    délibérément la casse. Échec fail-closed mais INVISIBLE — la pire forme.
--    Le cast `::uuid` normalise des deux côtés. Le sens du cast est ratcheté.
--
-- 4. CONTEXTE ABSENT = NE RIEN VOIR, décidé (ADR-032 §D6). GUC absent (NULL) ou
--    vide (`''` → NULL par `nullif`) : le prédicat vaut NULL, aucune ligne ne
--    passe, et AUCUNE erreur n'est levée. Fail-closed par construction, sans
--    clause supplémentaire.
--
--    Il ne faut JAMAIS écrire `current_setting(…) IS NULL OR tenant_id = …` :
--    cette forme échoue OUVERT pour l'application entière (DNC-10). Elle est
--    interdite par un ratchet textuel, pas seulement par ce commentaire.
--
-- 5. `FOR ALL TO PUBLIC` — jamais `TO app_user`. Une policy nommant un rôle ne
--    s'applique QU'À lui : tout autre rôle non-propriétaire futur (un
--    `app_migrator`, un `auditor`, un rôle d'analytique) serait EXEMPTÉ en
--    silence. `TO PUBLIC` est la forme fail-closed.
--
-- 6. `WITH CHECK` est écrit EXPLICITEMENT et à l'identique de `USING`. Omis,
--    PostgreSQL retombe sur `USING` pour la vérification — le comportement
--    paraîtrait correct aujourd'hui et deviendrait faux le jour où quelqu'un
--    ajouterait un `WITH CHECK` permissif. La présence de `with_check` dans
--    `pg_policies` est assertée, pas déduite.
--
-- ============================================================================
-- LE PÉRIMÈTRE : « PORTE UNE COLONNE tenant_id » — 44 TABLES, ET LES 11 AUTRES
-- ============================================================================
--
-- Les 44 noms sont écrits en LITTÉRAL dans un tableau unique ci-dessous. Ils ne
-- sont PAS découverts depuis `information_schema` à l'application : une
-- migration dont l'effet dépend de la base où elle atterrit est irrelisable
-- (G-MIGRATION exige une migration RELUE) et non déterministe sur les bases
-- scratch du garde de dérive. Seule la RÉPÉTITION est factorisée, via un
-- `format('%I')` — les NOMS restent littéraux et diffables, et un ratchet
-- assertit l'ÉGALITÉ D'ENSEMBLES (dans les deux sens) entre ce tableau et les
-- modèles de `schema.prisma` qui déclarent `tenantId`.
--
-- Les 11 tables SANS `tenant_id` ne reçoivent PAS de policy. Elles ne sont pas
-- toutes globales, et le dire est le contraire de la surclamation PF-02 :
--
--   A. RÉELLEMENT GLOBALES — aucun discriminant de tenant, aucune donnée d'un
--      tenant : `permission`, `role`, `role_permission`, `_prisma_migrations`.
--
--      ⚠️ CORRECTION 2026-08-14 (S-E01-1b, PF-191) — CETTE LIGNE ÉTAIT FAUSSE
--      POUR `role` ET POUR `role_permission`, ET ELLE L'ÉTAIT DÈS L'ORIGINE.
--      `role` porte `school_id UUID` (créée par le baseline) et `school` porte
--      `tenant_id UUID NOT NULL` : une ligne de `role` au `school_id` non nul
--      appartient donc à UN tenant, et `role_permission` en hérite à deux sauts.
--      Un GRANT `SELECT` nu sur ces deux tables aurait laissé le tenant A lire
--      les rôles CUSTOM du tenant B et LEUR COMPOSITION DE PRIVILÈGES — mesuré
--      par exécution (`A_SEES_B_ROLEPERM|1`) avant d'être refermé.
--      Ce qui rendait l'erreur invisible : `role.school_id` n'avait AUCUNE clé
--      étrangère, donc la dérivation structurelle ne pouvait pas la voir.
--      `S-E01-1b` pose `role_school_id_fkey`, place les deux tables sous policy
--      et rend la dérivation transitive. Voir
--      `20260814180000_role_reference_surface_rls` et ADR-046.
--      SEULES `permission` et `_prisma_migrations` restent réellement globales,
--      et cette fois la classification a été MESURÉE colonne par colonne.
--      Le SQL exécutable de CE fichier n'est pas modifié : une migration
--      appliquée ne se réécrit pas, seule son annotation est corrigée.
--
--   B. AUTO-DISCRIMINANTE, EXCLUE DÉLIBÉRÉMENT : `tenant` — sa clé primaire EST
--      le discriminant. Une policy ici casserait la couture identité, qui doit
--      lire `tenant` PAR SLUG *avant* qu'un tenant soit résolu (S-E01-1, pas
--      commencée). Exclusion motivée, pas oubli.
--
--      ⚠️ ÉTAT DATÉ, corrigé le 2026-08-14 (S-E01-1b) — L'EXCLUSION RESTE VRAIE
--      DE CE FICHIER, MAIS SA RAISON A DISPARU. Mesuré sur `apps/api/src` après
--      `S-E01-1a` : il n'existe PLUS AUCUNE lecture de `tenant` PAR SLUG. Les
--      seules lectures sont `where: { id: tenantId }` ; les lectures par slug
--      sont dans les seeds, qui se connectent comme le PROPRIÉTAIRE. La seule
--      écriture par slug restante est `register.controller.ts`, et elle EST le
--      défaut ouvert PF-185. `S-E01-1b` place donc `tenant` sous une policy
--      `id = <GUC>` dans SA migration, sans fonction `SECURITY DEFINER` — celle
--      qui était « préférée » n'aurait eu AUCUN appelant. Voir ADR-046 §D4.
--   C. DÉRIVÉES D'UN TENANT PAR CLÉ ÉTRANGÈRE — donc NON PROTÉGÉES par ce diff,
--      et atteignables par jointure depuis une table protégée :
--        `grade_revision`      -> grade          (piste d'audit des notes)
--        `announcement_receipt`-> announcement
--        `branding`            -> school
--        `import_row`          -> import_batch   (charges utiles d'import brutes)
--        `user_role`           -> role, user_profile
--        `outbox_event`        -> AUCUNE FK, aucun discriminant de tenant
--
--      La classe C est le RÉSIDU de cette story. PF-02 moitié (a) est refermée
--      PARTIELLEMENT, pas complètement, et le ledger le dit ainsi.
--
-- ============================================================================
-- LES GRANTS : 44 TABLES, PAS `ON ALL TABLES IN SCHEMA public`
-- ============================================================================
--
-- `GRANT … ON ALL TABLES IN SCHEMA public` donnerait à `app_user` les 11 tables
-- ci-dessus, qui n'ont AUCUNE policy — c'est-à-dire un accès non filtré. Les
-- GRANTs portent donc exactement sur les 44 tables sous policy.
--
-- DEUX JEUX DE PRIVILÈGES, PAS UN (ADR-032 §D7)
-- ---------------------------------------------
-- 42 tables reçoivent `SELECT, INSERT, UPDATE, DELETE`. DEUX en reçoivent
-- STRICTEMENT MOINS — `SELECT, INSERT` — parce qu'elles sont APPEND-ONLY, et que
-- l'append-only ne peut pas être une propriété tenue par la seule discipline
-- applicative une fois que `app_user` sera le rôle de connexion :
--
--   `audit_log`            — `schema.prisma` (§« Audit append-only ») délègue
--                            explicitement cette propriété à « RLS + REVOKE
--                            configurés en migration SQL ». CETTE migration EST
--                            cette migration SQL : un GRANT UPDATE/DELETE ici
--                            serait le contraire exact de ce que le schéma
--                            annonce. La table porte une chaîne `hash`/`prev_hash`
--                            dont `prev_hash` serait RÉINSCRIPTIBLE : une
--                            falsification pourrait être rendue cohérente, donc
--                            indétectable par vérification de chaîne. L'audit
--                            append-only est non négociable (GUARDRAILS §1, RGPD).
--   `conversation_message` — `schema.prisma` : « An immutable (append-only)
--                            message. No edit, no soft-delete in the MVP ». La
--                            modération passe par report + `status=blocked`, pas
--                            par la suppression.
--
-- MESURÉ, et c'est ce qui rend le retrait SANS RISQUE : un grep sur `apps/**` et
-- `packages/**` ne trouve AUCUN `conversationMessage.update|delete|upsert`, et
-- pour `auditLog` un seul appelant — `apps/api/prisma/seed-demo.ts:298`
-- (`deleteMany`), un script de seed qui se connecte comme le PROPRIÉTAIRE
-- `pilotage` et n'est donc pas concerné par les GRANTs de `app_user`.
--
-- `conversation_report` n'est PAS dans ce jeu, et l'écrire ici évite qu'on l'y
-- ajoute par analogie : elle porte `status`, `reviewed_by`, `reviewed_at` et
-- `updated_at` — une modération la fait MUTER par construction. Une table
-- « append-only » de plus serait une panne, pas un durcissement.
--
-- Le jeu append-only est un tableau NOMMÉ et compté ci-dessous, et un ratchet
-- (`rls-isolation-gate.spec.ts` + le recensement de `rls-isolation-check.js`)
-- assertit que ses privilèges restent ⊆ {SELECT, INSERT}. On ne peut donc pas
-- l'élargir en silence. L'assertion d'ACCORD `GRANTED == tenantCols` n'est pas
-- affectée : ces tables restent accordées, avec moins de privilèges.
--
-- AUCUN grant de séquence : mesuré, `information_schema.sequences` compte ZÉRO
-- entrée dans `public` (aucune colonne serial ni identity ; les clés primaires
-- sont des `uuid`). « L'accès aux séquences dont il a réellement besoin » se
-- résout donc à RIEN. `GRANT USAGE ON SCHEMA public` est tout de même émis
-- explicitement : `app_user` l'a aujourd'hui via le grant PUBLIC par défaut,
-- pas par un grant nominatif, et un durcissement futur qui révoquerait PUBLIC
-- le lui retirerait sans que rien ne le signale.
--
-- Les GRANTs sont conditionnés à l'EXISTENCE du rôle (`pg_roles`), parce que les
-- rôles sont à l'échelle du CLUSTER alors que les migrations s'appliquent à une
-- BASE : le garde de dérive crée des bases scratch et y lance `migrate deploy`,
-- et le job CI provisionne un conteneur PostgreSQL neuf où `app_user` n'existe
-- pas. Sans ce garde, `migrate deploy` échouerait là-bas. La moitié
-- ENABLE/CREATE POLICY, elle, reste INCONDITIONNELLE — c'est la propriété de
-- sécurité, elle ne dépend d'aucun rôle.
--
-- Le jeu de GRANTs est DÉLIBÉRÉMENT INCOMPLET pour la bascule : `role`,
-- `permission`, `role_permission`, `user_role` et `tenant` restent illisibles
-- pour `app_user`, donc la première jointure d'autorisation échouerait. La
-- bascule n'est pas « à une étape » ; c'est écrit dans PROGRESS.md.
--
-- ⚠️ ÉTAT DATÉ, corrigé le 2026-08-14 — CETTE PHRASE N'EST PLUS VRAIE, sur DEUX
-- points, et aucun des deux n'a été corrigé en modifiant ce fichier :
--
--   • `user_role` N'EST PLUS illisible depuis `S-E01-2c`
--     (`20260813180000_tenant_rls_derived_policies`) : elle est l'une des CINQ
--     tables tenant-DÉRIVÉES et elle détient `SELECT, INSERT, UPDATE`. VÉRIFIÉ
--     dans le tuple de cette migration-là, pas déduit de cette phrase-ci.
--   • `role`, `permission`, `role_permission` et `tenant` sont accordés en
--     `SELECT` — et RIEN d'autre — depuis `S-E01-1b`
--     (`20260814180000_role_reference_surface_rls`), avec `_prisma_migrations`.
--     La jointure d'autorisation `user_profile -> user_role -> role ->
--     role_permission -> permission` a été EXÉCUTÉE comme `app_user` : elle
--     levait `permission denied for table role` avant, elle rend 1 après.
--
-- Ce qui reste vrai de cette phrase, et qui est l'essentiel : la bascule n'est
-- toujours PAS « à une étape ». Les blocages restants ont maintenant des NOMS
-- plutôt qu'une prose : PF-193 (le chemin d'ÉCRITURE de `roles.controller.ts`)
-- et PF-185 (l'`upsert` de `tenant` par `register.controller.ts`). Voir ADR-046.
--
-- ============================================================================
-- EXPAND / CONTRACT, ET LE ROLLBACK (G-MIGRATION, AC-12)
-- ============================================================================
--
-- EXPAND PUR. Cette migration AJOUTE des policies et des GRANTs. Elle ne
-- modifie aucune colonne, n'en supprime aucune, ne déplace ni ne réécrit aucune
-- donnée, ne crée aucun index (mesuré : les 44 portent déjà `tenant_id` en tête
-- d'index, la condition préalable (4) d'ADR-032 est donc DÉJÀ satisfaite).
-- **Il n'y a pas de phase contract.** C'est précisément pourquoi un
-- DROP/DISABLE est un renversement SUFFISANT : il n'y a aucun état de données à
-- reconstruire.
--
-- Elle est RE-JOUABLE : `CREATE POLICY` n'a pas d'`IF NOT EXISTS` en PG 15, donc
-- chaque `CREATE` est précédé d'un `DROP POLICY IF EXISTS`. Une application
-- partielle peut être relancée sans erreur.
--
-- ROLLBACK (ADR-032 §D8) — à exécuter tel quel, comme le propriétaire des
-- tables. Il est sûr *parce que* rien ne se connecte encore comme `app_user` :
-- le retrait des GRANTs ne coupe aucun appelant vivant.
--
-- Le `REVOKE` reste UNIFORME sur les 44, y compris sur les deux tables
-- append-only qui n'ont jamais reçu UPDATE/DELETE : PostgreSQL traite le retrait
-- d'un privilège non détenu comme un no-op silencieux. Un second tableau ici
-- serait une source de dérive pour zéro effet.
--
--   DO $rollback$
--   DECLARE
--     t text;
--     tenant_scoped CONSTANT text[] := ARRAY[
--       'academic_year','alert_instance','alert_rule','announcement','assessment',
--       'attendance_record','audit_log','booking','calendar_event','class_section',
--       'class_session','class_subject_distribution','conversation',
--       'conversation_message','conversation_participant','conversation_report',
--       'cycle','enrollment','export_job','grade','grade_level','guardian',
--       'guardianship','guardianship_claim','import_batch','lesson_entry',
--       'meeting_request','notification','notification_preference',
--       'remediation_plan','roster_source','school','snapshot_recompute_trigger',
--       'student','student_global_snapshot','student_subject_snapshot','subject',
--       'subject_coefficient','teacher_profile','teaching_assignment','term',
--       'tutor','tutor_availability','user_profile'
--     ];
--     has_app_user CONSTANT boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user');
--   BEGIN
--     FOREACH t IN ARRAY tenant_scoped LOOP
--       EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
--       EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
--       IF has_app_user THEN
--         EXECUTE format('REVOKE SELECT, INSERT, UPDATE, DELETE ON public.%I FROM app_user', t);
--       END IF;
--     END LOOP;
--     IF has_app_user THEN
--       REVOKE USAGE ON SCHEMA public FROM app_user;
--     END IF;
--   END
--   $rollback$;
--
-- Ce renversement est EXÉCUTÉ par `scripts/rls-isolation-check.js` (applique →
-- prouve le refus → renverse → prouve que `pg_policy` est revenu à son compte
-- antérieur et `relrowsecurity` à `f`), et non seulement écrit ici : un rollback
-- jamais joué est une assertion sur un commentaire.
--
-- ============================================================================
-- CE QUE LE GARDE DE DÉRIVE NE PEUT PAS VOIR — ET POURQUOI IL Y A UN AUTRE GARDE
-- ============================================================================
--
-- `prisma migrate diff --from-schema-datasource --to-schema-datamodel` ignore
-- policies et GRANTs : ce diff reste `No difference detected` avec ou sans cette
-- migration. Bonne nouvelle (aucun faux rouge sur G-MIGRATION) et mauvaise
-- nouvelle, qui est la moitié porteuse : le garde de dérive ne pourra JAMAIS
-- détecter une policy supprimée hors bande. C'est ce qui rend
-- `scripts/rls-isolation-check.js` structurellement nécessaire, et pas
-- « confortable » : il est la seule chose capable d'observer l'effet de ce
-- fichier.

-- ---------------------------------------------------------------------------
-- Un SEUL bloc, UN SEUL tableau littéral de 44 noms — plus le sous-ensemble
-- APPEND-ONLY, qui est une LISTE D'EXCEPTIONS et non une seconde copie.
--
-- Deux copies du tableau des 44 (une pour les policies, une pour les GRANTs)
-- seraient une source de dérive à elles seules — d'où le drapeau `has_app_user`
-- calculé une fois, plutôt qu'un second bloc `DO`. `append_only`, lui, ne
-- duplique rien : il NOMME deux des 44, et le bloc REFUSE de s'appliquer s'il
-- contient un nom absent des 44 (une exemption muette au lieu de restrictive).
-- ---------------------------------------------------------------------------
DO $rls$
DECLARE
  tenant_scoped CONSTANT text[] := ARRAY[
    'academic_year',
    'alert_instance',
    'alert_rule',
    'announcement',
    'assessment',
    'attendance_record',
    'audit_log',
    'booking',
    'calendar_event',
    'class_section',
    'class_session',
    'class_subject_distribution',
    'conversation',
    'conversation_message',
    'conversation_participant',
    'conversation_report',
    'cycle',
    'enrollment',
    'export_job',
    'grade',
    'grade_level',
    'guardian',
    'guardianship',
    'guardianship_claim',
    'import_batch',
    'lesson_entry',
    'meeting_request',
    'notification',
    'notification_preference',
    'remediation_plan',
    'roster_source',
    'school',
    'snapshot_recompute_trigger',
    'student',
    'student_global_snapshot',
    'student_subject_snapshot',
    'subject',
    'subject_coefficient',
    'teacher_profile',
    'teaching_assignment',
    'term',
    'tutor',
    'tutor_availability',
    'user_profile'
  ];
  -- APPEND-ONLY : sous-ensemble STRICT du tableau ci-dessus qui ne reçoit que
  -- `SELECT, INSERT`. Voir l'en-tête §« DEUX JEUX DE PRIVILÈGES » (ADR-032 §D7).
  -- `audit_log` porte une chaîne hash/prev_hash ; `conversation_message` est
  -- déclarée immuable par `schema.prisma`. Ni l'une ni l'autre n'a d'appelant
  -- UPDATE/DELETE dans le code applicatif (mesuré).
  append_only CONSTANT text[] := ARRAY[
    'audit_log',
    'conversation_message'
  ];
  -- Les rôles sont à l'échelle du CLUSTER, les migrations s'appliquent à une
  -- BASE : sur une base scratch neuve d'un cluster sans `app_user`, les GRANTs
  -- sont sautés et `migrate deploy` réussit quand même. Calculé UNE fois.
  has_app_user CONSTANT boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user');
  expected CONSTANT integer := 44;
  t text;
BEGIN
  -- Un tableau tronqué par une résolution de conflit laisserait des tables sans
  -- policy en silence. On refuse d'appliquer plutôt que de protéger 43 tables.
  IF array_length(tenant_scoped, 1) IS DISTINCT FROM expected THEN
    RAISE EXCEPTION
      'tenant_isolation: le tableau porte % noms au lieu de % ; migration refusée',
      array_length(tenant_scoped, 1), expected;
  END IF;

  -- Une table append-only qui ne serait PAS dans `tenant_scoped` ne recevrait
  -- aucun GRANT du tout — l'exemption serait alors muette au lieu d'être
  -- restrictive. On refuse d'appliquer plutôt que de laisser les deux listes
  -- diverger.
  FOREACH t IN ARRAY append_only LOOP
    IF NOT (t = ANY (tenant_scoped)) THEN
      RAISE EXCEPTION
        'tenant_isolation: la table append-only public.% est absente de tenant_scoped', t;
    END IF;
  END LOOP;

  FOREACH t IN ARRAY tenant_scoped LOOP
    -- Une table absente est une erreur, jamais un saut : sauter reviendrait à
    -- livrer une policy manquante avec un `migrate deploy` vert.
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE EXCEPTION 'tenant_isolation: la table public.% est introuvable', t;
    END IF;

    -- Moitié SÉCURITÉ : inconditionnelle. Pas de `FORCE` — voir l'en-tête.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- `CREATE POLICY` n'a pas d'`IF NOT EXISTS` en PG 15 : le DROP préalable
    -- rend la migration re-jouable après une application partielle.
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);

    EXECUTE format($policy$
      CREATE POLICY tenant_isolation ON public.%I
        FOR ALL
        TO PUBLIC
        USING (
          nullif(current_setting('app.current_tenant_id', true), '')::uuid = tenant_id
        )
        WITH CHECK (
          nullif(current_setting('app.current_tenant_id', true), '')::uuid = tenant_id
        )
    $policy$, t);

    -- Moitié ACCÈS : conditionnelle, et strictement limitée aux 44 tables
    -- placées sous policy juste au-dessus.
    --
    -- DEUX jeux : les tables APPEND-ONLY ne reçoivent jamais UPDATE ni DELETE.
    -- La branche restrictive est écrite EN PREMIER, pour qu'une lecture rapide
    -- ne puisse pas la manquer, et pour qu'un `ELSE` oublié échoue du côté sûr.
    IF has_app_user THEN
      IF t = ANY (append_only) THEN
        EXECUTE format('GRANT SELECT, INSERT ON public.%I TO app_user', t);
      ELSE
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO app_user', t);
      END IF;
    END IF;
  END LOOP;

  IF has_app_user THEN
    -- Déjà détenu via le grant PUBLIC par défaut ; rendu nominatif pour survivre
    -- à un durcissement futur qui révoquerait PUBLIC.
    GRANT USAGE ON SCHEMA public TO app_user;
  ELSE
    RAISE NOTICE
      'tenant_isolation: le rôle app_user est absent de ce cluster ; les 44 policies '
      'sont posées, les GRANTs sont sautés. Les policies ne dépendent d''aucun rôle.';
  END IF;
END
$rls$;
