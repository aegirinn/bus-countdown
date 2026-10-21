// A low, synthesized church-style bell (no audio files needed).
// Browsers only allow sound after a tap, so unlockAudio() must be called from the bell button's click.

let ctx = null;

export function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Inharmonic partials of a real bell (hum, prime, tierce, quint, nominal…), relative to the strike note
const PARTIALS = [
  [0.5, 0.5, 4.5],
  [1.0, 0.9, 3.2],
  [1.19, 0.35, 2.4],
  [1.5, 0.25, 2.0],
  [2.0, 0.3, 1.6],
  [2.66, 0.12, 1.0],
  [3.01, 0.08, 0.8],
];

function strike(at, base, volume) {
  const out = ctx.createGain();
  out.gain.value = volume;
  out.connect(ctx.destination);
  for (const [ratio, amp, decay] of PARTIALS) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = base * ratio;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(amp, at + 0.008); // hard strike
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }
}

/** Ring the bell `times` times. */
export function ringBell({ times = 3, gap = 1.3, base = 196, volume = 0.45, vibrate = true } = {}) {
  if (!unlockAudio()) return;
  const t0 = ctx.currentTime + 0.05;
  for (let i = 0; i < times; i++) strike(t0 + i * gap, base, volume);
  if (vibrate) try {
    navigator.vibrate?.([300, 200, 300, 200, 300]); // Android phones also buzz
  } catch {
    /* not supported */
  }
}

/** One soft tap so people hear what the alarm sounds like when they turn it on. */
export const previewBell = () => ringBell({ times: 1, volume: 0.2, vibrate: false });
