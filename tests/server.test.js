// Server checks without Apps Script: `node tests/server.test.js` (uses tests/mock.js).
// Covers the store plumbing: per-store sheets / properties / cache, the api() and doPost entries, the month cache,
// cross-store 근무 시간 data, BGF import per store (fake BGF), nightly, passwords. Add a case when you add server behavior.
const M = require('./mock.js');
const { exec, sandbox, sheets, doc, props, cache, log, BGF, fmt } = M;
const S = sandbox;
let n = 0;
function ok(name, cond, extra) { n++; if (!cond) { console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); process.exitCode = 1; } else console.log('ok  ', name); }
const now = new Date(), day = k => fmt(new Date(now.getTime() - k * 86400000), 'KST', 'yyyy-MM-dd'), ymd = k => day(k).replace(/-/g, '');
const mon = day(1).slice(0, 7);   // yesterday's month (the test data lives there)

// ----- the spreadsheet as it is today: one store, sheets without a store part -----
const HEAD = S.HEADERS;
const items = doc.insertSheet('폐기목록'); items.cols = 19;
items.data.push(HEAD.slice());
items.data.push(['900-1', day(1), day(1) + ' 10:00:00', '삼각김밥', 'c1', '간편식', 1, 800, 800, 1200, 1200, '900', '', '', '', '', mon, '', '']);
const mem = doc.insertSheet('직원'); mem.data.push(['이름(전체)', '폐기용 이름', '메모', '비밀번호(암호)'], ['김성휘', '성휘', '', ''], ['전병훈', '병훈', '', '']);
const sh = doc.insertSheet('출근일지'); sh.data.push(S.SHIFT_HEADERS.slice());
doc.insertSheet('월별 합계'); const lg = doc.insertSheet('가져오기 기록'); lg.data.push(['실행시각', '대상 기간', '전표 수', '새 품목', '결과']);
Object.assign(props, { ACCESS_OFF: '1', BGF_PW: 'pw-a', VER: '100', LIVE_TRIGGER: '5', OCT_IMPORT: '1', OCT_APPLY: '1', OCT_APPLY2: '1', JEO_BACKFILL: '1', JEO_DIV: '31' });
log.triggers.push('liveTick', 'nightly');

// ----- A. a page from before stores existed calls the functions directly -----
let boot = exec("getBoot('김성휘', '')");
ok('A legacy getBoot', boot.init.store === '25377' && boot.init.stores.length === 2 && boot.month.rows.length === 1 && boot.init.meOk === true, boot.init);
ok('A the other store got its sheets (its shifts are read for 근무 시간)', sheets.length === 9 && props.SHEETS_31949 === '1', sheets.map(s => s.name));
ok('A live info', boot.init.live.wait === '' && boot.month.store === '25377');

// ----- B. the new store: sheets appear by themselves -----
boot = exec("api('31949', 'getBoot', ['', ''])");
ok('B 두왕 sheets made', ['두왕점 폐기목록', '두왕점 직원', '두왕점 출근일지', '두왕점 월별 합계'].every(x => doc.getSheetByName(x)), sheets.map(s => s.name));
ok('B 두왕 boot empty', boot.init.store === '31949' && boot.init.members.length === 0 && boot.month.rows.length === 0 && boot.init.live.wait === 'pw', boot.init);
ok('B summary formula', /두왕점 폐기목록'!Q2:Q/.test(doc.getSheetByName('두왕점 월별 합계').data[2][0]));
let threw = ''; try { exec("api('nope', 'getBoot', ['', ''])"); } catch (e) { threw = e.message; }
ok('B unknown store refused', /없는 점포/.test(threw), threw);
threw = ''; try { exec("api('gs-sinjeong', 'getBoot', ['', ''])"); } catch (e) { threw = e.message; }
ok('B off store (GS25) refused', /없는 점포/.test(threw), threw);
threw = ''; try { exec("api('31949', 'setup', [])"); } catch (e) { threw = e.message; }
ok('B api only runs listed functions', /알 수 없는/.test(threw), threw);

// ----- C. members and shifts are per store; hours cross stores -----
exec("api('31949', 'addMember', ['김성휘'])");
ok('C member only in 두왕', doc.getSheetByName('두왕점 직원').data.length === 2 && mem.data.length === 3);
const v0 = exec("api('25377', 'getMonth', ['" + mon + "', ''])").version;
exec("api('31949', 'addMember', ['박두왕'])");
ok('C other store member change keeps our version', exec("api('25377', 'getMonth', ['" + mon + "', '" + v0 + "'])") === null);
let r = exec("api('31949', 'saveShift', ['', '" + day(1) + "', '김성휘', '09:00', '15:00', '', '" + mon + "', ''])");
ok('C 두왕 shift saved', r.shifts.length === 1 && doc.getSheetByName('두왕점 출근일지').data.length === 2 && sh.data.length === 1, r.shifts);
r = exec("api('25377', 'getMonth', ['" + mon + "', '" + v0 + "'])");
ok('C our version moved with the other store shift', r && r.version !== v0 && r.others.length === 1 && r.others[0].short === '두왕점' && r.others[0].shifts.length === 1 && r.others[0].shifts[0][1] === '김성휘', r && r.others);
exec("api('25377', 'saveShift', ['', '" + day(1) + "', '김성휘', '22:00', '08:00', '', '" + mon + "', ''])");
r = exec("api('31949', 'getMonth', ['" + mon + "', ''])");
ok('C 두왕 sees 둘리 shifts as others', r.others[0].short === '둘리점' && r.others[0].shifts.length === 1 && r.shifts.length === 1, r.others);

// ----- D. month cache -----
const before = exec("api('25377', 'getMonth', ['" + mon + "', ''])");
items.data[1][3] = '바뀐 이름';   // a change that does not move the version
let again = exec("api('25377', 'getMonth', ['" + mon + "', ''])");
ok('D kept answer served', again.rows[0][3] === '삼각김밥', again.rows[0]);
again = exec("api('25377', 'getMonth', ['" + mon + "', '', true])");
ok('D fresh reads the sheet', again.rows[0][3] === '바뀐 이름', again.rows[0]);
exec("onEdit({ range: { getSheet: function () { return { getName: function () { return '폐기목록'; } }; } } })");
ok('D onEdit moves the version', exec("api('25377', 'getMonth', ['" + mon + "', '" + before.version + "'])") !== null);
exec("onEdit({})");   // a bad event does nothing

// ----- E. tagging stays in its store -----
doc.getSheetByName('두왕점 폐기목록').data.push(['900-1', day(1), day(1) + ' 11:00:00', '도시락', 'c2', '간편식', 1, 3000, 3000, 4500, 4500, '900', '', '', '', '', mon, '', '']);
exec("onEdit({ range: { getSheet: function () { return { getName: function () { return '두왕점 폐기목록'; } }; } } })");
r = exec("api('31949', 'setTag', [2, '900-1', '취식', '김성휘', '" + mon + "', '', '김성휘', ''])");
ok('E tag written in 두왕 only', r.rows[0][8] === '취식' && doc.getSheetByName('두왕점 폐기목록').data[1][12] === '취식' && items.data[1][12] === '', [r.rows[0], items.data[1]]);

// a sheet deleted by hand comes back
M.sheets.splice(M.sheets.findIndex(x => x.name === '두왕점 월별 합계'), 1);
M.sheets.splice(M.sheets.findIndex(x => x.name === '두왕점 출근일지'), 1);
r = exec("api('31949', 'getMonth', ['" + mon + "', '', true])");
ok('E deleted sheet remade', !!doc.getSheetByName('두왕점 출근일지') && !!doc.getSheetByName('두왕점 월별 합계') && r.shifts.length === 0, sheets.map(s => s.name));
exec("api('31949', 'saveShift', ['', '" + day(1) + "', '김성휘', '09:00', '15:00', '', '" + mon + "', ''])");

// ----- F. JSON API (the app) -----
let out = JSON.parse(exec("doPost({ postData: { contents: JSON.stringify({ fn: 'getMonth', args: ['" + mon + "', ''], store: '31949' }) } })").text);
ok('F doPost with store', out.ok && out.r.store === '31949' && out.r.rows.length === 1, out);
out = JSON.parse(exec("doPost({ postData: { contents: JSON.stringify({ fn: 'getMonth', args: ['" + mon + "', ''] }) } })").text);
ok('F doPost without store = first store', out.ok && out.r.store === '25377', out);
out = JSON.parse(exec("doPost({ postData: { contents: JSON.stringify({ fn: 'getMonth', args: ['" + mon + "', ''], store: 'x' }) } })").text);
ok('F doPost bad store', !out.ok && /없는 점포/.test(out.err), out);

// ----- G. BGF import per store -----
BGF.pw = { '25377': 'pw-a', '31949': 'pw-b' };
BGF.jumpo = {
  '25377': { STORE_CD: '25377', STORE_NM: '울산둘리점', USER_NO: '25377' },
  '31949': { STORE_CD: '31949', PRE_STORE_CD: '170001', STORE_NM: '울산두왕점', SLC_CD: '', LOC_CD: '02', ADM_SECT_CD: '31140', STORE_OWNER_NM: '홍길동', STORE_POS_QTY: '1', STORE_IP: '10.1.2.3', SV_EMP_NO: '777', SSTORE_ID: '', RCV_ID: '1', FC_CD: 'P2', USER_GRP_ID: '0001', USER_NO: '31949', SGGD_CD: '31140999', LOGIN_USER_NO: '31949' }
};
function slip(no, id, k, lines) { return { CHIT_ID: id, head: { CHIT_NO: no, CHIT_ID: id, CHIT_FLAG: '', CHIT_YMD: ymd(k), ITEM_CNT: String(lines.length), CRE_YMDHMS: ymd(k) + '093000' }, lines: lines.map((nm, i) => ({ CHIT_NO: no, CHIT_SEQ: String(i + 1), ITEM_CD: 'i' + i, ITEM_NM: nm, LARGE_NM: '간편식', QTY: '1', WONGA_PRICE: '700.4', WONGA_AMT: '700.4', MAEGA_PRICE: '1100', MAEGA_AMT: '1100' })) }; }
BGF.slips = { '25377': [slip('A100', '04', 0, ['둘리 김밥', '둘리 우유'])], '31949': [slip('B200', '04', 0, ['두왕 김밥']), slip('B201', '24', 0, ['두왕 저회전 과자'])] };
// the 두왕 page asks before its password exists: nothing is fetched
log.fetch.length = 0;
r = exec("api('31949', 'refreshNow', [])");
ok('G no password → no BGF call', r.wait === 'pw' && log.fetch.length === 0, r);
// the owner enters it in the menu (fake ui)
S.__ui = { ButtonSet: { OK_CANCEL: 1 }, Button: { OK: 'ok' }, alerts: [], prompt: () => ({ getSelectedButton: () => 'ok', getResponseText: () => 'pw-b' }), alert(t) { this.alerts.push(t); } };
exec("menuSetPasswordFor_(__ui, STORES[1])");
ok('G menu password saved + login checked', props.BGF_PW_31949 === 'pw-b' && /로그인 확인 완료 \(울산두왕점\)/.test(S.__ui.alerts[0] || ''), S.__ui.alerts);
const ss = JSON.parse(props.BGF_SS_31949 || '{}');
ok('G SS_* taken from the login answer', ss.SS_PRE_STORE_CD === '170001' && ss.SS_STORE_NM === Buffer.from('울산두왕점').toString('base64') && ss.SS_STORE_OWNER_NM === Buffer.from('홍길동').toString('base64') && ss.SS_SGGD_CD === '31140999' && ss.SS_SV_EMP_NO === '777', ss);
ok('G first store password untouched', props.BGF_PW === 'pw-a');
// two trigger ticks: one store each
log.fetch.length = 0;
exec("liveTick({ triggerUid: 'id-liveTick' })");
exec("liveTick({ triggerUid: 'id-liveTick' })");
const dw = doc.getSheetByName('두왕점 폐기목록').data, dl = items.data;
ok('G 두왕 lines in 두왕 sheet', dw.some(x => x[3] === '두왕 김밥') && dw.some(x => x[3] === '두왕 저회전 과자' && x[18] === '저회전') && !dw.some(x => /둘리/.test(x[3])), dw.map(x => x[3]));
ok('G 둘리 lines in 둘리 sheet', dl.some(x => x[3] === '둘리 김밥') && dl.some(x => x[3] === '둘리 우유') && !dl.some(x => /두왕/.test(x[3])), dl.map(x => x[3]));
ok('G 원가 rounded', dw.find(x => x[3] === '두왕 김밥')[8] === 700);
const reqDw = log.fetch.filter(f => f.u === '/stgj020/search' && f.ds.dsSearch[0].strStoreCd === '31949');
ok('G 두왕 calls carry its own SS_*', reqDw.length >= 2 && reqDw.every(f => f.vars.SS_STORE_CD === '31949' && f.vars.SS_PRE_STORE_CD === '170001' && f.vars.SS_USER_NO === '31949' && /SS_SGGD_CD=31140999/.test(f.cookie)), reqDw.map(f => f.vars));
const reqDl = log.fetch.filter(f => f.u === '/stgj020/search' && f.ds.dsSearch[0].strStoreCd === '25377');
ok('G 둘리 calls keep the old SS_*', reqDl.length >= 2 && reqDl.every(f => f.vars.SS_PRE_STORE_CD === '160081' && f.vars.SS_SGGD_CD === '31140540' && f.vars.SS_STORE_NM === '7Jq47IKw65GY66as7KCQ'), reqDl.map(f => f.vars));
ok('G log lines marked by store', lg.data.some(x => /^\[두왕점\] /.test(x[1])) && lg.data.some(x => /실시간/.test(x[1]) && !/^\[/.test(x[1])), lg.data.map(x => x[1]));
ok('G per-store live state', props.LIVE_OK_AT && props.LIVE_OK_AT_31949 && props.LIVE_AT_31949, Object.keys(props));
r = exec("api('31949', 'refreshNow', [])");
ok('G 두왕 label after import', r.label && r.wait === '' && r.error === false, r);
// a third tick within 50 s: gated, kept session, nothing new
const logins = BGF.loginCount; log.fetch.length = 0;
exec("liveTick({ triggerUid: 'id-liveTick' })");
ok('G gate holds within 50 s', log.fetch.length === 0 && BGF.loginCount === logins, log.fetch.length);
// kept session is reused after the gate opens
props.LIVE_AT_31949 = '0'; props.LIVE_AT = String(Date.now());
exec("liveTick({ triggerUid: 'id-liveTick' })");
ok('G kept 두왕 login reused', BGF.loginCount === logins && log.fetch.length > 0 && log.fetch.every(f => /sess31949/.test(f.cookie)), [BGF.loginCount, logins]);

// ----- H. nightly: every store that can import; a failing store doesn't stop the other -----
BGF.slips['31949'].push(slip('B300', '04', 1, ['두왕 어제 빵']));
BGF.slips['25377'].push(slip('A300', '04', 1, ['둘리 어제 빵']));
out = exec("nightly({ triggerUid: 'id-nightly' })");
ok('H nightly both stores', /CU 울산둘리점/.test(out) && /CU 울산두왕점/.test(out) && dw.some(x => x[3] === '두왕 어제 빵') && dl.some(x => x[3] === '둘리 어제 빵'), out);
BGF.pw['31949'] = 'changed';
delete cache['bgf_session|31949'];
BGF.slips['25377'].push(slip('A301', '04', 1, ['둘리 어제 떡']));
threw = ''; try { exec("nightly({ triggerUid: 'id-nightly' })"); } catch (e) { threw = e.message; }
ok('H one store failing: the other still imports, error reported', /두왕점 실패/.test(threw) && dl.some(x => x[3] === '둘리 어제 떡') && log.mail.some(m => /울산두왕점/.test(m)), [threw, log.mail]);
threw = ''; try { exec("nightly({})"); } catch (e) { threw = e.message; }
ok('H nightly refuses web callers', /관리자/.test(threw), threw);

// ----- J. 월별 마감: a past month's totals are written once and don't move afterwards -----
const old = (k, name, code, qty, w, type, member, src) => [k, '2020-01-31', '2020-01-31 10:00:00', name, code, '간편식', qty, w, w * qty, 1000, 1000, k, type, type === '폐기' ? member.slice(1) : member, type ? member : '', '', '2020-01', '', src || ''];
items.data.push(old('OLD-1', '김밥', 'o1', 2, 500, '취식', '김성휘'), old('OLD-2', '우유', 'o2', 1, 700, '폐기', '전병훈'), old('OLD-3', '빵', 'o3', 1, 300, '', ''), old('OLD-4', '과자', 'o4', 1, 200, '', '', '저회전'));
delete props.CLOSED;
exec('closeAll_()');
const cl = doc.getSheetByName('월별 마감');
ok('J closed sheet made, old month written, this month not', cl && cl.data[0][0] === '월' && cl.data.some(x => x[0] === '2020-01') && !cl.data.some(x => x[0] === mon), cl && cl.data);
ok('J CLOSED property = the due month', props.CLOSED === exec('closeTarget_()') && props.CLOSED < day(0).slice(0, 7), props.CLOSED);
let jm = exec("api('25377', 'getMonth', ['2020-01', '', true])");
ok('J getMonth sends the closed totals', jm.closed && jm.closed.rows.some(c => c[0] === '김성휘' && c[3] === 2 && c[4] === 1000) && jm.closed.rows.some(c => c[0] === '전병훈' && c[1] === 1 && c[2] === 700) && jm.closed.todo[0] === 1 && jm.closed.todo[1] === 300 && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(jm.closed.at), jm.closed);
ok('J open month has no closed totals', exec("api('25377', 'getMonth', ['" + mon + "', '', true])").closed === null);
// next month a cancel slip takes back 김밥: the lines change, the closed totals don't
items.data.push(['NEW-1', '2020-02-01', '2020-02-01 09:00:00', '김밥', 'o1', '간편식', -2, -500, -1000, -1000, -1000, 'NEW', '', '', '', '', '2020-02', '', '']);
exec('closeAll_()');
jm = exec("api('25377', 'getMonth', ['2020-01', '', true])");
ok('J canceled line gone from the list, closed totals kept', !jm.rows.some(r => r[1] === 'OLD-1') && jm.closed.rows.some(c => c[0] === '김성휘' && c[4] === 1000), [jm.rows.map(r => r[1]), jm.closed]);
ok('J 2020-02 not closed again by itself (CLOSED is past it)', !cl.data.some(x => x[0] === '2020-02'));
// the owner redoes January from the menu helper: now from today's lines
out = exec("inStore_(STORES[0], function () { return closeMonth_('2020-01'); })");
jm = exec("api('25377', 'getMonth', ['2020-01', '', true])");
ok('J redo rewrites only that month', /2020-01 마감/.test(out) && !jm.closed.rows.some(c => c[0] === '김성휘') && jm.closed.rows.some(c => c[0] === '전병훈') && cl.data.filter(x => x[0] === '2020-01').length === 2, [out, cl.data]);
ok('J other store has its own state', props.CLOSED_31949 === props.CLOSED && !doc.getSheetByName('두왕점 월별 마감'));

// ----- I. passwords / tokens per store -----
r = exec("api('31949', 'setPassword', ['김성휘', '', 'abcd'])");
ok('I password set in 두왕 only', r.token && doc.getSheetByName('두왕점 직원').data[1][3] && !mem.data[1][3], r);
threw = ''; try { exec("api('31949', 'saveShift', ['', '" + day(2) + "', '김성휘', '09:00', '15:00', '', '" + mon + "', ''])"); } catch (e) { threw = e.message; }
ok('I 두왕 now needs the token', /\[비밀번호\]/.test(threw), threw);
r = exec("api('25377', 'saveShift', ['', '" + day(2) + "', '김성휘', '09:00', '10:00', '', '" + mon + "', ''])");
ok('I 둘리 name still open', !!r && r.shifts.length >= 1);
r = exec("api('31949', 'login', ['김성휘', 'abcd'])");
ok('I login gives the token', !!r.token);

// ----- K. backups: nightly copies every sheet into its own file; the menu helper brings them back -----
const kst = fmt(new Date(), 'KST', 'yyyy-MM-dd'), dSlot = 'D' + new Date(kst + 'T00:00:00Z').getUTCDay();
const bakOf = slot => M.docs.find(d => d.getId() === props['BAK_' + slot]);
let bk = bakOf(dSlot);
const plain = n => !/월별 합계$/.test(n);
ok('K nightly made today\'s weekday backup', bk && props['BAK_AT_' + dSlot] && bk.getName() === '직원 취식 목록 백업 · ' + '일월화수목금토'[+dSlot.slice(1)] + '요일', Object.keys(props).filter(k => /^BAK/.test(k)));
exec("backupTo_('" + dSlot + "')");   // again: 월별 마감 was made (J) after the nightly backup (H)
ok('K backup = every sheet but 월별 합계, + 백업 정보, no "Copy of"',
  JSON.stringify(bk.sheets.map(x => x.name).filter(n => n !== '백업 정보').sort()) === JSON.stringify(sheets.map(x => x.name).filter(plain).sort()) && bk.sheets[0].name === '백업 정보' && !bk.sheets.some(x => /Copy of|Sheet1/.test(x.name)), bk.sheets.map(x => x.name));
ok('K same slot again: replaced, not doubled', bakOf(dSlot) === bk && bk.sheets.length === sheets.filter(x => plain(x.name)).length + 1, bk.sheets.map(x => x.name));
// rows as the sheet shows them (a restore copies the whole grid, so the mock pads with empty cells)
const snap = x => JSON.stringify(x.data.slice(0, x.getLastRow()).map(r => { r = r.slice(); while (r.length && (r[r.length - 1] === '' || r[r.length - 1] === undefined)) r.pop(); return r; }));
const goodShifts = snap(sh), goodMem = snap(mem), nDocs = M.docs.length;
// someone ruins the data: 출근일지 emptied, 직원 sheet deleted, 폐기 tags wiped
sh.data.length = 1;
M.sheets.splice(M.sheets.indexOf(mem), 1);
const goodTags = snap(items);
items.data.forEach((x, i) => { if (i) x[12] = x[13] = x[14] = x[15] = ''; });
const vBefore = props.VER;
let back = exec("restoreFrom_('" + dSlot + "', null)");
ok('K restore brings back every sheet', back.length === bk.sheets.length - 1 && snap(doc.getSheetByName('출근일지')) === goodShifts && snap(doc.getSheetByName('직원')) === goodMem && snap(items) === goodTags && goodTags.indexOf('취식') > 0, back);
ok('K live sheet object kept, nothing left over', doc.getSheetByName('출근일지') === sh && !sheets.some(x => /Copy of/.test(x.name)) && sheets.filter(x => x.name === '직원').length === 1, sheets.map(x => x.name));
ok('K versions moved so pages reload', props.VER !== vBefore && props.SVER && props.VER_31949, [vBefore, props.VER]);
const rb = bakOf('R');
ok('K the ruined state went to 되살리기 직전 first', rb && rb.getSheetByName('출근일지').data.length === 1 && !rb.getSheetByName('직원') && M.docs.length === nDocs + 1, rb && rb.sheets.map(x => x.name));
// only some sheets
sh.data.length = 1; const m2 = doc.getSheetByName('직원'), memRows = m2.getLastRow(); m2.getRange(memRows + 1, 1, 1, 4).setValues([['새사람', '사람', '', '']]);
back = exec("restoreFrom_('" + dSlot + "', ['출근일지'])");
ok('K restore only the named sheet', back.length === 1 && snap(sh) === goodShifts && m2.getLastRow() === memRows + 1, back);
ok('K list newest first, has R', (() => { const l = exec('backupList_()'); return l.length >= 2 && l[0].when >= l[l.length - 1].when && l.some(b => b.slot === 'R'); })());
// a backup file deleted by hand: the next backup makes a new one
bk.gone = true;
exec("backupTo_('" + dSlot + "')");
ok('K deleted backup file is made again', bakOf(dSlot) && bakOf(dSlot) !== bk && bakOf(dSlot).getSheetByName('출근일지'));
threw = ''; try { exec("restoreFrom_('M7', null)"); } catch (e) { threw = e.message; }
ok('K missing slot refused', /찾지 못했어요/.test(threw), threw);
threw = ''; try { exec("api('25377', 'restoreFrom_', ['" + dSlot + "', null])"); } catch (e) { threw = e.message; }
ok('K not callable through api()', /알 수 없는/.test(threw), threw);
threw = ''; try { exec('menuRestore()'); } catch (e) { threw = e.message; }
ok('K menu needs the spreadsheet ui', /no ui/.test(threw), threw);

// ----- L. Google account access (the check is on from here) -----
delete props.ACCESS_OFF;
const post = (body) => JSON.parse(exec('doPost({ postData: { contents: ' + JSON.stringify(JSON.stringify(body)) + ' } })').text);
out = post({ fn: 'getMonth', args: [mon, ''], store: '25377' });
ok('L no key: data refused', out.ok === false && /^\[접근\]/.test(out.err), out);
threw = ''; try { exec("api('25377', 'getBoot', ['', ''])"); } catch (e) { threw = e.message; }
ok('L no key: api() refused', /^\[접근\]/.test(threw), threw);
threw = ''; try { exec("getBoot('김성휘', '')"); } catch (e) { threw = e.message; }
ok('L direct call refused', /^\[접근\]/.test(threw), threw);
out = post({ fn: 'getPage', args: [''] });
ok('L getPage open without a key', out.ok === true && out.r && out.r.hash, out);
out = post({ fn: 'redeem', args: ['ABCDEFGH'] });
ok('L the old 접근 코드 call is gone', out.ok === false && /알 수 없는/.test(out.err), out);
const N1 = 'nonce-aaaaaaaaaaaaaaaaaaaa', N2 = 'nonce-bbbbbbbbbbbbbbbbbbbb', N3 = 'nonce-cccccccccccccccccccc';
exec("GOOGLE_CLIENT_ID = ''");
out = post({ fn: 'gLogin', args: [N1, 'aa.bb.cc'] });
ok('L no client id yet: sign-in says so', out.ok === false && /설정되지 않았/.test(out.err), out);
const CID = 'test-client.apps.googleusercontent.com';
exec("GOOGLE_CLIENT_ID = '" + CID + "'");
const exp = Math.floor(Date.now() / 1000) + 3600;
S.__tokens = {
  'h.staff.s': { aud: CID, iss: 'https://accounts.google.com', email: 'Staff@Gmail.com', email_verified: 'true', exp: String(exp) },
  'h.other.s': { aud: 'someone-else.apps.googleusercontent.com', iss: 'accounts.google.com', email: 'x@gmail.com', email_verified: 'true', exp: String(exp) },
  'h.old.s': { aud: CID, iss: 'accounts.google.com', email: 'old@gmail.com', email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) - 10) },
  'h.owner.s': { aud: CID, iss: 'accounts.google.com', email: 'o@x', email_verified: 'true', exp: String(exp) },
  'h.legacy.s': { aud: CID, iss: 'accounts.google.com', email: 'legacy@gmail.com', email_verified: 'true', exp: String(exp) }
};
// tok(kind, nonce): a token whose claims are kind's, carrying that nonce (as Google puts the request's nonce in it)
const tok = (kind, n) => { const t = 'h.' + kind + n + '.s'; S.__tokens[t] = Object.assign({}, S.__tokens['h.' + kind + '.s'], { nonce: n }); return t; };
out = post({ fn: 'gPoll', args: [N1, ''] });
ok('L poll before sign-in: none', out.ok === true && out.r.s === 'none', out);
out = post({ fn: 'gLogin', args: [N1, tok('other', N1)] });
ok('L token for another app refused', out.ok === false && /확인하지 못했/.test(out.err), out);
out = post({ fn: 'gLogin', args: [N1, tok('old', N1)] });
ok('L expired token refused', out.ok === false, out);
out = post({ fn: 'gLogin', args: [N2, tok('staff', N1)] });
ok('L token made for another nonce refused', out.ok === false && /확인하지 못했/.test(out.err), out);
out = post({ fn: 'gLogin', args: [N1, 'not-a-token'] });
ok('L junk token refused', out.ok === false, out);
out = post({ fn: 'gLogin', args: ['short', tok('staff', 'short')] });
ok('L bad nonce refused', out.ok === false, out);
const mails = log.mail.length;
out = post({ fn: 'gLogin', args: [N1, tok('staff', N1)] });
ok('L new account: waits, email lower-cased', out.ok === true && out.r.s === 'wait' && out.r.email === 'staff@gmail.com', out);
ok('L owner gets one mail with the request', log.mail.length === mails + 1 && /staff@gmail\.com/.test(log.mail[log.mail.length - 1]), log.mail.slice(-1));
post({ fn: 'gLogin', args: [N2, tok('staff', N2)] });
ok('L same account again: no second mail', log.mail.length === mails + 1);
out = post({ fn: 'gPoll', args: [N1, ''] });
ok('L poll while waiting: wait, no key', out.ok === true && out.r.s === 'wait' && !out.r.dev, out);
ok('L ACCOUNTS has it waiting', JSON.parse(props.ACCOUNTS)['staff@gmail.com'].s === 'wait');
// the owner's mail link
let page = exec("doGet({ parameter: { allow: 'staff@gmail.com', s: 'wrong' } })").html;
ok('L allow link with a bad sig: no button', /맞지 않아요/.test(page) && !/allowAccount/.test(page));
const sig = exec("allowSig_('staff@gmail.com')");
page = exec("doGet({ parameter: { allow: 'staff@gmail.com', s: '" + sig + "' } })").html;
ok('L allow link: button page', /allowAccount\("staff@gmail.com"/.test(page), page.slice(0, 200));
threw = ''; try { exec("allowAccount('staff@gmail.com', 'nope')"); } catch (e) { threw = e.message; }
ok('L allowAccount needs the sig', /맞지 않아요/.test(threw), threw);
exec("allowAccount('staff@gmail.com', '" + sig + "')");
out = post({ fn: 'gPoll', args: [N1, ''] });
ok('L allowed: poll gives a device key', out.ok === true && out.r.s === 'ok' && /^g:staff@gmail\.com:[\w-]{32}$/.test(out.r.dev), out);
const dev = out.r.dev;
out = post({ fn: 'getMonth', args: [mon, ''], store: '25377', dev: dev });
ok('L key opens data (doPost)', out.ok === true && out.r && out.r.rows, out.err);
ok('L key opens data (api)', exec("api('25377', 'getInit', ['김성휘', ''], '" + dev + "')").members.length >= 1);
out = post({ fn: 'getMonth', args: [mon, ''], store: '25377', dev: 'g:boss@gmail.com:' + dev.slice(-32) });
ok('L key with another email refused', out.ok === false && /^\[접근\]/.test(out.err), out);
out = post({ fn: 'getMonth', args: [mon, ''], store: '25377', dev: dev.slice(0, -32) + 'x'.repeat(32) });
ok('L forged key refused', out.ok === false && /^\[접근\]/.test(out.err), out);
threw = ''; try { exec("getBoot('김성휘', '')"); } catch (e) { threw = e.message; }
ok('L direct call still refused after a good api call', /^\[접근\]/.test(threw), threw);
out = post({ fn: 'gPoll', args: [N3, ''] });
ok('L another phone, same account: signs in, gets in (always allowed)', out.r.s === 'none' && post({ fn: 'gLogin', args: [N3, tok('staff', N3)] }).r.s === 'ok' && post({ fn: 'gPoll', args: [N3, ''] }).r.dev === dev);
// cut the account: its key stops at once; allowing again brings it back
exec("setAccount_('staff@gmail.com', 'no')");
out = post({ fn: 'getMonth', args: [mon, ''], store: '25377', dev: dev });
ok('L cut account: key refused at once', out.ok === false && /^\[접근\]/.test(out.err), out);
ok('L cut account: poll says no', post({ fn: 'gPoll', args: [N1, ''] }).r.s === 'no');
exec("setAccount_('staff@gmail.com', 'ok')");
ok('L allowed again: same key works', post({ fn: 'getMonth', args: [mon, ''], store: '25377', dev: dev }).ok === true);
// the owner is always in
out = post({ fn: 'gLogin', args: ['nonce-owner-aaaaaaaaaaaaaaa', tok('owner', 'nonce-owner-aaaaaaaaaaaaaaa')] });
ok('L owner: ok at once', out.r.s === 'ok' && post({ fn: 'gPoll', args: ['nonce-owner-aaaaaaaaaaaaaaa', ''] }).r.s === 'ok', out);
// a phone with a key from the 접근 코드 days: its account is allowed by itself (until ACCESS_OLD_UNTIL)
const oldId = 'abcdefghijklmnop', oldDev = oldId + '.' + exec("b64_(Utilities.computeHmacSha256Signature('dev|" + oldId + "', secret_('ACCESS_KEY'))).slice(0, 32)");
out = post({ fn: 'getMonth', args: [mon, ''], store: '25377', dev: oldDev });
ok('L old 접근 코드 key alone no longer opens data', out.ok === false && /^\[접근\]/.test(out.err), out);
post({ fn: 'gLogin', args: ['nonce-legacy-aaaaaaaaaaaaaa', tok('legacy', 'nonce-legacy-aaaaaaaaaaaaaa')] });
ok('L waiting account + a forged old key: still waits', post({ fn: 'gPoll', args: ['nonce-legacy-aaaaaaaaaaaaaa', oldId + '.' + 'y'.repeat(32)] }).r.s === 'wait');
out = post({ fn: 'gPoll', args: ['nonce-legacy-aaaaaaaaaaaaaa', oldDev] });
ok('L waiting account + a good old key: allowed by itself', out.r.s === 'ok' && /^g:legacy@gmail\.com:/.test(out.r.dev) && /접근 코드/.test(JSON.parse(props.ACCOUNTS)['legacy@gmail.com'].n), out);
exec("ACCESS_OLD_UNTIL = '2000-01-01'");
exec("setAccount_('legacy@gmail.com', 'wait')");
ok('L after ACCESS_OLD_UNTIL: an old key no longer allows', post({ fn: 'gPoll', args: ['nonce-legacy-aaaaaaaaaaaaaa', oldDev] }).r.s === 'wait');
props.ACCESS_KEY = 'rotated-key';
out = post({ fn: 'getMonth', args: [mon, ''], store: '25377', dev: dev });
ok('L new ACCESS_KEY: every key stops (accounts stay allowed)', out.ok === false && JSON.parse(props.ACCOUNTS)['staff@gmail.com'].s === 'ok', out);
ok('L ... and signing in again gives the new key', post({ fn: 'gPoll', args: [N1, ''] }).r.dev !== dev);
for (let i = 0; i < 45; i++) exec("setAccount_('spam" + i + "@gmail.com', 'wait')");
const acc = JSON.parse(props.ACCOUNTS);
ok('L at most 40 waiting requests, allowed ones kept', Object.keys(acc).filter(k => acc[k].s === 'wait').length === 40 && acc['staff@gmail.com'].s === 'ok' && !acc['spam0@gmail.com'], Object.keys(acc).length);
props.ACCESS_OFF = '1';
out = post({ fn: 'getMonth', args: [mon, ''], store: '25377' });
ok('L ACCESS_OFF = 1 opens it (emergency switch)', out.ok === true, out.err);
threw = ''; try { exec('menuAccounts()'); } catch (e) { threw = e.message; }
ok('L access menu needs the spreadsheet ui', /no ui/.test(threw), threw);

console.log(process.exitCode ? 'SOME FAILED' : 'ALL ' + n + ' PASSED');
