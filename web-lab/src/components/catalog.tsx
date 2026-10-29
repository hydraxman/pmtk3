import type { Demo } from '../../shared/contracts';
import { executionStatus, historicalAliases } from '../../shared/catalog';
export function humanize(name: string) {
  return name.replace(/Demo\d*$/i, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
}
export function purpose(demo: Demo) {
  if (!demo.source) return 'Historical published demonstration; a current source mapping has not yet been recorded in this inventory.';
  const description = demo.description?.trim();
  if (description && !/^(function|%|[a-zA-Z]\w*\s*=|clear\b|close\b|if\b)/.test(description)) return description;
  const chapter = demo.chapters[0]?.replace(/^\(\d+\)-/, '').replaceAll('_', ' ').toLowerCase();
  return `Explore ${chapter || 'probabilistic modeling'} through the original ${demo.name} source demonstration.`;
}
export function Status({ status }: { status: string }) {
  return <span className={`status status-${status}`}><i />{status === 'source_missing' ? 'unmapped source' : status.replaceAll('_', ' ')}</span>;
}
export function DemoCard({ demo, onOpen }: { demo: Demo; onOpen: (id: string) => void }) {
  return <button className="demo-card" onClick={() => onOpen(demo.id)}>
    <div className="card-top"><span className="card-index">{demo.chapters[0]?.match(/^\((\d+)\)/)?.[1]?.padStart(2, '0') || '–'}</span><Status status={executionStatus(demo)} /></div>
    <h3>{humanize(demo.name)}</h3><code>{demo.name}</code><p>{purpose(demo)}</p>
    {!!historicalAliases(demo).length && <span className="card-alias">Published as {historicalAliases(demo).map(a => a.published_stem).join(', ')}</span>}
    <div className="card-footer"><span>{demo.published.length ? 'Book-published' : demo.kind === 'helper' ? 'Helper source' : 'Original source'}</span>
      <span>{typeof demo.result.duration_seconds === 'number' ? `${demo.result.duration_seconds.toFixed(2)}s` : 'Inspect →'}</span></div>
  </button>;
}
