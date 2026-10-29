import { useEffect, useRef, useState } from 'react';
import type { Data, Layout, PlotlyHTMLElement } from 'plotly.js';

let loader: Promise<typeof import('plotly.js')> | undefined;
function load() {
  loader ??= import('plotly.js-basic-dist-min').then(mod => mod.default);
  return loader;
}
/** Only the basic (SVG scatter/bar) bundle. No WebGL, maps, CDN, or React wrapper. */
export default function Plot({ data, layout, label, height = 340 }: {
  data: Data[]; layout?: Partial<Layout>; label: string; height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const node = ref.current!;
    let observer: ResizeObserver | undefined;
    void load().then(async plotly => {
      if (!active) return;
      await plotly.react(node, data, {
        autosize: true, height, margin: { t: 25, r: 22, b: 48, l: 56 },
        paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
        font: { family: 'Inter, Segoe UI, sans-serif', size: 12, color: '#66758b' },
        colorway: ['#0b9389', '#ec9652', '#7c79cf', '#538ac9'],
        xaxis: { gridcolor: '#edf0f4', zerolinecolor: '#dce3eb' },
        yaxis: { gridcolor: '#edf0f4', zerolinecolor: '#dce3eb' },
        legend: { orientation: 'h', y: 1.15, x: 0 },
        hovermode: 'closest', ...layout,
      }, { responsive: true, displaylogo: false, displayModeBar: false, scrollZoom: false });
      if (!active) { plotly.purge(node); return; }
      observer = new ResizeObserver(() => { void plotly.Plots.resize(node as unknown as PlotlyHTMLElement); });
      observer.observe(node);
    }).catch(() => { if (active) setError('Chart could not load. Numerical results remain available below.'); });
    return () => {
      active = false;
      observer?.disconnect();
      void loader?.then(plotly => plotly.purge(node));
    };
  }, [data, layout, height]);
  return <div className="plot" role="img" aria-label={label} style={{ minHeight: height }}>
    <div ref={ref} />
    {error && <p role="alert">{error}</p>}
  </div>;
}
