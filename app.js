// =====================================================================
// ระบบยืนยันการส่งของ — เวอร์ชันสแตติก + Firebase (ฐานข้อมูลกลาง)
// ข้อมูล DO / การสแกน / รูปถ่าย เก็บบน Firebase (Firestore เท่านั้น — ไม่ใช้ Storage)
// ทุกคนที่เปิดแอปนี้จะเห็นข้อมูลชุดเดียวกัน แบบเรียลไทม์
//
// โครงสร้างข้อมูล Firestore:
//   - คอลเลกชัน "dos"        doc id = เลข DO (trim + uppercase)
//       { doNo, palletCount, createdAt, createdBy }
//   - คอลเลกชัน "scans"      doc id = "<DO>__<seq 3 หลัก>" เช่น DO12345__001
//       { doNo, palletNo, qrData, hasPhoto, note, scannedAt, scannedBy }
//   - คอลเลกชัน "scanPhotos" doc id = "<DO>__<seq 3 หลัก>" (เดียวกับ scans)
//       { dataUrl, doNo }   // dataUrl = รูป JPEG แบบบีบอัด (base64 data URL)
//
// รูปถ่ายถูกบีบอัดที่ฝั่งไคลเอนต์ก่อนบันทึก (ย่อขนาด + ลดคุณภาพ JPEG)
// ให้มีขนาดเล็กพอที่จะเก็บใน Firestore document (จำกัด 1 MiB/เอกสาร)
//
// สิ่งที่ยังเก็บใน localStorage: เฉพาะ "ชื่อผู้ใช้งาน" (dcs_user) เพื่อความสะดวก
// =====================================================================

// ===================== Utilities =====================
const $ = (id) => document.getElementById(id);

const LS_KEYS = {
  USER: 'dcs_user'
};

function toast(msg, type) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (type || '');
  setTimeout(() => t.className = 'toast', 3200);
}
function busy(on) { $('overlay').style.display = on ? 'flex' : 'none'; }

/** ชื่อผู้ใช้งานที่กรอกไว้ (ไม่บังคับ) */
function currentUser_() {
  return (localStorage.getItem(LS_KEYS.USER) || '').trim();
}

// ===================== Firebase init =====================
let db = null;
let firebaseReady = false;

function isConfigValid_(cfg) {
  if (!cfg) return false;
  // หมายเหตุ: ไม่ใช้ Firebase Storage แล้ว จึงไม่บังคับให้ตั้งค่า storageBucket
  const required = ['apiKey', 'authDomain', 'projectId', 'messagingSenderId', 'appId'];
  return required.every((k) => {
    const v = cfg[k];
    return typeof v === 'string' && v.trim() !== '' && v.indexOf('ใส่ค่าของคุณ') === -1;
  });
}

function initFirebase_() {
  const cfg = window.firebaseConfig;
  if (!isConfigValid_(cfg)) {
    firebaseReady = false;
    showConfigWarning_();
    return false;
  }
  try {
    firebase.initializeApp(cfg);
    db = firebase.firestore();
    firebaseReady = true;
    return true;
  } catch (e) {
    firebaseReady = false;
    showConfigWarning_(e.message);
    return false;
  }
}

function showConfigWarning_(detail) {
  const msg = 'ยังไม่ได้ตั้งค่า Firebase — กรุณาเปิดไฟล์ firebase-config.js แล้ววางค่า config จาก Firebase Console (Project settings) ให้ครบทุกช่อง';
  toast(msg, 'error');

  // แสดงข้อความเตือนแบบติดหน้าจอ ไม่ให้หายไปเฉย ๆ
  let banner = $('fbWarning');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'fbWarning';
    banner.className = 'card';
    banner.style.background = '#fff3e0';
    banner.style.border = '1px solid #ffb74d';
    banner.style.margin = '14px';
    banner.style.color = '#e65100';
    banner.style.fontSize = '14px';
    banner.style.lineHeight = '1.6';
    const header = document.querySelector('.app-header');
    if (header && header.nextSibling) {
      document.body.insertBefore(banner, header.nextSibling);
    } else {
      document.body.appendChild(banner);
    }
  }
  banner.innerHTML =
    '⚠️ <b>ยังไม่ได้เชื่อมต่อ Firebase</b><br>' +
    'กรุณาเปิดไฟล์ <code>firebase-config.js</code> แล้วนำค่า config จาก Firebase Console ' +
    '(เมนู Project settings → General → Your apps) มาวางแทนคำว่า "ใส่ค่าของคุณ" ให้ครบทุกช่อง จากนั้นบันทึกและรีเฟรชหน้านี้ใหม่' +
    (detail ? ('<br><span style="font-size:12px;opacity:.8">รายละเอียด: ' + escapeHtml_(detail) + '</span>') : '');
}

/** ตรวจว่า Firebase พร้อมใช้งานหรือยัง ถ้าไม่พร้อมจะ throw ข้อความไทยให้ผู้ใช้ทราบ */
function ensureFirebase_() {
  if (!firebaseReady) {
    throw new Error('ยังไม่ได้ตั้งค่า Firebase กรุณาแก้ไขไฟล์ firebase-config.js ก่อนใช้งาน');
  }
}

/** แปลง Firestore Timestamp (หรือค่าอื่น ๆ) ให้เป็นข้อความเวลาแบบไทย */
function formatTimestamp_(ts) {
  if (!ts) return '';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const bkk = new Date(d.getTime() + (7 * 60 - d.getTimezoneOffset()) * 60000);
    const pad = (n) => String(n).padStart(2, '0');
    return bkk.getFullYear() + '-' + pad(bkk.getMonth() + 1) + '-' + pad(bkk.getDate()) +
      ' ' + pad(bkk.getHours()) + ':' + pad(bkk.getMinutes()) + ':' + pad(bkk.getSeconds());
  } catch (e) {
    return '';
  }
}

// ===================== รูปแบบ QR (ห้ามเปลี่ยน — ต้องตรงกับ docs อื่น) =====================

/** รูปแบบข้อความใน QR: <DO>-<ลำดับพาเลท 3 หลัก> เช่น DO12345-001 */
function buildQrData_(doNo, seq) {
  const pad = String(seq).padStart(3, '0');
  return doNo + '-' + pad;
}

/** แยกเลข DO และลำดับพาเลทออกจากข้อความ QR (ฝั่ง "เซิร์ฟเวอร์" — ใช้ตรวจสอบจริง) */
function parseQrData_(qr) {
  qr = String(qr || '').trim().toUpperCase();
  const idx = qr.lastIndexOf('-');
  if (idx === -1) return null;
  const doNo = qr.substring(0, idx);
  const seq = parseInt(qr.substring(idx + 1), 10);
  if (!doNo || isNaN(seq)) return null;
  return { doNo: doNo, seq: seq };
}

/** seq -> "001" รูปแบบ 3 หลัก ใช้เป็นส่วนหนึ่งของ doc id ใน "scans" */
function seqId_(seq) {
  return String(seq).padStart(3, '0');
}

// ===================== ฟังก์ชันหลัก (เทียบเท่า Code.gs แต่คุยกับ Firestore) =====================

/**
 * สร้าง/อัปเดตทะเบียน DO — เทียบเท่า createDO(doNo, palletCount) ใน Code.gs
 * @return {Promise<Object>} {doNo, palletCount, codes:[{seq, qrData}]}
 */
async function createDO(doNo, palletCount) {
  ensureFirebase_();
  doNo = String(doNo || '').trim().toUpperCase();
  palletCount = parseInt(palletCount, 10);
  if (!doNo) throw new Error('กรุณากรอกเลขที่ DO');
  if (!(palletCount >= 1 && palletCount <= 999)) throw new Error('จำนวนพาเลทต้องอยู่ระหว่าง 1–999');

  const docRef = db.collection('dos').doc(doNo);
  await docRef.set({
    doNo: doNo,
    palletCount: palletCount,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    createdBy: currentUser_()
  }, { merge: true });

  const codes = [];
  for (let i = 1; i <= palletCount; i++) {
    codes.push({ seq: i, qrData: buildQrData_(doNo, i) });
  }
  return { doNo: doNo, palletCount: palletCount, codes: codes };
}

/**
 * ดึงข้อมูล DO + สถานะการสแกน — เทียบเท่า getDOInfo(doNo)
 * @return {Promise<Object>} {found, doNo, total, scanned, scannedSeqs:[...]}
 */
async function getDOInfo(doNo) {
  ensureFirebase_();
  doNo = String(doNo || '').trim().toUpperCase();
  if (!doNo) throw new Error('กรุณากรอกเลขที่ DO');

  const masterSnap = await db.collection('dos').doc(doNo).get();
  const scansSnap = await db.collection('scans').where('doNo', '==', doNo).get();

  const scannedSeqs = [];
  scansSnap.forEach((doc) => {
    const n = parseInt(doc.data().palletNo, 10);
    if (!isNaN(n)) scannedSeqs.push(n);
  });
  scannedSeqs.sort((a, b) => a - b);

  return {
    found: masterSnap.exists,
    doNo: doNo,
    total: masterSnap.exists ? parseInt(masterSnap.data().palletCount, 10) : 0,
    scanned: scannedSeqs.length,
    scannedSeqs: scannedSeqs
  };
}

// ===================== บีบอัดรูปภาพ (เก็บลง Firestore แทน Storage) =====================

// เพดานขนาดข้อมูลรูป (base64 data URL) — Firestore จำกัด 1 MiB/เอกสาร
// เผื่อระยะห่างไว้พอสมควรสำหรับฟิลด์อื่น ๆ ในเอกสารเดียวกัน
// ลดเพดานลงเพื่อให้ "อัปโหลดเร็วขึ้นชัดเจน" ตอนบันทึก (ยอมลดคุณภาพรูปลงบ้าง)
// รูปยืนยันการส่งของ ~300KB @ ~800px ยังอ่านรายละเอียดได้ดี แต่ส่งขึ้น Firestore ไวกว่าเดิม ~3 เท่า
const PHOTO_MAX_BASE64_BYTES = 320 * 1024; // ~320 KB
const PHOTO_MAX_DIMENSION_STEPS = [1000, 800, 640, 480];
const PHOTO_QUALITY_STEPS = [0.6, 0.5, 0.42];

/** โหลด data URL เป็น HTMLImageElement */
function loadImage_(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('โหลดรูปภาพไม่สำเร็จ'));
    img.src = dataUrl;
  });
}

/** วาดรูปลงแคนวาสตามขนาดสูงสุดที่กำหนด (รักษาสัดส่วน) แล้วคืน data URL แบบ JPEG */
function drawToCanvas_(img, maxDim, quality) {
  let { width, height } = img;
  if (width > maxDim || height > maxDim) {
    if (width >= height) {
      height = Math.round(height * (maxDim / width));
      width = maxDim;
    } else {
      width = Math.round(width * (maxDim / height));
      height = maxDim;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  // พื้นหลังขาว เผื่อรูปต้นฉบับมีพื้นโปร่งใส (เช่น PNG) ก่อนแปลงเป็น JPEG
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * บีบอัดรูป (data URL) ให้มีขนาดเล็กพอจะเก็บใน Firestore document
 * ลองลดคุณภาพ JPEG ก่อน แล้วค่อยลดขนาดภาพ จนกว่าจะได้ขนาดที่ปลอดภัย
 * @param {string} dataUrl รูปต้นฉบับเป็น base64 data URL
 * @return {Promise<string>} รูป JPEG ที่บีบอัดแล้ว เป็น base64 data URL
 */
async function compressImage_(dataUrl) {
  const img = await loadImage_(dataUrl);

  for (const maxDim of PHOTO_MAX_DIMENSION_STEPS) {
    for (const quality of PHOTO_QUALITY_STEPS) {
      const out = drawToCanvas_(img, maxDim, quality);
      if (out.length <= PHOTO_MAX_BASE64_BYTES) {
        return out;
      }
    }
  }

  // ลองทุกขนาด/คุณภาพแล้วก็ยังเกินเพดานที่ปลอดภัย
  throw new Error('รูปใหญ่เกินไป กรุณาถ่ายใหม่อีกครั้ง');
}

/**
 * บันทึกการสแกน (บังคับแนบรูป) — เทียบเท่า saveScan(payload)
 * @param {Object} payload {doNo, qrData, photoBase64, mimeType, note}
 * @return {Promise<Object>} ข้อมูล DO ล่าสุดหลังบันทึก (เหมือน getDOInfo)
 */
async function saveScan(payload) {
  ensureFirebase_();
  payload = payload || {};
  const doNoInput = String(payload.doNo || '').trim().toUpperCase();
  const parsed = parseQrData_(payload.qrData);

  if (!doNoInput) throw new Error('ยังไม่ได้เลือกเลขที่ DO');
  if (!parsed) throw new Error('QR Code ไม่ถูกต้อง (อ่านเลข DO/พาเลทไม่ได้)');
  if (parsed.doNo !== doNoInput) {
    throw new Error('QR นี้เป็นของ ' + parsed.doNo + ' ไม่ตรงกับ DO ที่เลือก (' + doNoInput + ')');
  }
  if (!payload.photoBase64) throw new Error('ต้องถ่ายรูปแนบก่อนจึงจะบันทึกได้');

  const masterRef = db.collection('dos').doc(doNoInput);
  const masterSnap = await masterRef.get();
  if (!masterSnap.exists) throw new Error('ไม่พบ DO นี้ในระบบ กรุณาสร้าง DO ก่อน');

  const total = parseInt(masterSnap.data().palletCount, 10);
  if (parsed.seq < 1 || parsed.seq > total) {
    throw new Error('ลำดับพาเลท ' + parsed.seq + ' เกินจำนวนที่ตั้งไว้ (' + total + ')');
  }

  // บีบอัดรูปก่อน (นอก transaction) ให้เล็กพอจะเก็บในเอกสาร Firestore
  const tc = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const compressedDataUrl = await compressImage_(payload.photoBase64);
  dbg('บีบอัดรูป ' + Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now())) - tc) +
      ' ms · ~' + Math.round(compressedDataUrl.length / 1024) + ' KB');

  const scanId = doNoInput + '__' + seqId_(parsed.seq);
  const scanRef = db.collection('scans').doc(scanId);
  const scanPhotoRef = db.collection('scanPhotos').doc(scanId);

  // กันสแกนซ้ำแบบ atomic ด้วย transaction (แทน LockService เดิม)
  // เขียนทั้งเอกสาร scan และ scanPhoto พร้อมกันใน transaction เดียว
  const tw = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(scanRef);
    if (existing.exists) {
      throw new Error('พาเลทลำดับ ' + parsed.seq + ' ถูกสแกนไปแล้ว');
    }
    tx.set(scanRef, {
      doNo: doNoInput,
      palletNo: parsed.seq,
      qrData: String(payload.qrData).trim().toUpperCase(),
      hasPhoto: true,
      photoBytes: compressedDataUrl.length,   // ขนาดรูป (base64 char ≈ ไบต์) ใช้คำนวณกราฟความจุ Firestore
      note: String(payload.note || ''),
      scannedAt: firebase.firestore.FieldValue.serverTimestamp(),
      scannedBy: currentUser_()
    });
    tx.set(scanPhotoRef, {
      dataUrl: compressedDataUrl,
      doNo: doNoInput
    });
  });
  dbg('เขียน Firestore ' + Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now())) - tw) + ' ms');

  return getDOInfo(doNoInput);
}

// ===================== Tabs =====================
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    if (liveScanning) stopLiveScan(); // ปิดกล้องเมื่อออกจากหน้าสแกน
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('page-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'monitor') renderMonitor();
    if (btn.dataset.tab === 'export') renderExport();
  });
});

// ===================== ชื่อผู้ใช้งาน (ไม่บังคับ) — เก็บเฉพาะที่เครื่องนี้ =====================
(function initUserName() {
  const saved = localStorage.getItem(LS_KEYS.USER) || '';
  $('userName').value = saved;
  $('userName').addEventListener('change', () => {
    localStorage.setItem(LS_KEYS.USER, $('userName').value.trim());
  });
})();

// ===================== หน้า 1: สร้าง QR =====================
$('btnGen').addEventListener('click', async () => {
  const doNo = $('genDo').value.trim();
  const count = parseInt($('genCount').value, 10);
  if (!doNo) return toast('กรุณากรอกเลข DO', 'error');
  if (!(count >= 1 && count <= 999)) return toast('จำนวนพาเลทต้องอยู่ระหว่าง 1–999', 'error');

  $('btnGen').disabled = true;
  busy(true);
  try {
    const res = await createDO(doNo, count);
    renderQrSheets(res.doNo, res.codes);
    $('btnPrint').style.display = 'block';
    toast('สร้าง QR ' + res.codes.length + ' ดวงแล้ว', 'ok');
  } catch (e) {
    toast(e.message || 'เกิดข้อผิดพลาด', 'error');
  } finally {
    busy(false);
    $('btnGen').disabled = false;
  }
});

$('btnPrint').addEventListener('click', async () => { await whenQrReady_(5000); window.print(); });

/** วาด QR เป็นแผ่นละ 6 ดวง */
function renderQrSheets(doNo, codes) {
  if (typeof QRCode === 'undefined') {
    throw new Error('ไลบรารีสร้าง QR ยังโหลดไม่เสร็จ (ต่อเน็ตแล้วรีเฟรชหน้าใหม่)');
  }
  const area = $('printArea');
  area.innerHTML = '';
  for (let i = 0; i < codes.length; i += 6) {
    const sheet = document.createElement('div');
    sheet.className = 'qr-sheet';
    const group = codes.slice(i, i + 6);
    group.forEach(c => sheet.appendChild(buildQrCell(c)));
    // เติมช่องว่างให้ครบ 6 ช่อง เพื่อรักษ์เลย์เอาต์
    for (let k = group.length; k < 6; k++) {
      const empty = document.createElement('div');
      empty.className = 'qr-cell';
      sheet.appendChild(empty);
    }
    area.appendChild(sheet);
  }
}

function buildQrCell(code) {
  const cell = document.createElement('div');
  cell.className = 'qr-cell';
  const img = document.createElement('div');
  img.className = 'qr-img';
  cell.appendChild(img);
  const label = document.createElement('div');
  label.className = 'qr-label';
  label.textContent = code.qrData;
  cell.appendChild(label);
  // qrcodejs วาดลงใน element ทันที
  new QRCode(img, { text: code.qrData, width: 600, height: 600, correctLevel: QRCode.CorrectLevel.H });
  return cell;
}

/**
 * รอจน QR ทุกดวงในพื้นที่พิมพ์ "วาด/โหลดเสร็จจริง" ก่อนสั่งพิมพ์
 * (qrcodejs สลับ canvas -> <img> ที่ src โหลดช้ากว่า 1 tick ถ้าพิมพ์เร็วไปดวงจะว่าง)
 */
function whenQrReady_(timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const cells = document.querySelectorAll('#printArea .qr-img');
      let ready = cells.length > 0;
      cells.forEach((el) => {
        const img = el.querySelector('img');
        const canvas = el.querySelector('canvas');
        let ok;
        if (img && img.getAttribute('src')) ok = img.complete && img.naturalWidth > 0;
        else if (canvas) ok = canvas.width > 0;
        else ok = false;
        if (!ok) ready = false;
      });
      if (ready || Date.now() - start > (timeoutMs || 4000)) resolve();
      else setTimeout(check, 80);
    };
    check();
  });
}

// ===================== หน้า 2: สแกนยืนยัน =====================
let currentDO = null;
let qrReader = null;
let pendingScan = null; // {qrData, seq}
let photoData = null;   // {base64, mimeType}
let liveScanning = false; // สถานะกล้องสด (start/stop) ป้องกันเรียกซ้อน

// ===================== DEBUG PANEL =====================
// เขียน log ลงกล่อง #debugLog + console เพื่อวิเคราะห์ปัญหากล้อง/สแกนให้ตรงจุด
// (ตามกฎ CLAUDE.md ชั้น 4 — คงไว้จนกว่าผู้ใช้จะสั่งให้เอาออก)
let dbgErrCount = 0;
function dbg(msg) {
  const time = new Date().toTimeString().slice(0, 8);
  const line = '[' + time + '] ' + msg;
  const isErr = String(msg).indexOf('❌') !== -1;
  const panel = $('debugLog');
  if (panel) {
    const div = document.createElement('div');
    div.textContent = line;
    if (isErr) div.className = 'err';
    panel.appendChild(div);
    panel.scrollTop = panel.scrollHeight;
  }
  if (isErr) showDbgError_();
  try { console.log('[DBG] ' + msg); } catch (_) {}
}

// เด้งปุ่ม 🐞 มุมขวาเมื่อพบ ERROR (บรรทัดที่มี ❌) — ไม่เปิด log เอง ให้ผู้ใช้ "แตะดู"
function showDbgError_() {
  dbgErrCount++;
  const dock = $('debugDock');
  const count = $('dbgCount');
  const fab = $('debugFab');
  if (count) count.textContent = String(dbgErrCount);
  if (dock) dock.hidden = false;
  if (fab) { fab.classList.remove('pulse'); void fab.offsetWidth; fab.classList.add('pulse'); }
}

// ----- กล้องสแกนสด (getUserMedia ผ่าน html5-qrcode) -----
async function startLiveScan() {
  if (!currentDO) { toast('กรุณาโหลดเลขที่ DO ก่อน', 'error'); return; }
  if (liveScanning) return;

  dbg('เริ่มเปิดกล้องสด...');
  const hasGUM = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  dbg('getUserMedia รองรับ: ' + hasGUM + ' · secureContext: ' + window.isSecureContext);
  dbg('Html5Qrcode โหลดจาก CDN: ' + (typeof Html5Qrcode !== 'undefined'));

  if (typeof Html5Qrcode === 'undefined') {
    dbg('❌ ไลบรารี html5-qrcode ยังไม่โหลด (เช็คอินเทอร์เน็ต/ตัวบล็อกสคริปต์)');
    toast('โหลดไลบรารีสแกนไม่สำเร็จ ตรวจสอบอินเทอร์เน็ต', 'error');
    return;
  }
  if (!hasGUM || !window.isSecureContext) {
    dbg('❌ เปิดกล้องสดไม่ได้: ต้องเปิดผ่าน HTTPS และเบราว์เซอร์ต้องรองรับ getUserMedia');
    toast('ต้องเปิดหน้านี้ผ่าน HTTPS ถึงจะใช้กล้องสดได้ — ใช้ปุ่มถ่ายรูป/กรอกมือแทน', 'error');
    return;
  }

  if (!qrReader) qrReader = new Html5Qrcode('reader');

  // สลับ UI: แสดงพื้นที่กล้อง + ปุ่มปิด
  $('reader').style.display = 'block';
  $('btnLiveScan').style.display = 'none';
  $('btnStopScan').style.display = 'block';

  // log รายชื่อกล้อง (บางเครื่องเห็นชื่อหลังอนุญาตสิทธิ์แล้ว)
  try {
    const cams = await Html5Qrcode.getCameras();
    dbg('พบกล้อง ' + cams.length + ' ตัว: ' + cams.map(c => c.label || c.id).join(' | '));
  } catch (e) {
    dbg('getCameras ไม่สำเร็จ: ' + (e && e.name) + ' ' + (e && e.message));
  }

  try {
    await qrReader.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 250 },
      onLiveDecode,
      onLiveError
    );
    liveScanning = true;
    dbg('✅ กล้องเปิดแล้ว กำลังสแกน...');
  } catch (e) {
    dbg('❌ เปิดกล้องไม่สำเร็จ: ' + (e && e.name) + ' — ' + (e && (e.message || e)));
    toast('เปิดกล้องไม่สำเร็จ (' + (e && e.name || 'error') + ') ใช้ปุ่มถ่ายรูป/กรอกมือแทน', 'error');
    $('reader').style.display = 'none';
    $('btnLiveScan').style.display = 'block';
    $('btnStopScan').style.display = 'none';
  }
}

function onLiveDecode(decodedText) {
  dbg('อ่าน QR ได้: ' + decodedText);
  stopLiveScan();
  onDecoded(decodedText);
}

// callback ต่อเฟรมที่อ่านไม่เจอ — เงียบไว้ ไม่รบกวนผู้ใช้
function onLiveError(_msg) { /* ignore per-frame decode misses */ }

async function stopLiveScan() {
  $('reader').style.display = 'none';
  $('btnLiveScan').style.display = 'block';
  $('btnStopScan').style.display = 'none';
  if (!qrReader || !liveScanning) return;
  liveScanning = false;
  try {
    await qrReader.stop();
    dbg('ปิดกล้องแล้ว');
  } catch (e) {
    dbg('ปิดกล้อง error (ข้ามได้): ' + (e && e.message));
  }
}

$('btnLoadDo').addEventListener('click', loadDoInfo);
$('scanDo').addEventListener('keydown', e => { if (e.key === 'Enter') loadDoInfo(); });

async function loadDoInfo() {
  const doNo = $('scanDo').value.trim();
  if (!doNo) return toast('กรุณากรอกเลข DO', 'error');
  if (liveScanning) await stopLiveScan();
  busy(true);
  $('btnLoadDo').disabled = true;
  try {
    const info = await getDOInfo(doNo);
    if (!info.found) {
      $('doSummary').style.display = 'block';
      $('doSummary').innerHTML = '⚠️ ไม่พบ DO นี้ในระบบ — กรุณาสร้าง DO ในหน้า "สร้าง QR" ก่อน';
      $('scanControls').style.display = 'none';
      currentDO = null;
      return;
    }
    currentDO = info.doNo;
    renderDoSummary(info);
    $('scanControls').style.display = 'block';
  } catch (e) {
    toast(e.message || 'เกิดข้อผิดพลาด', 'error');
  } finally {
    busy(false);
    $('btnLoadDo').disabled = false;
  }
}

function renderDoSummary(info) {
  const remaining = info.total - info.scanned;
  $('doSummary').style.display = 'block';
  $('doSummary').innerHTML =
    'DO: <b>' + info.doNo + '</b><br>' +
    'พาเลททั้งหมด: <b>' + info.total + '</b> พาเลท<br>' +
    'สแกนแล้ว: <b>' + info.scanned + '</b> &nbsp;|&nbsp; คงเหลือ: <b>' + remaining + '</b><br>' +
    (info.scannedSeqs.length ? 'พาเลทที่สแกนแล้ว: ' + info.scannedSeqs.join(', ') : '');
}

// ----- สแกน QR จากรูปที่ถ่าย (html5-qrcode scanFile) -----
$('qrInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (liveScanning) await stopLiveScan(); // กันชนอินสแตนซ์ Html5Qrcode ตัวเดียวกัน
  busy(true);
  try {
    const decodedText = await decodeQr(file);
    if (!decodedText) throw new Error('no-qr');
    onDecoded(decodedText);
  } catch (err) {
    toast('อ่าน QR ไม่เจอ ลองถ่ายใหม่ให้ QR ชัด เต็มกรอบ และไม่เอียง', 'error');
  } finally {
    busy(false);
    e.target.value = ''; // เคลียร์เพื่อให้ถ่ายซ้ำดวงเดิมได้
  }
});

// ถอดรหัส QR: ใช้ตัวอ่านของเครื่องก่อน (เร็ว/แม่นกว่า) แล้วค่อย fallback
async function decodeQr(file) {
  // 1) BarcodeDetector ในตัวเครื่อง (iPhone/Android รุ่นใหม่) — ทนรูปเบลอ/เอียงได้ดี
  try {
    if ('BarcodeDetector' in window) {
      const formats = await BarcodeDetector.getSupportedFormats();
      if (formats.includes('qr_code')) {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        const bitmap = await createImageBitmap(file);
        const found = await detector.detect(bitmap);
        if (found && found.length) return found[0].rawValue;
      }
    }
  } catch (_) { /* ข้ามไปใช้ตัวสำรอง */ }
  // 2) สำรอง: html5-qrcode (zxing) อ่านจากไฟล์
  try {
    if (!qrReader) qrReader = new Html5Qrcode('reader');
    return await qrReader.scanFile(file, false);
  } catch (_) { return null; }
}

// ----- กรอกข้อมูล QR ด้วยตนเอง (fallback เมื่อกล้อง/ไฟล์ใช้ไม่ได้) -----
$('btnManualQr').addEventListener('click', () => {
  const text = $('manualQr').value.trim();
  if (!text) return toast('กรุณากรอกข้อมูล QR เช่น DO12345-001', 'error');
  onDecoded(text);
});
$('manualQr').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('btnManualQr').click();
});

// ----- ปุ่มกล้องสแกนสด + ปุ่มล้าง DEBUG PANEL -----
$('btnLiveScan').addEventListener('click', startLiveScan);
$('btnStopScan').addEventListener('click', stopLiveScan);

// DEBUG DOCK: แตะปุ่ม 🐞 = เปิด/ปิด log · ลากปุ่ม = ย้ายตำแหน่ง · ล้าง = เคลียร์แล้วซ่อนกลับ
(function initDbgDock() {
  const dock = $('debugDock'), fab = $('debugFab'), panel = $('debugPanel');
  if (!dock || !fab || !panel) return;
  let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
  fab.addEventListener('pointerdown', (e) => {
    dragging = true; moved = false;
    sx = e.clientX; sy = e.clientY;
    const r = dock.getBoundingClientRect();
    ox = r.left; oy = r.top;
    try { fab.setPointerCapture(e.pointerId); } catch (_) {}
  });
  fab.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    if (!moved) return;
    const w = dock.offsetWidth, h = dock.offsetHeight;
    const nx = Math.max(4, Math.min(window.innerWidth - w - 4, ox + dx));
    const ny = Math.max(4, Math.min(window.innerHeight - h - 4, oy + dy));
    dock.style.left = nx + 'px'; dock.style.top = ny + 'px';
    dock.style.right = 'auto'; dock.style.bottom = 'auto';
  });
  fab.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    try { fab.releasePointerCapture(e.pointerId); } catch (_) {}
    if (!moved) panel.hidden = !panel.hidden;   // แตะ (ไม่ลาก) = สลับเปิด/ปิด log
  });
  $('btnDbgClose').addEventListener('click', () => { panel.hidden = true; });
  $('btnDbgClear').addEventListener('click', () => {
    $('debugLog').innerHTML = '';
    dbgErrCount = 0;
    const c = $('dbgCount'); if (c) c.textContent = '0';
    panel.hidden = true;
    dock.hidden = true;   // ล้างแล้วซ่อนสนิทกลับ รอ ERROR ครั้งถัดไป
  });
})();

function onDecoded(decodedText) {
  if (!currentDO) { toast('กรุณาโหลดเลขที่ DO ก่อน', 'error'); return; }
  const parsed = parseQr(decodedText);
  if (!parsed) { toast('QR ไม่ถูกต้อง', 'error'); return; }
  if (parsed.doNo !== currentDO.toUpperCase()) {
    toast('QR เป็นของ ' + parsed.doNo + ' ไม่ตรงกับ DO ที่เลือก', 'error');
    return;
  }
  pendingScan = { qrData: decodedText.trim().toUpperCase(), seq: parsed.seq };
  openConfirmCard(parsed);
}

function parseQr(qr) {
  qr = String(qr || '').trim().toUpperCase();
  const idx = qr.lastIndexOf('-');
  if (idx === -1) return null;
  const doNo = qr.substring(0, idx);
  const seq = parseInt(qr.substring(idx + 1), 10);
  if (!doNo || isNaN(seq)) return null;
  return { doNo, seq };
}

function openConfirmCard(parsed) {
  if (liveScanning) stopLiveScan();
  resetConfirm();
  $('confirmCard').style.display = 'block';
  $('confirmInfo').innerHTML =
    'พบ QR: <b>' + pendingScan.qrData + '</b><br>' +
    'DO <b>' + parsed.doNo + '</b> พาเลทลำดับ <b>' + parsed.seq + '</b>';
  $('confirmCard').scrollIntoView({ behavior: 'smooth' });
}

function resetConfirm() {
  photoData = null;
  $('photoInput').value = '';
  $('scanNote').value = '';
  $('manualQr').value = '';
  $('photoPreview').style.display = 'none';
  $('btnSaveScan').disabled = true;
  $('photoHint').textContent = '⚠️ ต้องถ่ายรูปแนบก่อนจึงจะบันทึกได้';
}

// บังคับแนบรูป: ปุ่มบันทึกจะเปิดใช้งานก็ต่อเมื่อมีรูป
$('photoInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    photoData = { base64: reader.result, mimeType: file.type || 'image/jpeg' };
    $('photoPreview').src = reader.result;
    $('photoPreview').style.display = 'block';
    $('btnSaveScan').disabled = false;
    $('photoHint').textContent = '✅ แนบรูปแล้ว พร้อมบันทึก';
  };
  reader.readAsDataURL(file);
});

$('btnCancelScan').addEventListener('click', () => {
  pendingScan = null;
  $('confirmCard').style.display = 'none';
});

// บันทึกแบบ "เบื้องหลัง" (optimistic UI): ปิดการ์ดทันที พร้อมสแกนดวงถัดไปได้เลย
// การบีบอัด/อัปโหลดทำเบื้องหลัง แล้วเด้ง toast สำเร็จ/ล้มเหลวทีหลัง — รู้สึกเร็วขึ้นมาก
$('btnSaveScan').addEventListener('click', () => {
  if (!photoData) return toast('ต้องถ่ายรูปแนบก่อน', 'error');
  if (!pendingScan) return;

  // จับค่าปัจจุบันไว้ในตัวแปรเฉพาะ ก่อนเคลียร์ (กันชนกับการสแกนดวงถัดไป)
  const payload = {
    doNo: currentDO,
    qrData: pendingScan.qrData,
    photoBase64: photoData.base64,
    mimeType: photoData.mimeType,
    note: $('scanNote').value.trim()
  };
  const seq = pendingScan.seq;
  const doForSummary = currentDO;

  // ปิดการ์ดยืนยันทันที + เคลียร์เพื่อสแกนพาเลทถัดไปได้เลย
  pendingScan = null;
  $('confirmCard').style.display = 'none';
  toast('⏳ กำลังบันทึกพาเลท ' + seq + '...', '');

  saveScanBackground_(payload, seq, doForSummary);
});

/** บันทึกการสแกนแบบเบื้องหลัง แล้วรายงานผลผ่าน toast + DEBUG PANEL */
async function saveScanBackground_(payload, seq, doForSummary) {
  const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  try {
    const info = await saveScan(payload);
    dbg('✅ บันทึกพาเลท ' + seq + ' รวมทั้งหมด ' +
        Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now())) - t0) + ' ms');
    toast('✅ บันทึกพาเลท ' + seq + ' แล้ว', 'ok');
    if (currentDO === doForSummary) renderDoSummary(info); // อัปเดตสรุปถ้ายังอยู่ DO เดิม
    if (info.scanned >= info.total) toast('🎉 DO ' + info.doNo + ' ส่งครบแล้ว!', 'ok');
  } catch (e) {
    dbg('❌ บันทึกพาเลท ' + seq + ' ล้มเหลว: ' + (e && (e.message || e)));
    toast('❌ พาเลท ' + seq + ' บันทึกไม่สำเร็จ: ' + (e && e.message ? e.message : ''), 'error');
  }
}

// ===================== หน้า 3: มอนิเตอร์ (เรียลไทม์ผ่าน onSnapshot) =====================
$('btnRefresh').addEventListener('click', renderMonitor);

// แคชข้อมูลล่าสุดจาก Firestore สำหรับวาดหน้ามอนิเตอร์
let monitorDos = [];     // [{doNo, palletCount, createdAt}]
let monitorScans = [];   // [{doNo, palletNo, hasPhoto, note, scannedAt, scannedBy}]
let monitorListenersStarted = false;

function startMonitorListeners_() {
  if (monitorListenersStarted) return;
  if (!firebaseReady) return;
  monitorListenersStarted = true;

  db.collection('dos').onSnapshot((snap) => {
    monitorDos = [];
    snap.forEach((doc) => {
      const d = doc.data();
      monitorDos.push({
        doNo: doc.id,
        palletCount: parseInt(d.palletCount, 10) || 0,
        createdAt: d.createdAt || null
      });
    });
    renderMonitor();
    refreshExportIfActive_();
  }, (err) => {
    toast('โหลดข้อมูลมอนิเตอร์ไม่สำเร็จ: ' + (err.message || ''), 'error');
  });

  db.collection('scans').onSnapshot((snap) => {
    monitorScans = [];
    snap.forEach((doc) => {
      const d = doc.data();
      monitorScans.push({
        scanId: doc.id,
        doNo: String(d.doNo || '').trim().toUpperCase(),
        palletNo: parseInt(d.palletNo, 10),
        qrData: d.qrData || '',
        hasPhoto: !!d.hasPhoto,
        photoBytes: parseInt(d.photoBytes, 10) || 0,
        note: d.note || '',
        scannedAt: d.scannedAt || null,
        scannedBy: d.scannedBy || ''
      });
    });
    renderMonitor();
    refreshExportIfActive_();
  }, (err) => {
    toast('โหลดข้อมูลการสแกนไม่สำเร็จ: ' + (err.message || ''), 'error');
  });
}

/** คำนวณข้อมูลรวมสำหรับหน้ามอนิเตอร์จากแคช (เทียบเท่า getMonitorData) */
function computeMonitorData_() {
  const byDo = {}; // doNo -> {count, last}
  monitorScans.forEach((r) => {
    const d = r.doNo;
    if (!byDo[d]) byDo[d] = { count: 0, last: null };
    byDo[d].count++;
    if (r.scannedAt) {
      const ms = r.scannedAt.toMillis ? r.scannedAt.toMillis() : 0;
      const lastMs = byDo[d].last && byDo[d].last.toMillis ? byDo[d].last.toMillis() : -1;
      if (ms > lastMs) byDo[d].last = r.scannedAt;
    }
  });

  return monitorDos.map((m) => {
    const doNo = m.doNo;
    const total = m.palletCount;
    const scanned = byDo[doNo] ? byDo[doNo].count : 0;
    return {
      doNo: doNo,
      total: total,
      scanned: scanned,
      remaining: Math.max(0, total - scanned),
      complete: total > 0 && scanned >= total,
      lastUpdate: byDo[doNo] ? formatTimestamp_(byDo[doNo].last) : '',
      createdAtMs: m.createdAt && m.createdAt.toMillis ? m.createdAt.toMillis() : 0
    };
  }).sort((a, b) => b.createdAtMs - a.createdAtMs);
}

function renderMonitor() {
  if (!firebaseReady) {
    $('monitorList').innerHTML = '<div class="card">⚠️ ยังไม่ได้ตั้งค่า Firebase กรุณาแก้ไขไฟล์ firebase-config.js</div>';
    $('monitorMeta').textContent = '';
    return;
  }
  startMonitorListeners_();

  const rows = computeMonitorData_();
  const list = $('monitorList');
  list.innerHTML = '';
  if (!rows.length) {
    list.innerHTML = '<div class="card">ยังไม่มีข้อมูล DO</div>';
  } else {
    rows.forEach(r => list.appendChild(buildMonitorRow(r)));
  }
  const done = rows.filter(r => r.complete).length;
  $('monitorMeta').textContent = 'ครบ ' + done + ' / ทั้งหมด ' + rows.length + ' DO';
}

function buildMonitorRow(r) {
  const card = document.createElement('div');
  card.className = 'card mon-item';
  card.style.flexDirection = 'column';
  card.style.alignItems = 'stretch';

  const pct = r.total ? Math.round(r.scanned / r.total * 100) : 0;

  const top = document.createElement('div');
  top.style.display = 'flex';
  top.style.alignItems = 'center';
  top.style.gap = '12px';
  top.innerHTML =
    '<div class="meta">' +
      '<div class="mon-do">' + r.doNo + '</div>' +
      '<div class="mon-sub">' + r.scanned + ' / ' + r.total + ' พาเลท' +
        (r.lastUpdate ? ' · ล่าสุด ' + r.lastUpdate : '') + '</div>' +
      '<div class="bar"><span style="width:' + pct + '%"></span></div>' +
    '</div>' +
    '<span class="badge ' + (r.complete ? 'ok' : 'no') + '">' +
      (r.complete ? 'ครบ' : 'เหลือ ' + r.remaining) + '</span>';
  card.appendChild(top);

  // รายละเอียดการสแกน (ดูรูปที่บันทึกไว้) — พับ/กางได้
  const scans = monitorScans
    .filter(s => s.doNo === r.doNo)
    .sort((a, b) => (a.palletNo || 0) - (b.palletNo || 0));

  if (scans.length) {
    const toggle = document.createElement('button');
    toggle.className = 'mon-toggle';
    toggle.type = 'button';
    toggle.textContent = 'ดูรายละเอียด (' + scans.length + ' รายการ)';

    const detail = document.createElement('div');
    detail.className = 'mon-detail';
    detail.style.display = 'none';
    scans.forEach(s => detail.appendChild(buildScanRow(s)));

    toggle.addEventListener('click', () => {
      const showing = detail.style.display !== 'none';
      detail.style.display = showing ? 'none' : 'block';
      toggle.textContent = showing
        ? 'ดูรายละเอียด (' + scans.length + ' รายการ)'
        : 'ซ่อนรายละเอียด';
    });

    card.appendChild(toggle);

    // ปุ่มส่งออกรูปของ DO นี้ (เฉพาะที่มีรูป)
    const photoCount = scans.filter(s => s.hasPhoto).length;
    if (photoCount) {
      const bExp = document.createElement('button');
      bExp.className = 'mon-toggle';
      bExp.type = 'button';
      bExp.style.marginLeft = '14px';
      bExp.textContent = '⬇️ ส่งออกรูป (' + photoCount + ')';
      bExp.addEventListener('click', () => exportPhotos(r.doNo));
      card.appendChild(bExp);
    }

    card.appendChild(detail);
  }

  return card;
}

function buildScanRow(s) {
  const row = document.createElement('div');
  row.className = 'mon-scan-row';

  if (s.hasPhoto) {
    const thumb = document.createElement('div');
    thumb.className = 'mon-photo-thumb mon-photo-placeholder';
    thumb.textContent = '🖼️';
    thumb.title = 'คลิกเพื่อดูรูป';
    thumb.addEventListener('click', () => openScanPhoto_(s, thumb));
    row.appendChild(thumb);
  } else {
    const thumb = document.createElement('div');
    thumb.className = 'mon-photo-thumb mon-photo-placeholder mon-photo-empty';
    thumb.textContent = '–';
    thumb.title = 'ไม่มีรูปสำหรับรายการนี้';
    row.appendChild(thumb);
  }

  const scannedAtText = formatTimestamp_(s.scannedAt);
  const meta = document.createElement('div');
  meta.className = 'mon-scan-meta';
  meta.innerHTML =
    'พาเลท <b>' + s.palletNo + '</b> · ' + scannedAtText +
    (s.scannedBy ? ' · ' + escapeHtml_(s.scannedBy) : '') +
    (s.note ? '<br>หมายเหตุ: ' + escapeHtml_(s.note) : '');
  row.appendChild(meta);

  return row;
}

/**
 * ดึงรูปของรายการสแกนแบบ on-demand จากคอลเลกชัน "scanPhotos"
 * (ไม่โหลดรูปทั้งหมดมาพร้อมมอนิเตอร์ เพื่อให้ onSnapshot ของ dos/scans เบา)
 */
async function openScanPhoto_(s, thumbEl) {
  if (!firebaseReady) return;

  openLightbox_(null);            // เปิด lightbox โหมด "กำลังโหลด" ทันที
  const original = thumbEl.textContent;
  thumbEl.textContent = '⏳';

  try {
    const snap = await db.collection('scanPhotos').doc(s.scanId).get();
    if (!snap.exists || !snap.data() || !snap.data().dataUrl) {
      closeLightbox_();
      toast('ไม่พบรูปสำหรับรายการนี้', 'error');
      return;
    }
    openLightbox_(snap.data().dataUrl);   // แสดงรูปเต็มใน lightbox
  } catch (e) {
    closeLightbox_();
    toast('โหลดรูปไม่สำเร็จ: ' + (e && e.message ? e.message : ''), 'error');
  } finally {
    if (thumbEl.isConnected) thumbEl.textContent = original;
  }
}

/** เปิด lightbox — ถ้า dataUrl ว่าง = โหมดกำลังโหลด */
function openLightbox_(dataUrl) {
  const lb = $('lightbox');
  const img = $('lightboxImg');
  const loading = $('lightboxLoading');
  if (dataUrl) {
    img.src = dataUrl;
    img.style.display = 'block';
    loading.style.display = 'none';
  } else {
    img.style.display = 'none';
    img.src = '';
    loading.style.display = 'block';
  }
  lb.style.display = 'flex';
}

function closeLightbox_() {
  const lb = $('lightbox');
  lb.style.display = 'none';
  $('lightboxImg').src = '';
}

function escapeHtml_(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ===================== หน้า 1 (ต่อ): ประวัติ DO — ดู/ปริ้นซ้ำ/แก้จำนวน/ลบ =====================
let historyDos = [];              // [{doNo, palletCount, createdAt, createdBy}]
let historyListenerStarted = false;
let historyPage = 1;              // หน้าปัจจุบันของประวัติ DO
const HISTORY_PAGE_SIZE = 10;     // แสดงสูงสุด 10 DO ต่อหน้า ถ้าเกินดันไปหน้าถัดไป

function startHistoryListener_() {
  if (historyListenerStarted || !firebaseReady) return;
  historyListenerStarted = true;
  db.collection('dos').onSnapshot((snap) => {
    historyDos = [];
    snap.forEach((doc) => {
      const d = doc.data();
      historyDos.push({
        doNo: doc.id,
        palletCount: parseInt(d.palletCount, 10) || 0,
        createdAt: d.createdAt || null,
        createdBy: d.createdBy || ''
      });
    });
    historyDos.sort((a, b) => {
      const am = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
      const bm = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
      return bm - am;
    });
    renderHistory();
  }, (err) => {
    dbg('history listener error: ' + (err && err.message));
  });
}

function renderHistory() {
  const list = $('historyList');
  if (!list) return;
  if (!firebaseReady) { list.innerHTML = '<div class="history-empty">ยังไม่ได้เชื่อมต่อ Firebase</div>'; return; }
  if (!historyDos.length) { list.innerHTML = '<div class="history-empty">ยังไม่มี DO ที่สร้างไว้</div>'; return; }

  // แบ่งหน้า: สูงสุด 10 DO ต่อหน้า
  const totalPages = Math.max(1, Math.ceil(historyDos.length / HISTORY_PAGE_SIZE));
  if (historyPage > totalPages) historyPage = totalPages; // ลบจนรายการหด → เด้งกลับหน้าสุดท้ายที่มีอยู่
  if (historyPage < 1) historyPage = 1;

  const start = (historyPage - 1) * HISTORY_PAGE_SIZE;
  const pageItems = historyDos.slice(start, start + HISTORY_PAGE_SIZE);

  list.innerHTML = '';
  pageItems.forEach((d) => list.appendChild(buildHistoryRow(d)));

  if (totalPages > 1) list.appendChild(buildHistoryPager_(totalPages));
}

/** แถบแบ่งหน้าประวัติ DO: ‹ ก่อนหน้า | หน้า X/Y | ถัดไป › */
function buildHistoryPager_(totalPages) {
  const pager = document.createElement('div');
  pager.className = 'history-pager';

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.textContent = '‹ ก่อนหน้า';
  prev.disabled = historyPage <= 1;
  prev.addEventListener('click', () => { if (historyPage > 1) { historyPage--; renderHistory(); } });

  const info = document.createElement('span');
  info.className = 'history-pageinfo';
  info.textContent = 'หน้า ' + historyPage + ' / ' + totalPages + ' (ทั้งหมด ' + historyDos.length + ' DO)';

  const next = document.createElement('button');
  next.type = 'button';
  next.textContent = 'ถัดไป ›';
  next.disabled = historyPage >= totalPages;
  next.addEventListener('click', () => { if (historyPage < totalPages) { historyPage++; renderHistory(); } });

  pager.appendChild(prev);
  pager.appendChild(info);
  pager.appendChild(next);
  return pager;
}

function buildHistoryRow(d) {
  const row = document.createElement('div');
  row.className = 'history-row';

  const info = document.createElement('div');
  info.className = 'history-info';
  const created = formatTimestamp_(d.createdAt);
  info.innerHTML =
    '<div class="history-do">' + escapeHtml_(d.doNo) + '</div>' +
    '<div class="history-sub">' + d.palletCount + ' พาเลท' +
      (created ? ' · สร้าง ' + created : '') +
      (d.createdBy ? ' · โดย ' + escapeHtml_(d.createdBy) : '') + '</div>';
  row.appendChild(info);

  const actions = document.createElement('div');
  actions.className = 'history-actions';

  const bPrint = document.createElement('button');
  bPrint.className = 'h-print'; bPrint.type = 'button'; bPrint.textContent = '🖨️ ปริ้นซ้ำ';
  bPrint.addEventListener('click', () => reprintDO(d.doNo, d.palletCount));

  const bEdit = document.createElement('button');
  bEdit.className = 'h-edit'; bEdit.type = 'button'; bEdit.textContent = '✏️ แก้จำนวน';
  bEdit.addEventListener('click', () => startEditCount(row, d));

  const bDel = document.createElement('button');
  bDel.className = 'h-del'; bDel.type = 'button'; bDel.textContent = '🗑️ ลบ';
  bDel.addEventListener('click', () => deleteDO(d.doNo));

  actions.appendChild(bPrint);
  actions.appendChild(bEdit);
  actions.appendChild(bDel);
  row.appendChild(actions);
  return row;
}

/** ปริ้นซ้ำ QR ของ DO (กรณีป้ายชำรุด) — วาดใหม่ รอวาดครบ แล้วเปิดหน้าพิมพ์ */
async function reprintDO(doNo, count) {
  if (typeof QRCode === 'undefined') {
    return toast('ไลบรารีสร้าง QR ยังโหลดไม่เสร็จ (ต่อเน็ตแล้วรีเฟรชหน้าใหม่)', 'error');
  }
  const codes = [];
  for (let i = 1; i <= count; i++) codes.push({ seq: i, qrData: buildQrData_(doNo, i) });
  try {
    renderQrSheets(doNo, codes);
  } catch (e) {
    return toast(e.message || 'สร้าง QR ไม่สำเร็จ', 'error');
  }
  $('btnPrint').style.display = 'block';
  $('printArea').scrollIntoView({ behavior: 'smooth' });
  toast('เตรียมพิมพ์ DO ' + doNo + ' (' + count + ' ดวง)', 'ok');
  await whenQrReady_(5000);   // รอ QR วาดครบก่อนพิมพ์ (กัน "ขึ้นไม่ครบ")
  window.print();
}

/** แก้ "จำนวนพาเลท" ของ DO แบบ inline */
function startEditCount(row, d) {
  if (row.querySelector('.history-edit')) return; // กันเปิดซ้ำ
  const box = document.createElement('div');
  box.className = 'history-edit';
  const input = document.createElement('input');
  input.type = 'number'; input.min = '1'; input.max = '999'; input.value = d.palletCount;
  const save = document.createElement('button');
  save.className = 'primary'; save.type = 'button'; save.textContent = 'บันทึก';
  const cancel = document.createElement('button');
  cancel.className = 'ghost'; cancel.type = 'button'; cancel.textContent = 'ยกเลิก';
  box.appendChild(input); box.appendChild(save); box.appendChild(cancel);
  row.appendChild(box);
  input.focus();

  cancel.addEventListener('click', () => box.remove());
  save.addEventListener('click', async () => {
    const n = parseInt(input.value, 10);
    if (!(n >= 1 && n <= 999)) return toast('จำนวนพาเลทต้องอยู่ระหว่าง 1–999', 'error');
    save.disabled = true; cancel.disabled = true;
    busy(true);
    try {
      await db.collection('dos').doc(d.doNo).set({ palletCount: n }, { merge: true });
      toast('แก้จำนวนพาเลท ' + d.doNo + ' เป็น ' + n + ' แล้ว', 'ok');
      box.remove();
    } catch (e) {
      toast('แก้ไม่สำเร็จ: ' + (e && e.message ? e.message : ''), 'error');
      save.disabled = false; cancel.disabled = false;
    } finally { busy(false); }
  });
}

/** ลบ DO (พร้อมยืนยัน) — ถ้ามีการสแกนแล้วจะลบ scans + รูปทั้งหมดของ DO นี้ด้วย */
async function deleteDO(doNo) {
  if (!firebaseReady) return;
  busy(true);
  const scanDocs = [];
  try {
    const scansSnap = await db.collection('scans').where('doNo', '==', doNo).get();
    scansSnap.forEach((doc) => scanDocs.push(doc.id));
  } catch (e) {
    busy(false);
    return toast('ตรวจข้อมูลสแกนไม่สำเร็จ: ' + (e && e.message ? e.message : ''), 'error');
  }
  busy(false);

  const n = scanDocs.length;
  const msg = n > 0
    ? ('⚠️ DO ' + doNo + ' มีการสแกนไปแล้ว ' + n + ' รายการ\n\nการลบจะลบ DO นี้ พร้อม "การสแกนและรูปถ่ายทั้งหมด" อย่างถาวร\n\nยืนยันลบ?')
    : ('ต้องการลบ DO ' + doNo + ' ใช่ไหม?');
  const ok = await showConfirm(msg);
  if (!ok) return;

  busy(true);
  try {
    // รวมรายการที่จะลบ: scans + scanPhotos (id เดียวกัน) + เอกสาร DO
    const refs = [];
    scanDocs.forEach((id) => {
      refs.push(db.collection('scans').doc(id));
      refs.push(db.collection('scanPhotos').doc(id));
    });
    refs.push(db.collection('dos').doc(doNo));
    // แบ่ง commit ทีละ 400 op (เพดาน batch = 500)
    for (let i = 0; i < refs.length; i += 400) {
      const batch = db.batch();
      refs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
      await batch.commit();
    }
    toast('ลบ DO ' + doNo + ' แล้ว', 'ok');
  } catch (e) {
    toast('ลบไม่สำเร็จ: ' + (e && e.message ? e.message : ''), 'error');
  } finally {
    busy(false);
  }
}

// ----- Modal ยืนยัน (คืน Promise<boolean>) — ใช้แทน confirm() ของเบราว์เซอร์ -----
let confirmResolver_ = null;
function showConfirm(message) {
  return new Promise((resolve) => {
    confirmResolver_ = resolve;
    $('confirmModalMsg').textContent = message;
    $('confirmModal').style.display = 'flex';
  });
}
function closeConfirm_(result) {
  $('confirmModal').style.display = 'none';
  const r = confirmResolver_; confirmResolver_ = null;
  if (r) r(result);
}
$('confirmModalOk').addEventListener('click', () => closeConfirm_(true));
$('confirmModalCancel').addEventListener('click', () => closeConfirm_(false));
$('confirmModal').addEventListener('click', (e) => { if (e.target === $('confirmModal')) closeConfirm_(false); });

// ----- ปุ่มรีเฟรชประวัติ + ปิด lightbox -----
$('btnHistoryRefresh').addEventListener('click', renderHistory);
$('lightboxClose').addEventListener('click', closeLightbox_);
$('lightbox').addEventListener('click', (e) => { if (e.target === $('lightbox')) closeLightbox_(); });

// ===================== หน้า 4: ส่งออก / จัดการรูป =====================
// รีเฟรชหน้าส่งออกอัตโนมัติเมื่อข้อมูลอัปเดต (ถ้าอยู่หน้าส่งออก)
function refreshExportIfActive_() {
  const p = $('page-export');
  if (p && p.classList.contains('active')) renderExport();
}

// ===================== กราฟความจุ Firestore =====================
// Firestore (แผนฟรี Spark) จำกัดพื้นที่จัดเก็บ 1 GiB — รูปถ่ายเก็บเป็น base64 ในคอลเลกชัน scanPhotos
const FIRESTORE_LIMIT_BYTES = 1024 * 1024 * 1024; // 1 GiB = 100%
const PHOTO_FALLBACK_BYTES = 320 * 1024;          // ค่าประมาณสำหรับรูปเก่าที่ไม่มีฟิลด์ photoBytes

/** คำนวณ + วาดกราฟ % ความจุ Firestore จากขนาดรูปในแคช monitorScans */
function renderStorageGauge_() {
  const bar = $('gaugeBar');
  const text = $('gaugeText');
  const warn = $('gaugeWarn');
  if (!bar || !text) return;

  let usedBytes = 0;
  monitorScans.forEach((s) => {
    if (s.hasPhoto) usedBytes += (s.photoBytes || PHOTO_FALLBACK_BYTES);
  });

  const pct = Math.min(100, usedBytes / FIRESTORE_LIMIT_BYTES * 100);
  const usedMb = usedBytes / (1024 * 1024);
  const usedText = usedMb >= 1024
    ? (usedMb / 1024).toFixed(2) + ' GB'
    : usedMb.toFixed(1) + ' MB';

  const span = bar.querySelector('span');
  if (span) span.style.width = pct.toFixed(1) + '%';

  // สีสถานะ: เขียว <60% · ส้ม 60–80% · แดง ≥80%
  bar.classList.remove('warn', 'danger');
  if (pct >= 80) bar.classList.add('danger');
  else if (pct >= 60) bar.classList.add('warn');

  text.textContent = 'ใช้ไป ' + usedText + ' / 1 GiB (' + Math.round(pct) + '%)';
  if (warn) warn.style.display = pct >= 80 ? 'block' : 'none';
}

function renderExport() {
  startMonitorListeners_(); // ใช้แคช dos/scans ร่วมกับมอนิเตอร์
  const list = $('exportList');
  const meta = $('exportMeta');
  if (!list) return;
  if (!firebaseReady) {
    list.innerHTML = '<div class="card">⚠️ ยังไม่ได้ตั้งค่า Firebase</div>';
    if (meta) meta.textContent = '';
    return;
  }

  renderStorageGauge_(); // อัปเดตกราฟความจุก่อน

  // นับรูปต่อ DO จากแคช
  const byDo = {};
  monitorScans.forEach((s) => { if (s.hasPhoto) byDo[s.doNo] = (byDo[s.doNo] || 0) + 1; });
  const doNos = Object.keys(byDo).sort();
  const totalPhotos = doNos.reduce((sum, d) => sum + byDo[d], 0);

  if (meta) meta.textContent = 'มีรูปทั้งหมด ' + totalPhotos + ' รูป · ' + doNos.length + ' DO';
  $('btnExportAll').disabled = totalPhotos === 0;

  list.innerHTML = '';
  if (!doNos.length) {
    list.innerHTML = '<div class="card">ยังไม่มีรูปให้ส่งออก</div>';
    return;
  }
  doNos.forEach((doNo) => list.appendChild(buildExportRow(doNo, byDo[doNo])));
}

function buildExportRow(doNo, count) {
  const card = document.createElement('div');
  card.className = 'card history-row';

  const info = document.createElement('div');
  info.className = 'history-info';
  info.innerHTML =
    '<div class="history-do">' + escapeHtml_(doNo) + '</div>' +
    '<div class="history-sub">' + count + ' รูป</div>';
  card.appendChild(info);

  const actions = document.createElement('div');
  actions.className = 'history-actions';

  const bExp = document.createElement('button');
  bExp.className = 'h-print'; bExp.type = 'button'; bExp.textContent = '⬇️ ส่งออก (ZIP)';
  bExp.addEventListener('click', () => exportPhotos(doNo));

  const bDel = document.createElement('button');
  bDel.className = 'h-del'; bDel.type = 'button'; bDel.textContent = '🗑️ ลบรูป (คืนพื้นที่)';
  bDel.addEventListener('click', () => deletePhotos(doNo));

  actions.appendChild(bExp);
  actions.appendChild(bDel);
  card.appendChild(actions);
  return card;
}

/**
 * ส่งออกรูปเป็นไฟล์ ZIP ลงเครื่อง — doNo = null คือทุก DO
 * ชื่อไฟล์ในซิป = <DO>-<ลำดับ 3 หลัก>.jpg
 */
async function exportPhotos(doNo) {
  if (!firebaseReady) return;
  if (typeof JSZip === 'undefined') {
    toast('โหลดไลบรารี ZIP ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ต', 'error');
    return;
  }
  const targets = monitorScans.filter((s) => s.hasPhoto && (!doNo || s.doNo === doNo));
  if (!targets.length) { toast('ไม่มีรูปให้ส่งออก', 'error'); return; }

  busy(true);
  dbg('เริ่มส่งออกรูป doNo=' + (doNo || 'ALL') + ' จำนวนเป้าหมาย=' + targets.length);
  try {
    const zip = new JSZip();
    let ok = 0;
    for (const s of targets) {
      const snap = await db.collection('scanPhotos').doc(s.scanId).get();
      const dataUrl = snap.exists && snap.data() ? snap.data().dataUrl : null;
      if (!dataUrl) continue;
      const comma = dataUrl.indexOf(',');
      const base64 = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
      zip.file(s.doNo + '-' + seqId_(s.palletNo) + '.jpg', base64, { base64: true });
      ok++;
    }
    if (!ok) { toast('ไม่พบข้อมูลรูปให้ส่งออก', 'error'); return; }
    const blob = await zip.generateAsync({ type: 'blob' });
    dbg('สร้าง ZIP สำเร็จ ' + ok + ' รูป · ' + Math.round(blob.size / 1024) + ' KB');
    // แสดง modal พร้อมปุ่มให้ "แตะ" ดาวน์โหลด (ทำงานได้ทุกอุปกรณ์ รวมมือถือ)
    presentDownload_(blob, 'photos-' + (doNo || 'ALL') + '-' + Date.now() + '.zip', ok);
  } catch (e) {
    dbg('❌ ส่งออกล้มเหลว: ' + (e && (e.message || e)));
    toast('ส่งออกไม่สำเร็จ: ' + (e && e.message ? e.message : ''), 'error');
  } finally {
    busy(false);
  }
}

// ----- Modal ดาวน์โหลด: ให้ผู้ใช้ "แตะ" เอง (user gesture) → บันทึกไฟล์ได้ชัวร์ทุกอุปกรณ์ -----
let currentDownloadBlob_ = null;
let currentDownloadName_ = null;
let currentDownloadUrl_ = null;

function presentDownload_(blob, fname, count) {
  if (currentDownloadUrl_) { try { URL.revokeObjectURL(currentDownloadUrl_); } catch (_) {} }
  currentDownloadBlob_ = blob;
  currentDownloadName_ = fname;
  currentDownloadUrl_ = URL.createObjectURL(blob);

  const link = $('downloadLink');
  link.href = currentDownloadUrl_;
  link.download = fname;

  $('downloadModalMsg').textContent =
    'เตรียมไฟล์ ZIP พร้อมแล้ว (' + count + ' รูป · ' + Math.round(blob.size / 1024) + ' KB)\n' +
    'แตะปุ่มด้านล่างเพื่อบันทึกลงเครื่อง';

  // ปุ่มแชร์ (เหมาะกับมือถือ — iOS/Android "บันทึกไปยังไฟล์")
  $('downloadShare').style.display = (typeof navigator.canShare === 'function') ? 'block' : 'none';

  $('downloadModal').style.display = 'flex';
}

$('downloadLink').addEventListener('click', () => {
  // ปล่อยให้เบราว์เซอร์ดาวน์โหลดตามปกติ แล้วปิด modal
  toast('กำลังบันทึกไฟล์...', 'ok');
  setTimeout(() => { $('downloadModal').style.display = 'none'; }, 400);
});

$('downloadShare').addEventListener('click', async () => {
  try {
    const file = new File([currentDownloadBlob_], currentDownloadName_, { type: 'application/zip' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: currentDownloadName_ });
      $('downloadModal').style.display = 'none';
    } else {
      toast('อุปกรณ์นี้แชร์ไฟล์ไม่ได้ ใช้ปุ่มดาวน์โหลดแทน', 'error');
    }
  } catch (e) {
    if (e && e.name !== 'AbortError') toast('แชร์ไม่สำเร็จ: ' + (e.message || ''), 'error');
  }
});

$('downloadClose').addEventListener('click', () => { $('downloadModal').style.display = 'none'; });
$('downloadModal').addEventListener('click', (e) => { if (e.target === $('downloadModal')) $('downloadModal').style.display = 'none'; });

/**
 * ลบ "เฉพาะรูป" ของ DO ออกจาก Firestore เพื่อคืนพื้นที่ (เก็บประวัติสแกนไว้)
 * ตั้ง scans.hasPhoto = false เพื่อให้มอนิเตอร์รู้ว่ารูปถูกนำออกแล้ว
 */
async function deletePhotos(doNo) {
  if (!firebaseReady) return;
  const targets = monitorScans.filter((s) => s.hasPhoto && s.doNo === doNo);
  if (!targets.length) { toast('DO นี้ไม่มีรูปให้ลบ', 'error'); return; }

  const ok = await showConfirm(
    'ลบ "รูปถ่าย" ของ DO ' + doNo + ' จำนวน ' + targets.length + ' รูป ออกจาก Firestore เพื่อคืนพื้นที่?\n\n' +
    '• ประวัติการสแกน/สถานะยังอยู่ครบ\n• แต่จะกดดูรูปไม่ได้อีก\n\nแนะนำ: กด "ส่งออก (ZIP)" เก็บลงคอมก่อน');
  if (!ok) return;

  busy(true);
  try {
    for (let i = 0; i < targets.length; i += 200) {
      const batch = db.batch();
      targets.slice(i, i + 200).forEach((s) => {
        batch.delete(db.collection('scanPhotos').doc(s.scanId));
        batch.update(db.collection('scans').doc(s.scanId), { hasPhoto: false });
      });
      await batch.commit();
    }
    toast('ลบรูปของ DO ' + doNo + ' แล้ว (' + targets.length + ' รูป คืนพื้นที่)', 'ok');
  } catch (e) {
    toast('ลบรูปไม่สำเร็จ: ' + (e && e.message ? e.message : ''), 'error');
  } finally {
    busy(false);
  }
}

$('btnExportAll').addEventListener('click', () => exportPhotos(null));
$('btnExportRefresh').addEventListener('click', renderExport);

// ===================== เริ่มต้นแอป =====================
// จับ error ที่ไม่ถูก try/catch เพื่อให้ปุ่ม 🐞 เด้ง + ดูได้ว่า ERROR เกิดอะไร/ที่ไหน
window.addEventListener('error', (e) => {
  dbg('❌ JS error: ' + (e.message || (e.error && e.error.message) || 'unknown') +
      (e.filename ? ' @ ' + String(e.filename).split('/').pop() + ':' + e.lineno : ''));
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  dbg('❌ Promise rejected: ' + ((r && (r.message || r)) || 'unknown'));
});

initFirebase_();
dbg('แอปเริ่มทำงาน · html5-qrcode=' + (typeof Html5Qrcode !== 'undefined') +
    ' · getUserMedia=' + !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) +
    ' · HTTPS/secure=' + window.isSecureContext + ' · Firebase=' + firebaseReady);
if (firebaseReady) startHistoryListener_();
renderHistory();
if (firebaseReady && document.querySelector('.tab.active')?.dataset.tab === 'monitor') {
  renderMonitor();
}
