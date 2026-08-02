# Lakoli — DEEP AUDIT: domaine COMMUNICATION

**Méthode.** Extraction ciblée (node one-liners, slices de 1–7 Ko) sur le corpus minifié Vite de Lakoli :
`scratchpad/chunks/*.js` (149 chunks), `scratchpad/lakoli-main.js` (730 570 caractères), `scratchpad/lakoli-endpoints.txt`.
Toute chaîne entre guillemets ci-dessous est **CONFIRMED** = présente verbatim dans le bundle. Les déductions sont explicitement marquées **INFERRED**.

**Chunks ouverts pour ce rapport :**

| Chunk | Taille | Page / rôle |
|---|---|---|
| `campagnes-DN7uPtL8.js` | 46 753 o | Campagnes SMS (6 onglets) |
| `index-DuZBT_7c.js` | 43 843 o | Messagerie SMS (7 onglets) + `BoutonSms` réutilisable |
| `index-B59sXdjb.js` | 30 304 o | **WhatsApp Parents** (4 onglets) — chunk *non* nommé `whatsapp*` |
| `index-C62rUqbA.js` | 14 266 o | Crédit Communication (wallet SMS) |
| `index-CpPdJatZ.js` | 8 090 o | Journal SMS |
| `index-C_ZhDXdL.js` | 13 580 o | Portail Parent (2 onglets) |
| `parametres-KQTq47NY.js` | 10 665 o | Paramètres du portail |
| `preinscriptions-B3gu9n4h.js` | 9 255 o | Liste dossiers de préinscription portail |
| `dossier-Bl9jo0fs.js` | 16 939 o | Détail dossier portail (workflow + messagerie parent) |
| `index-vQwBYpuX.js` | 67 901 o | Réinscriptions — campagne SMS + WhatsApp |
| `detail-6Bu9thd6.js` | 137 912 o | Fiche élève — onglet Historique (relances + SMS) |
| `index-DEgXnv6X.js` | 29 959 o | Compositions — convocations SMS |
| `index-BT4yo3uy.js` | 112 473 o | **Centre d'aide Lakoli** (72 articles) — source de règles métier |
| `index-DW1DbOGP.js` | 5 458 o | Paramètres (index) |
| `index-Bs3h40d0.js` | 34 624 o | Inscriptions — lien de paiement par SMS |
| `index-Cj0ROcZS.js` | 27 288 o | Transport — relance SMS abonnements |
| `index-TfNa1dpy.js` | 30 297 o | Créances — envoi SMS du lien de paiement |

---

## 0. Correctifs à l'audit superficiel

| Affirmation de l'audit superficiel | Réalité constatée dans le bundle |
|---|---|
| « ~15 endpoints API » | Rien que le domaine communication compte **53 opérations propres** + 13 opérations transverses consommant du crédit SMS. |
| « les pages sont vides / placeholder » | Chaque page communication est un écran complet avec onglets, modales, simulateur de coût, tables, formulaires. Aucune n'est un placeholder. |
| « pas d'onglets / pas de modales explorés » | Recensés ici : 6 onglets Campagnes, 7 onglets Messagerie, 4 onglets WhatsApp, 2 onglets Portail Parent, 3 modales (Aperçu avant envoi, Nouveau modèle, Nouvelle règle), 1 modale de conversion dossier, 1 modale de convocation SMS. |

**3 endpoints absents de `lakoli-endpoints.txt`** (donc absents de tout comptage antérieur) et retrouvés en grepant les chunks :
`GET /sms-logs` (paginé), `GET /sms-wallet/recharge/verify?reference=`, `GET /preinscriptions-portail?statut&classeId&depuis`, `GET /relances?eleveId&limit`.

---

## 1. Cartographie des routes SPA du domaine

Extrait de `lakoli-main.js` (tableau de navigation, section `communiquer` dont le **label affiché est « Familles »**, description « Portail et messages ») :

```
{name:"Portail Parent",path:"/portail-parent",section:"communiquer",group:"Familles",roles:jt}
{name:"SMS",path:"/messagerie",section:"communiquer",group:"Campagnes",roles:[...An,"comptable","scolarite"]}
{name:"WhatsApp",path:"/whatsapp",section:"communiquer",group:"Campagnes",roles:[...An,"comptable","scolarite"]}
{name:"Crédit SMS & WhatsApp",path:"/credit-communication",section:"communiquer",group:"Compte",keywords:["crédit de communication"],roles:An}
```

Routes React (`lakoli-main.js`, table `<Route>`), toutes CONFIRMED :

| Route SPA | Composant / chunk | RBAC déclaré |
|---|---|---|
| `/messagerie` | `index-DuZBT_7c.js` | (hérité nav) |
| `/messagerie/campagnes` | `campagnes-DN7uPtL8.js` | — |
| `/whatsapp` | `index-B59sXdjb.js` | pas d'`allowedRoles` sur la Route |
| `/credit-communication` | `index-C62rUqbA.js` | — |
| `/sms-logs` | `index-CpPdJatZ.js` | — |
| `/portail-parent` | `index-C_ZhDXdL.js` | `["super_admin","direction","scolarite"]` |
| `/portail-parent/preinscriptions` | `preinscriptions-B3gu9n4h.js` | `["super_admin","direction","scolarite"]` |
| `/portail-parent/dossier/:id` | `dossier-Bl9jo0fs.js` | `["super_admin","direction","scolarite"]` |
| `/portail-parent/parametres` | `parametres-KQTq47NY.js` | `["super_admin","direction"]` |
| `/paiements-en-ligne/portail` | main bundle (public) | public |

**Module gating (CONFIRMED).** `lakoli-main.js` définit `function lm(e){return e.gatedModule??t3[e.path]}` et la table `t3` :
```
"/portail-parent":"parent_portal","/messagerie":"sms_messaging","/whatsapp":"whatsapp",
"/credit-communication":"communication_credit"
```
Le layout appelle `GET /module-access/catalog` (`queryKey:["module-access-catalog", tenantSlug]`, `staleTime:300000`, `retry:!1`) et calcule
`he = new Set(Y?.effectiveModules ?? [])` puis l'ensemble des modules **verrouillés** = codes du catalogue absents de `effectiveModules`.
Les 4 modules communication sont donc **gatables par plan tarifaire**. (Le seul `gatedModule:` explicitement écrit en dur dans la nav concerne `orientation_dob` et `conformite`, pas la communication — pour la communication, le gating passe par la table `t3`.)

**Bug / dette repérée.** `index-vQwBYpuX.js` (Réinscriptions) affiche, en cas de solde SMS insuffisant, un bouton « Recharger » pointant vers `href:"/parametres/sms"`. Or l'énumération complète des `path:` du bundle ne contient que `/parametres`, `/parametres/export-resiliation`, `/parametres/infos-generales`, `/parametres/paiement`, `/parametres/rh`. **`/parametres/sms` n'existe pas** → lien mort. La vraie page est `/credit-communication`.

---

## 2. Inventaire complet des endpoints (53 opérations propres)

### 2.1 `/communication/*` — moteur de campagnes (15) — `campagnes-DN7uPtL8.js`
```
GET    /communication/campaigns                    (refetchInterval 30 000 ms)
POST   /communication/campaigns
PUT    /communication/campaigns/{id}
POST   /communication/campaigns/{id}/simulate
POST   /communication/campaigns/{id}/send
POST   /communication/campaigns/{id}/cancel
GET    /communication/stats                        (refetchInterval 30 000 ms)
GET    /communication/templates
POST   /communication/templates
PUT    /communication/templates/{id}
DELETE /communication/templates/{id}
GET    /communication/rules
POST   /communication/rules
PUT    /communication/rules/{id}
DELETE /communication/rules/{id}
```

### 2.2 `/messagerie/*` — messagerie SMS/email (16) — `index-DuZBT_7c.js`
```
GET    /messagerie/stats                           (staleTime 600 000 ms, retry:false)
POST   /messagerie/envoyer
POST   /messagerie/envoyer-email
POST   /messagerie/preview-destinataires-email
GET    /messagerie/templates
POST   /messagerie/templates
PUT    /messagerie/templates/{id}
DELETE /messagerie/templates/{id}
POST   /messagerie/seed-templates
GET    /messagerie/listes
POST   /messagerie/listes
PUT    /messagerie/listes/{id}
DELETE /messagerie/listes/{id}
GET    /messagerie/listes/{id}/membres
POST   /messagerie/listes/{id}/membres
DELETE /messagerie/listes/{id}/membres/{membreId}
```

### 2.3 `/sms-logs/*` — journal & automatisations (6)
```
GET    /sms-logs?page={n}&limit={20|25}            [index-CpPdJatZ.js, index-DuZBT_7c.js]  ← absent du fichier d'endpoints
GET    /sms-logs?eleveId={id}&limit=100            [detail-6Bu9thd6.js]                    ← absent du fichier d'endpoints
GET    /sms-logs/stats                             [index-CpPdJatZ.js]
POST   /sms-logs/relance                           [index-CpPdJatZ.js]
GET    /sms-logs/auto-config                       [index-DuZBT_7c.js]
PUT    /sms-logs/auto-config/{key}                 [index-DuZBT_7c.js]
GET    /sms-logs/echecs-recents                    [lakoli-main.js, refetchInterval 60 000 ms]
```

### 2.4 `/sms-wallet/*` — portefeuille SMS (4) — `index-C62rUqbA.js`
```
GET    /sms-wallet                                 (refetchInterval 30 000 ms)
GET    /sms-wallet/packages
POST   /sms-wallet/recharge                        body {packageId}
GET    /sms-wallet/recharge/verify?reference=…     ← absent du fichier d'endpoints
```

### 2.5 `/portail-config` + `/portail/*` (4)
```
GET    /portail-config                             [index-C_ZhDXdL.js, parametres-KQTq47NY.js]
POST   /portail-config                             body {anneeScolaireId}  (= activation)
PATCH  /portail-config                             (= sauvegarde des paramètres)
POST   /portail/staff-access                       body {eleveId} → {token}  [detail-6Bu9thd6.js]
```

### 2.6 `/preinscriptions-portail/*` (6)
```
GET    /preinscriptions-portail?statut=&classeId=&depuis=   ← absent du fichier d'endpoints
GET    /preinscriptions-portail/stats
GET    /preinscriptions-portail/{id}
PATCH  /preinscriptions-portail/{id}/statut        body {statut, commentaire}
POST   /preinscriptions-portail/{id}/message       body {message}   → envoie un SMS au parent
POST   /preinscriptions-portail/{id}/convertir
```

### 2.7 `/relances` (2) — `detail-6Bu9thd6.js`
```
GET    /relances?eleveId={id}&limit=100            ← absent du fichier d'endpoints
POST   /relances                                   body {eleveId, type, destinataire?, notes?, montant?}
```

### 2.8 Opérations transverses qui consomment/produisent de la communication (13) — hors racines possédées mais fonctionnellement du domaine
```
POST   /reinscription-suivi/sms-campaign/preview   [index-vQwBYpuX.js]
POST   /reinscription-suivi/sms-campaign/send      [index-vQwBYpuX.js]
POST   /reinscription-suivi/campagne               [index-vQwBYpuX.js]  (trace la campagne WhatsApp manuelle)
POST   /subscriptions/sms-relance                  [index-Cj0ROcZS.js]  body {serviceType:"transport", anneeScolaireId}
POST   /preinscriptions/{id}/envoyer-lien          [index-Bs3h40d0.js]  → SMS lien de paiement
POST   /preinscriptions/{id}/confirmer-paiement-lien
GET    /pedagogie/planification-evaluations/{id}/notifications/preview  [index-DEgXnv6X.js]
POST   /pedagogie/planification-evaluations/{id}/notifications/sms      body {confirmer:true}
POST   /onboarding/portail-teste                   [lakoli-main.js]
POST   /paystack/portail/init                      [lakoli-main.js]  (portail public de paiement)
GET    /paystack/portail/{matricule}               [lakoli-main.js]
GET    /api/system-banners                         [lakoli-main.js]  bannières système, dont type "sms"
POST   /api/support/request                        [lakoli-main.js]  body {..., canal:"whatsapp"}
```

---

## 3. Page `/messagerie` — « Messagerie SMS »

**PageHero.** kicker `"Communication"`, titre `"Messagerie SMS"`, sous-titre `"Communiquez avec les parents par SMS — ID expéditeur LAKOLI"`.
Badge d'état à droite : `"Lakoli SMS · Actif"` si `stats.smsConfigured === true`, sinon `"SMS non configuré"` (icône `wifi-off`), suivi de `walletBalance` formaté `fr-CI` + `" SMS"`.

**7 onglets CONFIRMED** (tableau `u` du composant racine) :

| id | label | contenu |
|---|---|---|
| `campagnes` | `Campagnes` | monte `<CampagnesContent hideHeader />` (= page `/messagerie/campagnes` sans son hero) |
| `individuel` | `Message individuel` | `data-tour-id:"tour-btn-sms"` |
| `email` | `Email aux parents` | |
| `historique` | `Historique` | table paginée 25/page + export CSV |
| `listes` | `Listes` | listes de diffusion |
| `modeles` | `Modèles` | CRUD modèles SMS |
| `automatisations` | `Automatisations` | toggles SMS auto |

**Amorçage automatique (règle métier).** `useEffect` : si `templates.length === 0`, appel automatique `POST /messagerie/seed-templates` — le tenant reçoit des modèles préremplis sans action utilisateur.

### 3.1 Onglet « Message individuel »
- Recherche élève : `GET /eleves?search=…&limit=20`, activée à partir de **2 caractères** (`enabled: l.length>=2`). Placeholder `"Nom, prénom ou matricule..."`.
- Affiche pour chaque résultat le téléphone parent, sinon `"Pas de tél. parent"` en rouge.
- Fiche sélectionnée : `"Pas de téléphone parent enregistré"`.
- Modèles proposés sous forme de puces avec emoji conditionnel : `⚠️` si `categorie ∈ {relance_impaye, relance}`, `✅` si `∈ {recu_paiement, paiement}`, sinon `📩`.
- **Variables** : le contenu du modèle est scanné par `/\{(\w+)\}/g` ; `{eleve}` et `{ecole}` sont substituées automatiquement (nom de l'élève sélectionné ; `etablissement.sigle` ou `.nom`), les autres deviennent des champs de saisie libellés par la table :
  `{montant:"Montant (F CFA)", date:"Date", periode:"Période", classe:"Classe", motif:"Motif"}` ; libellé `"Compléter les variables :"`.
- Compteur : `` `${W} car. · ${Math.ceil(W/160)||1} SMS` `` — **découpage naïf à 160 caractères ici**, contrairement au calculateur des campagnes (voir §4.4).
- Envoi : `POST /messagerie/envoyer` avec `{typeDestinataires:"par_telephone", telephone, contenu}` si un numéro est connu, sinon `{typeDestinataires:"individuel", parentIds, contenu}`.
- Succès : `"SMS envoyé"` + `"Message transmis au parent de {prenoms} {nom}"` + bouton `" Nouveau message"` ; déclenche l'étape d'onboarding `currentKey:"premierSms"`, `successMessage:"SMS envoyé avec succès"`.
- Erreur spécifique : si `error === "sms_maintenance"` → `"📵 SMS temporairement indisponibles. Réessayez dans quelques instants."` sinon `"Erreur lors de l'envoi"`.

### 3.2 Composant réutilisable `BoutonSms` (exporté)
Exporté par `index-DuZBT_7c.js` sous le nom `BoutonSms` et réimporté par `index-TfNa1dpy.js` (Créances). Props : `{parentIds, nomEleve, telephone, messagePrefill, size}`.
- Message par défaut CONFIRMED :
  `"Bonjour, parent de {nomEleve}.\n\nNous vous contactons depuis l'école.\n\nCordialement, la Direction."`
- Le bouton est **désactivé** si `stats.smsConfigured === false`, avec le title : `"SMS non configuré — activez un agrégateur SMS dans Paramètres"` (⚠️ voir §11 : cette page de configuration n'existe pas dans la SPA).
- Si aucun destinataire : title `"Aucun parent enregistré"`.
- **Contrôle de format ivoirien** : si le numéro, dépouillé de ses non-chiffres, ne commence pas par `0` →
  `"Ce numéro ne commence pas par 0 — vérifiez le format ivoirien (ex : 07 12 00 16 28). Le SMS risque de ne pas être livré."`
- Analytics : `app_action_click` avec `metadata:{module:"Messagerie SMS", action:"sms_envoye"}`.

### 3.3 Onglet « Email aux parents »
- Sélecteur `"Classe (laisser vide = tous)"`, option par défaut `"Tous les parents avec email"`.
- Prévisualisation du volume : `POST /messagerie/preview-destinataires-email` avec `{typeDestinataires:"par_classe", classeIds:[id]}` ou `{typeDestinataires:"tous"}` → `{count}` affiché comme `` `${count} parent(s) avec une adresse email enregistrée` ``.
- Champs : `Objet` (placeholder `"Objet de l'email"`), `Message` (textarea 8 lignes, placeholder `"Composez votre email ici..."`).
- Envoi : `POST /messagerie/envoyer-email` `{typeDestinataires, classeIds?, objet, contenu}`.
- Bouton : `` `Envoyer l'email — ${count} destinataire(s)` `` ; désactivé si objet ou contenu vide **ou si `count === 0`**.
- Écran de fin : `"Envoi terminé"` + `` `${nombreEnvoyes} emails envoyés sur ${nombreDestinataires} destinataires` `` + `" Nouvel email"`.

### 3.4 Onglet « Historique »
- `GET /sms-logs?page={n}&limit=25`.
- Compteur : `` `${total} SMS enregistrés` `` sinon `"Aucun SMS enregistré"`.
- **Export CSV** côté client, séparateur `;`, fichier `historique-sms.csv`, en-têtes `["Destinataire","Type","Statut","Message","Date"]`, dates en `toLocaleString("fr-CI")`.
- Colonnes de table (majuscules CSS) : `DESTINATAIRE | TYPE | STATUT | MESSAGE | DATE`.
- Pagination : `"Précédent"` / `"Suivant"`, libellé `` `Page ${l} / ${o} · ${total} SMS` ``.

### 3.5 Onglet « Listes » (listes de diffusion)
- `GET /messagerie/listes` → cartes ; carte vide : `"Aucune liste de diffusion"` / `"Créez des groupes de contacts pour vos envois groupés"`.
- Création (`" Nouvelle liste"`) : titre `"Créer une liste de diffusion"`, champs `nom` (placeholder `"Nom de la liste (ex: Parents CM2)"`) et `description` (`"Description (optionnel)"`), bouton `"Créer"`.
- Détail d'une liste : `"Retour aux listes"`, `" Renommer"`, `" Supprimer"` (confirm natif `"Supprimer cette liste ?"`), compteur `` `${nombreMembres} membre(s)` ``.
- **Deux modes d'ajout de membres** :
  - `" Ajouter une classe"` → `POST /messagerie/listes/{id}/membres` body `{classeId}` (select `"Choisir une classe…"`)
  - `" Ajouter un parent"` → recherche `GET /parents?search=…&limit=20` (≥2 caractères) puis `POST …/membres` body `{parentIds:[id]}`
- Suppression membre : `DELETE /messagerie/listes/{id}/membres/{membreId}`.
- État vide membres : `"Aucun membre dans cette liste"`.

> **Constat structurel** : les listes de diffusion sont créées et peuplées, mais **aucun écran d'envoi du bundle ne cible une liste** (`typeDestinataires` n'accepte que `creances_impayees|tous_parents|par_classe` côté campagne, et `par_telephone|individuel` côté messagerie). Fonctionnalité **construite mais non branchée sur l'envoi** — INFERRED à partir de l'absence totale de `listeId` dans les payloads d'envoi du corpus.

### 3.6 Onglet « Modèles » (modèles SMS de la messagerie)
Layout maître-détail 1/4–3/4. Colonne gauche titrée `"Modèles SMS"`, bouton `" Nouveau modèle"`.
Formulaire : `"Nom du modèle"` (placeholder `"Ex: Relance impayé"`), `"Catégorie"`, `"Contenu du message"` (textarea 6 lignes, placeholder `"Texte du message... Utilisez {eleve}, {montant}, {date} pour les variables"`), aperçu bulle `"Aperçu"`.
Boutons `"Sauvegarder"` / `" Supprimer"` (confirm `"Supprimer ce modèle ?"`). État vide : `"Sélectionnez un modèle pour le modifier"` / `"ou créez-en un nouveau"`.

**Catégories (select, valeurs → libellés) :**
```
general        → Général
recu_paiement  → Reçu de paiement
relance_impaye → Relance impayée
convocation    → Convocation
bulletin       → Bulletin
absence        → Absence
rentree        → Rentrée
annonce        → Annonce
```

### 3.7 Onglet « Automatisations »
- `GET /sms-logs/auto-config` → liste `[{key,label,description,actif}]` (libellés **fournis par le serveur**, donc non extractibles du bundle).
- Toggle : `PUT /sms-logs/auto-config/{key}` body `{actif}` ; toasts `"SMS automatique activé"` / `"SMS automatique désactivé"` / `"Erreur lors de la mise à jour"`.
- En-tête : `"SMS envoyés automatiquement"` —
  > « Activez ou désactivez les SMS envoyés automatiquement par le système sans action manuelle de votre part. **Chaque toggle consomme des crédits SMS à chaque déclenchement.** »
- Encart ambre en bas :
  > « **Note :** Les SMS manuels (message individuel, campagnes, lien de paiement) ne sont pas affectés par ces paramètres. Seuls les envois déclenchés automatiquement par le système sont contrôlés ici. »

---

## 4. Page `/messagerie/campagnes` — « Campagnes SMS »

PageHero : kicker `"Communication"`, titre `"Campagnes SMS"`, sous-titre `"Composez, simulez et envoyez des campagnes de communication intelligentes."`
Badge crédit : `"Crédit :"` + solde + `" SMS"`, colorisé **rouge si ≤ 10, orange si ≤ 50, vert sinon**.

### 4.1 Deux raccourcis « 3 clics » (cartes d'action au-dessus des onglets)
1. `"Relancer les impayés"` (rouge) — badge = nombre d'élèves impayés (`GET /rapports/impayes?anneeScolaireId=…`). Sous-titre dynamique : `` `${m} parent(s) joignable(s) · campagne en 3 clics` `` sinon `"SMS de relance à tous les parents avec solde dû"`. Préremplit `defaultType = "relance_impaye"`.
2. `"Envoyer à une classe"` (bleu) — `"Information générale, événement ou message de la direction"`. Préremplit `defaultType = "info_generale"` et bascule `typeDestinataires` sur `par_classe`.

### 4.2 Les 6 onglets (tableau `Te`, CONFIRMED)
```
{id:"pretes",     label:"Prêtes",             badge = campaigns.filter(statut==="prete").length}
{id:"nouvelle",   label:"Nouvelle campagne"}   ← onglet par défaut
{id:"historique", label:"Historique"}
{id:"modeles",    label:"Modèles"}
{id:"regles",     label:"Règles"}
{id:"stats",      label:"Statistiques"}
```

### 4.3 Onglet « Nouvelle campagne » — inventaire des champs

**Bloc « Informations générales »**
| Champ | Contrôle | Détail |
|---|---|---|
| `Nom de la campagne *` | input | placeholder `"Ex: Relance mai 2025"` — **requis** (toast `"Nommez votre campagne"`) |
| `Type de message` | select | 10 valeurs (§7.2) |
| `Modèle` | boutons-puces | filtrés par catégorie compatible ; masqué si ≤ 1 candidat |

Mapping type → catégories de modèles proposées (objet `n`, CONFIRMED) :
```
relance_impaye   → ["relance_impaye","relance","paiement"]
info_generale    → ["annonce"]
convocation      → ["convocation"]
evenement        → ["annonce"]
resultat_scolaire→ ["bulletin"]
reinscription    → ["annonce"]
absence          → ["absence"]
autre            → ["custom"]
```

**Bloc « Destinataires »**
| Champ | Options |
|---|---|
| `Sélection` | `creances_impayees` → « Créances impayées uniquement » · `tous_parents` → « Tous les parents » · `par_classe` → « Par classe(s) » |
| `Classes` | select **multiple**, hauteur `h-24`, visible seulement si `par_classe` |

Encart bleu affiché quand `creances_impayees` — **règle métier majeure** :
> « Seuls les parents avec des créances non réglées seront contactés. **Les parents ayant effectué un paiement dans les 24 dernières heures sont automatiquement exclus.** »

**Bloc « Rédiger le message »**
- textarea 5 lignes, placeholder `"Rédigez votre message... Utilisez les variables ci-dessous pour personnaliser."`
- Encart ambre `"Conseil :"` — **règle de coût** :
  > « Évitez les accents et caractères spéciaux (é, è, à, ê...) dans vos messages. Un seul caractère accentué fait passer le SMS en encodage Unicode et **multiplie le coût par 2 à 3** (70 caractères max au lieu de 160). Préférez *ete* plutôt que *été*, *ecole* plutôt que *école*. »
- `"Insérer une variable :"` — 9 jetons cliquables (§7.5).
- Bouton `"Simuler et prévisualiser"` (le seul chemin d'envoi : **on ne peut pas envoyer sans simuler d'abord**).

**Panneau latéral collant** : titre `"Estimation des crédits"` puis `"Simulation"` après simulation. Avant simulation :
> « Lancez la simulation pour connaître le nombre exact de destinataires et le coût en crédits. »

### 4.4 Calculateur de crédits SMS (fonction `S`) — **algorithme exact, CONFIRMED**
```js
function S(i){ const l=/[^\x00-\xFF]/.test(i), d=l?70:160, x=l?67:153;
               return i ? (i.length<=d ? 1 : Math.ceil(i.length/x)) : 0 }
```
- Détection Unicode = présence d'un caractère hors Latin-1 (`> 0xFF`). **Attention : les accents français é/è/à sont dans Latin-1 (≤ 0xFF) et ne déclenchent donc PAS le mode 70 caractères dans ce calcul** — le conseil UI et le calculateur sont désynchronisés. (**INFERRED** — écart entre la copie « un seul caractère accentué… 70 caractères » et le prédicat `[^\x00-\xFF]`.)
- Barre de progression avec seuils affichés : `1 crédit` / `160` / `306` / `459` (ou `70` / `140` / `201` en mode Unicode). Couleur : vert ≤ 160, jaune ≤ 306, orange ≤ 459, rouge au-delà.
- Lignes du panneau : `Destinataires estimés`, `Crédits nécessaires`, `Crédit disponible`, `Après envoi` (rouge si négatif).
- Avertissements conditionnels :
  - ≥ 2 crédits : « Ce message utilise **{r} crédits** par parent. » + `` ` En le raccourcissant, vous pourriez économiser ${(r-1)*l} crédits.` ``
  - Unicode : « Message avec caractères accentués — limite réduite à 70 chars/crédit. »
  - Solde négatif : « Solde insuffisant. Rechargez votre Crédit Communication avant l'envoi. »

### 4.5 Résultat de simulation (`POST /communication/campaigns/{id}/simulate`)
Champs de réponse exploités : `nombreDestinataires`, `nombreEleves`, `nombreFusionnes`, `nombreInvalides`, `nbPaiementRecent`, `creditsEstimes`, `soldeActuel`, `soldeApresEnvoi`, `soldeInsuffisant`, `destinataires[].{nomParent,messageFinal,credits}`.

Tuiles : `Éligibles` (vert), `Élèves` (bleu), `Fusionnés` (violet, si > 0), `Invalides` (rouge, si > 0).
Ligne violette : `` `${nombreFusionnes} SMS économisés grâce au regroupement.` `` → **déduplication par parent multi-enfants**.
Si 0 destinataire : toast `"Aucun destinataire"` / `"Ajustez vos filtres."`.

### 4.6 Modale « Aperçu avant envoi »
Titre `" Aperçu avant envoi"`. Lignes label/valeur :
```
Type · Parents concernés · Élèves concernés · Messages fusionnés · Numéros invalides ·
Paiements récents exclus            ← confirme l'exclusion J-1
--- séparateur ---
Crédits nécessaires · Crédit disponible · Crédit restant après envoi
```
Bloc aperçu : `"Aperçu du 1er message envoyé"` + `"→ {nomParent}"` avec le `messageFinal` réellement personnalisé ; à défaut `"Aperçu du message (modèle)"`.
Boutons : `"Modifier"` / `"Confirmer l'envoi"`.
**Garde-fou dur : le bouton d'envoi est `disabled` si `soldeInsuffisant`** — l'envoi est impossible en solde négatif.
Bandeau rouge : « Solde insuffisant. Rechargez votre Crédit Communication avant d'envoyer. »
Succès : `"Envoi lancé ✓"` + `` `${nbDestinataires} SMS en cours d'envoi. La liste se met à jour automatiquement.` ``

### 4.7 Onglet « Prêtes » (file de validation)
Filtre `statut === "prete"`. État vide :
> `"Aucune campagne en attente de validation"` / `"Les campagnes semi-automatiques préparées apparaîtront ici."`

Chaque carte : nom, badge type, `` `${nombreDestinataires} parents` ``, `` `${creditsEstimes} crédits` ``, `` `${nombreFusionnes} fusionnés` ``.
Actions : `"Annuler"` (`POST …/cancel`) et `"Envoyer"` (`POST …/send`).
Toast d'envoi : `"Campagne envoyée ✓"` ou, si la réponse porte `demo:true`, **`"Campagne simulée ✓"`** → mode démo côté serveur, aucun SMS réel.

### 4.8 Onglet « Historique »
Recherche libre `"Rechercher une campagne..."` (filtre client sur nom + libellé de type).
Colonnes : `CAMPAGNE | TYPE | ENVOYÉS | CRÉDITS | STATUT | DATE`.
Cellule Envoyés = `` `${nombreEnvoyes ?? 0} / ${nombreDestinataires ?? 0}` ``. Date = `dateEnvoiEffective` sinon `createdAt`, `toLocaleDateString("fr-CI")`. Vide : `"Aucune campagne"`.

### 4.9 Onglet « Modèles » (modèles de campagne — distincts de ceux de la messagerie)
Groupés par catégorie (titre = libellé de catégorie en majuscules). Carte : nom, contenu en `font-mono` tronqué à 3 lignes, `` `${length} chars` `` + `` `${S(contenu)} crédit(s)` ``.
Modale : `"Nouveau modèle"` / `"Modifier le modèle"` — champs `Nom *`, `Catégorie`, `Message *`, compteur `` `${n} caractères · ${S} crédit(s) / destinataire` ``, jetons variables insérables, boutons `"Annuler"` / `"Enregistrer"` (désactivé si nom ou contenu vide).
Vide : `"Aucun modèle de message. Créez votre premier modèle."`

### 4.10 Onglet « Règles » — moteur d'automatisation
Intro CONFIRMED :
> « Configurez les automatisations — les campagnes seront préparées selon ces règles et apparaîtront dans l'onglet **Prêtes**. »

Carte règle : nom + badge `"Auto"` (rouge) ou `"Semi-auto"` (bleu), libellé de l'événement, et si `delaiJours ≠ 0` :
`` `${delaiJours>0 ? "+"+delaiJours+"j après" : Math.abs(delaiJours)+"j avant"} l'événement · ${heureEnvoi}` ``.
Actions : toggle actif/inactif (`PUT /communication/rules/{id}` body `{actif}` seul), édition, suppression. Règle inactive = bordure pointillée + opacité 60 %.
Vide : `"Aucune règle d'automatisation. Créez votre première règle."`

**Modale « Nouvelle règle » / « Modifier la règle » — champs :**
| Champ | Type | Défaut | Détail |
|---|---|---|---|
| `Nom *` | input | `""` | requis |
| `Événement déclencheur` | select à `optgroup` | `relance_mensuelle` | 2 groupes / 16 événements (§7.6) |
| `Mode` | select | `semi_auto` | `"Semi-automatique (validation requise)"` / `"Automatique (envoi direct)"` |
| `Délai (jours)` | number | `0` | aide : `"Positif = après. Négatif = avant l'événement."` |
| `Heure d'envoi` | time | `"08:00"` | |
| `Modèle de message` | select | `""` | option vide : `"— Aucun modèle (message manuel) —"` |
| `actif` | bool | `true` | non exposé dans la modale (seulement via toggle) |

Avertissement affiché si `mode === "automatique"` :
> « ⚠ **Les SMS partiront sans validation manuelle.** »

Payload : `templateId` converti en `Number` ou `null`. Champ `type` initialisé à `"paiement"` mais **jamais éditable dans l'UI** (dette).

### 4.11 Onglet « Statistiques » (`GET /communication/stats`)
6 KPI CONFIRMED :
```
Crédit disponible      (soldeActuel)            sous-titre "SMS restants"
Campagnes ce mois      (campagnesEnvoyees)      "campagnes envoyées"
SMS envoyés ce mois    (messagesEnvoyesMonth)   "messages transmis"
Crédits consommés      (creditsConsommesMonth)  "ce mois"
Crédits économisés     (creditsEconomises)      "grâce au regroupement"
Messages fusionnés     (messagesFusionnes)      "SMS économisés"
```
Bandeau bleu si `enAttenteValidation > 0` : `` `${n} campagne(s) en attente de validation dans l'onglet Prêtes.` ``

---

## 5. Page `/credit-communication` — « Crédit Communication »

PageHero : kicker `"Communication"`, titre `"Crédit Communication"`, sous-titre `"Gérez votre solde SMS Lakoli — rechargez en ligne en quelques clics"`, badge `"Lakoli SMS · ID expéditeur LAKOLI"`.

**Carte solde** (`data-tour-id:"ptour-credit-solde"`) : `"Crédit SMS disponible"` en `text-5xl`, sous-titre `"SMS restants"`.
Seuils CONFIRMED : `critique = balanceSms <= 10`, `bas = 0 < balanceSms <= 50`.
- solde = 0 : « **Solde épuisé — les SMS sont actuellement bloqués. Rechargez votre compte.** »
- 0 < solde ≤ 10 : « Solde critique — rechargez bientôt pour ne pas interrompre les notifications. »
- 10 < solde ≤ 50 : « Solde bas — nous vous recommandons de recharger avant d'atteindre 0. »
Métriques secondaires : `Ce mois` (`usedThisMonth`), `Total utilisé` (`totalUsedSms`), `Offerts` (`freeSmsGranted`, si > 0).

**Packs de recharge** (`data-tour-id:"ptour-credit-packs"`, `GET /sms-wallet/packages`) :
- Champs de pack : `{id, nom, smsInclus, prixFcfa, ordre}`.
- Le pack d'`ordre === 3` porte le badge `"Recommandé"` (violet).
- Prix formaté `fr-CI` + `" FCFA"`, et prix unitaire `` `≈ ${Math.round(prixFcfa/smsInclus)} FCFA / SMS` ``.
- **Pack à `smsInclus <= 0`** : libellé `"Disponible prochainement"` et bouton grisé `"Bientôt disponible"` → mécanisme de *coming soon* piloté par la donnée.
- Vide : `"Aucun pack disponible pour le moment"` / `"Contactez le support Lakoli pour configurer vos packs."`
- Note sous les packs : « Paiement Mobile Money sécurisé — votre solde est crédité immédiatement après confirmation. Pour des besoins spécifiques ou un devis personnalisé, contactez le support Lakoli. »

**Flux de recharge (CONFIRMED).**
1. `POST /sms-wallet/recharge {packageId}`.
2. Si la réponse porte `demo:true` → message `` `Recharge simulée — ${smsInclus} SMS ajoutés. Nouveau solde : ${newBalance} SMS.` ``, mise à jour optimiste du cache, **aucune redirection**.
3. Sinon redirection `window.location.href = paymentUrl`.
4. Au retour, le paramètre d'URL `?ref=` déclenche `GET /sms-wallet/recharge/verify?reference=…` :
   - `already:true` → « Ce paiement a déjà été crédité sur votre compte. » (idempotence)
   - succès → `` `✓ Recharge réussie — ${smsInclus} SMS ajoutés. Nouveau solde : ${newBalance} SMS.` ``
   - échec → `` `Paiement reçu mais crédit non appliqué : ${err}. Il sera appliqué automatiquement dans quelques minutes.` `` → **réconciliation asynchrone côté serveur**
   - pendant la vérif : « Vérification du paiement en cours… »

**Table « Derniers mouvements »** — colonnes `TYPE | QUANTITÉ | SOLDE APRÈS | DESCRIPTION | DATE`.
Champs : `type, quantity, balance_after, description, created_at` (snake_case, contrairement au reste de l'API).
Si ≥ 5 mouvements : lien `"Voir l'historique SMS complet →"` vers `/sms-logs`.

**Encart de bas de page — règles de facturation CONFIRMED :**
> « **ID expéditeur :** LAKOLI — visible par tous les parents qui reçoivent vos SMS. »
> « **Les SMS non envoyés en cas de solde insuffisant ne sont pas débités.** Chaque SMS de plus de 160 caractères (ou 70 pour les messages accentués) compte comme plusieurs segments. »

---

## 6. Page `/sms-logs` — « Journal SMS »

PageHero : kicker `"Communication"`, titre `"Journal SMS"`, sous-titre `"Historique des messages transactionnels"`.
Intro : « Tous les messages transactionnels enregistrés par l'application. »

Actions d'en-tête : lien `"Crédit Communication"` (→ `/credit-communication`) et bouton `"Relancer les impayés"` → `POST /sms-logs/relance` avec `alert()` natif `` `${envoye} SMS de relance envoyé(s) avec succès` ``.

**Bandeau d'échecs** (si `echoue + solde_insuffisant > 0`) :
`` `${n} SMS en échec détecté(s)` `` puis détail `` `${a} erreur(s) d'envoi` `` · `` `${r} bloqué(s) — solde insuffisant` `` + lien `"Recharger →"`.

4 KPI : `Total SMS`, `Envoyés / Livrés`, `Simulés (dev)`, `Échecs`.
Bloc `"Répartition par type"` (`stats.byType[] = {type,count}`).
Table paginée 20/page, colonnes `DESTINATAIRE | TYPE | STATUT | MESSAGE | DATE`. Boutons `"← Préc"` / `"Suiv →"`, libellé `` `Page ${l}` ``, total `` `${m} SMS total` ``.

> **Divergence de libellé confirmée** : le statut `envoye` est rendu `"Transmis à l'opérateur"` dans `/sms-logs` mais `"Envoyé"` dans l'onglet Historique de `/messagerie`. Deux tables de libellés distinctes coexistent (`R` dans `index-CpPdJatZ.js`, `X` dans `index-DuZBT_7c.js`).

**Cloche de notification globale** (`lakoli-main.js`, présente dans le header de toute l'app) :
- `GET /sms-logs/echecs-recents`, `refetchInterval: 60 000 ms`.
- Titre du panneau : `"Échecs d'envoi SMS"` / sous-titre `"7 derniers jours"`.
- Badge = nombre d'items d'`id` supérieur au dernier vu, mémorisé dans `localStorage["lakoli_sms_echecs_last_seen_id"]`, affiché `"9+"` au-delà de 9.
- Chip par ligne : `"Crédit SMS insuffisant"` (ambre) si `statut === "solde_insuffisant"`, sinon `"Échoué"` (rouge).
- Vide : `"Aucun échec récent"`. Pied : `"Voir l'historique complet"` → `/sms-logs`.

---

## 7. Énumérations et référentiels (tous CONFIRMED, verbatim)

### 7.1 Statut de campagne (`ee`, `campagnes-DN7uPtL8.js`)
```
brouillon              → "Brouillon"       (zinc)
prete                  → "Prête"           (bleu)
programmee             → "Programmée"      (violet)
envoyee                → "Envoyée"         (vert)
partiellement_envoyee  → "Partiel"         (ambre)
echouee                → "Échouée"         (rouge)
annulee                → "Annulée"         (zinc)
simulee                → "Simulée (démo)"  (ciel)
```

### 7.2 Type de campagne (`P`)
```
relance_impaye → "Relance impayé"        recu_paiement → "Reçu de paiement"
absence        → "Absence"               convocation   → "Convocation"
bulletin       → "Bulletin disponible"   info_generale → "Information générale"
evenement      → "Événement"             rentree       → "Rentrée scolaire"
reunion        → "Réunion parents"       personnalise  → "Message personnalisé"
```

### 7.3 Catégorie de modèle de campagne (`te`)
```
relance_impaye → "Relance impayé"   recu_paiement → "Reçu"        absence     → "Absence"
convocation    → "Convocation"      bulletin      → "Bulletin"    info_generale → "Information"
evenement      → "Événement"        rentree       → "Rentrée"     reunion     → "Réunion"
custom         → "Personnalisé"
```

### 7.4 Statut / type de SMS journalisé
```
STATUT : envoye→"Envoyé" (ou "Transmis à l'opérateur") · livre→"Livré" · echoue→"Échoué" ·
         simule→"Simulé" · en_attente→"En attente" · solde_insuffisant→"Solde insuffisant"
TYPE   : confirmation_paiement→"Confirmation paiement" · recu_paiement→"Reçu paiement" ·
         relance_impayes→"Relance impayés" · bienvenue→"Bienvenue" · alerte_fraude→"Alerte fraude" ·
         inscription_validee→"Inscription validée" · reinscription_validee→"Réinscription validée" ·
         reinitialisation_mdp→"Réinit. MDP" / "Réinitialisation MDP" · echeance_proche→"Échéance proche" ·
         lien_paiement→"Lien paiement" · autre→"Autre"
```
(Le fragment SMS de la fiche élève utilise en plus une mini-table `{lien_paiement, relance_impayes, inscription}` et les statuts `envoye|en_attente|echec` — **troisième** table de libellés, `echec` ≠ `echoue`.)

### 7.5 Variables de personnalisation SMS (campagnes) — 9 jetons
```
{nom_ecole}→"Nom école"     {nom_parent}→"Nom parent"   {nom_eleve}→"Nom élève"
{classe}→"Classe"           {montant}→"Montant"         {date_echeance}→"Date échéance"
{lien_portail}→"Lien portail"  {solde_restant}→"Solde restant"  {periode}→"Période"
```

### 7.6 Événements déclencheurs de règle (`se`) — 2 groupes, 16 événements
**Groupe « Paiements »**
```
ouverture_periode      → "Ouverture de période de paiement"
rappel_avant_echeance  → "Rappel avant échéance (J-X)"
rappel_echeance        → "Rappel le jour de l'échéance"
rappel_3j              → "Rappel 3 jours après échéance"
rappel_7j              → "Rappel 7 jours après échéance"
rappel_15j             → "Rappel 15 jours après échéance"
relance_mensuelle      → "Relance mensuelle des impayés"
recu_automatique       → "Reçu de paiement automatique"
paiement_partiel       → "Confirmation de paiement partiel"
```
**Groupe « Scolarité »**
```
bulletin_disponible    → "Bulletin disponible"
absence_enregistree    → "Absence enregistrée"
convocation            → "Convocation"
reunion_parents        → "Réunion parents-professeurs"
info_rentree           → "Information de rentrée"
rappel_evenement       → "Rappel d'événement scolaire"
message_direction      → "Message général de la direction"
```

### 7.7 Types de transaction du wallet SMS (`B`, `index-C62rUqbA.js`)
```
WELCOME_BONUS     → "Bonus bienvenue"   (violet)
RECHARGE          → "Recharge"          (émeraude)
SMS_SENT          → "SMS envoyé"        (ardoise)
MANUAL_ADJUSTMENT → "Ajustement"        (ambre)
REFUND            → "Remboursement"     (bleu)
CORRECTION        → "Correction"        (orange)
```

### 7.8 Statuts du dossier de préinscription portail (`k` / `u`) — 7 valeurs
```
preinscription_creee → "Nouveau"          (bleu)
dossier_incomplet    → "Incomplet"        (orange)
dossier_complet      → "Dossier validé"   (violet)
paiement_demande     → "Paiement demandé" (ambre)
paiement_recu        → "Paiement reçu"    (sarcelle)
validee              → "Inscrit(e)"       (vert)
annulee              → "Refusé"           (rouge)
```

### 7.9 Types de communication tracée (`/relances`, fiche élève)
```
appel→"Appel" 📞 · sms→"SMS" 📱 · email→"Email" ✉️ · courrier→"Courrier" 📮 ·
rencontre→"Rencontre" 🤝 · paystack→"Lien paiement" 🔗 · whatsapp→"WhatsApp" 💬
```
Le `<select>` de saisie propose : `"Appel téléphonique"`, `"SMS"`, `"Email"`, `"Courrier"`, `"Rencontre / visite"`, `"Lien de paiement"` — **`whatsapp` est rendu mais pas saisissable manuellement** (créé par le système).

### 7.10 Types de bannière système (`/api/system-banners`)
`info` · `warning` · `error` · `maintenance` · **`sms`** (orange) · `success` — dismiss persisté en `sessionStorage["sb_dismissed_v1"]`.

### 7.11 Services souscriptibles au portail (`D`, `parametres-KQTq47NY.js`)
```
cantine→"Cantine" · transport→"Transport scolaire" · internat→"Internat" · garderie→"Garderie"
```

### 7.12 Auteur d'un message de dossier portail
`ecole` (avatar « É », bulle alignée à droite) · `parent` (avatar « P », bulle à gauche).

---

## 8. Page `/whatsapp` — « WhatsApp Parents » (chunk `index-B59sXdjb.js`)

> **La page la plus manquée par un audit UI superficiel** : le nom de chunk ne contient pas « whatsapp », et le module n'apparaît qu'après filtrage des rôles. C'est pourtant un module complet de 30 Ko.

PageHero : kicker `"Communication"`, titre `"WhatsApp Parents"`, sous-titre `"Contactez les parents directement via WhatsApp — aucune configuration requise"`, badge `"Ouvre WhatsApp directement"`.

Encart « Fonctionnement » — **modèle économique CONFIRMED** :
> « Chaque bouton "WhatsApp" ouvre l'application WhatsApp (ou WhatsApp Web sur ordinateur) avec le message pré-rempli. Vous envoyez en un clic — depuis le compte WhatsApp de votre téléphone ou ordinateur. **Aucune API, aucune clé, aucun abonnement requis.** »

→ WhatsApp est un canal **100 % gratuit et manuel** (deep-links `wa.me`), à l'inverse du SMS qui consomme du wallet. Le libellé de menu « Crédit SMS & WhatsApp » est donc trompeur : **le crédit ne couvre que le SMS**.

**4 onglets CONFIRMED :** `individuel` → `"Message individuel"` · `groupe` → `"Envoi groupé"` · `relances` → `"Relances impayés"` · `modeles` → `"Modèles réinscription"`.

### 8.1 Normalisation de numéro et construction du lien (`lakoli-main.js`)
```js
function Q5(e){ const n=e.replace(/[\s\-\.\(\)+]/g,"");
  return n.startsWith("00225") ? n.replace("00225","225")
       : (n.startsWith("0")&&n.length===10)||n.length===10 ? "225"+n
       : n.length===8 ? "2250"+n
       : n.startsWith("225")&&n.length===13 ? n
       : n.startsWith("225")&&n.length===12 ? "2250"+n.slice(3) : n }
function Rw(e,n){ return `https://wa.me/${Q5(e)}?text=${encodeURIComponent(ms(n))}` }
```
`ms()` = *sanitizer* : supprime U+FFFD, normalise apostrophes/guillemets typographiques, NBSP → espace, soft-hyphen supprimé, tirets longs → `-`, `…` → `...`, retire les caractères de contrôle, normalise CRLF → LF, `trim()`. → **assainissement anti-Unicode déjà appliqué côté WhatsApp mais PAS côté SMS.**

Si le contact n'a pas de numéro : `alert("Ce contact n'a pas de numéro de téléphone enregistré.")`.

### 8.2 Onglet « Message individuel »
- Recherche : `GET /eleves?search=…&limit=20` (≥ 2 caractères), placeholder `"Nom, prénom ou téléphone..."`.
- Le numéro normalisé est affiché avec `+` en préfixe.
- Champs conditionnels selon le modèle sélectionné :
  - `convocation` → `Date`, `Heure`, `Motif` (placeholder `"Ex: réunion parents-professeurs"`)
  - `bulletin` → `Période d'évaluation` (placeholder `"Ex: 1er Trimestre"`)
  - `rentree` → `Date de rentrée`
  - `relance_impaye` → `Nom de l'élève`, `Montant (FCFA)` (placeholder `50000`)
- Aperçu façon WhatsApp : fond `#ECE5DD`, bulle blanche, horodatage + `✓✓`.
- Astuce : `"*texte* = gras dans WhatsApp"`.

### 8.3 Onglet « Envoi groupé »
- Filtre `"Classe (laisser vide = tous)"` → option `"Tous les contacts"`.
  - Avec classe : `GET /eleves?classeId={id}&limit=200`
  - Sans classe : `GET /parents?limit=500&niveauInterface={niveau}`
- Compteurs : `` `${n} avec tél.` `` (vert) et `` `${n} sans tél.` `` (rouge).
- Zone `"Message groupé"` + `` `${n} contact(s) joignables` `` ; hint `"Cliquez sur chaque bouton pour ouvrir WhatsApp"`.
- Message par défaut si le champ est vide (mode classe) :
  `"Bonjour cher parent de *{eleve}*,\n\nMessage de l'école.\n\nCordialement."`
- Bandeau orange listant jusqu'à 5 contacts sans numéro puis `` ` et ${n-5} autres` ``.

### 8.4 Onglet « Relances impayés »
- Source : `GET /rapports/impayes?anneeScolaireId=…&niveauInterface=…`.
- Compteurs : `` `${n} impayé(s)` `` (rouge) et `` `${n} joignables` `` (vert WhatsApp).
- **Mode séquentiel** : bouton `` `Relancer séquentiellement (${n})` `` puis panneau `` `Relance ${i+1} / ${n}` `` avec bouton `"Arrêter"`, montant impayé affiché en FCFA.
- Le message est généré par le modèle `relance_impaye` avec `{eleve, montant, ecole}`.

### 8.5 Onglet « Modèles réinscription » — éditeur de templates persisté en `localStorage`
Clé : `"agora_wa_templates_reinscription"`. Boutons `" Réinitialiser"` et `"Sauvegarder"` → `"Sauvegardé !"`.
Variables insérables au clic, aperçu `"Aperçu du message"` `"(avec données d'exemple)"` + `` `Données exemple : {k} = "v", …` ``.

> **Risque produit** : ces modèles sont stockés **uniquement dans le navigateur** (pas d'appel API) → non partagés entre utilisateurs, perdus au nettoyage du cache. Le préfixe `agora_` trahit un ancien nom de produit.

### 8.6 Catalogue de modèles WhatsApp de réinscription (`Mo`, `lakoli-main.js`) — 4 modèles
| id | nom | description | variables |
|---|---|---|---|
| `reinscription_relance` | `Réinscription à confirmer` | `Premier contact pour demander confirmation de réinscription` | nomEleve, classe, ecole |
| `reinscription_lien_paiement` | `Lien de paiement` | `Envoi du lien de paiement après confirmation` | nomEleve, classe, montant, lienPaiement, ecole |
| `reinscription_paiement_recu` | `Paiement recu` | `Confirmation de reception du paiement` | nomEleve, montant, ecole |
| `reinscription_relance_generale` | `Relance generale` | `Rappel général en cours de campagne de réinscription` | nomEleve, ecole |

Texte intégral du modèle `reinscription_lien_paiement` (CONFIRMED, **sans accents — volontaire**) :
```
Bonjour Monsieur/Madame,

La reinscription de votre enfant {nomEleve} en classe de {classe} a ete enregistree.

Montant de l'avance : {montant} FCFA

Vous pouvez effectuer votre paiement en cliquant sur le lien suivant :

{lienPaiement}

Un recu vous sera transmis apres validation du paiement.

Merci de votre confiance.

Administration {ecole}
```

### 8.7 Catalogue de messages WhatsApp rapides (`e8`, `lakoli-main.js`) — 7 modèles
```
relance_impaye       💰 "Relance impayé"        → montant, ecole
confirmation_paiement ✅ "Confirmation paiement" → montant, reference?, ecole
absence              📅 "Signalement absence"   → eleve, date, ecole
convocation          📋 "Convocation"           → date, heure, motif, ecole
bulletin             📊 "Bulletin disponible"   → periode, ecole
rentree              🎒 "Annonce rentrée"       → date, ecole
libre                ✏️ "Message libre"         → (message vide)
```
Exemple verbatim (`relance_impaye`) :
> « Bonjour Monsieur/Madame,\n\nNous vous informons qu'un solde de {montant} FCFA reste du pour l'annee scolaire en cours.\n\nMerci de regulariser cette situation au secretariat dans les meilleurs delais.\n\nAdministration {ecole} »

### 8.8 Modèle « collège » codé en dur (`XL`, `lakoli-main.js`)
Un modèle WhatsApp **spécifique à un client** est embarqué dans le bundle de production :
> « Votre enfant {nomEleve} termine actuellement son cycle primaire a **GSSV**. […] le **College Source Vision** ouvrira ses portes a la prochaine rentree scolaire. […] les familles de GSSV beneficieront d'une priorite d'inscription pour l'entree en classe de 6eme. […] Administration GSSV / College Source Vision »

→ **Fuite de personnalisation mono-tenant dans un SaaS multi-tenant.** Appelé via `onWhatsAppCollege` dans le module Réinscriptions.

---

## 9. Portail Parent (`/portail-parent`) — deux espaces distincts

Titre de page `"Portail Parent"`, 2 onglets : `"Préinscriptions"` et `"Espace Parent"` (`data-tour-id:"ptour-portail-tabs"`).

### 9.1 État « non activé » (composant `F`)
Titre : `"Portail de préinscription"`. Argumentaire :
> « Offrez aux familles un espace en ligne pour soumettre les dossiers de préinscription de leurs enfants — sans avoir à se déplacer. Vous gérez tout depuis cet espace. »

3 bénéfices :
```
"Formulaire en ligne"  — "Les parents remplissent le dossier depuis leur téléphone"
"Suivi en temps réel"  — "Recevez et traitez les candidatures à votre rythme"
"Conversion facile"    — "Un clic pour transformer un candidat en élève inscrit"
```
CTA `"Activer le Portail de préinscription"` (`data-tour-id:"ptour-portail-activate"`) → `POST /portail-config {anneeScolaireId}`. Erreur : `"Erreur lors de l'activation. Réessayez."`

### 9.2 État activé (composant `O`)
- Lien public construit côté client : `` `https://${window.location.host}/portail-parent/ecole/${config.slug_public}` `` ; badge `"Ouvert"` / `"Fermé"` selon `config.actif` ; actions Copier / Ouvrir ; toast `"Lien copié !"`.
- 4 KPI cliquables (`GET /preinscriptions-portail/stats`) :
```
"Cette semaine"             → cette_semaine  → /portail-parent/preinscriptions
"En attente de traitement"  → en_attente     → ?statut=preinscription_creee
"Dossiers validés"          → valides        → ?statut=dossier_complet
"Inscriptions confirmées"   → confirmes      → ?statut=validee
```
- Alerte ambre si `messages_non_lus > 0` : `` `${n} message(s) non lu(s)` `` + « Des parents ont envoyé des messages sur leurs dossiers » + bouton `"Voir"`.
- Accès rapide : `"Gérer les dossiers"` (badge `` `+${cette_semaine} cette semaine` ``) et `"Paramètres du portail"` — *« Message d'accueil, classes ouvertes, documents requis… »*.

### 9.3 Onglet « Espace Parent » (composant `K`)
Encart bleu — **règle d'accès CONFIRMED** :
> « **Espace personnel des parents d'élèves inscrits.** Cet espace est réservé aux parents dont l'enfant est **déjà inscrit** dans l'école. Le parent entre son numéro de téléphone, reçoit un **code SMS**, et accède à ses bulletins, ses frais scolaires et ses paiements en ligne. »

Lien : `` `https://${host}/portail-parent/` `` ; CTA `"Ouvrir l'espace parent →"`.
Bloc `"Quand utiliser ce lien ?"` — 3 cas d'usage :
```
📲 "En début d'année"        — "Envoyez le lien par SMS à tous les parents pour qu'ils activent leur accès"
📞 "Assistance téléphonique" — "Un parent appelle pour un paiement — ouvrez l'espace pour le guider à voix haute"
💳 "Relance de paiement"     — "Partagez le lien dans vos messages de rappel de frais scolaires"
```

**Impersonation staff (CONFIRMED, `detail-6Bu9thd6.js`).** Depuis la fiche élève : `POST /portail/staff-access {eleveId}` → `{token}`, puis ouverture de `` `${origin}/portail-parent/?staff_token=${token}` ``. Erreur : `"Impossible d'ouvrir le portail"` / `"Aucun parent lié à cet élève."` → un agent peut voir l'espace parent sans OTP.

---

## 10. `/portail-parent/parametres` — configuration du portail (`PATCH /portail-config`)

Titre `"Paramètres du portail"`, sous-titre `"Configurez votre espace parent en ligne"`, bouton `"Enregistrer"` → `"Enregistrement…"`, toasts `"Paramètres enregistrés"` / `"Erreur lors de l'enregistrement"`.
État non activé : `"Le portail n'est pas encore activé."` + `"← Activer le portail"`.

**Formulaire complet (13 champs, 6 sections) — snake_case côté API :**

| Section | Champ | Type | Défaut | Libellé / placeholder |
|---|---|---|---|---|
| **Activation** | `actif` | toggle | `true` | `"Portail ouvert aux inscriptions"` / `"Désactivez pour suspendre temporairement les nouvelles demandes"` → `"Ouvert"` / `"Fermé"` |
| | `date_ouverture` | date | `""`→`null` | `"Ouverture des inscriptions"` |
| | `date_fermeture` | date | `""`→`null` | `"Fermeture des inscriptions"` |
| **Messages** | `message_accueil` | textarea 3 | `""` | `"Message d'accueil"` — *« Affiché sur la page d'accueil du portail »* — placeholder : `"Ex : Bienvenue sur le portail de préinscription de notre établissement. Remplissez le formulaire en ligne…"` |
| | `message_confirmation` | textarea 3 | `""` | `"Message de confirmation"` — *« Envoyé au parent après soumission du dossier »* — placeholder : `"Ex : Votre dossier a bien été reçu. Nous vous contacterons dans les 48h."` |
| **Classes ouvertes** | `classes_ouvertes` | multi-toggle | `[]` | source `GET /classes?all=1` |
| **Documents requis** | `documents_demandes` | checkbox | `[]` | 6 valeurs figées (voir ci-dessous) |
| **Services proposés** | `services_actifs` | multi-toggle | `[]` | cantine / transport / internat / garderie |
| **Affichage** | `afficher_frais` | toggle | `false` | `"Afficher les frais de scolarité"` / `"Montrer les tarifs sur la page du portail"` → `"Affiché"` / `"Masqué"` |
| **Contact** | `telephone_contact` | tel | `""` | placeholder `"+225 07 00 00 00 00"` |
| | `whatsapp_contact` | tel | `""` | placeholder `"+225 07 00 00 00 00"` |
| | `email_contact` | email | `""` | placeholder `"contact@ecole.ci"` |
| (non exposé) | `couleur_primaire` | — | `"#2563eb"` | **présent dans le state et envoyé au PATCH mais aucun contrôle UI ne le modifie** |

**Règle métier CONFIRMED (classes ouvertes) :**
> « Sélectionnez les classes pour lesquelles accepter des candidatures. **Si aucune n'est sélectionnée, toutes les classes sont disponibles.** »

**Liste figée des documents (`L`) — 6 valeurs, stockées en clair (libellé = valeur) :**
```
"Extrait de naissance"
"Bulletin de notes (dernière année)"
"Photo d'identité"
"Carnet de santé / Carnet de vaccination"
"Photocopie CNI parent"
"Attestation de scolarité précédente"
```
Aides : *« Documents que les parents doivent fournir lors de la soumission du dossier. »* / *« Services additionnels que les familles peuvent souscrire lors de la préinscription. »*

---

## 11. Dossiers de préinscription portail — liste + détail (workflow)

### 11.1 Liste `/portail-parent/preinscriptions` (`preinscriptions-B3gu9n4h.js`)
- `GET /preinscriptions-portail?statut=&classeId=&depuis=`, `staleTime 30 000`.
- Titre `"Dossiers de préinscription"`, compteur `` `${n} dossier(s)` `` + `` ` — ${labelStatut}` `` ou `" reçus via le portail"`.
- **Chips de filtre par statut** avec compteur calculé côté client : `` `Tous (${n})` `` puis un chip par statut (masqué si compteur 0 et non sélectionné).
- Recherche client : `"Rechercher par nom, téléphone, numéro…"` (nom+prénoms, `telephone_parent`, `dossier_number`).
- Filtres : select `"Toutes les classes"`, date `"Depuis"` (+ bouton `✕` `"Effacer filtre date"`).
- Colonnes desktop : `ENFANT | CLASSE | TÉLÉPHONE | STATUT | DÉPOSÉ LE | (Ouvrir)`. Vue mobile en cartes.
- Vide : `"Aucun dossier trouvé"` + `"Essayez de modifier vos filtres"` / `"Les préinscriptions soumises via le portail apparaîtront ici"`.

### 11.2 Détail `/portail-parent/dossier/:id` (`dossier-Bl9jo0fs.js`)

**Machine à états CONFIRMED (`ae`)** — actions autorisées par statut courant :
```
preinscription_creee → "Marquer incomplet"(dossier_incomplet, warn) ·
                        "Valider le dossier"(dossier_complet, success) · "Refuser"(annulee, danger)
dossier_incomplet    → "Valider le dossier" · "Refuser"
dossier_complet      → "Marquer incomplet" · "Refuser"
paiement_demande     → "Confirmer paiement reçu"(paiement_recu) · "Refuser"
paiement_recu        → "Refuser"
annulee              → []   (état terminal)
validee              → []   (état terminal)
```
- `A = ["dossier_complet","paiement_recu"].includes(statut)` → affiche le bouton `"Confirmer l'inscription"`.
- `w = ["validee","annulee"].includes(statut)` → **masque le bloc Actions ET le champ de réponse de la messagerie** (dossier gelé).
- Les transitions vers `annulee` et `dossier_incomplet` ouvrent une zone de commentaire :
  - `annulee` → `"Motif du refus (optionnel)"`, placeholder `"Ex: dossier incomplet après relances…"`
  - `dossier_incomplet` → `"Commentaire (optionnel)"`, placeholder `"Précisez ce qui manque…"`
  - Les autres transitions sont appliquées **sans confirmation**.
- Toast : `"Statut mis à jour"` / `"Erreur lors du changement de statut"`.

**Modale de conversion (`POST …/convertir`) :**
> Titre `"Confirmer l'inscription"` — « Cette action va transformer **{nom} {prenoms}** en élève inscrit et générer ses créances de frais. »
> Avertissement : « **Assurez-vous que les catégories de frais sont configurées pour cette classe avant de continuer.** »
> Succès : `"🎉 Inscription confirmée !"` / « L'élève est maintenant inscrit et **les créances ont été générées**. »
> Échec : `"Erreur lors de la conversion"` / « Vérifiez que les catégories de frais sont configurées. »

**Messagerie bidirectionnelle école ↔ parent (`POST …/message`) :**
- Fil de discussion `` `Messages (${n})` ``, bulles orientées par `auteur` (`"É"` / `"P"`), vide : `"Aucun message échangé."`
- Zone de saisie : placeholder `"Écrire un message au parent…"`, 2 lignes.
- **Succès : `"Message envoyé"` / « Un SMS a été envoyé au parent. »** → chaque message du fil **consomme un SMS**.

**Autres blocs du détail :** `Parent` (Père / Mère / Téléphone), `Enfant` (Nom complet / Date de naissance / Classe demandée / École précédente), `Historique` (timeline `statusLogs` : `→ {label}`, commentaire en italique, horodatage + `{utilisateur_prenoms} {utilisateur_nom}`), `` `Documents (${n})` `` (vignettes image ou icône + type, vide : `"Aucun document déposé pour l'instant."`) servis par `/api/storage/objects/…`.
En-tête : `` `Déposé le ${date} · ${classe.nom} · ${anneeScolaire.libelle}` `` + `dossier_number` en `font-mono`.

---

## 12. Communication tracée sur la fiche élève (onglet « Historique »)

`detail-6Bu9thd6.js` — 3 blocs, chargés seulement si `tab === "historique"` :

1. **`"Suivi des communications"`** (`GET /relances?eleveId&limit=100`) — bouton `"Nouvelle"` ouvrant un mini-formulaire :
   - `Type` (6 options, §7.9) · `Destinataire (optionnel)` placeholder `"Nom ou numéro"` · `Notes` placeholder `"Résumé de la communication..."`
   - `POST /relances {eleveId, type, destinataire?, notes?}` → toast `"Communication enregistrée"` / `"Impossible d'enregistrer la communication"`.
   - Rendu : emoji + chip coloré + montant FCFA + date/heure `fr-CI` + `"→ {destinataire}"` + `"Par : {expediteurNom}"` + notes en italique + lien `"Voir le lien →"` si `paystackUrl`.
   - Vide : `"Aucune communication enregistrée"`.
2. **`"SMS envoyés"`** (`GET /sms-logs?eleveId&limit=100`) — badge `` `${n} SMS` ``, chip statut, type, `#providerId` en mono, message tronqué. Vide : `"Aucun SMS enregistré"`.
3. **`"Actions système"`** (`GET /eleves/{id}/audit`).

Envoi direct du lien de paiement par SMS (`index-TfNa1dpy.js`, Créances) :
```js
POST /messagerie/envoyer {
  typeDestinataires:"par_telephone",
  telephone: phone.startsWith("225") ? phone : `225${phone}`,
  contenu:`Bonjour, voici le lien de paiement sécurisé pour ${nom} ${prenoms} : ${url} (Montant : ${montant} FCFA)`
}
```
Toasts `"SMS envoyé avec succès"` / `"Échec de l'envoi SMS"`.

---

## 13. Campagnes SMS de réinscription (`index-vQwBYpuX.js`)

Modale `" Campagne de réinscription"` avec **2 canaux en onglets** : `"SMS"` et `"WhatsApp (manuel)"`.

### 13.1 Canal SMS — assistant en 3 étapes (`cible` → `confirmation` → `resultat`)
**Cibles (`Ue`)**, plus une cible dynamique `selection` si des lignes sont cochées :
```
tous_non_reinscrits       → "Non réinscrits"
filtres_ecran             → "Élèves filtrés à l'écran"
non_contactes             → "Non contactés"
contactes_non_reinscrits  → "Contactés mais non réinscrits"
selection                 → `Sélection dans le tableau (${n})`
```
**10 variables (`zs`)** : `{nom_ecole} {nom_parent} {nom_eleve} {classe_actuelle} {classe_suivante} {annee_scolaire} {date_limite} {montant} {lien_reinscription} {lien_paiement}`

**Message par défaut (`Ts`)** :
> « Bonjour {nom_parent}, réinscrivez {nom_eleve} ({classe_actuelle}→{classe_suivante}) pour {annee_scolaire} en ligne : {lien_reinscription} - {nom_ecole} »

**Règle de fusion CONFIRMED :**
> « Les SMS sont **regroupés par parent**, sauf si le message contient une variable propre à l'élève ({nom_eleve}, {classe_actuelle}, {classe_suivante}, {lien_reinscription}, {lien_paiement}). »

Étape 2 (`POST …/sms-campaign/preview`) : 4 tuiles `Destinataires (SMS)` · `Crédits requis` · `Solde wallet` · `Ignorés (n° invalide)`, aperçu `"Aperçu (premier destinataire)"`, bouton `` `Confirmer l'envoi (${n})` `` — **désactivé si `soldeInsuffisant && !demo`**.
Bandeau si `demo` : « Mode démo : l'envoi sera simulé, aucun crédit ne sera débité. »
Bandeau si solde court : « Solde Communication insuffisant pour envoyer cette campagne. » + bouton `"Recharger"` (→ lien mort `/parametres/sms`, cf. §1).
Étape 3 : `` `✅ ${nbEnvoyes} envoyé(s) • ❌ ${nbEchecs} échec(s) • ⚠️ ${nbIgnores} ignoré(s)` `` + `" (simulé — mode démo)"`.
Erreur HTTP **402** → toast `"Solde insuffisant"` avec le message serveur.

### 13.2 Canal WhatsApp (manuel)
Cibles : `non_contacte` → `` `Non contactés (${n})` ``, `pas_de_reponse` → `` `Sans réponse (${n})` ``, `tous` → `` `Tous sauf réinscrits (${n})` ``.
Message par défaut (avec emojis et gras WhatsApp) :
```
Bonjour 👋
Votre enfant *[Nom]* en classe de *[Classe]* doit être réinscrit pour l'année prochaine.

✅ Répondez *OUI* pour confirmer votre souhait de réinscription.
📞 Ou appelez-nous directement.
```
Variables : `"Variables : [Nom], [Classe]"` (syntaxe crochets, **incompatible** avec la syntaxe accolades des autres modules).
Boucle d'envoi : `window.open(wa.me…)` par destinataire avec **`await new Promise(r=>setTimeout(r,300))`** entre deux ouvertures, puis `POST /reinscription-suivi/campagne {ids, anneeScolaireDestId}` pour tracer.
Résultat : `` `✅ ${n} envoyé(s) • ❌ ${m} sans téléphone` `` + toast `` `Campagne envoyée : ${n} messages` ``.

Le workflow en 6 étapes de la page (composant `Fs`) confirme la place de la communication :
`1 Résultats fin d'année` · `2 Initialiser` · **`3 Contacter — "Appeler / WhatsApp"`** · `4 Réponses` · **`5 Encaisser — "Envoyer lien de paiement"`** · `6 …`

---

## 14. Convocations SMS d'examen (`index-DEgXnv6X.js`) — capacité totalement invisible en survol UI

`POST /pedagogie/planification-evaluations/{id}/notifications/sms {confirmer:true}`
`GET  /pedagogie/planification-evaluations/{id}/notifications/preview`

Modale de prévisualisation, 4 tuiles : `Élèves` · `À envoyer` · `Déjà envoyés` · `Sans téléphone`.
`"Aperçu individualisé"`, vide : `"Aucun nouveau destinataire."`
Coût : `` `Coût estimé : ${segmentsEstimes} segment(s) SMS · Solde : ${soldeSms}.` `` (rouge si `!soldeSuffisant`).

**Règles métier CONFIRMED :**
> « Cette confirmation couvre **toutes les salles simultanées** de la répartition. **Un seul SMS est envoyé par élève au parent principal joignable, avec sa salle affectée. Une seconde confirmation ne renvoie pas les convocations déjà transmises.** » (idempotence)

Pré-requis bloquants avant SMS (fonction `rs`) :
> « Complétez la salle et au moins un surveillant avant publication, **SMS** ou documents. »
> « La salle ou l'un des surveillants n'est plus actif. Remplacez cette ressource avant publication, **SMS** ou documents. »
> « Renseignez l'effectif prévu de chaque salle simultanée avant publication, **SMS** ou documents. »

Erreurs : `solde_sms_insuffisant` → `` `Solde SMS insuffisant : ${solde} disponible(s), ${requis} requis.` ``
Retours : `` `${l} convocation(s) envoyée(s) pour ${t} salle(s) simultanée(s).` `` · « Toutes les convocations de cette répartition avaient déjà été envoyées. » · `` `${f} convocation(s) n'ont pas pu être envoyées. Vous pouvez relancer les échecs.` `` · `` `${j} envoi(s) ont été abandonnés car la publication a changé. Rechargez la répartition avant de recommencer.` ``
Bouton : `` `Confirmer l'envoi (${aEnvoyer})` `` — `disabled` si `!aEnvoyer || !soldeSuffisant`.

Autre SMS transverse : `POST /subscriptions/sms-relance {serviceType:"transport", anneeScolaireId}` (page Transport) → toast `` `${envoye} SMS envoyé(s) aux parents avec impayés transport` ``.

---

## 15. Règles métier issues du Centre d'aide (`index-BT4yo3uy.js`) — 72 articles, 8 concernent la communication

Le bundle embarque un centre d'aide complet (`"Centre d'aide Lakoli"`, *« Guides, procédures et FAQ pour utiliser Lakoli efficacement. »*, `"Mode d'emploi actualisé le 26 juillet 2026."`). Articles du domaine :
`wallet-sms-overview`, `portail-parent-overview`, `portail-config-tabs`, `portail-preinscriptions-admin`, `portail-parent-espace`, `whatsapp-envoyer`, `whatsapp-rappel-paiement`, `faq-whatsapp`, `reinscriptions-campagne-whatsapp`, `preinscriptions-overview`, `parents-telephone`, `procedures-gestion-impayes`.

### 15.1 `wallet-sms-overview` — « Crédit SMS (Wallet) », rôles `["Direction","Finance"]`
> « Lakoli envoie certains messages automatiquement aux parents par SMS : lien de paiement de préinscription, confirmation de dossier, rappels. Chaque SMS envoyé consomme du crédit SMS depuis le portefeuille (wallet) de votre établissement. »

Table `Type de transaction | Effet` :
```
Bonus bienvenue        → "Crédit SMS offert à la création de votre compte"
Recharge               → "Achat d'un pack de SMS supplémentaires"
SMS envoyé             → "Déduction automatique à chaque message envoyé"
Ajustement / Correction→ "Modification manuelle par le support Lakoli"
Remboursement          → "Crédit SMS remis en cas d'erreur d'envoi"
```
> ⚠ « **Si votre solde atteint 0, les SMS automatiques (liens de paiement, rappels) ne peuvent plus être envoyés tant qu'une recharge n'est pas effectuée. Le statut « Solde insuffisant » apparaît alors sur les dossiers concernés.** »
> 💡 « Surveillez votre solde régulièrement pendant les périodes de forte activité (rentrée, campagne de réinscription, campagnes de préinscription) où la consommation de SMS augmente. »

### 15.2 `portail-parent-overview` — authentification OTP
> Étapes : « Le parent saisit son numéro de téléphone (celui enregistré dans la fiche de son enfant) » → « Il reçoit un **code de vérification (OTP) par SMS** » → « Il saisit le code pour accéder à son espace ».
> ℹ « **Il n'y a pas de mot de passe à retenir : la connexion se fait uniquement par code SMS à chaque fois.** Le numéro doit correspondre exactement à celui enregistré dans Lakoli (comme numéro principal ou secondaire du parent). »
> Contenu vu par le parent : enfants inscrits (classe, matricule) · créances (dû, payé, remises, solde restant) · historique de paiements · bouton de paiement en ligne · notes par période et matière · absences.
> ⚠ « Si le parent n'arrive pas à recevoir le code SMS, vérifiez d'abord que son numéro est bien celui enregistré dans Lakoli (fiche élève → Parents) et qu'il est **au bon format ivoirien**. »

### 15.3 `portail-config-tabs` — distinction des deux espaces
```
Préinscriptions | "Familles qui veulent inscrire un enfant (pas encore élève)" | "Formulaire en ligne pour déposer un dossier de candidature"
Espace Parent   | "Parents dont l'enfant est DÉJÀ inscrit"                     | "Accès aux bulletins, frais et paiement en ligne via code SMS"
```
> ⚠ « Ces deux espaces ont des **URLs différentes** et des usages distincts. Ne les confondez pas lors du partage aux familles. »
> ℹ « **Le lien partagé aux familles reste valide même si vous modifiez les paramètres du portail.** »

### 15.4 `whatsapp-envoyer` — limite structurelle du canal
> ⚠ « Chaque message WhatsApp s'ouvre dans votre application WhatsApp (téléphone ou WhatsApp Web). **Vous devez appuyer sur Envoyer vous-même. Lakoli ne peut pas envoyer automatiquement sans votre accord.** »
> Points d'entrée WhatsApp : fiche élève (onglet Profil → section Parents, icône verte par numéro), module Réinscriptions (boutons `💬` et `💬2` = numéro principal / secondaire), module WhatsApp.

### 15.5 `whatsapp-rappel-paiement`
> « Fiche élève → onglet Finance » → « Un bouton WhatsApp apparaît si l'élève a un solde impayé. Il ouvre un message pré-rédigé avec le montant exact. »
> 💡 « Le message mentionne automatiquement le montant exact du solde en FCFA. Vous n'avez rien à saisir. »

### 15.6 `faq-whatsapp` — 4 Q/R
> « Le numéro du parent doit être renseigné et **commencer par l'indicatif pays (+225 pour la Côte d'Ivoire)**. »
> « Peut-on envoyer des messages à un groupe de parents depuis Lakoli ? — Via le menu WhatsApp ou depuis le module Réinscriptions → bouton « Envoyer campagne ». **Les messages s'ouvrent un par un pour validation.** »
> « Comment vérifier qu'un message WhatsApp a bien été envoyé ? — **La date de dernier contact dans le module Réinscriptions est mise à jour automatiquement.** Pour confirmer la réception, vérifiez les coches dans WhatsApp. »
> « Oui, WhatsApp fonctionne avec n'importe quel indicatif pays. »

### 15.7 `parents-telephone` — modèle de données téléphone
> « Lakoli gère **deux numéros par parent : un numéro principal et un numéro secondaire**. »
> Usages : affichage fiche élève avec bouton WhatsApp par numéro · appels et WhatsApp dans le suivi de réinscription · export Excel · **campagnes de masse**.
> 💡 « Si le parent a deux numéros dans une seule cellule Excel (ex: `0701234567/0502345678`), **Lakoli les sépare automatiquement à l'import**. »

### 15.8 `preinscriptions-overview` — SMS automatiques du pipeline
> 💡 « **Chaque changement de statut important déclenche un SMS automatique au parent** (ex: lien de paiement, confirmation de réception). »
> Étape 2 : « Depuis la ligne du dossier, cliquez sur l'action d'envoi. **Un SMS est envoyé automatiquement au parent avec le lien de paiement des frais de préinscription.** »
> ⚠ « La validation d'une préinscription **ne crée pas** automatiquement l'inscription officielle de l'élève pour l'année scolaire — utilisez ensuite le module Inscriptions. »

### 15.9 `procedures-gestion-impayes` — **échelle de relance en 4 niveaux (règle métier majeure)**
```
1 - Rappel amiable   | J+7 après l'échéance | "Message WhatsApp avec solde dû"
2 - Relance formelle | J+30                 | "Appel téléphonique + lettre de relance"
3 - Mise en demeure  | J+60                 | "Courrier recommandé, intervention de la direction"
4 - Suspension       | J+90                 | "Suspension de l'accès aux services (cantine, etc.)"
```
> ⚠ « La suspension d'un élève pour impayé doit être **validée par la direction et notifiée par écrit** aux parents. »

### 15.10 `reinscriptions-campagne-whatsapp`
> ⚠ « Les messages WhatsApp s'ouvrent un par un dans votre navigateur. Vous devez valider chaque envoi manuellement depuis votre téléphone ou WhatsApp Web. »
> 💡 « **Faites la campagne tôt le matin (8h-9h) ou en début de soirée (18h-19h) pour maximiser les lectures.** »

---

## 16. Visites guidées produit (`lakoli-main.js`) — copie marketing/pédagogique du domaine

Tours CONFIRMED (`Vc`) : `{id:"whatsapp", label:"Envoyer via WhatsApp", route:"/whatsapp"}`, `{id:"credit-communication", label:"Crédit SMS", route:"/credit-communication"}`, plus le tour messagerie.

> Messagerie : « **Message individuel** : un SMS à un parent précis. **Campagne** : envoi groupé à une classe, un niveau ou toute l'école en un clic. **Email** : pour les parents disposant d'une adresse e-mail. **Historique** : consultez les envois précédents. » (`targetId:"ptour-sms-tabs"`)
> « …expéditeur LAKOLI — les parents reconnaissent immédiatement votre école. »
> WhatsApp : « Envoyez des messages WhatsApp directement depuis Lakoli. **Idéal pour les documents (reçus, bulletins) et les messages longs.** Chaque lien WhatsApp ouvre automatiquement la conversation avec le parent. » · « Lakoli affiche **uniquement les parents pour lesquels un numéro WhatsApp est enregistré**. »
> Crédit : « **Un SMS standard = 1 crédit. Un message long (>160 caractères) = 2 crédits.** Lakoli vous prévient quand votre solde est bas. » · « Le paiement s'effectue par **Mobile Money**. Le crédit est ajouté immédiatement après confirmation. »

**Onboarding (`Ec`)** — 2 des 10 étapes appartiennent au domaine :
- `premierSms` (idx 7) — `"Envoyez votre premier SMS"` : « Cliquez sur l'onglet « Message individuel » (mis en surbrillance), choisissez un élève, rédigez un message court et appuyez sur Envoyer. **Ce premier envoi valide la messagerie SMS de votre école.** » → route `/messagerie`, `targetId:"tour-btn-sms"`.
- `portailParentTeste` (idx 9) — `"Découvrir le Portail Parent"` : « Votre portail est actif et accessible aux familles. Copiez le lien depuis cette page et partagez-le à vos parents — **ils s'y connectent via un code SMS** pour consulter les notes, paiements et bulletins. » Astuce : « **Les parents n'ont pas besoin de créer un compte : un code OTP envoyé sur leur téléphone suffit.** » → `POST /onboarding/portail-teste`.

`eM = new Set(["collaborateurInvite","premierSms","paiementEnLigne","portailParentTeste"])` — étapes considérées optionnelles/avancées (INFERRED d'après le nom de l'ensemble et son usage de filtrage).

---

## 17. Points de fragilité / dette technique relevés (tous appuyés sur le code)

1. **`/parametres/sms` n'existe pas** — bouton « Recharger » mort dans la campagne de réinscription (§1).
2. **Trois tables de libellés de statut SMS divergentes** (`envoye` = « Envoyé » vs « Transmis à l'opérateur » ; `echec` vs `echoue`) — §7.4.
3. **Deux calculateurs de segments** : `Math.ceil(len/160)` (messagerie, modèles) vs l'algorithme GSM/Unicode 160/153/70/67 (campagnes). Facturation potentiellement mal estimée dans la messagerie individuelle.
4. **Le prédicat Unicode `[^\x00-\xFF]` n'attrape pas les accents français** alors que la copie UI affirme l'inverse (§4.4).
5. **Modèles WhatsApp persistés en `localStorage`** sous une clé au préfixe d'un ancien produit `agora_` — non partagés, non sauvegardés (§8.5).
6. **Modèle client mono-tenant en dur** (« GSSV » / « College Source Vision ») livré à tous les tenants (§8.8).
7. **`couleur_primaire`** envoyée au PATCH sans contrôle UI (§10).
8. **Listes de diffusion construites mais jamais utilisables comme cible d'envoi** (§3.5).
9. **`type` d'une règle d'automatisation figé à `"paiement"`** sans contrôle UI, alors que le catalogue d'événements couvre aussi la scolarité (§4.10).
10. **Deux syntaxes de variables incompatibles** : `{accolades}` (SMS/campagnes/WhatsApp modèles) vs `[crochets]` (campagne WhatsApp réinscription).
11. **Confirmations natives `confirm()` / `alert()`** encore présentes (suppression de liste, suppression de modèle, relance impayés) au milieu d'un design system de modales.
12. **Impersonation `staff_token`** sur le portail parent, sans étape de confirmation ni trace visible dans l'UI appelante (§9.3).
13. **`POST /messagerie/seed-templates` déclenché automatiquement** à l'ouverture de l'onglet quand la liste est vide — effet de bord silencieux (§3).

---

## 18. Récapitulatif quantitatif

| Métrique | Valeur |
|---|---|
| Endpoints propres au domaine | **53** |
| Endpoints transverses consommant de la communication | **13** |
| Endpoints absents de `lakoli-endpoints.txt` retrouvés ici | **4** |
| Pages SPA du domaine | **9** (`/messagerie`, `/messagerie/campagnes`, `/whatsapp`, `/credit-communication`, `/sms-logs`, `/portail-parent`, `/portail-parent/preinscriptions`, `/portail-parent/dossier/:id`, `/portail-parent/parametres`) + 1 portail public |
| Onglets recensés | 6 (Campagnes) + 7 (Messagerie) + 4 (WhatsApp) + 2 (Portail) = **19** |
| Modales / assistants recensés | **8** |
| Ensembles d'énumérations documentés | **22** |
| Modèles de messages livrés en dur dans le bundle | **11** WhatsApp (4 réinscription + 7 rapides) + 1 modèle client |
| Champs de formulaire inventoriés | 3 (campagne) + 6 (destinataires/message) + 3 (modèle campagne) + 3 (modèle messagerie) + 7 (règle) + 13 (portail) + 3 (relance) + 2 (email) = **40** |
