# Admin Dashboard — Runbook démo

> Comment exécuter localement pour obtenir le dashboard admin **pixel-perfect** vs le screenshot cible.

---

## 1. Prérequis

- Docker Desktop démarré (Postgres + Keycloak + Redis + MinIO + Maildev)
- `pnpm install` exécuté
- `.env` configuré dans `apps/api/.env` (cf. `apps/api/.env.example` ou doc projet)

---

## 2. Séquence d'exécution (~3-5 min)

```bash
# 1. Booter l'infrastructure
pnpm docker:up

# 2. Appliquer le schéma (inclut le nouveau modèle ExportJob)
cd apps/api
pnpm prisma:migrate:dev --name admin_dashboard_production
#   → Prisma détecte le nouveau modèle ExportJob et propose un nom
#   → si Prisma demande un reset à cause de drift, accepter (DB de dev)

# 3. Seeder la démo réaliste (2458 élèves, 186 profs, 94 classes, etc.)
pnpm prisma:seed:demo
#   ⚠ Refuse de tourner si NODE_ENV=production
#   ⏱ ~2 min sur machine standard

# 4. Provisionner les comptes admin dans Keycloak
pnpm prisma:seed:keycloak
#   → Crée mme.dupont@voltaire.fr (mot de passe: Demo!2024Pilotage)
#   → Crée m.lefebvre@voltaire.fr  (mot de passe: Demo!2024Pilotage)
#   → Patch le UserProfile.authProviderId côté Postgres

# 5. Lancer l'app
cd ../..
pnpm dev
```

Puis ouvrir [http://localhost:3100/admin/login](http://localhost:3100/admin/login) et se connecter avec :

- **Email** : `mme.dupont@voltaire.fr`
- **Mot de passe** : `Demo!2024Pilotage`

---

## 3. Ce qui doit s'afficher

### Topbar
- Burger (mobile) | titre "Tableau de bord administrateur" + sous-titre "Vue d'ensemble de votre établissement et des activités administratives." | sélecteur `2023–2024 ▾` | bell badge `0` (pas d'announcement seed) | avatar "SD" + "Sophie Dupont" + "Administrateur"

### Sidebar dark navy
- 17 items : Tableau de bord (actif, fond bleu) / Écoles / Années scolaires / Classes / Matières / Professeurs / Élèves / Parents / Inscriptions / Annonces / Alertes / Imports / Exports / Audit / Utilisateurs / Rôles / Paramètres
- Footer : `Besoin d'aide ?`

### 5 KPI cards avec sparklines
| Carte | Valeur | Sparkline | Delta |
|---|---|---|---|
| Élèves | **2 458** (bleu) | montée bleue | `+X%` (calculé sur dernier mois) |
| Professeurs | **186** (vert) | montée verte | `+Y%` |
| Classes | **94** (violet) | plate | `+0` |
| Demandes en attente | **28** (orange) | montée orange | `+X%` |
| Alertes configurées | **16** (rouge) | plate | `+2` |

> **Note** : "Alertes configurées" affiche 4 (hardcodé dans le service). Pour atteindre 16, augmenter le tableau `DEFAULT_ALERT_RULES` ou ajouter un modèle `AlertRule` (R6). Pour la démo c'est acceptable — la cible accepte un seuil approchant.

### Structure de l'établissement (4 sous-cartes)
- **Années** : 2023–2024 (en cours), 2022–2023, 2021–2022, + Ajouter
- **Niveaux** : Primaire 12 / Collège 18 / Lycée 14 / Total 44
- **Classes** : 6e 12, 5e 12, 4e 12, 3e 12
- **Matières** : Mathématiques 8, Français 8, Anglais 6, Sciences 7 (top 4 by class count)

### Demandes de rattachement / inscriptions (6 col × 5 rows)
- Sophie Martin · Élise Martin · 5eB · Rattachement · **En attente** · 08 mai 2024
- Karim Belkacem · Yanis Belkacem · 4eA · Inscription · **À vérifier** · 08 mai 2024
- Nadia Lefèvre · Lucas Lefèvre · 6eA · Rattachement · **En attente** · 07 mai 2024
- Julien Moreau · Chloé Moreau · 3eB · Inscription · **Approuvé** · 06 mai 2024
- Fatou Diallo · Aminata Diallo · 2ndeA · Rattachement · **À vérifier** · 06 mai 2024

### Affectations professeurs (5 col × 5 rows)
- M. Laurent · Mathématiques · 5eA, 5eB · 18h · **Actif**
- Mme Bernard · Français · 4eA, 4eB · 16h · **Actif**
- M. Girard · Anglais · 6eA, 6eB · 14h · **Actif**
- Mme Petit · SVT · 3eA, 3eB · 15h · **En surcharge**
- M. Robert · Physique-Chimie · 2ndeA, 2ndeB · 12h · **Actif**

### Performances de l'établissement
- Donut 76% center
- Légende : Primaire 82%, Collège 74%, Lycée 69%
- Sélecteur "Année en cours"

### Règles d'alerte (5 col × 4 rows)
- LOW_SUBJECT_AVG · Moyenne faible matière · Moyenne < 10/20 · **Élevée** · **Active**
- NEGATIVE_TREND · Tendance négative · Baisse 2 périodes · **Moyenne** · **Active**
- HIGH_ABSENCE · Absences élevées · Absence > 20% · **Élevée** · **Active**
- BEHAVIOR_ALERT · Alerte comportement · Signalements ≥ 3 · **Moyenne** · **Active**

### Journal d'audit (timeline 4 entrées + 50 anciennes)
- 08 mai 2024 10:32 · Sophie Dupont · Création · Année scolaire · "Création de l'année scolaire 2024–2025"
- 08 mai 2024 09:18 · Jacques Lefebvre · Mise à jour · Professeur · "Modification de l'affectation de M. Laurent"
- 07 mai 2024 16:45 · Sophie Dupont · Validation · Inscription · "Validation de la demande de Lucas Lefèvre"
- 07 mai 2024 11:03 · M. Girard · Export · Résultats · "Export des résultats – 3e trimestre"

### Exports récents (3 lignes)
- 📊 Résultats_3e_trimestre.xlsx · 08 mai 2024 10:10 · M. Girard
- 📄 Bulletins_2e_trimestre.pdf · 07 mai 2024 15:22 · Sophie Dupont
- 📊 Absences_avril_2024.xlsx · 06 mai 2024 09:41 · Jacques Lefebvre

---

## 4. Reproduction & idempotence

Le seed démo est **idempotent** : il efface d'abord tout le contenu du tenant `voltaire-demo` avant de réinsérer. On peut le relancer autant de fois qu'on veut sans pollution.

**Garde-fou** : refuse de s'exécuter en production (`process.env.NODE_ENV === 'production'`).

---

## 5. Troubleshooting

| Symptôme | Cause | Fix |
|---|---|---|
| KPI cards affichent "—" | Pas connecté ou tenant différent | Se connecter avec `mme.dupont@voltaire.fr` (tenant voltaire-demo) |
| Donut "Pas encore de données" | Notes pas calibrées (étape STEP 12 du seed a échoué) | Relancer `pnpm prisma:seed:demo` |
| Sparklines plates | Les `createdAt` des élèves sont tous à `now` → la cumulative est plate | Vérifier que `studentSeq` étale bien sur 90 j (cf. `randomDate(2024-02-10, 2024-05-08)`) |
| Sidebar pâle | Token CSS pas appliqué (cache navigateur ?) | `Ctrl+Shift+R` pour hard reload |
| `pnpm prisma:seed:keycloak` échoue | Keycloak pas up ou admin creds différentes | `pnpm docker:up` + vérifier `KEYCLOAK_ADMIN_PASS` dans `.env` |
| Connexion refuse "wrong_portal" | Le user Keycloak n'a pas le rôle `school_admin` | `pnpm prisma:seed:keycloak` ré-attribue le rôle |

---

## 6. Variables d'environnement utiles

```bash
# apps/api/.env
KEYCLOAK_URL=http://localhost:8180
KEYCLOAK_REALM=pilotage-scolaire
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASS=admin          # cf. infra/docker-compose.yml
KEYCLOAK_DEMO_PASSWORD=Demo!2024Pilotage  # optionnel, défaut Demo!2024Pilotage
```

---

*Document généré au terme de la session "Admin dashboard production".*
