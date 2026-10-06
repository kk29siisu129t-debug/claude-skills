#!/usr/bin/env node
// src/app/index.html の CSP に、プレビュー（srcdoc iframe は親の CSP を引き継ぐ）で動く固定スクリプトの sha256 を反映する。
// HEAD_SCRIPT / RUNTIME_SCRIPT を変えたら実行する（unit テストが不一致を検出する）。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { HEAD_SCRIPT, RUNTIME_SCRIPT } from './src/core/render.js';

const file = new URL('./src/app/index.html', import.meta.url);
const hash = (s) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;
const html = readFileSync(file, 'utf8').replace(/script-src 'self'[^;]*;/, `script-src 'self' ${hash(HEAD_SCRIPT)} ${hash(RUNTIME_SCRIPT)};`);
writeFileSync(file, html);
console.log('CSP script hashes updated');
