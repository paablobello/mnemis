'use client';

export default function GlobalError() {
  return (
    <html lang="en">
      <body>
        <main className="public-shell">
          <section className="public-hero">
            <div className="brand-mark">
              <span>Mnemis</span>
            </div>
            <h1>Something went wrong.</h1>
            <p>Refresh the page or return to the dashboard.</p>
            <div className="hero-actions">
              <a className="primary-action" href="/dashboard">
                Dashboard
              </a>
              <a className="secondary-action" href="/">
                Home
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
