/** Map tiles stay off until a licensed style URL is configured. */
export function mapStyleUrl(): string {
  const enabled = import.meta.env.VITE_DWEL_MAP_ENABLED === 'true';
  const style = String(import.meta.env.VITE_DWEL_MAP_STYLE_URL ?? '').trim();
  if (!enabled || !style) return '';
  return style;
}

export function savingsEstimateEnabled(): boolean {
  return import.meta.env.VITE_DWEL_SAVINGS_ENABLED === 'true';
}
