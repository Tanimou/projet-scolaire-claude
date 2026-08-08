/**
 * Provenance client — **l'unique** seam de transfert d'`apps/web` vers l'API.
 *
 * ## Pourquoi ce fichier existe (S-E04-3 · ADR-036 · PF-31 · PF-128)
 *
 * Sur toute écriture auditée déclenchée depuis l'UI, le pair TCP vu par l'API
 * est le **conteneur web** — une adresse constante, partagée par tous les
 * acteurs, pour toujours (`PF-31`). Enregistrer cette adresse dans
 * `AuditLog.ipAddress` produit une preuve fausse : un auditeur lit « cette
 * personne a agi depuis 172.20.0.5 », ce qui n'a jamais été vrai de personne.
 *
 * `apps/web` a **deux** seams serveur vers l'API, pas un — la table de contexte
 * d'`ADR-036` n'en nomme qu'un (`PF-128`, découvert à ce sprint) :
 *
 *   1. `src/lib/api-client.ts`               — server components / server actions
 *   2. `src/app/api/proxy/[...path]/route.ts` — fetch des composants client
 *
 * Les deux appellent ce module. Aucun des deux ne ré-implémente l'extraction :
 * une seconde copie est exactement la manière dont un correctif à moitié
 * appliqué survit à sa propre revue (AC-8).
 *
 * ## La règle, et c'est tout l'argument de sécurité
 *
 * `X-Forwarded-For` est un en-tête **que le client contrôle**. Dans la route
 * proxy, le pair de la requête entrante *est le navigateur* : n'importe qui
 * peut faire `fetch('/api/proxy/…', { headers: { 'x-forwarded-for': '6.6.6.6' } })`.
 * Lire cet en-tête sans compter les sauts, puis l'estampiller de notre jeton,
 * livrerait précisément le design qu'`ADR-036 D1` refuse par écrit — « tout
 * appelant choisit ce que la piste de gouvernance retient de lui » — en le
 * faisant *paraître* digne de confiance.
 *
 * Donc l'adresse n'est lue **que** sous un nombre de sauts épinglé
 * (`WEB_TRUST_PROXY_HOPS`), qui compte les relais **devant Next** :
 *
 * - `W = 0` (local, `--profile app`) : `docker port pilotage_web` →
 *   `3000/tcp -> 0.0.0.0:3000`, publication L4 ; `nginx` porte
 *   `profiles: ["prod"]` (`infra/docker-compose.yml:539`) et ne tourne pas.
 *   **Aucun relais L7 n'existe devant Next en local**, donc tout
 *   `x-forwarded-for` reçu vient du client → il est **jeté**, aucun en-tête
 *   d'adresse n'est transmis, l'API enregistre `null`, l'UI l'énonce. C'est
 *   `ADR-036 D4` qui s'exécute correctement, pas un échec.
 * - `W = 2` (prod : Traefik → nginx → web), les deux ajoutent leur saut ; une
 *   entrée forgée par le client se retrouve **au-delà** du saut `W` et n'est
 *   jamais retenue.
 *
 * Un client réel est `chaîne[longueur - W]`. Si la chaîne observée est **plus
 * courte** que `W`, on ne sait pas qui a parlé — on renvoie `null` plutôt que
 * l'entrée de tête, qui serait la valeur forgée (le piège que « au-delà du saut
 * N » ne couvre pas : Express, lui, rembourre et retourne la tête).
 *
 * ## `x-real-ip` n'est utilisable que si nous sommes le premier relais
 *
 * nginx pose `X-Real-IP: $remote_addr` — l'adresse **qu'il a vue**. Avec
 * Traefik devant lui, c'est l'adresse de Traefik, c'est-à-dire celle d'un
 * relais : exactement ce que `D4` interdit d'enregistrer (« aucune valeur n'est
 * jamais celle du proxy »). On ne l'accepte donc que lorsque `W === 1`.
 *
 * ## Le marqueur de transfert est envoyé même quand il n'y a rien à déclarer
 *
 * Côté API, l'absence de tout en-tête `x-pilotage-*` signifie « aucun relais ne
 * revendique quoi que ce soit » et l'API retombe sur `req.ip`. Si ce module se
 * taisait faute d'adresse — le cas **normal** en local — l'API enregistrerait
 * l'adresse du conteneur web : `PF-31` reconstitué par le correctif écrit pour
 * le supprimer. `x-pilotage-forward-token` est donc **toujours** émis, y compris
 * vide quand aucun jeton n'est configuré : « je relaie, je n'ai pas de valeur
 * digne de confiance » se distingue de « je ne relaie pas ».
 *
 * ## Pourquoi le jeton n'est pas lui-même un contournement `DNC-10`
 *
 * Un jeton absent ou faux ne peut rendre la provenance que **plus nulle, jamais
 * moins**. Il ne relâche aucun contrôle, n'accorde aucun accès, et ne peut pas
 * faire enregistrer une valeur qui serait autrement restée blanche. C'est cette
 * asymétrie qui le sépare de la confiance aveugle refusée par `D1`, laquelle
 * laisse l'appelant **choisir** la valeur retenue.
 *
 * Résiduel, énoncé plutôt que caché : (a) un appelant peut envoyer un jeton
 * inexact pour forcer **sa propre** ligne à `null` — une dégradation vers
 * l'inconnu honnête, la direction sûre, et visible d'un auditeur comme une
 * absence ; (b) le jeton fait d'`apps/web` un oracle de provenance : qui lit
 * l'environnement du conteneur web peut forger une adresse. L'asymétrie tient
 * pour un extérieur, pas pour un initié disposant de l'environnement. Le jeton
 * n'est **pas** une authentification et ne doit jamais en porter le nom.
 *
 * `AUDIT_FORWARD_TOKEN` est **volontairement pas** `NEXT_PUBLIC_*` : Next inline
 * les variables `NEXT_PUBLIC_` dans le bundle navigateur, ce qui publierait le
 * secret à chaque visiteur.
 */

/**
 * Source d'en-têtes minimale. `headers()` de `next/headers` (server components)
 * et `NextRequest.headers` (route handler) satisfont tous deux cette forme —
 * c'est ce qui permet **un seul** helper pour les deux seams (`PF-128`).
 */
export interface ClientProvenanceSource {
  get(name: string): string | null;
}

export const PILOTAGE_CLIENT_IP_HEADER = 'x-pilotage-client-ip';
export const PILOTAGE_CLIENT_USER_AGENT_HEADER = 'x-pilotage-client-user-agent';
export const PILOTAGE_FORWARD_TOKEN_HEADER = 'x-pilotage-forward-token';

/**
 * Tirets, jamais tirets bas : nginx supprime par défaut les en-têtes contenant
 * un `_` (`underscores_in_headers off`). Un `x_pilotage_client_ip` serait
 * silencieusement effacé en production et **toutes** les lignes redeviendraient
 * blanches sans la moindre erreur. La forme du nom est donc porteuse.
 */
const PILOTAGE_HEADER_PREFIX = /^x-pilotage-/i;

/**
 * Plafond de la valeur transmise. L'API re-tronque via `truncateUserAgent` —
 * défense en profondeur, pas substitution. Ce plafond-ci existe pour une autre
 * raison : `undici` valide les en-têtes sortants et **jette** sur un total trop
 * gros ou sur un octet interdit. Un client scripté contrôle son propre
 * `User-Agent` ; sans nettoyage, une tentative d'injection n'injecte rien mais
 * fait planter la page d'admin.
 */
const MAX_FORWARDED_USER_AGENT_LENGTH = 512;

/**
 * Topologie la plus profonde que ce dépôt décrive (prod : Traefik → nginx →
 * web). Une valeur plus grande vaudrait « fais confiance à la tête de la
 * chaîne », c'est-à-dire la confiance aveugle refusée par `ADR-036 D1` obtenue
 * par un simple entier — la vraie façon dont quelqu'un désactiverait ce
 * mécanisme n'est pas d'ajouter un `SKIP_*`, c'est d'écrire `99`.
 */
const MAX_WEB_TRUST_PROXY_HOPS = 2;

const TRUST_PROXY_HOPS_ENV = 'WEB_TRUST_PROXY_HOPS';

let hopsCache: number | null = null;
let hopsWarned = false;

/**
 * Nombre de relais épinglé devant Next. Strict : `/^\d+$/` après `trim`, borné
 * par {@link MAX_WEB_TRUST_PROXY_HOPS}. Aucune coercition — `Number()` accepte
 * `''` → `0`, `'0x2'` → `2`, `'1e1'` → `10`, `'2.0'` → `2`, et `''` → `0` est
 * le cas catastrophique parce qu'il *ressemble* à un épinglage valide.
 *
 * **Écart assumé, et sa raison.** Côté API, une clé manquante refuse le
 * démarrage. Ici, lever à ce point-ci se produirait *au rendu d'une requête*,
 * pas au boot : la page entière renverrait 500. On retombe donc sur `0`, ce qui
 * signifie « ne fais confiance à aucun saut » — la direction sûre, celle qui
 * produit un blanc honnête et jamais une adresse de relais — et on l'énonce une
 * fois sur le journal du serveur pour que la dérive soit découvrable plutôt que
 * muette.
 */
function webTrustProxyHops(): number {
  if (hopsCache !== null) return hopsCache;
  const raw = process.env[TRUST_PROXY_HOPS_ENV];
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10);
    if (parsed <= MAX_WEB_TRUST_PROXY_HOPS) {
      hopsCache = parsed;
      return hopsCache;
    }
  }
  if (!hopsWarned) {
    hopsWarned = true;
    // Jamais la valeur observée : un message d'erreur ne doit pas recopier la
    // configuration. On nomme la variable et la forme attendue.
    console.warn(
      `[client-provenance] ${TRUST_PROXY_HOPS_ENV} absent ou mal formé ` +
        `(entier décimal 0..${MAX_WEB_TRUST_PROXY_HOPS} attendu) — aucun saut n'est ` +
        `considéré comme fiable, aucune adresse client ne sera transmise (ADR-036 D4).`,
    );
  }
  hopsCache = 0;
  return hopsCache;
}

/** Réinitialise le cache mémoïsé. Réservé aux tests. */
export function __resetClientProvenanceCacheForTests(): void {
  hopsCache = null;
  hopsWarned = false;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

/**
 * Normalise une entrée de chaîne en une adresse candidate, ou `null`.
 *
 * Les entrées réelles ne sont pas des adresses nues : `1.2.3.4:5678`,
 * `[::1]:443`, `::ffff:127.0.0.1`, et les identifiants obfusqués de la RFC 7239
 * (`unknown`, `_hidden`) circulent tous. Sans ce passage, tout client IPv6
 * deviendrait silencieusement `null` et le même client serait stocké sous deux
 * orthographes — deux formats d'une adresse satisferaient « deux adresses
 * différentes » pour la mauvaise raison.
 *
 * L'API re-valide de toute façon (`sanitiseInetOrNull`) : ici on refuse
 * simplement de transmettre un jeton manifestement invalide.
 */
export function normaliseClientAddress(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  if (value === '') return null;

  // `[::1]:443` / `[::1]` → `::1`
  // `noUncheckedIndexedAccess` est actif (`@pilotage/tsconfig/base.json`) :
  // tout accès indexé — groupe de capture ou élément de `split()` — vaut
  // `string | undefined`. On garde donc la même forme que le jumeau API
  // (`apps/api/src/shared/audit/client-hints.ts`) : `?.[1]` et un `split`
  // hissé, jamais un `!` ni trois `split()` successifs.
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed?.[1]) {
    value = bracketed[1];
  } else {
    // `1.2.3.4:5678` → `1.2.3.4` (un seul `:` ⇒ ce n'est pas de l'IPv6)
    const parts = value.split(':');
    const head = parts[0];
    if (parts.length === 2 && head !== undefined && IPV4.test(head)) {
      value = head;
    }
  }

  // IPv4 encapsulée en IPv6 (`::ffff:127.0.0.1`) : une seule orthographe
  // canonique, sinon le même client compte pour deux adresses (AC-1).
  const mapped = /^::ffff:((?:\d{1,3}\.){3}\d{1,3})$/i.exec(value);
  if (mapped?.[1]) value = mapped[1];

  if (IPV4.test(value)) return value;
  // IPv6 : forme lâche mais exclusive (hex + `:` seulement), donc `unknown`,
  // `_hidden` et tout identifiant obfusqué sont rejetés.
  if (value.includes(':') && IPV6.test(value) && value.length <= 45) return value.toLowerCase();
  return null;
}

/**
 * Adresse client réellement observable, sous le nombre de sauts épinglé.
 * Renvoie `null` — et **jamais une supposition** — dès que la chaîne ne permet
 * pas de désigner un client sans ambiguïté.
 */
export function resolveClientAddress(
  source: ClientProvenanceSource,
  hops: number = webTrustProxyHops(),
): string | null {
  // Aucun relais fiable devant Next : tout `x-forwarded-for` présent a été
  // écrit par le client lui-même. On ne transmet rien (ADR-036 D1/D4).
  if (hops < 1) return null;

  const chain = (source.get('x-forwarded-for') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');

  if (chain.length >= hops) {
    // Le client est l'entrée immédiatement à gauche des `hops` relais de
    // confiance. Tout ce qui est plus à gauche a été fourni par l'appelant.
    return normaliseClientAddress(chain[chain.length - hops]);
  }

  // Chaîne plus courte que `hops` : soit un relais n'a pas ajouté son saut,
  // soit la requête n'a pas suivi le chemin décrit. Dans les deux cas on ne
  // sait pas qui a parlé (ADR-036 D4).
  if (chain.length > 0) return null;

  // `x-real-ip` ne vaut que si nous sommes nous-mêmes le premier relais ;
  // au-delà, c'est l'adresse d'un relais, ce que D4 interdit d'enregistrer.
  if (hops === 1) return normaliseClientAddress(source.get('x-real-ip'));
  return null;
}

/**
 * Nettoie un `User-Agent` avant transmission : retire les caractères de
 * contrôle (dont `CR`/`LF`, la tentative d'injection d'en-tête), tout octet
 * hors latin-1 que `undici` refuserait, compacte les blancs et tronque.
 */
export function sanitiseOutgoingUserAgent(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let value = '';
  for (const char of raw) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      value += ' ';
      continue;
    }
    if (code > 0xff) continue;
    value += char;
  }
  value = value.replace(/\s+/g, ' ').trim();
  if (value === '') return null;
  return value.slice(0, MAX_FORWARDED_USER_AGENT_LENGTH);
}

/**
 * Valeur du jeton telle qu'elle partira sur le fil. **Aucune normalisation** :
 * la comparaison côté API est octet à octet, donc compacter les blancs ou
 * tronquer produirait un jeton qui « ressemble » au bon et ne correspond
 * jamais — une provenance nulle permanente et inexplicable. On se contente de
 * refuser les valeurs qu'`undici` rejetterait (caractères de contrôle,
 * hors-latin-1), auquel cas on émet la chaîne vide : le relais se déclare, sans
 * prétendre à une valeur digne de confiance.
 *
 * Le jeton n'est jamais journalisé, jamais renvoyé, jamais mis dans un message
 * d'erreur : il n'est lu qu'ici, et uniquement pour être posé sur la requête.
 */
function forwardTokenHeaderValue(): string {
  const raw = process.env.AUDIT_FORWARD_TOKEN;
  if (typeof raw !== 'string' || raw === '') return '';
  for (const char of raw) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x21 || code > 0xff) return '';
  }
  return raw;
}

/**
 * Retire toute clé `x-pilotage-*` d'un enregistrement d'en-têtes fourni par un
 * appelant. Sans cela, un `init.headers` malveillant (ou simplement erroné)
 * survivrait dans les cas où ce module n'émet pas la clé correspondante — la
 * fusion écrase, elle n'ajoute pas.
 *
 * La comparaison est insensible à la casse : `X-Pilotage-Client-Ip` et
 * `x-pilotage-client-ip` sont le même en-tête HTTP mais deux clés d'objet.
 */
export function stripClientProvenanceHeaders(headers: Record<string, string>): void {
  for (const key of Object.keys(headers)) {
    if (PILOTAGE_HEADER_PREFIX.test(key)) delete headers[key];
  }
}

/**
 * Construit les en-têtes de provenance à fusionner **en dernier** dans la
 * requête sortante vers l'API.
 *
 * @param source en-têtes de la requête entrante (`headers()` ou `NextRequest.headers`).
 *   `null`/`undefined` est toléré : hors d'une portée de requête, on n'invente
 *   rien et on se contente de déclarer le relais.
 */
export function clientProvenanceHeaders(
  source: ClientProvenanceSource | null | undefined,
): Record<string, string> {
  // Toujours présent : c'est ce qui distingue « je relaie sans valeur fiable »
  // de « aucun relais » côté API, et donc ce qui empêche `req.ip` (l'adresse du
  // conteneur web) d'être enregistré à notre place.
  const out: Record<string, string> = {
    [PILOTAGE_FORWARD_TOKEN_HEADER]: forwardTokenHeaderValue(),
  };
  if (!source) return out;

  const ip = resolveClientAddress(source);
  if (ip) out[PILOTAGE_CLIENT_IP_HEADER] = ip;

  const userAgent = sanitiseOutgoingUserAgent(source.get('user-agent'));
  if (userAgent) out[PILOTAGE_CLIENT_USER_AGENT_HEADER] = userAgent;

  return out;
}
