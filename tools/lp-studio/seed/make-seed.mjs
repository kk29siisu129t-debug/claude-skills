// 架空seed を生成する。中身はすべて架空。実在の事業・人物・実績ではない。
//   seed/cases/<id>.brief.json（入力だけ）＋ examples/v2/<id>/response.json（Claude Code が書いた JSON）
//   → ingestGenerated（検証つき取り込み）→ seed/<id>.project.json
// 人手で完成原稿を固定するのではなく、生成経路を通した結果を seed にする。
// 簿記ケースには、検証用データ UI 用の架空 LPO 集計を付ける（LP の成果根拠には使わない）。
import { readFileSync, writeFileSync } from 'node:fs';
import { parseProjectJson, serializeProject } from '../src/core/schema.js';
import { ingestGenerated } from '../src/core/generate.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const dataset = JSON.parse(read('./lpo-dataset.fictional.json'));
for (const id of ['michishirube', 'mitsumoriban']) {
  const brief = parseProjectJson(read(`./cases/${id}.brief.json`));
  if (!brief.ok) throw new Error(brief.errors.join('\n'));
  const r = ingestGenerated(brief.project, read(`../examples/v2/${id}/response.json`), { mode: 'full' });
  if (!r.ok) throw new Error(r.report.errors.join('\n'));
  const p = { ...r.project, updatedAt: '2026-10-06T00:00:00.000Z', lpo: { dataset: id === 'michishirube' ? dataset : null } };
  const check = parseProjectJson(serializeProject(p));
  if (!check.ok) throw new Error(check.errors.join('\n'));
  writeFileSync(new URL(`./${id}.project.json`, import.meta.url), serializeProject(check.project) + '\n');
  const stops = r.report.issues.filter((i) => i.level === 'stop');
  console.log(`seed/${id}.project.json（停止条件 ${stops.length} 件）`);
}
