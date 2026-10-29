import { useMemo, useState } from 'react';
import { betaBernoulli, emDemo, hmmDemo, pcaDemo, regressionDemo, sprinkler, type AdapterId, type CovarianceConvention, type Evidence } from '../../shared/numerics';
import Plot from './Plot';

export const learningPath: { id: AdapterId; title: string; subtitle: string; chapter: string; equation: string; purpose: string }[] = [
  { id: 'beta', title: 'Learning from a coin', subtitle: 'Beta–Bernoulli', chapter: '03 · Generative models',
    equation: 'p(θ | D) = Beta(θ; α + heads, β + tails)',
    purpose: 'Watch evidence reshape a prior. The posterior mean is also the probability of heads on the next toss.' },
  { id: 'regression', title: 'Fit, then regularize', subtitle: 'Linear & ridge regression', chapter: '07 · Linear regression',
    equation: 'β̂ = argmin ‖y − Xβ‖² + λ Σⱼ₌₁ᵈ βⱼ²',
    purpose: 'Fit polynomial features with QR least squares. Ridge shrinks the slopes, never the intercept. λ = 0 gives ordinary least squares.' },
  { id: 'pca', title: 'Find the hidden direction', subtitle: '2D principal components', chapter: '12 · Latent linear models',
    equation: 'S = XᶜᵀXᶜ / d,   d = N (default) or N − 1 (sample),   Sv = λv',
    purpose: 'Rotate a cloud of observations and recover its principal axes using a symmetric 2×2 eigendecomposition. The first axis minimizes rank-one reconstruction error.' },
  { id: 'em', title: 'Separate a mixture', subtitle: 'Gaussian mixture EM', chapter: '11 · Mixture models',
    equation: 'rᵢₖ ∝ πₖ N(xᵢ; μₖ, σₖ²),   μₖ ← Σᵢ rᵢₖxᵢ / Σᵢ rᵢₖ',
    purpose: 'Alternate soft assignments with weighted parameter updates. Observe the data log-likelihood, not a classification accuracy. This is a local fit, not a guarantee of the global optimum.' },
  { id: 'hmm', title: 'Infer a hidden sequence', subtitle: 'HMM forward–backward', chapter: '17 · Markov & hidden Markov models',
    equation: 'αₜ(j) = p(yₜ | j) Σᵢ αₜ₋₁(i) Aᵢⱼ,   γₜ ∝ αₜ ⊙ βₜ',
    purpose: 'Smooth state probabilities using all observations in log space. Compare these marginals with Viterbi’s single most probable joint path: they solve different problems.' },
  { id: 'sprinkler', title: 'Reason with evidence', subtitle: 'Sprinkler Bayes network', chapter: '10 · Directed graphical models',
    equation: 'p(C,S,R,W) = p(C) p(S | C) p(R | C) p(W | S,R)',
    purpose: 'Condition a four-node Bayes network by exact enumeration of all 16 assignments. Wet grass can make rain more likely; observing the sprinkler can explain some of it away.' },
];
const fmt = (v: number, digits = 3) => v.toFixed(digits);
function Slider({ name, value, min, max, step = 1, set, suffix = '' }: {
  name: string; value: number; min: number; max: number; step?: number; set: (v: number) => void; suffix?: string;
}) {
  return <label className="slider-label"><span>{name}<output>{value}{suffix}</output></span>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={event => set(Number(event.target.value))} aria-label={name} />
    <small><span>{min}{suffix}</span><span>{max}{suffix}</span></small>
  </label>;
}
function Stats({ values }: { values: [string, string][] }) {
  return <div className="model-stats">{values.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>;
}
function ModelPanel({ controls, children }: { controls: React.ReactNode; children: React.ReactNode }) {
  return <div className="model-grid"><aside className="model-controls"><h3>Experiment controls</h3>{controls}
    <p className="muted small">Local computation · seeded data · double precision</p></aside><div className="model-output">{children}</div></div>;
}
function BetaModel() {
  const [a, setA] = useState(2), [b, setB] = useState(2), [heads, setHeads] = useState(7), [tails, setTails] = useState(3);
  const result = useMemo(() => betaBernoulli(a, b, heads, tails), [a, b, heads, tails]);
  const data = useMemo(() => [
    { x: result.x, y: result.prior, type: 'scatter' as const, mode: 'lines' as const, name: 'Prior', line: { color: '#a5b3c5', dash: 'dash' as const } },
    { x: result.x, y: result.posterior, type: 'scatter' as const, mode: 'lines' as const, name: 'Posterior', fill: 'tozeroy' as const, fillcolor: 'rgba(11,147,137,.12)', line: { color: '#0b9389', width: 3 } },
  ], [result]);
  return <ModelPanel controls={<>
    <Slider name="Prior α" value={a} min={.5} max={15} step={.5} set={setA} />
    <Slider name="Prior β" value={b} min={.5} max={15} step={.5} set={setB} />
    <Slider name="Observed heads" value={heads} min={0} max={80} set={setHeads} />
    <Slider name="Observed tails" value={tails} min={0} max={80} set={setTails} />
  </>}>
    <div className="chart-heading"><h3>Belief over the coin’s bias</h3><span>Probability density</span></div>
    <Plot data={data} label="Beta prior and posterior density" layout={{ xaxis: { title: { text: 'Probability of heads θ' }, range: [0, 1] }, yaxis: { title: { text: 'Density' }, rangemode: 'tozero' } }} />
    <Stats values={[['Posterior', `Beta(${result.alpha}, ${result.beta})`], ['Next-toss P(heads)', fmt(result.predictive)], ['Posterior variance', fmt(result.variance, 5)]]} />
    <p className="insight">Density is evaluated inside (0, 1); singular endpoints for shape parameters below one are intentionally not plotted. The analytic mean and variance do not use grid integration.</p>
  </ModelPanel>;
}
function RegressionModel() {
  const [lambda, setLambda] = useState(.1), [degree, setDegree] = useState(3), [noise, setNoise] = useState(.35);
  const result = useMemo(() => regressionDemo(42, noise, degree, lambda), [noise, degree, lambda]);
  const data = useMemo(() => [
    { x: result.x, y: result.y, type: 'scatter' as const, mode: 'markers' as const, name: 'Observations', marker: { size: 7, color: '#7c8da4', opacity: .7 } },
    { x: result.grid, y: result.truth, type: 'scatter' as const, mode: 'lines' as const, name: 'Data-generating curve', line: { color: '#ec9652', dash: 'dot' as const } },
    { x: result.grid, y: result.prediction, type: 'scatter' as const, mode: 'lines' as const, name: lambda ? 'Ridge fit' : 'OLS fit', line: { color: '#0b9389', width: 3 } },
  ], [result, lambda]);
  return <ModelPanel controls={<>
    <Slider name="Polynomial degree" value={degree} min={1} max={6} set={setDegree} />
    <Slider name="Ridge λ" value={lambda} min={0} max={8} step={.1} set={setLambda} />
    <Slider name="Noise σ" value={noise} min={0} max={1} step={.05} set={setNoise} />
    <p className="small">40 fixed observations · seed 42. The displayed RMSE is in-sample, not a generalization estimate.</p>
  </>}>
    <div className="chart-heading"><h3>{lambda ? 'Ridge' : 'Ordinary least squares'} regression</h3><span>Polynomial feature basis</span></div>
    <Plot data={data} label="Observed data, true curve and regression fit" layout={{ xaxis: { title: { text: 'x' } }, yaxis: { title: { text: 'Response y' } } }} />
    <Stats values={[['Training RMSE', fmt(result.rmse)], ['Intercept (unpenalized)', fmt(result.coefficients[0])], ['Penalized objective', fmt(result.objective)]]} />
    <div className="insight">Coefficients β₀ … β{degree}: <code>{result.coefficients.map(v => fmt(v)).join(', ')}</code></div>
  </ModelPanel>;
}
function PcaModel() {
  const [angle, setAngle] = useState(35), [spread, setSpread] = useState(.45);
  const [convention, setConvention] = useState<CovarianceConvention>('population');
  const result = useMemo(() => pcaDemo(42, angle, spread, 140, convention), [angle, spread, convention]);
  const data = useMemo(() => {
    const traces: import('plotly.js').Data[] = [
      { x: result.points.map(p => p[0]), y: result.points.map(p => p[1]), type: 'scatter', mode: 'markers', name: 'Observed cloud', marker: { color: '#8fa2ba', opacity: .6, size: 6 } },
      { x: result.reconstructed.map(p => p[0]), y: result.reconstructed.map(p => p[1]), type: 'scatter', mode: 'markers', name: 'Rank-one reconstruction', marker: { color: '#0b9389', opacity: .55, size: 4 } },
    ];
    result.eigenvectors.forEach((v, k) => {
      const length = 2 * Math.sqrt(Math.max(0, result.eigenvalues[k]));
      traces.push({ x: [-1, 1].map(s => result.mean[0] + s * length * v[0]),
        y: [-1, 1].map(s => result.mean[1] + s * length * v[1]), type: 'scatter', mode: 'lines',
        name: `Principal axis ${k + 1}`, line: { color: k ? '#ec9652' : '#0b9389', width: 3 } });
    });
    return traces;
  }, [result]);
  return <ModelPanel controls={<>
    <Slider name="Cloud angle" value={angle} min={-90} max={90} set={setAngle} suffix="°" />
    <Slider name="Minor-axis spread" value={spread} min={.1} max={1.7} step={.05} set={setSpread} />
    <label className="field">Covariance normalization<select value={convention} onChange={event => setConvention(event.target.value as CovarianceConvention)}>
      <option value="population">Population · divide by N</option><option value="sample">Sample · divide by N − 1</option>
    </select></label>
    <p className="small">140 fixed Gaussian observations · seed 42. Axes extend two standard deviations from the sample mean.</p>
  </>}>
    <div className="chart-heading"><h3>A lower-dimensional view</h3><span>Equal aspect ratio</span></div>
    <Plot data={data} label="Two-dimensional observations and principal axes" height={390} layout={{ xaxis: { title: { text: 'x₁' } }, yaxis: { title: { text: 'x₂' }, scaleanchor: 'x', scaleratio: 1 } }} />
    <Stats values={[['PC1 variance explained', `${fmt(100 * result.explained, 1)}%`], ['Eigenvalue λ₁', fmt(result.eigenvalues[0])], ['Eigenvalue λ₂', fmt(result.eigenvalues[1])]]} />
    <p className="insight">Covariance uses {convention === 'population' ? 'N (population/MLE), matching the original pcaPmtk convention' :
      'N − 1 (sample); eigenvalues are N/(N − 1) times the population values'}. Eigenvector signs are arbitrary: v and −v represent the same principal direction. When eigenvalues coincide, the axis is not uniquely identified.</p>
  </ModelPanel>;
}
function EmModel() {
  const [separation, setSeparation] = useState(3), [iteration, setIteration] = useState(20);
  const full = useMemo(() => emDemo(42, separation, 50), [separation]);
  const fit = full.history[iteration];
  const data = useMemo(() => {
    const curves = fit.means.map((mu, k) => full.x.map(x =>
      fit.weights[k] * Math.exp(-.5 * (x - mu) ** 2 / fit.variances[k]) / Math.sqrt(2 * Math.PI * fit.variances[k])));
    const bins = 35, lo = -6, width = 12 / bins, counts = Array(bins).fill(0) as number[];
    full.data.forEach(x => { const i = Math.floor((x - lo) / width); if (i >= 0 && i < bins) counts[i]++; });
    return [
      { x: counts.map((_, i) => lo + (i + .5) * width), y: counts.map(c => c / (full.data.length * width)),
        type: 'bar' as const, name: 'Observed density', marker: { color: '#dae2eb' }, width: width * .9 },
      ...curves.map((curve, k) => ({ x: full.x, y: curve, type: 'scatter' as const, mode: 'lines' as const,
        name: `Weighted component ${k + 1}`, line: { width: 2, color: k ? '#ec9652' : '#0b9389' } })),
      { x: full.x, y: full.x.map((_, i) => curves[0][i] + curves[1][i]), type: 'scatter' as const,
        mode: 'lines' as const, name: 'Mixture density', line: { width: 2, color: '#626baa', dash: 'dot' as const } },
    ];
  }, [full, fit]);
  const likelihood = useMemo(() => [
    { x: full.history.map(h => h.iteration), y: full.history.map(h => h.likelihood), type: 'scatter' as const,
      mode: 'lines' as const, name: 'Log-likelihood', line: { color: '#0b9389', width: 2 } },
    { x: [iteration], y: [fit.likelihood], type: 'scatter' as const, mode: 'markers' as const,
      name: 'Selected iteration', marker: { color: '#ec9652', size: 9 } },
  ], [full, iteration, fit]);
  return <ModelPanel controls={<>
    <Slider name="Mean separation" value={separation} min={.5} max={6} step={.1} set={setSeparation} />
    <Slider name="EM iteration" value={iteration} min={0} max={50} set={setIteration} />
    <p className="small">220 observations · seed 42. Quantile initialization, log-space responsibilities, variance floor 10⁻⁶. Iteration 0 is the initialization.</p>
  </>}>
    <div className="chart-heading"><h3>Two latent populations</h3><span>Soft assignments, not hard clusters</span></div>
    <Plot data={data} label="Gaussian mixture density and observations" height={300} layout={{ barmode: 'overlay', xaxis: { title: { text: 'x' }, range: [-6, 6] }, yaxis: { title: { text: 'Density' } } }} />
    <Plot data={likelihood} label="EM log-likelihood progression" height={220} layout={{ showlegend: false, xaxis: { title: { text: 'Iteration' } }, yaxis: { title: { text: 'Log p(data)' } } }} />
    <Stats values={[['Data log-likelihood', fmt(fit.likelihood, 2)], ['Fitted means', fit.means.map(v => fmt(v, 2)).join(' / ')], ['Mixing weights', fit.weights.map(v => fmt(v, 2)).join(' / ')]]} />
  </ModelPanel>;
}
function HmmModel() {
  const [stay, setStay] = useState(.85), [accuracy, setAccuracy] = useState(.8), [sequence, setSequence] = useState('0010111001');
  const valid = /^[01]{1,200}$/.test(sequence);
  const result = useMemo(() => hmmDemo(stay, accuracy, valid ? sequence : '0'), [stay, accuracy, sequence, valid]);
  const data = useMemo(() => result.initial.map((_, state) => ({
    x: result.observations.map((_, i) => i + 1), y: result.marginals.map(row => row[state]),
    type: 'scatter' as const, mode: 'lines+markers' as const, stackgroup: 'probability',
    name: `P(state ${state} | all observations)`, line: { width: 2, color: state ? '#ec9652' : '#0b9389' },
  })), [result]);
  return <ModelPanel controls={<>
    <Slider name="State persistence" value={stay} min={.05} max={.99} step={.01} set={setStay} />
    <Slider name="Emission accuracy" value={accuracy} min={.5} max={.99} step={.01} set={setAccuracy} />
    <label className="field">Binary observations<input value={sequence} maxLength={200} onChange={event => setSequence(event.target.value)} aria-invalid={!valid} /></label>
    {!valid && <p className="error">Enter 1–200 zeros and ones.</p>}
    <p className="small">A = [[p, 1−p], [1−p, p]]<br />B = [[q, 1−q], [1−q, q]]<br />Initial state probabilities: [½, ½].</p>
  </>}>
    {valid ? <>
      <div className="chart-heading"><h3>Smoothed state probabilities</h3><span>Forward–backward in log space</span></div>
      <Plot data={data} label="HMM smoothed state probability at each time" layout={{ xaxis: { title: { text: 'Time step' }, dtick: sequence.length > 30 ? undefined : 1 }, yaxis: { title: { text: 'Posterior probability' }, range: [0, 1] } }} />
      <Stats values={[['Sequence log probability', fmt(result.logLikelihood)], ['Observations', `${sequence.length}`], ['Marginal normalization', '1 at every step']]} />
      <div className="insight"><strong>Viterbi joint MAP path</strong><code className="sequence">{result.viterbi.join(' ')}</code>
        <p>Not the same calculation as independent argmax of each smoothed marginal. Transition rows are “from state → to state”.</p></div>
    </> : <div className="empty">Fix the observation sequence to run inference.</div>}
  </ModelPanel>;
}
function SprinklerModel() {
  const [cloud, setCloud] = useState(.5), [wet, setWet] = useState('true'), [s, setS] = useState('unknown');
  const evidence: Evidence = {};
  if (wet !== 'unknown') evidence.wet = wet === 'true';
  if (s !== 'unknown') evidence.sprinkler = s === 'true';
  const result = useMemo(() => sprinkler(evidence, cloud), [wet, s, cloud]);
  const keys = ['cloudy', 'sprinkler', 'rain', 'wet'] as const;
  const data = useMemo(() => [
    { x: [...keys], y: keys.map(k => result.prior[k]), type: 'bar' as const, name: 'Prior', marker: { color: '#c4cfdd' } },
    { x: [...keys], y: keys.map(k => result.posterior[k]), type: 'bar' as const, name: 'Posterior | evidence', marker: { color: '#0b9389' } },
  ], [result]);
  const select = (name: string, value: string, set: (v: string) => void) =>
    <label className="field">{name}<select value={value} onChange={e => set(e.target.value)}>
      <option value="unknown">Unobserved</option><option value="true">True</option><option value="false">False</option>
    </select></label>;
  return <ModelPanel controls={<>
    <Slider name="P(cloudy)" value={cloud} min={.05} max={.95} step={.05} set={setCloud} />
    {select('Wet grass evidence', wet, setWet)}
    {select('Sprinkler evidence', s, setS)}
    <div className="network" aria-label="Cloudy causes sprinkler and rain, which cause wet grass">
      <span>Cloudy</span><div>↙　↘</div><div><span>Sprinkler</span> <span>Rain</span></div><div>↘　↙</div><span>Wet grass</span>
    </div>
  </>}>
    <div className="chart-heading"><h3>How evidence changes belief</h3><span>Exact inference · 16 assignments</span></div>
    <Plot data={data} label="Bayes network prior and conditional node probabilities" layout={{ barmode: 'group', yaxis: { title: { text: 'P(node = true)' }, range: [0, 1] } }} />
    <Stats values={[['P(evidence)', fmt(result.evidenceProbability, 4)], ['P(rain | evidence)', fmt(result.posterior.rain, 4)], ['Joint probability sum', fmt(result.states.reduce((a, b) => a + b.probability, 0), 4)]]} />
    <details className="insight"><summary>Conditional probability tables</summary>
      <p>P(S=true | C=true/false) = 0.1 / 0.5.<br />P(R=true | C=true/false) = 0.8 / 0.2.<br />
        P(W=true | S,R) for (1,1), (1,0), (0,1), (0,0) = 0.99, 0.9, 0.9, 0.</p>
    </details>
  </ModelPanel>;
}
const models = { beta: BetaModel, regression: RegressionModel, pca: PcaModel, em: EmModel, hmm: HmmModel, sprinkler: SprinklerModel };
export default function Lab({ selected, onSelect }: { selected: AdapterId; onSelect: (id: AdapterId) => void }) {
  const item = learningPath.find(x => x.id === selected)!;
  const Model = models[selected];
  return <section className="interactive-lab">
    <div className="section-heading"><div><p className="eyebrow">THE INTERACTIVE LEARNING PATH</p><h2>Six ideas. Infinite experiments.</h2></div>
      <span className="reproduction">TypeScript reproduction</span></div>
    <p className="section-intro">Independent educational adapters, not original Octave output. All other original cases remain in the catalog; they have not been ported to TypeScript.</p>
    <nav className="learning-steps" aria-label="Interactive learning path">{learningPath.map((step, i) =>
      <button key={step.id} onClick={() => onSelect(step.id)} className={selected === step.id ? 'selected' : ''} aria-current={selected === step.id ? 'step' : undefined}>
        <span>{String(i + 1).padStart(2, '0')}</span><strong>{step.subtitle}</strong>
      </button>)}</nav>
    <article className="experiment">
      <div className="experiment-heading"><p className="eyebrow">{item.chapter}</p><h2>{item.title}</h2><p>{item.purpose}</p><div className="equation">{item.equation}</div></div>
      <Model key={selected} />
      <footer className="experiment-footer">Transparent by design: fixed seeds, original equations, no remote computation. <a href="/api/numerics" target="_blank" rel="noreferrer">Seeded fixtures ↗</a><a href="/api/numerics/parity" target="_blank" rel="noreferrer">Fixed comparison inputs & outputs ↗</a><a href="/api/numerics/parity/check" target="_blank" rel="noreferrer">Check six original fixed fixtures ↗</a></footer>
    </article>
  </section>;
}
