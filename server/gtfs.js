// Loads Strætó's GTFS timetable and answers "when does route X next reach stop Y?"
import fs from 'node:fs';
import path from 'node:path';
import { unzip, parseCsv, eachCsvRow } from './files.js';

export const GTFS_URL = process.env.GTFS_URL || 'https://opendata.straeto.is/data/gtfs/gtfs.zip';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // Strætó asks people not to fetch more than ~daily
export const TZ = 'Atlantic/Reykjavik';

// ---------- helpers ----------

/** Lower-case, strip accents, and spell out Icelandic letters so "hlemmur" finds "Hlemmur" and "thinghus" finds "Þinghús". */
export function fold(s) {
  return s
    .toLowerCase()
    .replace(/þ/g, 'th')
    .replace(/ð/g, 'd')
    .replace(/æ/g, 'ae')
    .replace(/ö/g, 'o')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function toSec(hms) {
  if (!hms) return null;
  const [h, m, s] = hms.trim().split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

function readCsv(dir, name, required = true) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`GTFS file missing: ${name}`);
    return [];
  }
  return parseCsv(fs.readFileSync(file, 'utf8'));
}

/** Date parts as seen on a clock in Reykjavík. */
export function localParts(date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'long', hourCycle: 'h23',
    }).formatToParts(date).map((x) => [x.type, x.value]),
  );
  return {
    ymd: `${p.year}${p.month}${p.day}`,
    weekday: p.weekday.toLowerCase(),
    secOfDay: Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second),
  };
}

/** Epoch ms of local midnight for the service day containing `date`. Iceland is UTC+0 with no DST, but we don't rely on that. */
function midnightMs(date) {
  return date.getTime() - localParts(date).secOfDay * 1000 - date.getMilliseconds();
}

// ---------- download ----------

export async function ensureGtfs(dataDir) {
  const marker = path.join(dataDir, 'stop_times.txt');
  const fresh = fs.existsSync(marker) && Date.now() - fs.statSync(marker).mtimeMs < MAX_AGE_MS;
  if (fresh) return;

  console.log(`[gtfs] downloading ${GTFS_URL}`);
  try {
    const res = await fetch(GTFS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(dataDir, { recursive: true });
    for (const [name, data] of unzip(buf)) {
      // some feeds nest the .txt files in a folder; flatten them
      if (name.endsWith('.txt')) fs.writeFileSync(path.join(dataDir, path.basename(name)), data);
    }
    console.log(`[gtfs] saved to ${dataDir}`);
  } catch (err) {
    if (fs.existsSync(marker)) {
      console.warn(`[gtfs] download failed (${err.message}); using the copy already on disk`);
    } else {
      throw new Error(`Could not download the Strætó timetable from ${GTFS_URL}: ${err.message}`);
    }
  }
}

// ---------- index ----------

export function loadGtfs(dir) {
  const t0 = Date.now();

  const routes = new Map();
  for (const r of readCsv(dir, 'routes.txt')) {
    routes.set(r.route_id, {
      id: r.route_id,
      name: r.route_short_name || r.route_long_name || r.route_id,
      longName: r.route_long_name || '',
      color: r.route_color ? `#${r.route_color}` : null,
      textColor: r.route_text_color ? `#${r.route_text_color}` : null,
    });
  }

  const trips = []; // indexed by number to keep the stop-times index compact
  const tripIndex = new Map();
  for (const t of readCsv(dir, 'trips.txt')) {
    tripIndex.set(t.trip_id, trips.length);
    trips.push({ id: t.trip_id, routeId: t.route_id, serviceId: t.service_id, headsign: t.trip_headsign || '' });
  }

  // Stops are grouped by name: a stop name usually has one platform per direction.
  const stopById = new Map();
  const groups = new Map(); // key -> { key, name, ids, lat, lon }
  for (const s of readCsv(dir, 'stops.txt')) {
    if (s.location_type && s.location_type !== '0') continue; // skip stations/entrances
    const name = s.stop_name;
    const key = fold(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || s.stop_id;
    stopById.set(s.stop_id, { id: s.stop_id, name, key });
    if (!groups.has(key)) groups.set(key, { key, name, folded: fold(name), ids: [], lat: 0, lon: 0 });
    const g = groups.get(key);
    g.ids.push(s.stop_id);
    g.lat += Number(s.stop_lat) || 0;
    g.lon += Number(s.stop_lon) || 0;
  }
  for (const g of groups.values()) {
    g.lat /= g.ids.length;
    g.lon /= g.ids.length;
  }

  // stop_id -> { sec: Int32Array, trip: Int32Array }, sorted by time.
  // stop_times.txt is by far the biggest file (~1M rows), so it's streamed into flat number arrays.
  const raw = new Map(); // stop_id -> [sec, tripIdx, sec, tripIdx, ...]
  const stText = fs.readFileSync(path.join(dir, 'stop_times.txt'), 'utf8');
  eachCsvRow(stText, (f, c) => {
    const ti = tripIndex.get(f[c.trip_id]?.trim());
    if (ti === undefined) return;
    const sec = toSec(f[c.departure_time] || f[c.arrival_time]);
    if (sec == null) return;
    const stopId = f[c.stop_id].trim();
    const seq = Number(f[c.stop_sequence]);
    const t = trips[ti];
    if (t.lastSeq === undefined || seq > t.lastSeq) { t.lastSeq = seq; t.lastStop = stopId; }
    let arr = raw.get(stopId);
    if (!arr) raw.set(stopId, (arr = []));
    arr.push(sec, ti);
  });
  const byStop = new Map();
  let maxSec = 0;
  for (const [stopId, arr] of raw) {
    const n = arr.length / 2;
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => arr[2 * a] - arr[2 * b]);
    const sec = new Int32Array(n), trip = new Int32Array(n);
    order.forEach((o, i) => { sec[i] = arr[2 * o]; trip[i] = arr[2 * o + 1]; });
    if (n && sec[n - 1] > maxSec) maxSec = sec[n - 1];
    byStop.set(stopId, { sec, trip });
  }
  raw.clear();

  // Which routes serve which stop group, and in which directions
  const routesAtGroup = new Map();
  for (const [stopId, list] of byStop) {
    const stop = stopById.get(stopId);
    if (!stop) continue;
    let m = routesAtGroup.get(stop.key);
    if (!m) routesAtGroup.set(stop.key, (m = new Map()));
    for (const ti of new Set(list.trip)) {
      const trip = trips[ti];
      if (trip.lastStop === stopId) continue;
      if (!m.has(trip.routeId)) m.set(trip.routeId, new Set());
      if (trip.headsign) m.get(trip.routeId).add(trip.headsign);
    }
  }

  // Service calendars
  const calendar = new Map();
  for (const c of readCsv(dir, 'calendar.txt', false)) calendar.set(c.service_id, c);
  const exceptions = new Map(); // `${date}|${service}` -> '1' added / '2' removed
  for (const d of readCsv(dir, 'calendar_dates.txt', false)) {
    exceptions.set(`${d.date}|${d.service_id}`, d.exception_type);
  }

  let feedEnd = null;
  for (const f of readCsv(dir, 'feed_info.txt', false)) feedEnd = f.feed_end_date || feedEnd;

  console.log(
    `[gtfs] indexed ${groups.size} stops, ${routes.size} routes, ${trips.length} trips in ${Date.now() - t0} ms`,
  );

  const activeCache = new Map();
  function isActive(serviceId, ymd, weekday) {
    const k = `${ymd}|${serviceId}`;
    if (activeCache.has(k)) return activeCache.get(k);
    let on = false;
    const ex = exceptions.get(k);
    if (ex === '1') on = true;
    else if (ex === '2') on = false;
    else {
      const c = calendar.get(serviceId);
      on = !!c && c[weekday] === '1' && c.start_date <= ymd && ymd <= c.end_date;
    }
    activeCache.set(k, on);
    return on;
  }

  return {
    feedEnd,
    routes,
    stopCount: groups.size,

    searchStops(q, limit = 20) {
      const f = fold(q.trim());
      if (!f) return [];
      const out = [];
      for (const g of groups.values()) {
        const i = g.folded.indexOf(f);
        if (i === -1) continue;
        out.push({ g, score: (i === 0 ? 0 : 1) + g.folded.length / 1000 });
      }
      out.sort((a, b) => a.score - b.score);
      return out.slice(0, limit).map(({ g }) => publicStop(g));
    },

    getStop(key) {
      const g = groups.get(key);
      if (!g) return null;
      const m = routesAtGroup.get(key) || new Map();
      const served = [...m]
        .map(([routeId, heads]) => ({ ...routes.get(routeId), headsigns: [...heads].sort() }))
        .filter((r) => r.id)
        .sort((a, b) => a.name.localeCompare(b.name, 'is', { numeric: true }));
      return { ...publicStop(g), routes: served };
    },

    nearestStops(lat, lon, limit = 8) {
      return [...groups.values()]
        .map((g) => ({ g, d: distanceM(lat, lon, g.lat, g.lon) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, limit)
        .map(({ g, d }) => ({ ...publicStop(g), distanceM: Math.round(d) }));
    },

    /**
     * Next scheduled departures from a stop group.
     * routeId optional. Looks at yesterday's service (for after-midnight trips),
     * today, and tomorrow so late-night queries still find the first morning bus.
     */
    upcoming(key, { routeId, now = new Date(), limit = 6, horizonSec = 24 * 3600 } = {}) {
      const g = groups.get(key);
      if (!g) return null;
      const nowMs = now.getTime();
      const out = [];
      const dayMs = 24 * 3600 * 1000;
      const base = midnightMs(now);

      for (const offset of [-1, 0, 1]) {
        const dayStart = base + offset * dayMs;
        // use noon to get the date label, so a DST shift (if ever) can't push us across midnight
        const { ymd, weekday } = localParts(new Date(dayStart + dayMs / 2));
        const minSec = (nowMs - dayStart) / 1000 - 60; // include buses that left <1 min ago
        if (minSec > maxSec) continue;
        const maxS = minSec + horizonSec;

        for (const stopId of g.ids) {
          const list = byStop.get(stopId);
          if (!list) continue;
          for (let i = lowerBound(list.sec, minSec); i < list.sec.length && list.sec[i] <= maxS; i++) {
            const sec = list.sec[i];
            const trip = trips[list.trip[i]];
            const tripId = trip.id;
            if (trip.lastStop === stopId) continue; // the bus ends here; you can't board it
            if (routeId && trip.routeId !== routeId) continue;
            if (!isActive(trip.serviceId, ymd, weekday)) continue;
            out.push({
              tripId,
              stopId,
              routeId: trip.routeId,
              route: routes.get(trip.routeId)?.name ?? trip.routeId,
              headsign: trip.headsign,
              scheduled: dayStart + sec * 1000,
              serviceDate: ymd,
            });
          }
        }
      }

      out.sort((a, b) => a.scheduled - b.scheduled);
      // de-duplicate (a trip can appear twice if a stop group has looping service)
      const seen = new Set();
      return out.filter((x) => {
        const k = `${x.tripId}|${x.serviceDate}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }).slice(0, limit * 3); // extra headroom; caller trims after realtime adjustments
    },
  };
}

function publicStop(g) {
  return { key: g.key, name: g.name, lat: g.lat, lon: g.lon, platforms: g.ids.length };
}

function lowerBound(secs, sec) {
  let lo = 0, hi = secs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (secs[mid] < sec) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
