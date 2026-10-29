import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ConfiguredOctave } from '../shared/contracts.js';

function isFile(file: string) {
  try { return statSync(file).isFile(); } catch { return false; }
}
export function findExecutable(root: string, names: string[], depth: number): string | undefined {
  if (!existsSync(root) || depth < 0) return undefined;
  for (const name of names) if (isFile(path.join(root, name))) return path.join(root, name);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const found = findExecutable(path.join(root, entry.name), names, depth - 1);
      if (found) return found;
    }
  }
}
export function graphicsToolkit(executable: string): 'qt' | 'gnuplot' {
  return /^octave-gui(?:\.exe)?$/i.test(path.basename(executable)) ? 'qt' : 'gnuplot';
}
/** Initial selection only: rendering failures never cause an engine retry/fallback. */
export function selectOctave(root: string, platform = process.platform, override?: string): ConfiguredOctave | undefined {
  const consoleNames = platform === 'win32' ? ['octave-cli.exe', 'octave.exe'] : ['octave-cli', 'octave'];
  const executable = override !== undefined ? override
    : (platform === 'win32' ? findExecutable(root, ['octave-gui.exe'], 5) : undefined)
      ?? findExecutable(root, consoleNames, 5);
  // An invalid explicit override is an error/not-ready state, not permission to choose another binary.
  if (!executable || !path.isAbsolute(executable) || !isFile(executable)) return undefined;
  const toolkit = graphicsToolkit(executable);
  return { executable, graphics_toolkit: toolkit, binary_kind: toolkit === 'qt' ? 'gui-linked' : 'console',
    selection: override !== undefined ? 'override' : 'bundled' };
}
