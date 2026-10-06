import { readFileSync } from 'node:fs';
import { parseProjectJson } from '../../src/core/schema.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
export const SEED_TEXT = read('seed/michishirube.project.json');
export const SEED2_TEXT = read('seed/mitsumoriban.project.json');
export const BRIEF = (id) => read(`seed/cases/${id}.brief.json`);
export const RESPONSE = (id) => read(`examples/v2/${id}/response.json`);
function parse(text) {
  const r = parseProjectJson(text);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.project;
}
/** 簿記ケース（生成経路を通した seed。架空 LPO データ付き） */
export const seed = () => parse(SEED_TEXT);
/** 見積もり番ケース */
export const seed2 = () => parse(SEED2_TEXT);
export const brief = (id) => parse(BRIEF(id));
