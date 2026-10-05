#!/usr/bin/env node
// src/app/index.html の CSP に、プレビュー内で動く固定スクリプト（RUNTIME_SCRIPT）の sha256 を反映する。
// RUNTIME_SCRIPT を変えたら実行する（unit テストが不一致を検出する）。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { RUNTIME_SCRIPT } from './src/core/render.js';

const file = new URL('./src/app/index.html', import.meta.url);
const hash = createHash('sha256').update(RUNTIME_SCRIPT).digest('base64');
const html = readFileSync(file, 'utf8').replace(/script-src 'self'( 'sha256-[^']+')?;/, `script-src 'self' 'sha256-${hash}';`);
writeFileSync(file, html);
console.log(`CSP script hash: sha256-${hash}`);
