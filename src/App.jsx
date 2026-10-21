import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';

const REFRESH_MS = 30_000;
const FAV_KEY = 'bus-countdown:favourites';

// ---------- small utilities ----------

const clock = (ms) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Atlantic/Reykjavik' }).format(ms);

/** "4:05", "12 min", "1 h 20 min" — precise when it matters, calm when it doesn't. */
function countdown(diffMs) {
  if (diffMs <= 15_000) return { big: 'Now', unit: '' };
  const s = Math.round(diffMs / 1000);
  if (s < 10 * 60) return { big: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, unit: 'min' };
  const m = Math.round(s / 60);
  if (m < 60) return { big: String(m), unit: 'min' };
  const h = Math.floor(m / 60);
  return { big: `${h} h ${m % 60}`, unit: 'min' };
}

function short(diffMs) {
  if (diffMs <= 15_000) return 'now';
  const m = Math.round(diffMs / 60_000);
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  return { stop: p.get('stop'), route: p.get('route'), to: p.get('to') };
}
function writeHash({ stop, route, to }) {
  const p = new URLSearchParams();
  if (stop) p.set('stop', stop);
  if (route) p.set('route', route);
  if (to) p.set('to', to);
  const h = p.toString();
  history.replaceState(null, '', h ? `#${h}` : location.pathname);
}

function loadFavs() {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY)) || [];
  } catch {
    return [];
  }
}
function saveFavs(f) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(f));
  } catch {
    /* private mode etc. — favourites just won't persist */
  }
}

function useNow(interval = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [interval]);
  return now;
}

// ---------- pieces ----------

function RouteBadge({ route, size = 'md' }) {
  const style = route?.color ? { background: route.color, color: route.textColor || '#fff' } : undefined;
  return (
    <span className={`badge badge-${size}`} style={style}>
      {route?.name ?? '?'}
    </span>
  );
}

function StopSearch({ onPick, favourites, onPickFav }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    if (!q.trim()) return setResults([]);
    const n = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await api.search(q);
        if (n === seq.current) setResults(r);
      } catch (e) {
        setError(e.message);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const nearMe = () => {
    if (!navigator.geolocation) return setError('Your browser does not share location.');
    setBusy(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          setResults(await api.nearby(coords.latitude, coords.longitude));
          setQ('');
        } catch (e) {
          setError(e.message);
        }
        setBusy(false);
      },
      () => {
        setError('Could not get your location.');
        setBusy(false);
      },
      { timeout: 10_000 },
    );
  };

  return (
    <section className="panel">
      <label className="label" htmlFor="stop-q">Which stop are you at?</label>
      <div className="search-row">
        <input
          id="stop-q"
          className="input"
          placeholder="e.g. Hlemmur, Mjódd, Háskóli"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          autoFocus
        />
        <button className="btn ghost" onClick={nearMe} disabled={busy} title="Find stops near me">
          {busy ? '…' : 'Near me'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      {results.length > 0 && (
        <ul className="list">
          {results.map((s) => (
            <li key={s.key}>
              <button className="list-item" onClick={() => onPick(s.key)}>
                <span>{s.name}</span>
                <span className="muted">{s.distanceM != null ? `${s.distanceM} m` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim() && results.length === 0 && <p className="muted pad">No stops match “{q}”.</p>}

      {!q.trim() && results.length === 0 && favourites.length > 0 && (
        <>
          <p className="label spaced">Saved</p>
          <ul className="list">
            {favourites.map((f) => (
              <li key={`${f.stop}|${f.route}|${f.to}`}>
                <button className="list-item" onClick={() => onPickFav(f)}>
                  <span className="fav-line">
                    {f.routeInfo && <RouteBadge route={f.routeInfo} size="sm" />}
                    <span>
                      {f.stopName}
                      {f.to && <span className="muted"> → {f.to}</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Chips({ options, value, onChange, render }) {
  return (
    <div className="chips" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value ?? 'all'}
          role="radio"
          aria-checked={value === o.value}
          className={`chip ${value === o.value ? 'on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {render ? render(o) : o.label}
        </button>
      ))}
    </div>
  );
}

function Board({ stop, route, to, setSel, onBack, isFav, toggleFav, realtime }) {
  const now = useNow(1000);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.arrivals(stop.key, route, 20);
      setData(r);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [stop.key, route]);

  useEffect(() => {
    setData(null);
    load();
    const id = setInterval(load, REFRESH_MS);
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  const routeInfo = stop.routes.find((r) => r.id === route);
  const routesById = useMemo(() => Object.fromEntries(stop.routes.map((r) => [r.id, r])), [stop]);

  const list = (data?.arrivals || [])
    .filter((a) => !to || a.headsign === to)
    .filter((a) => a.expected > now - 15_000);
  const [next, ...later] = list;

  // When the shown bus has gone, fetch again so the list doesn't run dry
  useEffect(() => {
    if (data && list.length < 3) load();
  }, [list.length < 3]); // eslint-disable-line react-hooks/exhaustive-deps

  const cd = next && countdown(next.expected - now);
  const late = next && next.live ? Math.round((next.expected - next.scheduled) / 60_000) : 0;

  return (
    <>
      <section className="panel">
        <div className="stop-head">
          <button className="back" onClick={onBack} aria-label="Choose another stop">←</button>
          <h1 className="stop-name">{stop.name}</h1>
          <button
            className={`star ${isFav ? 'on' : ''}`}
            onClick={toggleFav}
            aria-label={isFav ? 'Remove from saved' : 'Save this stop and route'}
            title={isFav ? 'Saved' : 'Save'}
          >
            {isFav ? '★' : '☆'}
          </button>
        </div>

        <p className="label">Bus</p>
        <Chips
          value={route || null}
          onChange={(v) => setSel({ stop: stop.key, route: v, to: null })}
          options={[{ value: null, label: 'Any' }, ...stop.routes.map((r) => ({ value: r.id, r }))]}
          render={(o) => (o.r ? <RouteBadge route={o.r} size="sm" /> : o.label)}
        />

        {routeInfo && routeInfo.headsigns.length > 1 && (
          <>
            <p className="label spaced">Towards</p>
            <Chips
              value={to || null}
              onChange={(v) => setSel({ stop: stop.key, route, to: v })}
              options={[{ value: null, label: 'Either way' }, ...routeInfo.headsigns.map((h) => ({ value: h, label: h }))]}
            />
          </>
        )}
      </section>

      <section className="hero" aria-live="polite">
        {error && !data && <p className="error">{error}</p>}
        {!data && !error && <p className="muted">Loading timetable…</p>}
        {data && !next && <p className="muted">No more buses {route ? `on route ${routeInfo?.name} ` : ''}in the next 24 hours.</p>}
        {next && (
          <>
            <div className="hero-top">
              <RouteBadge route={routesById[next.routeId]} size="lg" />
              <span className="hero-dest">to {next.headsign || '—'}</span>
            </div>
            <div className={`count ${next.expected - now < 120_000 ? 'soon' : ''}`}>
              <span className="count-num">{cd.big}</span>
              {cd.unit && <span className="count-unit">{cd.unit}</span>}
            </div>
            <p className="hero-meta">
              {next.live ? (
                <>
                  <span className="dot live" /> Live · expected {clock(next.expected)}
                  {late > 0 && ` · ${late} min late`}
                  {late < 0 && ` · ${-late} min early`}
                </>
              ) : (
                <>
                  <span className="dot" /> Timetable · {clock(next.scheduled)}
                </>
              )}
            </p>
          </>
        )}
      </section>

      {later.length > 0 && (
        <section className="panel">
          <p className="label">After that</p>
          <ul className="list later">
            {later.slice(0, 6).map((a) => (
              <li key={`${a.tripId}|${a.serviceDate}`} className="later-row">
                <RouteBadge route={routesById[a.routeId]} size="sm" />
                <span className="later-dest">{a.headsign}</span>
                <span className="later-time">{clock(a.expected)}</span>
                <span className="later-in">{short(a.expected - now)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && !realtime && (
        <p className="foot">
          Times are from Strætó’s published timetable, so they don’t account for traffic or delays.
        </p>
      )}
    </>
  );
}

// ---------- app ----------

export default function App() {
  const [sel, setSelRaw] = useState(readHash);
  const [stop, setStop] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [favs, setFavs] = useState(loadFavs);

  const setSel = (s) => {
    writeHash(s);
    setSelRaw(s);
  };

  useEffect(() => {
    api.status().then(setStatus).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!sel.stop) return setStop(null);
    if (stop?.key === sel.stop) return;
    api
      .stop(sel.stop)
      .then(setStop)
      .catch((e) => {
        setError(e.message);
        setSel({});
      });
  }, [sel.stop]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onHash = () => setSelRaw(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const favKey = (f) => `${f.stop}|${f.route || ''}|${f.to || ''}`;
  const isFav = favs.some((f) => favKey(f) === favKey(sel));
  const toggleFav = () => {
    const next = isFav
      ? favs.filter((f) => favKey(f) !== favKey(sel))
      : [
          { stop: sel.stop, route: sel.route || null, to: sel.to || null, stopName: stop.name, routeInfo: stop.routes.find((r) => r.id === sel.route) || null },
          ...favs,
        ].slice(0, 12);
    setFavs(next);
    saveFavs(next);
  };

  return (
    <div className="app">
      <header className="top">
        <span className="logo" aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22"><rect x="3" y="3" width="18" height="15" rx="4" fill="currentColor" /><rect x="6" y="6" width="12" height="5" rx="1.5" fill="var(--bg)" /><circle cx="8" cy="20" r="2" fill="currentColor" /><circle cx="16" cy="20" r="2" fill="currentColor" /></svg>
        </span>
        <span className="brand">Next bus</span>
        {status?.sample && <span className="tag">sample data</span>}
        {status?.realtime && <span className="tag live-tag">live</span>}
      </header>

      {error && !stop && <p className="error panel">{error}</p>}

      {!sel.stop && (
        <StopSearch
          favourites={favs}
          onPick={(key) => setSel({ stop: key, route: null, to: null })}
          onPickFav={(f) => setSel({ stop: f.stop, route: f.route, to: f.to })}
        />
      )}

      {sel.stop && stop && stop.key === sel.stop && (
        <Board
          stop={stop}
          route={sel.route}
          to={sel.to}
          setSel={setSel}
          onBack={() => setSel({})}
          isFav={isFav}
          toggleFav={toggleFav}
          realtime={!!status?.realtime}
        />
      )}
    </div>
  );
}
