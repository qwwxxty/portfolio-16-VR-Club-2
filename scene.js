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
  scene.add(key, rim, warm);
}

/* Завантажує шолом, центрує по bounding box і нормалізує найбільший габарит до 1. */
export async function loadHelmet() {
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
          normal = normalize(mix(normal, normalize(vzGlassN), vzGlass * 0.94));`);
    };
  });
  const pivot = new THREE.Group();
  pivot.add(holder);
  pivot.rotation.set(BASE_ROT.x, BASE_ROT.y, BASE_ROT.z);
  return pivot;
}

/* ---------- Стрічка ---------- */
const RIBBON_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uHalfLen;
  uniform float uHalfW;
  uniform float uCenterY;
  uniform float uXScale;
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec2 vUv2;

  vec3 ribbon(float u, float v) {
    float t = uTime;
    float px = u * uHalfLen;
    float x = px * uXScale; /* на вузьких екранах хвилі частіші */
    /* вісь стрічки */
    float cy = sin(x * 0.52 + t * 0.21) * 0.17 + sin(x * 1.18 - t * 0.15) * 0.06;
    float cz = cos(x * 0.44 + t * 0.18) * 0.40;
    /* скручування навколо осі: стрічка то лягає площиною, то стає майже ребром */
    float th = 0.25 + 0.95 * sin(x * 0.58 - t * 0.19) + 0.30 * sin(x * 1.31 + t * 0.13);
    float w = uHalfW * (1.0 + 0.20 * sin(x * 0.77 + t * 0.11));
    /* складки шовку впоперек */
    float fold = sin(v * 2.6 + x * 1.6 + t * 0.27) * 0.30 + sin(v * 5.0 - x * 1.1 - t * 0.2) * 0.08;
    float a = v * w;
    float b = fold * w;
    return vec3(px, uCenterY + cy + a * cos(th) + b * sin(th), cz + a * sin(th) - b * cos(th));
  }

  void main() {
    float u = position.x;
    float v = position.y;
    vec3 p = ribbon(u, v);
    vec3 du = ribbon(u + 0.004, v) - p;
    vec3 dv = ribbon(u, v + 0.02) - p;
    vNormal = normalize(cross(du, dv));
    vPos = p;
    vUv2 = vec2(u, v);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const RIBBON_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uBg;
  uniform vec3 uSurface;
  uniform vec3 uText;
  uniform vec3 uMuted;
  uniform vec3 uAccent;
  uniform vec3 uAccent2;
  uniform float uFade;
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec2 vUv2;

  /* Уявна «студія», яку відбиває рідкий метал. Усі кольори — з палітри сайту. */
  vec3 studio(vec3 r) {
    float up = r.y * 0.5 + 0.5;
    vec3 c = mix(uSurface * 0.8, uSurface * 1.55, smoothstep(0.0, 0.5, up));
    c = mix(c, uMuted * 0.7, smoothstep(0.5, 1.0, up));
    /* довгі софтбокси: дають дзеркальні смуги, як на полірованому титані */
    float s1 = smoothstep(0.50, 0.98, sin(r.y * 6.0 + sin(r.x * 2.4) * 1.1 + 0.5));
    float s2 = smoothstep(0.80, 1.00, sin(r.y * 11.0 - r.x * 1.9 + 2.4));
    c += uMuted * 0.32 * s1 + uText * (0.5 * s1 * s1 * s1 * s1 + 0.2 * s2 * s1);
    /* два акцентні відблиски: вузькі, тому кольору на екрані небагато */
    float gA = pow(max(dot(r, normalize(vec3(0.78, -0.30, 0.55))), 0.0), 44.0);
    float gB = pow(max(dot(r, normalize(vec3(-0.72, 0.38, 0.58))), 0.0), 32.0);
    c += mix(uAccent, uText, 0.12) * gA * 0.95 + mix(uAccent2, uText, 0.12) * gB * 0.9;
    return c;
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vPos);
    if (dot(n, V) < 0.0) n = -n;
    float ndv = max(dot(n, V), 0.0);
    float fres = pow(1.0 - ndv, 4.0);
    vec3 col = studio(reflect(-V, n));
    /* перламутровий френель по краях складок */
    col += mix(uAccent2, uText, 0.65) * fres * 0.30;
    /* легке затемнення в глибині складок */
    col *= 0.72 + 0.28 * smoothstep(-0.9, 0.6, n.y);

    float edge = smoothstep(1.0, 0.965, abs(vUv2.y));
    float alpha = edge * uFade;
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

export function makeRibbon(pal, mobile) {
  const geo = new THREE.PlaneGeometry(2, 2, mobile ? 110 : 220, mobile ? 20 : 40);
  const mat = new THREE.ShaderMaterial({
    vertexShader: RIBBON_VERT,
    fragmentShader: RIBBON_FRAG,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: true,
    premultipliedAlpha: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uTime: { value: 0 }, uHalfLen: { value: 4 }, uHalfW: { value: 0.5 }, uCenterY: { value: -1.2 }, uXScale: { value: 1 },
      uFade: { value: 1 },
      uBg: { value: pal.bg }, uSurface: { value: pal.surface }, uText: { value: pal.text },
      uMuted: { value: pal.muted }, uAccent: { value: pal.accent }, uAccent2: { value: pal.accent2 },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.position.z = -2.4;
  mesh.renderOrder = -1;
  return mesh;
}

/* ---------- Сцена першого екрана ---------- */
export function initHero({ canvas, hero, anchor, mobile, onFirstFrame, onHelmet, onError }) {
  const pal = readPalette();
  const renderer = makeRenderer(canvas, mobile ? 1.5 : 2);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
  camera.position.set(0, 0, CAM_Z);
  setupLook(renderer, scene, pal);

  const ribbon = makeRibbon(pal, mobile);
  scene.add(ribbon);
  const U = ribbon.material.uniforms;

  const rig = new THREE.Group();
  scene.add(rig);
  let helmet = null;
  let helmetIn = 0;

  const VH = visibleHeight();
  const state = { w: 0, h: 0, baseX: 0, baseY: 0, scale: 1, pitchFix: 0 };

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
    const VW = VH * camera.aspect;

    /* Шолом стає точно на місце постера. */
    const a = anchor.getBoundingClientRect();
    const cx = a.left + a.width / 2 - rect.left;
    const cy = a.top + a.height / 2 - rect.top;
    state.baseX = (cx - w / 2) * unit;
    state.baseY = (h / 2 - cy) * unit;
    state.scale = (a.width * unit) / POSTER_SPAN;
    state.pitchFix = Math.atan2(state.baseY, CAM_Z);

    /* Стрічка: нижня третина, краї за межами екрана. */
    U.uHalfLen.value = VW * 0.5 * 1.45 + 0.6;
    U.uHalfW.value = VH * (mobile ? 0.085 : 0.105);
    U.uCenterY.value = state.baseY - VH * 0.055;
    U.uXScale.value = Math.min(2.2, Math.max(1, 1.5 / camera.aspect));
  }

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  function onPointer(e) {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }
  if (!mobile && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    window.addEventListener('pointermove', onPointer, { passive: true });
  }

  let scrollP = 0;
  function onScroll() {
    scrollP = Math.min(1, Math.max(0, window.scrollY / Math.max(1, state.h)));
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  let running = false, visible = true, raf = 0, first = true;
  const clock = new THREE.Clock();
  let time = 0;

  function frame() {
    raf = 0;
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    time += dt;
    layout();

    const k = 1 - Math.exp(-dt * 4);
    pointer.x += (pointer.tx - pointer.x) * k;
    pointer.y += (pointer.ty - pointer.y) * k;

    U.uTime.value = time;
    const s = scrollP * scrollP * (3 - 2 * scrollP);
    ribbon.position.y = -s * 0.5;
    U.uFade.value = 1 - Math.min(1, Math.max(0, (scrollP - 0.45) / 0.5));

    if (helmet) {
      helmetIn = Math.min(1, helmetIn + dt * 0.8);
      const ease = helmetIn * helmetIn * (3 - 2 * helmetIn);
      const sc = state.scale * (1 - s * 0.45);
      rig.scale.setScalar(sc);
      rig.position.set(
        state.baseX,
        state.baseY + Math.sin(time * 0.9) * 0.035 * ease * state.scale + s * 0.9,
        -s * 5,
      );
      /* Покачування + кілька градусів за курсором + поворот при прокрутці. */
      helmet.rotation.x = BASE_ROT.x + state.pitchFix + Math.sin(time * 0.6) * 0.03 * ease + pointer.y * 0.07 + s * 0.35;
      helmet.rotation.y = BASE_ROT.y + Math.sin(time * 0.45) * 0.06 * ease + pointer.x * 0.1 + s * 1.5;
      helmet.rotation.z = BASE_ROT.z + Math.sin(time * 0.7 + 1.0) * 0.015 * ease;
    }
    canvas.style.opacity = String(1 - Math.min(1, Math.max(0, (scrollP - 0.55) / 0.4)));

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
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); onError && onError(new Error('context lost')); });

  onScroll();
  update();

  loadHelmet().then((pivot) => {
    helmet = pivot;
    rig.add(pivot);
    layout();
    /* Один кадр, щоб шейдери шолома скомпілювались до того, як сховаємо постер. */
    requestAnimationFrame(() => requestAnimationFrame(() => onHelmet && onHelmet()));
  }).catch((err) => onError && onError(err));

  return {
    renderer, scene, camera, ribbon, rig,
    get running() { return running; },
    /* Для інструментів (tools/): нерухомий кадр без анімації. */
    still({ showHelmet = true, showRibbon = true, t = 0 } = {}) {
      running = false; if (raf) { cancelAnimationFrame(raf); raf = 0; }
      state.w = 0; layout();
      U.uTime.value = t; U.uFade.value = 1;
      ribbon.visible = showRibbon; rig.visible = showHelmet;
      if (helmet) {
        rig.scale.setScalar(state.scale); rig.position.set(state.baseX, state.baseY, 0);
        helmet.rotation.set(BASE_ROT.x + state.pitchFix, BASE_ROT.y, BASE_ROT.z);
      }
      renderer.render(scene, camera);
    },
  };
}
