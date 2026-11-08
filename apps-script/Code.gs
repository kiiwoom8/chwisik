/**
 * 직원 취식 목록
 * - 매일 00:01 무렵 BGF 점포시스템에서 어제(와 그제) 폐기 전표를 가져와 '폐기목록' 시트에 추가
 * - 웹앱: 직원이 자기 이름을 한 번 고르고, 품목마다 [취식] / [폐기] 를 한 번 눌러 등록
 *   취식 → 전체 이름(김성휘), 폐기 → 이름만(성휘)
 * - 월별 합계: '월별 합계' 시트와 웹앱에서 확인
 */

var TZ = 'Asia/Seoul';
var BASE = 'https://store.bgfretail.com';
var STORE_CD = '25377';
var USER_NO = '25377';

var SH_ITEMS = '폐기목록';
var SH_MEMBERS = '직원';
var SH_SUMMARY = '월별 합계';
var SH_LOG = '가져오기 기록';

// 폐기목록 columns (1-based)
var C = { KEY: 1, DATE: 2, TIME: 3, NAME: 4, CODE: 5, CAT: 6, QTY: 7, WPRICE: 8, WAMT: 9, MPRICE: 10, MAMT: 11, CHIT: 12, TYPE: 13, WHO: 14, MEMBER: 15, AT: 16, MONTH: 17 };
var NCOL = 17;
var HEADERS = ['키', '일자', '생성시각', '품명', '상품코드', '분류', '수량', '원가단가', '원가금액', '매가단가', '매가금액', '전표번호', '구분', '등록이름', '직원', '등록시각', '월'];

/* ======================= 시트 준비 / 메뉴 ======================= */

function setup() {
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);

  var items = ss.getSheetByName(SH_ITEMS) || ss.insertSheet(SH_ITEMS, 0);
  if (items.getLastRow() === 0) {
    items.getRange(1, 1, 1, NCOL).setValues([HEADERS]).setFontWeight('bold');
    items.setFrozenRows(1);
  }
  items.getRange('A:F').setNumberFormat('@');
  items.getRange('L:Q').setNumberFormat('@');
  items.getRange('G:K').setNumberFormat('#,##0');

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
  return 'ok';
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('취식 관리')
    .addItem('BGF 비밀번호 입력', 'menuSetPassword')
    .addItem('어제 폐기 지금 가져오기', 'nightly')
    .addItem('기간 지정해서 가져오기', 'menuImportRange')
    .addSeparator()
    .addItem('매일 자동 가져오기 켜기', 'installNightlyTrigger')
    .addToUi();
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
  var log = SpreadsheetApp.getActive().getSheetByName(SH_LOG);
  var stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
  try {
    var r = fetchPyegi_(fromYmd, toYmd);
    var added = appendItems_(r.items);
    var msg = fromYmd + '~' + toYmd + ': 전표 ' + r.chits + '장, 새 품목 ' + added + '건 추가';
    if (log) log.appendRow([stamp, fromYmd + '~' + toYmd, r.chits, added, 'OK']);
    return msg;
  } catch (e) {
    if (log) log.appendRow([stamp, fromYmd + '~' + toYmd, '', '', '실패: ' + e.message]);
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
        return [it.key, it.date, it.time, it.name, it.code, it.cat, it.qty, it.wprice, it.wamt, it.mprice, it.mamt, it.chit, '', '', '', '', it.date.slice(0, 7)];
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

function fetchPyegi_(fromYmd, toYmd) {
  var s = bgfLogin_();
  var list = s.post('/stgj020/search', ssvBuild_(svcVars_(), 'dsSearch',
    ['strDate', 'strStoreCd', 'strChitDiv', 'strChitNo', 'strChitYmd', 'strToDt', 'strFromDt'],
    ['', STORE_CD, '10', '', '', toYmd, fromYmd]));
  var chits = (list.ds.dsList || []).filter(function (c) { return c.CHIT_NO; });
  var meta = {};
  chits.forEach(function (c) { meta[c.CHIT_NO] = c; });

  // group by (date, chit id, flag) so each detail call matches what the site sends
  var groups = {};
  chits.forEach(function (c) {
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
  return { chits: chits.length, items: items };
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

function members_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH_MEMBERS);
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, 2).getDisplayValues()
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) { var full = String(r[0]).trim(); return { full: full, short: String(r[1]).trim() || shortName_(full) }; });
}
function shortName_(full) {
  full = String(full).trim();
  var two = ['남궁', '황보', '제갈', '사공', '선우', '서문', '독고', '동방'];
  if (full.length >= 4 && two.indexOf(full.slice(0, 2)) >= 0) return full.slice(2);
  return full.length >= 2 ? full.slice(1) : full;
}

function getInit() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH_ITEMS);
  var n = sh.getLastRow() - 1;
  var months = {};
  if (n > 0) sh.getRange(2, C.MONTH, n, 1).getDisplayValues().forEach(function (r) { if (r[0]) months[r[0]] = 1; });
  var list = Object.keys(months).sort().reverse();
  var cur = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  if (list.indexOf(cur) < 0) list.unshift(cur);
  return { members: members_(), months: list, version: version_() };
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
        Number(nums[i][1]) || 0, Number(nums[i][2]) || 0, Number(nums[i][4]) || 0, r[C.TYPE - 1], r[C.MEMBER - 1], r[C.WHO - 1], r[C.DATE - 1]]);
    }
  }
  return { version: v, month: month, rows: rows, members: members_() };
}

/** type: '취식' | '폐기' | '' (clear). memberFull: 전체 이름. */
function setTag(rowHint, key, type, memberFull, month) {
  if (['취식', '폐기', ''].indexOf(type) < 0) throw new Error('bad type');
  var mem = null;
  if (type) {
    members_().forEach(function (m) { if (m.full === memberFull) mem = m; });
    if (!mem) throw new Error('직원 목록에 없는 이름이에요. 이름을 다시 골라 주세요.');
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(SH_ITEMS);
    var row = Number(rowHint);
    if (!(row >= 2 && row <= sh.getLastRow() && sh.getRange(row, C.KEY).getDisplayValue() === key)) {
      var f = sh.getRange('A:A').createTextFinder(key).matchEntireCell(true).findNext();
      if (!f) throw new Error('항목을 찾지 못했어요. 새로고침해 주세요.');
      row = f.getRow();
    }
    var rng = sh.getRange(row, C.TYPE, 1, 4);
    if (type) {
      var who = type === '취식' ? mem.full : mem.short;
      rng.setValues([[type, who, mem.full, Utilities.formatDate(new Date(), TZ, 'MM/dd HH:mm')]]);
    } else {
      rng.clearContent();
    }
    bumpVersion_();
  } finally {
    lock.releaseLock();
  }
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
