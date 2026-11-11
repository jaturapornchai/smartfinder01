/**
 * warehouse3d.js — ฉากร้านและคลังวัสดุก่อสร้าง-ไฟฟ้า 3 มิติ (ต่อยอดจาก D:\sml3d\01)
 * สินค้าเต็มทุกเชลฟ์ ทุกชั้นวางพาเลท และทุกโซนพื้น · ของทุกชิ้นเป็นของนิ่ง (InstancedMesh) · มีเพียงอวตารลูกค้าที่เคลื่อนไหว
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pad2, SHELF_BAY, SHELF_BLOCKS, SHOWROOM, PROMO_SPOTS } from './layout.js';

export { THREE };

const $ = (id) => document.getElementById(id);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
// ตัวสุ่มแบบมี seed: ฉากเหมือนเดิมทุกครั้งที่โหลด (สินค้าบนเชลฟ์/พาเลทไม่สลับตำแหน่งไปมา)
let seed = 0x5eed02;
const rng = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rand = (a, b) => a + rng() * (b - a);
const pick = (arr) => arr[(rng() * arr.length) | 0];
export const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
export const DEG = Math.PI / 180;

const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _bm = new THREE.Matrix4(), _s = new THREE.Vector3();
export const yawOfDir = (dx, dz) => Math.atan2(-dz, dx);

export const fontsReady = Promise.race([
  Promise.all([document.fonts.load('800 64px Inter'), document.fonts.load('700 40px "Noto Sans Thai"')]),
  new Promise((r) => setTimeout(r, 2500)),
]);

/* =====================================================================
   1. RENDERER / SCENE / CAMERA / LIGHTS + AUTO GFX QUALITY
   ===================================================================== */
export const canvas = $('scene');
export const LITE = matchMedia('(pointer: coarse)').matches;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
export const GFX_STEPS = [{ q: 0, scale: 0.68 }, { q: 0, scale: 0.85 }, { q: 0, scale: 1 }, { q: 1, scale: 1 }, { q: 2, scale: 1 }];
const GFX_PREF = { low: 2, mid: 3, high: 4 };

function gpuName() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch { return ''; }
}
function firstGfxStep(pref) {
  if (pref !== 'auto') return GFX_PREF[pref];
  const gpu = gpuName(), saved = parseInt(store.get('bw02.gfxStep'), 10);
  if (/SwiftShader|llvmpipe|Basic Render|Software/i.test(gpu)) return 0;
  if (saved >= 0 && saved < GFX_STEPS.length) return saved;
  return /RTX|GTX|Radeon (RX|Pro)|Arc\(TM\) [AB]\d|Quadro|Apple M\d/i.test(gpu) ? 4 : 3;
}
export const GFX = {
  pref: GFX_PREF[store.get('bw02.gfx')] ? store.get('bw02.gfx') : 'auto',
  step: 0, t: 0, n: 0, hold: 3.5, good: 0, fails: [0, 0, 0, 0, 0], failT: -1e9, slow: null, frozen: false, frame: 0,
};
GFX.step = firstGfxStep(GFX.pref);

export const renderer = new THREE.WebGLRenderer({ canvas, antialias: GFX_STEPS[GFX.step].q > 0, alpha: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.03;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

export const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xe2e8f0, 120, 250);
const pmrem = new THREE.PMREMGenerator(renderer);
const ENV = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
scene.environment = ENV;

export const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.5, 460);
camera.position.set(36, 46, 52);
export const controls = new OrbitControls(camera, canvas);
controls.target.set(8, 0, -8);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minPolarAngle = 0.08; // อนุญาตให้มองจากมุมบน 2D เกือบตั้งฉากได้!
controls.maxPolarAngle = 1.32;
controls.minDistance = 7;
controls.maxDistance = 165;
controls.screenSpacePanning = false;
controls.update();

const hemi = new THREE.HemisphereLight(0xffffff, 0xaab6c8, 0.88);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff5e6, 2.65);
sun.position.set(24, 48, 22);
sun.target.position.set(8, 0, -12);
sun.castShadow = true;
sun.shadow.mapSize.set(LITE ? 2048 : 4096, LITE ? 2048 : 4096);
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = LITE ? 0.07 : 0.045;
scene.add(sun, sun.target);
const fillLight = new THREE.DirectionalLight(0xdce8ff, 0.58);
fillLight.position.set(-30, 26, 36);
scene.add(fillLight);

const GEO = {};
const pools = [];
const P = {}, SC = {};

export function gfxPixelRatio() {
  const { q, scale } = GFX_STEPS[GFX.step];
  const pr = q === 2 ? Math.min(devicePixelRatio, LITE ? 1.5 : 1.75) : Math.min(devicePixelRatio, 1.5, Math.sqrt((q ? 1.8e6 : 1.0e6) / Math.max(1, innerWidth * innerHeight)));
  renderer.setPixelRatio(pr * scale);
}
export function setGfxUI() {
  const seg = $('gfxSeg');
  if (!seg) return;
  for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.gfx === GFX.pref));
  const { q } = GFX_STEPS[GFX.step];
  const el = $('gfxNow');
  if (el) el.textContent = GFX.pref === 'auto' ? `(${['ประหยัด', 'กลาง', 'สูง'][q]})` : '';
}
export function applyGfx() {
  const { q } = GFX_STEPS[GFX.step], full = q === 2 && !LITE, size = full ? 4096 : 2048;
  gfxPixelRatio();
  sun.castShadow = q > 0;
  if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.setScalar(size); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  sun.shadow.normalBias = full ? 0.045 : 0.07;
  for (const p of pools) if (p.soft) p.mesh.castShadow = full;
  scene.environment = q ? ENV : null;
  hemi.intensity = q ? 0.88 : 1.5;
  fillLight.intensity = q ? 0.58 : 0.82;
  if (P.bag) {
    P.bag.mesh.geometry = P.sack.mesh.geometry = full ? GEO.bagRound : GEO.bagBox;
    P.bucket.mesh.geometry = GEO.bucket[+full];
    P.lid.mesh.geometry = GEO.lid[+full];
  }
  setGfxUI();
}
function setGfxStep(i) {
  i = clamp(i, 0, GFX_STEPS.length - 1);
  if (i === GFX.step) return;
  GFX.step = i; GFX.hold = 2.5; GFX.good = 0; GFX.n = 0; GFX.t = 0;
  applyGfx();
  if (GFX.pref === 'auto') store.set('bw02.gfxStep', String(i));
}
export function setGfxPref(pref) {
  GFX.pref = pref; store.set('bw02.gfx', pref);
  GFX.frozen = false; GFX.slow = null; GFX.fails.fill(0); GFX.hold = 1.5;
  if (pref !== 'auto') setGfxStep(GFX_PREF[pref]);
  setGfxUI();
}
export function gfxWatch(dt) {
  if (GFX.pref !== 'auto' || GFX.frozen) return;
  if (document.hidden || dt > 1) { GFX.n = 0; GFX.t = 0; return; }
  if (GFX.hold > 0) { GFX.hold -= dt; return; }
  GFX.n++; GFX.t += dt;
  if (GFX.t < 1.5) return;
  const fps = GFX.n / GFX.t, now = performance.now();
  GFX.n = 0; GFX.t = 0;
  if (fps < 38) {
    if (GFX.slow && fps < GFX.slow.fps * 1.1) GFX.slow.n++; else GFX.slow = { step: GFX.step, fps, n: 0 };
    if (GFX.slow.n >= 2) { GFX.frozen = true; setGfxStep(GFX.slow.step); return; }
    GFX.fails[GFX.step]++; GFX.failT = now; GFX.good = 0;
    setGfxStep(GFX.step - (fps < 22 ? 2 : 1));
    return;
  }
  GFX.slow = null;
  if (fps < 55) { GFX.good = 0; return; }
  if (++GFX.good >= 4 && GFX.step < GFX_STEPS.length - 1 && GFX.fails[GFX.step + 1] < 2 && now - GFX.failT > 30000) setGfxStep(GFX.step + 1);
}
gfxPixelRatio();

/* =====================================================================
   3. INSTANCED VISUAL SYSTEM & TEXTURES
   ===================================================================== */
class Pool {
  constructor(geo, mat, cap, { cast = true, receive = true, colored = false, soft = false } = {}) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = cast;
    this.mesh.receiveShadow = receive;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    if (colored) this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    this.free = [];
    this.cap = cap;
    this.dirty = false;
    this.soft = soft;
    this.overflow = 0;
    scene.add(this.mesh);
    pools.push(this);
  }
  alloc() {
    if (this.free.length) return this.free.pop();
    if (this.mesh.count >= this.cap) { this.overflow++; return this.cap - 1; }
    return this.mesh.count++;
  }
  release(i) { this.mesh.setMatrixAt(i, ZERO_M); this.free.push(i); this.dirty = true; }
  set(i, m) { this.mesh.setMatrixAt(i, m); this.dirty = true; }
  color(i, c) { this.mesh.setColorAt(i, c); this.mesh.instanceColor.needsUpdate = true; }
  flush() { if (this.dirty) { this.mesh.instanceMatrix.needsUpdate = true; this.dirty = false; } }
}
const M4 = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

export function canvasTex(w, h, draw, { repeat, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function noise(g, w, h, n, a, dark = true) {
  for (let i = 0; i < n; i++) {
    const v = dark ? (Math.random() * 60) | 0 : 200 + ((Math.random() * 55) | 0);
    g.fillStyle = `rgba(${v},${v},${v},${a * Math.random()})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}
const TEX = {}, MAT = {};
function std(color, opts = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.0, envMapIntensity: 0.6, ...opts }); }

function buildTexturesAndMaterials() {
  TEX.planks = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#c99a62'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5; i++) {
      const y0 = (i / 5) * h;
      g.fillStyle = `hsl(${30 + Math.random() * 6}, ${42 + Math.random() * 10}%, ${52 + Math.random() * 8}%)`;
      g.fillRect(0, y0 + 4, w, h / 5 - 10);
      g.fillStyle = 'rgba(60,35,15,0.5)'; g.fillRect(0, y0 + h / 5 - 6, w, 6);
    }
    noise(g, w, h, 700, 0.16);
  });
  TEX.cement = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#d9d4c7'; g.fillRect(0, 0, w, h); noise(g, w, h, 1800, 0.1);
    g.fillStyle = '#c62828'; g.fillRect(0, h * 0.36, w, h * 0.28);
    g.fillStyle = '#1e3a8a'; g.fillRect(0, h * 0.64, w, h * 0.05);
    g.fillStyle = '#fff'; g.font = '700 52px "Noto Sans Thai", Inter'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('ปูนซีเมนต์ 50 กก.', w / 2, h * 0.5);
  });
  TEX.aac = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#e7e5e0'; g.fillRect(0, 0, w, h); noise(g, w, h, 4000, 0.1);
    g.strokeStyle = 'rgba(120,113,108,0.55)'; g.lineWidth = 2.5;
    for (let r = 0; r <= 8; r++) {
      const y = (r / 8) * h; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      const off = r % 2 ? w / 4 : 0; for (let x = off; x < w; x += w / 2) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + h / 8); g.stroke(); }
    }
  });
  TEX.brick = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#d6cbbf'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 16; r++) {
      const y = (r / 16) * h, off = r % 2 ? 32 : 0;
      for (let x = -64; x < w + 64; x += 64) { g.fillStyle = `hsl(${10 + Math.random() * 8}, 58%, ${36 + Math.random() * 10}%)`; g.fillRect(x + off + 2, y + 2, 60, h / 16 - 4); }
    }
  });
  TEX.carton = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#c8a172'; g.fillRect(0, 0, w, h); noise(g, w, h, 1000, 0.1);
    g.fillStyle = 'rgba(214,190,150,0.9)'; g.fillRect(w * 0.42, 0, w * 0.16, h);
    g.fillStyle = '#fff'; g.fillRect(w * 0.08, h * 0.62, w * 0.3, h * 0.22);
    g.fillStyle = '#2563eb'; g.font = '800 20px Inter'; g.fillText('BC', w * 0.72, h * 0.3);
  });
  TEX.bollard = canvasTex(64, 256, (g, w, h) => {
    g.fillStyle = '#facc15'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#111827'; for (let y = -64; y < h; y += 48) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + 24); g.lineTo(w, y + 46); g.lineTo(0, y + 22); g.fill(); }
  });
  TEX.corrugated = canvasTex(256, 64, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#cbd5e1'); gr.addColorStop(0.5, '#f1f5f9'); gr.addColorStop(1, '#94a3b8');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, { repeat: [1, 14] });
  TEX.diamond = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#8b95a3'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 3;
    for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 8, y + 6); g.stroke(); }
  }, { repeat: [6, 3] });
  TEX.wall = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#f4f6f9'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) { g.fillStyle = 'rgba(148,163,184,0.22)'; g.fillRect(x, 0, 3, h); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(x + 3, 0, 2, h); }
  }, { repeat: [12, 1] });

  MAT.rackBlue = std(0x1d4ed8, { roughness: 0.45, metalness: 0.35 });
  MAT.beamOrange = std(0xf97316, { roughness: 0.42, metalness: 0.3 });
  MAT.galv = std(0xc7cdd6, { roughness: 0.35, metalness: 0.8 });
  MAT.darkSteel = std(0x334155, { roughness: 0.5, metalness: 0.6 });
  MAT.wood = std(0xffffff, { map: TEX.planks, roughness: 0.85 });
  MAT.woodPlain = std(0xb98a55, { roughness: 0.9 });
  MAT.plasticPallet = std(0x2563eb, { roughness: 0.55 });
  MAT.cement = std(0xffffff, { map: TEX.cement, roughness: 0.92 });
  MAT.aac = std(0xffffff, { map: TEX.aac, roughness: 0.95 });
  MAT.brick = std(0xffffff, { map: TEX.brick, roughness: 0.9 });
  MAT.carton = std(0xffffff, { map: TEX.carton, roughness: 0.85 });
  MAT.bucket = std(0xf8fafc, { roughness: 0.35 });
  MAT.lid = std(0xffffff, { roughness: 0.4 });
  MAT.rebar = std(0x6b4f3a, { roughness: 0.62, metalness: 0.75 });
  MAT.pvc = std(0x1e60c9, { roughness: 0.3 });
  MAT.pipeEnd = std(0x0b1d3a, { roughness: 0.9 });
  MAT.tie = std(0x111827, { roughness: 0.5, metalness: 0.6 });
  MAT.bollard = std(0xffffff, { map: TEX.bollard, roughness: 0.5 });
  MAT.wall = std(0xffffff, { map: TEX.wall, roughness: 0.82 });
  MAT.wallCap = std(0x475569, { roughness: 0.7 });
  MAT.glass = new THREE.MeshStandardMaterial({ color: 0xbfdbfe, emissive: 0xdbeafe, emissiveIntensity: 0.35, roughness: 0.08, metalness: 0.3 });
  MAT.door = std(0xffffff, { map: TEX.corrugated, roughness: 0.4, metalness: 0.55 });
  MAT.yellow = std(0xfacc15, { roughness: 0.45 });
  MAT.concrete = std(0xc9ced6, { roughness: 0.95 });
  MAT.asphalt = std(0x5b6472, { roughness: 0.95 });
  MAT.white = std(0xf8fafc, { roughness: 0.35, metalness: 0.1 });
  MAT.blue = std(0x2563eb, { roughness: 0.35 });
  MAT.redLight = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 1.4 });
  MAT.diamond = std(0xffffff, { map: TEX.diamond, roughness: 0.4, metalness: 0.8 });
}

/* =====================================================================
   4. LAYOUT & ZONES (ต่อยอดจาก D:\sml3d\01)
   ===================================================================== */
export const W = { X0: -26, X1: 53, Z0: -67.5, Z1: 17 };
export const WALL_H = 7.8;
export const ENTRANCE_POS = { x: 18.5, z: 15.8 }; // จุดประตูทางเข้าลูกค้าหลัก

export const L = {
  bay: 3.0, depth: 1.1, levels: [0, 1.75, 3.5], rackH: 5.0,
  mainZ: 2.6, westX: -11.2, eastX: 7.2, dockZ: 7.5, dock2Z: -8,
  lanes: [-11.2, 7.2, 28.6, 50.0],
  rows: [-21.0, -29.4, -37.8, -46.2, -54.6, -63.0],
  aisles: [], racks: [],
};
function addAisle(key, z, x0, bays, wx, ex) {
  const a = { key, z, x0, bays, x1: x0 + bays * L.bay, wx, ex };
  L.aisles.push(a);
  L.racks.push({ name: key + '1', front: z - 3, dir: -1, x0, bays, x1: a.x1, aisle: a }, { name: key + '2', front: z + 3, dir: 1, x0, bays, x1: a.x1, aisle: a });
}
addAisle('A', -12.6, -8, 4, -11.2, 7.2); addAisle('B', -4.2, -8, 4, -11.2, 7.2);
[['CDEFGH', -8, 4, -11.2, 7.2], ['JKLMNP', 10.4, 5, 7.2, 28.6], ['QRSTUV', 31.8, 5, 28.6, 50.0]]
  .forEach(([keys, x0, bays, wx, ex]) => L.rows.forEach((z, i) => addAisle(keys[i], z, x0, bays, wx, ex)));

export const AREA = {
  bulk: { x0: -25.2, x1: -14.4, z0: -66.6, z1: -21.2 },
  steel: { x0: 31.6, x1: 47.2, z0: -15.4, z1: -3.2 },
  hardware: { x0: 34.8, x1: 51.8, z0: 5.9, z1: 13.9 },
  entrance: { x0: 14.9, x1: 21.2, z0: 11.8, z1: 16.8 },
};

const meshBox = (w, h, d, mat, x = 0, y = 0, z = 0, parent = scene, shadow = true) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m;
};
export const signPlane = (txt, sub, w, h, bg = '#1d4ed8', fg = '#fff', res = 512, doubleSide = false) => {
  const t = canvasTex(res, Math.max(64, Math.round((res * h) / w)), (g, cw, ch) => {
    g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
    g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = Math.max(2, ch * 0.03); g.strokeRect(4, 4, cw - 8, ch - 8);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    const mainFont = `800 ${Math.round(ch * (sub ? 0.42 : 0.62))}px "Noto Sans Thai", Inter`;
    g.font = mainFont;
    const fit = Math.min(1, (cw * 0.9) / Math.max(1, g.measureText(txt).width));
    if (fit < 1) g.font = `800 ${Math.round(ch * (sub ? 0.42 : 0.62) * fit)}px "Noto Sans Thai", Inter`;
    g.fillText(txt, cw / 2, ch * (sub ? 0.38 : 0.52));
    if (sub) {
      g.font = `600 ${Math.round(ch * 0.24)}px "Noto Sans Thai", Inter`;
      g.globalAlpha = 0.92;
      g.fillText(sub, cw / 2, ch * 0.76);
    }
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.45, side: doubleSide ? THREE.DoubleSide : THREE.FrontSide }));
};

let floorTexture = null;

function paintFloorTexture() {
  const Wm = W.X1 - W.X0, Dm = W.Z1 - W.Z0, ppm = Math.min(64, Math.floor((LITE ? 2560 : 4096) / Math.max(Wm, Dm)));
  const X = (x) => (x - W.X0) * ppm, Z = (z) => (z - W.Z0) * ppm, S = (m) => m * ppm;
  return canvasTex(Math.round(Wm * ppm), Math.round(Dm * ppm), (g, cw, ch) => {
    const gr = g.createLinearGradient(0, 0, cw, ch);
    gr.addColorStop(0, '#f3f6fa'); gr.addColorStop(1, '#e3e8f0');
    g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
    noise(g, cw, ch, Math.round((cw * ch) / 160), 0.045);
    g.strokeStyle = 'rgba(148,163,184,0.28)'; g.lineWidth = 2;
    for (let x = W.X0 + 6; x < W.X1; x += 6) { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), ch); g.stroke(); }
    for (let z = W.Z0 + 6; z < W.Z1; z += 6) { g.beginPath(); g.moveTo(0, Z(z)); g.lineTo(cw, Z(z)); g.stroke(); }

    const rect = (x0, z0, x1, z1) => [X(Math.min(x0, x1)), Z(Math.min(z0, z1)), S(Math.abs(x1 - x0)), S(Math.abs(z1 - z0))];
    const text = (t, x, z, size, color, { weight = 800, rot = 0, font = 'Inter, "Noto Sans Thai"' } = {}) => {
      g.save(); g.translate(X(x), Z(z)); g.rotate(rot); g.fillStyle = color; g.font = `${weight} ${S(size)}px ${font}`;
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 0, 0); g.restore();
    };
    const zone = (x0, z0, x1, z1, fill, stroke, title, thai, lx, lz, size = 0.98, rot = 0) => {
      g.fillStyle = fill; g.fillRect(...rect(x0, z0, x1, z1));
      g.strokeStyle = stroke; g.lineWidth = S(0.12); g.strokeRect(...rect(x0, z0, x1, z1));
      const off = size * 1.07;
      text(title, lx, lz, size, 'rgba(15,23,42,0.65)', { rot });
      text(thai, lx - Math.sin(rot) * off, lz + Math.cos(rot) * off, size * 0.63, 'rgba(15,23,42,0.52)', { weight: 700, rot, font: '"Noto Sans Thai", Inter' });
    };

    for (const r of L.racks) {
      const back = r.front + r.dir * L.depth;
      g.fillStyle = 'rgba(71,85,105,0.10)'; g.fillRect(...rect(r.x0 - 0.2, r.front, r.x1 + 0.2, back));
      g.fillStyle = '#facc15'; g.fillRect(...rect(r.x0 - 0.3, r.front - r.dir * 0.12, r.x1 + 0.3, r.front - r.dir * 0.22));
    }

    // โซนหลักในร้านและคลัง — ป้ายพื้นวางในซอยเดินหรือขอบโซน จึงไม่ถูกสินค้าบัง
    zone(-24.6, -17.3, -13.7, -0.1, 'rgba(14,116,144,0.06)', '#facc15', 'BATH & TILE SHOWROOM', 'โชว์รูมสุขภัณฑ์ · กระเบื้อง', -19.2, -2.72, 0.42);
    zone(-9.4, 5.0, 5.4, 16.3, 'rgba(249,115,22,0.065)', '#facc15', 'TOOLS & AGRICULTURE', 'เครื่องมือช่าง · เกษตร', -2.0, 6.93, 0.42);
    zone(9.2, 5.0, 17.2, 16.5, 'rgba(234,179,8,0.09)', '#f59e0b', 'PROMOTION', 'ลานสินค้าจัดรายการ', 13.2, 9.43, 0.42);
    zone(19.9, 5.0, 26.6, 16.3, 'rgba(22,163,74,0.065)', '#facc15', 'GARDEN & HOME', 'สวน · ของใช้ในบ้าน', 23.3, 6.95, 0.36);
    zone(9.5, -3.7, 26.3, 0.1, 'rgba(234,179,8,0.09)', '#f59e0b', 'PROMOTION', 'ลานสินค้าจัดรายการ', 17.6, -2.02, 0.42);
    zone(9.5, -16.7, 26.3, -3.8, 'rgba(190,24,93,0.05)', '#facc15', 'HOME & KITCHEN', 'เครื่องใช้ไฟฟ้า · ครัว · ห้องน้ำ · ประตู', 17.9, -5.47, 0.42);
    zone(-24.4, 9.9, -13.6, 15.9, 'rgba(71,85,105,0.07)', '#facc15', 'STEEL REBAR & PVC', 'เหล็กเส้นข้ออ้อย · ท่อใหญ่', -19, 16.2, 0.5);
    zone(-25.4, -66.9, -13.6, -17.6, 'rgba(220,38,38,0.05)', '#facc15', 'BULK CEMENT & BRICK', 'กองพื้น · ปูน / อิฐ / กระเบื้อง / สุขภัณฑ์', -14.05, -42, 0.42, -Math.PI / 2);
    zone(30.9, -15.9, 47.7, 0.3, 'rgba(2,132,199,0.065)', '#38bdf8', 'PIPE · STEEL · ROOF', 'ท่อประปา · ท่อไฟ · เหล็ก · หลังคา', 39.3, -1.9);
    zone(34.2, 4.9, 52.3, 16.4, 'rgba(245,158,11,0.085)', '#f59e0b', 'ELECTRICAL & HARDWARE', 'ไฟฟ้า · ประปา · ฮาร์ดแวร์ · สี', 43.3, 6.93, 0.42);

    // ทางเดินลูกค้าปลอดภัยสีเขียว (Customer Safe Walkway)
    g.fillStyle = 'rgba(16,185,129,0.16)';
    g.fillRect(...rect(17.5, 4.5, 19.5, 16.8));   // ทางเดินตรงจากประตูทางเข้า
    g.fillRect(...rect(17.5, 14.1, 34.8, 15.2));  // ทางเดินเชื่อมไปโซนไฟฟ้าหน้าร้าน
    g.strokeStyle = 'rgba(5,150,105,0.75)'; g.lineWidth = S(0.08);
    g.strokeRect(...rect(17.5, 4.5, 19.5, 16.8));
    text('ทางเดินลูกค้า', 18.5, 11.2, 0.44, 'rgba(6,95,70,0.85)', { rot: -Math.PI / 2, font: '"Noto Sans Thai", Inter' });
    text('ทางเข้าลูกค้า · ENTRANCE', 18.5, 16.3, 0.52, '#1d4ed8', { font: '"Noto Sans Thai", Inter' });

    // ช่องจราจรหลัก
    const lane = (x0, z0, x1, z1) => {
      g.fillStyle = 'rgba(37,99,235,0.035)'; g.fillRect(...rect(x0, z0, x1, z1));
      g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = S(0.085); g.setLineDash([S(0.9), S(0.5)]);
      const [rx, rz, rw, rh] = rect(x0, z0, x1, z1);
      if (rw > rh) { g.beginPath(); g.moveTo(rx, rz); g.lineTo(rx + rw, rz); g.moveTo(rx, rz + rh); g.lineTo(rx + rw, rz + rh); g.stroke(); }
      else { g.beginPath(); g.moveTo(rx, rz); g.lineTo(rx, rz + rh); g.moveTo(rx + rw, rz); g.lineTo(rx + rw, rz + rh); g.stroke(); }
      g.setLineDash([]);
    };
    const laneN = W.Z0 + 1.9, laneE = L.lanes[L.lanes.length - 1] + 2;
    lane(-25.6, L.mainZ - 2, laneE, L.mainZ + 2);
    for (const x of L.lanes) lane(x - 2, laneN, x + 2, L.mainZ - 2);
    lane(-25.6, L.dockZ - 2, L.westX + 2, L.dockZ + 2);
    lane(L.westX - 2, L.mainZ + 2, L.westX + 2, L.dockZ - 2);

    g.strokeStyle = 'rgba(250,204,21,0.8)'; g.lineWidth = S(0.07); g.setLineDash([S(0.6), S(0.6)]);
    for (const a of L.aisles) { g.beginPath(); g.moveTo(X(a.x0 - 1), Z(a.z)); g.lineTo(X(a.x1 + 1), Z(a.z)); g.stroke(); }
    g.setLineDash([]);
    for (const a of L.aisles) text('ซอย ' + a.key, a.x0 + 1.6, a.z, 0.55, 'rgba(30,41,59,0.52)', { font: '"Noto Sans Thai", Inter' });

    // ทางม้าลาย 2 จุด (x=7.8 และ x=18.5 หน้าทางเข้า)
    g.fillStyle = 'rgba(255,255,255,0.95)';
    for (const cxw of [7.8, 18.5]) {
      for (let z = L.mainZ - 1.8; z < L.mainZ + 1.8; z += 0.55) g.fillRect(...rect(cxw - 0.6, z, cxw + 0.6, z + 0.28));
    }
  });
}

function buildShell() {
  floorTexture = paintFloorTexture();
  const fw = W.X1 - W.X0, fd = W.Z1 - W.Z0, cxm = (W.X0 + W.X1) / 2, czm = (W.Z0 + W.Z1) / 2;
  const R = Math.hypot(fw, fd) / 2;
  sun.target.position.set(cxm, 0, czm); sun.position.set(cxm + R * 0.84, R * 1.48, czm + R * 0.71);
  Object.assign(sun.shadow.camera, { left: -R * 1.1, right: R * 1.1, top: R, bottom: -R, near: 5, far: R * 3.9 });
  sun.shadow.camera.updateProjectionMatrix();

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.38, metalness: 0.0, envMapIntensity: 0.5 }));
  floor.position.set(cxm, 0, czm); floor.receiveShadow = true; floor.name = 'warehouseFloor';
  scene.add(floor);

  const apron = new THREE.Mesh(new THREE.CircleGeometry(280, 64).rotateX(-Math.PI / 2), std(0xd6dde6, { roughness: 0.95 }));
  apron.position.set(cxm, -0.03, czm); apron.receiveShadow = true; scene.add(apron);
  meshBox(46, 0.2, fd + 26, MAT.asphalt, -49.5, -1.35, czm, scene, false);
  meshBox(0.6, 1.25, fd + 26, MAT.concrete, -26.6, -0.625, czm, scene, false);


  const wallH = WALL_H, sideH = 4.0;
  const bw = meshBox(fw + 0.6, wallH, 0.3, MAT.wall, cxm, wallH / 2, W.Z0 - 0.15);
  bw.material = MAT.wall.clone(); bw.material.map = TEX.wall.clone(); bw.material.map.repeat.set(fw / 4.4, 1); bw.material.map.needsUpdate = true;
  meshBox(fw + 0.6, 0.18, 0.42, MAT.wallCap, cxm, wallH + 0.09, W.Z0 - 0.15);
  for (let x = W.X0 + 4; x <= W.X1 - 4; x += 4.4) meshBox(3.6, 0.9, 0.06, MAT.glass, x, wallH - 0.85, W.Z0 + 0.02, scene, false);

  const brand = signPlane('BC Smart Store & Warehouse', 'ศูนย์ค้าส่ง-ปลีก วัสดุก่อสร้าง · ไฟฟ้า · ประปา · เครื่องมือช่าง', 14, 1.8, '#0f172a', '#ffffff');
  brand.position.set(16, 5.8, W.Z0 + 0.02); scene.add(brand);

  const wx = W.X0 - 0.15, open = 1.7, doorH = 3.6;
  for (const [z0, z1] of [[W.Z0, L.dock2Z - open], [L.dock2Z + open, L.dockZ - open], [L.dockZ + open, W.Z1]]) {
    const len = z1 - z0, zc = (z0 + z1) / 2;
    const m = meshBox(0.3, sideH, len, MAT.wall, wx, sideH / 2, zc);
    m.material = MAT.wall.clone(); m.material.map = TEX.wall.clone(); m.material.map.repeat.set(len / 4.4, 1); m.material.map.needsUpdate = true;
    meshBox(0.42, 0.18, len, MAT.wallCap, wx, sideH + 0.09, zc);
  }
  // ประตูม้วนรับ-ส่งสินค้า 2 บาน ปิดสนิท (ไม่มีรถเข้า-ออกในฉาก)
  for (const dz of [L.dockZ, L.dock2Z]) {
    meshBox(0.3, sideH - doorH, open * 2, MAT.wall, wx, (sideH + doorH) / 2, dz);
    meshBox(0.42, 0.18, open * 2, MAT.wallCap, wx, sideH + 0.09, dz);
    const sign = signPlane(dz === L.dockZ ? '01' : '02', 'ประตูรับ-ส่งสินค้า', 1.7, 1.0);
    sign.rotation.y = Math.PI / 2; sign.position.set(wx + 0.17, 3.77, dz + (dz === L.dockZ ? -2.6 : 2.6)); scene.add(sign);
    meshBox(0.16, 0.16, 0.16, MAT.redLight, wx + 0.25, 3.2, dz + 2.2, scene, false);
    meshBox(0.08, doorH, open * 2 - 0.1, MAT.door, wx, doorH / 2, dz);
  }
  meshBox(1.3, 0.05, 2.2, MAT.diamond, -26.3, -0.012, L.dockZ, scene, false);
  meshBox(1.3, 0.05, 2.2, MAT.diamond, -26.3, -0.012, L.dock2Z, scene, false);

  // ขอบอาคารด้านทิศใต้ เว้นช่องประตูทางเข้าลูกค้า x = 16.5..20.5
  meshBox(42.5, 0.28, 0.25, MAT.wallCap, -4.75, 0.14, W.Z1 + 0.12);
  meshBox(32.5, 0.28, 0.25, MAT.wallCap, 36.75, 0.14, W.Z1 + 0.12);
  meshBox(0.25, 0.28, fd + 0.3, MAT.wallCap, W.X1 + 0.12, 0.14, czm);

  buildCustomerEntranceAndSigns();
}

/** สร้างซุ้มทางเข้าลูกค้า เคาน์เตอร์บริการลูกค้า ตู้ Kiosk และป้ายบอกหมวดหมู่เหนือเชลฟ์ 3 มิติ */
function buildCustomerEntranceAndSigns() {
  // ซุ้มทางเข้าลูกค้า (x = 18.5, z = 16.8)
  const ex = 18.5, ez = 16.85;
  meshBox(0.32, 3.6, 0.32, MAT.blue, ex - 2.1, 1.8, ez);
  meshBox(0.32, 3.6, 0.32, MAT.blue, ex + 2.1, 1.8, ez);
  meshBox(4.6, 0.45, 0.45, MAT.blue, ex, 3.75, ez);
  const archSign = signPlane('ทางเข้าลูกค้า · ENTRANCE', 'จุดเริ่มต้นค้นหาสินค้าและระบบนำทาง GPS', 4.4, 0.95, '#1d4ed8', '#ffffff', 512, true);
  archSign.position.set(ex, 4.35, ez);
  scene.add(archSign);

  // พรมต้อนรับสีน้ำเงินหน้าประตูทางเข้า
  meshBox(3.4, 0.018, 1.6, MAT.blue, ex, 0.009, 16.0, scene, false);

  // เคาน์เตอร์ประชาสัมพันธ์ & จุดรับใบเบิกสินค้า (x = 16.0, z = 13.6)
  meshBox(2.2, 1.02, 0.85, MAT.white, 16.0, 0.51, 13.6);
  meshBox(2.3, 0.08, 0.95, MAT.blue, 16.0, 1.05, 13.6);
  const infoSign = signPlane('จุดบริการลูกค้า · รับสินค้าชิ้นใหญ่', 'ส่งรายการให้พนักงานจัดสินค้า แล้วรับของที่นี่', 2.2, 0.55, '#059669', '#ffffff', 512, true);
  infoSign.position.set(16.0, 2.35, 13.6);
  scene.add(infoSign);

  // ตู้ Kiosk จอสัมผัสค้นหาสินค้าหน้าทางเข้า (x = 17.2, z = 14.8)
  meshBox(0.52, 1.25, 0.38, MAT.darkSteel, 17.1, 0.625, 14.9);
  const kioskScr = signPlane('ค้นหาสินค้า', 'แตะเลือกหลายจุด', 0.46, 0.62, '#2563eb', '#ffffff', 256);
  kioskScr.position.set(17.1, 1.38, 15.11);
  kioskScr.rotation.x = -0.25;
  scene.add(kioskScr);

  // ป้ายแขวนบอกโซนหลักของร้านและคลัง (2 หน้า)
  const bigZoneSigns = [
    [43.3, 3.75, 9.65, 'ไฟฟ้า · ประปา · เครื่องมือ · ฮาร์ดแวร์ · สี', 'โซนไฟฟ้าและประปาหน้าร้าน (SH)', '#d97706'],
    [23.3, 3.75, 9.65, 'สวน · กลางแจ้ง · ทำความสะอาด', 'โซนสวนและของใช้ในบ้าน (GD)', '#15803d'],
    [13.2, 3.3, 9.65, 'สินค้าจัดรายการ ยกพาเลท', 'ลานโปรโมชันหน้าร้าน', '#b45309'],
    [-2.0, 3.75, 9.65, 'เครื่องมือช่าง · เครื่องมือไฟฟ้า · เกษตร', 'โซนเครื่องมือช่างและเกษตร (TG)', '#c2410c'],
    [17.6, 3.3, -1.8, 'สินค้าจัดรายการ ยกพาเลท', 'ลานโปรโมชันกลางร้าน', '#b45309'],
    [17.9, 3.75, -10.25, 'เครื่องใช้ไฟฟ้า · ครัว · ห้องน้ำ · ประตูหน้าต่าง', 'โซนของใช้ในบ้าน (HM)', '#be185d'],
    [-19.2, 3.75, -8.5, 'สุขภัณฑ์ · กระเบื้อง · อ่างล้างหน้า · อ่างอาบน้ำ', 'โชว์รูมห้องน้ำและกระเบื้อง (TS)', '#0e7490'],
    [39.0, 3.9, -11.6, 'ท่อประปา · ท่อร้อยสายไฟ · เหล็กรูปพรรณ · หลังคา', 'โซนท่อและเหล็ก (PIPE & STEEL)', '#0369a1'],
    [-19.0, 3.6, 12.8, 'เหล็กเส้นข้ออ้อย DB12-DB28 · ท่อเมน PVC', 'โซนของยาว (LONG GOODS)', '#334155'],
    [-19.5, 3.9, -45.0, 'กองเก็บยกล็อต · ปูนซีเมนต์ · อิฐมวลเบา · กระเบื้อง', 'โซนกองพื้น (BULK STORAGE)', '#b91c1c'],
    [-2.0, 5.4, -12.6, 'ซอย A-B · ปูนซีเมนต์ กาวปูกระเบื้อง อิฐ', 'ชั้นวางพาเลทขายดี', '#1d4ed8'],
    [18.0, 5.4, -29.4, 'ซอย J-P · สต็อกไฟฟ้า สายไฟ โคมไฟ เครื่องมือ', 'คลังสินค้าไฟฟ้าและอุปกรณ์', '#d97706'],
    [39.3, 5.4, -29.4, 'ซอย Q-V · สต็อกประปา ปั๊มน้ำ ถังบำบัด สีถังใหญ่', 'คลังสินค้าประปาและเคมีภัณฑ์', '#0d9488'],
  ];
  for (const [bx, by, bz, main, sub, col] of bigZoneSigns) hangSign(main, sub, 7.6, 0.95, col, bx, by, bz);
}

/* =====================================================================
   5. RACKS, SLOTS & CARGO POOLS
   ===================================================================== */
export const slots = [];
export const slotById = new Map();
export const RACK_SLOTS = [];
function addSlot(s) { Object.assign(s, { reservedBy: null }); slots.push(s); slotById.set(s.id, s); return s; }

const BOLLARDS = [];
function buildBollardsAndRacks() {
  for (const r of L.racks) for (const x of [r.x0 - 0.45, r.x1 + 0.45]) BOLLARDS.push([x, r.front + r.dir * (L.depth - 0.15)]);
  BOLLARDS.push([-25.35, L.dockZ - 2.15], [-25.35, L.dockZ + 2.15], [-25.35, L.dock2Z - 2.15], [-25.35, L.dock2Z + 2.15]);
  const pb = new Pool(new THREE.CylinderGeometry(0.11, 0.11, 1.1, 16).translate(0, 0.55, 0), MAT.bollard, BOLLARDS.length);
  const pc = new Pool(new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.1, 0), MAT.yellow, BOLLARDS.length);
  for (const [x, z] of BOLLARDS) {
    _m.makeTranslation(x, 0, z); pb.set(pb.alloc(), _m); pc.set(pc.alloc(), _m);
  }

  const sum = (f) => L.racks.reduce((n, r) => n + f(r), 0), nUp = sum((r) => (r.bays + 1) * 2);
  const upright = new Pool(new THREE.BoxGeometry(0.09, L.rackH, 0.09).translate(0, L.rackH / 2, 0), MAT.rackBlue, nUp);
  const brace = new Pool(new THREE.BoxGeometry(0.035, 1, 0.035), MAT.rackBlue, nUp * 5, { soft: true });
  const beam = new Pool(new THREE.BoxGeometry(1, 0.12, 0.06), MAT.beamOrange, sum((r) => r.bays * 4));
  const foot = new Pool(new THREE.BoxGeometry(0.16, 0.02, 0.16), MAT.galv, nUp, { cast: false });
  const guard = new Pool(new THREE.BoxGeometry(0.12, 0.42, 1.2), MAT.yellow, L.racks.length * 2);
  const up = new THREE.Vector3(0, 1, 0);
  const seg = (a, b) => {
    const d = _v2.subVectors(b, a), len = d.length();
    _q.setFromUnitVectors(up, d.normalize());
    _m.compose(_v.addVectors(a, b).multiplyScalar(0.5), _q, _s.set(1, len, 1)); brace.set(brace.alloc(), _m);
  };

  for (const r of L.racks) {
    const back = r.front + r.dir * L.depth, xm = (r.x0 + r.x1) / 2, zm = (r.front + back) / 2;
    const fz = r.front + r.dir * 0.045, bz = back - r.dir * 0.045;
    for (let i = 0; i <= r.bays; i++) {
      const x = r.x0 + i * L.bay;
      for (const z of [fz, bz]) {
        _m.makeTranslation(x, 0, z); upright.set(upright.alloc(), _m); foot.set(foot.alloc(), _m);
      }
      for (let k = 0; k < 5; k++) {
        const y0 = 0.25 + k * 0.92;
        seg(new THREE.Vector3(x, y0, fz), new THREE.Vector3(x, y0 + 0.92, bz));
        seg(new THREE.Vector3(x, y0, fz), new THREE.Vector3(x, y0, bz));
      }
    }
    for (const ex of [r.x0 - 0.16, r.x1 + 0.16]) { _m.makeTranslation(ex, 0.21, zm); guard.set(guard.alloc(), _m); }
    for (let b = 0; b < r.bays; b++) {
      const xc = r.x0 + (b + 0.5) * L.bay, len = L.bay - 0.09;
      for (const lvl of [1, 2]) {
        const y = L.levels[lvl] - 0.06, fbz = r.front + r.dir * 0.03, bbz = back - r.dir * 0.03;
        for (const z of [fbz, bbz]) { _m.compose(_v.set(xc, y, z), _q.identity(), _s.set(len, 1, 1)); beam.set(beam.alloc(), _m); }
      }
      for (let lvl = 0; lvl < 3; lvl++) for (let p = 0; p < 2; p++) {
        const idx = lvl * r.bays * 2 + b * 2 + p + 1;
        addSlot({ id: `${r.name}-${pad2(idx)}`, kind: 'rack', rack: r, level: lvl, bay: b, x: xc + (p ? 0.62 : -0.62), z: r.front + r.dir * 0.55, yaw: yawOfDir(0, r.dir), h: L.levels[lvl], aisleZ: r.aisle.z });
      }
    }
    for (const [ex, ry] of [[r.x1 + 0.06, Math.PI / 2], [r.x0 - 0.06, -Math.PI / 2]]) {
      const s = signPlane(r.name, 'แถว ' + r.name, 0.9, 0.62, '#1d4ed8', '#fff', 256);
      s.position.set(ex, L.rackH - 0.45, zm); s.rotation.y = ry; scene.add(s);
    }
    for (let lvl = 0; lvl < 3 && !LITE; lvl++) {
      const y = [0.09, L.levels[1] - 0.06, L.levels[2] - 0.06][lvl];
      const tex = canvasTex(512 * r.bays, 24, (g, cw, ch) => {
        g.clearRect(0, 0, cw, ch);
        for (let b = 0; b < r.bays; b++) for (let p = 0; p < 2; p++) {
          const xc = (b + 0.5) * L.bay + (p ? 0.62 : -0.62), u = (xc / (L.bay * r.bays)) * cw;
          g.fillStyle = '#ffffff'; g.fillRect(u - 70, 2, 140, ch - 4);
          g.fillStyle = '#0f172a'; g.font = '800 17px Inter'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(`${r.name}-${pad2(lvl * r.bays * 2 + b * 2 + p + 1)}`, u, ch / 2 + 1);
        }
      });
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(L.bay * r.bays, 0.11), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
      strip.position.set(xm, y, r.front - r.dir * 0.002);
      if (r.dir > 0) strip.rotation.y = Math.PI;
      scene.add(strip);
    }
  }
  for (const s of slots) RACK_SLOTS.push(s);
}

export const CARGO_TYPES = {
  cement:   { label: 'ปูนซีเมนต์ 50 กก. × 24', short: 'Cement', mass: 1200, he: [0.59, 0.39, 0.44], mat: 'cement', heavy: true, bags: 'bag' },
  mortar:   { label: 'ปูนฉาบสำเร็จรูป 50 กก. × 24', short: 'Mortar', mass: 1200, he: [0.59, 0.39, 0.44], mat: 'cement', heavy: true, bags: 'sack', tints: [0xd9c3a0, 0xc8ad85] },
  tilefix:  { label: 'กาวซีเมนต์ปูกระเบื้อง 20 กก. × 24', short: 'Tile Adhesive', mass: 480, he: [0.59, 0.39, 0.44], mat: 'cement', bags: 'sack', tints: [0x93c5fd, 0xf9a8d4, 0xfcd34d] },
  aac:      { label: 'อิฐมวลเบา AAC', short: 'AAC Block', mass: 850, he: [0.575, 0.475, 0.475], mat: 'masonry', heavy: true },
  brick:    { label: 'อิฐแดง (มอญ)', short: 'Red Brick', mass: 850, he: [0.55, 0.36, 0.46], mat: 'masonry', heavy: true },
  tile:     { label: 'กระเบื้อง 60×60 ซม. (กล่อง)', short: 'Floor Tile', mass: 780, he: [0.6, 0.34, 0.31], mat: 'carton', heavy: true },
  paint:    { label: 'สีทาอาคาร ถัง 18 ลิตร × 24', short: 'Paint 18 L', mass: 600, he: [0.6, 0.365, 0.45], mat: 'carton' },
  sanitary: { label: 'สุขภัณฑ์ (กล่อง)', short: 'Sanitary Ware', mass: 220, he: [0.58, 0.452, 0.48], mat: 'carton' },
  mixed:    { label: 'อุปกรณ์ไฟฟ้า/ฮาร์ดแวร์ (กล่อง)', short: 'Electrical/HW', mass: 420, he: [0.58, 0.46, 0.48], mat: 'carton' },
  empty:    { label: 'พาเลทพลาสติก/ไม้', short: 'Pallet', mass: 0, he: null, mat: 'wood' },
};
const PAINT_COLORS = [0xef4444, 0x2563eb, 0x16a34a, 0xf59e0b, 0x0f172a, 0xf8fafc, 0x7c3aed];
const CARTON_TINTS = [0xffffff, 0xf3e8d6, 0xe2e8f0, 0xfde68a];
const NEED = {
  cement: { bag: 24 }, mortar: { sack: 24 }, tilefix: { sack: 24 }, aac: { aac: 1, strap: 2 }, brick: { brick: 1, strap: 2 },
  tile: { carton: 16 }, paint: { bucket: 24, lid: 12, carton: 1 }, sanitary: { carton: 8 }, mixed: { carton: 6, bucket: 4, lid: 4 }, empty: {},
};
const used = (pool) => pool.mesh.count - pool.free.length;
const poolFree = (pool) => pool.cap - used(pool);
function poolFits(type) {
  for (const k in NEED[type]) if (poolFree(P[k]) < NEED[type][k] + 20) return false;
  return poolFree(P.wDeck) > 0 || poolFree(P.pDeck) > 0;
}

function buildCargoPools() {
  GEO.bagBox = new THREE.BoxGeometry(0.58, 0.125, 0.43);
  GEO.bagRound = LITE ? GEO.bagBox : new RoundedBoxGeometry(0.58, 0.125, 0.43, 1, 0.045);
  // ถังสี: ไม่มีฝาบน-ล่าง (ฝาถังเป็นชิ้นแยก ก้นถังมองไม่เห็น) ลดจำนวนสามเหลี่ยมบนมือถือ
  GEO.bucket = [LITE ? 6 : 8, 12].map((n) => new THREE.CylinderGeometry(0.15, 0.135, 0.34, n, 1, true));
  GEO.lid = [LITE ? 6 : 8, 12].map((n) => new THREE.CylinderGeometry(0.154, 0.154, 0.028, n));
  const soft = { soft: true }, seg = LITE ? 8 : 12;
  // cap = จำนวนสูงสุดต่อ Pool (จองหน่วยความจำเท่านั้น วาดจริงตามจำนวนที่ใช้) ตั้งเผื่อจากยอดใช้จริงที่ log ตอนจบ initWarehouse
  P.wDeck = new Pool(new THREE.BoxGeometry(1.2, 0.035, 1.0), MAT.wood, 2200);
  P.wRun = new Pool(new THREE.BoxGeometry(1.2, 0.109, 0.1), MAT.woodPlain, 6600, soft);
  P.pDeck = new Pool(new THREE.BoxGeometry(1.2, 0.035, 1.0), MAT.plasticPallet, 900);
  P.pRun = new Pool(new THREE.BoxGeometry(1.2, 0.109, 0.1), MAT.plasticPallet, 2700, soft);
  P.bag = new Pool(GEO.bagBox, MAT.cement, 9000, soft);
  P.sack = new Pool(GEO.bagBox, std(0xffffff, { map: TEX.cement, roughness: 0.92 }), 14000, { colored: true, ...soft });
  P.aac = new Pool(new THREE.BoxGeometry(1.15, 0.95, 0.95), MAT.aac, 500);
  P.brick = new Pool(new THREE.BoxGeometry(1.1, 0.72, 0.92), MAT.brick, 500);
  P.strap = new Pool(new THREE.BoxGeometry(1, 1, 1), std(0x1e293b, { roughness: 0.5 }), 2000, { cast: false });
  P.carton = new Pool(new THREE.BoxGeometry(1, 1, 1), MAT.carton, 20000, { colored: true });
  P.bucket = new Pool(GEO.bucket[1], MAT.bucket, 14000, soft);
  P.lid = new Pool(GEO.lid[1], MAT.lid, 11000, { colored: true, cast: false });
  P.rod = new Pool(new THREE.CylinderGeometry(0.014, 0.014, 6, 6).rotateX(Math.PI / 2), MAT.rebar, 340);
  P.pipe = new Pool(new THREE.CylinderGeometry(0.055, 0.055, 4, seg, 1, true).rotateX(Math.PI / 2), MAT.pvc, 180);
  P.pipeIn = new Pool(new THREE.CylinderGeometry(0.047, 0.047, 3.99, 8).rotateX(Math.PI / 2), MAT.pipeEnd, 180, { cast: false });
  P.skid = new Pool(new THREE.BoxGeometry(1, 1, 1), MAT.woodPlain, 80);
  P.tie = new Pool(new THREE.BoxGeometry(1, 1, 1), MAT.tie, 120, { cast: false });
  SC.box = new Pool(new THREE.BoxGeometry(1, 1, 1), std(0xffffff, { roughness: 0.65, metalness: 0.1 }), 48000, { colored: true, ...soft });
  SC.cyl = new Pool(new THREE.CylinderGeometry(0.5, 0.5, 1, seg), std(0xffffff, { roughness: 0.42, metalness: 0.15 }), 10000, { colored: true, ...soft });
}

export const cargoList = new Set();
let cargoSeq = 1;
/** จำนวนพาเลท/ชิ้นสินค้าที่วางไม่ได้เพราะ Pool เต็ม — ต้องเป็น 0 เสมอ (ตรวจตอนจบ initWarehouse) */
const poolShort = { pallets: 0, items: 0 };

/** พาเลทและมัดสินค้าเป็นของนิ่ง: เขียนตำแหน่งทุกชิ้นลง InstancedMesh ครั้งเดียว ไม่มี physics body ต่อพาเลท จึงไม่กิน CPU ทุกเฟรม */
function registerCargo(c, parts, x, y, z, yaw) {
  _bm.compose(_v.set(x, y, z), _q.setFromAxisAngle(_v2.set(0, 1, 0), yaw), _s.set(1, 1, 1));
  for (const p of parts) {
    const idx = p.pool.alloc();
    if (p.color) p.pool.color(idx, p.color);
    p.pool.set(idx, _m.multiplyMatrices(_bm, p.local));
  }
  c.id = `PL-${4000 + cargoSeq++}`;
  cargoList.add(c);
  return c;
}

/** สร้างพาเลทสินค้า 1 ใบ · opts.layers = จำนวนชั้นถุง (1-6) · opts.stack = จำนวนพาเลทเปล่าที่ซ้อนกัน (เฉพาะ type 'empty') */
export function makePallet(type, x, z, yaw, supportY = 0, opts = {}) {
  if (CARGO_TYPES[type] && !poolFits(type)) poolShort.pallets++;
  if (!CARGO_TYPES[type] || !poolFits(type)) type = 'empty';
  const spec = CARGO_TYPES[type];
  let plastic = opts.plastic ?? rng() < 0.25;
  if (poolFree(plastic ? P.pDeck : P.wDeck) < 1) plastic = !plastic;
  const layers = spec.bags ? clamp(opts.layers ?? 6, 1, 6) : 0;
  const he = layers && layers < 6 ? [spec.he[0], layers * 0.064 + 0.006, spec.he[2]] : spec.he;
  const loadCy = he ? 0.144 + he[1] : 0;
  const T = (lx, ly, lz, sx = 1, sy = 1, sz = 1, ry = 0) => M4(lx, ly, lz, sx, sy, sz, 0, ry, 0);
  const parts = [];
  for (let k = 0; k < (type === 'empty' ? opts.stack || 1 : 1); k++) {
    parts.push({ pool: plastic ? P.pDeck : P.wDeck, local: T(0, 0.1265 + k * 0.144, 0) });
    for (const rz of [-0.45, 0, 0.45]) parts.push({ pool: plastic ? P.pRun : P.wRun, local: T(0, 0.0545 + k * 0.144, rz) });
  }
  if (spec.bags) {
    const pool = P[spec.bags], tint = spec.tints ? new THREE.Color(pick(spec.tints)) : null;
    for (let k = 0; k < layers; k++) for (let i = 0; i < 4; i++) {
      const bx = (i % 2 ? 0.295 : -0.295) + rand(-0.01, 0.01), bz = (i < 2 ? 0.218 : -0.218) + rand(-0.01, 0.01);
      parts.push({ pool, color: tint, local: M4(bx, 0.144 + 0.0625 + k * 0.128, bz, 1, 1, 1, 0, rand(-0.03, 0.03) + (k % 2 ? Math.PI : 0), 0) });
    }
  } else if (type === 'aac' || type === 'brick') {
    const pool = type === 'aac' ? P.aac : P.brick;
    parts.push({ pool, local: T(0, loadCy, 0) });
    for (const sz of [-0.25, 0.25]) parts.push({ pool: P.strap, local: T(0, loadCy, sz * he[2] * 1.6, he[0] * 2 + 0.012, he[1] * 2 + 0.012, 0.03) });
  } else if (type === 'tile') {
    const tint = new THREE.Color(pick(CARTON_TINTS));
    for (let i = 0; i < 2; i++) for (let k = 0; k < 8; k++)
      parts.push({ pool: P.carton, color: tint, local: T(i ? 0.3 : -0.3, 0.144 + 0.0425 + k * 0.085, 0, 0.585, 0.083, 0.6, rand(-0.02, 0.02)) });
  } else if (type === 'paint') {
    const col = new THREE.Color(pick(PAINT_COLORS));
    for (let k = 0; k < 2; k++) for (let i = 0; i < 12; i++) {
      const bx = -0.45 + (i % 4) * 0.3, bz = -0.3 + Math.floor(i / 4) * 0.3, by = 0.144 + 0.17 + k * 0.36;
      parts.push({ pool: P.bucket, local: T(bx, by, bz) });
      if (k) parts.push({ pool: P.lid, color: col, local: T(bx, by + 0.184, bz) });
    }
    parts.push({ pool: P.carton, color: new THREE.Color(0xd6c9b0), local: T(0, 0.144 + 0.35, 0, 1.19, 0.014, 0.9) });
  } else if (type === 'sanitary') {
    for (let k = 0; k < 2; k++) for (let i = 0; i < 4; i++)
      parts.push({ pool: P.carton, color: new THREE.Color(pick(CARTON_TINTS)), local: T(i % 2 ? 0.29 : -0.29, 0.144 + 0.225 + k * 0.452, i < 2 ? 0.24 : -0.24, 0.56, 0.45, 0.46) });
  } else if (type === 'mixed') {
    for (let i = 0; i < 4; i++) parts.push({ pool: P.carton, color: new THREE.Color(pick(CARTON_TINTS)), local: T(i % 2 ? 0.29 : -0.29, 0.144 + 0.22, i < 2 ? 0.236 : -0.236, 0.56, 0.43, 0.455) });
    for (let i = 0; i < 2; i++) parts.push({ pool: P.carton, color: new THREE.Color(pick(CARTON_TINTS)), local: T(0.29, 0.584 + 0.17, i ? 0.236 : -0.236, 0.54, 0.34, 0.44) });
    for (let i = 0; i < 4; i++) {
      const bx = i % 2 ? -0.14 : -0.44, bz = i < 2 ? 0.24 : -0.24, col = new THREE.Color(pick(PAINT_COLORS));
      parts.push({ pool: P.bucket, local: T(bx, 0.584 + 0.17, bz) }, { pool: P.lid, color: col, local: T(bx, 0.584 + 0.354, bz) });
    }
  }
  return registerCargo({ type, kind: 'pallet', label: spec.label, short: spec.short, he }, parts, x, supportY + 0.003, z, yaw);
}

/** มัดของยาว (เหล็กเส้น 6 ม. / ท่อ PVC 4 ม.) วางบนหมอนไม้ · baseY = ความสูงฐานเมื่อวางซ้อนชั้น */
function makeBundle(kind, x, z, yaw, baseY = 0) {
  const rebar = kind === 'rebar', hx = rebar ? 0.11 : 0.23, hy = rebar ? 0.1 : 0.17, skidZ = rebar ? 2.0 : 1.4;
  const parts = [];
  for (const sz of [-skidZ, skidZ]) parts.push({ pool: P.skid, local: M4(0, 0.05, sz, 0.64, 0.1, 0.12) });
  if (rebar) {
    const pts = [[0, 0]];
    for (let ring = 1; ring <= 3; ring++) for (let k = 0; k < ring * 6; k++) {
      const side = Math.floor(k / ring), t = (k % ring) / ring, a0 = side * Math.PI / 3, a1 = a0 + Math.PI / 3;
      pts.push([ring * 0.03 * lerp(Math.cos(a0), Math.cos(a1), t), ring * 0.03 * lerp(Math.sin(a0), Math.sin(a1), t)]);
    }
    for (const [px, py] of pts) parts.push({ pool: P.rod, local: M4(px * 1.1, 0.1 + hy + py, 0) });
    for (const sz of [-2.4, -0.8, 0.8, 2.4]) parts.push({ pool: P.tie, local: M4(0, 0.1 + hy, sz, 0.24, 0.22, 0.03) });
  } else {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      const px = -0.165 + i * 0.11, py = 0.1 + 0.058 + j * 0.112;
      parts.push({ pool: P.pipe, local: M4(px, py, 0) }, { pool: P.pipeIn, local: M4(px, py, 0) });
    }
    for (const sz of [-1.2, 0, 1.2]) parts.push({ pool: P.tie, local: M4(0, 0.1 + hy, sz, hx * 2 + 0.02, hy * 2 + 0.02, 0.025) });
  }
  return registerCargo({ type: kind, kind: 'bundle', height: 0.1 + hy * 2 }, parts, x, baseY + 0.003, z, yaw);
}

/* =====================================================================
   6. RETAIL SHELVING · SHOWROOM · PROMOTION STACKS · BULK · PIPE/STEEL YARD
   ===================================================================== */
const _col = new THREE.Color(), _e = new THREE.Euler();
function put(pool, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, color = null, rx = 0, rz = 0) {
  if (poolFree(pool) < 1) { poolShort.items++; return; }
  const i = pool.alloc();
  pool.set(i, _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz)));
  if (color != null) pool.color(i, _col.set(color));
}

/** ป้ายแขวน 2 หน้า: อ่านได้ถูกด้านจากทั้งสองฝั่งทางเดิน */
function hangSign(main, sub, w, h, bg, x, y, z, res = 512) {
  const front = signPlane(main, sub, w, h, bg, '#ffffff', res);
  front.position.set(x, y, z);
  const back = front.clone();
  back.rotation.y = Math.PI;
  scene.add(front, back);
}

const PAL = {
  elec: [0xf8fafc, 0xdc2626, 0xf59e0b, 0x0f172a, 0x2563eb, 0x16a34a],
  wire: [0xf8fafc, 0x1e293b, 0x2563eb, 0xef4444, 0x16a34a, 0xfacc15],
  led: [0xfef3c7, 0xfde68a, 0xf8fafc, 0x38bdf8, 0xfb923c],
  plumb: [0x1e60c9, 0xf8fafc, 0x94a3b8, 0xb45309, 0x0ea5e9],
  tool: [0x0f766e, 0xf59e0b, 0xdc2626, 0x1e293b, 0x2563eb, 0x16a34a],
  screw: [0xf8fafc, 0x38bdf8, 0xfacc15, 0xf97316, 0x64748b],
  paint: PAINT_COLORS,
  green: [0x16a34a, 0x65a30d, 0x15803d, 0xa16207, 0x92400e, 0x0ea5e9],
  home: [0xf8fafc, 0xfda4af, 0x93c5fd, 0xa7f3d0, 0xfde68a, 0xc4b5fd],
  metal: [0xcbd5e1, 0xe5e7eb, 0x94a3b8, 0xfbbf24, 0x1f2937],
  clay: [0xb45309, 0x9a3412, 0x78350f, 0xf8fafc, 0x475569],
};
// รูปทรงสินค้าบนชั้น: B = กล่อง, C = ทรงกระบอกตั้ง (ขดสายไฟ ขวด กระถาง), R = ม้วนนอน, K = ถังสีแกลลอน · n = จำนวนหน้าสินค้าต่อชั้น
const B = (n, h0, h1, pal, stack = 1) => ({ k: 'box', n, h0, h1, pal, stack });
const C = (n, h0, h1, pal, d = 0.26, stack = 1) => ({ k: 'cyl', n, h0, h1, pal, d, stack });
const R = (n, d, pal) => ({ k: 'roll', n, d, pal });
const K = (n) => ({ k: 'can', n, pal: PAINT_COLORS });
/** รูปแบบสินค้า 5 ชั้น (ล่าง → บน) ของเชลฟ์แต่ละหมวด — key ตรงกับ style ใน layout.js */
const SHELF_STYLES = {
  breaker: [B(5, 0.3, 0.38, PAL.elec), B(6, 0.26, 0.34, PAL.elec), B(9, 0.16, 0.24, PAL.elec), B(12, 0.12, 0.18, PAL.elec), B(8, 0.2, 0.3, PAL.elec)],
  wire: [C(7, 0.1, 0.1, PAL.wire, 0.26, 3), C(7, 0.1, 0.1, PAL.wire, 0.26, 3), C(7, 0.1, 0.1, PAL.wire, 0.26, 3), C(7, 0.1, 0.1, PAL.wire, 0.26, 3), B(10, 0.14, 0.2, PAL.wire)],
  led: [B(6, 0.3, 0.38, PAL.led), B(8, 0.22, 0.3, PAL.led), B(12, 0.14, 0.2, PAL.led), B(14, 0.12, 0.16, PAL.led), B(7, 0.26, 0.36, PAL.led)],
  plumb: [C(6, 0.3, 0.36, PAL.plumb), B(7, 0.24, 0.32, PAL.plumb), B(11, 0.14, 0.2, PAL.plumb), C(9, 0.16, 0.22, PAL.plumb, 0.18), B(9, 0.18, 0.26, PAL.plumb)],
  tool: [B(4, 0.32, 0.38, PAL.tool), B(5, 0.28, 0.36, PAL.tool), B(6, 0.24, 0.3, PAL.tool), B(8, 0.18, 0.26, PAL.tool), B(10, 0.14, 0.2, PAL.tool)],
  handtool: [B(8, 0.2, 0.3, PAL.tool), B(12, 0.3, 0.38, PAL.tool), B(14, 0.28, 0.36, PAL.tool), B(12, 0.22, 0.3, PAL.tool), B(10, 0.16, 0.22, PAL.tool)],
  screw: [B(8, 0.16, 0.2, PAL.screw, 2), B(10, 0.12, 0.16, PAL.screw, 2), B(12, 0.1, 0.13, PAL.screw, 3), B(14, 0.09, 0.11, PAL.screw, 3), B(12, 0.1, 0.14, PAL.screw, 2)],
  paint: [K(7), K(7), K(7), C(10, 0.2, 0.26, PAL.paint, 0.17), B(9, 0.18, 0.26, PAL.paint)],
  appliance: [B(4, 0.34, 0.4, PAL.home), B(4, 0.34, 0.4, PAL.home), B(5, 0.3, 0.38, PAL.home), B(6, 0.26, 0.34, PAL.home), B(7, 0.22, 0.3, PAL.home)],
  machine: [B(3, 0.36, 0.4, PAL.tool), B(4, 0.34, 0.4, PAL.tool), B(4, 0.3, 0.38, PAL.tool), B(5, 0.28, 0.36, PAL.tool), B(6, 0.24, 0.3, PAL.tool)],
  garden: [B(10, 0.3, 0.4, PAL.green), B(12, 0.3, 0.4, PAL.green), B(9, 0.2, 0.3, PAL.green), B(8, 0.2, 0.26, PAL.green), B(10, 0.16, 0.22, PAL.green)],
  hose: [C(7, 0.12, 0.14, PAL.green, 0.26, 2), C(7, 0.12, 0.14, PAL.green, 0.26, 2), B(9, 0.2, 0.28, PAL.green), C(9, 0.2, 0.3, PAL.green, 0.18), B(10, 0.16, 0.22, PAL.green)],
  sack: [B(4, 0.1, 0.11, PAL.green, 3), B(4, 0.1, 0.11, PAL.green, 3), B(5, 0.09, 0.1, PAL.green, 3), B(6, 0.16, 0.22, PAL.green), B(8, 0.14, 0.2, PAL.green)],
  roll: [R(3, 0.26, PAL.green), R(3, 0.24, PAL.home), R(4, 0.22, PAL.green), R(4, 0.2, PAL.home), R(5, 0.18, PAL.green)],
  pot: [C(6, 0.24, 0.3, PAL.clay), C(7, 0.2, 0.26, PAL.clay), C(7, 0.18, 0.24, PAL.clay), C(9, 0.14, 0.2, PAL.clay, 0.18), C(9, 0.12, 0.16, PAL.clay, 0.18)],
  home: [B(4, 0.34, 0.4, PAL.home), B(4, 0.3, 0.38, PAL.home), B(5, 0.28, 0.34, PAL.home), B(6, 0.22, 0.3, PAL.home), B(7, 0.2, 0.26, PAL.home)],
  clean: [C(10, 0.34, 0.4, PAL.home, 0.12), B(8, 0.26, 0.34, PAL.home), B(8, 0.22, 0.3, PAL.home), B(9, 0.18, 0.24, PAL.home), B(10, 0.16, 0.2, PAL.home)],
  bottle: [C(10, 0.24, 0.3, PAL.home, 0.16), C(11, 0.22, 0.28, PAL.home, 0.15), C(12, 0.2, 0.26, PAL.home, 0.13), C(13, 0.16, 0.22, PAL.home, 0.12), B(10, 0.14, 0.2, PAL.home)],
  faucet: [B(7, 0.26, 0.34, PAL.metal), B(8, 0.24, 0.3, PAL.metal), B(9, 0.2, 0.28, PAL.metal), B(10, 0.18, 0.24, PAL.metal), B(12, 0.14, 0.2, PAL.metal)],
  lock: [B(10, 0.16, 0.22, PAL.metal), B(12, 0.14, 0.2, PAL.metal), B(14, 0.12, 0.16, PAL.metal), B(14, 0.12, 0.16, PAL.metal), B(12, 0.14, 0.18, PAL.metal)],
};
const SHELF_LEVELS = 5, SHELF_POST_H = 2.5;
const shelfY = (l) => 0.12 + l * 0.46;

/** เรียงสินค้าเต็มชั้น 1 ชั้นทั้งแถวหน้าและแถวหลัง ไม่มีช่องว่าง: จัดเป็นกลุ่มรุ่นสินค้า (สี/ขนาดเดียวกัน 1-3 หน้า) เหมือนการเรียงสินค้าจริง */
function fillShelfLevel(spec, cx, y, z) {
  const pitch = 1.88 / spec.n, x0 = cx - 0.94 + pitch / 2, top = y + 0.015;
  for (const dz of [-0.145, 0.145]) {
    let left = 0, col = 0, h = 0;
    for (let i = 0; i < spec.n; i++) {
      if (left-- <= 0) { left = (rng() * 3) | 0; col = pick(spec.pal); h = rand(spec.h0 || 0, spec.h1 || 0); }
      const x = x0 + i * pitch;
      if (spec.k === 'box') {
        for (let s = 0; s < spec.stack; s++) put(SC.box, x, top + h * (s + 0.5), z + dz, pitch - 0.02, h - 0.004, 0.26, 0, col);
      } else if (spec.k === 'cyl') {
        const d = Math.min(pitch - 0.02, spec.d);
        for (let s = 0; s < spec.stack; s++) put(SC.cyl, x, top + h * (s + 0.5), z + dz, d, h - 0.004, d, 0, col);
      } else if (spec.k === 'roll') {
        put(SC.cyl, x, top + spec.d / 2, z + dz, spec.d, pitch - 0.03, spec.d, 0, col, 0, Math.PI / 2);
      } else {
        const s = Math.min(0.86, (pitch - 0.015) / 0.3);
        put(P.bucket, x, top + 0.17 * s, z + dz, s, s, s);
        put(P.lid, x, top + 0.354 * s, z + dz, s, s, s, 0, col);
      }
    }
  }
}

/** เชลฟ์ 5 ชั้น 1 บล็อก (ทุกตู้ ทุกชั้น เต็ม 100%) + ป้ายหมวดเหนือแต่ละแถว */
function buildShelfBlock(code, block, accent) {
  const len = block.bays * SHELF_BAY, xm = block.x0 + len / 2;
  block.rows.forEach((row, ri) => {
    const style = SHELF_STYLES[row.style];
    for (let u = 0; u < block.bays; u++) {
      const cx = block.x0 + (u + 0.5) * SHELF_BAY;
      for (const px of [-0.98, 0.98]) for (const pz of [-0.28, 0.28]) put(SC.box, cx + px, SHELF_POST_H / 2, row.z + pz, 0.04, SHELF_POST_H, 0.04, 0, 0x1e40af);
      put(SC.box, cx, SHELF_POST_H - 0.05, row.z, 1.96, 0.1, 0.6, 0, accent);
      for (let l = 0; l < SHELF_LEVELS; l++) {
        const y = shelfY(l);
        put(SC.box, cx, y, row.z, 1.96, 0.03, 0.58, 0, 0xe2e8f0);
        for (const s of [-1, 1]) put(SC.box, cx, y - 0.005, row.z + s * 0.295, 1.94, 0.04, 0.012, 0, 0xfef08a);
        fillShelfLevel(style[l], cx, y, row.z);
      }
    }
    hangSign(`${code}${ri + 1} · ${row.title}`, null, Math.min(len - 0.6, 6.4), 0.5, '#' + accent.toString(16).padStart(6, '0'), xm, SHELF_POST_H + 0.42, row.z);
  });
}

const TILE_COLORS = [0xe7e5e4, 0xd6d3d1, 0x78716c, 0xfafaf9, 0xa8a29e, 0x44403c, 0xc2b8a3, 0x94a3b8, 0x7c5a3c, 0xb08968];
const WOOD_COLORS = [0x8b5e3c, 0xb08968, 0x3f3f46, 0xe7e5e4];
/** โชว์รูมสุขภัณฑ์-กระเบื้อง: แผงโชว์ 2 ด้าน เต็มทุกช่อง */
function buildShowroom() {
  const b = SHOWROOM, len = b.bays * SHELF_BAY, xm = b.x0 + len / 2;
  b.rows.forEach((row, ri) => {
    const z = row.z;
    if (row.style === 'tile') put(SC.box, xm, 1.15, z, len, 2.3, 0.1, 0, 0x334155);
    else { put(SC.box, xm, 0.06, z, len, 0.12, 1.5, 0, 0xf1f5f9); put(SC.box, xm, 1.0, z, len, 1.76, 0.06, 0, 0x475569); }
    for (let u = 0; u < b.bays; u++) for (const s of [-1, 1]) {
      const cx = b.x0 + (u + 0.5) * SHELF_BAY;
      if (row.style === 'tile') {
        for (let i = 0; i < 3; i++) {
          const x = cx - 0.64 + i * 0.64, col = pick(TILE_COLORS), n = 4 + ((rng() * 4) | 0);
          for (let j = 0; j < 2; j++) put(SC.box, x, 1.05 + j * 0.64, z + s * 0.06, 0.6, 0.6, 0.02, 0, col);
          for (let k = 0; k < n; k++) put(P.carton, x, 0.0425 + k * 0.085, z + s * 0.42, 0.6, 0.083, 0.6, 0, pick(CARTON_TINTS));
        }
      } else if (row.style === 'bath') {
        put(SC.box, cx, 0.4, z + s * 0.42, 1.7, 0.56, 0.7, 0, 0xffffff);
        put(SC.box, cx, 0.685, z + s * 0.42, 1.5, 0.012, 0.5, 0, 0xbae6fd);
        put(SC.cyl, cx - 0.72, 0.8, z + s * 0.42, 0.035, 0.24, 0.035, 0, 0xcbd5e1);
      } else for (const dx of [-0.5, 0.5]) {
        const x = cx + dx;
        if (row.style === 'toilet') {
          put(SC.cyl, x, 0.32, z + s * 0.44, 0.36, 0.4, 0.46, 0, 0xffffff);
          put(SC.cyl, x, 0.535, z + s * 0.44, 0.38, 0.03, 0.48, 0, pick([0xffffff, 0xe2e8f0, 0x1f2937]));
          put(SC.box, x, 0.68, z + s * 0.14, 0.38, 0.36, 0.16, 0, 0xffffff);
        } else {
          put(SC.box, x, 0.48, z + s * 0.3, 0.8, 0.72, 0.46, 0, pick(WOOD_COLORS));
          put(SC.cyl, x, 0.9, z + s * 0.32, 0.42, 0.12, 0.34, 0, 0xffffff);
          put(SC.cyl, x, 1.0, z + s * 0.12, 0.03, 0.2, 0.03, 0, 0xcbd5e1);
          put(SC.box, x, 1.45, z + s * 0.045, 0.6, 0.7, 0.02, 0, 0xbae6fd);
        }
      }
    }
    hangSign(`TS${ri + 1} · ${row.title}`, null, 6.4, 0.5, '#0e7490', xm, 2.75, z);
  });
}

/** กองพาเลทสินค้าจัดรายการ (PM-01..PM-64) ซ้อน 2 ชั้น + ป้ายราคาหันเข้าซอยเดิน */
function buildPromoStacks() {
  for (const sp of PROMO_SPOTS) {
    const lo = makePallet(sp.type, sp.x, sp.z, 0, 0, { plastic: true });
    if (lo.he) makePallet(sp.type, sp.x, sp.z, 0, 0.144 + lo.he[1] * 2, { plastic: true, layers: 4 });
    if (sp.standZ == null) continue;
    const s = Math.sign(sp.standZ - sp.z);
    put(SC.box, sp.x, 1.2, sp.z + s * 0.52, 0.62, 0.36, 0.014, 0, 0xfacc15);
    put(SC.box, sp.x, 1.33, sp.z + s * 0.528, 0.62, 0.1, 0.014, 0, 0xdc2626);
  }
}

const BULK_TYPES = ['cement', 'aac', 'mortar', 'brick', 'tile', 'tilefix', 'sanitary'];
function buildSceneryAndBulk() {
  buildShelfBlock('SH', SHELF_BLOCKS.SH, 0xd97706);
  buildShelfBlock('TG', SHELF_BLOCKS.TG, 0xc2410c);
  buildShelfBlock('GD', SHELF_BLOCKS.GD, 0x15803d);
  buildShelfBlock('HM', SHELF_BLOCKS.HM, 0xbe185d);
  buildShowroom();
  buildPromoStacks();

  // โซนท่อประปา ท่อไฟเหลือง/ขาว เหล็กกล่อง แผ่นบอร์ด หลังคา ถังน้ำ
  const LONG_GOODS = [
    [0x1e60c9, 0.11, 4, 0], [0x1e60c9, 0.06, 4, 0], [0xfacc15, 0.035, 4, 0], [0xf8fafc, 0.035, 4, 0],
    [0xc7cdd6, 0.06, 6, 0], [0x1f2937, 0.055, 6, 1], [0x334155, 0.075, 6, 1],
  ];
  for (const zc of [-13.9, -9.3]) {
    const xa = 32.2, xb = 44.2, LV = [0.55, 1.25, 1.95, 2.65];
    for (let x = xa; x <= xb + 0.01; x += 2.0) {
      put(SC.box, x, 1.7, zc, 0.14, 3.4, 0.2, 0, 0x1d4ed8);
      put(SC.box, x, 0.06, zc, 0.16, 0.12, 2.3, 0, 0x1d4ed8);
      for (const y of LV) put(SC.box, x, y, zc, 0.08, 0.1, 2.2, 0, 0xf97316);
    }
    for (const y of LV) for (const side of [-1, 1]) {
      let x = xa - 0.2;
      while (x < xb - 2) {
        const [col, d, len, sq] = zc < -11 ? LONG_GOODS[(rng() * 4) | 0] : LONG_GOODS[4 + ((rng() * 3) | 0)];
        const cnt = Math.min(10, Math.floor(0.78 / d));
        for (let i = 0; i < cnt; i++) {
          const px = x + len / 2, py = y + 0.05 + d / 2, pz = zc + side * (0.18 + (i + 0.5) * d);
          if (sq) put(SC.box, px, py, pz, len, d, d, 0, col); else put(SC.cyl, px, py, pz, d, len, d, 0, col, 0, Math.PI / 2);
        }
        x += len + 0.2;
      }
    }
  }

  // แผ่นบอร์ด A-Frame (ยิปซั่ม/สมาร์ทบอร์ด/ไม้อัด)
  for (const cx of [33.4, 36.6, 39.8]) {
    put(SC.box, cx, 0.05, -5.3, 2.3, 0.1, 1.3, 0, 0x334155);
    put(SC.box, cx, 0.75, -5.3, 2.3, 1.3, 0.05, 0, 0x334155);
    for (const side of [-1, 1]) {
      put(SC.box, cx, 0.71, -5.3 + side * 0.22, 2.44, 1.22, 0.18, 0, pick([0xe7e5e4, 0xd6d3d1, 0xc9a26b]), -side * 0.15);
    }
  }

  // กองหลังคาเมทัลชีท
  for (const [cx, cz] of [[44.3, -4.0], [44.2, -5.15]]) {
    for (const dx of [-1.6, 0, 1.6]) put(SC.box, cx + dx, 0.05, cz, 0.1, 0.1, 0.84, 0, 0x8b6b43);
    put(SC.box, cx, 0.22, cz, 4.5, 0.24, 0.78, 0, cz > -4.5 ? 0x1d4ed8 : 0xb91c1c);
  }

  // ถังเก็บน้ำ DOS
  for (let i = 0; i < 10; i++) {
    const x = i % 2 ? 46.7 : 45.5, z = -14.3 + Math.floor(i / 2) * 1.35, h = i % 2 ? 1.7 : 1.4, d = 1.05;
    put(SC.cyl, x, h / 2, z, d, h, d, 0, pick([0xd6c7a1, 0x2563eb, 0x6b7280, 0x0f766e]));
    put(SC.cyl, x, h + 0.04, z, 0.42, 0.08, 0.42, 0, 0x1f2937);
  }

  // กองพื้น BULK STORAGE 7 บล็อก (BK-01..BK-07): ทุกแถว ทุกคอลัมน์ ซ้อน 2 ชั้น ไม่เว้นช่อง
  const A = AREA.bulk;
  BULK_TYPES.forEach((type, b) => {
    for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++) {
      const x = A.x0 + 0.8 + c * 1.35, z = A.z0 + 0.8 + b * 7.05 + r * 1.2;
      const lo = makePallet(type, x, z, rand(-0.04, 0.04), 0, { plastic: false });
      if (lo.he) makePallet(type, x, z, rand(-0.04, 0.04), 0.144 + lo.he[1] * 2, { plastic: false, layers: 4 });
    }
  });

  // โซนของยาว LONG GOODS เต็มตลอดแนวกว้าง: เหล็กเส้น 4 แถว + ท่อ PVC 3 แถว × 2 กอง ซ้อน 2 ชั้น + ม้วนตะแกรงไวร์เมชหัว-ท้ายโซน
  for (const z of [10.65, 11.3, 11.95, 12.6]) for (let k = 0; k < 2; k++) makeBundle('rebar', -19.0, z, Math.PI / 2, k * 0.3);
  for (const x of [-21.9, -17.3]) for (const z of [13.6, 14.3, 15.0]) for (let k = 0; k < 2; k++) makeBundle('pvc', x, z, Math.PI / 2, k * 0.44);
  for (const x of [-23.75, -22.9, -15.1, -14.25]) for (const z of [10.5, 11.3, 12.1, 12.9]) {
    put(SC.cyl, x, 0.55, z, 0.66, 1.1, 0.66, 0, 0x9ca3af);
    put(SC.cyl, x, 0.55, z, 0.3, 1.12, 0.3, 0, 0x374151);
  }
}

/* =====================================================================
   7. CUSTOMER AVATAR · SHOPPING CART · EYE-VIEW BUILDING SHELL
   ===================================================================== */
const WK = {
  leg: new THREE.CapsuleGeometry(0.078, 0.74, 4, 10).translate(0, -0.45, 0),
  shoe: new THREE.BoxGeometry(0.25, 0.07, 0.12).translate(0.05, -0.89, 0),
  torso: new THREE.CapsuleGeometry(0.17, 0.34, 4, 14),
  arm: new THREE.CapsuleGeometry(0.05, 0.5, 4, 8).translate(0, -0.3, 0),
  head: new THREE.SphereGeometry(0.108, 16, 12),
  hat: new THREE.SphereGeometry(0.126, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  skin: std(0xc99a74, { roughness: 0.7 }),
  pants: std(0x334155, { roughness: 0.8 }),
};

/** สร้างโมเดลคน 3 มิติ (อวตารลูกค้า) — หันหน้าไปทางแกน +x ของ group */
export function createPersonRig({ shirtColor = 0x1e3a8a, hatColor = null } = {}) {
  const g = new THREE.Group();
  const add = (geo, mat, parent) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; parent.add(m); return m; };
  const hip = 0.93;
  const legs = [-0.1, 0.1].map((lz) => {
    const p = new THREE.Group(); p.position.set(0, hip, lz);
    add(WK.leg, WK.pants, p); add(WK.shoe, std(0x111827), p); g.add(p); return p;
  });
  const upper = new THREE.Group(); upper.position.y = hip; g.add(upper);
  const torso = add(WK.torso, std(shirtColor, { roughness: 0.6 }), upper);
  torso.position.y = 0.35; torso.scale.set(0.78, 1, 1.12);
  add(WK.head, WK.skin, upper).position.y = 0.8;
  if (hatColor != null) add(WK.hat, std(hatColor, { roughness: 0.35 }), upper).position.y = 0.83;
  const arms = [-0.235, 0.235].map((lz) => {
    const p = new THREE.Group(); p.position.set(0, 0.6, lz);
    add(WK.arm, std(shirtColor, { roughness: 0.7 }), p); upper.add(p); return p;
  });
  return { group: g, legs, arms, upper };
}

/** รถเข็นช้อปปิ้งของลูกค้า — หันหน้าไปทางแกน +x (มือจับอยู่ฝั่ง -x) จุดอ้างอิงอยู่กึ่งกลางตะกร้าที่ระดับพื้น */
export function createShoppingCart() {
  const bar = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const frame = [bar(0.8, 0.02, 0.5, 0, 0.5, 0), bar(0.78, 0.02, 0.46, 0, 0.17, 0)];
  for (const y of [0.92, 0.71]) {
    for (const z of [-0.25, 0.25]) frame.push(bar(0.84, 0.022, 0.022, 0, y, z));
    for (const x of [-0.41, 0.41]) frame.push(bar(0.022, 0.022, 0.5, x, y, 0));
  }
  for (let i = 0; i <= 8; i++) for (const z of [-0.25, 0.25]) frame.push(bar(0.012, 0.42, 0.012, -0.41 + i * 0.1025, 0.71, z));
  for (let i = 1; i < 5; i++) for (const x of [-0.41, 0.41]) frame.push(bar(0.012, 0.42, 0.012, x, 0.71, -0.25 + i * 0.1));
  for (const x of [-0.36, 0.36]) for (const z of [-0.21, 0.21]) frame.push(bar(0.025, 0.42, 0.025, x, 0.3, z));
  for (const z of [-0.25, 0.25]) frame.push(bar(0.022, 0.14, 0.022, -0.41, 0.98, z), bar(0.14, 0.022, 0.022, -0.47, 1.04, z));
  const wheels = [];
  for (const x of [-0.36, 0.36]) for (const z of [-0.21, 0.21]) wheels.push(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10).rotateX(Math.PI / 2).translate(x, 0.05, z));
  const g = new THREE.Group();
  g.add(
    new THREE.Mesh(mergeGeometries(frame), std(0xd1d5db, { roughness: 0.3, metalness: 0.85 })),
    new THREE.Mesh(bar(0.036, 0.036, 0.56, -0.54, 1.04, 0), std(0x2563eb, { roughness: 0.4 })),
    new THREE.Mesh(mergeGeometries(wheels), std(0x111827, { roughness: 0.9 })),
  );
  return g;
}

/** เปลือกอาคารสำหรับมุมมองสายตาลูกค้า (หลังคา ผนังเต็มความสูง โครงหลังคา โคมไฮเบย์) — ซ่อนในมุมมองจากด้านบนเพื่อไม่บังผังคลัง */
const eyeShell = new THREE.Group();
function buildEyeShell() {
  const fw = W.X1 - W.X0, fd = W.Z1 - W.Z0, cxm = (W.X0 + W.X1) / 2, czm = (W.Z0 + W.Z1) / 2, H = WALL_H, sideH = 4.18;
  const wallMat = std(0xeef2f7, { roughness: 0.85 }), trussMat = std(0x94a3b8, { roughness: 0.5, metalness: 0.5 });
  const box = (w, h, d, mat, x, y, z) => meshBox(w, h, d, mat, x, y, z, eyeShell, false);
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(fw + 0.6, fd + 0.6).rotateX(Math.PI / 2), std(0xdde3ea, { roughness: 0.7, metalness: 0.25 }));
  roof.position.set(cxm, H + 0.02, czm);
  eyeShell.add(roof);
  // ผนังทิศใต้ เว้นช่องประตูทางเข้าลูกค้า (x = 16.25..20.75 สูง 3.97 ม.)
  const sz = W.Z1 + 0.27, doorX0 = 16.25, doorX1 = 20.75, doorTop = 3.97;
  box(doorX0 - (W.X0 - 0.3), H, 0.3, wallMat, (doorX0 + W.X0 - 0.3) / 2, H / 2, sz);
  box(W.X1 + 0.3 - doorX1, H, 0.3, wallMat, (doorX1 + W.X1 + 0.3) / 2, H / 2, sz);
  box(doorX1 - doorX0, H - doorTop, 0.3, wallMat, (doorX0 + doorX1) / 2, (H + doorTop) / 2, sz);
  box(0.3, H, fd + 0.6, wallMat, W.X1 + 0.27, H / 2, czm);
  box(0.3, H - sideH, fd + 0.6, wallMat, W.X0 - 0.15, (H + sideH) / 2, czm);
  for (let z = W.Z0 + 6; z < W.Z1; z += 12) box(fw, 0.3, 0.16, trussMat, cxm, H - 0.4, z);
  for (let x = W.X0 + 7.9; x < W.X1; x += 15.8) box(0.16, 0.22, fd, trussMat, x, H - 0.16, czm);
  const xs = [], zs = [];
  for (let x = W.X0 + 4.6; x < W.X1; x += 10) xs.push(x);
  for (let z = W.Z0 + 4.5; z < W.Z1; z += 8.4) zs.push(z);
  const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(1.3, 0.07, 0.34),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.25 }), xs.length * zs.length);
  let n = 0;
  for (const x of xs) for (const z of zs) lamps.setMatrixAt(n++, _m.makeTranslation(x, H - 0.72, z));
  eyeShell.add(lamps);
  eyeShell.visible = false;
  scene.add(eyeShell);
}
export function setEyeViewScene(on) { eyeShell.visible = on; }

export function animatePersonRig(rig, speed, phase) {
  const k = clamp(speed / 1.2, 0, 1);
  const s = Math.sin(phase) * 0.55 * k;
  rig.legs[0].rotation.z = s; rig.legs[1].rotation.z = -s;
  rig.arms[0].rotation.z = -s * 0.75; rig.arms[1].rotation.z = s * 0.75;
  rig.upper.rotation.z = -k * 0.05;
  rig.group.position.y = Math.abs(Math.cos(phase)) * 0.022 * k;
}

export function cargoAtSlot(c, s) {
  return !!(c && s && cargoList.has(c));
}
export function placeAt(s, c) { s.cargo = c; c.slot = s; return c; }

/** เติมสต็อกพาเลทให้เต็มชั้นวางทุกช่อง (1,104 ช่อง ทั้ง 3 ระดับ ไม่เว้น) · rackTypes = ชนิดสินค้าที่ catalog กำหนดไว้ต่อช่อง (Map slotId → cargoType) */
const STOCK_MIX = ['cement', 'mortar', 'tilefix', 'aac', 'brick', 'tile', 'paint', 'sanitary', 'mixed', 'mixed'];
function populateRackStock(rackTypes) {
  const light = ['tilefix', 'paint', 'sanitary', 'mixed'];
  for (const s of RACK_SLOTS) {
    if (s.cargo) continue;
    let type = rackTypes && rackTypes.get(s.id);
    if (!type || type === 'empty' || !CARGO_TYPES[type]) {
      type = pick(STOCK_MIX);
      if (CARGO_TYPES[type].heavy && s.level > 1) type = pick(light);
    }
    placeAt(s, makePallet(type, s.x + rand(-0.02, 0.02), s.z, s.yaw, s.h));
  }
}

/** ตรวจว่า Pool พอสำหรับสินค้าทั้งคลัง — ถ้าไม่พอ (มีของที่วางไม่ได้/กลายเป็นพาเลทเปล่า) แจ้ง console.error ทันที */
function checkPoolUsage() {
  const all = { ...P, ...SC }, usage = Object.keys(all).map((k) => `${k} ${used(all[k])}/${all[k].cap}`).join(' · ');
  const overflow = pools.reduce((n, p) => n + p.overflow, 0);
  console.info(`[warehouse3d] พาเลท/มัดสินค้า ${cargoList.size} ชุด · ${usage}`);
  if (overflow || poolShort.pallets || poolShort.items) {
    console.error(`[warehouse3d] Pool ไม่พอ: พาเลทที่กลายเป็นพาเลทเปล่า ${poolShort.pallets} · ชิ้นที่วางไม่ได้ ${poolShort.items} · instance ล้น ${overflow}`);
  }
}

const _sp = new THREE.Vector3();
export function toScreen(x, y, z) {
  _sp.set(x, y, z).project(camera);
  return { x: (_sp.x + 1) * 0.5 * innerWidth, y: (1 - _sp.y) * 0.5 * innerHeight, ok: _sp.z < 1 && _sp.z > -1 };
}

/** ฉากเป็นของนิ่งทั้งหมด: ต่อเฟรมแค่ส่งตำแหน่ง instance ที่เพิ่งเขียนขึ้นการ์ดจอ (ไม่มีรถ คน หรือ physics ให้คำนวณ) */
export function stepWarehouse() {
  for (const p of pools) p.flush();
}

export async function initWarehouse(onProgress, { rackTypes = null } = {}) {
  const step = (p, m) => { if (onProgress) onProgress(p, m); };
  const nextFrame = () => new Promise((r) => setTimeout(r, 20));
  step(12, 'กำลังโหลดฟอนต์และพื้นผิวร้าน…');
  await fontsReady; await nextFrame();
  buildTexturesAndMaterials();
  step(35, 'กำลังสร้างอาคาร ซุ้มทางเข้าลูกค้า และชั้นวางพาเลท 1,104 ช่อง…');
  await nextFrame();
  buildShell(); buildEyeShell(); buildBollardsAndRacks();
  step(62, 'กำลังเรียงสินค้าเต็มเชลฟ์ โชว์รูม และกองโปรโมชัน…');
  await nextFrame();
  buildCargoPools(); buildSceneryAndBulk();
  step(82, 'กำลังเติมสต็อกพาเลทให้เต็มทุกช่องในคลัง…');
  await nextFrame();
  populateRackStock(rackTypes);
  applyGfx();
  checkPoolUsage();
}
