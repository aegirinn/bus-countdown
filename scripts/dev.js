// Starts the timetable API and the Vite dev server together (works on Windows, macOS and Linux).
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const sample = process.argv.includes('--sample');
const viteBin = 'node_modules/vite/bin/vite.js';

if (!fs.existsSync(viteBin)) {
  console.error('\nVite is not installed yet. Run this first, in the bus-countdown folder:\n\n  npm install\n');
  process.exit(1);
}

const procs = [
  ['api', ['server/index.js', ...(sample ? ['--sample'] : [])]],
  ['web', [viteBin]],
].map(([name, args]) => {
  const p = spawn(process.execPath, args, { stdio: 'inherit' });
  p.on('exit', (code) => {
    console.log(`[${name}] stopped${code ? ` (exit code ${code})` : ''}`);
    shutdown(code ?? 0);
  });
  return p;
});

function shutdown(code) {
  for (const p of procs) if (p.exitCode === null) p.kill();
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
