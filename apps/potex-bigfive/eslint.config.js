import js from '@eslint/js';
import globals from 'globals';

// プライバシー方針をコードで守るための禁止ルール。
// 保存・送信・URL への書き込み・HTML 文字列の流し込みをアプリのソースから締め出す。
const privacyGuards = {
  'no-restricted-globals': [
    'error',
    { name: 'localStorage', message: '永続保存は禁止です。' },
    { name: 'sessionStorage', message: '永続保存は禁止です。' },
    { name: 'indexedDB', message: '永続保存は禁止です。' },
    { name: 'fetch', message: '外部通信は禁止です。' },
    { name: 'XMLHttpRequest', message: '外部通信は禁止です。' },
    { name: 'WebSocket', message: '外部通信は禁止です。' },
    { name: 'EventSource', message: '外部通信は禁止です。' },
    { name: 'confirm', message: 'Artifact では動作しないため、画面内の確認を使います。' },
    { name: 'alert', message: '画面内の表示を使います。' },
  ],
  'no-restricted-properties': [
    'error',
    { object: 'document', property: 'cookie', message: 'cookie は禁止です。' },
    { object: 'navigator', property: 'sendBeacon', message: '外部通信は禁止です。' },
    { object: 'window', property: 'localStorage', message: '永続保存は禁止です。' },
    { object: 'window', property: 'sessionStorage', message: '永続保存は禁止です。' },
    { object: 'window', property: 'fetch', message: '外部通信は禁止です。' },
    { object: 'history', property: 'pushState', message: '回答を URL に載せないため禁止です。' },
    { object: 'history', property: 'replaceState', message: '回答を URL に載せないため禁止です。' },
    { object: 'location', property: 'hash', message: '回答を URL に載せないため禁止です。' },
    { object: 'location', property: 'search', message: '回答を URL に載せないため禁止です。' },
  ],
  'no-restricted-syntax': [
    'error',
    { selector: "MemberExpression[property.name='innerHTML']", message: 'textContent / createElement を使います。' },
    { selector: "MemberExpression[property.name='outerHTML']", message: 'textContent / createElement を使います。' },
    { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'textContent / createElement を使います。' },
    { selector: "CallExpression[callee.property.name='write'][callee.object.name='document']", message: 'document.write は禁止です。' },
    { selector: "CallExpression[callee.name='eval']", message: 'eval は禁止です。' },
    { selector: "NewExpression[callee.name='Function']", message: 'Function コンストラクタは禁止です。' },
  ],
};

export default [
  { ignores: ['dist/**', 'node_modules/**', 'test-results/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        PotexScoring: 'readonly',
        PotexContent: 'readonly',
        PotexLogic: 'readonly',
      },
    },
    rules: {
      ...privacyGuards,
      'no-unused-vars': ['error', { varsIgnorePattern: '^Potex' }],
      'no-redeclare': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
