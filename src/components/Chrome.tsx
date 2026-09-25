import { navigate, type Route } from '../app/router';
import { Wordmark } from './ui';

const NAV: { route: Route; label: string }[] = [
  { route: 'method', label: 'Method' },
  { route: 'library', label: 'Instruments' },
];

export function Header({ current }: { current?: Route }) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a
          className="site-home"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('home');
          }}
        >
          <Wordmark />
        </a>
        <nav className="site-nav" aria-label="Primary">
          {NAV.map((n) => (
            <a
              key={n.route}
              href={`#${n.route}`}
              className={`site-nav-link ${current === n.route ? 'is-current' : ''}`}
              aria-current={current === n.route ? 'page' : undefined}
            >
              {n.label}
            </a>
          ))}
          <a href="#setup" className="site-nav-cta">
            Begin
          </a>
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <Wordmark />
          <p>An experimental assessment instrument by Javelin. Estimates performance on the measured constructs. Not a clinical, diagnostic or hiring test.</p>
        </div>
        <div className="site-footer-meta mono">
          <span>v1.0 · provisional parameters</span>
          <span>Data stays on this device</span>
          <a href="#method">Method and limitations</a>
          <a href="#review">Item review</a>
        </div>
      </div>
    </footer>
  );
}
