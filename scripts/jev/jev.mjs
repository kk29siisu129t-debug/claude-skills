#!/usr/bin/env node
// Jev（TypeSafe AI の判断特化モデル）で成果物を機械検品する CLI。依存なし、Node 18+。
//
//   node scripts/jev/jev.mjs check <file> [--rubric NAME ...] [--json] [--no-log]
//   node scripts/jev/jev.mjs ask   --state <text|@file> --questions <json|@file>
//   node scripts/jev/jev.mjs key <発行したキー>   （保存して接続確認まで）
//   node scripts/jev/jev.mjs ping
//   node scripts/jev/jev.mjs rubrics
//
// APIキー: 環境変数 TYPESAFE_API_KEY、無ければ %USERPROFILE%\.claude\jev.key（1行）。
// 料金: 入力 $0.042/100万トークン、出力無料。毎回 data/jev/log.jsonl に使用量を残す。
//
// Jev ができるのは「与えた文書に対する判定」だけ。文章生成・計算・日付比較はできない。
// 日本語は英語より精度が落ちるので、質問文は英語、文書はそのまま日本語で渡す。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENDPOINT = process.env.JEV_ENDPOINT || "https://api.typesafe.ai/v1/systemone"; // 上書きはテスト用
const MODEL = "jev-latest";
const MAX_STATE_CHARS = 50_000; // 上限64Kトークン。日本語は1文字が1〜1.5トークンになるので、質問文の分も含めて余裕を残す

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const RUBRIC_DIR = path.join(HERE, "rubrics");
const LOG_PATH = path.join(REPO, "data", "jev", "log.jsonl");

// ---------- 引数 ----------
function parseArgs(argv) {
  const out = { _: [], rubric: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--rubric" || a === "-r") out.rubric.push(argv[++i]);
    else if (a === "--state") out.state = argv[++i];
    else if (a === "--questions") out.questions = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--no-log") out.noLog = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else out._.push(a);
  }
  return out;
}

function usage() {
  const lines = fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 14);
  console.log(lines.map(l => l.replace(/^\/\/ ?/, "")).join("\n"));
}

// ---------- キー ----------
const KEY_FILE = path.join(os.homedir(), ".claude", "jev.key");

function validKey(k, from) {
  if (!k) return false;
  if (/[^\x21-\x7e]/.test(k)) {
    console.error(`${from} のキーに英数字以外が入っています（「ここにキー」のまま実行していませんか）。\n` +
      "発行した実際のキーで、次を実行してください:\n" +
      "  node scripts/jev/jev.mjs key <発行したキー>");
    process.exit(1);
  }
  return true;
}

function apiKey() {
  const env = process.env.TYPESAFE_API_KEY?.trim();
  if (validKey(env, "環境変数 TYPESAFE_API_KEY")) return env;
  if (fs.existsSync(KEY_FILE)) {
    // PowerShell の > は UTF-16LE(BOM付き) で書くことがあるので、BOM を見て文字コードを選ぶ
    const buf = fs.readFileSync(KEY_FILE);
    const isUtf16 = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe;
    const k = buf.toString(isUtf16 ? "utf16le" : "utf8").replace(/^\uFEFF/, "").trim();
    if (validKey(k, KEY_FILE)) return k;
  }
  console.error(
    "APIキーが見つかりません。\n" +
    "  1. https://console.typesafe.ai/keys でキーを発行\n" +
    "  2. node scripts/jev/jev.mjs key <発行したキー>  で保存（" + KEY_FILE + " に書きます）\n"
  );
  process.exit(1);
}

function cmdKey(args) {
  const k = (args._[1] ?? "").trim();
  if (!k) { console.error("キーを引数に渡してください: node scripts/jev/jev.mjs key <発行したキー>"); process.exit(1); }
  if (/[^\x21-\x7e]/.test(k)) { console.error("英数字以外が入っています。発行画面のキーをそのまま貼ってください。"); process.exit(1); }
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, k + "\n", { encoding: "utf8" });
  console.log(`保存しました: ${KEY_FILE}（${k.slice(0, 6)}…${k.slice(-4)}）。続けて ping で接続確認します。`);
}

// ---------- 入力の読み方 ----------
function readArgOrFile(v) {
  if (v == null) return v;
  if (v.startsWith("@")) return fs.readFileSync(v.slice(1), "utf8");
  return v;
}

// HTML はタグ・CSS・JS を落として本文だけにする（トークンを無駄にしない）
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function loadDocument(file) {
  const raw = fs.readFileSync(file, "utf8");
  let text = /\.html?$/i.test(file) ? htmlToText(raw) : raw;
  let truncated = false;
  if (text.length > MAX_STATE_CHARS) {
    text = text.slice(0, MAX_STATE_CHARS);
    truncated = true;
  }
  return { text, truncated, chars: text.length };
}

// ---------- ルーブリック ----------
function listRubrics() {
  return fs.readdirSync(RUBRIC_DIR).filter(f => f.endsWith(".json")).map(f => f.replace(/\.json$/, ""));
}

function loadRubric(name) {
  const f = path.join(RUBRIC_DIR, name + ".json");
  if (!fs.existsSync(f)) {
    console.error(`ルーブリック "${name}" がありません。使えるもの: ${listRubrics().join(", ")}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

// 複数ルーブリックを1リクエストにまとめる。質問は並列評価で、課金は入力トークンだけなので
// 別々に投げるより文書分のトークンが節約できる。
function buildQuestions(rubrics) {
  const questions = {};
  const meta = {};
  for (const r of rubrics) {
    for (const [id, q] of Object.entries(r.questions)) {
      const key = rubrics.length > 1 ? `${r.name}__${id}` : id;
      const { label, gate, flag_if, applies_if, fix, ...apiQ } = q;
      questions[key] = apiQ;
      meta[key] = { rubric: r.name, id, label, gate, flag_if, applies_if, fix, type: q.type };
    }
  }
  return { questions, meta };
}

// ---------- API ----------
async function callJev(body, key) {
  const delays = [0, 800, 2000, 5000];
  let lastErr;
  for (const d of delays) {
    if (d) await new Promise(r => setTimeout(r, d));
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = "接続できません: " + (e.cause?.message ?? e.message);
      continue; // ネットワーク断は再試行
    }
    if (res.ok) return res.json();
    const txt = await res.text();
    lastErr = `${res.status} ${txt.slice(0, 300)}`;
    if (res.status === 401) { console.error("APIキーが無効です (401)。"); process.exit(1); }
    if (res.status === 422) { console.error("リクエストが不正です (422):\n" + txt.slice(0, 800)); process.exit(1); }
    if (res.status !== 429 && res.status !== 529) break; // 再試行するのはレート制限だけ
  }
  console.error("Jev 呼び出し失敗: " + lastErr);
  process.exit(1);
}

// ---------- 判定 ----------
// 型はこちらが送った質問側を正とする（応答の type は補助）
function value(ans, type = ans?.type) {
  if (!ans) return undefined;
  if (type === "noul") return ans.noul ?? ans.probability;
  if (type === "score") return ans.score;
  if (type === "choice") return ans.choice;
  return ans.noul ?? ans.probability ?? ans.score ?? ans.choice;
}

// 各質問を 合格 / 要修正 / 目視 / 注意 / 対象外 に落とす
function judge(meta, answers) {
  const rows = [];
  for (const [key, m] of Object.entries(meta)) {
    const ans = answers[key];
    if (!ans) continue;
    const v = value(ans, m.type);
    const conf = ans.confidence;
    const row = { key, rubric: m.rubric, id: m.id, label: m.label ?? m.id, type: m.type, value: v, confidence: conf, fix: m.fix, verdict: "info" };

    // 前提条件（数字が無い文書に出典を求めない、など）
    if (m.applies_if) {
      const depKey = Object.keys(meta).find(k => meta[k].rubric === m.rubric && meta[k].id === m.applies_if.q);
      const dep = depKey ? value(answers[depKey], meta[depKey].type) : undefined;
      const ok = dep != null && (m.applies_if.min == null || dep >= m.applies_if.min) && (m.applies_if.max == null || dep <= m.applies_if.max);
      if (!ok) { row.verdict = "na"; rows.push(row); continue; }
    }

    if (m.gate) {
      const g = m.gate;
      let pass = true;
      if (g.min != null && !(v >= g.min)) pass = false;
      if (g.max != null && !(v <= g.max)) pass = false;
      if (g.in != null && !g.in.includes(v)) pass = false;
      // 迷っている答えは人が見る。noul は 0.5 付近、choice/score は confidence が低いとき
      const unsure = (m.type === "noul" && v > 0.35 && v < 0.65) || (conf != null && conf < 0.55);
      row.verdict = unsure ? "check" : (pass ? "pass" : "fail");
    } else if (m.flag_if) {
      const f = m.flag_if;
      const hit = (f.min != null && v >= f.min) || (f.max != null && v <= f.max) || (f.in != null && f.in.includes(v));
      row.verdict = hit ? "flag" : "pass";
    }
    rows.push(row);
  }
  return rows;
}

const MARK = { pass: "✅", fail: "❌", check: "⚠️", flag: "ℹ️", na: "－", info: "・" };
const WORD = { pass: "合格", fail: "要修正", check: "目視", flag: "注意", na: "対象外", info: "参考" };

function fmtValue(row) {
  if (row.type === "noul") return (row.value * 100).toFixed(0) + "%";
  if (row.type === "score") return row.value.toFixed(2) + (row.confidence != null ? ` (c${row.confidence.toFixed(2)})` : "");
  return String(row.value) + (row.confidence != null ? ` (c${row.confidence.toFixed(2)})` : "");
}

function printReport(rows, info) {
  const fails = rows.filter(r => r.verdict === "fail");
  const checks = rows.filter(r => r.verdict === "check");
  const flags = rows.filter(r => r.verdict === "flag");
  const na = rows.filter(r => r.verdict === "na");
  const head = fails.length ? `❌ 要修正 ${fails.length}件` : "✅ 機械検品は通過";
  console.log(`${head}（目視 ${checks.length}・注意 ${flags.length}・対象外 ${na.length}）`);
  const trunc = info.truncated ? `｜⚠️ 先頭${MAX_STATE_CHARS.toLocaleString()}字で切り詰め` : "";
  console.log(`${info.file}｜${info.rubrics.join("+")}｜${info.chars.toLocaleString()}字｜${info.tokens.toLocaleString()}tok｜${info.ms}ms${trunc}`);
  console.log("");
  console.log("| 判定 | 項目 | 値 | 直し方 |");
  console.log("|---|---|---|---|");
  const order = { fail: 0, check: 1, flag: 2, pass: 3, info: 4, na: 5 };
  for (const r of [...rows].sort((a, b) => order[a.verdict] - order[b.verdict])) {
    const showFix = r.verdict === "fail" || r.verdict === "check" || r.verdict === "flag";
    const fix = showFix && r.fix ? r.fix : "";
    console.log(`| ${MARK[r.verdict]} ${WORD[r.verdict]} | ${r.label} | ${r.verdict === "na" ? "" : fmtValue(r)} | ${fix} |`);
  }
  console.log("");
  console.log("Jev は有無を判定するだけで、数字の正しさは検算しない。「要修正」と「目視」は人が原文を見て確定する。");
}

function appendLog(entry) {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
}

// ---------- コマンド ----------
async function cmdCheck(args) {
  const file = args._[1];
  if (!file) { console.error("ファイルを指定してください。"); process.exit(1); }
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) { console.error("ファイルがありません: " + abs); process.exit(1); }
  const names = args.rubric.length ? args.rubric : ["output-contract"];
  const rubrics = names.map(loadRubric);
  const doc = loadDocument(abs);
  const { questions, meta } = buildQuestions(rubrics);

  const body = {
    model: MODEL,
    state: {
      document: doc.text,
      context: rubrics.map(r => r.context).filter(Boolean).join(" ") ||
        "The document is written in Japanese. It is an internal report or external proposal prepared for a CEO who runs eight businesses in parallel.",
    },
    questions,
  };
  const t0 = Date.now();
  const res = await callJev(body, apiKey());
  const ms = Date.now() - t0;
  const rows = judge(meta, res.answers ?? {});
  const info = { file: path.relative(REPO, abs) || abs, rubrics: names, chars: doc.chars, truncated: doc.truncated, tokens: res.usage?.input_tokens ?? 0, ms, model: res.model };

  if (!args.noLog) appendLog({
    ts: new Date().toISOString(), cmd: "check", file: info.file, rubrics: names, model: res.model,
    input_tokens: info.tokens, ms,
    fail: rows.filter(r => r.verdict === "fail").map(r => r.key),
    check: rows.filter(r => r.verdict === "check").map(r => r.key),
    flag: rows.filter(r => r.verdict === "flag").map(r => r.key),
  });

  if (args.json) console.log(JSON.stringify({ info, rows, raw: res }, null, 2));
  else printReport(rows, info);
  process.exit(rows.some(r => r.verdict === "fail") ? 2 : 0);
}

async function cmdAsk(args) {
  const state = readArgOrFile(args.state);
  const qs = readArgOrFile(args.questions);
  if (!state || !qs) { console.error("--state と --questions が必要です（@file でファイル指定可）。"); process.exit(1); }
  let questions;
  try { questions = JSON.parse(qs); } catch (e) { console.error("--questions が JSON ではありません: " + e.message); process.exit(1); }
  let parsedState = state;
  try { parsedState = JSON.parse(state); } catch { /* 文字列のまま渡す */ }
  const t0 = Date.now();
  const res = await callJev({ model: MODEL, state: parsedState, questions }, apiKey());
  if (!args.noLog) appendLog({ ts: new Date().toISOString(), cmd: "ask", model: res.model, input_tokens: res.usage?.input_tokens ?? 0, ms: Date.now() - t0, questions: Object.keys(questions) });
  console.log(JSON.stringify(res, null, 2));
}

async function cmdPing() {
  const t0 = Date.now();
  const res = await callJev({
    model: MODEL,
    state: "売上は目標2,570万円に対し実績1,830万円で、達成率71.2%。",
    questions: { has_numbers: { type: "noul", instructions: "Does the text contain a numeric figure?" } },
  }, apiKey());
  const ms = Date.now() - t0;
  const v = value(res.answers?.has_numbers, "noul");
  appendLog({ ts: new Date().toISOString(), cmd: "ping", model: res.model, input_tokens: res.usage?.input_tokens ?? 0, ms });
  console.log(`OK ${res.model} ${ms}ms has_numbers=${v == null ? "?" : v.toFixed(2)} tokens=${res.usage?.input_tokens}`);
  if (v == null) console.log("応答の形が想定と違います。生の応答: " + JSON.stringify(res.answers));
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (args.help || !cmd) { usage(); process.exit(0); }
if (cmd === "check") await cmdCheck(args);
else if (cmd === "ask") await cmdAsk(args);
else if (cmd === "key") { cmdKey(args); await cmdPing(); }
else if (cmd === "ping") await cmdPing();
else if (cmd === "rubrics") {
  for (const n of listRubrics()) { const r = loadRubric(n); console.log(`${n}\t${r.title}（${Object.keys(r.questions).length}問）`); }
}
else { usage(); process.exit(1); }
