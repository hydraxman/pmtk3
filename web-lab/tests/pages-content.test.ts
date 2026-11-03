import test from 'node:test';
import assert from 'node:assert/strict';
import { chapterGuides, guides, guideFor } from '../pages/content.js';

test('chapter notes cover only the 25 official output groups with mathematical context', () => {
  assert.deepEqual(chapterGuides.map(guide => guide.number), [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 23, 24, 25, 26, 27, 28]);
  for (const guide of guides) {
    assert.ok(guide.summary.length > 25 && guide.formula.length > 4 && guide.symbols.length > 10, guide.title);
    assert.equal(guide.lookFor.length, 2);
    assert.ok(guide.prerequisites && guide.intuition && guide.english);
  }
});
test('official chapter evidence always wins and editorial links do not fabricate memberships', () => {
  const original = ['1'];
  assert.equal(guideFor('pcaDemo3d', original), '1');
  assert.deepEqual(original, ['1']);
  assert.equal(guideFor('demoRosenConstrained', []), 'optimization');
  assert.equal(guideFor('hmmNbestDemo', []), '17');
  assert.equal(guideFor('memoryMapDemo', []), 'computation');
});
