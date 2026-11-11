'use strict';
/* ============================================================================
   HMSI-LCMS — Frontend SPA (JavaScript.html)
   Prinsip kinerja (gas-instant-ux):
   1) Semua section dimuat sekali → navigasi instan tanpa google.script.run.
   2) Data disimpan di state lokal (S.data) + snapshot sessionStorage → render 0 ms,
      aksi sederhana memakai UI optimistis & sinkronisasi delta di latar belakang.
   3) Server memakai CacheService berversi; klien hanya menarik tabel yang berubah.
   4) Satu panggilan server per aksi (batch di backend).
   Aman di iframe (gas-spa-iframe): URL tidak pernah berubah, token hanya di memori/
   sessionStorage, tidak ada window.location / ?page=.
   ============================================================================ */

/* ───────────── KONSTANTA ───────────── */
const R = { CORP: 'SHEC_CORPORATE', SITE: 'SHEC_SITE', PIC: 'PIC', PJO: 'PJO', MGT: 'MANAJEMEN' };
const ROLE_LABEL = { SHEC_CORPORATE: 'SHEC Corporate', SHEC_SITE: 'SHEC Site', PIC: 'PIC Departemen', PJO: 'PJO / Area Manager', MANAJEMEN: 'Manajemen Corporate' };
const JENIS = ['ESDM', 'K3', 'Lingkungan', 'SNI', 'SKKNI', 'Ketenagakerjaan', 'Lainnya'];
const BENTUK = ['Undang-Undang', 'Peraturan Pemerintah', 'Peraturan Presiden', 'Peraturan Menteri', 'Keputusan Menteri', 'Keputusan Dirjen', 'Peraturan Daerah', 'Instruksi', 'Surat Edaran', 'SNI', 'SKKNI', 'Standar', 'Lainnya'];
const METODE = ['Pemeriksaan Dokumen', 'Observasi Lapangan', 'Wawancara', 'Pengukuran', 'Uji Laboratorium'];
const HASIL = ['Compliant', 'Non-Compliant', 'Pending', 'N/A'];
const PILL = {
  'Compliant': 'g', 'Non-Compliant': 'r', 'Pending': 'b', 'N/A': 'n', 'Aktif': 'g', 'Mendekati Kedaluwarsa': 'a', 'Kedaluwarsa': 'r', 'Tanpa Masa Berlaku': 'n',
  'Open': 'b', 'Diajukan': 'a', 'Overdue': 'r', 'Closed': 'g', 'Berlaku': 'g', 'Diubah': 'a', 'Dicabut': 'r', 'Menunggu': 'b', 'Disetujui': 'g', 'Ditolak': 'r',
  'Duplikat': 'n', 'Baru': 'g', 'Perubahan': 'a', 'Pencabutan': 'r', 'Draft': 'n', 'Menunggu Verifikasi': 'b', 'Terverifikasi': 'g', 'Berhasil': 'g', 'Sebagian': 'a',
  'Gagal': 'r', 'Belum dicek': 'n', 'Nonaktif': 'n', 'Terkunci': 'r', 'Wajib Ganti PIN': 'a', 'Normal': 'g', 'Archived': 'n', 'Arsip': 'n', 'Menyimpan…': 'o'
};
const WARNA = { g: '#16A34A', r: '#DC2626', a: '#F59E0B', b: '#2563EB', n: '#9CA3AF', o: '#F37321' };
const MENU = [
  { id: 'dashboard', ic: 'dashboard', l: 'Dashboard' },
  { id: 'pencarian', ic: 'travel_explore', l: 'Pencarian Regulasi', roles: [R.CORP], cnt: () => is(R.CORP) ? (S.data.antrean || []).filter(a => a.status === 'Menunggu').length : 0 },
  { id: 'reg1', ic: 'menu_book', l: 'Register Peraturan' },
  { id: 'reg2', ic: 'verified', l: 'Register Izin & Lisensi', cnt: () => D.reg2().filter(r => ['Mendekati Kedaluwarsa', 'Kedaluwarsa'].includes(stIzin(r)) && (!is(R.PIC) || r.pic_nrp === S.me.nrp)).length, cv: 'a' },
  { id: 'evaluasi', ic: 'fact_check', l: 'Evaluasi & RTP', cnt: () => D.rtp().filter(r => stRtp(r) === 'Overdue').length + (is(R.SITE) ? kwBelumEval(periodeAktif()).length : 0), cv: 'r' },
  { id: 'laporan', ic: 'bar_chart', l: 'Laporan', roles: [R.CORP, R.SITE, R.PJO, R.MGT] },
  { sec: 'Administrasi', roles: [R.CORP, R.SITE, R.MGT] },
  { id: 'pengaturan', ic: 'settings', l: 'Pengaturan', sub: 'SHEC Corporate Only', roles: [R.CORP] },
  { id: 'audit', ic: 'history', l: 'Log Audit', roles: [R.CORP, R.SITE, R.MGT] }
];
const SEC_TITLE = {
  dashboard: 'Dashboard Kepatuhan', pencarian: 'Pencarian Regulasi', verifikasi: 'Verifikasi Temuan', reg1: 'Register 1 — Peraturan & Standar',
  reg1d: 'Detail Regulasi', reg2: 'Register 2 — Izin, Lisensi & Sertifikasi', reg2d: 'Detail Izin / Lisensi', evaluasi: 'Register 3 — Evaluasi & RTP',
  evalform: 'Formulir Evaluasi Kepatuhan', laporan: 'Laporan & Ekspor', pengaturan: 'Pengaturan', audit: 'Log Audit'
};
const AKSES_SEC = { pencarian: [R.CORP], verifikasi: [R.CORP], laporan: [R.CORP, R.SITE, R.PJO, R.MGT], pengaturan: [R.CORP], audit: [R.CORP, R.SITE, R.MGT] };
const MENU_INDUK = { verifikasi: 'pencarian', reg1d: 'reg1', reg2d: 'reg2', evalform: 'evaluasi' };

/* ───────────── UTIL ───────────── */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (n, c) => `<span class="ms ${c || ''}" aria-hidden="true">${n}</span>`;
const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
function fmtTgl(s) { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${+m[3]} ${BLN[+m[2] - 1]} ${m[1]}` : (s || '–'); }
function fmtWkt(s) { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/); return m ? `${+m[3]} ${BLN[+m[2] - 1]} ${m[1]}, ${m[4]}:${m[5]}` : fmtTgl(s); }
function isoLokal(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function today() { return S.hariIni || isoLokal(new Date()); }
function dUTC(s) { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; }
function selisih(a, b) { const x = dUTC(a), y = dUTC(b); return x == null || y == null ? null : Math.round((y - x) / 864e5); }
function addDays(s, n) { return new Date(dUTC(s) + n * 864e5).toISOString().slice(0, 10); }
const nf = n => Number(n || 0).toLocaleString('id-ID');
const pct = (a, b) => b > 0 ? Math.round(a / b * 1000) / 10 : null;
const fpct = v => v == null ? '–' : String(v).replace('.', ',') + '%';
function ukuran(b) { b = Number(b || 0); return b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
function inisial(n) { return String(n || '?').replace(/^(ir|dr|drs)\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase(); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const uid = p => (p || 'tmp') + '-' + Math.random().toString(36).slice(2, 9);
function labelPeriode(p) { const m = String(p || '').match(/^(\d{4})-S([12])$/); return m ? `Semester ${m[2] === '1' ? 'I' : 'II'} ${m[1]}` : (p || '–'); }
function autoPeriode() { const d = new Date(); return d.getFullYear() + (d.getMonth() < 6 ? '-S1' : '-S2'); }
function periodeSebelum(p, n) { let [y, s] = p.split('-S').map(Number); for (let i = 0; i < n; i++) { if (s === 2) s = 1; else { s = 2; y--; } } return y + '-S' + s; }
function lsGet(k, d) { try { const v = localStorage.getItem('lcms_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem('lcms_' + k, JSON.stringify(v)); } catch (e) { /* storage diblokir */ } }
function ssGet(k) { try { return sessionStorage.getItem('lcms_' + k); } catch (e) { return null; } }
function ssSet(k, v) { try { if (v == null) sessionStorage.removeItem('lcms_' + k); else sessionStorage.setItem('lcms_' + k, v); } catch (e) { /* abaikan */ } }
const cari = (q, ...xs) => !q || xs.join(' ').toLowerCase().includes(q.toLowerCase());
const opsi = (arr, v) => arr.map(o => { const [a, b] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(a)}" ${String(a) === String(v) ? 'selected' : ''}>${esc(b)}</option>`; }).join('');

/* ───────────── STATE ───────────── */
const S = {
  token: null, me: null, data: {}, ver: {}, cfg: {}, stat: {}, hariIni: null, periodeAktif: null, idx: null, loaded: false,
  ui: { sec: 'dashboard', params: {}, hist: [], site: lsGet('site', 'ALL'), tbl: {}, tab: {}, sel: {}, dash: { donut: 'izin', periode: '', dept: 'ALL' }, cari: null, drawer: null, ef: null },
  lastAct: Date.now(), charts: {}
};
const cfg = (k, d) => (S.cfg[k] === undefined || S.cfg[k] === '') ? d : S.cfg[k];
const ambang = () => Number(cfg('ambang_hari', 90));
const target = () => Number(cfg('target_kepatuhan', 90));
const periodeAktif = () => S.periodeAktif || cfg('periode_aktif', '') || autoPeriode();
function buildCfg() { const c = {}; (S.data.config || []).forEach(r => { c[r.key] = r.value; }); S.cfg = c; }

/* ───────────── INDEKS & TURUNAN ───────────── */
function I() {
  if (S.idx) return S.idx;
  const d = S.data;
  const by = (a, k) => { const m = {}; (a || []).forEach(r => { m[r[k]] = r; }); return m; };
  const grp = (a, f) => { const m = {}; (a || []).forEach(r => { const k = typeof f === 'function' ? f(r) : r[f]; (m[k] = m[k] || []).push(r); }); return m; };
  S.idx = {
    user: by(d.users, 'nrp'), site: by(d.sites, 'kode'), dept: by(d.departemen, 'kode'), reg1: by(d.reg1, 'id_reg1'), kw: by(d.kewajiban, 'id_kewajiban'),
    kwByReg1: grp((d.kewajiban || []).filter(k => k.status_aktif !== 'Archived'), 'id_reg1'), reg2: by(d.reg2, 'id_izin'), ppj: grp(d.perpanjangan, 'id_izin'),
    ev: by(d.evaluasi, 'id_evaluasi'), rtp: by(d.rtp, 'id_rtp'), rtpByEv: grp((d.rtp || []).filter(r => r.status_aktif !== 'Archived'), 'id_evaluasi'),
    prog: grp(d.progres, 'id_rtp'), lamp: grp((d.lampiran || []).filter(l => l.status_aktif !== 'Archived'), l => l.entitas + '|' + l.id_entitas),
    ant: by(d.antrean, 'id_antrean'), portal: by(d.portal, 'id'), notif: new Set((d.notif || []).map(n => n.kunci)),
    smkp: by(d.smkp, 'id_smkp'), smkpByKode: by(d.smkp, 'kode_sub')
  };
  return S.idx;
}
/** Opsi "checks" semua elemen SMKP aktif, diurutkan elemen→kode (dipakai form verifikasi & Register 1). */
function smkpOpts() { return (S.data.smkp || []).filter(aktif).sort((a, b) => a.kode_sub.localeCompare(b.kode_sub, undefined, { numeric: true })).map(e => [e.kode_sub, `${e.kode_sub} — ${e.nama_sub_elemen}`]); }
/** Badge-badge elemen SMKP dari string koma kode_sub, dengan nama sub-elemen bila dikenal. */
function smkpBadges(csv, cls) {
  const kodes = String(csv || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!kodes.length) return '';
  return `<div class="row wrap" style="gap:4px">${kodes.map(k => { const e = I().smkpByKode[k]; return pill(e ? `${k} ${e.nama_sub_elemen}` : k, cls || 'b', false); }).join('')}</div>`;
}
const namaUser = n => (I().user[n] || {}).nama || n || '–';
const namaSite = k => !k || k === 'ALL' ? 'Semua Site' : String(k).split(',').map(x => (I().site[x.trim()] || {}).nama || x).join(', ');
const namaDept = k => !k ? '–' : String(k).split(',').map(x => (I().dept[x.trim()] || {}).nama || x).join(', ');
const aktif = r => r && r.status_aktif !== 'Archived';
function sisaHari(exp) { return exp ? selisih(today(), exp) : null; }
function stIzin(r) { const s = sisaHari(r.tanggal_kedaluwarsa); if (s == null) return 'Tanpa Masa Berlaku'; if (s < 0) return 'Kedaluwarsa'; if (s <= ambang()) return 'Mendekati Kedaluwarsa'; return 'Aktif'; }
function stRtp(r) { if (r.status_rtp === 'Closed') return 'Closed'; if (r.due_date && r.due_date < today()) return 'Overdue'; return r.status_rtp || 'Open'; }
function judulReg(r) { return r ? `${r.bentuk_peraturan || r.jenis_peraturan || ''} No. ${r.nomor || '–'} Tahun ${r.tahun || '–'}`.trim() : '–'; }
function lampiran(ent, id) { return I().lamp[ent + '|' + id] || []; }

/* ───────────── PERAN & CAKUPAN ───────────── */
const is = (...r) => !!S.me && r.includes(S.me.role);
function mySites() { const u = S.me; if (!u || is(R.CORP, R.MGT)) return null; const s = String(u.site || '').trim(); if (!s || s.toUpperCase() === 'ALL') return null; return s.split(',').map(x => x.trim()).filter(Boolean); }
function inMySites(v) { const sc = mySites(); if (!sc) return true; const x = String(v || '').trim(); if (!x || x.toUpperCase() === 'ALL') return true; return x.split(',').some(y => sc.includes(y.trim())); }
function siteOk(v) { const g = S.ui.site; if (!g || g === 'ALL') return true; const x = String(v || '').trim(); if (!x || x.toUpperCase() === 'ALL') return true; return x.split(',').map(s => s.trim()).includes(g); }
function siteList() { const sc = mySites(); return (S.data.sites || []).filter(s => s.status === 'Aktif' && (!sc || sc.includes(s.kode))); }
const deptList = () => (S.data.departemen || []).filter(d => d.status === 'Aktif');
const can = {
  reg1: () => is(R.CORP),
  usul: () => is(R.CORP, R.SITE),
  verif: () => is(R.CORP),
  reg2Tambah: () => is(R.CORP, R.SITE),
  reg2Edit: r => is(R.CORP) || (is(R.SITE) && inMySites(r.site)) || (is(R.PIC) && r.pic_nrp === S.me.nrp),
  reg2Arsip: r => is(R.CORP) || (is(R.SITE) && inMySites(r.site)),
  evalTambah: () => is(R.SITE),
  evalEdit: e => (is(R.CORP) || (is(R.SITE) && inMySites(e.site))) && e.status_verifikasi !== 'Terverifikasi' && aktif(e),
  evalVerif: e => is(R.CORP) && e.status_verifikasi === 'Menunggu Verifikasi' && e.evaluator_nrp !== S.me.nrp,
  rtpEdit: r => (is(R.CORP) || (is(R.SITE) && inMySites(r.site))) && r.status_rtp !== 'Closed',
  rtpProgres: r => r.status_rtp !== 'Closed' && (is(R.CORP) || (is(R.SITE) && inMySites(r.site)) || r.pic_nrp === S.me.nrp),
  rtpAjukan: r => r.pic_nrp === S.me.nrp && !['Closed', 'Diajukan'].includes(r.status_rtp),
  rtpVerif: r => (is(R.CORP) || (is(R.SITE) && inMySites(r.site))) && r.pic_nrp !== S.me.nrp && r.status_rtp !== 'Closed'
};
const D = {
  reg1: () => (S.data.reg1 || []).filter(r => siteOk(r.site_berlaku)),
  reg2: () => (S.data.reg2 || []).filter(r => aktif(r) && siteOk(r.site)),
  ev: per => (S.data.evaluasi || []).filter(e => aktif(e) && siteOk(e.site) && (!per || e.periode === per)),
  rtp: () => (S.data.rtp || []).filter(r => aktif(r) && siteOk(r.site)),
  antrean: () => S.data.antrean || [],
  kw: () => (S.data.kewajiban || []).filter(k => aktif(k) && siteOk(k.site_berlaku))
};
/** Kewajiban aktif (dalam cakupan site) yang belum punya evaluasi sama sekali pada periode tertentu. */
function kwBelumEval(per) { return D.kw().filter(k => !D.ev(per).some(e => e.id_kewajiban === k.id_kewajiban)); }

/* ───────────── API (satu pintu ke server) ───────────── */
function pesanJaringan(err) {
  const m = String((err && err.message) || err || '');
  if (/NetworkError|Failed to fetch|network|ERR_|Connection/i.test(m)) return 'Koneksi ke server terputus. Periksa jaringan Anda lalu coba lagi.';
  if (/Authorization|PERMISSION|izin/i.test(m)) return 'Server menolak permintaan (izin). Hubungi administrator.';
  return m || 'Terjadi kesalahan tak terduga.';
}
/* Konfigurasi: hanya URL /exec (publik). Placeholder ditolak. */
function gasUrl() {
  const u = (window.APP_CONFIG && window.APP_CONFIG.GAS_URL) || '';
  if (!/^https:\/\/script\.google\.com\//.test(u) || /GANTI|XXXX/.test(u)) return '';
  return u;
}
/* Deduplikasi permintaan baca yang identik & sedang berjalan (gas-scale-turbo) */
const _inflight = {};
let _tulisEpoch = 0;
const AKSI_BACA = /^(data\.sync|auth\.info|auth\.ping|auth\.me)$/;
function kirimHttp(action, data) {
  const url = gasUrl();
  if (!url) return Promise.reject(new Error('Konfigurasi belum lengkap: isi GAS_URL di js/config.js dengan URL Web App (/exec).'));
  const t0 = performance.now();
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // WAJIB: hindari preflight CORS
    body: JSON.stringify({ action: action, token: S.token, data: data || {} }),
    redirect: 'follow', credentials: 'omit'
  }).then(r => {
    if (!r.ok) throw new Error('Server mengembalikan status ' + r.status + '.');
    return r.json();
  }).then(res => { res._rtt = Math.round(performance.now() - t0); S.rtt = res._rtt; return res; });
}
function api(action, data) {
  const baca = AKSI_BACA.test(action);
  let key = null;
  if (baca) { key = _tulisEpoch + '|' + action + '|' + JSON.stringify(data || {}); if (_inflight[key]) return _inflight[key]; }
  else _tulisEpoch++;
  const p = kirimHttp(action, data).then(res => {
    if (!res) throw new Error('Respons server kosong.');
    if (!res.success) {
      const e = new Error(res.message || 'Permintaan gagal.'); e.code = res.code; e.res = res;
      if (res.code === 'SESI_HABIS' && action !== 'auth.login') sesiHabis(res.message);
      if (res.code === 'WAJIB_GANTI_PIN') layarGantiPin(true);
      throw e;
    }
    return res;
  }, err => { throw (err && err.code) ? err : new Error(pesanJaringan(err)); });
  if (key) { _inflight[key] = p; const bersih = () => { delete _inflight[key]; }; p.then(bersih, bersih); }
  return p;
}

/* ───────────── SINKRONISASI (delta berversi) ───────────── */
let syncJalan = null, syncLagi = false, syncTimer = null;
function setSyncDot(busy, teks) {
  const d = $('#syncDot'); if (!d) return;
  d.classList.remove('hide'); d.classList.toggle('busy', !!busy); $('#syncTx').textContent = teks || (busy ? 'Menyinkronkan…' : 'Tersinkron');
}
function sync(paksa) {
  if (!S.token) return Promise.resolve();
  if (syncJalan) { syncLagi = true; return syncJalan; }
  setSyncDot(true);
  syncJalan = api('data.sync', { ver: paksa ? {} : S.ver, paksa: !!paksa })
    .then(res => { terapkanSync(res.data); setSyncDot(false, 'Tersinkron ' + new Date().toTimeString().slice(0, 5)); })
    .catch(e => { setSyncDot(false, 'Gagal sinkron'); if (!['SESI_HABIS', 'WAJIB_GANTI_PIN'].includes(e.code)) { if (!S.loaded) layarGagalMuat(e.message); else toast(e.message, 'warning', 'Sinkronisasi tertunda'); } throw e; })
    .finally(() => { syncJalan = null; if (syncLagi) { syncLagi = false; sync().catch(() => { }); } });
  return syncJalan;
}
function jadwalSync(ms) { clearTimeout(syncTimer); syncTimer = setTimeout(() => sync().catch(() => { }), ms == null ? 400 : ms); }
function terapkanSync(d) {
  const ada = Object.keys(d.data || {});
  ada.forEach(k => { S.data[k] = d.data[k]; });
  S.ver = d.ver || S.ver; S.me = d.me || S.me; S.stat = d.stat || {}; S.hariIni = d.hariIni; S.periodeAktif = d.periodeAktif;
  if (d.data && d.data.config) buildCfg();
  const awal = !S.loaded;
  S.loaded = true;
  if (ada.length || awal) { S.idx = null; simpanSnapshot(); }
  renderChrome();
  if (awal) go(lsGet('sec', 'dashboard'), {}, false);
  else if (ada.length) rerender(true);
}
const simpanSnapshot = debounce(() => {
  try { const s = JSON.stringify({ me: S.me, data: S.data, ver: S.ver, stat: S.stat, hariIni: S.hariIni, periodeAktif: S.periodeAktif }); if (s.length < 4.5e6) ssSet('snap', s); } catch (e) { /* abaikan */ }
}, 800);
function muatSnapshot() {
  try { const s = ssGet('snap'); if (!s) return false; const o = JSON.parse(s); Object.assign(S, { me: o.me, data: o.data || {}, ver: o.ver || {}, stat: o.stat || {}, hariIni: o.hariIni, periodeAktif: o.periodeAktif }); buildCfg(); S.idx = null; S.loaded = true; return true; } catch (e) { return false; }
}

/* ───────────── MUTASI OPTIMISTIS ───────────── */
/**
 * apply(): ubah state lokal & kembalikan fungsi undo → UI berubah 0 ms.
 * Server dipanggil di latar; gagal = rollback + toast. Sukses = sinkron delta.
 */
async function kirim(action, data, o) {
  o = o || {};
  let undo = null;
  if (o.apply) { undo = o.apply(); S.idx = null; rerender(true); }
  if (o.btn) busy(o.btn, true, o.txt);
  try {
    const res = await api(action, data);
    if (o.sukses) o.sukses(res);
    S.idx = null;
    if (!o.diam) toast(res.message, 'success');
    jadwalSync(300);
    return res;
  } catch (e) {
    if (undo) { undo(); S.idx = null; rerender(true); }
    if (o.gagal) o.gagal(e);
    if (!['SESI_HABIS', 'WAJIB_GANTI_PIN'].includes(e.code)) toast(e.message, 'error', o.judulGagal || 'Gagal disimpan');
    throw e;
  } finally { if (o.btn && document.body.contains(o.btn)) busy(o.btn, false); }
}
function upsert(key, idk, rec) {
  const arr = S.data[key] || (S.data[key] = []);
  const i = arr.findIndex(r => r[idk] === rec[idk]);
  const prev = i >= 0 ? arr[i] : null;
  if (i >= 0) arr[i] = Object.assign({}, arr[i], rec); else arr.unshift(rec);
  return () => { const j = arr.findIndex(r => r[idk] === rec[idk]); if (prev) arr[j] = prev; else if (j >= 0) arr.splice(j, 1); };
}
function gantiId(key, idk, lama, rec) { const arr = S.data[key] || []; const i = arr.findIndex(r => r[idk] === lama); if (i >= 0) arr[i] = rec; else arr.unshift(rec); }

/* ───────────── KOMPONEN UI ───────────── */
function pill(t, v, ikon) {
  const k = v || PILL[t] || 'n';
  const i = ikon !== false && (k === 'r' || k === 'a') ? ic(k === 'r' ? 'error' : 'warning') : (ikon && ikon !== true ? ic(ikon) : '');
  return `<span class="pill ${k}">${i}${esc(t)}</span>`;
}
function busy(btn, on, txt) {
  if (!btn) return;
  if (on) { btn.dataset.h = btn.innerHTML; btn.classList.add('busy'); btn.innerHTML = `<span class="spin s ${/\b(p|d|gn)\b/.test(btn.className) ? 'w' : ''}"></span> ${esc(txt || 'Memproses…')}`; }
  else { btn.classList.remove('busy'); if (btn.dataset.h) btn.innerHTML = btn.dataset.h; }
}
function toast(msg, type, judul) {
  type = type || 'info';
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = ic({ success: 'check_circle', error: 'error', warning: 'warning', info: 'info' }[type] || 'info', 'f') + `<div class="tx">${judul ? `<b>${esc(judul)}</b>` : ''}${esc(msg)}</div><button class="xbtn" style="width:24px;height:24px;margin:-2px -4px 0 0" aria-label="Tutup notifikasi">${ic('close', 's')}</button>`;
  const hapus = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
  el.querySelector('button').onclick = hapus;
  $('#toasts').appendChild(el);
  setTimeout(hapus, type === 'error' ? 7500 : 4200);
}
function modal(o) {
  const root = $('#mroot');
  root.innerHTML = `<div class="ovl"><div class="mdl ${o.size || ''}" role="dialog" aria-modal="true" aria-labelledby="mdlT">
    <div class="mdl-h"><div class="ic ${o.icCls || ''}">${ic(o.icon || 'edit_note')}</div><div style="min-width:0"><h3 id="mdlT">${esc(o.title)}</h3>${o.sub ? `<p>${esc(o.sub)}</p>` : ''}</div>
    <button class="xbtn" data-act="mclose" aria-label="Tutup">${ic('close')}</button></div>
    <div class="mdl-b" id="mdlB">${o.body || ''}</div>${o.foot ? `<div class="mdl-f" id="mdlF">${o.foot}</div>` : ''}</div></div>`;
  S.ui.modalTutup = o.onClose || null;
  const ovl = root.firstChild;
  ovl.addEventListener('mousedown', e => { if (e.target === ovl && o.dismiss !== false) tutupModal(); });
  setTimeout(() => { const f = root.querySelector('.mdl-b input:not([type=hidden]):not([readonly]):not([type=checkbox]),.mdl-b select,.mdl-b textarea') || root.querySelector('.mdl-f .btn.p'); if (f) f.focus(); }, 40);
  return root.querySelector('.mdl');
}
function tutupModal() { $('#mroot').innerHTML = ''; const cb = S.ui.modalTutup; S.ui.modalTutup = null; if (cb) cb(); }
function konfirmasi(o) {
  return new Promise(res => {
    const root = $('#croot');
    root.innerHTML = `<div class="ovl" style="z-index:95"><div class="mdl sm" role="alertdialog" aria-modal="true" aria-labelledby="cfT">
      <div class="mdl-h"><div class="ic ${o.danger ? 'r' : ''}">${ic(o.icon || (o.danger ? 'warning' : 'help'))}</div><div><h3 id="cfT">${esc(o.title)}</h3>${o.msg ? `<p>${esc(o.msg)}</p>` : ''}</div></div>
      ${o.alasan ? `<div class="mdl-b"><div class="fld"><label for="cfAl">${esc(o.alasanLabel || 'Alasan')}${o.wajib !== false ? '<span class="rq">*</span>' : ''}</label><textarea class="inp" id="cfAl" rows="3" maxlength="1000"></textarea><div class="ferr hide" id="cfErr">${ic('error')} Wajib diisi.</div></div></div>` : ''}
      <div class="mdl-f"><button class="btn gh" id="cfNo">Batal</button><button class="btn ${o.danger ? 'd' : 'p'}" id="cfOk">${esc(o.ok || 'Ya, lanjutkan')}</button></div></div></div>`;
    const selesai = v => { root.innerHTML = ''; res(v); };
    S.ui.cfBatal = () => selesai(false);
    $('#cfNo').onclick = () => selesai(false);
    $('#cfOk').onclick = () => {
      if (o.alasan) { const v = $('#cfAl').value.trim(); if (o.wajib !== false && !v) { $('#cfErr').classList.remove('hide'); $('#cfAl').classList.add('err'); $('#cfAl').focus(); return; } selesai(v || '-'); }
      else selesai(true);
    };
    setTimeout(() => (o.alasan ? $('#cfAl') : $('#cfOk')).focus(), 40);
  });
}
function bukaDrawer(fnRender) { S.ui.drawer = fnRender; renderDrawer(); }
function renderDrawer() { if (!S.ui.drawer) return; const html = S.ui.drawer(); if (html == null) { tutupDrawer(); return; } const sc = $('.drw-b') ? $('.drw-b').scrollTop : 0; $('#droot').innerHTML = `<div class="drw-ovl" data-act="dclose"></div><aside class="drw" role="dialog" aria-modal="true">${html}</aside>`; if ($('.drw-b')) $('.drw-b').scrollTop = sc; }
function tutupDrawer() { $('#droot').innerHTML = ''; S.ui.drawer = null; }
function popMenu(anchor, html, cls) {
  tutupMenu();
  const r = anchor.getBoundingClientRect();
  const m = document.createElement('div');
  m.className = 'menu ' + (cls || ''); m.id = 'popm'; m.innerHTML = html;
  document.body.appendChild(m);
  const w = m.offsetWidth;
  m.style.top = Math.min(window.innerHeight - m.offsetHeight - 8, r.bottom + 6) + 'px';
  m.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
}
function tutupMenu() { const m = $('#popm'); if (m) m.remove(); }
function kosong(ikon, judul, teks, aksi) { return `<div class="empty"><div class="eic">${ic(ikon)}</div><b>${esc(judul)}</b>${teks ? `<p>${esc(teks)}</p>` : ''}${aksi || ''}</div>`; }
function skeleton() {
  return `<div class="sk sk-h"></div><div class="grid g6 kpis mt16">${'<div class="sk sk-c"></div>'.repeat(6)}</div><div class="grid g-73 mt16"><div class="sk" style="height:320px"></div><div class="sk" style="height:320px"></div></div>`;
}
function kpi(o) {
  return `<div class="kpi ${o.l ? 'l-' + o.l : ''} ${o.act ? 'click' : ''} ${o.sel ? 'sel' : ''}" ${o.act ? `data-act="${o.act}" data-v="${esc(o.v || '')}" ${o.sec ? `data-sec="${o.sec}"` : ''} role="button" tabindex="0"` : ''}>
    <div class="kpi-h"><div class="kpi-l">${esc(o.label)}</div>${o.icon ? `<div class="kpi-ic ${o.ic || ''}">${ic(o.icon, 's')}</div>` : ''}</div>
    <div class="kpi-v ${o.vc || ''}">${o.value}${o.unit ? `<small>${esc(o.unit)}</small>` : ''}</div>${o.sub ? `<div class="kpi-s">${o.sub}</div>` : ''}</div>`;
}
function hdr(o) {
  const cr = (o.crumbs || []).map((c, i, a) => i === a.length - 1 ? `<span class="cur">${esc(c[0])}</span>` : `<a data-act="go" data-sec="${c[1]}">${esc(c[0])}</a>${ic('chevron_right', 'xs')}`).join('');
  return `<div class="ph"><div class="ph-t">${cr ? `<div class="crumbs">${cr}</div>` : ''}<h1>${o.title}${o.tag ? ` <span class="tag">${esc(o.tag)}</span>` : ''}</h1>${o.sub ? `<p>${o.sub}</p>` : ''}</div>${o.actions ? `<div class="ph-a">${o.actions}</div>` : ''}</div>`;
}

/* Tabel generik dengan paging (state per id tabel) */
function tst(id, def) { return S.ui.tbl[id] || (S.ui.tbl[id] = Object.assign({ q: '', page: 1, per: lsGet('per', 10) }, def || {})); }
function tabel(id, o) {
  const st = tst(id);
  const rows = o.rows || [];
  const per = st.per, pages = Math.max(1, Math.ceil(rows.length / per));
  if (st.page > pages) st.page = pages;
  const view = o.semua ? rows : rows.slice((st.page - 1) * per, st.page * per);
  const sel = o.pilih ? (S.ui.sel[id] || (S.ui.sel[id] = new Set())) : null;
  const head = (o.pilih ? `<th style="width:36px"><input type="checkbox" data-act="selall" data-t="${id}" aria-label="Pilih semua" ${view.length && view.every(r => sel.has(r[o.key])) ? 'checked' : ''}></th>` : '') + o.cols.map(c => `<th class="${c.cls || ''}" style="${c.w ? 'width:' + c.w : ''}">${esc(c.l)}</th>`).join('');
  const body = view.map(r => {
    const attr = o.rowAct ? `class="clk ${o.rowCls ? o.rowCls(r) : ''} ${sel && sel.has(r[o.key]) ? 'sel' : ''}" data-act="${o.rowAct}" data-id="${esc(r[o.key])}" tabindex="0"` : `class="${o.rowCls ? o.rowCls(r) : ''} ${sel && sel.has(r[o.key]) ? 'sel' : ''}"`;
    return `<tr ${attr}>${o.pilih ? `<td data-l=""><input type="checkbox" data-act="sel1" data-t="${id}" data-id="${esc(r[o.key])}" ${sel.has(r[o.key]) ? 'checked' : ''} aria-label="Pilih baris"></td>` : ''}${o.cols.map(c => `<td class="${c.cls || ''}" data-l="${esc(c.l)}">${c.r(r)}</td>`).join('')}</tr>`;
  }).join('');
  const kos = !rows.length ? `<tr><td colspan="${o.cols.length + (o.pilih ? 1 : 0)}" data-l="">${o.empty || kosong('search_off', 'Tidak ada data', 'Ubah kata kunci atau filter untuk melihat data lain.')}</td></tr>` : '';
  const a = rows.length ? (st.page - 1) * per + 1 : 0, b = Math.min(rows.length, st.page * per);
  let nums = [];
  for (let p = 1; p <= pages; p++) if (p === 1 || p === pages || Math.abs(p - st.page) <= 1) nums.push(p); else if (nums[nums.length - 1] !== '…') nums.push('…');
  const pg = o.semua || rows.length <= 5 && pages === 1 ? '' : `<div class="pg"><span>Menampilkan <b>${a}–${b}</b> dari <b>${nf(rows.length)}</b> ${esc(o.unit || 'data')}</span><span class="sp"></span>
    <label class="row small">Baris <select data-ch="per" data-t="${id}" aria-label="Baris per halaman">${opsi([5, 10, 25, 50, 100], per)}</select></label>
    <button data-act="page" data-t="${id}" data-p="${st.page - 1}" ${st.page <= 1 ? 'disabled' : ''} aria-label="Sebelumnya">${ic('chevron_left', 's')}</button>
    ${nums.map(p => p === '…' ? '<span>…</span>' : `<button data-act="page" data-t="${id}" data-p="${p}" class="${p === st.page ? 'on' : ''}">${p}</button>`).join('')}
    <button data-act="page" data-t="${id}" data-p="${st.page + 1}" ${st.page >= pages ? 'disabled' : ''} aria-label="Berikutnya">${ic('chevron_right', 's')}</button></div>`;
  const bulk = sel && sel.size && o.bulk ? `<div class="bulk"><b>${sel.size}</b> dipilih <span class="sp"></span>${o.bulk}<button class="btn sm gh" data-act="selclear" data-t="${id}">Batal pilih</button></div>` : '';
  return `${bulk}<div class="tblw"><table class="tbl ${o.kartu === false ? '' : 'cards'}"><thead><tr>${head}</tr></thead><tbody>${body}${kos}</tbody></table></div>${pg}`;
}

/* ───────────── FORM ───────────── */
function fld(f) {
  const id = 'f_' + f.n + (f.sfx || '');
  const v = f.v == null ? '' : f.v;
  const lab = f.l ? `<label for="${id}">${esc(f.l)}${f.req ? '<span class="rq">*</span>' : ''}</label>` : '';
  const rq = f.req ? 'required' : '';
  let c;
  if (f.t === 'select') c = `<select class="inp" id="${id}" name="${f.n}" ${rq} ${f.ro ? 'disabled' : ''} ${f.ch ? `data-ch="${f.ch}"` : ''}>${f.ph === false ? '' : `<option value="">${esc(f.ph || '— Pilih —')}</option>`}${opsi(f.opts || [], v)}</select>`;
  else if (f.t === 'textarea') c = `<textarea class="inp" id="${id}" name="${f.n}" rows="${f.rows || 3}" ${rq} ${f.ro ? 'readonly' : ''} maxlength="${f.max || 3000}" placeholder="${esc(f.ph || '')}">${esc(v)}</textarea>`;
  else if (f.t === 'checks') { const s = String(v || '').split(',').map(x => x.trim()); c = `<div class="cbgrid" data-checks="${f.n}" id="${id}" ${f.req ? 'data-req="1"' : ''}>${(f.opts || []).map(o => { const [a, b] = Array.isArray(o) ? o : [o, o]; return `<label class="cbx"><input type="checkbox" value="${esc(a)}" ${s.includes(String(a)) ? 'checked' : ''} ${f.ro ? 'disabled' : ''}> ${esc(b)}</label>`; }).join('')}</div>`; }
  else if (f.t === 'toggle') c = `<label class="row" style="gap:10px;min-height:36px"><span class="tgl"><input type="checkbox" name="${f.n}" id="${id}" ${v === true || v === 'TRUE' || v === 'Aktif' ? 'checked' : ''}><span></span></span><span class="small muted2">${esc(f.tl || '')}</span></label>`;
  else c = `<input class="inp" id="${id}" name="${f.n}" type="${f.t || 'text'}" value="${esc(v)}" ${rq} ${f.ro ? 'readonly' : ''} ${f.min != null ? `min="${f.min}"` : ''} ${f.maxv != null ? `max="${f.maxv}"` : ''} maxlength="${f.max || 500}" placeholder="${esc(f.ph || '')}" ${f.im ? `inputmode="${f.im}"` : ''} autocomplete="off">`;
  return `<div class="fld ${f.full ? 'full' : ''}" data-f="${f.n}">${lab}${c}${f.help ? `<div class="help">${esc(f.help)}</div>` : ''}<div class="ferr hide"></div></div>`;
}
function bacaForm(root) {
  const o = {};
  $$('[name]', root).forEach(el => { if (el.type === 'checkbox') o[el.name] = el.checked; else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; } else o[el.name] = String(el.value || '').trim(); });
  $$('[data-checks]', root).forEach(g => { o[g.dataset.checks] = $$('input:checked', g).map(i => i.value).join(','); });
  return o;
}
function setErr(root, n, msg) {
  const w = root.querySelector(`[data-f="${n}"]`); if (!w) return;
  const e = w.querySelector('.ferr'), inp = w.querySelector('.inp');
  if (msg) { e.innerHTML = ic('error') + ' ' + esc(msg); e.classList.remove('hide'); if (inp) inp.classList.add('err'); }
  else { e.classList.add('hide'); if (inp) inp.classList.remove('err'); }
}
const RX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function validasi(root, ekstra) {
  let ok = true, pertama = null;
  $$('[data-f]', root).forEach(w => setErr(root, w.dataset.f, null));
  const tandai = (n, m, el) => { setErr(root, n, m); ok = false; pertama = pertama || el || root.querySelector(`[name="${n}"]`); };
  $$('[required]', root).forEach(el => { if (!String(el.value || '').trim()) tandai(el.name, 'Wajib diisi.', el); });
  $$('[data-checks][data-req]', root).forEach(g => { if (!$$('input:checked', g).length) tandai(g.dataset.checks, 'Pilih minimal satu.', g.querySelector('input')); });
  $$('input[type=email]', root).forEach(el => { if (el.value.trim() && !RX_EMAIL.test(el.value.trim())) tandai(el.name, 'Format email tidak valid.', el); });
  $$('input[type=url]', root).forEach(el => { if (el.value.trim() && !/^https?:\/\//i.test(el.value.trim())) tandai(el.name, 'Harus diawali http:// atau https://', el); });
  if (ekstra) { const ex = ekstra(bacaForm(root)) || {}; Object.keys(ex).forEach(k => { if (ex[k]) tandai(k, ex[k]); }); }
  if (pertama && pertama.focus) pertama.focus();
  return ok;
}

/* ───────────── BERKAS: unggah, pratinjau, unduh ───────────── */
const MIME_OK = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx' };
/** Berkas PDF yang dipilih sementara di form "Usulkan Regulasi" sebelum id_antrean ada; diunggah segera setelah usulan terkirim. */
let _usulBerkas = null;
function b64Blob(b64, mime) { const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return new Blob([u8], { type: mime }); }
function unduhBlob(blob, nama) { const a = document.createElement('a'); const url = URL.createObjectURL(blob); a.href = url; a.download = nama; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 6000); }
function fileB64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('Gagal membaca berkas.')); r.readAsDataURL(file); }); }
function pilihBerkas(cb) { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = '.pdf,.jpg,.jpeg,.png,.xls,.xlsx'; i.onchange = () => cb(Array.from(i.files || [])); i.click(); }
function cekBerkas(f) {
  const maks = Number(cfg('maks_upload_mb', 10));
  let mime = f.type;
  if (!MIME_OK[mime]) { const ext = (f.name.split('.').pop() || '').toLowerCase(); mime = Object.keys(MIME_OK).find(k => MIME_OK[k] === ext || (ext === 'jpeg' && MIME_OK[k] === 'jpg')) || ''; }
  if (!mime) return { err: `"${f.name}": format tidak diizinkan (PDF, JPG, PNG, Excel).` };
  if (f.size > maks * 1048576) return { err: `"${f.name}": melebihi ${maks} MB.` };
  return { mime };
}
/** Unggah berkas langsung (entitas sudah punya ID). Baris placeholder tampil instan. */
async function unggah(entitas, id, files, site) {
  for (const f of files) {
    const c = cekBerkas(f);
    if (c.err) { toast(c.err, 'error'); continue; }
    const tmp = { id_lampiran: uid('tmpL'), entitas, id_entitas: id, nama_file: f.name, mime: c.mime, ukuran: String(f.size), site: site || '', diunggah_oleh: S.me.nrp, waktu: new Date().toISOString().slice(0, 16).replace('T', ' '), status_aktif: 'Active', _up: true };
    (S.data.lampiran = S.data.lampiran || []).push(tmp); S.idx = null; rerender(true);
    try {
      const b64 = await fileB64(f);
      const res = await api('lampiran.unggah', { entitas, id_entitas: id, nama_file: f.name, mime: c.mime, base64: b64 });
      gantiId('lampiran', 'id_lampiran', tmp.id_lampiran, res.data.lampiran);
      toast(res.message, 'success');
    } catch (e) {
      S.data.lampiran = S.data.lampiran.filter(l => l.id_lampiran !== tmp.id_lampiran);
      toast(e.message, 'error', 'Unggah gagal');
    }
    S.idx = null; rerender(true);
  }
  jadwalSync(500);
}
function fileIkon(mime) { return /image/.test(mime) ? ['image', 'img'] : (/sheet|excel/.test(mime) ? ['table_view', 'xls'] : ['picture_as_pdf', '']); }
function daftarBerkas(list, o) {
  o = o || {};
  if (!list.length) return o.kosong === false ? '' : `<div class="muted small" style="padding:6px 2px">${esc(o.teksKosong || 'Belum ada berkas terlampir.')}</div>`;
  return `<div class="files">${list.map(l => { const [ik, cl] = fileIkon(l.mime); return `<div class="file"><div class="fic ${cl}">${ic(ik)}</div><div class="fn"><b title="${esc(l.nama_file)}">${esc(l.nama_file)}</b><span>${l._up ? '<span class="spin s"></span> Mengunggah…' : `${ukuran(l.ukuran)} • ${esc(namaUser(l.diunggah_oleh))} • ${fmtWkt(l.waktu)}`}</span></div>
    ${l._up ? '' : `<button class="btn gh ic sm" data-act="pratinjau" data-id="${esc(l.id_lampiran)}" title="Pratinjau" aria-label="Pratinjau ${esc(l.nama_file)}">${ic('visibility')}</button><button class="btn gh ic sm" data-act="unduhlamp" data-id="${esc(l.id_lampiran)}" title="Unduh" aria-label="Unduh">${ic('download')}</button>${o.hapus && (o.hapus === true || o.hapus(l)) ? `<button class="btn gh ic sm" data-act="arsiplamp" data-id="${esc(l.id_lampiran)}" title="Hapus dari daftar" aria-label="Hapus">${ic('delete')}</button>` : ''}`}</div>`; }).join('')}</div>`;
}
function zonaUnggah(ent, id, site, teks) {
  return `<div class="drop" data-act="unggah" data-drop="1" data-ent="${ent}" data-id="${esc(id)}" data-site="${esc(site || '')}" role="button" tabindex="0"><div class="dic">${ic('cloud_upload')}</div>${esc(teks || 'Tarik & letakkan berkas di sini atau klik untuk memilih')}<small>PDF, JPG, PNG, Excel • Maks. ${esc(cfg('maks_upload_mb', 10))} MB per berkas • Disimpan di Google Drive SHEC</small></div>`;
}
async function ambilLampiran(id) { const res = await api('lampiran.ambil', { id_lampiran: id }); return res.data; }
async function pratinjau(id) {
  const l = (S.data.lampiran || []).find(x => x.id_lampiran === id); if (!l) return;
  modal({ title: l.nama_file, sub: `${ukuran(l.ukuran)} • diunggah ${fmtWkt(l.waktu)} oleh ${namaUser(l.diunggah_oleh)}`, icon: fileIkon(l.mime)[0], size: 'lg', body: '<div class="sk" style="height:420px"></div>', foot: `<button class="btn" data-act="mclose">Tutup</button><button class="btn p" data-act="unduhlamp" data-id="${esc(id)}">${ic('download')} Unduh</button>` });
  try {
    const d = await ambilLampiran(id);
    if (!$('#mdlB')) return;
    const url = URL.createObjectURL(b64Blob(d.base64, d.mime));
    S.ui.blobUrl = url;
    let isi;
    if (/image/.test(d.mime)) isi = `<img src="${url}" alt="${esc(d.nama)}" style="max-width:100%;max-height:70vh;display:block;margin:auto;border-radius:8px">`;
    else if (/pdf/.test(d.mime)) isi = `<object data="${url}" type="application/pdf" style="width:100%;height:70vh;border:1px solid var(--bd);border-radius:8px">${kosong('picture_as_pdf', 'Pratinjau PDF tidak didukung browser ini', 'Gunakan tombol Unduh untuk membuka berkas.')}</object>`;
    else isi = kosong('table_view', 'Pratinjau tidak tersedia untuk berkas Excel', 'Gunakan tombol Unduh untuk membuka berkas di aplikasi spreadsheet.');
    $('#mdlB').innerHTML = isi;
  } catch (e) { if ($('#mdlB')) $('#mdlB').innerHTML = kosong('error', 'Gagal memuat berkas', e.message); }
}
async function unduhLampiran(id, btn) {
  const l = (S.data.lampiran || []).find(x => x.id_lampiran === id); if (!l) return;
  busy(btn, true, 'Mengunduh…');
  try { const d = await ambilLampiran(id); unduhBlob(b64Blob(d.base64, d.mime), d.nama); }
  catch (e) { toast(e.message, 'error', 'Unduh gagal'); }
  finally { busy(btn, false); }
}
async function buatLaporan(jenis, format, filter, btn) {
  busy(btn, true, 'Menyusun laporan…');
  try {
    const res = await api('laporan.buat', { jenis, format, filter: filter || {} });
    const d = res.data;
    if (d.base64) unduhBlob(b64Blob(d.base64, d.mime), d.nama);
    toast(res.message, 'success', d.nama);
    jadwalSync(300);
  } catch (e) { toast(e.message, 'error', 'Ekspor gagal'); }
  finally { busy(btn, false); }
}

/* ───────────── NAVIGASI (SPA, tanpa perubahan URL) ───────────── */
function go(sec, params, catat) {
  if (!SEC_TITLE[sec] || (AKSES_SEC[sec] && !is(...AKSES_SEC[sec]))) sec = 'dashboard';
  if (catat !== false && S.ui.sec !== sec) S.ui.hist.push([S.ui.sec, S.ui.params]);
  if (S.ui.hist.length > 30) S.ui.hist.shift();
  if (S.ui.sec !== sec) tutupDrawer();
  S.ui.sec = sec; S.ui.params = params || {};
  if (!MENU_INDUK[sec]) lsSet('sec', sec);
  // Hanya section aktif yang berisi DOM → tidak ada ID ganda & memori ringan (state tetap di S.ui).
  $$('.sec').forEach(s => { const on = s.id === 'sec-' + sec; s.classList.toggle('on', on); if (!on && s.innerHTML) s.innerHTML = ''; });
  $('#tbTitle').textContent = SEC_TITLE[sec];
  renderNav(); renderSec(sec); tutupSb();
  window.scrollTo(0, 0);
}
function kembali(fb) { const h = S.ui.hist.pop(); if (h) go(h[0], h[1], false); else go(fb || 'dashboard', {}, false); }
const FORM_SEC = ['evalform', 'verifikasi'];
function renderSec(sec, lunak) {
  const el = $('#sec-' + sec); if (!el) return;
  if (!S.loaded) { el.innerHTML = skeleton(); return; }
  if (lunak && FORM_SEC.includes(sec)) { if (PARTIAL[sec]) PARTIAL[sec](); return; }   // jangan timpa form yang sedang diisi
  const ae = document.activeElement, aid = ae && ae.id && el.contains(ae) ? ae.id : null, pos = aid && ae.selectionStart != null ? ae.selectionStart : null;
  Object.values(S.charts).forEach(c => { try { c.destroy(); } catch (e) { /* abaikan */ } }); S.charts = {};
  try { (HAL[sec] || (() => { el.innerHTML = ''; }))(el, S.ui.params); }
  catch (e) { console.error(e); el.innerHTML = kosong('error', 'Halaman gagal ditampilkan', e.message); }
  if (aid) { const n = document.getElementById(aid); if (n) { n.focus(); if (pos != null && n.setSelectionRange) try { n.setSelectionRange(pos, pos); } catch (e) { /* tipe input tanpa seleksi */ } } }
}
function rerender(lunak) { renderNav(); renderSec(S.ui.sec, lunak); renderDrawer(); }
function bukaSb() { $('#sb').classList.add('open'); $('#ovlsb').classList.add('on'); }
function tutupSb() { $('#sb').classList.remove('open'); $('#ovlsb').classList.remove('on'); }

/* ───────────── KROM: sidebar, topbar, site ───────────── */
function renderChrome() {
  const u = S.me; if (!u) return;
  const nmApp = cfg('nama_aplikasi', 'HMSI-LCMS');
  $('#sbNama').textContent = nmApp;
  const logo = cfg('logo_url', '');
  $('#sbLogo').innerHTML = /^https:\/\//.test(logo) ? `<img src="${esc(logo)}" alt="Logo">` : 'HMSI';
  ['#sbAv', '#tbAv'].forEach(s => { $(s).textContent = inisial(u.nama); });
  $('#sbUNama').textContent = u.nama; $('#tbUNama').textContent = u.nama;
  const hm = $('.tb-crumb .hm'); if (hm) hm.innerHTML = esc(ROLE_LABEL[u.role] || u.role) + '&nbsp;/&nbsp;';
  $('#sbUNrp').textContent = 'NRP ' + u.nrp;
  $('#sbURole').textContent = ROLE_LABEL[u.role] || u.role; $('#tbURole').textContent = ROLE_LABEL[u.role] || u.role;
  const sites = siteList();
  if (S.ui.site !== 'ALL' && !sites.some(s => s.kode === S.ui.site)) S.ui.site = 'ALL';
  const semua = mySites() ? `Semua Site Saya (${sites.length})` : `Semua ${sites.length} Site Operasional`;
  $('#siteSel').innerHTML = `<option value="ALL">${esc(semua)}</option>` + sites.map(s => `<option value="${esc(s.kode)}" ${s.kode === S.ui.site ? 'selected' : ''}>${esc(s.nama)}</option>`).join('');
  renderNav();
}
function renderNav() {
  if (!S.me) return;
  const aktifSec = MENU_INDUK[S.ui.sec] || S.ui.sec;
  $('#nav').innerHTML = MENU.filter(m => !m.roles || is(...m.roles)).map(m => {
    if (m.sec) return `<div class="sb-sec">${esc(m.sec)}</div>`;
    const n = S.loaded && m.cnt ? m.cnt() : 0;
    return `<button class="nav ${aktifSec === m.id ? 'on' : ''}" data-act="go" data-sec="${m.id}" ${aktifSec === m.id ? 'aria-current="page"' : ''}>${ic(m.icon || m.ic)}<span class="lbl">${esc(m.l)}${m.sub ? `<small>${esc(m.sub)}</small>` : ''}</span>${n ? `<span class="cnt ${m.cv || ''}">${n}</span>` : ''}</button>`;
  }).join('');
  $('#bellDot').classList.toggle('hide', !daftarNotif().length);
}
function daftarNotif() {
  if (!S.loaded || !S.me) return [];
  const L = [], pic = is(R.PIC);
  D.reg2().forEach(r => { if (pic && r.pic_nrp !== S.me.nrp) return; const s = sisaHari(r.tanggal_kedaluwarsa); if (s != null && s <= 30) L.push({ i: 'verified', v: s < 0 ? 'r' : 'a', t: r.nama_dokumen, s: s < 0 ? `Kedaluwarsa ${-s} hari • ${namaSite(r.site)}` : `H-${s} kedaluwarsa • ${namaSite(r.site)}`, sec: 'reg2d', id: r.id_izin, w: s }); });
  D.rtp().forEach(r => { if (pic && r.pic_nrp !== S.me.nrp) return; const st = stRtp(r); if (st === 'Overdue') L.push({ i: 'assignment_late', v: 'r', t: `${r.id_rtp} overdue`, s: r.tindakan_perbaikan, sec: 'rtp', id: r.id_rtp, w: selisih(today(), r.due_date) }); else if (st === 'Diajukan' && can.rtpVerif(r)) L.push({ i: 'task_alt', v: 'a', t: `${r.id_rtp} menunggu verifikasi`, s: r.tindakan_perbaikan, sec: 'rtp', id: r.id_rtp, w: 5 }); });
  if (is(R.CORP)) {
    const a = D.antrean().filter(x => x.status === 'Menunggu').length; if (a) L.push({ i: 'travel_explore', v: 'o', t: `${a} temuan regulasi menunggu verifikasi`, s: 'Antrean Verifikasi Corporate', sec: 'pencarian', tab: 'antrean', w: 3 });
    const e = D.ev().filter(x => x.status_verifikasi === 'Menunggu Verifikasi' && x.evaluator_nrp !== S.me.nrp).length; if (e) L.push({ i: 'fact_check', v: 'b', t: `${e} evaluasi menunggu verifikasi`, s: 'Register 3 — Evaluasi', sec: 'evaluasi', w: 4 });
  }
  if (is(R.SITE)) {
    const k = kwBelumEval(periodeAktif()).length; if (k) L.push({ i: 'assignment_late', v: 'o', t: `${k} kewajiban belum dievaluasi`, s: `Register 3 — Evaluasi & RTP • ${labelPeriode(periodeAktif())}`, sec: 'evaluasi', w: 4 });
  }
  return L.sort((a, b) => a.w - b.w).slice(0, 25);
}

/* ───────────── AUTENTIKASI ───────────── */
function tampilAuth(html) { $('#app').classList.remove('on'); const a = $('#auth'); a.innerHTML = html; a.classList.add('on'); sembunyiBoot(); }
function sembunyiBoot() { const b = $('#boot'); if (b) { b.style.opacity = '0'; setTimeout(() => b.remove(), 200); } }
function brand() { return `<div class="brand"><div class="sb-logo">HMSI</div><div><div class="b7" style="font-size:15px">${esc(cfg('nama_aplikasi', 'HMSI-LCMS'))}</div><div class="xsmall muted">Sistem Manajemen Kepatuhan Hukum &amp; Regulasi Pertambangan</div></div></div>`; }
function kakiAuth() { return `<div class="afoot">HMSI Legal Compliance Management System • v1.0<br>Mendukung SMKP Minerba Sub Elemen II.3 &amp; V.3</div>`; }
function layarLogin(pesan, jenis) {
  tampilAuth(`<div class="acard" id="acard">${brand()}<h2>Masuk ke Akun Anda</h2><p class="lead">Gunakan Nomor Registrasi Pokok (NRP) dan PIN Anda untuk mengakses portal kepatuhan.</p>
    ${pesan ? `<div class="note ${jenis || 'b'} mb12">${ic(jenis === 'g' ? 'check_circle' : 'info')}<div>${esc(pesan)}</div></div>` : ''}
    <form id="fLogin" novalidate autocomplete="off">
      <div class="fld"><label for="lNrp">Nomor Registrasi Pokok (NRP)</label><div class="ifield">${ic('badge')}<input class="inp" id="lNrp" name="nrp" inputmode="text" autocapitalize="characters" maxlength="30" placeholder="Contoh: 7320491" required></div></div>
      <div class="fld"><label for="lPin">PIN Keamanan</label><div class="ifield">${ic('lock')}<input class="inp" id="lPin" name="pin" type="password" inputmode="numeric" maxlength="8" placeholder="6 digit angka" required><button type="button" class="eye" data-act="eye" data-for="lPin" aria-label="Tampilkan PIN">${ic('visibility')}</button></div></div>
      <div id="lErr" class="hide"></div>
      <button class="btn p lg blk" type="submit" id="lBtn">Masuk ke Sistem ${ic('arrow_forward')}</button>
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:6px"><button type="button" class="lnk small" data-act="lupapin">Lupa PIN? Hubungi SHEC Corporate</button><span class="xsmall muted row">${ic('verified_user', 'xs')} Tanpa akun Google</span></div>
    </form>
    <div class="note b mt16" style="font-size:12px">${ic('schedule')}<div>Percobaan login gagal dibatasi ${esc(cfg('maks_gagal', 5))} kali sebelum akun terkunci ${esc(cfg('kunci_menit', 15))} menit.</div></div>${kakiAuth()}</div>`);
  setTimeout(() => $('#lNrp') && $('#lNrp').focus(), 50);
  $('#fLogin').addEventListener('submit', prosesLogin);
}
async function prosesLogin(e) {
  e.preventDefault();
  const nrp = $('#lNrp').value.trim(), pin = $('#lPin').value, err = $('#lErr');
  const tampilErr = (m, ikon) => { err.className = 'aerr'; err.innerHTML = ic(ikon || 'error') + `<div><b>Otentikasi Ditolak</b><br>${esc(m)}</div>`; $('#acard').classList.remove('shake'); void $('#acard').offsetWidth; $('#acard').classList.add('shake'); $$('#fLogin .inp').forEach(i => i.classList.add('err')); };
  if (!nrp || !pin) { tampilErr('NRP dan PIN wajib diisi.'); return; }
  if (!/^\d{6,8}$/.test(pin)) { tampilErr('PIN terdiri dari 6–8 digit angka.'); return; }
  const btn = $('#lBtn'); busy(btn, true, 'Memeriksa…');
  try {
    const res = await api('auth.login', { nrp, pin });
    S.token = res.data.token; S.me = res.data.me; ssSet('token', S.token);
    if (res.data.wajibGantiPin) { layarGantiPin(true); return; }
    masukApp(res.message);
  } catch (ex) {
    busy(btn, false);
    if (ex.code === 'TERKUNCI') { layarTerkunci(ex.res.sisaMs); return; }
    tampilErr(ex.message); $('#lPin').value = ''; $('#lPin').focus();
  }
}
let cdTimer = null;
function layarTerkunci(sisaMs) {
  const akhir = Date.now() + Number(sisaMs || 900000);
  tampilAuth(`<div class="acard" style="text-align:center">${brand()}<div class="big-ic" style="background:var(--r-t);color:var(--r)">${ic('lock')}</div><h2>Akun Terkunci</h2>
    <p class="lead">Terlalu banyak percobaan PIN yang salah. Demi keamanan, akun dikunci sementara.</p><div class="cdown" id="cdown">${ic('timer', 's')} <span>--:--</span></div>
    <div class="mt24 col" style="gap:8px"><button class="btn p lg blk" data-act="kelogin">Kembali ke Halaman Masuk</button><button class="btn gh blk" data-act="lupapin">Hubungi SHEC Corporate untuk membuka kunci</button></div>${kakiAuth()}</div>`);
  clearInterval(cdTimer);
  const tick = () => { const s = Math.max(0, Math.round((akhir - Date.now()) / 1000)); const el = $('#cdown span'); if (!el) { clearInterval(cdTimer); return; } el.textContent = `Coba lagi dalam ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; if (!s) { clearInterval(cdTimer); el.textContent = 'Kunci sudah dibuka — silakan masuk'; } };
  tick(); cdTimer = setInterval(tick, 1000);
}
function sesiHabis(msg) {
  if (!S.token) return;
  bersihkanSesi();
  tutupModal(); tutupDrawer();
  tampilAuth(`<div class="acard" style="text-align:center">${brand()}<div class="big-ic">${ic('hourglass_empty')}</div><h2>Sesi Berakhir</h2><p class="lead">${esc(msg || 'Sesi Anda berakhir. Silakan masuk kembali untuk melanjutkan.')}</p>
    <button class="btn p lg blk" data-act="kelogin">Masuk Kembali</button>${kakiAuth()}</div>`);
}
function bersihkanSesi() { S.token = null; S.loaded = false; S.data = {}; S.ver = {}; S.idx = null; S.me = null; S.ui.hist = []; ssSet('token', null); ssSet('snap', null); }
function cekPin(pin, nrp) {
  const r = { len: /^\d{6,8}$/.test(pin), ulang: !!pin && !/^(\d)\1+$/.test(pin) && !'01234567890123'.includes(pin) && !'98765432109876'.includes(pin), nrp: !!pin && pin !== String(nrp || '') };
  r.skor = [r.len, r.ulang, r.nrp].filter(Boolean).length; r.ok = r.skor === 3; return r;
}
function formPin(wajib) {
  return `<form id="fPin" novalidate autocomplete="off" class="col" style="gap:14px">
    ${wajib ? `<div class="note a">${ic('info')}<div>Anda harus mengganti PIN sementara sebelum melanjutkan.</div></div>` : ''}
    ${['pinLama|PIN Saat Ini', 'pinBaru|PIN Baru', 'pinUlang|Ulangi PIN Baru'].map(s => { const [n, l] = s.split('|'); return `<div class="fld" data-f="${n}"><label for="p_${n}">${l}</label><div class="ifield">${ic(n === 'pinLama' ? 'lock' : 'key')}<input class="inp" id="p_${n}" name="${n}" type="password" inputmode="numeric" maxlength="8" ${n === 'pinBaru' ? 'data-in="pinkuat"' : ''}><button type="button" class="eye" data-act="eye" data-for="p_${n}" aria-label="Tampilkan PIN">${ic('visibility')}</button></div><div class="ferr hide"></div></div>`; }).join('')}
    <div class="str"><i id="pinStr"></i></div>
    <div class="rules" id="pinRules"><div data-r="len">${ic('radio_button_unchecked')} Minimal 6 digit angka (maks. 8)</div><div data-r="ulang">${ic('radio_button_unchecked')} Bukan urutan atau angka berulang</div><div data-r="nrp">${ic('radio_button_unchecked')} Tidak sama dengan NRP</div></div>
    <button class="btn p lg blk" type="submit" id="pinBtn" disabled>Simpan PIN Baru</button></form>`;
}
function layarGantiPin(wajib) {
  if (!S.token) return;
  tampilAuth(`<div class="acard">${brand()}<h2>Ganti PIN</h2><p class="lead">Buat PIN pribadi yang hanya Anda ketahui. Jangan bagikan PIN kepada siapa pun.</p>${formPin(wajib)}
    <div class="row mt12" style="justify-content:center"><button class="lnk small" data-act="logout">Keluar</button></div>${kakiAuth()}</div>`);
  $('#fPin').addEventListener('submit', e => simpanPin(e, true));
}
function bukaGantiPin() {
  modal({ title: 'Ganti PIN', sub: 'PIN baru berlaku untuk login berikutnya di semua perangkat.', icon: 'key', size: 'sm', body: formPin(false) });
  $('#fPin').addEventListener('submit', e => simpanPin(e, false));
}
async function simpanPin(e, wajib) {
  e.preventDefault();
  const f = $('#fPin'), v = bacaForm(f), r = cekPin(v.pinBaru, S.me && S.me.nrp);
  if (!validasi(f, x => ({ pinLama: !x.pinLama ? 'Wajib diisi.' : '', pinBaru: !r.ok ? 'PIN belum memenuhi syarat.' : '', pinUlang: x.pinUlang !== x.pinBaru ? 'PIN tidak sama.' : '' }))) return;
  const btn = $('#pinBtn'); busy(btn, true, 'Menyimpan…');
  try {
    const res = await api('auth.gantiPin', { pinLama: v.pinLama, pinBaru: v.pinBaru });
    S.token = res.data.token; ssSet('token', S.token);
    toast(res.message, 'success');
    if (wajib) masukApp(); else tutupModal();
  } catch (ex) { busy(btn, false); setErr(f, 'pinLama', ex.message); }
}
async function logout() {
  if (S.token) api('auth.logout').catch(() => { });
  bersihkanSesi(); tutupModal(); tutupDrawer();
  layarLogin('Anda telah keluar dari aplikasi.', 'g');
}
function masukApp(salam) {
  $('#auth').classList.remove('on'); $('#auth').innerHTML = '';
  $('#app').classList.add('on'); sembunyiBoot();
  renderChrome();
  if (S.loaded) go(lsGet('sec', 'dashboard'), {}, false);
  else { $$('.sec').forEach(s => s.classList.remove('on')); const el = $('#sec-dashboard'); el.classList.add('on'); el.innerHTML = skeleton(); }
  sync(!S.loaded).then(() => { if (salam) toast(salam, 'success'); }).catch(() => { });
}
function layarGagalMuat(msg) {
  const el = $('#sec-' + S.ui.sec) || $('#sec-dashboard');
  el.innerHTML = kosong('cloud_off', 'Data gagal dimuat', msg, `<button class="btn p" data-act="muatulang">${ic('refresh')} Coba Lagi</button>`);
}

/* ───────────── EVENT GLOBAL (delegasi) ───────────── */
const ACT = {}, IN = {}, CH = {}, HAL = {};
const renderTunda = debounce(() => renderSec(S.ui.sec), 160);
Object.assign(ACT, {
  go: t => { if (t.dataset.tab) S.ui.tab[t.dataset.sec] = t.dataset.tab; go(t.dataset.sec, t.dataset.id ? { id: t.dataset.id } : {}); },
  back: t => kembali(t.dataset.fb),
  'sb-open': bukaSb, 'sb-close': tutupSb, mclose: tutupModal, dclose: tutupDrawer,
  logout: () => logout(), kelogin: () => layarLogin(), gantipin: () => bukaGantiPin(),
  muatulang: () => { toast('Memuat ulang seluruh data dari server…', 'info'); sync(true).catch(() => { }); },
  eye: t => { const i = document.getElementById(t.dataset.for); if (!i) return; const tampil = i.type === 'password'; i.type = tampil ? 'text' : 'password'; t.innerHTML = ic(tampil ? 'visibility_off' : 'visibility'); },
  lupapin: () => modal({ title: 'Lupa PIN / Akun Terkunci', sub: 'Layanan reset kredensial', icon: 'support_agent', size: 'sm', body: `<div class="col" style="gap:12px"><p class="muted2" style="margin:0">PIN tidak dapat dipulihkan sendiri. Hubungi <b>SHEC Corporate</b> atau SHEC Site di lokasi Anda untuk:</p><ul style="margin:0;padding-left:18px;line-height:1.8"><li>Menerbitkan PIN sementara baru</li><li>Membuka kunci akun lebih awal</li></ul><div class="note a">${ic('badge')}<div>Siapkan kartu identitas karyawan. Verifikasi identitas diperlukan sebelum PIN sementara diterbitkan.</div></div></div>`, foot: '<button class="btn p" data-act="mclose">Mengerti</button>' }),
  tab: t => { S.ui.tab[t.dataset.g] = t.dataset.v; renderSec(S.ui.sec); },
  page: t => { tst(t.dataset.t).page = Number(t.dataset.p); renderSec(S.ui.sec); },
  sel1: t => { const s = S.ui.sel[t.dataset.t] || (S.ui.sel[t.dataset.t] = new Set()); if (t.checked) s.add(t.dataset.id); else s.delete(t.dataset.id); renderSec(S.ui.sec); },
  selall: t => { const s = S.ui.sel[t.dataset.t] || (S.ui.sel[t.dataset.t] = new Set()); $$(`input[data-act="sel1"][data-t="${t.dataset.t}"]`).forEach(c => { if (t.checked) s.add(c.dataset.id); else s.delete(c.dataset.id); }); renderSec(S.ui.sec); },
  selclear: t => { S.ui.sel[t.dataset.t] = new Set(); renderSec(S.ui.sec); },
  umenu: t => popMenu(t, `<div class="mh"><b>${esc(S.me.nama)}</b><br>NRP ${esc(S.me.nrp)} • ${esc(ROLE_LABEL[S.me.role])}<br>${esc(namaSite(S.me.site))}</div><hr><button data-act="gantipin">${ic('key')} Ganti PIN</button><button data-act="muatulang">${ic('sync')} Muat ulang data</button><hr><button class="r" data-act="logout">${ic('logout')} Keluar</button>`),
  notif: t => { const L = daftarNotif(); popMenu(t, `<div class="mh b6" style="padding:12px">Perlu perhatian (${L.length})</div>` + (L.length ? L.map(n => `<div class="ntf-i" data-act="buka-notif" data-sec="${n.sec}" data-id="${esc(n.id || '')}" data-tab="${n.tab || ''}" role="button" tabindex="0">${ic(n.i, 't-' + n.v)}<div style="min-width:0"><b>${esc(n.t)}</b><div class="muted xsmall clamp2">${esc(n.s)}</div></div></div>`).join('') : '<div class="empty small">Tidak ada hal mendesak. 🎉</div>'), 'ntf'); },
  'buka-notif': t => { if (t.dataset.sec === 'rtp') { S.ui.tab.evaluasi = 'rtp'; go('evaluasi'); bukaRtp(t.dataset.id); } else { if (t.dataset.tab) S.ui.tab[t.dataset.sec] = t.dataset.tab; go(t.dataset.sec, t.dataset.id ? { id: t.dataset.id } : {}); } },
  pratinjau: t => pratinjau(t.dataset.id),
  unduhlamp: t => unduhLampiran(t.dataset.id, t),
  unggah: t => pilihBerkas(f => unggah(t.dataset.ent, t.dataset.id, f, t.dataset.site)),
  arsiplamp: async t => {
    if (!await konfirmasi({ title: 'Hapus lampiran dari daftar?', msg: 'Berkas tetap tersimpan di Google Drive dan tercatat di log audit.', danger: true, ok: 'Hapus' })) return;
    const id = t.dataset.id;
    kirim('lampiran.arsip', { id_lampiran: id }, { apply: () => upsert('lampiran', 'id_lampiran', { id_lampiran: id, status_aktif: 'Archived' }) }).catch(() => { });
  },
  laporan: t => buatLaporan(t.dataset.j, t.dataset.f || 'xlsx', { site: S.ui.site, periode: t.dataset.p || '' }, t)
});
Object.assign(CH, {
  'site-global': t => { S.ui.site = t.value; lsSet('site', t.value); Object.values(S.ui.tbl).forEach(s => { s.page = 1; }); rerender(); },
  per: t => { const st = tst(t.dataset.t); st.per = Number(t.value); st.page = 1; lsSet('per', st.per); renderSec(S.ui.sec); },
  flt: t => { const st = tst(t.dataset.t); st[t.dataset.k] = t.type === 'checkbox' ? t.checked : t.value; st.page = 1; renderSec(S.ui.sec); }
});
Object.assign(IN, {
  q: t => { const st = tst(t.dataset.t); st.q = t.value; st.page = 1; renderTunda(); },
  'lm-q': t => { const LM = initLM(); LM.q = t.value; renderTunda(); },
  pinkuat: t => {
    const r = cekPin(t.value, S.me && S.me.nrp);
    $$('#pinRules [data-r]').forEach(d => { const ok = r[d.dataset.r]; d.classList.toggle('ok', ok); d.querySelector('.ms').textContent = ok ? 'check_circle' : 'radio_button_unchecked'; });
    const bar = $('#pinStr'); bar.style.width = (r.skor / 3 * 100) + '%'; bar.style.background = ['#DC2626', '#DC2626', '#F59E0B', '#16A34A'][r.skor];
    $('#pinBtn').disabled = !r.ok;
  }
});
function pasangEvent() {
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if ($('#popm') && !e.target.closest('#popm') && !(t && ['umenu', 'notif'].includes(t.dataset.act))) tutupMenu();
    if (!t) return;
    const a = e.target.closest('a[href]');
    if (a && t.contains(a) && a !== t) return;                    // tautan eksternal di dalam baris
    const fn = ACT[t.dataset.act]; if (!fn) return;
    if (!['INPUT', 'LABEL', 'SELECT', 'A'].includes(t.tagName)) e.preventDefault();
    if (t.closest('#popm')) tutupMenu();
    fn(t, e);
  });
  document.addEventListener('input', e => { const t = e.target.closest('[data-in]'); if (t && IN[t.dataset.in]) IN[t.dataset.in](t, e); });
  document.addEventListener('change', e => { const t = e.target.closest('[data-ch]'); if (t && CH[t.dataset.ch]) CH[t.dataset.ch](t, e); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('#croot').innerHTML) { if (S.ui.cfBatal) S.ui.cfBatal(); }
      else if ($('#popm')) tutupMenu(); else if ($('#mroot').innerHTML) tutupModal(); else if (S.ui.drawer) tutupDrawer(); else tutupSb();
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-act][tabindex]')) { e.preventDefault(); e.target.click(); }
  });
  document.addEventListener('dragover', e => { const z = e.target.closest('[data-drop]'); if (z) { e.preventDefault(); z.classList.add('ov'); } });
  document.addEventListener('dragleave', e => { const z = e.target.closest('[data-drop]'); if (z) z.classList.remove('ov'); });
  document.addEventListener('drop', e => {
    const z = e.target.closest('[data-drop]'); if (!z) return;
    e.preventDefault(); z.classList.remove('ov');
    const files = Array.from(e.dataTransfer.files || []); if (!files.length) return;
    if (z.dataset.ent === 'EVALQ') antreBerkasEval(files); else unggah(z.dataset.ent, z.dataset.id, files, z.dataset.site);
  });
  ['click', 'keydown', 'touchstart', 'scroll'].forEach(ev => document.addEventListener(ev, () => { S.lastAct = Date.now(); }, { passive: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.token && S.loaded && Date.now() - (S.lastSync || 0) > 60000) jadwalSync(100); });
  setInterval(() => {
    if (!S.token) return;
    const idleMnt = Number(cfg('idle_menit', 30));
    if (Date.now() - S.lastAct > idleMnt * 60000) { api('auth.logout').catch(() => { }); sesiHabis(`Sesi berakhir karena tidak ada aktivitas selama ${idleMnt} menit.`); return; }
    if (!document.hidden && S.loaded && Date.now() - S.lastAct < 120000 && Date.now() - (S.lastSync || 0) > 120000) { S.lastSync = Date.now(); sync().catch(() => { }); }
  }, 30000);
  window.addEventListener('load', () => { if (S.loaded && S.ui.sec === 'dashboard') renderSec('dashboard', true); }, { once: true });
}

/* ───────────── GRAFIK ───────────── */
function donut(id, data, total) {
  const el = document.getElementById(id); if (!el) return;
  const tot = data.reduce((a, d) => a + d.v, 0);
  if (window.Chart) {
    S.charts[id] = new Chart(el, {
      type: 'doughnut',
      data: { labels: data.map(d => d.l), datasets: [{ data: tot ? data.map(d => d.v) : [1], backgroundColor: tot ? data.map(d => d.c) : ['#E5E7EB'], borderWidth: 2, borderColor: '#fff', hoverOffset: 4 }] },
      options: { cutout: '72%', responsive: false, animation: { duration: 300 }, plugins: { legend: { display: false }, tooltip: { enabled: !!tot, callbacks: { label: c => ` ${c.label}: ${nf(c.raw)} (${fpct(pct(c.raw, tot))})` } } } }
    });
  } else {
    let acc = 0;
    const seg = tot ? data.map(d => { const a = acc; acc += d.v / tot * 360; return `${d.c} ${a}deg ${acc}deg`; }).join(',') : '#E5E7EB 0 360deg';
    el.parentNode.style.background = `radial-gradient(circle,#fff 52%,transparent 53%),conic-gradient(${seg})`; el.parentNode.style.borderRadius = '50%';
  }
}
function legenda(data) { const tot = data.reduce((a, d) => a + d.v, 0); return `<div class="lgd">${data.map(d => `<div class="lgd-i"><i style="background:${d.c}"></i><span>${esc(d.l)}</span><b>${nf(d.v)}</b><span class="muted small" style="flex:0">${fpct(pct(d.v, tot))}</span></div>`).join('')}</div>`; }
function diffKata(a, b) {
  const A = String(a || '').split(/\s+/).filter(Boolean), B = String(b || '').split(/\s+/).filter(Boolean), n = A.length, m = B.length;
  if (n * m > 60000) return [esc(a), esc(b)];
  const eq = (x, y) => x.toLowerCase().replace(/[^\w]/g, '') === y.toLowerCase().replace(/[^\w]/g, '');
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = eq(A[i], B[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0; const L = [], Rr = [];
  while (i < n && j < m) { if (eq(A[i], B[j])) { L.push(esc(A[i++])); Rr.push(esc(B[j++])); } else if (dp[i + 1][j] >= dp[i][j + 1]) L.push(`<del>${esc(A[i++])}</del>`); else Rr.push(`<ins>${esc(B[j++])}</ins>`); }
  while (i < n) L.push(`<del>${esc(A[i++])}</del>`); while (j < m) Rr.push(`<ins>${esc(B[j++])}</ins>`);
  return [L.join(' '), Rr.join(' ')];
}
const host = u => { const m = String(u || '').match(/^https?:\/\/([^\/?#]+)/i); return m ? m[1] : (u || '–'); };
function tahunOpts() { const y = new Date().getFullYear(); const a = []; for (let t = y; t >= y - 15; t--) a.push(t); return a; }
function seninBerikut() { const t = today(); const d = new Date(dUTC(t)); const dow = d.getUTCDay(); const n = ((8 - dow) % 7) || 7; const s = addDays(t, n); return `Senin, ${fmtTgl(s)} 01:00 WIB`; }

/* ───────────── HALAMAN: DASHBOARD ───────────── */
HAL.dashboard = el => {
  if (is(R.PIC)) { dashPIC(el); return; }
  const per = S.ui.dash.periode || periodeAktif(), dep = S.ui.dash.dept;
  const kwOk = e => dep === 'ALL' || (I().kw[e.id_kewajiban] || {}).departemen_penanggung_jawab === dep;
  const izin = D.reg2().filter(r => dep === 'ALL' || r.departemen === dep);
  const nIz = s => izin.filter(r => stIzin(r) === s).length;
  const n30 = izin.filter(r => { const s = sisaHari(r.tanggal_kedaluwarsa); return s != null && s >= 0 && s <= 30; }).length;
  const reg1 = D.reg1().filter(r => aktif(r) && r.status_berlaku !== 'Dicabut');
  const mulaiPer = per.endsWith('S1') ? per.slice(0, 4) + '-01-01' : per.slice(0, 4) + '-07-01';
  const reg1Baru = reg1.filter(r => (r.tanggal_verifikasi || '') >= mulaiPer).length;
  const antM = D.antrean().filter(a => a.status === 'Menunggu');
  const evs = D.ev(per).filter(kwOk), ver = evs.filter(e => e.status_verifikasi === 'Terverifikasi');
  const nH = h => ver.filter(e => e.hasil === h).length;
  const pTot = pct(nH('Compliant'), ver.length - nH('N/A'));
  const rtps = D.rtp(), ovd = rtps.filter(r => stRtp(r) === 'Overdue'), rtpAkt = rtps.filter(r => r.status_rtp !== 'Closed');
  const sites = siteList().filter(s => S.ui.site === 'ALL' || s.kode === S.ui.site);
  const perSite = sites.map(s => { const v = ver.filter(e => e.site === s.kode); const c = v.filter(e => e.hasil === 'Compliant').length, na = v.filter(e => e.hasil === 'N/A').length; return { s, p: pct(c, v.length - na), n: v.length }; })
    .sort((a, b) => (b.p == null ? -1 : b.p) - (a.p == null ? -1 : a.p));
  const tg = target(), rendah = perSite.filter(x => x.p != null && x.p < tg);
  const periods = Array.from(new Set([periodeAktif(), periodeSebelum(periodeAktif(), 1), periodeSebelum(periodeAktif(), 2)].concat((S.data.evaluasi || []).map(e => e.periode)))).filter(Boolean).sort().reverse();
  const tabD = S.ui.dash.donut;
  const DON = {
    izin: { t: 'Status Izin & Lisensi', c: 'Total Izin', d: [{ l: 'Aktif Berlaku', v: nIz('Aktif'), c: WARNA.g }, { l: `≤ ${ambang()} hari`, v: nIz('Mendekati Kedaluwarsa'), c: WARNA.a }, { l: 'Kedaluwarsa', v: nIz('Kedaluwarsa'), c: WARNA.r }] },
    eval: { t: 'Hasil Evaluasi ' + labelPeriode(per), c: 'Evaluasi', d: [{ l: 'Compliant', v: evs.filter(e => e.hasil === 'Compliant').length, c: WARNA.g }, { l: 'Non-Compliant', v: evs.filter(e => e.hasil === 'Non-Compliant').length, c: WARNA.r }, { l: 'Pending', v: evs.filter(e => e.hasil === 'Pending').length, c: WARNA.b }, { l: 'N/A', v: evs.filter(e => e.hasil === 'N/A').length, c: WARNA.n }] },
    rtp: { t: 'Progres RTP', c: 'Total RTP', d: [{ l: 'Open', v: rtps.filter(r => stRtp(r) === 'Open').length, c: WARNA.b }, { l: 'Diajukan', v: rtps.filter(r => stRtp(r) === 'Diajukan').length, c: WARNA.a }, { l: 'Overdue', v: ovd.length, c: WARNA.r }, { l: 'Closed', v: rtps.filter(r => stRtp(r) === 'Closed').length, c: WARNA.g }] }
  }[tabD];
  // Insight otomatis (analisis berbasis aturan dari data lokal)
  const ins = [];
  if (perSite.some(x => x.p != null)) ins.push(rendah.length ? `<b>${rendah.length} site</b> berada di bawah ambang mandatori ${tg}%: ${rendah.map(x => esc(x.s.nama.replace('Site ', '')) + ' (' + fpct(x.p) + ')').join(', ')}.` : `Seluruh site yang dievaluasi memenuhi ambang mandatori ${tg}%.`);
  else ins.push(`Belum ada evaluasi terverifikasi untuk ${labelPeriode(per)}.`);
  const kwAktif = (S.data.kewajiban || []).filter(aktif).length, kwEval = new Set(evs.map(e => e.id_kewajiban)).size;
  if (kwAktif) ins.push(`Cakupan evaluasi ${labelPeriode(per)}: <b>${kwEval}</b> dari ${kwAktif} kewajiban pasal (${fpct(pct(kwEval, kwAktif))}).`);
  if (nIz('Kedaluwarsa') || n30) ins.push(`<b>${nIz('Kedaluwarsa')}</b> izin kedaluwarsa dan <b>${n30}</b> izin akan habis dalam 30 hari — prioritaskan perpanjangan.`);
  if (ovd.length) { const t = ovd.slice().sort((a, b) => a.due_date.localeCompare(b.due_date))[0]; ins.push(`<b>${ovd.length} RTP overdue</b>; terlama ${esc(t.id_rtp)} terlambat ${selisih(t.due_date, today())} hari (PIC ${esc(namaUser(t.pic_nrp))}).`); }
  if (is(R.CORP) && antM.length) ins.push(`<b>${antM.length}</b> temuan regulasi menunggu verifikasi Corporate.`);
  const evMenunggu = evs.filter(e => e.status_verifikasi === 'Menunggu Verifikasi').length;
  if (evMenunggu) ins.push(`${evMenunggu} evaluasi menunggu verifikasi — persentase kepatuhan hanya menghitung evaluasi terverifikasi.`);
  // Perlu tindakan segera
  const tindak = [];
  izin.forEach(r => { const s = sisaHari(r.tanggal_kedaluwarsa); if (s != null && s <= 30) tindak.push({ k: 'Izin', ic: 'verified', t: r.nama_dokumen, s2: r.nomor_dokumen, site: r.site, pic: r.pic_nrp, w: s, sisa: s < 0 ? `Kedaluwarsa ${-s} hari` : `H-${s}`, st: s < 0 ? 'Kedaluwarsa' : 'Mendekati Kedaluwarsa', sec: 'reg2d', id: r.id_izin }); });
  rtps.forEach(r => { const st = stRtp(r); if (st === 'Closed') return; const s = selisih(today(), r.due_date); if (s != null && s <= 3) tindak.push({ k: 'RTP', ic: 'assignment', t: r.tindakan_perbaikan, s2: r.id_rtp, site: r.site, pic: r.pic_nrp, w: s, sisa: s < 0 ? `Terlambat ${-s} hari` : (s === 0 ? 'Hari ini' : `H-${s}`), st, sec: 'rtp', id: r.id_rtp }); });
  tindak.sort((a, b) => a.w - b.w);
  const heroOn = is(R.CORP, R.SITE);
  el.innerHTML = `
  ${heroOn ? `<div class="hero"><div class="hic">${ic('travel_explore', 'l')}</div><div style="flex:1;min-width:240px"><h2>Pencarian Regulasi Otomatis (Portal Pemerintah) <span class="tag">${ic('smart_toy', 'xs')} Bot Aktif</span></h2>
    <p>Pemeriksaan otomatis terakhir: <b>${S.stat.portalTerakhir ? fmtWkt(S.stat.portalTerakhir) + ' WIB' : 'belum pernah'}</b>${is(R.CORP) ? ` • <b class="t-o">${antM.length} regulasi baru/berubah</b> memerlukan validasi Corporate SHEC.` : '. Usulkan regulasi tambahan bila diperlukan.'}</p></div>
    <div class="ha">${is(R.CORP) ? `<button class="btn" data-act="go" data-sec="pencarian" data-tab="antrean">${ic('fact_check')} Lihat Antrean Verifikasi (${antM.length})</button><button class="btn p" data-act="go" data-sec="pencarian" data-tab="cari">${ic('travel_explore')} Cari Sekarang (Manual)</button>` : `<button class="btn p" data-act="usul">${ic('add_circle')} Usulkan Regulasi</button>`}</div></div>` : ''}
  <div class="card mb16"><div class="fbar" style="border:0">
    <span class="flbl row">${ic('tune', 's')} FILTER LINGKUP:</span>
    <select class="inp" style="width:auto" data-ch="dash" data-k="periode" aria-label="Periode">${opsi(periods.map(p => [p, labelPeriode(p) + (p === periodeAktif() ? ' (Aktif)' : '')]), per)}</select>
    <select class="inp" style="width:auto" data-ch="dash" data-k="dept" aria-label="Departemen"><option value="ALL">Semua Departemen</option>${opsi(deptList().map(d => [d.kode, d.nama]), dep)}</select>
    <span class="sp"></span><span class="sync-dot"><i></i>Google Sheets tersinkron</span>
    ${is(R.CORP, R.SITE, R.PJO, R.MGT) ? `<button class="btn" data-act="go" data-sec="laporan">${ic('download')} Ekspor PDF/Excel</button>` : ''}
  </div></div>
  <div class="grid g6 kpis mb16">
    ${kpi({ label: 'Total Peraturan & Standar', value: nf(reg1.length), unit: 'aktif', icon: 'menu_book', sub: `${ic('trending_up', 'xs t-g')} +${reg1Baru} regulasi ${labelPeriode(per).replace('Semester ', 'Smt ')}`, act: 'go', sec: 'reg1' })}
    ${kpi({ label: is(R.CORP) ? 'Menunggu Verifikasi' : 'Usulan Diproses', value: nf(antM.length), unit: 'temuan', icon: 'pending_actions', ic: 'o', l: 'o', vc: 't-o', sub: `${antM.filter(a => a.jenis_temuan === 'Baru').length} Baru • ${antM.filter(a => a.jenis_temuan === 'Perubahan').length} Diubah • ${antM.filter(a => a.jenis_temuan === 'Pencabutan').length} Dicabut` })}
    ${kpi({ label: 'Izin & Lisensi Aktif', value: nf(nIz('Aktif')), unit: 'dokumen', icon: 'verified', ic: 'g', sub: `${ic('check_circle', 'xs t-g')} ${fpct(pct(nIz('Aktif'), izin.length))} dari total registrasi` })}
    ${kpi({ label: `Kedaluwarsa ≤ ${ambang()} Hari`, value: nf(nIz('Mendekati Kedaluwarsa')), unit: 'dokumen', icon: 'schedule', ic: 'a', vc: 't-a', sub: `${ic('notifications_active', 'xs t-a')} ${n30} dokumen ≤ 30 hari` })}
    ${kpi({ label: 'Izin Kedaluwarsa', value: nf(nIz('Kedaluwarsa')), unit: 'kritis', icon: 'error', ic: 'r', l: 'r', vc: 't-r', sub: nIz('Kedaluwarsa') ? `<span class="t-r b6">${ic('priority_high', 'xs')} Eskalasi ke PJO site</span>` : 'Tidak ada' })}
    ${kpi({ label: 'RTP Overdue', value: nf(ovd.length), unit: 'tindakan', icon: 'assignment_late', ic: 'r', l: ovd.length ? 'r' : '', vc: ovd.length ? 't-r' : '', sub: `dari ${rtpAkt.length} RTP aktif • SMKP V.3` })}
  </div>
  <div class="grid g-73 mb16">
    <div class="card"><div class="card-h"><div class="sp"><h3>Tingkat Kepatuhan Evaluasi per Site</h3><p>SMKP Minerba Sub Elemen II.3 &amp; V.3 — evaluasi terverifikasi ${esc(labelPeriode(per))}</p></div>
      <span class="pill g">Rata-rata ${fpct(pTot)}</span><span class="small muted row">${'<i style="width:10px;height:10px;background:var(--o);border-radius:2px;display:inline-block"></i>'} Realisasi <i style="width:2px;height:12px;background:var(--r);display:inline-block;margin-left:6px"></i> Batas ${tg}%</span></div>
      <div class="card-b"><div class="bars">${perSite.length ? perSite.map(x => `<div class="bar-r ${x.p == null ? 'na' : (x.p < tg ? 'low' : '')}" title="${esc(x.s.nama)}: ${x.n} evaluasi terverifikasi"><span class="nm">${esc(x.s.nama)}</span><div class="bar-t"><div class="bar-f" style="width:${x.p || 0}%"></div><div class="bar-tg" style="left:${tg}%"></div></div><span class="pv">${x.p == null ? '<span class="muted small">Belum</span>' : fpct(x.p)}</span></div>`).join('') : kosong('apartment', 'Tidak ada site', '')}</div>
      ${rendah.length ? `<div class="note r mt16">${ic('warning')}<div>${rendah.length} site berada di bawah ambang batas mandatori ${tg}% (${rendah.map(x => esc(x.s.nama)).join(', ')}).</div></div>` : ''}</div>
      <div class="card-f"><button class="lnk" data-act="go" data-sec="evaluasi">Buka Analisis Matriks Lengkap ${ic('arrow_forward', 's')}</button></div></div>
    <div class="col" style="gap:16px">
      <div class="card"><div class="card-h"><div class="sp"><h3>Distribusi Kepatuhan &amp; Izin</h3><p>Status agregat ${S.ui.site === 'ALL' ? 'seluruh site' : esc(namaSite(S.ui.site))}</p></div></div>
        <div class="card-b"><div class="ptabs mb16" role="tablist">${[['izin', 'Status Izin'], ['eval', 'Hasil Evaluasi'], ['rtp', 'Progres RTP']].map(([k, l]) => `<button class="${tabD === k ? 'on' : ''}" data-act="dash-donut" data-v="${k}">${l}</button>`).join('')}</div>
        <div class="donut-w"><div class="donut"><canvas id="dnDash" width="180" height="180" aria-label="${esc(DON.t)}" role="img"></canvas><div class="dc"><b>${nf(DON.d.reduce((a, d) => a + d.v, 0))}</b><span>${esc(DON.c)}</span></div></div>${legenda(DON.d)}</div></div></div>
      <div class="card"><div class="card-h"><div class="ic">${ic('auto_awesome')}</div><div><h3>Insight Otomatis</h3><p>Analisis aturan dari data terkini</p></div></div><div class="card-b insight"><ul>${ins.map(x => `<li>${ic('arrow_right')}<span>${x}</span></li>`).join('')}</ul></div></div>
    </div>
  </div>
  <div class="grid g2">
    <div class="card"><div class="card-h"><div class="ic" style="background:var(--r-t);color:var(--r)">${ic('warning')}</div><div class="sp"><h3>Perlu Tindakan Segera</h3><p>Izin ≤ 30 hari / kedaluwarsa dan RTP jatuh tempo</p></div>${tindak.length ? `<span class="pill r">${tindak.length} tindakan</span>` : ''}</div>
      ${tindak.length ? `<div class="tblw"><table class="tbl cards"><thead><tr><th>Kategori &amp; Dokumen</th><th>Site &amp; PIC</th><th>Sisa Waktu</th><th>Status</th></tr></thead><tbody>${tindak.slice(0, 6).map(x => `<tr class="clk" data-act="${x.sec === 'rtp' ? 'buka-rtp' : 'go'}" data-sec="${x.sec}" data-id="${esc(x.id)}" tabindex="0"><td data-l="Dokumen"><div class="t1 clamp2">${esc(x.t)}</div><div class="t2">${x.k} • ${esc(x.s2)}</div></td><td data-l="Site & PIC"><div>${esc(namaSite(x.site))}</div><div class="t2">${esc(namaUser(x.pic))}</div></td><td data-l="Sisa" class="nowrap ${x.w < 0 ? 't-r b6' : 't-a b6'}">${esc(x.sisa)}</td><td data-l="Status">${pill(x.st)}</td></tr>`).join('')}</tbody></table></div>` : kosong('task_alt', 'Tidak ada tindakan mendesak', 'Semua izin dan RTP dalam batas waktu aman.')}
      <div class="card-f">Menampilkan ${Math.min(6, tindak.length)} dari ${tindak.length} item kritis<span class="sp"></span><button class="lnk" data-act="go" data-sec="reg2">Lihat Register Izin ${ic('arrow_forward', 's')}</button></div></div>
    ${is(R.CORP) ? `<div class="card"><div class="card-h"><div class="ic">${ic('policy')}</div><div class="sp"><h3>Temuan Regulasi Terbaru Portal Resmi</h3><p>Hasil penelusuran bot dari JDIH &amp; portal kementerian</p></div>${antM.length ? `<span class="pill o">${antM.length} menunggu</span>` : ''}</div>
      ${antM.length ? `<div class="tblw"><table class="tbl cards"><thead><tr><th>Sumber</th><th>Nomor &amp; Judul</th><th>Karakteristik</th><th>Ditemukan</th></tr></thead><tbody>${antM.slice().sort((a, b) => String(b.tanggal_ditemukan).localeCompare(a.tanggal_ditemukan)).slice(0, 5).map(a => `<tr class="clk" data-act="go" data-sec="verifikasi" data-id="${esc(a.id_antrean)}" tabindex="0"><td data-l="Sumber" class="small">${esc(a.sumber_portal)}</td><td data-l="Regulasi"><div class="t1 clamp2">${esc(a.judul)}</div><div class="t2">${esc(a.bentuk)} No. ${esc(a.nomor || '–')} / ${esc(a.tahun || '–')}</div></td><td data-l="Jenis">${pill(a.jenis_temuan)}</td><td data-l="Ditemukan" class="small nowrap">${fmtWkt(a.tanggal_ditemukan)}</td></tr>`).join('')}</tbody></table></div>` : kosong('inbox', 'Antrean kosong', 'Tidak ada temuan yang menunggu verifikasi.')}
      <div class="card-f">Sistem mengevaluasi keterkaitan klausul secara otomatis<span class="sp"></span><button class="lnk" data-act="go" data-sec="pencarian" data-tab="antrean">Buka Antrean ${ic('arrow_forward', 's')}</button></div></div>`
      : `<div class="card"><div class="card-h"><div class="ic">${ic('menu_book')}</div><div class="sp"><h3>Regulasi Terbaru di Register 1</h3><p>Diverifikasi SHEC Corporate</p></div></div>
      <div class="tblw"><table class="tbl cards"><thead><tr><th>Regulasi</th><th>Jenis</th><th>Diverifikasi</th></tr></thead><tbody>${reg1.slice().sort((a, b) => String(b.tanggal_verifikasi).localeCompare(a.tanggal_verifikasi)).slice(0, 5).map(r => `<tr class="clk" data-act="go" data-sec="reg1d" data-id="${esc(r.id_reg1)}" tabindex="0"><td data-l="Regulasi"><div class="t1">${esc(judulReg(r))}</div><div class="t2 clamp2">${esc(r.judul)}</div></td><td data-l="Jenis">${pill(r.jenis_peraturan, 'o', false)}</td><td data-l="Tanggal" class="small nowrap">${fmtTgl(r.tanggal_verifikasi)}</td></tr>`).join('')}</tbody></table></div></div>`}
  </div>`;
  donut('dnDash', DON.d);
};
CH.dash = t => { S.ui.dash[t.dataset.k] = t.value; renderSec('dashboard'); };
ACT['dash-donut'] = t => { S.ui.dash.donut = t.dataset.v; renderSec('dashboard'); };
ACT['buka-rtp'] = t => { S.ui.tab.evaluasi = 'rtp'; go('evaluasi'); bukaRtp(t.dataset.id); };

function dashPIC(el) {
  const me = S.me.nrp;
  const izin = D.reg2().filter(r => r.pic_nrp === me || r.departemen === S.me.departemen);
  const milik = izin.filter(r => r.pic_nrp === me);
  const rtps = D.rtp().filter(r => r.pic_nrp === me), ovd = rtps.filter(r => stRtp(r) === 'Overdue'), open = rtps.filter(r => ['Open', 'Overdue'].includes(stRtp(r)));
  const kw = (S.data.kewajiban || []).filter(k => aktif(k) && k.departemen_penanggung_jawab === S.me.departemen);
  const tugas = [];
  milik.forEach(r => { const s = sisaHari(r.tanggal_kedaluwarsa); if (s != null && s <= ambang()) tugas.push({ k: 'Izin', t: r.nama_dokumen, s2: r.nomor_dokumen, w: s, sisa: s < 0 ? `Kedaluwarsa ${-s} hari` : `H-${s}`, st: stIzin(r), act: 'go', sec: 'reg2d', id: r.id_izin }); });
  rtps.forEach(r => { const st = stRtp(r); if (st === 'Closed') return; const s = selisih(today(), r.due_date); tugas.push({ k: 'RTP', t: r.tindakan_perbaikan, s2: r.id_rtp, w: st === 'Diajukan' ? 999 : s, sisa: st === 'Diajukan' ? 'Menunggu verifikasi' : (s < 0 ? `Terlambat ${-s} hari` : `H-${s}`), st, act: 'buka-rtp', sec: 'rtp', id: r.id_rtp }); });
  tugas.sort((a, b) => a.w - b.w);
  el.innerHTML = hdr({ title: `Halo, ${esc(S.me.nama.split(' ')[0])} 👋`, sub: `${esc(ROLE_LABEL[S.me.role])} • ${esc(namaDept(S.me.departemen))} • ${esc(namaSite(S.me.site))}. Berikut kewajiban dan tindak lanjut yang ditugaskan kepada Anda.` })
    + `<div class="grid g4 kpis mb16">${kpi({ label: 'Izin/Lisensi Saya', value: nf(milik.length), unit: 'dokumen', icon: 'verified', ic: 'g', act: 'go', sec: 'reg2' })}${kpi({ label: `Kedaluwarsa ≤ ${ambang()} hari`, value: nf(milik.filter(r => stIzin(r) !== 'Aktif').length), icon: 'schedule', ic: 'a', vc: 't-a' })}${kpi({ label: 'RTP Saya (Open)', value: nf(open.length), icon: 'assignment', ic: 'b' })}${kpi({ label: 'RTP Overdue', value: nf(ovd.length), icon: 'assignment_late', ic: 'r', l: ovd.length ? 'r' : '', vc: ovd.length ? 't-r' : '' })}</div>
    <div class="grid g-73"><div class="card"><div class="card-h"><div class="ic">${ic('checklist')}</div><div class="sp"><h3>Tugas Saya</h3><p>Diurutkan dari yang paling mendesak</p></div></div>
      ${tugas.length ? `<div class="tblw"><table class="tbl cards"><thead><tr><th>Tugas</th><th>Sisa Waktu</th><th>Status</th></tr></thead><tbody>${tugas.map(x => `<tr class="clk" data-act="${x.act}" data-sec="${x.sec}" data-id="${esc(x.id)}" tabindex="0"><td data-l="Tugas"><div class="t1">${esc(x.t)}</div><div class="t2">${x.k} • ${esc(x.s2)}</div></td><td data-l="Sisa" class="nowrap b6 ${x.w < 0 ? 't-r' : 't-a'}">${esc(x.sisa)}</td><td data-l="Status">${pill(x.st)}</td></tr>`).join('')}</tbody></table></div>` : kosong('task_alt', 'Tidak ada tugas mendesak', 'Semua kewajiban Anda dalam kondisi aman.')}</div>
      <div class="card"><div class="card-h"><div class="ic">${ic('gavel')}</div><div><h3>Kewajiban Departemen Saya</h3><p>${esc(namaDept(S.me.departemen))}</p></div></div><div class="card-b"><div class="kpi-v">${nf(kw.length)}<small>kewajiban pasal</small></div><p class="muted small">Dari ${new Set(kw.map(k => k.id_reg1)).size} regulasi aktif di Register 1.</p><button class="btn t blk" data-act="go" data-sec="reg1">${ic('menu_book')} Lihat Regulasi Terkait</button></div></div></div>`;
}

/* ───────────── HALAMAN: PENCARIAN REGULASI ───────────── */
HAL.pencarian = el => {
  const tab = S.ui.tab.pencarian || 'cari';
  const nM = D.antrean().filter(a => a.status === 'Menunggu').length;
  el.innerHTML = hdr({
    crumbs: [['Dashboard', 'dashboard'], ['Pencarian Regulasi']], title: 'Pencarian Regulasi &amp; Pemantauan Portal', tag: 'Otomasi Crawler',
    sub: 'Perayapan portal resmi pemerintah (ESDM, Kemnaker, KLHK, BSN, dll.). Seluruh temuan <b>wajib diverifikasi SHEC Corporate</b> sebelum masuk Register 1.',
    actions: can.usul() ? `<button class="btn" data-act="usul">${ic('add_circle')} Usulkan Regulasi</button>` : ''
  }) + `<div class="tabs" role="tablist"><button class="tab ${tab === 'cari' ? 'on' : ''}" role="tab" data-act="tab" data-g="pencarian" data-v="cari">${ic('travel_explore', 's')} Pencarian &amp; Status Portal</button><button class="tab ${tab === 'antrean' ? 'on' : ''}" role="tab" data-act="tab" data-g="pencarian" data-v="antrean">${ic('inbox', 's')} ${is(R.CORP) ? 'Antrean Verifikasi' : 'Usulan Saya'} ${nM ? `<span class="cnt">${nM}</span>` : ''}</button></div>`
    + (tab === 'cari' ? pencarianCari() : pencarianAntrean());
};
function initCari() {
  if (S.ui.cari) return S.ui.cari;
  const y = new Date().getFullYear();
  const kata = (S.data.kata || []).filter(k => k.aktif === 'TRUE');
  return (S.ui.cari = { sumber: new Set((S.data.portal || []).filter(p => p.aktif === 'TRUE' && p.url_pencarian).map(p => p.id)), kata: new Set(kata.slice(0, 4).map(k => k.kata)), ekstra: [], dari: y - 1, sampai: y, bentuk: 'Semua', jalan: false, hasil: null });
}
function pencarianCari() {
  const portals = S.data.portal || [], kata = (S.data.kata || []).filter(k => k.aktif === 'TRUE');
  let h = '';
  if (is(R.CORP)) {
    const C = initCari(), kuota = Number(cfg('kuota_urlfetch', 20000)), pakai = S.stat.urlfetchHariIni || 0;
    const nKata = C.kata.size + C.ekstra.length, nReq = Array.from(C.sumber).reduce((a, id) => { const p = I().portal[id]; return a + (p && String(p.url_pencarian).includes('{q}') ? Math.max(1, nKata) : 1); }, 0);
    h += `<div class="card mb16"><div class="card-h"><div class="ic">${ic('manage_search')}</div><div class="sp"><h3>Jalankan Pencarian Regulasi Manual</h3><p>Cari peraturan &amp; standar terbaru langsung dari portal resmi kementerian dan lembaga.</p></div>
      <div style="text-align:right"><div class="xsmall muted b6">KUOTA URLFETCH HARI INI</div><div class="b7 tnum">${nf(pakai)} / ${nf(kuota)}</div></div></div><div class="card-b">
      <div class="row mb8"><div class="flbl sp">PILIH SUMBER PORTAL RESMI KEMENTERIAN &amp; LEMBAGA</div><button class="lnk small" data-act="cari-semua">Pilih semua portal aktif</button></div>
      <div class="grid g3">${portals.map(p => `<label class="pcard ${C.sumber.has(p.id) ? 'on' : ''}"><input type="checkbox" data-ch="cari-src" value="${esc(p.id)}" ${C.sumber.has(p.id) ? 'checked' : ''} ${C.jalan ? 'disabled' : ''}><div style="min-width:0;flex:1"><div class="row"><b class="sp">${esc(p.nama)}</b>${p.aktif === 'TRUE' ? pill('Aktif', 'g', false) : pill('Nonaktif', 'n', false)}</div><span>${esc(p.deskripsi || p.kategori)}</span><div class="u">${ic('link', 'xs')} ${esc(host(p.url_beranda))}${p.url_pencarian ? '' : ' • <i>tanpa URL pencarian</i>'}</div></div></label>`).join('') || kosong('public_off', 'Belum ada sumber portal', 'Tambahkan di Pengaturan → Sumber Portal.')}</div>
      <div class="card flat mt16" style="background:var(--sf2)"><div class="card-b">
        <div class="flbl mb8">KATA KUNCI &amp; TAG TEMATIK SHEC <span class="muted" style="font-weight:500">(maks. 10)</span></div>
        <div class="row wrap">${kata.map(k => `<button class="chip ${C.kata.has(k.kata) ? 'on' : ''}" data-act="cari-kata" data-v="${esc(k.kata)}" ${C.jalan ? 'disabled' : ''} aria-pressed="${C.kata.has(k.kata)}">${C.kata.has(k.kata) ? ic('check', 'xs') : ''}${esc(k.kata)}</button>`).join('')}
          ${C.ekstra.map((k, i) => `<span class="chip kw">${esc(k)}<span class="ms x" data-act="cari-hapus" data-i="${i}" role="button" tabindex="0" aria-label="Hapus ${esc(k)}">close</span></span>`).join('')}
          <span class="row" style="gap:6px"><input class="inp" id="cariKw" placeholder="+ Tambah kata kunci…" style="height:30px;width:200px" maxlength="80" aria-label="Kata kunci tambahan"><button class="btn sm t" data-act="cari-tambah">${ic('add')} Tambah</button></span></div>
        <div class="grid g3 mt16">${fld({ n: 'dari', l: 'Periode terbitan dari', t: 'select', opts: tahunOpts(), v: C.dari, ph: false, ch: 'cari-opt' })}${fld({ n: 'sampai', l: 'Sampai tahun', t: 'select', opts: tahunOpts(), v: C.sampai, ph: false, ch: 'cari-opt' })}${fld({ n: 'bentuk', l: 'Lingkup dokumen', t: 'select', opts: [['Semua', 'Semua jenis (UU, PP, Permen, SNI…)']].concat(BENTUK), v: C.bentuk, ph: false, ch: 'cari-opt' })}</div>
      </div></div>
      <div class="row wrap mt16" style="gap:10px"><div class="note b sp" style="padding:8px 12px;min-width:260px">${ic('info')}<div>Pencarian berjalan paralel (batch UrlFetchApp) — estimasi <b>${nReq}</b> permintaan. Hasil <b>selalu</b> masuk Antrean Verifikasi, tidak langsung ke Register 1.</div></div>
        <button class="btn gh" data-act="cari-reset" ${C.jalan ? 'disabled' : ''}>Reset Parameter</button>
        <button class="btn p lg" data-act="cari-jalan" ${C.jalan || !C.sumber.size ? 'disabled' : ''}>${C.jalan ? '<span class="spin s w"></span> Mencari di portal…' : ic('travel_explore') + ' Cari Sekarang (Fetch Portal)'}</button></div>
      ${C.jalan ? `<div class="note o mt12">${ic('hourglass_top')}<div><b>Memeriksa ${C.sumber.size} portal…</b> Biasanya 10–60 detik tergantung respons server pemerintah. Anda boleh berpindah menu — hasil tetap diproses dan masuk antrean.</div></div>` : ''}
      ${C.hasil ? hasilCari(C.hasil) : ''}
    </div></div>`;
  } else {
    h += `<div class="note b mb16">${ic('info')}<div>Pemantauan portal resmi dijalankan otomatis oleh SHEC Corporate setiap minggu. Bila Anda menemukan regulasi relevan yang belum terdaftar, gunakan tombol <b>Usulkan Regulasi</b>.</div></div>`;
  }
  h += manualLinkCard();
  const port = S.data.portal || [];
  h += `<div class="card mb16"><div class="card-h"><div class="ic">${ic('monitor_heart')}</div><div class="sp"><h3>Status Pemeriksaan Otomatis Portal Resmi</h3><p>Trigger mingguan (${esc(cfg('jadwal_portal', 'Senin 01:00 WIB'))}) &amp; integritas hash konten</p></div><span class="pill g">${ic('event', 'xs')} Berikutnya: ${esc(seninBerikut())}</span></div>
    ${tabel('portalst', { key: 'id', rows: port, semua: true, kartu: true, empty: kosong('public_off', 'Belum ada sumber portal', ''), cols: [
      { l: 'Portal Resmi', r: p => `<div class="t1">${esc(p.nama)}</div><div class="t2">${esc(host(p.url_beranda))} • ${esc(p.kategori)}</div>` },
      { l: 'Pemeriksaan Terakhir', r: p => `<span class="small nowrap">${p.terakhir_dicek ? fmtWkt(p.terakhir_dicek) : '–'}</span>` },
      { l: 'Status Respons', r: p => pill(p.status_terakhir || 'Belum dicek') + (p.aktif !== 'TRUE' ? ' ' + pill('Nonaktif', 'n', false) : '') },
      { l: 'Temuan', cls: 'num', r: p => `<b class="tnum">${nf(p.temuan_terakhir)}</b>` },
      { l: 'Keterangan', r: p => `<span class="small muted clamp2" title="${esc(p.pesan_terakhir)}">${esc(p.pesan_terakhir || '–')}</span>` },
      { l: '', cls: 'act', r: p => is(R.CORP) ? `<button class="btn sm" data-act="portal-uji" data-id="${esc(p.id)}">${ic('network_check')} Uji</button> <button class="btn sm t" data-act="portal-cek" data-id="${esc(p.id)}" ${p.aktif !== 'TRUE' || (S.ui.cari && S.ui.cari.jalan) ? 'disabled' : ''}>${ic('refresh')} Cek Ulang</button>` : '' }
    ] })}</div>`;
  if (is(R.CORP)) {
    const antM = D.antrean().filter(a => a.status === 'Menunggu').sort((a, b) => String(b.tanggal_ditemukan).localeCompare(a.tanggal_ditemukan));
    h += `<div class="card"><div class="card-h"><div class="ic">${ic('new_releases')}</div><div class="sp"><h3>Hasil Temuan Baru Menunggu Verifikasi Corporate</h3><p>Ditemukan <b>${antM.length}</b> regulasi baru/berubah yang belum terdaftar di Register 1</p></div><button class="btn p" data-act="tab" data-g="pencarian" data-v="antrean">Buka Antrean Verifikasi ${ic('arrow_forward')}</button></div>
      ${tabel('antbaru', { key: 'id_antrean', rows: antM.slice(0, 5), semua: true, rowAct: 'ant-buka', empty: kosong('inbox', 'Antrean kosong', 'Tidak ada temuan yang menunggu verifikasi.'), cols: kolomAntrean() })}</div>`;
  }
  return h;
}
function hasilCari(h) {
  const log = h.log || {};
  return `<div class="card flat mt16"><div class="card-h"><div class="ic" style="background:var(--g-t);color:var(--g)">${ic('task_alt')}</div><div class="sp"><h3>Hasil Pencarian</h3><p><b>${h.baru.length}</b> temuan baru masuk antrean verifikasi${h.selesai ? '' : ' • sebagian permintaan dilewati karena batas waktu'}</p></div>${h.baru.length ? `<button class="btn t" data-act="tab" data-g="pencarian" data-v="antrean">Tinjau Temuan ${ic('arrow_forward')}</button>` : ''}</div>
    <div class="card-b"><div class="grid g3">${Object.keys(log).map(id => { const L = log[id], p = I().portal[id] || { nama: id }; const st = L.gagal && !L.ok ? 'Gagal' : (L.gagal ? 'Sebagian' : 'Berhasil'); return `<div class="file" style="align-items:flex-start"><div class="fic ${st === 'Berhasil' ? 'img' : ''}" style="${st === 'Berhasil' ? 'background:var(--g-t);color:var(--g)' : ''}">${ic(st === 'Berhasil' ? 'check' : 'error')}</div><div class="fn"><b>${esc(p.nama)}</b><span>${pill(st)} ${L.item} item terbaca${L.pesan.length ? ' • ' + esc(L.pesan[0]) : ''}</span></div></div>`; }).join('')}</div>
    ${h.baru.length ? `<div class="mt12">${h.baru.slice(0, 6).map(b => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--bd3)">${pill(b.jenis_temuan)}<span class="small sp">${esc(b.judul)}</span><span class="xsmall muted">${esc(b.sumber_portal)}</span></div>`).join('')}</div>` : `<div class="note b mt12">${ic('info')}<div>Tidak ada regulasi baru. Bila portal berstatus Gagal/Sebagian, periksa URL pencarian di Pengaturan → Sumber Portal dengan tombol <b>Uji</b>.</div></div>`}</div></div>`;
}

/* ── Link Pencarian Manual (fallback klien: portal pemerintah memblokir UrlFetchApp server) ── */
function initLM() { return S.ui.lm || (S.ui.lm = { q: '' }); }
/** Tebak kategori Kata_Kunci yang relevan dengan keyword user (cocok substring/overlap kata, case-insensitive). */
function kategoriTebak(q) {
  const ql = String(q || '').toLowerCase().trim();
  if (!ql) return '';
  const daftar = (S.data.kata || []).filter(k => k.aktif === 'TRUE' && k.kata);
  const qw = ql.split(/\s+/).filter(Boolean);
  let terbaik = null, skor = 0;
  daftar.forEach(k => {
    const kl = String(k.kata).toLowerCase();
    if (!kl) return;
    let s = 0;
    if (ql === kl) s = 100;
    else if (ql.includes(kl) || kl.includes(ql)) s = 50 + Math.min(kl.length, ql.length);
    else { const kw = kl.split(/\s+/).filter(Boolean); s = qw.filter(w => kw.includes(w)).length * 10; }
    if (s > skor) { skor = s; terbaik = k; }
  });
  return skor > 0 ? terbaik.kategori : '';
}
/** Bangun daftar tautan pencarian manual dari Sumber_Portal aktif (klien saja, tanpa UrlFetchApp server). */
function linkManualList(qRaw) {
  const q = String(qRaw || '').trim();
  const kategori = kategoriTebak(q);
  const portals = (S.data.portal || []).filter(p => p.aktif === 'TRUE');
  const items = portals.map(p => {
    const tpl = String(p.url_pencarian || '').trim();
    const url = (q && tpl.indexOf('{q}') >= 0) ? tpl.replace(/\{q\}/g, encodeURIComponent(q)) : (p.url_beranda || tpl || '');
    return { p, url, cocok: !!kategori && p.kategori === kategori };
  }).filter(x => x.url);
  items.sort((a, b) => (b.cocok - a.cocok));
  return { kategori, items };
}
function manualLinkItem(x) {
  const p = x.p;
  return `<a class="pcard" href="${esc(x.url)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none${x.cocok ? ';border-color:var(--o-b);background:#FFFAF5' : ''}">
    <div style="min-width:0;flex:1"><div class="row"><b class="sp">${esc(p.nama)}</b>${x.cocok ? pill('Disarankan', 'o', false) : ''}${ic('open_in_new', 'xs muted')}</div>
    <span>${esc(p.deskripsi || p.kategori)}</span>
    <div class="u">${ic('link', 'xs')} ${esc(host(p.url_beranda))}</div></div></a>`;
}
function manualLinkCard() {
  const LM = initLM();
  const { kategori, items } = linkManualList(LM.q);
  return `<div class="card mb16"><div class="card-h"><div class="ic">${ic('link')}</div><div class="sp"><h3>Cari Manual di Portal Resmi</h3><p>Buka pencarian portal resmi langsung dari browser Anda — tetap bekerja walau pencarian otomatis di atas gagal/diblokir oleh portal pemerintah.</p></div></div>
    <div class="card-b">
      <div class="fld"><label for="f_lmq">Kata kunci pencarian</label>
        <div class="srch" style="position:relative">${ic('search')}<input class="inp" id="f_lmq" data-in="lm-q" value="${esc(LM.q)}" placeholder="Contoh: juru las, riksa uji, limbah B3…" maxlength="80" autocomplete="off"></div>
        <div class="help">${kategori ? `Kategori tersarankan: <b>${esc(kategori)}</b> (dari Kata Kunci terdaftar) — portal kategori ini ditampilkan lebih dulu. Portal lain tetap tersedia di bawah.` : 'Ketik kata kunci untuk membuka pencarian pada semua portal resmi aktif sekaligus di tab baru.'}</div>
      </div>
      ${items.length ? `<div class="grid g3 mt12">${items.map(manualLinkItem).join('')}</div>` : `<div class="mt12">${kosong('public_off', 'Belum ada sumber portal aktif', 'Tambahkan atau aktifkan sumber portal di Pengaturan → Sumber Portal.')}</div>`}
      <div class="note b mt12">${ic('info')}<div>Tautan dibuka di tab baru dari komputer Anda sendiri (bukan server aplikasi), sehingga tidak diblokir seperti pencarian otomatis. Menemukan regulasi yang relevan? Klik <b>Usulkan Regulasi</b> di atas untuk mengajukannya ke SHEC Corporate.</div></div>
    </div></div>`;
}
Object.assign(ACT, {
  'cari-semua': () => { const C = initCari(); C.sumber = new Set((S.data.portal || []).filter(p => p.aktif === 'TRUE' && p.url_pencarian).map(p => p.id)); renderSec('pencarian'); },
  'cari-kata': t => { const C = initCari(), v = t.dataset.v; if (C.kata.has(v)) C.kata.delete(v); else if (C.kata.size + C.ekstra.length < 10) C.kata.add(v); else toast('Maksimal 10 kata kunci per pencarian.', 'warning'); renderSec('pencarian'); },
  'cari-tambah': () => { const C = initCari(), i = $('#cariKw'), v = (i.value || '').trim(); if (!v) { i.focus(); return; } if (C.kata.size + C.ekstra.length >= 10) { toast('Maksimal 10 kata kunci per pencarian.', 'warning'); return; } if (!C.ekstra.includes(v) && !C.kata.has(v)) C.ekstra.push(v); renderSec('pencarian'); },
  'cari-hapus': t => { const C = initCari(); C.ekstra.splice(Number(t.dataset.i), 1); renderSec('pencarian'); },
  'cari-reset': () => { S.ui.cari = null; renderSec('pencarian'); },
  'cari-jalan': () => { const C = initCari(); jalankanCari(Array.from(C.sumber), Array.from(C.kata).concat(C.ekstra)); },
  'portal-cek': t => { const C = initCari(); C.sumber = new Set([t.dataset.id]); jalankanCari([t.dataset.id], (S.data.kata || []).filter(k => k.aktif === 'TRUE').map(k => k.kata).slice(0, 10)); },
  'portal-uji': async t => {
    const p = I().portal[t.dataset.id]; if (!p) return;
    busy(t, true, 'Menguji…');
    try {
      const res = await api('portal.uji', { id: p.id, kata: (S.data.kata || []).filter(k => k.aktif === 'TRUE').map(k => k.kata)[0] || 'pertambangan' });
      const d = res.data;
      modal({ title: 'Uji Koneksi: ' + p.nama, sub: res.message, icon: d.kode < 300 ? 'check_circle' : 'error', icCls: d.kode < 300 ? 'g' : 'r', body: `<dl class="dl"><div><dt>Kode HTTP</dt><dd>${esc(d.kode)}</dd></div><div><dt>Waktu respons</dt><dd>${nf(d.ms)} ms</dd></div><div class="full"><dt>URL diuji</dt><dd class="mono" style="word-break:break-all">${esc(d.url)}</dd></div><div class="full"><dt>Contoh item terbaca (${d.jumlah})</dt><dd>${d.contoh.length ? '<ul style="margin:4px 0 0;padding-left:18px">' + d.contoh.map(c => `<li class="small">${esc(c)}</li>`).join('') + '</ul>' : '<span class="muted">Tidak ada item regulasi yang terbaca. Sesuaikan URL pencarian atau isi "Pola item (regex)" di Pengaturan.</span>'}</dd></div></dl>`, foot: '<button class="btn p" data-act="mclose">Tutup</button>' });
    } catch (e) { toast(e.message, 'error', 'Uji koneksi gagal'); } finally { busy(t, false); }
  }
});
CH['cari-src'] = t => { const C = initCari(); if (t.checked) C.sumber.add(t.value); else C.sumber.delete(t.value); renderSec('pencarian'); };
CH['cari-opt'] = t => { const C = initCari(); C[t.name] = t.name === 'bentuk' ? t.value : Number(t.value); renderSec('pencarian'); };
async function jalankanCari(ids, kata) {
  const C = initCari();
  if (Number(C.dari) > Number(C.sampai)) { toast('Tahun "dari" tidak boleh melebihi "sampai".', 'warning'); return; }
  C.jalan = true; C.hasil = null; if (S.ui.sec === 'pencarian') renderSec('pencarian');
  try {
    const res = await api('portal.cari', { sumberIds: ids, kata, tahunDari: C.dari, tahunSampai: C.sampai, bentuk: C.bentuk });
    C.hasil = res.data;
    (res.data.baru || []).forEach(b => upsert('antrean', 'id_antrean', b)); S.idx = null;
    toast(res.message, res.data.baru.length ? 'success' : 'info', 'Pencarian selesai');
    jadwalSync(200);
  } catch (e) { toast(e.message, 'error', 'Pencarian gagal'); }
  finally { C.jalan = false; if (S.ui.sec === 'pencarian') renderSec('pencarian'); renderNav(); }
}

/* ── Antrean verifikasi ── */
function kolomAntrean() {
  return [
    { l: 'ID & Tanggal', r: a => `<div class="idc">${esc(a.id_antrean)}</div><div class="t2 nowrap">${fmtWkt(a.tanggal_ditemukan)}</div>` },
    { l: 'Nomor & Judul Regulasi', r: a => `<div class="t1 clamp2">${esc(a.judul)}</div><div class="t2">${esc(a.bentuk || '–')} No. ${esc(a.nomor || '–')} Tahun ${esc(a.tahun || '–')}</div>` },
    { l: 'Sumber', r: a => `<span class="small">${esc(a.sumber_portal)}</span>${a.pengusul && a.pengusul !== 'BOT' ? `<div class="t2">Usulan ${esc(namaUser(a.pengusul))}</div>` : ''}` },
    { l: 'Kategori', r: a => pill(a.jenis || 'Lainnya', 'o', false) },
    { l: 'Implikasi', r: a => pill(a.jenis_temuan) },
    { l: 'Status', r: a => pill(a.status) },
    { l: '', cls: 'act', r: a => `<button class="btn sm ${a.status === 'Menunggu' && is(R.CORP) ? 't' : ''}" data-act="ant-buka" data-id="${esc(a.id_antrean)}">${a.status === 'Menunggu' && is(R.CORP) ? 'Telaah' : 'Lihat'}</button>` }
  ];
}
function pencarianAntrean() {
  const st = tst('ant', { status: is(R.CORP) ? 'Menunggu' : 'ALL', jt: 'ALL', src: 'ALL' });
  const all = D.antrean();
  const rows = all.filter(a => (st.status === 'ALL' || a.status === st.status) && (st.jt === 'ALL' || a.jenis_temuan === st.jt) && (st.src === 'ALL' || a.sumber_portal === st.src) && cari(st.q, a.id_antrean, a.judul, a.nomor, a.tahun, a.sumber_portal, a.bentuk))
    .sort((a, b) => String(b.tanggal_ditemukan).localeCompare(a.tanggal_ditemukan));
  const sumber = Array.from(new Set(all.map(a => a.sumber_portal))).sort();
  return `<div class="card"><div class="fbar"><div class="srch">${ic('search')}<input class="inp" id="antQ" data-in="q" data-t="ant" value="${esc(st.q)}" placeholder="Cari ID, nomor, judul, sumber…" aria-label="Cari antrean"></div>
    <select class="inp" data-ch="flt" data-t="ant" data-k="status" aria-label="Status">${opsi([['ALL', 'Semua status'], 'Menunggu', 'Disetujui', 'Ditolak', 'Duplikat'], st.status)}</select>
    <select class="inp" data-ch="flt" data-t="ant" data-k="jt" aria-label="Jenis temuan">${opsi([['ALL', 'Semua jenis temuan'], 'Baru', 'Perubahan', 'Pencabutan'], st.jt)}</select>
    <select class="inp" data-ch="flt" data-t="ant" data-k="src" aria-label="Sumber">${opsi([['ALL', 'Semua sumber']].concat(sumber), st.src)}</select></div>
    ${tabel('ant', { key: 'id_antrean', rows, pilih: is(R.CORP), rowAct: 'ant-buka', unit: 'temuan', bulk: `<button class="btn sm" data-act="ant-dup">${ic('content_copy')} Tandai Duplikat</button><button class="btn sm do" data-act="ant-tolak">${ic('block')} Tolak Terpilih</button>`, empty: kosong('inbox', is(R.CORP) ? 'Tidak ada temuan' : 'Belum ada usulan', is(R.CORP) ? 'Ubah filter status untuk melihat riwayat verifikasi.' : 'Usulan regulasi Anda akan tampil di sini beserta status verifikasinya.'), cols: kolomAntrean() })}</div>`;
}
Object.assign(ACT, {
  'ant-buka': t => {
    const a = I().ant[t.dataset.id]; if (!a) return;
    if (is(R.CORP)) { go('verifikasi', { id: a.id_antrean }); return; }
    const lampA = lampiran('ANT', a.id_antrean), bolehUnggahA = a.status === 'Menunggu' && a.pengusul === S.me.nrp;
    modal({ title: a.judul, sub: `${a.id_antrean} • ${a.sumber_portal}`, icon: 'policy', size: 'lg', body: `<div class="row wrap mb12">${pill(a.jenis_temuan)} ${pill(a.status)}</div><dl class="dl"><div><dt>Bentuk</dt><dd>${esc(a.bentuk || '–')}</dd></div><div><dt>Nomor / Tahun</dt><dd>${esc(a.nomor)} / ${esc(a.tahun)}</dd></div><div><dt>Diusulkan</dt><dd>${fmtWkt(a.tanggal_ditemukan)}</dd></div><div><dt>Diverifikasi</dt><dd>${a.diverifikasi_oleh ? esc(namaUser(a.diverifikasi_oleh)) + ' • ' + fmtWkt(a.tanggal_verifikasi) : '–'}</dd></div><div class="full"><dt>Catatan verifikasi</dt><dd>${esc(a.catatan_verifikasi || '–')}</dd></div>${a.id_reg1 ? `<div class="full"><dt>Register 1</dt><dd><button class="lnk" data-act="go" data-sec="reg1d" data-id="${esc(a.id_reg1)}">${esc(a.id_reg1)} ${ic('arrow_forward', 's')}</button></dd></div>` : ''}</dl>
      <div class="fsec"><span class="bar"></span>Naskah PDF &amp; Saran Elemen SMKP</div>
      <div class="col" style="gap:10px">${daftarBerkas(lampA, { hapus: a.pengusul === S.me.nrp, teksKosong: 'Belum ada naskah PDF terlampir.' })}${bolehUnggahA ? zonaUnggah('ANT', a.id_antrean, a.site_pengusul, 'Tarik & letakkan naskah PDF di sini atau klik untuk memilih') : ''}${a.elemen_smkp_disarankan ? smkpBadges(a.elemen_smkp_disarankan, 'o') : ''}</div>`, foot: '<button class="btn p" data-act="mclose">Tutup</button>' });
  },
  'ant-dup': async () => {
    const ids = Array.from(S.ui.sel.ant || []); if (!ids.length) return;
    if (!await konfirmasi({ title: `Tandai ${ids.length} temuan sebagai duplikat?`, msg: 'Temuan tidak akan masuk Register 1.', ok: 'Tandai Duplikat' })) return;
    S.ui.sel.ant = new Set();
    kirim('antrean.tolak', { ids, duplikat: true, alasan: 'Ditandai duplikat oleh ' + S.me.nama }, { apply: () => { const u = ids.map(id => upsert('antrean', 'id_antrean', { id_antrean: id, status: 'Duplikat' })); return () => u.forEach(f => f()); } }).catch(() => { });
  },
  'ant-tolak': async () => {
    const ids = Array.from(S.ui.sel.ant || []); if (!ids.length) return;
    const alasan = await konfirmasi({ title: `Tolak ${ids.length} temuan?`, msg: 'Alasan akan dicatat di log audit.', ok: 'Tolak Temuan', danger: true, alasan: true, alasanLabel: 'Alasan penolakan' });
    if (!alasan) return;
    S.ui.sel.ant = new Set();
    kirim('antrean.tolak', { ids, alasan }, { apply: () => { const u = ids.map(id => upsert('antrean', 'id_antrean', { id_antrean: id, status: 'Ditolak', catatan_verifikasi: alasan })); return () => u.forEach(f => f()); } }).catch(() => { });
  },
  usul: () => {
    _usulBerkas = null;
    modal({ title: 'Usulkan Regulasi', sub: 'Usulan masuk Antrean Verifikasi dan wajib disetujui SHEC Corporate.', icon: 'add_circle', size: 'lg', body: `<form id="fUsul" class="frm" novalidate>
      ${fld({ n: 'bentuk', l: 'Bentuk peraturan', t: 'select', opts: BENTUK, req: true })}${fld({ n: 'jenis', l: 'Kategori', t: 'select', opts: JENIS, v: 'Lainnya', req: true })}
      ${fld({ n: 'nomor', l: 'Nomor', req: true, max: 80, ph: 'Contoh: 8' })}${fld({ n: 'tahun', l: 'Tahun', req: true, max: 4, im: 'numeric', ph: '2026' })}
      ${fld({ n: 'judul', l: 'Judul / tentang', t: 'textarea', rows: 2, req: true, full: true, max: 600 })}
      ${fld({ n: 'tautan_sumber', l: 'Tautan sumber resmi', t: 'url', full: true, ph: 'https://jdih…' })}
      ${fld({ n: 'jenis_temuan', l: 'Jenis usulan', t: 'select', opts: ['Baru', 'Perubahan', 'Pencabutan'], v: 'Baru', ph: false })}
      ${fld({ n: 'ringkasan', l: 'Alasan / relevansi', t: 'textarea', rows: 3, full: true, max: 2000, ph: 'Kegiatan site yang terdampak…' })}
      <div class="full">
        <label>Lampiran naskah PDF <span class="muted" style="font-weight:500">(opsional — untuk saran elemen SMKP otomatis)</span></label>
        <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
          <button type="button" class="btn gh" data-act="usul-pilih-pdf">${ic('attach_file')} Pilih berkas PDF</button>
          <span id="usulFileNama" class="small muted">Belum ada berkas dipilih</span>
        </div>
      </div></form>`,
      foot: `<button class="btn gh" data-act="mclose">Batal</button><button class="btn p" data-act="usul-kirim">${ic('send')} Kirim Usulan</button>` });
  },
  'usul-pilih-pdf': () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = '.pdf';
    i.onchange = () => {
      const f = (i.files || [])[0]; if (!f) return;
      const c = cekBerkas(f);
      if (c.err) { toast(c.err, 'error'); return; }
      if (c.mime !== 'application/pdf') { toast(`"${f.name}": hanya berkas PDF yang didukung di sini.`, 'error'); return; }
      _usulBerkas = f;
      const el = $('#usulFileNama'); if (el) el.textContent = `${f.name} (${ukuran(String(f.size))})`;
    };
    i.click();
  },
  'usul-kirim': async t => {
    const f = $('#fUsul');
    if (!validasi(f, x => ({ tahun: /^\d{4}$/.test(x.tahun) ? '' : 'Tahun harus 4 digit.' }))) return;
    try {
      const res = await kirim('antrean.usul', bacaForm(f), { btn: t, txt: 'Mengirim…' });
      upsert('antrean', 'id_antrean', res.data.antrean);
      if (_usulBerkas) { unggah('ANT', res.data.antrean.id_antrean, [_usulBerkas]); _usulBerkas = null; }
      S.idx = null; tutupModal(); rerender(true);
    } catch (e) { /* toast sudah tampil */ }
  }
});

/* ───────────── HALAMAN: VERIFIKASI (split view) ───────────── */
HAL.verifikasi = (el, p) => {
  const a = I().ant[p.id];
  if (!a) { el.innerHTML = kosong('search_off', 'Temuan tidak ditemukan', 'Mungkin sudah dihapus atau Anda tidak memiliki akses.', `<button class="btn p" data-act="go" data-sec="pencarian" data-tab="antrean">Kembali ke Antrean</button>`); return; }
  const lama = a.id_reg1_terkait ? I().reg1[a.id_reg1_terkait] : null;
  const selesai = a.status !== 'Menunggu';
  el.innerHTML = hdr({
    crumbs: [['Pencarian Regulasi', 'pencarian'], ['Antrean Verifikasi', 'pencarian'], ['Tinjau: ' + a.id_antrean]],
    title: 'Tinjau Temuan Regulasi', sub: `${pill(a.jenis_temuan)} ${pill(a.status)} <span class="small">Sumber: <b>${esc(a.sumber_portal)}</b> • Terdeteksi ${fmtWkt(a.tanggal_ditemukan)} WIB • ID ${esc(a.id_antrean)}</span>`,
    actions: `<button class="btn" data-act="ant-kembali">${ic('arrow_back')} Kembali ke Antrean</button>${a.tautan_sumber ? `<a class="btn" href="${esc(a.tautan_sumber)}" target="_blank" rel="noopener noreferrer">${ic('open_in_new')} Buka Dokumen Resmi</a>` : ''}`
  }) + `<div class="grid g-73" style="align-items:start"><div class="col" style="gap:16px">
      <div class="card"><div class="card-h"><div class="ic">${ic('description')}</div><div class="sp"><h3>Data Temuan</h3><p>${a.pengusul === 'BOT' ? `Dideteksi otomatis oleh crawler${a.kata_kunci ? ` (kata kunci "${esc(a.kata_kunci)}")` : ''}` : 'Usulan ' + esc(namaUser(a.pengusul))}</p></div></div>
        <div class="card-b"><h3 style="font-size:16px;line-height:1.4;margin-bottom:12px">${esc(a.judul)}</h3><dl class="dl c3"><div><dt>Bentuk</dt><dd>${esc(a.bentuk || '–')}</dd></div><div><dt>Nomor</dt><dd>${esc(a.nomor || '–')}</dd></div><div><dt>Tahun</dt><dd>${esc(a.tahun || '–')}</dd></div><div><dt>Kategori SHEC</dt><dd>${pill(a.jenis || 'Lainnya', 'o', false)}</dd></div><div><dt>Sumber portal</dt><dd>${esc(a.sumber_portal)}</dd></div><div><dt>Hash konten</dt><dd class="mono" title="${esc(a.hash_konten)}">${esc(String(a.hash_konten || '').slice(0, 12))}…</dd></div>
        <div class="full"><dt>Ringkasan / tentang</dt><dd>${esc(a.ringkasan || '–')}</dd></div><div class="full"><dt>Tautan sumber</dt><dd class="small" style="word-break:break-all">${a.tautan_sumber ? `<a href="${esc(a.tautan_sumber)}" target="_blank" rel="noopener noreferrer">${esc(a.tautan_sumber)}</a>` : '–'}</dd></div></dl></div></div>
      ${lampiranAntreanCard(a)}
      ${lama ? `<div class="card tint"><div class="card-b"><div class="row mb8"><span class="ms t-o">account_tree</span><b class="small sp" style="letter-spacing:.04em">HUBUNGAN SILSILAH REGULASI</b>${pill('Status saat ini: ' + lama.status_berlaku, PILL[lama.status_berlaku], false)}</div>
        <div class="b6">${esc(judulReg(lama))} tentang ${esc(lama.judul)}</div><div class="mono mt8">ID: ${esc(lama.id_reg1)}</div>
        <div class="small mt8 row">${ic('autorenew', 's t-o')} Status regulasi lama akan diperbarui sesuai pilihan "Status regulasi lama" saat disetujui.</div></div></div>
      <div class="card"><div class="card-h"><div class="ic">${ic('difference')}</div><div class="sp"><h3>Komparasi Versi (Diff Viewer)</h3><p>Perbandingan judul regulasi lama dengan temuan terbaru</p></div>${pill(a.jenis_temuan === 'Pencabutan' ? 'MAJOR IMPACT' : 'MODERATE IMPACT', a.jenis_temuan === 'Pencabutan' ? 'r' : 'a')}</div>
        <div class="card-b">${(() => { const [l, r] = diffKata(judulReg(lama) + ' tentang ' + lama.judul, (a.bentuk || '') + ' No. ' + (a.nomor || '') + ' Tahun ' + (a.tahun || '') + ' ' + a.judul); return `<div class="diff"><div><h5><span>${esc(judulReg(lama))} (lama)</span><span>Klausul usang</span></h5>${l}</div><div class="nw"><h5><span>${esc(a.bentuk || '')} ${esc(a.nomor || '')}/${esc(a.tahun || '')} (baru)</span><span class="t-o">Mandatori baru</span></h5>${r}</div></div>`; })()}
        <div class="note b mt12">${ic('info')}<div>Perbandingan pasal penuh dilakukan dengan membuka dokumen resmi. Aplikasi membandingkan metadata &amp; judul untuk membantu telaah awal.</div></div></div></div>` : ''}
    </div><div>${selesai ? hasilVerif(a) : formVerif(a, lama)}</div></div>`;
};
function hasilVerif(a) {
  return `<div class="card"><div class="card-h"><div class="ic">${ic(a.status === 'Disetujui' ? 'verified' : 'block')}</div><div><h3>Hasil Verifikasi</h3><p>Temuan ini sudah diproses</p></div></div><div class="card-b"><dl class="dl"><div><dt>Status</dt><dd>${pill(a.status)}</dd></div><div><dt>Verifikator</dt><dd>${esc(namaUser(a.diverifikasi_oleh))}</dd></div><div><dt>Waktu</dt><dd>${fmtWkt(a.tanggal_verifikasi)}</dd></div>${a.id_reg1 ? `<div><dt>Register 1</dt><dd><button class="lnk" data-act="go" data-sec="reg1d" data-id="${esc(a.id_reg1)}">${esc(a.id_reg1)} ${ic('arrow_forward', 's')}</button></dd></div>` : ''}<div class="full"><dt>Catatan</dt><dd>${esc(a.catatan_verifikasi || '–')}</dd></div></dl></div></div>`;
}
/**
 * Kartu "Berkas Naskah PDF & Saran Elemen SMKP" (FR-12) — dipakai di halaman Tinjau Temuan (CORP) dan
 * modal "Lihat" usulan (SITE pengusul). Mengunggah PDF di sini memicu saran otomatis elemen_smkp_disarankan
 * di server (sekali, saat lampiran PDF baru terpasang) — murni informasional, tidak pernah memblokir apa pun.
 */
function lampiranAntreanCard(a) {
  const lamp = lampiran('ANT', a.id_antrean);
  const bolehUnggah = a.status === 'Menunggu' && (is(R.CORP) || a.pengusul === S.me.nrp);
  return `<div class="card"><div class="card-h"><div class="ic">${ic('picture_as_pdf')}</div><div class="sp"><h3>Berkas Naskah (PDF) &amp; Saran Elemen SMKP</h3><p>Unggah naskah resmi PDF untuk mendapat saran elemen SMKP otomatis (informasional — bukan AI/LLM, pencocokan kata kunci lokal)</p></div></div>
    <div class="card-b col" style="gap:12px">${daftarBerkas(lamp, { hapus: is(R.CORP) || a.pengusul === S.me.nrp, teksKosong: 'Belum ada naskah PDF terlampir.' })}${bolehUnggah ? zonaUnggah('ANT', a.id_antrean, a.site_pengusul, 'Tarik & letakkan naskah PDF di sini atau klik untuk memilih') : ''}
    ${a.elemen_smkp_disarankan ? `<div><div class="xsmall b6 muted mb4">SARAN ELEMEN SMKP (OTOMATIS, DARI PDF TERLAMPIR)</div>${smkpBadges(a.elemen_smkp_disarankan, 'o')}</div>` : (lamp.some(l => l.mime === 'application/pdf') ? `<div class="note b">${ic('info')}<div>Tidak ada saran elemen SMKP yang cocok dari naskah PDF ini, atau ekstraksi teks belum berhasil. SHEC Corporate tetap dapat memilih elemen SMKP secara manual saat menyetujui.</div></div>` : '')}</div></div>`;
}
function barisKw(k, i) {
  k = k || {};
  return `<div class="rep k" data-kw="${i}"><input class="inp" name="kw_pasal" placeholder="Pasal/butir" value="${esc(k.pasal_butir || '')}" maxlength="200" aria-label="Pasal"><select class="inp" name="kw_period" aria-label="Periodisitas">${opsi(['Bulanan', 'Triwulan', 'Semester', 'Tahunan', 'Insidental'], k.periodisitas || 'Semester')}</select><input class="inp" name="kw_uraian" placeholder="Uraian kewajiban yang harus dipenuhi" value="${esc(k.uraian_kewajiban || '')}" maxlength="3000" aria-label="Uraian kewajiban"><button type="button" class="btn gh ic" data-act="kw-hapus" aria-label="Hapus baris">${ic('delete')}</button></div>`;
}
function bacaKw(root) { return $$('[data-kw]', root).map(r => ({ pasal_butir: $('[name=kw_pasal]', r).value.trim(), periodisitas: $('[name=kw_period]', r).value, uraian_kewajiban: $('[name=kw_uraian]', r).value.trim() })).filter(k => k.uraian_kewajiban); }
function formVerif(a, lama) {
  const statusLama = a.jenis_temuan === 'Pencabutan' ? 'Dicabut' : (a.jenis_temuan === 'Perubahan' ? 'Diubah' : '');
  const reg1Opts = (S.data.reg1 || []).filter(aktif).map(r => [r.id_reg1, `${r.id_reg1} — ${judulReg(r)}`]);
  return `<div class="card" style="position:sticky;top:76px"><div class="card-h"><div class="ic">${ic('gavel')}</div><div class="sp"><h3>Formulir Verifikasi SHEC Corporate</h3><p>Lengkapi parameter sebelum menerbitkan ke Register 1</p></div><span class="tag">FR-03</span></div>
    <form class="card-b frm" id="fVerif" novalidate style="max-height:calc(100vh - 230px);overflow:auto">
      <div class="full note b">${ic('person')}<div><b>Verifikator:</b> ${esc(S.me.nama)} (NRP ${esc(S.me.nrp)} — ${esc(ROLE_LABEL[S.me.role])})</div></div>
      <div class="fsec"><span class="bar"></span>1. Identitas Regulasi</div>
      ${fld({ n: 'jenis_peraturan', l: 'Kategori', t: 'select', opts: JENIS, v: a.jenis || 'Lainnya', req: true, ph: false })}${fld({ n: 'bentuk_peraturan', l: 'Bentuk', t: 'select', opts: BENTUK, v: a.bentuk })}
      ${fld({ n: 'nomor', l: 'Nomor', v: a.nomor, req: true, max: 80 })}${fld({ n: 'tahun', l: 'Tahun', v: a.tahun, req: true, max: 4, im: 'numeric' })}
      ${fld({ n: 'judul', l: 'Judul / tentang', t: 'textarea', rows: 2, v: a.judul, req: true, full: true, max: 600 })}
      ${fld({ n: 'tautan_sumber_resmi', l: 'Tautan sumber resmi', t: 'url', v: a.tautan_sumber, full: true })}
      <div class="fsec"><span class="bar"></span>2. Relevansi Kegiatan Operasional</div>
      ${fld({ n: 'relevansi_kegiatan', l: 'Relevansi terhadap kegiatan HMSI', t: 'textarea', rows: 3, req: true, full: true, max: 2000, ph: 'Contoh: Berlaku untuk seluruh armada mobile crane dan workshop maintenance…' })}
      <div class="fsec"><span class="bar"></span>3. Site Berlaku</div>
      ${fld({ n: 'cakupan', l: 'Cakupan site', t: 'select', opts: [['ALL', 'Semua site (distribusi korporat serentak)'], ['SPESIFIK', 'Pilih site spesifik']], v: 'ALL', ph: false, ch: 'cakupan', full: true })}
      <div class="full hide" id="wrapSite">${fld({ n: 'site_berlaku', l: 'Site spesifik', t: 'checks', opts: (S.data.sites || []).filter(s => s.status === 'Aktif').map(s => [s.kode, s.nama]) })}</div>
      <div class="fsec"><span class="bar"></span>4. Keterkaitan SMKP &amp; Silsilah</div>
      <div class="full">${fld({ n: 'keterkaitan_smkp', l: 'Keterkaitan SMKP Minerba', t: 'checks', v: 'II.3,V.3', opts: [['II.3', 'Elemen II.3 — Identifikasi & pemenuhan peraturan'], ['V.3', 'Elemen V.3 — Evaluasi kepatuhan hukum']] })}</div>
      ${fld({ n: 'id_reg1_terkait', l: 'Regulasi terkait (lama)', t: 'select', opts: reg1Opts, v: a.id_reg1_terkait, ph: '— Tidak ada —' })}${fld({ n: 'statusLama', l: 'Status regulasi lama', t: 'select', opts: [['', 'Tidak berubah'], ['Diubah', 'Tandai "Diubah (Amended)"'], ['Dicabut', 'Tandai "Dicabut"']], v: statusLama, ph: false })}
      ${fld({ n: 'status_berlaku', l: 'Status regulasi baru', t: 'select', opts: ['Berlaku', 'Diubah', 'Dicabut'], v: 'Berlaku', ph: false })}
      <div class="fsec"><span class="bar"></span>4b. Elemen SMKP (Taksonomi 51 Sub-Elemen) <span class="muted" style="font-weight:500;text-transform:none;letter-spacing:0">(opsional)</span></div>
      ${a.elemen_smkp_disarankan ? `<div class="full note o">${ic('auto_awesome')}<div><b>Saran otomatis dari PDF terlampir</b> (sudah dicentang di bawah — hanya informasional, periksa &amp; sesuaikan sebelum menyetujui): ${smkpBadges(a.elemen_smkp_disarankan)}</div></div>` : `<div class="full help" style="margin:0 0 4px">Belum ada saran otomatis (PDF belum dilampirkan / tidak ada kecocokan kata kunci). Pilih manual bila relevan — boleh dikosongkan.</div>`}
      <div class="full">${fld({ n: 'elemen_smkp', l: 'Elemen SMKP terkonfirmasi', t: 'checks', v: a.elemen_smkp_disarankan, opts: smkpOpts() })}</div>
      <div class="fsec"><span class="bar"></span>5. Kewajiban Pasal Awal <span class="muted" style="font-weight:500;text-transform:none;letter-spacing:0">(opsional)</span></div>
      <div class="full col" style="gap:8px" id="kwRows"></div><div class="full"><button type="button" class="add-row" data-act="kw-tambah">${ic('add')} Tambah Kewajiban</button></div>
      ${fld({ n: 'catatan', l: 'Catatan telaah hukum & rekomendasi', t: 'textarea', rows: 3, full: true, max: 2000, ph: 'Contoh: Wajib sosialisasi ke seluruh PJO…' })}
    </form>
    <div class="card-f" style="flex-direction:column;align-items:stretch;gap:8px"><button class="btn p lg blk" data-act="verif-setuju">${ic('verified')} Setujui &amp; Terbitkan ke Register 1</button>
      <div class="grid g2" style="gap:8px"><button class="btn bl" data-act="verif-dup">${ic('content_copy')} Tandai Duplikat</button><button class="btn do" data-act="verif-tolak">${ic('cancel')} Tolak Temuan</button></div>
      <div class="row xsmall muted">${ic('shield', 'xs')} Hasil verifikasi dicatat di Audit_Log.</div></div></div>`;
}
CH.cakupan = t => { const w = $('#wrapSite'); if (w) w.classList.toggle('hide', t.value !== 'SPESIFIK'); };
Object.assign(ACT, {
  'ant-kembali': () => { S.ui.tab.pencarian = 'antrean'; go('pencarian'); },
  'kw-tambah': () => { const c = $('#kwRows'); c.insertAdjacentHTML('beforeend', barisKw({}, Date.now())); const r = c.lastElementChild; if (r) $('[name=kw_pasal]', r).focus(); },
  'kw-hapus': t => { const r = t.closest('[data-kw]'); if (r) r.remove(); },
  'verif-setuju': async t => {
    const a = I().ant[S.ui.params.id], f = $('#fVerif'); if (!a || !f) return;
    if (!validasi(f, x => ({ tahun: /^\d{4}$/.test(x.tahun) ? '' : 'Tahun harus 4 digit.', site_berlaku: x.cakupan === 'SPESIFIK' && !x.site_berlaku ? 'Pilih minimal satu site.' : '' }))) return;
    const v = bacaForm(f);
    if (!await konfirmasi({ title: 'Terbitkan ke Register 1?', msg: 'Regulasi menjadi master aktif dan dapat dievaluasi oleh site terkait.', ok: 'Setujui & Terbitkan', icon: 'verified' })) return;
    const reg1 = { jenis_peraturan: v.jenis_peraturan, bentuk_peraturan: v.bentuk_peraturan, nomor: v.nomor, tahun: v.tahun, judul: v.judul, tautan_sumber_resmi: v.tautan_sumber_resmi, sumber_resmi: a.sumber_portal, status_berlaku: v.status_berlaku, relevansi_kegiatan: v.relevansi_kegiatan, site_berlaku: v.cakupan === 'ALL' ? 'ALL' : v.site_berlaku, pic_departemen: v.pic_departemen, keterkaitan_smkp: v.keterkaitan_smkp, id_reg1_terkait: v.id_reg1_terkait, elemen_smkp: v.elemen_smkp };
    try {
      const res = await kirim('antrean.setujui', { id_antrean: a.id_antrean, reg1, kewajiban: bacaKw(f), idLama: v.id_reg1_terkait, statusLama: v.statusLama, catatan: v.catatan }, { btn: t, txt: 'Menerbitkan…', diam: true });
      upsert('antrean', 'id_antrean', { id_antrean: a.id_antrean, status: 'Disetujui', id_reg1: res.data.id_reg1, diverifikasi_oleh: S.me.nrp });
      toast(res.message, 'success', 'Terverifikasi'); S.ui.tab.pencarian = 'antrean'; S.idx = null; go('pencarian');
    } catch (e) { /* form tetap, toast sudah tampil */ }
  },
  'verif-dup': async () => {
    const a = I().ant[S.ui.params.id]; if (!a) return;
    if (!await konfirmasi({ title: 'Tandai sebagai duplikat?', msg: 'Temuan tidak akan masuk Register 1.', ok: 'Tandai Duplikat' })) return;
    S.ui.tab.pencarian = 'antrean'; go('pencarian');
    kirim('antrean.tolak', { ids: [a.id_antrean], duplikat: true, alasan: 'Duplikat dengan regulasi terdaftar' }, { apply: () => upsert('antrean', 'id_antrean', { id_antrean: a.id_antrean, status: 'Duplikat' }) }).catch(() => { });
  },
  'verif-tolak': async () => {
    const a = I().ant[S.ui.params.id]; if (!a) return;
    const alasan = await konfirmasi({ title: 'Tolak temuan ini?', msg: a.judul, ok: 'Tolak Temuan', danger: true, alasan: true, alasanLabel: 'Alasan penolakan' });
    if (!alasan) return;
    S.ui.tab.pencarian = 'antrean'; go('pencarian');
    kirim('antrean.tolak', { ids: [a.id_antrean], alasan }, { apply: () => upsert('antrean', 'id_antrean', { id_antrean: a.id_antrean, status: 'Ditolak', catatan_verifikasi: alasan }) }).catch(() => { });
  }
});

/* ───────────── HALAMAN: REGISTER 1 — PERATURAN & STANDAR ───────────── */
function segBar(c, nc, p) { const t = c + nc + p || 1; return `<div class="prog" style="height:8px"><i style="width:${c / t * 100}%;background:${WARNA.g}"></i><i style="width:${p / t * 100}%;background:${WARNA.b}"></i><i style="width:${nc / t * 100}%;background:${WARNA.r}"></i></div>`; }
HAL.reg1 = el => {
  const st = tst('reg1', { jenis: 'ALL', status: 'ALL', dept: 'ALL', smkp: 'ALL', arsip: false });
  const semua = D.reg1(), akt = semua.filter(aktif), arsip = semua.filter(r => !aktif(r));
  const base = st.arsip ? arsip : akt;
  const rows = base.filter(r => (st.jenis === 'ALL' || r.jenis_peraturan === st.jenis) && (st.status === 'ALL' || r.status_berlaku === st.status) && (st.dept === 'ALL' || String(r.pic_departemen).split(',').includes(st.dept)) && (st.smkp === 'ALL' || String(r.elemen_smkp).split(',').includes(st.smkp)) && cari(st.q, r.id_reg1, r.nomor, r.tahun, r.judul, r.bentuk_peraturan, r.sumber_resmi))
    .sort((a, b) => String(b.tanggal_verifikasi).localeCompare(a.tanggal_verifikasi) || String(b.id_reg1).localeCompare(a.id_reg1));
  const c = s => akt.filter(r => r.status_berlaku === s).length;
  const kwN = id => (I().kwByReg1[id] || []).length;
  const ver = D.ev(periodeAktif()).filter(e => e.status_verifikasi === 'Terverifikasi');
  const vc = ver.filter(e => e.hasil === 'Compliant').length, vnc = ver.filter(e => e.hasil === 'Non-Compliant').length, vp = D.ev(periodeAktif()).filter(e => e.hasil === 'Pending').length;
  const idx = pct(vc, ver.length - ver.filter(e => e.hasil === 'N/A').length);
  const rtpOpen = D.rtp().filter(r => r.status_rtp !== 'Closed').length;
  const bisaUsulan = is(R.CORP, R.SITE);
  const tabR1 = bisaUsulan ? (S.ui.tab.reg1v || 'daftar') : 'daftar';
  const nM = bisaUsulan ? D.antrean().filter(a => a.status === 'Menunggu').length : 0;
  const isiDaftar = `<div class="grid g5 kpis mb16">
      ${kpi({ label: 'TOTAL REGULASI', value: nf(akt.length), unit: 'terverifikasi aktif', icon: 'account_balance', ic: 'o', act: 'flt-reg1', v: 'ALL', sel: !st.arsip && st.status === 'ALL' })}
      ${kpi({ label: 'BERLAKU PENUH', value: nf(c('Berlaku')), icon: 'check_circle', ic: 'g', vc: 't-g', sub: fpct(pct(c('Berlaku'), akt.length)) + ' tanpa amandemen', act: 'flt-reg1', v: 'Berlaku', sel: !st.arsip && st.status === 'Berlaku' })}
      ${kpi({ label: 'DIUBAH SEBAGIAN', value: nf(c('Diubah')), icon: 'published_with_changes', ic: 'a', vc: 't-a', sub: 'Periksa pasal turunan', act: 'flt-reg1', v: 'Diubah', sel: !st.arsip && st.status === 'Diubah' })}
      ${kpi({ label: 'DICABUT', value: nf(c('Dicabut')), icon: 'block', ic: 'r', vc: 't-r', sub: 'Tidak berlaku lagi', act: 'flt-reg1', v: 'Dicabut', sel: !st.arsip && st.status === 'Dicabut' })}
      ${kpi({ label: 'ARSIP', value: nf(arsip.length), icon: 'inventory_2', sub: 'Disimpan untuk referensi audit', act: 'flt-reg1', v: 'ARSIP', sel: st.arsip })}
    </div>
    <div class="grid g-73 mb16"><div class="card"><div class="card-b"><div class="row mb8"><div class="ic" style="width:34px;height:34px;border-radius:9px;background:var(--o-t);color:var(--o-d);display:flex;align-items:center;justify-content:center">${ic('shield')}</div><div class="sp"><h3 style="font-size:15px">Agregasi Tingkat Pemenuhan Kepatuhan</h3><div class="small muted">Evaluasi terverifikasi ${esc(labelPeriode(periodeAktif()))} • ${S.ui.site === 'ALL' ? 'seluruh site' : esc(namaSite(S.ui.site))}</div></div><span class="pill g">${fpct(idx)} Indeks</span></div>
      <div class="row small mb8"><span class="sp">${nf(ver.length)} kewajiban terevaluasi &amp; terverifikasi</span><span>${nf(vc)} Patuh • ${nf(vp)} Pending • ${nf(vnc)} Non-Compliant</span></div>${segBar(vc, vnc, vp)}
      <div class="grid g3 mt12" style="gap:8px"><div class="lgd-i" style="flex-direction:column;align-items:flex-start;gap:2px"><span class="xsmall">Kewajiban pasal terpetakan</span><b>${nf((S.data.kewajiban || []).filter(aktif).length)}</b></div><div class="lgd-i" style="flex-direction:column;align-items:flex-start;gap:2px"><span class="xsmall">RTP terbuka</span><b class="t-o">${nf(rtpOpen)} item</b></div><div class="lgd-i" style="flex-direction:column;align-items:flex-start;gap:2px"><span class="xsmall">Menunggu verifikasi</span><b class="t-b">${nf(D.antrean().filter(a => a.status === 'Menunggu').length)} temuan</b></div></div></div></div>
      <div class="card tint"><div class="card-b"><div class="row mb8">${ic('campaign', 't-o')}<b class="sp">Prinsip Register 1</b><span class="pill o">PENTING</span></div><p class="small" style="margin:0 0 8px;line-height:1.6">Hanya regulasi yang <b>disetujui SHEC Corporate</b> yang menjadi master aktif dan dasar evaluasi kepatuhan. Regulasi tidak dihapus permanen — gunakan status Dicabut/Arsip agar jejak audit tetap utuh.</p><button class="lnk small" data-act="go" data-sec="pencarian">Buka Pencarian Regulasi ${ic('arrow_forward', 's')}</button></div></div></div>
    <div class="card"><div class="fbar"><div class="srch">${ic('search')}<input class="inp" id="r1Q" data-in="q" data-t="reg1" value="${esc(st.q)}" placeholder="Cari nomor, judul, kode register…" aria-label="Cari regulasi"></div>
      <select class="inp" data-ch="flt" data-t="reg1" data-k="jenis" aria-label="Kategori">${opsi([['ALL', 'Semua kategori']].concat(JENIS), st.jenis)}</select>
      <select class="inp" data-ch="flt" data-t="reg1" data-k="status" aria-label="Status">${opsi([['ALL', 'Semua status'], 'Berlaku', 'Diubah', 'Dicabut'], st.status)}</select>
      <select class="inp" data-ch="flt" data-t="reg1" data-k="smkp" aria-label="Elemen SMKP">${opsi([['ALL', 'Semua elemen SMKP']].concat(smkpOpts()), st.smkp)}</select>
      ${st.q || st.jenis !== 'ALL' || st.status !== 'ALL' || st.dept !== 'ALL' || st.smkp !== 'ALL' || st.arsip ? `<button class="btn gh sm" data-act="reset-reg1">${ic('filter_alt_off')} Reset Filter</button>` : ''}</div>
      <div class="factive">${['ALL'].concat(JENIS).map(j => { const n = j === 'ALL' ? base.length : base.filter(r => r.jenis_peraturan === j).length; return n || j === 'ALL' ? `<button class="chip ${st.jenis === j ? 'on' : ''}" data-act="r1-jenis" data-v="${j}">${j === 'ALL' ? 'Semua' : esc(j)} <b>${n}</b></button>` : ''; }).join('')}</div>
      ${tabel('reg1', { key: 'id_reg1', rows, rowAct: 'r1-buka', unit: 'peraturan', empty: kosong('menu_book', st.arsip ? 'Tidak ada arsip' : 'Belum ada regulasi', 'Regulasi masuk melalui verifikasi Antrean atau tambah manual oleh SHEC Corporate.'), rowCls: r => aktif(r) ? '' : 'tmp', cols: [
        { l: 'Kode Register', r: r => `<div class="idc">${esc(r.id_reg1)}</div><div class="t2 nowrap">${ic('verified', 'xs t-g')} Verif: ${fmtTgl(r.tanggal_verifikasi)}</div>` },
        { l: 'Nomor & Tahun', r: r => `<div class="t1">${esc(judulReg(r))}</div><div class="t2">${esc(r.sumber_resmi || '–')}</div>` },
        { l: 'Judul & Kategori', r: r => `<div class="clamp2" style="max-width:380px">${esc(r.judul)}</div><div class="row wrap mt8" style="gap:4px">${pill(r.jenis_peraturan, 'o', false)}${String(r.keterkaitan_smkp || '').split(',').filter(Boolean).map(x => pill('SMKP ' + x, 'b', false)).join('')}${String(r.elemen_smkp || '').split(',').filter(Boolean).map(k => pill(k, 'n', false)).join('')}</div>` },
        { l: 'Kewajiban Pasal', r: r => `<span class="pill b">${ic('rule')} ${kwN(r.id_reg1)} klausul</span>` },
        { l: 'Berlaku untuk', r: r => `<div class="small">${esc(namaSite(r.site_berlaku))}</div>` },
        { l: 'Status', r: r => aktif(r) ? pill(r.status_berlaku) : pill('Arsip', 'n') }
      ] })}</div>
    <div class="card info mt16"><div class="card-b row wrap" style="gap:12px">${ic('sync', 't-b')}<div class="sp" style="min-width:240px"><b>Integrasi Google Sheets &amp; SMKP Minerba Element II.3</b><div class="small muted2">Register 1 tersimpan di spreadsheet master SHEC Corporate (terpisah dari MY HOMS). Data disinkronkan otomatis setiap ada perubahan.</div></div>${is(R.CORP, R.SITE, R.MGT) ? `<button class="btn" data-act="go" data-sec="audit">${ic('history')} Log Audit Trail</button>` : ''}<button class="btn p" data-act="muatulang">${ic('sync')} Paksa Sinkronisasi</button></div></div>`;
  el.innerHTML = hdr({
    crumbs: [['Register Kepatuhan', 'reg1'], ['Register 1 — Peraturan & Standar']], title: 'Register 1 — Peraturan &amp; Standar', tag: 'Edisi ' + labelPeriode(periodeAktif()),
    sub: 'Daftar induk regulasi hukum, standar teknis pertambangan, dan perizinan lingkungan yang telah diverifikasi SHEC Corporate.',
    actions: `${is(R.PIC) ? '' : `<button class="btn" data-act="laporan" data-j="REG1" data-f="xlsx">${ic('download')} Ekspor Matriks Regulasi</button>`}${can.reg1() ? `<button class="btn p" data-act="reg1-form">${ic('add')} Tambah Peraturan Manual</button>` : ''}${is(R.SITE) ? `<button class="btn p" data-act="usul">${ic('add_circle')} Usulkan Regulasi</button>` : ''}`
  }) + (bisaUsulan ? `<div class="tabs" role="tablist"><button class="tab ${tabR1 === 'daftar' ? 'on' : ''}" role="tab" data-act="tab" data-g="reg1v" data-v="daftar">${ic('menu_book', 's')} Daftar Regulasi</button><button class="tab ${tabR1 === 'usulan' ? 'on' : ''}" role="tab" data-act="tab" data-g="reg1v" data-v="usulan">${ic('inbox', 's')} ${is(R.CORP) ? 'Antrean Verifikasi' : 'Usulan Saya'}${nM ? ` <span class="cnt">${nM}</span>` : ''}</button></div>` : '')
    + (tabR1 === 'usulan' ? pencarianAntrean() : isiDaftar);
};
Object.assign(ACT, {
  'r1-buka': t => go('reg1d', { id: t.dataset.id }),
  'r1-jenis': t => { const st = tst('reg1'); st.jenis = t.dataset.v; st.page = 1; renderSec('reg1'); },
  'flt-reg1': t => { const st = tst('reg1'); if (t.dataset.v === 'ARSIP') { st.arsip = true; st.status = 'ALL'; } else { st.arsip = false; st.status = t.dataset.v; } st.page = 1; renderSec('reg1'); },
  'reset-reg1': () => { S.ui.tbl.reg1 = null; renderSec('reg1'); },
  'reg1-form': t => formReg1(t.dataset.id ? I().reg1[t.dataset.id] : null)
});

HAL.reg1d = (el, p) => {
  const r = I().reg1[p.id];
  if (!r) { el.innerHTML = kosong('search_off', 'Regulasi tidak ditemukan', 'Data mungkin di luar cakupan akses Anda.', `<button class="btn p" data-act="go" data-sec="reg1">Kembali ke Register 1</button>`); return; }
  const kws = (S.data.kewajiban || []).filter(k => k.id_reg1 === r.id_reg1);
  const kwAkt = kws.filter(aktif);
  const tab = S.ui.tab.reg1d || 'kw', per = periodeAktif();
  const evs = (S.data.evaluasi || []).filter(e => aktif(e) && e.id_reg1 === r.id_reg1 && siteOk(e.site));
  const evPer = evs.filter(e => e.periode === per && e.status_verifikasi === 'Terverifikasi');
  const h = x => evPer.filter(e => e.hasil === x).length;
  const lamp = lampiran('REG1', r.id_reg1);
  const terkait = (S.data.reg1 || []).filter(x => x.id_reg1 !== r.id_reg1 && (x.id_reg1_terkait === r.id_reg1 || r.id_reg1_terkait === x.id_reg1));
  const statKw = k => { const v = evs.filter(e => e.id_kewajiban === k.id_kewajiban && e.status_verifikasi === 'Terverifikasi' && e.periode === per); if (!v.length) return '<span class="muted small">Belum dievaluasi</span>'; const nc = v.filter(e => e.hasil === 'Non-Compliant').length, cc = v.filter(e => e.hasil === 'Compliant').length; return `<div class="row wrap" style="gap:4px">${cc ? pill(cc + ' Compliant', 'g', false) : ''}${nc ? pill(nc + ' NC', 'r') : ''}</div>`; };
  let isiTab = '';
  if (tab === 'kw') isiTab = `${can.reg1() ? `<div class="fbar" style="justify-content:flex-end"><button class="btn p sm" data-act="kw-form" data-reg="${esc(r.id_reg1)}">${ic('add')} Tambah Kewajiban</button></div>` : ''}${tabel('kw' + r.id_reg1, { key: 'id_kewajiban', rows: kws.sort((a, b) => (aktif(b) - aktif(a)) || String(a.id_kewajiban).localeCompare(b.id_kewajiban)), unit: 'kewajiban', rowCls: k => aktif(k) ? '' : 'tmp', empty: kosong('rule', 'Belum ada kewajiban pasal', 'Tambahkan pasal/butir kewajiban agar dapat dievaluasi.'), cols: [
    { l: 'Pasal / Butir', r: k => `<div class="t1">${esc(k.pasal_butir || '–')}</div><div class="t2 mono">${esc(k.id_kewajiban)}</div>` },
    { l: 'Uraian Kewajiban', r: k => `<div style="max-width:420px">${esc(k.uraian_kewajiban)}</div>${aktif(k) ? '' : pill('Arsip', 'n')}` },
    { l: 'Site / Periode', r: k => `<div class="small">${esc(namaSite(k.site_berlaku))}</div><div class="t2">${esc(k.periodisitas || '–')}</div>` },
    { l: 'Status ' + labelPeriode(per).replace('Semester ', 'Smt '), r: statKw },
    { l: '', cls: 'act', r: k => can.reg1() ? `<button class="btn gh ic sm" data-act="kw-form" data-reg="${esc(r.id_reg1)}" data-id="${esc(k.id_kewajiban)}" title="Ubah" aria-label="Ubah kewajiban">${ic('edit')}</button><button class="btn gh ic sm" data-act="kw-arsip" data-id="${esc(k.id_kewajiban)}" title="${aktif(k) ? 'Arsipkan' : 'Pulihkan'}" aria-label="${aktif(k) ? 'Arsipkan' : 'Pulihkan'}">${ic(aktif(k) ? 'archive' : 'unarchive')}</button>` : '' }
  ] })}`;
  else if (tab === 'lamp') isiTab = `<div class="card-b col" style="gap:12px">${daftarBerkas(lamp, { hapus: can.reg1() })}${can.reg1() ? zonaUnggah('REG1', r.id_reg1, r.site_berlaku, 'Unggah salinan naskah resmi (PDF) — untuk SNI/standar berlisensi, simpan hanya bila memiliki hak akses yang sah') : ''}</div>`;
  else if (tab === 'ev') isiTab = tabel('ev' + r.id_reg1, { key: 'id_evaluasi', rows: evs.sort((a, b) => String(b.tanggal_evaluasi).localeCompare(a.tanggal_evaluasi)), rowAct: 'ev-buka', unit: 'evaluasi', empty: kosong('fact_check', 'Belum ada evaluasi', 'Evaluasi dibuat oleh SHEC Site di menu Evaluasi & RTP.'), cols: [
    { l: 'ID Evaluasi', r: e => `<div class="idc">${esc(e.id_evaluasi)}</div><div class="t2">${esc(labelPeriode(e.periode))}</div>` },
    { l: 'Pasal', r: e => esc((I().kw[e.id_kewajiban] || {}).pasal_butir || '–') }, { l: 'Site', r: e => esc(namaSite(e.site)) },
    { l: 'Hasil', r: e => pill(e.hasil) }, { l: 'Verifikasi', r: e => pill(e.status_verifikasi) }] });
  else if (tab === 'hist') isiTab = riwayatAudit(r.id_reg1);
  else isiTab = terkait.length ? `<div class="card-b col" style="gap:10px">${terkait.map(x => `<div class="file clk" data-act="r1-buka" data-id="${esc(x.id_reg1)}" role="button" tabindex="0" style="cursor:pointer"><div class="fic" style="background:var(--o-t);color:var(--o-d)">${ic('account_tree')}</div><div class="fn"><b>${esc(judulReg(x))}</b><span>${esc(x.judul)}</span></div>${pill(x.status_berlaku)}</div>`).join('')}</div>` : kosong('account_tree', 'Tidak ada regulasi terkait', 'Hubungan perubahan/pencabutan akan tampil di sini.');
  el.innerHTML = hdr({
    crumbs: [['Register 1 — Peraturan & Standar', 'reg1'], [r.id_reg1]], title: esc(judulReg(r)),
    sub: `${pill(aktif(r) ? r.status_berlaku : 'Arsip')} ${pill(r.jenis_peraturan, 'o', false)} <span>${esc(r.judul)}</span>`,
    actions: `<button class="btn" data-act="back" data-fb="reg1">${ic('arrow_back')} Kembali</button>${r.tautan_sumber_resmi ? `<a class="btn" href="${esc(r.tautan_sumber_resmi)}" target="_blank" rel="noopener noreferrer">${ic('open_in_new')} Sumber Resmi</a>` : ''}${can.reg1() ? `<button class="btn" data-act="reg1-form" data-id="${esc(r.id_reg1)}">${ic('edit')} Ubah</button><button class="btn ${aktif(r) ? 'do' : 'gn'}" data-act="reg1-arsip" data-id="${esc(r.id_reg1)}">${ic(aktif(r) ? 'archive' : 'unarchive')} ${aktif(r) ? 'Arsipkan' : 'Pulihkan'}</button>` : ''}`
  }) + `<div class="grid g-73 mb16"><div class="card"><div class="card-h"><div class="ic">${ic('info')}</div><div><h3>Informasi Regulasi</h3><p>Master aktif Register 1</p></div></div><div class="card-b"><dl class="dl c3">
      <div><dt>Kode register</dt><dd class="mono b6 t-o">${esc(r.id_reg1)}</dd></div><div><dt>Bentuk</dt><dd>${esc(r.bentuk_peraturan || '–')}</dd></div><div><dt>Nomor / Tahun</dt><dd>${esc(r.nomor)} / ${esc(r.tahun)}</dd></div>
      <div><dt>Tanggal penetapan</dt><dd>${fmtTgl(r.tanggal_penetapan)}</dd></div><div><dt>Sumber resmi</dt><dd>${esc(r.sumber_resmi || '–')}</dd></div><div><dt>Keterkaitan SMKP</dt><dd>${esc(r.keterkaitan_smkp || '–')}</dd></div>
      <div><dt>Site berlaku</dt><dd>${esc(namaSite(r.site_berlaku))}</dd></div><div><dt>Diverifikasi</dt><dd>${esc(namaUser(r.diverifikasi_oleh))}<div class="t2 small muted">${fmtTgl(r.tanggal_verifikasi)}${r.id_antrean_asal ? ' • dari ' + esc(r.id_antrean_asal) : ''}</div></dd></div>
      <div class="full"><dt>Relevansi terhadap kegiatan HMSI</dt><dd>${esc(r.relevansi_kegiatan || '–')}</dd></div>
      <div class="full"><dt>Elemen SMKP terkonfirmasi (FR-12)</dt><dd>${r.elemen_smkp ? smkpBadges(r.elemen_smkp) : '<span class="muted">–</span>'}</dd></div></dl></div></div>
    <div class="card"><div class="card-h"><div class="ic">${ic('donut_large')}</div><div><h3>Status Pemenuhan</h3><p>${esc(labelPeriode(per))} • evaluasi terverifikasi</p></div></div><div class="card-b">
      <div class="kpi-v">${fpct(pct(h('Compliant'), evPer.length - h('N/A')))}<small>patuh</small></div><div class="mt8">${segBar(h('Compliant'), h('Non-Compliant'), h('Pending'))}</div>
      <div class="lgd mt12">${[['Compliant', WARNA.g], ['Non-Compliant', WARNA.r], ['Pending', WARNA.b], ['N/A', WARNA.n]].map(([l, c]) => `<div class="lgd-i"><i style="background:${c}"></i><span>${l}</span><b>${h(l)}</b></div>`).join('')}</div>
      <p class="xsmall muted mt12" style="margin-bottom:0">${kwAkt.length} kewajiban aktif • ${evs.length} evaluasi tercatat (semua periode)</p></div></div></div>
    <div class="card"><div class="tabs in" role="tablist">${[['kw', 'Kewajiban Pasal', kwAkt.length], ['lamp', 'Lampiran', lamp.length], ['ev', 'Evaluasi', evs.length], ['hist', 'Riwayat Perubahan'], ['rel', 'Regulasi Terkait', terkait.length]].map(([k, l, n]) => `<button class="tab ${tab === k ? 'on' : ''}" role="tab" data-act="tab" data-g="reg1d" data-v="${k}">${l}${n != null ? ` <span class="cnt">${n}</span>` : ''}</button>`).join('')}</div>${isiTab}</div>`;
};
/* Riwayat dari Audit_Log (dimuat saat tab dibuka) */
function riwayatAudit(id) {
  if (!is(R.CORP, R.SITE, R.MGT)) return kosong('lock', 'Riwayat tidak tersedia untuk peran Anda', '');
  S.ui.riwayat = S.ui.riwayat || {};
  const R0 = S.ui.riwayat[id];
  if (!R0) { S.ui.riwayat[id] = { muat: true }; api('audit.list', { id, per: 50 }).then(res => { S.ui.riwayat[id] = { rows: res.data.rows }; renderSec(S.ui.sec, true); }).catch(e => { S.ui.riwayat[id] = { err: e.message }; renderSec(S.ui.sec, true); }); return '<div class="card-b"><div class="sk sk-l"></div><div class="sk sk-l" style="width:70%"></div><div class="sk sk-l" style="width:50%"></div></div>'; }
  if (R0.muat) return '<div class="card-b"><div class="sk sk-l"></div><div class="sk sk-l" style="width:60%"></div></div>';
  if (R0.err) return kosong('error', 'Riwayat gagal dimuat', R0.err);
  if (!R0.rows.length) return kosong('history', 'Belum ada riwayat', '');
  return `<div class="card-b"><div class="tl">${R0.rows.map(a => `<div class="tl-i ${/ARSIP|TOLAK|GAGAL/.test(a.aksi) ? 'r' : (/TAMBAH|SETUJU|VERIF/.test(a.aksi) ? 'g' : '')}"><div class="tl-h"><b>${esc(a.aksi.replace(/_/g, ' '))} • ${esc(a.nama)}</b><span>${fmtWkt(a.waktu)}</span></div><div class="tl-b">${esc(a.ringkasan)}${ringkasDiff(a)}</div></div>`).join('')}</div><button class="lnk small mt12" data-act="riwayat-ulang" data-id="${esc(id)}">${ic('refresh', 's')} Muat ulang riwayat</button></div>`;
}
function ringkasDiff(a) {
  try { const l = JSON.parse(a.nilai_lama || '{}'), b = JSON.parse(a.nilai_baru || '{}'); const k = Object.keys(b); if (!k.length) return ''; return '<div class="row wrap mt8" style="gap:4px">' + k.slice(0, 6).map(x => `<span class="mono xsmall" style="background:var(--sf2);border:1px solid var(--bd);border-radius:4px;padding:1px 6px">${esc(x)}: <span class="t-r">${esc(String(l[x] || '∅').slice(0, 40))}</span> → <span class="t-g">${esc(String(b[x] || '∅').slice(0, 40))}</span></span>`).join('') + '</div>'; } catch (e) { return ''; }
}
ACT['riwayat-ulang'] = t => { delete S.ui.riwayat[t.dataset.id]; renderSec(S.ui.sec, true); };
function formReg1(r) {
  const baru = !r; r = r || { status_berlaku: 'Berlaku', site_berlaku: 'ALL', keterkaitan_smkp: 'II.3' };
  const spes = r.site_berlaku && r.site_berlaku !== 'ALL';
  modal({ title: baru ? 'Tambah Peraturan Manual' : 'Ubah ' + r.id_reg1, sub: baru ? 'Peraturan langsung menjadi master aktif Register 1 (diverifikasi oleh Anda).' : judulReg(r), icon: 'menu_book', size: 'lg',
    body: `<form id="fReg1" class="frm" novalidate>
      <div class="fsec"><span class="bar"></span>Identitas</div>
      ${fld({ n: 'jenis_peraturan', l: 'Kategori', t: 'select', opts: JENIS, v: r.jenis_peraturan, req: true })}${fld({ n: 'bentuk_peraturan', l: 'Bentuk', t: 'select', opts: BENTUK, v: r.bentuk_peraturan, req: true })}
      ${fld({ n: 'nomor', l: 'Nomor', v: r.nomor, req: true, max: 80 })}${fld({ n: 'tahun', l: 'Tahun', v: r.tahun, req: true, max: 4, im: 'numeric' })}
      ${fld({ n: 'judul', l: 'Judul / tentang', t: 'textarea', rows: 2, v: r.judul, req: true, full: true, max: 600 })}
      ${fld({ n: 'sumber_resmi', l: 'Sumber resmi', v: r.sumber_resmi, ph: 'Contoh: JDIH Kementerian ESDM', max: 200 })}${fld({ n: 'tanggal_penetapan', l: 'Tanggal penetapan', t: 'date', v: r.tanggal_penetapan })}
      ${fld({ n: 'tautan_sumber_resmi', l: 'Tautan sumber resmi', t: 'url', v: r.tautan_sumber_resmi, full: true, ph: 'https://' })}
      <div class="fsec"><span class="bar"></span>Keberlakuan &amp; Relevansi</div>
      ${fld({ n: 'status_berlaku', l: 'Status berlaku', t: 'select', opts: ['Berlaku', 'Diubah', 'Dicabut'], v: r.status_berlaku, ph: false })}${fld({ n: 'id_reg1_terkait', l: 'Regulasi terkait / pengubah', t: 'select', opts: (S.data.reg1 || []).filter(x => aktif(x) && x.id_reg1 !== r.id_reg1).map(x => [x.id_reg1, x.id_reg1 + ' — ' + judulReg(x)]), v: r.id_reg1_terkait, ph: '— Tidak ada —' })}
      ${fld({ n: 'relevansi_kegiatan', l: 'Relevansi terhadap kegiatan HMSI', t: 'textarea', rows: 3, v: r.relevansi_kegiatan, req: true, full: true, max: 2000 })}
      <div class="full">${fld({ n: 'keterkaitan_smkp', l: 'Keterkaitan SMKP Minerba', t: 'checks', v: r.keterkaitan_smkp, opts: [['II.3', 'Elemen II.3'], ['V.3', 'Elemen V.3']] })}</div>
      <div class="full">${fld({ n: 'elemen_smkp', l: 'Elemen SMKP terkonfirmasi (taksonomi 51 sub-elemen, opsional)', t: 'checks', v: r.elemen_smkp, opts: smkpOpts() })}</div>
      ${baru ? `<div class="fsec"><span class="bar"></span>Kewajiban Pasal Awal</div><div class="full col" style="gap:8px" id="kwRows">${barisKw({}, 0)}</div><div class="full"><button type="button" class="add-row" data-act="kw-tambah">${ic('add')} Tambah Kewajiban</button></div>` : ''}
      <div class="fsec"><span class="bar"></span>Distribusi ke Site</div>
      ${fld({ n: 'cakupan', l: 'Regulasi dan pasal di atas berlaku untuk', t: 'select', opts: [['ALL', 'Semua site'], ['SPESIFIK', 'Site tertentu (pilih di bawah)']], v: spes ? 'SPESIFIK' : 'ALL', ph: false, ch: 'cakupan', full: true })}
      <div class="full ${spes ? '' : 'hide'}" id="wrapSite">${fld({ n: 'site_berlaku', l: 'Pilih site', t: 'checks', v: spes ? r.site_berlaku : '', opts: (S.data.sites || []).filter(x => x.status === 'Aktif').map(x => [x.kode, x.nama]) })}</div>
      <div class="full small muted">${baru ? 'Setelah Simpan &amp; Terbitkan, peraturan langsung berstatus berlaku dan muncul di Register serta daftar evaluasi site terpilih.' : ''}</div>
    </form>`,
    foot: `<span class="lf">${ic('shield', 's')} Tercatat di Audit_Log</span><button class="btn gh" data-act="mclose">Batal</button><button class="btn p" data-act="reg1-simpan" data-id="${esc(r.id_reg1 || '')}">${ic('save')} ${baru ? 'Simpan & Terbitkan' : 'Simpan Perubahan'}</button>` });
}
Object.assign(ACT, {
  'reg1-simpan': async t => {
    const f = $('#fReg1');
    if (!validasi(f, x => ({ tahun: /^\d{4}$/.test(x.tahun) ? '' : 'Tahun harus 4 digit.', site_berlaku: x.cakupan === 'SPESIFIK' && !x.site_berlaku ? 'Pilih minimal satu site.' : '' }))) return;
    const v = bacaForm(f); v.site_berlaku = v.cakupan === 'ALL' ? 'ALL' : v.site_berlaku; v.id_reg1 = t.dataset.id; v.kewajiban = $('#kwRows') ? bacaKw(f) : [];
    if (!v.id_reg1 && !v.kewajiban.length) { toast('Isi minimal satu pasal kewajiban agar peraturan dapat dievaluasi site.', 'error'); return; }
    try {
      const res = await kirim('reg1.simpan', v, { btn: t, txt: 'Menyimpan…' });
      upsert('reg1', 'id_reg1', res.data.reg1); (res.data.kewajiban || []).forEach(k => upsert('kewajiban', 'id_kewajiban', k)); S.idx = null;
      tutupModal();
      if (!v.id_reg1) {
        const nSite = v.site_berlaku === 'ALL' ? (S.data.sites || []).filter(x => x.status === 'Aktif').length : String(v.site_berlaku).split(',').filter(Boolean).length;
        const nKw = (res.data.kewajiban || []).length;
        toast(`Berlaku untuk ${v.site_berlaku === 'ALL' ? 'semua site (' + nSite + ')' : nSite + ' site'}. ${nKw} kewajiban pasal menunggu evaluasi site.`, 'success', 'Peraturan terbit');
        go('reg1d', { id: res.data.reg1.id_reg1 });
      } else rerender(true);
    } catch (e) { /* toast */ }
  },
  'reg1-arsip': async t => {
    const r = I().reg1[t.dataset.id]; if (!r) return;
    const arsip = aktif(r);
    const alasan = await konfirmasi(arsip ? { title: 'Arsipkan regulasi ini?', msg: 'Regulasi tidak lagi menjadi dasar evaluasi, tetapi tetap tersimpan untuk audit.', ok: 'Arsipkan', danger: true, alasan: true } : { title: 'Pulihkan regulasi?', msg: 'Regulasi kembali menjadi master aktif.', ok: 'Pulihkan' });
    if (!alasan) return;
    kirim('reg1.arsip', { id_reg1: r.id_reg1, pulihkan: !arsip, alasan: typeof alasan === 'string' ? alasan : '' }, { apply: () => upsert('reg1', 'id_reg1', { id_reg1: r.id_reg1, status_aktif: arsip ? 'Archived' : 'Active' }) }).catch(() => { });
  },
  'kw-form': t => {
    const reg = I().reg1[t.dataset.reg];
    if (t.dataset.id) {
      const k = I().kw[t.dataset.id];
      modal({ title: 'Ubah Kewajiban', sub: reg ? judulReg(reg) : '', icon: 'rule', body: `<form id="fKw" class="frm" novalidate>
        ${fld({ n: 'pasal_butir', l: 'Pasal / butir', v: k.pasal_butir, req: true, max: 200, ph: 'Contoh: Pasal 14 ayat (2)' })}${fld({ n: 'periodisitas', l: 'Periodisitas evaluasi', t: 'select', opts: ['Bulanan', 'Triwulan', 'Semester', 'Tahunan', 'Insidental'], v: k.periodisitas, ph: false })}
        ${fld({ n: 'uraian_kewajiban', l: 'Uraian kewajiban', t: 'textarea', rows: 4, v: k.uraian_kewajiban, req: true, full: true, max: 3000 })}
        <div class="full">${fld({ n: 'site_berlaku', l: 'Site berlaku (kosongkan = semua site)', t: 'checks', v: k.site_berlaku === 'ALL' ? '' : k.site_berlaku, opts: (S.data.sites || []).map(s => [s.kode, s.nama]) })}</div></form>`,
        foot: `<button class="btn gh" data-act="mclose">Batal</button><button class="btn p" data-act="kw-simpan" data-reg="${esc(t.dataset.reg)}" data-id="${esc(t.dataset.id)}">${ic('save')} Simpan</button>` });
    } else {
      modal({ title: 'Tambah Kewajiban Pasal', sub: reg ? judulReg(reg) : '', icon: 'rule', size: 'xl', body: `<form id="fKw" class="frm" novalidate>
        <div class="full"><div class="small muted" style="margin-bottom:6px">Tambahkan satu atau beberapa pasal/butir kewajiban sekaligus. Site berlaku akan mengikuti site regulasi induk; gunakan tombol Ubah per-baris di tabel untuk mengatur site tertentu.</div></div>
        <div class="full col" style="gap:8px" id="kwRows">${barisKw({}, 0)}</div><div class="full"><button type="button" class="add-row" data-act="kw-tambah">${ic('add')} Tambah Baris</button></div>
        <div class="fsec"><span class="bar"></span>Distribusi ke Site</div>
        ${fld({ n: 'cakupan', l: 'Pasal di atas berlaku untuk', t: 'select', opts: [['IKUT', 'Semua site regulasi induk (' + namaSite(reg ? reg.site_berlaku : 'ALL') + ')'], ['SPESIFIK', 'Hanya site tertentu (pilih di bawah)']], v: 'IKUT', ph: false, ch: 'cakupan', full: true })}
        <div class="full hide" id="wrapSite">${fld({ n: 'site_berlaku', l: 'Pilih site', t: 'checks', opts: (S.data.sites || []).filter(x => x.status === 'Aktif' && (!reg || !reg.site_berlaku || reg.site_berlaku === 'ALL' || String(reg.site_berlaku).split(',').includes(x.kode))).map(x => [x.kode, x.nama]) })}</div></form>`,
        foot: `<button class="btn gh" data-act="mclose">Batal</button><button class="btn p" data-act="kw-simpan" data-reg="${esc(t.dataset.reg)}">${ic('save')} Simpan</button>` });
    }
  },
  'kw-simpan': async t => {
    const f = $('#fKw');
    if (t.dataset.id) {
      if (!validasi(f)) return;
      const v = bacaForm(f); v.site_berlaku = v.site_berlaku || 'ALL'; v.id_reg1 = t.dataset.reg; v.id_kewajiban = t.dataset.id;
      tutupModal(); kirim('kewajiban.simpan', v, { apply: () => upsert('kewajiban', 'id_kewajiban', v) }).catch(() => { }); return;
    }
    const list = bacaKw(f);
    if (!list.length) { toast('Isi minimal satu uraian kewajiban.', 'error'); return; }
    const cak = (f.querySelector('[name=cakupan]') || {}).value || 'IKUT';
    if (cak !== 'IKUT') {
      const v = bacaForm(f), sit = cak === 'ALL' ? 'ALL' : (v.site_berlaku || '');
      if (!sit) { toast('Pilih minimal satu site.', 'error'); return; }
      list.forEach(k => { k.site_berlaku = sit; });
    }
    try {
      const res = await kirim('kewajiban.simpan_banyak', { id_reg1: t.dataset.reg, list }, { btn: t, txt: 'Menyimpan…' });
      (res.data.kewajiban || []).forEach(k => upsert('kewajiban', 'id_kewajiban', k));
      S.idx = null; tutupModal(); rerender(true);
    } catch (e) { /* toast */ }
  },
  'kw-arsip': async t => {
    const k = I().kw[t.dataset.id]; if (!k) return;
    const arsip = aktif(k);
    if (!await konfirmasi({ title: arsip ? 'Arsipkan kewajiban?' : 'Pulihkan kewajiban?', msg: k.pasal_butir + ' — ' + k.uraian_kewajiban, ok: arsip ? 'Arsipkan' : 'Pulihkan', danger: arsip })) return;
    kirim('kewajiban.arsip', { id_kewajiban: k.id_kewajiban, pulihkan: !arsip }, { apply: () => upsert('kewajiban', 'id_kewajiban', { id_kewajiban: k.id_kewajiban, status_aktif: arsip ? 'Archived' : 'Active' }) }).catch(() => { });
  }
});

/* ───────────── HALAMAN: REGISTER 2 — IZIN, LISENSI & SERTIFIKASI ───────────── */
function selSisa(r) {
  const s = sisaHari(r.tanggal_kedaluwarsa);
  if (s == null) return '<span class="muted">–</span>';
  if (s < 0) return pill(`${s} hari (Expired)`, 'r');
  if (s <= 7) return pill(`${s} hari (H-7)`, 'r');
  if (s <= ambang()) { const t = [30, 60, 90].find(x => s <= x) || ambang(); return pill(`${s} hari (H-${t})`, 'a'); }
  return `<span class="t-g b6 nowrap">${ic('check', 'xs')} ${nf(s)} hari</span>`;
}
HAL.reg2 = el => {
  const st = tst('reg2', { st: 'ALL', jenis: 'ALL', dept: 'ALL' });
  const base = D.reg2();
  const n = s => base.filter(r => stIzin(r) === s).length;
  const rows = base.filter(r => (st.st === 'ALL' || stIzin(r) === st.st) && (st.jenis === 'ALL' || r.jenis_dokumen === st.jenis) && (st.dept === 'ALL' || r.departemen === st.dept) && cari(st.q, r.id_izin, r.nama_dokumen, r.nomor_dokumen, r.nama_pemegang, r.objek, namaUser(r.pic_nrp)))
    .sort((a, b) => String(a.tanggal_kedaluwarsa || '9999').localeCompare(String(b.tanggal_kedaluwarsa || '9999')));
  el.innerHTML = hdr({
    crumbs: [['Register Kepatuhan', 'reg1'], ['Register 2 — Izin, Lisensi & Sertifikasi']], title: 'Register 2 — Izin, Lisensi &amp; Sertifikasi',
    sub: `Monitoring masa berlaku izin operasional, lisensi K3, SIO, dan sertifikasi peralatan lintas ${S.ui.site === 'ALL' ? 'site' : esc(namaSite(S.ui.site))}. Pengingat otomatis H-${esc(cfg('tahap_pengingat', '90,60,30,7').replace(/,/g, '/'))}.`,
    actions: `${is(R.PIC) ? '' : `<button class="btn" data-act="laporan" data-j="REG2" data-f="xlsx">${ic('download')} Ekspor Excel</button>`}${can.reg2Tambah() ? `<button class="btn p" data-act="reg2-form">${ic('add')} Tambah Izin Baru</button>` : ''}`
  }) + `<div class="grid g4 kpis mb16">
      ${kpi({ label: 'Aktif', value: nf(n('Aktif')), unit: 'dokumen', icon: 'check_circle', ic: 'g', sub: `> ${ambang()} hari kalender`, act: 'reg2-st', v: 'Aktif', sel: st.st === 'Aktif' })}
      ${kpi({ label: 'Mendekati Kedaluwarsa', value: nf(n('Mendekati Kedaluwarsa')), unit: 'dokumen', icon: 'schedule', ic: 'a', l: 'a', vc: 't-a', sub: `${ic('warning', 'xs t-a')} Ambang H-${ambang()} / H-30`, act: 'reg2-st', v: 'Mendekati Kedaluwarsa', sel: st.st === 'Mendekati Kedaluwarsa' })}
      ${kpi({ label: 'Kedaluwarsa', value: nf(n('Kedaluwarsa')), unit: 'dokumen', icon: 'error', ic: 'r', l: 'r', vc: 't-r', sub: `<span class="t-r">Kritis — stop unit / jatuh tempo</span>`, act: 'reg2-st', v: 'Kedaluwarsa', sel: st.st === 'Kedaluwarsa' })}
      ${kpi({ label: 'Total Izin & Lisensi', value: nf(base.length), unit: 'total', icon: 'description', sub: `${ic('inventory_2', 'xs')} 100% tercatat terpusat`, act: 'reg2-st', v: 'ALL', sel: st.st === 'ALL' })}
    </div>
    <div class="card"><div class="fbar"><div class="srch">${ic('search')}<input class="inp" id="r2Q" data-in="q" data-t="reg2" value="${esc(st.q)}" placeholder="Cari nama dokumen, nomor izin, pemegang, PIC…" aria-label="Cari izin"></div>
      <select class="inp" data-ch="flt" data-t="reg2" data-k="jenis" aria-label="Jenis dokumen">${opsi([['ALL', 'Semua jenis dokumen'], 'Izin', 'Lisensi', 'Sertifikasi'], st.jenis)}</select>
      <select class="inp" data-ch="flt" data-t="reg2" data-k="dept" aria-label="Departemen">${opsi([['ALL', 'Semua departemen']].concat(deptList().map(d => [d.kode, d.nama])), st.dept)}</select>
      <select class="inp" data-ch="flt" data-t="reg2" data-k="st" aria-label="Status">${opsi([['ALL', 'Semua status'], 'Aktif', 'Mendekati Kedaluwarsa', 'Kedaluwarsa', 'Tanpa Masa Berlaku'], st.st)}</select></div>
      ${st.st !== 'ALL' || st.q ? `<div class="factive">Filter aktif: ${st.st !== 'ALL' ? `<span class="chip kw">Status: ${esc(st.st)} <span class="ms x" data-act="reg2-st" data-v="ALL" role="button" aria-label="Hapus filter">close</span></span>` : ''}${st.q ? `<span class="chip kw">"${esc(st.q)}"</span>` : ''}<button class="lnk small" data-act="reset-reg2">Bersihkan semua filter</button></div>` : ''}
      ${tabel('reg2', { key: 'id_izin', rows, rowAct: 'r2-buka', unit: 'dokumen', rowCls: r => { const s = sisaHari(r.tanggal_kedaluwarsa); return r._tmp ? 'tmp' : (s != null && s < 0 ? 'crit' : (s != null && s <= 30 ? 'warn' : '')); }, empty: kosong('verified', 'Tidak ada dokumen', 'Ubah filter atau tambahkan izin baru.'), cols: [
        { l: 'ID Dokumen', r: r => `<div class="idc">${esc(r._tmp ? 'Menyimpan…' : r.id_izin)}</div><div class="t2">${esc(r.jenis_dokumen)}</div>` },
        { l: 'Nama Dokumen & Objek', r: r => `<div class="t1 ${stIzin(r) === 'Kedaluwarsa' ? 't-r' : ''}">${esc(r.nama_dokumen)}</div><div class="t2">${esc(r.objek || r.nama_pemegang || '')}</div>` },
        { l: 'No. Surat / Izin', r: r => `<span class="mono">${esc(r.nomor_dokumen)}</span>` },
        { l: 'PIC & Departemen', r: r => `<div>${esc(namaUser(r.pic_nrp))}</div><div class="t2">${esc(namaDept(r.departemen))}</div>` },
        { l: 'Site', r: r => esc(namaSite(r.site)) },
        { l: 'Jatuh Tempo', r: r => `<span class="nowrap ${stIzin(r) === 'Kedaluwarsa' ? 't-r b6' : ''}">${fmtTgl(r.tanggal_kedaluwarsa)}</span>` },
        { l: 'Sisa Hari', r: selSisa },
        { l: '', cls: 'act', r: r => can.reg2Edit(r) && !r._tmp ? `<button class="btn sm ${stIzin(r) === 'Kedaluwarsa' ? 'd' : 't'}" data-act="perpanjang" data-id="${esc(r.id_izin)}">${ic('autorenew')} Perpanjang</button>` : '' }
      ] })}</div>
    <div class="note b mt16">${ic('info')}<div><b>Klausul Kepatuhan SMKP Minerba &amp; OHSAS:</b> alat berat atau instalasi tanpa riksa uji/SILO aktif wajib dihentikan operasinya (DTI/Red Tagged). Ajukan perpanjangan lisensi paling lambat H-45 sebelum jatuh tempo.</div></div>`;
};
Object.assign(ACT, {
  'r2-buka': t => go('reg2d', { id: t.dataset.id }),
  'reg2-st': t => { const st = tst('reg2'); st.st = t.dataset.v; st.page = 1; renderSec('reg2'); },
  'reset-reg2': () => { S.ui.tbl.reg2 = null; renderSec('reg2'); },
  'reg2-form': t => formReg2(t.dataset.id ? I().reg2[t.dataset.id] : null),
  perpanjang: t => formPerpanjang(I().reg2[t.dataset.id])
});
HAL.reg2d = (el, p) => {
  const r = I().reg2[p.id];
  if (!r) { el.innerHTML = kosong('search_off', 'Dokumen tidak ditemukan', 'Data mungkin di luar cakupan akses Anda.', `<button class="btn p" data-act="go" data-sec="reg2">Kembali ke Register 2</button>`); return; }
  const s = sisaHari(r.tanggal_kedaluwarsa), stt = stIzin(r);
  const total = r.tanggal_terbit && r.tanggal_kedaluwarsa ? selisih(r.tanggal_terbit, r.tanggal_kedaluwarsa) : null;
  const jalan = total ? Math.min(100, Math.max(0, Math.round(selisih(r.tanggal_terbit, today()) / total * 100))) : 0;
  const ppj = (I().ppj[r.id_izin] || []).slice().sort((a, b) => String(b.created_at).localeCompare(a.created_at));
  const lamp = lampiran('REG2', r.id_izin);
  const tahap = String(cfg('tahap_pengingat', '90,60,30,7')).split(',').map(Number).filter(Boolean).sort((a, b) => b - a);
  const reg = r.id_reg1 ? I().reg1[r.id_reg1] : null, pic = I().user[r.pic_nrp] || {};
  el.innerHTML = hdr({
    crumbs: [['Register 2 — Izin, Lisensi & Sertifikasi', 'reg2'], [r.id_izin]], title: esc(r.nama_dokumen),
    sub: `<span class="tag">${esc(r.id_izin)}</span> ${pill(stt + (s != null && s >= 0 && s <= ambang() ? ` (H-${s})` : ''), PILL[stt])} <span class="small">No. ${esc(r.nomor_dokumen)} • ${esc(namaSite(r.site))}</span>`,
    actions: `<button class="btn" data-act="back" data-fb="reg2">${ic('arrow_back')} Kembali</button>${can.reg2Edit(r) ? `<button class="btn" data-act="reg2-form" data-id="${esc(r.id_izin)}">${ic('edit')} Ubah</button>` : ''}${can.reg2Arsip(r) ? `<button class="btn do" data-act="reg2-arsip" data-id="${esc(r.id_izin)}">${ic('archive')} Arsipkan</button>` : ''}${can.reg2Edit(r) ? `<button class="btn p" data-act="perpanjang" data-id="${esc(r.id_izin)}">${ic('autorenew')} Perpanjang Izin Ini</button>` : ''}`
  }) + `<div class="grid g-73" style="align-items:start"><div class="col" style="gap:16px">
      <div class="card"><div class="card-h"><div class="ic">${ic('description')}</div><div><h3>Informasi Dokumen</h3><p>${esc(r.jenis_dokumen)} • ${esc(r.lembaga_penerbit || 'Lembaga penerbit belum diisi')}</p></div></div><div class="card-b"><dl class="dl c3">
        <div><dt>Jenis dokumen</dt><dd>${esc(r.jenis_dokumen)}</dd></div><div><dt>Nomor dokumen</dt><dd class="mono">${esc(r.nomor_dokumen)}</dd></div><div><dt>Objek / unit</dt><dd>${esc(r.objek || '–')}</dd></div>
        <div><dt>Nama pemegang</dt><dd>${esc(r.nama_pemegang)}</dd></div><div><dt>Lembaga penerbit</dt><dd>${esc(r.lembaga_penerbit || '–')}</dd></div><div><dt>Dasar hukum</dt><dd>${reg ? `<button class="lnk" data-act="r1-buka" data-id="${esc(reg.id_reg1)}">${esc(reg.id_reg1)} ${ic('arrow_forward', 'xs')}</button><div class="t2 small muted">${esc(judulReg(reg))}</div>` : '–'}</dd></div>
        <div><dt>Site</dt><dd>${esc(namaSite(r.site))}</dd></div><div><dt>Departemen</dt><dd>${esc(namaDept(r.departemen))}</dd></div><div><dt>PIC penanggung jawab</dt><dd><div class="row"><div class="av s">${esc(inisial(pic.nama || r.pic_nrp))}</div><div><b class="small">${esc(pic.nama || r.pic_nrp)}</b><div class="xsmall muted">NRP ${esc(r.pic_nrp)}${pic.jabatan ? ' • ' + esc(pic.jabatan) : ''}</div></div></div></dd></div>
        <div class="full"><dt>Catatan</dt><dd>${esc(r.catatan || '–')}</dd></div></dl></div></div>
      <div class="card"><div class="card-h"><div class="ic">${ic('event')}</div><div class="sp"><h3>Periode Masa Berlaku &amp; Status Komputasi</h3><p>Status dihitung otomatis dari tanggal kedaluwarsa</p></div>${total ? `<span class="pill n">Siklus ${Math.round(total / 365 * 10) / 10} tahun</span>` : ''}</div><div class="card-b">
        <dl class="dl" style="grid-template-columns:repeat(4,minmax(0,1fr))"><div><dt>Tanggal terbit</dt><dd>${fmtTgl(r.tanggal_terbit)}</dd></div><div><dt>Tanggal kedaluwarsa</dt><dd class="${stt === 'Kedaluwarsa' ? 't-r b6' : ''}">${fmtTgl(r.tanggal_kedaluwarsa)}</dd></div><div><dt>Status berlaku <span class="pill n" style="height:16px;font-size:9px">OTOMATIS</span></dt><dd>${pill(stt)}</dd></div><div><dt>Sisa hari <span class="pill n" style="height:16px;font-size:9px">OTOMATIS</span></dt><dd>${selSisa(r)}</dd></div></dl>
        ${total ? `<div class="row small mt16"><span class="sp muted">Progres umur sertifikat: ${nf(Math.max(0, selisih(r.tanggal_terbit, today())))} dari ${nf(total)} hari terlewati (${jalan}%)</span>${stt !== 'Aktif' ? `<span class="t-r b6">Ambang internal ${ambang()} hari</span>` : ''}</div><div class="prog mt8" style="height:8px"><i style="width:${jalan}%;background:linear-gradient(90deg,${WARNA.o},${jalan > 90 ? WARNA.r : WARNA.o})"></i></div>` : ''}</div></div>
      <div class="card"><div class="card-h"><div class="ic">${ic('folder_open')}</div><div class="sp"><h3>Berkas Lampiran &amp; Evidence Terverifikasi</h3><p>Disimpan di Google Drive SHEC (02_Izin_Lisensi_Sertifikasi)</p></div><span class="pill b">${ic('cloud_done', 'xs')} ${lamp.length} berkas</span></div><div class="card-b col" style="gap:12px">${daftarBerkas(lamp, { hapus: l => can.reg2Edit(r) && (!is(R.PIC) || l.diunggah_oleh === S.me.nrp) })}${can.reg2Edit(r) ? zonaUnggah('REG2', r.id_izin, r.site) : ''}</div></div>
    </div><div class="col" style="gap:16px">
      <div class="card"><div class="card-h"><div class="ic">${ic('notifications_active')}</div><div class="sp"><h3>Status Pengingat Otomatis</h3><p>Email digest via Gmail ke PIC &amp; SHEC Site</p></div><span class="tag">FR-05</span></div><div class="card-b col" style="gap:8px">
        ${r.tanggal_kedaluwarsa ? tahap.map(t => { const tgl = addDays(r.tanggal_kedaluwarsa, -t), k = `IZN|${r.id_izin}|${t}|${r.tanggal_kedaluwarsa}`, kirimS = I().notif.has(k), lewat = tgl <= today(); return `<div class="lgd-i"><span class="pill ${t <= 7 ? 'r' : 'o'}" style="flex:0">H-${t}</span><span><b class="small">${t === 7 ? 'Ambang kritis & mitigasi stop unit' : (t <= 30 ? 'Pengajuan berkas resmi' : (t <= 60 ? 'Evaluasi kesiapan riksa uji/PJK3' : 'Perencanaan biaya & anggaran'))}</b><div class="xsmall muted">Jadwal: ${fmtTgl(tgl)}</div></span>${kirimS ? pill('Terkirim', 'g', 'mark_email_read') : (lewat ? pill('Diproses job harian', 'a', false) : pill('Terjadwal', 'n', 'schedule'))}</div>`; }).join('') : '<div class="muted small">Dokumen tanpa masa berlaku — tidak ada pengingat.</div>'}
        <p class="xsmall muted" style="margin:6px 0 0">Setiap pemicu email dicatat permanen di Notifikasi_Log${pic.email_gmail ? ' dan dikirim ke ' + esc(pic.email_gmail) : ''}.</p></div></div>
      <div class="card"><div class="card-h"><div class="ic">${ic('history')}</div><div class="sp"><h3>Riwayat Perpanjangan</h3><p>Reg2_Perpanjangan</p></div></div><div class="card-b">${ppj.length ? `<div class="tl">${ppj.map((x, i) => `<div class="tl-i ${i === 0 ? '' : 'n'}"><div class="tl-h"><b>Siklus ${String(x.tanggal_terbit_baru).slice(0, 4)} – ${String(x.tanggal_kedaluwarsa_baru).slice(0, 4)}${i === 0 ? ' (Aktif)' : ''}</b><span>${fmtTgl(String(x.created_at).slice(0, 10))}</span></div><div class="tl-b">Suket <b>${esc(x.nomor_baru)}</b> berlaku ${fmtTgl(x.tanggal_terbit_baru)} s.d. ${fmtTgl(x.tanggal_kedaluwarsa_baru)}${x.lembaga ? ' oleh ' + esc(x.lembaga) : ''}. Sebelumnya ${esc(x.nomor_lama)}.${x.catatan ? `<div class="small muted mt8">${esc(x.catatan)}</div>` : ''}</div></div>`).join('')}<div class="tl-i n"><div class="tl-h"><b>Penerbitan awal tercatat</b><span>${fmtTgl(String(r.created_at).slice(0, 10))}</span></div></div></div>` : kosong('history', 'Belum ada perpanjangan', 'Riwayat akan tercatat otomatis saat dokumen diperpanjang.')}</div></div>
      <div class="card"><div class="card-b"><div class="xsmall muted b6 mb8">INTEGRITAS AUDIT MANDATORI</div><div class="kpi-v">${lamp.length ? '100%' : '0%'}<small class="${lamp.length ? 't-g' : 't-r'}">${lamp.length ? 'Terdokumentasi' : 'Belum ada evidence'}</small></div><p class="small muted" style="margin:6px 0 0">Diperbarui ${fmtWkt(r.updated_at)} oleh ${esc(namaUser(r.updated_by))}.</p></div></div>
    </div></div>`;
};
function formReg2(r) {
  const baru = !r, pic = is(R.PIC);
  r = r || { jenis_dokumen: 'Izin', site: S.ui.site !== 'ALL' ? S.ui.site : (mySites() || [''])[0] };
  const users = (S.data.users || []).filter(u => u.status === 'Aktif').map(u => [u.nrp, `${u.nama} (${u.nrp}) — ${ROLE_LABEL[u.role] || u.role}`]);
  modal({ title: baru ? 'Tambah Izin / Lisensi / Sertifikasi' : 'Ubah ' + r.id_izin, sub: baru ? 'Status masa berlaku dihitung otomatis dari tanggal kedaluwarsa.' : r.nama_dokumen, icon: 'verified', size: 'lg',
    body: `<form id="fReg2" class="frm" novalidate>
      <div class="fsec"><span class="bar"></span>Data Dokumen</div>
      ${fld({ n: 'jenis_dokumen', l: 'Jenis dokumen', t: 'select', opts: ['Izin', 'Lisensi', 'Sertifikasi'], v: r.jenis_dokumen, req: true, ph: false })}${fld({ n: 'nomor_dokumen', l: 'Nomor dokumen', v: r.nomor_dokumen, req: true, max: 120 })}
      ${fld({ n: 'nama_dokumen', l: 'Nama dokumen', v: r.nama_dokumen, req: true, full: true, max: 300, ph: 'Contoh: Suket Riksa Uji Crane Mobile 50T' })}
      ${fld({ n: 'objek', l: 'Objek / unit / personel', v: r.objek, max: 300 })}${fld({ n: 'nama_pemegang', l: 'Nama pemegang', v: r.nama_pemegang, req: true, max: 200 })}
      ${fld({ n: 'lembaga_penerbit', l: 'Lembaga penerbit / PJK3', v: r.lembaga_penerbit, max: 200 })}${fld({ n: 'id_reg1', l: 'Dasar hukum (Register 1)', t: 'select', opts: (S.data.reg1 || []).filter(aktif).map(x => [x.id_reg1, x.id_reg1 + ' — ' + judulReg(x)]), v: r.id_reg1, ph: '— Opsional —' })}
      <div class="fsec"><span class="bar"></span>Lokasi &amp; Penanggung Jawab</div>
      ${fld({ n: 'site', l: 'Site', t: 'select', opts: siteList().map(s => [s.kode, s.nama]), v: r.site, req: true, ro: pic })}${fld({ n: 'departemen', l: 'Departemen', t: 'select', opts: deptList().map(d => [d.kode, d.nama]), v: r.departemen, req: true, ro: pic })}
      ${fld({ n: 'pic_nrp', l: 'PIC (pengguna terdaftar)', t: 'select', opts: users, v: r.pic_nrp, req: true, full: true, ro: pic })}
      <div class="fsec"><span class="bar"></span>Masa Berlaku</div>
      ${fld({ n: 'tanggal_terbit', l: 'Tanggal terbit', t: 'date', v: r.tanggal_terbit, req: true })}${fld({ n: 'tanggal_kedaluwarsa', l: 'Tanggal kedaluwarsa', t: 'date', v: r.tanggal_kedaluwarsa, help: 'Kosongkan bila dokumen berlaku tanpa batas waktu.' })}
      ${fld({ n: 'catatan', l: 'Catatan', t: 'textarea', rows: 2, v: r.catatan, full: true, max: 2000 })}</form>`,
    foot: `<span class="lf">${ic('shield', 's')} Tercatat di Audit_Log</span><button class="btn gh" data-act="mclose">Batal</button><button class="btn p" data-act="reg2-simpan" data-id="${esc(r.id_izin || '')}">${ic('save')} Simpan</button>` });
}
Object.assign(ACT, {
  'reg2-simpan': t => {
    const f = $('#fReg2');
    if (!validasi(f, x => ({ tanggal_kedaluwarsa: x.tanggal_kedaluwarsa && x.tanggal_kedaluwarsa < x.tanggal_terbit ? 'Tidak boleh sebelum tanggal terbit.' : '' }))) return;
    const v = bacaForm(f), id = t.dataset.id;
    if (is(R.PIC) && id) { const r = I().reg2[id]; v.site = r.site; v.departemen = r.departemen; v.pic_nrp = r.pic_nrp; }
    v.id_izin = id;
    const tmpId = id || uid('tmpI');
    tutupModal();
    kirim('reg2.simpan', v, {
      apply: () => upsert('reg2', 'id_izin', Object.assign({}, v, { id_izin: tmpId, status_aktif: 'Active', _tmp: !id, created_at: new Date().toISOString().slice(0, 19).replace('T', ' ') })),
      sukses: res => { gantiId('reg2', 'id_izin', tmpId, res.data.reg2); },
      gagal: () => setTimeout(() => { formReg2(Object.assign({}, I().reg2[id] || {}, v)); }, 50)
    }).catch(() => { });
  },
  'reg2-arsip': async t => {
    const r = I().reg2[t.dataset.id]; if (!r) return;
    const alasan = await konfirmasi({ title: 'Arsipkan dokumen ini?', msg: 'Dokumen tidak lagi dipantau masa berlakunya, tetapi tetap tersimpan untuk audit.', ok: 'Arsipkan', danger: true, alasan: true });
    if (!alasan) return;
    go('reg2');
    kirim('reg2.arsip', { id_izin: r.id_izin, alasan }, { apply: () => upsert('reg2', 'id_izin', { id_izin: r.id_izin, status_aktif: 'Archived' }) }).catch(() => { });
  }
});
function formPerpanjang(r) {
  if (!r) return;
  const terbit = today(), exp = r.tanggal_kedaluwarsa && r.tanggal_kedaluwarsa > today() ? addDays(r.tanggal_kedaluwarsa, 730) : addDays(today(), 730);
  S.ui.ppjFiles = [];
  modal({ title: 'Perpanjang Izin / Lisensi', sub: 'Siklus pembaruan masa berlaku dokumen ' + r.id_izin, icon: 'autorenew', size: 'lg',
    body: `<form id="fPpj" class="frm" novalidate>
      <div class="full note b">${ic('info')}<div>Masa berlaku saat ini: <b>${fmtTgl(r.tanggal_terbit)} – ${fmtTgl(r.tanggal_kedaluwarsa)}</b> (No. ${esc(r.nomor_dokumen)})</div></div>
      ${fld({ n: 'tanggal_terbit_baru', l: 'Tanggal terbit baru', t: 'date', v: terbit, req: true })}${fld({ n: 'tanggal_kedaluwarsa_baru', l: 'Tanggal kedaluwarsa baru', t: 'date', v: exp, req: true })}
      ${fld({ n: 'nomor_baru', l: 'Nomor surat / rekomendasi baru', req: true, full: true, max: 120 })}
      ${fld({ n: 'lembaga', l: 'Lembaga / PJK3 pelaksana', v: r.lembaga_penerbit, full: true, max: 200 })}
      <div class="full fld"><label>Unggah berkas suket / sertifikat baru</label><div class="drop" data-act="ppj-file" role="button" tabindex="0"><div class="dic">${ic('cloud_upload')}</div>Klik untuk memilih berkas PDF/JPG/PNG<small>Maks. ${esc(cfg('maks_upload_mb', 10))} MB • disimpan otomatis ke Google Drive SHEC</small></div><div id="ppjList" class="files mt8"></div></div>
      ${fld({ n: 'catatan', l: 'Catatan tambahan & no. referensi SPK', t: 'textarea', rows: 2, full: true, max: 2000 })}</form>`,
    foot: `<span class="lf">${ic('task_alt', 's')} Dicatat pada Reg2_Perpanjangan &amp; Audit_Log</span><button class="btn gh" data-act="mclose">Batal</button><button class="btn p" data-act="ppj-simpan" data-id="${esc(r.id_izin)}">${ic('save')} Simpan Perpanjangan</button>` });
}
Object.assign(ACT, {
  'ppj-file': () => pilihBerkas(files => { files.forEach(f => { const c = cekBerkas(f); if (c.err) toast(c.err, 'error'); else S.ui.ppjFiles.push(f); }); $('#ppjList').innerHTML = S.ui.ppjFiles.map((f, i) => `<div class="file"><div class="fic">${ic('attach_file')}</div><div class="fn"><b>${esc(f.name)}</b><span>${ukuran(f.size)} • diunggah setelah disimpan</span></div><button type="button" class="btn gh ic sm" data-act="ppj-hapus" data-i="${i}" aria-label="Hapus">${ic('close')}</button></div>`).join(''); }),
  'ppj-hapus': t => { S.ui.ppjFiles.splice(Number(t.dataset.i), 1); t.closest('.file').remove(); },
  'ppj-simpan': t => {
    const f = $('#fPpj'), r = I().reg2[t.dataset.id]; if (!r) return;
    if (!validasi(f, x => ({ tanggal_kedaluwarsa_baru: x.tanggal_kedaluwarsa_baru <= x.tanggal_terbit_baru ? 'Harus setelah tanggal terbit baru.' : '' }))) return;
    const v = bacaForm(f), files = S.ui.ppjFiles.slice();
    v.id_izin = r.id_izin;
    tutupModal();
    const tmp = { id_perpanjangan: uid('tmpP'), id_izin: r.id_izin, nomor_lama: r.nomor_dokumen, tanggal_terbit_lama: r.tanggal_terbit, tanggal_kedaluwarsa_lama: r.tanggal_kedaluwarsa, nomor_baru: v.nomor_baru, tanggal_terbit_baru: v.tanggal_terbit_baru, tanggal_kedaluwarsa_baru: v.tanggal_kedaluwarsa_baru, lembaga: v.lembaga, catatan: v.catatan, created_at: new Date().toISOString().slice(0, 19).replace('T', ' '), created_by: S.me.nrp };
    kirim('reg2.perpanjang', v, {
      apply: () => { const u1 = upsert('reg2', 'id_izin', { id_izin: r.id_izin, nomor_dokumen: v.nomor_baru, tanggal_terbit: v.tanggal_terbit_baru, tanggal_kedaluwarsa: v.tanggal_kedaluwarsa_baru, lembaga_penerbit: v.lembaga || r.lembaga_penerbit }); const u2 = upsert('perpanjangan', 'id_perpanjangan', tmp); return () => { u1(); u2(); }; },
      sukses: res => { gantiId('reg2', 'id_izin', r.id_izin, res.data.reg2); gantiId('perpanjangan', 'id_perpanjangan', tmp.id_perpanjangan, res.data.perpanjangan); if (files.length) unggah('REG2', r.id_izin, files, r.site); }
    }).catch(() => { });
  }
});

/* ───────────── HALAMAN: REGISTER 3 — EVALUASI & RTP ───────────── */
const PARTIAL = {};
function usersSite(site) { return (S.data.users || []).filter(u => u.status === 'Aktif' && (u.role === R.CORP || !u.site || u.site === 'ALL' || String(u.site).split(',').includes(site))); }
HAL.evaluasi = el => {
  const tab = S.ui.tab.evaluasi || 'ev', per = S.ui.evPer || periodeAktif();
  const evs = D.ev(per), rtps = D.rtp();
  const nOvd = rtps.filter(r => stRtp(r) === 'Overdue').length;
  const periods = Array.from(new Set([periodeAktif(), periodeSebelum(periodeAktif(), 1), periodeSebelum(periodeAktif(), 2)].concat((S.data.evaluasi || []).map(e => e.periode)))).filter(Boolean).sort().reverse();
  el.innerHTML = hdr({
    crumbs: [['Register Kepatuhan', 'reg1'], ['Register 3 — Evaluasi Kepatuhan & RTP']], title: 'Register 3 — Evaluasi Kepatuhan Peraturan &amp; Standar', tag: 'SMKP Minerba Terintegrasi',
    sub: 'Pemantauan berkala kepatuhan per semester terhadap kewajiban hukum Register 1 (SMKP Minerba Elemen II.3 &amp; V.3).',
    actions: `<label class="sitesel" style="max-width:none">${ic('calendar_month', 's muted')}<select data-ch="ev-per" aria-label="Periode evaluasi">${opsi(periods.map(p => [p, labelPeriode(p) + (p === periodeAktif() ? ' (Aktif)' : '')]), per)}</select></label>${is(R.PIC) ? '' : `<button class="btn" data-act="laporan" data-j="${tab === 'rtp' ? 'RTP' : 'REG3'}" data-f="xlsx" data-p="${esc(per)}">${ic('table_view')} Ekspor ${tab === 'rtp' ? 'Monitoring RTP' : 'Laporan Kepatuhan'}</button>`}${can.evalTambah() ? `<button class="btn p" data-act="go" data-sec="evalform">${ic('add_circle')} Tambah Evaluasi Semester</button>` : ''}`
  }) + `<div class="tabs" role="tablist"><button class="tab ${tab === 'ev' ? 'on' : ''}" role="tab" data-act="tab" data-g="evaluasi" data-v="ev">Evaluasi Kepatuhan <span class="cnt">${evs.length}</span></button><button class="tab ${tab === 'rtp' ? 'on' : ''}" role="tab" data-act="tab" data-g="evaluasi" data-v="rtp">Rencana Tindak Lanjut / RTP <span class="cnt">${rtps.filter(r => r.status_rtp !== 'Closed').length}</span>${nOvd ? `<span class="cnt r">${nOvd} Overdue</span>` : ''}</button></div>`
    + (tab === 'rtp' ? tabRtp(rtps) : tabEval(evs, per));
};
CH['ev-per'] = t => { S.ui.evPer = t.value; renderSec('evaluasi'); };
function tabEval(evs, per) {
  const st = tst('ev', { hasil: 'ALL', ver: 'ALL', dept: 'ALL', nc: false });
  const belum = can.evalTambah() ? kwBelumEval(per) : [];
  const h = x => evs.filter(e => e.hasil === x).length;
  const ver = evs.filter(e => e.status_verifikasi === 'Terverifikasi');
  const vc = ver.filter(e => e.hasil === 'Compliant').length, vna = ver.filter(e => e.hasil === 'N/A').length;
  const p = pct(vc, ver.length - vna), tg = target();
  const pPrev = (() => { const pv = D.ev(periodeSebelum(per, 1)).filter(e => e.status_verifikasi === 'Terverifikasi'); const c = pv.filter(e => e.hasil === 'Compliant').length; return pct(c, pv.length - pv.filter(e => e.hasil === 'N/A').length); })();
  const rows = evs.filter(e => { const k = I().kw[e.id_kewajiban] || {}, r = I().reg1[e.id_reg1] || {}; return (st.hasil === 'ALL' || e.hasil === st.hasil) && (!st.nc || e.hasil === 'Non-Compliant') && (st.ver === 'ALL' || e.status_verifikasi === st.ver) && (st.dept === 'ALL' || k.departemen_penanggung_jawab === st.dept) && cari(st.q, e.id_evaluasi, r.nomor, r.judul, judulReg(r), k.pasal_butir, k.uraian_kewajiban, e.temuan, namaSite(e.site)); })
    .sort((a, b) => (a.status_verifikasi === 'Menunggu Verifikasi' ? -1 : 0) - (b.status_verifikasi === 'Menunggu Verifikasi' ? -1 : 0) || String(b.id_evaluasi).localeCompare(a.id_evaluasi));
  const ring = `<div class="ring" style="background:conic-gradient(var(--o) ${(p || 0) * 3.6}deg,var(--o-t) 0)"><div>${ic('verified')}</div></div>`;
  return (belum.length ? `<div class="card" style="border-left:3px solid var(--o);margin-bottom:16px"><div class="card-h"><div class="ic" style="background:var(--o-t);color:var(--o-d)">${ic('assignment_late')}</div><div class="sp"><h3>${belum.length} Kewajiban Belum Dievaluasi — ${esc(labelPeriode(per))}</h3><p>Kewajiban pasal dari Register 1 yang sudah berlaku untuk site Anda, tetapi belum ada evaluasinya di periode ini.</p></div></div>
    <div class="card-b col" style="gap:8px">${belum.slice(0, 6).map(k => { const r = I().reg1[k.id_reg1] || {}; return `<div class="file" style="align-items:center"><div class="fic" style="background:var(--o-t);color:var(--o-d)">${ic('rule')}</div><div class="fn"><b>${esc(judulReg(r))}${k.pasal_butir ? ' — ' + esc(k.pasal_butir) : ''}</b><span class="clamp2">${esc(k.uraian_kewajiban)}</span></div><button class="btn sm p" data-act="eval-buat-kw" data-id="${esc(k.id_kewajiban)}">${ic('add')} Buat Evaluasi</button></div>`; }).join('')}${belum.length > 6 ? `<div class="small muted">+${belum.length - 6} kewajiban lainnya belum dievaluasi.</div>` : ''}</div></div>` : '')
    + `<div class="grid g6 kpis mb16" style="grid-template-columns:repeat(4,minmax(0,1fr)) minmax(0,2fr)">
      ${kpi({ label: 'COMPLIANT', value: nf(h('Compliant')), unit: 'kewajiban', icon: 'check_circle', ic: 'g', vc: 't-g', sub: `Proporsi ${fpct(pct(h('Compliant'), evs.length))} • ${pill('Evidence', 'g', false)}`, act: 'ev-hasil', v: 'Compliant', sel: st.hasil === 'Compliant' })}
      ${kpi({ label: 'NON-COMPLIANT', value: nf(h('Non-Compliant')), unit: 'kewajiban', icon: 'warning', ic: 'r', vc: 't-r', l: h('Non-Compliant') ? 'r' : '', sub: `Rasio ${fpct(pct(h('Non-Compliant'), evs.length))} • ${pill('Wajib RTP', 'r', false)}`, act: 'ev-hasil', v: 'Non-Compliant', sel: st.hasil === 'Non-Compliant' })}
      ${kpi({ label: 'PENDING REVIEW', value: nf(h('Pending')), unit: 'kewajiban', icon: 'schedule', ic: 'b', vc: 't-b', sub: `Porsi ${fpct(pct(h('Pending'), evs.length))}`, act: 'ev-hasil', v: 'Pending', sel: st.hasil === 'Pending' })}
      ${kpi({ label: 'N/A (TIDAK BERLAKU)', value: nf(h('N/A')), unit: 'kewajiban', icon: 'block', sub: `Porsi ${fpct(pct(h('N/A'), evs.length))} • di luar scope`, act: 'ev-hasil', v: 'N/A', sel: st.hasil === 'N/A' })}
      <div class="kpi" style="background:linear-gradient(110deg,#FFF1E6,#FFFFFF);border-color:var(--o-b)"><div class="kpi-h"><div class="kpi-l b6">% KEPATUHAN TERVERIFIKASI <span class="pill o">SMKP V.3</span></div>${ring}</div>
        <div class="kpi-v t-o" style="font-size:34px">${fpct(p)}${pPrev != null && p != null ? `<small class="${p >= pPrev ? 't-g' : 't-r'}">${ic(p >= pPrev ? 'trending_up' : 'trending_down', 'xs')} ${p >= pPrev ? '+' : ''}${String(Math.round((p - pPrev) * 10) / 10).replace('.', ',')}% vs smt lalu</small>` : ''}</div>
        <div class="kpi-s">Dihitung dari evaluasi terverifikasi (${vc} Compliant ÷ ${ver.length - vna} terverifikasi, tidak termasuk ${vna} N/A). Pending &amp; draft tidak dihitung.</div>
        <div class="row mt8">${p != null && p >= tg ? pill(`Target ≥ ${tg}% terpenuhi`, 'g', 'check') : pill(`Target ≥ ${tg}% belum terpenuhi`, 'r')}</div></div>
    </div>
    <div class="card"><div class="fbar"><div class="srch">${ic('search')}<input class="inp" id="evQ" data-in="q" data-t="ev" value="${esc(st.q)}" placeholder="Cari nomor regulasi, pasal, uraian kewajiban, temuan…" aria-label="Cari evaluasi"></div>
      <select class="inp" data-ch="flt" data-t="ev" data-k="dept" aria-label="Departemen">${opsi([['ALL', 'Semua departemen']].concat(deptList().map(d => [d.kode, d.nama])), st.dept)}</select>
      <select class="inp" data-ch="flt" data-t="ev" data-k="hasil" aria-label="Hasil">${opsi([['ALL', 'Semua status hasil']].concat(HASIL), st.hasil)}</select>
      <select class="inp" data-ch="flt" data-t="ev" data-k="ver" aria-label="Status verifikasi">${opsi([['ALL', 'Semua status verifikasi'], 'Draft', 'Menunggu Verifikasi', 'Terverifikasi'], st.ver)}</select>
      <label class="row small" style="gap:8px"><span class="tgl"><input type="checkbox" data-ch="flt" data-t="ev" data-k="nc" ${st.nc ? 'checked' : ''}><span></span></span><span class="t-r b6">${ic('priority_high', 'xs')} Hanya Non-Compliant</span></label></div>
      ${tabel('ev', { key: 'id_evaluasi', rows, rowAct: 'ev-buka', unit: `evaluasi ${labelPeriode(per)}`, rowCls: e => e.hasil === 'Non-Compliant' ? 'crit' : '', empty: kosong('fact_check', 'Belum ada evaluasi', `Belum ada evaluasi untuk ${labelPeriode(per)}${can.evalTambah() ? '. Tambahkan evaluasi semester untuk kewajiban di Register 1.' : '.'}`, can.evalTambah() ? `<button class="btn p" data-act="go" data-sec="evalform">${ic('add')} Tambah Evaluasi</button>` : ''), cols: [
        { l: 'ID Evaluasi', r: e => `<div class="idc" style="color:${WARNA[PILL[e.hasil]] || ''}">${esc(e.id_evaluasi)}</div><div class="t2">${fmtTgl(e.tanggal_evaluasi)}</div>` },
        { l: 'Regulasi & Pasal Terkait', r: e => { const r = I().reg1[e.id_reg1] || {}, k = I().kw[e.id_kewajiban] || {}; return `<div class="row" style="gap:6px;align-items:flex-start">${pill(r.jenis_peraturan || '–', 'o', false)}<div><div class="t1">${esc(judulReg(r))}</div><div class="t2">${esc(k.pasal_butir || '–')}</div></div></div>`; } },
        { l: 'Uraian Kewajiban Hukum', r: e => { const k = I().kw[e.id_kewajiban] || {}; return `<div class="clamp2" style="max-width:360px">${esc(k.uraian_kewajiban || '–')}</div>${e.temuan && e.hasil !== 'Compliant' ? `<div class="small ${e.hasil === 'Non-Compliant' ? 't-r' : 'muted'} mt8">${ic('error', 'xs')} ${esc(e.temuan)}</div>` : ''}`; } },
        { l: 'Site & Dept', r: e => `<div>${esc(namaSite(e.site))}</div><div class="t2">${esc(namaDept((I().kw[e.id_kewajiban] || {}).departemen_penanggung_jawab))}</div>` },
        { l: 'Evidence', r: e => { const n = lampiran('EVAL', e.id_evaluasi).length; return n ? `<span class="pill b">${ic('attach_file')} ${n} berkas</span>` : (e.hasil === 'N/A' ? '<span class="muted small"><i>Tidak diperlukan</i></span>' : pill('Belum ada', 'a')); } },
        { l: 'Hasil', r: e => pill(e.hasil) },
        { l: 'Verifikasi', r: e => pill(e.status_verifikasi) },
        { l: '', cls: 'act', r: e => can.evalVerif(e) ? `<button class="btn sm gn" data-act="ev-buka" data-id="${esc(e.id_evaluasi)}">${ic('verified')} Verifikasi</button>` : (can.evalEdit(e) ? `<button class="btn sm" data-act="ev-buka" data-id="${esc(e.id_evaluasi)}">${ic('edit')} Ubah</button>` : '') }
      ] })}</div>
    <div class="card tint mt16"><div class="card-b row wrap" style="gap:14px"><div class="ic" style="width:40px;height:40px;border-radius:10px;background:#fff;color:var(--o-d);display:flex;align-items:center;justify-content:center">${ic('gavel')}</div><div class="sp" style="min-width:260px"><b>Mandatori Klausul SMKP Minerba Sub Elemen II.3 &amp; V.3</b><div class="small muted2">Evaluasi kepatuhan hukum dilaksanakan minimal setiap semester. Temuan Non-Compliant wajib ditindaklanjuti dengan RTP. Status RTP Closed tidak otomatis mengubah hasil evaluasi menjadi Compliant.</div></div>${is(R.CORP, R.SITE, R.MGT) ? `<button class="btn" data-act="go" data-sec="audit">${ic('history')} Log Validasi SHEC</button>` : ''}</div></div>`;
}
ACT['ev-hasil'] = t => { const st = tst('ev'); st.hasil = st.hasil === t.dataset.v ? 'ALL' : t.dataset.v; st.page = 1; renderSec('evaluasi'); };
ACT['eval-buat-kw'] = t => go('evalform', { kw: t.dataset.id });
ACT['ev-buka'] = t => go('evalform', { id: t.dataset.id });
function tabRtp(rtps) {
  const st = tst('rtp', { st: 'ALL', pic: 'ALL' });
  const n = s => rtps.filter(r => stRtp(r) === s).length;
  const pics = Array.from(new Set(rtps.map(r => r.pic_nrp)));
  const rows = rtps.filter(r => (st.st === 'ALL' || stRtp(r) === st.st || (st.st === 'AKTIF' && r.status_rtp !== 'Closed')) && (st.pic === 'ALL' || r.pic_nrp === st.pic) && cari(st.q, r.id_rtp, r.tindakan_perbaikan, r.id_evaluasi, namaUser(r.pic_nrp), namaSite(r.site)))
    .sort((a, b) => { const o = { Overdue: 0, Diajukan: 1, Open: 2, Closed: 3 }; return (o[stRtp(a)] - o[stRtp(b)]) || String(a.due_date).localeCompare(b.due_date); });
  return `<div class="grid g4 kpis mb16">
      ${kpi({ label: 'OPEN / DALAM PROGRES', value: nf(n('Open')), unit: 'tindakan', icon: 'pending_actions', ic: 'b', vc: 't-b', sub: 'Dikerjakan PIC departemen', act: 'rtp-st', v: 'Open', sel: st.st === 'Open' })}
      ${kpi({ label: 'MENUNGGU VERIFIKASI', value: nf(n('Diajukan')), unit: 'tindakan', icon: 'task', ic: 'a', vc: 't-a', sub: 'Diajukan PIC, menunggu SHEC Site', act: 'rtp-st', v: 'Diajukan', sel: st.st === 'Diajukan' })}
      ${kpi({ label: 'OVERDUE', value: nf(n('Overdue')), unit: 'tindakan', icon: 'assignment_late', ic: 'r', vc: 't-r', l: n('Overdue') ? 'r' : '', sub: 'Melewati due date', act: 'rtp-st', v: 'Overdue', sel: st.st === 'Overdue' })}
      ${kpi({ label: 'CLOSED / DIVERIFIKASI', value: nf(n('Closed')), unit: 'tindakan', icon: 'task_alt', ic: 'g', vc: 't-g', sub: `${fpct(pct(n('Closed'), rtps.length))} dari total RTP`, act: 'rtp-st', v: 'Closed', sel: st.st === 'Closed' })}
    </div>
    <div class="card"><div class="fbar"><div class="srch">${ic('search')}<input class="inp" id="rtpQ" data-in="q" data-t="rtp" value="${esc(st.q)}" placeholder="Cari ID RTP, tindakan, evaluasi, PIC…" aria-label="Cari RTP"></div>
      <select class="inp" data-ch="flt" data-t="rtp" data-k="st" aria-label="Status RTP">${opsi([['ALL', 'Semua status'], ['AKTIF', 'Belum ditutup'], 'Open', 'Diajukan', 'Overdue', 'Closed'], st.st)}</select>
      <select class="inp" data-ch="flt" data-t="rtp" data-k="pic" aria-label="PIC">${opsi([['ALL', 'Semua PIC']].concat(pics.map(p => [p, namaUser(p)])), st.pic)}</select></div>
      ${tabel('rtp', { key: 'id_rtp', rows, rowAct: 'buka-rtp1', unit: 'tindakan perbaikan', rowCls: r => (stRtp(r) === 'Overdue' ? 'crit ' : '') + (S.ui.drawerId === r.id_rtp && S.ui.drawer ? 'sel' : ''), empty: kosong('assignment', 'Tidak ada RTP', 'RTP diterbitkan dari evaluasi berhasil Non-Compliant.'), cols: [
        { l: 'ID RTP', r: r => `<div class="idc">${esc(r.id_rtp)}</div>` },
        { l: 'Uraian Tindakan Perbaikan', r: r => `<div class="t1 clamp2" style="max-width:360px">${esc(r.tindakan_perbaikan)}</div>` },
        { l: 'Dasar Temuan & Regulasi', r: r => { const e = I().ev[r.id_evaluasi] || {}, g = I().reg1[e.id_reg1] || {}; return `<div class="small">${esc(judulReg(g))}</div><div class="t2">${esc(r.id_evaluasi)}${e.hasil ? ' • ' + esc(e.hasil) : ''}</div>`; } },
        { l: 'Site', r: r => esc(namaSite(r.site)) },
        { l: 'PIC', r: r => `<div class="row"><div class="av s">${esc(inisial(namaUser(r.pic_nrp)))}</div><span class="small">${esc(namaUser(r.pic_nrp))}</span></div>` },
        { l: 'Due Date', r: r => `<span class="nowrap">${fmtTgl(r.due_date)}</span>` },
        { l: 'Sisa / Terlambat', r: r => { const st2 = stRtp(r); if (st2 === 'Closed') return `<span class="t-g small">${ic('check', 'xs')} Selesai ${fmtTgl(r.tanggal_verifikasi)}</span>`; const s = selisih(today(), r.due_date); return s < 0 ? `<b class="t-r nowrap">${-s} hari terlambat</b>` : `<span class="nowrap ${s <= 3 ? 't-a b6' : ''}">${s === 0 ? 'Hari ini' : s + ' hari lagi'}</span>`; } },
        { l: 'Status', r: r => pill(stRtp(r)) }
      ] })}</div>`;
}
ACT['rtp-st'] = t => { const st = tst('rtp'); st.st = st.st === t.dataset.v ? 'ALL' : t.dataset.v; st.page = 1; renderSec('evaluasi'); };
ACT['buka-rtp1'] = t => bukaRtp(t.dataset.id);

/* ── Drawer detail RTP ── */
function bukaRtp(id) { S.ui.drawerId = id; bukaDrawer(() => drawerRtp(id)); if (S.ui.sec === 'evaluasi') renderSec('evaluasi', true); }
function drawerRtp(id) {
  const r = I().rtp[id]; if (!r) return null;
  const e = I().ev[r.id_evaluasi] || {}, kw = I().kw[e.id_kewajiban] || {}, reg = I().reg1[e.id_reg1] || {};
  const st = stRtp(r), s = selisih(today(), r.due_date), pic = I().user[r.pic_nrp] || {};
  const prog = (I().prog[id] || []).slice().sort((a, b) => String(a.waktu).localeCompare(b.waktu));
  const lamp = lampiran('RTP', id), bolehCatat = can.rtpProgres(r), sayaPic = r.pic_nrp === S.me.nrp;
  let aksi = '';
  if (can.rtpAjukan(r)) aksi += `<button class="btn p" data-act="rtp-ajukan" data-id="${esc(id)}">${ic('send')} Ajukan Penyelesaian</button>`;
  if (can.rtpVerif(r)) aksi += `<button class="btn gn" data-act="rtp-tutup" data-id="${esc(id)}">${ic('task_alt')} Verifikasi &amp; Tutup RTP</button><button class="btn do" data-act="rtp-kembali" data-id="${esc(id)}">${ic('undo')} Kembalikan</button>`;
  if (can.rtpEdit(r)) aksi += `<button class="btn gh" data-act="rtp-ubah" data-id="${esc(id)}">${ic('edit')} Ubah</button>`;
  return `<div class="drw-h"><div style="min-width:0;flex:1"><div class="row wrap"><h3 style="font-size:18px">${esc(id)}</h3>${pill(st === 'Overdue' ? `Overdue (${-s} hari)` : st, PILL[st])}</div>
      <button class="lnk small mt8" data-act="go" data-sec="reg1d" data-id="${esc(reg.id_reg1 || '')}" ${reg.id_reg1 ? '' : 'disabled'}>${ic('menu_book', 's')} ${esc(judulReg(reg))}${kw.pasal_butir ? ' • ' + esc(kw.pasal_butir) : ''}</button></div><button class="xbtn" data-act="dclose" aria-label="Tutup detail">${ic('close')}</button></div>
    <div class="drw-b">
      <div class="card"><div class="card-b"><div class="xsmall b6 muted mb8">URAIAN TINDAKAN PERBAIKAN</div><div class="b6" style="font-size:14.5px;line-height:1.5">${esc(r.tindakan_perbaikan)}</div>
        <dl class="dl mt16"><div><dt>PIC penanggung jawab</dt><dd><b>${esc(pic.nama || r.pic_nrp)}</b><div class="small muted">NRP ${esc(r.pic_nrp)}${pic.departemen ? ' (' + esc(namaDept(pic.departemen)) + ')' : ''}</div></dd></div><div><dt>Lokasi site</dt><dd>${esc(namaSite(r.site))}</dd></div>
        <div><dt>Target selesai (due date)</dt><dd><b>${fmtTgl(r.due_date)}</b>${st === 'Overdue' ? `<div class="small t-r">Terlambat ${-s} hari kalender</div>` : ''}</dd></div><div><dt>Evaluasi induk</dt><dd><button class="lnk" data-act="ev-buka" data-id="${esc(r.id_evaluasi)}">${esc(r.id_evaluasi)}</button>${e.hasil ? `<div class="small ${e.hasil === 'Non-Compliant' ? 't-r' : ''}">Temuan: ${esc(e.hasil)}</div>` : ''}</dd></div>
        ${e.temuan ? `<div class="full"><dt>Temuan</dt><dd class="small">${esc(e.temuan)}</dd></div>` : ''}</dl></div></div>
      <div class="card"><div class="card-h"><h3 class="sp">Bukti Objektif Penyelesaian</h3><span class="pill b">${lamp.length} berkas</span></div><div class="card-b col" style="gap:10px">${daftarBerkas(lamp, { hapus: l => bolehCatat && (!is(R.PIC) || l.diunggah_oleh === S.me.nrp), teksKosong: 'Belum ada bukti. Unggah bukti sebelum mengajukan penyelesaian.' })}${bolehCatat ? zonaUnggah('RTP', id, r.site, 'Tarik & letakkan bukti tambahan atau klik untuk memilih') : ''}</div></div>
      <div class="card"><div class="card-h"><h3 class="sp">Catatan Progres &amp; Klarifikasi</h3><span class="xsmall muted">${prog.length} entri jejak audit</span></div><div class="card-b col" style="gap:10px">
        ${prog.length ? prog.map(x => `<div class="msg ${x.nrp === S.me.nrp ? 'me' : ''} ${['Dikembalikan'].includes(x.jenis) ? 'r' : ''}"><div class="msg-h"><b>${esc(x.nama)} (${esc(x.peran)})</b><span>${fmtWkt(x.waktu)} WIB</span></div>${x.jenis !== 'Progres' ? `<div class="mb8">${pill(x.jenis, { Dibuat: 'n', Diajukan: 'a', Ditutup: 'g', Dikembalikan: 'r', Diubah: 'b' }[x.jenis] || 'n', false)}</div>` : ''}<p>${esc(x.catatan)}</p>${x._tmp ? '<div class="xsmall muted mt8"><span class="spin s"></span> Mengirim…</div>' : ''}</div>`).join('') : '<div class="muted small">Belum ada catatan.</div>'}
        ${bolehCatat ? `<div class="fld"><label for="rtpCat" class="sr">Catatan progres</label><textarea class="inp" id="rtpCat" rows="2" maxlength="2000" placeholder="Tulis progres atau klarifikasi…"></textarea></div><div class="row"><span class="sp"></span><button class="btn t sm" data-act="rtp-catat" data-id="${esc(id)}">${ic('send')} Kirim Catatan</button></div>` : ''}</div></div>
    </div>
    <div class="drw-f">${aksi || ''}${sayaPic && r.status_rtp !== 'Closed' && !can.rtpVerif(r) ? `<span class="small muted row">${ic('lock', 's')} PIC tidak dapat menutup RTP sendiri</span>` : ''}${!aksi && r.status_rtp === 'Closed' ? `<span class="small t-g row">${ic('verified', 's')} Diverifikasi ${esc(namaUser(r.diverifikasi_oleh))} • ${fmtTgl(r.tanggal_verifikasi)}</span>` : ''}<span class="sp"></span><span class="xsmall muted">Diperbarui ${fmtWkt(r.updated_at)} oleh ${esc(namaUser(r.updated_by))}</span></div>`;
}
function progTmp(id, jenis, catatan) { return { id: uid('tmpG'), id_rtp: id, waktu: new Date().toISOString().slice(0, 19).replace('T', ' '), nrp: S.me.nrp, nama: S.me.nama, peran: ROLE_LABEL[S.me.role], jenis, catatan, _tmp: true }; }
Object.assign(ACT, {
  'rtp-catat': t => {
    const id = t.dataset.id, ta = $('#rtpCat'), v = (ta.value || '').trim();
    if (!v) { ta.classList.add('err'); ta.focus(); return; }
    const tmp = progTmp(id, 'Progres', v);
    kirim('rtp.progres', { id_rtp: id, catatan: v }, { diam: true, apply: () => upsert('progres', 'id', tmp), sukses: res => gantiId('progres', 'id', tmp.id, res.data.progres) }).then(() => toast('Catatan terkirim.', 'success')).catch(() => { });
  },
  'rtp-ajukan': async t => {
    const id = t.dataset.id, r = I().rtp[id];
    if (!lampiran('RTP', id).length) { toast('Unggah minimal satu bukti penyelesaian terlebih dahulu.', 'warning'); return; }
    const cat = await konfirmasi({ title: 'Ajukan penyelesaian RTP?', msg: 'SHEC Site akan memverifikasi bukti sebelum RTP ditutup.', ok: 'Ajukan', icon: 'send', alasan: true, alasanLabel: 'Catatan penyelesaian', wajib: false });
    if (!cat) return;
    const tmp = progTmp(id, 'Diajukan', cat === '-' ? 'Penyelesaian diajukan untuk verifikasi.' : cat);
    kirim('rtp.ajukan', { id_rtp: id, catatan: cat === '-' ? '' : cat }, { apply: () => { const a = upsert('rtp', 'id_rtp', { id_rtp: r.id_rtp, status_rtp: 'Diajukan' }); const b = upsert('progres', 'id', tmp); return () => { a(); b(); }; } }).catch(() => { });
  },
  'rtp-tutup': async t => {
    const id = t.dataset.id;
    const cat = await konfirmasi({ title: 'Verifikasi & tutup RTP?', msg: 'Pastikan bukti objektif sudah memadai. Status kewajiban tetap mengikuti hasil evaluasi.', ok: 'Tutup RTP', icon: 'task_alt', alasan: true, alasanLabel: 'Catatan verifikasi', wajib: false });
    if (!cat) return;
    const tmp = progTmp(id, 'Ditutup', cat === '-' ? 'RTP diverifikasi dan ditutup.' : cat);
    kirim('rtp.verifikasi', { id_rtp: id, keputusan: 'tutup', catatan: cat === '-' ? '' : cat }, { apply: () => { const a = upsert('rtp', 'id_rtp', { id_rtp: id, status_rtp: 'Closed', diverifikasi_oleh: S.me.nrp, tanggal_verifikasi: today() }); const b = upsert('progres', 'id', tmp); return () => { a(); b(); }; } }).catch(() => { });
  },
  'rtp-kembali': async t => {
    const id = t.dataset.id;
    const cat = await konfirmasi({ title: 'Kembalikan RTP ke PIC?', msg: 'Jelaskan kekurangan bukti atau tindakan yang perlu dilengkapi.', ok: 'Kembalikan', danger: true, alasan: true, alasanLabel: 'Catatan pengembalian' });
    if (!cat) return;
    const tmp = progTmp(id, 'Dikembalikan', cat);
    kirim('rtp.verifikasi', { id_rtp: id, keputusan: 'kembali', catatan: cat }, { apply: () => { const a = upsert('rtp', 'id_rtp', { id_rtp: id, status_rtp: 'Open' }); const b = upsert('progres', 'id', tmp); return () => { a(); b(); }; } }).catch(() => { });
  },
  'rtp-ubah': t => formRtp(I().rtp[t.dataset.id]),
  'rtp-baru': t => formRtp(null, t.dataset.ev)
});
function formRtp(r, idEv) {
  const e = I().ev[r ? r.id_evaluasi : idEv]; if (!e) return;
  r = r || { due_date: addDays(today(), 14) };
  modal({ title: r.id_rtp ? 'Ubah ' + r.id_rtp : 'Terbitkan RTP Baru', sub: 'Evaluasi ' + e.id_evaluasi + ' • ' + namaSite(e.site), icon: 'assignment', body: `<form id="fRtp" class="frm" novalidate>
    ${fld({ n: 'tindakan_perbaikan', l: 'Tindakan perbaikan', t: 'textarea', rows: 3, v: r.tindakan_perbaikan, req: true, full: true, max: 2000 })}
    ${fld({ n: 'pic_nrp', l: 'PIC', t: 'select', opts: usersSite(e.site).map(u => [u.nrp, `${u.nama} (${u.nrp})`]), v: r.pic_nrp, req: true })}${fld({ n: 'due_date', l: 'Due date', t: 'date', v: r.due_date, req: true })}
    ${r.id_rtp ? fld({ n: 'catatan', l: 'Alasan perubahan', t: 'textarea', rows: 2, full: true, max: 500 }) : ''}</form>`,
    foot: `<button class="btn gh" data-act="mclose">Batal</button><button class="btn p" data-act="rtp-simpan" data-id="${esc(r.id_rtp || '')}" data-ev="${esc(e.id_evaluasi)}">${ic('save')} Simpan</button>` });
}
ACT['rtp-simpan'] = async t => {
  const f = $('#fRtp'); if (!validasi(f)) return;
  const v = bacaForm(f); v.id_rtp = t.dataset.id; v.id_evaluasi = t.dataset.ev;
  if (v.id_rtp) { tutupModal(); kirim('rtp.simpan', v, { apply: () => upsert('rtp', 'id_rtp', { id_rtp: v.id_rtp, tindakan_perbaikan: v.tindakan_perbaikan, pic_nrp: v.pic_nrp, due_date: v.due_date }) }).catch(() => { }); return; }
  try { const res = await kirim('rtp.simpan', v, { btn: t, txt: 'Menerbitkan…' }); upsert('rtp', 'id_rtp', res.data.rtp); S.idx = null; tutupModal(); rerender(true); } catch (e) { /* toast */ }
};

/* ── Formulir evaluasi kepatuhan (W-14) ── */
HAL.evalform = (el, p) => {
  const e = p.id ? I().ev[p.id] : null;
  if (p.id && !e) { el.innerHTML = kosong('search_off', 'Evaluasi tidak ditemukan', '', `<button class="btn p" data-act="go" data-sec="evaluasi">Kembali</button>`); return; }
  if (!e && !can.evalTambah()) { el.innerHTML = kosong('lock', 'Akses ditolak', 'Evaluasi dibuat oleh SHEC Site. SHEC Corporate meninjau dan memverifikasi dari menu Evaluasi &amp; RTP.'); return; }
  const edit = e ? can.evalEdit(e) : true;
  const kwAwal = e ? e.id_kewajiban : (p.kw && I().kw[p.kw] ? p.kw : '');
  S.ui.ef = { kunci: p.id || 'baru', id: e ? e.id_evaluasi : '', files: [], hasil: e ? e.hasil : '', kw: kwAwal };
  const site0 = e ? e.site : (kwAwal && I().kw[kwAwal] && I().kw[kwAwal].site_berlaku !== 'ALL' ? String(I().kw[kwAwal].site_berlaku).split(',')[0] : (S.ui.site !== 'ALL' ? S.ui.site : (siteList()[0] || {}).kode));
  const periods = Array.from(new Set([periodeAktif(), periodeSebelum(periodeAktif(), 1)].concat(e ? [e.periode] : [])));
  const rtpAda = e ? (I().rtpByEv[e.id_evaluasi] || []) : [];
  const ro = !edit;
  const segH = `<div class="seg" role="radiogroup" aria-label="Hasil evaluasi" id="efHasil">${HASIL.map(h => `<button type="button" role="radio" aria-checked="${S.ui.ef.hasil === h}" class="${S.ui.ef.hasil === h ? 'on ' : ''}${{ Compliant: 'g', 'Non-Compliant': 'r', Pending: 'b', 'N/A': 'n' }[h]}" data-act="ef-hasil" data-v="${h}" ${ro ? 'disabled' : ''}>${ic({ Compliant: 'check_circle', 'Non-Compliant': 'cancel', Pending: 'schedule', 'N/A': 'block' }[h], 's')} ${h}</button>`).join('')}</div>`;
  el.innerHTML = hdr({
    crumbs: [['Register 3 — Evaluasi & RTP', 'evaluasi'], [e ? e.id_evaluasi : 'Evaluasi Baru']], title: e ? `Evaluasi ${esc(e.id_evaluasi)}` : 'Buat Evaluasi Kepatuhan',
    sub: e ? `${pill(e.status_verifikasi)} ${pill(e.hasil)} <span class="small">Evaluator ${esc(namaUser(e.evaluator_nrp))} • ${esc(labelPeriode(e.periode))}</span>` : 'Isi hasil pemeriksaan pemenuhan satu kewajiban hukum untuk satu site.',
    actions: `<button class="btn" data-act="back" data-fb="evaluasi">${ic('arrow_back')} Kembali</button>`
  })
    + (e && can.evalVerif(e) ? `<div class="card tint mb16"><div class="card-b row wrap" style="gap:12px">${ic('verified', 'l t-o')}<div class="sp" style="min-width:240px"><b>Menunggu verifikasi Anda</b><div class="small muted2">Periksa evidence &amp; temuan. Hanya evaluasi terverifikasi yang dihitung dalam persentase kepatuhan.</div></div><button class="btn do" data-act="ev-kembali" data-id="${esc(e.id_evaluasi)}">${ic('undo')} Kembalikan</button><button class="btn gn" data-act="ev-verif" data-id="${esc(e.id_evaluasi)}">${ic('verified')} Verifikasi Evaluasi</button></div></div>` : '')
    + (e && e.status_verifikasi === 'Menunggu Verifikasi' && e.evaluator_nrp === S.me.nrp ? `<div class="card tint mb16"><div class="card-b row wrap" style="gap:12px">${ic('info', 'l t-o')}<div class="sp" style="min-width:240px"><b>Menunggu verifikasi akun SHEC Corporate lain</b><div class="small muted2">Evaluator tidak dapat memverifikasi evaluasinya sendiri, jadi evaluasi ini belum bisa diproses lebih lanjut dari akun Anda. Minta akun SHEC Corporate lain untuk membuka menu Evaluasi &amp; RTP dan memverifikasinya, atau kembalikan ke Draft untuk mengubahnya.</div></div><button class="btn do" data-act="ev-kembali" data-id="${esc(e.id_evaluasi)}">${ic('undo')} Kembalikan ke Draft</button></div></div>` : '')
    + (e && e.status_verifikasi === 'Draft' && e.catatan_verifikasi ? `<div class="note a mb16">${ic('undo')}<div><b>Dikembalikan verifikator:</b> ${esc(e.catatan_verifikasi)}</div></div>` : '')
    + (e && e.status_verifikasi === 'Terverifikasi' ? `<div class="note g mb16">${ic('verified')}<div>Terverifikasi oleh <b>${esc(namaUser(e.diverifikasi_oleh))}</b> pada ${fmtTgl(e.tanggal_verifikasi)}. Evaluasi terverifikasi tidak dapat diubah.</div></div>` : '')
    + `<form id="efForm" novalidate class="col" style="gap:16px">
    <div class="card"><div class="card-b frm">
      <div class="fsec"><span class="bar"></span>Informasi Evaluasi</div>
      ${fld({ n: 'periode', l: 'Periode', t: 'select', opts: periods.map(x => [x, labelPeriode(x)]), v: e ? e.periode : periodeAktif(), req: true, ph: false, ro })}${fld({ n: 'site', l: 'Site', t: 'select', opts: siteList().map(s => [s.kode, s.nama]), v: site0, req: true, ro: ro || !!e, ch: 'ef-site' })}
      ${fld({ n: 'tanggal_evaluasi', l: 'Tanggal evaluasi', t: 'date', v: e ? e.tanggal_evaluasi : today(), req: true, ro })}${fld({ n: 'evaluator', l: 'Evaluator', v: e ? namaUser(e.evaluator_nrp) : S.me.nama + ' (NRP ' + S.me.nrp + ')', ro: true })}
      <div class="fsec"><span class="bar"></span>Kewajiban yang Dievaluasi</div>
      <div class="full kwpick" data-f="id_kewajiban">${ro || e ? '' : `<label class="flbl" for="efKwQ">Cari kewajiban dari Register 1<span class="rq" style="color:var(--r)">*</span></label><div class="srch" style="position:relative;margin-top:6px">${ic('search', 's muted')}<input class="inp" id="efKwQ" data-in="ef-kwq" placeholder="Ketik nomor regulasi, pasal, atau uraian kewajiban…" autocomplete="off" style="padding-left:34px" aria-label="Cari kewajiban"></div><div class="kwlist hide" id="efKwList"></div>`}
        <input type="hidden" name="id_kewajiban" value="${esc(S.ui.ef.kw)}"><div id="efKwCard" class="mt8">${kartuKw(S.ui.ef.kw)}</div><div class="ferr hide"></div></div>
      <div class="fsec"><span class="bar"></span>Pemeriksaan</div>
      ${fld({ n: 'metode_pemeriksaan', l: 'Metode pemeriksaan', t: 'select', opts: METODE, v: e ? e.metode_pemeriksaan : '', req: true, ro })}
      <div class="fld" data-f="hasil"><label>Hasil evaluasi<span class="rq">*</span></label>${segH}<input type="hidden" name="hasil" value="${esc(S.ui.ef.hasil)}"><div class="ferr hide"></div></div>
      ${fld({ n: 'temuan', l: 'Temuan / justifikasi', t: 'textarea', rows: 3, v: e ? e.temuan : '', full: true, ro, max: 3000, ph: 'Uraikan temuan ketidaksesuaian, atau justifikasi untuk N/A…' })}
    </div></div>
    <div class="card"><div class="card-h"><div class="ic">${ic('folder_open')}</div><div class="sp"><h3>Evidence / Bukti Objektif</h3><p>Wajib untuk hasil Compliant • disimpan di 03_Evidence_Evaluasi/${esc(labelPeriode(e ? e.periode : periodeAktif()))}</p></div><span class="pill r ${S.ui.ef.hasil === 'Compliant' ? '' : 'hide'}" id="efWajib">${ic('priority_high')} wajib</span></div>
      <div class="card-b col" style="gap:12px"><div id="efBukti"></div>${ro ? '' : `<div class="drop" data-act="ef-file" data-drop="1" data-ent="EVALQ" role="button" tabindex="0"><div class="dic">${ic('cloud_upload')}</div>Tarik &amp; letakkan evidence atau klik untuk memilih<small>PDF, JPG, PNG, Excel • Maks. ${esc(cfg('maks_upload_mb', 10))} MB • ${e ? 'langsung diunggah' : 'diunggah setelah evaluasi disimpan'}</small></div>`}</div></div>
    <div class="card ${S.ui.ef.hasil === 'Non-Compliant' || rtpAda.length ? '' : 'hide'}" id="efRtpWrap" style="border-left:3px solid var(--r)"><div class="card-h"><div class="ic" style="background:var(--r-t);color:var(--r)">${ic('assignment')}</div><div class="sp"><h3>Rencana Tindak Lanjut (RTP)</h3><p>Wajib minimal satu RTP untuk hasil Non-Compliant • PIC tidak dapat menutup RTP sendiri</p></div>${e && is(R.CORP, R.SITE) && e.status_verifikasi !== 'Draft' ? `<button type="button" class="btn sm t" data-act="rtp-baru" data-ev="${esc(e.id_evaluasi)}">${ic('add')} Terbitkan RTP</button>` : ''}</div>
      <div class="card-b col" style="gap:10px">${rtpAda.map(r => `<div class="file clk" data-act="buka-rtp" data-id="${esc(r.id_rtp)}" role="button" tabindex="0" style="cursor:pointer"><div class="fic" style="background:var(--b-t);color:var(--b)">${ic('assignment')}</div><div class="fn"><b>${esc(r.id_rtp)} — ${esc(r.tindakan_perbaikan)}</b><span>PIC ${esc(namaUser(r.pic_nrp))} • Due ${fmtTgl(r.due_date)}</span></div>${pill(stRtp(r))}</div>`).join('')}
        ${ro ? '' : `<div id="efRtpRows" class="col" style="gap:8px"></div><button type="button" class="add-row" data-act="ef-rtp-tambah">${ic('add')} Tambah RTP</button>`}</div></div>
    </form>
    <div class="sticky-f"><span class="lf">${ic('shield', 's')} Setiap perubahan tercatat di Audit_Log</span>${e && (is(R.CORP) || (can.evalEdit(e))) ? `<button class="btn do" data-act="ev-arsip" data-id="${esc(e.id_evaluasi)}">${ic('archive')} Arsipkan</button>` : ''}<button class="btn gh" data-act="back" data-fb="evaluasi">${ro ? 'Tutup' : 'Batal'}</button>${ro ? '' : `<button class="btn" data-act="ef-simpan" data-k="0">${ic('save')} Simpan Draft</button><button class="btn p" data-act="ef-simpan" data-k="1">${ic('send')} Kirim untuk Verifikasi</button>`}</div>`;
  PARTIAL.evalform();
  if (!ro && S.ui.ef.hasil === 'Non-Compliant' && !rtpAda.length) ACT['ef-rtp-tambah']();
};
PARTIAL.evalform = () => {
  const b = $('#efBukti'); if (!b || !S.ui.ef) return;
  const e = S.ui.ef.id ? I().ev[S.ui.ef.id] : null, edit = e ? can.evalEdit(e) : true;
  const ada = S.ui.ef.id ? lampiran('EVAL', S.ui.ef.id) : [];
  b.innerHTML = daftarBerkas(ada, { hapus: edit, kosong: false }) + (S.ui.ef.files.length ? `<div class="files mt8">${S.ui.ef.files.map((f, i) => `<div class="file"><div class="fic">${ic('schedule')}</div><div class="fn"><b>${esc(f.name)}</b><span>${ukuran(f.size)} • antre, diunggah saat disimpan</span></div><button type="button" class="btn gh ic sm" data-act="ef-file-hapus" data-i="${i}" aria-label="Hapus">${ic('close')}</button></div>`).join('')}</div>` : '') + (!ada.length && !S.ui.ef.files.length ? '<div class="muted small">Belum ada evidence.</div>' : '');
};
function kartuKw(id) {
  const k = I().kw[id]; if (!k) return '<div class="muted small">Belum ada kewajiban dipilih.</div>';
  const r = I().reg1[k.id_reg1] || {};
  return `<div class="card flat" style="background:var(--sf2)"><div class="card-b"><div class="row wrap mb8">${pill(r.jenis_peraturan || '–', 'o', false)}<b>${esc(judulReg(r))}</b><span class="muted small">• ${esc(k.pasal_butir || '–')}</span></div><div class="small">${esc(k.uraian_kewajiban)}</div><div class="xsmall muted mt8">PIC: ${esc(namaDept(k.departemen_penanggung_jawab))} • Periodisitas: ${esc(k.periodisitas || '–')} • ${esc(k.id_kewajiban)}</div></div></div>`;
}
function antreBerkasEval(files) {
  const ef = S.ui.ef; if (!ef) return;
  if (ef.id) { unggah('EVAL', ef.id, files, (I().ev[ef.id] || {}).site); return; }
  files.forEach(f => { const c = cekBerkas(f); if (c.err) toast(c.err, 'error'); else ef.files.push(f); });
  PARTIAL.evalform();
}
IN['ef-kwq'] = t => {
  const q = t.value.trim().toLowerCase(), list = $('#efKwList'), site = ($('#f_site') || {}).value;
  if (q.length < 2) { list.classList.add('hide'); return; }
  const kws = (S.data.kewajiban || []).filter(k => { if (!aktif(k)) return false; const r = I().reg1[k.id_reg1]; if (!r || !aktif(r) || r.status_berlaku === 'Dicabut') return false; const sOk = !k.site_berlaku || k.site_berlaku === 'ALL' || String(k.site_berlaku).split(',').includes(site); const rOk = !r.site_berlaku || r.site_berlaku === 'ALL' || String(r.site_berlaku).split(',').includes(site); return sOk && rOk && cari(q, k.pasal_butir, k.uraian_kewajiban, judulReg(r), r.judul, k.id_kewajiban); }).slice(0, 30);
  list.innerHTML = kws.length ? kws.map(k => { const r = I().reg1[k.id_reg1]; return `<button type="button" data-act="ef-kw" data-id="${esc(k.id_kewajiban)}"><b>${esc(judulReg(r))} — ${esc(k.pasal_butir || '')}</b><span>${esc(k.uraian_kewajiban)}</span></button>`; }).join('') : '<div class="empty small">Tidak ada kewajiban yang cocok untuk site ini.</div>';
  list.classList.remove('hide');
};
CH['ef-site'] = () => { const q = $('#efKwQ'); if (q && q.value) IN['ef-kwq'](q); };
Object.assign(ACT, {
  'ef-kw': t => { S.ui.ef.kw = t.dataset.id; $('[name=id_kewajiban]', $('#efForm')).value = t.dataset.id; $('#efKwCard').innerHTML = kartuKw(t.dataset.id); $('#efKwList').classList.add('hide'); $('#efKwQ').value = ''; setErr($('#efForm'), 'id_kewajiban', null); },
  'ef-hasil': t => {
    const v = t.dataset.v; S.ui.ef.hasil = v; $('[name=hasil]', $('#efForm')).value = v;
    $$('#efHasil button').forEach(b => { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    $('#efWajib').classList.toggle('hide', v !== 'Compliant');
    const w = $('#efRtpWrap'); const ada = w && w.querySelector('.file');
    if (w) w.classList.toggle('hide', v !== 'Non-Compliant' && !ada);
    if (v === 'Non-Compliant' && $('#efRtpRows') && !$('#efRtpRows').children.length && !ada) ACT['ef-rtp-tambah']();
    setErr($('#efForm'), 'hasil', null);
  },
  'ef-file': () => pilihBerkas(antreBerkasEval),
  'ef-file-hapus': t => { S.ui.ef.files.splice(Number(t.dataset.i), 1); PARTIAL.evalform(); },
  'ef-rtp-tambah': () => {
    const c = $('#efRtpRows'); if (!c) return;
    const site = ($('#f_site') || {}).value;
    c.insertAdjacentHTML('beforeend', `<div class="rep" data-rtp="1"><input class="inp" name="r_tindakan" placeholder="Tindakan perbaikan" maxlength="2000" aria-label="Tindakan perbaikan"><select class="inp" name="r_pic" aria-label="PIC">${opsi([['', 'Pilih PIC']].concat(usersSite(site).map(u => [u.nrp, `${u.nama} (${ROLE_LABEL[u.role] || u.role})`])), '')}</select><input class="inp" type="date" name="r_due" value="${addDays(today(), 14)}" aria-label="Due date"><button type="button" class="btn gh ic" data-act="kw-hapus2" aria-label="Hapus RTP">${ic('delete')}</button></div>`);
  },
  'kw-hapus2': t => { const r = t.closest('[data-rtp]'); if (r) r.remove(); },
  'ef-simpan': t => simpanEval(t.dataset.k === '1', t),
  'ev-verif': async t => {
    const id = t.dataset.id;
    if (!await konfirmasi({ title: 'Verifikasi evaluasi ini?', msg: 'Hasil akan dihitung dalam persentase kepatuhan dan tidak dapat diubah lagi.', ok: 'Verifikasi', icon: 'verified' })) return;
    go('evaluasi');
    kirim('eval.verifikasi', { id_evaluasi: id, keputusan: 'setuju' }, { apply: () => upsert('evaluasi', 'id_evaluasi', { id_evaluasi: id, status_verifikasi: 'Terverifikasi', diverifikasi_oleh: S.me.nrp, tanggal_verifikasi: today() }) }).catch(() => { });
  },
  'ev-kembali': async t => {
    const id = t.dataset.id;
    const cat = await konfirmasi({ title: 'Kembalikan ke evaluator?', msg: 'Evaluasi kembali menjadi Draft untuk dilengkapi.', ok: 'Kembalikan', danger: true, alasan: true, alasanLabel: 'Catatan pengembalian' });
    if (!cat) return;
    go('evaluasi');
    kirim('eval.verifikasi', { id_evaluasi: id, keputusan: 'kembali', catatan: cat }, { apply: () => upsert('evaluasi', 'id_evaluasi', { id_evaluasi: id, status_verifikasi: 'Draft', catatan_verifikasi: cat }) }).catch(() => { });
  },
  'ev-arsip': async t => {
    const id = t.dataset.id;
    const al = await konfirmasi({ title: 'Arsipkan evaluasi?', msg: 'Evaluasi tidak dihitung lagi dalam statistik, tetapi tetap tersimpan untuk audit.', ok: 'Arsipkan', danger: true, alasan: true });
    if (!al) return;
    go('evaluasi');
    kirim('eval.arsip', { id_evaluasi: id, alasan: al }, { apply: () => upsert('evaluasi', 'id_evaluasi', { id_evaluasi: id, status_aktif: 'Archived' }) }).catch(() => { });
  }
});
async function simpanEval(kirimV, btn) {
  const f = $('#efForm'), ef = S.ui.ef;
  const rtpBaru = $$('[data-rtp]', f).map(r => ({ tindakan_perbaikan: $('[name=r_tindakan]', r).value.trim(), pic_nrp: $('[name=r_pic]', r).value, due_date: $('[name=r_due]', r).value })).filter(x => x.tindakan_perbaikan || x.pic_nrp);
  const e = ef.id ? I().ev[ef.id] : null;
  const nBukti = (ef.id ? lampiran('EVAL', ef.id).length : 0) + ef.files.length;
  const nRtp = (ef.id ? (I().rtpByEv[ef.id] || []).length : 0) + rtpBaru.length;
  const ok = validasi(f, x => ({
    id_kewajiban: !x.id_kewajiban ? 'Pilih kewajiban yang dievaluasi.' : '',
    hasil: !x.hasil ? 'Pilih hasil evaluasi.' : '',
    temuan: kirimV && x.hasil === 'Non-Compliant' && !x.temuan ? 'Uraikan temuan untuk hasil Non-Compliant.' : ''
  }));
  if (!ok) return;
  if (rtpBaru.some(x => !x.tindakan_perbaikan || !x.pic_nrp || !x.due_date)) { toast('Lengkapi tindakan, PIC, dan due date pada setiap baris RTP.', 'warning'); return; }
  if (kirimV && bacaForm(f).hasil === 'Compliant' && !nBukti) { toast('Evidence wajib dilampirkan untuk hasil Compliant.', 'warning'); return; }
  if (kirimV && bacaForm(f).hasil === 'Non-Compliant' && !nRtp) { toast('Hasil Non-Compliant wajib memiliki minimal satu RTP.', 'warning'); return; }
  const v = bacaForm(f);
  v.site = v.site || (e ? e.site : '');
  const duaLangkah = kirimV && ef.files.length > 0;
  busy(btn, true, kirimV ? 'Mengirim…' : 'Menyimpan…');
  try {
    let res = await api('eval.simpan', Object.assign({}, v, { id_evaluasi: ef.id, kirim: kirimV && !duaLangkah, rtp: rtpBaru }));
    const ev = res.data.evaluasi; ef.id = ev.id_evaluasi; ef.kunci = ev.id_evaluasi;
    upsert('evaluasi', 'id_evaluasi', ev); (res.data.rtp || []).forEach(r => upsert('rtp', 'id_rtp', r)); S.idx = null;
    $$('[data-rtp]', f).forEach(r => r.remove());
    if (ef.files.length) {
      busy(btn, false); busy(btn, true, 'Mengunggah evidence…');
      const antre = ef.files.splice(0); PARTIAL.evalform();
      for (const file of antre) {
        const c = cekBerkas(file);
        const r2 = await api('lampiran.unggah', { entitas: 'EVAL', id_entitas: ev.id_evaluasi, nama_file: file.name, mime: c.mime, base64: await fileB64(file) });
        upsert('lampiran', 'id_lampiran', r2.data.lampiran); S.idx = null; PARTIAL.evalform();
      }
    }
    if (duaLangkah) res = await api('eval.simpan', Object.assign({}, v, { id_evaluasi: ev.id_evaluasi, kirim: true, rtp: [] }));
    if (res.data && res.data.evaluasi) upsert('evaluasi', 'id_evaluasi', res.data.evaluasi);
    S.idx = null; toast(res.message, 'success'); jadwalSync(200);
    go('evaluasi');
  } catch (err) {
    toast(err.message, 'error', 'Evaluasi belum tersimpan sepenuhnya');
    if (ef.id && S.ui.params.id !== ef.id) S.ui.params = { id: ef.id };
    jadwalSync(200);
  } finally { if (document.body.contains(btn)) busy(btn, false); }
}

/* ───────────── HALAMAN: LAPORAN & EKSPOR ───────────── */
const LAP = {
  SMKP: { t: 'Laporan Audit SMKP Elemen II.3 & V.3', d: 'Evaluasi kepatuhan semesteran, gap analysis statutori, dan status mitigasi temuan seluruh site.', ic: 'workspace_premium', tag: 'Format Mandatori' },
  REG1: { t: 'Register 1 — Inventaris Regulasi', d: 'Daftar induk regulasi terverifikasi, pemetaan relevansi, dan PIC departemen.', ic: 'menu_book', tag: 'Reg1_Peraturan' },
  REG2: { t: 'Register 2 — Masa Berlaku Izin & Lisensi', d: 'Monitoring jatuh tempo izin H-90/60/30/7, lembaga penerbit, dan PIC.', ic: 'verified', tag: 'Reg2_Izin' },
  REG3: { t: 'Register 3 — Rekapitulasi Evaluasi', d: 'Hasil audit kepatuhan per site, rasio compliant vs non-compliant, dan temuan.', ic: 'fact_check', tag: 'Reg3_Evaluasi' },
  RTP: { t: 'Monitoring Tindak Lanjut (RTP)', d: 'Tindakan perbaikan open, overdue, PIC per site, dan riwayat verifikasi penutupan.', ic: 'assignment_late', tag: 'Reg3_RTP' },
  EXEC: { t: 'Executive Summary Corporate', d: 'Ringkasan metrik kepatuhan konsolidasi per site untuk Direksi, KTT, dan Komite HSE.', ic: 'insights', tag: 'Konsolidasi' }
};
const STATUS_LAP = { SMKP: HASIL, REG3: HASIL, REG1: ['Berlaku', 'Diubah', 'Dicabut'], REG2: ['Aktif', 'Mendekati Kedaluwarsa', 'Kedaluwarsa'], RTP: ['Open', 'Diajukan', 'Overdue', 'Closed'], EXEC: [] };
function dataLaporan(j, f) {
  const sOk = s => !f.site || f.site === 'ALL' || s === 'ALL' || String(s || '').split(',').includes(f.site);
  const dOk = d => !f.dept || f.dept === 'ALL' || d === f.dept;
  const stOk = s => !f.status || f.status === 'ALL' || s === f.status;
  const evs = (S.data.evaluasi || []).filter(e => aktif(e) && e.periode === f.periode && sOk(e.site) && dOk((I().kw[e.id_kewajiban] || {}).departemen_penanggung_jawab));
  const ver = evs.filter(e => e.status_verifikasi === 'Terverifikasi'), c = h => ver.filter(e => e.hasil === h).length;
  const rtps = (S.data.rtp || []).filter(r => aktif(r) && sOk(r.site));
  const ringEv = [['Evaluasi Terverifikasi', nf(ver.length)], ['Tingkat Kepatuhan', fpct(pct(c('Compliant'), ver.length - c('N/A')))], ['Non-Compliant', nf(c('Non-Compliant'))], ['RTP Aktif / Overdue', `${rtps.filter(r => r.status_rtp !== 'Closed').length} / ${rtps.filter(r => stRtp(r) === 'Overdue').length}`]];
  const L = { ring: [], kol: [], baris: [] };
  if (j === 'SMKP' || j === 'REG3') {
    L.ring = ringEv; L.kol = ['No', 'Klausul / Peraturan', 'Kewajiban', 'Site', 'Hasil', 'Status Bukti / RTP'];
    evs.filter(e => stOk(e.hasil)).forEach((e, i) => { const k = I().kw[e.id_kewajiban] || {}, r = I().reg1[e.id_reg1] || {}; const rt = (I().rtpByEv[e.id_evaluasi] || []).map(x => x.id_rtp + ' (' + stRtp(x) + ')').join(', '); L.baris.push([String(i + 1).padStart(2, '0'), judulReg(r) + (k.pasal_butir ? ' — ' + k.pasal_butir : ''), k.uraian_kewajiban || '–', namaSite(e.site), e.hasil, rt || (lampiran('EVAL', e.id_evaluasi).length ? lampiran('EVAL', e.id_evaluasi).length + ' evidence' : '–')]); });
  } else if (j === 'REG1') {
    const rows = (S.data.reg1 || []).filter(r => aktif(r) && sOk(r.site_berlaku) && stOk(r.status_berlaku) && (!f.dept || f.dept === 'ALL' || String(r.pic_departemen).split(',').includes(f.dept)));
    L.ring = [['Total Regulasi', nf(rows.length)], ['Berlaku', nf(rows.filter(r => r.status_berlaku === 'Berlaku').length)], ['Diubah', nf(rows.filter(r => r.status_berlaku === 'Diubah').length)], ['Kewajiban Pasal', nf(rows.reduce((a, r) => a + (I().kwByReg1[r.id_reg1] || []).length, 0))]];
    L.kol = ['No', 'Kode', 'Regulasi', 'Judul', 'Status', 'PIC Departemen'];
    rows.forEach((r, i) => L.baris.push([i + 1, r.id_reg1, judulReg(r), r.judul, r.status_berlaku, namaDept(r.pic_departemen)]));
  } else if (j === 'REG2') {
    const rows = (S.data.reg2 || []).filter(r => aktif(r) && sOk(r.site) && dOk(r.departemen) && stOk(stIzin(r))).sort((a, b) => String(a.tanggal_kedaluwarsa || '9999').localeCompare(String(b.tanggal_kedaluwarsa || '9999')));
    L.ring = ['Aktif', 'Mendekati Kedaluwarsa', 'Kedaluwarsa'].map(s => [s, nf(rows.filter(r => stIzin(r) === s).length)]).concat([['Total Dokumen', nf(rows.length)]]);
    L.kol = ['No', 'ID', 'Nama Dokumen', 'Nomor', 'Site', 'Kedaluwarsa', 'Sisa Hari', 'Status'];
    rows.forEach((r, i) => L.baris.push([i + 1, r.id_izin, r.nama_dokumen, r.nomor_dokumen, namaSite(r.site), fmtTgl(r.tanggal_kedaluwarsa), sisaHari(r.tanggal_kedaluwarsa) == null ? '–' : sisaHari(r.tanggal_kedaluwarsa), stIzin(r)]));
  } else if (j === 'RTP') {
    const rows = rtps.filter(r => stOk(stRtp(r)));
    L.ring = ['Open', 'Diajukan', 'Overdue', 'Closed'].map(s => [s, nf(rows.filter(r => stRtp(r) === s).length)]);
    L.kol = ['No', 'ID RTP', 'Tindakan Perbaikan', 'Site', 'PIC', 'Due Date', 'Status'];
    rows.forEach((r, i) => L.baris.push([i + 1, r.id_rtp, r.tindakan_perbaikan, namaSite(r.site), namaUser(r.pic_nrp), fmtTgl(r.due_date), stRtp(r)]));
  } else {
    L.ring = ringEv; L.kol = ['No', 'Site', 'Terverifikasi', 'Compliant', 'Non-Compliant', '% Kepatuhan', 'Izin Kedaluwarsa', 'RTP Overdue'];
    siteList().filter(s => sOk(s.kode)).forEach((s, i) => { const v = ver.filter(e => e.site === s.kode), cc = h => v.filter(e => e.hasil === h).length; L.baris.push([i + 1, s.nama, v.length, cc('Compliant'), cc('Non-Compliant'), fpct(pct(cc('Compliant'), v.length - cc('N/A'))), (S.data.reg2 || []).filter(r => aktif(r) && r.site === s.kode && stIzin(r) === 'Kedaluwarsa').length, rtps.filter(r => r.site === s.kode && stRtp(r) === 'Overdue').length]); });
  }
  return L;
}
HAL.laporan = el => {
  const st = S.ui.lap || (S.ui.lap = { jenis: 'SMKP', periode: periodeAktif(), dept: 'ALL', status: 'ALL', site: S.ui.site });
  const L = dataLaporan(st.jenis, st), J = LAP[st.jenis];
  const periods = Array.from(new Set([periodeAktif(), periodeSebelum(periodeAktif(), 1), periodeSebelum(periodeAktif(), 2)].concat((S.data.evaluasi || []).map(e => e.periode)))).sort().reverse();
  const warna = { Compliant: 't-g', 'Non-Compliant': 't-r', Kedaluwarsa: 't-r', Overdue: 't-r', 'Mendekati Kedaluwarsa': 't-a', Closed: 't-g', Pending: 't-b' };
  const riw = (S.data.laporan || []).slice().sort((a, b) => String(b.waktu).localeCompare(a.waktu));
  const filter = { periode: st.periode, site: st.site, departemen: st.dept, status: st.status };
  el.innerHTML = hdr({ crumbs: [['Dashboard', 'dashboard'], ['Laporan & Ekspor SMKP']], title: 'Laporan &amp; Ekspor SMKP Minerba', tag: 'Format Resmi HMSI', sub: 'Pusat konsolidasi dan pencetakan dokumen audit SMKP Sub Elemen II.3 &amp; V.3, inventaris izin, dan matriks pemenuhan statutori. Berkas tersimpan otomatis di Google Drive /05_Laporan_Ekspor/.' })
    + `<div class="grid g-37" style="align-items:start"><div class="col" style="gap:10px"><div class="flbl row">${ic('grid_view', 's')} PILIH JENIS LAPORAN</div>
      ${Object.keys(LAP).map(k => `<button class="rcard ${st.jenis === k ? 'on' : ''}" data-act="lap-jenis" data-v="${k}"><div class="ic">${ic(LAP[k].ic)}</div><div style="flex:1;min-width:0"><div class="row"><b class="sp">${esc(LAP[k].t)}</b>${st.jenis === k ? ic('check_circle', 's t-o') : ''}</div><span>${esc(LAP[k].d)}</span><div class="mt8">${pill(LAP[k].tag, 'n', false)}</div></div></button>`).join('')}
      <div class="note b">${ic('info')}<div><b>Validasi lampiran SMKP:</b> persentase kepatuhan dihitung dari evaluasi terverifikasi (Compliant ÷ (Terverifikasi − N/A)).</div></div></div>
    <div class="col" style="gap:16px"><div class="card"><div class="card-h"><div class="ic">${ic('tune')}</div><div class="sp"><h3>Parameter Dokumen Laporan</h3><p>${esc(J.t)}</p></div><span class="sync-dot"><i></i>Koneksi Google Sheets aktif</span></div><div class="card-b">
      <div class="grid g4">${fld({ n: 'periode', l: 'Periode audit', t: 'select', opts: periods.map(p => [p, labelPeriode(p)]), v: st.periode, ph: false, ch: 'lap' })}${fld({ n: 'site', l: 'Cakupan operasional', t: 'select', opts: [['ALL', 'Semua site']].concat(siteList().map(s => [s.kode, s.nama])), v: st.site, ph: false, ch: 'lap' })}${fld({ n: 'dept', l: 'Departemen / divisi', t: 'select', opts: [['ALL', 'Semua departemen']].concat(deptList().map(d => [d.kode, d.nama])), v: st.dept, ph: false, ch: 'lap' })}${fld({ n: 'status', l: 'Klasifikasi status', t: 'select', opts: [['ALL', 'Semua status']].concat(STATUS_LAP[st.jenis]), v: st.status, ph: false, ch: 'lap', ro: !STATUS_LAP[st.jenis].length })}</div>
      <div class="row wrap mt16"><span class="sp small muted">${nf(L.baris.length)} baris data • ${esc(labelPeriode(st.periode))} • ${esc(namaSite(st.site))}</span>
        <button class="btn" data-act="lap-buat" data-f="xlsx">${ic('table_view')} Ekspor Excel (.xlsx)</button><button class="btn p" data-act="lap-buat" data-f="pdf">${ic('picture_as_pdf')} Ekspor PDF Resmi</button></div></div></div>
      <div class="card"><div class="card-h"><span class="sync-dot"><i></i>Pratinjau cetak real-time (A4)</span><span class="sp"></span><span class="xsmall muted">Pratinjau menampilkan maks. 25 baris • ekspor memuat seluruh data</span></div>
      <div class="paper-w"><div class="paper"><div class="ph1"><div class="row" style="align-items:flex-start;gap:12px"><div class="lgo">HMSI</div><div><div class="b7" style="font-size:13px">${esc(cfg('nama_perusahaan', 'PT Hanwha Mining Services Indonesia'))}</div><div class="t-o b7" style="font-size:10px">SHEC &amp; LEGAL GOVERNANCE</div><div class="muted" style="font-size:9px">Sistem Manajemen Keselamatan Pertambangan (SMKP Minerba)</div></div></div>
        <div class="meta">No. Dok : HMSI-LCMS-${today().replace(/-/g, '')}<br>Tanggal : ${fmtTgl(today())}<br>Dicetak : ${esc(S.me.nama)}<br>Klasifikasi : <b class="t-r">INTERNAL</b></div></div><div class="rule"></div>
        <h2>${esc(J.t)}</h2><div style="text-align:center;font-size:10px;color:var(--tx2)">Periode: ${esc(labelPeriode(st.periode))} • Cakupan: ${esc(namaSite(st.site))}${st.dept !== 'ALL' ? ' • ' + esc(namaDept(st.dept)) : ''}</div>
        <div class="rk">${L.ring.map(([l, v]) => `<div><small>${esc(l)}</small><b>${esc(v)}</b></div>`).join('')}</div>
        <table><thead><tr>${L.kol.map(k => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${L.baris.length ? L.baris.slice(0, 25).map(b => `<tr>${b.map(x => `<td class="${warna[x] || ''} ${warna[x] ? 'b7' : ''}">${esc(x)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${L.kol.length}" style="text-align:center;padding:18px;color:var(--tx3)">Tidak ada data untuk parameter ini.</td></tr>`}</tbody></table>
        <div class="row mt16" style="justify-content:space-between;font-size:9px;color:var(--tx3);border-top:1px solid var(--bd);padding-top:8px"><span>Dokumen dihasilkan otomatis oleh HMSI-LCMS. Status RTP Closed tidak otomatis berarti kewajiban Compliant.</span><span>Halaman 1</span></div></div></div></div>
      <div class="card"><div class="card-h"><div class="ic">${ic('history')}</div><div class="sp"><h3>Riwayat Ekspor Laporan &amp; Unduhan Terakhir</h3><p>Tersimpan di Google Drive /05_Laporan_Ekspor/ dan terindeks di Laporan_Log</p></div></div>
      ${tabel('lapr', { key: 'id', rows: riw, unit: 'berkas arsip', empty: kosong('folder_open', 'Belum ada laporan diekspor', 'Laporan yang Anda ekspor akan tersimpan di sini.'), cols: [
        { l: 'Nama Dokumen Laporan', r: x => `<div class="row" style="align-items:flex-start"><span class="pill ${x.format === 'pdf' ? 'r' : 'g'}" style="flex-shrink:0">${x.format === 'pdf' ? 'PDF' : 'XLS'}</span><div style="min-width:0"><div class="t1" style="word-break:break-all">${esc(x.nama_file)}</div><div class="t2 mono">${esc(x.id)}</div></div></div>` },
        { l: 'Jenis', r: x => pill((LAP[x.jenis] || {}).tag || x.jenis, 'o', false) },
        { l: 'Periode & Site', r: x => `<div class="small">${esc(x.periode)}</div><div class="t2">${esc(x.site)}</div>` },
        { l: 'Dibuat Oleh', r: x => `<div class="small">${esc(x.nama_pembuat)}</div><div class="t2">NRP ${esc(x.dibuat_oleh)}</div>` },
        { l: 'Waktu Ekspor', r: x => `<span class="small nowrap">${fmtWkt(x.waktu)}</span>` },
        { l: 'Ukuran', r: x => `<span class="small">${ukuran(x.ukuran)}</span>` },
        { l: '', cls: 'act', r: x => `<button class="btn gh ic sm" data-act="lap-unduh" data-id="${esc(x.id)}" title="Unduh" aria-label="Unduh ${esc(x.nama_file)}">${ic('download')}</button>` }
      ] })}</div></div></div>`;
  S.ui.lapFilter = filter;
};
CH.lap = t => { const st = S.ui.lap; st[t.name] = t.value; renderSec('laporan'); };
Object.assign(ACT, {
  'lap-jenis': t => { const st = S.ui.lap; st.jenis = t.dataset.v; st.status = 'ALL'; renderSec('laporan'); },
  'lap-buat': t => buatLaporan(S.ui.lap.jenis, t.dataset.f, S.ui.lapFilter, t),
  'lap-unduh': async t => {
    busy(t, true, '');
    try { const res = await api('laporan.ambil', { id: t.dataset.id }); unduhBlob(b64Blob(res.data.base64, res.data.mime), res.data.nama); }
    catch (e) { toast(e.message, 'error', 'Unduh gagal'); } finally { busy(t, false); }
  }
});

/* ───────────── HALAMAN: PENGATURAN (SHEC Corporate) ───────────── */
HAL.pengaturan = el => {
  const tab = S.ui.tab.pengaturan || 'user';
  const TABS = [['user', 'Pengguna & Hak Akses', 'manage_accounts'], ['site', 'Site Operasional', 'apartment'], ['dept', 'Departemen', 'domain'], ['portal', 'Sumber Portal Resmi', 'public'], ['kata', 'Kata Kunci', 'sell'], ['smkp', 'Elemen SMKP', 'fact_check'], ['param', 'Parameter Sistem', 'tune']];
  const isi = { user: setUser, site: () => setMaster('Sites'), dept: () => setMaster('Departemen'), portal: setPortal, kata: setKata, smkp: setSmkp, param: setParam }[tab]();
  el.innerHTML = hdr({ crumbs: [['Pengaturan Sistem', 'pengaturan'], [TABS.find(x => x[0] === tab)[1]]], title: { user: 'Manajemen Pengguna &amp; Otorisasi Akses (RBAC)', site: 'Master Site Operasional', dept: 'Master Departemen', portal: 'Sumber Portal Resmi &amp; Crawler', kata: 'Kata Kunci Pencarian', smkp: 'Taksonomi Elemen SMKP Minerba', param: 'Parameter Sistem' }[tab], sub: { user: 'Kelola akun pengguna, peran (Corporate, Site, PIC, PJO, Manajemen), kredensial PIN, serta mitigasi akses tidak sah.', site: 'Daftar site HMSI yang menjadi cakupan kepatuhan.', dept: 'Departemen penanggung jawab kewajiban dan izin.', portal: 'Portal resmi pemerintah yang dipantau crawler. Uji setiap URL pencarian sebelum diaktifkan.', kata: 'Kata kunci tematik SHEC untuk pencarian otomatis mingguan & manual.', smkp: '7 elemen / 51 sub-elemen SMKP Minerba (Kepdirjen 185.K/37.04/DJB/2019) — kata kunci dipakai untuk saran otomatis elemen SMKP pada PDF usulan regulasi.', param: 'Ambang pengingat, keamanan sesi, dan identitas aplikasi.' }[tab] })
    + `<div class="grid" style="grid-template-columns:230px minmax(0,1fr);align-items:start" id="setGrid"><div class="card" style="padding:8px"><div class="sb-sec" style="padding-top:6px">Konfigurasi Master</div>${TABS.map(([k, l, i]) => `<button class="nav ${tab === k ? 'on' : ''}" data-act="tab" data-g="pengaturan" data-v="${k}">${ic(i)}<span class="lbl">${l}</span></button>`).join('')}
      <div class="note a mt12" style="margin:12px 4px 4px;font-size:11.5px">${ic('lock')}<div><b>Kebijakan keamanan:</b> PIN disimpan sebagai hash bersalt. PIN sementara hanya tampil sekali dan wajib diganti saat login pertama.</div></div></div><div>${isi}</div></div>`;
  if (window.innerWidth < 900) $('#setGrid').style.gridTemplateColumns = 'minmax(0,1fr)';
};
function akunSt(u) { return u.terkunci === 'TRUE' ? 'Terkunci' : (String(u.wajib_ganti_pin).toUpperCase() === 'TRUE' ? 'Wajib Ganti PIN' : 'Normal'); }
function setUser() {
  const st = tst('usr', { role: 'ALL', site: 'ALL', status: 'ALL' });
  const all = S.data.users || [];
  const rows = all.filter(u => (st.role === 'ALL' || u.role === st.role) && (st.site === 'ALL' || u.site === 'ALL' || String(u.site).split(',').includes(st.site)) && (st.status === 'ALL' || u.status === st.status || akunSt(u) === st.status) && cari(st.q, u.nrp, u.nama, u.email_gmail, u.email_corporate, u.jabatan)).sort((a, b) => String(a.nama).localeCompare(b.nama));
  const rv = { SHEC_CORPORATE: 'o', SHEC_SITE: 'b', PIC: 'g', PJO: 'a', MANAJEMEN: 'n' };
  return `<div class="row mb16"><span class="sp"></span><button class="btn p" data-act="u-form">${ic('person_add')} Tambah Pengguna Baru</button></div>
    <div class="grid g4 kpis mb16">${kpi({ label: 'TOTAL PERSONEL', value: nf(all.length), icon: 'group', ic: 'o' })}${kpi({ label: 'AKUN AKTIF', value: nf(all.filter(u => u.status === 'Aktif').length), icon: 'check_circle', ic: 'g', vc: 't-g' })}${kpi({ label: 'AKUN TERKUNCI', value: nf(all.filter(u => u.terkunci === 'TRUE').length), icon: 'lock', ic: 'r', vc: 't-r', sub: `> ${esc(cfg('maks_gagal', 5))} kali PIN salah`, act: 'flt-usr', v: 'Terkunci' })}${kpi({ label: 'KREDENSIAL BARU', value: nf(all.filter(u => akunSt(u) === 'Wajib Ganti PIN').length), icon: 'key', ic: 'a', vc: 't-a', sub: 'Wajib ganti PIN sementara', act: 'flt-usr', v: 'Wajib Ganti PIN' })}</div>
    <div class="card"><div class="fbar"><div class="srch">${ic('search')}<input class="inp" id="usrQ" data-in="q" data-t="usr" value="${esc(st.q)}" placeholder="Cari NRP, nama, email…" aria-label="Cari pengguna"></div>
      <select class="inp" data-ch="flt" data-t="usr" data-k="role" aria-label="Peran">${opsi([['ALL', 'Semua peran']].concat(Object.keys(ROLE_LABEL).map(k => [k, ROLE_LABEL[k]])), st.role)}</select>
      <select class="inp" data-ch="flt" data-t="usr" data-k="site" aria-label="Site">${opsi([['ALL', 'Semua site']].concat((S.data.sites || []).map(s => [s.kode, s.nama])), st.site)}</select>
      <select class="inp" data-ch="flt" data-t="usr" data-k="status" aria-label="Status">${opsi([['ALL', 'Semua status'], 'Aktif', 'Nonaktif', 'Terkunci', 'Wajib Ganti PIN'], st.status)}</select></div>
      ${tabel('usr', { key: 'nrp', rows, unit: 'personel terdaftar', cols: [
        { l: 'Personel', r: u => `<div class="row"><div class="av s">${esc(inisial(u.nama))}</div><div><div class="t1">${esc(u.nama)}</div><div class="t2">NRP ${esc(u.nrp)}${u.jabatan ? ' • ' + esc(u.jabatan) : ''}</div></div></div>` },
        { l: 'Peran', r: u => pill(ROLE_LABEL[u.role] || u.role, rv[u.role], false) },
        { l: 'Site / Wilayah', r: u => `<span class="small">${esc(namaSite(u.site))}</span>` },
        { l: 'Departemen', r: u => `<span class="small">${esc(namaDept(u.departemen))}</span>` },
        { l: 'Email Notifikasi', r: u => `<div class="small" style="word-break:break-all">${esc(u.email_gmail || '–')}</div>${u.email_corporate ? `<div class="t2" style="word-break:break-all">CC: ${esc(u.email_corporate)}</div>` : ''}` },
        { l: 'Status', r: u => `<label class="tgl" title="${u.status === 'Aktif' ? 'Nonaktifkan' : 'Aktifkan'}"><input type="checkbox" data-ch="u-status" data-id="${esc(u.nrp)}" ${u.status === 'Aktif' ? 'checked' : ''} ${u.nrp === S.me.nrp ? 'disabled' : ''} aria-label="Status aktif ${esc(u.nama)}"><span></span></label>` },
        { l: 'Akun', r: u => `${pill(akunSt(u), null, akunSt(u) === 'Terkunci' ? 'lock' : (akunSt(u) === 'Wajib Ganti PIN' ? 'key' : false))}<div class="t2">${u.terakhir_masuk ? 'Masuk ' + fmtWkt(u.terakhir_masuk) : 'Belum pernah masuk'}</div>` },
        { l: '', cls: 'act', r: u => `<button class="btn gh ic sm" data-act="u-form" data-id="${esc(u.nrp)}" title="Ubah" aria-label="Ubah ${esc(u.nama)}">${ic('edit')}</button><button class="btn sm" data-act="u-reset" data-id="${esc(u.nrp)}">${ic('lock_reset')} Reset PIN</button>${u.terkunci === 'TRUE' ? ` <button class="btn sm t" data-act="u-buka" data-id="${esc(u.nrp)}">${ic('lock_open')} Buka Kunci</button>` : ''}` }
      ] })}</div>`;
}
ACT['flt-usr'] = t => { const st = tst('usr'); st.status = st.status === t.dataset.v ? 'ALL' : t.dataset.v; st.page = 1; renderSec('pengaturan'); };
function formUser(u) {
  const baru = !u; u = u || { role: R.PIC, status: 'Aktif', site: '' };
  const semua = [R.CORP, R.MGT].includes(u.role);
  modal({ title: baru ? 'Tambah Pengguna Baru' : 'Ubah Pengguna', sub: baru ? 'PIN sementara diterbitkan otomatis & hanya ditampilkan sekali.' : `NRP ${u.nrp}`, icon: 'person_add', size: 'lg',
    body: `<form id="fUser" class="frm" novalidate>
      ${fld({ n: 'nrp', l: 'NRP (Nomor Registrasi Pokok)', v: u.nrp, req: true, max: 30, ro: !baru, ph: 'Contoh: 7320491' })}${fld({ n: 'nama', l: 'Nama lengkap', v: u.nama, req: true, max: 120 })}
      ${fld({ n: 'role', l: 'Peran (RBAC)', t: 'select', opts: Object.keys(ROLE_LABEL).map(k => [k, ROLE_LABEL[k]]), v: u.role, req: true, ph: false, ch: 'u-role' })}${fld({ n: 'departemen', l: 'Departemen', t: 'select', opts: deptList().map(d => [d.kode, d.nama]), v: u.departemen, req: true })}
      ${fld({ n: 'jabatan', l: 'Jabatan', v: u.jabatan, max: 120 })}${fld({ n: 'status', l: 'Status akun', t: 'select', opts: ['Aktif', 'Nonaktif'], v: u.status, ph: false })}
      <div class="full ${semua ? 'hide' : ''}" id="uSiteW">${fld({ n: 'site', l: 'Site / wilayah kewenangan', t: 'checks', v: semua ? '' : u.site, opts: (S.data.sites || []).map(s => [s.kode, s.nama]) })}</div>
      <div class="full note b ${semua ? '' : 'hide'}" id="uSiteAll">${ic('public')}<div>Peran ini memiliki cakupan <b>seluruh site</b>.</div></div>
      ${fld({ n: 'email_gmail', l: 'Email Gmail (notifikasi utama)', t: 'email', v: u.email_gmail, req: true, max: 120, ph: 'nama@gmail.com', help: 'Wajib. Dipakai untuk pengingat — bukan untuk login.' })}${fld({ n: 'email_corporate', l: 'Email corporate (opsional)', t: 'email', v: u.email_corporate, max: 120, help: 'Opsional, dipakai sebagai tembusan (CC) pengingat.' })}
    </form>`, foot: `<span class="lf">${ic('lock', 's')} Login memakai NRP + PIN</span><button class="btn gh" data-act="mclose">Batal</button><button class="btn p" data-act="u-simpan" data-baru="${baru ? 1 : 0}">${ic('save')} ${baru ? 'Simpan & Terbitkan PIN' : 'Simpan Perubahan'}</button>` });
}
CH['u-role'] = t => { const all = [R.CORP, R.MGT].includes(t.value); $('#uSiteW').classList.toggle('hide', all); $('#uSiteAll').classList.toggle('hide', !all); };
function modalPin(u, pin) {
  modal({ title: 'Kredensial PIN Sementara Diterbitkan', sub: 'Ketentuan akses mandatori sesuai tata kelola SHEC', icon: 'key', size: 'sm', dismiss: false,
    body: `<div class="card flat" style="background:var(--sf2)"><div class="card-b"><div class="xsmall b6 muted">PERSONEL PENERIMA</div><div class="row mt8"><b class="sp" style="font-size:15px">${esc(u.nama)}</b>${pill(ROLE_LABEL[u.role] || u.role, 'b', false)}</div><div class="small muted2">NRP <b>${esc(u.nrp)}</b> • ${esc(namaDept(u.departemen))} (${esc(namaSite(u.site))})</div></div></div>
      <div class="xsmall b6 muted mt16" style="text-align:center">PIN AKSES BARU (6 DIGIT)</div><div class="pinbox" id="pinVal">${esc(pin)}</div><div class="row" style="justify-content:center"><button class="btn sm" data-act="pin-salin">${ic('content_copy')} Salin PIN</button></div>
      <div class="note a mt16">${ic('warning')}<div><b>PERINGATAN KEAMANAN WAJIB</b><br>PIN sementara ini <b>hanya ditampilkan satu kali</b> dan tidak disimpan dalam teks biasa. Pengguna wajib menggantinya saat login pertama.</div></div>
      <div class="small muted mt12 row">${ic('mail', 's')} Notifikasi dapat dikirim ke: <b class="mono">${esc(u.email_gmail || '–')}</b></div>`,
    foot: `<button class="btn gh" data-act="mclose">Tutup</button><button class="btn p" data-act="pin-kirim" data-nrp="${esc(u.nrp)}">${ic('mail')} Kirim Notifikasi ke Gmail Pengguna</button>` });
  S.ui.pinSem = pin;
  S.ui.modalTutup = () => { S.ui.pinSem = null; };
}
CH['u-status'] = t => {
  const u = (S.data.users || []).find(x => x.nrp === t.dataset.id); if (!u) return;
  const v = Object.assign({}, u, { status: t.checked ? 'Aktif' : 'Nonaktif' });
  kirim('user.simpan', v, { apply: () => upsert('users', 'nrp', { nrp: u.nrp, status: v.status }) }).catch(() => { });
};
Object.assign(ACT, {
  'u-form': t => formUser(t.dataset.id ? (S.data.users || []).find(u => u.nrp === t.dataset.id) : null),
  'u-simpan': async t => {
    const f = $('#fUser'), baru = t.dataset.baru === '1';
    const v = bacaForm(f);
    const semua = [R.CORP, R.MGT].includes(v.role);
    if (!validasi(f, x => ({ nrp: /^[A-Za-z0-9.\-]{3,30}$/.test(x.nrp) ? '' : 'NRP 3–30 karakter huruf/angka.', site: !semua && !x.site ? 'Pilih minimal satu site untuk peran ini.' : '' }))) return;
    v.site = semua ? 'ALL' : v.site; v.baru = baru; v.nrp = v.nrp.toUpperCase();
    if (!baru) { tutupModal(); kirim('user.simpan', v, { apply: () => upsert('users', 'nrp', v) }).catch(() => { }); return; }
    try { const res = await kirim('user.simpan', v, { btn: t, txt: 'Menerbitkan…', diam: true }); upsert('users', 'nrp', res.data.user); S.idx = null; rerender(true); modalPin(res.data.user, res.data.pinSementara); } catch (e) { /* toast */ }
  },
  'u-reset': async t => {
    const u = (S.data.users || []).find(x => x.nrp === t.dataset.id); if (!u) return;
    if (!await konfirmasi({ title: 'Reset PIN ' + u.nama + '?', msg: 'PIN lama tidak berlaku lagi dan semua sesi aktif pengguna diakhiri. Pastikan identitas pengguna sudah diverifikasi.', ok: 'Terbitkan PIN Sementara', danger: true, icon: 'lock_reset' })) return;
    try { const res = await kirim('user.resetPin', { nrp: u.nrp }, { btn: t, txt: '…', diam: true }); upsert('users', 'nrp', res.data.user); S.idx = null; rerender(true); modalPin(res.data.user, res.data.pinSementara); } catch (e) { /* toast */ }
  },
  'u-buka': t => { const n = t.dataset.id; kirim('user.bukaKunci', { nrp: n }, { apply: () => upsert('users', 'nrp', { nrp: n, terkunci: 'FALSE', kunci_sampai: '' }) }).catch(() => { }); },
  'pin-salin': () => { const p = S.ui.pinSem || ''; (navigator.clipboard ? navigator.clipboard.writeText(p) : Promise.reject()).then(() => toast('PIN disalin ke clipboard.', 'success')).catch(() => { const r = document.createRange(); r.selectNode($('#pinVal')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Tekan Ctrl+C untuk menyalin PIN.', 'info'); }); },
  'pin-kirim': t => kirim('user.kirimPin', { nrp: t.dataset.nrp, pin: S.ui.pinSem }, { btn: t, txt: 'Mengirim…' }).catch(() => { })
});
function setMaster(tabel) {
  const key = tabel === 'Sites' ? 'sites' : 'departemen', rows = (S.data[key] || []).slice().sort((a, b) => String(a.kode).localeCompare(b.kode));
  return `<div class="card"><div class="card-h"><div class="sp"><h3>${tabel === 'Sites' ? 'Site Operasional' : 'Departemen'} (${rows.length})</h3><p>Data master tidak dihapus — nonaktifkan bila tidak digunakan.</p></div><button class="btn p" data-act="m-form" data-t="${tabel}">${ic('add')} Tambah</button></div>
    ${tabel === 'Sites' ? tabel_m(rows, tabel, [{ l: 'Kode', r: s => `<span class="idc">${esc(s.kode)}</span>` }, { l: 'Nama Site', r: s => `<b>${esc(s.nama)}</b>` }, { l: 'Wilayah', r: s => esc(s.wilayah || '–') }, { l: 'Lokasi', r: s => `<span class="small muted">${esc(s.lokasi || '–')}</span>` }, { l: 'Status', r: s => pill(s.status) }])
      : tabel_m(rows, tabel, [{ l: 'Kode', r: s => `<span class="idc">${esc(s.kode)}</span>` }, { l: 'Nama Departemen', r: s => `<b>${esc(s.nama)}</b>` }, { l: 'Status', r: s => pill(s.status) }])}</div>`;
}
function tabel_m(rows, t, cols) { return tabel('m' + t, { key: 'kode', rows, semua: true, cols: cols.concat([{ l: '', cls: 'act', r: s => `<button class="btn gh ic sm" data-act="m-form" data-t="${t}" data-id="${esc(s.kode)}" aria-label="Ubah">${ic('edit')}</button>` }]) }); }
Object.assign(ACT, {
  'm-form': t => {
    const tb = t.dataset.t, key = tb === 'Sites' ? 'sites' : 'departemen', s = t.dataset.id ? (S.data[key] || []).find(x => x.kode === t.dataset.id) : { status: 'Aktif' };
    modal({ title: (t.dataset.id ? 'Ubah ' : 'Tambah ') + (tb === 'Sites' ? 'Site' : 'Departemen'), icon: tb === 'Sites' ? 'apartment' : 'domain', body: `<form id="fM" class="frm" novalidate>${fld({ n: 'kode', l: 'Kode', v: s.kode, req: true, max: 20, ro: !!t.dataset.id, ph: 'Contoh: TBG' })}${fld({ n: 'status', l: 'Status', t: 'select', opts: ['Aktif', 'Nonaktif'], v: s.status, ph: false })}${fld({ n: 'nama', l: 'Nama', v: s.nama, req: true, full: true, max: 120 })}${tb === 'Sites' ? fld({ n: 'wilayah', l: 'Wilayah / provinsi', v: s.wilayah, max: 80 }) + fld({ n: 'lokasi', l: 'Lokasi / keterangan', v: s.lokasi, max: 200 }) : ''}</form>`,
      foot: `<button class="btn gh" data-act="mclose">Batal</button><button class="btn p" data-act="m-simpan" data-t="${tb}" data-baru="${t.dataset.id ? 0 : 1}">${ic('save')} Simpan</button>` });
  },
  'm-simpan': t => {
    const f = $('#fM'); if (!validasi(f, x => ({ kode: /^[A-Za-z0-9\-]{2,20}$/.test(x.kode) ? '' : 'Kode 2–20 karakter huruf/angka.' }))) return;
    const v = bacaForm(f); v.kode = v.kode.toUpperCase(); v.tabel = t.dataset.t; v.baru = t.dataset.baru === '1';
    const key = v.tabel === 'Sites' ? 'sites' : 'departemen';
    tutupModal();
    kirim('master.simpan', v, { apply: () => upsert(key, 'kode', { kode: v.kode, nama: v.nama, status: v.status, wilayah: v.wilayah, lokasi: v.lokasi }), sukses: () => renderChrome() }).catch(() => { });
  }
});
function setPortal() {
  const rows = S.data.portal || [];
  return `<div class="card"><div class="card-h"><div class="sp"><h3>Sumber Portal (${rows.length})</h3><p>Gunakan <span class="mono">{q}</span> di URL pencarian sebagai tempat kata kunci. Klik <b>Uji</b> untuk memastikan parser membaca daftar regulasi.</p></div><button class="btn p" data-act="p-form">${ic('add')} Tambah Sumber</button></div>
    ${tabel('mportal', { key: 'id', rows, semua: true, cols: [
      { l: 'Nama Portal', r: p => `<div class="t1">${esc(p.nama)}</div><div class="t2">${esc(p.id)} • ${esc(p.kategori)} • ${esc(p.metode || 'HTML')}</div>` },
      { l: 'URL Pencarian', r: p => `<div class="mono xsmall" style="max-width:340px;word-break:break-all">${esc(p.url_pencarian || p.url_beranda)}</div>` },
      { l: 'Status Terakhir', r: p => `${pill(p.status_terakhir || 'Belum dicek')}<div class="t2">${p.terakhir_dicek ? fmtWkt(p.terakhir_dicek) : ''}</div>` },
      { l: 'Aktif', r: p => `<label class="tgl"><input type="checkbox" data-ch="p-aktif" data-id="${esc(p.id)}" ${p.aktif === 'TRUE' ? 'checked' : ''} aria-label="Aktifkan ${esc(p.nama)}"><span></span></label>` },
      { l: '', cls: 'act', r: p => `<button class="btn sm" data-act="portal-uji" data-id="${esc(p.id)}">${ic('network_check')} Uji Koneksi</button> <button class="btn gh ic sm" data-act="p-form" data-id="${esc(p.id)}" aria-label="Ubah">${ic('edit')}</button>` }
    ] })}</div><div class="note b mt16">${ic('info')}<div>Setiap portal pemerintah memiliki struktur halaman berbeda. Parser generik membaca tautan berjudul regulasi (UU, PP, Permen, Kepmen, SNI…). Bila hasil uji kosong, isi <b>Pola item (regex)</b> dengan grup bernama <span class="mono">(?&lt;link&gt;…)</span> dan <span class="mono">(?&lt;judul&gt;…)</span>, atau gunakan endpoint RSS/JSON resmi bila tersedia.</div></div>`;
}
CH['p-aktif'] = t => { const p = I().portal[t.dataset.id]; if (!p) return; const v = Object.assign({}, p, { aktif: t.checked }); kirim('portal.simpan', v, { apply: () => upsert('portal', 'id', { id: p.id, aktif: t.checked ? 'TRUE' : 'FALSE' }) }).catch(() => { }); };
Object.assign(ACT, {
  'p-form': t => {
    const p = t.dataset.id ? I().portal[t.dataset.id] : { metode: 'HTML', aktif: 'TRUE', kategori: 'Lainnya' };
    modal({ title: t.dataset.id ? 'Ubah Sumber Portal' : 'Tambah Sumber Portal', icon: 'public', size: 'lg', body: `<form id="fP" class="frm" novalidate>
      ${fld({ n: 'nama', l: 'Nama portal', v: p.nama, req: true, max: 120 })}${fld({ n: 'kategori', l: 'Kategori SHEC', t: 'select', opts: JENIS, v: p.kategori, ph: false })}
      ${fld({ n: 'deskripsi', l: 'Deskripsi singkat', v: p.deskripsi, full: true, max: 300 })}
      ${fld({ n: 'url_beranda', l: 'URL beranda', t: 'url', v: p.url_beranda, req: true, full: true })}
      ${fld({ n: 'url_pencarian', l: 'URL pencarian (gunakan {q} untuk kata kunci)', t: 'url', v: p.url_pencarian, full: true, help: 'Contoh: https://portal.go.id/cari?keyword={q}. Kosongkan bila portal tidak menyediakan pencarian (beranda yang diperiksa).' })}
      ${fld({ n: 'metode', l: 'Format respons', t: 'select', opts: ['HTML', 'RSS', 'JSON'], v: p.metode, ph: false })}${fld({ n: 'aktif', l: 'Aktif dipantau', t: 'toggle', v: p.aktif, tl: 'Ikut pemeriksaan mingguan' })}
      ${fld({ n: 'pola_item', l: 'Pola item (regex, opsional — lanjutan)', v: p.pola_item, full: true, max: 500, help: 'Contoh: <a href="(?<link>[^"]+)"[^>]*class="judul"[^>]*>(?<judul>[^<]+)</a>' })}</form>`,
      foot: `<button class="btn gh" data-act="mclose">Batal</button><button class="btn p" data-act="p-simpan" data-id="${esc(p.id || '')}">${ic('save')} Simpan</button>` });
  },
  'p-simpan': async t => {
    const f = $('#fP'); if (!validasi(f, x => ({ url_pencarian: x.url_pencarian && !/^https?:\/\//i.test(x.url_pencarian) ? 'URL harus diawali http(s)://' : '' }))) return;
    const v = bacaForm(f); v.id = t.dataset.id;
    try { const res = await kirim('portal.simpan', v, { btn: t, txt: 'Menyimpan…' }); upsert('portal', 'id', res.data.portal); S.idx = null; tutupModal(); rerender(true); } catch (e) { /* toast */ }
  }
});
function setKata() {
  const ks = S.data.kata || [], grup = {};
  ks.forEach(k => { (grup[k.kategori] = grup[k.kategori] || []).push(k); });
  return `<div class="card mb16"><div class="card-h"><div class="sp"><h3>Tambah Kata Kunci</h3><p>Klik chip untuk mengaktifkan/menonaktifkan. Kata kunci aktif dipakai crawler mingguan.</p></div></div><div class="card-b"><form id="fKK" class="row wrap" novalidate onsubmit="return false"><select class="inp" name="kategori" style="width:200px" aria-label="Kategori">${opsi(['Umum'].concat(JENIS), 'Umum')}</select><input class="inp" name="kata" id="kkBaru" maxlength="80" placeholder="Contoh: riksa uji pesawat angkat" style="flex:1;min-width:220px" aria-label="Kata kunci"><button class="btn p" data-act="kk-tambah">${ic('add')} Tambah</button></form></div></div>
    ${Object.keys(grup).sort().map(g => `<div class="card mb12"><div class="card-h"><h3 class="sp">${esc(g)}</h3><span class="xsmall muted">${grup[g].filter(k => k.aktif === 'TRUE').length}/${grup[g].length} aktif</span></div><div class="card-b row wrap">${grup[g].map(k => `<button class="chip kw ${k.aktif === 'TRUE' ? '' : 'off'}" data-act="kk-toggle" data-id="${esc(k.id)}" aria-pressed="${k.aktif === 'TRUE'}" title="${k.aktif === 'TRUE' ? 'Klik untuk nonaktifkan' : 'Klik untuk aktifkan'}">${ic(k.aktif === 'TRUE' ? 'check' : 'block', 'xs')} ${esc(k.kata)}</button>`).join('')}</div></div>`).join('') || kosong('sell', 'Belum ada kata kunci', '')}`;
}
Object.assign(ACT, {
  'kk-toggle': t => { const k = (S.data.kata || []).find(x => x.id === t.dataset.id); if (!k) return; const on = k.aktif !== 'TRUE'; kirim('kata.simpan', { id: k.id, aktif: on }, { diam: true, apply: () => upsert('kata', 'id', { id: k.id, aktif: on ? 'TRUE' : 'FALSE' }) }).catch(() => { }); },
  'kk-tambah': async t => {
    const f = $('#fKK'), v = bacaForm(f);
    if (!v.kata) { $('#kkBaru').classList.add('err'); $('#kkBaru').focus(); return; }
    try { const res = await kirim('kata.simpan', v, { btn: t, txt: '…' }); upsert('kata', 'id', res.data.kata); S.idx = null; renderSec('pengaturan'); } catch (e) { /* toast */ }
  }
});
/* ── Elemen SMKP Minerba (FR-12) — mirip pola CRUD Sumber Portal: form lengkap + toggle aktif per baris ── */
function setSmkp() {
  const rows = (S.data.smkp || []).slice().sort((a, b) => a.kode_sub.localeCompare(b.kode_sub, undefined, { numeric: true }));
  const grup = {};
  rows.forEach(e => { (grup[e.elemen_no] = grup[e.elemen_no] || []).push(e); });
  return `<div class="card mb16"><div class="card-h"><div class="sp"><h3>Elemen SMKP Minerba (${rows.length})</h3><p>Kata kunci tiap sub-elemen dipakai untuk menyarankan elemen SMKP secara otomatis dari PDF usulan regulasi. Pencocokan lokal (tanpa AI/LLM eksternal) — hasil tetap wajib dikonfirmasi SHEC Corporate saat verifikasi.</p></div><button class="btn p" data-act="smkp-form">${ic('add')} Tambah Sub-Elemen</button></div></div>
    ${Object.keys(grup).sort((a, b) => Number(a) - Number(b)).map(no => `<div class="card mb12"><div class="card-h"><h3 class="sp">Elemen ${esc(no)} — ${esc(grup[no][0].elemen)}</h3><span class="xsmall muted">${grup[no].filter(aktif).length}/${grup[no].length} aktif</span></div>
      ${tabel('msmkp' + no, { key: 'id_smkp', rows: grup[no], semua: true, rowCls: e => aktif(e) ? '' : 'tmp', cols: [
        { l: 'Kode', r: e => `<span class="idc">${esc(e.kode_sub)}</span>` },
        { l: 'Nama Sub-Elemen', r: e => `<div style="max-width:420px">${esc(e.nama_sub_elemen)}</div>${aktif(e) ? '' : pill('Arsip', 'n')}` },
        { l: 'Kata Kunci', r: e => `<div class="row wrap" style="gap:3px;max-width:380px">${String(e.kata_kunci || '').split(',').filter(Boolean).slice(0, 6).map(k => `<span class="chip" style="cursor:default">${esc(k)}</span>`).join('')}${String(e.kata_kunci || '').split(',').filter(Boolean).length > 6 ? `<span class="xsmall muted">+${String(e.kata_kunci || '').split(',').filter(Boolean).length - 6}</span>` : ''}</div>` },
        { l: 'Aktif', r: e => `<label class="tgl"><input type="checkbox" data-ch="smkp-aktif" data-id="${esc(e.id_smkp)}" ${aktif(e) ? 'checked' : ''} aria-label="Aktifkan ${esc(e.kode_sub)}"><span></span></label>` },
        { l: '', cls: 'act', r: e => `<button class="btn gh ic sm" data-act="smkp-form" data-id="${esc(e.id_smkp)}" aria-label="Ubah">${ic('edit')}</button>` }
      ] })}</div>`).join('') || kosong('fact_check', 'Belum ada elemen SMKP', 'Jalankan setupAppEnvironment() untuk mengisi taksonomi 51 sub-elemen bawaan.')}`;
}
CH['smkp-aktif'] = t => { const e = I().smkp[t.dataset.id]; if (!e) return; const on = t.checked; kirim('smkp.simpan', { id_smkp: e.id_smkp, hanyaStatus: true, status_aktif: on }, { diam: true, apply: () => upsert('smkp', 'id_smkp', { id_smkp: e.id_smkp, status_aktif: on ? 'Active' : 'Archived' }) }).catch(() => { }); };
Object.assign(ACT, {
  'smkp-form': t => {
    const e = t.dataset.id ? I().smkp[t.dataset.id] : { elemen_no: '1', elemen: '', status_aktif: 'Active' };
    modal({ title: t.dataset.id ? 'Ubah Sub-Elemen SMKP' : 'Tambah Sub-Elemen SMKP', icon: 'fact_check', size: 'lg', body: `<form id="fSmkp" class="frm" novalidate>
      ${fld({ n: 'elemen_no', l: 'Elemen (1–7)', t: 'select', opts: [['1', '1 — Kebijakan'], ['2', '2 — Perencanaan'], ['3', '3 — Organisasi dan Personel'], ['4', '4 — Implementasi'], ['5', '5 — Pemantauan, Evaluasi dan Tindak Lanjut'], ['6', '6 — Dokumentasi'], ['7', '7 — Tinjauan Manajemen dan Peningkatan Kinerja']], v: e.elemen_no, req: true, ph: false })}${fld({ n: 'kode_sub', l: 'Kode sub-elemen', v: e.kode_sub, req: true, max: 10, ph: 'Contoh: 1.a', ro: !!t.dataset.id })}
      ${fld({ n: 'elemen', l: 'Nama elemen', v: e.elemen, req: true, max: 200, full: true, ph: 'Contoh: Kebijakan' })}
      ${fld({ n: 'nama_sub_elemen', l: 'Nama sub-elemen', t: 'textarea', rows: 2, v: e.nama_sub_elemen, req: true, full: true, max: 300 })}
      ${fld({ n: 'kata_kunci', l: 'Kata kunci (pisahkan dengan koma)', t: 'textarea', rows: 3, v: String(e.kata_kunci || '').split(',').join(', '), full: true, max: 2000, ph: 'kata kunci satu, kata kunci dua, …', help: 'Dipakai untuk mencocokkan isi PDF usulan regulasi secara otomatis (pencocokan teks lokal, tanpa AI/LLM eksternal).' })}
      ${fld({ n: 'status_aktif', l: 'Status', t: 'toggle', v: e.status_aktif !== 'Archived', tl: 'Aktif — ikut pencocokan otomatis' })}</form>`,
      foot: `<button class="btn gh" data-act="mclose">Batal</button><button class="btn p" data-act="smkp-simpan" data-id="${esc(t.dataset.id || '')}">${ic('save')} Simpan</button>` });
  },
  'smkp-simpan': async t => {
    const f = $('#fSmkp'); if (!validasi(f)) return;
    const v = bacaForm(f); v.id_smkp = t.dataset.id;
    try { const res = await kirim('smkp.simpan', v, { btn: t, txt: 'Menyimpan…' }); upsert('smkp', 'id_smkp', res.data.smkp); S.idx = null; tutupModal(); rerender(true); } catch (e) { /* toast */ }
  }
});
const PARAM = [
  ['Identitas Aplikasi', 'badge', [['nama_aplikasi', 'Nama aplikasi'], ['nama_perusahaan', 'Nama perusahaan (laporan resmi)'], ['logo_url', 'URL logo (https, opsional)']]],
  ['Kepatuhan & Pengingat', 'notifications_active', [['periode_aktif', 'Periode evaluasi aktif (mis. 2026-S2, kosong = otomatis)'], ['target_kepatuhan', 'Ambang batas kepatuhan (%)'], ['ambang_hari', 'Ambang "Mendekati Kedaluwarsa" (hari)'], ['tahap_pengingat', 'Tahap pengingat izin (hari, pisahkan koma)'], ['hari_pengingat_rtp', 'Pengingat RTP sebelum due date (hari)'], ['jadwal_portal', 'Jadwal pemeriksaan portal (informasi)'], ['email_notifikasi_aktif', 'Email notifikasi otomatis (Izin, RTP, Antrean, Kewajiban, Evaluasi)']]],
  ['Keamanan Sesi & Login', 'shield_lock', [['idle_menit', 'Sesi berakhir bila idle (menit)'], ['sesi_jam', 'Masa berlaku sesi maksimum (jam)'], ['maks_gagal', 'PIN salah sebelum akun terkunci'], ['kunci_menit', 'Lama penguncian (menit)']]],
  ['Sistem & Kuota', 'settings', [['maks_upload_mb', 'Batas ukuran unggahan (MB)'], ['kuota_urlfetch', 'Kuota UrlFetch harian akun pemilik']]]
];
function setParam() {
  return `<form id="fParam" novalidate class="col" style="gap:16px">${PARAM.map(([g, i, items]) => `<div class="card"><div class="card-h"><div class="ic">${ic(i)}</div><h3>${esc(g)}</h3></div><div class="card-b frm">${items.map(([k, l]) => k === 'email_notifikasi_aktif' ? fld({ n: k, l, t: 'select', opts: [['0', 'Nonaktif — mode uji, tidak ada email terkirim'], ['1', 'Aktif — email notifikasi terkirim sungguhan']], v: cfg(k, '0'), ph: false, full: true }) : fld({ n: k, l, v: cfg(k, ''), max: 300, im: /menit|jam|hari|gagal|mb|kuota|target/.test(k) && k !== 'tahap_pengingat' ? 'numeric' : '' })).join('')}</div></div>`).join('')}
    <div class="card info"><div class="card-b"><dl class="dl c3"><div><dt>Sisa kuota email hari ini</dt><dd>${S.stat.emailSisa != null ? nf(S.stat.emailSisa) : '–'}</dd></div><div><dt>UrlFetch terpakai hari ini</dt><dd>${nf(S.stat.urlfetchHariIni)}</dd></div><div><dt>Pemeriksaan portal terakhir</dt><dd>${S.stat.portalTerakhir ? fmtWkt(S.stat.portalTerakhir) : '–'}</dd></div></dl></div></div>
    <div class="row"><span class="sp"></span><button class="btn p lg" data-act="param-simpan">${ic('save')} Simpan Parameter</button></div></form>`;
}
ACT['param-simpan'] = async t => {
  const f = $('#fParam'), v = bacaForm(f);
  if (!validasi(f, x => ({ periode_aktif: x.periode_aktif && !/^\d{4}-S[12]$/.test(x.periode_aktif) ? 'Format 2026-S2.' : '', tahap_pengingat: !/^\d+(,\s*\d+)*$/.test(x.tahap_pengingat) ? 'Daftar angka dipisah koma, mis. 90,60,30,7.' : '', idle_menit: Number(x.idle_menit) < 5 || Number(x.idle_menit) > 360 ? '5–360 menit.' : '' }))) return;
  try {
    await kirim('config.simpan', { nilai: v }, { btn: t, txt: 'Menyimpan…' });
    Object.keys(v).forEach(k => { const r = (S.data.config || []).find(c => c.key === k); if (r) r.value = v[k]; else (S.data.config = S.data.config || []).push({ key: k, value: v[k] }); });
    buildCfg(); renderChrome();
  } catch (e) { /* toast */ }
};

/* ───────────── HALAMAN: LOG AUDIT (paging di server) ───────────── */
const MODUL = ['Keamanan', 'Register 1', 'Kewajiban', 'Antrean Verifikasi', 'Pencarian Regulasi', 'Sumber Portal', 'Kata Kunci', 'Register 2', 'Register 3', 'RTP', 'Lampiran', 'Laporan', 'Pengguna', 'Sites', 'Departemen', 'Parameter'];
function audSt() { return S.ui.aud || (S.ui.aud = { q: '', modul: '', aksi: '', dari: '', sampai: '', hal: 1, data: null, muat: false, buka: new Set() }); }
function muatAudit() {
  const st = audSt(); st.muat = true;
  api('audit.list', { q: st.q, modul: st.modul, aksi: st.aksi, dari: st.dari, sampai: st.sampai, hal: st.hal, per: 25 })
    .then(res => { st.data = res.data; }).catch(e => { st.data = { rows: [], total: 0, err: e.message }; })
    .finally(() => { st.muat = false; if (S.ui.sec === 'audit') renderSec('audit', true); });
}
HAL.audit = el => {
  const st = audSt();
  if (!st.data && !st.muat) muatAudit();
  const d = st.data;
  const aksiV = a => /GAGAL|TERKUNCI|TOLAK|ARSIP|KEMBALI/.test(a) ? 'r' : (/LOGIN$|LOGOUT/.test(a) ? 'n' : (/RESET|PIN|KUNCI/.test(a) ? 'a' : (/TAMBAH|SETUJU|VERIF|TUTUP/.test(a) ? 'g' : 'b')));
  const pages = d ? Math.max(1, Math.ceil(d.total / 25)) : 1;
  el.innerHTML = hdr({ crumbs: [['Pengaturan Sistem', is(R.CORP) ? 'pengaturan' : 'dashboard'], ['Log Audit Keamanan']], title: 'Riwayat Perubahan &amp; Log Audit Keamanan', tag: 'Audit_Log', sub: 'Jejak siapa, kapan, dan apa yang diubah di seluruh register. Nilai PIN dan rahasia tidak pernah dicatat.', actions: `<button class="btn" data-act="aud-ulang">${ic('refresh')} Muat Ulang</button>` })
    + `<div class="card"><div class="fbar"><div class="srch">${ic('search')}<input class="inp" id="audQ" data-in="aud-q" value="${esc(st.q)}" placeholder="Cari NRP, nama, ID record, ringkasan…" aria-label="Cari log"></div>
      <select class="inp" data-ch="aud" data-k="modul" aria-label="Modul">${opsi([['', 'Semua modul']].concat(MODUL), st.modul)}</select>
      <select class="inp" data-ch="aud" data-k="aksi" aria-label="Aksi">${opsi([['', 'Semua aksi'], 'LOGIN', 'LOGIN_GAGAL', 'AKUN_TERKUNCI', 'TAMBAH', 'UBAH', 'ARSIP', 'VERIFIKASI', 'RESET_PIN', 'GANTI_PIN', 'EKSPOR', 'UNGGAH'], st.aksi)}</select>
      <input class="inp" type="date" style="width:auto" data-ch="aud" data-k="dari" value="${esc(st.dari)}" aria-label="Dari tanggal"><input class="inp" type="date" style="width:auto" data-ch="aud" data-k="sampai" value="${esc(st.sampai)}" aria-label="Sampai tanggal"></div>
      ${!d || st.muat && !d.rows.length ? '<div class="card-b">' + '<div class="sk sk-l"></div>'.repeat(6) + '</div>' : (d.err ? kosong('error', 'Log gagal dimuat', d.err) : `<div class="tblw"><table class="tbl cards"><thead><tr><th>Waktu</th><th>Pengguna</th><th>Aksi</th><th>Modul</th><th>ID Record</th><th>Ringkasan</th><th></th></tr></thead><tbody>${d.rows.length ? d.rows.map((a, i) => { const k = a.waktu + a.nrp + i, adaDiff = a.nilai_baru && a.nilai_baru !== '{}', buka = st.buka.has(k); return `<tr><td data-l="Waktu" class="nowrap small mono">${esc(a.waktu)}</td><td data-l="Pengguna"><div class="t1">${esc(a.nama)}</div><div class="t2">NRP ${esc(a.nrp)} • ${esc(ROLE_LABEL[a.role] || a.role)}</div></td><td data-l="Aksi">${pill(a.aksi.replace(/_/g, ' '), aksiV(a.aksi), false)}</td><td data-l="Modul" class="small">${esc(a.modul)}</td><td data-l="ID" class="mono xsmall">${esc(a.id_record || '–')}</td><td data-l="Ringkasan" class="small"><div class="clamp2" style="max-width:340px">${esc(a.ringkasan)}</div></td><td data-l="" class="act">${adaDiff ? `<button class="btn gh ic sm" data-act="aud-buka" data-k="${esc(k)}" aria-expanded="${buka}" aria-label="Lihat perubahan">${ic(buka ? 'expand_less' : 'expand_more')}</button>` : ''}</td></tr>${buka ? `<tr><td colspan="7" data-l="" style="background:var(--sf2)">${diffAudit(a)}</td></tr>` : ''}`; }).join('') : `<tr><td colspan="7" data-l="">${kosong('history', 'Tidak ada log', 'Ubah filter pencarian.')}</td></tr>`}</tbody></table></div>
      <div class="pg"><span>Total <b>${nf(d.total)}</b> entri${d.terbatas ? ' (5.000 entri terbaru)' : ''}${st.muat ? ' • <span class="spin s"></span> memuat…' : ''}</span><span class="sp"></span><button data-act="aud-hal" data-p="${st.hal - 1}" ${st.hal <= 1 ? 'disabled' : ''} aria-label="Sebelumnya">${ic('chevron_left', 's')}</button><span>Halaman ${st.hal} dari ${pages}</span><button data-act="aud-hal" data-p="${st.hal + 1}" ${st.hal >= pages ? 'disabled' : ''} aria-label="Berikutnya">${ic('chevron_right', 's')}</button></div>`)}</div>`;
};
function diffAudit(a) {
  let l = {}, b = {};
  try { l = JSON.parse(a.nilai_lama || '{}'); b = JSON.parse(a.nilai_baru || '{}'); } catch (e) { /* abaikan */ }
  const k = Object.keys(Object.assign({}, l, b));
  return `<div class="diff">${['Nilai Lama', 'Nilai Baru'].map((t, i) => `<div style="${i ? 'background:#F0FDF4;border-color:var(--g-b)' : 'background:#FEF2F2;border-color:var(--r-b)'}"><h5>${t}</h5>${k.map(x => `<div class="small"><b class="mono">${esc(x)}</b>: ${esc(String((i ? b : l)[x] == null ? '∅' : (i ? b : l)[x]))}</div>`).join('') || '<span class="muted small">–</span>'}</div>`).join('')}</div>`;
}
const audCariTunda = debounce(() => { const st = audSt(); st.hal = 1; st.data = null; muatAudit(); renderSec('audit', true); }, 450);
IN['aud-q'] = t => { audSt().q = t.value; audCariTunda(); };
CH.aud = t => { const st = audSt(); st[t.dataset.k] = t.value; st.hal = 1; st.data = null; renderSec('audit'); };
Object.assign(ACT, {
  'aud-ulang': () => { const st = audSt(); st.data = null; renderSec('audit'); },
  'aud-hal': t => { const st = audSt(); st.hal = Number(t.dataset.p); muatAudit(); renderSec('audit', true); },
  'aud-buka': t => { const st = audSt(), k = t.dataset.k; if (st.buka.has(k)) st.buka.delete(k); else st.buka.add(k); renderSec('audit', true); }
});

/* ───────────── BOOT ───────────── */
function boot() {
  pasangEvent();
  const tok = ssGet('token');
  if (tok) { S.token = tok; muatSnapshot(); masukApp(); }
  else layarLogin();
}
boot();
