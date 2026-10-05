import { readFileSync } from 'node:fs';
import { parseProjectJson } from '../../src/core/schema.js';

export const SEED_TEXT = readFileSync(new URL('../../seed/project.fictional.json', import.meta.url), 'utf8');
export function seed() {
  const r = parseProjectJson(SEED_TEXT);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.project;
}
