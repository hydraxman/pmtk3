import type { VisualPlot } from '../shared/reproductions/types.js';
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const palette = ['#078b80', '#d67135', '#7760b3', '#326cac', '#c8436b', '#607942'];
export function renderPlotSvg(plot: VisualPlot) {
  const width = 1000, height = 600, left = 85, right = 960, top = 85, bottom = 500;
  const xs = plot.traces.flatMap(trace => trace.x.map((value, i) => typeof value === 'number' ? value : i));
  const ys = plot.traces.flatMap(trace => trace.y);
  let xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
  const grids = plot.traces.map(trace => {
    if (trace.marker?.symbol !== 'square' || !trace.mode?.includes('markers') || !trace.x.every(value => typeof value === 'number')) return undefined;
    const columns = [...new Set(trace.x)].sort((a, b) => a - b), rows = [...new Set(trace.y)].sort((a, b) => a - b);
    if (columns.length < 2 || rows.length < 2 || columns.length * rows.length !== trace.x.length) return undefined;
    const spacing = (coordinates: number[]) => Math.min(...coordinates.slice(1).map((value, i) => value - coordinates[i]));
    const dx = spacing(columns), dy = spacing(rows);
    // Include half a cell at the boundaries so dense grids cannot cover labels or axes.
    xmin = Math.min(xmin, columns[0] - dx / 2); xmax = Math.max(xmax, columns.at(-1)! + dx / 2);
    ymin = Math.min(ymin, rows[0] - dy / 2); ymax = Math.max(ymax, rows.at(-1)! + dy / 2);
    return { dx, dy };
  });
  if (plot.traces.some(trace => trace.type === 'bar')) { ymin = Math.min(0, ymin); ymax = Math.max(0, ymax); }
  if (xmin === xmax) { xmin -= .5; xmax += .5; }
  if (ymin === ymax) { ymin -= .5; ymax += .5; }
  const x = (v: number) => left + (v - xmin) / (xmax - xmin) * (right - left);
  const y = (v: number) => bottom - (v - ymin) / (ymax - ymin) * (bottom - top);
  const fmt = (v: number) => Number(v.toPrecision(4)).toString();
  const svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(plot.title)}">`,
    '<rect width="100%" height="100%" fill="white"/>',
    `<text x="${left}" y="28" font-family="sans-serif" font-size="19" fill="#24374a">${escape(plot.title)}</text>`];
  for (let i = 0; i <= 5; i++) {
    const u = xmin + (xmax - xmin) * i / 5, v = ymin + (ymax - ymin) * i / 5;
    svg.push(`<path d="M${left},${y(v)}H${right}" stroke="#e5ebee"/>`,
      `<text x="${left - 10}" y="${y(v) + 4}" text-anchor="end" font-family="sans-serif" font-size="12">${fmt(v)}</text>`,
      `<text x="${x(u)}" y="${bottom + 22}" text-anchor="middle" font-family="sans-serif" font-size="12">${fmt(u)}</text>`);
  }
  svg.push(`<path d="M${left},${top}V${bottom}H${right}" fill="none" stroke="#718494"/>`);
  plot.traces.forEach((trace, index) => {
    const baseColor = palette[index % palette.length];
    svg.push(`<text x="${left + (index % 4) * 215}" y="${49 + Math.floor(index / 4) * 16}" font-family="sans-serif" font-size="12" fill="${baseColor}">${escape(trace.name.slice(0, 30))}</text>`);
    const values = trace.x.map((v, i) => typeof v === 'number' ? v : i);
    if (trace.type === 'bar') {
      const barWidth = Math.max(1, (right - left) / Math.max(1, values.length) * .75 / plot.traces.length);
      values.forEach((v, i) => {
        const yy = y(trace.y[i]), zero = y(0);
        svg.push(`<rect x="${x(v) - barWidth / 2 + index * barWidth}" y="${Math.min(yy, zero)}" width="${barWidth}" height="${Math.abs(yy - zero)}" fill="${baseColor}"/>`);
        if (typeof trace.x[i] === 'string' && values.length <= 12) svg.push(`<text x="${x(v)}" y="${bottom + 40}" text-anchor="middle" font-size="10" font-family="sans-serif">${escape(String(trace.x[i]).slice(0, 18))}</text>`);
      });
    } else {
      if (!trace.mode || trace.mode.includes('lines')) {
        const points = values.map((v, i) => `${x(v)},${y(trace.y[i])}`).join(' ');
        svg.push(`<polyline points="${points}" fill="none" stroke="${trace.line?.color ?? baseColor}" stroke-width="2"${trace.line?.dash && trace.line.dash !== 'solid' ? ' stroke-dasharray="6 4"' : ''}/>`);
      }
      if (trace.mode?.includes('markers')) {
        const colors = trace.marker?.color, numerical = Array.isArray(colors) ? colors : undefined;
        const min = numerical ? Math.min(...numerical) : 0, max = numerical ? Math.max(...numerical) : 1;
        const grid = grids[index];
        const cellWidth = grid ? grid.dx / (xmax - xmin) * (right - left) : 0;
        const cellHeight = grid ? grid.dy / (ymax - ymin) * (bottom - top) : 0;
        values.forEach((v, i) => {
          const fraction = numerical ? (numerical[i] - min) / (max - min || 1) : 0;
          const color = numerical ? `hsl(${250 - 200 * fraction} 65% 47%)` : typeof colors === 'string' ? colors : baseColor;
          if (trace.marker?.symbol === 'square') {
            const size = Math.max(2, Math.min(18, (right - left) / Math.sqrt(values.length)));
            const w = grid ? cellWidth : size, h = grid ? cellHeight : size;
            svg.push(`<rect x="${x(v) - w / 2}" y="${y(trace.y[i]) - h / 2}" width="${w}" height="${h}" fill="${color}"/>`);
          } else svg.push(`<circle cx="${x(v)}" cy="${y(trace.y[i])}" r="3" fill="${color}" opacity=".8"/>`);
        });
      }
      if (trace.mode === 'text') values.forEach((v, i) => svg.push(`<text x="${x(v)}" y="${y(trace.y[i])}" font-family="sans-serif" font-size="12">${escape(trace.text?.[i] ?? '')}</text>`));
    }
  });
  svg.push(`<text x="${(left + right) / 2}" y="565" text-anchor="middle" font-family="sans-serif" font-size="14">${escape(plot.xLabel ?? '')}</text>`,
    `<text x="20" y="300" transform="rotate(-90 20 300)" text-anchor="middle" font-family="sans-serif" font-size="14">${escape(plot.yLabel ?? '')}</text>`,
    '<text x="20" y="590" font-family="sans-serif" font-size="11" fill="#66758b">Fresh independent TypeScript computation; not an original MATLAB execution.</text></svg>');
  return svg.join('\n');
}
