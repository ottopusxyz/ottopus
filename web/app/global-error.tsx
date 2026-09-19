'use client'

/**
 * The last boundary: the root layout itself failed to render.
 *
 * Next replaces the root layout with this, so nothing the layout provided
 * exists here — no fonts, no global stylesheet, no theme, no providers. That
 * is why this file draws its own <html> and <body> and styles inline; a class
 * name would be a promise nothing is around to keep. It says the one thing
 * that matters and offers the one thing that can help.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#f6f8fb',
          color: '#0f1b2d',
          padding: 24,
        }}
      >
        <div role="alert" style={{ maxWidth: 360, textAlign: 'center' }}>
          <p style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>Ottopus could not draw this page</p>
          <p style={{ fontSize: 13, lineHeight: 1.5, margin: '0 0 16px', color: '#4a5a70' }}>
            Nothing was signed and no request was built. Reloading is safe.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              font: 'inherit',
              fontSize: 13,
              fontWeight: 600,
              padding: '8px 14px',
              borderRadius: 999,
              border: '1px solid #c9d3e0',
              background: '#fff',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ marginTop: 12, fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#7a8798' }}>{error.digest}</p>
          ) : null}
        </div>
      </body>
    </html>
  )
}
