import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stateRoot } from '../server/config.js';
import { selectOctave } from '../server/runtime-selection.js';

async function fixture() {
  await mkdir(stateRoot, { recursive: true });
  const root = await mkdtemp(path.join(stateRoot, 'runtime-selection-'));
  const gui = path.join(root, 'version', 'mingw64', 'bin', 'octave-gui.exe');
  const cli = path.join(root, 'octave-cli.exe');
  await mkdir(path.dirname(gui), { recursive: true });
  // Files are selection fixtures only; no test executes them.
  await writeFile(gui, 'not executable');
  await writeFile(cli, 'not executable');
  return { root, gui, cli };
}
test('Windows prefers bundled GUI globally even when a console binary is shallower', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(selectOctave(f.root, 'win32'), { executable: f.gui, binary_kind: 'gui-linked',
      graphics_toolkit: 'qt', selection: 'bundled' });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('explicit Console override wins over bundled GUI and remains gnuplot', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(selectOctave(f.root, 'win32', f.cli), { executable: f.cli, binary_kind: 'console',
      graphics_toolkit: 'gnuplot', selection: 'override' });
    assert.equal(selectOctave(f.root, 'win32', f.gui)?.graphics_toolkit, 'qt');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('invalid executable overrides never silently select another installed binary', async () => {
  const f = await fixture();
  try {
    for (const invalid of ['', 'relative/octave-gui.exe', path.join(f.root, 'missing.exe'), f.root]) {
      assert.equal(selectOctave(f.root, 'win32', invalid), undefined);
    }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('initial Console selection is explicit when the bundled GUI is absent', async () => {
  const f = await fixture();
  try {
    await rm(f.gui);
    assert.deepEqual(selectOctave(f.root, 'win32'), { executable: f.cli, binary_kind: 'console',
      graphics_toolkit: 'gnuplot', selection: 'bundled' });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('non-Windows selection uses its console executable, not a Windows GUI file', async () => {
  const f = await fixture();
  try {
    const cli = path.join(f.root, 'octave-cli');
    await writeFile(cli, 'not executable');
    assert.equal(selectOctave(f.root, 'linux')?.executable, cli);
    assert.equal(selectOctave(f.root, 'linux')?.graphics_toolkit, 'gnuplot');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
