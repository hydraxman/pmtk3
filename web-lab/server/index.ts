import { buildApp } from './app.js';
import { port } from './config.js';

const { app, queue } = await buildApp();
process.once('exit', () => queue.emergencyStop());
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
try {
  await app.listen({ host: '127.0.0.1', port });
  console.log(`PMTK3 laboratory: http://127.0.0.1:${port}`);
  console.log('Original harness outputs: web-lab/results (shared demo-results is read-only).');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
