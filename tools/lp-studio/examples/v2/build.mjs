// 2ケースを生成経路どおりに通して、成果物を書き出す（再現用）。
//   seed/cases/<id>.brief.json（入力）＋ examples/v2/<id>/response.json（Claude Code が書いた JSON）
//   → ingestGenerated → project.json / review.html（レビュー用）/ draft.html（社内確認・参照ID表示）/ check.txt
//   node examples/v2/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { parseProjectJson, serializeProject } from '../../src/core/schema.js';
import { ingestGenerated, buildPrompt } from '../../src/core/generate.js';
import { exportHtml } from '../../src/core/render.js';

const here = (p) => new URL(p, import.meta.url);
for (const id of ['michishirube', 'mitsumoriban']) {
  const brief = parseProjectJson(readFileSync(here(`../../seed/cases/${id}.brief.json`), 'utf8')).project;
  writeFileSync(here(`./${id}/prompt.md`), buildPrompt(brief, 'full') + '\n');
  const r = ingestGenerated(brief, readFileSync(here(`./${id}/response.json`), 'utf8'), { mode: 'full' });
  if (!r.ok) throw new Error(`${id}: ${r.report.errors.join(' / ')}`);
  writeFileSync(here(`./${id}/project.json`), serializeProject(r.project) + '\n');
  const review = exportHtml(r.project, 'review');
  if (!review.html) throw new Error(`${id}: review blocked: ${review.report.blockers.join(' / ')}`);
  writeFileSync(here(`./${id}/review.html`), review.html);
  writeFileSync(here(`./${id}/draft.html`), exportHtml(r.project, 'draft').html);
  const g = review.report.gates;
  const lines = [
    `# ${id}`,
    `レビュー用プレビュー: ${g.reviewPreview.ok ? '描画できる' : '停止条件あり'}`,
    `実販売の公開準備: ${g.commercialReady.ok ? '整っている' : '整っていない'}`,
    ...g.commercialReady.reasons.map((x) => `  - ${x}`),
    '検査結果:',
    ...review.report.issues.map((i) => `  [${i.level}] ${i.message}`),
    `出力しないセクション: ${review.report.removed.map((x) => `${x.role}（${x.reason}）`).join(' / ') || 'なし'}`,
  ];
  writeFileSync(here(`./${id}/check.txt`), lines.join('\n') + '\n');
  console.log(`${id}: stop ${review.report.issues.filter((i) => i.level === 'stop').length} / warn ${review.report.issues.filter((i) => i.level === 'warn').length}`);
}
