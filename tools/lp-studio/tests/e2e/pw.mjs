// Playwright の解決（ローカル依存が無ければグローバルの playwright を使う）
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

export async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    const root = execSync('npm root -g').toString().trim();
    const require = createRequire(root + '/');
    return require('playwright').chromium;
  }
}

export async function launch() {
  const chromium = await loadChromium();
  const opts = { headless: true };
  try {
    return await chromium.launch(opts);
  } catch {
    return chromium.launch({ ...opts, executablePath: '/opt/pw-browsers/chromium' });
  }
}
