import type { DemoResult, JobStatus } from './contracts.js';
import { executedSuccess } from './catalog.js';

// The harness enforces the demo's 120s budget; the outer watchdog also allows
// bounded coordinator/setup/cleanup time before killing its owned runner.
export const webRunLimits = { timeoutSeconds: 120, memoryLimitMiB: 6144, serviceWatchdogSeconds: 240 } as const;
export const originalRetryStatuses = ['success', 'failed', 'timeout', 'resource_limit', 'runner_error', 'interrupted', 'stale'] as const;
export function needsAttention(status: string) {
  return ['failed', 'timeout', 'resource_limit', 'runner_error', 'interrupted', 'stale'].includes(status);
}
export function originalJobOutcome(result: DemoResult | undefined, code: number | null, fresh: boolean, watchdog: boolean): JobStatus {
  if (result?.status === 'unsupported') return 'unsupported';
  if (result?.status === 'resource_limit' && fresh) return 'resource_limit';
  return !watchdog && code === 0 && result && executedSuccess(result) && fresh ? 'success' : 'failed';
}
