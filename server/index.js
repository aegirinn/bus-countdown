// Timetable API for the bus countdown app. Uses only Node's built-in modules.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensureGtfs, loadGtfs } from './gtfs.js';
import { applyRealtime, realtimeEnabled } from './realtime.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const args = process.argv.slice(2);
const useSample = args.includes('--sample') || !!process.env.GTFS_DIR;
const GTFS_DIR = path.resolve(
  process.env.GTFS_DIR || (useSample ? path.join(here, 'sample-gtfs') : path.join(here, '..', 'data', 'gtfs')),
);
const DIST = path.join(here, '..', 'dist');
const serveApp = (args.includes('--production') || process.env.NODE_ENV === 'production') && fs.existsSync(DIST);

let gtfs = null;
let loadError = null;

async function refresh() {
  try {
    if (!useSample) await ensureGtfs(GTFS_DIR);
    gtfs = loadGtfs(GTFS_DIR);
    loadError = null;
  } catch (err) {
    loadError = err.message;
    console.error(`[gtfs] ${err.message}`);
  }
}

await refresh();
if (!useSample) setInterval(refresh, 24 * 60 * 60 * 1000); // pick up timetable changes daily

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*', // lets a packaged Android app call this API
  });
  res.end(JSON.stringify(body));
}

async function api(req, res, url) {
  if (!gtfs) return send(res, 503, { error: loadError || 'Timetable is still loading' });
  const q = url.searchParams;
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); // ['api', ...]

  if (parts[1] === 'status') {
    return send(res, 200, {
      stops: gtfs.stopCount, routes: gtfs.routes.size, feedEnd: gtfs.feedEnd,
      realtime: realtimeEnabled(), sample: useSample,
    });
  }

  if (parts[1] === 'stops' && parts.length === 2) {
    if (q.get('lat') && q.get('lon')) return send(res, 200, gtfs.nearestStops(Number(q.get('lat')), Number(q.get('lon'))));
    return send(res, 200, gtfs.searchStops(q.get('q') || ''));
  }

  if (parts[1] === 'stops' && parts.length === 3) {
    const stop = gtfs.getStop(parts[2]);
    return stop ? send(res, 200, stop) : send(res, 404, { error: 'Unknown stop' });
  }

  if (parts[1] === 'stops' && parts[3] === 'arrivals') {
    const limit = Math.min(Number(q.get('limit')) || 6, 20);
    const raw = gtfs.upcoming(parts[2], { routeId: q.get('route') || undefined, limit });
    if (!raw) return send(res, 404, { error: 'Unknown stop' });
    const now = Date.now();
    const arrivals = (await applyRealtime(raw))
      .filter((d) => d.expected >= now - 30_000)
      .sort((a, b) => a.expected - b.expected)
      .slice(0, limit);
    return send(res, 200, { now, realtime: realtimeEnabled(), arrivals });
  }

  send(res, 404, { error: 'Not found' });
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function staticFile(res, pathname) {
  let file = path.join(DIST, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': (TYPES[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (serveApp) return staticFile(res, url.pathname);
      // Dev mode: this port only serves the API; point people at the React dev server.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Next bus API</title>
<body style="font:16px/1.5 system-ui;max-width:32rem;margin:15vh auto;padding:0 1rem">
<h1 style="font-size:1.4rem">This is the timetable API</h1>
<p>The app runs on the Vite dev server: <a href="http://localhost:5173">http://localhost:5173</a>
(or whichever port <code>npm run dev</code> printed as “Local”).</p>
<p>Want a single port instead? Run <code>npm start</code>, which builds the app and serves it here.</p>
<p style="color:#777">Timetable: ${gtfs ? `${gtfs.stopCount} stops loaded` : loadError || 'loading…'}</p></body>`);
    } catch (err) {
      console.error(err);
      send(res, 500, { error: 'Server error' });
    }
  })
  .listen(PORT, () => console.log(`[api] listening on http://localhost:${PORT}${serveApp ? ' (serving the app too)' : ''}`));
