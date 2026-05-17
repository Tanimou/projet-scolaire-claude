# ADR-001: Architecture en modular monolith

**Status:** Accepted
**Date:** 2026-05-15
**Deciders:** Tech lead, Product owner

## Context

Le cahier des charges (§1, §8) recommande explicitement de démarrer par un modular monolith plutôt que des microservices prématurés. Le projet:
- 10 modules backend distincts identifiés.
- Une équipe initiale petite (≤ 5 devs supposé).
- Besoin de livrer rapidement un MVP fonctionnel.
- Cohérence transactionnelle forte requise (publication note → snapshots → alertes → notification doivent rester cohérents).
- Volume utilisateurs initial modeste (école pilote).

## Decision

Adopter un **modular monolith NestJS** avec:
- Un seul déploiement applicatif `apps/api`.
- 10 modules NestJS isolés (Identity, School Structure, Enrollment, Teaching, Assessment, Gradebook, Analytics, Alerting, Notification, Audit).
- Communication inter-modules via interfaces de service explicites + événements internes (outbox + BullMQ).
- Une instance dédiée `apps/worker` pour les jobs asynchrones (même codebase, mode différent).
- Une base de données Postgres partagée mais avec namespacing logique par module (schémas Postgres optionnels Phase 2).

## Options Considered

### Option A: Modular monolith (choisi)
| Dimension | Assessment |
|---|---|
| Complexité | Faible-moyenne |
| Coût ops | Faible |
| Scalabilité | Moyenne (suffit jusqu'à 10k DAU) |
| Familiarité équipe | Élevée |
| Vitesse livraison | Élevée |

**Pros:** simplicité ops, transactions ACID natives, refactoring facile, debugging direct, coût hébergement bas.
**Cons:** déploiement monolithique (mitigé par modules + tests), scaling vertical en premier.

### Option B: Microservices
**Pros:** scaling indépendant, choix techno par service.
**Cons:** complexité ops énorme (K8s + service mesh + tracing distribué + cohérence éventuelle dès J1), latence inter-service, debugging difficile, pas justifié par le volume MVP.

### Option C: Backend serverless (Lambdas + DynamoDB)
**Pros:** scalabilité auto, paiement à l'usage.
**Cons:** patterns relationnels difficiles (le modèle scolaire est très relationnel), cold start, vendor lock-in, pas aligné cahier §8.

## Trade-off Analysis

Le modular monolith offre 90% des bénéfices d'une architecture modulaire (séparation des préoccupations, testabilité, évolutivité) sans la complexité opérationnelle des microservices. Pour le volume MVP et l'équipe initiale, c'est le ratio valeur/complexité optimal.

L'option B (microservices) deviendra pertinente si on atteint > 50k DAU ou si certaines parties (paiement, messagerie) nécessitent un cycle de release indépendant. Le design avec outbox + événements typés rend cette migration future faisable module par module.

## Consequences

**Ce qui devient plus facile:**
- Transactions ACID natives entre modules (ex. publication note + audit dans la même transaction).
- Tests d'intégration sans mocks réseau.
- Onboarding développeur (un seul repo, un seul process à lancer).
- Refactoring cross-module.

**Ce qui devient plus difficile:**
- Scaling sélectif (impossible de scaler uniquement Analytics).
- Isolation panne (un crash impacte tout) → mitigé par graceful shutdown + healthchecks.
- Discipline architecturale: il faut empêcher activement les couplages directs cross-module (ESLint rule sur imports).

**À revisiter:**
- Si le volume Analytics devient dominant, extraction en service séparé partageant `packages/contracts`.
- Si la messagerie temps réel ajoute du trafic WebSocket lourd, séparer le service Notification.

## Action Items

1. [ ] Mettre en place ESLint rule `no-restricted-paths` pour interdire imports cross-module non passant par une interface publique.
2. [ ] Documenter dans `CONTRIBUTING.md` la règle "communication entre modules = interfaces + événements".
3. [ ] Créer la base `apps/worker` dès Phase 1 (même si peu de jobs au début) pour éviter mélange API/worker.
4. [ ] Mettre en place outbox pattern dès Phase 1 (table `outbox_event` + poller).
