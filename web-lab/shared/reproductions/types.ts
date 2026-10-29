export interface VisualTrace {
  name: string;
  type: 'scatter' | 'bar';
  x: number[] | string[];
  y: number[];
  mode?: 'lines' | 'markers' | 'lines+markers' | 'text';
  text?: string[];
  marker?: {
    color?: string | number[];
    size?: number;
    symbol?: string;
    colorscale?: string;
    showscale?: boolean;
  };
  line?: { color?: string; dash?: 'solid' | 'dot' | 'dash'; width?: number };
}
export interface VisualPlot {
  title: string;
  xLabel?: string;
  yLabel?: string;
  traces: VisualTrace[];
}
export interface ExperimentCheck {
  name: string;
  passed: boolean;
  detail?: string;
}
export interface ExperimentResult {
  plots: VisualPlot[];
  metrics: Record<string, number | string>;
  checks: ExperimentCheck[];
  notes?: string[];
}
export interface Reproduction {
  id: string;
  title: string;
  source: string;
  method: string;
  description: string;
  differences: string[];
  run: (seed: number) => ExperimentResult;
}
