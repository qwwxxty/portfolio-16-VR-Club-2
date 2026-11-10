/* VIZOR — 3D-сцена першого екрана: шолом (GLB) + шейдерна стрічка в одному canvas.
   Модуль вантажиться динамічно зі script.js уже після першої відрисовки тексту й постера. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const HELMET_URL = new URL('./assets/models/helmet.glb', import.meta.url).href;
export const FOV = 22;
export const CAM_Z = 10;
/* Базовий ракурс шолома. Той самий ракурс у постері (tools/poster.html). */
export const BASE_ROT = { x: 0.1, y: -0.5, z: -0.03 };
/* Постер — квадрат зі стороною POSTER_SPAN одиниць сцени; шолом нормалізовано до 1. */
export const POSTER_SPAN = 1.42;

export function visibleHeight() {
  return 2 * CAM_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
}

export function readPalette() {
  const css = getComputedStyle(document.documentElement);
  const get = (name) => new THREE.Color(css.getPropertyValue(name).trim());
  return {
    bg: get('--bg'), surface: get('--surface'), text: get('--text'),
    muted: get('--muted'), accent: get('--accent'), accent2: get('--accent-2'),
  };
}

export function makeRenderer(canvas, dprCap) {
  const renderer = new THREE.WebGLRenderer({
    canvas, alpha: true, antialias: true, powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

/* Оточення для відбиттів і світло в кольорах палітри. */
export function setupLook(renderer, scene, pal) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  /* М'які світлові панелі в кольорах палітри: саме їх відбиває візор. */
  const panel = (color, power, w, h, pos) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(power), side: THREE.DoubleSide }),
    );
    m.position.set(pos[0], pos[1], pos[2]);
    m.lookAt(0, 0.5, 0);
    room.add(m);
  };
  panel(pal.text, 9, 7, 2.2, [0, 6.2, 5]);
  panel(pal.accent2, 14, 2.2, 6, [-7, 1.5, 3.5]);
  panel(pal.accent, 10, 2.4, 2.4, [6.5, -2.2, 4.5]);
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();

  const key = new THREE.DirectionalLight(pal.text, 1.6);
  key.position.set(2.5, 4, 6);
  const rim = new THREE.DirectionalLight(pal.accent2, 2.4);
  rim.position.set(-5, 1.5, -3);
  const warm = new THREE.PointLight(pal.accent, 7, 9, 2);
  warm.position.set(1.8, -1.6, 1.6);
  /* контровий: ззаду-згори, обводить краї шолома і стрічки */
  const back = new THREE.DirectionalLight(pal.text.clone().lerp(pal.accent2, 0.35), 3.2);
  back.position.set(1.5, 6, -7);
  scene.add(key, rim, warm, back);
}

/* Завантажує шолом, центрує по bounding box і нормалізує найбільший габарит до 1. */
export async function loadHelmet(pal = readPalette()) {
  const rimCol = pal.text.clone().lerp(pal.accent2, 0.4);
  const rimGlsl = `vec3(${rimCol.r.toFixed(4)}, ${rimCol.g.toFixed(4)}, ${rimCol.b.toFixed(4)})`;
  const gltf = await new GLTFLoader().loadAsync(HELMET_URL);
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);
  const holder = new THREE.Group();
  holder.add(model);
  holder.scale.setScalar(1 / Math.max(size.x, size.y, size.z));
  model.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    m.envMapIntensity = 1.15;
    m.side = THREE.FrontSide;
    if (m.normalScale) m.normalScale.setScalar(0.55);
    /* Текстурний атлас моделі дрібно порізаний: без mip-рівнів сусідні острівці не «протікають». */
    [m.map, m.normalMap, m.roughnessMap, m.metalnessMap].forEach((t) => {
      if (!t) return;
      t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
    });
    /* У моделі один матеріал на все. Найтемніші ділянки базового кольору — це скло візора:
       робимо їх гладким тонованим дзеркалом, щоб візор відбивав оточення. */
    m.onBeforeCompile = (shader) => {
      /* Нормаль скла рахуємо аналітично (плавно вигнута поверхня), бо сітка моделі нерівна
         і дзеркало показувало б кожну грань. */
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vzGlassN;\nvarying float vzFront;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vzGlassN = normalize(normalMatrix * normalize(vec3(position.x * 0.85, position.y * 0.55, 1.0)));
          vzFront = position.z;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vzGlassN;\nvarying float vzFront;')
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          float vzLum = dot(diffuseColor.rgb, vec3(0.3333));
          float vzGlass = (1.0 - smoothstep(0.012, 0.035, vzLum)) * smoothstep(0.05, 0.2, vzFront);
          roughnessFactor = mix(roughnessFactor, 0.12, vzGlass);`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
          metalnessFactor = mix(metalnessFactor, 1.0, vzGlass);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.38, 0.42, 0.47), vzGlass);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          normal = normalize(mix(normal, normalize(vzGlassN), vzGlass * 0.94));`)
        /* тонкий світлий контур по краях, сильніший згори: шолом відділяється від тла */
        .replace('#include <opaque_fragment>', `
          float vzRim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 6.0);
          vzRim *= smoothstep(-0.4, 0.55, normal.y);
          outgoingLight += ${rimGlsl} * vzRim * 0.45;
          #include <opaque_fragment>`);
    };
  });
  const pivot = new THREE.Group();
  pivot.add(holder);
  pivot.rotation.set(BASE_ROT.x, BASE_ROT.y, BASE_ROT.z);
  return pivot;
}

/* ---------- Стрічка ---------- */
/* Стрічка лежить далі від камери, шолом ближче: по глибині вони не перетинаються ніколи. */
const RIBBON_Z = -3;
const HELMET_Z = 0.8;
const CYCLE = 10; /* секунд на повний цикл «дихання» стрічки */
const W = (Math.PI * 2) / CYCLE;

/* Справжня стрічка: смуга змінної ширини вздовж CatmullRom-кривої зі скручуванням ~1.4 оберта.
   Координати задаємо в площині екрана (z = 0), а меш відсуваємо вглиб і збільшуємо на стільки ж. */
export function makeRibbon(pal, mobile) {
  const SU = mobile ? 160 : 280;
  const SV = mobile ? 8 : 14;
  const count = (SU + 1) * (SV + 1);
  const pos = new Float32Array(count * 3);
  const idx = [];
  for (let i = 0; i < SU; i++) for (let j = 0; j < SV; j++) {
    const a = i * (SV + 1) + j, b = a + SV + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(idx);

  const front = pal.text.clone().lerp(pal.muted, 0.5);                       /* перламутровий титан */
  const backCol = pal.muted.clone().lerp(pal.accent2, 0.22).multiplyScalar(0.8); /* зворотний бік холодніший */
  const rimCol = pal.text.clone().lerp(pal.accent2, 0.55);
  const shadow = { value: new THREE.Vector4(0, 0, 1, 1) };
  const shadowK = { value: 0 };
  const inner = { value: new THREE.Vector4(0, 0, 1, 0) };
  const innerCol = glowColor();
  const mat = new THREE.MeshPhysicalMaterial({
    color: front, metalness: 0.92, roughness: 0.22,
    clearcoat: 1, clearcoatRoughness: 0.18, envMapIntensity: 1.0,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uShadow = shadow;
    shader.uniforms.uShadowK = shadowK;
    shader.uniforms.uInner = inner;
    shader.uniforms.uInnerCol = { value: innerCol };
    shader.uniforms.uBack = { value: backCol };
    shader.uniforms.uRim = { value: rimCol };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vzXY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvzXY = position.xy;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vzXY;\nuniform vec4 uShadow;\nuniform float uShadowK;\nuniform vec3 uBack;\nuniform vec3 uRim;\nuniform vec4 uInner;\nuniform vec3 uInnerCol;')
      .replace('#include <color_fragment>', '#include <color_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb = uBack;')
      .replace('#include <opaque_fragment>', `
        /* френель: тонке холодне світіння на згинах і краях, щоб силует читався на темному */
        float vzF = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 3.0);
        outgoingLight += uRim * vzF * 0.42;
        /* м'яка тінь від шолома на стрічці за ним */
        vec2 vzD = (vzXY - uShadow.xy) / uShadow.zw;
        outgoingLight *= 1.0 - uShadowK * exp(-dot(vzD, vzD));
        /* світіння зсередини біля шолома: згасає за Гаусом уздовж стрічки */
        vec2 vzG = (vzXY - uInner.xy) / uInner.z;
        outgoingLight += uInnerCol * uInner.w * exp(-dot(vzG, vzG) * 2.2);
        #include <opaque_fragment>`);
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const depthScale = (CAM_Z - RIBBON_Z) / CAM_Z;
  mesh.position.z = RIBBON_Z;
  mesh.scale.setScalar(depthScale);

  const ctrl = Array.from({ length: 7 }, () => new THREE.Vector3());
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
  const P = Array.from({ length: SU + 1 }, () => new THREE.Vector3());
  let maxZ = 0;

  /* L: { VW, VH, hx, hy, side, top } — розміри екрана, центр і сторона шолома, верхня межа (низ кнопки). */
  function update(t, L) {
    const { VW, VH, hx, hy, side, top } = L;
    const yb = -VH / 2;
    const X = Math.max(VW / 2, 0.8 * side);
    const W0 = Math.min(0.062 * VH, 0.2 * side);
    const yRight = yb + VH / 6; /* середина нижньої третини */
    /* пік за шоломом не вище за низ кнопки (з запасом на ширину і хвилю) */
    const aMid = 0.012 * VH;
    const yPeak = Math.min(hy + 0.02 * side, top - aMid - W0 * 1.2);
    const A = 0.03 * VH;
    const s1 = Math.sin(W * t), c1 = Math.cos(W * t), s2 = Math.sin(W * t + 2.1), c2 = Math.cos(W * t + 1.2);
    ctrl[0].set(hx - X - 1.2, yb - 0.45, -0.2);
    ctrl[1].set(hx - X * 0.8, yb + 0.02 * VH + A * 0.7 * s1, 0.25 * c1);
    ctrl[2].set(hx - X * 0.4, yPeak - 0.27 * side + A * s2, -0.15 + 0.2 * s1);
    ctrl[3].set(hx + X * 0.04, yPeak + aMid * c2, -0.25);
    ctrl[4].set(hx + X * 0.46, Math.min(yPeak - 0.1 * side, yRight + 0.09 * VH) + A * c1, 0.2 * s2);
    ctrl[5].set(hx + X * 0.85, yRight + A * 0.8 * s2, 0.25 - 0.15 * c2);
    ctrl[6].set(hx + X + 1.2, yRight + 0.04 * VH, 0);
    curve.updateArcLengths();

    for (let i = 0; i <= SU; i++) curve.getPoint(i / SU, P[i]);
    maxZ = -Infinity;
    let k = 0;
    for (let i = 0; i <= SU; i++) {
      const u = i / SU;
      const p = P[i], pa = P[Math.max(0, i - 1)], pb = P[Math.min(SU, i + 1)];
      /* дотична і базис: B лежить у площині екрана, N дивиться на камеру */
      let tx = pb.x - pa.x, ty = pb.y - pa.y, tz = pb.z - pa.z;
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let bx = -ty, by = tx, bz = 0;
      const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
      const nx = ty * bz - tz * by, ny = tz * bx - tx * bz, nz = tx * by - ty * bx;
      /* скручування: ~1.4 оберта на всю довжину, за шоломом стрічка лежить площиною; плюс «дихання» */
      const ang = 0.3 + Math.PI * 2 * 1.4 * (u - 0.5) + 0.24 * Math.sin(W * t + u * 4.0);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const wx = ca * bx + sa * nx, wy = ca * by + sa * ny, wz = ca * bz + sa * nz;
      const ox = -sa * bx + ca * nx, oy = -sa * by + ca * ny, oz = -sa * bz + ca * nz;
      const hw = W0 * (0.6 + 0.5 * Math.sin(Math.PI * u)) * (1 + 0.1 * Math.sin(u * 9 + W * t));
      for (let j = 0; j <= SV; j++) {
        const v = (j / SV) * 2 - 1;
        const a = v * hw;
        const b = (v * v - 0.5) * 0.32 * hw; /* жолоб упоперек: складка, бліки тягнуться вздовж */
        const z = p.z + a * wz + b * oz;
        pos[k++] = p.x + a * wx + b * ox;
        pos[k++] = p.y + a * wy + b * oy;
        pos[k++] = z;
        if (z > maxZ) maxZ = z;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }

  return {
    mesh, update,
    setShadow(x, y, rx, ry, k) { shadow.value.set(x, y, rx, ry); shadowK.value = k; },
    maxWorldZ() { return RIBBON_Z + maxZ * depthScale; },
    /* центр стрічки за шоломом (площина екрана) */
    mid() { return ctrl[3]; },
    /* стрічка біля шолома світиться зсередини: x, y центру, радіус, сила */
    setGlow(x, y, r, k) { inner.value.set(x, y, r, k); },
  };
}

/* Світіння за шоломом: один шейдерний квад зі звичайним (не аддитивним) змішуванням, без постобробки.
   Дві складові: кругла пляма за шоломом і витягнута вздовж стрічки, у 1.5 раза слабша.
   Альфа спадає за Гаусом і доходить до нуля задовго до краю квада, тож межі не видно ніде.
   Зверху світіння гаситься біля низу кнопки: кнопка й текст лишаються на чистому тлі. */
const GLOW_Z = -1.5;
const GLOW_PEAK = 0.44;            /* непрозорість у центрі плями за шоломом */
const GLOW_BAND = GLOW_PEAK / 1.5; /* вздовж стрічки */
const GLOW_W = 4.2, GLOW_H = 2.4;  /* розмір квада в сторонах постера шолома */
export function glowColor() {
  const css = getComputedStyle(document.documentElement);
  return new THREE.Color(css.getPropertyValue('--glow').trim());
}
function makeGlow(pal) {
  const col = glowColor(); /* світлий холодний відтінок акценту, oklch(0.70 0.10 235) */
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uCol: { value: col.clone().convertLinearToSRGB() },
      uK: { value: 1 }, uTop: { value: 10 }, uFade: { value: 1 }, uUp: { value: 1 },
      uBand: { value: new THREE.Vector3(0, 0, 0.1) }, /* зсув центру смуги (у сторонах шолома) і її нахил */
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying float vY;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vY = wp.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uCol; uniform vec3 uBand;
      uniform float uK; uniform float uTop; uniform float uFade; uniform float uUp;
      varying vec2 vUv; varying float vY;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        /* координати в сторонах постера шолома, центр — шолом */
        vec2 d = (vUv - 0.5) * vec2(${GLOW_W.toFixed(1)}, ${GLOW_H.toFixed(1)});
        /* угору (до кнопки) Гаус стиснутий так, щоб сам дійти до нуля біля низу кнопки: без «полички» */
        d.y *= mix(1.0, uUp, smoothstep(-0.2, 0.2, d.y));
        float r = length(d);
        /* пляма за шоломом: Гаус, рівно нуль на радіусі 1.0 */
        float g1 = exp(-r * r / 0.19) * smoothstep(1.0, 0.55, r);
        /* смуга вздовж стрічки: вузький Гаус упоперек, довгий уздовж */
        vec2 e = d - uBand.xy;
        float cs = cos(uBand.z), sn = sin(uBand.z);
        e = vec2(cs * e.x + sn * e.y, -sn * e.x + cs * e.y);
        float g2 = exp(-(e.x * e.x / 0.62 + e.y * e.y / 0.045)) * smoothstep(1.5, 0.8, abs(e.x)) * smoothstep(0.75, 0.35, abs(e.y));
        float a = ${GLOW_PEAK.toFixed(3)} * g1 + ${GLOW_BAND.toFixed(3)} * g2 * (1.0 - 0.6 * g1);
        a *= uK * smoothstep(uTop, uTop - uFade, vY);
        a = clamp(a + (hash(gl_FragCoord.xy) - 0.5) / 255.0 * step(0.002, a), 0.0, 1.0); /* дизеринг проти смуг */
        gl_FragColor = vec4(uCol * a, a);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  const group = new THREE.Group();
  group.add(mesh);
  /* справжнє світло від ореолу: підсвічує стрічку за шоломом */
  const light = new THREE.PointLight(col, 2.4, 7, 2);
  group.add(light);
  const f = (CAM_Z - GLOW_Z) / CAM_Z;

  /* cx, cy — центр шолома в площині екрана; top — низ кнопки; k — сила (0..1); bx, by — центр стрічки за шоломом */
  function place(cx, cy, side, shrink, t, px, py, k, top, bx, by) {
    const gx = cx - px * 0.03 * side, gy = cy - 0.06 * side + py * 0.02 * side;
    mesh.position.set(gx * f, gy * f, GLOW_Z);
    mesh.scale.set(GLOW_W * side * f * shrink, GLOW_H * side * f * shrink, 1);
    mat.uniforms.uK.value = k * (1 + 0.05 * Math.sin(W * t));
    mat.uniforms.uTop.value = top * f;
    mat.uniforms.uFade.value = 0.1 * side * f; /* запобіжник; основне згасання дає стиснутий Гаус */
    mat.uniforms.uUp.value = Math.max(1, 0.9 / Math.max(0.05, (top - gy) / (side * shrink)));
    mat.uniforms.uBand.value.set((bx - gx) / side, (by - gy) / side, -0.06);
    light.position.set(cx * 1.12, (cy + 0.1 * side) * 1.12, -1.2);
    light.intensity = 2.4 * k * side * side / 3.2;
  }
  return { group, place, color: col };
}

/* ---------- Сцена першого екрана ---------- */
export function initHero({ canvas, hero, anchor, limitEl, mobile, onFirstFrame, onHelmet, onError, onContextLost }) {
  const pal = readPalette();
  const renderer = makeRenderer(canvas, mobile ? 1.5 : 2);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
  camera.position.set(0, 0, CAM_Z);
  setupLook(renderer, scene, pal);

  const ribbon = makeRibbon(pal, mobile);
  scene.add(ribbon.mesh);
  const glow = makeGlow(pal);
  scene.add(glow.group);

  const rig = new THREE.Group();
  scene.add(rig);
  let helmet = null;
  let helmetIn = 0;

  const VH = visibleHeight();
  const NEAR = (CAM_Z - HELMET_Z) / CAM_Z;  /* шолом ближче до камери: компенсуємо перспективу */
  const state = { w: 0, h: 0, baseX: 0, baseY: 0, scale: 1, pitchFix: 0, side: 1, unit: 0.004 };
  const L = { VW: 1, VH, hx: 0, hy: 0, side: 1, top: 0, glowTop: 0 };

  function layout() {
    const rect = hero.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w === state.w && h === state.h) return;
    state.w = w; state.h = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const unit = VH / h; // одиниць сцени в одному CSS-пікселі
    state.unit = unit;

    /* Шолом стає точно на місце постера. */
    const a = anchor.getBoundingClientRect();
    const cx = a.left + a.width / 2 - rect.left;
    const cy = a.top + a.height / 2 - rect.top;
    state.side = a.width * unit;
    state.baseX = (cx - w / 2) * unit;
    state.baseY = (h / 2 - cy) * unit;
    state.scale = state.side / POSTER_SPAN;
    state.pitchFix = Math.atan2(state.baseY, CAM_Z);

    /* Стрічка не заходить під кнопку й текст: верхня межа — низ кнопки мінус 3.5 % висоти. */
    /* позицію кнопки беремо з розмітки, без урахування її анімації при прокрутці */
    const limBottom = limitEl.offsetTop + limitEl.offsetHeight + (limitEl.offsetParent ? limitEl.offsetParent.offsetTop : 0);
    L.VW = VH * camera.aspect;
    L.hx = state.baseX; L.hy = state.baseY; L.side = state.side;
    L.top = (h / 2 - limBottom) * unit - 0.035 * VH;
    L.glowTop = (h / 2 - limBottom) * unit - 0.008 * VH;
  }

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  function onPointer(e) {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }
  if (!mobile && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    window.addEventListener('pointermove', onPointer, { passive: true });
  }

  /* Прогрес прокрутки рахуємо в кожному кадрі з актуальної висоти першого екрана.
     Раніше він рахувався один раз до першого layout() і без події scroll лишався рівним 1:
     після оновлення сторінки не з самого верху сцена ставала прозорою. */
  let scrollP = 0;
  function readScroll() {
    scrollP = state.h > 1 ? Math.min(1, Math.max(0, window.scrollY / state.h)) : 0;
  }

  let running = false, visible = true, raf = 0, first = true;
  const clock = new THREE.Clock();
  let time = 0;

  /* Розставляє все для моменту t; lift — наскільки шолом піднявся над базовою точкою. */
  function place(t, s, ease, px, py) {
    ribbon.update(t, L);
    /* Стрічка при прокрутці не зсувається: раніше вона йшла вниз, і її лівий нижній кінець
       виходив за нижню межу canvas. Тепер це один об'єкт, який цілком гасне разом зі сценою. */

    const bob = Math.sin(t * 0.9) * 0.035 * ease * state.scale;
    /* шолом піднімається рівно на ті самі 60 px, що й текст: вони йдуть разом і не наїжджають одне на одного */
    const lift = bob + s * 60 * state.unit;
    const shrink = 1 - s * 0.5;
    if (helmet) {
      /* Шолом не йде вглиб крізь стрічку: він зменшується й піднімається, лишаючись перед нею. */
      rig.scale.setScalar(state.scale * NEAR * shrink);
      rig.position.set(state.baseX * NEAR, (state.baseY + lift) * NEAR, HELMET_Z);
      /* Покачування + кілька градусів за курсором + поворот при прокрутці. */
      helmet.rotation.x = BASE_ROT.x + state.pitchFix + Math.sin(t * 0.6) * 0.03 * ease + py * 0.06 + s * 0.18;
      helmet.rotation.y = BASE_ROT.y + Math.sin(t * 0.45) * 0.06 * ease + px * 0.1 - s * 0.35;
      helmet.rotation.z = BASE_ROT.z + Math.sin(t * 0.7 + 1.0) * 0.015 * ease;
    }
    /* Світіння за шоломом їде разом із ним і гасне при прокрутці. */
    const mid = ribbon.mid();
    /* при прокрутці світіння лишається з шоломом (трохи слабшає) і гасне разом з усією сценою */
    const gk = 1 - 0.35 * s;
    glow.place(state.baseX, state.baseY + lift, state.side, shrink, t, px, py, gk, L.glowTop, mid.x, mid.y);
    ribbon.setGlow(state.baseX, mid.y, 0.95 * state.side, 0.3 * gk);
    /* Тінь на стрічці за шоломом: слабшає, коли шолом іде вгору. */
    ribbon.setShadow(state.baseX + 0.03 * state.side, state.baseY + lift - 0.1 * state.side + s * 0.8,
      0.36 * state.side, 0.22 * state.side, 0.4 * (helmet ? 1 : 0.6) * (1 - s));
  }

  let held = false; /* для інструментів: кадр завмирає, цикл живий */
  function frame() {
    raf = 0;
    if (!running) return;
    if (held) { clock.getDelta(); raf = requestAnimationFrame(frame); return; }
    const dt = Math.min(clock.getDelta(), 0.05);
    time += dt;
    layout();
    readScroll();

    const k = 1 - Math.exp(-dt * 4);
    pointer.x += (pointer.tx - pointer.x) * k;
    pointer.y += (pointer.ty - pointer.y) * k;
    if (helmet) helmetIn = Math.min(1, helmetIn + dt * 0.8);
    const ease = helmetIn * helmetIn * (3 - 2 * helmetIn);
    /* Той самий відрізок і те саме пом'якшення (ease-out), що й у тексту: шолом відходить, поки текст зникає. */
    const sp = Math.min(1, scrollP / 0.5);
    const s = 1 - (1 - sp) * (1 - sp);
    place(time, s, ease, pointer.x, pointer.y);
    canvas.style.opacity = String(1 - Math.min(1, Math.max(0, (scrollP - 0.5) / 0.4)));

    renderer.render(scene, camera);
    if (first) { first = false; onFirstFrame && onFirstFrame(); }
    raf = requestAnimationFrame(frame);
  }

  function update() {
    const should = visible && !document.hidden;
    if (should && !running) {
      running = true; clock.getDelta();
      if (!raf) raf = requestAnimationFrame(frame);
    } else if (!should && running) {
      running = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }
  }

  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    update();
  }, { threshold: 0.02 }).observe(hero);
  document.addEventListener('visibilitychange', update);
  /* Якщо браузер забрав WebGL-контекст (сон, нестача пам'яті GPU), не лишаємо порожнє місце: повертаємо постер. */
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); running = false; if (raf) { cancelAnimationFrame(raf); raf = 0; }
    onContextLost && onContextLost();
  });

  update();

  loadHelmet(pal).then((pivot) => {
    helmet = pivot;
    rig.add(pivot);
    state.w = 0; layout();
    /* Два кадри, щоб шейдери шолома скомпілювались до того, як сховаємо постер. */
    requestAnimationFrame(() => requestAnimationFrame(() => onHelmet && onHelmet()));
  }).catch((err) => onError && onError(err));

  return {
    renderer, scene, camera, rig, glow: glow.group, ribbon: ribbon.mesh,
    get running() { return running; },
    get time() { return time; },
    /* Для інструментів (tools/): заморозити поточний кадр, не зупиняючи цикл. */
    hold(on) { held = !!on; },
    /* Запас по глибині між найближчою точкою стрічки і найдальшою точкою шолома (одиниці сцени). */
    depthGap() { return (HELMET_Z - 0.75 * state.scale * NEAR) - ribbon.maxWorldZ(); },
    /* Для інструментів (tools/): нерухомий кадр без анімації. */
    still({ showHelmet = true, showRibbon = true, t = 0 } = {}) {
      running = false; if (raf) { cancelAnimationFrame(raf); raf = 0; }
      state.w = 0; layout();
      place(t, 0, 0, 0, 0);
      canvas.style.opacity = '1';
      ribbon.mesh.visible = showRibbon; rig.visible = showHelmet; glow.group.visible = showHelmet;
      renderer.render(scene, camera);
    },
  };
}
