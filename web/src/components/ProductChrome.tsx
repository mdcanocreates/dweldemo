import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth';

export function ProductMark({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="landing-brand" aria-label="Dwel home">
      <img src="/faviconrbit.png" alt="" width={22} height={22} />
      <span>Dwel</span>
    </Link>
  );
}

export function ProductHeader() {
  const { user, logout } = useAuth();
  const landlord = Boolean(user?.landlordOrgId);
  const broker = Boolean(user?.brokerOrgId);
  const admin = Boolean(
    user?.roles.some((r) => r.role === 'rbit_admin' || r.role === 'rbit_super_admin'),
  );

  return (
    <header className="landing-header">
      <div className="landing-header-inner">
        <ProductMark />
        <nav className="landing-nav" aria-label="Primary">
          <NavLink to="/listings">Browse homes</NavLink>
          <NavLink to="/partner" className="landing-nav-partner">
            Dwel Partner
          </NavLink>
          <NavLink to="/saved">Saved</NavLink>
          {user && <NavLink to="/applications">My applications</NavLink>}
          {landlord && <NavLink to="/landlord">Home provider</NavLink>}
          {broker && <NavLink to="/broker">Broker</NavLink>}
          {admin && <NavLink to="/admin">Admin</NavLink>}
          {user ? (
            <button type="button" className="landing-signin" onClick={() => void logout()}>
              Sign out
            </button>
          ) : (
            <Link to="/sign-in" className="landing-signin">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export function ProductFooter() {
  return (
    <footer className="landing-footer">
      <div>
        <ProductMark />
        <p>Dwel, a product of RBIT Financial Inc.</p>
        <p>© 2026 RBIT Financial Inc.</p>
      </div>
      <nav>
        <Link to="/listings">Browse homes</Link>
        <Link to="/partner">Dwel Partner</Link>
        <Link to="/discover">Start your profile</Link>
        <Link to="/sign-in">Sign in</Link>
      </nav>
    </footer>
  );
}

export function ProductFrame({ children }: { children: ReactNode }) {
  return (
    <div className="landing">
      <ProductHeader />
      <main className="landing-section">{children}</main>
      <ProductFooter />
    </div>
  );
}
