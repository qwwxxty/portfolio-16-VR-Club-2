// Контраст тексту поверх сцени, виміряний по реальному скриншоту (текст приховано, тло лишається).
import { chromium } from 'playwright';
import sharp from 'sharp';
const lum = (r, g, bl) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl); };
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [w, h, mobile, mode] of [[375, 740, true, 'live'], [375, 667, true, 'live'], [768, 1024, true, 'live'], [1440, 900, false, 'live'], [1366, 768, false, 'live'], [1440, 900, false, 'static'], [375, 740, true, 'static']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, reducedMotion: mode === 'static' ? 'reduce' : 'no-preference' });
  const p = await ctx.newPage();
  await p.goto('http://localhost:8765/index.html', { waitUntil: 'load' });
  if (mode === 'live') await p.waitForFunction('document.getElementById("top").classList.contains("has-helmet")');
  await p.waitForTimeout(1500);
  if (!mobile) await p.mouse.move(w / 2, 5); // курсор угорі: шари світіння зсуваються найвище
  const rects = await p.evaluate(() => {
    const r = ['.pill', '#hero-title', '.hero__sub'].map(s => { const q = document.querySelector(s).getBoundingClientRect(); return [q.left, q.top, q.width, q.height].map(Math.round); });
    document.querySelector('.hero__content').style.visibility = 'hidden';
    return r;
  });
  let worst = 99, worstPx = null;
  for (let n = 0; n < (mode === 'live' ? 12 : 1); n++) { // 12 кадрів за цикл «дихання»
    await p.waitForTimeout(mode === 'live' ? 850 : 100);
    const { data, info } = await sharp(await p.screenshot()).raw().toBuffer({ resolveWithObject: true });
    for (const [i, [x, y, rw, rh]] of rects.entries()) {
      let mx = 0, px = null;
      for (let yy = Math.max(0, y); yy < Math.min(info.height, y + rh); yy++) for (let xx = Math.max(0, x); xx < Math.min(info.width, x + rw); xx++) {
        const k = (yy * info.width + xx) * info.channels; const L = lum(data[k], data[k + 1], data[k + 2]); if (L > mx) { mx = L; px = [data[k], data[k + 1], data[k + 2]]; }
      }
      // pill і підзаголовок — приглушений текст (#A1ACB9); заголовок — світлий, найтемніша точка градієнта ≈ #A6D5F0
      const fg = i === 1 ? lum(0xA6, 0xD5, 0xF0) : lum(0xA1, 0xAC, 0xB9);
      const c = (fg + 0.05) / (mx + 0.05);
      if (c < worst) { worst = c; worstPx = { el: ['pill', 'h1', 'sub'][i], px }; }
    }
  }
  console.log(w + 'x' + h, mode, 'min contrast', worst.toFixed(2), JSON.stringify(worstPx));
  await ctx.close();
}
await b.close();
