import { checkNumericalParity, type OriginalNumericalReference } from '../shared/parity.js';
import { sharedRoot } from './config.js';
import { HttpError, jsonFile } from './files.js';

export async function numericalParityReport() {
  let reference: OriginalNumericalReference;
  try { reference = await jsonFile<OriginalNumericalReference>(sharedRoot, 'numerical-reference.json'); }
  catch { throw new HttpError(503, 'Original numerical-reference.json is unavailable, invalid, or refused by the file safety policy.'); }
  return checkNumericalParity(reference);
}
