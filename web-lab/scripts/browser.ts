import { existsSync } from 'node:fs';
import path from 'node:path';

/** Prefer installed Windows Edge. This helper never installs a browser. */
export function browserLaunchOptions(env: NodeJS.ProcessEnv = process.env, exists = existsSync) {
  if (env.WEB_LAB_BROWSER_CHANNEL) return { channel: env.WEB_LAB_BROWSER_CHANNEL };
  if (process.platform === 'win32') {
    const candidates = [
      env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA,
    ].filter((root): root is string => !!root).map(root => path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    const executablePath = candidates.find(file => exists(file));
    if (executablePath) return { channel: 'msedge', executablePath };
  }
  // Use an already-cached Playwright Chromium when no installed Edge is present.
  // A missing browser causes an actionable Playwright error, not an automatic download.
  return {};
}
