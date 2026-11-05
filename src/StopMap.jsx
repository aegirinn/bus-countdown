// Map of every stop on the start screen. Leaflet + OpenStreetMap; both are only loaded when the
// map is about to scroll into view, so the search screen stays fast.
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useT } from './i18n.js';

const CAPITAL = [64.128, -21.88]; // Reykjavík capital area
const START_ZOOM = 12;
const radiusFor = (z) => (z <= 10 ? 2.5 : z <= 11 ? 3.5 : z <= 12 ? 4.5 : z <= 13 ? 5.5 : z <= 14 ? 6.5 : 8);
const STYLE = { color: '#1a1400', weight: 1.5, fillColor: '#f2b705', fillOpacity: 1 };
const PICKED = { color: '#1a1400', weight: 3, fillColor: '#ffffff', fillOpacity: 1, opacity: 1 };

// Dots fade toward the edges of the map: solid in the middle, faint at the rim.
// r is the distance from the centre, where 1 = the middle of an edge.
const FADE_START = 0.35;
const FADE_END = 1.1;
const MIN_OPACITY = 0.15;
function opacityAt(r) {
  const t = Math.min(1, Math.max(0, (r - FADE_START) / (FADE_END - FADE_START)));
  return 1 - t * t * (3 - 2 * t) * (1 - MIN_OPACITY); // smooth ease
}

// metres between two points (good enough at city scale)
function metres(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.round(Math.hypot(x, y) * R);
}

export default function StopMap({ onPick, userPos, StopLine }) {
  const t = useT();
  const wrap = useRef(null);
  const el = useRef(null);
  const mapRef = useRef(null); // { L, map, markers: Map(key -> marker), me }
  const [state, setState] = useState('idle'); // idle | loading | ready | failed
  const [picked, setPicked] = useState(null); // { key, name, lines }
  const pickRow = useRef(null);

  // make sure the tapped stop's row below the map is on screen
  useEffect(() => {
    if (picked) pickRow.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [picked]);

  // Load Leaflet and the stop list once the map is close to the screen
  useEffect(() => {
    const node = wrap.current;
    if (!node) return;
    let cancelled = false;
    const start = () => {
      setState('loading');
      Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css'), api.allStops()])
        .then(([mod, , data]) => {
          if (cancelled || !el.current) return;
          build(mod.default ?? mod, data);
          setState('ready');
        })
        .catch(() => !cancelled && setState('failed'));
    };
    if (!('IntersectionObserver' in window)) {
      start();
      return () => { cancelled = true; };
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          start();
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(node);
    return () => {
      cancelled = true;
      io.disconnect();
      mapRef.current?.map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function build(L, data) {
    const map = L.map(el.current, {
      center: CAPITAL,
      zoom: START_ZOOM,
      preferCanvas: true, // ~800 dots draw much faster on a canvas
      scrollWheelZoom: true, // the mouse wheel zooms while the pointer is over the map
      wheelPxPerZoomLevel: 90, // a little gentler than Leaflet's default, so a flick doesn't jump several levels
      tap: true,
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // request tiles with CORS so the app can store them on the phone (see public/sw.js);
      // without it browsers count each stored tile as several MB of space
      crossOrigin: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    const markers = new Map();
    const r = radiusFor(START_ZOOM);
    for (const [key, name, lat, lon, routeIds] of data.stops) {
      const lines = routeIds.map((id) => ({ id, ...data.routes[id] }));
      const m = L.circleMarker([lat, lon], { ...STYLE, radius: r, bubblingMouseEvents: false }).addTo(map);
      m.on('click', () => select({ key, name, lines, lat, lon }));
      markers.set(key, m);
    }
    map.on('zoomend', () => {
      const rad = radiusFor(map.getZoom());
      markers.forEach((m) => m.setRadius(rad));
      const cur = mapRef.current?.pickedKey;
      if (cur) markers.get(cur)?.setRadius(rad + 3);
    });
    map.on('click', () => select(null));
    mapRef.current = { L, map, markers, me: null, pickedKey: null };

    // re-fade while panning/zooming, at most once per animation frame
    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        fadeAll();
      });
    };
    map.on('move zoom resize', schedule);
    fadeAll();
    if (userPos) showMe(userPos);
  }

  function fadeAll() {
    const ref = mapRef.current;
    if (!ref) return;
    const { map, markers } = ref;
    const size = map.getSize();
    const hw = size.x / 2, hh = size.y / 2;
    const view = map.getBounds().pad(0.2); // only dots on (or just off) screen need updating
    markers.forEach((m, key) => {
      if (key === ref.pickedKey) return;
      const ll = m.getLatLng();
      if (!view.contains(ll)) return;
      const p = map.latLngToContainerPoint(ll);
      const o = opacityAt(Math.hypot((p.x - hw) / hw, (p.y - hh) / hh));
      if (Math.abs((m.options.fillOpacity ?? 1) - o) > 0.02) m.setStyle({ opacity: o, fillOpacity: o });
    });
  }

  function select(stop) {
    const ref = mapRef.current;
    if (!ref) return;
    const rad = radiusFor(ref.map.getZoom());
    if (ref.pickedKey) ref.markers.get(ref.pickedKey)?.setStyle(STYLE).setRadius(rad);
    ref.pickedKey = stop?.key ?? null;
    if (stop) ref.markers.get(stop.key)?.setStyle(PICKED).setRadius(rad + 3).bringToFront();
    fadeAll(); // the previously picked dot gets its faded look back
    setPicked(stop);
  }

  function showMe(pos) {
    const ref = mapRef.current;
    if (!ref) return;
    const ll = [pos.lat, pos.lon];
    if (!ref.me) {
      ref.me = ref.L.circleMarker(ll, {
        radius: 8, color: '#ffffff', weight: 3, fillColor: '#1c7ed6', fillOpacity: 1, interactive: false,
      }).addTo(ref.map);
    } else ref.me.setLatLng(ll);
    ref.map.setView(ll, 15);
  }

  // "Near me" in the search card moves the map to you
  useEffect(() => {
    if (userPos && state === 'ready') showMe(userPos);
  }, [userPos, state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="panel map-panel" ref={wrap}>
      <p className="label">{t.map}</p>
      <div className="map-box">
        <div ref={el} className="map" role="region" aria-label={t.map} />
        {state !== 'ready' && (
          <div className="map-overlay">{state === 'failed' ? t.mapFailed : t.mapLoading}</div>
        )}
      </div>
      {picked ? (
        // same row as the search / nearby results; tap to open the stop
        <ul className="list map-pick" ref={pickRow}>
          <li>
            <button className="list-item" onClick={() => onPick(picked.key)}>
              <StopLine name={picked.name} lines={picked.lines} />
              {userPos && <span className="muted dist">{metres(userPos, picked)} m</span>}
            </button>
          </li>
        </ul>
      ) : (
        state === 'ready' && <p className="map-hint muted">{t.mapHint}</p>
      )}
    </section>
  );
}
