import { useEffect, useRef, useState } from 'react';
import type { DemoDetail as Detail, Snapshot } from '../../shared/contracts';
import { loadDetail, mutate } from '../api';
import { Status, humanize, purpose } from './catalog';
import { canRunInOctave, historicalAliases, octaveUnsupported, sharedBatchBusyMessage } from '../../shared/catalog';
import { webRunLimits } from '../../shared/execution';
import { hasReproduction } from '../../shared/reproductions/manifest';
import ReproductionPanel from './ReproductionPanel';

function hasWarnings(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}
export default function DemoDetail({ id, snapshot, onClose, refresh }: {
  id: string; snapshot: Snapshot; onClose: () => void; refresh: () => void;
}) {
  const [detail, setDetail] = useState<Detail>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [trusted, setTrusted] = useState(false), [attemptIndex, setAttemptIndex] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        if (!document.hidden) {
          const result = await loadDetail(id, controller.signal);
          if (active) { setDetail(result); setError(''); }
        }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Detail unavailable'); }
      finally { if (active) timer = setTimeout(poll, 3000); }
    };
    void poll();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [id]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const nodes = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,summary,[tabindex="0"]')];
        if (!nodes.length) { event.preventDefault(); return; }
        const first = nodes[0], last = nodes.at(-1)!;
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) {
          event.preventDefault(); first.focus();
        }
      }
    }
    document.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, [onClose]);
  async function run() {
    setBusy(true);
    try { await mutate('/api/runs', { demoId: detail?.demo.id ?? id }, snapshot.csrf); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Run failed'); }
    finally { setBusy(false); }
  }
  const job = snapshot.jobs.filter(j => j.demoId === (detail?.demo.id ?? id)).at(-1);
  const active = job && ['queued', 'running'].includes(job.status);
  const demo = detail?.demo, attempt = detail?.attempts[Math.min(attemptIndex, detail.attempts.length - 1)];
  const unsupported = demo && octaveUnsupported(demo);
  const previousSavedAttempt = !!(attempt?.label.startsWith('Web lab') && job &&
    Date.parse(attempt.result.started_at ?? '') < Date.parse(job.createdAt));
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-title" ref={dialog} tabIndex={-1}>
      <header className="detail-top"><span className="eyebrow">ORIGINAL PMTK3 DEMONSTRATION</span><button className="icon-button" onClick={onClose} aria-label="Close demo details">✕</button></header>
      {error && <p className="notice error" role="alert">{error}</p>}
      {!detail ? <div className="empty">Loading original source and artifacts…</div> : <>
        <div className="detail-heading"><h2 id="detail-title">{humanize(demo!.name)}</h2><code>{demo!.name}</code><p>{purpose(demo!)}</p>
          <div className="tag-row"><span className="tag">{demo!.kind === 'source_missing' ? 'source mapping pending' : demo!.kind}</span><span className="tag">{demo!.entry_type || 'no source mapping'}</span>
            {demo!.chapters.map(c => <span className="tag" key={c}>{c.replace(/^\((\d+)\)-/, '$1 · ').replaceAll('_', ' ')}</span>)}</div>
        </div>
        {!!historicalAliases(demo!).length && <section className="notice info alias-provenance">
          <strong>Historical published name → current original source</strong>
          {historicalAliases(demo!).map(alias => <p key={alias.published_stem}>
            <code>{alias.published_stem}</code> → <code>{alias.source}</code><br />
            {alias.reason || 'Source alias recorded by the inventory'} · {alias.change || 'rename'}{alias.date ? ` · ${alias.date}` : ''} · {' '}
            {/^[a-f0-9]{40}$/i.test(alias.commit) ? <a href={`https://github.com/probml/pmtk3/commit/${alias.commit}`} target="_blank" rel="noreferrer">commit {alias.commit.slice(0, 8)} ↗</a> : <code>{alias.commit}</code>}
          </p>)}
        </section>}
        {hasReproduction(id) && <ReproductionPanel key={id} id={id} />}
        <section className="execution-box">
          <div><h3>Run the original, locally</h3><p>Python harness → GNU Octave · {webRunLimits.timeoutSeconds}-second demo timeout · {webRunLimits.memoryLimitMiB} MiB process/tree caps · one user run at a time</p></div>
          {snapshot.runtime.configured && <p className="small configured-runtime">Configured next user run: <strong>{snapshot.runtime.configured.binary_kind === 'gui-linked' ? 'GUI-linked Qt' : 'Console / gnuplot'}</strong>
            {' · '}{snapshot.runtime.configured.selection} · <code>{snapshot.runtime.configured.executable}</code>.
            {' '}This setting does not describe older attempts. Rendering failures do not trigger a console retry.</p>}
          {demo!.safety.length > 0 && <div className="notice warning"><strong>Safety-blocked</strong>{demo!.safety.map((s, i) =>
            <p key={i}>Line {s.line}: {s.operation} — {s.reason}</p>)}</div>}
          {!demo!.source && <p className="notice warning">This published reference has no source mapping in the latest inventory. Execution is unavailable until that mapping is recorded.</p>}
          {!demo!.runnable && demo!.source && <p className="notice warning">This entry is a helper or requires inputs; it is not a standalone runnable candidate.</p>}
          {unsupported && <div className="notice warning"><strong>Unsupported in Octave — workload not executed</strong>
            <p>Requirement: {unsupported.requirement}. {unsupported.reason}</p>
            <p>A leading early return or old exit-0 record is not an executed pass. Any retained attempt evidence remains historical.</p></div>}
          {(!snapshot.runtime.octave || !snapshot.runtime.python) && <p className="notice warning">Runtime provisioning is in progress. Original execution becomes available when Python and Octave are detected. Interactive models work now.</p>}
          {snapshot.sharedRunner.active && <p className="notice warning" role="status">{sharedBatchBusyMessage}</p>}
          <label className="trust"><input type="checkbox" checked={trusted} onChange={event => setTrusted(event.target.checked)} />
            I trust this original code. Static triage and isolated working directories are not a security sandbox.</label>
          <button className="button primary" onClick={() => void run()} disabled={busy || !!active || !trusted ||
            snapshot.sharedRunner.active || !canRunInOctave(demo!) || !snapshot.runtime.python || !snapshot.runtime.octave}>
            {active ? `${job.status === 'queued' ? 'Queued' : 'Running'}…` : busy ? 'Submitting…' : job ? 'Retry original demo ↗' : 'Run original demo ↗'}
          </button>
          <p className="small muted">User artifacts stay in web-lab/results. The parent’s shared demo-results is never modified by this service.</p>
        </section>
        {job && <section className="job-detail">
          <div className="section-heading"><h3>Your latest user run</h3><Status status={job.status} /></div>
          <p className="small">{job.message || (active ? 'Waiting for original harness output…' : 'Run finished.')}</p>
          {active && <button className="button danger" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await mutate(`/api/runs/${job.id}/cancel`, {}, snapshot.csrf); refresh(); }
            catch (e) { setError(e instanceof Error ? e.message : 'Cancellation failed'); }
            finally { setBusy(false); }
          }}>Cancel owned run</button>}
          {job.output && <details><summary>Runner console</summary><pre className="log">{job.output}</pre></details>}
        </section>}
        <section className="attempt-section">
          <div className="section-heading"><h3>Original Octave results</h3><span className="tag">Not TypeScript</span></div>
          <div className="attempt-tabs" role="tablist" aria-label="Original attempt origin">{detail.attempts.map((a, i) =>
            <button key={a.label} role="tab" aria-selected={Math.min(attemptIndex, detail.attempts.length - 1) === i}
              onClick={() => setAttemptIndex(i)}>{a.label}</button>)}</div>
          {attempt && <>
            {attempt.result.classification_only && <p className="notice info">Capability classification only — not an Octave execution attempt.</p>}
            {previousSavedAttempt && <p className="notice warning">Previous saved attempt — the latest user request has not produced a new original result yet. These images and logs are not outputs of that newer request.</p>}
            <div className="result-summary"><Status status={attempt.result.status} />
              {(attempt.result.status === 'unsupported' || attempt.result.workload_executed === false ||
                attempt.result.execution_disposition === 'not_executed') && <span className="tag">Workload not executed</span>}
              <span>{typeof attempt.result.duration_seconds === 'number' ? `${attempt.result.duration_seconds.toFixed(3)}s` : 'Duration not measured'}</span>
              {typeof attempt.result.memory_limit_mib === 'number' && <span>Memory limit: {attempt.result.memory_limit_mib} MiB</span>}
              <span>{attempt.result.finished_at || attempt.result.started_at || 'No execution recorded'}</span></div>
            <p className="small muted">Attempt: <code>{attempt.result.attempt_id || 'none'}</code></p>
            {(attempt.result.message || attempt.result.error) && <pre className="result-error">{attempt.result.message || attempt.result.error?.message || JSON.stringify(attempt.result.error, null, 2)}</pre>}
            {hasWarnings(attempt.result.capture_errors) && <pre className="result-error">Figure export warnings: {JSON.stringify(attempt.result.capture_errors, null, 2)}</pre>}
            {attempt.result.status !== 'success' && attempt.figures.length > 0 &&
              <p className="notice warning">Partial or previous figures — not evidence of a current success.</p>}
            {attempt.figures.length ? <div className="artifact-grid">{attempt.figures.map((image, i) =>
              <figure key={image.url}><a href={image.url} target="_blank" rel="noreferrer"><img src={image.url} loading="lazy"
                alt={`${demo!.name}, ${previousSavedAttempt ? 'previous saved attempt, not the latest request' : attempt.result.status === 'success' ? 'current successful attempt' : 'partial/previous attempt'}, figure ${i + 1}`} /></a>
                <figcaption>{previousSavedAttempt ? 'Previous saved attempt' : attempt.result.status === 'success' ? 'Current attempt' : 'Partial / previous attempt'} · {image.name}</figcaption></figure>)}</div> :
              <div className="empty compact">{attempt.result.status === 'unsupported'
                ? `No Octave workload was executed. Requirement: ${attempt.result.requirement || unsupported?.requirement || 'a supported engine'}. This is not a nonvisual success.`
                : attempt.result.status === 'success'
                ? 'Execution succeeded without a captured figure. Nonvisual successes are valid.'
                : 'No current figures. Run the original or inspect the logs; historical images below are not current results.'}</div>}
            <p className="small muted">Harness success means the original returned without a top-level exception, not independent proof of numerical correctness.</p>
            <div className="artifact-links">{attempt.artifacts.map(a => <a href={a.url} target="_blank" rel="noreferrer" key={a.url}>{a.name} ↗</a>)}</div>
            {attempt.result.runtime_profile ? <details className="recorded-runtime">
              <summary>Recorded runtime profile · actual attempt metadata</summary>
              <p className="small muted">Recorded by the harness for this saved attempt, not inferred from the current web default.</p>
              <pre className="log">{JSON.stringify(attempt.result.runtime_profile, null, 2).slice(0, 16000)}</pre></details>
              : <p className="small muted">No runtime profile was recorded for this saved attempt; current defaults are not applied retroactively.</p>}
            {attempt.result.memory_guard && <details open={attempt.result.status === 'resource_limit'}>
              <summary>Memory guard diagnostics · {attempt.result.memory_guard.enabled ? 'enabled' : 'disabled'}</summary>
              <pre className="log">{JSON.stringify(attempt.result.memory_guard, null, 2).slice(0, 16000)}</pre></details>}
            <details open={['failed', 'resource_limit', 'runner_error', 'timeout'].includes(attempt.result.status)}><summary>Octave log · bounded tail</summary>
              <pre className="log">{attempt.log || 'No log has been recorded for this attempt.'}</pre></details>
          </>}
        </section>
        <details className="reference-section"><summary>Historical published references · {detail.references.length} images · NOT current execution</summary>
          <p>Pre-generated assets shipped with PMTK3. These are never counted as a pass and are not produced by the interactive adapters.</p>
          {detail.references.length ? <div className="artifact-grid historical">{detail.references.map(image =>
            <figure key={image.url}><a href={image.url} target="_blank" rel="noreferrer"><img src={image.url} loading="lazy" alt={`Historical reference for ${demo!.name}; not a current result`} /></a>
              <figcaption>Historical reference · {image.name}</figcaption></figure>)}</div> : <p className="muted">No published image is mapped to this source.</p>}
        </details>
        <details className="source-section"><summary>Original source & metadata</summary>
          <p className="small"><code>{demo!.source || 'Source mapping not recorded'}</code></p>
          <div className="tag-row">{demo!.tags.map((tag, i) => <span key={i} className="tag">{tag.name}{tag.value ? ` · ${tag.value}` : ''}</span>)}</div>
          {demo!.interactive && <p className="notice warning">Interactive calls were detected; stdin is closed, pauses disabled, and the original timeout still applies.</p>}
          <pre className="source-code">{detail.source || 'No original source mapping has been recorded in this inventory.'}</pre>
        </details>
      </>}
    </div>
  </div>;
}
