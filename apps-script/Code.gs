/**
 * 직원 취식 목록
 * - 매일 00:01 무렵 BGF 점포시스템에서 어제(와 그제) 폐기 전표를 가져와 '폐기목록' 시트에 추가
 * - 낮에도 오늘 폐기를 바로 가져옴: 직원이 링크를 열 때(2분에 한 번까지) + 10분마다 자동
 * - 웹앱: 직원이 자기 이름을 한 번 고르고, 품목마다 [취식] / [폐기] 를 한 번 눌러 등록
 *   취식 → 전체 이름(김성휘), 폐기 → 이름만(성휘)
 * - 출근일지: [출근] / [퇴근] 한 번 누르거나 직접 입력. 다른 직원 근무 시간도 날짜별로 보임
 *   근무 기록 밖 시간의 폐기를 등록하면 확인을 받고, '확인' 열에 '근무외' 로 남김
 * - 월별 합계: '월별 합계' 시트와 웹앱에서 확인 (웹앱은 근무시간 합계도)
 */

var TZ = 'Asia/Seoul';
var BASE = 'https://store.bgfretail.com';
var STORE_CD = '25377';
var USER_NO = '25377';

var SH_ITEMS = '폐기목록';
var SH_MEMBERS = '직원';
var SH_SUMMARY = '월별 합계';
var SH_LOG = '가져오기 기록';
var SH_SHIFTS = '출근일지';

// 폐기목록 columns (1-based)
var C = { KEY: 1, DATE: 2, TIME: 3, NAME: 4, CODE: 5, CAT: 6, QTY: 7, WPRICE: 8, WAMT: 9, MPRICE: 10, MAMT: 11, CHIT: 12, TYPE: 13, WHO: 14, MEMBER: 15, AT: 16, MONTH: 17, NOTE: 18 };
var NCOL = 18;
var HEADERS = ['키', '일자', '생성시각', '품명', '상품코드', '분류', '수량', '원가단가', '원가금액', '매가단가', '매가금액', '전표번호', '구분', '등록이름', '직원', '등록시각', '월', '확인'];
var OFFSHIFT_NOTE = '근무외';

// 출근일지 columns (1-based). 퇴근이 출근보다 이르면 다음 날 퇴근.
var SC = { KEY: 1, DATE: 2, MEMBER: 3, START: 4, END: 5, HOURS: 6, MEMO: 7, AT: 8, MONTH: 9 };
var SNCOL = 9;
var SHIFT_HEADERS = ['키', '날짜', '직원', '출근', '퇴근', '근무시간', '메모', '등록시각', '월'];
var OPEN_SHIFT_MAX_H = 16;   // 퇴근을 안 찍은 근무는 이 시간까지만 '근무 중'으로 봄

// 실시간 가져오기
var LIVE_MIN_GAP_S = 120;    // BGF 에 이보다 자주 접속하지 않음
var LIVE_TRIGGER_MIN = 10;   // 아무도 안 열어도 이 간격으로 오늘 폐기를 가져옴

/* ======================= 시트 준비 / 메뉴 ======================= */

function setup() {
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);

  var items = ss.getSheetByName(SH_ITEMS) || ss.insertSheet(SH_ITEMS, 0);
  if (items.getMaxColumns() < NCOL) items.insertColumnsAfter(items.getMaxColumns(), NCOL - items.getMaxColumns());
  items.getRange(1, 1, 1, NCOL).setValues([HEADERS]).setFontWeight('bold');
  items.setFrozenRows(1);
  items.getRange('A:F').setNumberFormat('@');
  items.getRange('L:R').setNumberFormat('@');
  items.getRange('G:K').setNumberFormat('#,##0');

  shiftSheet_();

  var mem = ss.getSheetByName(SH_MEMBERS) || ss.insertSheet(SH_MEMBERS);
  if (mem.getLastRow() === 0) {
    mem.getRange(1, 1, 1, 3).setValues([['이름(전체)', '폐기용 이름', '메모']]).setFontWeight('bold');
    mem.getRange(2, 1, 1, 2).setValues([['김성휘', '성휘']]);
    mem.setFrozenRows(1);
  }

  var sum = ss.getSheetByName(SH_SUMMARY) || ss.insertSheet(SH_SUMMARY);
  sum.clear();
  sum.getRange('A1').setValue('월별 합계 (폐기목록 시트에서 자동 계산)').setFontWeight('bold');
  sum.getRange('A3').setFormula(
    "=IFERROR(QUERY({'" + SH_ITEMS + "'!Q2:Q,'" + SH_ITEMS + "'!M2:M,'" + SH_ITEMS + "'!O2:O,'" + SH_ITEMS + "'!N2:N,'" + SH_ITEMS + "'!G2:G,'" + SH_ITEMS + "'!I2:I,'" + SH_ITEMS + "'!K2:K}," +
    "\"select Col1, Col2, Col3, Col4, count(Col5), sum(Col5), sum(Col6), sum(Col7) where Col2 is not null group by Col1, Col2, Col3, Col4 order by Col1 desc, Col2, Col3 " +
    "label Col1 '월', Col2 '구분', Col3 '직원', Col4 '등록이름', count(Col5) '건수', sum(Col5) '수량', sum(Col6) '원가합계', sum(Col7) '매가합계'\", 0), \"아직 등록된 항목이 없어요\")"
  );

  var log = ss.getSheetByName(SH_LOG) || ss.insertSheet(SH_LOG);
  if (log.getLastRow() === 0) {
    log.getRange(1, 1, 1, 5).setValues([['실행시각', '대상 기간', '전표 수', '새 품목', '결과']]).setFontWeight('bold');
    log.setFrozenRows(1);
  }

  var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('시트1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);

  installNightlyTrigger();
  installLiveTrigger();
  return 'ok';
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('취식 관리')
    .addItem('BGF 비밀번호 입력', 'menuSetPassword')
    .addItem('오늘 폐기 지금 가져오기', 'menuLiveNow')
    .addItem('어제 폐기 지금 가져오기', 'nightly')
    .addItem('기간 지정해서 가져오기', 'menuImportRange')
    .addSeparator()
    .addItem('매일 자동 가져오기 켜기', 'installNightlyTrigger')
    .addItem('실시간 가져오기 켜기 (10분마다 + 링크 열 때)', 'menuLiveOn')
    .addItem('실시간 가져오기 끄기', 'menuLiveOff')
    .addSeparator()
    .addItem('개발자 비밀번호 설정', 'menuSetDevPw')
    .addItem('직원 비밀번호 지우기', 'menuClearMemberPw')
    .addToUi();
}

function menuLiveNow() {
  var ui = SpreadsheetApp.getUi();
  var r = liveImport_();
  ui.alert(r.error ? '가져오지 못했어요:\n' + r.error : '오늘 폐기 새 품목 ' + r.added + '건 추가 (' + (r.ms / 1000).toFixed(1) + '초)');
}
function menuLiveOn() {
  PropertiesService.getScriptProperties().deleteProperty('LIVE_OFF');
  installLiveTrigger();
  SpreadsheetApp.getUi().alert('실시간 가져오기를 켰어요. 10분마다, 그리고 직원이 링크를 열 때 (2분에 한 번까지) 오늘 폐기를 가져옵니다.');
}
function menuLiveOff() {
  PropertiesService.getScriptProperties().setProperty('LIVE_OFF', '1');
  removeLiveTrigger_();
  SpreadsheetApp.getUi().alert('실시간 가져오기를 껐어요. 매일 밤 00:01 가져오기는 그대로 돌아갑니다.');
}

function menuSetPassword() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('BGF 점포시스템 비밀번호', '점포 ' + USER_NO + ' 의 비밀번호를 입력하세요. 이 스프레드시트의 스크립트 설정에만 저장됩니다.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var pw = r.getResponseText().trim();
  if (!pw) return;
  PropertiesService.getScriptProperties().setProperty('BGF_PW', pw);
  try {
    var s = bgfLogin_();
    ui.alert('로그인 확인 완료. 이제 매일 자동으로 가져옵니다.');
  } catch (e) {
    ui.alert('비밀번호는 저장했지만 로그인 확인에 실패했어요:\n' + e.message);
  }
}

function menuImportRange() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('기간 지정해서 가져오기', '예: 20261101-20261107  (하루만: 20261105)', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var m = r.getResponseText().replace(/\s/g, '').match(/^(\d{8})(?:-(\d{8}))?$/);
  if (!m) { ui.alert('형식이 맞지 않아요. 예: 20261101-20261107'); return; }
  var res = importRange(m[1], m[2] || m[1]);
  ui.alert(res);
}

function installNightlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'nightly') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('nightly').timeBased().atHour(0).nearMinute(1).everyDays(1).inTimezone(TZ).create();
  return '매일 00:01 무렵 자동 가져오기가 켜졌어요.';
}

function installLiveTrigger() {
  removeLiveTrigger_();
  ScriptApp.newTrigger('liveTick').timeBased().everyMinutes(LIVE_TRIGGER_MIN).create();
  PropertiesService.getScriptProperties().setProperty('LIVE_TRIGGER', '1');
  return LIVE_TRIGGER_MIN + '분마다 오늘 폐기 가져오기가 켜졌어요.';
}
function removeLiveTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'liveTick') ScriptApp.deleteTrigger(t);
  });
  PropertiesService.getScriptProperties().deleteProperty('LIVE_TRIGGER');
}

/** Time trigger: 오늘(과 어제) 폐기 중 새 전표만 가져옴. */
function liveTick() { refreshNow(); }

/* ======================= 매일 가져오기 ======================= */

function nightly() {
  var now = new Date();
  var d1 = ymd_(new Date(now.getTime() - 24 * 3600 * 1000));
  var d2 = ymd_(new Date(now.getTime() - 2 * 24 * 3600 * 1000));
  return importRange(d2, d1);
}

function importThisMonth() {
  var now = new Date();
  var first = Utilities.formatDate(now, TZ, 'yyyyMM') + '01';
  return importRange(first, ymd_(now));
}

function importRange(fromYmd, toYmd) {
  try {
    var r = fetchPyegi_(fromYmd, toYmd);
    var added = appendItems_(r.items);
    var msg = fromYmd + '~' + toYmd + ': 전표 ' + r.chits + '장, 새 품목 ' + added + '건 추가';
    logImport_(fromYmd + '~' + toYmd, r.chits, added, 'OK');
    return msg;
  } catch (e) {
    logImport_(fromYmd + '~' + toYmd, '', '', '실패: ' + e.message);
    try {
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '[직원 취식 목록] 폐기 가져오기 실패',
        fromYmd + '~' + toYmd + ' 폐기 목록을 가져오지 못했어요.\n\n' + e.message +
        '\n\n스프레드시트 메뉴 [취식 관리 > 기간 지정해서 가져오기]로 다시 시도할 수 있어요.');
    } catch (e2) {}
    throw e;
  }
}

function appendItems_(items) {
  if (!items.length) return 0;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(SH_ITEMS);
    var n = sh.getLastRow() - 1;
    var have = {};
    if (n > 0) sh.getRange(2, 1, n, 1).getValues().forEach(function (r) { have[r[0]] = 1; });
    var rows = items.filter(function (it) { return !have[it.key]; })
      .sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : (a.key < b.key ? -1 : 1); })
      .map(function (it) {
        return [it.key, it.date, it.time, it.name, it.code, it.cat, it.qty, it.wprice, it.wamt, it.mprice, it.mamt, it.chit, '', '', '', '', it.date.slice(0, 7), ''];
      });
    if (rows.length) {
      sh.getRange(n + 2, 1, rows.length, NCOL).setValues(rows);
      bumpVersion_();
    }
    return rows.length;
  } finally {
    lock.releaseLock();
  }
}

/* ======================= 실시간 가져오기 (오늘 폐기) ======================= */

/**
 * Called by the page on open / every few minutes, and by the 10-minute trigger.
 * Hits BGF at most once per LIVE_MIN_GAP_S across all callers; otherwise returns at once.
 */
function refreshNow() {
  var p = PropertiesService.getScriptProperties();
  var props = p.getProperties();
  if (props.LIVE_OFF === '1') return liveInfo_(props, 0);
  if (props.LIVE_TRIGGER !== '1') { try { installLiveTrigger(); } catch (e) {} }
  if (Date.now() - Number(props.LIVE_AT || 0) < LIVE_MIN_GAP_S * 1000) return liveInfo_(props, 0);
  var cache = CacheService.getScriptCache();
  if (cache.get('live_running')) return liveInfo_(props, 0);
  cache.put('live_running', '1', 90);
  var r;
  try { r = liveImport_(); } finally { cache.remove('live_running'); }
  return liveInfo_(p.getProperties(), r.added);
}

/** Fetch yesterday..today, only slips we don't have yet. Never throws. */
function liveImport_() {
  var p = PropertiesService.getScriptProperties();
  var t0 = Date.now();
  p.setProperty('LIVE_AT', String(t0));
  var now = new Date(t0);
  var from = ymd_(new Date(t0 - 24 * 3600 * 1000)), to = ymd_(now);
  try {
    var r = fetchPyegi_(from, to, knownChits_());
    var added = appendItems_(r.items);
    var ms = Date.now() - t0;
    p.setProperties({ LIVE_OK_AT: String(t0), LIVE_MS: String(ms), LIVE_ERR: '' });
    if (added) logImport_(from + '~' + to + ' (실시간)', r.chits, added, 'OK · ' + (ms / 1000).toFixed(1) + '초, 상세 ' + r.fetched + '장');
    return { added: added, ms: ms };
  } catch (e) {
    var msg = String(e && e.message || e).slice(0, 200);
    if (!p.getProperty('LIVE_ERR')) logImport_(from + '~' + to + ' (실시간)', '', '', '실패: ' + msg);
    p.setProperty('LIVE_ERR', msg);
    return { added: 0, ms: Date.now() - t0, error: msg };
  }
}

function liveInfo_(props, added) {
  var ok = Number(props.LIVE_OK_AT || 0);
  var label = '';
  if (ok) {
    var d = new Date(ok);
    label = Utilities.formatDate(d, TZ, 'yyyy-MM-dd') === Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd')
      ? Utilities.formatDate(d, TZ, 'HH:mm') : Utilities.formatDate(d, TZ, 'M/d HH:mm');
  }
  return { label: label, off: props.LIVE_OFF === '1', error: props.LIVE_ERR ? true : false, added: added || 0 };
}

/** { CHIT_NO: number of lines already in the sheet } */
function knownChits_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH_ITEMS);
  var n = sh.getLastRow() - 1, out = {};
  if (n > 0) sh.getRange(2, C.CHIT, n, 1).getDisplayValues().forEach(function (r) { if (r[0]) out[r[0]] = (out[r[0]] || 0) + 1; });
  return out;
}

function logImport_(range, chits, added, result) {
  var log = SpreadsheetApp.getActive().getSheetByName(SH_LOG);
  if (log) log.appendRow([Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'), range, chits, added, result]);
}

/* ======================= BGF 점포시스템 통신 (Nexacro SSV) ======================= */

var RS = '\x1e', US = '\x1f';
var SS_VARS = [
  ['SS_STORE_CD', STORE_CD], ['SS_PRE_STORE_CD', '160081'], ['SS_STORE_NM', '7Jq47IKw65GY66as7KCQ'], ['SS_SLC_CD', ''],
  ['SS_LOC_CD', '02'], ['SS_ADM_SECT_CD', '31140'], ['SS_STORE_OWNER_NM', '7KO87ZiE7KCV'], ['SS_STORE_POS_QTY', '2'],
  ['SS_STORE_IP', '10.126.178.1'], ['SS_SV_EMP_NO', '1213170'], ['SS_SSTORE_ID', ''], ['SS_RCV_ID', '1'], ['SS_FC_CD', 'P2'],
  ['SS_USER_GRP_ID', '0001'], ['SS_USER_NO', USER_NO], ['SS_SGGD_CD', '31140540'], ['SS_LOGIN_USER_NO', USER_NO]
];

function ssvBuild_(vars, dsName, cols, row) {
  var p = ['SSV:utf-8'];
  vars.forEach(function (kv) { p.push(kv[0] + '=' + kv[1]); });
  p.push('Dataset:' + dsName);
  p.push(['_RowType_'].concat(cols.map(function (c) { return c + ':STRING(256)'; })).join(US));
  p.push(['N'].concat(row).join(US));
  p.push('');
  return p.join(RS) + RS;
}

function ssvParse_(text) {
  var recs = String(text).split(RS);
  var out = { vars: {}, ds: {} };
  var cur = null, cols = null;
  for (var i = 1; i < recs.length; i++) {
    var rec = recs[i];
    if (rec.indexOf('Dataset:') === 0) { cur = rec.slice(8); out.ds[cur] = []; cols = null; continue; }
    if (cur === null) {
      var eq = rec.indexOf('=');
      if (eq > 0) out.vars[rec.slice(0, eq).split(':')[0]] = rec.slice(eq + 1);
      continue;
    }
    if (rec === '') { cur = null; continue; }
    if (rec.indexOf('_RowType_') === 0) { cols = rec.split(US).slice(1).map(function (c) { return c.split(':')[0]; }); continue; }
    if (rec.indexOf('_Const') === 0 || !cols) continue;
    var f = rec.split(US), o = {};
    for (var k = 0; k < cols.length; k++) { var v = f[k + 1]; o[cols[k]] = (v === undefined || v === '\x03') ? '' : v; }
    out.ds[cur].push(o);
  }
  return out;
}

function Session_() { this.jar = {}; SS_VARS.forEach(function (kv) { if (kv[1]) this.jar[kv[0]] = kv[1]; }, this); this.jar.GV_USERFLAG = 'HOME'; }
Session_.prototype.cookie = function () {
  var j = this.jar;
  return Object.keys(j).map(function (k) { return k + '=' + j[k]; }).join('; ');
};
Session_.prototype.take = function (resp) {
  var h = resp.getAllHeaders();
  var sc = h['Set-Cookie'] || h['set-cookie'];
  if (!sc) return;
  if (!Array.isArray(sc)) sc = [sc];
  var j = this.jar;
  sc.forEach(function (c) { var kv = String(c).split(';')[0]; var i = kv.indexOf('='); if (i > 0) j[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); });
};
Session_.prototype.get = function (path) {
  var resp = UrlFetchApp.fetch(BASE + path, { method: 'get', muteHttpExceptions: true, followRedirects: true, headers: { Cookie: this.cookie() } });
  this.take(resp);
  return resp;
};
Session_.prototype.post = function (path, body) {
  var resp = UrlFetchApp.fetch(BASE + path, {
    method: 'post', contentType: 'text/xml; charset=UTF-8', payload: Utilities.newBlob(body, 'text/xml').getBytes(),
    muteHttpExceptions: true, followRedirects: false,
    headers: {
      'Cookie': this.cookie(), 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/xml, text/xml, */*',
      'Referer': BASE + '/websrc/deploy/index.html', 'Origin': BASE, 'Cache-Control': 'no-cache, no-store', 'Pragma': 'no-cache'
    }
  });
  this.take(resp);
  var code = resp.getResponseCode();
  if (code !== 200) throw new Error(path + ' 응답 ' + code);
  var parsed = ssvParse_(resp.getContentText('UTF-8'));
  if (parsed.vars.ErrorCode !== undefined && parsed.vars.ErrorCode !== '0') {
    throw new Error(path + ' 오류: ' + (parsed.vars.ErrorMsg || parsed.vars.ErrorCode));
  }
  return parsed;
};

function bgfLogin_() {
  var pw = PropertiesService.getScriptProperties().getProperty('BGF_PW');
  if (!pw) throw new Error('BGF 비밀번호가 아직 없어요. 메뉴 [취식 관리 > BGF 비밀번호 입력]에서 넣어 주세요.');
  var s = new Session_();
  s.get('/websrc/deploy/index.html');
  var vars = [['GV_USERFLAG', 'HOME']].concat(SS_VARS).concat([
    ['USER_TYPE', '1'], ['CONN_PLACE', 'HOME'], ['GV_CHANNELTYPE', 'HOME'], ['LOGIN_STORE', ''], ['MULTI_YN', 'N'],
    ['RUNTIME_YN', '(일반)'], ['MULTI_STORE_TYPE', 'A'], ['PILOT_GROUP_YN', 'N'], ['PILOT_CONNECT_YN', 'N'],
    ['SC_AUTO_LOGIN_YN', 'undefined'],
    ['POS_ONE_MENU_LIST', 'STCM020_M0,STMS190_M0,STJS050_M1,STCM120_M0,STCM300_M0,STMB810_M0,STMB800_M0,STMB510_M0,STMB530_M0,STMB520_M0,STGJ300_M0'],
    ['GV_USERFLAG', 'HOME'], ['GV_CHANNELTYPE', 'HOME']
  ]);
  var body = ssvBuild_(vars, 'ds_login',
    ['USER_NO', 'PASSWD', 'USER_GRP_ID', 'GV_POSPARAM1', 'GV_POSPARAM2', 'GV_POSPARAM3', 'GV_POSPARAM4'],
    [USER_NO, pw, '0001', '', '', '', '']);
  var r = s.post('/login/login', body);
  var msg = (r.ds.GDS_MSG || [])[0];
  if (!r.ds.GDS_JUMPO || !r.ds.GDS_JUMPO.length) {
    throw new Error('로그인 실패' + (msg ? ': ' + (msg.MSG_CONT || JSON.stringify(msg)) : ''));
  }
  return s;
}

function svcVars_() {
  return [['GV_USERFLAG', 'HOME']].concat(SS_VARS).concat([
    ['GV_MENU_ID', '0001,STGJ020_M0'], ['GV_USERFLAG', 'HOME'], ['GV_CHANNELTYPE', 'HOME']
  ]);
}

/**
 * known (optional): { CHIT_NO: lines already imported }. A slip is skipped when we already have
 * at least ITEM_CNT lines of it, so a live refresh only downloads details for new slips.
 * The nightly import passes nothing and re-reads every slip (safety net).
 */
function fetchPyegi_(fromYmd, toYmd, known) {
  var s = bgfLogin_();
  var list = s.post('/stgj020/search', ssvBuild_(svcVars_(), 'dsSearch',
    ['strDate', 'strStoreCd', 'strChitDiv', 'strChitNo', 'strChitYmd', 'strToDt', 'strFromDt'],
    ['', STORE_CD, '10', '', '', toYmd, fromYmd]));
  var chits = (list.ds.dsList || []).filter(function (c) { return c.CHIT_NO; });
  var meta = {};
  chits.forEach(function (c) { meta[c.CHIT_NO] = c; });
  var todo = chits.filter(function (c) {
    var cnt = Number(c.ITEM_CNT), have = known ? (known[c.CHIT_NO] || 0) : 0;
    return !(cnt > 0 && have >= cnt);
  });

  // group by (date, chit id, flag) so each detail call matches what the site sends
  var groups = {};
  todo.forEach(function (c) {
    var g = c.CHIT_YMD + '|' + c.CHIT_ID + '|' + c.CHIT_FLAG;
    (groups[g] = groups[g] || []).push(c.CHIT_NO);
  });

  var items = [];
  Object.keys(groups).forEach(function (g) {
    var parts = g.split('|'), ymd = parts[0], chitId = parts[1], flag = parts[2];
    var svc = flag === 'PA' ? 'searchDetailType0' : 'searchDetailType1';
    var nos = groups[g];
    for (var i = 0; i < nos.length; i += 40) {
      var chunk = nos.slice(i, i + 40);
      var r = s.post('/stgj020/' + svc, ssvBuild_(svcVars_(), 'dsSearch',
        ['strChitDiv', 'strChitNo', 'strChitNoList', 'strChitYmd', 'strStoreCd'],
        [chitId, '', "('" + chunk.join("','") + "')", ymd, STORE_CD]));
      var rows = [];
      Object.keys(r.ds).forEach(function (k) { if (/^dsListType/.test(k)) rows = rows.concat(r.ds[k]); });
      rows.forEach(function (d) {
        if (!d.CHIT_NO || !d.ITEM_NM) return;
        var m = meta[d.CHIT_NO] || {};
        var cre = String(m.CRE_YMDHMS || (ymd + '000000'));
        var cy = String(m.CHIT_YMD || ymd);
        items.push({
          key: d.CHIT_NO + '-' + (d.CHIT_SEQ || ''),
          date: cy.slice(0, 4) + '-' + cy.slice(4, 6) + '-' + cy.slice(6, 8),
          time: cre.slice(0, 4) + '-' + cre.slice(4, 6) + '-' + cre.slice(6, 8) + ' ' + cre.slice(8, 10) + ':' + cre.slice(10, 12) + ':' + cre.slice(12, 14),
          name: d.ITEM_NM, code: d.ITEM_CD || '', cat: d.LARGE_NM || '',
          qty: Number(d.QTY) || 0, wprice: Number(d.WONGA_PRICE) || 0, wamt: Number(d.WONGA_AMT) || 0,
          mprice: Number(d.MAEGA_PRICE) || 0, mamt: Number(d.MAEGA_AMT) || 0, chit: d.CHIT_NO
        });
      });
    }
  });
  return { chits: chits.length, fetched: todo.length, items: items };
}

function ymd_(d) { return Utilities.formatDate(d, TZ, 'yyyyMMdd'); }

/* ======================= 웹앱 ======================= */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('직원 취식 목록')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function bumpVersion_() {
  var p = PropertiesService.getScriptProperties();
  var v = String(Date.now());
  p.setProperty('VER', v);
  CacheService.getScriptCache().removeAll(['members']);
  return v;
}
function version_() { return PropertiesService.getScriptProperties().getProperty('VER') || '0'; }

/* 직원 columns: A 이름(전체), B 폐기용 이름, C 메모, D 비밀번호(암호) — D holds a salted hash, never the password */
var MC = { FULL: 1, SHORT: 2, MEMO: 3, PW: 4 };
var PW_HEADER = '비밀번호(암호)';
var AUTH_TAG = '[비밀번호]';

function memberRows_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH_MEMBERS);
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, 4).getDisplayValues().map(function (r, i) {
    var full = String(r[0]).trim();
    return { row: i + 2, full: full, short: String(r[1]).trim() || shortName_(full), pw: String(r[3]).trim() };
  }).filter(function (m) { return m.full; });
}
function members_() {
  return memberRows_().map(function (m) { return { full: m.full, short: m.short, hasPw: !!m.pw }; });
}
function memberRow_(full) {
  var m = null;
  memberRows_().forEach(function (x) { if (x.full === full) m = x; });
  if (!m) throw new Error('직원 목록에 없는 이름이에요. 이름을 다시 골라 주세요.');
  return m;
}

/* ---------- 비밀번호 ---------- */

function secret_(name) {
  var p = PropertiesService.getScriptProperties();
  var v = p.getProperty(name);
  if (!v) { v = Utilities.getUuid() + Utilities.getUuid(); p.setProperty(name, v); }
  return v;
}
function b64_(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ''); }
function pwHash_(full, pw) {
  return b64_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, secret_('PW_SALT') + '|' + full + '|' + pw, Utilities.Charset.UTF_8));
}
function devHash_(pw) {
  return b64_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, secret_('PW_SALT') + '|개발자|' + pw, Utilities.Charset.UTF_8));
}
/** Changes whenever the member's password changes, so old phones must log in again. */
function token_(m) {
  return m.pw ? b64_(Utilities.computeHmacSha256Signature(m.full + '|' + m.pw, secret_('TOKEN_KEY'))).slice(0, 32) : '';
}
/** The acting worker. Throws AUTH_TAG error when their password is set and the token is missing or old. */
function authMember_(full, token) {
  var m = memberRow_(full);
  if (m.pw && String(token || '') !== token_(m)) throw new Error(AUTH_TAG + ' ' + m.full + ' 님 비밀번호를 다시 입력해 주세요.');
  return { full: m.full, short: m.short };
}

/** Password check. The developer password (Script Property DEV_PW_HASH) opens any name. */
function login(full, pw) {
  var m = memberRow_(full);
  if (!m.pw) return { token: '' };
  pw = String(pw || '');
  var cache = CacheService.getScriptCache();
  var ck = 'pwfail_' + b64_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, m.full, Utilities.Charset.UTF_8));
  var fails = Number(cache.get(ck) || 0);
  if (fails >= 5) throw new Error('비밀번호를 여러 번 틀렸어요. 10분 뒤에 다시 해 주세요.');
  var dev = PropertiesService.getScriptProperties().getProperty('DEV_PW_HASH');
  if (pw && (pwHash_(m.full, pw) === m.pw || (dev && devHash_(pw) === dev))) {
    cache.remove(ck);
    return { token: token_(m) };
  }
  cache.put(ck, String(fails + 1), 600);
  var left = 5 - fails - 1;
  if (left <= 0) throw new Error('비밀번호를 5번 틀려서 10분 동안 이 이름을 쓸 수 없어요.');
  throw new Error('비밀번호가 맞지 않아요.' + (left <= 2 ? ' (' + left + '번 남음)' : ''));
}

/** Set, change or remove ('') your own password. Needs your current token when one is set. */
function setPassword(full, token, newPw) {
  authMember_(full, token);
  newPw = String(newPw || '');
  if (newPw && (newPw.length < 4 || newPw.length > 30)) throw new Error('비밀번호는 4~30자로 해 주세요.');
  return withLock_(function () {
    var sh = SpreadsheetApp.getActive().getSheetByName(SH_MEMBERS);
    var m = memberRow_(full);
    if (sh.getRange(1, MC.PW).getDisplayValue() !== PW_HEADER) sh.getRange(1, MC.PW).setValue(PW_HEADER).setFontWeight('bold');
    m.pw = newPw ? pwHash_(m.full, newPw) : '';
    sh.getRange(m.row, MC.PW).setNumberFormat('@').setValue(m.pw);
    bumpVersion_();
    return { token: token_(m), members: members_() };
  });
}

function menuSetDevPw() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('개발자 비밀번호', '이 비밀번호는 웹앱에서 어느 직원 이름의 비밀번호 대신 쓸 수 있어요. 비우면 개발자 비밀번호를 없애요.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var pw = r.getResponseText().trim();
  var p = PropertiesService.getScriptProperties();
  if (pw) { p.setProperty('DEV_PW_HASH', devHash_(pw)); ui.alert('개발자 비밀번호를 저장했어요.'); }
  else { p.deleteProperty('DEV_PW_HASH'); ui.alert('개발자 비밀번호를 없앴어요.'); }
}
function menuClearMemberPw() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('직원 비밀번호 지우기', '비밀번호를 지울 직원의 전체 이름 (예: 김성휘)', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  try {
    var m = memberRow_(r.getResponseText().trim());
    SpreadsheetApp.getActive().getSheetByName(SH_MEMBERS).getRange(m.row, MC.PW).setValue('');
    bumpVersion_();
    ui.alert(m.full + ' 님 비밀번호를 지웠어요. 이제 비밀번호 없이 쓸 수 있어요.');
  } catch (e) { ui.alert(e.message); }
}
function shortName_(full) {
  full = String(full).trim();
  var two = ['남궁', '황보', '제갈', '사공', '선우', '서문', '독고', '동방'];
  if (full.length >= 4 && two.indexOf(full.slice(0, 2)) >= 0) return full.slice(2);
  return full.length >= 2 ? full.slice(1) : full;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/** me/token: the name this phone remembers; meOk = false means it must enter the password again. */
function getInit(me, token) {
  var meOk = true;
  if (me) { try { authMember_(me, token); } catch (e) { meOk = String(e.message).indexOf(AUTH_TAG) < 0; } }
  var out = getInitData_();
  out.meOk = meOk;
  return out;
}
function getInitData_() {
  var ss = SpreadsheetApp.getActive();
  var months = {};
  [[ss.getSheetByName(SH_ITEMS), C.MONTH], [ss.getSheetByName(SH_SHIFTS), SC.MONTH]].forEach(function (p) {
    var sh = p[0];
    var n = sh ? sh.getLastRow() - 1 : 0;
    if (n > 0) sh.getRange(2, p[1], n, 1).getDisplayValues().forEach(function (r) { if (r[0]) months[r[0]] = 1; });
  });
  var list = Object.keys(months).sort().reverse();
  var cur = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  if (list.indexOf(cur) < 0) list.unshift(cur);
  return { members: members_(), months: list, version: version_(), live: liveInfo_(PropertiesService.getScriptProperties().getProperties(), 0) };
}

/** month: 'yyyy-MM'. Returns null when the caller already has this version. */
function getMonth(month, knownVersion) {
  var v = version_();
  if (knownVersion && knownVersion === v) return null;
  var sh = SpreadsheetApp.getActive().getSheetByName(SH_ITEMS);
  var n = sh.getLastRow() - 1;
  var rows = [];
  if (n > 0) {
    var vals = sh.getRange(2, 1, n, NCOL).getDisplayValues();
    var nums = sh.getRange(2, C.QTY, n, 5).getValues();
    for (var i = 0; i < vals.length; i++) {
      var r = vals[i];
      if (r[C.MONTH - 1] !== month) continue;
      rows.push([i + 2, r[C.KEY - 1], r[C.TIME - 1] || r[C.DATE - 1], r[C.NAME - 1], Number(nums[i][0]) || 0,
        Number(nums[i][1]) || 0, Number(nums[i][2]) || 0, Number(nums[i][4]) || 0, r[C.TYPE - 1], r[C.MEMBER - 1], r[C.WHO - 1], r[C.DATE - 1], r[C.NOTE - 1]]);
    }
  }
  var all = readShifts_();
  return { version: v, month: month, rows: rows, shifts: shiftsFor_(month, all), usual: usualShifts_(all), members: members_() };
}

/**
 * type: '취식' | '폐기' | '' (clear). memberFull: whose tag to write (전체 이름).
 * note: '근무외' when the worker confirmed a 폐기 outside their recorded shift (kept only for 폐기).
 * me/token: who is acting. Writing someone else's name is only allowed to undo your own change
 * (the row must currently be yours or empty).
 */
function setTag(rowHint, key, type, memberFull, month, note, me, token) {
  if (['취식', '폐기', ''].indexOf(type) < 0) throw new Error('bad type');
  var actor = authMember_(me || memberFull, token);
  var mem = type ? (memberFull === actor.full ? actor : memberRow_(memberFull)) : null;
  note = type === '폐기' && note === OFFSHIFT_NOTE ? OFFSHIFT_NOTE : '';
  withLock_(function () {
    var sh = SpreadsheetApp.getActive().getSheetByName(SH_ITEMS);
    var row = Number(rowHint);
    if (!(row >= 2 && row <= sh.getLastRow() && sh.getRange(row, C.KEY).getDisplayValue() === key)) {
      var f = sh.getRange('A:A').createTextFinder(key).matchEntireCell(true).findNext();
      if (!f) throw new Error('항목을 찾지 못했어요. 새로고침해 주세요.');
      row = f.getRow();
    }
    if (mem && mem.full !== actor.full) {
      var curMember = sh.getRange(row, C.MEMBER).getDisplayValue();
      if (curMember && curMember !== actor.full) throw new Error('다른 직원 이름으로는 등록할 수 없어요.');
    }
    var rng = sh.getRange(row, C.TYPE, 1, 4);
    if (type) {
      var who = type === '취식' ? mem.full : mem.short;
      rng.setValues([[type, who, mem.full, Utilities.formatDate(new Date(), TZ, 'MM/dd HH:mm')]]);
    } else {
      rng.clearContent();
    }
    if (note && sh.getRange(1, C.NOTE).getDisplayValue() !== HEADERS[C.NOTE - 1]) {
      sh.getRange(1, C.NOTE).setValue(HEADERS[C.NOTE - 1]).setFontWeight('bold');
    }
    sh.getRange(row, C.NOTE).setValue(note);
    bumpVersion_();
  });
  return getMonth(month || '', '');
}

/* ======================= 출근일지 ======================= */

function shiftSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SH_SHIFTS);
  if (!sh) {
    sh = ss.insertSheet(SH_SHIFTS);
    sh.getRange(1, 1, 1, SNCOL).setValues([SHIFT_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:E').setNumberFormat('@');
    sh.getRange('G:I').setNumberFormat('@');
    sh.getRange('F:F').setNumberFormat('0.00');
  }
  return sh;
}

/** minutes on a time line where 'yyyy-MM-dd' + 'HH:mm' is read as written (KST) */
function toMin_(date, hhmm) {
  return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +hhmm.slice(0, 2), +hhmm.slice(3, 5)) / 60000;
}
function nowMin_() {
  var now = new Date();
  return toMin_(Utilities.formatDate(now, TZ, 'yyyy-MM-dd'), Utilities.formatDate(now, TZ, 'HH:mm'));
}
/** [startMin, endMin or null] — 퇴근 earlier than 출근 means the next day */
function shiftSpan_(s) {
  var a = toMin_(s.date, s.start);
  if (!s.end) return [a, null];
  var b = toMin_(s.date, s.end);
  if (b < a) b += 1440;
  return [a, b];
}

function readShifts_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH_SHIFTS);
  var n = sh ? sh.getLastRow() - 1 : 0;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, SNCOL).getDisplayValues().map(function (r, i) {
    return { row: i + 2, key: r[SC.KEY - 1], date: r[SC.DATE - 1], member: r[SC.MEMBER - 1], start: r[SC.START - 1], end: r[SC.END - 1], memo: r[SC.MEMO - 1] };
  }).filter(function (s) { return s.key && /^\d{4}-\d\d-\d\d$/.test(s.date) && /^\d\d:\d\d$/.test(s.start); });
}

/** Shifts that start in the month, plus the last day of the month before (overnight shifts). */
function shiftsFor_(month, all) {
  if (!/^\d{4}-\d\d$/.test(month)) return [];
  var prev = Utilities.formatDate(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1, 1) - 12 * 3600 * 1000), 'UTC', 'yyyy-MM-dd');
  var last = month + '-31';
  return (all || readShifts_()).filter(function (s) { return s.date >= prev && s.date <= last; })
    .map(function (s) { return [s.row, s.key, s.date, s.member, s.start, s.end, s.memo]; });
}

/**
 * Most frequent (출근, 퇴근) pair per worker over the last 90 days, used as the default when
 * entering a shift by hand. '*' = everyone. Ties go to the most recent shift.
 */
function usualShifts_(all) {
  var since = Utilities.formatDate(new Date(Date.now() - 90 * 24 * 3600 * 1000), TZ, 'yyyy-MM-dd');
  var cnt = {}, out = {};
  all.forEach(function (s) {
    if (!s.end || s.date < since) return;
    [s.member, '*'].forEach(function (who) {
      var k = s.start + '|' + s.end;
      var c = cnt[who] = cnt[who] || {};
      var o = c[k] = c[k] || { n: 0, last: '' };
      o.n++; if (s.date > o.last) o.last = s.date;
    });
  });
  Object.keys(cnt).forEach(function (who) {
    var best = null, bk = '';
    Object.keys(cnt[who]).forEach(function (k) {
      var o = cnt[who][k];
      if (!best || o.n > best.n || (o.n === best.n && o.last > best.last)) { best = o; bk = k; }
    });
    out[who] = bk.split('|');
  });
  return out;
}

function openShiftOf_(all, member, nowM) {
  var best = null;
  all.forEach(function (s) {
    if (s.member !== member || s.end) return;
    var a = shiftSpan_(s)[0];
    if (a <= nowM + 5 && nowM - a < OPEN_SHIFT_MAX_H * 60 && (!best || a > shiftSpan_(best)[0])) best = s;
  });
  return best;
}

function overlapOf_(all, member, a, b, skipKey, nowM) {
  var hit = null;
  all.forEach(function (s) {
    if (hit || s.member !== member || s.key === skipKey) return;
    var sp = shiftSpan_(s);
    var e = sp[1] !== null ? sp[1] : Math.max(sp[0] + 1, Math.min(nowM, sp[0] + OPEN_SHIFT_MAX_H * 60));
    var bb = b !== null ? b : a + 1;
    if (sp[0] < bb && a < e) hit = s;
  });
  return hit;
}

function shiftHours_(date, start, end) {
  if (!end) return '';
  var sp = shiftSpan_({ date: date, start: start, end: end });
  return Math.round((sp[1] - sp[0]) / 60 * 100) / 100;
}

function writeShift_(sh, row, s) {
  sh.getRange(row, 1, 1, SNCOL).setValues([[s.key, s.date, s.member, s.start, s.end || '', shiftHours_(s.date, s.start, s.end),
    s.memo || '', Utilities.formatDate(new Date(), TZ, 'MM/dd HH:mm'), s.date.slice(0, 7)]]);
}

function clockIn(memberFull, month, token) {
  var mem = authMember_(memberFull, token);
  withLock_(function () {
    var sh = shiftSheet_();
    var all = readShifts_(), nowM = nowMin_(), now = new Date();
    var open = openShiftOf_(all, mem.full, nowM);
    if (open) throw new Error('이미 ' + open.start + '에 출근했어요. 끝났으면 [퇴근]을 눌러 주세요.');
    var hit = overlapOf_(all, mem.full, nowM, null, '', nowM);
    if (hit) throw new Error('지금 시간이 이미 근무 기록(' + hit.start + '–' + hit.end + ') 안에 있어요.');
    writeShift_(sh, sh.getLastRow() + 1, {
      key: 's' + now.getTime().toString(36) + Math.floor(Math.random() * 1296).toString(36),
      date: Utilities.formatDate(now, TZ, 'yyyy-MM-dd'), member: mem.full, start: Utilities.formatDate(now, TZ, 'HH:mm'), end: '', memo: ''
    });
    bumpVersion_();
  });
  return getMonth(month || '', '');
}

function clockOut(memberFull, month, token) {
  var mem = authMember_(memberFull, token);
  withLock_(function () {
    var sh = shiftSheet_();
    var all = readShifts_(), nowM = nowMin_();
    var open = openShiftOf_(all, mem.full, nowM);
    if (!open) throw new Error('지금 출근 중인 기록이 없어요. [직접 입력]으로 적어 주세요.');
    open.end = Utilities.formatDate(new Date(), TZ, 'HH:mm');
    writeShift_(sh, open.row, open);
    bumpVersion_();
  });
  return getMonth(month || '', '');
}

/** key '' = new. end '' = still working. */
function saveShift(key, date, memberFull, start, end, memo, month, token) {
  var mem = authMember_(memberFull, token);
  date = String(date || ''); start = String(start || '').slice(0, 5); end = String(end || '').slice(0, 5);
  memo = String(memo || '').replace(/^[=+\-@]+/, '').trim().slice(0, 40);
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) throw new Error('날짜를 골라 주세요.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) throw new Error('출근 시간을 적어 주세요.');
  if (end && !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) throw new Error('퇴근 시간이 이상해요.');
  if (end && end === start) throw new Error('출근과 퇴근 시간이 같아요.');
  var nowM = nowMin_();
  var a = toMin_(date, start);
  if (a > nowM + 60) throw new Error('아직 오지 않은 시간은 적을 수 없어요.');
  var b = end ? shiftSpan_({ date: date, start: start, end: end })[1] : null;
  if (!end && nowM - a >= OPEN_SHIFT_MAX_H * 60) throw new Error('지난 근무는 퇴근 시간도 적어 주세요.');
  if (!end && a > nowM + 5) throw new Error('퇴근을 비워 두려면 출근 시간이 지금보다 앞이어야 해요.');
  withLock_(function () {
    var sh = shiftSheet_();
    var all = readShifts_();
    var cur = null;
    if (key) {
      all.forEach(function (s) { if (s.key === key) cur = s; });
      if (!cur) throw new Error('기록을 찾지 못했어요. 새로고침해 주세요.');
      if (cur.member !== mem.full) throw new Error('다른 직원의 기록은 고칠 수 없어요.');
    }
    var hit = overlapOf_(all, mem.full, a, b, key, nowM);
    if (hit) throw new Error(hit.date.slice(5).replace('-', '/') + ' ' + hit.start + (hit.end ? '–' + hit.end : '') + ' 기록과 겹쳐요.');
    if (!end && openShiftOf_(all.filter(function (s) { return s.key !== key; }), mem.full, nowM)) {
      throw new Error('이미 출근 중인 기록이 있어요. 퇴근 시간을 적어 주세요.');
    }
    var s = { key: key || 's' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), date: date, member: mem.full, start: start, end: end, memo: memo };
    writeShift_(sh, cur ? cur.row : sh.getLastRow() + 1, s);
    bumpVersion_();
  });
  return getMonth(month || '', '');
}

function deleteShift(key, memberFull, month, token) {
  var mem = authMember_(memberFull, token);
  withLock_(function () {
    var sh = shiftSheet_();
    var cur = null;
    readShifts_().forEach(function (s) { if (s.key === key) cur = s; });
    if (!cur) throw new Error('기록을 찾지 못했어요. 새로고침해 주세요.');
    if (cur.member !== mem.full) throw new Error('다른 직원의 기록은 지울 수 없어요.');
    sh.deleteRow(cur.row);
    bumpVersion_();
  });
  return getMonth(month || '', '');
}

function addMember(full) {
  full = String(full || '').replace(/[=+\-@'"<>]/g, '').trim().slice(0, 10);
  if (full.length < 2) throw new Error('이름을 두 글자 이상 적어 주세요.');
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var exists = members_().some(function (m) { return m.full === full; });
    if (!exists) {
      SpreadsheetApp.getActive().getSheetByName(SH_MEMBERS).appendRow([full, shortName_(full), '웹에서 추가']);
      bumpVersion_();
    }
  } finally {
    lock.releaseLock();
  }
  return members_();
}
