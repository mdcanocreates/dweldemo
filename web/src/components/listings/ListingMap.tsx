import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { resolveCityCenter } from '../../lib/cityCenters';
import type { MapStyleValue } from '../../lib/listingFeatures';
import { prepareMapPins, type MapPinInput } from '../../lib/mapPins';

export type MapListing = MapPinInput;

type Props = {
  listings: MapListing[];
  selectedListingId: string | null;
  onSelectListing: (id: string) => void;
  styleUrl: MapStyleValue;
  /** Optional location query used for city-level centering when pins are absent. */
  searchQuery?: string;
};

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function ListingMap({
  listings,
  selectedListingId,
  onSelectListing,
  styleUrl,
  searchQuery,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const selectRef = useRef(onSelectListing);
  const selectedRef = useRef(selectedListingId);
  const [tileError, setTileError] = useState<string | null>(null);
  const fittedKey = useRef('');
  const cityKey = useRef('');

  useEffect(() => {
    selectRef.current = onSelectListing;
  }, [onSelectListing]);

  useEffect(() => {
    selectedRef.current = selectedListingId;
  }, [selectedListingId]);

  useEffect(() => {
    if (!containerRef.current || !styleUrl) return;
    setTileError(null);
    const city = resolveCityCenter(searchQuery);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl as string | maplibregl.StyleSpecification,
      center: [city.longitude, city.latitude],
      zoom: city.zoom,
      attributionControl: {
        compact: true,
        customAttribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('error', () => {
      setTileError('The map could not load. The list of homes is still available.');
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);
    mapRef.current = map;
    cityKey.current = '';
    fittedKey.current = '';
    return () => {
      observer.disconnect();
      fittedKey.current = '';
      cityKey.current = '';
      map.remove();
      mapRef.current = null;
    };
  }, [styleUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers: maplibregl.Marker[] = [];
    const bounds = new maplibregl.LngLatBounds();
    const pins = prepareMapPins(listings);
    let selectedElement: HTMLButtonElement | null = null;

    for (const pin of pins) {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'dwel-map-pin';
      element.textContent = pin.label;
      element.dataset.listingId = pin.listingIds.join(',');
      const selected = pin.listingIds.includes(selectedListingId ?? '');
      if (pin.listingIds.length > 1) {
        element.setAttribute('aria-label', `Show ${pin.listingIds.length} homes in this area`);
      } else {
        element.setAttribute('aria-label', `Show ${pin.label} on the list`);
      }
      if (selected) {
        element.classList.add('is-selected');
        element.setAttribute('aria-pressed', 'true');
        selectedElement = element;
      } else {
        element.setAttribute('aria-pressed', 'false');
      }
      element.addEventListener('click', () => {
        const current = pin.listingIds.indexOf(selectedRef.current ?? '');
        const next = pin.listingIds[(current + 1) % pin.listingIds.length] ?? pin.id;
        selectRef.current(next);
      });

      const marker = new maplibregl.Marker({ element })
        .setLngLat([pin.longitude, pin.latitude])
        .addTo(map);
      markers.push(marker);
      bounds.extend([pin.longitude, pin.latitude]);
    }

    const geographyKey = pins
      .map((pin) => `${pin.listingIds.join(',')}:${pin.latitude}:${pin.longitude}`)
      .sort()
      .join('|');
    const fit = () => {
      if (markers.length === 0) {
        const city = resolveCityCenter(searchQuery);
        const nextCityKey = `${city.name}:${city.latitude}:${city.longitude}:${searchQuery ?? ''}`;
        if (cityKey.current === nextCityKey) return;
        cityKey.current = nextCityKey;
        fittedKey.current = '';
        const motion = prefersReducedMotion() ? 0 : 400;
        map.easeTo({ center: [city.longitude, city.latitude], zoom: city.zoom, duration: motion });
        return;
      }
      if (fittedKey.current === geographyKey) return;
      fittedKey.current = geographyKey;
      cityKey.current = '';
      const motion = prefersReducedMotion() ? 0 : 400;
      if (markers.length === 1) {
        map.easeTo({ center: bounds.getCenter(), zoom: 11, duration: motion });
      } else {
        map.fitBounds(bounds, { padding: 35, maxZoom: 12, duration: motion });
      }
    };
    if (map.loaded()) fit();
    else map.once('load', fit);
    if (
      selectedElement &&
      selectedListingId &&
      document.activeElement?.closest('.dwel-listings-results')
    ) {
      selectedElement.focus({ preventScroll: true });
    }

    return () => {
      for (const marker of markers) marker.remove();
    };
  }, [listings, selectedListingId, searchQuery]);

  if (!styleUrl) {
    return (
      <section className="dwel-map-panel" aria-label="Map of available homes">
        <p className="dwel-map-panel__heading">Homes in this area</p>
        <p className="dwel-map-panel__unavailable">The map is turned off until a map style is configured.</p>
        <p className="dwel-map-panel__disclaimer">Locations are approximate. Homes without a verified area still appear in the list.</p>
      </section>
    );
  }

  return (
    <section className="dwel-map-panel">
      <p className="dwel-map-panel__heading">Homes in this area</p>
      {tileError && <p className="dwel-map-panel__unavailable" role="alert">{tileError}</p>}
      <div ref={containerRef} className="dwel-map-panel__canvas" aria-label="Map of available homes" />
      <p className="dwel-map-panel__disclaimer">
        Locations are approximate. Map data © OpenStreetMap contributors.
      </p>
    </section>
  );
}
