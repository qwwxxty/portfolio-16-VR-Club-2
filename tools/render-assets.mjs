// Генерує постер шолома, статичну стрічку та OG-картинку з живої сцени.
// Потрібні: npm i playwright sharp; локальний сервер у корені сайту (python3 -m http.server 8765).
// Запуск: node render-assets.mjs <шлях до кореня сайту>
import { chromium } from 'playwright';
import sharp from 'sharp';
const root = process.argv[2]; const base = 'http://localhost:8765';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const buf = (d) => Buffer.from(d.split(',')[1], 'base64');

// 1. Постер: шолом на прозорому тлі, той самий ракурс, що в сцені
let p = await b.newPage({ viewport: { width: 1200, height: 1200 } });
await p.goto(base + '/tools/poster.html'); await p.waitForFunction('window.__done');
await sharp(buf(await p.evaluate('window.__png'))).resize(900, 900).webp({ quality: 84, alphaQuality: 90 }).toFile(root + '/assets/img/helmet-poster.webp');
await p.close();

// 2. Статична стрічка (для reduced motion / без WebGL / до старту сцени)
const ctx = await b.newContext({ viewport: { width: 2400, height: 900 }, deviceScaleFactor: 4 / 3 });
p = await ctx.newPage();
await p.goto(base + '/index.html', { waitUntil: 'load' });
await p.waitForFunction('window.__vizor && document.getElementById("top").classList.contains("has-helmet")');
const png = await p.evaluate(() => { window.__vizor.still({ showHelmet: false }); return document.getElementById('scene').toDataURL('image/png'); });
const img = sharp(buf(png)); const m = await img.metadata();
const top = Math.round(m.height * 0.45);
await img.extract({ left: 0, top, width: m.width, height: m.height - top }).resize(3200, 660, { fit: 'fill' }).webp({ quality: 78, alphaQuality: 85 }).toFile(root + '/assets/img/ribbon-static.webp');
await ctx.close();

// 3. OG-картинка 1200×630 з першого екрана
p = await b.newPage({ viewport: { width: 1600, height: 840 } });
await p.goto(base + '/index.html', { waitUntil: 'load' });
await p.waitForFunction('document.getElementById("top").classList.contains("has-helmet")');
await p.waitForTimeout(1500);
await sharp(await p.screenshot()).resize(1200, 630).jpeg({ quality: 84, mozjpeg: true }).toFile(root + '/assets/img/og-cover.jpg');
await b.close();
console.log('ok');
