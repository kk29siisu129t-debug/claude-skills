#!/usr/bin/env node
// LP Studio CLI。Claude Code セッションから実行する前提（新規APIキー・外部API接続なし）。
//
//   node cli.mjs new --out p.json                          空の project
//   node cli.mjs seed --out p.json                         架空seedをコピー
//   node cli.mjs template --project p.json --out p.json    LP全体をテンプレートで下書き（AI生成ではない）
//   node cli.mjs prompt --project p.json --mode full|reangle|section [--promise 文] [--section id] > prompt.md
//   node cli.mjs ingest --project p.json --response r.json --mode full|reangle|section [--section id] --out p2.json
//   node cli.mjs validate --project p.json
//   node cli.mjs audit --project p.json
//   node cli.mjs export --project p.json --kind draft|safe --out page.html
//   node cli.mjs lpo --project p.json [--json]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseProjectJson, serializeProject } from './src/core/schema.js';
import { emptyProject } from './src/core/model.js';
import { generateAllTemplate, buildPrompt, ingestGenerated } from './src/core/generate.js';
import { auditProject } from './src/core/claims.js';
import { exportHtml } from './src/core/render.js';
import { analyzeLpo } from './src/core/lpo.js';

const [cmd, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const k = rest[i].slice(2);
    const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
    args[k] = v;
  }
}

function load(path) {
  const r = parseProjectJson(readFileSync(path, 'utf8'));
  for (const w of r.warnings) console.error(`warn: ${w}`);
  if (!r.ok) {
    for (const e of r.errors) console.error(`error: ${e}`);
    process.exit(2);
  }
  return r.project;
}
function save(project, out) {
  const p = { ...project, updatedAt: new Date().toISOString() };
  if (out) { writeFileSync(out, serializeProject(p) + '\n'); console.error(`wrote ${out}`); } else process.stdout.write(serializeProject(p) + '\n');
}
const need = (k) => { if (!args[k] || args[k] === true) { console.error(`--${k} が必要です`); process.exit(1); } return args[k]; };

switch (cmd) {
  case 'new': save(emptyProject(args.name || '新しいLP'), args.out); break;
  case 'seed': save(load(new URL('./seed/project.fictional.json', import.meta.url).pathname), args.out); break;
  case 'template': save(generateAllTemplate(load(need('project'))), args.out); break;
  case 'prompt': {
    const p = load(need('project'));
    process.stdout.write(buildPrompt(p, args.mode || 'full', { promise: args.promise, sectionId: args.section }) + '\n');
    break;
  }
  case 'ingest': {
    const p = load(need('project'));
    const r = ingestGenerated(p, readFileSync(need('response'), 'utf8'), { mode: need('mode'), sectionId: args.section });
    for (const k of ['errors', 'rejected', 'warnings', 'added']) for (const m of r.report[k]) console.error(`${k}: ${m}`);
    if (!r.ok) process.exit(2);
    save(r.project, args.out);
    break;
  }
  case 'validate': { load(need('project')); console.log('ok'); break; }
  case 'audit': {
    const issues = auditProject(load(need('project')));
    for (const i of issues) console.log(`[${i.level}] ${i.message}`);
    console.log(`${issues.length} 件`);
    break;
  }
  case 'export': {
    const kind = need('kind');
    const { html, report } = exportHtml(load(need('project')), kind);
    for (const b of report.blockers) console.error(`blocker: ${b}`);
    for (const r of report.removed) console.error(`removed: [${r.section}] ${r.text} — ${r.reasons.join(' / ')}`);
    if (!html) { console.error('safe export をブロックしました（上記 blocker を解消してください）'); process.exit(3); }
    if (args.out) { writeFileSync(args.out, html); console.error(`wrote ${args.out}`); } else process.stdout.write(html);
    break;
  }
  case 'lpo': {
    const a = analyzeLpo(load(need('project')));
    if (args.json) { console.log(JSON.stringify(a, null, 2)); break; }
    if (!a.ok) { console.log(a.message); break; }
    console.log(`※ ${a.banner}`);
    console.log(`未接続: ${Object.values(a.connections).map((c) => c.label).join(' / ')}`);
    for (const an of a.analyses) {
      console.log(`\n■ ${an.name} ${an.period} 分母=${an.unit} CV=${an.conversionDefinition}`);
      for (const o of an.observations) console.log(`  観測: ${o.text}`);
      for (const c of an.comparisons) console.log(`  判定: ${c.variant} → ${c.label}${c.p != null ? ` (p=${c.p.toExponential(2)})` : ''}\n    ${c.reasons.join('\n    ')}`);
    }
    console.log('\n■ 期間をまたぐ比較の前提');
    for (const c of a.crossPeriod) console.log(`  ${c.a} × ${c.b}: ${c.comparable ? '定義一致（比較の前提を満たす）' : `比較しない — ${c.reasons.join(' / ')}`}`);
    console.log('\n■ 仮説と検証計画（推測）');
    for (const h of a.hypotheses) console.log(`  [${h.priority.level}] ${h.title}（根拠種別: ${h.evidenceType}）\n    ${h.hypothesis}`);
    break;
  }
  default:
    console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').filter((l) => l.startsWith('//')).join('\n'));
}
