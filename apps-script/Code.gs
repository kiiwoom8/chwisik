/**
 * 직원 취식 목록
 * - 매일 00:01 무렵 BGF 점포시스템에서 어제(와 그제) 폐기 전표를 가져와 '폐기목록' 시트에 추가
 * - 낮에도 오늘 폐기를 바로 가져옴: 링크가 열려 있으면 1분마다 + 아무도 안 열어도 5분마다 자동
 * - 웹앱: 직원이 자기 이름을 한 번 고르고, 품목마다 [취식] / [폐기] 를 한 번 눌러 등록
 *   취식 → 전체 이름(김성휘), 폐기 → 이름만(성휘)
 * - 출근일지: [출근] / [퇴근] 한 번 누르거나 직접 입력. 다른 직원 근무 시간도 날짜별로 보임
 *   근무 기록 밖 시간의 폐기를 등록하면 확인을 받고, '확인' 열에 '근무외' 로 남김
 * - 월별 합계: '월별 합계' 시트와 웹앱에서 확인 (웹앱은 근무시간 합계도)
 * - 저회전상품철수 전표도 폐기와 똑같이 가져옴 ('전표' 열 = '저회전'). 취식으로만 등록할 수 있고,
 *   등록 안 해도 됨 (미등록에 안 셈). 폐기로는 등록할 수 없음.
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
var C = { KEY: 1, DATE: 2, TIME: 3, NAME: 4, CODE: 5, CAT: 6, QTY: 7, WPRICE: 8, WAMT: 9, MPRICE: 10, MAMT: 11, CHIT: 12, TYPE: 13, WHO: 14, MEMBER: 15, AT: 16, MONTH: 17, NOTE: 18, SRC: 19 };
var NCOL = 19;
var HEADERS = ['키', '일자', '생성시각', '품명', '상품코드', '분류', '수량', '원가단가', '원가금액', '매가단가', '매가금액', '전표번호', '구분', '등록이름', '직원', '등록시각', '월', '확인', '전표'];
var OFFSHIFT_NOTE = '근무외';

// 가져오는 전표 종류. SRC 열: 폐기 = '' (비어 있음), 저회전상품철수 = '저회전'
var PYEGI_DIV = '10';          // 통합전표 조회 전표구분 (공통코드 S312) 10 = 폐기
var JEO = '저회전';
var JEO_CHIT_ID = '24';        // 목록의 CHIT_ID 24 = 저회전상품철수전표 (STGJ020_P1)
var CHIT_DIV_CODE = 'S312';    // 전표구분 공통코드 (/stco010/selComCd)

// 출근일지 columns (1-based). 퇴근이 출근보다 이르면 다음 날 퇴근.
var SC = { KEY: 1, DATE: 2, MEMBER: 3, START: 4, END: 5, HOURS: 6, MEMO: 7, AT: 8, MONTH: 9 };
var SNCOL = 9;
var SHIFT_HEADERS = ['키', '날짜', '직원', '출근', '퇴근', '근무시간', '메모', '등록시각', '월'];
var OPEN_SHIFT_MAX_H = 16;   // 퇴근을 안 찍은 근무는 이 시간까지만 '근무 중'으로 봄
var SLOT_MIN = 30;           // 출근/퇴근 버튼 시간은 가까운 30분으로 맞춤 (가게는 30분 단위로 셈)
var HANDOVER_MIN = 30;       // 앞 사람 퇴근 뒤 30분 안에 출근하면 그 퇴근 시간으로 (교대, 빈 시간 없음)
var AUTO_OUT_MIN_H = 1;      // 다음 사람 출근 때 1시간 넘게 근무 중인 사람은 자동 퇴근
var AUTO_OUT_MEMO = '자동 퇴근';   // 메모에 이 표시가 있으면 본인이 아직 퇴근을 안 누른 것
var AUTO_OUT_CONFIRM_H = 2;  // 자동 퇴근 뒤 이 시간 안에 본인이 [퇴근]을 누를 수 있음

// 실시간 가져오기
var LIVE_MIN_GAP_S = 50;     // BGF 에 이보다 자주 접속하지 않음 (페이지는 1분마다 부름)
var LIVE_TRIGGER_MIN = 5;    // 아무도 안 열어도 이 간격으로 오늘 폐기를 가져옴 (1, 5, 10, 15, 30 중 하나)
var BGF_SESSION_MIN = 60;    // BGF 로그인 쿠키를 이 시간까지 다시 씀 (매번 로그인하지 않음)

/* ======================= 시트 준비 / 메뉴 ======================= */

function setup() {
  adminOnly_();
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);

  var items = ss.getSheetByName(SH_ITEMS) || ss.insertSheet(SH_ITEMS, 0);
  if (items.getMaxColumns() < NCOL) items.insertColumnsAfter(items.getMaxColumns(), NCOL - items.getMaxColumns());
  items.getRange(1, 1, 1, NCOL).setValues([HEADERS]).setFontWeight('bold');
  items.setFrozenRows(1);
  items.getRange('A:F').setNumberFormat('@');
  items.getRange('L:S').setNumberFormat('@');
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
  installLiveTrigger_();
  return 'ok';
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('취식 관리')
    .addItem('BGF 비밀번호 입력', 'menuSetPassword')
    .addItem('오늘 폐기·저회전 지금 가져오기', 'menuLiveNow')
    .addItem('어제 폐기·저회전 지금 가져오기', 'nightly')
    .addItem('기간 지정해서 가져오기', 'menuImportRange')
    .addItem('저회전 지난 날짜 모두 가져오기', 'menuJeoBackfill')
    .addSeparator()
    .addItem('매일 자동 가져오기 켜기', 'installNightlyTrigger')
    .addItem('실시간 가져오기 켜기 (5분마다 + 링크 열려 있으면 1분마다)', 'menuLiveOn')
    .addItem('실시간 가져오기 끄기', 'menuLiveOff')
    .addSeparator()
    .addItem('개발자 비밀번호 설정', 'menuSetDevPw')
    .addItem('직원 비밀번호 지우기', 'menuClearMemberPw')
    .addToUi();
}

function menuLiveNow() {
  var ui = SpreadsheetApp.getUi();
  var r = liveImport_();
  ui.alert(r.error ? '가져오지 못했어요:\n' + r.error : '오늘 폐기·저회전 새 품목 ' + r.added + '건 추가 (' + (r.ms / 1000).toFixed(1) + '초)');
}
function menuJeoBackfill() {
  var ui = SpreadsheetApp.getUi();   // first: throws when called from the web page
  PropertiesService.getScriptProperties().deleteProperty('JEO_BACKFILL');
  var r = jeoBackfill_(null, true);
  ui.alert(r.error ? JEO + ' 가져오지 못했어요:\n' + r.error : JEO + ' ' + r.range + ': 전표 ' + r.chits + '장, 새 품목 ' + r.added + '건 추가');
}
function menuLiveOn() {
  var ui = SpreadsheetApp.getUi();   // first: throws when called from the web page
  PropertiesService.getScriptProperties().deleteProperty('LIVE_OFF');
  installLiveTrigger_();
  ui.alert('실시간 가져오기를 켰어요. 5분마다, 그리고 직원이 링크를 열어 두면 1분마다 오늘 폐기를 가져옵니다.');
}
function menuLiveOff() {
  var ui = SpreadsheetApp.getUi();   // first: throws when called from the web page
  PropertiesService.getScriptProperties().setProperty('LIVE_OFF', '1');
  removeLiveTrigger_();
  ui.alert('실시간 가져오기를 껐어요. 매일 밤 00:01 가져오기는 그대로 돌아갑니다.');
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
  var res = importRange_(m[1], m[2] || m[1]);
  ui.alert(res);
}

function installNightlyTrigger() {
  adminOnly_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'nightly') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('nightly').timeBased().atHour(0).nearMinute(1).everyDays(1).inTimezone(TZ).create();
  return '매일 00:01 무렵 자동 가져오기가 켜졌어요.';
}

function installLiveTrigger_() {
  removeLiveTrigger_();
  ScriptApp.newTrigger('liveTick').timeBased().everyMinutes(LIVE_TRIGGER_MIN).create();
  PropertiesService.getScriptProperties().setProperty('LIVE_TRIGGER', String(LIVE_TRIGGER_MIN));
  return LIVE_TRIGGER_MIN + '분마다 오늘 폐기 가져오기가 켜졌어요.';
}
function removeLiveTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'liveTick') ScriptApp.deleteTrigger(t);
  });
  PropertiesService.getScriptProperties().deleteProperty('LIVE_TRIGGER');
}

/** Time trigger: 오늘(과 어제) 폐기 중 새 전표만 가져옴. */
function liveTick(e) { if (!fromTrigger_(e)) adminOnly_(); refreshNow(); }

/*
 * Every top-level function whose name does not end in '_' can be called by anyone who has the
 * /exec link (google.script.run from the browser console), running as the owner. So the ones meant
 * only for the menu, the editor or a trigger check who is calling.
 */
/** Owner / spreadsheet editor (menu, script editor). Anonymous web callers have no active user. */
function adminOnly_() {
  var a = '';
  try { a = Session.getActiveUser().getEmail(); } catch (e) {}
  if (!a || a !== Session.getEffectiveUser().getEmail()) throw new Error('관리자만 할 수 있어요.');
}
/** True when called by one of this project's own triggers (the event carries the trigger's id). */
function fromTrigger_(e) {
  var id = e && e.triggerUid ? String(e.triggerUid) : '';
  return !!id && ScriptApp.getProjectTriggers().some(function (t) { return t.getUniqueId() === id; });
}

/* ======================= 매일 가져오기 ======================= */

function nightly(e) {
  if (!fromTrigger_(e)) adminOnly_();
  var now = new Date();
  var d1 = ymd_(new Date(now.getTime() - 24 * 3600 * 1000));
  var d2 = ymd_(new Date(now.getTime() - 2 * 24 * 3600 * 1000));
  return importRange_(d2, d1);
}

function importThisMonth() {
  adminOnly_();
  var now = new Date();
  var first = Utilities.formatDate(now, TZ, 'yyyyMM') + '01';
  return importRange_(first, ymd_(now));
}

function importRange_(fromYmd, toYmd) {
  try {
    var r = fetchAll_(fromYmd, toYmd);
    var added = appendItems_(r.items);
    var msg = fromYmd + '~' + toYmd + ': 전표 ' + r.chits + '장 (' + JEO + ' ' + r.jeoChits + '장), 새 품목 ' + added + '건 추가' +
      (r.jeoErr ? '\n' + JEO + ' 가져오기 실패: ' + r.jeoErr : '');
    logImport_(fromYmd + '~' + toYmd, r.chits, added, 'OK' + jeoNote_(r));
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

/** 폐기목록 sheet with every column in place (adds the 전표 column to sheets made before it existed). */
function itemsSheet_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH_ITEMS);
  if (sh.getMaxColumns() < NCOL) sh.insertColumnsAfter(sh.getMaxColumns(), NCOL - sh.getMaxColumns());
  if (sh.getRange(1, C.SRC).getDisplayValue() !== HEADERS[C.SRC - 1]) {
    sh.getRange(1, C.SRC).setValue(HEADERS[C.SRC - 1]).setFontWeight('bold');
    sh.getRange(1, C.SRC, sh.getMaxRows(), 1).setNumberFormat('@');
  }
  return sh;
}

function appendItems_(items) {
  if (!items.length) return 0;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = itemsSheet_();
    var n = sh.getLastRow() - 1;
    var have = {};
    if (n > 0) sh.getRange(2, 1, n, 1).getValues().forEach(function (r) { have[r[0]] = 1; });
    var rows = items.filter(function (it) { if (have[it.key]) return false; have[it.key] = 1; return true; })
      .sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : (a.key < b.key ? -1 : 1); })
      .map(function (it) {
        return [it.key, it.date, it.time, it.name, it.code, it.cat, it.qty, it.wprice, it.wamt, it.mprice, it.mamt, it.chit, '', '', '', '', it.date.slice(0, 7), '', it.src || ''];
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
 * Called by the page on open / every minute while it is open, and by the 5-minute trigger.
 * Hits BGF at most once per LIVE_MIN_GAP_S across all callers; otherwise returns at once.
 */
function refreshNow() {
  var p = PropertiesService.getScriptProperties();
  var props = p.getProperties();
  // one time: October 2026 취식 + 근무 (Oct2026.gs); a failed try waits 10 min
  if ((props.OCT_APPLY !== '1' || props.OCT_APPLY2 !== '1') && props.OCT_IMPORT === '1' && typeof octApplyAll_ === 'function' &&
      Date.now() - Number(props.OCT_APPLY_TRY || 0) > 600 * 1000) {
    p.setProperty('OCT_APPLY_TRY', String(Date.now()));
    try { octApplyAll_(); } catch (e) { logImport_('2026-10 (10월 취식·근무 넣기)', '', '', '실패: ' + String(e && e.message || e).slice(0, 200)); }
  }
  if (props.LIVE_OFF === '1') return liveInfo_(props, 0);
  // LIVE_TRIGGER holds the trigger's minutes, so changing LIVE_TRIGGER_MIN reinstalls it
  if (props.LIVE_TRIGGER !== String(LIVE_TRIGGER_MIN)) { try { installLiveTrigger_(); } catch (e) {} }
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
    var r = liveFetch_(from, to, knownChits_());
    var added = appendItems_(r.items);
    var ms = Date.now() - t0;
    p.setProperties({ LIVE_OK_AT: String(t0), LIVE_MS: String(ms), LIVE_ERR: '' });
    // 저회전 failures are logged once per streak (JEO_ERR), and never stop the 폐기 import
    var jeoErrBefore = p.getProperty('JEO_ERR') || '';
    p.setProperty('JEO_ERR', r.jeoErr || '');
    if (added || (r.jeoErr && !jeoErrBefore)) {
      logImport_(from + '~' + to + ' (실시간)', r.chits, added, 'OK · ' + (ms / 1000).toFixed(1) + '초, 상세 ' + r.fetched + '장' + jeoNote_(r));
    }
    if (!r.jeoErr) added += jeoBackfill_(r.session, false).added || 0;
    added += octImport_(r.session).added || 0;
    return { added: added, ms: Date.now() - t0 };
  } catch (e) {
    var msg = String(e && e.message || e).slice(0, 200);
    if (!p.getProperty('LIVE_ERR')) logImport_(from + '~' + to + ' (실시간)', '', '', '실패: ' + msg);
    p.setProperty('LIVE_ERR', msg);
    return { added: 0, ms: Date.now() - t0, error: msg };
  }
}

/**
 * fetchAll_ with the BGF login kept between runs (CacheService), so a run every minute
 * doesn't log in every minute. A kept session that errors, or answers with no slips at all or
 * a 저회전 error, is not trusted: log in again and read once more (so an expired session can
 * never hide slips). The session that worked is kept for the next run.
 */
function liveFetch_(from, to, known) {
  var r = null, s = keptSession_();
  if (s) {
    try { r = fetchAll_(from, to, known, s); } catch (e) { r = null; }
    if (r && (!r.chits || r.jeoErr)) r = null;
  }
  if (!r) r = fetchAll_(from, to, known);
  keepSession_(r.session, s && r.session === s);
  return r;
}
function keptSession_() {
  try {
    var c = JSON.parse(CacheService.getScriptCache().get('bgf_session') || 'null');
    if (!c || !c.jar || Date.now() - Number(c.at || 0) > BGF_SESSION_MIN * 60 * 1000) return null;
    var s = new Session_();
    s.jar = c.jar;
    s.loginAt = Number(c.at);
    return s;
  } catch (e) { return null; }
}
function keepSession_(s, reused) {
  try {
    var at = reused && s.loginAt ? s.loginAt : Date.now();
    CacheService.getScriptCache().put('bgf_session', JSON.stringify({ jar: s.jar, at: at }), BGF_SESSION_MIN * 60);
  } catch (e) {}
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

/** A request with variables only (no input dataset), e.g. the common code lookup. */
function ssvVarsOnly_(vars) {
  return ['SSV:utf-8'].concat(vars.map(function (kv) { return kv[0] + '=' + kv[1]; })).join(RS) + RS;
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
 * One login, then 폐기 and 저회전상품철수 slips for the range.
 * A 저회전 failure never blocks 폐기: it comes back as jeoErr and its items are left out.
 */
function fetchAll_(fromYmd, toYmd, known, session) {
  var s = session || bgfLogin_();
  var a = fetchSlips_(s, PYEGI_DIV, '', '', fromYmd, toYmd, known);
  var b, jeoErr = '';
  try {
    // search by the S312 code (or 전체 when it can't be found), and keep CHIT_ID 24 slips only either way
    b = fetchSlips_(s, jeoDiv_(s), JEO_CHIT_ID, JEO, fromYmd, toYmd, known);
  } catch (e) {
    jeoErr = String(e && e.message || e).slice(0, 150);
    b = { chits: 0, fetched: 0, items: [] };
  }
  return { chits: a.chits + b.chits, jeoChits: b.chits, fetched: a.fetched + b.fetched, items: a.items.concat(b.items), jeoErr: jeoErr, session: s };
}

/**
 * One time: 저회전 for every date already in 폐기목록 (the live import only reads yesterday..today,
 * so days before 저회전 import existed would stay empty). Runs after a live import until it succeeds
 * once (JEO_BACKFILL=1); a failed try waits an hour (JEO_BACKFILL_TRY). force: ignore that wait.
 * Never throws. Returns { added, chits, range, error }.
 */
function jeoBackfill_(session, force) {
  var p = PropertiesService.getScriptProperties();
  if (p.getProperty('JEO_BACKFILL') === '1') return { added: 0 };
  if (!force && Date.now() - Number(p.getProperty('JEO_BACKFILL_TRY') || 0) < 3600 * 1000) return { added: 0 };
  p.setProperty('JEO_BACKFILL_TRY', String(Date.now()));
  var to = ymd_(new Date()), from = to, range = '';
  try {
    var sh = itemsSheet_(), n = sh.getLastRow() - 1;
    if (n > 0) sh.getRange(2, C.DATE, n, 1).getDisplayValues().forEach(function (r) {
      var d = String(r[0]).replace(/-/g, '');
      if (/^\d{8}$/.test(d) && d < from) from = d;
    });
    range = from + '~' + to;
    var s = session || bgfLogin_();
    var r = fetchSlips_(s, jeoDiv_(s), JEO_CHIT_ID, JEO, from, to);
    var added = appendItems_(r.items);
    logImport_(range + ' (' + JEO + ' 지난 날짜)', r.chits, added, 'OK');
    p.setProperty('JEO_BACKFILL', '1');
    return { added: added, chits: r.chits, range: range };
  } catch (e) {
    var msg = String(e && e.message || e).slice(0, 200);
    logImport_(range + ' (' + JEO + ' 지난 날짜)', '', '', '실패: ' + msg);
    return { added: 0, error: msg };
  }
}
/**
 * One time (owner's ask, 2026-11-10): October 2026 폐기 + 저회전 from BGF, so October's 취식 list
 * (the 10월 폐기 정리 split) and 근무시간 can be brought in. Runs after a live import until it succeeds
 * once (OCT_IMPORT=1); a failed try waits an hour (OCT_IMPORT_TRY). Never throws.
 */
function octImport_(session) {
  var p = PropertiesService.getScriptProperties();
  if (p.getProperty('OCT_IMPORT') === '1') return { added: 0 };
  if (Date.now() - Number(p.getProperty('OCT_IMPORT_TRY') || 0) < 3600 * 1000) return { added: 0 };
  p.setProperty('OCT_IMPORT_TRY', String(Date.now()));
  var range = '20261001~20261031 (10월 한 번)';
  try {
    var r = fetchAll_('20261001', '20261031', null, session);
    var added = appendItems_(r.items);
    logImport_(range, r.chits, added, 'OK' + jeoNote_(r));
    if (!r.jeoErr) p.setProperty('OCT_IMPORT', '1');
    return { added: added };
  } catch (e) {
    logImport_(range, '', '', '실패: ' + String(e && e.message || e).slice(0, 200));
    return { added: 0 };
  }
}
function jeoNote_(r) { return r.jeoErr ? ' · ' + JEO + ' 실패: ' + r.jeoErr : r.jeoChits ? ' · ' + JEO + ' ' + r.jeoChits + '장' : ''; }

/**
 * 전표구분 search code for 저회전상품철수, looked up by name in BGF's common code S312 (the same call
 * the 통합전표 조회 screen makes for its dropdown) and cached in Script Property JEO_DIV.
 * Returns '' (= 전체) when the lookup finds nothing; the caller then filters by CHIT_ID.
 */
function jeoDiv_(s) {
  var p = PropertiesService.getScriptProperties();
  var cached = p.getProperty('JEO_DIV');
  if (cached) return cached;
  var code = '';
  try {
    var r = s.post('/stco010/selComCd', ssvVarsOnly_(svcVars_().concat([
      ['codeKeys', CHIT_DIV_CODE], ['selecttype', 'A'], ['col1', '%'], ['col2', '%'], ['col3', '%'], ['col4', '%'], ['col5', '%'], ['col6', '%']
    ])));
    Object.keys(r.ds).forEach(function (k) {
      (r.ds[k] || []).forEach(function (row) {
        if (!code && row.CODE && String(row.NAME || '').indexOf(JEO) >= 0) code = String(row.CODE);
      });
    });
  } catch (e) {}
  if (code) p.setProperty('JEO_DIV', code);
  return code;
}

/**
 * divCode: 전표구분 search code ('' = 전체). onlyChitId: keep only slips with this CHIT_ID ('' = all).
 * src: written to the 전표 column ('' = 폐기).
 * known (optional): { CHIT_NO: lines already imported }. A slip is skipped when we already have
 * at least ITEM_CNT lines of it, so a live refresh only downloads details for new slips.
 * The nightly import passes nothing and re-reads every slip (safety net).
 */
function fetchSlips_(s, divCode, onlyChitId, src, fromYmd, toYmd, known) {
  var list = s.post('/stgj020/search', ssvBuild_(svcVars_(), 'dsSearch',
    ['strDate', 'strStoreCd', 'strChitDiv', 'strChitNo', 'strChitYmd', 'strToDt', 'strFromDt'],
    ['', STORE_CD, divCode, '', '', toYmd, fromYmd]));
  var chits = (list.ds.dsList || []).filter(function (c) { return c.CHIT_NO && (!onlyChitId || c.CHIT_ID === onlyChitId); });
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
          mprice: Number(d.MAEGA_PRICE) || 0, mamt: Number(d.MAEGA_AMT) || 0, chit: d.CHIT_NO, src: src || ''
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
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ---------- 앱 API (JSON) ----------
 * The Android app / installable page (app/) calls the same functions as google.script.run, but through
 * POST /exec with a text/plain body {"fn": name, "args": [...]} (text/plain = no CORS preflight).
 * Answer: {"ok": true, "r": result} or {"ok": false, "err": message}.
 * Only these names can be called; they are all public (google.script.run-callable) already. */
function apiFns_() {
  return {
    getBoot: getBoot, getInit: getInit, getMonth: getMonth, setTag: setTag, addMember: addMember,
    clockIn: clockIn, clockOut: clockOut, saveShift: saveShift, deleteShift: deleteShift,
    login: login, setPassword: setPassword, refreshNow: refreshNow, getPage: getPage
  };
}
function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var fns = apiFns_();
    if (!req || typeof req.fn !== 'string' || !Object.prototype.hasOwnProperty.call(fns, req.fn)) throw new Error('알 수 없는 요청이에요.');
    var r = fns[req.fn].apply(null, Array.isArray(req.args) ? req.args : []);
    out = { ok: true, r: r === undefined ? null : r };
  } catch (err) {
    out = { ok: false, err: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** One call for the page start: init + the newest month (saves a round trip). */
function getBoot(me, token) {
  var init = getInit(me, token);
  return { init: init, month: getMonth(init.months[0], '') };
}

/** The page source, for the app to update itself. null when the app already has this version (hash). */
function getPage(knownHash) {
  var html = HtmlService.createHtmlOutputFromFile('Index').getContent();
  var h = b64_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, html, Utilities.Charset.UTF_8));
  return String(knownHash || '') === h ? null : { hash: h, html: html };
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
  var sh = itemsSheet_();
  var n = sh.getLastRow() - 1;
  var rows = [], cancels = [];
  if (n > 0) {
    var vals = sh.getRange(2, 1, n, NCOL).getDisplayValues();
    var nums = sh.getRange(2, C.QTY, n, 5).getValues();
    var cx = cancelMatch_(vals, nums);
    var when = function (k) { return vals[k][C.TIME - 1] || vals[k][C.DATE - 1]; };
    for (var i = 0; i < vals.length; i++) {
      var r = vals[i];
      if (r[C.MONTH - 1] !== month) continue;
      if (cx.neg[i]) {
        // [time, name, qty, wamt, date, [[time, qty, type, member], …] canceled lines (empty = no earlier line), src]
        cancels.push([when(i), r[C.NAME - 1], Number(nums[i][0]) || 0, Number(nums[i][2]) || 0, r[C.DATE - 1],
          cx.neg[i].map(function (m) { var o = vals[m[0]]; return [when(m[0]), m[1], o[C.TYPE - 1], o[C.MEMBER - 1]]; }), r[C.SRC - 1]]);
        continue;
      }
      var q = Number(nums[i][0]) || 0, wamt = Number(nums[i][2]) || 0, mamt = Number(nums[i][4]) || 0;
      if (cx.left[i] !== undefined) {
        if (cx.left[i] <= 0) continue;            // fully canceled
        wamt = Math.round(wamt * cx.left[i] / q); mamt = Math.round(mamt * cx.left[i] / q); q = cx.left[i];
      }
      rows.push([i + 2, r[C.KEY - 1], when(i), r[C.NAME - 1], q,
        Number(nums[i][1]) || 0, wamt, mamt, r[C.TYPE - 1], r[C.MEMBER - 1], r[C.WHO - 1], r[C.DATE - 1], r[C.NOTE - 1], r[C.SRC - 1]]);
    }
  }
  var all = readShifts_();
  return { version: v, month: month, rows: rows, cancels: cancels, shifts: shiftsFor_(month, all), usual: usualShifts_(all), members: members_() };
}

/**
 * BGF 폐기 취소: a line with a negative 수량/단가/금액 cancels an earlier line of the same product
 * (same 상품코드, or 품명 when there is no code) and the same slip kind (전표 열: 폐기 / 저회전 never
 * cancel each other). Lines are walked in time order over the whole sheet,
 * so a cancel early next month still finds last month's line. Each cancel uses up the quantity of the
 * newest earlier line(s), untagged lines first. A cancel with no earlier line is simply ignored.
 * Returns neg: { index: [[matchedIndex, qty], …] } for every negative line (all are hidden),
 * left: { index: qty still standing } for positive lines touched by a cancel (0 = hide).
 */
function cancelMatch_(vals, nums) {
  var order = vals.map(function (r, i) { return i; });
  var t = function (i) { return vals[i][C.TIME - 1] || vals[i][C.DATE - 1]; };
  order.sort(function (a, b) { return t(a) < t(b) ? -1 : t(a) > t(b) ? 1 : a - b; });
  var open = {}, left = {}, rem = {}, neg = {};
  order.forEach(function (i) {
    var r = vals[i], x = nums[i];
    var q = Number(x[0]) || 0;
    var prod = String(r[C.SRC - 1] || '') + '|' + String(r[C.CODE - 1] || r[C.NAME - 1]);
    var isNeg = [0, 1, 2, 3, 4].some(function (k) { return (Number(x[k]) || 0) < 0; });
    if (!isNeg) {
      if (q > 0) { rem[i] = q; (open[prod] = open[prod] || []).push(i); }
      return;
    }
    var need = Math.abs(q) || 1, got = [], list = open[prod] || [];
    [true, false].forEach(function (untaggedOnly) {
      for (var j = list.length - 1; j >= 0 && need > 0; j--) {
        var k = list[j];
        if (!rem[k] || (untaggedOnly && vals[k][C.TYPE - 1])) continue;
        var take = Math.min(rem[k], need);
        rem[k] -= take; need -= take; left[k] = rem[k];
        got.push([k, take]);
      }
    });
    neg[i] = got;
  });
  return { neg: neg, left: left };
}

/**
 * type: '취식' | '폐기' | '' (clear). memberFull: whose tag to write (전체 이름).
 * A 저회전 row (전표 열 = '저회전') can only be 취식 or cleared.
 * note: '근무외' when the worker confirmed a 폐기 outside their recorded shift (kept only for 폐기).
 * me/token: who is acting. Only your own name is written, and a row someone else tagged can't be
 * changed or cleared from the page (the owner can still fix it in the sheet).
 */
function setTag(rowHint, key, type, memberFull, month, note, me, token) {
  if (['취식', '폐기', ''].indexOf(type) < 0) throw new Error('bad type');
  var actor = authMember_(me || memberFull, token);
  if (type && memberFull && memberFull !== actor.full) throw new Error('다른 직원 이름으로는 등록할 수 없어요.');
  var mem = type ? actor : null;
  note = type === '폐기' && note === OFFSHIFT_NOTE ? OFFSHIFT_NOTE : '';
  withLock_(function () {
    var sh = SpreadsheetApp.getActive().getSheetByName(SH_ITEMS);
    var row = Number(rowHint);
    if (!(row >= 2 && row <= sh.getLastRow() && sh.getRange(row, C.KEY).getDisplayValue() === key)) {
      var f = sh.getRange('A:A').createTextFinder(key).matchEntireCell(true).findNext();
      if (!f) throw new Error('항목을 찾지 못했어요. 새로고침해 주세요.');
      row = f.getRow();
    }
    var curMember = sh.getRange(row, C.MEMBER).getDisplayValue();
    if (curMember && curMember !== actor.full) throw new Error(curMember + ' 님이 등록한 항목이라 바꿀 수 없어요.');
    if (type === '폐기' && sh.getMaxColumns() >= C.SRC && sh.getRange(row, C.SRC).getDisplayValue() === JEO) {
      throw new Error(JEO + ' 상품은 폐기로 등록할 수 없어요. 먹었으면 취식으로 등록해 주세요.');
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

/** An open shift counts as "근무 중" from 15 min before its start (a rounded-up 출근) for 16 h. */
function isLive_(s, nowM) {
  if (s.end) return false;
  var a = shiftSpan_(s)[0];
  return a <= nowM + SLOT_MIN / 2 && nowM - a < OPEN_SHIFT_MAX_H * 60;
}

function openShiftOf_(all, member, nowM) {
  var best = null;
  all.forEach(function (s) {
    if (s.member !== member || !isLive_(s, nowM)) return;
    if (!best || shiftSpan_(s)[0] > shiftSpan_(best)[0]) best = s;
  });
  return best;
}

/* ---- 출근/퇴근 버튼 시간 맞추기 (30분 단위 + 교대) ----
 * The store counts work in 30-min slots, so a button press is rounded to the nearest slot
 * (:15 / :45 → 출근 down, 퇴근 up: ties go the worker's way).
 * Handover: if another worker's 퇴근 (or 출근) is close to the press — from 15 min after it to
 * 30 min before it — the press takes that exact time, so the two shifts meet with no gap and no
 * overlap (09:18 출근 after a 09:00 퇴근 → 09:00).
 * When someone presses 출근 while another worker is still 근무 중 (forgot 퇴근), that worker is
 * closed at the same time (memo `자동 퇴근`), if that leaves them at least 1 h. If they press
 * 퇴근 (page shows it for 2 h) within 30 min of it, the time stays; later than that, it moves to
 * their press (they stayed). Either way the memo mark goes away. */
function roundSlot_(m, tieUp) {
  var r = ((m % SLOT_MIN) + SLOT_MIN) % SLOT_MIN, h = SLOT_MIN / 2;
  return r < h || (r === h && !tieUp) ? m - r : m - r + SLOT_MIN;
}
function minDate_(m) { return Utilities.formatDate(new Date(m * 60000), 'UTC', 'yyyy-MM-dd'); }
function minHm_(m) { return Utilities.formatDate(new Date(m * 60000), 'UTC', 'HH:mm'); }

/**
 * The other worker's 퇴근 (which = 1) or 출근 (which = 0) nearest to t, among times in
 * [t - HANDOVER_MIN, t + SLOT_MIN / 2]; null if none. `after` = only times later than this.
 */
function handoverAt_(all, member, t, which, after) {
  var best = null;
  all.forEach(function (s) {
    if (s.member === member) return;
    var x = shiftSpan_(s)[which];
    if (x === null || x <= after) return;
    if (x < t - HANDOVER_MIN || x > t + SLOT_MIN / 2) return;
    if (best === null || Math.abs(x - t) < Math.abs(best - t)) best = x;
  });
  return best;
}

function isAutoOut_(s) { return String(s.memo || '').split(' · ').indexOf(AUTO_OUT_MEMO) >= 0; }
function dropAutoOut_(memo) {
  return String(memo || '').split(' · ').filter(function (p) { return p && p !== AUTO_OUT_MEMO; }).join(' · ');
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

/**
 * Plan a 출근 at nowM (no writes): { start (minutes), closed: [shift with .end set] }.
 * Pure apart from reading `all`, so it can be tested on its own.
 */
function planClockIn_(all, member, nowM) {
  var start = roundSlot_(nowM, false), closed = [];
  all.forEach(function (s) {
    if (s.member === member || !isLive_(s, nowM)) return;
    if (start - shiftSpan_(s)[0] < AUTO_OUT_MIN_H * 60) return; // 막 출근한 사람: 같이 일하는 중
    s.end = minHm_(start);
    s.memo = (dropAutoOut_(s.memo) ? dropAutoOut_(s.memo) + ' · ' : '') + AUTO_OUT_MEMO;
    closed.push(s);
  });
  if (!closed.length) {
    var e = handoverAt_(all, member, nowM, 1, -Infinity);
    if (e !== null) start = e;
  }
  return { start: start, closed: closed };
}

/** Plan a 퇴근 for `open` at nowM: end in minutes. */
function planClockOut_(all, member, open, nowM) {
  var a = shiftSpan_(open)[0];
  var end = roundSlot_(nowM, true);
  var s = handoverAt_(all, member, nowM, 0, a);
  return s !== null ? s : end;
}

function clockIn(memberFull, month, token) {
  var mem = authMember_(memberFull, token), info = null;
  withLock_(function () {
    var sh = shiftSheet_();
    var all = readShifts_(), nowM = nowMin_(), now = new Date();
    var open = openShiftOf_(all, mem.full, nowM);
    if (open) throw new Error('이미 ' + open.start + '에 출근했어요. 끝났으면 [퇴근]을 눌러 주세요.');
    var p = planClockIn_(all, mem.full, nowM);
    var hit = overlapOf_(all, mem.full, p.start, null, '', nowM);
    if (hit) throw new Error('지금 시간이 이미 근무 기록(' + hit.start + '–' + hit.end + ') 안에 있어요.');
    p.closed.forEach(function (s) { writeShift_(sh, s.row, s); });
    writeShift_(sh, sh.getLastRow() + 1, {
      key: 's' + now.getTime().toString(36) + Math.floor(Math.random() * 1296).toString(36),
      date: minDate_(p.start), member: mem.full, start: minHm_(p.start), end: '', memo: ''
    });
    info = { start: minHm_(p.start), closed: p.closed.map(function (s) { return [s.member, s.end]; }) };
    bumpVersion_();
  });
  var res = getMonth(month || '', '');
  if (res) res.clock = info;
  return res;
}

function clockOut(memberFull, month, token) {
  var mem = authMember_(memberFull, token), info = null;
  withLock_(function () {
    var sh = shiftSheet_();
    var all = readShifts_(), nowM = nowMin_();
    var open = openShiftOf_(all, mem.full, nowM);
    if (!open) {
      // 다음 사람이 출근하면서 자동 퇴근된 근무: 30분 안에 누르면 그 시간 그대로, 넘으면 지금 시간으로.
      var last = null;
      all.forEach(function (s) {
        if (s.member !== mem.full || !s.end || !isAutoOut_(s)) return;
        var b = shiftSpan_(s)[1];
        if (b > nowM + SLOT_MIN / 2 || nowM - b > AUTO_OUT_CONFIRM_H * 60 + 15) return;
        if (!last || b > shiftSpan_(last)[1]) last = s;
      });
      if (!last) throw new Error('지금 출근 중인 기록이 없어요. [직접 입력]으로 적어 주세요.');
      var lb = shiftSpan_(last)[1];
      var kept = nowM - lb < HANDOVER_MIN;
      if (!kept) last.end = minHm_(roundSlot_(nowM, true));
      last.memo = dropAutoOut_(last.memo);
      writeShift_(sh, last.row, last);
      info = kept ? { end: last.end, kept: true } : { end: last.end, moved: true };
      bumpVersion_();
      return;
    }
    var end = planClockOut_(all, mem.full, open, nowM);
    if (end <= shiftSpan_(open)[0]) {
      throw new Error(open.start + ' 출근과 퇴근이 같은 시간이 돼요. 잘못 눌렀으면 근무 기록을 눌러 지워 주세요.');
    }
    open.end = minHm_(end);
    writeShift_(sh, open.row, open);
    info = { end: open.end };
    bumpVersion_();
  });
  var res = getMonth(month || '', '');
  if (res) res.clock = info;
  return res;
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
