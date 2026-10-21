// Empty = same server as the page. Set VITE_API_BASE=https://your-app.onrender.com when building a native app.
const BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

async function get(path) {
  const res = await fetch(BASE + path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const api = {
  status: () => get('/api/status'),
  search: (q) => get(`/api/stops?q=${encodeURIComponent(q)}`),
  nearby: (lat, lon) => get(`/api/stops?lat=${lat}&lon=${lon}`),
  stop: (key) => get(`/api/stops/${encodeURIComponent(key)}`),
  arrivals: (key, route, limit = 8) =>
    get(`/api/stops/${encodeURIComponent(key)}/arrivals?limit=${limit}${route ? `&route=${encodeURIComponent(route)}` : ''}`),
};
