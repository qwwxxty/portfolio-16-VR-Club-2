// Перевірка палітри: OKLCH -> HEX і контраст WCAG. Запуск: node tools/contrast.mjs
const pal = {
  bg:      [0.165, 0.014, 250],
  surface: [0.225, 0.020, 250],
  text:    [0.955, 0.008, 250],
  muted:   [0.740, 0.022, 250],
  accent:  [0.720, 0.165, 52],
  accent2: [0.760, 0.115, 232],
};
function oklch2rgb([L, C, h]) {
  const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}
const gam = v => v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
const hex = lin => '#' + lin.map(v => Math.round(Math.min(1, Math.max(0, gam(v))) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const unhex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = h => { const [r, g, b] = unhex(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const H = {};
for (const k in pal) { const lin = oklch2rgb(pal[k]); H[k] = hex(lin); console.log(`--${k}: ${H[k]}  oklch(${pal[k].join(' ')})${lin.some(v => v < -0.001 || v > 1.001) ? '  [поза sRGB, обрізано]' : ''}`); }
const pairs = [
  ['text', 'bg', 4.5], ['text', 'surface', 4.5], ['muted', 'bg', 4.5], ['muted', 'surface', 4.5],
  ['accent', 'bg', 3], ['accent', 'surface', 3], ['accent2', 'bg', 4.5], ['accent2', 'surface', 4.5],
  ['bg', 'accent', 4.5], ['bg', 'text', 4.5], ['bg', 'accent2', 4.5],
  // Помаранчевий кружок на світлій кнопці — декоративний фон іконки; стрілка в ньому темна (bg на accent).
];
for (const [f, b, min] of pairs) { const r = cr(H[f], H[b]); console.log(`${f.padEnd(8)} на ${b.padEnd(8)} ${r.toFixed(2)}:1  поріг ${min}  ${r >= min ? 'OK' : 'FAIL'}`); }
