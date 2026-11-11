/**
 * layout.js — พิกัดเชลฟ์ โชว์รูม กองโปรโมชัน และซอยเดินของโซนหน้าร้าน
 * ใช้ร่วมกัน 3 ที่ให้ตรงกันเสมอ: ฉาก 3 มิติ (warehouse3d.js) · กราฟทางเดิน (app.js) · ตำแหน่งสินค้า (catalog.js)
 * ไฟล์นี้ไม่มี dependency (ไม่แตะ DOM/WebGL) เพื่อให้ตรวจข้อมูลด้วย node ได้
 */
export const pad2 = (n) => String(n).padStart(2, '0');

/** ความกว้างตู้เชลฟ์ 1 ตู้ (เมตร) */
export const SHELF_BAY = 2.0;

const mkRows = (zs, stands, defs) => defs.map(([title, style], i) => ({ z: zs[i], standZ: stands[i], title, style }));

// แถวเชลฟ์ฝั่งหน้าร้าน (ทิศใต้ของทางเดินหลัก) ใช้ระยะซอยชุดเดียวกันทุกบล็อก
const SOUTH_Z = [6.2, 8.1, 8.7, 10.6, 11.2, 13.1, 13.7, 15.6];
const SOUTH_STAND = [5.35, 7.15, 9.65, 9.65, 12.15, 12.15, 14.65, 14.65];
// แถวเชลฟ์โซนกลางคลัง (ทิศเหนือของทางเดินหลัก ระหว่างเลน 2 กับเลน 3)
const MID_Z = [-4.3, -6.2, -6.8, -8.7, -9.3, -11.2, -11.8, -13.7, -14.3, -16.2];
const MID_STAND = [-5.25, -5.25, -7.75, -7.75, -10.25, -10.25, -12.75, -12.75, -15.25, -15.25];

/** บล็อกเชลฟ์ 5 ชั้น: x0 = ขอบซ้ายของตู้แรก, style = รูปแบบสินค้าบนชั้น (ดู SHELF_STYLES ใน warehouse3d.js) */
export const SHELF_BLOCKS = {
  SH: {
    x0: 35.3, bays: 8, zoneName: 'โซนไฟฟ้า·ประปา·ฮาร์ดแวร์ (หน้าร้าน)',
    rows: mkRows(SOUTH_Z, SOUTH_STAND, [
      ['ตู้ไฟและเบรกเกอร์', 'breaker'],
      ['สายไฟและอุปกรณ์เดินสาย', 'wire'],
      ['หลอดไฟ LED และโคมไฟ', 'led'],
      ['ข้อต่อประปา วาล์ว ปั๊มน้ำ', 'plumb'],
      ['เครื่องมือช่างไฟฟ้าและมืออาชีพ', 'tool'],
      ['น็อตสกรู ฮาร์ดแวร์ และเซฟตี้', 'screw'],
      ['สีแกลลอน กาว และเคมีภัณฑ์', 'paint'],
      ['ปลั๊กพ่วง พัดลม และเครื่องทำน้ำอุ่น', 'appliance'],
    ]),
  },
  TG: {
    x0: -9.0, bays: 7, zoneName: 'โซนเครื่องมือช่าง·เกษตร',
    rows: mkRows(SOUTH_Z, SOUTH_STAND, [
      ['สว่าน หินเจียร เครื่องมือไฟฟ้า', 'tool'],
      ['ค้อน ประแจ ไขควง เครื่องมือช่างมือ', 'handtool'],
      ['ตลับเมตร ระดับน้ำ ใบตัด ดอกสว่าน', 'screw'],
      ['ตู้เชื่อม ปั๊มลม เครื่องฉีดน้ำ', 'machine'],
      ['จอบ เสียม พลั่ว กรรไกรตัดกิ่ง', 'garden'],
      ['เครื่องพ่นยา ปั๊มน้ำเกษตร สายยาง', 'hose'],
      ['ปุ๋ย ดินปลูก วัสดุปลูก', 'sack'],
      ['ตาข่าย สแลน ผ้าใบ เชือก', 'roll'],
    ]),
  },
  GD: {
    x0: 20.3, bays: 3, zoneName: 'โซนสวน·กลางแจ้ง·ของใช้ในบ้าน',
    rows: mkRows(SOUTH_Z, SOUTH_STAND, [
      ['กระถางต้นไม้ และของแต่งสวน', 'pot'],
      ['สายยาง หัวฉีด สปริงเกลอร์', 'hose'],
      ['ไฟโซลาร์สนาม และไฟประดับ', 'led'],
      ['ถังขยะ และกล่องเก็บของ', 'home'],
      ['ไม้กวาด ไม้ถูพื้น อุปกรณ์ทำความสะอาด', 'clean'],
      ['น้ำยาทำความสะอาด และกำจัดปลวก', 'bottle'],
      ['บันได รถเข็น อุปกรณ์ขนย้าย', 'machine'],
      ['ถ่าน ไฟฉาย และของใช้ทั่วไป', 'screw'],
    ]),
  },
  HM: {
    x0: 9.9, bays: 8, zoneName: 'โซนเครื่องใช้ไฟฟ้า·ครัว·ห้องน้ำ·ประตู',
    rows: mkRows(MID_Z, MID_STAND, [
      ['พัดลม และเครื่องใช้ไฟฟ้าในบ้าน', 'appliance'],
      ['เครื่องทำน้ำอุ่น และเครื่องกรองน้ำ', 'appliance'],
      ['ซิงค์ เตาแก๊ส เครื่องดูดควัน', 'machine'],
      ['ก๊อกน้ำ ฝักบัว อุปกรณ์ห้องน้ำ', 'faucet'],
      ['ลูกบิด กุญแจ บานพับ', 'lock'],
      ['มือจับ รางลิ้นชัก อุปกรณ์เฟอร์นิเจอร์', 'screw'],
      ['ชั้นวางของ ตู้ และกล่องเก็บของ', 'home'],
      ['กาว ซิลิโคน เทป วัสดุอุดรอยรั่ว', 'bottle'],
      ['มุ้งลวด ม่าน อุปกรณ์ประตูหน้าต่าง', 'roll'],
      ['โคมไฟตกแต่ง และพัดลมเพดาน', 'led'],
    ]),
  },
};

/** โชว์รูมสุขภัณฑ์-กระเบื้อง (แผงโชว์ 2 ด้าน กว้างช่องละ 2 ม.) */
export const SHOWROOM = {
  x0: -24.2, bays: 5, zoneName: 'โชว์รูมสุขภัณฑ์·กระเบื้อง',
  rows: mkRows([-1.0, -4.0, -7.0, -10.0, -13.0, -16.0], [-2.5, -5.5, -8.5, -11.5, -14.5, -14.5], [
    ['กระเบื้องปูพื้น 60×60 และแกรนิตโต้', 'tile'],
    ['ชักโครก และสุขภัณฑ์', 'toilet'],
    ['กระเบื้องผนัง และโมเสก', 'tile'],
    ['อ่างล้างหน้า และเคาน์เตอร์ห้องน้ำ', 'basin'],
    ['กระเบื้องลายไม้ ลายหิน และ SPC', 'tile'],
    ['อ่างอาบน้ำ และฉากกั้นอาบน้ำ', 'bath'],
  ]),
};

/** จุดกึ่งกลางหน้าตู้ + จุดยืนบนซอยเดิน ของเชลฟ์/โชว์รูม (row และ bay เริ่มนับที่ 1) */
export function shelfSpot(block, row, bay) {
  const b = block === 'TS' ? SHOWROOM : SHELF_BLOCKS[block];
  const r = b && b.rows[row - 1];
  if (!r || bay < 1 || bay > b.bays) throw new Error(`ไม่มีตำแหน่งเชลฟ์ ${block}${row}-${pad2(bay)}`);
  const x = b.x0 + (bay - 0.5) * SHELF_BAY;
  return { code: `${block}${row}-${pad2(bay)}`, zoneName: b.zoneName, title: r.title, x, z: r.z, standX: x, standZ: r.standZ };
}

/** กองพาเลทสินค้าโปรโมชัน (standZ = null คือพาเลทแถวในของบล็อก ไม่มีซอยติดหน้า จึงไม่ผูกสินค้าใน catalog) */
export const PROMO_SPOTS = [];
const addPromoRow = (z, standZ, xs, types) => xs.forEach((x, i) => PROMO_SPOTS.push({
  code: `PM-${pad2(PROMO_SPOTS.length + 1)}`, x, z, standX: x, standZ, type: types[i % types.length],
}));
const cols = (x0, step, n) => Array.from({ length: n }, (_, i) => Math.round((x0 + i * step) * 100) / 100);
// ลานโปรโมชันกลางคลัง (ติดทางเดินหลัก)
addPromoRow(-0.6, -1.8, cols(10.2, 1.35, 12), ['paint', 'paint', 'tile', 'tile', 'cement', 'cement', 'tilefix', 'tilefix', 'sanitary', 'sanitary', 'mixed', 'mixed']);
addPromoRow(-3.0, -1.8, cols(10.2, 1.35, 12), ['mixed', 'mixed', 'sanitary', 'sanitary', 'mortar', 'mortar', 'cement', 'cement', 'tile', 'tile', 'paint', 'paint']);
// ลานโปรโมชันข้างทางเข้าลูกค้า
addPromoRow(6.25, 5.35, cols(10.0, 1.3, 6), ['paint', 'paint', 'mixed', 'mixed', 'tile', 'tile']);
addPromoRow(8.4, 7.15, cols(10.0, 1.3, 6), ['tilefix', 'tilefix', 'sanitary', 'sanitary', 'mixed', 'mixed']);
addPromoRow(10.9, 12.15, cols(10.0, 1.3, 6), ['cement', 'cement', 'mortar', 'mortar', 'paint', 'paint']);
addPromoRow(13.4, 12.15, cols(10.0, 1.3, 4), ['tile', 'tile', 'sanitary', 'sanitary']);
addPromoRow(14.6, null, cols(10.0, 1.3, 4), ['tile', 'tile', 'sanitary', 'sanitary']);
addPromoRow(15.8, null, cols(10.0, 1.3, 4), ['mixed', 'mixed', 'paint', 'paint']);
// หัวซอยเชลฟ์ไฟฟ้า (ระหว่างเลน 3 กับเชลฟ์ SH)
addPromoRow(6.25, 5.35, [31.5, 32.8], ['mixed']);
addPromoRow(8.4, 7.15, [31.5, 32.8], ['paint']);
addPromoRow(10.9, 9.65, [31.5, 32.8], ['sanitary']);
addPromoRow(13.4, 12.15, [31.5, 32.8], ['tile']);
addPromoRow(15.75, 14.65, [31.5, 32.8], ['mixed']);

export const PROMO_BY_CODE = new Map(PROMO_SPOTS.map((s) => [s.code, s]));

/** ซอยเดินเท้าของโซนเชลฟ์/โชว์รูม/โปรโมชัน — แต่ละรายการคือ [x1, z1, x2, z2] */
export const SHELF_WALK_SEGMENTS = [
  // ซอยเชลฟ์หน้าร้านยาวตลอดแนว: เครื่องมือช่าง-เกษตร → โปรโมชัน → ทางเข้า → สวน → ไฟฟ้า-ประปา
  ...[5.35, 7.15, 9.65, 12.15].map((z) => [-11.2, z, 52.15, z]),
  [-11.2, 14.65, 7.2, 14.65],
  // ซอยลานโปรโมชัน + เชลฟ์เครื่องใช้ไฟฟ้า-ครัว-ห้องน้ำ (ระหว่างเลน 2 กับเลน 3)
  ...[-1.8, -5.25, -7.75, -10.25, -12.75, -15.25].map((z) => [7.2, z, 28.6, z]),
  // ซอยโชว์รูมสุขภัณฑ์-กระเบื้อง (ต่อจากทางเดินเลียบกองพื้น x = -12.6)
  ...[-2.5, -5.5, -8.5, -11.5, -14.5].map((z) => [-24.6, z, -12.6, z]),
];
