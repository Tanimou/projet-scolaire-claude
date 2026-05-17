export const LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'fr';

export async function loadMessages(locale: Locale): Promise<Record<string, string>> {
  switch (locale) {
    case 'fr':
      return (await import('./messages/fr.json')).default;
    case 'en':
      return (await import('./messages/en.json')).default;
    default:
      return (await import('./messages/fr.json')).default;
  }
}
