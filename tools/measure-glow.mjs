// Заміри світіння і стрічки числами (OKLab L пікселів скриншота 1440×900) і покриття стрічки при прокрутці.
// Запуск: node measure.mjs <тека для скриншотів>. Потрібен сервер на :8765.
import { chromium } from 'playwright';
import sharp from 'sharp';
const S = process.argv[2];
const okL = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; const R = f(r), G = f(g), B = f(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B), m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B), s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s; };
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
await p.goto('http://localhost:8765/index.html', { waitUntil: 'load' });
await p.waitForFunction('document.getElementById("top").classList.contains("has-helmet")');
await p.waitForTimeout(2500);
console.log('GL renderer:', await p.evaluate(() => { const gl = window.__vizor.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; }));
// Заморожуємо кадр: зупиняємо цикл і рендеримо вручну, щоб знімки «зі світінням» і «без» відрізнялись лише світінням.
const geom = () => p.evaluate(() => { const a = document.getElementById('poster').getBoundingClientRect(), c = document.getElementById('scene').getBoundingClientRect(); return { cx: a.left + a.width / 2, cy: a.top + a.height / 2, side: a.width, canvasTop: c.top, rects: ['.pill', '#hero-title', '.hero__sub', '.btn-hero', '#nav'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [s, r.left, r.top, r.right, r.bottom]; }) }; });
const frame = async (glow, helmet = true, ribbon = true) => { await p.evaluate(([g, h, r]) => { const v = window.__vizor; v.glow.visible = g; v.rig.visible = h; v.ribbon.visible = r; v.renderer.render(v.scene, v.camera); }, [glow, helmet, ribbon]); const { data, info } = await sharp(await p.screenshot()).raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, ch: info.channels }; };
const L = (im, x, y) => { const k = (Math.round(y) * im.w + Math.round(x)) * im.ch; return okL(im.data[k], im.data[k + 1], im.data[k + 2]); };
const avg = (im, x, y, r = 3) => { let s = 0, n = 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { s += L(im, x + dx, y + dy); n++; } return s / n; };
const freeze = () => p.evaluate(() => window.__vizor.hold(true));
const unfreeze = () => p.evaluate(() => window.__vizor.hold(false));

async function analyse(label) {
  await freeze(); await p.waitForTimeout(120);
  const G = await geom();
  const full = await frame(true), noGlow = await frame(false), onlyBg = await frame(false, false, false), noRib = await frame(false, true, false), noHelm = await frame(false, false, true);
  await frame(true); await unfreeze();
  // точка «вільна», якщо там немає ні шолома, ні стрічки, ні тексту/кнопки/меню
  const isObj = (x, y) => Math.abs(L(noGlow, x, y) - L(onlyBg, x, y)) > 0.004;
  const inText = (x, y, pad = 10) => G.rects.some(([, l, t, r, bt]) => x > l - pad && x < r + pad && y > t - pad && y < bt + pad);
  const free = (x, y, pad = 6) => { if (x < 8 || x > 1431 || y < 8 || y > 891 || inText(x, y)) return false; for (let dy = -pad; dy <= pad; dy += 3) for (let dx = -pad; dx <= pad; dx += 3) if (isObj(x + dx, y + dy)) return false; return true; };
  const bgL = avg(full, 60, 300);
  const isHelm = (x, y) => Math.abs(L(noRib, x, y) - L(onlyBg, x, y)) > 0.004;
  const out = { label, G, bgL, full, noGlow, onlyBg, free, isObj, isHelm };
  // 1) центр світіння поруч із шоломом
  const near = [];
  for (let ang = 0; ang < 360; ang += 8) for (const rr of [0.28, 0.34, 0.4, 0.46]) { const x = G.cx + Math.cos(ang * Math.PI / 180) * rr * G.side, y = G.cy + Math.sin(ang * Math.PI / 180) * rr * G.side; if (free(x, y)) near.push({ x: Math.round(x), y: Math.round(y), dL: +(avg(full, x, y) - bgL).toFixed(4) }); }
  near.sort((a, c) => c.dL - a.dL); out.near = near;
  // 2) зовнішня межа
  const far = [];
  for (let ang = 0; ang < 360; ang += 5) for (const rr of [1.1, 1.25]) { const x = G.cx + Math.cos(ang * Math.PI / 180) * rr * G.side, y = G.cy + Math.sin(ang * Math.PI / 180) * rr * G.side; if (free(x, y, 9)) far.push({ x: Math.round(x), y: Math.round(y), ang, dL: +Math.abs(avg(full, x, y) - bgL).toFixed(4) }); }
  far.sort((a, c) => c.dL - a.dL); out.far = far;
  // 3) внесок світіння (кадр зі світінням мінус кадр без нього) в зонах тексту і кнопки
  out.zones = G.rects.slice(0, 4).map(([s, l, t, r, bt]) => { let mx = 0; for (let y = Math.max(0, t - 14); y <= Math.min(899, bt + 14); y += 2) for (let x = Math.max(0, l - 30); x <= Math.min(1439, r + 30); x += 3) mx = Math.max(mx, Math.abs(L(full, x, y) - L(noGlow, x, y))); return [s, +mx.toFixed(4)]; });
  // 4) стрічка: колонки, де вона є (кадр лише зі стрічкою проти порожнього тла)
  const visTop = Math.max(0, Math.round(G.canvasTop)); const cov = [0, 0, 0]; let lm = -1, rm = -1;
  for (let x = 0; x < 1440; x++) { let has = false; for (let y = visTop; y < 900; y += 2) if (Math.abs(L(noHelm, x, y) - L(onlyBg, x, y)) > 0.01) { has = true; break; } if (has) { cov[Math.min(2, Math.floor(x / 480))]++; if (lm < 0) lm = x; rm = x; } }
  out.rib = { lm, rm, cov: cov.map(c => Math.round(c / 480 * 100)) };
  return out;
}

const A = await analyse('0%');
console.log('фон: L =', A.bgL.toFixed(4), '(очікуване для #0A0F14:', okL(10, 15, 20).toFixed(4) + ')');
console.log('ЦЕНТР, поруч із шоломом, поза шоломом і стрічкою (' + A.near.length + ' точок на 0.28–0.46 сторони від центру):');
console.log('   max ΔL =', A.near[0].dL, 'у', A.near[0].x + ',' + A.near[0].y, '| медіана =', A.near[Math.floor(A.near.length / 2)].dL, '| min =', A.near[A.near.length - 1].dL, '| точок із ΔL ≥ 0.08:', A.near.filter(n => n.dL >= 0.08).length);
// Світіння має дві складові: кругла пляма (радіус до 1.0 сторони) і смуга вздовж стрічки (до ±1.5 сторони по горизонталі). Межу плями міряємо на кільці поза смугою, смугу — окремим профілем.
const inBand = (n) => Math.abs(n.y - (A.G.cy + 0.02 * A.G.side)) < 0.5 * A.G.side;
const ring = A.far.filter(n => !inBand(n)), band = A.far.filter(inBand);
console.log('МЕЖА ПЛЯМИ, кільце 1.1–1.25 сторони від центру поза смугою стрічки (' + ring.length + ' точок): max |ΔL| =', ring[0].dL, 'у', ring[0].x + ',' + ring[0].y, '| точок із |ΔL| ≥ 0.005:', ring.filter(n => n.dL >= 0.005).length);
console.log('   те саме кільце в зоні смуги вздовж стрічки (' + band.length + ' точок, тут світіння ще триває за задумом): max |ΔL| =', band.length ? band[0].dL : '-');
const edge = []; for (const x of [6, 14, 1425, 1433]) for (let y = 560; y < 890; y += 6) if (A.free(x, y, 4)) edge.push(+Math.abs(avg(A.full, x, y) - A.bgL).toFixed(4));
console.log('МЕЖА СМУГИ: біля лівого і правого країв екрана поза стрічкою (' + edge.length + ' точок): max |ΔL| =', Math.max(...edge));
console.log('ВНЕСОК СВІТІННЯ в зонах тексту і кнопки (кадр зі світінням − без нього, max |ΔL|):', A.zones.map(z => z.join(' ')).join(' | '));
// гладкість: радіальні профілі поза об'єктами, найбільший стрибок між сусідніми пікселями
let maxStep = 0; const profs = [];
for (const ang of [90, 60, 120, 200, 340]) { const pr = []; let prev = null; for (let rr = 0.2; rr <= 1.3; rr += 1 / A.G.side) { const x = A.G.cx + Math.cos(ang * Math.PI / 180) * rr * A.G.side, y = A.G.cy + Math.sin(ang * Math.PI / 180) * rr * A.G.side; if (!A.free(x, y, 3)) { prev = null; continue; } const v = avg(A.full, x, y, 1) - A.bgL; if (prev !== null) maxStep = Math.max(maxStep, Math.abs(v - prev)); prev = v; if (Math.round(rr * A.G.side) % 45 === 0) pr.push(v.toFixed(3)); } profs.push(ang + '°: ' + pr.join(' ')); }
console.log('радіальні профілі ΔL (крок 45 px, лише вільні точки):\n   ' + profs.join('\n   '));
console.log('найбільший стрибок ΔL між сусідніми пікселями вздовж профілів =', maxStep.toFixed(4));
await sharp(Buffer.from(A.full.data), { raw: { width: 1440, height: 900, channels: A.full.ch } }).png().toFile(`${S}/m_0.png`);

console.log('СТРІЧКА І СВІТІННЯ ПРИ ПРОКРУТЦІ:');
for (const f of [0, 0.25, 0.5]) {
  await p.evaluate((f) => window.scrollTo({ top: Math.round(900 * f), behavior: 'instant' }), f); await p.waitForTimeout(700);
  const R = await analyse(f * 100 + '%');
  // світіння на місці: найбільший внесок світіння в околі шолома поза об'єктами
  let g = 0; for (let ang = 0; ang < 360; ang += 10) for (const r0 of [0.3, 0.36, 0.42]) { const sp = Math.min(1, f / 0.5), rr = r0 * (1 - 0.5 * (1 - (1 - sp) * (1 - sp))); const x = R.G.cx + Math.cos(ang * Math.PI / 180) * rr * R.G.side, y = R.G.cy - 60 * Math.min(1, f / 0.5) + Math.sin(ang * Math.PI / 180) * rr * R.G.side; if (x < 4 || x > 1435 || y < 72 || y > 895 || R.isHelm(x, y)) continue; g = Math.max(g, L(R.full, x, y) - L(R.noGlow, x, y)); }
  const op = await p.evaluate(() => document.getElementById('scene').style.opacity);
  console.log(`   скрол ${f * 100}%: стрічка в колонках ${R.rib.lm}–${R.rib.rm} з 0–1439; покриття третин екрана: ліва ${R.rib.cov[0]}%, центр ${R.rib.cov[1]}%, права ${R.rib.cov[2]}%; opacity canvas ${op}; внесок світіння біля шолома (поза шоломом, зі стрічкою включно) ΔL = ${g.toFixed(3)}`);
  await p.screenshot({ path: `${S}/m_${f * 100}.png` });
}
await b.close();
