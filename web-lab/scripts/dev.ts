import { spawn } from 'node:child_process';

const bins = ['node_modules/tsx/dist/cli.mjs', 'node_modules/vite/bin/vite.js'];
const children = [
  spawn(process.execPath, [bins[0], 'watch', 'server/index.ts'], {
    stdio: 'inherit', env: { ...process.env, WEB_LAB_DEV: '1' }, shell: false,
  }),
  spawn(process.execPath, [bins[1], '--host', '127.0.0.1'], { stdio: 'inherit', shell: false }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach(child => child.kill('SIGTERM'));
  process.exitCode = code;
}
children.forEach(child => child.once('exit', code => stop(code ?? 1)));
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
console.log('Development UI: http://127.0.0.1:5173 · API: http://127.0.0.1:4173');
