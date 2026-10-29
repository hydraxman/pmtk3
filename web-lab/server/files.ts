import { lstat, mkdir, open, realpath, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export class HttpError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) { super(message); }
}
/** Create owned output directories without following pre-existing junctions. */
export async function ensureUnlinkedDirectory(directory: string) {
  const absolute = path.resolve(directory), parsed = path.parse(absolute);
  let cursor = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try { await mkdir(cursor); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new HttpError(403, 'Linked output directories are not allowed');
  }
}
/** Reject traversal, alternate streams, symlinks and junctions in every segment. */
export async function confinedFile(root: string, relative: string, maxSize = 20 * 1024 * 1024) {
  if (typeof relative !== 'string' || relative.length > 1500 || !relative ||
    /[\\:\0]/.test(relative) || path.isAbsolute(relative) ||
    relative.split('/').some(v => !v || v === '.' || v === '..')) {
    throw new HttpError(400, 'Invalid artifact path');
  }
  const resolvedRoot = path.resolve(root);
  const canonicalRoot = await realpath(resolvedRoot);
  if (canonicalRoot.toLowerCase() !== resolvedRoot.toLowerCase()) throw new HttpError(403, 'Linked roots are not served');
  let cursor = resolvedRoot;
  for (const segment of relative.split('/')) {
    cursor = path.join(cursor, segment);
    if ((await lstat(cursor)).isSymbolicLink()) throw new HttpError(403, 'Linked files are not served');
  }
  const real = await realpath(cursor);
  const rel = path.relative(canonicalRoot, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new HttpError(403, 'Artifact outside allowed root');
  const info = await stat(real);
  if (!info.isFile() || info.size > maxSize) throw new HttpError(413, 'File unavailable or too large');
  return real;
}
export async function jsonFile<T>(root: string, relative: string): Promise<T> {
  return JSON.parse(await readFile(await confinedFile(root, relative, 12 * 1024 * 1024), 'utf8')) as T;
}
export async function textFile(root: string, relative: string, tail = false, limit = 128 * 1024) {
  const file = await confinedFile(root, relative, 128 * 1024 * 1024);
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat(), length = Math.min(info.size, limit);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, tail ? Math.max(0, info.size - length) : 0);
    return (info.size > limit ? '[Truncated to 128 KiB]\n' : '') + buffer.toString('utf8');
  } finally { await handle.close(); }
}
