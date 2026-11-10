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
/* Габарити шолома всередині квадрата постера (частки сторони, від центру). Виміряно по постеру. */
const HELM_HALF_W = 0.38;
const HELM_BOTTOM = 0.245;
/* Стрічка лежить далі від камери, шолом ближче: по глибині вони не перетинаються ніколи. */
const RIBBON_Z = -3;
const HELMET_Z = 0.8;

const RIBBON_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uHalfLen;
  uniform float uHalfW;
  uniform float uCenterY;
  uniform float uXScale;
  uniform float uHelmX;   /* де висить шолом */
  uniform float uClear;   /* півширина спокійної зони під шоломом */
  uniform float uSpread;  /* довжина переходу від спокійної зони до «крил» */
  uniform float uRise;    /* наскільки крила піднімаються */
  uniform float uAmpIn;   /* амплітуда хвилі під шоломом (обмежена) */
  uniform float uAmpOut;  /* амплітуда хвилі на крилах */
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec2 vUv2;
  varying float vPx;

  vec3 ribbon(float u, float v) {
    float t = uTime;
    float px = u * uHalfLen;
    /* e = 0 під шоломом, 1 на крилах */
    float e = smoothstep(uClear, uClear + uSpread, abs(px - uHelmX));
    float x = px * uXScale;
    float wave = sin(x * 0.62 + t * 0.22) * 0.7 + sin(x * 1.3 - t * 0.16) * 0.3; /* у межах [-1, 1] */
    float cy = uCenterY + uRise * e + wave * mix(uAmpIn, uAmpOut, e);
    float cz = cos(x * 0.5 + t * 0.18) * 0.25 * e;
    /* скручування: під шоломом стрічка лежить площиною до камери, на крилах перевертається */
    float thFree = 0.4 + x * 0.55 + t * 0.08 + 0.6 * sin(x * 0.9 - t * 0.2);
    float thIn = -0.55 + 0.1 * sin(t * 0.3 + x);
    float th = mix(thIn, thFree, e);
    float w = uHalfW * (1.0 + 1.3 * e + 0.1 * sin(x * 0.8 + t * 0.11));
    float a = v * w;
    float b = (v * v - 0.5) * 0.55 * w; /* легкий жолоб упоперек: бліки тягнуться вздовж стрічки */
    return vec3(px, cy + a * cos(th) + b * sin(th), cz + a * sin(th) - b * cos(th));
  }

  void main() {
    float u = position.x;
    float v = position.y;
    vec3 p = ribbon(u, v);
    vec3 du = ribbon(u + 0.003, v) - p;
    vec3 dv = ribbon(u, v + 0.02) - p;
    vNormal = normalize(cross(du, dv));
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vPos = wp.xyz;
    vUv2 = vec2(u, v);
    vPx = p.x;
    gl_Position = projectionMatrix * viewMatrix * wp;
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
  uniform vec3 uShadow; /* x центру, півширина, сила */
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec2 vUv2;
  varying float vPx;

  /* Уявна «студія», яку відбиває рідкий метал. Усі кольори — з палітри сайту. */
  vec3 studio(vec3 r) {
    float up = r.y * 0.5 + 0.5;
    vec3 c = mix(uSurface * 0.75, uSurface * 1.7, smoothstep(0.0, 0.5, up));
    c = mix(c, uMuted * 0.8, smoothstep(0.45, 1.0, up));
    /* довгі софтбокси: дзеркальні смуги вздовж стрічки */
    float s1 = smoothstep(0.35, 0.98, sin(r.y * 4.6 + r.z * 1.4 + 0.4));
    float s2 = smoothstep(0.75, 1.00, sin(r.y * 9.0 + r.z * 2.0 + 2.2));
    c += uMuted * 0.30 * s1 + uText * (0.55 * s1 * s1 * s1 + 0.22 * s2 * s1);
    /* два акцентні відблиски: вузькі, тому кольору на екрані небагато */
    float gA = pow(max(dot(r, normalize(vec3(0.70, -0.25, 0.66))), 0.0), 30.0);
    float gB = pow(max(dot(r, normalize(vec3(-0.66, 0.30, 0.68))), 0.0), 24.0);
    c += mix(uAccent, uText, 0.12) * gA * 1.0 + mix(uAccent2, uText, 0.12) * gB * 0.95;
    return c;
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vPos);
    float back = step(dot(n, V), 0.0);
    n = mix(n, -n, back);
    float ndv = max(dot(n, V), 0.0);
    float fres = pow(1.0 - ndv, 4.0);
    vec3 col = studio(reflect(-V, n));
    col += mix(uAccent2, uText, 0.65) * fres * 0.28;
    /* зворотний бік стрічки трохи темніший: видно, що це стрічка, а не площина */
    col *= mix(1.0, 0.72, back);

    /* м'яка тінь від шолома */
    float d = (vPx - uShadow.x) / uShadow.y;
    float sh = uShadow.z * exp(-d * d);
    col *= 1.0 - sh;

    float edge = smoothstep(1.0, 0.94, abs(vUv2.y));
    float alpha = edge * uFade;
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

export function makeRibbon(pal, mobile) {
  const geo = new THREE.PlaneGeometry(2, 2, mobile ? 140 : 280, mobile ? 10 : 16);
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
      uTime: { value: 0 }, uHalfLen: { value: 4 }, uHalfW: { value: 0.15 }, uCenterY: { value: -1.5 },
      uXScale: { value: 1 }, uHelmX: { value: 0 }, uClear: { value: 1 }, uSpread: { value: 0.9 },
      uRise: { value: 0.25 }, uAmpIn: { value: 0.03 }, uAmpOut: { value: 0.15 },
      uFade: { value: 1 }, uShadow: { value: new THREE.Vector3(0, 1, 0) },
      uBg: { value: pal.bg }, uSurface: { value: pal.surface }, uText: { value: pal.text },
      uMuted: { value: pal.muted }, uAccent: { value: pal.accent }, uAccent2: { value: pal.accent2 },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  /* Координати стрічки задаємо в площині екрана (z = 0), а сам меш відсуваємо вглиб
     і збільшуємо на стільки ж, щоб на екрані він лишився там, де порахували. */
  mesh.position.z = RIBBON_Z;
  mesh.scale.setScalar((CAM_Z - RIBBON_Z) / CAM_Z);
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
  const NEAR = (CAM_Z - HELMET_Z) / CAM_Z; /* шолом ближче до камери: компенсуємо перспективу */
  const state = { w: 0, h: 0, baseX: 0, baseY: 0, scale: 1, pitchFix: 0, shadowR: 1 };

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
    const side = a.width * unit;
    state.baseX = (cx - w / 2) * unit;
    state.baseY = (h / 2 - cy) * unit;
    state.scale = side / POSTER_SPAN;
    state.pitchFix = Math.atan2(state.baseY, CAM_Z);

    /* Зазор між шоломом і стрічкою рахуємо з запасом на всі рухи:
       покачування (0.035 * scale), нахили за курсором і власне погойдування (0.03 * scale)
       плюс видимий проміжок 3 % висоти екрана. Найвища точка стрічки під шоломом —
       uCenterY + uAmpIn + 1.25 * uHalfW — завжди нижча за цю межу. */
    const helmBottom = state.baseY - HELM_BOTTOM * side;
    const limit = helmBottom - 0.065 * state.scale - 0.03 * VH;
    const floor = -VH / 2 + 0.012 * VH;
    const room = Math.max(limit - floor, 0.05 * VH);
    const ampIn = room * 0.1;
    const halfW = Math.min((room - 2 * ampIn) / 2.5, 0.045 * VH);
    U.uAmpIn.value = ampIn;
    U.uHalfW.value = halfW;
    U.uCenterY.value = limit - ampIn - halfW * 1.25;
    U.uHelmX.value = state.baseX;
    U.uClear.value = HELM_HALF_W * side * 1.05 + 0.1 * state.scale;
    U.uSpread.value = Math.min(1.5, Math.max(0.35, VW * 0.22));
    /* на вузьких екранах крилам ніде розгорнутися, тому вони майже не піднімаються */
    const wing = Math.min(1, Math.max(0.2, (VW / 2 - U.uClear.value) / 1.2));
    U.uRise.value = 0.05 * VH * wing;
    U.uAmpOut.value = 0.035 * VH * wing;
    U.uHalfLen.value = VW * 0.5 * 1.25 + 0.4;
    U.uXScale.value = Math.min(2.2, Math.max(1, 1.5 / camera.aspect));
    state.shadowR = HELM_HALF_W * side * 0.62;
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
    ribbon.position.y = -s * 0.6; /* при прокрутці стрічка йде вниз, шолом угору: зазор тільки росте */
    U.uFade.value = 1 - Math.min(1, Math.max(0, (scrollP - 0.45) / 0.5));

    let lift = 0;
    if (helmet) {
      helmetIn = Math.min(1, helmetIn + dt * 0.8);
      const ease = helmetIn * helmetIn * (3 - 2 * helmetIn);
      const bob = Math.sin(time * 0.9) * 0.035 * ease * state.scale;
      lift = bob + s * 1.1;
      /* Шолом не йде вглиб крізь стрічку: він зменшується й піднімається, лишаючись перед нею. */
      rig.scale.setScalar(state.scale * NEAR * (1 - s * 0.5));
      rig.position.set(state.baseX * NEAR, (state.baseY + lift) * NEAR, HELMET_Z);
      /* Покачування + кілька градусів за курсором + поворот при прокрутці. */
      helmet.rotation.x = BASE_ROT.x + state.pitchFix + Math.sin(time * 0.6) * 0.03 * ease + pointer.y * 0.06 + s * 0.3;
      helmet.rotation.y = BASE_ROT.y + Math.sin(time * 0.45) * 0.06 * ease + pointer.x * 0.1 + s * 1.4;
      helmet.rotation.z = BASE_ROT.z + Math.sin(time * 0.7 + 1.0) * 0.015 * ease;
    }
    /* Тінь під шоломом: слабшає й розпливається, коли шолом піднімається. */
    const hgt = Math.max(0, lift / state.scale + 0.035);
    U.uShadow.value.set(state.baseX, state.shadowR * (1 + hgt * 1.2), helmet ? 0.62 * helmetIn / (1 + hgt * 2.2) : 0);
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
      ribbon.position.y = 0;
      U.uShadow.value.set(state.baseX, state.shadowR * 1.04, showHelmet ? 0 : 0.58);
      if (helmet) {
        rig.scale.setScalar(state.scale * NEAR); rig.position.set(state.baseX * NEAR, state.baseY * NEAR, HELMET_Z);
        helmet.rotation.set(BASE_ROT.x + state.pitchFix, BASE_ROT.y, BASE_ROT.z);
      }
      renderer.render(scene, camera);
    },
  };
}
