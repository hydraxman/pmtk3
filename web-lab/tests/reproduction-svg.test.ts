import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPlotSvg } from '../scripts/reproduction-svg.js';

test('offline SVG renderer emits fresh line, category bar, matrix and text geometry with escaped labels', () => {
  const svg = renderPlotSvg({
    title: '<not-markup> & comparison', xLabel: 'x', yLabel: 'y',
    traces: [
      { name: 'Curve', type: 'scatter', mode: 'lines', x: [0, 1, 2], y: [0, 1, 0] },
      { name: 'Categories', type: 'bar', x: ['A', 'B', 'C'], y: [1, 2, 1] },
      { name: 'Pixels', type: 'scatter', mode: 'markers', x: [0, 1, 2], y: [0, 0, 1],
        marker: { symbol: 'square', color: [0, .5, 1] } },
      { name: 'Labels', type: 'scatter', mode: 'text', x: [0], y: [1], text: ['<b>literal</b>'] },
    ],
  });

  assert.match(svg, /<polyline points="/);
  assert.ok((svg.match(/<rect /g) ?? []).length >= 7);
  assert.match(svg, /&lt;not-markup&gt; &amp; comparison/);
  assert.match(svg, /&lt;b&gt;literal&lt;\/b&gt;/);
  assert.doesNotMatch(svg, /\bNaN\b|\bInfinity\b|<b>|<script/);
  assert.match(svg, /not an original MATLAB execution/);
});

test('dense matrix markers tile both axes rather than drawing misleading separated stripes', () => {
  const svg = renderPlotSvg({ title: '2 by 3 matrix', traces: [
    { name: 'values', type: 'scatter', mode: 'markers', x: [0, 1, 2, 0, 1, 2], y: [0, 0, 0, -1, -1, -1],
      marker: { symbol: 'square', color: [0, 1, 2, 3, 4, 5] } },
  ] });
  const cells = [...svg.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" fill="hsl/g)];
  assert.equal(cells.length, 6);
  for (const cell of cells) {
    const [x, y, width, height] = cell.slice(1).map(Number);
    assert.ok(Math.abs(width - 875 / 3) < 1e-8 && height === 415 / 2);
    assert.ok(x >= 85 - 1e-8 && y >= 85 - 1e-8 && x + width <= 960 + 1e-8 && y + height <= 500 + 1e-8);
  }
});
