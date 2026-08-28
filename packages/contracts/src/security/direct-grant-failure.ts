/**
 * S-E05-8 / PF-25 half (a) / ADR-082 §D1 — LA taxonomie des échecs du grant
 * direct (ROPC) Keycloak, déclarée UNE FOIS, ici, et nulle part ailleurs.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CETTE FONCTION NE PEUT PAS FAIRE, ET POURQUOI C'EST LE CORRECTIF
 * ---------------------------------------------------------------------------
 * Elle NE PEUT PAS distinguer un mot de passe erroné d'un code TOTP erroné ou
 * manquant, PARCE QUE KEYCLOAK NE LE DIT PAS : dans le grant
 * `password` (Resource Owner Password Credentials), les deux répondent
 * `401 / invalid_grant / "Invalid user credentials"`. Aucune information
 * observable ne sépare les deux cas. C'est pour cela que le membre s'appelle
 * `credentials-or-otp-rejected` : L'AMBIGUÏTÉ EST PORTÉE PAR LE NOM, afin
 * qu'aucune lecture ultérieure n'y lise une certitude.
 *
 * Le défaut fermé par ce module est exactement l'inverse de cette prudence :
 * `apps/web/src/auth.ts:193-209` (sur HEAD, avant cette tranche) testait
 * `description.includes('credential')` AVANT la branche 401/`invalid_grant`, si
 * bien que la chaîne MESURÉE `"Invalid user credentials"` — qui contient
 * `credential` — classait toute FAUTE DE FRAPPE en « OTP requis ». La règle de
 * correspondance qui l'interdit est écrite ici et vaut pour toute évolution de
 * cette table : ON N'ANCRE JAMAIS SUR UNE AIGUILLE QUI EST SOUS-CHAÎNE PROPRE
 * D'UNE AUTRE PHRASE ATTENDUE. On ancre sur la phrase MESURÉE, entière.
 *
 * ---------------------------------------------------------------------------
 * PROVENANCE DES CHAÎNES — LES DEUX N'ONT PAS LE MÊME GRADE DE PREUVE
 * ---------------------------------------------------------------------------
 * a) `"Invalid user credentials"` — **MESURÉE**. Observée par cette routine au
 *    run 63 (2026-08-15) contre un conteneur Keycloak 26.0 jetable important
 *    `infra/keycloak/realm-export.json`, candidat A →
 *    `HTTP 401 Invalid user credentials`. Consignée verbatim à
 *    `docs/daily-improvement-v3/traceability/CLOSED-L0.md:123` (ligne PF-228).
 *
 * b) `"Account is not fully set up"` — **NON MESURÉE PAR CETTE ROUTINE**. Elle
 *    est AFFIRMÉE par un commentaire du dépôt,
 *    `apps/api/src/modules/identity/register.controller.ts:241`, qui documente
 *    que laisser des `requiredActions` en attente fait répondre cela au ROPC.
 *    Grade : documentée en interne, jamais observée. Décharge prévue :
 *    `scripts/keycloak-live-probe.js` STEP 6, expédié **NOT EXECUTED**
 *    (Docker Desktop refuse de démarrer, 7ᵉ run consécutif).
 *    Présenter (a) et (b) comme également fondées serait blanchir du folklore
 *    en mesure ; c'est pourquoi les deux grades sont écrits séparément.
 *
 * ---------------------------------------------------------------------------
 * PRÉMISSE P-1, NON VÉRIFIÉE, ET CE QU'ELLE COMMANDE (ADR-082 §D3, PF-444)
 * ---------------------------------------------------------------------------
 * P-1 : Keycloak ne répond `"Account is not fully set up"` qu'APRÈS avoir
 * validé le mot de passe ; un mot de passe faux court-circuite d'abord vers
 * `"Invalid user credentials"`. SI P-1 tient, `account-setup-pending` ne
 * divulgue rien à un appelant qui n'a pas déjà PROUVÉ le mot de passe, et n'est
 * donc pas un oracle d'existence de compte. P-1 est RAISONNÉE depuis la
 * sémantique du grant, **pas mesurée ici**. Décharge : STEP 6 « mint C » de la
 * sonde (mot de passe FAUX contre un utilisateur ayant `CONFIGURE_TOTP` en
 * attente) — c'est l'unique observation qui la tranche.
 *
 * CONTINGENCE PRÉ-DÉCIDÉE, une ligne, si P-1 est falsifiée : le RENDU des deux
 * membres est collapsé en une seule chaîne côté `apps/web` ; la taxonomie, elle,
 * GARDE la distinction (les tests, le cliquet et la tranche future qui mesurera
 * vraiment le MFA en ont besoin).
 *
 * ---------------------------------------------------------------------------
 * CE QUI TOMBE DANS `unclassified`, ÉNONCÉ PLUTÔT QU'IMPLICITE
 * ---------------------------------------------------------------------------
 * • 5xx, passerelle en erreur, corps illisible, `error` inconnu
 *   (`invalid_client`, `unauthorized_client`, …), réponse sans statut 401 :
 *   « aucune réponse exploitable ». Keycloak indisponible ne doit JAMAIS se
 *   lire « mot de passe erroné » — d'où ce membre distinct, et non un repli sur
 *   le membre ambigu.
 * • VERROUILLAGE DE COMPTE (résiduel NOMMÉ, non mesuré) : la politique du realm
 *   verrouille après 5 tentatives (`apps/web/src/app/admin/settings/page.tsx`).
 *   Un compte temporairement désactivé répond `invalid_grant` avec une phrase de
 *   la famille `"Account is disabled"` / `"Account temporarily disabled"`. Aucune
 *   de ces phrases ne contient l'ancre de la règle (1), donc elle atterrit sur
 *   `credentials-or-otp-rejected` — DÉLIBÉRÉMENT, et pour la même raison que le
 *   membre existe : sans mesure, un membre « verrouillé » distinct serait un
 *   oracle inventé. C'est un résiduel enregistré, pas un oubli ; sa décharge est
 *   la même sonde.
 *
 * ---------------------------------------------------------------------------
 * CONTRAINTES DE FORME — POURQUOI CE FICHIER N'IMPORTE RIEN
 * ---------------------------------------------------------------------------
 * `apps/web/src/middleware.ts:1-8` importe déjà des VALEURS de ce répertoire
 * (`buildWebCsp`, `generateCspNonce`) et s'exécute sur le runtime EDGE ; le
 * consommateur de ce module, `apps/web/src/auth.ts`, est tiré dans ce même
 * bundle par `middleware.ts:11`. Un module qui échouerait au chargement là
 * casserait TOUTES les routes des quatre portails, pas une page. Donc, comme
 * `csp.ts`, `csv-injection.ts` et `branding-css.ts` : zéro dépendance (pas même
 * `zod`), aucune classe, aucun `instanceof` — la couture CJS `src`/`dist` rend
 * l'identité de classe non fiable à travers la frontière du paquet, alors qu'une
 * chaîne d'union l'est toujours.
 *
 * CE QUE CE MODULE NE PRÉTEND PAS FAIRE (G-DNC / DNC-06) : il ne décide d'AUCUNE
 * autorisation, n'ouvre aucun chemin de succès, et ne convertit jamais un échec
 * en session. Il traduit une réponse d'échec OBSERVÉE en un code de message.
 */

/**
 * L'union FERMÉE des issues d'un grant direct EN ÉCHEC.
 *
 * Ce n'est PAS le domaine des issues de connexion : `wrong_portal` est décidé
 * APRÈS un jeton émis avec succès, depuis les revendications décodées
 * (`apps/web/src/auth.ts`), et n'entre donc pas ici — l'y admettre rendrait le
 * contrat d'entrée de cette fonction mensonger.
 */
export type DirectGrantFailureCode =
  /**
   * Identifiants refusés. AMBIGU PAR CONSTRUCTION : mot de passe faux, OU code
   * TOTP faux/absent. Keycloak répond la même chose aux deux.
   */
  | 'credentials-or-otp-rejected'
  /**
   * Le compte existe et son mot de passe a été accepté, mais des actions
   * requises restent en attente (`UPDATE_PASSWORD`, `CONFIGURE_TOTP` — posées à
   * l'invitation, `apps/api/src/modules/identity/invite.controller.ts`).
   */
  | 'account-setup-pending'
  /** Aucune réponse exploitable : 5xx, corps illisible, `error` inconnu. */
  | 'unclassified';

/**
 * Les membres de l'union, comme valeur runtime.
 *
 * Source UNIQUE : les consommateurs et le cliquet la LISENT, ils ne la
 * ré-écrivent pas. Une seconde liste écrite à la main est exactement la dérive
 * que cette tranche ferme.
 */
export const DIRECT_GRANT_FAILURE_CODES: readonly DirectGrantFailureCode[] = [
  'credentials-or-otp-rejected',
  'account-setup-pending',
  'unclassified',
] as const;

/** La réponse d'échec, telle qu'elle est OBSERVABLE — rien de plus. */
export interface DirectGrantFailureInput {
  /** Statut HTTP de la réponse jeton. */
  status: number;
  /** Champ `error` du corps OAuth2, s'il a pu être lu. */
  error?: string | null;
  /** Champ `error_description` du corps OAuth2, s'il a pu être lu. */
  errorDescription?: string | null;
}

/**
 * La phrase ENTIÈRE et ancrée de la règle (1). Jamais une aiguille : `setup`,
 * `account` ou `not fully` seuls apparaîtraient dans d'autres messages.
 * Provenance : (b) ci-dessus — NON MESURÉE.
 */
const ACCOUNT_SETUP_PENDING_PHRASE = 'account is not fully set up';

/**
 * La valeur `error` OAuth2 que Keycloak renvoie pour un refus d'identifiants.
 * Provenance : (a) ci-dessus — MESURÉE au run 63.
 */
const INVALID_GRANT = 'invalid_grant';

/**
 * Normalisation : minuscules, espaces blancs compressés, extrémités coupées.
 *
 * Elle rend la comparaison insensible à la casse et au ré-emballage d'espaces
 * (un `\n` dans un corps proxyfié ne doit pas changer le verdict) et à RIEN
 * d'autre : aucune ponctuation n'est retirée, aucun accent replié. Une
 * normalisation plus large re-créerait des collisions de sous-chaînes, qui sont
 * précisément le défaut fermé.
 */
function normalise(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Classe une réponse de grant direct EN ÉCHEC.
 *
 * LES DEUX PRÉDICATS SONT DISJOINTS PAR CONSTRUCTION — la règle (2) exclut
 * explicitement la phrase de la règle (1). Permuter l'ordre des règles ne change
 * donc AUCUN verdict, et c'est la propriété dont l'absence était tout le défaut :
 * la cascade d'origine dépendait de son ordre sur des aiguilles qui se
 * chevauchaient.
 *
 * TOTALE : toute entrée, y compris `{status: NaN}` ou des champs absents, rend
 * un membre de `DIRECT_GRANT_FAILURE_CODES`. Une entrée non reconnue dégrade
 * vers `unclassified` — jamais vers un membre confiant (échec FERMÉ).
 */
export function classifyDirectGrantFailure(
  input: DirectGrantFailureInput,
): DirectGrantFailureCode {
  const description = normalise(input.errorDescription);
  const error = normalise(input.error);

  // (1) Actions requises en attente. Phrase ENTIÈRE, jamais une aiguille.
  if (description.includes(ACCOUNT_SETUP_PENDING_PHRASE)) {
    return 'account-setup-pending';
  }

  // (2) Refus d'identifiants — AMBIGU (mot de passe ou OTP). Le `!includes`
  //     ci-dessus est déjà acquis : c'est ce qui rend les deux prédicats
  //     disjoints et l'ordre non porteur.
  if (input.status === 401 || error === INVALID_GRANT) {
    return 'credentials-or-otp-rejected';
  }

  // (3) Rien d'exploitable. Keycloak à terre ne se lit pas « mot de passe faux ».
  return 'unclassified';
}
