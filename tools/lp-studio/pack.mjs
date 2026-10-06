#!/usr/bin/env node
// 共有用 ZIP を作る: dist/lp-studio-<commit>.zip
//   node pack.mjs            … 作業ツリーがコミット済みのときだけ作る（ZIP の中身＝そのコミットの版）
//   node pack.mjs --out <path> --allow-dirty   … テスト用（VERSION.txt に dirty と書く）
// 中身: git 管理下の tools/lp-studio 一式（seed・examples・docs・tests・dist/lp-studio-standalone.html）＋ VERSION.txt
// 録画（mp4/gif）は .gitignore のため含めない。外部通信なし。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const dirty = git('status', '--porcelain', '--', '.') !== '';
if (dirty && !args.includes('--allow-dirty')) { console.error('未コミットの変更があります。コミットしてから実行してください（ZIP と commit を一致させるため）'); process.exit(1); }
try { execFileSync(process.execPath, ['build-standalone.mjs', '--check'], { cwd: root, stdio: 'pipe' }); } catch { console.error('dist/lp-studio-standalone.html がソースと一致しません。node build-standalone.mjs を実行してください'); process.exit(1); }
const sha = git('rev-parse', 'HEAD');
const files = git('ls-files', '-z', '--', '.').split('\0').filter(Boolean);
const stage = mkdtempSync(join(tmpdir(), 'lp-pack-'));
const base = join(stage, 'lp-studio');
for (const f of files) { mkdirSync(dirname(join(base, f)), { recursive: true }); cpSync(join(root, f), join(base, f)); }
writeFileSync(join(base, 'VERSION.txt'), `commit ${sha}${dirty ? ' + 未コミットの変更（テスト用の作成）' : ''}\nbranch ${git('rev-parse', '--abbrev-ref', 'HEAD')}\nfiles ${files.length}\n`);
const out = opt('--out') || join(root, 'dist', `lp-studio-${sha.slice(0, 7)}.zip`);
mkdirSync(dirname(out), { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-qrX', out, 'lp-studio'], { cwd: stage });
rmSync(stage, { recursive: true, force: true });
console.log(`${out}（${files.length + 1} files, commit ${sha.slice(0, 7)}${dirty ? ', dirty' : ''}）`);
