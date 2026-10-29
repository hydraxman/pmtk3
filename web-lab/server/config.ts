import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findExecutable, selectOctave } from './runtime-selection.js';

function findWebRoot() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    try {
      if (JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).name === 'pmtk3-web-lab') return dir;
    } catch { /* Continue to the parent of the compiled server. */ }
    dir = path.dirname(dir);
  }
  throw new Error('Cannot locate web-lab/package.json');
}
export const webRoot = findWebRoot();
export const repoRoot = path.dirname(webRoot);
export const sharedRoot = path.join(repoRoot, 'demo-results');
export const localRoot = path.join(webRoot, 'results');
export const stateRoot = path.join(webRoot, '.state');
export const harness = path.join(repoRoot, 'demo-lab', 'run_demos.py');
export const bootstrap = path.join(webRoot, 'server', 'launch_harness.py');
export const port = Number(process.env.WEB_LAB_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('WEB_LAB_PORT must be 1024–65535');
export const dev = process.env.WEB_LAB_DEV === '1';

export function detectRuntime() {
  const runtime = path.join(repoRoot, '.demo-runtime');
  // Configuration is operator-only; no HTTP endpoint can set executable paths.
  const python = process.env.WEB_LAB_PYTHON || findExecutable(path.join(runtime, 'python'), ['python.exe', 'python3', 'python'], 2);
  // The harness configures the GUI-linked binary's child-only Qt environment and --no-gui.
  const configured = selectOctave(path.join(runtime, 'octave'), process.platform, process.env.WEB_LAB_OCTAVE);
  return {
    python: python && path.isAbsolute(python) && existsSync(python) ? python : undefined,
    octave: configured?.executable,
    configured,
  };
}
