# ADR-018: Module Finance — périmètre et architecture (phase future)

**Status:** Proposed
**Date:** 2026-05-31

## Context

Le cahier des charges mentionne la gestion financière comme un axe stratégique de la plateforme : frais d'inscription, scolarité par cycle ou par classe, suivi des paiements attendus / reçus / en retard, graphes de recouvrement et état financier par famille.

Plusieurs alternatives d'intégration se posent :

1. **Grande carte sur le dashboard admin** — intégrer les indicateurs financiers directement dans le tableau de bord principal, au même niveau que les autres KPI (absences, notes, alertes).
2. **Espace séparé (module dédié)** — créer un espace Finance autonome, accessible depuis la navigation principale de l'admin, sans encombrer le dashboard.

Par ailleurs, les demandes d'inscription et de rattachement parent-élève sont déjà accessibles via :
- Les KPI du dashboard admin (compteur de demandes en attente)
- La page dédiée `/admin/enrollments` (liste + actions d'approbation)

Ces flux ne doivent pas être déplacés dans le module Finance, même si la finance devient un espace séparé.

## Decision

Le **Module Finance est reporté à une phase future** (Phase 9 — Extensions, après la livraison de la plateforme de base). Il ne sera **pas** implémenté dans les phases 0 à 8.

Quand il sera développé, il prendra la forme d'un **espace séparé** dans le portail admin (route `/admin/finance`), et non d'une grande carte sur le dashboard principal. Cette approche :

- Préserve la lisibilité du dashboard admin, centré sur le pilotage pédagogique (absences, notes, alertes comportementales).
- Permet une évolution indépendante du module Finance sans risquer de régression sur les autres fonctionnalités.
- Facilite les permissions granulaires : un custom role `comptable` (ADR-015) pourra accéder à `/admin/finance` sans avoir accès aux données pédagogiques.

### Périmètre prévu du module Finance

| Fonctionnalité | Description |
|---|---|
| Frais d'inscription | Tarif configuré par cycle / classe ; appliqué automatiquement à chaque nouvel élève inscrit |
| Scolarité par cycle | Montant annuel défini au niveau du cycle (primaire, collège, lycée…) |
| Scolarité par classe | Surcharge optionnelle au niveau de la classe (filière, options) |
| Paiements attendus | Échéancier généré par élève selon le plan de paiement de sa famille |
| Paiements reçus | Enregistrement des versements (virement, chèque, espèces, paiement en ligne) |
| Paiements en retard | Détection automatique des échéances dépassées + niveau d'alerte |
| Graphes de recouvrement | Courbes taux de recouvrement global + par cycle/classe + évolution mensuelle |
| État financier par famille | Vue consolidée : total dû, total versé, solde, historique des paiements, reçus PDF |

### Interactions avec le dashboard admin

- Un **signal discret** sur le dashboard admin (badge ou ligne dans le résumé) indiquera le nombre de familles avec paiement en retard, avec un lien vers `/admin/finance?filtre=en_retard`.
- Ce signal ne doit **pas** prendre la forme d'une grande carte : il s'intégrera dans la section « Alertes opérationnelles » existante, au même niveau que les autres signaux mineurs.

### Interactions avec les inscriptions

- Les demandes d'inscription et de rattachement restent gérées via le dashboard admin (KPI compteur) et la page `/admin/enrollments`.
- À terme, l'approbation d'une inscription dans `/admin/enrollments` pourra déclencher la création automatique d'un échéancier financier pour la famille — mais ce couplage sera implémenté côté Finance, sans modifier le flux Enrollment existant (event-driven via BullMQ).

## Sécurité et multi-tenant

- Toutes les données financières sont isolées par `tenant_id` + RLS (ADR-002).
- Custom role `comptable` : accès Finance en lecture/écriture, pas d'accès aux données pédagogiques (ADR-015).
- Audit log obligatoire sur chaque opération financière (création, modification, annulation de paiement).
- Les reçus PDF générés sont stockés dans MinIO/S3 avec accès signé temporaire.

## Ce que cet ADR ne couvre PAS

- Intégration d'un prestataire de paiement en ligne (Stripe, PayPal…) — décision séparée, Phase 9+.
- Comptabilité générale ou export vers un logiciel de comptabilité — hors périmètre v1.
- Portail parent : affichage du solde financier de la famille — possible en Phase 9, à décider.

## Consequences

**Avantages de l'espace séparé :**
- Dashboard admin reste centré sur le pilotage pédagogique, sans surcharge visuelle.
- Module Finance peut être activé / désactivé par tenant (feature flag).
- Permissions fines sans impact sur les rôles pédagogiques existants.
- Développement et tests isolés du reste de la plateforme.

**Points d'attention :**
- La navigation admin devra prévoir une entrée « Finance » (icône, label) dès la Phase 6 (Dashboards) pour ne pas avoir à revoir la structure de navigation en Phase 9.
- Le couplage event-driven Enrollment → Finance devra être documenté dans un ADR dédié lors de l'implémentation.

## Action Items (Phase 9)

1. [ ] Définir le schéma Prisma : `fee_schedule`, `payment_plan`, `payment`, `payment_receipt`
2. [ ] Implémenter le module NestJS `FinanceModule` (endpoints REST + événements BullMQ)
3. [ ] UI admin : espace `/admin/finance` avec tableau de bord recouvrement + vue par famille
4. [ ] Signal discret sur le dashboard admin (badge « X familles en retard »)
5. [ ] Génération PDF reçus (réutiliser la lib Documents de Phase 6)
6. [ ] Tests d'intégration : cycle complet inscription → échéancier → paiement → reçu
7. [ ] ADR dédié pour l'intégration d'un prestataire de paiement en ligne
