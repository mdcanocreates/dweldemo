/**
 * Free OpenStreetMap raster style for MapLibre.
 * Tile URL is overridable via VITE_DWEL_MAP_TILE_URL.
 * Follows OSM tile usage policy: attribution, browser HTTP cache, user-driven loads only.
 */
export type OsmStyleConfig = {
  version: 8;
  name: string;
  sources: {
    osm: {
      type: 'raster';
      tiles: string[];
      tileSize: number;
      attribution: string;
      maxzoom: number;
    };
  };
  layers: Array<{ id: string; type: 'raster'; source: string }>;
};

const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export function osmRasterStyle(): OsmStyleConfig {
  const tileUrl = String(import.meta.env.VITE_DWEL_MAP_TILE_URL ?? '').trim() || DEFAULT_TILE_URL;
  return {
    version: 8,
    name: 'dwel-osm-raster',
    sources: {
      osm: {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxzoom: 19,
      },
    },
    layers: [{ id: 'osm-raster', type: 'raster', source: 'osm' }],
  };
}
