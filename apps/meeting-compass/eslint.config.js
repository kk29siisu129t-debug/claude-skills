import js from '@eslint/js';
import globals from 'globals';

// web/ では HTML 文字列の注入・ブラウザ永続化・ネットワーク送信・マイク/画面取得を禁止する
const forbiddenInWeb = [
  { selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]", message: 'innerHTML/outerHTML は使わず textContent を使う' },
  { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'insertAdjacentHTML は禁止' },
  { selector: "CallExpression[callee.property.name='write'][callee.object.name='document']", message: 'document.write は禁止' },
  { selector: "CallExpression[callee.property.name=/^(getUserMedia|getDisplayMedia)$/]", message: 'このプロトタイプではマイク・画面取得をしない' },
];

export default [
  { ignores: ['node_modules/', 'dist/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  {
    files: ['web/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-syntax': ['error', ...forbiddenInWeb],
      'no-restricted-globals': ['error',
        { name: 'localStorage', message: '保存はメモリのみ' },
        { name: 'sessionStorage', message: '保存はメモリのみ' },
        { name: 'indexedDB', message: '保存はメモリのみ' },
        { name: 'fetch', message: '初期状態でネットワーク送信しない' },
        { name: 'XMLHttpRequest', message: '初期状態でネットワーク送信しない' },
        { name: 'WebSocket', message: '初期状態でネットワーク送信しない' },
        { name: 'EventSource', message: '初期状態でネットワーク送信しない' },
        { name: 'eval', message: 'eval は禁止' },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },
  {
    files: ['*.js', '*.mjs', 'scripts/**/*.mjs', 'tests/**/*.js', 'tests/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
