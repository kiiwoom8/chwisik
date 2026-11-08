# Dev notes — 직원 취식 목록

Last updated: 2026-11-08

## What it does

- **Every night around 00:01 (Asia/Seoul)**, a Google Apps Script time trigger logs in to the BGF 점포시스템 (store 25377), downloads the 폐기 slips for **yesterday and the day before**, and appends any new items to the **폐기목록** sheet. The day before is re-fetched so slips entered late are not missed. Items already in the sheet are skipped.
- **During the day (실시간 가져오기)**, today's (and yesterday's) new slips are pulled in when a worker opens the link, every 3 min while the page stays open, and every 10 min by a trigger even when nobody has it open. BGF is hit at most once per 2 min overall. See *Live import* below.
- **출근일지**: staff tap **[출근] / [퇴근]** (or enter a shift by hand) and see everyone's shifts day by day.
- **Off-shift 폐기 warning**: tagging 폐기 on an item whose slip time is outside the worker's recorded shifts (±30 min) asks for confirmation. If they confirm, it is saved and marked `근무외`.
- **Staff open one link** (no login). They pick their name once (stored on the phone), then tap **[취식]** or **[폐기]** on each item.
  - 취식 → records the full name (김성휘)
  - 폐기 → records the first name only (성휘)
- **Monthly totals** per person are shown in the web app (월별 합계 tab) and in the **월별 합계** sheet (a QUERY formula).

Everything runs on Google's servers. The owner's computer can be off.

## Live resources

| What | Where |
|---|---|
| Spreadsheet | Google Drive → **직원 취식 목록** (`1OFt4d-qxrv8EnsK3PK060Llv33fw2UnZ09rp00It338`) |
| Apps Script project | Bound to the sheet; project id `1ypg7065GCWVnqAQFi1mu3vFyg_vSEti7RdtbzXKITl4ogeFpoqfqYjzQ` |
| Staff web app (deployment v1) | https://script.google.com/macros/s/AKfycbzmsekRKq8HY5jqog-Dpb80yJqv-n3H4fZMItLZPISuM39M6RVyr3qOtqtz864YwlRKpw/exec |
| Google account | noerror96@gmail.com (script runs as this account) |
| Trigger | `nightly`, time-driven, daily, `atHour(0).nearMinute(1)`, Asia/Seoul. Google fires it within about ±15 min. |
| Trigger | `liveTick`, every 10 min. It installs itself the first time the page calls `refreshNow` (Script Property `LIVE_TRIGGER=1`). |

Deployment settings: **Execute as: Me**, **Who has access: Anyone**.

## Sheets

### 폐기목록 (one row per slip line)

| Col | Header | Notes |
|---|---|---|
| A | 키 | `CHIT_NO-CHIT_SEQ`, unique; used for dedupe and to find rows |
| B | 일자 | slip date `yyyy-MM-dd` |
| C | 생성시각 | slip created `yyyy-MM-dd HH:mm:ss` (from `CRE_YMDHMS`) |
| D | 품명 | |
| E | 상품코드 | |
| F | 분류 | `LARGE_NM` |
| G | 수량 | can be negative (cancellation slips) |
| H–K | 원가단가, 원가금액, 매가단가, 매가금액 | |
| L | 전표번호 | |
| M | 구분 | `취식` / `폐기` / empty |
| N | 등록이름 | full name for 취식, first name for 폐기 |
| O | 직원 | always the full name (used for grouping) |
| P | 등록시각 | `MM/dd HH:mm` |
| Q | 월 | `yyyy-MM`, used to load a month |
| R | 확인 | `근무외` = 폐기 the worker confirmed although the slip time was outside their recorded shift |

Columns A–F and L–R are plain text (`@`) so dates and codes are not auto-converted.

**Canceled 폐기 (BGF 취소)**: a line with a negative 수량 / 단가 / 금액 cancels an earlier 폐기 of the same product (same 상품코드, else 품명). `cancelMatch_()` walks the whole sheet in 생성시각 order and uses up the quantity of the newest earlier line(s), untagged lines first; a partial cancel leaves the rest standing (amounts scaled). A negative line with no earlier match is ignored. The sheet is not changed: `getMonth` leaves canceled lines and all negative lines out of `rows` and lists the negatives in `cancels` (the page's 취소 tab). The sheet's 월별 합계 QUERY still counts a tagged line that was later canceled.

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
| G | 메모 | optional |
| H | 등록시각 | `MM/dd HH:mm`, last write |
| I | 월 | `yyyy-MM` of 날짜 |

Rules (server-side): from the page a worker can only edit or delete their own rows; one worker's shifts may not overlap; an open shift counts as "근무 중" for 16 h at most (after that the page shows "퇴근 기록 없음" until someone fixes it). The owner can edit the sheet directly.

### 직원
A = full name, B = first name for 폐기 (auto: drops a 1-char surname, or a 2-char one such as 남궁/황보/제갈/선우). Staff can also add themselves from the web app (column C = "웹에서 추가").
D = 비밀번호(암호): a salted SHA-256 hash of the worker's own password, or empty = no password. Never the password itself. Clearing the cell removes the password.

## Passwords (optional, per name)

- A worker can make, change or remove a password from the page (나: … **비밀번호**). 4–30 characters. No password is fine; then the name works as before.
- Choosing a name that has a password (🔒) asks for it once per phone. The server returns a token (HMAC of name + hash with the Script Property `TOKEN_KEY`), kept in the phone's localStorage (`chwisik.tok`). Every write sends it: `setTag`, `clockIn`/`clockOut`, `saveShift`, `deleteShift`, `setPassword`. Changing the password changes the token, so other phones must enter the new one.
- `setTag` checks the **actor** (`me`). It writes another worker's name only to undo the actor's own change (the row must be the actor's or empty at that moment).
- 5 wrong tries for a name → that name is locked for 10 min (CacheService).
- **Developer bypass**: spreadsheet menu → **개발자 비밀번호 설정** stores a hash in `DEV_PW_HASH`. Typing that password in any name's password box unlocks that name (then the developer can also change or remove its password from the page). Menu → **직원 비밀번호 지우기** removes one worker's password.
- Secrets `PW_SALT`, `TOKEN_KEY` are created on first use in Script Properties. Deleting `TOKEN_KEY` logs every phone out; deleting `PW_SALT` makes every stored password invalid (clear column D then).

### 월별 합계
A QUERY over 폐기목록 grouped by 월, 구분, 직원, 등록이름, with count, quantity, 원가, and 매가 totals.

### 가져오기 기록
One row per import run: time, date range, slip count, new items, result. Failures also email the owner.

## Spreadsheet menu: 취식 관리

- **BGF 비밀번호 입력**: stores the password in Script Properties (`BGF_PW`) and test-logs in.
- **어제 폐기 지금 가져오기**: runs `nightly()` now.
- **오늘 폐기 지금 가져오기**: runs the live import once (ignores the 2-min limit) and shows how long it took.
- **기간 지정해서 가져오기**: e.g. `20261101-20261108`.
- **매일 자동 가져오기 켜기**: recreates the nightly trigger.
- **실시간 가져오기 켜기 / 끄기**: the 10-min trigger and the on-open refresh. 끄기 sets `LIVE_OFF=1`; the nightly import keeps running.
- **개발자 비밀번호 설정**: the password that opens any name (empty = remove it).
- **직원 비밀번호 지우기**: removes one worker's password.

## BGF 점포시스템 protocol (reverse-engineered 2026-11-08)

The site is a **Nexacro** app at `https://store.bgfretail.com/websrc/deploy/index.html`. Every call is
`POST https://store.bgfretail.com/<service>` with an **SSV** body (`Content-Type: text/xml`).

SSV format:
- records separated by `\x1e` (RS), fields by `\x1f` (US), null = `\x03`
- first record `SSV:utf-8`, then `NAME=value` variables, then `Dataset:<name>`, a header record
  `_RowType_␟COL:STRING(256)␟…`, data rows starting with `N`, and an empty record to end the dataset
- responses carry `ErrorCode:string=0` (anything else is an error; `ErrorMsg` explains)

Variables sent with every call: `GV_USERFLAG=HOME`, the `SS_*` store variables (store code, store name base64, etc., constants in `Code.gs`), `GV_MENU_ID`, and `GV_CHANNELTYPE=HOME`. The session is a cookie, which the script keeps in a simple cookie jar.

| Step | Service | Dataset → key fields |
|---|---|---|
| Login | `/login/login` | `ds_login`: `USER_NO`, `PASSWD` (plain text, no captcha or encryption), `USER_GRP_ID=0001`. Plus vars `USER_TYPE=1`, `CONN_PLACE=HOME`, `MULTI_YN=N`, `RUNTIME_YN=(일반)`, … Success = response has dataset `GDS_JUMPO`. |
| Slip list | `/stgj020/search` | `dsSearch`: `strStoreCd`, `strChitDiv=10` (**10 = 폐기** in the 전표구분 dropdown), `strFromDt`, `strToDt` (yyyymmdd). Returns `dsList` with `CHIT_NO`, `CHIT_ID` (04 for 폐기), `CHIT_FLAG` (PC), `CHIT_YMD`, `ITEM_CNT`, `WONGA_AMT`, `MAEGA_AMT`, `CRE_YMDHMS`. |
| Slip detail | `/stgj020/searchDetailType1` (`Type0` when `CHIT_FLAG=PA`) | `dsSearch`: `strChitDiv=<CHIT_ID>`, `strChitNoList=('n1','n2',…)` (many slips at once, we chunk by 40), `strChitYmd`, `strStoreCd`. Returns `dsListType1`: `CHIT_NO`, `CHIT_SEQ`, `ITEM_CD`, `ITEM_NM`, `LARGE_NM`, `QTY`, `WONGA_PRICE`, `WONGA_AMT`, `MAEGA_PRICE`, `MAEGA_AMT`, `CUST_NM`, `CENTER_NM`. |

전표구분 codes (dsChitDiv): 01 일반매입, 02 루트매입, 03 점포직매입, 04 무료택배, 05 매입수정, 06 매입차이, 07 반품, 08 반품수정, 09 반품차이, **10 폐기**, 11 매가변경, 12 점간이동매입, 13 점간이동반품, 14 소모품(내부), 15 공병반품, …

Verified: 11/1–11/8 import = 103 slips / 225 items, identical to the site's own totals.

If BGF changes its login (adds a captcha, OTP, or password encryption), the nightly import will fail and email the owner. Re-capture the login request from the browser (hook `XMLHttpRequest.prototype.send` on the login page **before** pressing 로그인; logging out reloads the page and clears the hook).

## Web app API (google.script.run)

| Function | Purpose |
|---|---|
| `getInit(me, token)` | members (`{full, short, hasPw}`), list of months (items + shifts), data version, live-import label, `meOk` (false = this phone must enter the password again) |
| `getMonth(month, knownVersion)` | rows + cancels + shifts + `usual` for `yyyy-MM`; returns `null` if `knownVersion` is current (cheap polling) |
| `setTag(rowHint, key, type, memberFull, month, note, me, token)` | type `취식` / `폐기` / `''` (clear). `note='근무외'` is kept only for 폐기. Uses LockService. Returns the fresh month. |
| `addMember(full)` | adds to 직원 |
| `clockIn(memberFull, month, token)` / `clockOut(…)` | start a shift now / close the open one now |
| `saveShift(key, date, memberFull, start, end, memo, month, token)` | create (`key=''`) or edit own shift; checks format, overlap, future times |
| `deleteShift(key, memberFull, month, token)` | delete own shift |
| `login(full, pw)` | returns `{token}`; accepts the developer password too |
| `setPassword(full, token, newPw)` | `newPw=''` removes it; returns `{token, members}` |
| `refreshNow()` | live import if the last one was ≥ 2 min ago; returns `{label, error, off, added}` |

Auth failures throw a message containing `[비밀번호]`; the page then opens the password box.

**Anything public is callable.** Every top-level function in Code.gs whose name does not end in `_` can be called by anyone with the /exec link (`google.script.run` from the browser console), running as the owner. Keep helpers private with a trailing `_`. Menu / editor / trigger functions guard themselves: menu items call `SpreadsheetApp.getUi()` first (throws outside the spreadsheet), `setup`, `installNightlyTrigger`, `importThisMonth` call `adminOnly_()` (active user must be the owner or an editor), and the trigger handlers `nightly(e)` / `liveTick(e)` accept their own trigger's `triggerUid` or else `adminOnly_()`.

`setTag` only writes the acting worker's own name, and refuses to change or clear a row another worker tagged (the page greys those buttons out). Wrong tags by someone else are fixed by the owner in the sheet (clear columns M–P of that row).

`usual` = `{fullName: [출근, 퇴근], '*': [...]}`: the most frequent closed shift (start+end pair) per worker over the last 90 days (ties → most recent). The 근무 직접 입력 form starts with the worker's own pair, else everyone's.

Row shape sent to the page: `[sheetRow, key, time, name, qty, wprice, wamt, mamt, type, memberFull, who, date, note]`.
Cancel shape: `[time, name, qty, wamt, date, [[origTime, qty, type, memberFull], …]]` (empty list = no earlier 폐기, ignored).
Shift shape: `[sheetRow, key, date, memberFull, start, end, memo]`. A month's shifts also include the last day of the month before (overnight shifts).

The page polls every 5 s while visible. A Script Property `VER` changes on every write or import (tags, shifts, imports), so unchanged polls return `null`.

The off-shift 폐기 check runs in the page (it already has the month's shifts): the item's 생성시각 must fall inside one of the worker's shifts, with 30 min grace either side; an open shift counts up to now. Items with only a date pass if any shift touches that day. Each item line also shows who was working at that time (`근무 지은`).

**Empty-time warning (출근 tab)**: for each past day of the month, from the first recorded day to yesterday, the page joins everyone's shifts (including overnight ones from the day before) over 00:00–24:00 and lists gaps of 15 min or more ("아무도 기록하지 않은 시간"). The store is treated as **open 24 h**. A shift without 퇴근 from a past day counts as unknown, so it shows as a gap until fixed. Each gap has **내가 근무했어요**, which opens 근무 직접 입력 filled with that date and time (whole empty day → the usual times). Gaps are hidden while a name filter is on.

**Page layout**: the 출근 tab is first and always opens first. In the 취식 / 폐기 tabs each line's right button is **취소** (removes that tag) and the left one switches to the other type. The 취소 tab lists BGF-canceled 폐기. Tabs other than 미등록 and 취소 show a name filter (모두 + names that have something in that tab this month). (일) is red and (토) blue in day headings.

## Live import (오늘 폐기)

- `refreshNow()` (page) and `liveTick()` (10-min trigger) go through the same gate: Script Property `LIVE_AT` (last attempt) must be ≥ `LIVE_MIN_GAP_S` = 120 s old, and a 90 s cache flag stops two runs at once. So BGF sees **at most one login per 2 min**, and only while someone has the page open; otherwise one per 10 min.
- It searches yesterday..today (one list call) and downloads details **only for slips not fully in the sheet yet** (`knownChits_()` counts lines per 전표번호 and compares with `ITEM_CNT`). A typical run is login + list + 0–1 detail calls. The nightly import still re-reads every slip as a safety net.
- `LIVE_OK_AT` = start of the last successful run → the page header shows "폐기 21:31까지". `LIVE_ERR` holds the last error; only the first failure of a streak goes to 가져오기 기록, and live failures don't email (the nightly one still does). Successful runs are logged only when they add items, with the run time in seconds — check those rows to see how fast BGF really is.
- Load: 144 trigger runs/day × a few seconds ≈ 10 min of the 90 min/day trigger quota; UrlFetch stays far below 20k/day.
- **Watch out:** if BGF ever logs the store PC out when the same account logs in elsewhere, turn this off (menu → 실시간 가져오기 끄기).

## Auto-deploy (GitHub → Apps Script)

Set up 2026-11-08.

- Workflow: `.github/workflows/deploy.yml`. It runs on push to `main` when `apps-script/**`, `.clasp.json` or the workflow changes, and can also be run by hand (Actions → Deploy to Apps Script → Run workflow).
- Steps: `node --check` on Code.gs and the page script → `clasp push --force` (rootDir `apps-script/`) → `clasp deploy --deploymentId <web app deployment>`, which adds a new version to the same deployment, so the `/exec` link never changes.
- Credentials: repo secret **`CLASPRC_JSON`** = the content of `~/.clasprc.json` from `clasp login` (clasp 2.4.2) as noerror96@gmail.com. The refresh token doesn't expire on its own. It stops working if the Google password changes or access for "clasp – The Apps Script CLI" is removed at myaccount.google.com → Security → Third-party access.
  - To renew: run `npx @google/clasp@2.4.2 login` on any computer with a browser, then replace the secret with the new `~/.clasprc.json`.
- Requires the **Google Apps Script API** to be ON at https://script.google.com/home/usersettings (it is).
- Deployments: `AKfycbzmsekR…wlRKpw` = staff web app (versioned). `AKfycbz0TxbU…` = the editor's @HEAD test deployment (ignore).

## Operations

- **Password changed at BGF** → spreadsheet menu 취식 관리 → BGF 비밀번호 입력.
- **Missed days** → 기간 지정해서 가져오기 (safe to repeat; it dedupes by key).
- **After code changes** → commit and push to `main`. GitHub Actions deploys it (see Auto-deploy). The `/exec` URL stays the same.
- **Code got deleted in the editor** → restore from `apps-script/` in this repo.

## Known limits / gotchas

- Names without a password are open: anyone can tag or clock in under them. With a password, only phones that entered it (or the developer password) can.
- Anyone can still clear or overwrite a tag someone else made (that writes the actor's own name, not theirs).
- The off-shift warning is advisory: the worker can still save, and the row is marked `근무외`.
- A line is tagged as a whole. Quantity 3 cannot yet be split into 1 취식 + 2 폐기.
- The public link has no login. Anyone with it can tag items or add a name. The sheet's 등록시각 column is the audit trail.
- Apps Script web apps show a "created by a Google Apps Script user" banner. This is normal.
- In Claude's Chrome tab group, the web app's inner frame sometimes stayed blank (an extension-side issue). Normal Chrome tabs and phones work.
- Apps Script quotas (consumer account): UrlFetch 20k/day and total trigger runtime 90 min/day. This project uses a tiny fraction.

## History

- 2026-11-04: one-off. October 폐기 list copied into Excel Online; then a shared "tap to remove" page (Claude artifact, then an Apps Script web app on the sheet **10월 폐기 정리**) to split 4 people's items.
- 2026-11-08: this project. Automated nightly import, one-tap 취식/폐기 tagging, monthly totals. Deployed as v1.
- 2026-11-08: 출근일지 (clock in/out, manual entry, monthly hours), off-shift 폐기 warning (`근무외`), live import of today's 폐기 (on open + every 10 min, new slips only).
- 2026-11-09: 출근 tab first/default, name filter, (일)/(토) colors, optional per-name passwords with developer bypass, usual times in 근무 직접 입력, empty-time warning for past days.
