import { Link } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { SITEMAP_SECTIONS } from '../config/siteRoutes';

/**
 * Human-readable sitemap. Routes come from src/config/sitemapData.json
 * (shared with scripts/generate-sitemap.mjs) — not a hand-maintained duplicate of App.tsx.
 *
 * FLAG: App.tsx <Routes> JSX is not programmatically enumerable; public URLs are centralized
 * in sitemapData.json. Auth-only deep links are omitted on purpose.
 * Domain for XML sitemap: see SITEMAP_BASE_URL in siteRoutes.ts (placeholder pending confirmation).
 */
export function SitemapPage() {
  return (
    <Shell>
      <p className="section-eyebrow">Site map</p>
      <h1 className="section-title">Sitemap</h1>
      <p className="muted" style={{ maxWidth: '36rem' }}>
        Every public page on dwel.20, organized by section.
      </p>
      <div className="sitemap-grid">
        {SITEMAP_SECTIONS.map((section) => (
          <section key={section.title} className="panel stack">
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{section.title}</h2>
            <ul className="sitemap-list">
              {section.routes.map((r) => (
                <li key={r.path}>
                  <Link to={r.path}>{r.label}</Link>
                  <span className="font-mono muted" style={{ fontSize: '0.75rem', marginLeft: '0.5rem' }}>
                    {r.path}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Shell>
  );
}
