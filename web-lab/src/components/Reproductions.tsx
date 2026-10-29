import { useEffect, useState } from 'react';
import type { Reproduction } from '../../shared/reproductions/types';
import ReproductionPanel from './ReproductionPanel';

export default function Reproductions() {
  const [definitions, setDefinitions] = useState<Omit<Reproduction, 'run'>[]>([]);
  const [selected, setSelected] = useState('arsDemo'), [search, setSearch] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/reproductions', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`Cannot read reproduction catalog (${response.status})`);
      const body: { definitions: Omit<Reproduction, 'run'>[] } = await response.json();
      setDefinitions(body.definitions);
    }).catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Catalog unavailable'); });
    return () => controller.abort();
  }, []);
  const matching = definitions.filter(item => `${item.id} ${item.title} ${item.method}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="reproductions-view">
    <p className="eyebrow">RECOVERED LEARNING EFFECTS</p><h1>Every case, a runnable experiment.</h1>
    <p className="section-intro">52 independent visual implementations cover the original failures, timeouts and platform restrictions.
      These are explicitly changed workloads, not 52 newly passing original Octave programs. No unsafe original installer or external crawler is executed.</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    <label className="search-field"><input type="search" aria-label="Search visual reproductions" placeholder="Search recovered cases…"
      value={search} onChange={event => setSearch(event.target.value)} /></label>
    <label className="reproduction-selector">Visual reproduction <select aria-label="Choose visual reproduction" value={selected}
      onChange={event => setSelected(event.target.value)}>
      {!matching.some(item => item.id === selected) && definitions.some(item => item.id === selected) &&
        <option value={selected}>{selected} (selected)</option>}
      {matching.map(item => <option value={item.id} key={item.id}>{item.id} — {item.title}</option>)}
    </select></label>
    <p className="small muted">{matching.length} / {definitions.length} reproductions · source and method differences disclosed for every case</p>
    {!!definitions.length && <ReproductionPanel key={selected} id={selected} />}
  </section>;
}
