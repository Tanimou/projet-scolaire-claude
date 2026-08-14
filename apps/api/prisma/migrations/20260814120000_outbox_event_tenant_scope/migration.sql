-- S-E01-2d — `outbox_event` CESSE d'être la table hors de toute policy : elle
-- reçoit un `tenant_id` DÉNORMALISÉ, et rejoint le régime ordinaire des tables
-- tenant-scopées. Ferme `PF-185`. Décidé par `ADR-044`.
--
-- Migration RELUE À LA MAIN (ADR-027, G-MIGRATION). Elle n'a été produite ni par
-- `prisma migrate dev` ni par `prisma db push` — ni l'une ni l'autre chaîne
-- n'apparaît dans ce diff. `schema.prisma` EST touché par cette story, et c'est
-- la DIFFÉRENCE avec `S-E01-2b` et `S-E01-2c` : là-bas il ne l'était pas parce
-- qu'une policy et un GRANT ne sont pas modélisables en Prisma ; ici il s'agit
-- d'une COLONNE et d'une CLÉ ÉTRANGÈRE, que Prisma modélise et que le garde de
-- dérive de schéma VOIT. Le piège correspondant est armé et refermé dans le même
-- diff : `prisma generate` est lancé dans cette story (P-05), sans quoi le
-- typecheck serait ROUGE tant que le client n'est pas régénéré.
--
-- ============================================================================
-- CE QUE CETTE MIGRATION FAIT — ET SURTOUT CE QU'ELLE NE FAIT PAS
-- ============================================================================
--
-- ELLE FAIT : ajoute `outbox_event.tenant_id` (uuid, NOT NULL), matérialise la
-- clé étrangère vers `tenant` en `ON DELETE CASCADE`, crée l'index de tête
-- `(tenant_id, status, created_at)`, pose `ENABLE ROW LEVEL SECURITY` + la
-- policy `tenant_isolation` — le MÊME prédicat que les 44, mot pour mot — et
-- accorde `SELECT, INSERT, UPDATE` à `app_user`. Le recensement passe donc de
-- `44 + 5` à `45 + 5`, et `outbox_event` SORT du résidu.
--
-- ELLE NE FAIT PAS : rendre l'application isolée par RLS. **Après cette
-- migration, l'application qui tourne n'est TOUJOURS PAS isolée par RLS.** Elle
-- se connecte comme `pilotage`, PROPRIÉTAIRE des tables, et un propriétaire
-- n'est pas soumis à ses propres policies tant que `FORCE ROW LEVEL SECURITY`
-- n'est pas posé — délibérément absent, voir `ADR-032 §D5`. Ce qui reste est la
-- BASCULE DE CONNEXION (`S-E01-1`), et rien de cette phrase n'a changé depuis
-- `S-E01-2b`. Aucune ligne de ce fichier ne doit pouvoir se lire comme
-- « l'application est isolée » : cette surclamation EST le défaut `PF-02`.
--
-- ELLE NE FAIT PAS NON PLUS : inventer un chemin de clé étrangère. `ADR-042 §D7`
-- avait raison de refuser d'en écrire un — le couple `aggregate_type` +
-- `aggregate_id` reste POLYMORPHE et NON CONTRAINT, et il le reste après cette
-- migration. La table n'est pas devenue dérivable ; elle est devenue
-- tenant-SCOPÉE, ce qui est une décision de dénormalisation, pas une dérivation.
--
-- ============================================================================
-- POURQUOI UNE COLONNE PLUTÔT QU'UNE POLICY (ADR-044 §D1)
-- ============================================================================
--
-- `ADR-042 §D7` a MESURÉ sur `pg_constraint` que `outbox_event` ne détient
-- AUCUNE clé étrangère, donc qu'il n'existe aucun `EXISTS`-sur-le-parent à
-- écrire. Ce constat n'a pas changé et n'est pas contourné ici : la seule façon
-- d'isoler cette table est de lui DONNER un discriminant. C'est exactement ce
-- que `PF-185` prescrivait, et cette migration l'exécute.
--
-- La FK ajoutée pointe vers `tenant`, pas vers l'agrégat : elle ne rend pas
-- `aggregate_id` contraint et ne prétend pas le faire.
--
-- ============================================================================
-- LE BACKFILL, ET POURQUOI IL EST FAIL-LOUD PLUTÔT QUE COMPLAISANT
-- ============================================================================
--
-- MESURÉ (`ADR-042 §D7`, re-vérifié pour cette story) : `outboxEvent.` a ZÉRO
-- appelant dans `apps/**` et `packages/**`. La table est un échafaudage SANS
-- ÉCRIVAIN, donc elle est vide partout, et le backfill est aujourd'hui une
-- formalité. Il cesse d'en être une le jour où un écrivain atterrit — d'où
-- l'intérêt de le faire MAINTENANT plutôt qu'après.
--
-- Une ligne existante n'est PAS attribuable : il n'y a, par construction, aucun
-- discriminant à lire. Les deux réponses complaisantes sont donc refusées :
--   • la SUPPRIMER — un événement non délivré effacé par une migration est une
--     perte de données silencieuse, jamais un nettoyage ;
--   • l'AFFECTER au premier tenant venu — c'est de la fiction avec une policy
--     autour, précisément ce que `ADR-042` refuse.
-- Le backfill n'accepte donc qu'UN seul cas sans ambiguïté (base MONO-TENANT :
-- l'affectation est forcée, pas devinée) et LÈVE une exception dans tous les
-- autres. Une base multi-tenant portant des lignes orphelines fait ÉCHOUER le
-- `migrate deploy` avec le compte exact — un opérateur tranche, pas la
-- migration.
--
-- UNE SEULE MIGRATION, PAS DEUX, ET C'EST UNE MESURE. `PF-185` écrivait
-- « NOT NULL dans une SECONDE migration ». Ce découpage expand/contract existe
-- pour les tables à ÉCRIVAINS VIVANTS : il évite qu'un écrivain de l'ancien code
-- insère une ligne sans la colonne entre les deux déploiements. Ici les
-- écrivains sont au nombre de ZÉRO, donc cette fenêtre n'existe pas — et la
-- scinder laisserait la colonne NULLABLE en production pendant tout un cycle de
-- déploiement, c'est-à-dire une colonne de SÉCURITÉ optionnelle. Le découpage
-- serait strictement PIRE ici. Il redeviendra obligatoire le jour où un écrivain
-- existera : c'est écrit dans `ADR-044 §D2`.
--
-- ============================================================================
-- LE GRANT : `SELECT, INSERT, UPDATE` — ET PAS `DELETE` (ADR-044 §D3)
-- ============================================================================
--
-- `ADR-032 §D7` et `ADR-042 §D5` mesurent les privilèges DEPUIS LES SITES
-- D'APPEL. Ici la mesure rend ZÉRO site d'appel, donc la mesure seule ne tranche
-- pas — et c'est dit plutôt que masqué. Ce qui tranche est la FORME du pattern
-- outbox, qui est la raison d'être de la table :
--   INSERT — le producteur écrit l'événement DANS LA MÊME TRANSACTION que
--            l'agrégat. C'est tout le pattern ; sans `INSERT` la table est
--            inutilisable par le rôle applicatif.
--   UPDATE — le relais marque `status`, `sent_at`, `attempts`, `last_error`.
--            Un événement délivré est un événement MUTÉ, jamais un nouveau.
--   DELETE — RETENU. La purge de rétention est un travail d'exploitation, mené
--            par le PROPRIÉTAIRE, pas par le rôle des requêtes. Donner `DELETE`
--            au rôle applicatif lui permettrait d'effacer des événements NON
--            DÉLIVRÉS, c'est-à-dire exactement la perte que le pattern outbox
--            existe pour empêcher. « Un privilège sans appelant est du rayon de
--            souffle pur » (`ADR-032 §D7`) et celui-ci n'aura jamais d'appelant
--            légitime côté application.
-- L'absence de `DELETE` est ASSERTÉE (`OUTBOX_DELETE = 0`), donc elle ne peut
-- pas s'élargir en silence.
--
-- CE QUE LE GRANT N'EST PAS : la réponse à une erreur de permission. `PF-183`
-- excluait explicitement la branche « élargir le grant pour faire taire le
-- `permission denied` ». Elle reste exclue : ce qui rend ce GRANT admissible
-- n'est pas qu'il fasse taire quelque chose, c'est que la POLICY existe
-- désormais et est PROUVÉE par exécution avant lui.
--
-- ============================================================================
-- R-11 : L'INDEX DE TÊTE EST CRÉÉ ICI, PAS SUPPOSÉ
-- ============================================================================
--
-- Contrairement aux 44 (tenant_id déjà en tête d'index) et aux 5 dérivées
-- (colonne FK déjà en tête), `outbox_event` ne portait qu'un index
-- `(status, created_at)` : sa colonne `tenant_id` VIENT D'ÊTRE CRÉÉE, donc aucun
-- index ne la menait. Cette migration CRÉE `(tenant_id, status, created_at)` et
-- VÉRIFIE, avant d'activer la policy, qu'un index mène bien par `tenant_id` —
-- elle refuse de s'appliquer sinon. L'index `(status, created_at)` est CONSERVÉ :
-- le relais draine par statut, et le retirer serait un changement de
-- comportement déguisé en nettoyage.
--
-- ============================================================================
-- EXPAND / CONTRACT, ET LE ROLLBACK (G-MIGRATION, ADR-044 §D4)
-- ============================================================================
--
-- CELLE-CI N'EST PAS UN EXPAND PUR, et c'est la première du lot. Elle AJOUTE une
-- colonne, une contrainte et un index — donc le renversement ne se réduit PAS à
-- `DROP POLICY` + `DISABLE` + `REVOKE`. Il doit aussi retirer ce qui a été créé,
-- dans l'ordre inverse. Écrire « expand pur » ici par analogie avec les deux
-- migrations précédentes serait un copier-coller faux.
--
-- Le renversement est SANS PERTE tant que la table est vide (mesuré : zéro
-- écrivain). Il cesse de l'être dès qu'elle ne l'est plus : retirer la colonne
-- détruirait alors l'attribution, qui n'est pas re-dérivable. C'est écrit ici
-- pour que personne ne joue ce rollback plus tard en croyant qu'il est neutre.
--
--   DO $rollback$
--   DECLARE
--     has_app_user CONSTANT boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user');
--   BEGIN
--     DROP POLICY IF EXISTS tenant_isolation ON public.outbox_event;
--     ALTER TABLE public.outbox_event DISABLE ROW LEVEL SECURITY;
--     IF has_app_user THEN
--       REVOKE SELECT, INSERT, UPDATE, DELETE ON public.outbox_event FROM app_user;
--     END IF;
--     DROP INDEX IF EXISTS public.outbox_event_tenant_id_status_created_at_idx;
--     ALTER TABLE public.outbox_event DROP CONSTRAINT IF EXISTS outbox_event_tenant_id_fkey;
--     ALTER TABLE public.outbox_event DROP COLUMN IF EXISTS tenant_id;  -- DESTRUCTIF si la table n'est plus vide
--   END
--   $rollback$;
--
-- La moitié policy/GRANT de ce renversement est EXÉCUTÉE par
-- `scripts/rls-isolation-check.js` : son bloc générique itère toute table portant
-- `relrowsecurity`, donc il ramasse `outbox_event` avec les 49 autres, et
-- `ROLLBACK_TOUCHED` est comparé à `TENANT_COLS + DERIVED_EXPECTED` — 50
-- désormais — donc l'inclusion est VÉRIFIÉE, pas supposée.
--
-- Elle est RE-JOUABLE de bout en bout : `ADD COLUMN IF NOT EXISTS`,
-- `CREATE INDEX IF NOT EXISTS`, la contrainte gardée sur `pg_constraint`, et
-- `DROP POLICY IF EXISTS` avant chaque `CREATE POLICY` (PG 15 n'a pas
-- d'`IF NOT EXISTS` sur `CREATE POLICY`). Une application partielle se relance.
--
-- ============================================================================
-- CE QUE LE GARDE DE DÉRIVE VOIT, ET CE QU'IL NE VERRA JAMAIS
-- ============================================================================
--
-- Il voit la COLONNE, la CONTRAINTE et l'INDEX : `prisma migrate diff` les
-- compare à `schema.prisma`, donc un oubli d'un côté serait un ROUGE de dérive.
-- C'est pourquoi les noms émis ici sont EXACTEMENT ceux que Prisma génère
-- (`outbox_event_tenant_id_fkey`, `outbox_event_tenant_id_status_created_at_idx`)
-- et pourquoi la FK porte `ON DELETE CASCADE ON UPDATE CASCADE`, la forme que
-- `onDelete: Cascade` produit — mêmes noms et même forme que
-- `school_tenant_id_fkey` et `user_profile_tenant_id_fkey` dans `0_baseline`.
--
-- Il ne verra JAMAIS la policy ni le GRANT : ce diff reste `No difference
-- detected` avec ou sans eux. Seul `scripts/rls-isolation-check.js` les observe,
-- et son recensement est un ACCORD calculé sur le catalogue
-- (`RLS_ON == TENANT_COLS + DERIVED_EXPECTED`), jamais un 50 en dur.

-- `ENABLE ROW LEVEL SECURITY` et `ADD COLUMN` prennent un ACCESS EXCLUSIVE :
-- borner l'attente plutôt que faire la queue derrière un lecteur long. La
-- migration échoue proprement au bout de 5 s et se relance telle quelle.
SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- (1) EXPAND — la colonne, d'abord NULLABLE : une table non vide refuserait un
--     `NOT NULL` immédiat, et ce refus doit venir du bloc de backfill ci-dessous
--     avec son compte, pas d'un message d'erreur générique de PostgreSQL.
-- ---------------------------------------------------------------------------
ALTER TABLE public.outbox_event ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- ---------------------------------------------------------------------------
-- (2) BACKFILL — un seul cas non ambigu, et un ÉCHEC BRUYANT pour tous les
--     autres. Voir l'en-tête §BACKFILL.
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE
  tenant_count integer;
  orphans integer;
BEGIN
  SELECT count(*) INTO tenant_count FROM public.tenant;

  -- MONO-TENANT : l'affectation est FORCÉE par le catalogue, pas devinée. C'est
  -- le seul cas où une ligne orpheline a une attribution unique et vérifiable.
  IF tenant_count = 1 THEN
    UPDATE public.outbox_event
       SET tenant_id = (SELECT id FROM public.tenant)
     WHERE tenant_id IS NULL;
  END IF;

  SELECT count(*) INTO orphans FROM public.outbox_event WHERE tenant_id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION
      'outbox_event : % ligne(s) sans tenant_id et % tenants en base ; aucune '
      'attribution n''est dérivable (aggregate_type/aggregate_id sont polymorphes '
      'et non contraints). La migration REFUSE de deviner et refuse de supprimer : '
      'un opérateur doit trancher, puis relancer. Voir ADR-044 §D2.',
      orphans, tenant_count;
  END IF;
END
$backfill$;

-- ---------------------------------------------------------------------------
-- (3) La colonne devient obligatoire. Atteignable seulement si (2) a laissé zéro
--     orpheline — donc jamais « en silence ».
-- ---------------------------------------------------------------------------
ALTER TABLE public.outbox_event ALTER COLUMN tenant_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- (4) La clé étrangère, avec le NOM et la FORME que Prisma génère pour
--     `onDelete: Cascade` — identique à `school_tenant_id_fkey` et
--     `user_profile_tenant_id_fkey`. Gardée sur `pg_constraint` : `ADD
--     CONSTRAINT` n'a pas d'`IF NOT EXISTS`, et cette migration est re-jouable.
-- ---------------------------------------------------------------------------
DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'outbox_event_tenant_id_fkey'
       AND conrelid = 'public.outbox_event'::regclass
  ) THEN
    ALTER TABLE public.outbox_event
      ADD CONSTRAINT outbox_event_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenant(id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$fk$;

-- ---------------------------------------------------------------------------
-- (5) R-11 — l'index dont `tenant_id` est la colonne DE TÊTE. Créé ici parce que
--     la colonne vient d'être créée : aucun index existant ne pouvait la mener.
--     `(status, created_at)` est CONSERVÉ, voir l'en-tête §R-11.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS outbox_event_tenant_id_status_created_at_idx
  ON public.outbox_event (tenant_id, status, created_at);

-- ---------------------------------------------------------------------------
-- (6) La moitié SÉCURITÉ + la moitié ACCÈS, dans un bloc qui REFUSE de
--     s'appliquer plutôt que de sauter : table introuvable, colonne
--     `tenant_id` absente, aucun index de tête, chaîne de privilèges hors du jeu
--     FERMÉ. Sauter reviendrait à livrer une policy manquante sous un
--     `migrate deploy` VERT — la forme exacte du défaut que cette story referme.
-- ---------------------------------------------------------------------------
DO $rls_outbox$
DECLARE
  target CONSTANT text := 'outbox_event';
  -- Jeu FERMÉ, comme les 5 dérivées : la seule façon d'élargir le rayon de
  -- souffle est d'ajouter ici une chaîne que le diff montre. AUCUNE ne contient
  -- `DELETE` — voir l'en-tête §LE GRANT.
  allowed_privileges CONSTANT text[] := ARRAY[
    'SELECT, INSERT',
    'SELECT, INSERT, UPDATE'
  ];
  privileges CONSTANT text := 'SELECT, INSERT, UPDATE';
  -- Les rôles sont à l'échelle du CLUSTER, les migrations s'appliquent à une
  -- BASE : sur une base scratch d'un cluster sans `app_user`, les GRANTs sont
  -- sautés et `migrate deploy` réussit quand même. La moitié ENABLE/CREATE
  -- POLICY reste INCONDITIONNELLE — c'est la propriété de sécurité.
  has_app_user CONSTANT boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user');
  target_oid oid;
  tenant_attnum smallint;
BEGIN
  IF NOT (privileges = ANY (allowed_privileges)) THEN
    RAISE EXCEPTION
      'tenant_isolation (outbox) : privilèges "%" hors du jeu fermé ; voir ADR-044 §D3', privileges;
  END IF;

  target_oid := to_regclass(format('public.%I', target));
  IF target_oid IS NULL THEN
    RAISE EXCEPTION 'tenant_isolation (outbox) : la table public.% est introuvable', target;
  END IF;

  SELECT a.attnum INTO tenant_attnum
    FROM pg_attribute a
   WHERE a.attrelid = target_oid AND a.attname = 'tenant_id'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF tenant_attnum IS NULL THEN
    RAISE EXCEPTION
      'tenant_isolation (outbox) : public.% ne porte pas de colonne tenant_id ; le prédicat '
      'ne compilerait pas et la policy serait posée sur une table sans discriminant', target;
  END IF;

  -- R-11, VÉRIFIÉ avant d'activer la policy et non supposé : un prédicat sur
  -- `tenant_id` sans index de tête est un balayage séquentiel par lecture.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index x WHERE x.indrelid = target_oid AND x.indkey[0] = tenant_attnum
  ) THEN
    RAISE EXCEPTION
      'tenant_isolation (outbox) : aucun index ne mène par public.%.tenant_id (R-11)', target;
  END IF;

  -- Moitié SÉCURITÉ : INCONDITIONNELLE. Pas de `FORCE` — voir l'en-tête.
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);

  -- PG 15 n'a pas d'`IF NOT EXISTS` sur `CREATE POLICY` : le DROP préalable rend
  -- la migration re-jouable après une application partielle.
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', target);

  -- LE MÊME PRÉDICAT QUE LES 44, MOT POUR MOT. `nullif(…, '')` n'est pas
  -- décoratif : après un `COMMIT`, `set_config(…, true)` laisse le GUC à `''` et
  -- NON à NULL, donc un cast nu lèverait `22P02` à la DEUXIÈME requête de chaque
  -- connexion du pool. Ce n'est pas non plus un `IS NULL OR` déguisé : `''`
  -- devient NULL, et NULL ne laisse passer AUCUNE ligne. `USING` et `WITH CHECK`
  -- sont déclarés EXPLICITEMENT et IDENTIQUES — un `with_check` NULL retomberait
  -- sur `USING`, ce qui a l'air correct aujourd'hui et casse le jour où
  -- quelqu'un en ajoute un permissif. `TO PUBLIC` : une policy nommant un rôle
  -- exempterait en silence tous les AUTRES rôles non propriétaires.
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
  $policy$, target);

  -- Moitié ACCÈS : conditionnelle, une table, jamais `ON ALL TABLES`. `%s` est
  -- sûr ici parce que `privileges` vient d'être validé contre le jeu FERMÉ.
  IF has_app_user THEN
    EXECUTE format('GRANT %s ON public.%I TO app_user', privileges, target);
  ELSE
    RAISE NOTICE
      'tenant_isolation (outbox) : le rôle app_user est absent de ce cluster ; la policy est '
      'posée, le GRANT est sauté. La policy ne dépend d''aucun rôle.';
  END IF;
END
$rls_outbox$;
