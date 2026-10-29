export interface DemoResult {
  status: string;
  success: boolean;
  figures: string[];
  source_sha256?: string;
  attempt_id?: string;
  started_at?: string;
  finished_at?: string;
  duration_seconds?: number;
  message?: string;
  error?: { message?: string; identifier?: string; stack?: unknown };
  capture_errors?: unknown;
  log?: string;
  attempt_result?: string;
  harness_result?: string;
  metadata?: string;
  path_origins?: string;
  runner_pid?: number;
  pid?: number;
  engine?: string;
  workload_executed?: boolean;
  execution_disposition?: string;
  requirement?: string;
  classification_only?: boolean;
  memory_limit_mib?: number;
  memory_guard?: MemoryGuard;
  runtime_profile?: RuntimeProfile;
}
export interface ConfiguredOctave {
  executable: string;
  binary_kind: 'gui-linked' | 'console';
  graphics_toolkit: 'qt' | 'gnuplot';
  selection: 'override' | 'bundled';
}
export interface RuntimeProfile {
  executable?: string;
  binary_kind?: string;
  frontend?: string;
  qt_bundle?: unknown;
  qt_environment?: unknown;
  path_directories?: string[];
}
export interface MemoryGuard {
  enabled: boolean;
  limit_bytes?: number;
  job_commit_limit_bytes?: number;
  poll_interval_seconds?: number;
  method?: string;
  peak_working_set_bytes?: number;
  peak_sampled_private_bytes?: number;
  last_sample?: unknown;
  violation?: unknown;
}
export interface EngineConstraint {
  engine: string;
  status: string;
  requirement: string;
  reason: string;
  line?: number;
}
export interface HistoricalAlias {
  published_stem: string;
  old_source: string;
  source: string;
  commit: string;
  date?: string;
  change?: string;
  reason?: string;
}
export interface Demo {
  id: string;
  name: string;
  source: string | null;
  sha256: string | null;
  description: string;
  kind: string;
  entry_type: string | null;
  runnable: boolean;
  safety: { line: number; operation: string; reason: string }[];
  tags: { name: string; value: string }[];
  chapters: string[];
  published: { page: string; chapter: string; images: string[]; published_stem?: string;
    source_resolution?: string; historical_alias?: HistoricalAlias | null }[];
  historical_aliases?: HistoricalAlias[];
  engine_constraints?: EngineConstraint[];
  interactive: boolean;
  result: DemoResult;
}
export interface Chapter { id: string; title: string; pages: number; demo_pages: number }
export interface Inventory {
  generated_at: string;
  counts: Record<string, number>;
  chapters: Chapter[];
  entries: Demo[];
}
export type JobStatus = 'queued' | 'running' | 'success' | 'failed' | 'resource_limit' | 'cancelled' | 'interrupted' | 'unsupported' | 'busy';
export interface Job {
  id: string;
  demoId: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  message?: string;
  output: string;
  originalStatus?: JobStatus;
}
export interface Snapshot extends Inventory {
  learningCoverage?: { standalone: number; originalSuccesses: number; independentAlternatives: number; availableRoutes: number };
  csrf: string;
  warning?: string;
  refreshedAt: string;
  runtime: { python: boolean; octave: boolean; configured?: ConfiguredOctave };
  jobs: Job[];
  sharedRunner: { active: boolean; message: string };
  localRunner: { active: boolean; message: string };
  sharedProgress?: {
    updated_at: string; total: number; completed: number; started: number; jobs: number; active: string[];
    memory_limit_mib?: number;
  };
}
export interface Asset { url: string; name: string }
export interface AttemptView {
  label: string;
  result: DemoResult;
  figures: Asset[];
  artifacts: Asset[];
  log: string;
}
export interface DemoDetail {
  demo: Demo;
  source: string | null;
  attempts: AttemptView[];
  references: Asset[];
}
export interface DatasetRecord {
  name: string;
  references: string[];
  mat_files: string[];
  kind: string;
  local_paths: string[];
  status: string;
  note?: string;
}
export interface DataRecovery {
  file: string;
  source_repository: string;
  source_commit: string;
  source_path: string;
  sha256: string;
  bytes: number;
}
export interface DataMetadata {
  audit?: {
    generated_at: string;
    scope: string;
    bundled_mat_files: number;
    referenced_datasets: number;
    available_datasets: number;
    datasets: DatasetRecord[];
  };
  recovery: DataRecovery[];
  warning?: string;
}
