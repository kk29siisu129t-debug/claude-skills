// ブラウザ用のスクリプト（非モジュール）を Node の同じ realm に読み込む。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8');

const code = [read('scoring.js'), read('content.js'), read('logic.js'), read('career.js')].join('\n');
const api = vm.runInThisContext(`${code}\n;({ PotexScoring, PotexContent, PotexLogic, PotexCareer })`, {
  filename: 'potex-src.js',
});

export const { PotexScoring, PotexContent, PotexLogic, PotexCareer } = api;
