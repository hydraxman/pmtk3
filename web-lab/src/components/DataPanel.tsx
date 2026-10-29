import { useEffect, useMemo, useState } from 'react';
import type { DataMetadata } from '../../shared/contracts';
import { getJSON } from '../api';

export default function DataPanel({ onFindSource }: { onFindSource: (source: string) => void }) {
  const [open, setOpen] = useState(false), [metadata, setMetadata] = useState<DataMetadata>(), [error, setError] = useState('');
  const [query, setQuery] = useState(''), [status, setStatus] = useState('*');
  useEffect(() => {
    if (!open) return;
    let active = true, timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const data = await getJSON<DataMetadata>('/api/data', controller.signal);
        if (active) { setMetadata(data); setError(''); }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Dataset metadata unavailable'); }
      finally { if (active) timer = setTimeout(poll, 15_000); }
    };
    void poll();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [open]);
  const datasets = useMemo(() => (metadata?.audit?.datasets ?? []).filter(d =>
    [d.name, d.note ?? '', ...d.references].join(' ').toLowerCase().includes(query.toLowerCase().trim()) &&
      (status === '*' || (status === 'available' ? d.status === 'available' : d.status !== 'available'))),
  [metadata?.audit?.datasets, query, status]);
  const audit = metadata?.audit;
  const directoryCount = audit?.datasets.filter(d => d.kind === 'directory').length ?? 0;
  return <section className="data-panel">
    <button className="data-panel-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span><span className="coverage-icon">◇</span><strong>Dataset readiness & provenance</strong><small>Audited references, dataset context, and recovered official data</small></span><b>{open ? '−' : '+'}</b>
    </button>
    {open && <div className="data-panel-body">
      {error && <p className="notice error" role="alert">{error}</p>}
      {!metadata && !error && <p className="muted small">Reading local audit and recovery metadata…</p>}
      {metadata?.warning && <p className="notice info">{metadata.warning}</p>}
      {audit && <>
        <div className="data-metrics">
          <div><strong>{audit.available_datasets}/{audit.referenced_datasets}</strong><span>Audited datasets available</span></div>
          <div><strong>{directoryCount}</strong><span>Directory-based datasets included</span></div>
          <div><strong>{metadata.recovery.length}</strong><span>Recovered files with provenance</span></div>
        </div>
        <p className="small muted">{audit.scope}</p>
        <p className="notice info">A static audit gap is <strong>not necessarily an active execution blocker</strong>. Inactive options and MATLAB-builtin datasets can appear in the unresolved set. Use each original run’s log for runtime diagnosis. Directory datasets are counted separately from .mat files.</p>
        <div className="data-controls">
          <label className="field">Find a dataset<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="adultCensus, srbct, sceneContextSUN09…" /></label>
          <label className="field">Audit classification<select value={status} onChange={event => setStatus(event.target.value)}>
            <option value="*">All datasets</option><option value="available">Available locally</option><option value="review">Review runtime context</option>
          </select></label>
        </div>
        <div className="dataset-list" aria-label="Dataset audit records">
          {datasets.map(dataset => <article key={dataset.name}>
            <div className="dataset-title"><code>{dataset.name}</code><span className="tag">{dataset.kind === 'directory' ? 'directory' : dataset.kind}</span>
              <span className={`status ${dataset.status === 'available' ? 'status-success' : 'status-stale'}`}><i />{dataset.status === 'available' ? 'available' : 'review context'}</span></div>
            <p>{dataset.local_paths.length ? dataset.local_paths.join(' · ') : 'No local path resolved by the static audit; runtime requirement is not established.'}</p>
            {dataset.note && <p className="dataset-note">{dataset.note}</p>}
            <div className="dataset-references"><span>Referenced by</span>{dataset.references.map(source =>
              <button key={source} className="text-button" onClick={() => onFindSource(source)}>{source.split('/').at(-1)} ↗</button>)}</div>
          </article>)}
          {!datasets.length && <p className="empty compact">No matching dataset records.</p>}
        </div>
        <p className="small muted data-timestamp">Audit generated: {audit.generated_at || 'not recorded'} · {audit.bundled_mat_files} .mat files recorded by the audit</p>
      </>}
      {!!metadata?.recovery.length && <details className="recovery-details"><summary>Recovered official files · source commit, path, SHA-256, and size</summary>
        <p className="small muted">Read-only provenance from demo-results/data-recovery.json. This panel displays metadata only; it does not download data or mark demos as successful.</p>
        <div className="recovery-list">{metadata.recovery.map(row => <article key={row.file}>
          <strong><code>{row.file}</code></strong><p><code>{row.source_repository}</code> · commit <code>{row.source_commit}</code></p>
          <p>Source path: <code>{row.source_path}</code> · {row.bytes.toLocaleString()} bytes<br />SHA-256: <code>{row.sha256}</code></p>
        </article>)}</div>
      </details>}
    </div>}
  </section>;
}
