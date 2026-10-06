#!/usr/bin/env node
// 配布 ZIP を作る: dist/lp-studio-<commit>[-lite].zip
//   node pack.mjs [--lite] [--out <path>]   … git がある場所: コミット済みの版から作る（中身は commit の blob のバイト列）
//   node pack.mjs --allow-dirty --out <path> … テスト用: 作業ツリーの未コミットの変更を含める（dirty と記録し、blob 照合はしない）
//   git が無い場所（展開した配布物）: node verify-dist.mjs の検証に通ったときだけ、manifest の一覧のまま再梱包する（full / lite も元のまま）
// 同梱: MANIFEST.json（各ファイルの sha256・commit・branch・dirty・lite・excluded）と VERSION.txt（commit・branch・dirty・MANIFEST.json の sha256）
// --lite: docs/screenshots と docs/motion を除き、PACKAGING-NOTES.txt を付ける（manifest に含める）
// ZIP は展開時にテキストを変換しない（zip -l/-ll は使わない）。実行ビット（mode）は記録しない（node で実行するため不要）。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyDist, sha256, stableStringify, safeRelPath, MANIFEST, VERSION, LITE_EXCLUDABLE } from './verify-dist.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const die = (msg) => { console.error(msg); process.exit(1); };
const LITE_EXCLUDED = LITE_EXCLUDABLE;

// git モードは、この pack.mjs がその repo で追跡されているときだけ（展開先がたまたま別の repo の中にあるときは、配布物の再梱包として扱う）
let inGit = false;
try { execFileSync('git', ['ls-files', '--error-unmatch', 'pack.mjs'], { cwd: root, stdio: 'pipe' }); inGit = true; } catch { inGit = false; }

try { execFileSync(process.execPath, ['build-standalone.mjs', '--check'], { cwd: root, stdio: 'pipe' }); } catch { die('dist/lp-studio-standalone.html がソースと一致しません。node build-standalone.mjs を実行してください'); }

let commit, branch, dirty, lite, excluded, entries; // entries: [path, Buffer]
if (inGit) {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
  dirty = git('status', '--porcelain', '--', '.') !== '';
  if (dirty && !args.includes('--allow-dirty')) die('未コミットの変更があります。コミットしてから実行してください（ZIP と commit を一致させるため）');
  commit = git('rev-parse', 'HEAD');
  branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  lite = args.includes('--lite');
  excluded = lite ? LITE_EXCLUDED : [];
  const prefix = git('rev-parse', '--show-prefix');
  // dirty（テスト用）: 追跡中と未追跡（.gitignore 対象外）の作業ツリー。clean: commit の tree
  const listing = dirty ? git('ls-files', '-co', '--exclude-standard', '--', '.').split('\n').filter(Boolean).map((f) => `100644 - -\t${f}`).join('\n') : git('ls-tree', '-r', '--full-tree', commit, '--', prefix || '.');
  entries = [];
  for (const line of listing.split('\n').filter(Boolean)) {
    const [meta, full] = line.split('\t');
    const [mode, a, b] = meta.split(' ');
    if (mode === '120000' || mode === '160000') continue; // シンボリックリンク・サブモジュールは同梱しない
    const rel = dirty ? full : full.slice(prefix.length);
    if (excluded.some((d) => rel.startsWith(`${d}/`))) continue;
    if (!safeRelPath(rel)) die(`安全でないパスを同梱できません: ${rel}`);
    // clean: commit の blob のバイト列（autocrlf 等の影響を受けない）。dirty（テスト用）: 作業ツリー
    if (dirty && (!existsSync(join(root, rel)) || lstatSync(join(root, rel)).isSymbolicLink())) continue; // 作業ツリーで削除済み・リンク
    const buf = dirty ? readFileSync(join(root, rel)) : execFileSync('git', ['cat-file', 'blob', a.length === 40 ? a : b], { cwd: root, maxBuffer: 64 << 20 });
    entries.push([rel, buf]);
  }
} else {
  const r = verifyDist(root, { git: false });
  if (!r.ok) die(`git が無い場所では、検証に通った配布物だけを再梱包できます。検証に失敗しました:\n- ${r.errors.slice(0, 20).join('\n- ')}`);
  ({ commit, branch, dirty, lite, excluded } = r);
  entries = Object.keys(r.manifest.files).map((p) => [p, readFileSync(join(root, p))]);
}

const files = {};
if (lite && inGit) {
  const notes = `LP Studio 軽量配布（添付の容量上限のため）\n\n元: commit ${commit}（branch ${branch}）。除外したパス（ディレクトリ全体。テスト・ビルド・実行コードからは参照されない）:\n${excluded.map((d) => `- ${d}/`).join('\n')}\n\n完全な履歴と除外したファイルはリポジトリの同じ commit にある。\n確認: node verify-dist.mjs（版と全ファイルの一致）／ node --test tests/unit/*.test.mjs ／ node build-standalone.mjs --check ／ npm run test:e2e\n\n限界: MANIFEST.json は署名ではない。git の無い場所では、ファイル・MANIFEST・VERSION をすべて一貫して書き換えた改変と、除外した画像・録画の範囲の欠落は検出できない（node verify-dist.mjs <このフォルダ> --git <repo> で commit と照合すれば検出できる）。\n`;
  entries.push(['PACKAGING-NOTES.txt', Buffer.from(notes)]);
}
entries.sort((x, y) => (x[0] < y[0] ? -1 : 1));
for (const [p, buf] of entries) files[p] = sha256(buf);
const manifestText = stableStringify({ format: 1, commit, branch, dirty: !!dirty, lite: !!lite, excluded: excluded || [], files }) + '\n';
const version = `commit ${commit}\nbranch ${branch}\ndirty ${dirty ? 'yes' : 'no'}\nlite ${lite ? 'yes' : 'no'}\nmanifest-sha256 ${sha256(Buffer.from(manifestText))}\nfiles ${entries.length}\n`;

const stage = mkdtempSync(join(tmpdir(), 'lp-pack-'));
const base = join(stage, 'lp-studio');
for (const [p, buf] of entries) { mkdirSync(dirname(join(base, p)), { recursive: true }); writeFileSync(join(base, p), buf); }
writeFileSync(join(base, MANIFEST), manifestText);
writeFileSync(join(base, VERSION), version);
// 梱包前に、作ったものを自分で検証する
const self = verifyDist(base, { git: false });
if (!self.ok) { rmSync(stage, { recursive: true, force: true }); die(`作った配布物の検証に失敗しました:\n- ${self.errors.join('\n- ')}`); }
const out = opt('--out') || join(root, 'dist', `lp-studio-${commit.slice(0, 7)}${lite ? '-lite' : ''}.zip`);
mkdirSync(dirname(out), { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-qrX', out, 'lp-studio'], { cwd: stage });
rmSync(stage, { recursive: true, force: true });
console.log(`${out}（${entries.length} files + ${MANIFEST}・${VERSION}, commit ${commit.slice(0, 7)}${dirty ? ', dirty' : ''}${lite ? ', lite' : ''}${inGit ? '' : '、検証済みの配布物から再梱包'}）`);
