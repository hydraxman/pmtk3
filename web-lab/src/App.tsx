import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Snapshot } from '../shared/contracts';
import type { AdapterId } from '../shared/numerics';
import { demoExecutedSuccess, demoSearchText, executionStatus, inventoryMetrics, sharedBatchBusyMessage } from '../shared/catalog';
import { needsAttention } from '../shared/execution';
import { loadState, mutate } from './api';
import { DemoCard, Status } from './components/catalog';
import DemoDetail from './components/DemoDetail';
import Plot from './components/Plot';
import DataPanel from './components/DataPanel';
import { reproductionIds } from '../shared/reproductions/manifest';
const Lab = lazy(() => import('./components/Lab'));
const Reproductions = lazy(() => import('./components/Reproductions'));
const chapterNumber = (id: string) => Number(id.match(/^\((\d+)\)/)?.[1] ?? 999);
const chapterTitle = (title: string) => title.replace(/^\(\d+\)-/, '').replaceAll('_', ' ');
const pageSize = 24;
function Mark() {
  return <svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true"><rect width="36" height="36" rx="10" fill="#33b8a4" />
    <path d="M7 25h5V15h5V9h5v9h5v7" fill="none" stroke="#102231" strokeWidth="2.8" strokeLinejoin="round" /><circle cx="27" cy="11" r="2" fill="#102231" /></svg>;
}
function ChapterChart({ state }: { state: Snapshot }) {
  const data = useMemo(() => {
    const chapters = [...state.chapters].sort((a, b) => chapterNumber(a.id) - chapterNumber(b.id));
    const groups = [
      { name: 'Current success', color: '#0b9389', test: (s: string) => s === 'success' },
      { name: 'Needs attention', color: '#ec9652', test: needsAttention },
      { name: 'Other / pending', color: '#dce4ef', test: (s: string) => s !== 'success' && !needsAttention(s) },
    ];
    return groups.map(g => ({ x: chapters.map(c => `Ch ${chapterNumber(c.id)}`),
      y: chapters.map(c => state.entries.filter(e => e.chapters.includes(c.id) && g.test(executionStatus(e))).length),
      text: chapters.map(c => chapterTitle(c.title)), type: 'bar' as const, name: g.name,
      marker: { color: g.color }, hovertemplate: '%{text}: %{y}<extra>%{fullData.name}</extra>' }));
  }, [state.chapters, state.entries]);
  return <Plot data={data} label="Chapter coverage grouped by latest original execution status" height={240}
    layout={{ barmode: 'stack', margin: { t: 35, l: 38, r: 12, b: 45 }, yaxis: { title: { text: 'Entries' } } }} />;
}
export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(), [error, setError] = useState('');
  const [view, setView] = useState<'catalog' | 'lab' | 'queue' | 'reproductions'>('catalog');
  const [chapter, setChapter] = useState('*'), [query, setQuery] = useState(''), [status, setStatus] = useState('*');
  const [scope, setScope] = useState('all'), [page, setPage] = useState(0), [selected, setSelected] = useState<string>();
  const [adapter, setAdapter] = useState<AdapterId>('beta'), [mobileNav, setMobileNav] = useState(false);
  const [showChart, setShowChart] = useState(false), [queueError, setQueueError] = useState('');
  const [isMobile, setIsMobile] = useState(() => matchMedia('(max-width: 700px)').matches);
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  const closeDetail = useCallback(() => setSelected(undefined), []);
  useEffect(() => {
    const media = matchMedia('(max-width: 700px)');
    const update = () => setIsMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement;
      if (event.key === '/' && view === 'catalog' && !selected &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) && !element.isContentEditable) {
        event.preventDefault();
        document.getElementById('demo-search')?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [selected, view]);
  useEffect(() => {
    let active = true, inFlight = false, timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      if (!active || inFlight) return;
      clearTimeout(timer);
      inFlight = true;
      try {
        if (!document.hidden) {
          const data = await loadState(controller.signal);
          if (active) { setSnapshot(data); setError(''); }
        }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Could not reach the local service'); }
      finally { inFlight = false; if (active) timer = setTimeout(poll, 3000); }
    };
    refreshRef.current = () => { void poll(); };
    const visibility = () => { if (!document.hidden) void poll(); };
    document.addEventListener('visibilitychange', visibility);
    void poll();
    return () => { active = false; controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => { setPage(0); }, [chapter, query, status, scope]);
  const chapters = useMemo(() => [...(snapshot?.chapters ?? [])].sort((a, b) => chapterNumber(a.id) - chapterNumber(b.id)), [snapshot?.chapters]);
  const filtered = useMemo(() => {
    const search = query.toLowerCase().trim();
    return (snapshot?.entries ?? []).filter(e =>
      (chapter === '*' || (chapter === 'unmapped' ? !e.chapters.length : e.chapters.includes(chapter))) &&
      (status === '*' || executionStatus(e) === status) &&
      (scope === 'all' || (scope === 'published' ? e.published.length > 0 : e.published.length === 0)) &&
      (!search || demoSearchText(e).includes(search)));
  }, [snapshot?.entries, chapter, query, status, scope]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
  const statuses = useMemo(() => [...new Set(snapshot?.entries.map(executionStatus) ?? [])].sort(), [snapshot?.entries]);
  const activeJobs = snapshot?.jobs.filter(j => ['queued', 'running'].includes(j.status)) ?? [];
  function navigate(next: typeof view) { setView(next); setMobileNav(false); window.scrollTo(0, 0); }
  function chooseChapter(id: string) { setChapter(id); navigate('catalog'); }
  const successCount = snapshot?.entries.filter(demoExecutedSuccess).length ?? 0;
  const metrics = useMemo(() => snapshot ? inventoryMetrics(snapshot.entries, snapshot.counts) : undefined, [snapshot]);
  return <div className="app-shell">
    <button className="mobile-menu" onClick={() => setMobileNav(!mobileNav)} aria-expanded={mobileNav} aria-label="Toggle navigation">☰</button>
    <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`} inert={isMobile && !mobileNav}>
      <a className="brand" href="#" onClick={event => { event.preventDefault(); chooseChapter('*'); }}><Mark /><span>PMTK<span className="brand-number">3</span><small>PROBABILITY LAB</small></span></a>
      <p className="sidebar-label">WORKSPACE</p>
      <nav className="workspace-nav" aria-label="Workspace">
        <button className={view === 'catalog' ? 'active' : ''} onClick={() => navigate('catalog')}><span>▦</span> Demo explorer <b>{snapshot?.entries.length ?? '…'}</b></button>
        <button className={view === 'lab' ? 'active' : ''} onClick={() => navigate('lab')}><span>⌁</span> Interactive lab <b>6</b></button>
        <button className={view === 'reproductions' ? 'active' : ''} onClick={() => navigate('reproductions')}><span>◈</span> Visual reproductions <b>{reproductionIds.length}</b></button>
        <button className={view === 'queue' ? 'active' : ''} onClick={() => navigate('queue')}><span>≋</span> Run queue <b>{activeJobs.length}</b></button>
      </nav>
      <div className="chapter-label"><p className="sidebar-label">BOOK CHAPTERS</p><span>{chapters.length}</span></div>
      <nav className="chapter-nav" aria-label="Book chapters">
        <button className={view === 'catalog' && chapter === '*' ? 'active' : ''} onClick={() => chooseChapter('*')}><span className="chapter-num">⊞</span><span>All demonstrations</span></button>
        {chapters.map(c => <button key={c.id} onClick={() => chooseChapter(c.id)} className={view === 'catalog' && chapter === c.id ? 'active' : ''}>
          <span className="chapter-num">{String(chapterNumber(c.id)).padStart(2, '0')}</span><span>{chapterTitle(c.title)}</span>
        </button>)}
        <button className={view === 'catalog' && chapter === 'unmapped' ? 'active' : ''} onClick={() => chooseChapter('unmapped')}>
          <span className="chapter-num">···</span><span>Other / unmapped sources</span></button>
      </nav>
      <footer className="sidebar-footer"><span className="live-dot" /> Local-first laboratory<small>React · TypeScript · GNU Octave</small></footer>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div><span className="breadcrumb">Workspace</span><span className="slash">/</span>{view === 'catalog' ? 'Demo explorer' : view === 'lab' ? 'Interactive lab' : view === 'reproductions' ? 'Visual reproductions' : 'Run queue'}</div>
        <div className="topbar-right"><span className={`live-dot ${error ? 'offline' : ''}`} /><span>{error ? 'Disconnected' : snapshot ? 'Local service connected' : 'Connecting…'}</span>
          <a href="https://github.com/probml/pmtk3" target="_blank" rel="noreferrer">Original project ↗</a></div>
      </header>
      <main id="main">
        {error && <div className="notice error" role="alert">{error} <button className="text-button" onClick={refresh}>Try again</button>{snapshot && ' · Last readable data retained.'}</div>}
        {snapshot?.warning && <p className="notice warning" role="status">{snapshot.warning}</p>}
        {!snapshot ? <div className="loading-view"><div className="loading-orbit" /><h1>Opening the laboratory</h1><p>Reading original sources and durable execution results…</p>
          {error && <p>Start the API with <code>npm start</code> after <code>npm run build</code>, and verify demo-results/inventory.json exists.</p>}</div> :
          <>
            {view === 'catalog' && <>
              <section className="hero"><div><p className="eyebrow"><span /> THE PROBABILISTIC MACHINE LEARNING TOOLKIT</p>
                <h1>Ideas become<br /><em>experiments.</em></h1>
                <p>Explore the original PMTK3 collection. Run the MATLAB sources in Octave, inspect real results, or learn by changing the model yourself.</p>
                <button className="button primary" onClick={() => navigate('lab')}>Enter the interactive lab <span>↗</span></button>
                <span className="hero-caption">6 live TypeScript models · all original cases in the explorer</span>
              </div><div className="hero-art" aria-hidden="true">
                <div className="art-label">POSTERIOR EXPLORATION <span>θ ∈ [0,1]</span></div>
                <svg viewBox="0 0 340 190"><defs><linearGradient id="density" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#0b9389" stopOpacity=".25" /><stop offset="100%" stopColor="#0b9389" stopOpacity="0" /></linearGradient></defs>
                  {[40, 80, 120, 160].map(y => <path key={y} d={`M15 ${y}H325`} stroke="#d7e5e5" strokeDasharray="3 5" />)}
                  <path d="M15 167 C60 166 62 142 90 142 C130 142 128 30 180 30 C231 30 222 140 267 154 C290 162 300 167 325 167 L325 178 L15 178Z" fill="url(#density)" />
                  <path d="M15 167 C60 166 62 142 90 142 C130 142 128 30 180 30 C231 30 222 140 267 154 C290 162 300 167 325 167" fill="none" stroke="#0b9389" strokeWidth="3" />
                  <path d="M15 167 C75 165 80 78 141 78 C201 78 220 165 325 167" fill="none" stroke="#a0b6c1" strokeDasharray="5 6" strokeWidth="2" />
                  <circle cx="180" cy="30" r="5" fill="#0b9389" stroke="#f1faf8" strokeWidth="3" />
                </svg><div className="art-footer"><span><i /> A little evidence.</span><span>A clearer picture.</span></div>
              </div></section>
              <section className="metrics" aria-label="Inventory metrics">
                {[
                  [String(metrics!.sources), 'Original .m sources', `${snapshot.entries.length} inventory entries · read from disk`],
                  [String(metrics!.runnable), 'Eligible to attempt', `Static policy · ${metrics!.blocked} safety-blocked · ${metrics!.unsupported} unsupported`],
                  [String(metrics!.published), 'Book-published demos', `${metrics!.mapped}/${metrics!.published} source-linked · ${metrics!.renames} verified renames`],
                  [String(successCount), 'Current original successes', 'Latest attempt only · not historical images'],
                ].map(([value, name, note]) => <div className="metric" key={name}><span>{name}</span><strong>{value}<i>↗</i></strong><small>{note}</small></div>)}
              </section>
              <p className="small muted policy-note">Eligibility is static policy, not proof that every demo will work. Runtime dependencies can produce additional unsupported outcomes; current statuses and successes are shown separately.</p>
              {snapshot.learningCoverage && <p className="notice info learning-coverage">
                <strong>{snapshot.learningCoverage.availableRoutes} / {snapshot.learningCoverage.standalone} learning routes available</strong>
                {' · '}{snapshot.learningCoverage.originalSuccesses} successful original workloads · {snapshot.learningCoverage.independentAlternatives} independent visual alternatives.
                {' '}Alternatives do not change original execution status. <button className="text-button" onClick={() => navigate('reproductions')}>Explore visual reproductions</button>
              </p>}
              {(snapshot.sharedRunner.active || activeJobs.length > 0) && <section className="live-progress" aria-label="Live original execution progress" aria-live="polite">
                <div><span className="live-dot" /><strong>{snapshot.sharedRunner.active ? 'Shared original batch is running' : 'Your original execution queue is active'}</strong>
                  <span>{snapshot.sharedRunner.active && snapshot.sharedProgress
                    ? `${snapshot.sharedProgress.completed} / ${snapshot.sharedProgress.total} attempts finished · ${snapshot.sharedProgress.active.length} active`
                    : `${activeJobs.filter(j => j.status === 'running').length} running · ${activeJobs.filter(j => j.status === 'queued').length} queued`}</span></div>
                {snapshot.sharedRunner.active && snapshot.sharedProgress && <progress max={Math.max(1, snapshot.sharedProgress.total)}
                  value={snapshot.sharedProgress.completed} aria-label="Completed originals in current shared batch" />}
                <p>{snapshot.sharedRunner.active && snapshot.sharedProgress?.active.length ? snapshot.sharedProgress.active.join(' · ') :
                  activeJobs.map(j => j.demoId).slice(0, 3).join(' · ') || 'Waiting for the next durable harness snapshot…'}</p>
                {snapshot.sharedRunner.active && <p>{sharedBatchBusyMessage} Finished attempts include failures and timeouts, not only passes.</p>}
                {snapshot.sharedRunner.active && snapshot.sharedProgress?.memory_limit_mib !== undefined &&
                  <p>Configured memory limit: {snapshot.sharedProgress.memory_limit_mib} MiB per process and owned tree.</p>}
              </section>}
              <section className="coverage"><button onClick={() => setShowChart(!showChart)} aria-expanded={showChart}>
                <span><span className="coverage-icon">▥</span><strong>Chapter execution coverage</strong><small>Current original outcomes across {chapters.length} published chapter groups</small></span><b>{showChart ? '−' : '+'}</b>
              </button>{showChart && <div className="coverage-chart"><ChapterChart state={snapshot} /><p className="small muted">Chapter membership follows the published directory. Multi-chapter entries can appear more than once. Unmapped sources remain visible below.</p></div>}</section>
              <DataPanel onFindSource={source => {
                setChapter('*'); setQuery(source); setStatus('*'); setScope('all');
                requestAnimationFrame(() => document.querySelector('.catalog')?.scrollIntoView({ block: 'start' }));
              }} />
              <section className="catalog">
                <div className="section-heading"><div><p className="eyebrow">THE ORIGINAL COLLECTION</p>
                  <h2>{chapter === '*' ? 'Explore demonstrations' : chapter === 'unmapped' ? 'Other / unmapped sources' : chapterTitle(chapters.find(c => c.id === chapter)?.title ?? chapter)}</h2></div>
                  <span className="updated">Snapshot {new Date(snapshot.refreshedAt).toLocaleTimeString()} · refresh ≤3s + request</span></div>
                <div className="catalog-toolbar">
                  <label className="search-field"><span aria-hidden="true">⌕</span><input id="demo-search" type="search" aria-label="Search demonstrations" placeholder="Search a model, method, or source…" value={query} onChange={e => setQuery(e.target.value)} />
                    <kbd>/</kbd></label>
                  <label className="filter-field"><span>Status</span><select aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)}><option value="*">All statuses</option>{statuses.map(s => <option value={s} key={s}>{s === 'source_missing' ? 'Unmapped source' : s.replaceAll('_', ' ')}</option>)}</select></label>
                  <label className="filter-field"><span>Collection</span><select aria-label="Filter collection" value={scope} onChange={e => setScope(e.target.value)}>
                    <option value="all">All originals</option><option value="published">Book-published</option><option value="other">Other sources</option></select></label>
                </div>
                <div className="results-caption"><span><strong>{filtered.length}</strong> demonstrations{query && ` matching “${query}”`}</span><span>Original source → Octave result</span></div>
                {filtered.length ? <div className="demo-grid">{filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(demo => <DemoCard demo={demo} onOpen={setSelected} key={demo.id} />)}</div> :
                  <div className="empty"><h3>No matching demonstrations</h3><p>Try a different chapter, status, or search term.</p><button className="button secondary" onClick={() => { setChapter('*'); setQuery(''); setStatus('*'); setScope('all'); }}>Reset filters</button></div>}
                {filtered.length > pageSize && <nav className="pagination" aria-label="Results pages"><button className="button secondary" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 0}>← Previous</button>
                  <span>Page {currentPage + 1} of {Math.ceil(filtered.length / pageSize)}</span><button className="button secondary" onClick={() => setPage(currentPage + 1)} disabled={(currentPage + 1) * pageSize >= filtered.length}>Next →</button></nav>}
              </section>
            </>}
            {view === 'lab' && <Suspense fallback={<div className="empty">Loading interactive numerical models…</div>}><Lab selected={adapter} onSelect={setAdapter} /></Suspense>}
            {view === 'reproductions' && <Suspense fallback={<div className="empty">Loading recovered experiments…</div>}><Reproductions /></Suspense>}
            {view === 'queue' && <section className="queue-view"><p className="eyebrow">OWNED COMPUTE, TRANSPARENT RESULTS</p><h1>Your execution queue</h1>
              <p className="section-intro">One user-run original at a time. Parent batches take priority: web runs pause while the shared batch lock is active. This service only writes to web-lab/results.</p>
              <div className="runtime-grid"><div><span className={`live-dot ${snapshot.runtime.python ? '' : 'offline'}`} /> Python {snapshot.runtime.python ? 'ready' : 'not detected'}</div>
                <div><span className={`live-dot ${snapshot.runtime.octave ? '' : 'offline'}`} /> Octave {snapshot.runtime.octave ? 'ready' : 'not detected'}</div></div>
              {snapshot.runtime.configured && <p className="notice info configured-runtime">Configured next user run: {snapshot.runtime.configured.binary_kind === 'gui-linked' ? 'GUI-linked Qt' : 'Console / gnuplot'}
                {' · '}{snapshot.runtime.configured.selection} · <code>{snapshot.runtime.configured.executable}</code>. Actual saved-attempt profiles are shown in demo details.</p>}
              <p className="notice info">Shared inventory: {snapshot.sharedRunner.message} Web results: {snapshot.localRunner.message}</p>
              {snapshot.sharedRunner.active && <p className="notice warning" role="status">{sharedBatchBusyMessage}</p>}
              {queueError && <p className="notice error" role="alert">{queueError}</p>}
              {!snapshot.jobs.length ? <div className="empty"><h3>A clean workbench</h3><p>Open any runnable original in the explorer to queue a new attempt.</p><button className="button primary" onClick={() => navigate('catalog')}>Explore originals →</button></div> :
                <div className="queue-list">{[...snapshot.jobs].reverse().map(job => <article key={job.id}>
                  <div><button className="text-button" onClick={() => setSelected(job.demoId)}>{job.demoId} ↗</button><small>{new Date(job.createdAt).toLocaleString()}</small></div>
                  <Status status={job.status} /><p>{job.message || 'Waiting for the original harness…'}</p>
                  {['queued', 'running'].includes(job.status) && <button className="button danger" onClick={async () => {
                    try { await mutate(`/api/runs/${job.id}/cancel`, {}, snapshot.csrf); refresh(); }
                    catch (e) { setQueueError(e instanceof Error ? e.message : 'Cancellation failed'); }
                  }}>Cancel</button>}
                  {job.output && <details><summary>Runner console</summary><pre className="log">{job.output}</pre></details>}
                </article>)}</div>}
            </section>}
            <footer className="main-footer"><span>PMTK3 laboratory <span className="footer-dot">·</span> Local data, open exploration</span>
              <p>Original toolkit by Matt Dunham, Kevin Murphy & contributors. Interactive adapters are independent reproductions, not book text or original outputs.</p>
              <p>Static safety review is not a sandbox. Run only trusted source code. <a href="https://github.com/probml/pmtk3" target="_blank" rel="noreferrer">Source & attribution ↗</a></p></footer>
          </>}
      </main>
    </div>
    {selected && snapshot && <DemoDetail key={selected} id={selected} snapshot={snapshot} onClose={closeDetail} refresh={refresh} />}
  </div>;
}
