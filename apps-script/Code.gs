/**
 * 직원 취식 목록
 * - 매일 00:01 무렵 BGF 점포시스템에서 어제(와 그제) 폐기 전표를 가져와 '폐기목록' 시트에 추가
 * - 낮에도 오늘 폐기를 바로 가져옴: 링크가 열려 있으면 1분마다 + 아무도 안 열어도 5분마다 자동
 * - 웹앱: 직원이 자기 이름을 한 번 고르고, 품목마다 [취식] / [폐기] 를 한 번 눌러 등록
 *   취식 → 전체 이름(김성휘), 폐기 → 이름만(성휘)
 * - 출근일지: [출근] / [퇴근] 한 번 누르거나 직접 입력. 다른 직원 근무 시간도 날짜별로 보임
 *   근무 기록 밖 시간의 폐기를 등록하면 확인을 받고, '확인' 열에 '근무외' 로 남김
 * - 월별 합계: '월별 합계' 시트와 웹앱에서 확인 (웹앱은 근무시간 합계도)
 * - 저회전상품철수 전표도 폐기와 똑같이 가져옴 ('전표' 열 = '저회전'). 취식이나 폐기로 등록할 수 있고
 *   (누가 처리했는지 남김), 등록 안 해도 됨 (미등록에 안 셈).
 * - 점포 여러 곳: STORES 에 적힌 점포마다 시트(폐기목록·직원·출근일지·월별 합계)와 설정이 따로 있음.
 *   화면은 점포를 골라서 보고, 서버는 요청마다 그 점포(store_())로 일함.
 */

var TZ = 'Asia/Seoul';
var BASE = 'https://store.bgfretail.com';

/* ======================= 점포 (multi-store) =======================
 * One entry per store. Every store has its own sheets, Script Properties and cache keys; nothing is shared
 * but 가져오기 기록, the password salt / token key and the developer password.
 *   id      what the page sends (and the BGF 점포코드 for a CU store). Never change it once used.
 *   chain   which 전산 the lines come from: a key of CHAINS (the import adapter).
 *   on      false = defined but hidden (not in the page, no sheets, no import).
 *   legacy  the first store, from before stores existed: its sheets and properties have no store part
 *           in their names ('폐기목록', 'BGF_PW'); every other store gets '<short> 폐기목록', 'BGF_PW_<id>'.
 *   userNo  the 전산 login id.
 *   ss      (CU) the SS_* variables BGF expects, when known. A store without it gets them from its own
 *           login answer (bgfSsFromLogin_), kept in Script Property BGF_SS_<id>.
 * To add a store: add a line here, push, then enter its 전산 password in the spreadsheet menu.
 */
var STORES = [
  { id: '25377', name: 'CU 울산둘리점', short: '둘리점', chain: 'CU', on: true, legacy: true, userNo: '25377',
    ss: [
      ['SS_STORE_CD', '25377'], ['SS_PRE_STORE_CD', '160081'], ['SS_STORE_NM', '7Jq47IKw65GY66as7KCQ'], ['SS_SLC_CD', ''],
      ['SS_LOC_CD', '02'], ['SS_ADM_SECT_CD', '31140'], ['SS_STORE_OWNER_NM', '7KO87ZiE7KCV'], ['SS_STORE_POS_QTY', '2'],
      ['SS_STORE_IP', '10.126.178.1'], ['SS_SV_EMP_NO', '1213170'], ['SS_SSTORE_ID', ''], ['SS_RCV_ID', '1'], ['SS_FC_CD', 'P2'],
      ['SS_USER_GRP_ID', '0001'], ['SS_USER_NO', '25377'], ['SS_SGGD_CD', '31140540'], ['SS_LOGIN_USER_NO', '25377']
    ] },
  { id: '31949', name: 'CU 울산두왕점', short: '두왕점', chain: 'CU', on: true, userNo: '31949' },
  // 준비만 해 둠 (on: false). GS25 전산은 BGF 와 달라서 CHAINS.GS25 어댑터를 만든 뒤에 켬. docs/DEVNOTES.md → Stores
  { id: 'gs-sinjeong', name: 'GS25 울산신정중앙점', short: '신정중앙점', chain: 'GS25', on: false, userNo: '' }
];

/*
 * Import adapters, one per chain (전산). Everything outside an adapter is chain-neutral: sheets, tagging,
 * 출근일지, the page. An adapter gives:
 *   system   name shown in messages
 *   pwKey    Script Property that holds the 전산 password (per store: pkey_())
 *   jeo      true when the 전산 has 저회전상품철수 slips (the page hides the 저회전 tab otherwise)
 *   live(from, to, known)  yesterday..today, may reuse a kept login; known = { 전표번호: lines in the sheet }
 *   range(from, to)        full re-read of a date range with a fresh login
 *   check()                logs in and returns a short text for the menu (throws when it fails)
 * live / range return { chits, jeoChits, fetched, items, jeoErr, session } where every item is
 *   { key, date 'yyyy-MM-dd', time 'yyyy-MM-dd HH:mm:ss', name, code, cat, qty, wprice, wamt, mprice, mamt, chit, src }
 * (key unique inside the store; src '' = 폐기, '저회전' = 저회전). A chain without live / range (GS25 for now)
 * simply has no import: its stores still work for 출근일지 and hand-made lists.
 */
var CHAINS = {
  CU: {
    system: 'BGF 점포시스템', pwKey: 'BGF_PW', jeo: true,
    live: function (from, to, known) { return liveFetch_(from, to, known); },
    range: function (from, to) { return fetchAll_(from, to); },
    check: function () { var s = bgfLogin_(); return s.storeNm || store_().name; }
  },
  GS25: { system: 'GS25 점포 전산', pwKey: 'GS_PW', jeo: false }
};

var CUR_ = null;   // the store this execution works for (one request = one store)
function store_() { return CUR_ || STORES[0]; }
function storeById_(id) {
  id = String(id || '');
  if (!id) return STORES[0];
  for (var i = 0; i < STORES.length; i++) if (STORES[i].id === id && STORES[i].on) return STORES[i];
  throw new Error('없는 점포예요. 점포를 다시 골라 주세요.');
}
/** Page entry: work for this store from here on ('' = the first store, for pages from before stores existed). */
function useStore_(id) { CUR_ = storeById_(id); storeSheets_(CUR_, false); return CUR_; }
/** Run fn for another store (triggers, menu), then come back. */
function inStore_(st, fn) {
  var was = CUR_;
  CUR_ = st;
  try { storeSheets_(st, false); return fn(st); } finally { CUR_ = was; }
}
function onStores_() { return STORES.filter(function (st) { return st.on; }); }
/** The chain adapter when this store can import (adapter written and the 전산 password entered), else null. */
function importer_(st) {
  st = st || store_();
  var ch = CHAINS[st.chain];
  return ch && ch.live && ch.range && pget_(ch.pwKey, st) ? ch : null;
}
/** '' when ready to import; 'pw' = password not entered yet; 'adapter' = this chain's import isn't written yet. */
function importWait_(st) {
  st = st || store_();
  var ch = CHAINS[st.chain];
  return !ch || !ch.live ? 'adapter' : pget_(ch.pwKey, st) ? '' : 'pw';
}
function sheetName_(base, st) { st = st || store_(); return st.legacy ? base : st.short + ' ' + base; }
var SS_DOC_ = null;
function doc_() { return SS_DOC_ || (SS_DOC_ = SpreadsheetApp.getActive()); }
function sheet_(base, st) {
  st = st || store_();
  var sh = doc_().getSheetByName(sheetName_(base, st));
  // a store's sheet that was deleted by hand comes back empty (its SHEETS mark said it was there)
  if (!sh && !st.legacy && pget_('SHEETS', st) === '1') { pdel_('SHEETS', st); storeSheets_(st, false); sh = doc_().getSheetByName(sheetName_(base, st)); }
  return sh;
}

/* Script Properties: one read per execution (snapshot), writes go through and update it.
 * pget_ / pset_ / pdel_ = this store's value (key + '_<id>' for every store but the first);
 * gget_ / gset_ / gdel_ = shared by all stores. */
var PS_ = null, PSNAP_ = null;
function ps_() { return PS_ || (PS_ = PropertiesService.getScriptProperties()); }
function snap_() { return PSNAP_ || (PSNAP_ = ps_().getProperties()); }
function pkey_(k, st) { st = st || store_(); return st.legacy ? k : k + '_' + st.id; }
function gget_(k) { var v = snap_()[k]; return v === undefined || v === null ? '' : String(v); }
function gset_(k, v) { v = String(v); ps_().setProperty(k, v); snap_()[k] = v; }
function gdel_(k) { ps_().deleteProperty(k); delete snap_()[k]; }
function pget_(k, st) { return gget_(pkey_(k, st)); }
function pset_(k, v, st) { gset_(pkey_(k, st), v); }
function pdel_(k, st) { gdel_(pkey_(k, st)); }
/** Cache key of this store. */
function ck_(k, st) { return k + '|' + (st || store_()).id; }

var SH_ITEMS = '폐기목록';
var SH_MEMBERS = '직원';
var SH_SUMMARY = '월별 합계';
var SH_LOG = '가져오기 기록';
var SH_SHIFTS = '출근일지';
var SH_CLOSE = '월별 마감';

// 폐기목록 columns (1-based)
var C = { KEY: 1, DATE: 2, TIME: 3, NAME: 4, CODE: 5, CAT: 6, QTY: 7, WPRICE: 8, WAMT: 9, MPRICE: 10, MAMT: 11, CHIT: 12, TYPE: 13, WHO: 14, MEMBER: 15, AT: 16, MONTH: 17, NOTE: 18, SRC: 19 };
var NCOL = 19;
var HEADERS = ['키', '일자', '생성시각', '품명', '상품코드', '분류', '수량', '원가단가', '원가금액', '매가단가', '매가금액', '전표번호', '구분', '등록이름', '직원', '등록시각', '월', '확인', '전표'];
var OFFSHIFT_NOTE = '근무외';

// 월별 마감: 지난 달 직원별 폐기 / 취식 수량·원가를 한 번 적어 두고, 그 뒤로는 그 숫자를 보여 줌 (나중에 바뀌지 않게)
var CLOSE_HEADERS = ['월', '직원', '폐기 수량', '폐기 원가', '취식 수량', '취식 원가', '마감시각'];
var CLOSE_TODO = '(미등록)';   // 직원 열: 그 달 미등록 폐기 (폐기 수량·원가 열에 적음)
var CLOSE_AFTER_DAYS = 1;      // 달이 바뀌고 이만큼 지나서 마감 (마지막 날 밤 근무자가 아침까지 등록할 수 있게)

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
var SLOT_MIN = 30;           // 근무 시간은 가까운 30분으로 맞춤 (가게는 30분 단위로 셈)
var HANDOVER_MIN = 30;       // 앞 사람 퇴근 뒤 30분 안에 출근하면 교대로 봄 (겹침 습관 셈)
var AUTO_OUT_MIN_H = 1;      // 다음 사람 출근 때 1시간 넘게 근무 중인 사람은 자동 퇴근
var AUTO_OUT_MEMO = '자동 퇴근';   // 메모에 이 표시가 있으면 본인이 아직 퇴근을 확인 안 한 것
var TRIM_MEMO = '교대 맞춤';   // 다음 사람 출근이 앞 사람 퇴근보다 일러서 퇴근을 그 출근에 맞춤. 메모: '교대 맞춤 (원래 22:30)'
var HANDOFF_DAYS = 90;       // 겹침이 보통인지 볼 때 보는 기간
var HANDOFF_NEAR_MIN = 60;   // 같은 교대로 보는 시간대 (출근 시각 ±60분)
var HANDOFF_MIN_N = 3;       // 이보다 적게 보이면 판단 없이 퇴근을 맞춤

// 실시간 가져오기
var LIVE_MIN_GAP_S = 50;     // BGF 에 이보다 자주 접속하지 않음 (페이지는 1분마다 부름)
var LIVE_TRIGGER_MIN = 5;    // 아무도 안 열어도 이 간격으로 오늘 폐기를 가져옴 (1, 5, 10, 15, 30 중 하나)
var BGF_SESSION_MIN = 60;    // BGF 로그인 쿠키를 이 시간까지 다시 씀 (매번 로그인하지 않음)

/* ======================= 시트 준비 / 메뉴 ======================= */

function setup() {
  adminOnly_();
  var ss = doc_();
  ss.setSpreadsheetTimeZone(TZ);

  onStores_().forEach(function (st) { storeSheets_(st, true); });

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

/**
 * One store's sheets: 폐기목록, 출근일지, 직원, 월별 합계 (names: sheetName_). redo = false (every request
 * of a store other than the first): only makes what is missing, so a new store in STORES gets its sheets
 * by itself the first time it is used. redo = true (setup): also writes headers, formats and the 합계 formula again.
 */
function storeSheets_(st, redo) {
  // SHEETS_<id> = 1 once made: the usual request (a page polling every 5 s) then doesn't open the spreadsheet for this check
  if (!redo && (st.legacy || pget_('SHEETS', st) === '1')) return;
  var ss = doc_();
  var nItems = sheetName_(SH_ITEMS, st), nMem = sheetName_(SH_MEMBERS, st), nSum = sheetName_(SH_SUMMARY, st), nShift = sheetName_(SH_SHIFTS, st);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var items = ss.getSheetByName(nItems), fresh = !items;
    if (fresh) items = ss.insertSheet(nItems, st.legacy ? 0 : ss.getNumSheets());
    if (fresh || redo) {
      if (items.getMaxColumns() < NCOL) items.insertColumnsAfter(items.getMaxColumns(), NCOL - items.getMaxColumns());
      items.getRange(1, 1, 1, NCOL).setValues([HEADERS]).setFontWeight('bold');
      items.setFrozenRows(1);
      items.getRange('A:F').setNumberFormat('@');
      items.getRange('L:S').setNumberFormat('@');
      items.getRange('G:K').setNumberFormat('#,##0');
    }

    if (!ss.getSheetByName(nShift)) {
      var sh = ss.insertSheet(nShift, ss.getNumSheets());
      sh.getRange(1, 1, 1, SNCOL).setValues([SHIFT_HEADERS]).setFontWeight('bold');
      sh.setFrozenRows(1);
      sh.getRange('A:E').setNumberFormat('@');
      sh.getRange('G:I').setNumberFormat('@');
      sh.getRange('F:F').setNumberFormat('0.00');
    }

    var mem = ss.getSheetByName(nMem) || ss.insertSheet(nMem, ss.getNumSheets());
    if (mem.getLastRow() === 0) {
      mem.getRange(1, 1, 1, 4).setValues([['이름(전체)', '폐기용 이름', '메모', PW_HEADER]]).setFontWeight('bold');
      if (st.legacy) mem.getRange(2, 1, 1, 2).setValues([['김성휘', '성휘']]);
      mem.setFrozenRows(1);
    }

    var sum = ss.getSheetByName(nSum), newSum = !sum;
    if (newSum) sum = ss.insertSheet(nSum, ss.getNumSheets());
    if (newSum || redo) {
      sum.clear();
      sum.getRange('A1').setValue(st.name + ' 월별 합계 (' + nItems + ' 시트에서 자동 계산)').setFontWeight('bold');
      sum.getRange('A3').setFormula(
        "=IFERROR(QUERY({'" + nItems + "'!Q2:Q,'" + nItems + "'!M2:M,'" + nItems + "'!O2:O,'" + nItems + "'!N2:N,'" + nItems + "'!G2:G,'" + nItems + "'!I2:I,'" + nItems + "'!K2:K}," +
        "\"select Col1, Col2, Col3, Col4, count(Col5), sum(Col5), sum(Col6), sum(Col7) where Col2 is not null group by Col1, Col2, Col3, Col4 order by Col1 desc, Col2, Col3 " +
        "label Col1 '월', Col2 '구분', Col3 '직원', Col4 '등록이름', count(Col5) '건수', sum(Col5) '수량', sum(Col6) '원가합계', sum(Col7) '매가합계'\", 0), \"아직 등록된 항목이 없어요\")"
      );
    }
    SpreadsheetApp.flush();
    if (!st.legacy) pset_('SHEETS', '1', st);
  } finally {
    lock.releaseLock();
  }
}

/** Stores whose chain has an import adapter (password entered or not). */
function posStores_() { return onStores_().filter(function (st) { return importWait_(st) !== 'adapter'; }); }

function onOpen() {
  var menu = SpreadsheetApp.getUi().createMenu('취식 관리');
  // 점포마다 전산 비밀번호가 따로 있음: menuSetPassword, menuSetPassword2, menuSetPassword3 (STORES 순서)
  posStores_().forEach(function (st) {
    var i = STORES.indexOf(st);
    if (i < 3) menu.addItem(CHAINS[st.chain].system + ' 비밀번호 입력 · ' + st.name, 'menuSetPassword' + (i ? i + 1 : ''));
  });
  menu.addItem('오늘 폐기·저회전 지금 가져오기', 'menuLiveNow')
    .addItem('어제 폐기·저회전 지금 가져오기', 'nightly')
    .addItem('기간 지정해서 가져오기', 'menuImportRange')
    .addItem('저회전 지난 날짜 모두 가져오기 (' + STORES[0].short + ')', 'menuJeoBackfill')
    .addItem('월 마감 다시 하기 (지난 달 합계를 지금 숫자로)', 'menuReclose')
    .addSeparator()
    .addItem('지금 백업하기', 'menuBackupNow')
    .addItem('백업에서 되살리기', 'menuRestore')
    .addSeparator()
    .addItem('매일 자동 가져오기 켜기', 'installNightlyTrigger')
    .addItem('실시간 가져오기 켜기 (5분마다 + 링크 열려 있으면 1분마다)', 'menuLiveOn')
    .addItem('실시간 가져오기 끄기', 'menuLiveOff')
    .addSeparator()
    .addItem('개발자 비밀번호 설정', 'menuSetDevPw')
    .addItem('직원 비밀번호 지우기', 'menuClearMemberPw')
    .addSeparator()
    .addItem('접근 계정 (허용 · 끊기)', 'menuAccounts')
    .addItem('모든 폰 다시 로그인하게 하기', 'menuAccessRevokeAll')
    .addToUi();
}

/** Stores that can import now (adapter + password). */
function importStores_() { return onStores_().filter(function (st) { return !!importer_(st); }); }

/**
 * Menu helper: which store? One store → that one, no question. More → a prompt with numbers.
 * all = true lets the owner leave it empty for every store. Returns a list of stores, or null when canceled.
 */
function askStores_(ui, list, all) {
  if (list.length <= 1) return list;
  var text = list.map(function (st, i) { return (i + 1) + ' = ' + st.name; }).join('\n') + (all ? '\n\n비워 두면 모든 점포' : '');
  var r = ui.prompt('어느 점포인가요?', text, ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return null;
  var v = r.getResponseText().trim();
  if (!v && all) return list;
  var st = list[Number(v) - 1];
  if (!st) { ui.alert('번호를 적어 주세요. 예: 1'); return null; }
  return [st];
}

function menuLiveNow() {
  var ui = SpreadsheetApp.getUi();
  var sts = importStores_();
  if (!sts.length) { ui.alert('전산 비밀번호가 들어 있는 점포가 없어요. 먼저 비밀번호를 입력해 주세요.'); return; }
  ui.alert(sts.map(function (st) {
    var r = inStore_(st, liveImport_);
    return st.name + ': ' + (r.error ? '가져오지 못했어요 (' + r.error + ')' : '새 품목 ' + r.added + '건 추가 (' + (r.ms / 1000).toFixed(1) + '초)');
  }).join('\n'));
}
function menuJeoBackfill() {
  var ui = SpreadsheetApp.getUi();   // first: throws when called from the web page
  pdel_('JEO_BACKFILL', STORES[0]);
  var r = inStore_(STORES[0], function () { return jeoBackfill_(null, true); });
  ui.alert(r.error ? JEO + ' 가져오지 못했어요:\n' + r.error : JEO + ' ' + r.range + ': 전표 ' + r.chits + '장, 새 품목 ' + r.added + '건 추가');
}
function menuReclose() {
  var ui = SpreadsheetApp.getUi();   // first: throws when called from the web page
  var sts = askStores_(ui, onStores_(), false);
  if (!sts || !sts.length) return;
  var r = ui.prompt('월 마감 다시 하기 · ' + sts[0].name, '어느 달인가요? 예: 2026-10\n그 달 합계를 지금 폐기목록 숫자로 다시 적어요.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var m = r.getResponseText().replace(/\s/g, '');
  if (!/^\d{4}-\d\d$/.test(m) || m > closeTarget_()) { ui.alert('지난 달을 2026-10 처럼 적어 주세요. (이번 달은 마감 전이에요)'); return; }
  ui.alert(inStore_(sts[0], function () { return closeMonth_(m); }));
}
function menuLiveOn() {
  var ui = SpreadsheetApp.getUi();   // first: throws when called from the web page
  gdel_('LIVE_OFF');
  installLiveTrigger_();
  ui.alert('실시간 가져오기를 켰어요. 5분마다, 그리고 직원이 링크를 열어 두면 1분마다 오늘 폐기를 가져옵니다.');
}
function menuLiveOff() {
  var ui = SpreadsheetApp.getUi();   // first: throws when called from the web page
  gset_('LIVE_OFF', '1');
  removeLiveTrigger_();
  ui.alert('실시간 가져오기를 껐어요. 매일 밤 00:01 가져오기는 그대로 돌아갑니다.');
}

/* 전산 비밀번호: one menu item per store (a menu item can't carry an argument, so one small function each). */
function menuSetPassword() { menuSetPasswordFor_(SpreadsheetApp.getUi(), STORES[0]); }
function menuSetPassword2() { menuSetPasswordFor_(SpreadsheetApp.getUi(), STORES[1]); }
function menuSetPassword3() { menuSetPasswordFor_(SpreadsheetApp.getUi(), STORES[2]); }
function menuSetPasswordFor_(ui, st) {
  var ch = st && st.on && CHAINS[st.chain];
  if (!ch || !ch.check) { ui.alert('이 점포는 아직 전산 연결이 준비되지 않았어요.'); return; }
  var r = ui.prompt(st.name + ' · ' + ch.system + ' 비밀번호', '아이디 ' + st.userNo + ' 의 비밀번호를 입력하세요. 이 스프레드시트의 스크립트 설정에만 저장됩니다.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var pw = r.getResponseText().trim();
  if (!pw) return;
  pset_(ch.pwKey, pw, st);
  try {
    var who = inStore_(st, function () { CacheService.getScriptCache().remove(ck_('bgf_session')); return ch.check(); });
    ui.alert('로그인 확인 완료 (' + who + '). 이제 자동으로 가져옵니다.\n지난 날짜는 메뉴 [기간 지정해서 가져오기]로 가져올 수 있어요.');
  } catch (e) {
    ui.alert('비밀번호는 저장했지만 로그인 확인에 실패했어요:\n' + e.message);
  }
}

function menuImportRange() {
  var ui = SpreadsheetApp.getUi();
  var sts = askStores_(ui, importStores_(), true);
  if (!sts) return;
  if (!sts.length) { ui.alert('전산 비밀번호가 들어 있는 점포가 없어요. 먼저 비밀번호를 입력해 주세요.'); return; }
  var r = ui.prompt('기간 지정해서 가져오기', '예: 20261101-20261107  (하루만: 20261105)', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var m = r.getResponseText().replace(/\s/g, '').match(/^(\d{8})(?:-(\d{8}))?$/);
  if (!m) { ui.alert('형식이 맞지 않아요. 예: 20261101-20261107'); return; }
  ui.alert(sts.map(function (st) {
    try { return st.name + '\n' + inStore_(st, function () { return importRange_(m[1], m[2] || m[1]); }); }
    catch (e) { return st.name + '\n가져오지 못했어요: ' + e.message; }
  }).join('\n\n'));
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
  gset_('LIVE_TRIGGER', String(LIVE_TRIGGER_MIN));
  return LIVE_TRIGGER_MIN + '분마다 오늘 폐기 가져오기가 켜졌어요.';
}
function removeLiveTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'liveTick') ScriptApp.deleteTrigger(t);
  });
  gdel_('LIVE_TRIGGER');
}

/**
 * Time trigger (every LIVE_TRIGGER_MIN): 자동 퇴근 catch-up for every store, then 오늘(과 어제) 새 전표 for
 * ONE store: the one read longest ago. So with N stores each is read every N × 5 min while nobody has
 * the page open (an open page asks for its own store every minute), and the trigger's daily runtime
 * stays what it was with one store (Apps Script allows 90 min a day).
 */
function liveTick(e) {
  if (!fromTrigger_(e)) adminOnly_();
  onStores_().forEach(function (st) { try { inStore_(st, autoOutAll_); } catch (x) {} });
  closeAll_();
  try { inStore_(STORES[0], octOnce_); } catch (x) {}
  var sts = importStores_().sort(function (a, b) { return Number(pget_('LIVE_AT', a) || 0) - Number(pget_('LIVE_AT', b) || 0); });
  if (sts.length) inStore_(sts[0], liveGate_);
  else liveGate_();   // keeps the trigger bookkeeping (LIVE_TRIGGER) right even with nothing to read
}

/** Hand edits in the spreadsheet (owner): bump that store's data version so open pages and the month cache follow. */
function onEdit(e) {
  try {
    var name = e.range.getSheet().getName();
    onStores_().forEach(function (st) {
      if (![SH_ITEMS, SH_MEMBERS, SH_SHIFTS, SH_CLOSE].some(function (b) { return sheetName_(b, st) === name; })) return;
      var v = nextVer_(st);
      pset_('VER', v, st);
      if (name !== sheetName_(SH_MEMBERS, st)) pset_('SVER', v, st);
    });
  } catch (x) {}
}

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

/** Yesterday and the day before, for every store that can import. One store failing doesn't stop the next. */
function nightly(e) {
  var trig = fromTrigger_(e);
  if (!trig) adminOnly_();
  var now = new Date();
  var d1 = ymd_(new Date(now.getTime() - 24 * 3600 * 1000));
  var d2 = ymd_(new Date(now.getTime() - 2 * 24 * 3600 * 1000));
  var out = [], err = null;
  importStores_().forEach(function (st) {
    try { out.push(st.name + ' ' + inStore_(st, function () { return importRange_(d2, d1); })); }
    catch (x) { err = err || x; out.push(st.name + ' 실패: ' + x.message); }
  });
  closeAll_();
  try { out.push('백업: ' + backupNightly_().map(function (b) { return b.name.replace(BAK_PREFIX, '') + ' ' + b.sheets + '시트'; }).join(', ')); }
  catch (x) { err = err || x; out.push('백업 실패: ' + x.message); }
  if (err) throw new Error(out.join('\n'));
  return out.join('\n');
}

/** Editor only: this month so far, every store that can import. */
function importThisMonth() {
  adminOnly_();
  var now = new Date();
  var first = Utilities.formatDate(now, TZ, 'yyyyMM') + '01';
  return importStores_().map(function (st) {
    return st.name + ' ' + inStore_(st, function () { return importRange_(first, ymd_(now)); });
  }).join('\n');
}

/** Full re-read of a date range for the current store (its chain adapter's range()). */
function importRange_(fromYmd, toYmd) {
  var st = store_();
  try {
    var ch = importer_(st);
    if (!ch) throw new Error(importWait_(st) === 'pw' ? '전산 비밀번호가 아직 없어요. 메뉴 [취식 관리]에서 넣어 주세요.' : '이 점포는 아직 전산 연결이 준비되지 않았어요.');
    var r = ch.range(fromYmd, toYmd);
    var added = appendItems_(r.items);
    var msg = fromYmd + '~' + toYmd + ': 전표 ' + r.chits + '장 (' + JEO + ' ' + r.jeoChits + '장), 새 품목 ' + added + '건 추가' +
      (r.jeoErr ? '\n' + JEO + ' 가져오기 실패: ' + r.jeoErr : '');
    logImport_(fromYmd + '~' + toYmd, r.chits, added, 'OK' + jeoNote_(r));
    return msg;
  } catch (e) {
    logImport_(fromYmd + '~' + toYmd, '', '', '실패: ' + e.message);
    try {
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '[직원 취식 목록] ' + st.name + ' 폐기 가져오기 실패',
        st.name + ' ' + fromYmd + '~' + toYmd + ' 폐기 목록을 가져오지 못했어요.\n\n' + e.message +
        '\n\n스프레드시트 메뉴 [취식 관리 > 기간 지정해서 가져오기]로 다시 시도할 수 있어요.');
    } catch (e2) {}
    throw e;
  }
}

/** 폐기목록 sheet of the current store, with every column in place (adds the 전표 column to sheets made before it existed). */
function itemsSheet_() {
  var sh = sheet_(SH_ITEMS);
  if (!store_().legacy) return sh;   // made complete by storeSheets_
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
      bumpVersion_(true);
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
  access_();
  if (store_().legacy) octOnce_();
  try { autoOutAll_(); } catch (e) {}
  return liveGate_();
}

/** One time (first store only): October 2026 취식 + 근무 (Oct2026.gs); a failed try waits 10 min. */
function octOnce_() {
  if ((gget_('OCT_APPLY') !== '1' || gget_('OCT_APPLY2') !== '1') && gget_('OCT_IMPORT') === '1' && typeof octApplyAll_ === 'function' &&
      Date.now() - Number(gget_('OCT_APPLY_TRY') || 0) > 600 * 1000) {
    gset_('OCT_APPLY_TRY', String(Date.now()));
    try { octApplyAll_(); } catch (e) { logImport_('2026-10 (10월 취식·근무 넣기)', '', '', '실패: ' + String(e && e.message || e).slice(0, 200)); }
    PSNAP_ = null;   // Oct2026.gs writes its flags itself
  }
}

/** The throttle in front of liveImport_ for the current store. Returns liveInfo_. */
function liveGate_() {
  if (gget_('LIVE_OFF') === '1') return liveInfo_(0);
  // LIVE_TRIGGER holds the trigger's minutes, so changing LIVE_TRIGGER_MIN reinstalls it
  if (gget_('LIVE_TRIGGER') !== String(LIVE_TRIGGER_MIN)) { try { installLiveTrigger_(); } catch (e) {} }
  if (!importer_()) return liveInfo_(0);   // 전산 비밀번호가 아직 없거나 연결이 준비 안 된 점포
  if (Date.now() - Number(pget_('LIVE_AT') || 0) < LIVE_MIN_GAP_S * 1000) return liveInfo_(0);
  var cache = CacheService.getScriptCache();
  if (cache.get(ck_('live_running'))) return liveInfo_(0);
  cache.put(ck_('live_running'), '1', 90);
  var r;
  try { r = liveImport_(); } finally { cache.remove(ck_('live_running')); }
  return liveInfo_(r.added);
}

/** Fetch yesterday..today for the current store, only slips we don't have yet. Never throws. */
function liveImport_() {
  var st = store_();
  var t0 = Date.now();
  pset_('LIVE_AT', String(t0));
  var now = new Date(t0);
  var from = ymd_(new Date(t0 - 24 * 3600 * 1000)), to = ymd_(now);
  try {
    var ch = importer_(st);
    if (!ch) throw new Error('전산 비밀번호가 아직 없어요.');
    var r = ch.live(from, to, knownChits_());
    var added = appendItems_(r.items);
    var ms = Date.now() - t0;
    pset_('LIVE_OK_AT', String(t0)); pset_('LIVE_MS', String(ms));
    if (pget_('LIVE_ERR')) pset_('LIVE_ERR', '');
    // 저회전 failures are logged once per streak (JEO_ERR), and never stop the 폐기 import
    var jeoErrBefore = pget_('JEO_ERR');
    if (jeoErrBefore !== (r.jeoErr || '')) pset_('JEO_ERR', r.jeoErr || '');
    if (added || (r.jeoErr && !jeoErrBefore)) {
      logImport_(from + '~' + to + ' (실시간)', r.chits, added, 'OK · ' + (ms / 1000).toFixed(1) + '초, 상세 ' + r.fetched + '장' + jeoNote_(r));
    }
    // one-time catch-ups of the first store (from before 저회전 import / before November)
    if (st.legacy) {
      if (!r.jeoErr) added += jeoBackfill_(r.session, false).added || 0;
      added += octImport_(r.session).added || 0;
    }
    return { added: added, ms: Date.now() - t0 };
  } catch (e) {
    var msg = String(e && e.message || e).slice(0, 200);
    if (!pget_('LIVE_ERR')) logImport_(from + '~' + to + ' (실시간)', '', '', '실패: ' + msg);
    pset_('LIVE_ERR', msg);
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
    var c = JSON.parse(CacheService.getScriptCache().get(ck_('bgf_session')) || 'null');
    if (!c || !c.jar || Date.now() - Number(c.at || 0) > BGF_SESSION_MIN * 60 * 1000) return null;
    var s = new Session_();   // its SS_* come from STORES / BGF_SS (saved at login)
    s.jar = c.jar;
    s.loginAt = Number(c.at);
    return s;
  } catch (e) { return null; }
}
function keepSession_(s, reused) {
  try {
    var at = reused && s.loginAt ? s.loginAt : Date.now();
    CacheService.getScriptCache().put(ck_('bgf_session'), JSON.stringify({ jar: s.jar, at: at }), BGF_SESSION_MIN * 60);
  } catch (e) {}
}

/** Header label of the current store: last good import, and why there is none yet (wait: 'pw' / 'adapter'). */
function liveInfo_(added) {
  var ok = Number(pget_('LIVE_OK_AT') || 0);
  var label = '';
  if (ok) {
    var d = new Date(ok);
    label = Utilities.formatDate(d, TZ, 'yyyy-MM-dd') === Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd')
      ? Utilities.formatDate(d, TZ, 'HH:mm') : Utilities.formatDate(d, TZ, 'M/d HH:mm');
  }
  return { label: label, off: gget_('LIVE_OFF') === '1', error: pget_('LIVE_ERR') ? true : false, added: added || 0, wait: importWait_() };
}

/** { CHIT_NO: number of lines already in the sheet } */
function knownChits_() {
  var sh = sheet_(SH_ITEMS);
  var n = sh.getLastRow() - 1, out = {};
  if (n > 0) sh.getRange(2, C.CHIT, n, 1).getDisplayValues().forEach(function (r) { if (r[0]) out[r[0]] = (out[r[0]] || 0) + 1; });
  return out;
}

/** 가져오기 기록 is shared: lines of every store but the first start with [점포]. */
function logImport_(range, chits, added, result) {
  var log = doc_().getSheetByName(SH_LOG), st = store_();
  if (log) log.appendRow([Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'), (st.legacy ? '' : '[' + st.short + '] ') + range, chits, added, result]);
}

/* ======================= BGF 점포시스템 통신 (Nexacro SSV) ======================= */

var RS = '\x1e', US = '\x1f';
/* The SS_* store variables BGF's own page sends with every call, in its order. The first store's values are
 * written in STORES (captured from the browser). Any other CU store gets them from its login answer. */
var SS_KEYS = ['SS_STORE_CD', 'SS_PRE_STORE_CD', 'SS_STORE_NM', 'SS_SLC_CD', 'SS_LOC_CD', 'SS_ADM_SECT_CD', 'SS_STORE_OWNER_NM', 'SS_STORE_POS_QTY',
  'SS_STORE_IP', 'SS_SV_EMP_NO', 'SS_SSTORE_ID', 'SS_RCV_ID', 'SS_FC_CD', 'SS_USER_GRP_ID', 'SS_USER_NO', 'SS_SGGD_CD', 'SS_LOGIN_USER_NO'];
var SS_B64 = { SS_STORE_NM: 1, SS_STORE_OWNER_NM: 1 };   // sent base64-encoded (Korean text)

/** [[SS_KEY, value], …] of a store: from STORES, else what its last login gave (Script Property BGF_SS_<id>), else the bare minimum. */
function ssVars_(st) {
  st = st || store_();
  if (st.ss) return st.ss;
  var saved = {};
  try { saved = JSON.parse(pget_('BGF_SS', st) || '{}') || {}; } catch (e) {}
  var base = { SS_STORE_CD: st.id, SS_USER_GRP_ID: '0001', SS_USER_NO: st.userNo, SS_LOGIN_USER_NO: st.userNo };
  return SS_KEYS.map(function (k) { return [k, saved[k] !== undefined && saved[k] !== '' ? String(saved[k]) : (base[k] || '')]; });
}

/**
 * After a login of a store whose SS_* values aren't written in STORES: take them from the login answer,
 * the way BGF's own page does (nexacro17lib/component/extPrototype.js, _gfn_loginCallback):
 * SS_X = column X of row 0 of GDS_JUMPO, for every key in SS_KEYS; STORE_NM and STORE_OWNER_NM base64-encoded.
 * A column the answer doesn't have keeps what we had (the jar) or the minimum. The result is kept in
 * Script Property BGF_SS_<id>, so a kept session (keptSession_) and the next login start from it.
 */
function bgfSsFromLogin_(s, r) {
  var st = s.st;
  var row = (r.ds.GDS_JUMPO || [])[0] || {};
  s.storeNm = String(row.STORE_NM || '');
  if (st.ss) return;
  var base = { SS_STORE_CD: st.id, SS_USER_GRP_ID: '0001', SS_USER_NO: st.userNo, SS_LOGIN_USER_NO: st.userNo };
  var out = {};
  SS_KEYS.forEach(function (k) {
    var v = row[k.slice(3)];
    if (v !== undefined && v !== null && String(v) !== '') out[k] = SS_B64[k] ? Utilities.base64Encode(String(v), Utilities.Charset.UTF_8) : String(v);
    else out[k] = String(s.jar[k] || base[k] || '');
  });
  s.ss = SS_KEYS.map(function (k) { return [k, out[k]]; });
  s.ss.forEach(function (kv) { if (kv[1]) s.jar[kv[0]] = kv[1]; });
  var json = JSON.stringify(out);
  if (pget_('BGF_SS', st) !== json) pset_('BGF_SS', json, st);
}

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

/** A BGF session (cookie jar) of one store. st: default = the current store. */
function Session_(st) {
  this.st = st || store_();
  this.ss = ssVars_(this.st);
  this.jar = {};
  this.ss.forEach(function (kv) { if (kv[1]) this.jar[kv[0]] = kv[1]; }, this);
  this.jar.GV_USERFLAG = 'HOME';
}
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

/** Logs the current store in to BGF (its own id and password) and returns the session. */
function bgfLogin_() {
  var st = store_();
  var pw = pget_('BGF_PW', st);
  if (!pw) throw new Error('BGF 비밀번호가 아직 없어요. 메뉴 [취식 관리 > BGF 점포시스템 비밀번호 입력]에서 넣어 주세요.');
  var s = new Session_(st);
  s.get('/websrc/deploy/index.html');
  var vars = [['GV_USERFLAG', 'HOME']].concat(s.ss).concat([
    ['USER_TYPE', '1'], ['CONN_PLACE', 'HOME'], ['GV_CHANNELTYPE', 'HOME'], ['LOGIN_STORE', ''], ['MULTI_YN', 'N'],
    ['RUNTIME_YN', '(일반)'], ['MULTI_STORE_TYPE', 'A'], ['PILOT_GROUP_YN', 'N'], ['PILOT_CONNECT_YN', 'N'],
    ['SC_AUTO_LOGIN_YN', 'undefined'],
    ['POS_ONE_MENU_LIST', 'STCM020_M0,STMS190_M0,STJS050_M1,STCM120_M0,STCM300_M0,STMB810_M0,STMB800_M0,STMB510_M0,STMB530_M0,STMB520_M0,STGJ300_M0'],
    ['GV_USERFLAG', 'HOME'], ['GV_CHANNELTYPE', 'HOME']
  ]);
  var body = ssvBuild_(vars, 'ds_login',
    ['USER_NO', 'PASSWD', 'USER_GRP_ID', 'GV_POSPARAM1', 'GV_POSPARAM2', 'GV_POSPARAM3', 'GV_POSPARAM4'],
    [st.userNo, pw, '0001', '', '', '', '']);
  var r = s.post('/login/login', body);
  var msg = (r.ds.GDS_MSG || [])[0];
  if (!r.ds.GDS_JUMPO || !r.ds.GDS_JUMPO.length) {
    throw new Error('로그인 실패' + (msg ? ': ' + (msg.MSG_CONT || JSON.stringify(msg)) : ''));
  }
  bgfSsFromLogin_(s, r);
  return s;
}

function svcVars_(s) {
  return [['GV_USERFLAG', 'HOME']].concat(s.ss).concat([
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
  var cached = gget_('JEO_DIV');   // a BGF-wide code: the same for every CU store
  if (cached) return cached;
  var code = '';
  try {
    var r = s.post('/stco010/selComCd', ssvVarsOnly_(svcVars_(s).concat([
      ['codeKeys', CHIT_DIV_CODE], ['selecttype', 'A'], ['col1', '%'], ['col2', '%'], ['col3', '%'], ['col4', '%'], ['col5', '%'], ['col6', '%']
    ])));
    Object.keys(r.ds).forEach(function (k) {
      (r.ds[k] || []).forEach(function (row) {
        if (!code && row.CODE && String(row.NAME || '').indexOf(JEO) >= 0) code = String(row.CODE);
      });
    });
  } catch (e) {}
  if (code) gset_('JEO_DIV', code);
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
  var storeCd = s.st.id;   // BGF 점포코드 (= SS_STORE_CD)
  s.ss.forEach(function (kv) { if (kv[0] === 'SS_STORE_CD' && kv[1]) storeCd = kv[1]; });
  var list = s.post('/stgj020/search', ssvBuild_(svcVars_(s), 'dsSearch',
    ['strDate', 'strStoreCd', 'strChitDiv', 'strChitNo', 'strChitYmd', 'strToDt', 'strFromDt'],
    ['', storeCd, divCode, '', '', toYmd, fromYmd]));
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
      var r = s.post('/stgj020/' + svc, ssvBuild_(svcVars_(s), 'dsSearch',
        ['strChitDiv', 'strChitNo', 'strChitNoList', 'strChitYmd', 'strStoreCd'],
        [chitId, '', "('" + chunk.join("','") + "')", ymd, storeCd]));
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
          qty: Number(d.QTY) || 0, wprice: Math.round(Number(d.WONGA_PRICE) || 0), wamt: Math.round(Number(d.WONGA_AMT) || 0),  // 원가 is whole won (BGF sends decimals)
          mprice: Number(d.MAEGA_PRICE) || 0, mamt: Number(d.MAEGA_AMT) || 0, chit: d.CHIT_NO, src: src || ''
        });
      });
    }
  });
  return { chits: chits.length, fetched: todo.length, items: items };
}

function ymd_(d) { return Utilities.formatDate(d, TZ, 'yyyyMMdd'); }

/* ======================= 웹앱 ======================= */

/*
 * One staff address (owner, 2026-11-25: "combine 2 urls into one"): the GitHub Pages copy (WEB_APP_URL, app/www).
 * GET /exec = Move.html, which sends the browser there with this phone's store and names (#move=…);
 * GET /exec?stay=1 = the staff page here, as before (fallback if GitHub Pages is down).
 * The apps (Android, iPhone page, z's Chwisik tab) use doPost / getPage, not this.
 */
var WEB_APP_URL = 'https://kiiwoom8.github.io/chwisik/';
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.allow) return allowPage_(p);   // the owner's 허용 link from the access-request mail
  if (p.stay === '1') {
    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('직원 취식 목록')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  var t = HtmlService.createTemplateFromFile('Move');
  t.url = WEB_APP_URL;
  t.store = /^[\w-]{1,24}$/.test(String(p.store || '')) ? String(p.store) : '';
  return t.evaluate().setTitle('취식 주소가 바뀌었어요').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ---------- 접근 (Google 계정) ----------
 * The page and this server's address are public (GitHub Pages, public repo, the APK), so every data call needs a
 * device key, and a phone gets one only for a Google account the owner allowed (owner, 2026-11-25: "instead of
 * 접근코드 or apk access, allow permission through google account. once the account is allowed, always allow the
 * account"). docs/DEVNOTES.md, Access.
 *
 * Sign-in: the page makes a random nonce, opens LOGIN_PAGE?n=<nonce> (GitHub Pages, app/www/login.html; in a new tab,
 * or the phone's browser for the Android app, since Google sign-in doesn't work inside an app's WebView). That page
 * sends the tab to Google's account chooser (OpenID Connect, client GOOGLE_CLIENT_ID, nonce = n; no popup) and gets an
 * ID token back, posted here with the nonce (gLogin): Google's tokeninfo checks it (and its nonce), and nonce -> email
 * is kept 6 h. The page asks gPoll(nonce) until the
 * account is allowed and then gets its device key.
 * Accounts: Script Property ACCOUNTS = {email: {s: 'ok' | 'wait' | 'no', t: first seen, a: allowed at, n: note}};
 * the names shown with them: ACCNAMES (see setAccName).
 * The owner (the account this script runs as) is always allowed. A new account is 'wait' and the owner gets a mail
 * with a 허용 link (/exec?allow=…&s=…, signed with ALLOW_KEY). Once 'ok' it stays allowed on every phone until the
 * owner cuts it (menu 접근 계정).
 * Device key = 'g:<email>:<sig>', sig = HMAC(ACCESS_KEY, 'g|' + email). Every call checks the sig AND that the account
 * is still allowed, so cutting an account stops its phones at once. Nothing is stored per phone.
 * Open without a key: getPage (the page source is public anyway), gLogin, gPoll.
 * Direct google.script.run calls to the data functions are refused too: they check ACCESS_ (set only by api()
 * / doPost() after the key check; every execution starts with it false).
 * Script Property ACCESS_OFF = '1' turns the check off (emergency switch; the tests use it). */
var GOOGLE_CLIENT_ID = '274035594907-i92r76rlpp0c9h1dt79bm6fcheb77b44.apps.googleusercontent.com';   // Google Cloud project chwisik (noerror96), public value
var LOGIN_PAGE = WEB_APP_URL + 'login.html';
var EXEC_URL = 'https://script.google.com/macros/s/AKfycbzmsekRKq8HY5jqog-Dpb80yJqv-n3H4fZMItLZPISuM39M6RVyr3qOtqtz864YwlRKpw/exec';
/* Phones that came in with the old 접근 코드 / APK key: their account is allowed by itself on its first Google sign-in
 * (they were invited already), until this day (KST). After it, a new account always waits for the owner. */
var ACCESS_OLD_UNTIL = '2026-12-09';
var ACCESS_TAG = '[접근]';
var ACCESS_ = false;
var CALLER_ = '';   // the account of this execution's device key ('' = none / not a good key); set with ACCESS_
var OPEN_FNS_ = ['getPage', 'gLogin', 'gPoll'];
var NONCE_RE_ = /^[A-Za-z0-9_-]{22,64}$/;
function accessOff_() { return gget_('ACCESS_OFF') === '1'; }
function ownerEmail_() {
  try { return String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); } catch (e) { return ''; }
}
function accounts_() {
  try { return JSON.parse(gget_('ACCOUNTS') || '{}') || {}; } catch (e) { return {}; }
}
/** 'ok' | 'wait' | 'no' | '' (never seen). */
function accountState_(email) {
  if (!email) return '';
  if (email === ownerEmail_()) return 'ok';
  var a = accounts_()[email];
  return a ? a.s : '';
}
/** Change ACCOUNTS under the script lock, starting from the stored value (another run may have changed it). */
function setAccount_(email, s, note) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var acc;
    try { acc = JSON.parse(ps_().getProperty('ACCOUNTS') || '{}') || {}; } catch (e) { acc = {}; }
    var a = acc[email] || { t: Date.now() };
    a.s = s;
    if (s === 'ok') a.a = Date.now();
    if (note) a.n = note;
    acc[email] = a;
    // at most 40 waiting requests (oldest dropped): strangers can't fill the property up
    var wait = Object.keys(acc).filter(function (k) { return acc[k].s === 'wait'; }).sort(function (x, y) { return acc[x].t - acc[y].t; });
    while (wait.length > 40) delete acc[wait.shift()];
    gset_('ACCOUNTS', JSON.stringify(acc));
  } finally {
    lock.releaseLock();
  }
}
function accSig_(email) { return b64_(Utilities.computeHmacSha256Signature('g|' + email, secret_('ACCESS_KEY'))).slice(0, 32); }
function accDev_(email) { return 'g:' + email + ':' + accSig_(email); }
/** The account a device key was made for ('' = not a good key). */
function devEmail_(dev) {
  var m = /^g:([^:\s]{3,254}):([A-Za-z0-9_-]{32})$/.exec(String(dev || ''));
  return m && m[2] === accSig_(m[1]) ? m[1] : '';
}
/** A key from the 접근 코드 days ('id.sig'), only for ACCESS_OLD_UNTIL. */
function oldDevOk_(dev) {
  var m = /^([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{32})$/.exec(String(dev || ''));
  return !!m && m[2] === b64_(Utilities.computeHmacSha256Signature('dev|' + m[1], secret_('ACCESS_KEY'))).slice(0, 32);
}
/** api() / doPost(): a good device key of an allowed account opens the data functions for this execution. */
function checkAccess_(fn, dev) {
  CALLER_ = devEmail_(dev);
  if (CALLER_ && accountState_(CALLER_) !== 'ok') CALLER_ = '';
  ACCESS_ = accessOff_() || !!CALLER_;
  if (!ACCESS_ && OPEN_FNS_.indexOf(fn) < 0) throw new Error(ACCESS_TAG + ' Google 계정으로 들어와 주세요.');
}
/** The caller signed in with the owner's Google account (the account this script runs as). ACCESS_OFF doesn't
 * count: the 접근 계정 screen always needs the owner's own device key. */
function ownerCaller_() { return !!CALLER_ && CALLER_ === ownerEmail_(); }
function ownerOnly_() {
  access_();
  if (!ownerCaller_()) throw new Error('[관리자] 사장님 Google 계정으로 들어온 폰에서만 할 수 있어요.');
}
/** First line of every data function anyone could call. */
function access_() {
  if (!ACCESS_ && !accessOff_()) throw new Error(ACCESS_TAG + ' Google 계정으로 들어와 주세요.');
}
/** Google's ID token (LOGIN_PAGE, OpenID Connect with nonce = the phone's nonce) -> the account's email, checked by
 * Google's tokeninfo; the token must carry this nonce, so a token can't be replayed for another phone. */
function idTokenEmail_(cred, nonce) {
  if (!/\.apps\.googleusercontent\.com$/.test(GOOGLE_CLIENT_ID)) throw new Error('Google 로그인이 아직 설정되지 않았어요. 사장님께 알려 주세요.');
  cred = String(cred || '');
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(cred) || cred.length > 4096) throw new Error('Google 로그인을 확인하지 못했어요. 다시 해 주세요.');
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(cred), { muteHttpExceptions: true });
  var t = {};
  try { t = JSON.parse(res.getContentText()) || {}; } catch (e) {}
  if (res.getResponseCode() !== 200 || t.aud !== GOOGLE_CLIENT_ID || !/^(https:\/\/)?accounts\.google\.com$/.test(String(t.iss)) ||
      String(t.email_verified) !== 'true' || !t.email || Number(t.exp) * 1000 < Date.now() || t.nonce !== nonce) {
    throw new Error('Google 로그인을 확인하지 못했어요. 다시 해 주세요.');
  }
  return String(t.email).trim().toLowerCase();
}
/** LOGIN_PAGE: nonce + ID token -> remember who signed in for that nonce; a new account asks the owner. */
function gLogin(n, cred) {
  if (!NONCE_RE_.test(String(n || ''))) throw new Error('이 화면은 취식 앱의 [Google 계정으로 들어가기] 버튼으로 열어 주세요.');
  var email = idTokenEmail_(cred, String(n));
  CacheService.getScriptCache().put('gl:' + n, email, 21600);
  var s = accountState_(email);
  if (autoAllow_() && (!s || s === 'wait')) {   // 자동 허용 window: in at once (a cut account stays cut)
    setAccount_(email, 'ok', '자동 허용');
    if (!s) notifyOwner_(email, true);
    s = 'ok';
  } else if (!s) { setAccount_(email, 'wait'); s = 'wait'; notifyOwner_(email); }
  return { s: s, email: email };
}
/** The page, every few seconds after opening LOGIN_PAGE: {s: 'none'} (no sign-in yet) | 'wait' | 'no' | 'ok' + dev. */
function gPoll(n, old) {
  var email = NONCE_RE_.test(String(n || '')) ? CacheService.getScriptCache().get('gl:' + n) : null;
  if (!email) return { s: 'none' };
  var s = accountState_(email);
  if (s === 'wait' && autoAllow_()) { setAccount_(email, 'ok', '자동 허용'); s = 'ok'; }
  if (s === 'wait' && oldDevOk_(old) && Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd') <= ACCESS_OLD_UNTIL) {
    setAccount_(email, 'ok', '접근 코드 쓰던 폰');
    s = 'ok';
  }
  return s === 'ok' ? { s: 'ok', email: email, dev: accDev_(email) } : { s: s || 'wait', email: email };
}
function allowSig_(email) { return b64_(Utilities.computeHmacSha256Signature('allow|' + email, secret_('ALLOW_KEY'))).slice(0, 32); }
/** Mail to the owner with a 허용 link (at most 20 a day); auto = let in by 자동 허용, the mail only tells. */
function notifyOwner_(email, auto) {
  var cache = CacheService.getScriptCache(), sent = Number(cache.get('glMail') || 0);
  if (sent >= 20) return;
  cache.put('glMail', String(sent + 1), 86400);
  var link = EXEC_URL + '?allow=' + encodeURIComponent(email) + '&s=' + allowSig_(email);
  try {
    if (auto) {
      MailApp.sendEmail(ownerEmail_(), '[직원 취식 목록] 자동 허용: ' + email,
        email + ' 계정이 취식 앱에 들어왔어요. 새 요청 자동 허용이 켜져 있어서 바로 허용했어요 (' + autoUntilText_() + '까지).\n\n' +
        '모르는 계정이면 취식 앱의 더보기 > 접근 계정 에서 [끊기]를 누르세요. 자동 허용도 거기서 끌 수 있어요.');
      return;
    }
    MailApp.sendEmail(ownerEmail_(), '[직원 취식 목록] 접근 요청: ' + email,
      email + ' 계정이 취식 앱에 들어오려고 해요.\n\n아는 사람이면 아래 링크에서 [허용]을 누르세요. 한 번 허용하면 그 계정은 어느 폰에서든 계속 들어와요.\n' +
      link + '\n\n모르는 계정이면 그냥 두세요 (들어오지 못해요). 취식 앱의 더보기 > 접근 계정, 시트 메뉴 취식 관리 > 접근 계정 에서도 허용하고 끊을 수 있어요.');
  } catch (e) {}
}
/** The page behind the mail link: one button -> allowAccount. */
function allowPage_(p) {
  var email = String(p.allow || '').trim().toLowerCase(), ok = String(p.s || '') === allowSig_(email);
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); };
  var js = function (v) { return JSON.stringify(v).replace(/</g, '\\u003c'); };
  var body = !ok ? '<p>링크가 맞지 않아요. 메일의 링크를 그대로 눌러 주세요.</p>' :
    (accountState_(email) === 'ok' ? '<p><b>' + esc(email) + '</b> 계정은 이미 허용돼 있어요.</p>' :
    '<p><b>' + esc(email) + '</b> 계정을 취식 앱에 들어오게 할까요?<br>한 번 허용하면 어느 폰에서든 계속 들어와요.</p>' +
    '<button id="b">허용</button><p id="m" role="status"></p><script>document.getElementById("b").onclick=function(){var b=this,m=document.getElementById("m");' +
    'b.disabled=true;m.textContent="허용하는 중…";google.script.run.withSuccessHandler(function(){m.textContent="허용했어요. 그 폰에서 바로 들어가져요.";b.hidden=true;})' +
    '.withFailureHandler(function(e){b.disabled=false;m.textContent=(e&&e.message)||"다시 해 주세요.";}).allowAccount(' + js(email) + ',' + js(String(p.s)) + ');};</script>');
  return HtmlService.createHtmlOutput('<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font:16px/1.6 system-ui,sans-serif;max-width:420px;margin:0 auto;padding:24px 16px;color:#19201c}' +
    'b{word-break:break-all}button{min-height:44px;min-width:120px;border:0;border-radius:10px;background:#1f7a4d;color:#fff;font:inherit;font-weight:700;cursor:pointer}</style></head><body><h2>취식 앱 접근 허용</h2>' +
    body + '</body></html>').setTitle('접근 허용').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function allowAccount(email, sig) {
  email = String(email || '').trim().toLowerCase();
  if (!email || String(sig || '') !== allowSig_(email)) throw new Error('링크가 맞지 않아요.');
  if (accountState_(email) !== 'ok') setAccount_(email, 'ok', '메일 링크로 허용');
  return true;
}
/* The page's 접근 계정 screen (더보기 > 접근 계정): only on a phone signed in with the owner's account (ownerOnly_);
 * getInit tells the page (admin) so nobody else ever sees the menu item. Same ACCOUNTS as the menu and the mail link. */
var EMAIL_RE_ = /^[^@\s:]{1,64}@[^@\s:]{1,190}\.[^@\s:]{2,}$/;
/** {owner, own: {nm, u}, list: [{e, s, t (first seen), a (allowed at), n (note), nm (the owner's name for it), u (the name it
 * used most, accName_)}]}: waiting first, then allowed, then cut; newest first. The page shows nm, else u. */
function getAccounts() {
  ownerOnly_();
  var acc = accounts_(), names = accNames_(), rank = { wait: 0, ok: 1, no: 2 }, own = ownerEmail_();
  var nm = function (e) { var o = names[e] || {}; return { nm: o.nm || '', u: accName_(o) }; };
  var list = Object.keys(acc).filter(function (e) { return e !== own && rank[acc[e].s] !== undefined; }).map(function (e) {
    var a = acc[e], n = nm(e);
    return { e: e, s: a.s, t: a.t || 0, a: a.a || 0, n: a.n || '', nm: n.nm, u: n.u };
  });
  list.sort(function (x, y) { return rank[x.s] - rank[y.s] || (y.s === 'ok' ? y.a - x.a : y.t - x.t) || (x.e < y.e ? -1 : 1); });
  return { owner: own, own: nm(own), list: list, auto: autoAllowCfg_() };
}
/** s: 'ok' (허용; a new email = allowed ahead of time), 'no' (끊기: its phones stop at once), 'del' (지우기 from the list). */
function setAccess(email, s) {
  ownerOnly_();
  email = String(email || '').trim().toLowerCase();
  s = String(s || '');
  if (email === ownerEmail_()) throw new Error('사장님 계정은 늘 들어와요.');
  if (!EMAIL_RE_.test(email)) throw new Error('Google 계정 이메일을 적어 주세요. 예: name@gmail.com');
  if (s === 'del') delAccount_(email);
  else if (s === 'ok' || s === 'no') {
    var cur = accountState_(email);
    if (cur !== s) setAccount_(email, s, s === 'ok' ? (cur ? '앱에서 허용' : '미리 허용') : '');
  } else throw new Error('알 수 없는 요청이에요.');
  return getAccounts();
}
/** The owner's name for an account (the owner's own too); '' = back to the most-used name. */
function setAccName(email, name) {
  ownerOnly_();
  email = String(email || '').trim().toLowerCase();
  name = String(name || '').replace(/\s+/g, ' ').replace(/^[=+\-@]+/, '').trim();
  if (name.length > 20) throw new Error('이름은 20자까지 적어 주세요.');
  if (email !== ownerEmail_() && !accounts_()[email]) throw new Error('목록에 없는 계정이에요. 새로고침해 주세요.');
  editNames_(function (all) {
    var o = all[email] || {};
    if (name) o.nm = name; else delete o.nm;
    if (Object.keys(o).length) all[email] = o; else delete all[email];
  });
  return getAccounts();
}
/* 새 요청 자동 허용 (owner, 2026-11-28: "for the next 48 hours, allow every google account request automatically ...
 * in that period the new users can access right after google login"). Script Property AUTO_ALLOW = {u: until ms, h: hours
 * chosen}; while now < u a new or waiting account is allowed on its Google sign-in (note 자동 허용), so login.html goes
 * straight in. A cut account stays cut. Turning it on also allows every account waiting now. Ends by itself at u. */
var AUTO_HOURS_ = [12, 24, 48, 168];
function autoAllowCfg_() {
  var c;
  try { c = JSON.parse(gget_('AUTO_ALLOW') || 'null'); } catch (e) { c = null; }
  return c && Number(c.u) > Date.now() ? { u: Number(c.u), h: Number(c.h) || 0 } : null;
}
function autoAllow_() { return !!autoAllowCfg_(); }
function autoUntilText_() {
  var c = autoAllowCfg_();
  return c ? Utilities.formatDate(new Date(c.u), 'Asia/Seoul', 'M/d HH:mm') : '';
}
/** hours: one of AUTO_HOURS_ (that long from now) or 0 (off). On: every waiting account is allowed too. Returns getAccounts(). */
function setAutoAllow(hours) {
  ownerOnly_();
  var h = Number(hours) || 0;
  if (h && AUTO_HOURS_.indexOf(h) < 0) throw new Error('알 수 없는 시간이에요.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!h) gdel_('AUTO_ALLOW');
    else {
      var now = Date.now(), acc, n = 0;
      gset_('AUTO_ALLOW', JSON.stringify({ u: now + h * 3600000, h: h }));
      try { acc = JSON.parse(ps_().getProperty('ACCOUNTS') || '{}') || {}; } catch (e) { acc = {}; }
      Object.keys(acc).forEach(function (e) { if (acc[e].s === 'wait') { acc[e].s = 'ok'; acc[e].a = now; acc[e].n = '자동 허용'; n++; } });
      if (n) gset_('ACCOUNTS', JSON.stringify(acc));
    }
  } finally {
    lock.releaseLock();
  }
  return getAccounts();
}

/* Names on the 접근 계정 screen: Script Property ACCNAMES = {email: {c: {전체 이름: [count, last ms]}, nm: owner's name}}.
 * Every 취식/폐기 tag and 출근 save or delete counts the name it was made with for the caller's account; the screen
 * shows the owner's name for the account, else the name it used most (accName_). */
var ACC_NAMES_MAX_ = 8;   // names kept per account (the least used goes)
function accNames_() {
  try { return JSON.parse(gget_('ACCNAMES') || '{}') || {}; } catch (e) { return {}; }
}
/** The most-used name of one ACCNAMES entry (a tie: the latest); '' = none yet. */
function accName_(o) {
  var c = (o && o.c) || {}, best = '';
  Object.keys(c).forEach(function (k) { if (!best || c[k][0] > c[best][0] || (c[k][0] === c[best][0] && c[k][1] > c[best][1])) best = k; });
  return best;
}
/** Change ACCNAMES from the stored value (fresh read). Under the script lock unless the caller holds it. */
function editNames_(fn, locked) {
  var lock = locked ? null : LockService.getScriptLock();
  if (lock) lock.waitLock(20000);
  try {
    var all;
    try { all = JSON.parse(ps_().getProperty('ACCNAMES') || '{}') || {}; } catch (e) { all = {}; }
    fn(all);
    gset_('ACCNAMES', JSON.stringify(all));
  } finally {
    if (lock) lock.releaseLock();
  }
}
/** After a save made as full: count it for this execution's account (none with ACCESS_OFF). Never fails the save. */
function noteActor_(full) {
  if (!CALLER_ || !full) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return;   // a busy moment: one count less doesn't matter
  try {
    editNames_(function (all) {
      var o = all[CALLER_] = all[CALLER_] || {}, c = o.c = o.c || {};
      var x = c[full] = c[full] || [0, 0];
      x[0]++; x[1] = Date.now();
      var ks = Object.keys(c).sort(function (p, q) { return c[p][0] - c[q][0] || c[p][1] - c[q][1]; });
      while (ks.length > ACC_NAMES_MAX_) delete c[ks.shift()];
    }, true);
  } catch (e) {
  } finally {
    lock.releaseLock();
  }
}
function delAccount_(email) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var acc;
    try { acc = JSON.parse(ps_().getProperty('ACCOUNTS') || '{}') || {}; } catch (e) { acc = {}; }
    if (acc[email]) { delete acc[email]; gset_('ACCOUNTS', JSON.stringify(acc)); }
    editNames_(function (all) { delete all[email]; }, true);
  } finally {
    lock.releaseLock();
  }
}
/** Requests waiting for the owner (the page's badge on 더보기). */
function waitCount_() {
  var acc = accounts_();
  return Object.keys(acc).filter(function (e) { return acc[e].s === 'wait'; }).length;
}
/** Menu 접근 계정: the list; a number flips 허용 <-> 끊기, an email allows that account ahead of time. */
function menuAccounts() {
  var ui = SpreadsheetApp.getUi(), acc = accounts_(), names = accNames_();
  var list = Object.keys(acc).sort(function (x, y) { return (acc[y].t || 0) - (acc[x].t || 0); });
  var L = { ok: '허용', wait: '허용 기다림', no: '끊김' };
  var day = function (ms) { return ms ? Utilities.formatDate(new Date(ms), 'Asia/Seoul', 'M/d') : ''; };
  var text = (list.length ? list.map(function (e, i) {
    var a = acc[e];
    var o = names[e] || {}, nm = o.nm || accName_(o);
    return (i + 1) + '. ' + (nm ? nm + ' ' : '') + e + ' - ' + L[a.s] + ' (' + day(a.s === 'ok' ? a.a : a.t) + (a.n ? ', ' + a.n : '') + ')';
  }).join('\n') : '아직 들어온 계정이 없어요.') +
    '\n\n사장님 계정(' + ownerEmail_() + ')은 늘 들어와요.' +
    (autoAllow_() ? '\n새 요청 자동 허용: ' + autoUntilText_() + '까지 (끄기: 취식 앱 더보기 > 접근 계정)' : '') +
    '\n\n번호를 적으면 허용 <-> 끊기가 바뀌어요 (기다림은 허용으로). 이메일을 적으면 그 계정을 미리 허용해요.';
  var r = ui.prompt('접근 계정', text, ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var v = r.getResponseText().trim().toLowerCase();
  if (!v) return;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { setAccount_(v, 'ok', '미리 허용'); ui.alert(v + ' 허용했어요. 그 계정으로 로그인하면 바로 들어와요.'); return; }
  var e = list[Number(v) - 1];
  if (!e) { ui.alert('목록의 번호나 이메일을 적어 주세요.'); return; }
  var s = acc[e].s === 'ok' ? 'no' : 'ok';
  setAccount_(e, s);
  ui.alert(e + (s === 'ok' ? ' 허용했어요.' : ' 끊었어요. 그 계정으로 들어온 폰은 바로 막혀요.'));
}
function menuAccessRevokeAll() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('모든 폰 다시 로그인', '모든 폰(안드로이드 앱, 아이폰, 브라우저, z)이 Google 계정으로 다시 들어와야 해요. 허용된 계정은 그대로라 로그인만 하면 돼요. 할까요?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  gset_('ACCESS_KEY', Utilities.getUuid() + Utilities.getUuid());
  ui.alert('했어요.');
}

/* ---------- 앱 API (JSON) ----------
 * The Android app / installable page (app/) calls the same functions as google.script.run, but through
 * POST /exec with a text/plain body {"fn": name, "args": [...]} (text/plain = no CORS preflight).
 * Answer: {"ok": true, "r": result} or {"ok": false, "err": message}.
 * Only these names can be called; they are all public (google.script.run-callable) already. */
function apiFns_() {
  return {
    getBoot: getBoot, getInit: getInit, getMonth: getMonth, setTag: setTag, addMember: addMember,
    saveShift: saveShift, deleteShift: deleteShift,
    login: login, setPassword: setPassword, refreshNow: refreshNow, getPage: getPage, gLogin: gLogin, gPoll: gPoll,
    getAccounts: getAccounts, setAccess: setAccess, setAccName: setAccName, setAutoAllow: setAutoAllow
  };
}
function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var fns = apiFns_();
    if (!req || typeof req.fn !== 'string' || !Object.prototype.hasOwnProperty.call(fns, req.fn)) throw new Error('알 수 없는 요청이에요.');
    checkAccess_(req.fn, req.dev);
    useStore_(req.store);   // no store = the first store (a page from before stores existed)
    var r = fns[req.fn].apply(null, Array.isArray(req.args) ? req.args : []);
    out = { ok: true, r: r === undefined ? null : r };
  } catch (err) {
    out = { ok: false, err: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * The page's one entry on the /exec link (google.script.run.api): the same functions as doPost, for one store.
 * (A page from before stores existed calls the functions directly; they then work for the first store.)
 */
function api(store, fn, args, dev) {
  var fns = apiFns_();
  if (typeof fn !== 'string' || !Object.prototype.hasOwnProperty.call(fns, fn)) throw new Error('알 수 없는 요청이에요.');
  checkAccess_(fn, dev);
  useStore_(store);
  return fns[fn].apply(null, Array.isArray(args) ? args : []);
}

/** One call for the page start: init + the newest month (saves a round trip). */
function getBoot(me, token) {
  access_();
  var init = getInit(me, token);
  return { init: init, month: getMonth(init.months[0], '') };
}

/** The page source, for the app to update itself. null when the app already has this version (hash). */
function getPage(knownHash) {
  var html = HtmlService.createHtmlOutputFromFile('Index').getContent();
  var h = b64_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, html, Utilities.Charset.UTF_8));
  return String(knownHash || '') === h ? null : { hash: h, html: html };
}

/*
 * Data version of the current store: VER changes on every write / import (the page polls with it, and the
 * month cache is keyed by it). Sheet writes are flushed BEFORE the new version is set, so anyone who sees
 * the new version reads the new data (and never caches the old data under the new version).
 * SVER = the same for what other stores show too (출근일지, 폐기목록, 월별 마감; not 직원): other stores add it
 * to their version, because a month's answer carries every store's shifts and 취식 / 폐기 totals
 * (근무 시간 and 직원별 취식 are summed per person across stores). shared = true for those writes.
 */
function bumpVersion_(shared) {
  SpreadsheetApp.flush();
  var v = nextVer_();
  pset_('VER', v);
  if (shared) pset_('SVER', v);
  MEM_ = {};
  return v;
}
/** A version newer than the store's current one (the clock, or +1 when two changes fall in the same millisecond). */
function nextVer_(st) { return String(Math.max(Date.now(), Number(pget_('VER', st) || 0) + 1)); }
function version_() {
  var cur = store_(), v = pget_('VER') || '0';
  onStores_().forEach(function (st) { if (st !== cur) v += '.' + (pget_('SVER', st) || '0'); });
  return v;
}

/* Big values in CacheService (100 KB a value): cut into pieces. Used for a month's answer. */
var BIG_CHUNK = 30000;   // characters a piece (Korean = 3 bytes each)
function bigPut_(key, obj, sec) {
  try {
    var s = JSON.stringify(obj), n = Math.ceil(s.length / BIG_CHUNK), m = {};
    if (n > 40) return;
    for (var i = 0; i < n; i++) m[key + '|' + i] = s.substr(i * BIG_CHUNK, BIG_CHUNK);
    m[key] = String(n);
    CacheService.getScriptCache().putAll(m, sec);
  } catch (e) {}
}
function bigGet_(key) {
  try {
    var c = CacheService.getScriptCache(), n = Number(c.get(key) || 0);
    if (!n) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(key + '|' + i);
    var got = c.getAll(keys), s = '';
    for (var k = 0; k < n; k++) { if (typeof got[keys[k]] !== 'string') return null; s += got[keys[k]]; }
    return JSON.parse(s);
  } catch (e) { return null; }
}

/* 직원 columns: A 이름(전체), B 폐기용 이름, C 메모, D 비밀번호(암호) — D holds a salted hash, never the password */
var MC = { FULL: 1, SHORT: 2, MEMO: 3, PW: 4 };
var PW_HEADER = '비밀번호(암호)';
var AUTH_TAG = '[비밀번호]';

var MEM_ = {};   // 직원 rows read in this execution, per store (cleared on every write and inside every lock)
function memberRows_() {
  var id = store_().id;
  if (MEM_[id]) return MEM_[id];
  var sh = sheet_(SH_MEMBERS);
  var n = sh.getLastRow() - 1;
  if (n < 1) return (MEM_[id] = []);
  return (MEM_[id] = sh.getRange(2, 1, n, 4).getDisplayValues().map(function (r, i) {
    var full = String(r[0]).trim();
    return { row: i + 2, full: full, short: String(r[1]).trim() || shortName_(full), pw: String(r[3]).trim() };
  }).filter(function (m) { return m.full; }));
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
  var v = gget_(name);
  if (!v) {
    v = ps_().getProperty(name) || '';   // another run may have made it since our snapshot
    if (!v) v = Utilities.getUuid() + Utilities.getUuid();
    gset_(name, v);
  }
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
  access_();
  var m = memberRow_(full);
  if (!m.pw) return { token: '' };
  pw = String(pw || '');
  var cache = CacheService.getScriptCache();
  var ck = ck_('pwfail_' + b64_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, m.full, Utilities.Charset.UTF_8)));
  var fails = Number(cache.get(ck) || 0);
  if (fails >= 5) throw new Error('비밀번호를 여러 번 틀렸어요. 10분 뒤에 다시 해 주세요.');
  var dev = gget_('DEV_PW_HASH');
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
  access_();
  authMember_(full, token);
  newPw = String(newPw || '');
  if (newPw && (newPw.length < 4 || newPw.length > 30)) throw new Error('비밀번호는 4~30자로 해 주세요.');
  return withLock_(function () {
    var sh = sheet_(SH_MEMBERS);
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
  if (pw) { gset_('DEV_PW_HASH', devHash_(pw)); ui.alert('개발자 비밀번호를 저장했어요.'); }
  else { gdel_('DEV_PW_HASH'); ui.alert('개발자 비밀번호를 없앴어요.'); }
}
function menuClearMemberPw() {
  var ui = SpreadsheetApp.getUi();
  var sts = askStores_(ui, onStores_(), false);
  if (!sts || !sts.length) return;
  var r = ui.prompt('직원 비밀번호 지우기 · ' + sts[0].name, '비밀번호를 지울 직원의 전체 이름 (예: 김성휘)', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  try {
    var name = inStore_(sts[0], function () {
      var m = memberRow_(r.getResponseText().trim());
      sheet_(SH_MEMBERS).getRange(m.row, MC.PW).setValue('');
      bumpVersion_();
      return m.full;
    });
    ui.alert(name + ' 님 비밀번호를 지웠어요. 이제 비밀번호 없이 쓸 수 있어요.');
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
  MEM_ = {};   // read 직원 again inside the lock
  try { return fn(); } finally { lock.releaseLock(); }
}

/** me/token: the name this phone remembers; meOk = false means it must enter the password again. */
function getInit(me, token) {
  access_();
  var meOk = true;
  if (me) { try { authMember_(me, token); } catch (e) { meOk = String(e.message).indexOf(AUTH_TAG) < 0; } }
  var out = getInitData_();
  out.meOk = meOk;
  if (ownerCaller_()) out.admin = { wait: waitCount_() };   // only the owner's phone hears of the 접근 계정 screen
  return out;
}
function getInitData_() {
  var st = store_(), v = version_();
  // months with data: kept in the cache per data version (saves two column reads on every page start)
  var ckey = 'mons|' + st.id + '|' + v, list = null;
  try { list = JSON.parse(CacheService.getScriptCache().get(ckey) || 'null'); } catch (e) {}
  if (!list) {
    var months = {};
    [[sheet_(SH_ITEMS), C.MONTH], [sheet_(SH_SHIFTS), SC.MONTH]].forEach(function (p) {
      var sh = p[0];
      var n = sh ? sh.getLastRow() - 1 : 0;
      if (n > 0) sh.getRange(2, p[1], n, 1).getDisplayValues().forEach(function (r) { if (r[0]) months[r[0]] = 1; });
    });
    list = Object.keys(months).sort().reverse();
    try { CacheService.getScriptCache().put(ckey, JSON.stringify(list), MONTH_CACHE_S); } catch (e) {}
  }
  var cur = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  if (list.indexOf(cur) < 0) list.unshift(cur);
  return { members: members_(), months: list, version: v, live: liveInfo_(0), store: st.id, stores: storesInfo_() };
}
/** What the page knows about the stores: [{ id, name, short, chain, jeo (has a 저회전 tab) }]. */
function storesInfo_() {
  return onStores_().map(function (st) {
    return { id: st.id, name: st.name, short: st.short, chain: st.chain, jeo: !!(CHAINS[st.chain] && CHAINS[st.chain].jeo) };
  });
}

var MONTH_CACHE_S = 3600;   // a month's answer stays in the cache this long (per data version)

/**
 * month: 'yyyy-MM'. Returns null when the caller already has this version.
 * The answer is kept in CacheService per (store, month, version), so only the first caller after a change
 * reads the sheets; the others (every open phone polls) get the kept answer. fresh = true (pull to refresh,
 * sync button) reads the sheets anyway: for hand changes that don't move the version (a deleted row).
 */
function getMonth(month, knownVersion, fresh) {
  access_();
  var v = version_();
  if (knownVersion && knownVersion === v) return null;
  month = /^\d{4}-\d\d$/.test(String(month || '')) ? String(month) : '';
  var st = store_(), ckey = 'mo|' + st.id + '|' + month + '|' + v;
  if (!fresh) { var hit = bigGet_(ckey); if (hit) return hit; }
  var lines = monthLines_(month);
  var closed = month && month <= pget_('CLOSED') ? readClose_(month) : null;
  var all = readShifts_();
  var out = { version: v, store: st.id, month: month, rows: lines.rows, cancels: lines.cancels, closed: closed, shifts: shiftsFor_(month, all), usual: usualShifts_(all), members: members_(), others: otherShifts_(month) };
  bigPut_(ckey, out, MONTH_CACHE_S);
  return out;
}

/**
 * The month's lines from 폐기목록: rows (canceled lines left out, partly canceled ones scaled) and cancels
 * (negative lines), in the shapes getMonth sends (DEVNOTES → Web app API).
 */
function monthLines_(month) {
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
        cancels.push([when(i), r[C.NAME - 1], Number(nums[i][0]) || 0, Math.round(Number(nums[i][2]) || 0), r[C.DATE - 1],
          cx.neg[i].map(function (m) { var o = vals[m[0]]; return [when(m[0]), m[1], o[C.TYPE - 1], o[C.MEMBER - 1]]; }), r[C.SRC - 1]]);
        continue;
      }
      // 원가 is shown in whole won: round each line (older sheet rows can hold BGF's decimals), so totals are whole too
      var q = Number(nums[i][0]) || 0, wamt = Math.round(Number(nums[i][2]) || 0), mamt = Number(nums[i][4]) || 0;
      if (cx.left[i] !== undefined) {
        if (cx.left[i] <= 0) continue;            // fully canceled
        wamt = Math.round(wamt * cx.left[i] / q); mamt = Math.round(mamt * cx.left[i] / q); q = cx.left[i];
      }
      rows.push([i + 2, r[C.KEY - 1], when(i), r[C.NAME - 1], q,
        Math.round(Number(nums[i][1]) || 0), wamt, mamt, r[C.TYPE - 1], r[C.MEMBER - 1], r[C.WHO - 1], r[C.DATE - 1], r[C.NOTE - 1], r[C.SRC - 1]]);
    }
  }
  return { rows: rows, cancels: cancels };
}

/* ======================= 월별 마감 (지난 달 합계 고정) ======================= */
/*
 * Once a month is over (CLOSE_AFTER_DAYS into the next one), its 직원별 폐기 / 취식 수량 and 원가 are written once
 * into the store's 월별 마감 sheet, and from then on the page's 월별 합계 for that month shows those numbers.
 * So nothing that happens later (a cancel slip of the next month, a late tag, a re-import, a hand edit of 폐기목록)
 * moves a closed month's totals. Each line's own 원가 was already fixed when it was imported (BGF's slip amount).
 * The owner can redo one month with the menu 월 마감 다시 하기, or edit the 월별 마감 sheet by hand.
 */

/** The newest month that is due: last month once CLOSE_AFTER_DAYS of this month have passed, else the month before. */
function closeTarget_() {
  var d = new Date(Date.now() - CLOSE_AFTER_DAYS * 86400000);
  var y = Number(Utilities.formatDate(d, TZ, 'yyyy')), m = Number(Utilities.formatDate(d, TZ, 'MM')) - 1;
  if (m < 1) { y--; m = 12; }
  return y + '-' + ('0' + m).slice(-2);
}

/** Every store: close the months that are due. Cheap when nothing is due (one property read per store). */
function closeAll_() {
  onStores_().forEach(function (st) { try { inStore_(st, closeDue_); } catch (x) {} });
}
/** This store: every month up to closeTarget_() that has lines and isn't in 월별 마감 yet. Returns how many were closed. */
function closeDue_() {
  var target = closeTarget_();
  if (pget_('CLOSED') >= target) return 0;
  var have = {}, n = 0;
  closeRows_().forEach(function (r) { have[r.d[0]] = 1; });
  var months = {}, sh = itemsSheet_(), k = sh.getLastRow() - 1;
  if (k > 0) sh.getRange(2, C.MONTH, k, 1).getDisplayValues().forEach(function (r) { if (r[0]) months[r[0]] = 1; });
  Object.keys(months).sort().forEach(function (m) { if (m <= target && !have[m]) { closeMonth_(m); n++; } });
  pset_('CLOSED', target);
  return n;
}

/** Totals of a month's rows (getMonth row shape), the same way the page's 월별 합계 adds them. */
function monthTotals_(rows) {
  var by = {}, todo = { n: 0, w: 0 }, tot = { vn: 0, vw: 0, en: 0, ew: 0 };
  rows.forEach(function (r) {
    if (!r[8]) { if (!r[13]) { todo.n += r[4]; todo.w += r[6]; } return; }   // 미등록 = untagged 폐기 (저회전 never counts)
    var k = r[9] || '(이름 없음)', o = by[k] = by[k] || { vn: 0, vw: 0, en: 0, ew: 0 };
    if (r[8] === '취식') { o.en += r[4]; o.ew += r[6]; tot.en += r[4]; tot.ew += r[6]; }
    else { o.vn += r[4]; o.vw += r[6]; tot.vn += r[4]; tot.vw += r[6]; }
  });
  return { by: by, todo: todo, tot: tot };
}

/** Writes (or rewrites) one month into 월별 마감 from 폐기목록 as it is now. Returns a line for the menu. */
function closeMonth_(month) {
  return withLock_(function () {
    var t = monthTotals_(monthLines_(month).rows), at = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    var names = Object.keys(t.by).sort(function (a, b) { var x = t.by[a], y = t.by[b]; return y.ew - x.ew || (y.ew + y.vw) - (x.ew + x.vw) || (a < b ? -1 : 1); });   // 취식 원가 first, like the page
    var add = names.map(function (k) { var o = t.by[k]; return [month, k, o.vn, o.vw, o.en, o.ew, at]; });
    add.push([month, CLOSE_TODO, t.todo.n, t.todo.w, '', '', at]);   // always there, so every closed month has a row
    var old = closeRows_(), keep = old.filter(function (r) { return r.d[0] !== month; }).map(function (r) { return r.v; });
    var all = keep.concat(add).sort(function (a, b) { var x = String(a[0]), y = String(b[0]); return x < y ? 1 : x > y ? -1 : 0; });   // newest month on top
    var sh = closeSheet_(), w = CLOSE_HEADERS.length;
    if (old.length) sh.getRange(2, 1, old.length, w).clearContent();
    sh.getRange(2, 1, all.length, w).setValues(all);
    bumpVersion_(true);
    return month + ' 마감 (' + at + '): ' + names.length + '명 · 취식 원가 ' + t.tot.ew.toLocaleString() + '원 · 폐기 원가 ' + t.tot.vw.toLocaleString() + '원 · 미등록 ' + t.todo.w.toLocaleString() + '원';
  });
}

/** 월별 마감 sheet of this store, made on first use. */
function closeSheet_() {
  var name = sheetName_(SH_CLOSE), sh = doc_().getSheetByName(name);
  if (sh) return sh;
  sh = doc_().insertSheet(name, doc_().getNumSheets());
  sh.getRange(1, 1, 1, CLOSE_HEADERS.length).setValues([CLOSE_HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange('A:B').setNumberFormat('@');
  sh.getRange('G:G').setNumberFormat('@');
  sh.getRange('C:F').setNumberFormat('#,##0');
  return sh;
}
/** The sheet's rows: [{ d: display values, v: values }] (empty rows left out). */
function closeRows_() {
  var sh = doc_().getSheetByName(sheetName_(SH_CLOSE)), n = sh ? sh.getLastRow() - 1 : 0;
  if (n <= 0) return [];
  var w = CLOSE_HEADERS.length, d = sh.getRange(2, 1, n, w).getDisplayValues(), v = sh.getRange(2, 1, n, w).getValues();
  return d.map(function (r, i) { return { d: r, v: v[i] }; }).filter(function (r) { return r.d.join('') !== ''; });
}
/** One closed month for the page: { at, rows: [[memberFull, 폐기 수량, 폐기 원가, 취식 수량, 취식 원가]], todo: [수량, 원가] }, or null. */
function readClose_(month) {
  var num = function (x) { return Math.round(Number(String(x).replace(/[,\s원]/g, '')) || 0); };
  var out = { at: '', rows: [], todo: [0, 0] }, hit = false;
  closeRows_().forEach(function (r) {
    var d = r.d;
    if (d[0] !== month) return;
    hit = true; out.at = out.at || d[6];
    if (d[1] === CLOSE_TODO) out.todo = [num(d[2]), num(d[3])];
    else out.rows.push([d[1], num(d[2]), num(d[3]), num(d[4]), num(d[5])]);
  });
  return hit ? out : null;
}

/**
 * The month of every OTHER store: [{ id, short, shifts: [[date, memberFull, start, end], …], eat }].
 * The page adds them to 근무 시간 and 직원별 취식 (월별 합계): the same person (same full name) can work in
 * 2 or 3 stores, and the monthly hours and 취식 are one total per person.
 * eat = { rows: [[memberFull, 폐기 수량, 폐기 원가, 취식 수량, 취식 원가]], todo: [미등록 수량, 원가] }: that store's
 * 월별 마감 numbers once the month is closed there, else its lines added up now (monthTotals_).
 */
function otherShifts_(month) {
  var cur = store_();
  if (!/^\d{4}-\d\d$/.test(month)) return [];
  return onStores_().filter(function (st) { return st !== cur; }).map(function (st) {
    var list = [];
    try {
      list = inStore_(st, readShifts_).filter(function (s) { return s.date.slice(0, 7) === month; })
        .map(function (s) { return [s.date, s.member, s.start, s.end]; });
    } catch (e) {}
    var eat = { rows: [], todo: [0, 0] };
    try { eat = inStore_(st, function () { return storeEat_(month); }); } catch (e) {}
    return { id: st.id, short: st.short, shifts: list, eat: eat };
  });
}
/** This store's 직원별 폐기 / 취식 of a month (otherShifts_ eat shape), kept in the cache per SVER. */
function storeEat_(month) {
  var ck = 'eat|' + store_().id + '|' + month + '|' + (pget_('SVER') || '0'), c = CacheService.getScriptCache();
  try { var hit = JSON.parse(c.get(ck) || 'null'); if (hit) return hit; } catch (e) {}
  var out = month <= pget_('CLOSED') ? readClose_(month) : null;
  if (out) out = { rows: out.rows, todo: out.todo };
  else {
    var t = monthTotals_(monthLines_(month).rows);
    out = { rows: Object.keys(t.by).map(function (k) { var o = t.by[k]; return [k, o.vn, o.vw, o.en, o.ew]; }), todo: [t.todo.n, t.todo.w] };
  }
  try { c.put(ck, JSON.stringify(out), MONTH_CACHE_S); } catch (e) {}
  return out;
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
 * A 저회전 row (전표 열 = '저회전') takes 취식 or 폐기 like any row (so it shows who handled it).
 * note: '근무외' when the worker confirmed a 폐기 outside their recorded shift (kept only for 폐기).
 * me/token: who is acting. Only your own name is written, and a row someone else tagged can't be
 * changed or cleared from the page (the owner can still fix it in the sheet).
 */
function setTag(rowHint, key, type, memberFull, month, note, me, token) {
  access_();
  if (['취식', '폐기', ''].indexOf(type) < 0) throw new Error('bad type');
  var actor = authMember_(me || memberFull, token);
  if (type && memberFull && memberFull !== actor.full) throw new Error('다른 직원 이름으로는 등록할 수 없어요.');
  var mem = type ? actor : null;
  note = type === '폐기' && note === OFFSHIFT_NOTE ? OFFSHIFT_NOTE : '';
  withLock_(function () {
    var sh = sheet_(SH_ITEMS);
    var row = Number(rowHint);
    if (!(row >= 2 && row <= sh.getLastRow() && sh.getRange(row, C.KEY).getDisplayValue() === key)) {
      var f = sh.getRange('A:A').createTextFinder(key).matchEntireCell(true).findNext();
      if (!f) throw new Error('항목을 찾지 못했어요. 새로고침해 주세요.');
      row = f.getRow();
    }
    var curMember = sh.getRange(row, C.MEMBER).getDisplayValue();
    if (curMember && curMember !== actor.full) throw new Error(curMember + ' 님이 등록한 항목이라 바꿀 수 없어요.');
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
    bumpVersion_(true);
  });
  noteActor_(actor.full);
  return getMonth(month || '', '');
}

/* ======================= 출근일지 ======================= */

function shiftSheet_() {
  var ss = doc_();
  var sh = sheet_(SH_SHIFTS);
  if (!sh) {
    sh = ss.insertSheet(sheetName_(SH_SHIFTS));
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
  var sh = sheet_(SH_SHIFTS);
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

/* ---- 근무 시간 (30분 단위, 직접 입력만) ----
 * The store counts work in 30-min slots, so hand-entered times are rounded to the nearest slot
 * (:15 / :45 → 출근 down, 퇴근 up: ties go the worker's way). There are no [출근] / [퇴근]
 * buttons any more (owner, 2026-11-15): every shift is entered by hand.
 * 자동 퇴근: when someone enters a 출근 that has already come (퇴근 empty or filled in) while
 * another worker is still 근무 중 (forgot their 퇴근), that worker is closed (memo `자동 퇴근`) if
 * that leaves them at least 1 h. Closed at the new 출근, or — where overlapping is the habit at
 * that handover — at their usual 퇴근 when it comes up to 2 h later. A finished new shift that
 * ends before the earlier worker's usual 퇴근 is a helper inside their shift: left alone.
 * Saving their own row drops the mark. */
function roundSlot_(m, tieUp) {
  var r = ((m % SLOT_MIN) + SLOT_MIN) % SLOT_MIN, h = SLOT_MIN / 2;
  return r < h || (r === h && !tieUp) ? m - r : m - r + SLOT_MIN;
}
function minDate_(m) { return Utilities.formatDate(new Date(m * 60000), 'UTC', 'yyyy-MM-dd'); }
function minHm_(m) { return Utilities.formatDate(new Date(m * 60000), 'UTC', 'HH:mm'); }

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
 * Other workers' open (근무 중) shifts to close for a new shift [a, b] (b null = still working)
 * by `member`: each returned with .end set and the memo marked `자동 퇴근`. No writes.
 */
function planAutoOut_(all, member, a, b, nowM, skipKey) {
  if (a > nowM + SLOT_MIN / 2) return []; // 아직 안 온 출근
  var usual = null, closed = [];
  all.forEach(function (s) {
    if (s.member === member || s.key === skipKey || !isLive_(s, nowM)) return;
    var st = shiftSpan_(s)[0];
    if (a - st < AUTO_OUT_MIN_H * 60) return; // 막 출근했거나 내 출근보다 늦게 온 사람: 같이 일하는 중
    usual = usual || usualShifts_(all);
    var u = usual[s.member], ue = null;
    if (u && u[0] === s.start) { ue = toMin_(s.date, u[1]); if (ue <= st) ue += 1440; }
    if (b !== null && ue !== null && b < ue) return; // 그 사람 근무 안에서 잠깐 도운 기록
    var end = a;
    // 이 교대에서 겹치는 게 보통이면 그 사람이 늘 하던 퇴근으로 (2시간 안일 때)
    if (ue !== null && ue > a && ue - a <= 120 && overlapUsual_(all, a, skipKey)) end = ue;
    s.end = minHm_(end);
    s.memo = (dropAutoOut_(s.memo) ? dropAutoOut_(s.memo) + ' · ' : '') + AUTO_OUT_MEMO;
    closed.push(s);
  });
  return closed;
}

/**
 * Catch-up 자동 퇴근 (refreshNow: page open, pull, every minute while open, and the 5-min
 * trigger): any 근무 중 shift that a later shift of another worker (1 h+ after it, 퇴근 empty or
 * filled in) should have closed, e.g. one entered before this rule or saved while the other row
 * was being edited. Earliest 출근 first, so each forgotten shift closes at the next 출근.
 */
function autoOutAll_() {
  var all = readShifts_(), nowM = nowMin_();
  var later = all.filter(function (s) { var a = shiftSpan_(s)[0]; return a <= nowM + SLOT_MIN / 2 && nowM - a < OPEN_SHIFT_MAX_H * 60; })
    .sort(function (x, y) { return shiftSpan_(x)[0] - shiftSpan_(y)[0]; });
  var todo = [];
  later.forEach(function (b) {
    var sp = shiftSpan_(b);
    todo = todo.concat(planAutoOut_(all, b.member, sp[0], sp[1], nowM, b.key));
  });
  if (!todo.length) return 0;
  withLock_(function () {
    var sh = shiftSheet_(), now = readShifts_();
    todo.forEach(function (t) {
      // 그 사이에 바뀐 줄은 건드리지 않음
      var cur = null; now.forEach(function (s) { if (s.key === t.key) cur = s; });
      if (!cur || cur.row !== t.row || cur.end) return;
      writeShift_(sh, t.row, t);
    });
    bumpVersion_(true);
  });
  return todo.length;
}

/* ---- 교대 겹침 정리 ----
 * When a worker's 출근 (button or hand entry) falls inside another worker's recorded shift that
 * started 1 h+ earlier and ends before the new shift does (a handover, not a helper inside a
 * longer shift), the earlier worker's 퇴근 moves to that 출근 (memo `교대 맞춤 (원래 HH:mm)`).
 * Unless overlapping is the store's habit for that handover: over the last 90 days, at the same
 * time of day (±60 min; all handovers if fewer than 3 there), if handovers that overlapped
 * outnumber those that met or left a gap, the overlap is kept. Fewer than 3 seen → trim.
 * Shifts already trimmed or still marked 자동 퇴근 don't count (their end was set for the worker),
 * so the rule can't feed itself; a trim the worker undoes (edits the 퇴근 back) counts again.
 * The same check makes 자동 퇴근 use the earlier worker's usual 퇴근 where overlapping is the habit. */
function isTrimmed_(s) { return String(s.memo || '').split(' · ').some(function (p) { return p.indexOf(TRIM_MEMO) === 0; }); }
function dropTrim_(memo) {
  return String(memo || '').split(' · ').filter(function (p) { return p && p.indexOf(TRIM_MEMO) !== 0; }).join(' · ');
}
function todDiff_(x, y) { var d = Math.abs(((x - y) % 1440 + 1440) % 1440); return Math.min(d, 1440 - d); }

/** Handovers in the last HANDOFF_DAYS days: [{ at: B's 출근 (min), over: B came before A left }]. */
function handoffs_(all, skipKey) {
  var since = toMin_(Utilities.formatDate(new Date(Date.now() - HANDOFF_DAYS * 24 * 3600 * 1000), TZ, 'yyyy-MM-dd'), '00:00');
  // 자동으로 맞춘 퇴근(교대 맞춤, 확인 안 된 자동 퇴근)은 실제 습관이 아니니 셈에서 뺌
  var done = all.filter(function (s) { return s.end && s.key !== skipKey && !isTrimmed_(s) && !isAutoOut_(s) && shiftSpan_(s)[0] >= since - 1440; });
  var out = [];
  all.forEach(function (b) {
    if (b.key === skipKey) return;
    var bs = shiftSpan_(b), t = bs[0];
    if (t < since) return;
    var best = null, bd = 0;
    done.forEach(function (a) {
      if (a.member === b.member) return;
      var as = shiftSpan_(a);
      if (t - as[0] < AUTO_OUT_MIN_H * 60 || t > as[1] + HANDOVER_MIN) return;  // 같이 시작했거나 교대가 아님
      if (bs[1] !== null && bs[1] < as[1]) return;                             // 긴 근무 안의 짧은 근무
      var d = Math.abs(as[1] - t);
      if (!best || d < bd) { best = as; bd = d; }
    });
    if (best) out.push({ at: t, over: t < best[1] });
  });
  return out;
}

/** true when overlapping is the usual way for a handover at t (see above). */
function overlapUsual_(all, t, skipKey) {
  var hs = handoffs_(all, skipKey);
  var near = hs.filter(function (h) { return todDiff_(h.at, t) <= HANDOFF_NEAR_MIN; });
  if (near.length < HANDOFF_MIN_N) near = hs;
  if (near.length < HANDOFF_MIN_N) return false;
  var over = near.filter(function (h) { return h.over; }).length;
  return over > near.length - over;
}

/**
 * Other workers' closed shifts to trim for a new shift [a, b] (b null = open) by `member`:
 * each returned with .end = a and the memo marked. No writes. [] when overlap is usual.
 */
function planTrim_(all, member, a, b, skipKey) {
  var hit = all.filter(function (s) {
    if (s.member === member || !s.end || s.key === skipKey) return false;
    var sp = shiftSpan_(s);
    return a - sp[0] >= AUTO_OUT_MIN_H * 60 && a < sp[1] && (b === null || b >= sp[1]);
  });
  if (!hit.length || overlapUsual_(all, a, skipKey)) return [];
  return hit.map(function (s) {
    var was = s.end, m = dropTrim_(s.memo);
    s.end = minHm_(a);
    s.memo = (m ? m + ' · ' : '') + TRIM_MEMO + ' (원래 ' + was + ')';
    return s;
  });
}

/** key '' = new. end '' = still working. */
function saveShift(key, date, memberFull, start, end, memo, month, token) {
  access_();
  var mem = authMember_(memberFull, token);
  date = String(date || ''); start = String(start || '').slice(0, 5); end = String(end || '').slice(0, 5);
  memo = String(memo || '').replace(/^[=+\-@]+/, '').trim().slice(0, 40);
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) throw new Error('날짜를 골라 주세요.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) throw new Error('출근 시간을 적어 주세요.');
  if (end && !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) throw new Error('퇴근 시간이 이상해요.');
  // 30분 단위로 맞춤 (가게는 1–29분을 세지 않음). 출근은 :15 → 내림, 퇴근은 :45 → 올림.
  var a = roundSlot_(toMin_(date, start), false);
  date = minDate_(a); start = minHm_(a);
  if (end) end = minHm_(roundSlot_(toMin_(date, end), true));
  if (end && end === start) throw new Error('출근과 퇴근 시간이 같아요. (30분 단위로 맞추면 같은 시간이에요)');
  var nowM = nowMin_();
  if (a > nowM + 60) throw new Error('아직 오지 않은 시간이에요. 어젯밤 근무면 날짜를 어제로 골라 주세요.');
  var b = end ? shiftSpan_({ date: date, start: start, end: end })[1] : null;
  if (!end && nowM - a >= OPEN_SHIFT_MAX_H * 60) throw new Error('지난 근무는 퇴근 시간도 적어 주세요.');
  if (!end && a > nowM + SLOT_MIN / 2) throw new Error('퇴근을 비워 두려면 출근 시간이 지금보다 앞이어야 해요.');
  var trimmed = [], closed = [];
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
    // 본인이 '교대 맞춤'된 퇴근을 고치면 그 표시는 뺌 (고친 시간이 맞는 시간)
    if (cur && end !== cur.end) memo = dropTrim_(memo);
    // 본인이 자기 기록을 저장했으면 자동 퇴근을 확인한 것
    if (cur) memo = dropAutoOut_(memo);
    var s = { key: key || 's' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), date: date, member: mem.full, start: start, end: end, memo: memo };
    // 출근만 바뀌지 않은 수정(퇴근·메모만)은 다른 사람 기록을 건드리지 않음
    if (!cur || cur.date !== date || cur.start !== start) {
      trimmed = planTrim_(all, mem.full, a, b, key);
      trimmed.forEach(function (t) { writeShift_(sh, t.row, t); });
      // 출근을 적으면 (퇴근을 적었든 안 적었든) 퇴근을 안 적고 간 앞 사람은 자동 퇴근
      closed = planAutoOut_(all, mem.full, a, b, nowM, key);
      closed.forEach(function (t) { writeShift_(sh, t.row, t); });
    }
    writeShift_(sh, cur ? cur.row : sh.getLastRow() + 1, s);
    bumpVersion_(true);
  });
  noteActor_(mem.full);
  var res = getMonth(month || '', '');
  if (res && trimmed.length) res.trimmed = trimmed.map(function (t) { return [t.member, t.end]; });
  if (res && closed.length) res.closed = closed.map(function (t) { return [t.member, t.end]; });
  return res;
}

function deleteShift(key, memberFull, month, token) {
  access_();
  var mem = authMember_(memberFull, token);
  withLock_(function () {
    var sh = shiftSheet_();
    var cur = null;
    readShifts_().forEach(function (s) { if (s.key === key) cur = s; });
    if (!cur) throw new Error('기록을 찾지 못했어요. 새로고침해 주세요.');
    if (cur.member !== mem.full) throw new Error('다른 직원의 기록은 지울 수 없어요.');
    sh.deleteRow(cur.row);
    bumpVersion_(true);
  });
  noteActor_(mem.full);
  return getMonth(month || '', '');
}

function addMember(full) {
  access_();
  full = String(full || '').replace(/[=+\-@'"<>]/g, '').trim().slice(0, 10);
  if (full.length < 2) throw new Error('이름을 두 글자 이상 적어 주세요.');
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  MEM_ = {};
  try {
    var exists = members_().some(function (m) { return m.full === full; });
    if (!exists) {
      sheet_(SH_MEMBERS).appendRow([full, shortName_(full), '웹에서 추가']);
      bumpVersion_();
    }
  } finally {
    lock.releaseLock();
  }
  return members_();
}

/* ======================= 백업 / 되살리기 ======================= */
/*
 * Backups are separate spreadsheet files in the owner's Drive: one per weekday (overwritten a week later) and
 * one per month end (overwritten a year later), so the last 7 days and the last 12 month ends can always be
 * brought back, even if this spreadsheet is emptied or deleted. nightly() makes them; the menu makes one on
 * demand ('직접', its own file) and brings one back. Before bringing one back, the live data goes to the
 * '되살리기 직전' file, so a restore can be undone too.
 * Only SpreadsheetApp is used (no DriveApp), so this asks the owner for no new permission.
 * A backup copies every sheet (values + formats) except the 월별 합계 sheets (formulas, made by setup again),
 * plus a '백업 정보' sheet. Files are found by the ids in Script Properties BAK_<slot>, times in BAK_AT_<slot>.
 */
var BAK_PREFIX = '직원 취식 목록 백업 · ';
var BAK_INFO = '백업 정보';
var BAK_DAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** Slot → file name. D0..D6 = weekday, M1..M12 = month end, H = 직접, R = 되살리기 직전. */
function bakName_(slot) {
  if (slot === 'R') return BAK_PREFIX + '되살리기 직전';
  if (slot === 'H') return BAK_PREFIX + '직접';
  if (slot.charAt(0) === 'D') return BAK_PREFIX + BAK_DAYS[Number(slot.slice(1))] + '요일';
  return BAK_PREFIX + slot.slice(1) + '월 말';
}
function bakFile_(slot, make) {
  var id = gget_('BAK_' + slot), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }   // deleted by hand: make a new one
  if (!ss && make) { ss = SpreadsheetApp.create(bakName_(slot)); gset_('BAK_' + slot, ss.getId()); }
  return ss;
}
function isSummarySheet_(name) { return name === SH_SUMMARY || name.slice(-(SH_SUMMARY.length + 1)) === ' ' + SH_SUMMARY; }

/** Copies every sheet into the slot's file. New copies first, old ones deleted after, so a run that dies keeps the old backup. */
function backupTo_(slot) {
  var src = doc_(), dst = bakFile_(slot, true), when = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
  var info = dst.getSheetByName(BAK_INFO) || dst.insertSheet(BAK_INFO, 0);
  var made = [], rows = [];
  src.getSheets().forEach(function (s) {
    var n = s.getName();
    if (n === BAK_INFO || isSummarySheet_(n)) return;
    made.push({ sh: s.copyTo(dst), name: n });
    rows.push([n, Math.max(0, s.getLastRow() - 1)]);
  });
  var keep = made.map(function (m) { return m.sh; });
  dst.getSheets().slice().forEach(function (s) { if (s !== info && keep.indexOf(s) < 0) dst.deleteSheet(s); });
  made.forEach(function (m) { m.sh.setName(m.name); });
  info.clear();
  info.getRange(1, 1, 3, 2).setValues([['백업 시각', when], ['원본', src.getName()], ['시트', '줄 수 (제목 줄 빼고)']]);
  if (rows.length) info.getRange(4, 1, rows.length, 2).setValues(rows);
  SpreadsheetApp.flush();
  gset_('BAK_AT_' + slot, when);
  return { slot: slot, name: bakName_(slot), when: when, sheets: rows.length, url: dst.getUrl() };
}

/** nightly(): today's weekday file, and on the 1st also last month's month-end file. */
function backupNightly_() {
  var now = new Date(), kst = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  var slots = ['D' + new Date(kst + 'T00:00:00Z').getUTCDay()];
  if (kst.slice(8) === '01') slots.push('M' + Number(Utilities.formatDate(new Date(now.getTime() - 86400000), TZ, 'M')));
  return slots.map(backupTo_);
}

/** Backups that exist, newest first: [{ slot, name, when }]. */
function backupList_() {
  var all = snap_(), out = [];
  Object.keys(all).forEach(function (k) {
    var m = k.match(/^BAK_AT_(D[0-6]|M\d{1,2}|H|R)$/);
    if (m && all['BAK_' + m[1]]) out.push({ slot: m[1], name: bakName_(m[1]), when: String(all[k]) });
  });
  return out.sort(function (a, b) { return a.when < b.when ? 1 : a.when > b.when ? -1 : 0; });
}

/**
 * Brings the slot's sheets back into this spreadsheet (only: list of sheet names, or null = all).
 * The live data goes to the 'R' file first (unless restoring from 'R' itself). A live sheet keeps its place and
 * settings; its contents and formats become the backup's. A missing sheet comes back as a whole.
 * Every store's data version moves, so open pages read it again. Returns the restored sheet names.
 */
function restoreFrom_(slot, only) {
  var bak = bakFile_(slot, false);
  if (!bak) throw new Error('그 백업 파일을 찾지 못했어요.');
  if (slot !== 'R') backupTo_('R');
  var doc = doc_(), done = [];
  withLock_(function () {
    bak.getSheets().forEach(function (b) {
      var n = b.getName();
      if (n === BAK_INFO || (only && only.indexOf(n) < 0)) return;
      var tmp = b.copyTo(doc), live = doc.getSheetByName(n);
      if (!live) { tmp.setName(n); done.push(n); return; }
      var r = tmp.getMaxRows(), c = tmp.getMaxColumns();
      if (live.getMaxRows() < r) live.insertRowsAfter(live.getMaxRows(), r - live.getMaxRows());
      if (live.getMaxColumns() < c) live.insertColumnsAfter(live.getMaxColumns(), c - live.getMaxColumns());
      live.clear();
      tmp.getRange(1, 1, r, c).copyTo(live.getRange(1, 1));
      doc.deleteSheet(tmp);
      done.push(n);
    });
    SpreadsheetApp.flush();
    onStores_().forEach(function (st) { var v = nextVer_(st); pset_('VER', v, st); pset_('SVER', v, st); });
  });
  return done;
}

function menuBackupNow() {
  var ui = SpreadsheetApp.getUi();
  try {
    var r = backupTo_('H');
    ui.alert('백업했어요 (' + r.when + ', 시트 ' + r.sheets + '개).\n\n파일: ' + r.name + '\n' + r.url);
  } catch (e) { ui.alert('백업하지 못했어요: ' + e.message); }
}

function menuRestore() {
  var ui = SpreadsheetApp.getUi();
  var list = backupList_();
  if (!list.length) { ui.alert('아직 백업이 없어요. 매일 밤 00:01 무렵 자동으로 만들어져요. 지금 만들려면 [지금 백업하기].'); return; }
  var r = ui.prompt('백업에서 되살리기', '어느 백업인가요? 번호를 적어 주세요.\n\n' +
    list.map(function (b, i) { return (i + 1) + ' = ' + b.when + ' · ' + b.name.replace(BAK_PREFIX, ''); }).join('\n'), ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var b = list[Number(r.getResponseText().trim()) - 1];
  if (!b) { ui.alert('번호를 적어 주세요. 예: 1'); return; }
  r = ui.prompt('되살릴 시트', '비워 두면 모든 시트를 되살려요.\n일부만: 시트 이름을 쉼표로 (예: 출근일지, 두왕점 직원)', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var t = r.getResponseText().trim(), only = t ? t.split(',').map(function (x) { return x.trim(); }).filter(String) : null;
  var what = only ? only.join(', ') : '모든 시트';
  if (ui.alert('되살리기 확인', b.when + ' 백업으로 ' + what + '을(를) 바꿔요.\n그 뒤에 적힌 내용은 이 시트에서 사라지고, 지금 내용은 먼저 [' + bakName_('R').replace(BAK_PREFIX, '') + '] 백업에 남겨요.\n\n계속할까요?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  try {
    var done = restoreFrom_(b.slot, only);
    if (!done.length) { ui.alert('그 이름의 시트가 백업에 없어요. 이름을 확인해 주세요.'); return; }
    ui.alert('되살렸어요: ' + done.join(', ') +
      '\n\n백업 뒤에 들어온 폐기는 [기간 지정해서 가져오기]로 다시 가져오세요. 되돌리려면 [백업에서 되살리기]에서 [' + bakName_('R').replace(BAK_PREFIX, '') + ']를 고르세요.');
  } catch (e) { ui.alert('되살리지 못했어요: ' + e.message); }
}
