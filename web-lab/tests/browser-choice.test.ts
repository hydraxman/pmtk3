import test from 'node:test';
import assert from 'node:assert/strict';
import { browserLaunchOptions } from '../scripts/browser.js';

test('browser preference honors an explicit installed channel override', () => {
  assert.deepEqual(browserLaunchOptions({ WEB_LAB_BROWSER_CHANNEL: 'msedge' }), { channel: 'msedge' });
});
test('browser preference selects installed Edge without downloading anything', () => {
  const options = browserLaunchOptions({ 'ProgramFiles(x86)': 'C:\\EdgeFixture' }, file => String(file).endsWith('msedge.exe'));
  if (process.platform === 'win32') {
    assert.equal(options.channel, 'msedge');
    assert.match(options.executablePath!, /EdgeFixture.*msedge\.exe$/);
  } else assert.deepEqual(options, {});
});
