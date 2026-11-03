import { osmRasterStyle, type OsmStyleConfig } from './osmRasterStyle';

export type MapStyleValue = string | OsmStyleConfig;

/**
 * Free OSM raster by default. Set VITE_DWEL_MAP_ENABLED=false to disable.
 * Optional VITE_DWEL_MAP_STYLE_URL overrides with a remote style JSON URL.
 * Optional VITE_DWEL_MAP_TILE_URL overrides the OSM tile template.
 */
export function mapStyleUrl(): MapStyleValue {
  if (import.meta.env.VITE_DWEL_MAP_ENABLED === 'false') return '';
  const style = String(import.meta.env.VITE_DWEL_MAP_STYLE_URL ?? '').trim();
  if (style) return style;
  return osmRasterStyle();
}

export function savingsEstimateEnabled(): boolean {
  return import.meta.env.VITE_DWEL_SAVINGS_ENABLED === 'true';
}
