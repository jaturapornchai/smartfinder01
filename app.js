/**
 * app.js — ระบบหลักสำหรับค้นหาตำแหน่งสินค้าหลายรายการ นำทางเดินในโกดัง 3 มิติ และเชื่อมต่อ GPS มือถือ
 * รองรับ มือถือ (Mobile), แท็บเล็ต (Tablet), และโน้ตบุ๊ก (Notebook)
 */
import {
  THREE, clamp, wrapAngle, DEG, yawOfDir,
  canvas, renderer, scene, camera, controls,
  gfxPixelRatio, setGfxUI, setGfxPref, gfxWatch,
  W, ENTRANCE_POS, L, AREA, slotById,
  createPersonRig, animatePersonRig, createShoppingCart, setEyeViewScene, toScreen,
  stepWarehouse, initWarehouse,
} from './warehouse3d.js';
import { SHELF_WALK_SEGMENTS } from './layout.js';
import { initSales } from './sales.js';

import {
  CATEGORIES, CAT_MAP, formatSatang,
  PRODUCTS, PRODUCT_BY_ID, PRESET_LISTS, filterProducts,
} from './catalog.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

/* =====================================================================
   1. APPLICATION STATE
   ===================================================================== */
const state = {
  role: 'customer',          // 'customer' | 'staff' | 'contractor'
  query: '',
  catId: 'all',
  locFilter: 'all',          // 'all' | 'self' | 'bulk'
  optimizeRoute: true,
  followUser: false,
  is2D: false,
  tapMoveMode: false,
  mobTab: 'map',             // 'map' | 'catalog' | 'route' | 'gps'
  listKey: '',               // คำค้น+หมวด+ตัวกรองล่าสุดของรายการสินค้า (เปลี่ยนเมื่อไร เริ่มแสดงหน้าแรกใหม่)
  listLimit: 0,              // จำนวนการ์ดสินค้าที่แสดงอยู่ (สินค้า 2,000 รายการ แสดงทีละชุด)

  // รายการสินค้าที่เลือกปักหมุด: Map<productId, { id, qty, locIdx }>
  selected: new Map(),
  orderedStops: [],          // [{ id, product, loc, qty, legDist, cumDist, pathPts }]
  fullRoutePts: [],          // จุดเส้นทางเดินเท้าต่อเนื่อง [ [x,z], ... ]
  totalDistM: 0,

  // ตำแหน่งผู้ใช้ปัจจุบันและระบบ GPS มือถือ
  user: {
    x: ENTRANCE_POS.x,
    z: ENTRANCE_POS.z,
    yaw: Math.PI / 2,        // หันหน้าเข้าโกดัง (ทิศเหนือ -Z => yaw = PI/2 เพราะ yawOfDir(0,-1) = atan2(1,0) = PI/2)
    speed: 0,
    phase: 0,
  },
  gps: {
    mode: 'sim',             // 'real' | 'walk' | 'sim'
    watchId: null,
    lastLat: null,
    lastLng: null,
    accuracy: null,
    anchorLat: null,
    anchorLng: null,
    northDeg: 0,
    compassOn: false,
    compassHeading: null,
    walkSpeed: 2.8,
    walkStopCursor: 0,       // ลำดับหมุดเป้าหมายในโหมดเดินนำทางอัตโนมัติ
    walkSegIdx: 0,
    walkPause: 0,
  },
};

const QUICK_SPOTS = [
  { label: '🚪 ทางเข้าลูกค้า',        x: ENTRANCE_POS.x, z: ENTRANCE_POS.z, yaw: Math.PI / 2 },
  { label: '⚡ เชลฟ์ไฟฟ้า·ประปา',     x: 34.4, z: 7.15, yaw: 0 },
  { label: '🔧 เครื่องมือช่าง·เกษตร', x: -2.0, z: 9.65, yaw: 0 },
  { label: '🏠 ของใช้ในบ้าน·ครัว',    x: 17.9, z: -7.75, yaw: 0 },
  { label: '🚿 โชว์รูมสุขภัณฑ์',      x: -14.0, z: -5.5, yaw: Math.PI },
  { label: '🏷️ ลานโปรโมชัน',         x: 17.6, z: -1.8, yaw: 0 },
  { label: '📦 แร็คพาเลทกลางคลัง',    x: 7.2,  z: -21.0, yaw: Math.PI / 2 },
  { label: '🧱 ปูน·อิฐกองพื้น',       x: -12.6, z: -46.2, yaw: Math.PI },
];

/* =====================================================================
   2. BIND CATALOG TO 3D RACK SLOTS
   ===================================================================== */
const LEVEL_TEXT = [
  'ชั้นที่ 1 พื้นล่าง (หยิบเองได้)',
  'ชั้นที่ 2 สูง 1.75 ม. (ให้พนักงานจัดสินค้าให้)',
  'ชั้นที่ 3 สูง 3.50 ม. (ให้พนักงานจัดสินค้าให้)',
];

/** ชนิดสินค้าบนพาเลทของแต่ละช่องแร็คตามที่ catalog กำหนด (ช่องที่ไม่มีสินค้าผูก ฉากจะสุ่มสต็อกเติมให้เต็มเอง) */
function catalogRackTypes() {
  const types = new Map();
  for (const p of PRODUCTS) {
    for (const loc of p.locations) {
      if (loc.kind === 'rack') types.set(loc.slotId, loc.cargoType || 'mixed');
    }
  }
  return types;
}

function bindCatalogToScene() {
  for (const p of PRODUCTS) {
    for (const loc of p.locations) {
      if (loc.kind !== 'rack') continue;
      const slot = slotById.get(loc.slotId);
      if (!slot) continue;
      loc.x = slot.x;
      loc.z = slot.z;
      loc.y = slot.h + 0.55;
      loc.standX = slot.x;
      loc.standZ = slot.aisleZ;
      loc.levelLabel = LEVEL_TEXT[slot.level] || LEVEL_TEXT[0];
      loc.selfPick = slot.level === 0;
    }
    p.primary = p.locations[0];
    p.searchText = `${p.id} ${p.barcode} ${p.name} ${p.brand} ${p.keywords} ${
      p.locations.map((l) => `${l.code} ${l.zoneName} ${l.aisleLabel} ${l.levelLabel}`).join(' ')
    }`.toLowerCase();
  }
}

/* =====================================================================
   3. PEDESTRIAN WAYFINDING GRAPH (กราฟทางเดินเท้าจริง ไม่เดินชนชั้นวาง)
   ===================================================================== */
const PED_NAV = {
  segments: [],
  nodes: [],       // [{ x, z, adj: [{ to, w }] }]
  nodeMap: new Map(),
};

function buildPedestrianGraph() {
  const segs = [];
  const addSeg = (x1, z1, x2, z2) => segs.push([x1, z1, x2, z2]);

  // 1) ทางเดินแนวนอนหลัก (East-West)
  addSeg(-12.6, L.mainZ, 52.15, L.mainZ);       // ทางเดินหลักกลางโกดัง z = 2.6
  addSeg(18.5, 14.65, 52.15, 14.65);            // ทางเดินลูกค้าหน้าอาคารเชื่อมโซนเชลฟ์

  // 2) ซอยเชลฟ์หน้าร้าน โชว์รูม และลานโปรโมชัน (พิกัดชุดเดียวกับฉาก 3 มิติ ใน layout.js)
  for (const seg of SHELF_WALK_SEGMENTS) addSeg(...seg);

  // 3) ซอยแร็คพาเลททั้งหมด 20 ซอย (A, B, C..H, J..P, Q..V)
  for (const a of L.aisles) {
    addSeg(a.wx, a.z, a.ex, a.z);
  }

  // 4) ทางเชื่อมฝั่งตะวันตกเข้ากองพื้น (Bulk) และของยาว
  for (const rz of L.rows) {
    addSeg(-12.6, rz, -11.2, rz);
  }
  addSeg(-12.6, 7.5, -11.2, 7.5);

  // 5) ซอยในโซนท่อประปา เหล็กรูปพรรณ แผ่นบอร์ด หลังคา และถังน้ำ
  addSeg(28.6, -2.2, 50.0, -2.2);
  addSeg(28.6, -3.2, 41.2, -3.2);
  addSeg(28.6, -7.2, 44.5, -7.2);
  addSeg(28.6, -11.6, 44.5, -11.6);
  addSeg(28.6, -15.8, 50.0, -15.8);

  // 6) ทางเดินแนวตั้ง (North-South)
  addSeg(-12.6, -63.5, -12.6, 14.8);            // เลียบกองพื้นและของยาว
  addSeg(-11.2, -63.0, -11.2, 14.65);           // เลนหลัก 1
  addSeg(7.2, -63.0, 7.2, 14.65);               // เลนหลัก 2
  addSeg(18.5, 2.6, 18.5, 15.8);                // ทางเดินสีเขียวจากประตูทางเข้าลูกค้า
  addSeg(28.6, -63.0, 28.6, 14.65);             // เลนหลัก 3
  addSeg(31.2, -15.8, 31.2, 2.6);               // หน้าโซนท่อเหล็ก
  addSeg(34.4, 2.6, 34.4, 14.65);               // หน้าซอยเชลฟ์ไฟฟ้า
  addSeg(48.2, -15.8, 48.2, 2.6);               // ทางเดินลานถังน้ำ DOS
  addSeg(50.0, -63.0, 50.0, 2.6);               // เลนหลัก 4 (ไม่ทะลุเชลฟ์หน้าร้าน)
  addSeg(52.15, 2.6, 52.15, 14.65);             // ท้ายซอยเชลฟ์ไฟฟ้า

  PED_NAV.segments = segs;

  const keyOf = (x, z) => `${x.toFixed(2)},${z.toFixed(2)}`;
  const ensureNode = (x, z) => {
    const rx = Math.round(x * 100) / 100;
    const rz = Math.round(z * 100) / 100;
    const k = keyOf(rx, rz);
    let idx = PED_NAV.nodeMap.get(k);
    if (idx === undefined) {
      idx = PED_NAV.nodes.length;
      PED_NAV.nodes.push({ x: rx, z: rz, adj: [] });
      PED_NAV.nodeMap.set(k, idx);
    }
    return idx;
  };
  const linkNodes = (a, b) => {
    if (a === b) return;
    const na = PED_NAV.nodes[a], nb = PED_NAV.nodes[b];
    const w = Math.hypot(na.x - nb.x, na.z - nb.z);
    if (!na.adj.some((e) => e.to === b)) na.adj.push({ to: b, w });
    if (!nb.adj.some((e) => e.to === a)) nb.adj.push({ to: a, w });
  };

  // เก็บจุดปลายและจุดตัดทุกคู่ของ Segment
  const ptsOnSeg = segs.map(([x1, z1, x2, z2]) => [[x1, z1], [x2, z2]]);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const hit = segmentIntersection(segs[i], segs[j]);
      if (hit) {
        ptsOnSeg[i].push(hit);
        ptsOnSeg[j].push(hit);
      }
    }
  }

  // เรียงโหนดตามแนวยาวของแต่ละ Segment แล้วผูก Edge
  segs.forEach((s, idx) => {
    const [x1, z1] = s;
    const pts = ptsOnSeg[idx]
      .map(([px, pz]) => ({ id: ensureNode(px, pz), d: Math.hypot(px - x1, pz - z1) }))
      .sort((a, b) => a.d - b.d);
    for (let k = 0; k < pts.length - 1; k++) {
      linkNodes(pts[k].id, pts[k + 1].id);
    }
    s.nodeChain = pts.map((p) => p.id);
  });
}

/** ตรวจตอนเปิดหน้า: จุดยืนหยิบของทุกตำแหน่งสินค้าต้องอยู่บนทางเดินเท้า ช่องแร็คต้องมีจริง และทางเดินต้องต่อถึงกันทั้งหมด */
function auditCatalogNavigation() {
  const bad = [];
  let total = 0;
  for (const p of PRODUCTS) {
    for (const loc of p.locations) {
      total++;
      if (loc.kind === 'rack' && !slotById.has(loc.slotId)) { bad.push(`${p.id} ไม่มีช่อง ${loc.slotId}`); continue; }
      const snap = snapToWalkway(loc.standX, loc.standZ);
      if (!(snap.dist <= 0.05)) bad.push(`${p.id} ${loc.code} จุดยืนห่างทางเดิน ${snap.dist.toFixed(2)} ม.`);
    }
  }
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    for (const e of PED_NAV.nodes[queue.pop()].adj) {
      if (!seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
    }
  }
  if (seen.size !== PED_NAV.nodes.length) bad.push(`ทางเดินไม่ต่อถึงกัน ${PED_NAV.nodes.length - seen.size} จุด`);
  if (bad.length) console.error(`[nav] ตำแหน่งสินค้าที่นำทางไม่ถึง ${bad.length} จุด จาก ${total}: ${bad.slice(0, 12).join(' · ')}`);
  else console.info(`[nav] จุดยืนหยิบสินค้าอยู่บนทางเดินเท้าครบ ${total}/${total} ตำแหน่ง (สินค้า ${PRODUCTS.length} รายการ · ทางเดิน ${PED_NAV.segments.length} ช่วง)`);
}

function segmentIntersection(a, b) {
  const [x1, z1, x2, z2] = a;
  const [x3, z3, x4, z4] = b;
  const denom = (x1 - x2) * (z3 - z4) - (z1 - z2) * (x3 - x4);
  if (Math.abs(denom) < 1e-6) return null;
  const t = ((x1 - x3) * (z3 - z4) - (z1 - z3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (z1 - z3) - (z1 - z2) * (x1 - x3)) / denom;
  if (t >= -1e-4 && t <= 1.0001 && u >= -1e-4 && u <= 1.0001) {
    return [x1 + clamp(t, 0, 1) * (x2 - x1), z1 + clamp(t, 0, 1) * (z2 - z1)];
  }
  return null;
}

/** โปรเจกต์จุด (px, pz) ลงบนทางเดินเท้าที่ใกล้ที่สุด */
function snapToWalkway(px, pz) {
  let best = null;
  for (let i = 0; i < PED_NAV.segments.length; i++) {
    const s = PED_NAV.segments[i];
    const [x1, z1, x2, z2] = s;
    const vx = x2 - x1, vz = z2 - z1;
    const len2 = vx * vx + vz * vz || 1;
    const t = clamp(((px - x1) * vx + (pz - z1) * vz) / len2, 0, 1);
    const sx = x1 + t * vx, sz = z1 + t * vz;
    const d = Math.hypot(px - sx, pz - sz);
    if (!best || d < best.dist) {
      best = { x: sx, z: sz, dist: d, segIdx: i, chain: s.nodeChain };
    }
  }
  return best;
}

/** หาโหนดขนาบซ้าย-ขวาบน Segment เดียวกันของจุดที่โปรเจกต์แล้ว */
function anchorCandidates(snap) {
  const chain = snap.chain;
  const s = PED_NAV.segments[snap.segIdx];
  const d0 = Math.hypot(snap.x - s[0], snap.z - s[1]);
  let prev = chain[0], next = chain[chain.length - 1];
  for (let i = 0; i < chain.length; i++) {
    const n = PED_NAV.nodes[chain[i]];
    const dn = Math.hypot(n.x - s[0], n.z - s[1]);
    if (dn <= d0 + 1e-3) prev = chain[i];
    if (dn >= d0 - 1e-3) { next = chain[i]; break; }
  }
  const out = [];
  for (const id of new Set([prev, next])) {
    const n = PED_NAV.nodes[id];
    out.push({ id, cost: Math.hypot(snap.x - n.x, snap.z - n.z) });
  }
  return out;
}

/** คำนวณเส้นทางเดินเท้าที่สั้นที่สุดระหว่าง 2 พิกัดในโกดัง */
function findWalkPath(ax, az, bx, bz) {
  const sa = snapToWalkway(ax, az);
  const sb = snapToWalkway(bx, bz);

  // กรณีอยู่บนทางเดินเส้นเดียวกัน เดินตรงถึงกันได้เลย
  if (sa.segIdx === sb.segIdx) {
    const pts = [];
    if (sa.dist > 0.08) pts.push([ax, az]);
    pts.push([sa.x, sa.z], [sb.x, sb.z]);
    if (sb.dist > 0.08) pts.push([bx, bz]);
    return dedupPoints(pts);
  }

  const N = PED_NAV.nodes.length;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const visited = new Uint8Array(N);

  for (const c of anchorCandidates(sa)) {
    if (c.cost < dist[c.id]) dist[c.id] = c.cost;
  }

  for (let step = 0; step < N; step++) {
    let u = -1, bestD = Infinity;
    for (let i = 0; i < N; i++) {
      if (!visited[i] && dist[i] < bestD) { bestD = dist[i]; u = i; }
    }
    if (u === -1 || bestD === Infinity) break;
    visited[u] = 1;
    for (const e of PED_NAV.nodes[u].adj) {
      const nd = bestD + e.w;
      if (nd < dist[e.to]) {
        dist[e.to] = nd;
        prev[e.to] = u;
      }
    }
  }

  let bestGoal = -1, bestTotal = Infinity;
  for (const g of anchorCandidates(sb)) {
    const total = dist[g.id] + g.cost;
    if (total < bestTotal) { bestTotal = total; bestGoal = g.id; }
  }

  const pts = [];
  if (sa.dist > 0.08) pts.push([ax, az]);
  pts.push([sa.x, sa.z]);
  if (bestGoal !== -1) {
    const rev = [];
    for (let cur = bestGoal; cur !== -1; cur = prev[cur]) {
      rev.push([PED_NAV.nodes[cur].x, PED_NAV.nodes[cur].z]);
    }
    rev.reverse();
    pts.push(...rev);
  }
  pts.push([sb.x, sb.z]);
  if (sb.dist > 0.08) pts.push([bx, bz]);
  return dedupPoints(pts);
}

function dedupPoints(pts) {
  const out = [];
  for (const [x, z] of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(x - last[0], z - last[1]) > 0.04) out.push([x, z]);
  }
  // ตัดจุดกึ่งกลางที่อยู่ในแนวเส้นตรงเดียวกันออกเพื่อให้เส้นลูกศรเนียนสวย
  const clean = [];
  for (const p of out) {
    while (clean.length >= 2) {
      const a = clean[clean.length - 2], b = clean[clean.length - 1];
      const dx1 = b[0] - a[0], dz1 = b[1] - a[1];
      const dx2 = p[0] - b[0], dz2 = p[1] - b[1];
      const l1 = Math.hypot(dx1, dz1), l2 = Math.hypot(dx2, dz2);
      if (l1 > 1e-4 && l2 > 1e-4 && (dx1 * dx2 + dz1 * dz2) / (l1 * l2) > 0.999) clean.pop();
      else break;
    }
    clean.push(p);
  }
  return clean;
}

function pathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return d;
}

/* =====================================================================
   4. MULTI-PRODUCT ROUTE OPTIMIZER (Nearest-Neighbor + 2-Opt)
   ===================================================================== */
function getActiveLocation(product, entry) {
  const idx = clamp(entry?.locIdx ?? 0, 0, product.locations.length - 1);
  return product.locations[idx] || product.primary;
}

function recomputeRoute() {
  const entries = [];
  for (const [id, item] of state.selected.entries()) {
    const product = PRODUCT_BY_ID.get(id);
    if (!product) continue;
    entries.push({ id, qty: item.qty, locIdx: item.locIdx, product, loc: getActiveLocation(product, item) });
  }

  if (!entries.length) {
    state.orderedStops = [];
    state.fullRoutePts = [];
    state.totalDistM = 0;
    update3DPinsAndRoute();
    renderSelectedPanel();
    renderNavBanner();
    updateSelectionBadges();
    return;
  }

  // จัดลำดับเดินหยิบสินค้าที่สั้นที่สุด (Nearest-Neighbor + 2-Opt)
  let ordered = entries.slice();
  if (state.optimizeRoute && ordered.length > 1) {
    const startPt = { standX: state.user.x, standZ: state.user.z };
    const nodes = [startPt, ...ordered.map((e) => e.loc)];
    const K = nodes.length;
    const distMat = Array.from({ length: K }, () => new Float64Array(K));
    for (let i = 0; i < K; i++) {
      for (let j = i + 1; j < K; j++) {
        const d = pathLength(findWalkPath(nodes[i].standX, nodes[i].standZ, nodes[j].standX, nodes[j].standZ));
        distMat[i][j] = d;
        distMat[j][i] = d;
      }
    }
    // Nearest-Neighbor จากจุดที่ผู้ใช้ยืนอยู่ (index 0)
    const used = new Uint8Array(K);
    used[0] = 1;
    const tour = [];
    let cur = 0;
    for (let step = 1; step < K; step++) {
      let bestIdx = -1, bestD = Infinity;
      for (let j = 1; j < K; j++) {
        if (!used[j] && distMat[cur][j] < bestD) { bestD = distMat[cur][j]; bestIdx = j; }
      }
      used[bestIdx] = 1;
      tour.push(bestIdx);
      cur = bestIdx;
    }
    // 2-Opt ขัดเกลาลำดับทางเดินไม่ให้เดินย้อนไปมา
    const routeCost = (arr) => {
      let s = distMat[0][arr[0]];
      for (let i = 0; i < arr.length - 1; i++) s += distMat[arr[i]][arr[i + 1]];
      return s;
    };
    let improved = true;
    let guard = 0;
    while (improved && guard++ < 40) {
      improved = false;
      for (let i = 0; i < tour.length - 1; i++) {
        for (let k = i + 1; k < tour.length; k++) {
          const cand = [...tour.slice(0, i), ...tour.slice(i, k + 1).reverse(), ...tour.slice(k + 1)];
          if (routeCost(cand) + 0.05 < routeCost(tour)) {
            tour.splice(0, tour.length, ...cand);
            improved = true;
          }
        }
      }
    }
    ordered = tour.map((nodeIdx) => entries[nodeIdx - 1]);
  }

  // สร้างเส้นทางต่อเนื่องจากตัวผู้ใช้ -> จุดที่ 1 -> จุดที่ 2 -> ...
  let cx = state.user.x, cz = state.user.z, cum = 0;
  const full = [];
  state.orderedStops = ordered.map((e, idx) => {
    const pts = findWalkPath(cx, cz, e.loc.standX, e.loc.standZ);
    const leg = pathLength(pts);
    cum += leg;
    if (full.length && pts.length) full.push(...pts.slice(1));
    else full.push(...pts);
    cx = e.loc.standX;
    cz = e.loc.standZ;
    return { ...e, stepNo: idx + 1, legDist: leg, cumDist: cum, pathPts: pts };
  });
  state.fullRoutePts = full;
  state.totalDistM = cum;

  if (state.gps.walkStopCursor >= state.orderedStops.length) {
    state.gps.walkStopCursor = 0;
  }

  update3DPinsAndRoute();
  renderSelectedPanel();
  renderNavBanner();
  updateSelectionBadges();
  sales?.onSelectionChanged();
}

/* =====================================================================
   5. 3D VISUAL WAYFINDING, USER AVATAR, MULTI-PINS & ZONE LABELS
   ===================================================================== */
const nav3D = {
  userGroup: null,
  cart: null,                // รถเข็นของลูกค้า
  cartYaw: Math.PI / 2,
  userRig: null,
  pulseRing: null,
  headingCone: null,
  accDisc: null,
  userDomPin: null,

  pinsGroup: null,
  pinObjs: [],               // [{ pillar, ring, box, connector, dom, stop }]
  chevronMesh: null,
  chevronCurvePts: [],       // [{ x, z, yaw, distAt }]
  routeTube: null,
  zoneChips: [],
};

function init3DWayfindingObjects() {
  // 1) ตัวอวตารผู้ใช้งาน + เรดาร์ GPS + กรวยทิศหันหน้า
  const ug = new THREE.Group();
  nav3D.userGroup = ug;
  nav3D.userRig = createPersonRig({ shirtColor: 0x2563eb, hatColor: null });
  ug.add(nav3D.userRig.group);

  // วงแหวนเรดาร์สีฟ้าน้ำทะเลใต้เท้า
  const ringGeo = new THREE.RingGeometry(0.45, 0.72, 32).rotateX(-Math.PI / 2);
  nav3D.pulseRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
    color: 0x0ea5e9, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide,
  }));
  nav3D.pulseRing.position.y = 0.035;
  ug.add(nav3D.pulseRing);

  // กรวยบอกทิศหันหน้า (ชี้ไปตาม +X ของ local rig ซึ่งตรงกับ yawOfDir)
  const coneShape = new THREE.CircleGeometry(2.1, 24, -Math.PI / 5.5, (Math.PI * 2) / 5.5);
  coneShape.rotateX(-Math.PI / 2);
  nav3D.headingCone = new THREE.Mesh(coneShape, new THREE.MeshBasicMaterial({
    color: 0x38bdf8, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide,
  }));
  nav3D.headingCone.position.y = 0.03;
  ug.add(nav3D.headingCone);

  // วงรัศมีความแม่นยำสัญญาณ GPS จริง
  nav3D.accDisc = new THREE.Mesh(
    new THREE.CircleGeometry(1, 36).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.11, depthWrite: false })
  );
  nav3D.accDisc.position.y = 0.022;
  nav3D.accDisc.visible = false;
  ug.add(nav3D.accDisc);

  ug.position.set(state.user.x, 0, state.user.z);
  ug.rotation.y = state.user.yaw;
  scene.add(ug);

  nav3D.cart = createShoppingCart();
  nav3D.cartYaw = state.user.yaw;
  scene.add(nav3D.cart);
  followCart(state.user.x, state.user.z);

  // ป้าย HTML "คุณอยู่ที่นี่"
  const upin = document.createElement('div');
  upin.className = 'user-pin';
  upin.innerHTML = `
    <div class="row-base gap-1.5 px-2.5 py-1 rounded-full bg-blue-600 text-white text-[11px] font-extrabold shadow-lg shadow-blue-700/40 border border-white/80">
      <span class="w-2 h-2 rounded-full bg-emerald-300 live-dot"></span>
      <span>คุณอยู่ที่นี่</span>
    </div>
    <div class="w-2 h-2 bg-blue-600 rotate-45 mx-auto -mt-1 border-r border-b border-white/80"></div>
  `;
  $('pinLayer').appendChild(upin);
  nav3D.userDomPin = upin;

  // 2) กลุ่มหมุดสินค้าหลายจุด
  nav3D.pinsGroup = new THREE.Group();
  scene.add(nav3D.pinsGroup);

  // 3) ลูกศรนำทางเดินเท้าบนพื้น (InstancedMesh Chevrons สูงสุด 420 ดอก)
  const shape = new THREE.Shape();
  shape.moveTo(0.28, 0);
  shape.lineTo(-0.20, 0.24);
  shape.lineTo(-0.08, 0);
  shape.lineTo(-0.20, -0.24);
  shape.closePath();
  const chevGeo = new THREE.ShapeGeometry(shape);
  chevGeo.rotateX(-Math.PI / 2);
  const chevMat = new THREE.MeshBasicMaterial({
    color: 0x10b981, transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide,
  });
  nav3D.chevronMesh = new THREE.InstancedMesh(chevGeo, chevMat, 450);
  nav3D.chevronMesh.count = 0;
  nav3D.chevronMesh.frustumCulled = false;
  scene.add(nav3D.chevronMesh);

  // 4) ป้ายชื่อโซนลอยในมุมสูง
  const ZONES = [
    { title: '🚪 ทางเข้าลูกค้า & จุดบริการ', sub: 'จุดเริ่มต้นนำทาง', x: 18.5, y: 3.4, z: 15.5, cls: 'bg-blue-600/90 text-white border-blue-300/60' },
    { title: '⚡ ไฟฟ้า·ประปา·ฮาร์ดแวร์', sub: 'เชลฟ์ SH1 – SH8 (หยิบเอง)', x: 43.3, y: 3.3, z: 10.0, cls: 'bg-amber-500/95 text-slate-950 border-amber-200' },
    { title: '🌱 สวน·ของใช้ในบ้าน', sub: 'เชลฟ์ GD1 – GD8', x: 23.3, y: 3.3, z: 10.6, cls: 'bg-lime-600/90 text-white border-lime-300/60' },
    { title: '🔧 เครื่องมือช่าง·เกษตร', sub: 'เชลฟ์ TG1 – TG8', x: -2.0, y: 3.3, z: 10.6, cls: 'bg-orange-600/90 text-white border-orange-300/60' },
    { title: '🏷️ ลานสินค้าโปรโมชัน', sub: 'กองพาเลท PM-01 – PM-64', x: 17.6, y: 2.6, z: -1.8, cls: 'bg-yellow-400/95 text-slate-950 border-yellow-200' },
    { title: '🏠 เครื่องใช้ไฟฟ้า·ครัว·ห้องน้ำ', sub: 'เชลฟ์ HM1 – HM10', x: 17.9, y: 3.3, z: -10.2, cls: 'bg-pink-600/90 text-white border-pink-300/60' },
    { title: '🚿 โชว์รูมสุขภัณฑ์·กระเบื้อง', sub: 'แผงโชว์ TS1 – TS6', x: -19.2, y: 3.2, z: -8.6, cls: 'bg-teal-600/90 text-white border-teal-300/60' },
    { title: '🚰 โซนท่อ PVC·เหล็กกล่อง·หลังคา·ถังน้ำ', sub: 'แร็ค PS & ลานถังน้ำ', x: 39.5, y: 3.8, z: -9.5, cls: 'bg-sky-600/90 text-white border-sky-300/60' },
    { title: '📦 ชั้นวางพาเลท (แถว A – V)', sub: '1,104 ช่อง สต็อกเต็มทุกช่อง', x: 18.5, y: 5.6, z: -33.5, cls: 'bg-slate-900/85 text-white border-slate-500/50' },
    { title: '🧱 โซนกองพื้น ปูน·อิฐ·กระเบื้อง', sub: 'สินค้าหนักยกล็อต BK-01 – BK-07', x: -19.5, y: 3.2, z: -44.0, cls: 'bg-rose-600/90 text-white border-rose-300/60' },
    { title: '🏗️ โซนเหล็กเส้น 6 ม. & ท่อเมนใหญ่', sub: 'ให้พนักงานจัดสินค้า LG-01 – LG-04', x: -19.0, y: 2.8, z: 12.8, cls: 'bg-slate-700/90 text-white border-slate-400/50' },
  ];
  const zLayer = $('zoneLabelLayer');
  for (const z of ZONES) {
    const el = document.createElement('div');
    el.className = 'zone-chip';
    el.innerHTML = `
      <div class="px-2.5 py-1 rounded-xl border shadow-md backdrop-blur-sm text-center ${z.cls}">
        <div class="text-[11px] font-extrabold leading-tight whitespace-nowrap">${esc(z.title)}</div>
        <div class="text-[9px] font-semibold opacity-85 leading-tight whitespace-nowrap">${esc(z.sub)}</div>
      </div>
    `;
    zLayer.appendChild(el);
    nav3D.zoneChips.push({ ...z, el });
  }
}

const _m4 = new THREE.Matrix4();
const _q4 = new THREE.Quaternion();
const _v3 = new THREE.Vector3();
const _s3 = new THREE.Vector3(1, 1, 1);
const _upY = new THREE.Vector3(0, 1, 0);

/** อัปเดตหมุดสินค้า 3 มิติ เสาลำแสง และเส้นลูกศรนำทางเดินเท้า */
function update3DPinsAndRoute() {
  // ล้างหมุดเดิมทั้งหมดอย่างสะอาด
  while (nav3D.pinsGroup.children.length) {
    const ch = nav3D.pinsGroup.children.pop();
    ch.geometry?.dispose?.();
    if (Array.isArray(ch.material)) ch.material.forEach((m) => m.dispose?.());
    else ch.material?.dispose?.();
  }
  for (const po of nav3D.pinObjs) po.dom.remove();
  nav3D.pinObjs = [];

  if (nav3D.routeTube) {
    scene.remove(nav3D.routeTube);
    nav3D.routeTube.geometry.dispose();
    nav3D.routeTube.material.dispose();
    nav3D.routeTube = null;
  }

  // สร้างหมุดใหม่ครบทุกสินค้าที่เลือก
  const pillarGeo = new THREE.CylinderGeometry(0.06, 0.22, 4.6, 16, 1, true);
  pillarGeo.translate(0, 2.3, 0);
  const standRingGeo = new THREE.RingGeometry(0.36, 0.56, 28).rotateX(-Math.PI / 2);

  state.orderedStops.forEach((stop, idx) => {
    const isNext = idx === state.gps.walkStopCursor;
    const hex = isNext ? 0x10b981 : 0x2563eb;
    const loc = stop.loc;

    // 1. เสาลำแสงแนวตั้งเหนือตำแหน่งสินค้า
    const pillar = new THREE.Mesh(pillarGeo.clone(), new THREE.MeshBasicMaterial({
      color: hex, transparent: true, opacity: isNext ? 0.42 : 0.28, depthWrite: false, side: THREE.DoubleSide,
    }));
    pillar.position.set(loc.x, loc.y, loc.z);
    nav3D.pinsGroup.add(pillar);

    // 2. กล่องเรืองแสงครอบจุดวางสินค้าจริง (ช่วยให้รู้ว่าอยู่ชั้นไหน!)
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 0.78, 0.95),
      new THREE.MeshBasicMaterial({ color: hex, wireframe: true, transparent: true, opacity: 0.85 })
    );
    box.position.set(loc.x, loc.y, loc.z);
    nav3D.pinsGroup.add(box);

    // 3. วงแหวนจุดยืนหยิบสินค้าบนพื้นทางเดิน
    const ring = new THREE.Mesh(standRingGeo.clone(), new THREE.MeshBasicMaterial({
      color: hex, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide,
    }));
    ring.position.set(loc.standX, 0.032, loc.standZ);
    nav3D.pinsGroup.add(ring);

    // 4. เส้นประชี้จากจุดยืนบนพื้นขึ้นไปยังช่องสินค้าบนชั้น
    const connPts = [
      new THREE.Vector3(loc.standX, 0.06, loc.standZ),
      new THREE.Vector3(loc.x, loc.y, loc.z),
    ];
    const connGeo = new THREE.BufferGeometry().setFromPoints(connPts);
    const connLine = new THREE.Line(connGeo, new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: 0.7 }));
    nav3D.pinsGroup.add(connLine);

    // 5. การ์ดหมุด HTML ลอยเหนือสินค้า (คลิกเพื่อซูมดูใกล้ๆ ได้ทันที)
    const dom = document.createElement('div');
    dom.className = 'pin-card';
    const badgeBg = isNext ? 'bg-emerald-600' : 'bg-blue-600';
    const borderCls = isNext ? 'border-emerald-400 ring-2 ring-emerald-400/40' : 'border-blue-200';
    const cat = CAT_MAP[stop.product.cat] || CATEGORIES[0];
    dom.innerHTML = `
      <div class="glass rounded-xl px-2.5 py-1.5 border ${borderCls} shadow-lg max-w-[215px]">
        <div class="row-base gap-1.5">
          <span class="badge-base w-5 h-5 rounded-md ${badgeBg} text-white text-[11px] font-extrabold flex-none tnum">${stop.stepNo}</span>
          <span class="text-[11px] font-extrabold text-slate-900 truncate">${esc(cat.icon)} ${esc(stop.product.name)}</span>
        </div>
        <div class="row-base justify-between gap-2 mt-1 text-[10px]">
          <span class="font-extrabold text-blue-700">${esc(loc.code)}</span>
          <span class="text-slate-600 truncate">${esc(loc.selfPick ? 'หยิบเองได้' : 'ให้พนักงานจัดให้')}</span>
          <span class="font-bold text-emerald-700 tnum">+${Math.round(stop.legDist)} ม.</span>
        </div>
      </div>
      <div class="w-2.5 h-2.5 ${badgeBg} rotate-45 mx-auto -mt-1.5 shadow"></div>
    `;
    dom.addEventListener('click', (ev) => {
      ev.stopPropagation();
      focusProductStop(stop);
    });
    $('pinLayer').appendChild(dom);
    nav3D.pinObjs.push({ pillar, ring, box, dom, stop });
  });

  // สร้างเส้นทางเดินเท้าเรืองแสงและจัดเรียงลูกศร Chevron ตลอดเส้นทาง
  nav3D.chevronCurvePts = [];
  const pts = state.fullRoutePts;
  if (pts.length >= 2) {
    const vPts = pts.map(([x, z]) => new THREE.Vector3(x, 0.045, z));
    const lineGeo = new THREE.BufferGeometry().setFromPoints(vPts);
    nav3D.routeTube = new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({ color: 0x059669, transparent: true, opacity: 0.65 })
    );
    scene.add(nav3D.routeTube);

    // วางลูกศรทุกระยะ 1.05 เมตร
    const stepM = 1.05;
    let carry = 0.4;
    for (let i = 0; i < pts.length - 1 && nav3D.chevronCurvePts.length < 445; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
      const dx = x2 - x1, dz = z2 - z1;
      const segLen = Math.hypot(dx, dz);
      if (segLen < 1e-3) continue;
      const yaw = yawOfDir(dx, dz);
      let d = carry;
      while (d <= segLen && nav3D.chevronCurvePts.length < 445) {
        const t = d / segLen;
        nav3D.chevronCurvePts.push({ x: x1 + dx * t, z: z1 + dz * t, yaw });
        d += stepM;
      }
      carry = d - segLen;
    }
  }
  nav3D.chevronMesh.count = nav3D.chevronCurvePts.length;
  syncChevrons(0);
}

function syncChevrons(time) {
  const arr = nav3D.chevronCurvePts;
  if (!arr.length) {
    nav3D.chevronMesh.count = 0;
    return;
  }
  const wave = (time * 3.8) % 1;
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i];
    const pulse = 0.78 + 0.34 * Math.sin((i * 0.45 - wave * Math.PI * 2));
    _q4.setFromAxisAngle(_upY, c.yaw);
    _s3.set(pulse, 1, pulse);
    _m4.compose(_v3.set(c.x, 0.048, c.z), _q4, _s3);
    nav3D.chevronMesh.setMatrixAt(i, _m4);
  }
  nav3D.chevronMesh.instanceMatrix.needsUpdate = true;
}

function updateOverlaysPerFrame(time) {
  // 1. เรดาร์รอบตัวผู้ใช้
  const s = 1 + 0.35 * Math.sin(time * 3.4);
  nav3D.pulseRing.scale.set(s, 1, s);
  nav3D.pulseRing.material.opacity = 0.65 - 0.28 * Math.sin(time * 3.4);

  const us = toScreen(state.user.x, 2.15, state.user.z);
  const uVis = !eye.on && us.ok && us.x > -60 && us.x < innerWidth + 60 && us.y > -20 && us.y < innerHeight + 40;
  nav3D.userDomPin.style.display = uVis ? '' : 'none';
  if (uVis) {
    nav3D.userDomPin.style.transform = `translate(${us.x.toFixed(1)}px, ${us.y.toFixed(1)}px) translate(-50%, -100%)`;
  }

  // 2. หมุดสินค้าหลายจุด
  for (let i = 0; i < nav3D.pinObjs.length; i++) {
    const po = nav3D.pinObjs[i];
    const loc = po.stop.loc;
    const bounce = Math.sin(time * 3.2 + i * 0.9) * 0.08;
    po.box.position.y = loc.y + bounce;
    const rs = 1 + 0.16 * Math.sin(time * 4 + i);
    po.ring.scale.set(rs, 1, rs);

    const pinY = Math.max(loc.y + 1.45, 2.35);
    const sc = toScreen(loc.x, pinY, loc.z);
    const vis = sc.ok && sc.x > -90 && sc.x < innerWidth + 90 && sc.y > 40 && sc.y < innerHeight + 40;
    po.dom.style.display = vis ? '' : 'none';
    if (vis) {
      po.dom.style.transform = `translate(${sc.x.toFixed(1)}px, ${sc.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  // 3. ป้ายชื่อโซน (ซ่อนอัตโนมัติเมื่อซูมเข้าใกล้ < 24 ม. เพื่อไม่ให้บังสินค้า)
  const camDist = camera.position.distanceTo(controls.target);
  const showZones = !eye.on && camDist > 24;
  for (const zc of nav3D.zoneChips) {
    if (!showZones) { zc.el.style.display = 'none'; continue; }
    const sc = toScreen(zc.x, zc.y, zc.z);
    const vis = sc.ok && sc.x > 30 && sc.x < innerWidth - 30 && sc.y > 65 && sc.y < innerHeight - 65;
    zc.el.style.display = vis ? '' : 'none';
    if (vis) {
      zc.el.style.transform = `translate(${sc.x.toFixed(1)}px, ${sc.y.toFixed(1)}px) translate(-50%, -50%)`;
    }
  }

  // 4. ลูกศรไหลนำทาง
  syncChevrons(time);
}

/* =====================================================================
   6. CAMERA SMOOTH FLY-TO, 2D/3D VIEW & HOME FIT
   ===================================================================== */
const camTween = {
  active: false,
  t: 0,
  dur: 0.75,
  p0: new THREE.Vector3(),
  t0: new THREE.Vector3(),
  p1: new THREE.Vector3(),
  t1: new THREE.Vector3(),
};

function flyTo(tx, ty, tz, dist = 16, azimuthOffset = 0.45) {
  if (eye.on) return; // มุมมองสายตา: กล้องอยู่ที่ตาลูกค้าเสมอ
  camTween.p0.copy(camera.position);
  camTween.t0.copy(controls.target);
  camTween.t1.set(tx, ty, tz);
  if (state.is2D) {
    camTween.p1.set(tx, ty + Math.max(dist * 1.45, 24), tz + 0.8);
  } else {
    const dirX = Math.sin(azimuthOffset) * dist * 0.78;
    const dirZ = Math.cos(azimuthOffset) * dist * 0.86;
    camTween.p1.set(tx + dirX, ty + dist * 0.62, tz + dirZ);
  }
  camTween.t = 0;
  camTween.dur = 0.72;
  camTween.active = true;
}

function fitHomeView() {
  setEyeView(false);
  state.followUser = false;
  $('tglFollowUser').setAttribute('aria-checked', 'false');
  if (state.is2D) {
    flyTo(13, 0, -18, 86, 0);
  } else {
    camTween.p0.copy(camera.position);
    camTween.t0.copy(controls.target);
    camTween.t1.set(14, 0, -10);
    camTween.p1.set(44, 54, 56);
    camTween.t = 0;
    camTween.dur = 0.8;
    camTween.active = true;
  }
}

function focusProductStop(stop) {
  const loc = stop.loc;
  const dx = loc.standX - loc.x, dz = loc.standZ - loc.z;
  const az = Math.atan2(dx || 0.4, dz || 0.8);
  state.followUser = false;
  $('tglFollowUser').setAttribute('aria-checked', 'false');
  if (eye.on) lookEyeAt(loc.x, loc.y, loc.z);
  flyTo(loc.x, Math.min(loc.y, 2.2), loc.z, loc.kind === 'shelf' ? 10.5 : 15.5, az);
  if (innerWidth < 1180) setMobileTab('map');
  showToast(`📍 ${stop.product.name} — ช่อง ${loc.code} (${loc.levelLabel})`);
}

function toggle2D3D() {
  setEyeView(false);
  state.is2D = !state.is2D;
  $('lbl2D3D').textContent = state.is2D ? '3D' : '2D';
  $('btnToggle2D').classList.toggle('bg-blue-600', state.is2D);
  $('btnToggle2D').classList.toggle('text-white', state.is2D);
  const tgt = controls.target.clone();
  const d = clamp(camera.position.distanceTo(tgt), 18, 120);
  if (state.is2D) {
    controls.maxPolarAngle = 0.16;
    flyTo(tgt.x, tgt.y, tgt.z, d * 0.85, 0);
    showToast('🗺️ สลับเป็นมุมมองผังบน 2D');
  } else {
    controls.maxPolarAngle = 1.32;
    flyTo(tgt.x, tgt.y, tgt.z, d, 0.48);
    showToast('🏢 สลับเป็นมุมมอง 3 มิติ');
  }
}

/* =====================================================================
   7. MOBILE GPS ENGINE (Geolocation + Compass + Auto-Walk + Tap/Pad)
   ===================================================================== */
function detectZoneName(x, z) {
  if (x >= AREA.entrance.x0 - 1 && x <= AREA.entrance.x1 + 1 && z >= AREA.entrance.z0) return 'ทางเข้าลูกค้า & เคาน์เตอร์บริการ';
  if (x >= AREA.hardware.x0 - 1 && x <= AREA.hardware.x1 + 1 && z >= AREA.hardware.z0 - 1) return 'โซนเชลฟ์ไฟฟ้า·ประปา·เครื่องมือช่าง';
  if (x >= AREA.steel.x0 - 1 && x <= AREA.steel.x1 + 2 && z >= AREA.steel.z0 - 1 && z <= AREA.steel.z1 + 2) return 'โซนท่อ PVC · เหล็กกล่อง · หลังคา';
  if (x <= AREA.bulk.x1 + 2 && z <= AREA.bulk.z1 + 1) return 'โซนกองพื้น ปูน·อิฐ·กระเบื้อง';
  if (x <= -13 && z >= 9) return 'โซนเหล็กเส้น 6 ม. & ท่อเมนใหญ่';
  if (x <= -13.2 && z >= -17.3 && z <= 0.2) return 'โชว์รูมสุขภัณฑ์·กระเบื้อง';
  if (z >= 4.6) {
    if (x >= -9.6 && x <= 5.6) return 'โซนเครื่องมือช่าง·เกษตร';
    if (x >= 9.0 && x <= 17.4) return 'ลานสินค้าโปรโมชัน (หน้าร้าน)';
    if (x >= 19.7 && x <= 26.8) return 'โซนสวน·กลางแจ้ง·ของใช้ในบ้าน';
  }
  if (x >= 9.3 && x <= 26.5 && z >= -3.8 && z <= 0.3) return 'ลานสินค้าโปรโมชัน (กลางคลัง)';
  if (x >= 9.3 && x <= 26.5 && z >= -16.8 && z < -3.8) return 'โซนเครื่องใช้ไฟฟ้า·ครัว·ห้องน้ำ·ประตู';
  for (const a of L.aisles) {
    if (Math.abs(z - a.z) < 3.6 && x >= a.wx - 1.5 && x <= a.ex + 1.5) return `ช่องทางเดินชั้นวางพาเลท ซอย ${a.key}`;
  }
  if (Math.abs(z - L.mainZ) < 2.5) return 'ทางเดินหลักกลางโกดัง (Main Walkway)';
  return 'ภายในพื้นที่คลังสินค้า';
}

let lastRouteRecalcPos = { x: ENTRANCE_POS.x, z: ENTRANCE_POS.z };

function setUserPosition(nx, nz, nyaw = null, forceRecalc = false) {
  const prevX = state.user.x, prevZ = state.user.z;
  state.user.x = clamp(nx, W.X0 + 0.9, W.X1 - 0.9);
  state.user.z = clamp(nz, W.Z0 + 0.9, W.Z1 - 0.6);
  if (nyaw !== null && Number.isFinite(nyaw)) state.user.yaw = nyaw;

  nav3D.userGroup.position.set(state.user.x, 0, state.user.z);
  nav3D.userGroup.rotation.y = state.user.yaw;
  followCart(prevX, prevZ);
  sales?.onUserMoved(state.user.x, state.user.z);

  if (state.followUser && !camTween.active) {
    const dx = state.user.x - prevX, dz = state.user.z - prevZ;
    controls.target.x += dx;
    controls.target.z += dz;
    camera.position.x += dx;
    camera.position.z += dz;
  }

  updateGpsReadoutUI();

  const movedFromCalc = Math.hypot(state.user.x - lastRouteRecalcPos.x, state.user.z - lastRouteRecalcPos.z);
  if (forceRecalc || (state.gps.mode !== 'walk' && movedFromCalc > 1.6)) {
    lastRouteRecalcPos = { x: state.user.x, z: state.user.z };
    recomputeRoute();
  }
}

function updateGpsReadoutUI() {
  const zone = detectZoneName(state.user.x, state.user.z);
  $('userZoneTxt').textContent = zone;
  if (state.gps.mode === 'real' && state.gps.lastLat !== null) {
    $('userCoordTxt').textContent = `${state.gps.lastLat.toFixed(5)}, ${state.gps.lastLng.toFixed(5)} (X ${state.user.x.toFixed(1)}, Z ${state.user.z.toFixed(1)})`;
  } else {
    $('userCoordTxt').textContent = `X ${state.user.x.toFixed(1)}, Z ${state.user.z.toFixed(1)} ม.`;
  }
  $('topGpsLabel').textContent = zone.length > 18 ? zone.slice(0, 18) + '…' : zone;
}

function setGpsMode(mode) {
  if (state.gps.mode === 'real' && mode !== 'real' && state.gps.watchId !== null) {
    navigator.geolocation?.clearWatch(state.gps.watchId);
    state.gps.watchId = null;
  }
  state.gps.mode = mode;

  document.querySelectorAll('#gpsModeSeg button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.gpsmode === mode));
  });
  $('realGpsBox').classList.toggle('hidden', mode !== 'real');
  nav3D.accDisc.visible = mode === 'real' && state.gps.accuracy !== null;

  const isWalking = mode === 'walk';
  $('startWalkLabel').textContent = isWalking ? '⏸ หยุดเดิน' : '🚶 เดินนำทาง';
  $('bannerWalkTxt').textContent = isWalking ? 'หยุดเดิน' : 'เดินนำทาง';

  if (mode === 'real') {
    $('gpsModePill').textContent = 'GPS มือถือจริง';
    $('gpsModePill').className = 'badge-base px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold';
    $('topGpsSub').textContent = '· GPS มือถือทำงาน';
    startRealGeolocation();
  } else if (mode === 'walk') {
    $('gpsModePill').textContent = 'กำลังเดินนำทาง';
    $('gpsModePill').className = 'badge-base px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold';
    $('topGpsSub').textContent = '· กำลังเดินนำทาง';
    $('gpsStatusMsg').textContent = 'ระบบกำลังพาเดินไปตามช่องทางเดินปลอดภัยมุ่งหน้าสู่สินค้าจุดถัดไป';
    beginAutoWalk();
  } else {
    state.user.speed = 0;
    animatePersonRig(nav3D.userRig, 0, state.user.phase);
    $('gpsModePill').textContent = 'โหมดจำลองในอาคาร';
    $('gpsModePill').className = 'badge-base px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold';
    $('topGpsSub').textContent = '· พร้อมนำทาง';
    $('gpsStatusMsg').textContent = 'แตะปุ่ม "📡 GPS มือถือจริง" เมื่อเดินอยู่ในพื้นที่ หรือเลือกจุดยืนด่วนด้านล่างเพื่อทดสอบเส้นทาง';
    recomputeRoute();
  }
}

function startRealGeolocation() {
  if (!('geolocation' in navigator)) {
    $('gpsStatusMsg').textContent = 'เบราว์เซอร์อุปกรณ์นี้ไม่รองรับ Geolocation API กรุณาใช้โหมดกำหนดจุดยืนแทน';
    showToast('⚠️ อุปกรณ์นี้ไม่รองรับสัญญาณ GPS');
    return;
  }
  $('gpsStatusMsg').textContent = 'กำลังรับสัญญาณดาวเทียม/Wi-Fi จากมือถือของคุณ… เมื่อยืนหน้าประตูร้านให้กด "📌 ตั้งจุดนี้ = ทางเข้า"';
  $('gpsAccTxt').textContent = 'กำลังค้นหาสัญญาณ…';

  state.gps.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy, heading } = pos.coords;
      state.gps.lastLat = latitude;
      state.gps.lastLng = longitude;
      state.gps.accuracy = accuracy;

      if (state.gps.anchorLat === null) {
        state.gps.anchorLat = latitude;
        state.gps.anchorLng = longitude;
        showToast('📡 เชื่อมต่อ GPS มือถือสำเร็จ! ตั้งจุดเริ่มต้นที่ทางเข้าลูกค้า');
      }
      applyRealGpsCoordinate();

      if (Number.isFinite(heading) && heading >= 0 && !state.gps.compassOn) {
        // แปลงเข็มทิศ 0° = ทิศเหนือ (-Z) เป็นมุม yaw ในฉาก 3D
        const relDeg = heading - state.gps.northDeg;
        const dx = Math.sin(relDeg * DEG), dz = -Math.cos(relDeg * DEG);
        state.user.yaw = yawOfDir(dx, dz);
        nav3D.userGroup.rotation.y = state.user.yaw;
      }

      const accR = clamp(accuracy || 4, 1.2, 16);
      nav3D.accDisc.visible = true;
      nav3D.accDisc.scale.set(accR, 1, accR);
      $('gpsAccTxt').textContent = `±${Math.round(accuracy || 1)} เมตร`;
      $('gpsStatusMsg').textContent = 'รับสัญญาณ GPS สดต่อเนื่อง เดินถือมือถือไปตามเส้นลูกศรสีเขียวได้เลย';
    },
    (err) => {
      const msgMap = {
        1: 'ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง กรุณากดอนุญาต Location บนเบราว์เซอร์มือถือ',
        2: 'สัญญาณดาวเทียมในอาคารอ่อนชั่วคราว สามารถกดแตะพื้นโกดังเพื่อระบุจุดยืนเสริมได้',
        3: 'หมดเวลารอสัญญาณ GPS กำลังลองเชื่อมต่อใหม่…',
      };
      $('gpsAccTxt').textContent = 'สัญญาณขัดข้อง';
      $('gpsStatusMsg').textContent = msgMap[err.code] || 'ไม่สามารถอ่านค่า GPS ได้ในขณะนี้';
      showToast('⚠️ ' + ($('gpsStatusMsg').textContent));
    },
    { enableHighAccuracy: true, maximumAge: 1500, timeout: 12000 }
  );
}

function applyRealGpsCoordinate() {
  if (state.gps.lastLat === null || state.gps.anchorLat === null) return;
  const dNorthM = (state.gps.lastLat - state.gps.anchorLat) * 111320;
  const dEastM = (state.gps.lastLng - state.gps.anchorLng) * 111320 * Math.cos(state.gps.anchorLat * DEG);
  const theta = state.gps.northDeg * DEG;
  const localEast = dEastM * Math.cos(theta) - dNorthM * Math.sin(theta);
  const localNorth = dNorthM * Math.cos(theta) + dEastM * Math.sin(theta);
  const nx = ENTRANCE_POS.x + localEast;
  const nz = ENTRANCE_POS.z - localNorth;
  setUserPosition(nx, nz);
}

async function enableMobileCompass() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') {
        showToast('⚠️ ไม่ได้รับอนุญาตใช้เข็มทิศมือถือ');
        return;
      }
    }
    if (!state.gps.compassOn) {
      const onOrient = (ev) => {
        let heading = null;
        if (typeof ev.webkitCompassHeading === 'number') {
          heading = ev.webkitCompassHeading;
        } else if (typeof ev.alpha === 'number') {
          heading = (360 - ev.alpha) % 360;
        }
        if (heading !== null) {
          state.gps.compassHeading = heading;
          const relDeg = heading - state.gps.northDeg;
          const dx = Math.sin(relDeg * DEG), dz = -Math.cos(relDeg * DEG);
          state.user.yaw = yawOfDir(dx, dz);
          nav3D.userGroup.rotation.y = state.user.yaw;
        }
      };
      window.addEventListener('deviceorientationabsolute', onOrient, true);
      window.addEventListener('deviceorientation', onOrient, true);
      state.gps.compassOn = true;
      $('btnCompassPerm').textContent = '🧭 เข็มทิศทำงานอยู่ ✓';
      $('btnCompassPerm').classList.add('bg-emerald-50', 'text-emerald-700', 'border-emerald-300');
      showToast('🧭 เปิดเข็มทิศหันหน้าตามมือถือเรียบร้อย');
    }
  } catch {
    showToast('⚠️ เบราว์เซอร์นี้ไม่รองรับเซ็นเซอร์เข็มทิศ');
  }
}

/* ---------- โหมดเดินนำทางอัตโนมัติ (Auto-Walk) ---------- */
let activeWalkWaypoints = [];

function beginAutoWalk() {
  if (!state.orderedStops.length) {
    showToast('กรุณาเลือกสินค้าอย่างน้อย 1 รายการก่อนเริ่มเดินนำทาง');
    setGpsMode('sim');
    return;
  }
  if (state.gps.walkStopCursor >= state.orderedStops.length) {
    state.gps.walkStopCursor = 0;
  }
  buildWalkLegToStop(state.gps.walkStopCursor);
  update3DPinsAndRoute();
  renderNavBanner();
  renderSelectedPanel();
}

function buildWalkLegToStop(stopIdx) {
  const target = state.orderedStops[stopIdx];
  if (!target) { activeWalkWaypoints = []; return; }
  activeWalkWaypoints = findWalkPath(state.user.x, state.user.z, target.loc.standX, target.loc.standZ);
  state.gps.walkSegIdx = 0;
  state.gps.walkPause = 0;
}

function stepAutoWalk(dt) {
  if (state.gps.mode !== 'walk') return;
  if (!state.orderedStops.length) { setGpsMode('sim'); return; }

  if (state.gps.walkPause > 0) {
    state.gps.walkPause -= dt;
    state.user.speed = 0;
    animatePersonRig(nav3D.userRig, 0, state.user.phase);
    if (state.gps.walkPause <= 0) {
      if (state.gps.walkStopCursor + 1 < state.orderedStops.length) {
        state.gps.walkStopCursor++;
        buildWalkLegToStop(state.gps.walkStopCursor);
        update3DPinsAndRoute();
        renderNavBanner();
        renderSelectedPanel();
      } else {
        showToast('🎉 เดินครบทุกตำแหน่งสินค้าที่เลือกแล้ว!');
        setGpsMode('sim');
      }
    }
    return;
  }

  if (state.gps.walkSegIdx >= activeWalkWaypoints.length) {
    const reached = state.orderedStops[state.gps.walkStopCursor];
    if (reached) {
      // หันหน้าเข้าหาชั้นวางสินค้าเมื่อเดินถึงจุดยืนหยิบ!
      const faceYaw = yawOfDir(reached.loc.x - state.user.x, reached.loc.z - state.user.z);
      setUserPosition(state.user.x, state.user.z, faceYaw);
      showToast(`✅ ถึงจุดที่ ${reached.stepNo}: ${reached.product.name} (${reached.loc.code})`);
    }
    state.gps.walkPause = 1.35;
    return;
  }

  const [tx, tz] = activeWalkWaypoints[state.gps.walkSegIdx];
  const dx = tx - state.user.x, dz = tz - state.user.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.12) {
    state.gps.walkSegIdx++;
    return;
  }
  const spd = state.gps.walkSpeed;
  const step = Math.min(d, spd * dt);
  const desiredYaw = yawOfDir(dx, dz);
  const nyaw = wrapAngle(state.user.yaw + clamp(wrapAngle(desiredYaw - state.user.yaw), -6.5 * dt, 6.5 * dt));
  state.user.speed = spd;
  state.user.phase += dt * (3.6 + spd * 1.45);
  animatePersonRig(nav3D.userRig, spd, state.user.phase);
  setUserPosition(state.user.x + (dx / d) * step, state.user.z + (dz / d) * step, nyaw);

  // อัปเดตตัวเลขระยะเหลือไปจุดถัดไปแบบสดๆ บนแบนเนอร์
  const target = state.orderedStops[state.gps.walkStopCursor];
  if (target) {
    const rem = Math.hypot(target.loc.standX - state.user.x, target.loc.standZ - state.user.z);
    $('navNextDist').textContent = `อีก ${Math.max(1, Math.round(rem))} ม.`;
  }
}

/* ---------- ปุ่มกดเดินจำลองบนจอ (WalkPad) และคีย์บอร์ด WASD/Arrows ---------- */
const heldKeys = new Set();

function stepManualWalk(dt) {
  if (state.gps.mode === 'walk') return;
  let f = 0, r = 0;
  if (heldKeys.has('up')) f += 1;
  if (heldKeys.has('down')) f -= 1;
  if (heldKeys.has('right')) r += 1;
  if (heldKeys.has('left')) r -= 1;
  if (eye.on) {
    if (f || r) stepEyeManualWalk(dt, f, r);
    else if (!eye.walkPath.length) state.user.speed = 0;
    return;
  }
  if (!f && !r) {
    if (state.user.speed > 0) {
      state.user.speed = 0;
      animatePersonRig(nav3D.userRig, 0, state.user.phase);
    }
    return;
  }
  // เดินสัมพัทธ์กับมุมกล้องปัจจุบันเพื่อให้กดเข้าใจง่ายทั้งมุม 2D และ 3D
  const fwdX = controls.target.x - camera.position.x;
  const fwdZ = controls.target.z - camera.position.z;
  const flen = Math.hypot(fwdX, fwdZ) || 1;
  const ux = fwdX / flen, uz = fwdZ / flen;
  const rx = -uz, rz = ux;

  let mvx = ux * f + rx * r;
  let mvz = uz * f + rz * r;
  const mlen = Math.hypot(mvx, mvz) || 1;
  mvx /= mlen; mvz /= mlen;

  const spd = 4.2;
  state.user.speed = spd;
  state.user.phase += dt * 7.5;
  animatePersonRig(nav3D.userRig, spd, state.user.phase);
  setUserPosition(state.user.x + mvx * spd * dt, state.user.z + mvz * spd * dt, yawOfDir(mvx, mvz));
}

/* =====================================================================
   7.5 EYE VIEW — มุมมองจากสายตาลูกค้า (ถือมือถือเดินหาสินค้า พร้อมรถเข็น)
   ===================================================================== */
const EYE_HEIGHT = 1.58;
const EYE_PITCH_REST = -0.1;   // ก้มเล็กน้อยให้เห็นรถเข็นและลูกศรนำทางบนพื้น
const EYE_WALK_SPEED = 2.4;
const EYE_TURN_SPEED = 1.9;
const EYE_AISLE_HALF = 0.4;    // เดินเองออกนอกแนวทางเดินได้ไม่เกินระยะนี้ (กันเดินทะลุเชลฟ์/แร็ค)
const EYE_TAP_RANGE = 30;      // แตะพื้นเพื่อเดินไปได้ไกลสุด (เมตร)
const CART_AHEAD = 0.95;       // รถเข็นอยู่หน้าลูกค้า (เมตร)

const eye = {
  on: false,
  dragYaw: 0, dragPitch: 0,          // มุมที่ผู้ใช้ลากนิ้ว/เมาส์หันมอง
  sensor: null,                      // { yaw, pitch } จากเซ็นเซอร์เอียงมือถือ (กรองสั่นแล้ว) · null = ยังไม่มีสัญญาณ
  sensorYaw0: 0, sensorPitch0: 0,    // ท่าถือมือถือตอนกด "กลับมุมมองตรงหน้า" ถือเป็นมองตรง
  listening: false,
  walkPath: [],                      // เส้นทางเดินไปยังจุดที่แตะบนพื้น
};

// เปิดเข็มทิศอยู่ = ตัวลูกค้าหันตามมือถืออยู่แล้ว จึงไม่บวกมุมหันจากเซ็นเซอร์ซ้ำ
const eyeViewYaw = () => state.user.yaw + eye.dragYaw
  + (eye.sensor && !state.gps.compassOn ? wrapAngle(eye.sensor.yaw - eye.sensorYaw0) : 0);
const eyeViewPitch = () => clamp(EYE_PITCH_REST + eye.dragPitch + (eye.sensor ? eye.sensor.pitch - eye.sensorPitch0 : 0), -1.25, 1.25);

function recenterEyeView() {
  eye.dragYaw = 0;
  eye.dragPitch = 0;
  if (eye.sensor) {
    eye.sensorYaw0 = eye.sensor.yaw;
    eye.sensorPitch0 = eye.sensor.pitch;
  }
}

/** ให้ตัวลูกค้า (และรถเข็น) หันไปทางที่กำลังมองอยู่ โดยภาพไม่กระตุก */
function alignBodyToEyeView() {
  state.user.yaw = wrapAngle(eyeViewYaw());
  eye.dragYaw = 0;
  if (eye.sensor) eye.sensorYaw0 = eye.sensor.yaw;
}

function lookEyeAt(x, y, z) {
  const dx = x - state.user.x, dz = z - state.user.z;
  eye.dragYaw += wrapAngle(yawOfDir(dx, dz) - eyeViewYaw());
  eye.dragPitch += Math.atan2(y - EYE_HEIGHT, Math.hypot(dx, dz) || 1) - eyeViewPitch();
}

const _devEuler = new THREE.Euler();
const _devQ = new THREE.Quaternion();
const _devScreenQ = new THREE.Quaternion();
const _devCamQ = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); // กล้องมองออกทางหลังเครื่อง ไม่ใช่ทางขอบบน
const _devAxisZ = new THREE.Vector3(0, 0, 1);
const _devFwd = new THREE.Vector3();

/** แปลงมุมเอียงมือถือ (alpha/beta/gamma) เป็นทิศที่หลังเครื่องชี้ แล้วใช้เป็นทิศมองแบบสดๆ */
function onEyeDeviceOrientation(ev) {
  if (!eye.on || typeof ev.alpha !== 'number' || typeof ev.beta !== 'number' || typeof ev.gamma !== 'number') return;
  const screenAngle = ((screen.orientation && screen.orientation.angle) || 0) * DEG;
  _devEuler.set(ev.beta * DEG, ev.alpha * DEG, -ev.gamma * DEG, 'YXZ');
  _devQ.setFromEuler(_devEuler).multiply(_devCamQ).multiply(_devScreenQ.setFromAxisAngle(_devAxisZ, -screenAngle));
  _devFwd.set(0, 0, -1).applyQuaternion(_devQ);
  const yaw = yawOfDir(_devFwd.x, _devFwd.z);
  const pitch = Math.asin(clamp(_devFwd.y, -1, 1));
  if (!eye.sensor) {
    eye.sensor = { yaw, pitch };
    eye.sensorYaw0 = yaw;
    eye.sensorPitch0 = pitch;
    return;
  }
  eye.sensor.yaw = wrapAngle(eye.sensor.yaw + wrapAngle(yaw - eye.sensor.yaw) * 0.35);
  eye.sensor.pitch += (pitch - eye.sensor.pitch) * 0.35;
}

async function startEyeSensor() {
  if (eye.listening || typeof DeviceOrientationEvent === 'undefined') return;
  try {
    if (typeof DeviceOrientationEvent.requestPermission === 'function'
      && (await DeviceOrientationEvent.requestPermission()) !== 'granted') {
      // แจ้งเฉพาะเครื่องจอสัมผัส (คอมพิวเตอร์ไม่มีเซ็นเซอร์เอียงเครื่องอยู่แล้ว)
      if (navigator.maxTouchPoints > 0) showToast('ไม่ได้รับอนุญาตใช้เซ็นเซอร์มือถือ — ใช้นิ้วลากหันมองแทนได้');
      return;
    }
  } catch {
    return;
  }
  window.addEventListener('deviceorientation', onEyeDeviceOrientation, true);
  eye.listening = true;
}

function applyCameraLens() {
  camera.fov = eye.on ? (innerWidth < innerHeight ? 82 : 68) : 32;
  camera.near = eye.on ? 0.08 : 0.5;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}

function setEyeView(on) {
  if (eye.on === on) return;
  if (on && state.is2D) toggle2D3D();
  eye.on = on;
  eye.walkPath = [];
  camTween.active = false;
  controls.enabled = !on;
  document.body.classList.toggle('eye-mode', on);
  $('btnEyeView').setAttribute('aria-pressed', String(on));
  $('btnEyeView').classList.toggle('bg-blue-600', on);
  $('btnEyeView').classList.toggle('text-white', on);
  setEyeViewScene(on);
  nav3D.userRig.group.visible = !on;
  nav3D.headingCone.visible = !on;
  applyCameraLens();
  if (on) {
    recenterEyeView();
    startEyeSensor();
    showToast('👁️ มุมมองจากสายตา: ลากนิ้วเพื่อหันมอง · แตะพื้นเพื่อเดินไป · กด ◎ กลับมุมมองตรงหน้า');
  } else {
    flyTo(state.user.x, 1.0, state.user.z, 18, 0.45);
    showToast('🏢 กลับสู่มุมมองแผนผังร้าน');
  }
}

/** จำกัดตำแหน่งให้อยู่ใกล้แนวทางเดินเท้า (ใช้ตอนเดินเองในมุมมองสายตา) */
function keepNearWalkway(x, z) {
  const snap = snapToWalkway(x, z);
  if (snap.dist <= EYE_AISLE_HALF) return [x, z];
  const k = EYE_AISLE_HALF / snap.dist;
  return [snap.x + (x - snap.x) * k, snap.z + (z - snap.z) * k];
}

/** ปุ่มเดินในมุมมองสายตา: ขึ้น/ลง = เดินหน้า/ถอยตามทิศที่มอง · ซ้าย/ขวา = หันตัว */
function stepEyeManualWalk(dt, f, r) {
  eye.walkPath = [];
  if (r) state.user.yaw = wrapAngle(state.user.yaw - r * EYE_TURN_SPEED * dt);
  let nx = state.user.x, nz = state.user.z;
  if (f) {
    if (f > 0) alignBodyToEyeView();
    nx += Math.cos(state.user.yaw) * f * EYE_WALK_SPEED * dt;
    nz -= Math.sin(state.user.yaw) * f * EYE_WALK_SPEED * dt;
    [nx, nz] = keepNearWalkway(nx, nz);
    state.user.phase += dt * 7.5;
  }
  state.user.speed = f ? EYE_WALK_SPEED : 0;
  setUserPosition(nx, nz, state.user.yaw);
}

/** แตะพื้นในมุมมองสายตา → เดินตามทางเดินเท้าไปยังจุดนั้น */
function walkEyeTo(x, z) {
  if (state.gps.mode === 'real') {
    showToast('กำลังใช้ GPS มือถือจริง ตำแหน่งจะขยับตามที่คุณเดิน');
    return;
  }
  if (state.gps.mode === 'walk') setGpsMode('sim');
  const snap = snapToWalkway(x, z);
  eye.walkPath = findWalkPath(state.user.x, state.user.z, snap.x, snap.z);
}

function stepEyeWalkTo(dt) {
  if (!eye.on || !eye.walkPath.length || state.gps.mode !== 'sim') return;
  const [tx, tz] = eye.walkPath[0];
  const dx = tx - state.user.x, dz = tz - state.user.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.12) {
    eye.walkPath.shift();
    if (!eye.walkPath.length) state.user.speed = 0;
    return;
  }
  const step = Math.min(d, EYE_WALK_SPEED * 1.25 * dt);
  const nyaw = wrapAngle(state.user.yaw + clamp(wrapAngle(yawOfDir(dx, dz) - state.user.yaw), -5 * dt, 5 * dt));
  state.user.speed = EYE_WALK_SPEED;
  state.user.phase += dt * 7.5;
  setUserPosition(state.user.x + (dx / d) * step, state.user.z + (dz / d) * step, nyaw);
}

/** วางกล้องที่ระดับสายตาลูกค้าทุกเฟรม (controls.target = จุดที่มอง เพื่อให้กลับมุมมองแผนผังได้ต่อเนื่อง) */
function stepEyeView() {
  const yaw = eyeViewYaw(), pitch = eyeViewPitch(), cp = Math.cos(pitch);
  const bob = state.user.speed > 0 ? Math.sin(state.user.phase * 2) * 0.016 : 0;
  camera.position.set(state.user.x, EYE_HEIGHT + bob, state.user.z);
  controls.target.set(state.user.x + Math.cos(yaw) * cp * 4, EYE_HEIGHT + bob + Math.sin(pitch) * 4, state.user.z - Math.sin(yaw) * cp * 4);
  camera.lookAt(controls.target);
}

/** รถเข็นอยู่หน้าลูกค้าตามทิศที่เดิน (ไม่หมุนตามตอนหันหน้าเข้าหาชั้นวาง จะได้ไม่ทะลุเชลฟ์) */
function followCart(prevX, prevZ) {
  const dx = state.user.x - prevX, dz = state.user.z - prevZ;
  const moved = Math.hypot(dx, dz);
  if (moved >= 1.5 || state.gps.mode === 'real') {
    nav3D.cartYaw = state.user.yaw;
  } else if (moved > 0.002) {
    const turn = wrapAngle(yawOfDir(dx, dz) - nav3D.cartYaw);
    if (Math.abs(wrapAngle(yawOfDir(dx, dz) - state.user.yaw)) < 2.1) nav3D.cartYaw = wrapAngle(nav3D.cartYaw + clamp(turn, -0.25, 0.25));
  }
  nav3D.cart.position.set(state.user.x + Math.cos(nav3D.cartYaw) * CART_AHEAD, 0, state.user.z - Math.sin(nav3D.cartYaw) * CART_AHEAD);
  nav3D.cart.rotation.y = nav3D.cartYaw;
}

/* =====================================================================
   7.6 SALES ASSISTANT — เชื่อมระบบพนักงานขาย/ตะกร้า (sales.js) กับหมุดและเส้นทาง
   ===================================================================== */
let sales = null;

function pinProduct(id, qty = 1) {
  const p = PRODUCT_BY_ID.get(id);
  if (!p || state.selected.has(id)) return;
  state.selected.set(id, { id, qty, locIdx: preferredLocIdxForProduct(p) });
  recomputeRoute();
  renderCatalogList();
}

function unpinProduct(id) {
  if (!state.selected.delete(id)) return;
  recomputeRoute();
  renderCatalogList();
}

function focusProductById(id) {
  const p = PRODUCT_BY_ID.get(id);
  if (!p) return;
  focusProductStop(state.orderedStops.find((s) => s.id === id) || { product: p, loc: p.primary, stepNo: 1 });
}

function startSalesAssistant() {
  sales = initSales({
    products: PRODUCTS, productById: PRODUCT_BY_ID, catMap: CAT_MAP, presets: PRESET_LISTS, formatSatang, esc,
    getUser: () => ({ x: state.user.x, z: state.user.z }),
    getZoneName: detectZoneName,
    isPinned: (id) => state.selected.has(id),
    pinProduct, unpinProduct,
    applyPreset: (id) => applyPresetList(id),
    focusProduct: focusProductById,
    showToast,
  });
  sales.onSelectionChanged();
  sales.onUserMoved(state.user.x, state.user.z);
}

/* =====================================================================
   8. DOM RENDERING (Catalog, Presets, Categories, Selected Stops, Banner)
   ===================================================================== */
function renderPresetsAndCategories() {
  // ชุดรายการตัวอย่างด่วน
  $('presetBar').innerHTML = PRESET_LISTS.map((pr) => `
    <button type="button" data-preset="${esc(pr.id)}" title="${esc(pr.desc)}"
      class="btn-base h-7 px-2.5 rounded-lg bg-indigo-50/90 border border-indigo-200/90 text-[11px] font-bold text-indigo-800 hover:bg-indigo-100 flex-none">
      ${esc(pr.title)}
    </button>
  `).join('');

  $('presetBar').querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => applyPresetList(btn.dataset.preset));
  });

  // ปุ่มหมวดหมู่สินค้า (ทั้งหมด + ทุกหมวดใน CATEGORIES)
  renderCategoryButtons();

  // จุดยืนด่วนในแผง GPS
  $('quickSpots').innerHTML = QUICK_SPOTS.map((sp, i) => `
    <button type="button" data-qspot="${i}"
      class="btn-base h-8 px-2 rounded-lg bg-white border border-slate-200 text-slate-700 font-bold hover:border-blue-400 hover:text-blue-700 justify-start truncate">
      ${esc(sp.label)}
    </button>
  `).join('');
  $('quickSpots').querySelectorAll('[data-qspot]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sp = QUICK_SPOTS[Number(btn.dataset.qspot)];
      if (!sp) return;
      if (state.gps.mode === 'walk') setGpsMode('sim');
      setUserPosition(sp.x, sp.z, sp.yaw, true);
      flyTo(sp.x, 1.0, sp.z, 18, 0.45);
      showToast(`📍 ย้ายตำแหน่งยืนไปที่ ${sp.label}`);
    });
  });
}

function renderCategoryButtons() {
  $('catBar').innerHTML = CATEGORIES.map((c) => {
    const active = state.catId === c.id;
    const cls = active
      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
      : 'bg-white/90 text-slate-700 border-slate-200 hover:bg-slate-50';
    return `
      <button type="button" data-cat="${esc(c.id)}" aria-pressed="${active}"
        class="btn-base h-7 px-2.5 rounded-lg border text-[11px] font-bold flex-none ${cls}">
        <span>${esc(c.icon)}</span><span>${esc(c.short)}</span>
      </button>
    `;
  }).join('');

  $('catBar').querySelectorAll('[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.catId = btn.dataset.cat;
      renderCategoryButtons();
      renderCatalogList();
    });
  });
}

function getFilteredCatalog() {
  const base = filterProducts(state.query, state.catId);
  if (state.locFilter === 'self') {
    return base.filter((p) => p.locations.some((l) => l.selfPick));
  }
  if (state.locFilter === 'bulk') {
    return base.filter((p) => p.locations.some((l) => l.kind !== 'shelf'));
  }
  return base;
}

function preferredLocIdxForProduct(p) {
  if (state.locFilter === 'bulk' || state.role === 'staff') {
    const bulkIdx = p.locations.findIndex((l) => l.kind !== 'shelf');
    if (bulkIdx >= 0 && state.locFilter === 'bulk') return bulkIdx;
  }
  if (state.locFilter === 'self') {
    const selfIdx = p.locations.findIndex((l) => l.selfPick);
    if (selfIdx >= 0) return selfIdx;
  }
  return 0;
}

const LIST_PAGE = 60;

function renderCatalogList() {
  const list = getFilteredCatalog();
  const listKey = `${state.query}|${state.catId}|${state.locFilter}`;
  if (listKey !== state.listKey || !state.listLimit) {
    state.listKey = listKey;
    state.listLimit = LIST_PAGE;
  }
  const shown = list.slice(0, state.listLimit);
  $('catalogCount').textContent = `${list.length} รายการ`;

  if (!list.length) {
    $('productList').innerHTML = `
      <div class="rounded-2xl bg-slate-50 border border-slate-200/80 p-6 text-center">
        <div class="text-2xl mb-1">🔎</div>
        <div class="text-xs font-extrabold text-slate-700">ไม่พบสินค้าที่ตรงกับคำค้นหา</div>
        <div class="text-[11px] text-slate-500 mt-1">ลองพิมพ์คำสั้นลง เช่น "สายไฟ", "ท่อ", "ปูน", "สว่าน" หรือกดล้างตัวกรอง</div>
      </div>
    `;
    return;
  }

  $('productList').innerHTML = shown.map((p) => {
    const sel = state.selected.get(p.id);
    const isSel = !!sel;
    const cat = CAT_MAP[p.cat] || CATEGORIES[0];
    const loc = getActiveLocation(p, sel || { locIdx: preferredLocIdxForProduct(p) });
    const distApprox = Math.round(Math.hypot(loc.standX - state.user.x, loc.standZ - state.user.z));
    const cardCls = isSel
      ? 'bg-blue-50/95 border-blue-400 ring-1 ring-blue-400/40'
      : 'bg-white/90 border-slate-200/85 hover:border-blue-300';
    const roleMeta = state.role === 'staff'
      ? `<span class="text-[10px] font-semibold text-slate-500 tnum">สต็อก ${p.totalStock} ${esc(p.unit)} · SKU ${esc(p.id)}</span>`
      : `<span class="text-[10px] font-semibold text-slate-500">${esc(p.brand)} · คงเหลือ ${loc.stock} ${esc(p.unit)}</span>`;

    return `
      <div class="rounded-xl border p-2.5 transition ${cardCls}" data-prodcard="${esc(p.id)}">
        <div class="row-base justify-between gap-2">
          <span class="badge-base px-1.5 py-0.5 rounded-md border text-[10px] font-bold ${cat.badge}">${esc(cat.icon)} ${esc(cat.short)}</span>
          <div class="row-base gap-1.5">
            ${p.locations.length > 1 ? `<span class="badge-base px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold">${p.locations.length} จุดเก็บ</span>` : ''}
            <span class="text-xs font-extrabold text-blue-700 tnum">${esc(formatSatang(p.priceSatang))}<span class="text-[10px] font-medium text-slate-500">/${esc(p.unit)}</span></span>
          </div>
        </div>

        <div class="mt-1.5 text-xs font-extrabold text-slate-900 leading-snug">${esc(p.name)}</div>

        <div class="row-base justify-between gap-2 mt-1">
          ${roleMeta}
          <span class="text-[10px] font-bold text-emerald-700 tnum">ห่าง ~${distApprox} ม.</span>
        </div>

        <div class="row-base justify-between gap-1.5 mt-2 pt-1.5 border-t border-slate-200/70">
          <div class="min-w-0 flex-1">
            <div class="row-base gap-1 text-[11px]">
              <span class="badge-base px-1.5 py-0.5 rounded bg-slate-900 text-white font-extrabold text-[10px] tnum">${esc(loc.code)}</span>
              <span class="font-semibold text-slate-700 truncate">${esc(loc.aisleLabel)}</span>
            </div>
            <div class="text-[10px] ${loc.selfPick ? 'text-emerald-700' : 'text-amber-700'} font-semibold truncate mt-0.5">
              ${esc(loc.levelLabel)}
            </div>
          </div>

          <div class="row-base gap-1 flex-none">
            <button type="button" data-zoomprod="${esc(p.id)}" title="ซูมดูตำแหน่งในโกดัง 3D"
              class="btn-base h-7 px-2 rounded-lg bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-700 hover:bg-slate-200">
              ดูจุด
            </button>
            <button type="button" data-toggleprod="${esc(p.id)}"
              class="btn-base h-7 px-2.5 rounded-lg text-[11px] font-extrabold ${
                isSel ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-emerald-600 text-white hover:bg-emerald-700'
              }">
              ${isSel ? '✓ ปักหมุดแล้ว' : '+ ปักหมุด'}
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('') + (list.length > shown.length ? `
    <button type="button" data-listmore
      class="btn-base w-full h-9 rounded-xl bg-white border border-slate-200 text-xs font-extrabold text-blue-700 hover:border-blue-400">
      แสดงเพิ่มอีก ${Math.min(LIST_PAGE, list.length - shown.length)} รายการ (แสดงอยู่ ${shown.length} จาก ${list.length})
    </button>
  ` : '');

  $('productList').querySelector('[data-listmore]')?.addEventListener('click', () => {
    state.listLimit += LIST_PAGE;
    renderCatalogList();
  });
  $('productList').querySelectorAll('[data-toggleprod]').forEach((btn) => {
    btn.addEventListener('click', () => toggleSelectProduct(btn.dataset.toggleprod));
  });
  $('productList').querySelectorAll('[data-zoomprod]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = PRODUCT_BY_ID.get(btn.dataset.zoomprod);
      if (!p) return;
      if (!state.selected.has(p.id)) {
        state.selected.set(p.id, { id: p.id, qty: 1, locIdx: preferredLocIdxForProduct(p) });
        recomputeRoute();
        renderCatalogList();
      }
      const stop = state.orderedStops.find((s) => s.id === p.id) || { product: p, loc: p.primary, stepNo: 1 };
      focusProductStop(stop);
    });
  });
}

function toggleSelectProduct(id) {
  const p = PRODUCT_BY_ID.get(id);
  if (!p) return;
  if (state.selected.has(id)) {
    state.selected.delete(id);
    showToast(`ลบหมุด ${p.name} ออกแล้ว`);
  } else {
    state.selected.set(id, { id, qty: 1, locIdx: preferredLocIdxForProduct(p) });
    showToast(`📍 ปักหมุด "${p.name}" (${p.primary.code}) แล้ว`);
  }
  recomputeRoute();
  renderCatalogList();
}

function applyPresetList(presetId, silent = false) {
  const pr = PRESET_LISTS.find((x) => x.id === presetId);
  if (!pr) return;
  state.selected.clear();
  for (const it of pr.items) {
    if (PRODUCT_BY_ID.has(it.id)) {
      state.selected.set(it.id, { id: it.id, qty: it.qty, locIdx: 0 });
    }
  }
  state.gps.walkStopCursor = 0;
  recomputeRoute();
  renderCatalogList();
  if (!silent) {
    showToast(`${pr.title} — ปักหมุดและคำนวณเส้นทางเดินเรียบร้อย!`);
    if (innerWidth < 1180) setMobileTab('route');
  }
}

function renderSelectedPanel() {
  const stops = state.orderedStops;
  $('selCountBadge').textContent = String(stops.length);

  // คำนวณระยะเดิน เวลาเดิน และราคารวมด้วยจำนวนเต็มสตางค์ BigInt เท่านั้น (กฎข้อ 20)
  let totalSatang = 0n;
  for (const s of stops) {
    totalSatang += BigInt(s.qty) * BigInt(s.product.priceSatang);
  }
  const walkMinutes = stops.length ? Math.max(1, Math.ceil(state.totalDistM / 68)) : 0;
  $('sumDist').textContent = `${Math.round(state.totalDistM)} ม.`;
  $('sumTime').textContent = stops.length ? `~${walkMinutes} นาที` : '0 นาที';
  $('sumPriceLbl').textContent = state.role === 'staff' ? 'มูลค่าใบเบิก' : 'ยอดรวมประมาณ';
  $('sumPrice').textContent = formatSatang(Number(totalSatang));

  if (!stops.length) {
    $('selectedList').innerHTML = `
      <div class="rounded-2xl bg-slate-50/90 border border-dashed border-slate-300 p-5 text-center">
        <div class="text-xl mb-1">🛒</div>
        <div class="text-xs font-extrabold text-slate-700">ยังไม่ได้ปักหมุดสินค้า</div>
        <div class="text-[11px] text-slate-500 mt-1 leading-relaxed">
          กดปุ่ม <b>"+ ปักหมุด"</b> จากรายการสินค้าฝั่งซ้าย (เลือกได้หลายรายการ) หรือกดชุดรายการตัวอย่างด้านบน ระบบจะแสดงหมุด 3 มิติพร้อมเรียงลำดับเดินใกล้สุดให้ทันที
        </div>
      </div>
    `;
    return;
  }

  $('selectedList').innerHTML = stops.map((s, idx) => {
    const isNext = idx === state.gps.walkStopCursor;
    const badgeCls = isNext ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white';
    const cardCls = isNext ? 'bg-emerald-50/80 border-emerald-400' : 'bg-white/95 border-slate-200/90';
    const lineSatang = BigInt(s.qty) * BigInt(s.product.priceSatang);
    const hasAltLoc = s.product.locations.length > 1;
    const curLocIdx = state.selected.get(s.id)?.locIdx ?? 0;

    return `
      <div class="rounded-xl border p-2.5 ${cardCls}">
        <div class="row-base justify-between gap-2">
          <button type="button" data-focusstop="${idx}" class="row-base gap-2 min-w-0 flex-1 text-left cursor-pointer bg-transparent border-0 p-0">
            <span class="badge-base w-5 h-5 rounded-md ${badgeCls} text-[11px] font-extrabold flex-none tnum">${s.stepNo}</span>
            <span class="text-xs font-extrabold text-slate-900 truncate hover:text-blue-700">${esc(s.product.name)}</span>
          </button>
          <button type="button" data-rmstop="${esc(s.id)}" aria-label="ลบรายการนี้"
            class="btn-base w-6 h-6 rounded-lg bg-slate-100 text-slate-500 text-[11px] font-bold hover:bg-rose-100 hover:text-rose-600 flex-none">✕</button>
        </div>

        <div class="row-base justify-between gap-2 mt-1.5 text-[11px]">
          <div class="row-base gap-1.5 min-w-0">
            <span class="badge-base px-1.5 py-0.5 rounded bg-slate-900 text-white text-[10px] font-extrabold tnum">${esc(s.loc.code)}</span>
            <span class="text-slate-600 truncate">${esc(s.loc.aisleLabel)}</span>
          </div>
          <span class="font-extrabold text-emerald-700 tnum flex-none">+${Math.round(s.legDist)} ม.</span>
        </div>

        <div class="row-base justify-between gap-2 mt-2 pt-1.5 border-t border-slate-200/70 text-[11px]">
          <div class="row-base gap-1">
            <button type="button" data-qtydelta="${esc(s.id)}:-1" class="btn-base w-6 h-6 rounded-md bg-slate-100 border border-slate-200 font-extrabold text-slate-700">−</button>
            <span class="min-w-[44px] text-center font-extrabold text-slate-800 tnum">${s.qty} ${esc(s.product.unit)}</span>
            <button type="button" data-qtydelta="${esc(s.id)}:1" class="btn-base w-6 h-6 rounded-md bg-slate-100 border border-slate-200 font-extrabold text-slate-700">+</button>
            ${hasAltLoc ? `
              <button type="button" data-switchloc="${esc(s.id)}" title="สลับจุดหยิบหน้าร้าน / พาเลทสำรอง"
                class="btn-base h-6 px-1.5 rounded-md bg-amber-50 border border-amber-200 text-[10px] font-bold text-amber-800 ml-1">
                สลับจุด (${curLocIdx + 1}/${s.product.locations.length})
              </button>
            ` : ''}
          </div>
          <div class="row-base gap-1.5">
            <span class="font-extrabold text-blue-700 tnum">${esc(formatSatang(Number(lineSatang)))}</span>
            <button type="button" data-picked="${esc(s.id)}" class="btn-base h-6 px-2 rounded-md bg-blue-600 text-white text-[10px] font-bold hover:bg-blue-700">
              หยิบแล้ว ✓
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  $('selectedList').querySelectorAll('[data-focusstop]').forEach((b) => {
    b.addEventListener('click', () => {
      const idx = Number(b.dataset.focusstop);
      state.gps.walkStopCursor = idx;
      update3DPinsAndRoute();
      renderNavBanner();
      renderSelectedPanel();
      if (state.orderedStops[idx]) focusProductStop(state.orderedStops[idx]);
    });
  });
  $('selectedList').querySelectorAll('[data-rmstop]').forEach((b) => {
    b.addEventListener('click', () => toggleSelectProduct(b.dataset.rmstop));
  });
  $('selectedList').querySelectorAll('[data-picked]').forEach((b) => {
    b.addEventListener('click', () => markStopPicked(b.dataset.picked));
  });
  $('selectedList').querySelectorAll('[data-qtydelta]').forEach((b) => {
    b.addEventListener('click', () => {
      const [id, dStr] = b.dataset.qtydelta.split(':');
      const entry = state.selected.get(id);
      if (!entry) return;
      entry.qty = clamp(entry.qty + Number(dStr), 1, 9999);
      renderSelectedPanel();
    });
  });
  $('selectedList').querySelectorAll('[data-switchloc]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset.switchloc;
      const entry = state.selected.get(id);
      const p = PRODUCT_BY_ID.get(id);
      if (!entry || !p) return;
      entry.locIdx = (entry.locIdx + 1) % p.locations.length;
      recomputeRoute();
      renderCatalogList();
      const stop = state.orderedStops.find((s) => s.id === id);
      if (stop) focusProductStop(stop);
    });
  });
}

function markStopPicked(id) {
  const p = PRODUCT_BY_ID.get(id);
  const entry = state.selected.get(id);
  if (!entry) return;
  state.selected.delete(id);
  sales?.onPicked(id, entry.qty);
  if (state.gps.walkStopCursor >= state.selected.size) state.gps.walkStopCursor = 0;
  recomputeRoute();
  renderCatalogList();
  if (state.gps.mode === 'walk' && state.orderedStops.length) {
    buildWalkLegToStop(state.gps.walkStopCursor);
  }
  if (p) {
    showToast(state.orderedStops.length
      ? `✅ หยิบ "${p.name}" แล้ว! นำทางต่อไปจุดถัดไป`
      : `🎉 หยิบสินค้าครบทุกรายการเรียบร้อยแล้ว!`);
  }
}

function renderNavBanner() {
  const stops = state.orderedStops;
  const banner = $('navBanner');
  if (!stops.length) {
    banner.classList.add('hidden');
    return;
  }
  banner.classList.remove('hidden');
  const cur = stops[clamp(state.gps.walkStopCursor, 0, stops.length - 1)];
  $('navStepBadge').textContent = String(cur.stepNo);
  $('navNextName').textContent = cur.product.name;
  $('navNextLoc').textContent = `${cur.loc.code} · ${cur.loc.zoneName}`;
  $('navNextDist').textContent = `อีก ${Math.max(1, Math.round(cur.legDist))} ม.`;
  $('navTotalInfo').textContent = `ทั้งหมด ${stops.length} จุด (${Math.round(state.totalDistM)} ม.)`;
}

function updateSelectionBadges() {
  const n = String(state.selected.size);
  $('deskSelBadge').textContent = n;
  $('mobSelBadge').textContent = n;
  $('mobSelBadge').classList.toggle('hidden', state.selected.size === 0);
}

/* =====================================================================
   9. ROLE SWITCHER, RESPONSIVE PANELS, TOAST & INPUT EVENTS
   ===================================================================== */
function setRole(role) {
  state.role = role;
  document.querySelectorAll('#roleSeg button, #roleSegMob button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.role === role));
  });

  // เปลี่ยนสีเสื้ออวตารตามบทบาทให้ดูชัดเจน
  const styleByRole = {
    customer:   { shirtColor: 0x2563eb, hatColor: null,     label: 'มุมมองลูกค้าทั่วไป — แสดงจุดหยิบหน้าร้านและทางเดินปลอดภัย' },
    staff:      { shirtColor: 0xea580c, hatColor: 0xfacc15, label: 'มุมมองพนักงานคลัง — แสดง SKU สต็อกรวม และช่องพาเลทสำรอง' },
    contractor: { shirtColor: 0x0f766e, hatColor: 0xffffff, label: 'มุมมองช่าง/ผู้รับเหมา — รองรับจัดชุดวัสดุหลายโซนพร้อมคำนวณงบ' },
  };
  const cfg = styleByRole[role] || styleByRole.customer;
  nav3D.userGroup.remove(nav3D.userRig.group);
  nav3D.userRig = createPersonRig({ shirtColor: cfg.shirtColor, hatColor: cfg.hatColor });
  nav3D.userGroup.add(nav3D.userRig.group);

  renderCatalogList();
  renderSelectedPanel();
  showToast(`👤 ${cfg.label}`);
}

function setMobileTab(tab) {
  state.mobTab = tab;
  document.querySelectorAll('#mobileDock [data-mobtab]').forEach((b) => {
    const on = b.dataset.mobtab === tab;
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('text-blue-700', on);
    b.classList.toggle('bg-blue-50/90', on);
    b.classList.toggle('text-slate-600', !on);
  });
  document.querySelectorAll('.panel-sheet').forEach((sh) => {
    sh.classList.toggle('mob-open', sh.dataset.mob === tab);
  });
}

let toastTimer = null;
function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function bindUIEvents() {
  // ช่องค้นหาหลัก
  const sIn = $('searchInput');
  const sClr = $('btnClearSearch');
  sIn.addEventListener('input', () => {
    state.query = sIn.value;
    sClr.classList.toggle('hidden', !state.query);
    sClr.classList.toggle('flex', !!state.query);
    renderCatalogList();
    if (innerWidth < 1180 && state.query.trim().length > 0 && state.mobTab !== 'catalog') {
      setMobileTab('catalog');
    }
  });
  sIn.addEventListener('focus', () => {
    if (innerWidth < 1180 && state.mobTab === 'map') setMobileTab('catalog');
  });
  sClr.addEventListener('click', () => {
    sIn.value = '';
    state.query = '';
    sClr.classList.add('hidden');
    sClr.classList.remove('flex');
    renderCatalogList();
    sIn.focus();
  });

  // บทบาทผู้ใช้งาน
  document.querySelectorAll('#roleSeg button, #roleSegMob button').forEach((b) => {
    b.addEventListener('click', () => setRole(b.dataset.role));
  });

  // ตัวกรองโซนในแค็ตตาล็อก
  document.querySelectorAll('#locFilterSeg button').forEach((b) => {
    b.addEventListener('click', () => {
      state.locFilter = b.dataset.loc;
      document.querySelectorAll('#locFilterSeg button').forEach((x) => {
        x.setAttribute('aria-pressed', String(x === b));
      });
      renderCatalogList();
    });
  });

  // ปุ่มเลือก 5 อันดับแรกจากผลการค้นหาปัจจุบัน
  $('btnSelectVisible').addEventListener('click', () => {
    const vis = getFilteredCatalog().slice(0, 5);
    if (!vis.length) return;
    let added = 0;
    for (const p of vis) {
      if (!state.selected.has(p.id)) {
        state.selected.set(p.id, { id: p.id, qty: 1, locIdx: preferredLocIdxForProduct(p) });
        added++;
      }
    }
    recomputeRoute();
    renderCatalogList();
    showToast(added ? `📍 ปักหมุดเพิ่ม ${added} รายการพร้อมคำนวณเส้นทางแล้ว` : 'ทั้ง 5 รายการถูกปักหมุดไว้อยู่แล้ว');
  });

  // ปุ่มพับแผงซ้าย/ขวาบนจอ Notebook
  $('btnToggleLeft').addEventListener('click', () => document.body.classList.toggle('hide-left'));
  $('btnToggleRight').addEventListener('click', () => document.body.classList.toggle('hide-right'));

  // ปุ่มในแบนเนอร์นำทางด้านบน
  $('btnBannerZoom').addEventListener('click', () => {
    const cur = state.orderedStops[state.gps.walkStopCursor];
    if (cur) focusProductStop(cur);
  });
  $('btnBannerPick').addEventListener('click', () => {
    const cur = state.orderedStops[state.gps.walkStopCursor];
    if (cur) markStopPicked(cur.id);
  });
  $('btnBannerWalk').addEventListener('click', () => {
    setGpsMode(state.gps.mode === 'walk' ? 'sim' : 'walk');
  });

  // ปุ่มในแผงรายการที่เลือก
  $('btnStartWalk').addEventListener('click', () => {
    if (innerWidth < 1180 && state.gps.mode !== 'walk') setMobileTab('map');
    setGpsMode(state.gps.mode === 'walk' ? 'sim' : 'walk');
  });
  $('btnClearList').addEventListener('click', () => {
    state.selected.clear();
    if (state.gps.mode === 'walk') setGpsMode('sim');
    recomputeRoute();
    renderCatalogList();
    showToast('ล้างหมุดสินค้าทั้งหมดแล้ว');
  });
  $('tglOptimizeRoute').addEventListener('click', (e) => {
    state.optimizeRoute = !state.optimizeRoute;
    e.currentTarget.setAttribute('aria-checked', String(state.optimizeRoute));
    recomputeRoute();
  });

  // ปุ่มในแผง GPS
  $('topGpsBtn').addEventListener('click', () => {
    if (innerWidth < 1180) setMobileTab('gps');
    else {
      document.body.classList.remove('hide-right');
      flyTo(state.user.x, 1.0, state.user.z, 18, 0.45);
    }
  });
  document.querySelectorAll('#gpsModeSeg button').forEach((b) => {
    b.addEventListener('click', () => setGpsMode(b.dataset.gpsmode));
  });
  $('btnCalibrateEntrance').addEventListener('click', () => {
    if (state.gps.lastLat !== null) {
      state.gps.anchorLat = state.gps.lastLat;
      state.gps.anchorLng = state.gps.lastLng;
    }
    setUserPosition(ENTRANCE_POS.x, ENTRANCE_POS.z, Math.PI / 2, true);
    showToast('📌 เทียบพิกัดปัจจุบันเป็นประตูทางเข้าลูกค้าเรียบร้อย!');
  });
  $('btnCompassPerm').addEventListener('click', enableMobileCompass);
  $('sldNorthDeg').addEventListener('input', (e) => {
    state.gps.northDeg = Number(e.target.value) || 0;
    $('valNorthDeg').textContent = `${state.gps.northDeg}°`;
    if (state.gps.mode === 'real') applyRealGpsCoordinate();
  });
  $('btnToggleWalkPad').addEventListener('click', () => {
    $('walkPad').classList.toggle('show');
  });
  $('tglFollowUser').addEventListener('click', (e) => {
    state.followUser = !state.followUser;
    e.currentTarget.setAttribute('aria-checked', String(state.followUser));
    if (state.followUser) flyTo(state.user.x, 1.0, state.user.z, 18, 0.45);
  });
  document.querySelectorAll('#walkSpeedSeg button').forEach((b) => {
    b.addEventListener('click', () => {
      state.gps.walkSpeed = Number(b.dataset.spd) || 2.8;
      document.querySelectorAll('#walkSpeedSeg button').forEach((x) => {
        x.setAttribute('aria-pressed', String(x === b));
      });
    });
  });
  document.querySelectorAll('#gfxSeg button').forEach((b) => {
    b.addEventListener('click', () => setGfxPref(b.dataset.gfx));
  });

  // ปุ่มลอยขวา (FABs)
  $('btnMyPos').addEventListener('click', () => {
    if (eye.on) {
      recenterEyeView();
      showToast('◎ กลับมุมมองตรงหน้าแล้ว');
      return;
    }
    flyTo(state.user.x, 1.0, state.user.z, 16, 0.45);
    showToast('📍 ซูมมาที่ตำแหน่งปัจจุบันของคุณ');
  });
  $('btnEyeView').addEventListener('click', () => setEyeView(!eye.on));
  $('btnQuickGps').addEventListener('click', () => {
    if (state.gps.mode === 'real') {
      setGpsMode('sim');
      showToast('สลับกลับเป็นโหมดจำลองในอาคาร');
    } else {
      setGpsMode('real');
      if (innerWidth < 1180) setMobileTab('gps');
    }
  });
  $('btnTapMove').addEventListener('click', () => {
    state.tapMoveMode = !state.tapMoveMode;
    document.body.classList.toggle('tap-move-mode', state.tapMoveMode);
    $('btnTapMove').classList.toggle('bg-emerald-600', state.tapMoveMode);
    $('btnTapMove').classList.toggle('text-white', state.tapMoveMode);
    showToast(state.tapMoveMode
      ? '👆 แตะพื้นตรงไหนก็ได้ในโกดังเพื่อย้ายจุดที่คุณยืน'
      : 'ปิดโหมดแตะพื้นย้ายตำแหน่ง');
  });
  $('btnToggle2D').addEventListener('click', toggle2D3D);
  $('btnHomeView').addEventListener('click', fitHomeView);

  // แตะพื้นโกดังเพื่อย้ายจุดยืน (Raycaster ลงระนาบพื้น y = 0)
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hitPt = new THREE.Vector3();
  let pDown = null;

  canvas.addEventListener('pointerdown', (e) => {
    pDown = { x: e.clientX, y: e.clientY, id: e.pointerId, lastX: e.clientX, lastY: e.clientY };
    camTween.active = false;
  });
  // มุมมองสายตา: ลากนิ้ว/เมาส์ = หันมอง (ภาพเลื่อนตามนิ้วแบบแผนที่ถนน)
  canvas.addEventListener('pointermove', (e) => {
    if (!eye.on || !pDown || e.pointerId !== pDown.id || !(e.buttons || e.pointerType === 'touch')) return;
    const k = (camera.fov * DEG) / innerHeight;
    eye.dragYaw = wrapAngle(eye.dragYaw + (e.clientX - pDown.lastX) * k);
    eye.dragPitch = clamp(eye.dragPitch + (e.clientY - pDown.lastY) * k, -1.3, 1.3);
    pDown.lastX = e.clientX;
    pDown.lastY = e.clientY;
  });
  canvas.addEventListener('pointercancel', () => { pDown = null; });
  canvas.addEventListener('pointerup', (e) => {
    const down = pDown;
    pDown = null;
    if (!down || !(state.tapMoveMode || eye.on)) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    ndc.x = (e.clientX / innerWidth) * 2 - 1;
    ndc.y = -(e.clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(groundPlane, hitPt)) {
      if (eye.on) {
        const inRange = Math.hypot(hitPt.x - state.user.x, hitPt.z - state.user.z) <= EYE_TAP_RANGE;
        if (inRange && hitPt.x >= W.X0 && hitPt.x <= W.X1 && hitPt.z >= W.Z0 && hitPt.z <= W.Z1) walkEyeTo(hitPt.x, hitPt.z);
        return;
      }
      if (hitPt.x >= W.X0 && hitPt.x <= W.X1 && hitPt.z >= W.Z0 && hitPt.z <= W.Z1) {
        if (state.gps.mode === 'walk') setGpsMode('sim');
        const snap = snapToWalkway(hitPt.x, hitPt.z);
        const tx = snap.dist < 2.2 ? snap.x : hitPt.x;
        const tz = snap.dist < 2.2 ? snap.z : hitPt.z;
        const nyaw = yawOfDir(tx - state.user.x, tz - state.user.z);
        setUserPosition(tx, tz, nyaw, true);
        showToast(`📍 ย้ายตำแหน่งยืนไปที่ X ${tx.toFixed(1)}, Z ${tz.toFixed(1)} ม.`);
      }
    }
  });

  // ปุ่มกดเดินบนหน้าจอ WalkPad
  document.querySelectorAll('#walkPad [data-wkey]').forEach((btn) => {
    const k = btn.dataset.wkey;
    const press = (ev) => { ev.preventDefault(); heldKeys.add(k); btn.classList.add('on'); };
    const release = () => { heldKeys.delete(k); btn.classList.remove('on'); };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
  });

  // คีย์บอร์ด WASD / Arrow สำหรับเดินในโกดังบน Notebook
  const keyMap = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
  };
  window.addEventListener('keydown', (e) => {
    if (document.activeElement === sIn) return;
    if (keyMap[e.code]) heldKeys.add(keyMap[e.code]);
  });
  window.addEventListener('keyup', (e) => {
    if (keyMap[e.code]) heldKeys.delete(keyMap[e.code]);
  });

  // แถบเมนูมือถือและแท็บเล็ต
  document.querySelectorAll('#mobileDock [data-mobtab]').forEach((b) => {
    b.addEventListener('click', () => {
      const t = b.dataset.mobtab;
      setMobileTab(state.mobTab === t && t !== 'map' ? 'map' : t);
    });
  });
  document.querySelectorAll('.mob-close').forEach((b) => {
    b.addEventListener('click', () => setMobileTab('map'));
  });
  document.querySelectorAll('.mob-expand').forEach((b) => {
    b.addEventListener('click', () => {
      b.closest('.panel-sheet')?.classList.toggle('mob-tall');
    });
  });

  // แถบนำทางด้านบนสูงไม่เท่ากันตามความยาวชื่อสินค้า → บอกความสูงจริงให้ CSS เลื่อนปุ่มลอย/ปุ่มเดินบนมือถือลงตาม
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--nav-h', `${$('navBanner').offsetHeight}px`);
  }).observe($('navBanner'));
  window.addEventListener('resize', () => {
    applyCameraLens();
    renderer.setSize(innerWidth, innerHeight);
    gfxPixelRatio();
  });
}

/* =====================================================================
   10. BOOTSTRAP & MAIN ANIMATION LOOP
   ===================================================================== */
async function boot() {
  const bar = $('loaderBar');
  const txt = $('loaderText');
  const onProg = (pct, msg) => {
    if (bar) bar.style.width = `${pct}%`;
    if (txt && msg) txt.textContent = msg;
  };

  await initWarehouse(onProg, { rackTypes: catalogRackTypes() });
  onProg(92, `กำลังเชื่อมพิกัดสินค้า ${PRODUCTS.length} รายการ และสร้างเส้นทางเดินนำทาง…`);

  bindCatalogToScene();
  buildPedestrianGraph();
  auditCatalogNavigation();
  init3DWayfindingObjects();
  renderPresetsAndCategories();
  bindUIEvents();
  setGfxUI();

  // เปิดหน้าครั้งแรก: โหลดชุดตัวอย่าง "ชุดเดินไฟบ้านใหม่ (6 จุด)" เพื่อให้เห็นหมุดหลายจุดพร้อมเส้นทางเดินจากทางเข้าทันที
  applyPresetList('preset-elec-home', true);
  startSalesAssistant();
  updateGpsReadoutUI();
  fitHomeView();

  onProg(100, 'พร้อมค้นหาตำแหน่งสินค้าและนำทางแล้ว!');
  setTimeout(() => {
    const loader = $('loader');
    loader.style.opacity = '0';
    loader.style.pointerEvents = 'none';
    setTimeout(() => loader.remove(), 520);
  }, 220);

  let prev = performance.now() / 1000;
  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now() / 1000;
    const rawDt = now - prev;
    prev = now;
    const dt = Math.min(rawDt, 0.05);

    if (camTween.active) {
      camTween.t = Math.min(1, camTween.t + dt / camTween.dur);
      const e = 1 - Math.pow(1 - camTween.t, 3);
      camera.position.lerpVectors(camTween.p0, camTween.p1, e);
      controls.target.lerpVectors(camTween.t0, camTween.t1, e);
      if (camTween.t >= 1) camTween.active = false;
    }

    stepAutoWalk(dt);
    stepManualWalk(dt);
    stepEyeWalkTo(dt);
    if (eye.on) stepEyeView();
    else controls.update();
    stepWarehouse();
    updateOverlaysPerFrame(now);
    renderer.render(scene, camera);
    gfxWatch(rawDt, now);
  }
  animate();
}

boot();
