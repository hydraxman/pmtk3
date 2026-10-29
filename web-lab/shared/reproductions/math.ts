import { normal, seededRandom, sum } from '../numerics.js';
import type { VisualPlot, VisualTrace } from './types.js';
export { normal, seededRandom, sum };
export const range = (n: number) => Array.from({ length: n }, (_, i) => i);
export const zeros = (n: number, m: number) => range(n).map(() => Array<number>(m).fill(0));
export const dot = (a: number[], b: number[]) => sum(a.map((v, i) => v * b[i]));
export const mean = (a: number[]) => sum(a) / a.length;
export const transpose = (a: number[][]) => a[0].map((_, j) => a.map(row => row[j]));
export const norm = (a: number[]) => Math.sqrt(dot(a, a));
export const sigmoid = (x: number) => x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
export const softThreshold = (x: number, lambda: number) => Math.sign(x) * Math.max(0, Math.abs(x) - lambda);
export function normalize(a: number[]) {
  const total = sum(a);
  if (!(total > 0) || a.some(x => !Number.isFinite(x) || x < 0)) throw new RangeError('Invalid probability mass');
  return a.map(x => x / total);
}
export function solve(matrix: number[][], target: number[]) {
  const n = matrix.length;
  if (!n || target.length !== n || matrix.some(row => row.length !== n)) throw new RangeError('Invalid linear system');
  const a = matrix.map((row, i) => [...row, target[i]]);
  for (let j = 0; j < n; j++) {
    let pivot = j;
    for (let i = j + 1; i < n; i++) if (Math.abs(a[i][j]) > Math.abs(a[pivot][j])) pivot = i;
    if (!Number.isFinite(a[pivot][j]) || Math.abs(a[pivot][j]) < 1e-12) throw new RangeError('Singular linear system');
    [a[j], a[pivot]] = [a[pivot], a[j]];
    const divisor = a[j][j];
    for (let k = j; k <= n; k++) a[j][k] /= divisor;
    for (let i = 0; i < n; i++) if (i !== j) {
      const factor = a[i][j];
      for (let k = j; k <= n; k++) a[i][k] -= factor * a[j][k];
    }
  }
  const answer = a.map(row => row[n]);
  if (!answer.every(Number.isFinite)) throw new RangeError('Nonfinite linear-system solution');
  return answer;
}
export function cholesky(a: number[][]) {
  const l = zeros(a.length, a.length);
  for (let i = 0; i < a.length; i++) for (let j = 0; j <= i; j++) {
    let v = a[i][j];
    for (let k = 0; k < j; k++) v -= l[i][k] * l[j][k];
    if (i === j) {
      if (!(v > 0)) throw new RangeError('Matrix must be positive definite');
      l[i][j] = Math.sqrt(v);
    } else l[i][j] = v / l[j][j];
  }
  return l;
}
export function symmetricEigen(matrix: number[][]) {
  const n = matrix.length, a = matrix.map(row => [...row]), vectors = zeros(n, n);
  range(n).forEach(i => { vectors[i][i] = 1; });
  for (let step = 0; step < 100 * n * n; step++) {
    let p = 0, q = 0, largest = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (Math.abs(a[i][j]) > largest) { largest = Math.abs(a[i][j]); p = i; q = j; }
    }
    if (largest < 1e-11) break;
    const theta = .5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(theta), s = Math.sin(theta);
    const app = a[p][p], aqq = a[q][q], apq = a[p][q];
    a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    a[p][q] = a[q][p] = 0;
    for (let k = 0; k < n; k++) {
      if (k !== p && k !== q) {
        const x = a[k][p], y = a[k][q];
        a[k][p] = a[p][k] = c * x - s * y;
        a[k][q] = a[q][k] = s * x + c * y;
      }
      const x = vectors[k][p], y = vectors[k][q];
      vectors[k][p] = c * x - s * y;
      vectors[k][q] = s * x + c * y;
    }
  }
  const order = range(n).sort((i, j) => a[j][j] - a[i][i]);
  return { values: order.map(i => a[i][i]), vectors: order.map(i => vectors.map(row => row[i])) };
}
export const line = (name: string, x: number[], y: number[]): VisualTrace => ({ name, type: 'scatter', mode: 'lines', x, y });
export const scatter = (name: string, x: number[], y: number[]): VisualTrace => ({ name, type: 'scatter', mode: 'markers', x, y });
export function matrixPlot(title: string, matrix: number[][]): VisualPlot {
  const x: number[] = [], y: number[] = [], color: number[] = [];
  matrix.forEach((row, i) => row.forEach((v, j) => { x.push(j); y.push(-i); color.push(v); }));
  return { title, xLabel: 'Column', yLabel: 'Negative row index', traces: [{
    name: title, type: 'scatter', mode: 'markers', x, y,
    marker: { symbol: 'square', size: 9, color, colorscale: 'Viridis', showscale: true },
  }] };
}
