# Code map — 직원 취식 목록

Last updated: 2026-11-09

A guide to where things are in the code and how they connect. Functions are listed by name (search for `function <name>`), not by line number, so this file stays right when code moves. Keep it in sync with every change (see `CLAUDE.md`).

Two source files, no build step, no libraries (plus the app shell in `app/`, see the end):

- `apps-script/Code.gs` — Google Apps Script (V8). Runs as the owner. Talks to BGF with `UrlFetchApp`, stores everything in the bound spreadsheet.
- `apps-script/Index.html` — the staff page served by `doGet()`. One IIFE in one `<script>` block, ES5 style (`var`, `function`), talks to the server only through `run()`: `google.script.run` on the `/exec` link, `fetch` to the JSON API in the app.

Naming rule in Code.gs: a name ending in `_` is private. **Any other top-level function is callable by anyone with the /exec link** — so a new public function must check its caller (`authMember_`, `adminOnly_`, `fromTrigger_`, or `SpreadsheetApp.getUi()` for menu items).

---

## Code.gs

### Constants (top of file)

| Name | What |
|---|---|
| `TZ`, `BASE`, `STORE_CD`, `USER_NO` | Asia/Seoul, BGF host, store 25377 |
| `SH_ITEMS`, `SH_MEMBERS`, `SH_SUMMARY`, `SH_LOG`, `SH_SHIFTS` | sheet names: 폐기목록, 직원, 월별 합계, 가져오기 기록, 출근일지 |
| `C`, `NCOL`, `HEADERS` | 폐기목록 columns (1-based). `C.SRC` = 19 = 전표 (`''` 폐기 / `'저회전'`) |
| `OFFSHIFT_NOTE` | `'근무외'` |
| `PYEGI_DIV` | `'10'`, S312 search code for 폐기 |
| `JEO`, `JEO_CHIT_ID`, `CHIT_DIV_CODE` | `'저회전'`, CHIT_ID `'24'`, common code `'S312'` |
| `SC`, `SNCOL`, `SHIFT_HEADERS`, `OPEN_SHIFT_MAX_H` | 출근일지 columns; an open shift counts for 16 h max |
| `LIVE_MIN_GAP_S`, `LIVE_TRIGGER_MIN` | live import: ≥ 120 s between BGF logins; trigger every 10 min |
| `MC`, `PW_HEADER`, `AUTH_TAG` | 직원 columns; `[비밀번호]` marks auth errors for the page |
| `RS`, `US`, `SS_VARS` | SSV separators; BGF session variables sent with every call |

### Setup and menu — section `시트 준비 / 메뉴`

- `setup()` (admin) — creates/formats sheets, headers, the 월별 합계 QUERY, both triggers. Safe to re-run.
- `onOpen()` — builds the 취식 관리 menu. Each item maps to a `menu…` function or `nightly` / `installNightlyTrigger`.
- `menuLiveNow`, `menuJeoBackfill`, `menuLiveOn`, `menuLiveOff`, `menuSetPassword`, `menuImportRange`, `menuSetDevPw`, `menuClearMemberPw` — menu handlers; each calls `SpreadsheetApp.getUi()` first so web callers fail.
- `installNightlyTrigger()` (admin), `installLiveTrigger_()`, `removeLiveTrigger_()` — trigger management.
- `liveTick(e)` — 10-min trigger → `refreshNow()`.
- `adminOnly_()` — throws unless the active user is the owner. `fromTrigger_(e)` — true when `e.triggerUid` is one of this project's triggers.

### Import — sections `매일 가져오기`, `실시간 가져오기`, `BGF 점포시스템 통신`

Flow (both nightly and live):

```
nightly(e) ─► importRange_(from,to) ─┐
menuImportRange ──────────────────────┤
                                      ├─► fetchAll_(from,to,known?) ─► bgfLogin_()
refreshNow() ─► liveImport_() ────────┘        │                       ├─► fetchSlips_(s,'10','',  '',     …)  폐기
                                                │                       └─► fetchSlips_(s,jeoDiv_(s),'24','저회전',…)
                                                └─► appendItems_(items) ─► itemsSheet_(), dedupe by key, bumpVersion_()
```

- `nightly(e)` — trigger/admin only; yesterday and the day before → `importRange_`.
- `importThisMonth()` (admin) — 1st of the month to today.
- `importRange_(from, to)` — full re-read (no `known`), logs to 가져오기 기록, emails the owner on failure, rethrows.
- `itemsSheet_()` — returns 폐기목록, adding missing columns and the 전표 header (one-time migration). Used by `appendItems_` and `getMonth`.
- `appendItems_(items)` — under the script lock: skips keys already in the sheet **or earlier in the same batch**, sorts by time, writes rows (전표 = `it.src`), bumps `VER`.
- `refreshNow()` (public, no auth: it only imports) — throttle gate (`LIVE_OFF`, `LIVE_AT` ≥ 120 s, cache flag `live_running`), installs the live trigger if missing, → `liveImport_()`; returns `liveInfo_`.
- `liveImport_()` — yesterday..today with `knownChits_()` so only new slips get detail calls. Never throws; stores `LIVE_OK_AT` / `LIVE_MS` / `LIVE_ERR` / `JEO_ERR`; logs when lines were added or a failure streak starts. Then calls `jeoBackfill_(session)` (does nothing once `JEO_BACKFILL=1`).
- `jeoBackfill_(session, force)` — one-time 저회전 import from the earliest 일자 in 폐기목록 to today; reuses the live run's login; retries at most hourly unless `force`. Never throws.
- `liveInfo_(props, added)` — `{label, off, error, added}` for the page header.
- `knownChits_()` — `{CHIT_NO: lines in sheet}`.
- `logImport_(range, chits, added, result)` — appends to 가져오기 기록.
- `ssvBuild_(vars, dsName, cols, row)` — SSV request with one dataset/one row. `ssvVarsOnly_(vars)` — variables only. `ssvParse_(text)` — `{vars, ds: {name: [rowObj]}}`.
- `Session_` — cookie jar; `.get(path)`, `.post(path, body)` (throws on HTTP ≠ 200 or `ErrorCode ≠ 0`).
- `bgfLogin_()` — logs in with `BGF_PW`; throws a Korean message if missing/failed. `svcVars_()` — vars for service calls.
- `fetchAll_(from, to, known, session?)` — one login (or the given session), 폐기 then 저회전. A 저회전 error is caught into `jeoErr` (폐기 still imports). Returns `{chits, jeoChits, fetched, items, jeoErr, session}`. `jeoNote_(r)` — short log suffix.
- `jeoDiv_(s)` — S312 lookup via `/stco010/selComCd`, first CODE whose NAME contains `저회전`; cached in `JEO_DIV`; `''` if not found.
- `fetchSlips_(s, divCode, onlyChitId, src, from, to, known)` — list call → filter (`CHIT_NO`, optional `CHIT_ID`) → skip slips fully known → group by (date, CHIT_ID, CHIT_FLAG) → detail calls in chunks of 40 (`searchDetailType0` for flag PA, else `Type1`) → item objects `{key, date, time, name, code, cat, qty, wprice, wamt, mprice, mamt, chit, src}`.
- `ymd_(d)` — `yyyyMMdd` in KST.

### Web app — section `웹앱`

- `doGet()` — serves `Index.html` with the viewport meta (`width=device-width, initial-scale=1`; no `viewport-fit=cover`, see DEVNOTES gotchas).
- `doPost(e)` — JSON API for the app: body `{fn, args}`, runs only names in `apiFns_()`, answers `{ok, r}` / `{ok:false, err}`. **A new public function the app should use must be added to `apiFns_()`.**
- `getBoot(me, token)` (public) — `getInit` + `getMonth(newest, '')` in one call; the page's first call.
- `getPage(knownHash)` (public) — `Index.html` source + MD5 hash for the app's self-update; `null` when unchanged.
- `bumpVersion_()`, `version_()` — data version `VER` (also clears the `members` cache key).
- Members: `memberRows_()`, `members_()` (public shape `{full, short, hasPw}`), `memberRow_(full)` (throws if unknown), `shortName_(full)`, `addMember(full)` (public; sanitizes, appends).
- Passwords: `secret_(name)`, `b64_`, `pwHash_(full, pw)`, `devHash_(pw)`, `token_(m)`, `authMember_(full, token)` (the auth check every write uses), `login(full, pw)` (public, rate-limited), `setPassword(full, token, newPw)` (public).
- `withLock_(fn)` — script lock wrapper (15 s).
- `getInit(me, token)` / `getInitData_()` — boot payload.
- `getMonth(month, knownVersion)` — reads all of 폐기목록 once, runs `cancelMatch_`, builds `rows` (index 13 = src) and `cancels` (index 6 = src) for the month, plus shifts/usual/members.
- `cancelMatch_(vals, nums)` — BGF cancel pairing; product key = `src|상품코드-or-품명`. Returns `{neg, left}`.
- `setTag(rowHint, key, type, memberFull, month, note, me, token)` — the only writer of columns M–R. Checks: valid type, `authMember_`, own name only, row found by hint or key, row not owned by someone else, **no 폐기 on a 저회전 row**. Then writes and returns `getMonth`.

### 출근일지 — section `출근일지`

- `shiftSheet_()`, `readShifts_()`, `writeShift_(sh, row, s)`.
- Time helpers: `toMin_(date, hhmm)` (minutes on a KST number line), `nowMin_()`, `shiftSpan_(s)` (overnight aware), `shiftHours_`.
- `shiftsFor_(month, all)`, `usualShifts_(all)`, `openShiftOf_(all, member, nowM)`, `overlapOf_(…)`.
- Public (all check `authMember_`): `clockIn`, `clockOut`, `saveShift`, `deleteShift`.

---

## Index.html

### Layout (HTML)

Sticky header: title + month switcher, "나: 이름" + 이름 바꾸기 / 비밀번호 + sync label, my 취식/폐기 totals, the tab bar (`.tabs`, 8 columns, `data-view` = `shift`, `todo`, `eat`, `void`, `all`, `cancel`, `jeo`, `sum`; counters `#c-<view>`), search box. Main: `#status`, `#whoBar` (name filter), `#list` (line views), `#shifts`, `#sum`, `#emptyMsg`. Bottom sheets: `#confirm`, `#shiftEd`, `#picker`, `#pwSheet`. `#snack` for messages with 되돌리기.

CSS: tokens on `:root` with a dark-mode override; `.row.t-eat` / `.t-void` / `.t-cancel`; `.stamp` buttons (`.eat`, `.void`, `.on`, `.undo`); `.jeotag` labels 저회전 lines outside the 저회전 tab; `@media (max-width: 380px)` shrinks stamps and tab text so 8 tabs fit at 360 px.

### State

`S = { months, month, version, rows, cancels, shifts, usual, members, me, view, who, q, busy, live, refreshing, online }`. `S.me` and tokens persist in localStorage (`chwisik.me`, `chwisik.tok`). Constants: `POLL_MS` 5 s, `LIVE_MS` 3 min, `GRACE_MIN` 30, `OPEN_MAX_MIN` 16 h, `GAP_MIN` 15, `OFFSHIFT`, `JEO`.

Row shape (from `getMonth`): `[sheetRow, key, time, name, qty, wprice, wamt, mamt, type, memberFull, who, date, note, src]`.

### Functions by area

- Helpers: `$`, `fmt`, `lsGet`/`lsSet`, `mk(tag, cls, text)`, `tok`/`setTok`, `isAuthErr`, `run(fn, …args)` (Promise: `fetch` to `API` = `window.CHWISIK_API` in the app, else `google.script.run`), `errMsg`, `status`, `memberOf`, `shortOf`.
- Time: `toMin`, `nowMin`, `todayStr`, `curMonth`, `dur`, `dowOf`, `dayLabel`, `dayEl` (red 일 / blue 토), `addDays`, `hm`.
- Shifts logic: `span(s, nowM)` (`{a, b, open, live, stale, e}`), `openShift`, `workedAt(member, ts, grace)`, `workersAt(ts)`, `gapsOf(d, nowM)`, `checkDays()`, `overlapsOf(…)`.
- Name filter: `whoNames()` (per view), `curWho()`, `renderWho()`.
- Render: `render()` (tabs, counters — 미등록 excludes 저회전, 전체 = 폐기 lines, 저회전 = 저회전 lines — then dispatch), `renderList()` (filters per view, groups by day), `rowEl(r)` (buttons per view; 폐기 button removed for 저회전 rows; 저회전 tab = one button, 취식 → 취소 once registered; disabled for other workers' rows), `renderCancels()`, `renderShifts()`, `gapEl`, `shiftEl`, `renderSum()`, `table(…)`.
- Tagging: `tap(r, type)` (guards: picker, other worker, 저회전 + 폐기, off-shift confirm) → `doTag` → `apply` (optimistic) + `send` (`setTag`; rolls back on error) + snack undo.
- Shifts UI: `call(fn, args, done)` (adds token), `clock`, `openEditor(s, preset)`, `edHint`, `closeEditor`, form submit / delete handlers.
- Dialogs: `confirmBox`, `closeConfirm`, `openPicker`, `choose`, `openPw`, `closePw`, `savePw`.
- Data: `take(res, force)` (also `saveCache`), `saveCache(res)` / `loadCache()` (localStorage `chwisik.cache`: newest month's data for an instant start), `load(force)` (poll with version), `refreshLive()` (`refreshNow`), `setOnline`, `renderSync`.
- Misc: `snack(text, undo)`, tab click handlers, search, `goMonth`, Esc handling, `visibilitychange`.
- App update: `checkAppUpdate()` (app only: `getPage(CHWISIK_PAGE_HASH)` → localStorage `chwisik.page`, reload on next `visibilitychange`). The script's first lines clear `chwisik.pageTry` (tells the loader the page started).
- Boot: `loadCache()` draws the last data → `getBoot` → pick name / password → `refreshLive()` + `checkAppUpdate()` → intervals (poll 5 s, live 3 min, re-render 출근 every minute).

---

## app/ (Android app and installable page)

- `www/index.html` — loader: picks `chwisik.page` from localStorage (unless `chwisik.pageTry` says it broke) or fetches `page.html`, injects `CHWISIK_API` / `CHWISIK_PAGE_HASH` + viewport, `document.write`s it. Registers `sw.js` on real HTTPS hosts only (not inside the app, where the origin is `https://localhost`). **The `/exec` URL is hard-coded here**; change it if the deployment ever changes.
- `www/sw.js` — cache-first for the loader files (installable page only). Bump `CACHE` when the file list changes.
- `www/manifest.webmanifest`, `www/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`; `android-res/mipmap-*/ic_launcher*.png`, `android-res/drawable/splash.xml`; `make-icons.py` redraws all icons (PIL + Malgun Gothic Bold).
- `build.mjs` — `apps-script/Index.html` → `www/page.html` (generated, git-ignored).
- `capacitor.config.json` — app id `com.kiiwoom8.chwisik`, name 취식, `webDir: www`. `package.json` / `package-lock.json` — Capacitor 7. `android/` is generated in CI (git-ignored).

## Recipes

**Change the page.** Edit `apps-script/Index.html` and push: the `/exec` link updates via deploy.yml and the app picks it up by itself (`getPage`). Keep it working in both modes: no Apps Script templating (`<? ?>`), every server call through `run()`, and any new server function the page calls added to `apiFns_()`.

**Change the app shell** (`app/`). Push; android.yml builds a new APK on release android-latest. Phones only need it if the loader, icons or native settings changed.

**Import another BGF slip type (like 저회전).**
1. Find its CHIT_ID and detail dataset: read `https://store.bgfretail.com/websrc/deploy/GJ/STGJ020_P1.xfdl.js` (no login needed) for `strTitle` per `case "NN"`, and which `searchDetailType*` case group it is in. If it isn't `Type1`/`dsListType1`, the columns differ — map them in `fetchSlips_`.
2. Add constants, then a `fetchSlips_` call in `fetchAll_` with its own `src` value (look up the S312 search code by name like `jeoDiv_`, and always filter by CHIT_ID). Add a one-time backfill like `jeoBackfill_`: the live import only reads yesterday..today, so past days stay empty otherwise.
3. Server rules for tagging in `setTag`; page: a tab (`data-view`, counter id, `.tabs` column count), filters in `renderList` / `whoNames` / `render` counters, buttons in `rowEl`, guard in `tap`.
4. Update DEVNOTES (sheet column values, protocol, page behavior), this file, HISTORY.

**Add a column to 폐기목록.** Append to `C`, `NCOL`, `HEADERS`; extend the row in `appendItems_`; `itemsSheet_()` adds the column to old sheets (generalize its header check if the new column needs one); fix `setup()` number formats; extend the row shape in `getMonth` **at the end** (the page indexes rows by position) and document the shape.

**Add a public server function.** No trailing `_`; first line checks the caller (`authMember_(me, token)` for workers). Wrap sheet writes in `withLock_`, call `bumpVersion_()` after writes, return `getMonth(month, '')` if the page should refresh.

**Add a tab.** Button in `.tabs` (and bump `repeat(N, 1fr)`; check 360 px), counter in `render()`, filter in `renderList()` (or its own renderer), `whoNames()` / `curWho()` rules, empty message.
