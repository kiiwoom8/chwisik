"""Makes a copy of the staff page that runs without Apps Script, for looking at it in a browser.

    python tests/page-stub.py apps-script/Index.html <out dir>/index.html
    python -m http.server 8765 --directory <out dir>      # then open http://localhost:8765/ at 360 px

It puts a fake google.script.run (api(store, fn, args)) with two stores of made-up data in front of the page script.
Address options: ?delay=ms (server answer time, to see the loading screen), ?fail=N (the first N getBoot calls fail),
?store=31949 (a link that names the store), ?gs=1 (adds a third store without 저회전 and without 전산),
?closed=1 (adds last month as a closed month: 월별 합계 shows its 월별 마감 numbers), ?savefail=1 (saveShift / deleteShift refuse).
?ios=1 = iPhone Safari, ?ios=2 = iPhone home-screen app; ?api=1 = the hosted copy's fetch mode.
Google sign-in for the stub: after the gate's button, gPoll answers none, none, wait (staff@gmail.com), then ok
(calls without a g:… key get [접근]); ?deny=1 answers no instead of ok.
The page keeps its data in localStorage: run localStorage.clear() in the console to start as a new phone.
"""
import io, sys, re
src, out = sys.argv[1], sys.argv[2]
s = io.open(src, encoding='utf-8').read()
stub = r'''
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>
(function () {
  var Q = new URLSearchParams(location.search);
  var DELAY = Number(Q.get("delay") || 600), FAIL = Number(Q.get("fail") || 0);
  var STORES = [{ id: "25377", name: "CU 울산둘리점", short: "둘리점", chain: "CU", jeo: true }, { id: "31949", name: "CU 울산두왕점", short: "두왕점", chain: "CU", jeo: true }];
  if (Q.get("gs")) STORES.push({ id: "gs-sinjeong", name: "GS25 울산신정중앙점", short: "신정중앙점", chain: "GS25", jeo: false });
  var now = new Date(Date.now() + 540 * 60000).toISOString(), today = now.slice(0, 10), mon = today.slice(0, 7);
  var prevMon = new Date(Date.UTC(Number(mon.slice(0, 4)), Number(mon.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  function d(n) { return new Date(Date.now() + 540 * 60000 - n * 86400000).toISOString().slice(0, 10); }
  var DB = {
    "25377": { ver: 1, members: [{ full: "김성휘", short: "성휘", hasPw: false }, { full: "전병훈", short: "병훈", hasPw: false }, { full: "이국환", short: "국환", hasPw: true }],
      rows: [], shifts: [[2, "s1", d(1), "전병훈", "08:00", "13:00", ""], [3, "s2", d(1), "이국환", "13:00", "22:00", ""], [4, "s3", d(1), "김성휘", "22:00", "08:00", ""], [5, "s4", today, "전병훈", "08:00", "", ""]] },
    "31949": { ver: 1, members: [{ full: "김성휘", short: "성휘", hasPw: false }, { full: "박두왕", short: "두왕", hasPw: false }],
      rows: [], shifts: [[2, "t1", d(2), "김성휘", "09:00", "15:00", ""], [3, "t2", d(2), "박두왕", "15:00", "23:00", ""], [4, "t3", d(3), "박두왕", "15:00", "23:30", ""]] },
    "gs-sinjeong": { ver: 1, members: [], rows: [], shifts: [] }
  };
  var names = ["삼각김밥 참치마요", "도시락 제육볶음", "샌드위치 햄치즈", "핫바 매콤", "우유 500ml", "김밥 불고기", "샐러드 닭가슴살", "햄버거 불고기"];
  for (var i = 0; i < 60; i++) {
    var dd = d(i % 6), t = dd + " " + ("0" + (8 + i % 12)).slice(-2) + ":" + ("0" + (i * 7 % 60)).slice(-2) + ":00";
    var who = i % 5 === 0 ? "김성휘" : i % 5 === 1 ? "전병훈" : "";
    DB["25377"].rows.push([i + 2, "k" + i, t, names[i % 8], 1 + i % 2, 1200, 1200 * (1 + i % 2), 2000, who ? (i % 2 ? "취식" : "폐기") : "", who, who, dd, "", i % 11 === 0 ? "저회전" : ""]);
  }
  for (var j = 0; j < 9; j++) DB["31949"].rows.push([j + 2, "w" + j, d(j % 3) + " 10:0" + j + ":00", names[j % 8], 1, 900, 900, 1500, "", "", "", d(j % 3), "", ""]);
  function month(st, m) {
    var o = DB[st];
    var others = STORES.filter(function (x) { return x.id !== st; }).map(function (x) {
      return { id: x.id, short: x.short, shifts: DB[x.id].shifts.filter(function (s) { return s[2].slice(0, 7) === m; }).map(function (s) { return [s[2], s[3], s[4], s[5]]; }) };
    });
    var ok = m === mon, closed = !ok && Q.get("closed") ? { at: mon + "-02 00:01", rows: [["김성휘", 3, 3600, 5, 6000], ["전병훈", 1, 1200, 2, 2400]], todo: [4, 4800] } : null;
    return { version: String(o.ver), store: st, month: m, rows: ok ? o.rows : [], cancels: [], closed: closed, shifts: o.shifts.filter(function (s) { return s[2].slice(0, 7) === m; }), usual: { "*": ["08:00", "13:00"] }, members: o.members, others: others };
  }
  var F = {
    getBoot: function (st, me, tok) { return { init: { members: DB[st].members, months: Q.get("closed") ? [mon, prevMon] : [mon], version: String(DB[st].ver), live: { label: st === "25377" ? "21:31" : "", off: false, error: false, added: 0, wait: st === "25377" ? "" : st === "31949" ? "pw" : "adapter" }, store: st, stores: STORES, meOk: true }, month: month(st, mon) }; },
    getMonth: function (st, m, known, fresh) { return known === String(DB[st].ver) ? null : month(st, m); },
    refreshNow: function (st) { return { label: st === "25377" ? "21:32" : "", off: false, error: false, added: 0, wait: st === "25377" ? "" : "pw" }; },
    setTag: function (st, hint, key, type, member, m) { var o = DB[st]; o.rows.forEach(function (r) { if (r[1] === key) { r[8] = type; r[9] = type ? member : ""; r[10] = type ? member : ""; } }); o.ver++; return month(st, m); },
    addMember: function (st, full) { DB[st].members.push({ full: full, short: full.slice(1), hasPw: false }); return DB[st].members; },
    saveShift: function (st, key, date, member, a, b, memo, m) {
      if (Q.get("savefail")) throw new Error("다른 기록과 겹쳐요 (stub)");
      var o = DB[st], hit = null;
      o.shifts.forEach(function (s) { if (key && s[1] === key) hit = s; });
      if (hit) { hit[2] = date; hit[4] = a; hit[5] = b; hit[6] = memo; } else o.shifts.push([99, "n" + Date.now(), date, member, a, b, memo]);
      o.ver++; return month(st, m);
    },
    deleteShift: function (st, key, member, m) {
      if (Q.get("savefail")) throw new Error("기록을 찾지 못했어요 (stub)");
      var o = DB[st]; o.shifts = o.shifts.filter(function (s) { return s[1] !== key; }); o.ver++; return month(st, m);
    },
    getPage: function () { return null; },
    login: function () { return { token: "tok" }; },
    gPoll: function (st, n, old) {
      var k = (window.STUB_POLLS = (window.STUB_POLLS || 0) + 1);
      if (k <= 2) return { s: "none" };
      if (k <= 3) return { s: "wait", email: "staff@gmail.com" };
      if (Q.get("deny")) return { s: "no", email: "staff@gmail.com" };
      return { s: "ok", email: "staff@gmail.com", dev: "g:staff@gmail.com:" + "s".repeat(32) };
    }
  };
  var calls = window.STUB_CALLS = [];
  function runner() {
    var ok = function () {}, bad = function () {};
    var r = {
      withSuccessHandler: function (f) { ok = f; return r; }, withFailureHandler: function (f) { bad = f; return r; },
      api: function (st, fn, args, dev) {
        calls.push(st + ":" + fn);
        setTimeout(function () {
          if (fn !== "getPage" && fn !== "gPoll" && !/^g:/.test(dev || "")) { bad(new Error("[접근] Google 계정으로 들어와 주세요.")); return; }
          if (FAIL > 0 && fn === "getBoot") { FAIL--; bad(new Error("stub fail")); return; }
          if (!DB[st]) { bad(new Error("없는 점포예요. 점포를 다시 골라 주세요.")); return; }
          try { ok(JSON.parse(JSON.stringify(F[fn].apply(null, [st].concat(args)) || null))); } catch (e) { bad(e); }
        }, fn === "getMonth" ? Math.min(DELAY, 400) : DELAY);
      }
    };
    return r;
  }
  /* ?ios=1: an iPhone in Safari (?ios=2: the home-screen app). ?api=1: the hosted copy's mode (CHWISIK_API + fetch). */
  if (Q.get("ios")) {
    Object.defineProperty(navigator, "userAgent", { get: function () { return "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"; } });
    if (Q.get("ios") === "2") Object.defineProperty(navigator, "standalone", { get: function () { return true; } });
  }
  if (Q.get("api")) {
    window.CHWISIK_API = "https://stub.invalid/exec";
    var realFetch = window.fetch;
    window.fetch = function (url, opt) {
      if (url !== window.CHWISIK_API) return realFetch.apply(this, arguments);
      var b = JSON.parse(opt.body);
      return new Promise(function (resolve) {
        calls.push((b.store || "") + ":" + b.fn);
        setTimeout(function () {
          var out;
          if (b.fn !== "getPage" && b.fn !== "gPoll" && !/^g:/.test(b.dev || "")) out = { ok: false, err: "[접근] Google 계정으로 들어와 주세요." };
          else if (!DB[b.store || "25377"]) out = { ok: false, err: "없는 점포예요. 점포를 다시 골라 주세요." };
          else { try { out = { ok: true, r: JSON.parse(JSON.stringify(F[b.fn].apply(null, [b.store || "25377"].concat(b.args)) || null)) }; } catch (e) { out = { ok: false, err: e.message }; } }
          resolve({ ok: true, json: function () { return Promise.resolve(out); } });
        }, DELAY);
      });
    };
  }
  window.google = { script: { url: { getLocation: function (cb) { setTimeout(function () { cb({ parameter: { store: Q.get("store") || "" } }); }, 30); } } } };
  Object.defineProperty(window.google.script, "run", { get: runner });
})();
</script>
'''
s = s.replace('<base target="_top">', stub, 1)
io.open(out, 'w', encoding='utf-8').write(s)
print('stub page written')
