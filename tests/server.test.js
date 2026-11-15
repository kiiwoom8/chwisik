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
Object.assign(props, { BGF_PW: 'pw-a', VER: '100', LIVE_TRIGGER: '5', OCT_IMPORT: '1', OCT_APPLY: '1', OCT_APPLY2: '1', JEO_BACKFILL: '1', JEO_DIV: '31' });
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

// ----- I. passwords / tokens per store -----
r = exec("api('31949', 'setPassword', ['김성휘', '', 'abcd'])");
ok('I password set in 두왕 only', r.token && doc.getSheetByName('두왕점 직원').data[1][3] && !mem.data[1][3], r);
threw = ''; try { exec("api('31949', 'saveShift', ['', '" + day(2) + "', '김성휘', '09:00', '15:00', '', '" + mon + "', ''])"); } catch (e) { threw = e.message; }
ok('I 두왕 now needs the token', /\[비밀번호\]/.test(threw), threw);
r = exec("api('25377', 'saveShift', ['', '" + day(2) + "', '김성휘', '09:00', '10:00', '', '" + mon + "', ''])");
ok('I 둘리 name still open', !!r && r.shifts.length >= 1);
r = exec("api('31949', 'login', ['김성휘', 'abcd'])");
ok('I login gives the token', !!r.token);

console.log(process.exitCode ? 'SOME FAILED' : 'ALL ' + n + ' PASSED');
