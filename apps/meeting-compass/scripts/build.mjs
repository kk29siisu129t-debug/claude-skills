// ビルド = 静的ファイルを dist/ に複製し、参照切れが無いかを確認するだけ（バンドラ不要）。
import { cp, rm, readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'web');
const out = join(root, 'dist');

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

await rm(out, { recursive: true, force: true });
await cp(src, out, { recursive: true });

const files = await walk(out);
const missing = [];
for (const f of files.filter((x) => x.endsWith('.js') || x.endsWith('.html'))) {
  const text = await readFile(f, 'utf8');
  const refs = [...text.matchAll(/(?:from\s+|import\s*\(\s*|src=|href=)['"](\.{0,2}\/?[\w./-]+\.(?:js|css))['"]/g)].map((m) => m[1]);
  for (const r of refs) {
    const target = resolve(dirname(f), r);
    try { await stat(target); } catch { missing.push(`${f.replace(root, '.')} -> ${r}`); }
  }
  if (/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(text) && f.endsWith('.js')) {
    // 外部URLの文字列があってもCSPで接続は禁止されるが、念のため一覧化する
    console.warn(`注意: 外部URL文字列を含む ${f.replace(root, '.')}`);
  }
}
if (missing.length) {
  console.error('参照切れ:\n' + missing.join('\n'));
  process.exit(1);
}
console.log(`build ok: ${files.length} files -> dist/`);
