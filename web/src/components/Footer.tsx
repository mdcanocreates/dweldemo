import { Link } from 'react-router-dom';
import type { FooterLink } from '../config/footerLinks';

type FooterProps = {
  productName: 'Dwel' | 'dwel.20' | 'Lumis';
  links: FooterLink[];
};

/**
 * Shared product footer. Links come from footerLinks.ts.
 * Uses React Router so HashRouter deep links stay in-app.
 */
export function Footer({ productName, links }: FooterProps) {
  const year = new Date().getFullYear();

  return (
    <footer className="rbit-footer" data-product={productName}>
      <div className="rbit-footer-inner">
        <nav className="rbit-footer-links" aria-label="Footer">
          {links.map((link) =>
            link.external ? (
              <a key={link.href + link.label} href={link.href} rel="noopener noreferrer" target="_blank">
                {link.label}
              </a>
            ) : (
              <Link key={link.href + link.label} to={link.href.replace(/^#/, '') || '/'}>
                {link.label}
              </Link>
            ),
          )}
        </nav>
        <p className="rbit-footer-copy">
          © {year} RBIT Financial · {productName}
        </p>
      </div>
    </footer>
  );
}
