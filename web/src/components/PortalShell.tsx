import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth';

export type PortalNavLink = {
  to: string;
  label: string;
  end?: boolean;
};

/**
 * Shared portal shell: dark sidebar + light cream main (Replit N-4 / QF-1).
 */
export function PortalShell({
  navLabel,
  topEyebrow,
  topTitle,
  footTitle,
  footBody,
  footLinkTo = '/listings',
  footLinkLabel = 'Tenant view →',
  links,
  children,
}: {
  navLabel: string;
  topEyebrow: string;
  topTitle: string;
  footTitle: string;
  footBody: string;
  footLinkTo?: string;
  footLinkLabel?: string;
  links: PortalNavLink[];
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { logout } = useAuth();

  return (
    <div className="landlord-shell">
      {mobileOpen && (
        <button
          type="button"
          className="landlord-overlay"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={`landlord-side ${mobileOpen ? 'open' : ''}`} aria-label={navLabel}>
        <div className="landlord-side-top">
          <Link to="/" className="landlord-brand">
            <img src="/faviconrbit.png" alt="" width={20} height={20} />
            Dwel
          </Link>
          <button type="button" className="landlord-side-close" onClick={() => setMobileOpen(false)}>
            Close
          </button>
        </div>
        <p className="landlord-nav-label">{navLabel}</p>
        <nav className="landlord-nav">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="landlord-side-foot">
          <p className="landlord-nav-label">{footTitle}</p>
          <p>{footBody}</p>
          <Link to={footLinkTo}>{footLinkLabel}</Link>
        </div>
      </aside>
      <div className="landlord-main">
        <header className="landlord-top">
          <button type="button" className="landlord-menu-btn" onClick={() => setMobileOpen(true)}>
            Menu
          </button>
          <div className="landlord-top-copy">
            {topEyebrow ? <p className="landlord-nav-label">{topEyebrow}</p> : null}
            <p className="landlord-top-title">{topTitle}</p>
          </div>
          <button type="button" className="btn btn-soft" onClick={() => void logout()}>
            Sign out
          </button>
        </header>
        <main className="landlord-content">{children}</main>
      </div>
    </div>
  );
}
