# Evidence — Lakoli sidebar navigation map (Super Admin, cycle « Primaire »)

Captured: 2026-08-01 · Source: DOM walk of `<nav>` on https://lakoli.com/app/
Account role label displayed in sidebar footer: **Super Admin**. Tenant/establishment: **EPV — via Lakoli**.

Legend: `depth|kind|href|label` — kind `B` = collapsible section button, `H` = group heading, `A` = link.

```
0|A|/app/                            |Accueil
1|B| Piloter
  4|H| Analyse
    5|A|/app/rapports                |Rapports financiers
    5|A|/app/analytics               |Analyse financière
  4|H| Organisation
    5|A|/app/calendrier              |Calendrier scolaire
1|B| Scolarité
  4|H| Admissions
    5|A|/app/inscriptions            |Inscriptions
    5|A|/app/reinscriptions/suivi    |Réinscriptions
  4|H| Dossiers élèves
    5|A|/app/eleves                  |Élèves
    5|A|/app/affectations-etat       |Affectés de l'État
  4|H| Orientation et examens        (badge « À venir »)
    5|A|/app/inscriptions/fin-annee  |Décisions de fin d'année
    5|A|/app/examens-nationaux       |Examens nationaux
  4|H| Organisation pédagogique
    5|A|/app/affectations-enseignants|Affectations
    5|A|/app/emploi-du-temps         |Emploi du temps
    5|A|/app/suivi-enseignants       |Cours réalisés
  4|H| Vie scolaire                  (badge « À venir »)
    5|A|/app/presences               |Présences
    5|A|/app/vie-scolaire/discipline |Discipline
    5|A|/app/vie-scolaire/activites  |Activités et clubs
  4|H| Cours et évaluations
    5|A|/app/cahier-textes           |Cahier de textes
    5|A|/app/notes                   |Notes
    5|A|/app/planification-evaluations|Compositions
    5|A|/app/bulletins               |Bulletins
  4|H| Exports administratifs
    5|A|/app/exports-cio             |Exports CIO & StatCIO
1|B| Finance & services
  4|H| Paiements
    5|A|/app/paiement-parent         |Nouveau paiement
    5|A|/app/paiements-en-ligne      |Paiements en ligne
    5|A|/app/caisse                  |Caisse
  4|H| Suivi financier
    5|A|/app/creances                |Créances
  4|H| Services aux élèves
    5|A|/app/cantine                 |Cantine
    5|A|/app/transport               |Transport
    5|A|/app/autres-services         |Autres services
1|B| Familles
  4|H| Familles
    5|A|/app/portail-parent          |Portail Parent
  4|H| Campagnes
    5|A|/app/messagerie              |SMS
    5|A|/app/whatsapp                |WhatsApp
  4|H| Compte
    5|A|/app/credit-communication    |Crédit SMS & WhatsApp
1|B| Administration
  4|H| Documents officiels
    5|A|/app/trombinoscope           |Trombinoscope
    5|A|/app/documents               |Documents
    5|A|/app/conformite              |Conformité
  4|H| Équipe
    5|A|/app/rh                      |Personnel & RH
    5|A|/app/rh/pointages            |Pointage du personnel
    5|A|/app/utilisateurs            |Utilisateurs
  4|H| Compte
    5|A|/app/abonnement              |Abonnement
    5|A|/app/parametres              |Paramètres
  4|H| Outils avancés
    5|A|/app/audit-ia                |Contrôle IA
    5|A|/app/audit                   |Journal d'audit
    5|A|/app/admin/suppressions      |Suppressions
```

## Persistent sidebar chrome (outside the nav tree)

| Element | Observation |
|---|---|
| Tenant header | Logo + « EPV » + « VIA LAKOLI » |
| Cycle switcher | « CYCLE ACTIF — Primaire » dropdown (green dot). Also mirrored as a `CYCLE PRIMAIRE` pill in the top bar. |
| Page search | « Rechercher une page » with `⌘K` shortcut hint |
| Onboarding widget | « Continuer la configuration — 10% » progress bar, « Prochaine étape : Informations génér… » |
| Help | « Mode d'emploi & tutoriels » → `/app/aide` |
| Support | « Contacter le support » (button, not a link) |
| Account footer | Avatar « SK », name, role label « Super Admin », logout button |

## Top bar

| Element | Observation |
|---|---|
| Collapse | « Replier la navigation » |
| Cycle pill | « ● CYCLE PRIMAIRE » |
| Search | « Rechercher une page » |
| Guided tour | « Revoir le guide » — replays the per-page product tour |
| Notifications | Bell button |
| Account menu | « Ouvrir le menu du compte » |
| Skip link | `#contenu-principal` → « Aller au contenu principal » (accessibility) |
