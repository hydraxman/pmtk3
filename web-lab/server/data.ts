import type { DataMetadata, DataRecovery, DatasetRecord } from '../shared/contracts.js';
import { sharedRoot } from './config.js';
import { jsonFile } from './files.js';

export function datasetRecords(rows: unknown[]): DatasetRecord[] {
  return rows.filter((row): row is DatasetRecord => {
    if (!row || typeof row !== 'object') return false;
    const candidate = row as Partial<DatasetRecord>;
    return typeof candidate.name === 'string' && typeof candidate.kind === 'string' &&
      typeof candidate.status === 'string' && [candidate.references, candidate.local_paths, candidate.mat_files]
        .every(list => Array.isArray(list) && list.every(v => typeof v === 'string'));
  }).map(row => ({ ...row, note: typeof row.note === 'string' ? row.note : undefined }));
}

/** Fixed, read-only metadata files only. Dataset contents are never served. */
export async function dataMetadata(directory = sharedRoot): Promise<DataMetadata> {
  const result: DataMetadata = { recovery: [] };
  try {
    const raw = await jsonFile<NonNullable<DataMetadata['audit']>>(directory, 'data-audit.json');
    if (!Array.isArray(raw.datasets)) throw new Error('Invalid audit');
    const datasets = datasetRecords(raw.datasets);
    const count = (value: number, fallback: number) => Number.isInteger(value) && value >= 0 ? value : fallback;
    result.audit = { generated_at: typeof raw.generated_at === 'string' ? raw.generated_at : '',
      scope: typeof raw.scope === 'string' ? raw.scope : 'Recognized dataset references; static availability is not proof of execution.',
      datasets, bundled_mat_files: count(raw.bundled_mat_files, 0),
      referenced_datasets: count(raw.referenced_datasets, datasets.length),
      available_datasets: count(raw.available_datasets, datasets.filter(d => d.status === 'available').length) };
  } catch {
    result.warning = 'Dataset audit is not available yet. Original demo inventory and execution are unaffected.';
  }
  try {
    const raw = await jsonFile<DataRecovery[]>(directory, 'data-recovery.json');
    if (Array.isArray(raw)) result.recovery = raw.filter(row => typeof row.file === 'string' &&
      typeof row.source_repository === 'string' && typeof row.source_commit === 'string' &&
      typeof row.source_path === 'string' && typeof row.sha256 === 'string' && Number.isFinite(row.bytes));
  } catch { /* Optional provenance may be published after the audit. */ }
  return result;
}
