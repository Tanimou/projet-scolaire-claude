import './globals.css';

import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';

/**
 * S-E06-2 / PF-45 — TOUTES les routes sont rendues à la demande.
 *
 * La politique de sécurité du contenu porte un **nonce par réponse**
 * (`middleware.ts`). Un nonce n'a de sens que si le HTML servi le porte aussi, et
 * une page pré-rendue au build ne le peut pas : son HTML est figé avant que la
 * requête — donc avant que le nonce — existe.
 *
 * **Mesuré, pas supposé.** Avec la politique en place et cette ligne absente,
 * `GET /admin/login` sur la pile locale renvoyait `x-nextjs-cache: HIT`,
 * `x-nextjs-prerender: 1` et `Cache-Control: s-maxage=31536000`, pour un document
 * contenant **21 balises `<script>` dont 0 portant un nonce** — 15 externes et 6
 * en ligne (la charge utile RSC `self.__next_f.push`). Ce n'est pas une
 * dégradation : avec `'strict-dynamic'` la source `'self'` est ignorée par les
 * navigateurs CSP3, donc les 21 scripts sont bloqués et la page de connexion est
 * morte. Sans `'strict-dynamic'`, les 15 externes passent et les 6 en ligne
 * restent bloqués : l'hydratation échoue et le formulaire ne répond pas. Les deux
 * variantes cassent, ce qui écarte l'idée de relâcher la politique pour rattraper
 * le cache.
 *
 * **La règle est posée ici, au layout racine, et pas route par route.** Les 14
 * routes pré-rendues étaient `/`, `/_not-found`, les 6 pages de connexion /
 * inscription et 5 redirections héritées ; énumérer ces adresses laisserait la
 * quinzième — la prochaine page statique que quelqu'un ajoutera — casser en
 * silence, et le symptôme (une page qui s'affiche mais ne réagit pas) ne
 * ressemble pas à une erreur de CSP. `scripts/csp-check.js` refuse désormais tout
 * artefact où une route pré-rendue émet un `<script>`.
 *
 * Coût, dit franchement : `/` et les pages de connexion sont rendues à chaque
 * requête. 94 des 108 routes l'étaient déjà (elles lisent `headers()` ou
 * `auth()`), donc la perte porte sur 8 pages sans données — et elle achète la
 * seule propriété dont dépend toute la politique.
 */
export const dynamic = 'force-dynamic';

const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
  weight: ['500'],
});

export const metadata: Metadata = {
  title: {
    default: 'Pilotage scolaire — Le suivi scolaire qui rapproche école et famille',
    template: '%s · Pilotage scolaire',
  },
  description:
    "Plateforme de pilotage scolaire pour parents, professeurs et administrations. Notes, tendances, alertes explicables, recommandations d'action.",
  applicationName: 'Pilotage scolaire',
  authors: [{ name: 'Pilotage scolaire' }],
  generator: 'Next.js',
  keywords: ['école', 'éducation', 'notes', 'suivi scolaire', 'parents', 'professeurs'],
  referrer: 'origin-when-cross-origin',
  formatDetection: { email: false, address: false, telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
