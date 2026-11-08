# Dev notes — 직원 취식 목록

Last updated: 2026-11-09 (Android app + JSON API `doPost`; faster start: one `getBoot` call and the last data drawn from localStorage)

Read this first if you are a person or an AI agent about to change the code. Related docs:

| Doc | What's in it |
|---|---|
| `CLAUDE.md` | Working rules: git (always `main`, push right away), deploy, docs-update rule, conventions |
| `docs/DEVNOTES.md` (this) | What the system does, live resources, sheets, BGF protocol, API, operations, gotchas |
| `docs/CODEMAP.md` | Function-by-function map of `Code.gs` and `Index.html`, data flows, recipes for common changes |
| `docs/HISTORY.md` | Every change in order, with commit ids and the reason behind it |
| `docs/ROADMAP.md` | Planned work |

## What it does

A tracker for CU store **25377**: which expired items (폐기) a worker ate (취식) and which they threw away (폐기), plus a shift log (출근일지).

- **Every night around 00:01 (Asia/Seoul)** a time trigger logs in to the BGF 점포시스템, downloads the **폐기** and **저회전상품철수** slips for **yesterday and the day before**, and appends new lines to the **폐기목록** sheet. The day before is re-read so late slips are not missed. Lines already in the sheet are skipped (by key).
- **During the day (실시간 가져오기)** today's and yesterday's new slips are pulled when a worker opens the link, every 3 min while the page is open, and every 10 min by a trigger even if nobody has it open. BGF is hit at most once per 2 min overall. See *Live import*.
- **Staff open the Android app or one link** (no Google login). The app (see *App*) shows the same page without Google's wrapper and banner. They pick their name once (stored on the phone), then tap **[취식]** or **[폐기]** on each line.
  - 취식 → records the **full name** (김성휘)
  - 폐기 → records the **first name only** (성휘)
- **저회전 (저회전상품철수)** lines are imported the same way and shown in their own **저회전** tab. They can be tagged **취식 only**, never 폐기, and they **don't need to be tagged** (they are not counted in 미등록). A 저회전 취식 counts in the worker's 취식 totals like any other 취식.
- **출근일지**: staff tap **[출근] / [퇴근]** (or enter a shift by hand) and see everyone's shifts day by day.
- **Off-shift 폐기 warning**: tagging 폐기 on a line whose slip time is outside the worker's recorded shifts (±30 min) asks first. If they confirm, it is saved and marked `근무외`.
- **BGF cancels**: a negative line cancels an earlier line of the same product; both disappear from the lists and totals and show in the **취소** tab.
- **Monthly totals** per person in the web app (월별 합계 tab, includes hours) and in the **월별 합계** sheet (a QUERY formula).

Everything runs on Google's servers. The owner's computer can be off.

## Live resources

| What | Where |
|---|---|
| Spreadsheet | Google Drive → **직원 취식 목록** (`1OFt4d-qxrv8EnsK3PK060Llv33fw2UnZ09rp00It338`) |
| Apps Script project | Bound to the sheet; script id `1ypg7065GCWVnqAQFi1mu3vFyg_vSEti7RdtbzXKITl4ogeFpoqfqYjzQ` (also in `.clasp.json`) |
| Staff web app (versioned deployment) | https://script.google.com/macros/s/AKfycbzmsekRKq8HY5jqog-Dpb80yJqv-n3H4fZMItLZPISuM39M6RVyr3qOtqtz864YwlRKpw/exec (GET = the page, POST = the JSON API the app uses) |
| Android app (APK) | GitHub → Releases → **android-latest** → `chwisik.apk` (built by `.github/workflows/android.yml`) |
| App signing key | `C:\Users\kiiwo\chwisik-android-key\` on the owner's PC (never in the repo); also as repo secrets `ANDROID_KEYSTORE_B64` / `ANDROID_KEYSTORE_PW` |
| GitHub repo | source of truth; push to `main` deploys (see *Auto-deploy*) |
| Google account | noerror96@gmail.com (the script runs as this account) |
| Trigger `nightly` | time-driven, daily, `atHour(0).nearMinute(1)`, Asia/Seoul. Google fires it within about ±15 min. |
| Trigger `liveTick` | every 10 min. Installs itself the first time the page calls `refreshNow` (Script Property `LIVE_TRIGGER=1`). |

Web app settings (`apps-script/appsscript.json`): **Execute as: Me (owner)**, **Who has access: Anyone, even anonymous** (`ANYONE_ANONYMOUS`). Changing access locks staff out.

## Repo layout

| Path | What |
|---|---|
| `apps-script/Code.gs` | Server: BGF login + import (nightly, live), sheet setup, web app API, passwords, 출근일지 |
| `apps-script/Index.html` | The staff page: HTML + CSS + one `<script>` block (no build step, no libraries) |
| `apps-script/appsscript.json` | Manifest: timezone, V8, web app access |
| `.clasp.json` | clasp config (`rootDir: apps-script`) |
| `.github/workflows/deploy.yml` | Syntax check → `clasp push` → `clasp deploy` on the staff deployment |
| `app/` | Android app (Capacitor 7 shell) and installable page: `www/index.html` loader, `manifest.webmanifest`, `sw.js`, icons; `build.mjs` copies `Index.html` to `www/page.html`; `android-res/` icons + splash; `make-icons.py` makes the icons from `icon-source.png` |
| `.github/workflows/android.yml` | Builds the APK on push to `app/**` and publishes release `android-latest` |
| `.githooks/post-commit`, `scripts/setup-hooks.sh` | Auto-push `main` after every commit |
| `docs/` | These docs |

## Sheets

### 폐기목록 (one row per slip line; 폐기 and 저회전 both live here)

| Col | Header | Notes |
|---|---|---|
| A | 키 | `CHIT_NO-CHIT_SEQ`, unique; dedupe key and how the page finds a row |
| B | 일자 | slip date `yyyy-MM-dd` |
| C | 생성시각 | slip created `yyyy-MM-dd HH:mm:ss` (from `CRE_YMDHMS`) |
| D | 품명 | |
| E | 상품코드 | |
| F | 분류 | `LARGE_NM` |
| G | 수량 | can be negative (BGF cancel lines) |
| H–K | 원가단가, 원가금액, 매가단가, 매가금액 | |
| L | 전표번호 | `CHIT_NO`; `knownChits_()` counts lines per number |
| M | 구분 | `취식` / `폐기` / empty |
| N | 등록이름 | full name for 취식, first name for 폐기 |
| O | 직원 | always the full name (used for grouping and ownership) |
| P | 등록시각 | `MM/dd HH:mm` |
| Q | 월 | `yyyy-MM`, used to load a month |
| R | 확인 | `근무외` = 폐기 confirmed although the slip time was outside the worker's shift |
| S | 전표 | **empty = 폐기 slip**, `저회전` = 저회전상품철수 slip. Added 2026-11-09; `itemsSheet_()` adds the column and header to older sheets on first use. |

Columns A–F and L–S are plain text (`@`) so dates and codes are not auto-converted.

Rules:
- A 저회전 row can only be `취식` or empty. `setTag` refuses `폐기` on it (server), and the page hides the 폐기 button.
- **Canceled lines (BGF 취소)**: a line with a negative 수량 / 단가 / 금액 cancels an earlier line of the same product (same 상품코드, else 품명) **and the same slip kind** (폐기 and 저회전 never cancel each other). `cancelMatch_()` walks the whole sheet in 생성시각 order and uses up the quantity of the newest earlier line(s), untagged lines first; a partial cancel leaves the rest standing (amounts scaled). A negative line with no earlier match is ignored (shown with ⚠). The sheet itself is not changed: `getMonth` leaves canceled lines and all negative lines out of `rows` and lists the negatives in `cancels` (the 취소 tab). The sheet's 월별 합계 QUERY still counts a tagged line that was later canceled.

### 출근일지 (one row per shift)

Created on the first 출근 / save if missing (or by `setup()`).

| Col | Header | Notes |
|---|---|---|
| A | 키 | random id (`s…`) |
| B | 날짜 | the day the shift **starts**, `yyyy-MM-dd` |
| C | 직원 | full name |
| D | 출근 | `HH:mm` |
| E | 퇴근 | `HH:mm`; empty = still working. Earlier than 출근 = the next day (overnight). |
| F | 근무시간 | hours, decimal (e.g. 9.5); empty while open |
| G | 메모 | optional, max 40 chars, leading `= + - @` stripped (formula injection) |
| H | 등록시각 | `MM/dd HH:mm`, last write |
| I | 월 | `yyyy-MM` of 날짜 |

Rules (server-side): from the page a worker can only edit or delete their own rows; one worker's shifts may not overlap; an open shift counts as "근무 중" for 16 h at most (after that the page shows "퇴근 기록 없음" until someone fixes it); no future times (+60 min slack). The owner can edit the sheet directly.

### 직원
A = full name, B = first name for 폐기 (auto: drops a 1-char surname, or a 2-char one such as 남궁/황보/제갈/선우), C = memo ("웹에서 추가" when a worker added themself), D = 비밀번호(암호): salted SHA-256 hash of the worker's password, or empty = no password. Never the password itself. Clearing D removes the password.

### 월별 합계
A QUERY over 폐기목록 grouped by 월, 구분, 직원, 등록이름, with count, quantity, 원가, 매가 totals. Rebuilt by `setup()`. 저회전 취식 rows are counted under 구분 `취식` (untagged 저회전 rows have no 구분, so they are not counted).

### 가져오기 기록
One row per import run: time, date range, slip count, new lines, result. Nightly/manual runs always log; live runs log only when they add lines or when a failure streak starts. The result shows `· 저회전 N장` or `· 저회전 실패: …`. Nightly failures also email the owner.

## Script Properties (Apps Script → Project settings)

| Key | Set by | Meaning |
|---|---|---|
| `BGF_PW` | menu BGF 비밀번호 입력 | BGF store password (only place it exists) |
| `VER` | every write/import (`bumpVersion_`) | data version; the page polls `getMonth` with it |
| `LIVE_AT` | live import | start of the last live attempt (throttle) |
| `LIVE_OK_AT`, `LIVE_MS`, `LIVE_ERR` | live import | last success time, its duration, last error ('' = ok) |
| `LIVE_OFF` | menu 실시간 끄기 | `1` = live import off |
| `LIVE_TRIGGER` | `installLiveTrigger_` | `1` = the 10-min trigger exists |
| `JEO_DIV` | `jeoDiv_` | cached 전표구분 search code for 저회전상품철수 (from common code S312). Delete it to look it up again. |
| `JEO_ERR` | live import | last 저회전 error ('' = ok); only the first failure of a streak is logged |
| `JEO_BACKFILL` | `jeoBackfill_` | `1` = 저회전 for all past dates in the sheet was imported once. Delete it (or use the menu item) to run it again. |
| `JEO_BACKFILL_TRY` | `jeoBackfill_` | time of the last backfill try; a failed try waits 1 h before the next automatic one |
| `PW_SALT`, `TOKEN_KEY` | first use | password hashing salt / token HMAC key. Deleting `TOKEN_KEY` logs every phone out; deleting `PW_SALT` invalidates every stored password |
| `DEV_PW_HASH` | menu 개발자 비밀번호 설정 | hash of the developer bypass password |

## Passwords (optional, per name)

- A worker can make, change or remove a password from the page (나: … **비밀번호**). 4–30 characters. No password is fine; the name then works for anyone.
- Choosing a name that has a password (🔒) asks for it once per phone. The server returns a token (HMAC of name + hash with `TOKEN_KEY`), kept in localStorage (`chwisik.tok`). Every write sends it: `setTag`, `clockIn`/`clockOut`, `saveShift`, `deleteShift`, `setPassword`. Changing the password changes the token, so other phones must enter the new one.
- 5 wrong tries for a name → that name is locked for 10 min (CacheService).
- **Developer bypass**: menu **개발자 비밀번호 설정** stores `DEV_PW_HASH`. Typing that password in any name's password box unlocks that name. Menu **직원 비밀번호 지우기** removes one worker's password.

## Spreadsheet menu: 취식 관리

- **BGF 비밀번호 입력**: stores `BGF_PW` and test-logs in.
- **오늘 폐기·저회전 지금 가져오기**: one live import now (ignores the 2-min limit), shows the time it took.
- **어제 폐기·저회전 지금 가져오기**: runs `nightly()` now.
- **기간 지정해서 가져오기**: e.g. `20261101-20261108` (both kinds; safe to repeat).
- **저회전 지난 날짜 모두 가져오기**: re-runs the 저회전 backfill now: from the earliest 일자 in 폐기목록 to today (safe to repeat).
- **매일 자동 가져오기 켜기**: recreates the nightly trigger.
- **실시간 가져오기 켜기 / 끄기**: the 10-min trigger and the on-open refresh. 끄기 sets `LIVE_OFF=1`; the nightly import keeps running.
- **개발자 비밀번호 설정**, **직원 비밀번호 지우기**: see *Passwords*.

## BGF 점포시스템 protocol (reverse-engineered 2026-11-08, extended 2026-11-09)

The site is a **Nexacro 17** app at `https://store.bgfretail.com/websrc/deploy/index.html`. Every call is
`POST https://store.bgfretail.com/<service>` with an **SSV** body (`Content-Type: text/xml`).

SSV format:
- records separated by `\x1e` (RS), fields by `\x1f` (US), null = `\x03`
- first record `SSV:utf-8`, then `NAME=value` variables, then `Dataset:<name>`, a header record
  `_RowType_␟COL:STRING(256)␟…`, data rows starting with `N`, and an empty record to end the dataset
- a request may have variables only and no dataset (`ssvVarsOnly_`)
- responses carry `ErrorCode:string=0` (anything else is an error; `ErrorMsg` explains)

Variables sent with every call: `GV_USERFLAG=HOME`, the `SS_*` store variables (constants `SS_VARS` in `Code.gs`), `GV_MENU_ID`, `GV_CHANNELTYPE=HOME`. The session is a cookie, kept in a small cookie jar (`Session_`).

| Step | Service | Request → response |
|---|---|---|
| Login | `/login/login` | `ds_login`: `USER_NO`, `PASSWD` (plain text, no captcha or encryption), `USER_GRP_ID=0001`, plus vars `USER_TYPE=1`, `CONN_PLACE=HOME`, `MULTI_YN=N`, `RUNTIME_YN=(일반)`, … Success = response has dataset `GDS_JUMPO`. |
| Common code | `/stco010/selComCd` | vars only: `codeKeys=S312`, `selecttype=A`, `col1..col6=%`. Returns a dataset (named like `_ds_S312`) with `CODE`, `NAME`: the 전표구분 dropdown of 통합전표 조회. Used by `jeoDiv_()` to find the code whose NAME contains `저회전`. |
| Slip list | `/stgj020/search` | `dsSearch`: `strStoreCd`, `strChitDiv` (S312 code: **10 = 폐기**, '' = 전체), `strFromDt`, `strToDt` (yyyymmdd). Returns `dsList`: `CHIT_NO`, `CHIT_ID`, `CHIT_ID_NM`, `CHIT_FLAG`, `CHIT_YMD`, `ITEM_CNT`, `WONGA_AMT`, `MAEGA_AMT`, `CRE_YMDHMS`. |
| Slip detail | `/stgj020/searchDetailType1` (`Type0` when `CHIT_FLAG=PA`) | `dsSearch`: `strChitDiv=<CHIT_ID>`, `strChitNoList=('n1','n2',…)` (many slips at once, chunked by 40), `strChitYmd`, `strStoreCd`. Returns `dsListType1`: `CHIT_NO`, `CHIT_SEQ`, `ITEM_CD`, `ITEM_NM`, `LARGE_NM`, `QTY`, `WONGA_PRICE`, `WONGA_AMT`, `MAEGA_PRICE`, `MAEGA_AMT`, `CUST_NM`, `CENTER_NM`. |

Two code systems — don't mix them up:
- **전표구분 search code** (common code S312, the dropdown, sent as `strChitDiv` to `/stgj020/search`): 01 일반매입, 02 루트매입, 03 점포직매입, 04 무료택배, 05 매입수정, 06 매입차이, 07 반품, 08 반품수정, 09 반품차이, **10 폐기**, 11 매가변경, 12 점간이동매입, 13 점간이동반품, 14 소모품(내부), 15 공병반품, … The 저회전 code is not hard-coded: it is looked up from S312 by name and cached in `JEO_DIV`.
- **CHIT_ID** (per slip in `dsList`, sent as `strChitDiv` to the detail call): **04 = 폐기 전표**, **24 = 저회전상품철수전표**. Both use `searchDetailType1` and `dsListType1` (same columns). Found in the site's own form scripts: `GJ/STGJ020_M0.xfdl.js` (list screen, loads S312 via `gfn_setCommonCode`) and `GJ/STGJ020_P1.xfdl.js` (detail popup: `case "24": strTitle = "저회전상품철수전표"`, same detail case group as `04`).

How the 저회전 search works (`fetchAll_` → `fetchSlips_`): search with the S312 code if found (else `''` = 전체), then **keep only slips with `CHIT_ID = 24`**, so even a wrong or missing code can't pull in other slip types. A 저회전 failure is caught and reported (`jeoErr`); the 폐기 import still goes through.

> The 저회전 path was built from the site's scripts without a logged-in test (Claude may not type the BGF password). After the first deploy check 가져오기 기록 for `저회전 N장` or `저회전 실패: …`, and the `JEO_DIV` Script Property.

Verified (폐기): 11/1–11/8 import = 103 slips / 225 lines, identical to the site's own totals.

If BGF changes its login (captcha, OTP, password encryption), the nightly import fails and emails the owner. Re-capture the login request in the browser: hook `XMLHttpRequest.prototype.send` on the login page **before** pressing 로그인 (logging out reloads the page and clears the hook). Static form scripts can be read without logging in: `https://store.bgfretail.com/websrc/deploy/<prefix>/<FORM>.xfdl.js` (e.g. `GJ/STGJ020_M0.xfdl.js`).

## Web app API (google.script.run and JSON)

The page calls the server with `run(fn, …args)`. On the `/exec` link that is `google.script.run`. In the app (`window.CHWISIK_API` set by the loader) it is `fetch(POST /exec)` with a `text/plain` body `{"fn": name, "args": [...]}` (text/plain avoids a CORS preflight; Apps Script answers through a redirect to `script.googleusercontent.com`, which allows any origin). `doPost` answers `{"ok": true, "r": result}` or `{"ok": false, "err": message}` and only runs the names in `apiFns_()`, all of which are already public through `google.script.run`.

| Function | Purpose |
|---|---|
| `getBoot(me, token)` | `{init: getInit(…), month: getMonth(newest month, '')}`: the page's first call (one round trip instead of two) |
| `getPage(knownHash)` | `{hash, html}` of `Index.html`, or `null` if the app already has that hash (app self-update) |
| `getInit(me, token)` | members (`{full, short, hasPw}`), months (items + shifts), data version, live-import label, `meOk` (false = this phone must enter the password again) |
| `getMonth(month, knownVersion)` | rows + cancels + shifts + `usual` for `yyyy-MM`; `null` if `knownVersion` is current (cheap polling) |
| `setTag(rowHint, key, type, memberFull, month, note, me, token)` | type `취식` / `폐기` / `''` (clear). `note='근무외'` kept only for 폐기. Refuses rows another worker tagged, and 폐기 on 저회전 rows. Returns the fresh month. |
| `addMember(full)` | adds to 직원 |
| `clockIn(memberFull, month, token)` / `clockOut(…)` | start a shift now / close the open one now |
| `saveShift(key, date, memberFull, start, end, memo, month, token)` | create (`key=''`) or edit own shift; checks format, overlap, future times |
| `deleteShift(key, memberFull, month, token)` | delete own shift |
| `login(full, pw)` | returns `{token}`; accepts the developer password too |
| `setPassword(full, token, newPw)` | `newPw=''` removes it; returns `{token, members}` |
| `refreshNow()` | live import if the last one was ≥ 2 min ago; returns `{label, error, off, added}` |

Shapes sent to the page:
- Row: `[sheetRow, key, time, name, qty, wprice, wamt, mamt, type, memberFull, who, date, note, src]` — `src` (index 13) is `''` for 폐기, `'저회전'` for 저회전.
- Cancel: `[time, name, qty, wamt, date, [[origTime, qty, type, memberFull], …], src]` (empty list = no earlier line, ignored).
- Shift: `[sheetRow, key, date, memberFull, start, end, memo]`. A month's shifts also include the last day of the month before (overnight shifts).
- `usual` = `{fullName: [출근, 퇴근], '*': [...]}`: the most frequent closed shift pair per worker over the last 90 days (ties → most recent).

Auth failures throw a message containing `[비밀번호]`; the page then opens the password box.

**Anything public is callable.** Every top-level function in Code.gs whose name does not end in `_` can be called by anyone with the /exec link (`google.script.run` from the browser console), running as the owner. Keep helpers private with a trailing `_`. Menu / editor / trigger functions guard themselves: menu items call `SpreadsheetApp.getUi()` first (throws outside the spreadsheet); `setup`, `installNightlyTrigger`, `importThisMonth` call `adminOnly_()`; `nightly(e)` / `liveTick(e)` accept their own trigger's `triggerUid` or else `adminOnly_()`.

`setTag` writes only the acting worker's own name and refuses to change or clear a row another worker tagged (the page greys those buttons out). Wrong tags are fixed by the owner in the sheet (clear columns M–P of that row).

The page polls `getMonth` every 5 s while visible; `VER` changes on every write or import, so unchanged polls return `null`.

## Page behavior (Index.html)

- **Start**: if localStorage `chwisik.cache` holds this month's data (saved on every `take` of the newest month), the page draws it at once, then one `getBoot` call replaces it. So a returning phone sees the list right away even while Apps Script is slow. The Google Fonts stylesheet loads without blocking the first draw (`media=print` swap).

- **Tabs** (8, one row, fits 360 px): 출근 · 미등록 · 취식 · 폐기 · 전체 · 취소 · **저회전** · 월별 합계. 출근 is first and always opens first.
  - 미등록 = untagged **폐기** lines (저회전 is never 미등록).
  - 취식 = every 취식 line, 폐기 and 저회전 (저회전 lines carry a green `저회전` label).
  - 폐기 = 폐기-tagged lines. 전체 = every 폐기-slip line. 저회전 = every 저회전 line, with a one-line explanation on top and a single button per line: **[취식]** before it is registered, **[취소]** after (same as the 취식 / 폐기 tabs).
  - 취소 = BGF cancel lines (both kinds; 저회전 ones say so).
- In the 취식 / 폐기 tabs each line's right button is **취소** (removes that tag) and the left one switches to the other type (hidden for 저회전 lines). Lines tagged by another worker have disabled buttons.
- Name filter (모두 + names that have something in that tab this month) on every tab except 미등록 and 취소. (일) is red and (토) blue in day headings.
- Header "이번 달 내 취식 / 폐기" and the 월별 합계 table count 저회전 취식 as 취식; its footer shows only 미등록 **폐기**.
- Off-shift 폐기 check runs in the page: the line's 생성시각 must fall inside one of the worker's shifts, 30 min grace either side; an open shift counts up to now. Lines with only a date pass if any shift touches that day. Each line shows who was working then (`근무 지은`).
- **Empty-time warning (출근 tab)**: for each past day of the month, from the first recorded day to yesterday, the page joins everyone's shifts (including overnight ones from the day before) over 00:00–24:00 and lists gaps ≥ 15 min. The store is treated as **open 24 h**. A shift without 퇴근 from a past day counts as unknown. Each gap has **내가 근무했어요**, which opens 근무 직접 입력 prefilled. Hidden while a name filter is on.
- 출근 timeline bars: overlap with 2 people = yellow, 3+ = red, with "겹침 N분". Overnight shifts also show on the next day as `00:00 – 퇴근`.

## App (Android, and the installable page)

Why: the `/exec` link is slow to open (Google's wrapper page, two iframes, then the API calls), shows the "created by a Google Apps Script user" banner, and on some phones Google asks to sign in. The app runs the same page **directly**, without Google's page, and talks to the server through the JSON API.

- **One page for both.** `app/www/index.html` is a small loader. It takes the newest page the server gave last time (localStorage `chwisik.page` = `{hash, html}`), else the copy shipped in the app (`www/page.html`, copied from `apps-script/Index.html` by `app/build.mjs` at build time), adds `window.CHWISIK_API` / `CHWISIK_PAGE_HASH` and the viewport meta, drops `<base>`, and `document.write`s it.
- **Self-update.** After start the page calls `getPage(hash)`. A new page is stored and used the next time the app comes back to the front (`visibilitychange` → reload). So **page changes reach the app with the normal push to `main`; no new APK is needed.** A new APK is only needed when `app/` itself changes.
- **Safety net.** The loader sets `chwisik.pageTry = hash` before running a downloaded page; the page clears it as soon as its script starts. If it is still set next launch, that page broke: the loader drops it and runs the shipped copy (which then downloads the newest page again).
- **Android build** (`.github/workflows/android.yml`, on push to `app/**` or by hand): `npm ci` → `build.mjs` → `npx cap add android` (project generated fresh each time, not committed) → our icons/splash from `app/android-res/` (Capacitor's logo files removed) → `versionCode` = run number → **targetSdk 34** (Android 15 forces edge-to-edge for target 35, which would put the page under the status bar) → `assembleRelease` + zipalign + apksigner with the key from secrets → GitHub Releases: a versioned release **android-1.<run>** (kept as history) and **android-latest** (always the newest; `chwisik.apk`), plus a workflow artifact. Owner's rule: every app build is published to Releases. Without the secrets it builds a **debug** APK and warns: a phone with the debug build must uninstall it before a release-signed one installs.
- **Signing key**: PKCS12, alias `chwisik`, made 2026-11-09 with openssl, kept in `C:\Users\kiiwo\chwisik-android-key\` (README there). Lose it and phones must uninstall and reinstall to get a new build.
- **Installing**: the repo is private, so staff can't download from GitHub. The owner downloads `chwisik.apk` from the release and sends it (e.g. KakaoTalk); staff allow "install unknown apps" once. App id `com.kiiwoom8.chwisik`, name 취식.
- **iPhone**: a store app needs a Mac and a paid Apple developer account. Instead `app/www` is also an installable page (manifest, icons, `sw.js` caches the loader files, `apple-mobile-web-app-*` metas): host `app/www` + `page.html` on any HTTPS static host and staff use Safari → 공유 → 홈 화면에 추가. Not hosted yet (GitHub Pages needs a public repo or a paid plan).
- **Testing without a phone**: copy `app/www` (after `node app/build.mjs`) to a scratch folder, point `API` in its `index.html` at a small local server that answers POST with fake `{ok, r}` JSON, open it at 375 px. Done 2026-11-09: boot, name picker, tabs, cache-first start all worked.

## Live import (오늘 폐기·저회전)

- `refreshNow()` (page) and `liveTick()` (10-min trigger) go through the same gate: `LIVE_AT` must be ≥ `LIVE_MIN_GAP_S` = 120 s old, and a 90 s cache flag stops two runs at once. So BGF sees **at most one login per 2 min**, and only while someone has the page open; otherwise one per 10 min.
- **Past days**: the live import only reads yesterday..today, so on its own it would never fill 저회전 for days before 저회전 import existed (2026-11-09: only 11/8 came in). After a successful live run, `jeoBackfill_` imports 저회전 once for the whole range from the earliest 일자 in 폐기목록 to today, reusing the same login, then sets `JEO_BACKFILL=1`. The log row says `(저회전 지난 날짜)`. Any new slip kind added later needs the same kind of backfill.
- One run = login + 폐기 list + 저회전 list (+ the S312 lookup once, until `JEO_DIV` is cached) + detail calls **only for slips not fully in the sheet** (`knownChits_()` counts lines per 전표번호 and compares with `ITEM_CNT`). The nightly import re-reads every slip as a safety net.
- `LIVE_OK_AT` = start of the last successful run → the page header shows "폐기 21:31까지". `LIVE_ERR` holds the last error; only the first failure of a streak goes to 가져오기 기록, and live failures don't email (the nightly one does).
- Load: 144 trigger runs/day × a few seconds ≈ 10 min of the 90 min/day trigger quota; UrlFetch stays far below 20k/day.
- **Watch out:** if BGF ever logs the store PC out when the same account logs in elsewhere, turn live import off (menu → 실시간 가져오기 끄기).

## Auto-deploy (GitHub → Apps Script)

Set up 2026-11-08.

- Workflow: `.github/workflows/deploy.yml`. Runs on push to `main` when `apps-script/**`, `.clasp.json` or the workflow changes, and by hand (Actions → Deploy to Apps Script → Run workflow). Docs-only commits don't deploy.
- Steps: `node --check` on Code.gs and the page script → `clasp push --force` (rootDir `apps-script/`) → `clasp deploy --deploymentId <staff deployment>`, which adds a new version to the same deployment, so the `/exec` link never changes.
- Credentials: repo secret **`CLASPRC_JSON`** = the content of `~/.clasprc.json` from `clasp login` (clasp 2.4.2) as noerror96@gmail.com. The refresh token doesn't expire on its own. It stops working if the Google password changes or access for "clasp – The Apps Script CLI" is removed at myaccount.google.com → Security → Third-party access.
  - To renew: run `npx @google/clasp@2.4.2 login` on any computer with a browser, then replace the secret with the new `~/.clasprc.json`.
- Requires the **Google Apps Script API** ON at https://script.google.com/home/usersettings (it is).
- Deployments: `AKfycbzmsekR…wlRKpw` = staff web app (versioned). `AKfycbz0TxbU…` = the editor's @HEAD test deployment (ignore).

## Checking changes before pushing

1. Syntax: `cp apps-script/Code.gs /tmp/code.js && node --check /tmp/code.js`, and the same for the `<script>` block of `Index.html` (CI does both).
2. Page layout without Apps Script: copy `Index.html` to a scratch folder, add `<meta name="viewport" content="width=device-width, initial-scale=1">` (Apps Script adds it in `doGet`), and put a stub before the main script that defines `window.google.script.run` with `withSuccessHandler` / `withFailureHandler` and fake `getInit` / `getMonth` / `refreshNow` / `setTag` results (row shape above). Serve it with `python -m http.server` and check at 360 px.
3. Server code can't run locally (SpreadsheetApp, UrlFetchApp). After the push, watch the Actions run, then the 가져오기 기록 sheet and the page.
4. JSON API after a deploy: `curl -sL -H 'Content-Type: text/plain' -d '{"fn":"getInit","args":["",""]}' <exec URL>` must print `{"ok":true,…}`.

## Operations

- **Password changed at BGF** → menu 취식 관리 → BGF 비밀번호 입력.
- **Missed days** → 기간 지정해서 가져오기 (safe to repeat; dedupes by key).
- **저회전 not coming in** → check 가져오기 기록 for `저회전 실패: …`; delete Script Property `JEO_DIV` to redo the S312 lookup; check that `CHIT_ID` is still `24` on the site.
- **저회전 missing for older days** → menu 저회전 지난 날짜 모두 가져오기 (or 기간 지정해서 가져오기 for a specific range).
- **After code changes** → commit and push to `main`. GitHub Actions deploys it. The `/exec` URL stays the same.
- **Code got deleted in the editor** → restore from `apps-script/` in this repo (push again or run the workflow by hand).
- **A wrong tag by another worker** → owner clears columns M–P of that row in 폐기목록.

## Known limits / gotchas

- Names without a password are open: anyone can tag or clock in under them. With a password, only phones that entered it (or the developer password) can.
- The off-shift warning is advisory: the worker can still save; the row is marked `근무외`.
- A line is tagged as a whole. Quantity 3 cannot yet be split into 1 취식 + 2 폐기.
- The JSON API is as open as the link: anyone can POST the same public functions. Nothing new is exposed (they were all callable through `google.script.run` already).
- The public link has no Google login. Anyone with it can tag lines under password-less names or add a name. 등록시각 is the audit trail.
- The 월별 합계 sheet counts tagged lines that BGF later canceled; the page doesn't.
- Apps Script web apps show a "created by a Google Apps Script user" banner on the `/exec` link. It can't be removed there; the app doesn't have it.
- The page runs two iframes deep inside Google's `/exec` page, whose own background is white and can't be styled (`addMetaTag` takes only a few names; no `theme-color`). Keep the viewport meta without `viewport-fit=cover`: with it, phones draw the page under the bottom system bar, outside our frame, and Google's white shows there as a strip. `env(safe-area-inset-*)` in the CSS is harmless (0 inside the frame).
- In Claude's Chrome tab group, the web app's inner frame sometimes stayed blank (extension-side issue). Normal Chrome tabs and phones work.
- The BGF site page can freeze Chrome's screenshot tool (CDP timeout); use `javascript_tool` to read it instead.
- Apps Script quotas (consumer account): UrlFetch 20k/day, total trigger runtime 90 min/day. This project uses a small fraction.

## History

Full change log with reasons: `docs/HISTORY.md`.
