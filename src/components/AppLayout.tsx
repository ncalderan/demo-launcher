import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

/** App shell: top bar with product identity and lightweight nav. */
export function AppLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const isHome = pathname === '/';

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-text">
            SE Demo Launcher
            <span className="brand-sub">Public Sector</span>
          </span>
        </Link>
        {!isHome && (
          <Link to="/" className="header-link">
            All demos
          </Link>
        )}
        <span className="app-version" title="Installed build">
          v{__APP_VERSION__}
        </span>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
