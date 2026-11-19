// Loads apps-script/Code.gs (+ Oct2026.gs) into an in-memory mock of the Apps Script services
// (SpreadsheetApp, PropertiesService, CacheService, UrlFetchApp as a fake BGF, …), so server code can run in Node.
// Used by tests/server.test.js. Nothing here talks to Google or BGF; the passwords in the tests are made up.
const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), path = require('path');
const root = path.join(__dirname, '..');
const RS = '\x1e', US = '\x1f';

function colNum(letters) { let n = 0; for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64); return n; }
class Range {
  constructor(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  _grow(r, c) { const d = this.sh.data; while (d.length < r) d.push([]); for (const row of d) while (row.length < Math.max(c, this.sh.cols)) row.push(''); this.sh.cols = Math.max(this.sh.cols, c); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) { const v = (this.sh.data[this.r - 1 + i] || [])[this.c - 1 + j]; row.push(v === undefined ? '' : v); } out.push(row); } return out; }
  getDisplayValues() { return this.getValues().map(r => r.map(v => String(v))); }
  getDisplayValue() { return this.getDisplayValues()[0][0]; }
  getValue() { return this.getValues()[0][0]; }
  setValues(vals) { if (vals.length !== this.nr || vals[0].length !== this.nc) throw new Error('setValues size ' + vals.length + 'x' + vals[0].length + ' into ' + this.nr + 'x' + this.nc + ' @' + this.sh.name); this._grow(this.r + this.nr - 1, this.c + this.nc - 1); vals.forEach((row, i) => row.forEach((v, j) => { this.sh.data[this.r - 1 + i][this.c - 1 + j] = v; })); return this; }
  setValue(v) { this._grow(this.r, this.c); this.sh.data[this.r - 1][this.c - 1] = v; return this; }
  setFormula(f) { return this.setValue(f); }
  setFontWeight() { return this; } setNumberFormat() { return this; }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) if (this.sh.data[this.r - 1 + i]) this.sh.data[this.r - 1 + i][this.c - 1 + j] = ''; return this; }
  getSheet() { return this.sh; }
  copyTo(dest) { const v = this.getValues(); dest.sh.getRange(dest.r, dest.c, v.length, v[0].length).setValues(v); }
  createTextFinder(key) { const self = this; return { matchEntireCell() { return this; }, findNext() { for (let i = 0; i < self.sh.data.length; i++) if (String(self.sh.data[i][self.c - 1]) === key) return { getRow: () => i + 1 }; return null; } }; }
}
class Sheet {
  constructor(name) { this.name = name; this.data = []; this.cols = 26; }
  getName() { return this.name; }
  getLastRow() { let n = this.data.length; while (n > 0 && this.data[n - 1].every(v => v === '' || v === undefined)) n--; return n; }
  getMaxColumns() { return this.cols; } getMaxRows() { return Math.max(1000, this.data.length); }
  insertColumnsAfter(c, n) { this.cols += n; }
  setFrozenRows() {} clear() { this.data = []; }
  setName(n) { this.name = n; return this; } insertRowsAfter() {}
  copyTo(d) { const s = d.insertSheet('Copy of ' + this.name); s.data = this.data.map(r => r.slice()); s.cols = this.cols; return s; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      let m = a.match(/^([A-Z]+):([A-Z]+)$/); if (m) return new Range(this, 1, colNum(m[1]), this.getMaxRows(), colNum(m[2]) - colNum(m[1]) + 1);
      m = a.match(/^([A-Z]+)(\d+)$/); if (m) return new Range(this, +m[2], colNum(m[1]), 1, 1);
      throw new Error('range ' + a);
    }
    return new Range(this, a, b, c || 1, d || 1);
  }
  appendRow(row) { const n = this.getLastRow(); this.data.length = n; this.data.push(row.slice()); }
  deleteRow(r) { this.data.splice(r - 1, 1); }
}
// a spreadsheet file; docs[0] is the one the script is bound to, SpreadsheetApp.create adds more (backups)
const docs = [];
function newDoc(name, sheets) {
  const id = 'ss' + docs.length;
  const d = {
    sheets, name,
    getId: () => id, getName: () => d.name, getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id,
    getSheetByName: n => sheets.find(s => s.name === n) || null,
    insertSheet(n) { if (this.getSheetByName(n)) throw new Error('sheet exists: ' + n); const s = new Sheet(n); sheets.push(s); return s; },
    getNumSheets: () => sheets.length, getSheets: () => sheets, setSpreadsheetTimeZone() {}, deleteSheet(s) { if (sheets.length === 1) throw new Error('last sheet'); sheets.splice(sheets.indexOf(s), 1); }
  };
  docs.push(d);
  return d;
}
const sheets = [];
const doc = newDoc('직원 취식 목록', sheets);
const props = {}, cache = {}, log = { fetch: [], alerts: [], mail: [], triggers: [] };
function fmt(d, tz, f) {
  const t = new Date(d.getTime() + (tz === 'UTC' ? 0 : 9) * 3600000), p = n => ('0' + n).slice(-2);
  const o = { yyyy: t.getUTCFullYear(), MM: p(t.getUTCMonth() + 1), dd: p(t.getUTCDate()), HH: p(t.getUTCHours()), mm: p(t.getUTCMinutes()), ss: p(t.getUTCSeconds()), M: t.getUTCMonth() + 1, d: t.getUTCDate() };
  return f.replace(/yyyy|MM|dd|HH|mm|ss|M|d/g, k => o[k]);
}
const BGF = { pw: {}, jumpo: {}, slips: {}, loginCount: 0 };   // filled by the test
function ssv(vars, dss) {
  const p = ['SSV:utf-8'];
  Object.keys(vars).forEach(k => p.push(k + '=' + vars[k]));
  Object.keys(dss).forEach(name => { const rows = dss[name]; const cols = rows.cols || Object.keys(rows[0] || {}); p.push('Dataset:' + name); p.push(['_RowType_'].concat(cols.map(c => c + ':STRING(256)')).join(US)); rows.forEach(r => p.push(['N'].concat(cols.map(c => r[c] === undefined ? '\x03' : r[c])).join(US))); p.push(''); });
  return p.join(RS) + RS;
}
function parseReq(buf) {
  const recs = Buffer.from(buf).toString('utf8').split(RS), vars = {}, ds = {}; let cur = null, cols = null;
  for (let i = 1; i < recs.length; i++) { const rec = recs[i];
    if (rec.startsWith('Dataset:')) { cur = rec.slice(8); ds[cur] = []; continue; }
    if (cur === null) { const eq = rec.indexOf('='); if (eq > 0) vars[rec.slice(0, eq)] = rec.slice(eq + 1); continue; }
    if (rec === '') { cur = null; continue; }
    if (rec.startsWith('_RowType_')) { cols = rec.split(US).slice(1).map(c => c.split(':')[0]); continue; }
    const f = rec.split(US), o = {}; cols.forEach((c, k) => o[c] = f[k + 1]); ds[cur].push(o); }
  return { vars, ds };
}
const sandbox = {
  console, JSON, Math, Date, Object, Array, String, Number, RegExp, Error, parseInt, parseFloat, isNaN,
  SpreadsheetApp: { getActive: () => doc, flush() {}, getUi: () => { throw new Error('no ui'); },
    create(name) { const d = newDoc(name, []); d.insertSheet('Sheet1'); return d; },
    openById(id) { const d = docs.find(x => x.getId() === id && !x.gone); if (!d) throw new Error('no file ' + id); return d; } },
  PropertiesService: { getScriptProperties: () => ({
    getProperties: () => Object.assign({}, props), getProperty: k => (k in props ? props[k] : null),
    setProperty(k, v) { props[k] = String(v); }, setProperties(o) { Object.assign(props, o); }, deleteProperty(k) { delete props[k]; } }) },
  CacheService: { getScriptCache: () => ({
    get: k => (k in cache ? cache[k] : null), put(k, v) { if (String(v).length > 100000) throw new Error('cache too big'); cache[k] = String(v); }, remove(k) { delete cache[k]; },
    removeAll(ks) { ks.forEach(k => delete cache[k]); }, putAll(o) { Object.keys(o).forEach(k => { if (String(o[k]).length > 100000) throw new Error('cache too big'); cache[k] = String(o[k]); }); },
    getAll(ks) { const o = {}; ks.forEach(k => { if (k in cache) o[k] = cache[k]; }); return o; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ScriptApp: { getProjectTriggers: () => log.triggers.map(t => ({ getHandlerFunction: () => t, getUniqueId: () => 'id-' + t })), deleteTrigger() {},
    newTrigger(fn) { const b = { timeBased: () => b, everyMinutes: () => b, atHour: () => b, nearMinute: () => b, everyDays: () => b, inTimezone: () => b, create() { log.triggers.push(fn); } }; return b; } },
  Session: { getActiveUser: () => ({ getEmail: () => sandbox.__admin ? 'o@x' : '' }), getEffectiveUser: () => ({ getEmail: () => 'o@x' }) },
  MailApp: { sendEmail(to, subj) { log.mail.push(subj); } },
  HtmlService: { createHtmlOutputFromFile: () => ({ getContent: () => '<html>page</html>', setTitle() { return this; }, addMetaTag() { return this; } }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType() { return this; }, text: s }) },
  Utilities: {
    formatDate: fmt, getUuid: () => crypto.randomUUID(),
    DigestAlgorithm: { MD5: 'md5', SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(String(s), 'utf8').digest()),
    computeHmacSha256Signature: (s, k) => Array.from(crypto.createHmac('sha256', k).update(s).digest()),
    base64EncodeWebSafe: b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64Encode: s => Buffer.from(typeof s === 'string' ? s : Buffer.from(s)).toString('base64'),
    base64Decode: s => Array.from(Buffer.from(s, 'base64')),
    newBlob: s => ({ getBytes: () => Array.from(Buffer.from(String(s), 'utf8')), getDataAsString: () => Buffer.from(s).toString('utf8') })
  },
  UrlFetchApp: { fetch(url, opt) {
    const u = url.replace('https://store.bgfretail.com', ''); let body = '', headers = {};
    const cookie = (opt.headers && opt.headers.Cookie) || '';
    if (opt.method === 'get') { body = 'ok'; }
    else {
      const req = parseReq(opt.payload);
      log.fetch.push({ u, vars: req.vars, ds: req.ds, cookie });
      if (u === '/login/login') {
        const l = req.ds.ds_login[0]; BGF.loginCount++;
        if (BGF.pw[l.USER_NO] && BGF.pw[l.USER_NO] === l.PASSWD) { body = ssv({ 'ErrorCode:string': '0' }, { GDS_JUMPO: [BGF.jumpo[l.USER_NO]], GDS_MSG: [] }); headers['Set-Cookie'] = ['JSESSIONID=sess' + l.USER_NO + '; Path=/']; }
        else body = ssv({ 'ErrorCode:string': '0' }, { GDS_MSG: [{ MSG_CONT: '비밀번호 오류' }] });
      } else {
        const m = cookie.match(/JSESSIONID=sess(\d+)/), who = m && m[1];
        if (!who) body = ssv({ 'ErrorCode:string': '-1', 'ErrorMsg:string': '세션 없음' }, {});
        else if (u === '/stco010/selComCd') body = ssv({ 'ErrorCode:string': '0' }, { _ds_S312: [{ CODE: '10', NAME: '폐기' }, { CODE: '31', NAME: '저회전상품철수' }] });
        else if (u === '/stgj020/search') {
          const q = req.ds.dsSearch[0];
          if (q.strStoreCd !== who) body = ssv({ 'ErrorCode:string': '-2', 'ErrorMsg:string': '점포 다름 ' + q.strStoreCd }, {});
          else body = ssv({ 'ErrorCode:string': '0' }, { dsList: Object.assign((BGF.slips[who] || []).filter(c => q.strChitDiv === '' || (q.strChitDiv === '10' ? c.CHIT_ID === '04' : c.CHIT_ID === '24')).map(c => c.head), { cols: ['CHIT_NO', 'CHIT_ID', 'CHIT_FLAG', 'CHIT_YMD', 'ITEM_CNT', 'CRE_YMDHMS'] }) });
        } else if (/searchDetail/.test(u)) {
          const q = req.ds.dsSearch[0]; const rows = [];
          (BGF.slips[who] || []).forEach(c => { if (q.strChitNoList.indexOf("'" + c.head.CHIT_NO + "'") >= 0) c.lines.forEach(l => rows.push(l)); });
          body = ssv({ 'ErrorCode:string': '0' }, { dsListType1: Object.assign(rows, { cols: ['CHIT_NO', 'CHIT_SEQ', 'ITEM_CD', 'ITEM_NM', 'LARGE_NM', 'QTY', 'WONGA_PRICE', 'WONGA_AMT', 'MAEGA_PRICE', 'MAEGA_AMT'] }) });
        } else body = ssv({ 'ErrorCode:string': '-9', 'ErrorMsg:string': 'unknown ' + u }, {});
      }
    }
    return { getAllHeaders: () => headers, getResponseCode: () => 200, getContentText: () => body };
  } }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['Code.gs', 'Oct2026.gs']) vm.runInContext(fs.readFileSync(path.join(root, 'apps-script', f), 'utf8'), sandbox, { filename: f });
// every "execution" starts with fresh globals, like Apps Script: reset the per-execution caches
function exec(src) { vm.runInContext('CUR_ = null; SS_DOC_ = null; PS_ = null; PSNAP_ = null; MEM_ = {};', sandbox); return vm.runInContext(src, sandbox); }
module.exports = { exec, sandbox, sheets, doc, docs, props, cache, log, BGF, Sheet, fmt };
