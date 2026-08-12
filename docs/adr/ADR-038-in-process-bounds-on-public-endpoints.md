# ADR-038 — In-process admission bounds on public, pre-authentication endpoints

- **Status**: Accepted
- **Date**: 2026-08-12
- **Slice**: `S-E05-7` (epic V3-E05 — AuthN/AuthZ hardening)
- **Finding**: `PF-46` *(the « unthrottled » third only)* — **narrowed, not closed** · **Gates**: G-AUTHZ (primary),
  G-DNC · **DNC**: DNC-10
- **Scope**: `apps/api/src/shared/auth/public-endpoint-throttle.ts`,
  `apps/api/src/shared/auth/register-throttle.guard.ts`
- **Supersedes nothing.** Neighbours ADR-002 (multi-tenancy), ADR-004 (Keycloak),
  ADR-035 (audit inside the transaction), ADR-036 (provenance behind the reverse proxy)

## Contexte

`POST /auth/register-parent` est **le seul chemin de mutation public et non authentifié** du produit. Depuis `S-E05-11` une requête anonyme peut déclencher **quatre** aller-retours vers l'API admin de Keycloak : `findUserByEmail`, `createUser`, `setUserPassword`, et — sur transaction annulée — le `deleteUser` compensatoire. Aucune borne ne s'y appliquait : nginx n'expose que `api_zone` (120 r/m, `infra/nginx/conf.d/pilotage.conf`), la zone stricte `auth_zone` ne couvre que les routes de **pages** `/parent/login|register`, et la topologie locale `--profile app` n'a pas de nginx du tout.

Deux limiteurs existent déjà dans `apps/api`, et **aucun n'est copiable ici** :

| | `child-claims.service.ts` | `messaging.service.ts` | **cette décision** |
|---|---|---|---|
| Stockage | comptage de lignes en base | comptage de lignes en base | **mémoire du process** |
| Portée | tenant + guardian | tenant + expéditeur | **sans tenant (pré-auth)** |
| Redémarrage | durable | durable | **volatil** |
| Configuration | aucune | `MESSAGING_RATE_LIMIT_*` | **aucune (DNC-10)** |

Deux précédents contradictoires sans règle écrite pour choisir entre eux, c'est exactement la dérive qu'ADR-036/ADR-037 existent pour supprimer. D'où cet ADR plutôt qu'un simple docblock.

## D1 — Compteur **en mémoire du process**, pas de compteur en base

**Décision.** La borne est un compteur à fenêtre fixe tenu en mémoire, pas une requête `count()` sur une table.

**Raisons, mesurées :**

1. **Il n'y a aucune ligne à compter.** Les deux limiteurs existants bornent un acteur *authentifié* dont chaque tentative précédente a laissé une ligne durable. Une inscription refusée ne laisse rien : ce point d'entrée doit refuser **avant** son premier effet de bord, et ses effets de bord sont ceux de Keycloak, pas ceux de Postgres.
2. **Il n'y a ni tenant ni acteur à ce moment-là.** Le tenant est résolu à `register.controller.ts:358`, au cœur du handler que la borne existe précisément pour éviter d'atteindre. Un `WHERE tenant_id = …` ne peut pas être écrit par un guard qui s'exécute avant l'authentification, avant la validation et avant l'existence du tenant. **Cette absence est elle-même porteuse** : la clause « schéma » d'ADR-002 ne s'applique pas — la slice ne crée aucun modèle Prisma — et c'est l'argument le plus fort contre les deux limiteurs tenant-scopés.
3. **Une écriture en base par requête anonyme refusée reconstruirait, un sous-système plus loin, l'amplification même que la slice supprime.**

**Conséquence acceptée** : aucune migration, `G-MIGRATION` non déclenché, et un compteur volatil (voir D2).

## D2 — Le mono-process est **porteur** et doit être visible côté infra

**Décision.** Le plafond global n'est exact que tant que l'API tourne en **une seule instance**. `infra/docker-compose*.yml` ne déclare aujourd'hui ni `replicas` ni `scale`, donc l'invariant tient.

**Le jour où quelqu'un ajoute une réplique, le plafond réel devient N × la constante, et aucun test ne devient rouge.** C'est pourquoi l'invariant est écrit ici, là où un éditeur d'infra le rencontre, et pas seulement dans `apps/api/src/shared/auth/`. Un redémarrage remet aussi les compteurs à zéro — y compris le redémarrage que la boucle fail-closed d'ADR-035 D2 rend plausible.

**Si une seconde réplique devient nécessaire**, la borne doit migrer vers un compteur partagé (Redis/BullMQ est déjà présent) **dans la même PR que la réplique**, pas après.

## D3 — **Aucune** lecture d'environnement ici, contrairement à `messaging`

**Décision.** Les quatre constantes (fenêtre, plafond par identité, plafond global, capacité de la carte de clés) sont des exports nommés. Les deux fichiers ne lisent **rien** de l'environnement du process, et n'exposent aucun interrupteur d'arrêt (DNC-10). Précédent suivi : `shared/audit/client-hints.ts:82-86`.

**Pourquoi la divergence avec `messaging.service.ts` est délibérée et non une incohérence :** `messaging` borne un anti-spam sur un chemin **authentifié**, où une valeur mal réglée coûte du bruit ; il est donc légitime qu'un opérateur puisse l'assouplir. Ici le même réglage serait la seule chose entre un appelant **anonyme** et l'API admin de Keycloak. Règle générale qui en découle : **sur un chemin anonyme, l'absence de configuration signifie le réglage le plus strict, jamais l'arrêt de la protection.**

La règle est vérifiée structurellement (`public-endpoint-throttle.spec.ts`, bloc `(i)`), sur les sources dé-commentées — les docblocks expliquent la règle et un grep brut rougirait sur sa propre documentation (`PF-83`).

## D4 — Le plafond global est **aveugle à la source**, et c'est un arbitrage de disponibilité assumé

**Fait mesuré.** Ce point d'entrée a exactement **un** appelant dans tout le dépôt : une server action Next.js qui émet un `fetch` côté serveur (`register.controller.ts:195-214`, `shared/audit/client-hints.ts:26-35`). L'adresse transport est donc l'adresse de sortie unique du conteneur web, partagée par tous les inscrits — c'est `PF-31` exprimé sous forme de limiteur. Une borne par IP mettrait tous les parents du monde dans le même seau : elle est donc **refusée**, et le limiteur ne lit aucune adresse ni en-tête de transfert.

**Le résidu, choisi par écrit plutôt que découvert en incident.** Le plafond global est par conséquent déclenchable par n'importe qui avec `curl` et un corps JSON vide. Il **convertit une attaque en amplification en une attaque en disponibilité** : le lecteur du refus est fréquemment un parent innocent. Arbitrage retenu — un trafic non borné vers l'API admin de Keycloak sur un entonnoir fail-closed est pire qu'une inscription différée — assorti de trois obligations :

1. le message de refus est **impersonnel, sans chiffre et sans jargon** (il s'adresse à une victime, pas à un coupable), et les trois motifs de refus sont **indiscernables** de l'extérieur (aucun oracle d'énumération) ;
2. le déclenchement du plafond **endpoint-wide** émet un `Logger.warn` — agrégé, une ligne par fenêtre — sur lequel un opérateur peut alerter ; **aucune ligne d'`audit_log`** n'est écrite par refus (G-AUDIT est argumenté, pas déclenché : pas de mutation, donc pas de trace, et une écriture par refus rebâtirait l'amplification) ;
3. le plafond est dimensionné contre un **scénario écrit** — une soirée d'inscription de 200 parents en une heure, soit 3,3 admissions/minute en moyenne — et non contre un chiffre rond.

Résidu supplémentaire enregistré : le plafond est **inter-tenant par construction**. Acceptable aujourd'hui parce que le handler résout un tenant unique codé en dur ; **pas** acceptable silencieusement le jour où de vrais tenants coexistent — la rafale d'inscription d'un établissement refuserait celles de tous les autres.

## Ce que cet ADR ne décide pas

`emailVerified: true` reste inchangé (arbitrage produit consigné à `register.controller.ts:153-156`, il exige un câblage SMTP du realm dans `infra/`) ; le point d'entrée reste public (ADR-004 / produit) ; aucun autre point d'entrée n'est borné ; ni limiteur distribué, ni CAPTCHA. **`PF-46` est réduit, pas clos.**
