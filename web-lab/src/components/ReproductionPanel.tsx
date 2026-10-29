import { useState } from 'react';
import type { ReproductionRun } from '../../shared/reproductions/index';
import Plot from './Plot';

export default function ReproductionPanel({ id }: { id: string }) {
  const [seed, setSeed] = useState('42'), [run, setRun] = useState<ReproductionRun>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function execute() {
    setBusy(true); setError(''); setRun(undefined);
    try {
      const response = await fetch(`/api/reproductions/${encodeURIComponent(id)}?seed=${encodeURIComponent(seed)}`);
      if (!response.ok) {
        const body: { error?: string } = await response.json();
        throw new Error(body.error ?? `Experiment failed (${response.status})`);
      }
      setRun(await response.json() as ReproductionRun);
    } catch (e) { setError(e instanceof Error ? e.message : 'Visual reproduction failed'); }
    finally { setBusy(false); }
  }
  return <section className="reproduction-panel" data-demo-id={id}>
    <div className="section-heading"><h3>Independent visual reproduction</h3><span className="tag">TypeScript · not original execution</span></div>
    <p className="notice info">A runnable educational alternative for this case. Original failures, timeouts and safety restrictions remain visible and unchanged.</p>
    <div className="reproduction-controls">
      <label>Random seed <input aria-label="Reproduction random seed" type="number" min="0" max="4294967295"
        value={seed} onChange={event => setSeed(event.target.value)} /></label>
      <button className="button primary" disabled={busy || !/^(0|[1-9][0-9]{0,9})$/.test(seed) || Number(seed) > 0xffffffff}
        onClick={() => void execute()}>{busy ? 'Computing…' : 'Run visual reproduction'}</button>
    </div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {run && <div className="reproduction-result">
      <h4>{run.title}</h4><p>{run.description}</p><p><strong>Method:</strong> {run.method}</p>
      <details open><summary>Differences from the original workload</summary><ul>{run.differences.map((note, i) => <li key={i}>{note}</li>)}</ul></details>
      <p className="small muted">Source inspiration: <code>{run.source}</code> · seed {run.seed} · {run.durationMs.toFixed(1)} ms · {run.scope}</p>
      <div className="reproduction-metrics">{Object.entries(run.result.metrics).map(([name, value]) =>
        <div key={name}><span>{name}</span><strong>{typeof value === 'number' ? Number(value.toPrecision(6)).toString() : value}</strong></div>)}</div>
      {run.result.plots.map((plot, i) => <figure key={`${run.id}-${run.seed}-${i}`} className="reproduction-figure">
        <figcaption>{plot.title}</figcaption>
        <Plot label={`${run.id}: ${plot.title}`} data={plot.traces} height={390} layout={{
          xaxis: { title: { text: plot.xLabel ?? '' } },
          yaxis: { title: { text: plot.yLabel ?? '' },
            ...(plot.traces.some(trace => trace.marker?.symbol === 'square') ? { scaleanchor: 'x', scaleratio: 1 } : {}) },
        }} />
      </figure>)}
      <details><summary>Numerical checks · {run.result.checks.length} passed</summary>
        <ul>{run.result.checks.map((check, i) => <li key={i}>{check.name}{check.detail ? ` — ${check.detail}` : ''}</li>)}</ul></details>
      {run.result.notes?.map((note, i) => <p className="small muted" key={i}>{note}</p>)}
    </div>}
  </section>;
}
