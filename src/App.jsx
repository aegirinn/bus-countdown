import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { previewBell, ringBell, unlockAudio } from './bell.js';
import { LANGS, STRINGS, LangContext, loadLang, saveLang, useT } from './i18n.js';

const REFRESH_MS = 30_000;
const ALARM_MS = 5 * 60_000; // ring when the bus is this far away
const FAV_KEY = 'bus-countdown:favourites';
const RECENT_KEY = 'bus-countdown:recent';
const RECENT_MAX = 6;

// ---------- small utilities ----------

const clock = (ms) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Atlantic/Reykjavik' }).format(ms);

/** "4:05", "12 min", "1 h 20 min" — precise when it matters, calm when it doesn't. */
function countdown(diffMs, t) {
  if (diffMs <= 15_000) return { big: t.now, unit: '' };
  const s = Math.round(diffMs / 1000);
  if (s < 10 * 60) return { big: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, unit: t.min };
  const m = Math.round(s / 60);
  if (m < 60) return { big: String(m), unit: t.min };
  const h = Math.floor(m / 60);
  return { big: `${h} ${t.hour} ${m % 60}`, unit: t.min };
}

function short(diffMs, t) {
  if (diffMs <= 15_000) return t.nowShort;
  const m = Math.round(diffMs / 60_000);
  if (m < 1) return `<1 ${t.min}`;
  if (m < 60) return `${m} ${t.min}`;
  return `${Math.floor(m / 60)} ${t.hour} ${m % 60} ${t.min}`;
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

function loadList(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch {
    return [];
  }
}
function saveList(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* private mode etc. — the list just won't persist */
  }
}
const loadFavs = () => loadList(FAV_KEY);
const saveFavs = (f) => saveList(FAV_KEY, f);

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

function PickList({ items, onPick }) {
  return (
    <ul className="list">
      {items.map((f) => (
        <li key={`${f.stop}|${f.route}|${f.to}`}>
          <button className="list-item" onClick={() => onPick(f)}>
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
  );
}

function StopSearch({ onPick, favourites, recent, onPickFav, onClearRecent }) {
  const t = useT();
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
    if (!navigator.geolocation) return setError(t.noGeo);
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
        setError(t.geoFailed);
        setBusy(false);
      },
      { timeout: 10_000 },
    );
  };

  return (
    <section className="panel">
      <label className="label" htmlFor="stop-q">{t.whichStop}</label>
      <div className="search-row">
        <input
          id="stop-q"
          className="input"
          placeholder={t.placeholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          autoFocus
        />
        <button className="btn ghost" onClick={nearMe} disabled={busy} title={t.nearMeTitle}>
          {busy ? '…' : t.nearMe}
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
      {q.trim() && results.length === 0 && <p className="muted pad">{t.noMatch(q)}</p>}

      {!q.trim() && results.length === 0 && favourites.length > 0 && (
        <>
          <p className="label spaced">{t.saved}</p>
          <PickList items={favourites} onPick={onPickFav} />
        </>
      )}

      {!q.trim() && results.length === 0 && recent.length > 0 && (
        <>
          <div className="label-row spaced">
            <p className="label">{t.recent}</p>
            <button className="link" onClick={onClearRecent}>{t.clear}</button>
          </div>
          <PickList items={recent} onPick={onPickFav} />
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
  const t = useT();
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

  // ---- bell alarm: follows one specific bus, rings once when it's 5 minutes away ----
  const [alarm, setAlarm] = useState(null); // { id, rung }
  const idOf = (a) => `${a.tripId}|${a.serviceDate}`;
  const armed = alarm && next && alarm.id === idOf(next) && !alarm.rung;
  useEffect(() => {
    if (!alarm || alarm.rung || !data) return;
    const bus = list.find((a) => idOf(a) === alarm.id);
    if (!bus) return setAlarm(null); // that bus has gone
    if (bus.expected - now <= ALARM_MS) {
      ringBell();
      setAlarm({ ...alarm, rung: true });
    }
  }, [now, alarm, data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setAlarm(null), [stop.key, route, to]);
  const toggleAlarm = () => {
    if (armed) return setAlarm(null);
    unlockAudio();
    previewBell();
    setAlarm({ id: idOf(next), rung: false });
  };
  const rangForNext = alarm?.rung && next && alarm.id === idOf(next);

  const cd = next && countdown(next.expected - now, t);
  const late = next && next.live ? Math.round((next.expected - next.scheduled) / 60_000) : 0;

  return (
    <>
      <section className="panel">
        <div className="stop-head">
          <button className="back" onClick={onBack} aria-label={t.back}>←</button>
          <h1 className="stop-name">{stop.name}</h1>
          <button
            className={`star ${isFav ? 'on' : ''}`}
            onClick={toggleFav}
            aria-label={isFav ? t.favRemove : t.favAdd}
            title={isFav ? t.saved : t.save}
          >
            {isFav ? '★' : '☆'}
          </button>
        </div>

        <p className="label">{t.bus}</p>
        <Chips
          value={route || null}
          onChange={(v) => setSel({ stop: stop.key, route: v, to: null })}
          options={[{ value: null, label: t.any }, ...stop.routes.map((r) => ({ value: r.id, r }))]}
          render={(o) => (o.r ? <RouteBadge route={o.r} size="sm" /> : o.label)}
        />

        {routeInfo && routeInfo.headsigns.length > 1 && (
          <>
            <p className="label spaced">{t.towards}</p>
            <Chips
              value={to || null}
              onChange={(v) => setSel({ stop: stop.key, route, to: v })}
              options={[{ value: null, label: t.eitherWay }, ...routeInfo.headsigns.map((h) => ({ value: h, label: h }))]}
            />
          </>
        )}
      </section>

      <section className="hero" aria-live="polite">
        {error && !data && <p className="error">{error}</p>}
        {!data && !error && <p className="muted">{t.loading}</p>}
        {data && !next && <p className="muted">{t.noMore(route ? routeInfo?.name : null)}</p>}
        {next && (
          <>
            <div className="hero-top">
              <RouteBadge route={routesById[next.routeId]} size="lg" />
              <span className="hero-dest">{t.to(next.headsign || '—')}</span>
              {next.platform && <span className="plat plat-lg">{t.platform(next.platform)}</span>}
              <button
                className={`bell ${armed ? 'on' : ''}`}
                onClick={toggleAlarm}
                aria-pressed={!!armed}
                aria-label={armed ? t.bellOff : t.bellOn}
                title={armed ? t.bellOff : t.bellOn}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path
                    d="M12 3a6 6 0 0 0-6 6v3.5L4.5 16h15L18 12.5V9a6 6 0 0 0-6-6Zm-2.2 15a2.3 2.3 0 0 0 4.4 0"
                    fill={armed ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
            <div className={`count ${next.expected - now < 120_000 ? 'soon' : ''}`}>
              <span className="count-num">{cd.big}</span>
              {cd.unit && <span className="count-unit">{cd.unit}</span>}
            </div>
            {armed && <p className="bell-note">{t.bellArmed}</p>}
            {rangForNext && <p className="bell-note">{t.bellRang}</p>}
            <p className="hero-meta">
              {next.live ? (
                <>
                  <span className="dot live" /> {t.live(clock(next.expected))}
                  {late > 0 && ` · ${t.late(late)}`}
                  {late < 0 && ` · ${t.early(-late)}`}
                </>
              ) : (
                <>
                  <span className="dot" /> {t.timetable(clock(next.scheduled))}
                </>
              )}
            </p>
          </>
        )}
      </section>

      {later.length > 0 && (
        <section className="panel">
          <p className="label">{t.afterThat}</p>
          <ul className="list later">
            {later.slice(0, 6).map((a) => (
              <li key={`${a.tripId}|${a.serviceDate}`} className="later-row">
                <RouteBadge route={routesById[a.routeId]} size="sm" />
                <span className="later-dest">
                  {a.headsign}
                  {a.platform && <span className="plat"> · {a.platform}</span>}
                </span>
                <span className="later-time">{clock(a.expected)}</span>
                <span className="later-in">{short(a.expected - now, t)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && !realtime && (
        <p className="foot">{t.foot}</p>
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
  const [recent, setRecent] = useState(() => loadList(RECENT_KEY));
  const [lang, setLangRaw] = useState(loadLang);
  const t = STRINGS[lang];
  const setLang = (code) => {
    setLangRaw(code);
    saveLang(code);
  };

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t.brand;
  }, [lang, t]);

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

  // Remember the last stops opened (one entry per stop, keeping the route/direction last picked there)
  useEffect(() => {
    if (!stop || stop.key !== sel.stop) return;
    const entry = {
      stop: stop.key,
      route: sel.route || null,
      to: sel.to || null,
      stopName: stop.name,
      routeInfo: stop.routes.find((r) => r.id === sel.route) || null,
    };
    setRecent((prev) => {
      const next = [entry, ...prev.filter((r) => r.stop !== entry.stop)].slice(0, RECENT_MAX);
      saveList(RECENT_KEY, next);
      return next;
    });
  }, [stop, sel.stop, sel.route, sel.to]);
  const clearRecent = () => {
    setRecent([]);
    saveList(RECENT_KEY, []);
  };
  // don't repeat something that's already in Saved
  const recentShown = recent.filter((r) => !favs.some((f) => favKey(f) === favKey(r)));
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
    <LangContext.Provider value={t}>
    <div className="app">
      <header className="top">
        <span className="logo" aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22"><rect x="3" y="3" width="18" height="15" rx="4" fill="currentColor" /><rect x="6" y="6" width="12" height="5" rx="1.5" fill="var(--bg)" /><circle cx="8" cy="20" r="2" fill="currentColor" /><circle cx="16" cy="20" r="2" fill="currentColor" /></svg>
        </span>
        <span className="brand">{t.brand}</span>
        {status?.sample && <span className="tag">{t.sampleData}</span>}
        {status?.realtime && <span className="tag live-tag">{t.liveTag}</span>}
        <div className="lang" role="radiogroup" aria-label={t.language}>
          {LANGS.map((l) => (
            <button
              key={l.code}
              role="radio"
              aria-checked={lang === l.code}
              className={lang === l.code ? 'on' : ''}
              onClick={() => setLang(l.code)}
              title={l.name}
              lang={l.code}
            >
              {l.label}
            </button>
          ))}
        </div>
      </header>

      {error && !stop && <p className="error panel">{error}</p>}

      {!sel.stop && (
        <StopSearch
          favourites={favs}
          recent={recentShown}
          onClearRecent={clearRecent}
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
    </LangContext.Provider>
  );
}
