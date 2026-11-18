// Sicherheits-Header und Fehlerbehandlung für alle Antworten der Anwendung (Design-Regeln, Abschnitt 2 und 12).
// Caddy setzt davor schon einige Header; die Anwendung setzt sie selbst ebenfalls, damit sie auch ohne Caddy gelten.

// Die Oberfläche lädt nur eigene Dateien, ohne Inline-Skripte und ohne Inline-Stile.
// Die Karte (MapLibre) startet ihre Arbeitsprozesse aus blob:-Adressen (worker-src); die Wärmekarte ist ein data:-Bild, das MapLibre per fetch lädt (daher connect-src data:).
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

/** testinstanz: true bittet Suchmaschinen bei jeder Antwort, die Seite nicht aufzunehmen */
export function sicherheitsHeader({ testinstanz = false } = {}) {
  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (testinstanz) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    // Antworten, die zu einer Garage gehören, dürfen nirgends zwischengespeichert werden
    if (req.path.startsWith('/api/v1/garage') || req.path.startsWith('/api/v1/zugang') || req.path.startsWith('/api/v1/email') || req.path.startsWith('/api/admin')) res.setHeader('Cache-Control', 'no-store');
    next();
  };
}

/** Fehler als JSON statt der Standardseite von Express; keine Interna nach außen */
// eslint-disable-next-line no-unused-vars
export function fehlerAntwort(err, req, res, next) {
  if (res.headersSent) return next(err);
  // Fehler mit Schlüssel (FehlerEingabe) sind gewollte Antworten und geben Schlüssel und Feldhinweise weiter
  if (Number.isInteger(err?.status) && err.status >= 400 && err.status <= 503 && typeof err.code === 'string' && /^[a-z_]+$/.test(err.code)) {
    return res.status(err.status).json({ error: err.message, code: err.code, ...(err.felder ? { felder: err.felder } : {}) });
  }
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) {
    console.error(err);
    return res.status(500).json({ error: 'Interner Fehler' });
  }
  const text = status === 413 ? 'Die Anfrage ist zu groß.' : 'Ungültige Anfrage';
  res.status(status).json({ error: text });
}
