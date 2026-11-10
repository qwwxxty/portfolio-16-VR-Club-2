// Перевірка: шолом і стрічка не перетинаються в жодному кадрі. Знімає маски шолома і стрічки окремо.
import { chromium } from 'playwright';
import sharp from 'sharp';
const S = process.argv[2];
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [w, h, mobile] of [[375, 740, true], [768, 1024, true], [1440, 900, false]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto('http://localhost:8765/index.html', { waitUntil: 'load' });
  await p.waitForFunction('document.getElementById("top").classList.contains("has-helmet")');
  const measure = () => p.evaluate(() => {
    const v = window.__vizor, gl = v.renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const grab = (showH, showR) => { v.rig.visible = showH; v.ribbon.visible = showR; v.renderer.render(v.scene, v.camera); const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    const a = grab(true, false), r = grab(false, true); v.rig.visible = v.ribbon.visible = true;
    let overlap = 0, minGap = 1e9, helmBottomRow = -1, cut = false;
    for (let x = 0; x < W; x++) {
      let hb = -1, rt = -1; // рядки від низу (y=0 — низ)
      for (let y = 0; y < H; y++) { const i = (y * W + x) * 4 + 3; if (a[i] > 40) { hb = y; break; } }
      for (let y = H - 1; y >= 0; y--) { const i = (y * W + x) * 4 + 3; if (r[i] > 40) { rt = y; break; } }
      for (let y = 0; y < H; y++) { const i = (y * W + x) * 4 + 3; if (a[i] > 40 && r[i] > 40) overlap++; }
      if (hb >= 0) { if (hb === 0) cut = true; if (helmBottomRow < 0 || hb < helmBottomRow) helmBottomRow = hb; if (rt >= 0) minGap = Math.min(minGap, hb - rt); }
    }
    const dpr = W / document.getElementById('scene').clientWidth;
    return { overlap, minGapPx: Math.round(minGap / dpr), helmBottomFromHeroBottomPx: Math.round(helmBottomRow / dpr), cut };
  });
  let worst = { overlap: 0, minGapPx: 1e9, cut: false };
  const note = (m) => { worst.overlap = Math.max(worst.overlap, m.overlap); worst.minGapPx = Math.min(worst.minGapPx, m.minGapPx); worst.cut = worst.cut || m.cut; };
  const shot = async (name) => { await p.screenshot({ path: `${S}/g_${w}_${name}.png` }); };
  await p.waitForTimeout(300); await shot('start'); note(await measure());
  // цикл анімації: 40 замірів за ~14 с, курсор ходить по кутах
  const corners = [[5, 5], [w - 5, 5], [w - 5, h - 5], [5, h - 5], [w / 2, h - 5]];
  for (let i = 0; i < 40; i++) {
    if (!mobile) await p.mouse.move(...corners[i % corners.length]);
    await p.waitForTimeout(350); note(await measure());
    if (i === 12) await shot('mid');
  }
  // прокрутка
  for (const f of [0.1, 0.2, 0.3, 0.45, 0.6]) {
    await p.evaluate((f) => window.scrollTo({ top: Math.round(document.getElementById('top').offsetHeight * f), behavior: 'instant' }), f);
    await p.waitForTimeout(500); const m = await measure(); worst.overlap = Math.max(worst.overlap, m.overlap); if (f <= 0.3) worst.minGapPx = Math.min(worst.minGapPx, m.minGapPx);
    if (f === 0.3) { await shot('scroll30'); console.log(w, 'scroll30', JSON.stringify(m)); }
  }
  console.log(w, 'worst over all frames:', JSON.stringify(worst));
  await ctx.close();
}
await b.close();
