# Wireframes — Landing publique & 3 portails d'authentification

> Source pour l'implémentation. Chaque écran décrit en ASCII + spec composants + comportement.

---

## 1. Landing page publique (`/`)

**Objectif:** porte d'entrée vers les 3 portails, présenter le produit, conformité légale.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [Logo Pilotage scolaire]      Produit  Tarifs  Aide       [Connexion ▼]  │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│           Pilotage scolaire                                              │
│                                                                          │
│      Le suivi scolaire qui rapproche école et famille.                  │
│                                                                          │
│      Notes, tendances, alertes explicables, recommandations              │
│      d'action — pour chaque enfant, en temps réel.                       │
│                                                                          │
│      [ Je suis parent ]   [ Je suis professeur ]   [ Je suis admin ]    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│   Comment ça marche ?                                                    │
│                                                                          │
│   👨‍👩‍👧 Parent              👨‍🏫 Professeur            🏛️ Administration   │
│   ────────────              ──────────────             ──────────────    │
│   Suivez l'évolution        Planifiez, notez,          Configurez       │
│   scolaire de votre         publiez. Suivez            l'établissement, │
│   enfant. Recevez des       vos classes.               validez          │
│   alertes explicables.                                  inscriptions.    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│   Sécurité & confidentialité                                            │
│                                                                          │
│   🔒 Chiffrement bout-en-bout    🇫🇷 Hébergement souverain               │
│   👶 Protection enfants RGPD     🔐 MFA pour tous les acteurs           │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│   FAQ  |  Mentions légales  |  Confidentialité  |  Cookies  |  Contact  │
└──────────────────────────────────────────────────────────────────────────┘
```

**Composants:** `<Hero>`, `<FeatureGrid>`, `<TrustSection>`, `<Footer>`.

**CTAs:**
- "Je suis parent" → `/parent/login`
- "Je suis professeur" → `/teacher/login`
- "Je suis admin" → `/admin/login`
- "Connexion ▼" header → dropdown vers les 3 portails

**Comportement:**
- Si déjà loggué, header affiche "Mon espace" → redirige vers le portail correspondant au rôle dominant.
- Bandeau cookies en bas (consent management).

---

## 2. Portail Admin — `/admin/login`

```
┌────────────────────────────────────────────────────────┐
│  [← Retour à l'accueil]                                │
├────────────────────────────────────────────────────────┤
│                                                        │
│                  [Logo Pilotage]                       │
│                                                        │
│              Portail Administrateur                    │
│              Connectez-vous pour gérer l'école         │
│                                                        │
│      ┌────────────────────────────────────────┐        │
│      │ Email                                   │        │
│      │ ────────────────────────────────────── │        │
│      │ Mot de passe                    👁     │        │
│      │ ────────────────────────────────────── │        │
│      │                                         │        │
│      │  Mot de passe oublié ?                  │        │
│      │                                         │        │
│      │  [ Se connecter ]                       │        │
│      │                                         │        │
│      │  ─── ou ───                             │        │
│      │                                         │        │
│      │  [G] Continuer avec Google              │        │
│      │  [⊞] Continuer avec Microsoft           │        │
│      │                                         │        │
│      └────────────────────────────────────────┘        │
│                                                        │
│      Vous avez reçu une invitation ?                   │
│      → [ Créer mon compte ]                            │
│                                                        │
│      ─────────────────────────                          │
│      Vous êtes parent ?    → /parent/login             │
│      Vous êtes prof ?      → /teacher/login            │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Composants:** `<AuthLayout portal="admin">`, `<LoginForm>`, `<SSOButtons>`, `<PortalSwitchLinks>`.

**Comportement:**
- Submit POST `/api/v1/auth/login` → si succès, vérification MFA → redirect `/admin/dashboard`.
- MFA TOTP demandé après mot de passe (admin obligatoire).
- Si email valide mais pas admin → message "Ce compte n'est pas administrateur. Essayez le portail [parent / professeur]."
- Rate-limit: 5 tentatives / 15 min par IP + 5 / 15min par email.
- Si invité (`?invite=token`), pré-remplir email, afficher contexte invitation.

---

## 3. Portail Admin — `/admin/register` (sur invitation uniquement)

```
┌────────────────────────────────────────────────────────┐
│                                                        │
│                Création de votre compte                │
│                                                        │
│   Vous êtes invité par {{inviterName}} à rejoindre     │
│   l'établissement {{schoolName}} en tant que           │
│   {{role}}.                                            │
│                                                        │
│   ┌────────────────────────────────────────┐           │
│   │ Prénom                                  │           │
│   │ ─────────────────────────────────────── │           │
│   │ Nom                                     │           │
│   │ ─────────────────────────────────────── │           │
│   │ Email (pré-rempli, modifiable: non)     │           │
│   │ ─────────────────────────────────────── │           │
│   │ Mot de passe       [indicateur force]   │           │
│   │ ─────────────────────────────────────── │           │
│   │ Confirmer le mot de passe               │           │
│   │ ─────────────────────────────────────── │           │
│   │ ☐ J'accepte les CGU et la politique     │           │
│   │   de confidentialité                    │           │
│   │ ☐ J'accepte de recevoir les notifs      │           │
│   │   email                                  │           │
│   │                                         │           │
│   │  [ Créer mon compte ]                   │           │
│   └────────────────────────────────────────┘           │
└────────────────────────────────────────────────────────┘
```

**Comportement:**
- Token d'invitation validé côté serveur avant affichage (sinon page d'erreur).
- Email non-modifiable (vient de l'invitation).
- Indicateur force mot de passe en temps réel.
- Après création → écran de configuration MFA obligatoire (admin).
- Après MFA OK → connexion + redirect `/admin/dashboard`.

---

## 4. Portail Teacher — `/teacher/login`

Identique à `/admin/login` avec:
- Titre: "Portail Professeur"
- Couleur d'accent teal
- "Vous avez reçu une invitation ?" → idem
- Liens bascule vers admin/parent

---

## 5. Portail Teacher — `/teacher/register` (sur invitation)

Identique à `/admin/register`, sans le checkbox notifications (configurable plus tard dans profil). MFA enrôlement obligatoire.

---

## 6. Portail Parent — `/parent/login`

```
┌────────────────────────────────────────────────────────┐
│                                                        │
│                  [Logo Pilotage]                       │
│                                                        │
│                  Portail Famille                       │
│        Connectez-vous pour suivre votre enfant         │
│                                                        │
│   ┌────────────────────────────────────────┐           │
│   │ Email                                   │           │
│   │ ─────────────────────────────────────── │           │
│   │ Mot de passe                  👁        │           │
│   │ ─────────────────────────────────────── │           │
│   │ Mot de passe oublié ?                   │           │
│   │                                         │           │
│   │  [ Se connecter ]                       │           │
│   │                                         │           │
│   │  ─── ou ───                             │           │
│   │                                         │           │
│   │  [G] Continuer avec Google              │           │
│   │                                         │           │
│   └────────────────────────────────────────┘           │
│                                                        │
│   Pas encore de compte ?                               │
│   → [ Créer un compte famille ]                        │
│                                                        │
│   ────────────────────────                              │
│   Vous êtes prof ?      → /teacher/login               │
│   Vous êtes admin ?     → /admin/login                 │
└────────────────────────────────────────────────────────┘
```

**Différences:**
- "Créer un compte famille" → self-service registration (vs invitation pour admin/teacher).
- MFA recommandé mais pas obligatoire.

---

## 7. Portail Parent — `/parent/register` (self-service)

```
┌────────────────────────────────────────────────────────┐
│                                                        │
│              Créer votre compte famille                │
│                                                        │
│   Suivez l'évolution scolaire de votre enfant en      │
│   quelques clics.                                      │
│                                                        │
│   ┌────────────────────────────────────────┐           │
│   │ Étape 1 / 3 — Vos informations          │           │
│   │ ──────────────────────────────────────  │           │
│   │ Prénom                                  │           │
│   │ ────                                    │           │
│   │ Nom                                     │           │
│   │ ────                                    │           │
│   │ Email                                   │           │
│   │ ────                                    │           │
│   │ Téléphone (optionnel)                   │           │
│   │ ────                                    │           │
│   │ Mot de passe   [force]                  │           │
│   │ ────                                    │           │
│   │ Confirmer                               │           │
│   │ ────                                    │           │
│   │ ☐ J'accepte les CGU                     │           │
│   │ ☐ J'accepte la politique conf.          │           │
│   │ ☐ Notifications email                   │           │
│   │                                         │           │
│   │  [ Continuer ]                          │           │
│   └────────────────────────────────────────┘           │
│                                                        │
│   Déjà un compte ? → Se connecter                      │
└────────────────────────────────────────────────────────┘
```

**Étape 2 / 3 — Vérification email:**
```
   📧 Email envoyé à {{email}}
   Cliquez sur le lien pour vérifier votre adresse.
   [ Renvoyer l'email ]   [ Modifier l'adresse ]
```

**Étape 3 / 3 — Rattacher un enfant (optionnel, peut être fait plus tard):**
```
   Rattacher mon enfant
   ─────────────────────
   Code école *      [ ____________ ]   (?) où trouver ce code
   Nom de l'enfant   [ ____________ ]
   Prénom            [ ____________ ]
   Date de naissance [ JJ/MM/AAAA ]
   Lien de parenté   [ Mère ▼ ]
                      Père / Tuteur légal / Autre

   [ Soumettre la demande ]      [ Plus tard ]
```

**Comportement:**
- `Code école` est un identifiant court (8 caractères) que l'école communique aux parents.
- Une fois soumis → `guardianship_request` en pending → admin valide.
- L'utilisateur peut entrer plusieurs enfants successivement.
- Si "Plus tard" → atterrit sur `/parent/dashboard` avec onboarding empty-state qui invite à rattacher un enfant.

---

## 8. `/[portal]/forgot-password` (identique 3 portails)

```
   Réinitialiser votre mot de passe

   Indiquez l'email associé à votre compte. Nous vous
   enverrons un lien pour définir un nouveau mot de passe.

   Email   [ ______________ ]

   [ Envoyer le lien ]

   ─────────
   ← Retour à la connexion
```

**Comportement:**
- Toujours répondre "Si cet email existe, vous recevrez un lien" (évite énumération).
- Lien à TTL 1h, single-use.

---

## 9. `/[portal]/reset-password?token=...`

```
   Définir un nouveau mot de passe

   Nouveau mot de passe   [ ____________ ]   [force]
   Confirmer              [ ____________ ]

   [ Mettre à jour ]
```

**Comportement:**
- Vérifie token, expire en cas de réutilisation, invalide tous sessions actives après succès.

---

## 10. `/[portal]/verify-email?token=...`

```
   ✓ Email vérifié !
   Vous pouvez maintenant vous connecter.
   [ Se connecter ]
```

---

## 11. Accept invite — `/[portal]/accept-invite?token=...`

Affiche le contexte (inviter, école, rôle) et propose:
- Si compte existe avec cet email: "Se connecter et accepter"
- Sinon: "Créer mon compte" (formulaire register pré-rempli)

---

## 12. MFA Enrôlement (admin/teacher obligatoire)

Après création compte ou première connexion sans MFA:

```
   Sécurisez votre compte

   En tant que {{role}}, l'authentification à deux
   facteurs est requise pour protéger les données
   scolaires des élèves.

   Étape 1: Installer une app TOTP
   • Google Authenticator
   • Authy
   • 1Password
   • Microsoft Authenticator

   Étape 2: Scanner ce QR code
   [QR CODE]
   ou saisir manuellement: {{secret}}

   Étape 3: Saisir le code à 6 chiffres
   [ ______ ]

   [ Activer la 2FA ]

   ⚠️ Codes de secours
   Conservez ces codes en lieu sûr. Ils permettent
   d'accéder à votre compte si vous perdez votre
   téléphone.
   [Liste 10 codes]
   [ Télécharger en PDF ]   [ Copier ]
```

---

## 13. États d'erreur

| Code | Page / Message |
|---|---|
| 401 — non auth | Redirect login portail |
| 403 — mauvais rôle | "Vous n'avez pas accès à ce portail. Essayez le portail [X]." + lien |
| 404 — route inconnue | Page 404 portail-aware avec lien retour dashboard |
| 500 — serveur | Page erreur générique + bouton "Réessayer" + contact support |
| Offline | Banner top + composants se mettent en read-only |
| Maintenance | Page maintenance globale avec ETA |
