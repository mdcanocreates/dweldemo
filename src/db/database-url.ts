/**
 * Build Postgres connection URL from ECS-style env vars or DATABASE_URL.
 * TLS is configured separately via pg `ssl` — do not embed sslmode.
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DATABASE_URL?.trim()) {
    return env.DATABASE_URL.trim();
  }

  const host = env.DB_HOST;
  const port = env.DB_PORT ?? '5432';
  const name = env.DB_NAME;
  const user = env.DB_USER;
  const password = env.DB_PASSWORD;
  if (!host || !name || !user || !password) {
    throw new Error(
      'DATABASE_URL or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD are required',
    );
  }
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}
