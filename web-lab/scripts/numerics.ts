import { numericalFixtures, parityFixtures } from '../shared/numerics.js';
// Machine-readable stdout for external cross-engine checks; no output files written.
console.log(JSON.stringify(process.argv.includes('--parity') ? parityFixtures() : numericalFixtures(), null, 2));
