# Wireframes — Portail Parent (`/parent`)

> Cible: parents non-techniques. **Mobile-first absolu**. Lisibilité, bienveillance, action.

## Layout général

**Mobile (priorité):**
```
┌───────────────────────────┐
│ ☰  [Léa Martin ▼]  🔔  👤 │ Topbar (sélecteur enfant)
├───────────────────────────┤
│                           │
│   Page content            │
│                           │
├───────────────────────────┤
│ 🏠   📊   📅   🔔   👤    │ Bottom tabs
│ Home Suivi Cal Alert Profil│
└───────────────────────────┘
```

**Desktop:** Sidebar + content + side panel optionnel (alertes/activity).

Sélecteur enfant en haut si parent rattaché à plusieurs enfants.

---

## 1. Dashboard — `/parent/dashboard` (enfant sélectionné)

```
┌──────────────────────────────────────────────────────┐
│  ☰   [Léa Martin ▼]               🔔 (2)   👤      │
├──────────────────────────────────────────────────────┤
│                                                      │
│   📊 Léa, en bref                                   │
│   ─────────────────────────────────────              │
│                                                      │
│   Moyenne globale         Trimestre en cours         │
│        13.4 / 20          T2 — 15 mars / 30 juin    │
│        ↑ +0.6 vs T1                                  │
│                                                      │
│   ┌──────────────────────────────────────────┐      │
│   │ ⚠ 2 alertes ouvertes                     │      │
│   │   • Maths sous seuil                     │      │
│   │   • Tendance baisse en Anglais           │      │
│   │   [ Voir le détail ]                     │      │
│   └──────────────────────────────────────────┘      │
│                                                      │
│   📚 Performances par matière                       │
│   ─────                                              │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│   │ Maths    │ │ Français │ │ Anglais  │            │
│   │ 8.5/20   │ │ 14/20    │ │ 11/20    │            │
│   │ ↓ baisse │ │ → stable │ │ ↓ baisse │            │
│   │ coef. 4  │ │ coef. 3  │ │ coef. 2  │            │
│   └──────────┘ └──────────┘ └──────────┘            │
│   ┌──────────┐ ┌──────────┐ ...                     │
│   │ Histoire │ │ SVT      │                          │
│   │ 15/20    │ │ 12.5/20  │                          │
│   │ ↑ hausse │ │ → stable │                          │
│   └──────────┘ └──────────┘                          │
│                                                      │
│   📅 Examens à venir                                │
│   ─────                                              │
│   Mer. 22/05  Interrogation Fonctions    Maths      │
│   Lun. 27/05  Composition T2             Français   │
│   Ven. 31/05  DS Géopolitique            Histoire   │
│                                                      │
│   📝 Dernières notes publiées                       │
│   ─────                                              │
│   15/05  DST chapitre 5    Maths       8.5  ↓       │
│   12/05  Récitation        Français   14.0  →       │
│   10/05  Quiz vocab        Anglais    11.0  ↓       │
│   [ Voir l'historique ]                              │
│                                                      │
│   📢 Annonces école                                 │
│   ─────                                              │
│   Réunion parents-profs le 28/05 18h-20h            │
│                                                      │
├──────────────────────────────────────────────────────┤
│ 🏠  📊  📅  🔔(2)  👤                              │
└──────────────────────────────────────────────────────┘
```

---

## 2. Mes enfants — `/parent/children`

```
┌──────────────────────────────────────────────────────┐
│  Mes enfants                                          │
├──────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────┐     │
│  │ [Avatar]  Léa Martin                        │     │
│  │           2ndeB — Lycée Voltaire            │     │
│  │           Moy 13.4  •  2 alertes            │     │
│  │           [ Voir suivi ]                    │     │
│  └────────────────────────────────────────────┘     │
│                                                      │
│  ┌────────────────────────────────────────────┐     │
│  │ [Avatar]  Tom Martin                        │     │
│  │           5e — Collège Hugo                 │     │
│  │           Moy 15.1  •  0 alerte             │     │
│  │           [ Voir suivi ]                    │     │
│  └────────────────────────────────────────────┘     │
│                                                      │
│  [ + Rattacher un enfant ]                           │
└──────────────────────────────────────────────────────┘
```

---

## 3. Rattacher enfant — `/parent/children/claim`

Formulaire (voir landing-and-auth.md §7 étape 3).

---

## 4. Détail matière — `/parent/children/[id]/subjects/[subjectId]`

```
┌──────────────────────────────────────────────────────┐
│  ← Mathématiques — Léa Martin                         │
├──────────────────────────────────────────────────────┤
│                                                       │
│   Moyenne actuelle                                    │
│       8.5 / 20         Coefficient 4                  │
│       ↓ -2.1 vs T1                                    │
│                                                       │
│   ┌──────────────────────────────────────────┐       │
│   │ ⚠ Alerte ouverte                          │       │
│   │ Moyenne sous le seuil attendu (10/20)    │       │
│   │ Tendance: baisse régulière sur 3 notes   │       │
│   │ Recommandation: planifier un échange     │       │
│   │ avec l'enseignant ou renforcer en soutien │       │
│   │ [ Marquer comme traité ]                  │       │
│   └──────────────────────────────────────────┘       │
│                                                       │
│   📈 Évolution                                       │
│   [Line chart: notes sur l'année]                    │
│                                                       │
│   📊 Position dans la classe (anonyme)               │
│   [Box plot ou distribution]                          │
│   Votre enfant: percentile 30                        │
│                                                       │
│   📋 Historique des notes                            │
│   15/05  DST chap. 5         8.5  ↓                  │
│          Prof: "Manque de pratique sur les fonctions"│
│   02/05  Quiz dérivées      11.0  →                  │
│   25/04  Devoir maison      14.0  ↑                  │
│   18/04  Interrogation       9.0  ↓                  │
│                                                       │
│   📅 Évaluations à venir                            │
│   22/05  Interrogation Fonctions                     │
│   05/06  Composition T2                              │
│                                                       │
│   📚 Cahier de texte (cours)                        │
│   [Lien vers cours publiés]                          │
└──────────────────────────────────────────────────────┘
```

---

## 5. Calendrier — `/parent/children/[id]/calendar`

```
┌──────────────────────────────────────────────────────┐
│  Calendrier — Léa Martin                              │
│  [Semaine] [Mois] [Liste]                             │
├──────────────────────────────────────────────────────┤
│   Mai 2026          ◀ Mai ▶                           │
│                                                       │
│   Lun  Mar  Mer  Jeu  Ven  Sam  Dim                   │
│    1    2    3    4    5    6    7                    │
│    8    9   10   11   12   13   14                    │
│   15   16   17   18   19   20   21                    │
│   22•  23   24   25   26   27   28•                   │
│   29   30   31                                        │
│                                                       │
│   Légende:                                            │
│   • Examen   ⚪ Cours   ✏ Devoir   📢 Annonce        │
│                                                       │
│   Prochains événements                                │
│   ────                                                 │
│   Mer. 22/05  Interro Fonctions      Maths           │
│   Lun. 27/05  Composition T2          Français        │
│   Sam. 28/05  Réunion parents-profs   18h-20h        │
│                                                       │
│   [ Exporter mon calendrier (.ics) ]                  │
└──────────────────────────────────────────────────────┘
```

---

## 6. Présences — `/parent/children/[id]/attendance`

```
┌──────────────────────────────────────────────────────┐
│  Présences — Léa Martin                               │
│  Période: Mai 2026 ◀ ▶                                │
├──────────────────────────────────────────────────────┤
│  Synthèse mois                                        │
│  ✓ 32 cours présents                                  │
│  ⚠ 2 absences   (1 justifiée, 1 à justifier)         │
│  🕒 1 retard                                          │
│                                                       │
│  Détail                                               │
│  ────                                                  │
│  14/05  Maths 08h     Absente   "RDV médical" ✓ Just.│
│  10/05  Anglais 14h   Retard 10min                    │
│  03/05  Histoire 10h  Absente   ⚠ À justifier        │
│         [ Justifier cette absence ]                   │
│  ...                                                  │
└──────────────────────────────────────────────────────┘
```

Modal "Justifier":
- Motif (dropdown: médical / familial / autre)
- Description
- Pièce jointe optionnelle (certificat)
- Soumettre → workflow admin

---

## 7. Alertes — `/parent/children/[id]/alerts`

```
┌──────────────────────────────────────────────────────┐
│  Alertes — Léa Martin                                 │
│  [Toutes (4)] [Ouvertes (2)] [Archivées (2)]          │
├──────────────────────────────────────────────────────┤
│  🟡 Maths — Moyenne sous le seuil                     │
│       Sévérité: moyenne                               │
│       Détecté il y a 2 jours                          │
│       Moyenne actuelle: 8.5/20 (seuil: 10/20)         │
│       Tendance: baisse régulière                      │
│                                                       │
│       Recommandation:                                  │
│       Planifier un échange avec l'enseignant ou       │
│       renforcer en soutien scolaire.                  │
│                                                       │
│       [ Marquer traité ]  [ Contacter l'école ]      │
│                                                       │
│  ─────                                                 │
│                                                       │
│  🟠 Anglais — Tendance baissière                      │
│       [...]                                           │
└──────────────────────────────────────────────────────┘
```

---

## 8. Rapports — `/parent/children/[id]/reports`

```
┌──────────────────────────────────────────────────────┐
│  Rapports — Léa Martin                                │
├──────────────────────────────────────────────────────┤
│  Bulletins publiés                                    │
│  ─────                                                 │
│  Bulletin T1 2025-2026   [📄 Télécharger PDF]        │
│  Bulletin T2 (provisoire) [📄 Télécharger PDF]       │
│                                                       │
│  Synthèses à la demande                               │
│  ─────                                                 │
│  Générer une synthèse personnalisée pour la période   │
│  [Date début] → [Date fin]                            │
│  Format [PDF]                                         │
│  [ Générer ]  (peut prendre quelques secondes)        │
│                                                       │
│  Historique des synthèses générées                    │
│  ─────                                                 │
│  Synthèse 01/03 → 30/04  [📄 Télécharger]            │
└──────────────────────────────────────────────────────┘
```

---

## 9. Discipline — `/parent/children/[id]/disciplinary`

Lecture seule des disciplinary records. Filtrage par type/sévérité.

---

## 10. Cahier de texte — `/parent/children/[id]/lessons`

Vue par matière + semaine: contenu cours, devoirs, ressources.

---

## 11. Ressources — `/parent/children/[id]/resources`

Library des ressources partagées par les profs.

---

## 12. Annonces école — `/parent/announcements`

Feed des annonces concernant l'enfant + global école.

---

## 13. Messages — `/parent/messages` (Phase 5)

Inbox lecture seule MVP.

---

## 14. Notifications — `/parent/notifications`

Centre de notifications avec filtres + marquer tout lu.

---

## 15. Documents école — `/parent/documents`

Library publique (règlement, formulaires, FAQ).

---

## 16. Profil & paramètres

### `/parent/profile`
- Photo, infos, MFA (recommandé)
- Email, téléphone (vérifications)
- Deuxième contact (autre parent / tuteur)
- Sessions actives + revoke

### `/parent/settings`
- Préférences notifications (canaux, fréquence digest)
- Heures de silence (pas de push entre X et Y)
- Langue + fuseau
- Mode sombre
- Police dyslexie option
- Install PWA prompt
- Politique données (export / suppression compte)

---

## Empty states clés

| Page | Empty state |
|---|---|
| Dashboard sans enfant | "Pour commencer, rattachez votre enfant à votre compte." + CTA "Rattacher un enfant" |
| Dashboard enfant nouveau | "L'établissement n'a pas encore publié de note. Les premières informations apparaîtront dès la rentrée des notes." |
| Alertes vides | "Aucune alerte. Tout va bien ! 🎉" |
| Présences vide | "Aucune session enregistrée pour cette période." |
| Rapports vide | "Aucun bulletin publié pour le moment." |
