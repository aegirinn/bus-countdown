// Optional live data. Strætó only shares real-time feeds after you sign an agreement with them
// (see https://www.straeto.is/en/about-straeto/open-data). If you get a GTFS-Realtime
// TripUpdates URL, set STRAETO_RT_URL and the countdowns will use live delays.
// The protobuf decoder is only needed (and only installed) when you have a live feed:
//   npm install gtfs-realtime-bindings
let transit_realtime = null;
async function decoder() {
  if (!transit_realtime) {
    try {
      transit_realtime = (await import('gtfs-realtime-bindings')).default.transit_realtime;
    } catch {
      throw new Error('STRAETO_RT_URL is set but gtfs-realtime-bindings is not installed. Run: npm install gtfs-realtime-bindings');
    }
  }
  return transit_realtime;
}

const URL =process.env.STRAETO_RT_URL || '';
const HEADERS = process.env.STRAETO_RT_HEADER ? JSON.parse(process.env.STRAETO_RT_HEADER) : {};
const CACHE_MS = 20_000;

let cache = { at: 0, updates: null, error: null };

export const realtimeEnabled = () => !!URL;

/** Map of tripId -> { delay, stops: Map(stopId -> { time(ms)|null, delay|null }), canceled } */
async function getUpdates() {
  if (!URL) return null;
  if (Date.now() - cache.at < CACHE_MS) return cache.updates;
  try {
    const res = await fetch(URL, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rt = await decoder();
    const feed = rt.FeedMessage.decode(new Uint8Array(await res.arrayBuffer()));
    const updates = new Map();
    for (const e of feed.entity) {
      const tu = e.tripUpdate;
      if (!tu?.trip?.tripId) continue;
      const stops = new Map();
      for (const s of tu.stopTimeUpdate || []) {
        const ev = s.departure || s.arrival;
        stops.set(s.stopId, {
          time: ev?.time ? Number(ev.time) * 1000 : null,
          delay: ev?.delay ?? null,
          skipped: s.scheduleRelationship === 1,
        });
      }
      updates.set(tu.trip.tripId, {
        delay: tu.delay ?? null,
        stops,
        canceled: tu.trip.scheduleRelationship === 3,
      });
    }
    cache = { at: Date.now(), updates, error: null };
  } catch (err) {
    console.warn(`[realtime] ${err.message}`);
    cache = { at: Date.now(), updates: cache.updates, error: err.message };
  }
  return cache.updates;
}

/** Adds `expected` (ms) and `live` (bool) to each departure; drops cancelled ones. */
export async function applyRealtime(departures) {
  const updates = await getUpdates();
  return departures
    .map((d) => {
      const u = updates?.get(d.tripId);
      if (!u) return { ...d, expected: d.scheduled, live: false };
      if (u.canceled) return null;
      const s = u.stops.get(d.stopId);
      if (s?.skipped) return null;
      let expected = d.scheduled;
      if (s?.time) expected = s.time;
      else if (s?.delay != null) expected = d.scheduled + s.delay * 1000;
      else if (u.delay != null) expected = d.scheduled + u.delay * 1000;
      else {
        // GTFS-RT delays propagate from the last update before this stop; good enough to take the latest one we have
        const last = [...u.stops.values()].reverse().find((x) => x.delay != null);
        if (last) expected = d.scheduled + last.delay * 1000;
      }
      return { ...d, expected, live: true };
    })
    .filter(Boolean);
}
