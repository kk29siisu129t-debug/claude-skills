// 実際に描画に使われた和文フォントを確認する（CSS の指定だけでは保証しないため）。
//   node docs/fonts.mjs <page.html>
import { launch } from '../tests/e2e/pw.mjs';
const b = await launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.goto(`file://${(await import("node:path")).resolve(process.argv[2])}`);
const cdp = await p.context().newCDPSession(p);
await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
const out = {};
for (const sel of ['h1 .ph', '.lead', '.sec .body p', '.vis-row span:last-child', '.vis-table td', '.btn-primary', '.steps h3', '.demo-bar']) {
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
  if (!nodeId) continue;
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  out[sel] = fonts.map((f) => `${f.familyName}(${f.glyphCount})`).join(', ');
}
console.log(JSON.stringify(out, null, 1));
await b.close();
