# Code map — 직원 취식 목록

Last updated: 2026-11-25

A guide to where things are in the code and how they connect. Functions are listed by name (search for `function <name>`), not by line number, so this file stays right when code moves. Keep it in sync with every change (see `CLAUDE.md`).

Two source files, no build step, no libraries (plus the app shell in `app/`, see the end):

- `apps-script/Code.gs` — Google Apps Script (V8). Runs as the owner. Talks to BGF with `UrlFetchApp`, stores everything in the bound spreadsheet.
- `apps-script/Index.html` — the staff page served by `doGet()`. One IIFE in one `<script>` block, ES5 style (`var`, `function`), talks to the server only through `run()`: `google.script.run` on the `/exec` link, `fetch` to the JSON API in the app.

Every server function works for **one store**: `store_()` (set by `useStore_` for a page request, `inStore_` in triggers and the menu). Never write a sheet name, a store code or a Script Property key directly: use `sheet_(SH_…)`, `store_().id`, `pget_` / `pset_` (per store) or `gget_` / `gset_` (shared). See DEVNOTES → Stores.

Naming rule in Code.gs: a name ending in `_` is private. **Any other top-level function is callable by anyone with the /exec link** — so a new public function must check its caller (`authMember_`, `adminOnly_`, `fromTrigger_`, or `SpreadsheetApp.getUi()` for menu items).

---

## Code.gs

### Constants (top of file)

| Name | What |
|---|---|
| `TZ`, `BASE` | Asia/Seoul, BGF host |
| `STORES` | the stores: `{id, name, short, chain, on, legacy, userNo, ss}`. First = 둘리점 (`legacy`: names without a store part) |
| `CHAINS` | import adapter per chain: `{system, pwKey, jeo, live, range, check}`. `CU` = BGF; `GS25` = no import yet |
| `SH_ITEMS`, `SH_MEMBERS`, `SH_SUMMARY`, `SH_LOG`, `SH_SHIFTS` | **base** sheet names: 폐기목록, 직원, 월별 합계, 가져오기 기록, 출근일지 (a store's real name: `sheetName_`) |
| `MONTH_CACHE_S`, `BIG_CHUNK` | month answers kept 1 h; cache pieces of 30,000 characters |
| `C`, `NCOL`, `HEADERS` | 폐기목록 columns (1-based). `C.SRC` = 19 = 전표 (`''` 폐기 / `'저회전'`) |
| `OFFSHIFT_NOTE` | `'근무외'` |
| `PYEGI_DIV` | `'10'`, S312 search code for 폐기 |
| `JEO`, `JEO_CHIT_ID`, `CHIT_DIV_CODE` | `'저회전'`, CHIT_ID `'24'`, common code `'S312'` |
| `SC`, `SNCOL`, `SHIFT_HEADERS`, `OPEN_SHIFT_MAX_H` | 출근일지 columns; an open shift counts for 16 h max |
| `LIVE_MIN_GAP_S`, `LIVE_TRIGGER_MIN`, `BGF_SESSION_MIN` | live import: ≥ 50 s between BGF reads; trigger every 5 min; kept BGF login reused for 60 min |
| `MC`, `PW_HEADER`, `AUTH_TAG` | 직원 columns; `[비밀번호]` marks auth errors for the page |
| `RS`, `US`, `SS_KEYS`, `SS_B64` | SSV separators; the names of BGF's `SS_*` store variables, and which are base64 |

### Stores — section `점포 (multi-store)` (top of file)

- `store_()` — the store of this execution (`CUR_`, default the first). `storeById_(id)` (throws for an unknown / off store), `useStore_(id)` (page entry: sets it and makes its sheets), `inStore_(st, fn)` (run fn for another store, then come back), `onStores_()`.
- `importer_(st)` — the chain adapter when the store can import now (adapter + password), else null. `importWait_(st)` — `''` / `'pw'` / `'adapter'`. `posStores_()` (chain has an adapter), `importStores_()` (can import now).
- `sheetName_(base, st)`, `doc_()` (the spreadsheet, once per execution), `sheet_(base, st)` (re-makes a store sheet that was deleted by hand).
- Script Properties: `ps_()`, `snap_()` (all properties, read once per execution), `pkey_`, `pget_` / `pset_` / `pdel_` (this store), `gget_` / `gset_` / `gdel_` (shared). `ck_(k, st)` — cache key of a store.

### Setup and menu — section `시트 준비 / 메뉴`

- `setup()` (admin) — `storeSheets_(st, true)` for every store that is on, 가져오기 기록, both triggers. Safe to re-run.
- `storeSheets_(st, redo)` — one store's four sheets; makes what is missing (every request of a non-first store, cheap: `SHEETS_<id>` mark), `redo` also rewrites headers / formats / the 월별 합계 QUERY.
- `onOpen()` — builds the 취식 관리 menu: one password item per store with an adapter, then the shared items.
- `askStores_(ui, list, all)` — menu prompt "which store?" (skipped when there is one).
- `menuLiveNow` (every importing store), `menuJeoBackfill` (first store), `menuLiveOn`, `menuLiveOff`, `menuSetPassword` / `menuSetPassword2` / `menuSetPassword3` → `menuSetPasswordFor_(ui, st)`, `menuImportRange` (asks the store), `menuReclose` (asks the store and month → `closeMonth_`), `menuSetDevPw`, `menuClearMemberPw` (asks the store) — menu handlers; each calls `SpreadsheetApp.getUi()` first so web callers fail.
- `installNightlyTrigger()` (admin), `installLiveTrigger_()`, `removeLiveTrigger_()` — trigger management.
- `liveTick(e)` — 5-min trigger: `autoOutAll_` for every store, `closeAll_()`, then `liveGate_` for the one store read longest ago.
- `onEdit(e)` — simple trigger: a hand edit of a store's 폐기목록 / 직원 / 출근일지 / 월별 마감 moves that store's `VER` (and `SVER` for 출근일지).
- `adminOnly_()` — throws unless the active user is the owner. `fromTrigger_(e)` — true when `e.triggerUid` is one of this project's triggers.

### Import — sections `매일 가져오기`, `실시간 가져오기`, `BGF 점포시스템 통신`

Flow (both nightly and live):

```
nightly(e) ── each store ─► importRange_(from,to) ─► CHAINS[chain].range ─┐
menuImportRange ── store(s) ─┘                                             ├─► fetchAll_(from,to,known?) ─► bgfLogin_() ─► bgfSsFromLogin_()
refreshNow() ─► liveGate_() ─► liveImport_() ─► CHAINS[chain].live ─► liveFetch_ ┘        │              ├─► fetchSlips_(s,'10','',  '',     …)  폐기
liveTick(e) ── one store ──┘                                                               │              └─► fetchSlips_(s,jeoDiv_(s),'24','저회전',…)
                                                                                           └─► appendItems_(items) ─► itemsSheet_(), dedupe by key, bumpVersion_()
```
(Everything left of `CHAINS[…]` is chain-neutral; a GS25 adapter plugs in there.)

- `nightly(e)` — trigger/admin only; yesterday and the day before → `importRange_` for every store that can import; one store failing doesn't stop the next (the error is thrown at the end); then `closeAll_()`.
- `importThisMonth()` (admin) — 1st of the month to today, every importing store.
- `importRange_(from, to)` — current store: full re-read through its adapter's `range`, logs to 가져오기 기록 (`[점포]` prefix for non-first stores), emails the owner on failure, rethrows.
- `itemsSheet_()` — returns 폐기목록, adding missing columns and the 전표 header (one-time migration). Used by `appendItems_` and `getMonth`.
- `appendItems_(items)` — under the script lock: skips keys already in the sheet **or earlier in the same batch**, sorts by time, writes rows (전표 = `it.src`), bumps `VER`.
- `refreshNow()` (public, no auth: it only imports) — current store: `octOnce_()` (first store), `autoOutAll_()`, then `liveGate_()`.
- `liveGate_()` — throttle gate (`LIVE_OFF`, an importer, the store's `LIVE_AT` ≥ 50 s, cache flag `live_running|id`), installs the live trigger if `LIVE_TRIGGER` ≠ `LIVE_TRIGGER_MIN`, → `liveImport_()`; returns `liveInfo_`. `octOnce_()` — the one-time October step (Oct2026.gs).
- `liveImport_()` — current store, yesterday..today through its adapter's `live` with `knownChits_()` so only new slips get detail calls. Never throws; stores `LIVE_OK_AT` / `LIVE_MS` / `LIVE_ERR` / `JEO_ERR`; logs when lines were added or a failure streak starts. For the first store only it then calls `jeoBackfill_(session)` (does nothing once `JEO_BACKFILL=1`) and `octImport_(session)` (does nothing once `OCT_IMPORT=1`).
- `liveFetch_(from, to, known)` — `fetchAll_` on the kept BGF session (`keptSession_()`, CacheService `bgf_session`, ≤ `BGF_SESSION_MIN`); if it throws, finds no slips or 저회전 fails, logs in fresh and reads again; `keepSession_()` stores the session that worked (keeps its first login time).
- `jeoBackfill_(session, force)` — one-time 저회전 import from the earliest 일자 in 폐기목록 to today; reuses the live run's login; retries at most hourly unless `force`. Never throws.
- `octImport_(session)` — one-time import of October 2026 (폐기 + 저회전, 20261001–20261031) for bringing in October's 취식 split and 근무시간; reuses the live run's login; sets `OCT_IMPORT=1` on success, retries at most hourly (`OCT_IMPORT_TRY`). Never throws.
- `octApply_()` (in `apps-script/Oct2026.gs`) — one-time: writes `OCT_TAGS` (564 October 취식 tags: 폐기목록 key, 직원, 등록시각) onto untagged October 폐기 lines and appends `OCT_SHIFTS` (93 October shifts, keys `oct000`…) to 출근일지, skipping a shift that overlaps one already there. Called (through `octApplyAll_`) at the top of `refreshNow()` once `OCT_IMPORT=1`; sets `OCT_APPLY=1`; a failed try waits 10 min (`OCT_APPLY_TRY`); logs to 가져오기 기록. The file can be deleted after it ran.
- `octApply2_()` (Oct2026.gs) — second one-time step: `OCT_TAGS_LEE` (116 keys, the lines nobody took on 10월 폐기 정리) become 취식 by 이국환 on untagged October 폐기 lines; runs only after `OCT_APPLY=1`, sets `OCT_APPLY2=1`. `octApplyAll_()` runs both; `refreshNow()` calls it until both flags are set.
- `liveInfo_(added)` — `{label, off, error, added, wait}` for the page header (current store).
- `knownChits_()` — `{CHIT_NO: lines in sheet}`.
- `logImport_(range, chits, added, result)` — appends to 가져오기 기록.
- `ssvBuild_(vars, dsName, cols, row)` — SSV request with one dataset/one row. `ssvVarsOnly_(vars)` — variables only. `ssvParse_(text)` — `{vars, ds: {name: [rowObj]}}`.
- `Session_(st)` — cookie jar of one store (`.st`, `.ss` = its `SS_*` list); `.get(path)`, `.post(path, body)` (throws on HTTP ≠ 200 or `ErrorCode ≠ 0`).
- `ssVars_(st)` — the store's `SS_*`: `STORES[..].ss`, else Script Property `BGF_SS_<id>`, else the minimum. `bgfSsFromLogin_(s, r)` — after a login, fills them from `GDS_JUMPO` like BGF's page does and keeps them (not for the first store).
- `bgfLogin_()` — logs the current store in with its `BGF_PW`; throws a Korean message if missing/failed. `svcVars_(s)` — vars for service calls.
- `fetchAll_(from, to, known, session?)` — one login (or the given session), 폐기 then 저회전. A 저회전 error is caught into `jeoErr` (폐기 still imports). Returns `{chits, jeoChits, fetched, items, jeoErr, session}`. `jeoNote_(r)` — short log suffix.
- `jeoDiv_(s)` — S312 lookup via `/stco010/selComCd`, first CODE whose NAME contains `저회전`; cached in `JEO_DIV`; `''` if not found.
- `fetchSlips_(s, divCode, onlyChitId, src, from, to, known)` — list call → filter (`CHIT_NO`, optional `CHIT_ID`) → skip slips fully known → group by (date, CHIT_ID, CHIT_FLAG) → detail calls in chunks of 40 (`searchDetailType0` for flag PA, else `Type1`) → item objects `{key, date, time, name, code, cat, qty, wprice, wamt, mprice, mamt, chit, src}`.
- `ymd_(d)` — `yyyyMMdd` in KST.

### Web app — section `웹앱`

- `doGet(e)` — the old staff link: `Move.html` (template: `url` = `WEB_APP_URL`, `store` = a checked `?store=`) that sends the browser to the GitHub Pages copy with the phone's store and names; `?stay=1` serves `Index.html` with the viewport meta (`width=device-width, initial-scale=1`; no `viewport-fit=cover`, see DEVNOTES gotchas).
- 접근 section (before 앱 API; Google accounts): constants `GOOGLE_CLIENT_ID` (same as `app/www/login.html`), `LOGIN_PAGE`, `EXEC_URL`, `ACCESS_OLD_UNTIL`, `OPEN_FNS_`; `checkAccess_(fn, dev)` (api / doPost), `access_()` (first line of each public data function), `accessOff_` (`ACCESS_OFF`); accounts: `accounts_()` (`ACCOUNTS`), `accountState_(email)` (owner always `ok`), `setAccount_(email, s, note)` (script lock, caps waiting at 40), `ownerEmail_()`; keys: `accDev_` / `accSig_` / `devEmail_` (`g:<email>:<sig>`, HMAC with `ACCESS_KEY`), `oldDevOk_` (접근 코드 keys, for the move-over only); sign-in: `gLogin(nonce, idToken)` (public: tokeninfo check incl. the token's nonce via `idTokenEmail_(cred, nonce)`, nonce → email in cache, new account → wait + `notifyOwner_` mail), `gPoll(nonce, oldKey)` (public: none / wait / no / ok + dev); owner: `allowPage_(p)` (doGet `?allow=`), `allowAccount(email, sig)` (public, needs the `ALLOW_KEY` sig from the mail), menus `menuAccounts` / `menuAccessRevokeAll`; the page's screen: `CALLER_` (set by `checkAccess_`), `ownerCaller_()` / `ownerOnly_()`, `getAccounts()` / `setAccess(email, s)` / `setAccName(email, name)` (public, owner key only, in `apiFns_`), `delAccount_`, `waitCount_` (→ `getInit().admin`); names: `accNames_()` (`ACCNAMES`), `accName_(entry)` (most-used), `editNames_(fn, locked)`, `noteActor_(full)` (called after `setTag` / `saveShift` / `deleteShift`).
- `apps-script/Move.html` — that 주소 이동 page: reads `chwisik.store` / `chwisik.me[.<id>]` from localStorage, builds `WEB_APP_URL?store=…#move=…`, tries `window.top.location.replace`, else the [새 주소로 열기] button.
- `doPost(e)` — JSON API for the app: body `{fn, args, store}`, `useStore_(store)`, runs only names in `apiFns_()`, answers `{ok, r}` / `{ok:false, err}`.
- `api(store, fn, args)` (public) — the same for the `/exec` page (`google.script.run.api`). **A new public function the page should use must be added to `apiFns_()`** (both entries read it).
- `getBoot(me, token)` (public) — `getInit` + `getMonth(newest, '')` in one call; the page's first call.
- `getPage(knownHash)` (public) — `Index.html` source + MD5 hash for the app's self-update; `null` when unchanged.
- `bumpVersion_(shifts)` — flushes the sheet, then sets the store's `VER` (and `SVER` when `shifts`). `version_()` — `VER` + the other stores' `SVER`. `nextVer_(st)` — a version newer than the current one (clock, or +1).
- `bigPut_(key, obj, sec)` / `bigGet_(key)` — a big value in CacheService, in pieces.
- Members: `memberRows_()`, `members_()` (public shape `{full, short, hasPw}`), `memberRow_(full)` (throws if unknown), `shortName_(full)`, `addMember(full)` (public; sanitizes, appends).
- Passwords: `secret_(name)`, `b64_`, `pwHash_(full, pw)`, `devHash_(pw)`, `token_(m)`, `authMember_(full, token)` (the auth check every write uses), `login(full, pw)` (public, rate-limited), `setPassword(full, token, newPw)` (public).
- `withLock_(fn)` — script lock wrapper (15 s).
- `getInit(me, token)` / `getInitData_()` — boot payload (months list kept in the cache per version; adds `store`, `stores` = `storesInfo_()`).
- `getMonth(month, knownVersion, fresh)` — the kept answer if there is one (not when `fresh`); else `monthLines_(month)`, `readClose_(month)` (only when `month <= CLOSED`), shifts/usual/members/`others`, and keeps it.
- `monthLines_(month)` — reads all of 폐기목록 once, runs `cancelMatch_`, returns `{rows, cancels}` for the month (row index 13 = src, cancel index 6 = src).
- 월별 마감 (section `월별 마감`): `closeTarget_()` (newest month due: last month from the 2nd on), `closeAll_()` (every store, errors swallowed; nightly + liveTick), `closeDue_()` (this store: months ≤ target with lines and no 마감 rows → `closeMonth_`; sets `CLOSED`), `monthTotals_(rows)` (per person 폐기/취식 수량·원가 + 미등록, same rules as the page), `closeMonth_(month)` (lock; rewrites that month's rows, bumps the version), `closeSheet_()` (makes the sheet), `closeRows_()`, `readClose_(month)` (→ `closed` for the page).
- `otherShifts_(month)` — the other stores' shifts of the month, for 근무 시간 across stores.
- `memberRows_()` reads 직원 once per execution (`MEM_`; cleared on every write and inside every lock).
- `cancelMatch_(vals, nums)` — BGF cancel pairing; product key = `src|상품코드-or-품명`. Returns `{neg, left}`.
- `setTag(rowHint, key, type, memberFull, month, note, me, token)` — the only writer of columns M–R. Checks: valid type, `authMember_`, own name only, row found by hint or key, row not owned by someone else (저회전 rows take 취식 or 폐기). Then writes and returns `getMonth`.

### Backups — section `백업 / 되살리기` (end of file)

- `bakName_(slot)`, `bakFile_(slot, make)` (opens the slot's file by `BAK_<slot>`, makes one when missing), `isSummarySheet_(name)`.
- `backupTo_(slot)` — copies every sheet but 월별 합계 into the slot's file (new copies first, old deleted after), writes `백업 정보`, sets `BAK_AT_<slot>`. `backupNightly_()` — weekday slot + month-end slot on the 1st; called at the end of `nightly()`.
- `backupList_()` — existing backups newest first. `restoreFrom_(slot, only)` — backs up into `R`, then copies the slot's sheets back in the script lock and moves every store's `VER` / `SVER`.
- Menu: `menuBackupNow`, `menuRestore` (public names but call `SpreadsheetApp.getUi()` first, so they fail from the web).

### 출근일지 — section `출근일지`

- `shiftSheet_()`, `readShifts_()`, `writeShift_(sh, row, s)`.
- Time helpers: `toMin_(date, hhmm)` (minutes on a KST number line), `nowMin_()`, `shiftSpan_(s)` (overnight aware), `shiftHours_`.
- `shiftsFor_(month, all)`, `usualShifts_(all)`, `isLive_(s, nowM)` (open and within −15 min … 16 h), `openShiftOf_(all, member, nowM)`, `overlapOf_(…)`.
- Shift-time rules (constants `SLOT_MIN`, `HANDOVER_MIN`, `AUTO_OUT_MIN_H`, `AUTO_OUT_MEMO`): `roundSlot_(m, tieUp)`, `minDate_(m)` / `minHm_(m)` (minutes → `yyyy-MM-dd` / `HH:mm`), `isAutoOut_(s)`, `dropAutoOut_(memo)`, `planAutoOut_(all, member, a, b, nowM, skipKey)` (other workers' 근무 중 shifts to close for a new shift [a, b], b null = open; nothing when a hasn't come yet or when a finished b ends before their usual 퇴근; sets `end`/memo, no writes; usual 퇴근 when `overlapUsual_`), `autoOutAll_()` (catch-up from `refreshNow`: every shift started in the last 16 h, earliest first, closes what `planAutoOut_` would have, under the lock, skipping rows changed meanwhile). (`clockIn` / `clockOut`, `planClockIn_`, `planClockOut_`, `handoverAt_` were removed with the buttons, 2026-11-15.)
- 교대 겹침 정리 (constants `TRIM_MEMO`, `HANDOFF_DAYS`, `HANDOFF_NEAR_MIN`, `HANDOFF_MIN_N`): `isTrimmed_(s)`, `dropTrim_(memo)`, `todDiff_(x, y)` (minutes apart on the clock), `handoffs_(all, skipKey)` (→ `[{at, over}]`, last 90 days, system-set ends left out), `overlapUsual_(all, t, skipKey)`, `planTrim_(all, member, a, b, skipKey)` (→ other workers' shifts with `end` = a and memo marked, or `[]`; no writes).
- Public (all check `authMember_`): `saveShift` (rounds to 30-min slots; new row / moved 출근 → `planTrim_` (`res.trimmed`) and `planAutoOut_` (`res.closed`, 퇴근 empty or not); saving one's own row drops its `자동 퇴근` mark, an edited 퇴근 its `교대 맞춤` mark), `deleteShift`.

---

## Index.html

### Layout (HTML)

Header `.hdr` (scrolls away): title + month switcher, "나: 이름" + 이름 바꾸기 / 비밀번호 + sync label, my 취식/폐기 totals. Sticky bar `.top`: the tab bar (`.tabwrap` > `.tabs`, 7 columns, `data-view` = `shift`, `todo`, `eat`, `void`, `jeo`, `sum`, then `#moreBtn` (더보기, no `data-view`; label `#moreLbl`, count `#c-more`, `.chev`) which opens `#moreMenu` (`.mi` items with `data-view` = `all`, `cancel`, `aria-checked`); counters `#c-<view>`), search box, `#pin` (미등록 / 취식 only: holds `#whoBar` and `#pinTot`, the 금액합계 card, so they stay on screen). Main: `#status`, `#whoBar` (name filter), `#list` (line views), `#shifts`, `#sum`, `#emptyMsg`, `#loading` (skeleton shown while `!S.ready`). Bottom sheets: `#confirm`, `#shiftEd`, `#picker`, `#pwSheet`. `#snack` for messages with 되돌리기.

CSS: tokens on `:root` with a dark-mode override; `.row.t-eat` / `.t-void` / `.t-cancel`; `.stamp` buttons (`.eat`, `.void`, `.on`, `.undo`); `.jeotag` labels 저회전 lines outside the 저회전 tab; `@media (max-width: 380px)` shrinks stamps and tab text so 7 tabs fit at 360 px. `.moremenu` / `.mi` / `.chev`: the 더보기 menu.

### State

`S = { store, stores, months, month, version, rows, cancels, shifts, others, usual, members, me, view, who, q, busy, live, refreshing, online, ready, failed, pend }`. `S.store` persists in `chwisik.store` (the store list in `chwisik.stores`); `S.me`, tokens and the kept month persist per store through `K(name)`: `chwisik.me` for the first store (`LEGACY_STORE`), `chwisik.me.<id>` for others. `MONTHS` = months seen this session. Constants: `POLL_MS` 5 s, `LIVE_MS` 1 min, `GRACE_MIN` 30, `OPEN_MAX_MIN` 16 h, `GAP_MIN` 15, `OFFSHIFT`, `JEO`.

Row shape (from `getMonth`): `[sheetRow, key, time, name, qty, wprice, wamt, mamt, type, memberFull, who, date, note, src]`.

### Functions by area

- Helpers: `$`, `fmt`, `lsGet`/`lsSet`/`lsDel`, `mk(tag, cls, text)`, `sid()` (store id), `K(name)` (localStorage key of this store), `curStore()`, `loadIdentity()`, `tok`/`setTok`, `isAuthErr`, `run(fn, …args)` (Promise, always with the store: `fetch` to `API` = `window.CHWISIK_API` in the app, else `google.script.run.api`; an answer for a store the phone has left never arrives), `pend(±1)` (top progress bar), `errMsg`, `status`, `memberOf`, `shortOf`.
- Time: `toMin`, `nowMin`, `todayStr`, `curMonth`, `addMonths(m, n)`, `monthRange()` (oldest − `MONTHS_BACK` … newest month the ‹ › switcher reaches), `dur`, `dowOf`, `dayLabel`, `dayEl` (red 일 / blue 토), `addDays`, `hm`.
- Shifts logic: `span(s, nowM)` (`{a, b, open, live, on, stale, e}`; `on` = working now, incl. a 퇴근 written ahead), `openShift` (my shift that is `on`), `workedAt(member, ts, grace)`, `workersAt(ts)`, `gapsOf(d, nowM)`, `checkDays()`, `overlapsOf(…)`.
- Name filter: `whoNames()` (per view), `curWho()`, `renderWho()`.
- Render: `render()` (tabs — every `[data-view]` gets `aria-selected` (tabs) or `aria-checked` (`.mi`), `#moreBtn` selected + relabeled when the view is `all` / `cancel` — counters — 미등록 excludes 저회전, 전체 = 폐기 lines, 저회전 = 저회전 lines — then dispatch), `renderList()` (filters per view, groups by day; 미등록 / 취식 put `totalEl(vis)` in the header's `#pinTot`; `render()` moves `#whoBar` into `#pin` on those tabs and back above `#list` on others), `totalEl(vis)` (금액합계 card: 수량 · 원가 total of the shown lines; on 취식 also per person when 2+ people), `rowEl(r)` (buttons per view; 저회전 tab = [취식] [폐기], then the other type + [취소] once registered; disabled for other workers' rows), `renderCancels()`, `renderShifts()` (one row per shift, each day's shifts + carry-overs sorted by start on that day, latest on top: 야간 → 오후 → 오전 → carried-over 야간), `gapEl`, `shiftEl(s, nowM, d)` (one shift's row on day d: `00:00 –` part for a carry-over, `– 24:00` part when the rest has a next-day row; own row = edit button), `renderSum()` (its `eatTable()` builds the per-person table for `S.sumView` — `eat` = 취식 only, `all` = 폐기 + 취식 — and `withFilter(t, f)` (`f = {opts, cur, label, pick}`) adds the `.fchip` filter chip + menu to a table's title line — `eatFiltered()` for `S.sumView`, `hoursFiltered()` for `S.hoursView` (`all` = every store, `here` = this store only; `hoursTable()` builds the 근무 시간 table, no chip with one store); a pick swaps just that table; `SF` / `closeSumMenu()` track the open menu for the page-wide pointerdown / scroll / Esc handlers), `table(title, heads, rows, foot, note, sort)` (with `sort = {id, col, dir}` every header is a sort button; rows carry `keys` for comparing; the choice lives in `chwisik.sumSort` via `sumSort()` / `setSumSort()`). At its end `render()` hides all of them and shows `#loading` (with `skeleton()`: placeholder rows shaped like the open tab) while `!S.ready`, or `#fail` (message + 다시 시도) when the start failed. `render()` also sets the title to the store name and hides the 저회전 tab for a store without it. `renderSum()` uses `S.closed` (월별 마감 numbers, note via `closedDay(at)`) instead of summing `S.rows` when the month is closed, and adds `S.others` to the 근무 시간 table (per person over all stores, per-store line under the name). `workersAt` answers are remembered for one render (`WA`).
- Tagging: `tap(r, type)` (guards: picker, other worker, off-shift confirm for past days only) → `doTag` → `apply` (optimistic) + `send` (`setTag`; rolls back on error) + snack undo.
- Shifts UI: `shiftCall(fn, args, key, ok, bad)` (adds token; lazy: counts in `S.busy` / `PEND[key]` while on its way, takes the answer's month once nothing else is pending, `bad` undoes the screen change, then `load(true)`), `busy(d)` (`S.busy` ± and the sync label), `pendingShift(s)`, `shiftAt(key)`, `autoOutShift(member, nowM)` (my unconfirmed `자동 퇴근` in the last 2 h → the card says so), `openEditor(s, preset)`, `slotHm(t, up)` (30-min rounding for the hint), `edHint`, `closeEditor`, form submit / delete handlers.
- Dialogs: `confirmBox`, `closeConfirm`, `openPicker`, `choose`, `openPw`, `closePw`, `savePw`.
- Stores: `openStores(must)` / `closeStores()` (the `#storeSheet` list), `setStore(id)` (switch in place: identity, state, kept data, `boot()`), `carryMe` (the name to offer in the next store).
- Data: `take(res, force)` (sets `S.ready`, remembers the month in `MONTHS`, `arrive()` on the first draw; also `saveCache`), `saveCache(res)` / `loadCache()` (localStorage `K("cache")`: newest month's data for an instant start), `load(force, fresh)` (poll with version; `fresh` = skip the server's kept answer; returns a promise), `refreshLive()` (`refreshNow`), `setOnline`, `renderSync` (picks the text), `setSync(cls, text)` (writes the `#sync` button: text + `.ico` ↻; class `go` spins it).
- Misc: `snack(text, undo)`, tab click handlers (all `[data-view]`, tabs and menu items), `closeMore()` + 더보기 open / outside-tap / scroll / Esc close, search, `goMonth` (one calendar month, inside `monthRange()`), Esc handling, `visibilitychange`.
- 접근 (Google 계정): `gate()` opens `#gate` (keeps a 접근 코드 key as `chwisik.devOld`, deletes `chwisik.dev` and `chwisik.cache*`), points `#gateGo` at `LOGIN?n=<nonce>` (`gNonce()`, `chwisik.gn`; same tab when `gSameTab()`, else a new tab); a click on it (new tab only) starts `gPoll(wait)` (2.5 s for 3 min, then 10 s; again on `visibilitychange`), which shows wait / no in `#gateMsg` (`gateMsg`) and on ok calls `gotKey(r)` → stores the key, `boot()` + `refreshLive()`. `run()` sends `dev` with every call and opens the gate on an `[접근]` refusal; the start code opens the gate first when there is no key. `app/www/login.html`: redirects to Google's account chooser (OpenID Connect, nonce), back with `#id_token` → `gLogin` → in a browser: key stored, straight to `./` (`enter()`; also while waiting when `sameNonce(n)`); with `app=1`: `openApp()` tries the launcher intent, the back-to-app link (`backToApp()`) stays.
- 접근 계정 (owner only): `setAdmin(init.admin)` (from `boot()`; `gate()` clears it) shows `#accItem` / `#accSep` in the 더보기 menu, the count `#c-acc` and the tab dot `#moreDot`. `openAcc()` → `#accSheet`, `fetchAcc()` (`getAccounts`, `accSeq` drops stale answers), `renderAcc()` (sections via `accSection`, rows via `accRow`, `accMeta` / `accDay` texts, skeleton while loading), `setAcc(email, s, msg, undo)` (changes `ACC` at once, then `setAccess` queued on `accQ`; the last answer replaces the list, a refusal refetches). Form `#accAdd` allows an email ahead of time. Names: `accName(a)` (`nm` else `u`), `nameBtn` → `editName` (inline `.anin` box; `accEd` holds back `renderAcc` while typing, `accEnd` saves it when the sheet closes), saved through `accCall(fn, args)` (the shared queue `setAcc` uses too).
- iPhone install: `IOS` / `STANDALONE`; `installUrl()` keeps the Safari address at `?k=…&store=…&me=…` so 홈 화면에 추가 carries them; `takeInstallUrl()` (runs once at start) stores them in a copy that has no key and cleans the address.
- iPhone install bar: `iosHint()` (runs once at start) fills `#iosBar`: hosted copy in Safari → how to 홈 화면에 추가; `/exec` on an iPhone → link to `WEB_APP` (constant next to it, the Pages address; "" = no bar). Closing sets `chwisik.iosHint` = `off`.
- App update: `checkAppUpdate()` checks the running or pending hash on start, foreground, reconnect, once per visible minute, pull, and sync tap. `applyAppUpdate()` writes the new page and reloads when safe, retrying every five seconds. `run()` tracks outstanding staff writes across stores and lets a store-independent `getPage` reply finish after a store change. The script clears `chwisik.pageTry` on start for the loader.
- Pull to refresh: an IIFE after the sync button handler; `touchstart`/`touchmove`/`touchend` on `document`, `.ptr` spinner element; on release past `GO` calls `refreshLive()` + `load(true)`.
- Sticky bar hide / show: an IIFE right after pull to refresh; `check()` on `scroll` (passive) moves `.top` with `place(px, glide)` (inline `transform`; `shift` = px moved up) after an offset (`.hdr` + `.top` height): follows the scroll both ways; `settle()` after `SETTLE_MS` 120 glides a part-way bar in (last move `UP_TOL` 5 px+ up) or to the nearer end, glide length `GLIDE_MIN`–`GLIDE_MAX` ms by distance; never moved while `#q` has focus or a sheet is open.
- Boot: `loadCache()` draws the last data → `boot()` (`getBoot`; retries by itself after a failure, `bootSeq` voids a superseded one) and `refreshLive()` together → `afterBoot(init)`: store (new phone, 2+ stores) → name → password → once: intervals (poll 5 s, live 1 min, re-render 출근 every minute). A `?store=` in the address names the store for a phone that has none (`google.script.url.getLocation` on the `/exec` link).

---

## app/ (Android app and installable page)

- `www/index.html` — loader: picks `chwisik.page` from localStorage (unless `chwisik.pageTry` says it broke) or fetches `page.html`, injects `CHWISIK_API` / `CHWISIK_PAGE_HASH` + viewport, `document.write`s it. Registers `sw.js` on real HTTPS hosts only (not inside the app, where the origin is `https://localhost`). **The `/exec` URL is hard-coded here**; change it if the deployment ever changes.
- `www/sw.js` — installable page only. Opening the page: network first (`cache: "no-cache"`, past GitHub Pages' 10-min browser cache), stored copy under the scope key when offline / error / over 4 s. Icons, manifest, `page.html`: stored copy, refreshed in the background. Bump `CACHE` when the file list changes (now `chwisik-v3`).
- Loader: `#move=<json>` from `Move.html` → copies `chwisik.store` / `chwisik.me[.<id>]` it doesn't have yet, then strips the hash.
- Loader extras for iPhone: KakaoTalk in-app browser → `kakaotalk://web/openExternal`; `show()` also writes the home-screen tags (manifest, apple-touch-icon, `apple-mobile-web-app-*`, theme-color) into the page's head.
- `.github/workflows/ios.yml` — iPhone app: `npx cap add ios` (fresh each run) → `ios-res/` icon + splash → Info.plist version / name / encryption flag → simulator build (no secrets) or archive + sign + upload to TestFlight + release `ios-1.<run>` (secrets). Monthly run for TestFlight's 90-day limit.
- `ios-res/` — iPhone app icon (1024 px, no alpha) and launch screen, made by `make-icons.py`.
- `.github/workflows/pages.yml` — publishes `app/www` + `page.html` to GitHub Pages (the staff link, `https://kiiwoom8.github.io/chwisik/`) and remakes the `ios-latest` release (steps + QR code); skipped if the repo is private.
- `www/manifest.webmanifest`, `www/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`; `android-res/mipmap-*/ic_launcher*.png`, `android-res/drawable/splash.xml`; `make-icons.py` makes all icons from `app/icon-source.png` (the owner's character drawing): white background removed by edge flood fill, only the biggest shape kept (drops the speech bubble), square crop from the top of the head; Android icons transparent, web/iPhone icons on the page background. Needs Pillow, numpy, scipy. Writes `icon-preview.png` to look at.
- `build.mjs` — `apps-script/Index.html` → `www/page.html` (generated, git-ignored).
- `capacitor.config.json` — app id `com.kiiwoom8.chwisik`, name 취식, `webDir: www`. `package.json` / `package-lock.json` — Capacitor 7. `android/` is generated in CI (git-ignored).

## tests/

- `mock.js` — loads `Code.gs` + `Oct2026.gs` into a Node `vm` with in-memory SpreadsheetApp (several files: `SpreadsheetApp.create` / `openById` for backups), PropertiesService, CacheService, LockService, ScriptApp, Utilities and a fake BGF behind `UrlFetchApp`. `exec(src)` = one Apps Script execution (resets the per-execution globals).
- `server.test.js` — `node tests/server.test.js`: stores, caches, imports, nightly, passwords, backups and restore (64 checks).
- `page-stub.py` — writes a copy of `Index.html` with a fake `google.script.run.api` (two stores) for the browser.

## Recipes

**Add a store.** DEVNOTES → Stores → *Adding a CU store* / *Another chain (GS25)*.

**Change the page.** Edit `apps-script/Index.html` and push: the `/exec` link updates via deploy.yml and the app picks it up by itself (`getPage`). Keep it working in both modes: no Apps Script templating (`<? ?>`), every server call through `run()`, and any new server function the page calls added to `apiFns_()`.

**Change the app shell** (`app/`). Push; android.yml builds a new APK on release android-latest. Phones only need it if the loader, icons or native settings changed.

**Import another BGF slip type (like 저회전).**
1. Find its CHIT_ID and detail dataset: read `https://store.bgfretail.com/websrc/deploy/GJ/STGJ020_P1.xfdl.js` (no login needed) for `strTitle` per `case "NN"`, and which `searchDetailType*` case group it is in. If it isn't `Type1`/`dsListType1`, the columns differ — map them in `fetchSlips_`.
2. Add constants, then a `fetchSlips_` call in `fetchAll_` with its own `src` value (look up the S312 search code by name like `jeoDiv_`, and always filter by CHIT_ID). Add a one-time backfill like `jeoBackfill_`: the live import only reads yesterday..today, so past days stay empty otherwise.
3. Server rules for tagging in `setTag`; page: a tab (`data-view`, counter id, `.tabs` column count), filters in `renderList` / `whoNames` / `render` counters, buttons in `rowEl`, guard in `tap`.
4. Update DEVNOTES (sheet column values, protocol, page behavior), this file, HISTORY.

**Add a column to 폐기목록.** Append to `C`, `NCOL`, `HEADERS`; extend the row in `appendItems_`; `itemsSheet_()` adds the column to old sheets (generalize its header check if the new column needs one); fix `setup()` number formats; extend the row shape in `getMonth` **at the end** (the page indexes rows by position) and document the shape.

**Add a public server function.** No trailing `_`; first line checks the caller (`authMember_(me, token)` for workers). List it in `apiFns_()` (the page reaches it only through `api()` / `doPost`). Use `sheet_()` / `pget_()` so it works for every store. Wrap sheet writes in `withLock_`, call `bumpVersion_()` after writes (`bumpVersion_(true)` if 출근일지 changed), return `getMonth(month, '')` if the page should refresh. Add a case to `tests/server.test.js`.

**Add a tab.** Button in `.tabs` (and bump `repeat(N, 1fr)`; check 360 px; a rarely used view can go in `#moreMenu` as a `.mi` instead: then also add it to `inMore` and `#moreLbl` in `render()`), counter in `render()`, filter in `renderList()` (or its own renderer), `whoNames()` / `curWho()` rules, empty message.
