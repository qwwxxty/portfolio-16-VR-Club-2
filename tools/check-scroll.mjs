import { chromium, firefox } from 'playwright';
import sharp from 'sharp';
const S = process.argv[2]; const eng = process.argv[3] || 'chromium';
const b = eng === 'firefox' ? await firefox.launch() : await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const sizes = eng === 'firefox' ? [[1440, 900, false]] : [[375, 740, true], [768, 1024, true], [1440, 900, false], [1366, 700, false], [375, 600, true]];
for (const [w, h, mobile] of sizes) {
  const ctx = await b.newContext(eng === 'firefox' ? { viewport: { width: w, height: h } } : { viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(eng === 'firefox' ? 2500 : 0);
  if (eng !== 'firefox') await p.waitForFunction('document.getElementById("top").classList.contains("has-helmet")');
  await p.waitForTimeout(1500);
  const bufs = [];
  for (const f of [0, 0.25, 0.5]) {
    await p.evaluate((f) => window.scrollTo({ top: Math.round(document.getElementById('top').offsetHeight * f), behavior: 'instant' }), f);
    await p.waitForTimeout(700);
    const st = await p.evaluate(() => {
      const q = (s) => { const e = document.querySelector(s), c = getComputedStyle(e), r = e.getBoundingClientRect(); return { o: +(+c.opacity).toFixed(2), ty: c.transform === 'none' ? 0 : Math.round(new DOMMatrix(c.transform).m42), vis: c.visibility, top: Math.round(r.top), bottom: Math.round(r.bottom) }; };
      const btn = document.querySelector('.btn-hero');
      const nav = document.getElementById('nav').getBoundingClientRect();
      return { css: CSS.supports('animation-timeline: scroll()'), pill: q('.pill'), h1: q('#hero-title'), sub: q('.hero__sub'), btn: q('.btn-hero'), btnPE: getComputedStyle(btn).pointerEvents, btnTab: btn.getAttribute('tabindex'), navBottom: Math.round(nav.bottom), heroH: document.getElementById('top').offsetHeight, poster: Math.round(document.getElementById('poster').getBoundingClientRect().top + document.getElementById('poster').offsetHeight * 0.293) };
    });
    if (f === 0) console.log(w + 'x' + h, 'heroH', st.heroH, 'gap nav→pill', st.pill.top - st.navBottom, 'gap btn→helmet top', st.poster - st.btn.bottom, 'cssScroll', st.css);
    console.log('  ', f, 'pill', st.pill.o, st.pill.ty, '| h1', st.h1.o, st.h1.ty, '| sub', st.sub.o, st.sub.ty, '| btn', st.btn.o, st.btn.ty, st.btn.vis, 'pe', st.btnPE, 'tab', st.btnTab);
    bufs.push(await p.screenshot());
  }
  // назад угору: все повертається
  await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await p.waitForTimeout(600);
  console.log('   back to top:', await p.evaluate(() => ['.pill', '#hero-title', '.hero__sub', '.btn-hero'].map(s => getComputedStyle(document.querySelector(s)).opacity).join(',') + ' tab=' + document.querySelector('.btn-hero').getAttribute('tabindex')), 'errors', errs.length ? errs : 'none');
  const sc = w >= 1300 ? 0.46 : (w === 768 ? 0.5 : 0.8); const W = Math.round(w * sc), H = Math.round(h * sc);
  const rs = await Promise.all(bufs.map(x => sharp(x).resize(W, H).toBuffer()));
  await sharp({ create: { width: W * 3 + 20, height: H, channels: 3, background: '#666' } }).composite(rs.map((x, i) => ({ input: x, left: i * (W + 10), top: 0 }))).png().toFile(`${S}/sc_${eng}_${w}x${h}.png`);
  await ctx.close();
}
await b.close();
