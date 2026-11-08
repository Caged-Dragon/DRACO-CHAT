import ThemeToggle from '../components/ThemeToggle.jsx';

const FEATURES = [
  {
    title: 'Real-time chat',
    text: 'Messages land instantly on both sides — no refreshing, no waiting.',
    icon: '💬',
  },
  {
    title: 'Friend requests',
    text: 'Search for people, send a request, and chat once they accept.',
    icon: '🤝',
  },
  {
    title: 'Secure by default',
    text: 'Email verification, OAuth login, and password reset built in.',
    icon: '🔒',
  },
];

export default function Landing({ onGetStarted, onLogin }) {
  return (
    <div className="landing">
      <div className="landing-glow landing-glow-1" />
      <div className="landing-glow landing-glow-2" />

      <nav className="landing-nav">
        <div className="brand">
          <img src="/logo.png" alt="Dragon Chat" className="brand-logo" />
          <span className="brand-name">Dragon Chat</span>
        </div>
        <div className="landing-nav-actions">
          <ThemeToggle />
          <button className="landing-nav-login" onClick={onLogin}>
            Log in
          </button>
        </div>
      </nav>

      <main>
      <section className="landing-hero">
        <img src="/logo.png" alt="Dragon Chat" className="landing-logo" />
        <h1 className="landing-title">Dragon Chat</h1>
        <p className="landing-tagline">Connect Different. Chat Real.</p>
        <p className="landing-sub">
          A fast, friendly place to talk to the people who matter — built by
          Caged Dragon Studios.
        </p>
        <div className="landing-cta-row">
          <button className="landing-cta primary" onClick={onGetStarted}>
            Get Started
          </button>
          <button className="landing-cta secondary" onClick={onLogin}>
            I already have an account
          </button>
        </div>
      </section>

      <section className="landing-features">
        {FEATURES.map((f, i) => (
          <div
            className="landing-feature-card"
            key={f.title}
            style={{ animationDelay: `${0.15 * i}s` }}
          >
            <div className="landing-feature-icon">{f.icon}</div>
            <h2>{f.title}</h2>
            <p>{f.text}</p>
          </div>
        ))}
      </section>

      </main>
      <footer className="landing-footer">
        <img src="/logo-full.png" alt="Caged Dragon Studios - Unleash Possibilities" className="studio-logo" width="150" height="150" />
        <p className="studio-credit">Built by Caged Dragon Studios</p>
        <p className="legal-links">
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
          {' · '}
          <a href="/terms.html" target="_blank" rel="noopener noreferrer">Terms &amp; Conditions</a>
        </p>
      </footer>
    </div>
  );
}
