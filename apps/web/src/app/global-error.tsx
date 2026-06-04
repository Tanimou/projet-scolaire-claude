'use client';

import { useEffect } from 'react';

/**
 * Ultimate fallback — only renders when the ROOT layout itself throws, so it
 * must be fully self-contained (it replaces <html>/<body> and cannot rely on
 * the app's global CSS). Inline styles keep it dependency-free.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global-error]', error);
  }, [error]);

  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc',
          color: '#0f172a',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        }}
      >
        <div style={{ maxWidth: 420, padding: 32, textAlign: 'center' }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Une erreur est survenue</h1>
          <p style={{ marginTop: 8, fontSize: 14, color: '#64748b' }}>
            L’application a rencontré un problème inattendu. Réessayez dans un instant.
          </p>
          {error?.digest ? (
            <p style={{ marginTop: 12, fontFamily: 'monospace', fontSize: 12, color: '#94a3b8' }}>
              Référence : {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 24,
              height: 40,
              padding: '0 16px',
              borderRadius: 8,
              border: 'none',
              background: '#0f172a',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  );
}
