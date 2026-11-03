import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth';
import { Footer } from './Footer';
import { DWEL_FOOTER_LINKS } from '../config/footerLinks';

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
    <div className="landing-footer-wrap">
      <div className="landing-footer-brand">
        <ProductMark />
        <p>Dwel, a product of RBIT Financial Inc.</p>
      </div>
      <Footer productName="Dwel" links={DWEL_FOOTER_LINKS} />
    </div>
  );
}

export function ProductFrame({
  children,
  contentClassName = 'landing-section',
}: {
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <div className="landing">
      <ProductHeader />
      <main className={contentClassName}>{children}</main>
      <ProductFooter />
    </div>
  );
}
