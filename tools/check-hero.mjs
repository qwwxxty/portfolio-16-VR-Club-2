// Перевірка першого екрана: глибина шолом/стрічка, стрічка не заходить під текст і кнопку,
// контраст тексту поверх найяскравішої точки сцени. Знімає скриншоти в трьох моментах.
import { chromium } from 'playwright';
const S = process.argv[2];
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const lum = (r, g, bl) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl); };
for (const [w, h, mobile] of [[375, 740, true], [768, 1024, true], [1440, 900, false]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:8765/index.html', { waitUntil: 'load' });
  await p.waitForFunction('document.getElementById("top").classList.contains("has-helmet")');
  const measure = () => p.evaluate(() => {
    const v = window.__vizor, gl = v.renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const cv = document.getElementById('scene'), cr = cv.getBoundingClientRect(), k = W / cr.width;
    const grab = (hm, rb, gw) => { v.rig.visible = hm; v.ribbon.visible = rb; v.glow.visible = gw; v.renderer.render(v.scene, v.camera); const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    const rib = grab(false, true, false), all = grab(true, true, true), hm = grab(true, false, false);
    v.rig.visible = v.ribbon.visible = v.glow.visible = true;
    const rects = ['.pill', '#hero-title', '.hero__sub', '.btn-hero'].map(s => document.querySelector(s).getBoundingClientRect());
    let ribbonOverText = 0, maxA = 0, bright = [0, 0, 0, 0], cut = false;
    for (const [ri, r] of rects.entries()) {
      for (let y = Math.max(0, Math.floor((r.top - cr.top) * k)); y < Math.min(H, Math.ceil((r.bottom - cr.top) * k)); y++)
        for (let x = Math.max(0, Math.floor(r.left * k)); x < Math.min(W, Math.ceil(r.right * k)); x++) {
          const i = ((H - 1 - y) * W + x) * 4;
          if (rib[i + 3] > 20) ribbonOverText++;
          if (ri < 3 && all[i + 3] > maxA) { maxA = all[i + 3]; bright = [all[i], all[i + 1], all[i + 2], all[i + 3]]; }
        }
    }
    for (let x = 0; x < W; x++) if (hm[x * 4 + 3] > 40) cut = true; // шолом торкається нижнього краю
    return { ribbonOverText, bright, cut, depthGap: +v.depthGap().toFixed(2), t: +v.time.toFixed(1) };
  });
  const worst = { ribbonOverText: 0, minDepthGap: 1e9, minContrastMuted: 1e9, cut: false };
  const note = (m) => {
    worst.ribbonOverText = Math.max(worst.ribbonOverText, m.ribbonOverText); worst.minDepthGap = Math.min(worst.minDepthGap, m.depthGap); worst.cut = worst.cut || m.cut;
    // найяскравіший піксель сцени під текстом: premultiplied поверх --bg (#0A0F14)
    const a = m.bright[3] / 255, bg = [10, 15, 20];
    const c = [0, 1, 2].map(i => Math.min(255, m.bright[i] + bg[i] * (1 - a)));
    const Lb = lum(...c), Lm = lum(0xA1, 0xAC, 0xB9);
    worst.minContrastMuted = Math.min(worst.minContrastMuted, +((Lm + 0.05) / (Lb + 0.05)).toFixed(2));
  };
  const corners = [[5, 5], [w - 5, 5], [w - 5, h - 5], [5, h - 5]];
  for (let i = 0; i < 30; i++) {
    if (!mobile) await p.mouse.move(...corners[i % 4]);
    await p.waitForTimeout(330); note(await measure());
    if (i === 3) await p.screenshot({ path: `${S}/c_${w}_a.png` });
    if (i === 12) await p.screenshot({ path: `${S}/c_${w}_b.png` });
    if (i === 22) await p.screenshot({ path: `${S}/c_${w}_c.png` });
  }
  for (const f of [0.15, 0.3, 0.5]) {
    await p.evaluate((f) => window.scrollTo({ top: Math.round(document.getElementById('top').offsetHeight * f), behavior: 'instant' }), f);
    await p.waitForTimeout(500); const m = await measure(); worst.minDepthGap = Math.min(worst.minDepthGap, m.depthGap);
    if (f === 0.3) await p.screenshot({ path: `${S}/c_${w}_s.png` });
  }
  await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await p.waitForTimeout(600);
  const fps = await p.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); (function f() { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else r(Math.round(n / 3)); })(); }));
  delete worst.minContrastMuted; // альфа canvas не бачить аддитивного світіння; контраст міряє check-contrast.mjs
  console.log(w, JSON.stringify(worst), 'fps', fps, 'errors', errs.length ? errs : 'none');
  await ctx.close();
}
await b.close();
