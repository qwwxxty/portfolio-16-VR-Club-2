// JS-фолбек анімації тексту: вимикаємо CSS scroll-driven animations (підміна styles.css і CSS.supports).
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.route('**/styles.css', async (r) => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()).replaceAll('animation-timeline: scroll()', 'animation-timeline: nope()') }); });
await p.addInitScript(() => { const o = CSS.supports.bind(CSS); CSS.supports = (...a) => (String(a[0]).includes('animation-timeline') ? false : o(...a)); });
await p.goto('http://localhost:8765/index.html', { waitUntil: 'load' }); await p.waitForTimeout(1500);
const read = () => p.evaluate(() => ['.pill', '#hero-title', '.hero__sub', '.btn-hero'].map(s => { const e = document.querySelector(s), c = getComputedStyle(e); return (+c.opacity).toFixed(2) + '/' + (c.transform === 'none' ? 0 : Math.round(new DOMMatrix(c.transform).m42)) + (c.visibility === 'hidden' ? '/hidden' : '') + (c.animationName !== 'none' ? '/CSSANIM' : ''); }).join('  '));
for (const f of [0, 0.1, 0.25, 0.4, 0.5, 0]) { await p.evaluate((f) => window.scrollTo({ top: Math.round(900 * f), behavior: 'instant' }), f); await p.waitForTimeout(300); console.log(f, await read(), 'tab', await p.evaluate(() => document.querySelector('.btn-hero').getAttribute('tabindex'))); }
console.log('errors', errs);
await b.close();
