#!/usr/bin/env node
// 配布物（ZIP を展開したフォルダ）の完全性を確かめる。git が無い場所でも動く。
//   node verify-dist.mjs [フォルダ] [--git <repo のフォルダ>]   … 既定はこのファイルのあるフォルダ。exit 0 = 一致、2 = dirty（テスト用の版）だが一致、1 = 不一致
// 確かめること:
//   - VERSION.txt と MANIFEST.json の commit が一致し、MANIFEST.json の sha256 が VERSION.txt に書いた値と一致する
//   - MANIFEST.json の全ファイルが存在し、sha256 が一致する。manifest に無いファイルが無い（.gitignore の生成物を除く）
//   - パスは相対パスだけ（絶対パス・..・バックスラッシュ・重複・大文字小文字だけ違う重複は不可）。シンボリックリンクは不可
//   - git が使えて commit がある場合は、各ファイルが commit の内容（blob）と一致する（commit という申告そのものの検証）
// 限界: 署名ではない。git の無い場所で、ファイル・MANIFEST・VERSION をすべて一貫して書き換えられると検出できない。
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MANIFEST = 'MANIFEST.json';
// 軽量配布で除外してよいパス（固定。テスト・ビルド・実行コードから参照されない確認用の画像・録画だけ）
export const LITE_EXCLUDABLE = ['docs/screenshots', 'docs/motion'];
export const VERSION = 'VERSION.txt';
// .gitignore と同じ生成物（配布物の中で作られても、版の中身ではない）
const GENERATED = [/^dist\/[^/]+\.zip$/, /^docs\/motion\/[^/]+\.(mp4|gif|webm)$/, /^docs\/motion\/\.tmp-/];

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const gitBlob = (buf) => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');

export function safeRelPath(p) {
  return typeof p === 'string' && p.length > 0 && p.length < 400 && !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.includes('\\')
    && !/[\u0000-\u001f\u007f]/.test(p) && p.normalize('NFC') === p
    && p.split('/').every((seg) => seg && seg !== '.' && seg !== '..');
}
/** キーを並べ替えた JSON（MANIFEST.json のバイト列を安定させる） */
export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const isGenerated = (rel) => GENERATED.some((re) => re.test(rel));

function walk(dir, base = '') {
  const out = [];
  for (const name of readdirSync(join(dir, base))) {
    const rel = base ? `${base}/${name}` : name;
    const st = lstatSync(join(dir, rel));
    if (st.isSymbolicLink()) out.push({ rel, bad: 'シンボリックリンク' });
    else if (st.isDirectory()) out.push(...walk(dir, rel));
    else if (!st.isFile()) out.push({ rel, bad: '特殊ファイル（デバイス・FIFO など）' });
    else if (st.nlink > 1) out.push({ rel, bad: 'ハードリンク' });
    else out.push({ rel });
  }
  return out;
}

export function parseVersion(text) {
  const get = (k) => (text.match(new RegExp(`^${k} (\\S+)`, 'm')) || [])[1] || '';
  return { commit: get('commit'), branch: get('branch'), manifest: get('manifest-sha256'), dirty: /^dirty yes$/m.test(text) };
}

/** git で commit の中身と照合する。git が使えない（repo の外）なら 'no-git'、dirty なら 'skipped-dirty'、照合したら 'ok' */
function checkAgainstGit(dir, m, errors, gitDir = dir) {
  let top;
  try { top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: gitDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch { return 'no-git'; }
  try { execFileSync('git', ['cat-file', '-e', `${m.commit}^{commit}`], { cwd: gitDir, stdio: 'pipe' }); } catch { errors.push(`commit ${m.commit} がこのリポジトリにありません（blob 照合ができない）`); return 'failed'; }
  const prefix = execFileSync('git', ['rev-parse', '--show-prefix'], { cwd: gitDir, encoding: 'utf8' }).trim();
  const blobs = new Map();
  if (m.dirty) {
    // dirty（テスト用）: blob は照合しない。除外の整合だけ、作業ツリーの一覧（追跡中＋未追跡）で確かめる
    for (const f of execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: gitDir, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n').filter(Boolean)) if (existsSync(join(gitDir, f)) && !lstatSync(join(gitDir, f)).isSymbolicLink()) blobs.set(f, null);
  } else {
    const tree = execFileSync('git', ['ls-tree', '-r', '--full-tree', m.commit, '--', prefix || '.'], { cwd: top, encoding: 'utf8', maxBuffer: 64 << 20 });
    for (const l of tree.split('\n').filter(Boolean)) { const [meta, path] = l.split('\t'); const [mode, , sha] = meta.split(' '); if (mode !== '120000' && mode !== '160000') blobs.set(path.slice(prefix.length), sha); }
  }
  for (const p of Object.keys(m.files)) {
    if (m.dirty) break;
    if (p === 'PACKAGING-NOTES.txt' && !blobs.has(p)) continue; // pack が生成した説明（commit には無い）
    const b = blobs.get(p);
    if (!b) { errors.push(`commit ${m.commit.slice(0, 7)} に無いファイル: ${p}`); continue; }
    if (gitBlob(readFileSync(join(dir, p))) !== b) errors.push(`commit ${m.commit.slice(0, 7)} の内容と違う: ${p}`);
  }
  // commit にあって manifest に無いファイルは、宣言した除外（excluded）の中だけ。除外の中のファイルは同梱しない
  const ex = m.excluded || [];
  for (const p of blobs.keys()) {
    const inEx = ex.some((d) => p.startsWith(d.endsWith('/') ? d : `${d}/`));
    if (!(p in m.files) && !inEx) errors.push(`宣言外の欠落（commit にあるのに同梱されていない）: ${p}`);
    if ((p in m.files) && inEx) errors.push(`除外を宣言したのに同梱されている: ${p}`);
  }
  return m.dirty ? 'skipped-dirty' : 'ok';
}

export function verifyDist(dir, { git = true, gitDir } = {}) {
  const errors = [];
  const fail = (msg) => ({ ok: false, errors: [...errors, msg] });
  if (!existsSync(join(dir, VERSION))) return fail(`${VERSION} がありません`);
  if (!existsSync(join(dir, MANIFEST))) return fail(`${MANIFEST} がありません`);
  const v = parseVersion(readFileSync(join(dir, VERSION), 'utf8'));
  const raw = readFileSync(join(dir, MANIFEST));
  let m;
  try { m = JSON.parse(raw.toString('utf8')); } catch { return fail(`${MANIFEST} が JSON として読めません`); }
  if (m.format !== 1 || typeof m.files !== 'object' || !m.files || Array.isArray(m.files)) return fail(`${MANIFEST} の形式（format 1）が違います`);
  if (raw.toString('utf8') !== stableStringify(m) + '\n') errors.push(`${MANIFEST} が正規の形（キー順を固定した JSON）ではありません`);
  if (!Array.isArray(m.excluded || []) || !(m.excluded || []).every((d) => safeRelPath(d))) errors.push(`${MANIFEST} の excluded に安全でないパスがあります`);
  for (const d of m.excluded || []) if (!LITE_EXCLUDABLE.includes(d)) errors.push(`${MANIFEST} の excluded に、除外してよい一覧（${LITE_EXCLUDABLE.join('・')}）に無いパスがあります: ${d}`);
  if (!!m.lite !== !!(m.excluded || []).length) errors.push(`${MANIFEST} の lite と excluded が合っていません`);
  if (!/^[0-9a-f]{40}$/.test(m.commit || '')) return fail(`${MANIFEST} の commit がフルハッシュではありません`);
  if (v.commit !== m.commit) errors.push(`${VERSION} の commit（${v.commit}）と ${MANIFEST} の commit（${m.commit}）が違います`);
  if (v.manifest !== sha256(raw)) errors.push(`${MANIFEST} の sha256 が ${VERSION} の値と違います（MANIFEST.json が書き換えられています）`);
  if (v.dirty !== !!m.dirty) errors.push(`${VERSION} と ${MANIFEST} で dirty の記録が違います`);
  const seen = new Set();
  for (const [p, h] of Object.entries(m.files)) {
    if (!safeRelPath(p)) { errors.push(`安全でないパス: ${JSON.stringify(p)}`); continue; }
    if ([VERSION, MANIFEST].includes(p)) { errors.push(`${p} は manifest に入れません`); continue; }
    const low = p.toLowerCase();
    if (seen.has(low)) errors.push(`大文字小文字だけ違う重複: ${p}`);
    seen.add(low);
    if (!/^[0-9a-f]{64}$/.test(h)) { errors.push(`ハッシュの形式が違います: ${p}`); continue; }
    if ((m.excluded || []).some((d) => p.startsWith(`${d.replace(/\/$/, '')}/`))) errors.push(`除外を宣言したパスが manifest にあります: ${p}`);
  }
  // 実際に走査した一覧と manifest のキーを突き合わせる（キーで直接開かない）
  const walked = walk(dir);
  const real = realpathSync(dir);
  const present = new Map();
  const warnings = [];
  for (const f of walked) {
    if (f.bad) { errors.push(`${f.bad}は不可: ${f.rel}`); continue; }
    if (!realpathSync(join(dir, f.rel)).startsWith(real + '/')) { errors.push(`フォルダの外を指すパス: ${f.rel}`); continue; }
    if ([VERSION, MANIFEST].includes(f.rel)) continue;
    if (isGenerated(f.rel)) { warnings.push(`生成物（版の中身ではない）: ${f.rel}`); continue; }
    present.set(f.rel.normalize('NFC'), f.rel);
    if (!(f.rel in m.files)) errors.push(`manifest に無いファイル: ${f.rel}`);
  }
  for (const [p, h] of Object.entries(m.files)) {
    if (!safeRelPath(p)) continue;
    const rel = present.get(p);
    if (!rel) { errors.push(`ファイルがありません: ${p}`); continue; }
    if (sha256(readFileSync(join(dir, rel))) !== h) errors.push(`内容が違います: ${p}`);
  }
  const gitCheck = git && errors.length === 0 ? checkAgainstGit(dir, m, errors, gitDir || dir) : 'not-run';
  return { ok: errors.length === 0, errors, warnings, commit: m.commit, branch: m.branch, dirty: !!m.dirty, lite: !!m.lite, excluded: m.excluded || [], files: Object.keys(m.files).length, gitCheck, manifest: m };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const gi = a.indexOf('--git');
  const gitDir = gi >= 0 ? resolve(a[gi + 1]) : undefined; // 展開先が repo の外でも、この repo の commit と照合する
  const dir = resolve(a.find((x, i) => !x.startsWith('--') && a[i - 1] !== '--git') || dirname(fileURLToPath(import.meta.url)));
  const r = verifyDist(dir, { gitDir });
  if (!r.ok) { console.error(`検証に失敗しました（${dir}）:\n- ${r.errors.slice(0, 30).join('\n- ')}`); process.exit(1); }
  for (const w of r.warnings) console.error(`注意: ${w}`);
  const g = { ok: 'git の commit の内容（blob）とも一致', 'no-git': '整合のみ確認。commit の真正性は未検証（git が無い）', 'skipped-dirty': '未コミットの変更を含むため、git の blob 照合はしていない' }[r.gitCheck];
  console.log(`一致: commit ${r.commit}${r.dirty ? '（dirty: 未コミットの変更を含むテスト用の版）' : ''}、${r.files} files${r.lite ? `（軽量配布。除外: ${r.excluded.join(', ')}）` : ''}。${g}`);
  process.exit(r.dirty ? 2 : 0); // 0 = 一致、2 = dirty だが一致、1 = 不一致
}
