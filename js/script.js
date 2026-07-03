/* ============ DỮ LIỆU MẶC ĐỊNH (load từ file JSON) ============ */

let DEFAULT_CLASSES = [];
let DEFAULT_HOLIDAYS = [];

let CLASSES = [];
let HOLIDAYS = [];
let dataSourceNote = "dữ liệu gốc (snapshot)";

const WD_TOKEN_MAP = { T2: 1, T3: 2, T4: 3, T5: 4, T6: 5, T7: 6, CN: 0 };
const WD_NAMES = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
const WD_SHORT = ["CN", "Th2", "Th3", "Th4", "Th5", "Th6", "Th7"];

function toDate(iso) {
  // iso: 'YYYY-MM-DD' -> local Date at midnight
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function toISO(dt) {
  const y = dt.getFullYear(), m = String(dt.getMonth() + 1).padStart(2, '0'), d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function addDays(dt, n) {
  const nd = new Date(dt);
  nd.setDate(nd.getDate() + n);
  return nd;
}
function fmtDate(dt) {
  const d = String(dt.getDate()).padStart(2, '0'), m = String(dt.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${dt.getFullYear()}`;
}

function parseScheduleDays(lichHoc) {
  if (!lichHoc) return [];
  const tokens = lichHoc.match(/\bT[2-7]\b|\bCN\b/g) || [];
  const set = new Set(tokens.map(t => WD_TOKEN_MAP[t]));
  return Array.from(set);
}

function parseOffDates(str) {
  const out = new Set();
  if (!str) return out;
  String(str).split(',').forEach(p => {
    p = p.trim();
    if (!p) return;
    const parts = p.split('/');
    if (parts.length !== 3) return;
    let [d, m, y] = parts.map(x => parseInt(x, 10));
    if (y < 100) y += 2000;
    out.add(toISO(new Date(y, m - 1, d)));
  });
  return out;
}

function parseHienTai(str, kgDate) {
  if (!str) return null;
  const m = str.match(/Ng[àa]y\s*(\d{1,2})\/(\d{1,2})\s*h[ọo]c\s*bu[ổo]i\s*(\d+)/i);
  if (!m) return null;
  const d = parseInt(m[1], 10), mo = parseInt(m[2], 10), buoi = parseInt(m[3], 10);
  let year = kgDate.getFullYear();
  let dt = new Date(year, mo - 1, d);
  if (dt < kgDate) { year += 1; dt = new Date(year, mo - 1, d); }
  return { date: dt, buoi: buoi };
}

function buildHolidaySet(holidays) {
  const s = new Set();
  holidays.forEach(h => { if (h.date) s.add(h.date); });
  return s;
}

// Generate sessions starting at startDate with startBuoi, up to totalSessions (inclusive), skip weekends not matching + off days
function generateForward(startDate, weekdays, offSet, holidaySet, startBuoi, totalSessions) {
  const sessions = [];
  let buoi = startBuoi;
  let d = new Date(startDate);
  let guard = 0;
  while (buoi <= totalSessions && guard < 5000) {
    guard++;
    if (weekdays.includes(d.getDay())) {
      const iso = toISO(d);
      if (!offSet.has(iso) && !holidaySet.has(iso)) {
        sessions.push({ date: new Date(d), buoi: buoi });
        buoi++;
      }
    }
    d = addDays(d, 1);
  }
  return sessions;
}

function computeClass(cls, holidaySet) {
  const weekdays = parseScheduleDays(cls.lichHoc);
  const offSet = parseOffDates(cls.nghiRieng);
  const kgDate = cls.kgDate ? toDate(cls.kgDate) : null;

  if (cls.soBuoi === null || cls.soBuoi === undefined || !kgDate) {
    return { ...cls, status: 'missing', sessions: [], endDate: null, weekdays };
  }

  if (cls.hienTai) {
    const parsed = parseHienTai(cls.hienTai, kgDate);
    if (!parsed) {
      return { ...cls, status: 'missing', sessions: [], endDate: null, weekdays };
    }
    const total = cls.soBuoi; // không cộng thêm buổi KG cho lớp đang học
    let sessions = [{ date: parsed.date, buoi: parsed.buoi, isCurrent: true }];
    if (parsed.buoi < total) {
      sessions = sessions.concat(
        generateForward(addDays(parsed.date, 1), weekdays, offSet, holidaySet, parsed.buoi + 1, total)
      );
    }
    const endDate = sessions.length ? sessions[sessions.length - 1].date : parsed.date;
    return { ...cls, status: 'progress', sessions, endDate, total, currentBuoi: parsed.buoi, weekdays };
  } else {
    const total = cls.soBuoi + (cls.tangKG ? 1 : 0);
    let sessions = [{ date: kgDate, buoi: 1 }];
    if (total > 1) {
      sessions = sessions.concat(
        generateForward(addDays(kgDate, 1), weekdays, offSet, holidaySet, 2, total)
      );
    }
    const endDate = sessions.length ? sessions[sessions.length - 1].date : kgDate;
    return { ...cls, status: 'upcoming', sessions, endDate, total, weekdays };
  }
}

let COMPUTED = [];
let sortState = { key: 'endDate', dir: 1 };

function recompute() {
  const holidaySet = buildHolidaySet(HOLIDAYS);
  COMPUTED = CLASSES.map(c => computeClass(c, holidaySet));
  render();
}

function statusBadge(status) {
  if (status === 'progress') return '<span class="badge rounded-pill text-bg-primary">Đang học</span>';
  if (status === 'upcoming') return '<span class="badge rounded-pill text-bg-success">Chưa khai giảng</span>';
  return '<span class="badge rounded-pill text-bg-danger">Thiếu dữ liệu</span>';
}

function renderStats() {
  const total = COMPUTED.length;
  const progress = COMPUTED.filter(c => c.status === 'progress').length;
  const upcoming = COMPUTED.filter(c => c.status === 'upcoming').length;
  const missing = COMPUTED.filter(c => c.status === 'missing').length;
  document.getElementById('statsRow').innerHTML = `
    <div class="col"><div class="card card-body"><div class="fs-4 fw-bold">${total}</div><div class="small text-muted">Tổng số lớp</div></div></div>
    <div class="col"><div class="card card-body"><div class="fs-4 fw-bold text-primary">${progress}</div><div class="small text-muted">Đang học</div></div></div>
    <div class="col"><div class="card card-body"><div class="fs-4 fw-bold text-success">${upcoming}</div><div class="small text-muted">Chưa khai giảng</div></div></div>
    <div class="col"><div class="card card-body"><div class="fs-4 fw-bold text-danger">${missing}</div><div class="small text-muted">Thiếu dữ liệu</div></div></div>
  `;
}

function getFiltered() {
  const q = document.getElementById('searchBox').value.trim().toLowerCase();
  const statusF = document.getElementById('statusFilter').value;
  let list = COMPUTED.filter(c => {
    if (q && !c.name.toLowerCase().includes(q)) return false;
    if (statusF !== 'all' && c.status !== statusF) return false;
    return true;
  });
  list.sort((a, b) => {
    let av, bv;
    if (sortState.key === 'endDate') { av = a.endDate ? a.endDate.getTime() : Infinity; bv = b.endDate ? b.endDate.getTime() : Infinity; }
    else if (sortState.key === 'kgDate') { av = a.kgDate ? toDate(a.kgDate).getTime() : 0; bv = b.kgDate ? toDate(b.kgDate).getTime() : 0; }
    else if (sortState.key === 'soBuoi') { av = a.soBuoi || 0; bv = b.soBuoi || 0; }
    else if (sortState.key === 'status') { av = a.status; bv = b.status; }
    else if (sortState.key === 'lichHoc') { av = a.lichHoc || ''; bv = b.lichHoc || ''; }
    else { av = a.name; bv = b.name; }
    if (av < bv) return -1 * sortState.dir;
    if (av > bv) return 1 * sortState.dir;
    return 0;
  });
  return list;
}

function render() {
  renderStats();
  const list = getFiltered();
  const tbody = document.getElementById('tableBody');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">Không có lớp phù hợp bộ lọc.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = list.map((c, idx) => {
    const realIdx = COMPUTED.indexOf(c);
    let midCol;
    if (c.status === 'progress') {
      midCol = `${fmtDate(toDate(c.kgDate))} → hiện tại: <b>${fmtDate(c.sessions[0].date)}</b> (buổi ${c.currentBuoi})`;
    } else if (c.status === 'upcoming') {
      midCol = `Khai giảng: <b>${fmtDate(toDate(c.kgDate))}</b>`;
    } else {
      midCol = c.kgDate ? fmtDate(toDate(c.kgDate)) : '—';
    }
    const soBuoiText = c.soBuoi === null || c.soBuoi === undefined ? '<span class="muted">thiếu</span>' : c.soBuoi + (c.tangKG && c.status === 'upcoming' ? ` <span class="tag">+1 KG</span>` : '');
    const endText = c.endDate ? `<span class="end-date">${fmtDate(c.endDate)}</span>` : '<span class="muted">—</span>';
    const nghiRiengTag = c.nghiRieng ? `<div class="muted" style="margin-top:3px;">Nghỉ riêng: ${c.nghiRieng}</div>` : '';
    return `<tr>
      <td class="name-cell">${c.name}${nghiRiengTag}</td>
      <td>${statusBadge(c.status)}</td>
      <td>${midCol}</td>
      <td class="muted">${c.lichHoc || '—'}</td>
      <td>${soBuoiText}</td>
      <td>${endText}</td>
      <td>${c.sessions && c.sessions.length ? `<button class="btn btn-sm btn-outline-secondary detail-btn" data-idx="${realIdx}">Chi tiết</button>` : ''}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.detail-btn').forEach(btn => {
    btn.addEventListener('click', () => openModal(parseInt(btn.dataset.idx, 10)));
  });
}

const detailModal = new bootstrap.Modal(document.getElementById('detailModal'));

function openModal(idx) {
  const c = COMPUTED[idx];
  document.getElementById('modalTitle').textContent = c.name;
  const total = c.total || c.soBuoi;
  const statusText = c.status === 'progress' ? 'Đang học' : (c.status === 'upcoming' ? 'Chưa khai giảng' : 'Thiếu dữ liệu');
  document.getElementById('modalMeta').innerHTML = `
    Trạng thái: <b>${statusText}</b> · Lịch học: <b>${c.lichHoc || '—'}</b> · Tổng số buổi: <b>${total || '—'}</b><br>
    Ngày kết thúc dự kiến: <b style="color:var(--accent)">${c.endDate ? fmtDate(c.endDate) : '—'}</b>
  `;
  const lastBuoi = c.sessions.length ? c.sessions[c.sessions.length - 1].buoi : null;
  document.getElementById('modalSessions').innerHTML = c.sessions.map(s => {
    const cls = s.buoi === lastBuoi ? 'last-row' : (s.isCurrent ? 'current-row' : '');
    const note = s.buoi === lastBuoi ? 'Buổi kết thúc' : (s.isCurrent ? 'Buổi hiện tại' : '');
    return `<tr class="${cls}"><td>Buổi ${s.buoi}</td><td>${fmtDate(s.date)}</td><td>${WD_SHORT[s.date.getDay()]}</td><td class="muted">${note}</td></tr>`;
  }).join('');
  detailModal.show();
}

document.getElementById('searchBox').addEventListener('input', render);
document.getElementById('statusFilter').addEventListener('change', render);
document.querySelectorAll('th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (sortState.key === key) sortState.dir *= -1; else { sortState.key = key; sortState.dir = 1; }
    render();
  });
});

/* ============ UPLOAD FILE MỚI (SheetJS) ============ */
function excelSerialToISO(serial) {
  // Excel epoch handling via SheetJS date system (1900)
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;
  const dt = new Date(utc_value * 1000);
  return toISO(new Date(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

function cellToISODate(v) {
  if (v instanceof Date) return toISO(v);
  if (typeof v === 'number') return excelSerialToISO(v);
  if (typeof v === 'string') {
    const parts = v.split('/');
    if (parts.length === 3) {
      let [d, m, y] = parts.map(x => parseInt(x, 10));
      if (y < 100) y += 2000;
      return toISO(new Date(y, m - 1, d));
    }
  }
  return null;
}

document.getElementById('fileClasses').addEventListener('change', function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (ev) {
    try {
      const wb = XLSX.read(ev.target.result, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
      const newClasses = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r.every(v => v === null || v === '')) continue;
        const [name, kg, lich, sobuoi, tangkg, hientai, nghirieng] = r;
        if (!name) continue;
        newClasses.push({
          name: String(name).trim(),
          kgDate: cellToISODate(kg),
          lichHoc: lich || '',
          soBuoi: (sobuoi === null || sobuoi === '' || sobuoi === undefined) ? null : Number(sobuoi),
          tangKG: String(tangkg || '').trim().toLowerCase() === 'yes',
          hienTai: hientai || null,
          nghiRieng: nghirieng || null
        });
      }
      CLASSES = newClasses;
      dataSourceNote = `file tải lên "${file.name}"`;
      updateSubtitle();
      recompute();
    } catch (err) {
      alert('Không đọc được file: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
});

document.getElementById('fileHolidays').addEventListener('change', function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (ev) {
    try {
      const wb = XLSX.read(ev.target.result, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
      const newHolidays = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r[0]) continue;
        const iso = cellToISODate(r[0]);
        if (iso) newHolidays.push({ date: iso, desc: r[1] || '' });
      }
      HOLIDAYS = newHolidays;
      updateSubtitle();
      recompute();
    } catch (err) {
      alert('Không đọc được file: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
});

function updateSubtitle() {
  document.getElementById('subtitleInfo').textContent =
    `${CLASSES.length} lớp học · ${HOLIDAYS.length} ngày nghỉ lễ · Nguồn: ${dataSourceNote}`;
}

Promise.all([
  fetch('data/classes.json').then(r => r.json()),
  fetch('data/holidays.json').then(r => r.json())
]).then(([classes, holidays]) => {
  DEFAULT_CLASSES = classes;
  DEFAULT_HOLIDAYS = holidays;
  CLASSES = DEFAULT_CLASSES;
  HOLIDAYS = DEFAULT_HOLIDAYS;
  updateSubtitle();
  recompute();
}).catch(err => {
  console.error('Không tải được dữ liệu mặc định:', err);
});
