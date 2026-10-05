// デモ用: 「人の確認」を模した承認ステップ。実運用では UI の「内容を確認して承認」で人が行う。
// ここでは price_reason（価格未入力・要記入）を外し、残りを承認したものを project.reviewed.json に書く。
import { readFileSync, writeFileSync } from 'node:fs';
import { parseProjectJson, serializeProject } from '../../src/core/schema.js';
import { applyEdit } from '../../src/core/model.js';

let p = parseProjectJson(readFileSync(new URL('./project.after.json', import.meta.url), 'utf8')).project;
const price = p.sections.find((s) => s.type === 'price_reason');
if (price) p = applyEdit(p, { type: 'removeSection', id: price.id });
for (const s of p.sections) p = applyEdit(p, { type: 'approveSection', id: s.id, value: true });
p = applyEdit(p, { type: 'setName', value: 'ミチシルベ簿記（架空デモ・Claude Code生成）' });
writeFileSync(new URL('./project.reviewed.json', import.meta.url), serializeProject(p) + '\n');
console.log('project.reviewed.json（デモ確認者が承認した想定）');
