// พนักงานขายอัตโนมัติ + ตะกร้าสินค้า (vanilla ES module, ไม่มี backend: เก็บใน localStorage ทั้งหมด)
// เงินทุกจุดเป็นจำนวนเต็มสตางค์ — ห้ามใช้ทศนิยม/parseFloat

const K_BASKET = 'bw02.sales.basket';
const K_TICKETS = 'bw02.sales.tickets';
const K_COLLAPSED = 'bw02.sales.collapsed';
const K_VOICE = 'bw02.sales.voice';
const K_PRESET = 'bw02.sales.preset';

const GRID_CELL = 4;          // ม. ต่อช่อง spatial grid
const NEAR_RADIUS = 5;        // ม. รัศมีแนะนำสินค้า
const MOVE_THRESHOLD = 1.5;   // ม. ขยับเท่านี้ถึงคำนวณใหม่
const REPEAT_BLOCK_MS = 60000;
const ZONE_GAP_MS = 6000;
const MAX_QTY = 999;
const MAX_TICKETS = 20;

// ---------- ตารางกฎ "ของที่ใช้คู่กัน" (data ล้วน) ----------
// words = คำในชื่อสินค้าต้นทาง, not = คำที่ถ้ามีให้ข้ามกฎ (กันวนซ้ำกับสินค้าคู่), needs = คำค้นของคู่กัน
const PAIR_RULES = [
  { id: 'tile', words: ['กระเบื้อง'], not: ['กาว', 'ยาแนว', 'เกรียง'], needs: ['กาวซีเมนต์', 'ยาแนว', 'เกรียง'] },
  { id: 'wire', words: ['สายไฟ'], not: ['ท่อ', 'เทป', 'เบรกเกอร์'], needs: ['ท่อร้อยสาย', 'เบรกเกอร์', 'เทปพันสายไฟ'] },
  { id: 'paint', words: ['สีทา', 'สีน้ำ', 'สีอะคริลิก'], not: ['ลูกกลิ้ง', 'แปรง', 'รองพื้น'], needs: ['ลูกกลิ้ง', 'แปรง', 'สีรองพื้น'] },
  { id: 'pvc', words: ['ท่อ pvc', 'ท่อพีวีซี', 'ท่อ พีวีซี'], not: ['ข้อต่อ', 'กาว', 'เทป'], needs: ['ข้อต่อ', 'กาวทาท่อ', 'เทปพันเกลียว'] },
  { id: 'cement', words: ['ปูน'], not: ['เกรียง', 'กาว', 'ยาแนว'], needs: ['เกรียง', 'ทรายหยาบ', 'ทราย'] },
  { id: 'toilet', words: ['ชักโครก', 'สุขภัณฑ์', 'โถส้วม'], not: ['สาย', 'วาล์ว'], needs: ['สายฉีดชำระ', 'สต็อปวาล์ว', 'สตอปวาล์ว'] },
  { id: 'drill', words: ['สว่าน'], not: ['ดอก'], needs: ['ดอกสว่าน', 'พุก', 'ตลับเมตร'] },
  { id: 'breaker', words: ['เบรกเกอร์'], not: ['ตู้'], needs: ['ตู้คอนซูมเมอร์', 'สายไฟ'] },
  { id: 'faucet', words: ['ก๊อก', 'ก๊อกน้ำ'], not: ['เทป', 'สาย'], needs: ['เทปพันเกลียว', 'สายน้ำดี'] },
  { id: 'steel', words: ['เหล็กเส้น', 'เหล็กข้ออ้อย', 'เหล็กกล่อง'], not: ['ลวด', 'ใบตัด'], needs: ['ลวดผูกเหล็ก', 'ใบตัด', 'ถุงมือ'] },
  { id: 'grinder', words: ['เครื่องเจียร', 'หินเจียร'], not: ['ใบตัด', 'ใบเจียร'], needs: ['ใบตัด', 'แว่นตานิรภัย', 'ถุงมือ'] },
  { id: 'plug', words: ['ปลั๊ก', 'สวิตช์', 'สวิทช์'], not: ['กล่อง', 'ราง', 'สายไฟ'], needs: ['กล่องพลาสติก', 'สายไฟ', 'เทปพันสายไฟ'] },
  { id: 'lamp', words: ['โคมไฟ', 'โคมดาวน์ไลท์', 'ดาวน์ไลท์'], not: ['หลอด'], needs: ['หลอดไฟ', 'สวิตช์', 'สายไฟ'] },
  { id: 'oilpaint', words: ['สีน้ำมัน', 'สีสเปรย์'], not: ['ทินเนอร์', 'แปรง'], needs: ['ทินเนอร์', 'แปรง', 'กระดาษทราย'] },
  { id: 'hose', words: ['สายยาง'], not: ['ข้อต่อ', 'หัว'], needs: ['ข้อต่อสายยาง', 'หัวฉีด', 'ก๊อกสนาม'] },
  { id: 'screw', words: ['สกรู', 'ตะปู'], not: ['ไขควง'], needs: ['ไขควง', 'ค้อน'] },
];

// ---------- ฟังก์ชันล้วน (export เพื่อทดสอบ) ----------
const HEAVY_WORDS = ['50 กก.', '40 กก.', 'พาเลท', 'ถัง 18', '6 ม.', '6 เมตร', 'ชักโครก', 'อ่างอาบน้ำ', 'ถังเก็บน้ำ', 'ตู้เชื่อม', 'ปั๊มลม'];
const STAFF_KINDS = ['bulk', 'long', 'showroom'];
const STAFF_CATS = ['cement', 'steel'];

/** true = ชิ้นใหญ่/หนัก ลูกค้ายกเองไม่ไหว */
export function needsStaff(product, loc) {
  if (loc && loc.selfPick === false) return true;
  if (loc && STAFF_KINDS.includes(loc.kind)) return true;
  if (!product) return false;
  if (STAFF_CATS.includes(product.cat)) return true;
  const text = `${product.name || ''} ${product.unit || ''}`.toLowerCase();
  return HEAVY_WORDS.some((w) => text.includes(w.toLowerCase()));
}

function safeInt(n) {
  return Number.isSafeInteger(n) ? n : 0;
}

/** ยอดบรรทัด (สตางค์ จำนวนเต็ม) */
export function lineTotal(priceSatang, qty) {
  return safeInt(priceSatang) * safeInt(qty);
}

/** รวมยอดตะกร้า: items = [{id, qty, mode}] → จำนวนเต็มสตางค์ทั้งหมด */
export function basketTotals(items, productById) {
  const t = { selfSatang: 0, staffSatang: 0, totalSatang: 0, selfPieces: 0, staffPieces: 0, pieces: 0, lines: 0 };
  for (const it of items || []) {
    const p = productById && productById.get ? productById.get(it.id) : null;
    if (!p) continue;
    const sum = lineTotal(p.priceSatang, it.qty);
    const qty = safeInt(it.qty);
    if (it.mode === 'staff') { t.staffSatang += sum; t.staffPieces += qty; } else { t.selfSatang += sum; t.selfPieces += qty; }
    t.lines += 1;
  }
  t.totalSatang = t.selfSatang + t.staffSatang;
  t.pieces = t.selfPieces + t.staffPieces;
  return t;
}

const pad = (n, w) => String(n).padStart(w, '0');

/** เลขที่ใบจัดสินค้า JS-YYMMDD-HHMM-NNN (rnd = จำนวนเต็ม 0-999) */
export function makeTicketNo(date, rnd) {
  const d = date instanceof Date ? date : new Date();
  const ymd = pad(d.getFullYear() % 100, 2) + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2);
  return `JS-${ymd}-${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}-${pad(Math.abs(Math.trunc(rnd)) % 1000, 3)}`;
}

// ---------- localStorage แบบไม่ throw ----------
function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, val); } catch { /* เต็ม/ปิดใช้งาน: ข้ามเงียบ */ }
}
function lsGetJson(key, fallback) {
  try { const v = JSON.parse(lsGet(key)); return v == null ? fallback : v; } catch { return fallback; }
}

// ---------- สถานะโมดูล ----------
let handle = null;

export function initSales(api) {
  if (handle) return handle;
  if (typeof document === 'undefined') return noopHandle();
  const S = createState(api);
  injectStyle();
  buildDom(S);
  bindEvents(S);
  refreshSelection(S);
  renderAll(S);
  handle = {
    onUserMoved: (x, z) => onUserMoved(S, x, z),
    onPicked: (id, qty) => onPicked(S, id, qty),
    onSelectionChanged: () => { refreshSelection(S); renderAll(S); },
    openBasket: () => setPanelOpen(S, true),
    getBasketCount: () => basketPieces(S),
  };
  return handle;
}

function noopHandle() {
  return { onUserMoved() {}, onPicked() {}, onSelectionChanged() {}, openBasket() {}, getBasketCount: () => 0 };
}

function createState(api) {
  const products = Array.isArray(api.products) ? api.products : [];
  const S = {
    api,
    products,
    productById: api.productById || new Map(products.map((p) => [p.id, p])),
    esc: api.esc || ((s) => String(s)),
    fmt: api.formatSatang || ((n) => String(n)),
    basket: new Map(),
    tickets: lsGetJson(K_TICKETS, []),
    grid: buildGrid(products),
    haystack: products.map((p) => ({ p, h: haystackOf(p) })),
    queryCache: new Map(),
    pinnedIds: [],
    companionIds: new Set(),
    companions: [],
    suggestions: [],
    recent: new Map(),
    lastPos: null,
    lastZone: null,
    lastZoneAt: 0,
    message: 'สวัสดีครับ เดินดูสินค้าได้เลย มีอะไรให้ช่วยบอกได้ครับ',
    collapsed: lsGet(K_COLLAPSED) === '1',
    voiceOn: lsGet(K_VOICE) === '1',
    presetId: lsGet(K_PRESET) || '',
    ui: { panelOpen: false, confirmClear: false, ticketNo: null },
    voiceOk: voiceSupported(),
    el: {},
  };
  loadBasket(S);
  if (!Array.isArray(S.tickets)) S.tickets = [];
  return S;
}

function haystackOf(p) {
  const kw = Array.isArray(p.keywords) ? p.keywords.join(' ') : String(p.keywords || '');
  return `${p.name || ''} ${kw} ${p.brand || ''}`.toLowerCase();
}

function voiceSupported() {
  try { return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'; } catch { return false; }
}

// ---------- spatial grid ----------
function cellKey(ix, iz) { return `${ix},${iz}`; }

function buildGrid(products) {
  const cells = new Map();
  for (const p of products) {
    for (const loc of p.locations || []) {
      if (!Number.isFinite(loc.standX) || !Number.isFinite(loc.standZ)) continue;
      const key = cellKey(Math.floor(loc.standX / GRID_CELL), Math.floor(loc.standZ / GRID_CELL));
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push({ id: p.id, loc, x: loc.standX, z: loc.standZ });
    }
  }
  return cells;
}

/** คืน Map<productId, {entry, d}> เฉพาะจุดที่ใกล้สุดของแต่ละสินค้า ภายในรัศมี r */
function queryGrid(grid, x, z, r) {
  const span = Math.ceil(r / GRID_CELL);
  const cx = Math.floor(x / GRID_CELL);
  const cz = Math.floor(z / GRID_CELL);
  const best = new Map();
  for (let ix = cx - span; ix <= cx + span; ix++) {
    for (let iz = cz - span; iz <= cz + span; iz++) {
      for (const e of grid.get(cellKey(ix, iz)) || []) {
        const d = Math.hypot(e.x - x, e.z - z);
        if (d > r) continue;
        const cur = best.get(e.id);
        if (!cur || d < cur.d) best.set(e.id, { entry: e, d });
      }
    }
  }
  return best;
}

// ---------- ตะกร้า ----------
function loadBasket(S) {
  const raw = lsGetJson(K_BASKET, []);
  if (!Array.isArray(raw)) return;
  for (const it of raw) {
    if (!it || !S.productById.has(it.id)) continue;
    const qty = Math.min(MAX_QTY, Math.max(1, Math.trunc(Number(it.qty)) || 1));
    const mode = it.mode === 'staff' ? 'staff' : 'self';
    S.basket.set(it.id, { id: it.id, qty, mode, ticket: typeof it.ticket === 'string' ? it.ticket : '' });
  }
}

function saveBasket(S) {
  lsSet(K_BASKET, JSON.stringify([...S.basket.values()]));
}

function basketPieces(S) {
  let n = 0;
  for (const it of S.basket.values()) n += it.qty;
  return n;
}

function productLoc(p) {
  return p.primary || (p.locations && p.locations[0]) || null;
}

function addToBasket(S, id, qty, mode) {
  const p = S.productById.get(id);
  if (!p) return false;
  const cur = S.basket.get(id);
  if (cur && cur.ticket) { S.api.showToast?.('รายการนี้อยู่ระหว่างรอพนักงานจัดแล้ว'); return false; }
  const add = Math.max(1, Math.trunc(Number(qty)) || 1);
  if (cur) {
    cur.qty = Math.min(MAX_QTY, cur.qty + add);
    if (mode === 'staff') cur.mode = 'staff';
  } else {
    S.basket.set(id, { id, qty: Math.min(MAX_QTY, add), mode, ticket: '' });
  }
  afterBasketChange(S);
  return true;
}

function afterBasketChange(S) {
  saveBasket(S);
  S.ui.confirmClear = false;
  refreshCompanions(S);
  recheckSuggestions(S);
  renderAll(S);
}

function onPicked(S, id, qty) {
  const p = S.productById.get(id);
  if (!p) return;
  const staff = needsStaff(p, productLoc(p));
  addToBasket(S, id, qty, staff ? 'staff' : 'self');
  if (staff) S.api.showToast?.('ชิ้นใหญ่ ให้พนักงานจัดให้ภายหลัง');
  else S.api.showToast?.(`ใส่รถเข็นแล้ว: ${p.name}`);
}

function changeQty(S, id, delta) {
  const it = S.basket.get(id);
  if (!it || it.ticket) return;
  it.qty = Math.min(MAX_QTY, Math.max(1, it.qty + delta));
  afterBasketChange(S);
}

function swapMode(S, id) {
  const it = S.basket.get(id);
  if (!it || it.ticket) return;
  it.mode = it.mode === 'staff' ? 'self' : 'staff';
  afterBasketChange(S);
}

function removeItem(S, id) {
  S.basket.delete(id);
  afterBasketChange(S);
}

function clearBasket(S) {
  S.basket.clear();
  afterBasketChange(S);
}

// ---------- ใบจัดสินค้า ----------
function createTicket(S) {
  const staffItems = [...S.basket.values()].filter((it) => it.mode === 'staff' && !it.ticket);
  if (!staffItems.length) return;
  const no = makeTicketNo(new Date(), Math.floor(Math.random() * 1000));
  const lines = staffItems.map((it) => {
    const p = S.productById.get(it.id);
    const loc = productLoc(p);
    return { id: it.id, name: p.name, qty: it.qty, code: loc ? loc.code : '-', priceSatang: p.priceSatang };
  });
  const totalSatang = lines.reduce((s, l) => s + lineTotal(l.priceSatang, l.qty), 0);
  S.tickets.unshift({ no, ts: new Date().toISOString(), items: lines, totalSatang });
  S.tickets = S.tickets.slice(0, MAX_TICKETS);
  lsSet(K_TICKETS, JSON.stringify(S.tickets));
  for (const it of staffItems) it.ticket = no;
  S.ui.ticketNo = no;
  saveBasket(S);
  say(S, `สร้างใบจัดสินค้าเลขที่ ${no} แล้วครับ แจ้งเลขนี้ที่จุดบริการลูกค้าได้เลย`);
  renderAll(S);
}

function ticketText(S, t) {
  const rows = t.items.map((l, i) => `${i + 1}. ${l.name} x${l.qty} [${l.code}] ${S.fmt(lineTotal(l.priceSatang, l.qty))}`);
  return [`ใบจัดสินค้า ${t.no}`, ...rows, `รวมโดยประมาณ ${S.fmt(t.totalSatang)}`, 'ใบนี้เก็บในเครื่องนี้ ยังไม่ได้ส่งเข้าระบบร้าน'].join('\n');
}

async function copyTicket(S, no) {
  const t = S.tickets.find((x) => x.no === no);
  if (!t) return;
  const text = ticketText(S, t);
  try {
    await navigator.clipboard.writeText(text);
    S.api.showToast?.('คัดลอกรายการแล้ว');
  } catch {
    S.api.showToast?.('คัดลอกอัตโนมัติไม่ได้ในเบราว์เซอร์นี้');
  }
}

// ---------- เสียง + ข้อความพนักงาน ----------
function speak(S, text) {
  if (!S.voiceOn || !S.voiceOk) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'th-TH';
    synth.speak(u);
  } catch { /* เสียงใช้ไม่ได้: ข้าม */ }
}

function setMessage(S, text) {
  S.message = text;
  if (S.el.msg) S.el.msg.textContent = text;
}

function say(S, text) {
  setMessage(S, text);
  speak(S, text);
}

// ---------- การเลือก/ของคู่กัน ----------
function refreshSelection(S) {
  const isPinned = S.api.isPinned;
  S.pinnedIds = typeof isPinned === 'function' ? S.products.filter((p) => { try { return isPinned(p.id); } catch { return false; } }).map((p) => p.id) : [];
  refreshCompanions(S);
}

function isSelected(S, id) {
  let pinned = false;
  try { pinned = !!(S.api.isPinned && S.api.isPinned(id)); } catch { pinned = false; }
  return pinned || S.basket.has(id);
}

function findByQuery(S, q) {
  const key = q.toLowerCase();
  if (S.queryCache.has(key)) return S.queryCache.get(key);
  const hits = [];
  for (const row of S.haystack) {
    if (row.h.includes(key)) { hits.push(row.p.id); if (hits.length >= 12) break; }
  }
  S.queryCache.set(key, hits);
  return hits;
}

function matchingRules(p) {
  const name = String(p.name || '').toLowerCase();
  return PAIR_RULES.filter((r) => r.words.some((w) => name.includes(w)) && !r.not.some((w) => name.includes(w)));
}

/** คำนวณสินค้าที่ใช้คู่กับของที่ปักหมุด/อยู่ในตะกร้า — สูงสุด 3 รายการ แต่ละกฎผลัดกันหยิบเพื่อให้หลากหลาย */
function refreshCompanions(S) {
  const sourceIds = new Set([...S.pinnedIds, ...S.basket.keys()]);
  const lists = [];
  S.companionIds = new Set();
  for (const sid of sourceIds) {
    const src = S.productById.get(sid);
    if (!src) continue;
    for (const rule of matchingRules(src)) {
      for (const q of rule.needs) {
        const ids = findByQuery(S, q).filter((id) => id !== sid && !sourceIds.has(id));
        ids.forEach((id) => S.companionIds.add(id));
        if (ids.length) lists.push({ ids, srcName: src.name });
      }
    }
  }
  S.companions = pickRoundRobin(S, lists, 3);
}

function pickRoundRobin(S, lists, limit) {
  const out = [];
  const seen = new Set();
  for (let depth = 0; out.length < limit && depth < 4; depth++) {
    for (const l of lists) {
      const id = l.ids[depth];
      if (id == null || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, srcName: l.srcName });
      if (out.length >= limit) break;
    }
  }
  return out;
}

// ---------- เดินผ่านแล้วแนะนำ ----------
function onUserMoved(S, x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  if (S.lastPos && Math.hypot(x - S.lastPos.x, z - S.lastPos.z) < MOVE_THRESHOLD) return;
  S.lastPos = { x, z };
  const nearby = queryGrid(S.grid, x, z, NEAR_RADIUS);
  greetZone(S, x, z, nearby);
  const next = pickSuggestions(S, nearby);
  const sig = next.map((s) => `${s.id}@${Math.round(s.d * 10)}`).join('|');
  S.suggestions = next;
  if (sig !== S.sugSig) {
    S.sugSig = sig;
    renderCardBody(S);
  }
}

function eligibleEntry(S, id, now) {
  if (isSelected(S, id)) return false;
  const t = S.recent.get(id);
  return !(t && now - t < REPEAT_BLOCK_MS);
}

function scoreEntry(S, id, entry, d) {
  let s = (NEAR_RADIUS - d) * 2;
  if (entry.loc.kind === 'promo') s += 4;
  if (S.companionIds.has(id)) s += 6;
  return s;
}

function pickSuggestions(S, nearby) {
  const now = Date.now();
  const keep = [];
  for (const old of S.suggestions) {
    const near = nearby.get(old.id);
    if (near && !isSelected(S, old.id)) keep.push({ id: old.id, entry: near.entry, d: near.d });
    else S.recent.set(old.id, now); // หลุดจากรายการแล้ว: กันแนะนำซ้ำ 60 วินาที
  }
  const keepIds = new Set(keep.map((k) => k.id));
  const fresh = [];
  for (const [id, { entry, d }] of nearby) {
    if (keepIds.has(id) || !eligibleEntry(S, id, now) || !S.productById.has(id)) continue;
    fresh.push({ id, entry, d, score: scoreEntry(S, id, entry, d) });
  }
  fresh.sort((a, b) => b.score - a.score);
  const out = keep.slice(0, 3);
  for (const f of fresh) {
    if (out.length >= 3) break;
    out.push(f);
    S.recent.set(f.id, now);
  }
  return out;
}

function recheckSuggestions(S) {
  S.suggestions = S.suggestions.filter((s) => !isSelected(S, s.id));
  S.sugSig = null;
}

function greetZone(S, x, z, nearby) {
  let zone = '';
  try { zone = S.api.getZoneName ? S.api.getZoneName(x, z) : ''; } catch { zone = ''; }
  if (!zone || zone === S.lastZone) return;
  const now = Date.now();
  if (S.lastZone !== null && now - S.lastZoneAt < ZONE_GAP_MS) return;
  S.lastZone = zone;
  S.lastZoneAt = now;
  const hint = topCategoryName(S, nearby);
  say(S, `ตอนนี้อยู่${zone}ครับ${hint ? ` แถวนี้มี${hint}เด่นๆ` : ''}`);
}

function topCategoryName(S, nearby) {
  const count = new Map();
  for (const id of nearby.keys()) {
    const p = S.productById.get(id);
    if (p) count.set(p.cat, (count.get(p.cat) || 0) + 1);
  }
  let bestCat = '';
  let bestN = 0;
  for (const [cat, n] of count) if (n > bestN) { bestN = n; bestCat = cat; }
  const c = S.api.catMap && S.api.catMap[bestCat];
  return c ? c.name : '';
}

// ---------- ชุดงาน ----------
function missingPresetItems(S) {
  const pr = (S.api.presets || []).find((x) => x.id === S.presetId);
  if (!pr) return { preset: null, items: [] };
  const items = pr.items.filter((it) => S.productById.has(it.id) && !isSelected(S, it.id));
  return { preset: pr, items };
}

function choosePreset(S, id) {
  const pr = (S.api.presets || []).find((x) => x.id === id);
  if (!pr) return;
  S.presetId = id;
  lsSet(K_PRESET, id);
  S.api.applyPreset?.(id);
  refreshSelection(S);
  say(S, `รับทราบครับ งาน "${pr.title}" ผมช่วยดูของที่ต้องใช้ให้ครับ`);
  renderAll(S);
}

function addMissing(S, ids) {
  const { items } = missingPresetItems(S);
  for (const it of items) {
    if (ids && !ids.includes(it.id)) continue;
    S.api.pinProduct?.(it.id, Math.max(1, it.qty || 1));
  }
  refreshSelection(S);
  renderAll(S);
}

// ---------- DOM ----------
function injectStyle() {
  if (document.getElementById('bw02SalesStyle')) return;
  const st = document.createElement('style');
  st.id = 'bw02SalesStyle';
  st.textContent = `
#bw02Card{position:fixed;z-index:20;left:calc(8px + var(--sal,0px));right:calc(68px + var(--sar,0px));bottom:calc(72px + var(--sab,0px))}
#bw02Fab{position:fixed;z-index:20;right:calc(10px + var(--sar,0px));bottom:calc(72px + var(--sab,0px));width:52px;height:52px}
#bw02Panel{position:fixed;z-index:21;left:calc(8px + var(--sal,0px));right:calc(8px + var(--sar,0px));bottom:calc(70px + var(--sab,0px));max-height:min(78dvh,calc(100dvh - 140px));display:none;flex-direction:column}
#bw02Panel.open{display:flex}
body:has(#bw02Panel.open) #bw02Card{display:none}
#bw02CardBody{max-height:min(30dvh,236px);overflow-y:auto}
@media (max-width:1179.98px){body:has(.panel-sheet.mob-open) #bw02Card{display:none}}
@media (max-width:739.98px){body:has(.panel-sheet.mob-open) #bw02Fab{display:none}}
@media (min-width:740px) and (max-width:1179.98px){
#bw02Card{left:calc(168px + var(--sal,0px));right:auto;width:min(380px,calc(100vw - 190px))}
#bw02Fab{right:auto;left:calc(12px + var(--sal,0px));bottom:calc(176px + var(--sab,0px))}
#bw02Panel{left:auto;right:calc(12px + var(--sar,0px));width:400px;bottom:calc(72px + var(--sab,0px))}}
@media (min-width:1180px){
#bw02Card{left:396px;right:auto;width:340px;bottom:118px}
body.hide-left #bw02Card{left:16px}
#bw02Fab{right:434px;bottom:18px}
body.hide-right #bw02Fab{right:70px}
#bw02Panel{left:auto;right:434px;width:360px;bottom:76px;max-height:calc(100vh - 170px)}
body.hide-right #bw02Panel{right:70px}
#bw02CardBody{max-height:min(34vh,280px)}}`;
  document.head.appendChild(st);
}

function buildDom(S) {
  const card = document.createElement('section');
  card.id = 'bw02Card';
  card.className = 'rounded-2xl bg-white/95 border border-slate-200 shadow-xl text-slate-800 overflow-hidden';
  card.setAttribute('aria-label', 'พนักงานขาย');
  card.innerHTML = `
    <div class="flex items-center gap-2 px-2.5 py-2">
      <span class="flex-none w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-base" aria-hidden="true">🧑‍💼</span>
      <div class="min-w-0 flex-1">
        <div class="text-xs font-extrabold text-slate-900 leading-tight">พนักงานขาย</div>
        <div id="bw02Msg" class="text-[11px] text-slate-600 leading-snug line-clamp-2"></div>
      </div>
      <button type="button" data-act="voice" class="flex-none w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-sm" title="เปิด/ปิดเสียงพูด" aria-label="เปิดหรือปิดเสียงพูด"></button>
      <button type="button" data-act="toggle" class="flex-none w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-xs font-bold" aria-label="ย่อหรือขยายการ์ดพนักงานขาย"></button>
    </div>
    <div id="bw02CardBody" class="px-2.5 pb-2.5 border-t border-slate-100"></div>`;
  const fab = document.createElement('button');
  fab.id = 'bw02Fab';
  fab.type = 'button';
  fab.dataset.act = 'open-basket';
  fab.className = 'rounded-full bg-emerald-600 text-white shadow-xl border border-white/60 flex items-center justify-center text-2xl';
  fab.setAttribute('aria-label', 'เปิดตะกร้าสินค้า');
  fab.innerHTML = '<span aria-hidden="true">🛒</span><span id="bw02FabCount" class="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-red-600 text-white text-[11px] font-extrabold flex items-center justify-center"></span>';
  const panel = document.createElement('aside');
  panel.id = 'bw02Panel';
  panel.className = 'rounded-2xl bg-white border border-slate-200 shadow-2xl text-slate-800 overflow-hidden';
  panel.setAttribute('aria-label', 'ตะกร้าสินค้า');
  document.body.append(card, fab, panel);
  S.el = { card, fab, panel, msg: card.querySelector('#bw02Msg'), body: card.querySelector('#bw02CardBody'), count: fab.querySelector('#bw02FabCount') };
}

function bindEvents(S) {
  const onClick = (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !btn.closest('#bw02Card, #bw02Panel, #bw02Fab')) return;
    handleAction(S, btn.dataset.act, btn.dataset.id || '');
  };
  S.el.card.addEventListener('click', onClick);
  S.el.panel.addEventListener('click', onClick);
  S.el.fab.addEventListener('click', onClick);
}

function handleAction(S, act, id) {
  const actions = {
    toggle: () => { S.collapsed = !S.collapsed; lsSet(K_COLLAPSED, S.collapsed ? '1' : '0'); renderCard(S); },
    voice: () => toggleVoice(S),
    pin: () => { S.api.pinProduct?.(id, 1); refreshSelection(S); recheckSuggestions(S); renderAll(S); },
    look: () => S.api.focusProduct?.(id),
    staff: () => { if (addToBasket(S, id, 1, 'staff')) S.api.showToast?.('ใส่ตะกร้าให้พนักงานจัดให้แล้ว'); },
    preset: () => choosePreset(S, id),
    'missing-add': () => addMissing(S, [id]),
    'missing-all': () => addMissing(S, null),
    'open-basket': () => setPanelOpen(S, !S.ui.panelOpen),
    close: () => setPanelOpen(S, false),
    dec: () => changeQty(S, id, -1),
    inc: () => changeQty(S, id, 1),
    swap: () => swapMode(S, id),
    del: () => removeItem(S, id),
    send: () => createTicket(S),
    copy: () => copyTicket(S, id),
    'ticket-close': () => { S.ui.ticketNo = null; renderPanel(S); },
    'ticket-open': () => { S.ui.ticketNo = id; renderPanel(S); },
    clear: () => { S.ui.confirmClear = true; renderPanel(S); },
    'clear-no': () => { S.ui.confirmClear = false; renderPanel(S); },
    'clear-yes': () => clearBasket(S),
  };
  if (actions[act]) actions[act]();
}

function toggleVoice(S) {
  S.voiceOn = !S.voiceOn;
  lsSet(K_VOICE, S.voiceOn ? '1' : '0');
  if (!S.voiceOn) { try { window.speechSynthesis.cancel(); } catch { /* ไม่มีเสียง */ } }
  renderCardHeader(S);
  if (S.voiceOn) speak(S, S.message);
}

function setPanelOpen(S, open) {
  S.ui.panelOpen = open;
  S.ui.confirmClear = false;
  S.el.panel.classList.toggle('open', open);
  if (open) renderPanel(S);
}

// ---------- render ----------
function renderAll(S) {
  renderCard(S);
  renderFab(S);
  if (S.ui.panelOpen) renderPanel(S);
}

function renderFab(S) {
  const n = basketPieces(S);
  S.el.count.textContent = n > 99 ? '99+' : String(n);
  S.el.count.style.display = n > 0 ? 'flex' : 'none';
}

function renderCard(S) {
  renderCardHeader(S);
  S.el.body.style.display = S.collapsed ? 'none' : 'block';
  if (!S.collapsed) renderCardBody(S);
  if (S.el.msg) S.el.msg.textContent = S.message;
}

function renderCardHeader(S) {
  const [voiceBtn, toggleBtn] = S.el.card.querySelectorAll('button[data-act="voice"], button[data-act="toggle"]');
  voiceBtn.style.display = S.voiceOk ? 'flex' : 'none';
  voiceBtn.textContent = S.voiceOn ? '🔊' : '🔇';
  toggleBtn.textContent = S.collapsed ? '▲' : '▼';
}

function productRow(S, p, loc, opts) {
  const e = S.esc;
  const cat = (S.api.catMap && S.api.catMap[p.cat]) || { icon: '📦', name: '' };
  const staff = needsStaff(p, loc);
  const code = loc ? e(loc.code) : '-';
  const dist = opts.d != null ? `<span class="text-[10px] font-bold text-emerald-700">ห่าง ${opts.d.toFixed(1)} ม.</span>` : '';
  const promo = loc && loc.kind === 'promo' ? '<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">สินค้าจัดรายการหน้ากอง</span>' : '';
  const why = opts.why ? `<div class="text-[10px] text-slate-500">${e(opts.why)}</div>` : '';
  const btn = 'h-7 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center';
  return `<div class="rounded-xl border border-slate-200 bg-white p-2 mt-1.5">
    <div class="flex items-center gap-1.5">
      <span class="flex-none text-base" aria-hidden="true">${e(cat.icon)}</span>
      <div class="min-w-0 flex-1 text-xs font-extrabold text-slate-900 leading-snug">${e(p.name)}</div>
      <span class="flex-none text-xs font-extrabold text-blue-700">${e(S.fmt(p.priceSatang))}<span class="text-[10px] font-medium text-slate-500">/${e(p.unit)}</span></span>
    </div>
    <div class="flex items-center flex-wrap gap-1.5 mt-1">
      <span class="px-1.5 py-0.5 rounded bg-slate-900 text-white text-[10px] font-extrabold">${code}</span>${dist}${promo}
    </div>${why}
    <div class="flex items-center flex-wrap gap-1.5 mt-1.5">
      <button type="button" data-act="pin" data-id="${e(p.id)}" class="${btn} bg-blue-600 text-white">เพิ่มในรายการ</button>
      <button type="button" data-act="look" data-id="${e(p.id)}" class="${btn} bg-slate-100 border border-slate-200 text-slate-700">ดูตำแหน่ง</button>
      ${staff ? `<button type="button" data-act="staff" data-id="${e(p.id)}" class="${btn} bg-amber-100 border border-amber-300 text-amber-900">ให้พนักงานจัดให้</button>` : ''}
    </div>
  </div>`;
}

function sectionTitle(text) {
  return `<div class="mt-2 text-[11px] font-extrabold text-slate-700">${text}</div>`;
}

function renderCardBody(S) {
  if (S.collapsed) return;
  const parts = [];
  const sug = S.suggestions.map((s) => ({ p: S.productById.get(s.id), s })).filter((x) => x.p);
  parts.push(sectionTitle('เดินผ่านแล้วเจอสินค้าใกล้ตัว'));
  parts.push(sug.length ? sug.map(({ p, s }) => productRow(S, p, s.entry.loc, { d: s.d })).join('')
    : '<div class="text-[11px] text-slate-500 mt-1">เดินไปตามชั้นวาง เดี๋ยวผมแนะนำสินค้าใกล้ตัวให้ครับ</div>');
  const comp = S.companions.map((c) => ({ p: S.productById.get(c.id), c })).filter((x) => x.p);
  if (comp.length) {
    parts.push(sectionTitle('ของที่ต้องใช้คู่กัน'));
    parts.push(comp.map(({ p, c }) => productRow(S, p, productLoc(p), { why: `ใช้คู่กับ ${c.srcName}` })).join(''));
  }
  parts.push(presetSection(S));
  parts.push(basketNote(S));
  S.el.body.innerHTML = parts.join('');
}

function presetSection(S) {
  const e = S.esc;
  const presets = S.api.presets || [];
  if (!presets.length) return '';
  const chips = presets.map((pr) => {
    const on = pr.id === S.presetId;
    return `<button type="button" data-act="preset" data-id="${e(pr.id)}" title="${e(pr.desc || '')}" class="h-7 px-2.5 rounded-full text-[11px] font-bold flex items-center border ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300'}">${e(pr.title)}</button>`;
  }).join('');
  const { items } = missingPresetItems(S);
  let missing = '';
  if (items.length) {
    const rows = items.slice(0, 4).map((it) => {
      const p = S.productById.get(it.id);
      return `<div class="flex items-center gap-1.5 mt-1"><span class="min-w-0 flex-1 text-[11px] text-slate-800 truncate">${e(p.name)} ×${e(it.qty || 1)}</span>
        <button type="button" data-act="missing-add" data-id="${e(it.id)}" class="flex-none h-6 px-2 rounded-lg bg-blue-600 text-white text-[10px] font-bold flex items-center">เพิ่ม</button></div>`;
    }).join('');
    missing = `<div class="mt-1.5 rounded-xl bg-amber-50 border border-amber-200 p-2">
      <div class="flex items-center gap-1.5"><span class="flex-1 text-[11px] font-extrabold text-amber-900">ของในชุดงานที่ยังขาด ${items.length} รายการ</span>
      <button type="button" data-act="missing-all" class="flex-none h-6 px-2 rounded-lg bg-amber-600 text-white text-[10px] font-bold flex items-center">เพิ่มทั้งหมด</button></div>${rows}</div>`;
  }
  return `${sectionTitle('วันนี้ทำงานอะไรครับ')}<div class="flex items-center flex-wrap gap-1.5 mt-1">${chips}</div>${missing}`;
}

function basketNote(S) {
  const t = basketTotals([...S.basket.values()], S.productById);
  const { items } = missingPresetItems(S);
  const miss = items.length ? ` · ชุดงานยังขาด ${items.length} รายการ` : '';
  return `<div class="mt-2 pt-2 border-t border-slate-100 flex items-center gap-2">
    <div class="min-w-0 flex-1 text-[11px] text-slate-700">รถเข็น <b>${S.esc(S.fmt(t.selfSatang))}</b> (${t.selfPieces} ชิ้น) · พนักงานจัดให้ <b>${S.esc(S.fmt(t.staffSatang))}</b> (${t.staffPieces} ชิ้น)${S.esc(miss)}</div>
    <button type="button" data-act="open-basket" class="flex-none h-7 px-2 rounded-lg bg-emerald-600 text-white text-[11px] font-bold flex items-center">ดูตะกร้า</button></div>`;
}

// ---------- แผงตะกร้า ----------
function basketLine(S, it) {
  const e = S.esc;
  const p = S.productById.get(it.id);
  const loc = productLoc(p);
  const pending = !!it.ticket;
  const b = 'w-7 h-7 rounded-lg bg-slate-100 border border-slate-200 text-sm font-bold flex items-center justify-center';
  const ctrl = pending
    ? `<span class="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 text-[10px] font-bold">รอพนักงานจัด · ${e(it.ticket)}</span>`
    : `<button type="button" data-act="dec" data-id="${e(it.id)}" class="${b}" aria-label="ลดจำนวน">−</button>
       <span class="min-w-[28px] text-center text-xs font-extrabold">${it.qty}</span>
       <button type="button" data-act="inc" data-id="${e(it.id)}" class="${b}" aria-label="เพิ่มจำนวน">+</button>
       <button type="button" data-act="swap" data-id="${e(it.id)}" class="h-7 px-2 rounded-lg bg-amber-50 border border-amber-300 text-[10px] font-bold text-amber-900 flex items-center">${it.mode === 'staff' ? 'หยิบเอง' : 'ให้พนักงานจัด'}</button>`;
  return `<div class="rounded-xl border border-slate-200 p-2 mt-1.5">
    <div class="flex items-center gap-1.5">
      <div class="min-w-0 flex-1 text-xs font-extrabold text-slate-900 leading-snug">${e(p.name)}</div>
      <button type="button" data-act="del" data-id="${e(it.id)}" class="flex-none w-7 h-7 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-bold flex items-center justify-center" aria-label="ลบรายการ">✕</button>
    </div>
    <div class="flex items-center gap-1.5 mt-1 text-[11px] text-slate-600">
      <span class="px-1.5 py-0.5 rounded bg-slate-900 text-white text-[10px] font-extrabold">${loc ? e(loc.code) : '-'}</span>
      <span class="tabular-nums">${e(S.fmt(p.priceSatang))} × ${it.qty} = <b class="text-slate-900">${e(S.fmt(lineTotal(p.priceSatang, it.qty)))}</b></span>
    </div>
    <div class="flex items-center flex-wrap gap-1.5 mt-1.5">${ctrl}</div></div>`;
}

function groupBlock(S, title, items, sumSatang) {
  if (!items.length) return '';
  return `<div class="mt-2"><div class="flex items-center gap-2"><span class="flex-1 text-xs font-extrabold text-slate-800">${S.esc(title)}</span>
    <span class="text-xs font-extrabold text-blue-700">${S.esc(S.fmt(sumSatang))}</span></div>${items.map((it) => basketLine(S, it)).join('')}</div>`;
}

function ticketView(S) {
  const t = S.tickets.find((x) => x.no === S.ui.ticketNo);
  if (!t) return '';
  const e = S.esc;
  const rows = t.items.map((l) => `<div class="flex items-center gap-1.5 text-[11px]"><span class="min-w-0 flex-1 truncate">${e(l.name)} ×${l.qty}</span><span class="flex-none font-bold">${e(l.code)}</span></div>`).join('');
  const time = new Date(t.ts).toLocaleString('th-TH');
  return `<div class="rounded-xl border-2 border-sky-300 bg-sky-50 p-2.5 mt-2">
    <div class="text-xs font-extrabold text-sky-900">ใบจัดสินค้า ${e(t.no)}</div>
    <div class="text-[10px] text-slate-600">${e(time)} · รวมโดยประมาณ ${e(S.fmt(t.totalSatang))}</div>
    <div class="mt-1.5 space-y-0.5">${rows}</div>
    <div class="mt-1.5 text-[11px] font-bold text-sky-900">แจ้งเลขที่นี้ที่จุดบริการลูกค้าเพื่อรับสินค้า</div>
    <div class="mt-1 text-[10px] font-semibold text-red-700">ใบนี้เก็บในเครื่องนี้เท่านั้น ยังไม่ได้ส่งเข้าระบบร้าน</div>
    <div class="flex items-center gap-1.5 mt-2">
      <button type="button" data-act="copy" data-id="${e(t.no)}" class="h-8 px-3 rounded-lg bg-sky-600 text-white text-[11px] font-bold flex items-center">คัดลอกรายการ</button>
      <button type="button" data-act="ticket-close" class="h-8 px-3 rounded-lg bg-white border border-slate-300 text-[11px] font-bold flex items-center">ปิดใบนี้</button>
    </div></div>`;
}

function renderPanel(S) {
  const items = [...S.basket.values()];
  const t = basketTotals(items, S.productById);
  const selfItems = items.filter((it) => it.mode !== 'staff');
  const staffNew = items.filter((it) => it.mode === 'staff' && !it.ticket);
  const staffWait = items.filter((it) => it.mode === 'staff' && it.ticket);
  const sum = (arr) => basketTotals(arr, S.productById).totalSatang;
  const lastTicket = !S.ui.ticketNo && S.tickets[0] ? `<button type="button" data-act="ticket-open" data-id="${S.esc(S.tickets[0].no)}" class="mt-2 h-7 px-2 rounded-lg bg-sky-50 border border-sky-200 text-[11px] font-bold text-sky-800 flex items-center">ดูใบจัดสินค้าล่าสุด ${S.esc(S.tickets[0].no)}</button>` : '';
  const empty = items.length ? '' : '<div class="text-center text-xs text-slate-500 py-6">ยังไม่มีสินค้าในตะกร้า<br>กด "หยิบแล้ว" ที่จุดสินค้าเพื่อใส่รถเข็นครับ</div>';
  S.el.panel.innerHTML = `
    <div class="flex items-center gap-2 px-3 py-2 border-b border-slate-200">
      <span class="text-lg" aria-hidden="true">🛒</span><div class="flex-1 text-sm font-extrabold">ตะกร้าสินค้า</div>
      <button type="button" data-act="close" class="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 text-sm font-bold flex items-center justify-center" aria-label="ปิดตะกร้า">✕</button>
    </div>
    <div class="flex-1 overflow-y-auto px-3 pb-2">${empty}
      ${groupBlock(S, 'อยู่ในรถเข็น (หยิบเอง)', selfItems, sum(selfItems))}
      ${groupBlock(S, 'ให้พนักงานจัดให้ (ชิ้นใหญ่/หนัก ยกไม่ไหว)', staffNew, sum(staffNew))}
      ${groupBlock(S, 'รอพนักงานจัด', staffWait, sum(staffWait))}
      ${ticketView(S)}${lastTicket}
    </div>
    <div class="px-3 py-2 border-t border-slate-200 bg-slate-50">
      <div class="flex items-center gap-2 text-xs"><span class="flex-1 text-slate-700">รวมทั้งหมด ${t.pieces} ชิ้น</span><span class="text-sm font-extrabold text-blue-700">${S.esc(S.fmt(t.totalSatang))}</span></div>
      <div class="text-[10px] text-slate-500">ราคาโดยประมาณ ยังไม่ใช่ใบเสร็จ · หยิบเอง ${S.esc(S.fmt(t.selfSatang))} · พนักงานจัด ${S.esc(S.fmt(t.staffSatang))}</div>
      <div class="flex items-center flex-wrap gap-1.5 mt-2">
        <button type="button" data-act="send" ${staffNew.length ? '' : 'disabled'} class="flex-1 h-9 px-3 rounded-xl text-xs font-extrabold flex items-center justify-center ${staffNew.length ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-400'}">ส่งรายการให้พนักงานจัดสินค้า</button>
        ${clearControl(S, items.length)}
      </div>
    </div>`;
}

function clearControl(S, count) {
  if (!count) return '';
  if (S.ui.confirmClear) {
    return `<span class="text-[11px] font-bold text-red-700">ล้างทั้งหมดใช่ไหม?</span>
      <button type="button" data-act="clear-yes" class="h-9 px-3 rounded-xl bg-red-600 text-white text-xs font-bold flex items-center">ล้างเลย</button>
      <button type="button" data-act="clear-no" class="h-9 px-3 rounded-xl bg-white border border-slate-300 text-xs font-bold flex items-center">ไม่ล้าง</button>`;
  }
  return '<button type="button" data-act="clear" class="h-9 px-3 rounded-xl bg-white border border-red-300 text-red-700 text-xs font-bold flex items-center">ล้างตะกร้า</button>';
}
