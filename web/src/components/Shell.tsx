import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth';

function isAdmin(roles: Array<{ role: string }>): boolean {
  return roles.some((r) => r.role === 'rbit_admin' || r.role === 'rbit_super_admin');
}

function isRenter(roles: Array<{ role: string }>): boolean {
  return roles.some((r) => r.role === 'renter');
}

/** Part M-1 — role-aware primary nav. */
export function PublicNav() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const landlord = Boolean(user?.landlordOrgId);
  const broker = Boolean(user?.brokerOrgId);
  const admin = user ? isAdmin(user.roles) : false;

  const links: Array<{ to: string; label: string; end?: boolean }> = [];

  if (!user) {
    links.push(
      { to: '/listings', label: 'Find a home' },
      { to: '/landlords', label: 'For landlords' },
      { to: '/brokers', label: 'For brokers' },
      { to: '/calculator', label: 'NOI calculator' },
      { to: '/sign-in', label: 'Sign in' },
    );
  } else {
    links.push({ to: '/listings', label: 'Find a home' });
    if (isRenter(user.roles) || (!landlord && !broker)) {
      links.push({ to: '/applications', label: 'My applications' });
    }
    if (landlord) links.push({ to: '/landlord', label: 'Landlord portal' });
    if (broker) links.push({ to: '/broker', label: 'Broker portal' });
    if (admin) links.push({ to: '/admin', label: 'Admin' });
    links.push({ to: '/calculator', label: 'NOI calculator' });
  }

  return (
    <header className="topnav">
      <NavLink to="/" className="brand" end onClick={close}>
        dwel<em>.20</em>
      </NavLink>
      <button
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls="primary-nav"
        onClick={() => setOpen((v) => !v)}
      >
        Menu
      </button>
      <nav id="primary-nav" className={`nav-links ${open ? 'open' : ''}`} aria-label="Primary">
        {links.map((l) => (
          <NavLink key={l.to + l.label} to={l.to} end={l.end} onClick={close}>
            {l.label}
          </NavLink>
        ))}
        {user && (
          <button type="button" className="btn btn-secondary" onClick={() => void logout()}>
            Sign out
          </button>
        )}
      </nav>
    </header>
  );
}

export function Shell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="shell">
      <PublicNav />
      <main className="page">{children}</main>
      <footer className="footer">
        {footer ?? 'dwel.20 — rentals with transparent incentives for renters and owners.'}
      </footer>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="callout">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function ErrorState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="callout warn">
      <strong>{title}</strong>
      {children}
    </div>
  );
}
