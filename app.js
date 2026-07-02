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
const PHOTO_MAX_BASE64_BYTES = 900 * 1024; // ~900 KB
const PHOTO_MAX_DIMENSION_STEPS = [1000, 800, 600, 450];
const PHOTO_QUALITY_STEPS = [0.7, 0.6, 0.5, 0.45];

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
  const compressedDataUrl = await compressImage_(payload.photoBase64);

  const scanId = doNoInput + '__' + seqId_(parsed.seq);
  const scanRef = db.collection('scans').doc(scanId);
  const scanPhotoRef = db.collection('scanPhotos').doc(scanId);

  // กันสแกนซ้ำแบบ atomic ด้วย transaction (แทน LockService เดิม)
  // เขียนทั้งเอกสาร scan และ scanPhoto พร้อมกันใน transaction เดียว
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
      note: String(payload.note || ''),
      scannedAt: firebase.firestore.FieldValue.serverTimestamp(),
      scannedBy: currentUser_()
    });
    tx.set(scanPhotoRef, {
      dataUrl: compressedDataUrl,
      doNo: doNoInput
    });
  });

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

$('btnPrint').addEventListener('click', () => window.print());

/** วาด QR เป็นแผ่นละ 6 ดวง */
function renderQrSheets(doNo, codes) {
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

// ===================== หน้า 2: สแกนยืนยัน =====================
let currentDO = null;
let qrReader = null;
let pendingScan = null; // {qrData, seq}
let photoData = null;   // {base64, mimeType}
let liveScanning = false; // สถานะกล้องสด (start/stop) ป้องกันเรียกซ้อน

// ===================== DEBUG PANEL =====================
// เขียน log ลงกล่อง #debugLog + console เพื่อวิเคราะห์ปัญหากล้อง/สแกนให้ตรงจุด
// (ตามกฎ CLAUDE.md ชั้น 4 — คงไว้จนกว่าผู้ใช้จะสั่งให้เอาออก)
function dbg(msg) {
  const time = new Date().toTimeString().slice(0, 8);
  const line = '[' + time + '] ' + msg;
  const panel = $('debugLog');
  if (panel) {
    const div = document.createElement('div');
    div.textContent = line;
    panel.appendChild(div);
    panel.scrollTop = panel.scrollHeight;
  }
  try { console.log('[DBG] ' + msg); } catch (_) {}
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
$('btnDbgClear').addEventListener('click', () => { $('debugLog').innerHTML = ''; });

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

$('btnSaveScan').addEventListener('click', async () => {
  if (!photoData) return toast('ต้องถ่ายรูปแนบก่อน', 'error');
  if (!pendingScan) return;
  const btn = $('btnSaveScan');
  const cancelBtn = $('btnCancelScan');
  btn.disabled = true;
  cancelBtn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = '⏳ กำลังบันทึก...';
  busy(true);
  try {
    const info = await saveScan({
      doNo: currentDO,
      qrData: pendingScan.qrData,
      photoBase64: photoData.base64,
      mimeType: photoData.mimeType,
      note: $('scanNote').value.trim()
    });
    toast('บันทึกพาเลท ' + pendingScan.seq + ' แล้ว', 'ok');
    pendingScan = null;
    $('confirmCard').style.display = 'none';
    renderDoSummary(info);
    if (info.scanned >= info.total) toast('🎉 DO ' + info.doNo + ' ส่งครบแล้ว!', 'ok');
  } catch (e) {
    toast(e.message || 'บันทึกไม่สำเร็จ', 'error');
  } finally {
    busy(false);
    btn.disabled = false;
    cancelBtn.disabled = false;
    btn.textContent = originalLabel;
  }
});

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
        note: d.note || '',
        scannedAt: d.scannedAt || null,
        scannedBy: d.scannedBy || ''
      });
    });
    renderMonitor();
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

  // เปิดหน้าต่าง/แท็บใหม่ทันที (ก่อน fetch เสร็จ) เพื่อเลี่ยงปัญหา popup blocker
  const win = window.open('', '_blank');
  if (win) {
    win.document.title = 'รูปพาเลท ' + s.palletNo;
    win.document.body.style.margin = '0';
    win.document.body.style.background = '#111';
    win.document.body.innerHTML =
      '<div style="color:#fff;font-family:sans-serif;padding:24px;text-align:center">กำลังโหลดรูป...</div>';
  }

  const original = thumbEl.textContent;
  thumbEl.textContent = '⏳';

  try {
    const snap = await db.collection('scanPhotos').doc(s.scanId).get();
    if (!snap.exists || !snap.data() || !snap.data().dataUrl) {
      if (win) {
        win.document.body.innerHTML =
          '<div style="color:#fff;font-family:sans-serif;padding:24px;text-align:center">ไม่พบรูปสำหรับรายการนี้</div>';
      } else {
        toast('ไม่พบรูปสำหรับรายการนี้', 'error');
      }
      return;
    }
    const dataUrl = snap.data().dataUrl;
    if (win) {
      win.document.body.innerHTML =
        '<img src="' + dataUrl + '" alt="รูปพาเลท ' + s.palletNo + '" ' +
        'style="display:block;max-width:100%;max-height:100vh;margin:0 auto">';
    } else {
      // popup ถูกบล็อก — แสดงตัวอย่างย่อในที่เดิมแทน
      thumbEl.innerHTML = '';
      const img = document.createElement('img');
      img.className = 'mon-photo-thumb';
      img.src = dataUrl;
      img.alt = 'รูปพาเลท ' + s.palletNo;
      thumbEl.replaceWith(img);
    }
  } catch (e) {
    if (win) {
      win.document.body.innerHTML =
        '<div style="color:#fff;font-family:sans-serif;padding:24px;text-align:center">โหลดรูปไม่สำเร็จ: ' +
        escapeHtml_(e.message || '') + '</div>';
    } else {
      toast('โหลดรูปไม่สำเร็จ: ' + (e.message || ''), 'error');
    }
  } finally {
    if (thumbEl.isConnected) thumbEl.textContent = original;
  }
}

function escapeHtml_(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ===================== เริ่มต้นแอป =====================
initFirebase_();
dbg('แอปเริ่มทำงาน · html5-qrcode=' + (typeof Html5Qrcode !== 'undefined') +
    ' · getUserMedia=' + !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) +
    ' · HTTPS/secure=' + window.isSecureContext + ' · Firebase=' + firebaseReady);
if (firebaseReady && document.querySelector('.tab.active')?.dataset.tab === 'monitor') {
  renderMonitor();
}
