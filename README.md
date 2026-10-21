# Next bus — Strætó countdown

A small React app that shows how long until a bus reaches a stop in Iceland. Pick a stop (search or "Near me"), optionally a route and direction, and it counts down to the next bus and lists the ones after it. Choices can be starred and are kept in the URL, so you can bookmark e.g. `#stop=hlemmur&route=…&to=…`.

## Run it

Needs Node 18 or newer.

```bash
npm install
npm run dev          # API on :3001 + React dev server on :5173 → open http://localhost:5173
```

On first start the server downloads Strætó's open timetable (`https://opendata.straeto.is/data/gtfs/gtfs.zip`, roughly 8 MB) into `data/gtfs/` and refreshes it once a day. Strætó asks people not to download it more often than that.

To try the UI without downloading anything, use the bundled fake timetable (a few made-up routes around Hlemmur, Lækjartorg and Mjódd):

```bash
npm run dev:sample
```

For a single production server (builds the app and serves it with the API on one port):

```bash
npm start            # http://localhost:3001  (PORT=8080 npm start to change)
```

## On Android

**Install from the website (easiest).** Deploy it somewhere with HTTPS (e.g. Render), open the address in Chrome on the phone, then tap ⋮ → *Add to Home screen* / *Install app*. It gets the yellow bus icon and opens full-screen with no browser bar.

**Google Play Store.** Wrap the deployed site with [PWABuilder](https://www.pwabuilder.com): enter your URL, choose *Android*, and it produces a signed package you upload to the Play Console. It still loads your hosted site, so updates go live without a new store release.

**Fully native build (Capacitor).** Only needed if you want native features later (widgets, notifications):

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Next bus" is.nextbus.app --web-dir dist
set VITE_API_BASE=https://your-app.onrender.com   # PowerShell: $env:VITE_API_BASE="https://…"
npm run build
npx cap add android
npx cap open android      # opens Android Studio → Run, or Build → Generate Signed APK
```

The server still has to be hosted, because the phone app gets bus times from it.

## How it works

```
server/
  index.js      HTTP API (Node built-ins only, no Express)
  gtfs.js       downloads + indexes the timetable, computes upcoming departures
  files.js      tiny zip + CSV readers
  realtime.js   optional live delays (see below)
  sample-gtfs/  fake timetable for offline testing
src/
  App.jsx       stop search, route/direction pickers, countdown
```

API:

| Endpoint | Returns |
|---|---|
| `GET /api/stops?q=hlem` | stops matching a name (accent-insensitive: `laekjar`, `thing` → Þing…) |
| `GET /api/stops?lat=64.14&lon=-21.92` | nearest stops |
| `GET /api/stops/:key` | a stop with the routes and directions that serve it |
| `GET /api/stops/:key/arrivals?route=…&limit=8` | next departures (epoch ms) |

Platforms with the same name (one per side of the street) are treated as one stop, and you pick the direction with the "Towards" chips. Buses that terminate at the chosen stop are left out, since you can't board them. Trips after midnight (GTFS times like `24:30:00`) and holiday exceptions in `calendar_dates.txt` are handled.

## Live times (optional)

By default the countdown uses **scheduled** times. Strætó's real-time data is not public; you have to apply to them for access (see straeto.is → About → Open data). If you get a GTFS-Realtime *TripUpdates* feed:

```bash
npm install gtfs-realtime-bindings
STRAETO_RT_URL="https://…" npm run dev
# if the feed needs a key in a header:
STRAETO_RT_HEADER='{"Authorization":"Bearer …"}' STRAETO_RT_URL="https://…" npm run dev
```

The app then shows "Live · expected 08:14 · 3 min late" and drops cancelled trips. If Strætó gives you a different format (historically they've used an XML bus-location feed), `server/realtime.js` is the one file to adapt: it just needs to return an expected time per trip and stop.

Other GTFS feeds work too: `GTFS_URL=https://…/gtfs.zip npm run dev`.

Not affiliated with Strætó bs.
