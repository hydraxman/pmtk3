import { numericalParityReport } from '../server/parity.js';
import { parityScope } from '../shared/parity.js';

try {
  const report = await numericalParityReport();
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({ passed: false, scope: parityScope,
    error: error instanceof Error ? error.message : 'Parity verification failed' }, null, 2));
  process.exitCode = 1;
}
