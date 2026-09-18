// Marketing hero for the auth screen. Static presentation. Extracted verbatim
// from AuthView.
const FEATURES: [string, string, string][] = [
  ['✓', 'Multi-level verification', 'Syntax, DNS, MX, SMTP, disposable, role & catch-all detection in one pass.'],
  ['◎', 'Explainable results', 'Every risky address gets a plain-language reason and a clear recommendation.'],
  ['♥', 'List health score', 'A single 0–100 score with deliverability, data-quality, risk & domain metrics.'],
  ['↻', 'Ongoing monitoring', 'Scheduled re-verification, health-drop alerts, and history over time.'],
];

export function AuthHero() {
  return (
    <section className="hero">
      <h1 className="brand-lg" style={{ fontSize: 34 }}>
        Mail<span>Health</span>
      </h1>
      <p className="hero-lead">Know which emails are safe to send — and why.</p>
      <p className="hero-sub">
        Upload your list. Understand its health. See which contacts to keep, review, or remove, with a clear
        reason for each. Beyond valid/invalid.
      </p>
      <div className="feature-grid">
        {FEATURES.map(([ic, t, d]) => (
          <div className="feature" key={t}>
            <div className="feature-ic">{ic}</div>
            <div>
              <b>{t}</b>
              <div className="muted">{d}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
