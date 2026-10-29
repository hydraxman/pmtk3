import Fastify from 'fastify';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { numericalFixtures, parityFixtures } from '../shared/numerics.js';
import { detectRuntime, dev, localRoot, port, webRoot } from './config.js';
import { confinedFile, HttpError } from './files.js';
import { InventoryStore, runnerLock, sharedProgress } from './inventory.js';
import { RunQueue } from './queue.js';
import { dataMetadata } from './data.js';
import { numericalParityReport } from './parity.js';
import { jobForDisplay } from '../shared/catalog.js';
import { reproductionMetadata, runReproduction } from '../shared/reproductions/index.js';
import { hasReproduction } from '../shared/reproductions/manifest.js';

export async function buildApp(options: { stateDir?: string; batchLockRoot?: string } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 4096, requestTimeout: 15_000,
    connectionTimeout: 10_000, keepAliveTimeout: 5000, routerOptions: { maxParamLength: 4000 },
    ajv: { customOptions: { removeAdditional: false } } });
  const store = new InventoryStore(), queue = new RunQueue(store, options.stateDir, options.batchLockRoot), csrf = randomBytes(32).toString('hex');
  await queue.init();
  const origins = new Set([`http://127.0.0.1:${port}`, ...(dev ? ['http://127.0.0.1:5173'] : [])]);
  const hosts = new Set([...origins].map(o => new URL(o).host));
  app.addHook('onRequest', async (request, reply) => {
    // Host checking defeats DNS rebinding; no wildcard CORS and no localhost alias.
    if (!hosts.has(request.headers.host ?? '')) throw new HttpError(403, 'Use the loopback URL printed by the server');
    if (request.headers.origin && !origins.has(request.headers.origin)) throw new HttpError(403, 'Cross-origin access denied');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      if (!request.headers.origin || !origins.has(request.headers.origin) ||
        request.headers['x-lab-token'] !== csrf || request.headers['sec-fetch-site'] === 'cross-site') {
        throw new HttpError(403, 'Same-origin request and lab token required');
      }
      if (!request.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Use application/json');
    }
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cache-Control', 'no-store');
    // Plotly's SVG layout uses inline styles; no remote code, fonts, or connections.
    reply.header('Content-Security-Policy', `default-src 'self'; script-src 'self'${dev ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'${dev ? ' ws://127.0.0.1:5173' : ''}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
  });
  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, _req, reply) => {
    const code = error.statusCode ?? (error.code === 'ENOENT' ? 404 : 500);
    reply.code(code).send({ code: error instanceof HttpError ? error.code : undefined,
      error: code >= 500 && !(error instanceof HttpError)
      ? 'Local data or runtime unavailable. Check inventory/runtime setup.' : error.message });
  });
  app.get('/api/health', async () => ({ ok: true, service: 'pmtk3-web-lab' }));
  app.get('/api/state', async () => {
    const inventory = await store.merged(), runtime = detectRuntime();
    const standalone = inventory.entries.filter(entry => entry.runnable);
    const learningCoverage = {
      standalone: standalone.length,
      originalSuccesses: standalone.filter(entry => entry.result.status === 'success').length,
      independentAlternatives: standalone.filter(entry => hasReproduction(entry.id)).length,
      availableRoutes: standalone.filter(entry => entry.result.status === 'success' || hasReproduction(entry.id)).length,
    };
    return { ...inventory, learningCoverage, csrf, warning: store.warning, refreshedAt: new Date().toISOString(),
      runtime: { python: !!runtime.python, octave: !!runtime.octave, configured: runtime.configured },
      jobs: queue.jobs.map(job => jobForDisplay(job, inventory.entries.find(e => e.id === job.demoId))),
      sharedRunner: await queue.batchStatus(), localRunner: await runnerLock(localRoot),
      sharedProgress: await sharedProgress() };
  });
  app.get<{ Params: { id: string } }>('/api/demos/:id', async req => store.detail(req.params.id));
  app.get('/api/numerics', async () => numericalFixtures());
  app.get('/api/numerics/parity', async () => parityFixtures());
  app.get('/api/numerics/parity/check', async () => numericalParityReport());
  app.get('/api/data', async () => dataMetadata());
  app.get('/api/reproductions', async () => ({
    scope: 'Independent educational implementations; original results remain unchanged.',
    definitions: reproductionMetadata(),
  }));
  app.get<{ Params: { id: string }; Querystring: { seed?: string } }>('/api/reproductions/:id', {
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 100 } } },
      querystring: { type: 'object', additionalProperties: false,
        properties: { seed: { type: 'string', pattern: '^(0|[1-9][0-9]{0,9})$' } } },
    },
  }, async req => {
    try { return runReproduction(req.params.id, req.query.seed === undefined ? 42 : Number(req.query.seed)); }
    catch (error) {
      if (error instanceof RangeError && /Unknown visual reproduction/.test(error.message)) throw new HttpError(404, error.message);
      if (error instanceof RangeError && /Seed must/.test(error.message)) throw new HttpError(400, error.message);
      throw new HttpError(422, `Reproduction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  app.post<{ Body: { demoId: string } }>('/api/runs', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['demoId'],
      properties: { demoId: { type: 'string', minLength: 1, maxLength: 250 } } } },
  }, async (req, reply) => {
    const job = await queue.enqueue(await store.entry(req.body.demoId));
    return reply.code(202).send(job);
  });
  app.post<{ Params: { id: string } }>('/api/runs/:id/cancel', {
    schema: { body: { type: 'object', additionalProperties: false }, params: {
      type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[a-f0-9-]{36}$' } },
    } },
  }, async req => queue.cancel(req.params.id));
  app.get<{ Params: { token: string } }>('/api/artifacts/:token', async (req, reply) => {
    const { file, ext } = await store.artifact(req.params.token);
    const types: Record<string, string> = { '.png': 'image/png', '.json': 'application/json; charset=utf-8',
      '.log': 'text/plain; charset=utf-8', '.m': 'text/plain; charset=utf-8' };
    reply.type(types[ext]);
    return readFile(file);
  });
  app.get<{ Params: { '*': string } }>('/assets/*', async (req, reply) => {
    const relative = `assets/${req.params['*']}`, ext = path.extname(relative);
    const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
    if (!types[ext]) throw new HttpError(404, 'Unknown asset');
    const file = await confinedFile(path.join(webRoot, 'dist/client'), relative, 8 * 1024 * 1024);
    reply.type(types[ext]).header('Cache-Control', 'public, max-age=31536000, immutable');
    return readFile(file);
  });
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/') || req.method !== 'GET' || path.extname(req.url.split('?')[0])) {
      return reply.code(404).send({ error: 'Not found' });
    }
    try {
      return reply.type('text/html').send(await readFile(await confinedFile(path.join(webRoot, 'dist/client'), 'index.html'), 'utf8'));
    } catch { return reply.code(503).send({ error: 'Frontend not built. Run npm run build, or use npm run dev.' }); }
  });
  app.addHook('onClose', async () => queue.shutdown());
  return { app, queue };
}
