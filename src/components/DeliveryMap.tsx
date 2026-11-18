import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapMarkerPoint {
  id: string | number;
  lat: number;
  lng: number;
  label: string;
  sublabel?: string;
  selected?: boolean;
  delayed?: boolean;
}

interface DeliveryMapProps {
  store: { lat: number; lng: number; name?: string; address?: string };
  destination?: { lat: number; lng: number; label?: string; address?: string } | null;
  destinations?: MapMarkerPoint[];
  driver?: { lat: number; lng: number; name?: string; speed_kmh?: number; eta_min?: number | null } | null;
  drivers?: MapMarkerPoint[];
  routeGeometry?: [number, number][];
  liveSegmentGeometry?: [number, number][];
  heightClass?: string;
  interactivePicker?: boolean;
  onPickLocation?: (lat: number, lng: number) => void;
  onSelectMarker?: (id: string | number) => void;
}

function createStoreIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [38, 38],
    iconAnchor: [19, 38],
    popupAnchor: [0, -36],
    html: `<div style="width:38px;height:38px;border-radius:10px;overflow:hidden;background:#2054C9;border:2px solid #FFFFFF;box-shadow:0 3px 10px rgba(32,38,51,0.35);display:flex;align-items:center;justify-content:center;"><img src="/assets/aistudio/_cono_azul_de_compras_con_carrito_amarillo_b017e67b.png" alt="Los Patrones" style="width:100%;height:100%;object-fit:cover;display:block;" /></div>`,
  });
}

function createDestinationIcon(selected = true, delayed = false): L.DivIcon {
  const bg = delayed ? '#DC2626' : '#F9D94A';
  const fg = delayed ? '#FFFFFF' : '#202633';
  const size = selected ? 32 : 26;
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
    html: `<div style="width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${bg};border:2.5px solid #202633;box-shadow:0 3px 8px rgba(32,38,51,0.3);display:flex;align-items:center;justify-content:center;"><span style="transform:rotate(45deg);color:${fg};font-weight:700;font-size:11px;font-family:'Montserrat',sans-serif;">●</span></div>`,
  });
}

function createDriverIcon(name?: string): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -20],
    html: `<div style="position:relative;width:38px;height:38px;display:flex;align-items:center;justify-content:center;">
      <span style="position:absolute;inset:0;border-radius:9999px;background:rgba(19,182,75,0.28);"></span>
      <div title="${name || 'Repartidor'}" style="width:28px;height:28px;border-radius:9999px;background:#13B64B;border:2.5px solid #FFFFFF;box-shadow:0 2px 8px rgba(32,38,51,0.35);display:flex;align-items:center;justify-content:center;color:#202633;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
      </div>
    </div>`,
  });
}

export const DeliveryMap: React.FC<DeliveryMapProps> = ({
  store,
  destination,
  destinations = [],
  driver,
  drivers = [],
  routeGeometry = [],
  liveSegmentGeometry = [],
  heightClass = 'h-[320px] sm:h-[380px]',
  interactivePicker = false,
  onPickLocation,
  onSelectMarker,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const hasFittedOnceRef = useRef(false);
  const lastFitSignatureRef = useRef('');

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [store.lat, store.lng],
      zoom: 14,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    setTimeout(() => {
      map.invalidateSize();
    }, 120);

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handler = (e: L.LeafletMouseEvent) => {
      if (interactivePicker && onPickLocation) {
        onPickLocation(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
      }
    };
    map.on('click', handler);
    return () => {
      map.off('click', handler);
    };
  }, [interactivePicker, onPickLocation]);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();
    const boundsPoints: L.LatLngExpression[] = [[store.lat, store.lng]];

    // Store marker (always shown)
    const storeMarker = L.marker([store.lat, store.lng], { icon: createStoreIcon() });
    storeMarker.bindPopup(
      `<div style="font-family:Montserrat,sans-serif;font-size:12px;">
        <strong style="color:#2054C9;">${store.name || 'Los Patrones Mini Market'}</strong><br/>
        <span>${store.address || "15°36'43.9\"N 87°56'21.0\"W"}</span><br/>
        <span style="color:#666;font-size:11px;">15°36'43.9"N 87°56'21.0"W</span>
      </div>`
    );
    storeMarker.addTo(group);

    // Main route polyline
    if (routeGeometry.length > 1) {
      L.polyline(routeGeometry, {
        color: '#2054C9',
        weight: 5,
        opacity: 0.85,
      }).addTo(group);
      boundsPoints.push(routeGeometry[0], routeGeometry[routeGeometry.length - 1]);
    }

    // Live driver->destination dashed segment
    if (liveSegmentGeometry.length > 1) {
      L.polyline(liveSegmentGeometry, {
        color: '#13B64B',
        weight: 4,
        dashArray: '8 6',
        opacity: 0.95,
      }).addTo(group);
    }

    // Single destination marker
    if (destination && Number.isFinite(destination.lat) && Number.isFinite(destination.lng)) {
      const destMarker = L.marker([destination.lat, destination.lng], {
        icon: createDestinationIcon(true, false),
        draggable: interactivePicker,
      });
      destMarker.bindPopup(
        `<div style="font-family:Montserrat,sans-serif;font-size:12px;">
          <strong style="color:#202633;">${destination.label || 'Destino de entrega'}</strong><br/>
          <span>${destination.address || `${destination.lat.toFixed(5)}, ${destination.lng.toFixed(5)}`}</span>
        </div>`
      );
      if (interactivePicker && onPickLocation) {
        destMarker.on('dragend', () => {
          const pos = destMarker.getLatLng();
          onPickLocation(Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6)));
        });
      }
      destMarker.addTo(group);
      boundsPoints.push([destination.lat, destination.lng]);
    }

    // Multiple destinations (Admin Fleet Map)
    for (const d of destinations) {
      if (!Number.isFinite(d.lat) || !Number.isFinite(d.lng)) continue;
      const m = L.marker([d.lat, d.lng], { icon: createDestinationIcon(Boolean(d.selected), Boolean(d.delayed)) });
      m.bindPopup(
        `<div style="font-family:Montserrat,sans-serif;font-size:12px;">
          <strong>${d.label}</strong><br/>
          <span>${d.sublabel || ''}</span>
        </div>`
      );
      if (onSelectMarker) {
        m.on('click', () => onSelectMarker(d.id));
      }
      m.addTo(group);
      boundsPoints.push([d.lat, d.lng]);
    }

    // Single driver marker
    if (driver && Number.isFinite(driver.lat) && Number.isFinite(driver.lng)) {
      const dm = L.marker([driver.lat, driver.lng], { icon: createDriverIcon(driver.name) });
      dm.bindPopup(
        `<div style="font-family:Montserrat,sans-serif;font-size:12px;">
          <strong style="color:#0A7830;">${driver.name || 'Repartidor en camino'}</strong><br/>
          ${driver.eta_min ? `<span>Llegada estimada: ~${driver.eta_min} min</span>` : '<span>GPS activo</span>'}
        </div>`
      );
      dm.addTo(group);
      boundsPoints.push([driver.lat, driver.lng]);
    }

    // Multiple drivers (Admin Fleet Map)
    for (const drv of drivers) {
      if (!Number.isFinite(drv.lat) || !Number.isFinite(drv.lng)) continue;
      const dm = L.marker([drv.lat, drv.lng], { icon: createDriverIcon(drv.label) });
      dm.bindPopup(
        `<div style="font-family:Montserrat,sans-serif;font-size:12px;">
          <strong style="color:#0A7830;">${drv.label}</strong><br/>
          <span>${drv.sublabel || 'En ruta activa'}</span>
        </div>`
      );
      dm.addTo(group);
      boundsPoints.push([drv.lat, drv.lng]);
    }

    const fitSig = `${store.lat.toFixed(4)}_${destination?.lat?.toFixed(4) || ''}_${destinations.length}_${routeGeometry.length}`;
    if (!hasFittedOnceRef.current || lastFitSignatureRef.current !== fitSig) {
      hasFittedOnceRef.current = true;
      lastFitSignatureRef.current = fitSig;
      if (boundsPoints.length > 1) {
        map.fitBounds(L.latLngBounds(boundsPoints), { padding: [36, 36], maxZoom: 16 });
      } else {
        map.setView([store.lat, store.lng], 15);
      }
    }
  }, [store, destination, destinations, driver, drivers, routeGeometry, liveSegmentGeometry, interactivePicker, onPickLocation, onSelectMarker]);

  return (
    <div className={`relative w-full ${heightClass} rounded-xl overflow-hidden border border-[#202633]/15 bg-[#FFF4E5]/40 z-0`}>
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
};
