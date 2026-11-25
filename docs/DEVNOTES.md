# Dev notes — 직원 취식 목록

Last updated: 2026-11-26 (근무 직접 입력: a 출근 not yet come today goes on yesterday; straight into the page after Google sign-in; 접근 계정 shows and edits a name per account; 접근 계정 screen in the page for the owner; access by Google account; 접근 코드 and APK key removed)

Read this first if you are a person or an AI agent about to change the code. Related docs:

| Doc | What's in it |
|---|---|
| `CLAUDE.md` | Working rules: git (always `main`, push right away), deploy, docs-update rule, conventions |
| `docs/DEVNOTES.md` (this) | What the system does, live resources, sheets, BGF protocol, API, operations, gotchas |
| `docs/CODEMAP.md` | Function-by-function map of `Code.gs` and `Index.html`, data flows, recipes for common changes |
| `docs/HISTORY.md` | Every change in order, with commit ids and the reason behind it |
| `docs/ROADMAP.md` | Planned work |

## What it does

A tracker for convenience stores of one owner: which expired items (폐기) a worker ate (취식) and which they threw away (폐기), plus a shift log (출근일지). Stores today: **CU 울산둘리점** (25377, the first one) and **CU 울산두왕점** (31949, added 2026-11-16); **GS25 울산신정중앙점** is defined but off (see *Stores*). Each store has its own lists, staff and shift log; one page and one app serve them all (the worker picks the store once).

Everything below that says "the sheet" or a Script Property means **the current store's** (see *Stores* for the names).

- **Every night around 00:01 (Asia/Seoul)** a time trigger logs in to the BGF 점포시스템, downloads the **폐기** and **저회전상품철수** slips for **yesterday and the day before**, and appends new lines to the **폐기목록** sheet. The day before is re-read so late slips are not missed. Lines already in the sheet are skipped (by key).
- **During the day (실시간 가져오기)** today's and yesterday's new slips are pulled when a worker opens the link, every 1 min while the page is open, and every 5 min by a trigger even if nobody has it open. BGF is hit at most once per 50 s overall, and the BGF login is kept between runs (re-login only when needed). See *Live import*.
- **Staff open the Android app or one link** (no Google login). The app (see *App*) shows the same page without Google's wrapper and banner. They pick their name once (stored on the phone), then tap **[취식]** or **[폐기]** on each line.
  - 취식 → records the **full name** (김성휘)
  - 폐기 → records the **first name only** (성휘)
- **저회전 (저회전상품철수)** lines are imported the same way and shown in their own **저회전** tab. They can be tagged **취식 or 폐기** (폐기 added 2026-11-15 so it shows who handled them), and they **don't need to be tagged** (they are not counted in 미등록). A 저회전 취식 / 폐기 counts in the worker's 취식 / 폐기 totals like any other.
- **출근일지**: staff enter their shifts by hand (`+ 근무 직접 입력`, 30-min slots; no [출근] / [퇴근] buttons) and see everyone's shifts day by day.
- **Off-shift 폐기 warning**: tagging 폐기 on a **past day's** line whose slip time is outside the worker's recorded shifts (±30 min) asks first. If they confirm, it is saved and marked `근무외`. Today's lines are never warned (today's 출근일지 may not be filled in yet).
- **BGF cancels**: a negative line cancels an earlier line of the same product; both disappear from the lists and totals and show in the **취소** tab.
- **Monthly totals** per person in the web app (월별 합계 tab, includes hours) and in the **월별 합계** sheet (a QUERY formula).

Everything runs on Google's servers. The owner's computer can be off.

## Live resources

| What | Where |
|---|---|
| Spreadsheet | Google Drive → **직원 취식 목록** (`1OFt4d-qxrv8EnsK3PK060Llv33fw2UnZ09rp00It338`) |
| Apps Script project | Bound to the sheet; script id `1ypg7065GCWVnqAQFi1mu3vFyg_vSEti7RdtbzXKITl4ogeFpoqfqYjzQ` (also in `.clasp.json`) |
| **Staff link** (the one address) | https://kiiwoom8.github.io/chwisik/ (GitHub Pages: `app/www` + `page.html`, `.github/workflows/pages.yml`). Phones, PCs, iPhone home screen. |
| Staff web app (versioned deployment) | https://script.google.com/macros/s/AKfycbzmsekRKq8HY5jqog-Dpb80yJqv-n3H4fZMItLZPISuM39M6RVyr3qOtqtz864YwlRKpw/exec (GET = `Move.html`, a page that sends people to the staff link with their store and names; `?stay=1` = the page here as before; POST = the JSON API the app uses) |
| Android app (APK) | GitHub → Releases → **android-latest** → `chwisik.apk` (built by `.github/workflows/android.yml`) |
| iPhone app | GitHub → Releases → **ios-latest**: no file (home-screen web app); the address, steps and `chwisik-iphone-qr.png`. Remade by `pages.yml` on every Pages deploy. |
| App signing key | `C:\Users\kiiwo\chwisik-android-key\` on the owner's PC (never in the repo); also as repo secrets `ANDROID_KEYSTORE_B64` / `ANDROID_KEYSTORE_PW` |
| GitHub repo | source of truth; push to `main` deploys (see *Auto-deploy*) |
| Google account | noerror96@gmail.com (the script runs as this account) |
| Trigger `nightly` | time-driven, daily, `atHour(0).nearMinute(1)`, Asia/Seoul. Google fires it within about ±15 min. |
| Trigger `liveTick` | every 5 min (`LIVE_TRIGGER_MIN`). Each run reads **one** store (the one read longest ago), so with 2 stores each is read every 10 min while nobody has its page open. Installs itself when the page calls `refreshNow` and Script Property `LIVE_TRIGGER` isn't the current minutes (so changing `LIVE_TRIGGER_MIN` reinstalls it). |
| Link that opens a store | the staff link + `?store=<id>`, e.g. `…/exec?store=31949` for 두왕점. It only picks the store on a phone that has none yet; after that the phone's own choice wins. |

Web app settings (`apps-script/appsscript.json`): **Execute as: Me (owner)**, **Who has access: Anyone, even anonymous** (`ANYONE_ANONYMOUS`). Changing access locks staff out.

## Repo layout

| Path | What |
|---|---|
| `apps-script/Code.gs` | Server: BGF login + import (nightly, live), sheet setup, web app API, passwords, 출근일지 |
| `apps-script/Index.html` | The staff page: HTML + CSS + one `<script>` block (no build step, no libraries) |
| `apps-script/Oct2026.gs` | One-time October 2026 data (취식 tags + shifts, 이국환's lines) and `octApply_()` / `octApply2_()`; can be deleted after both ran (`OCT_APPLY=1`, `OCT_APPLY2=1`) |
| `apps-script/appsscript.json` | Manifest: timezone, V8, web app access |
| `.clasp.json` | clasp config (`rootDir: apps-script`) |
| `.github/workflows/deploy.yml` | Syntax check → `clasp push` → `clasp deploy` on the staff deployment |
| `app/` | Android app (Capacitor 7 shell) and installable page: `www/index.html` loader, `manifest.webmanifest`, `sw.js`, icons; `build.mjs` copies `Index.html` to `www/page.html`; `android-res/` icons + splash; `make-icons.py` makes the icons from `icon-source.png` |
| `.github/workflows/android.yml` | Builds the APK on push to `app/**` and publishes release `android-latest` |
| `.githooks/post-commit`, `scripts/setup-hooks.sh` | Auto-push `main` after every commit |
| `tests/` | `mock.js` + `server.test.js`: run `Code.gs` in Node against a mock of the Apps Script services (`node tests/server.test.js`); `page-stub.py`: a copy of the page with a fake server, to look at in a browser |
| `docs/` | These docs |

## Stores (multi-store)

Added 2026-11-16. The list is `STORES` at the top of `Code.gs`; the import code per chain is `CHAINS`.

| Store | id | chain | on | Notes |
|---|---|---|---|---|
| CU 울산둘리점 | `25377` | CU | yes | `legacy: true`: the store from before stores existed. Its sheets, Script Properties and localStorage keys have **no store part** in their names. Its BGF `SS_*` values are written in `STORES`. |
| CU 울산두왕점 | `31949` | CU | yes | BGF id 31949. Its `SS_*` values come from its own login answer. Needs its BGF password entered once in the menu. |
| GS25 울산신정중앙점 | `gs-sinjeong` | GS25 | **no** | Prepared only: hidden everywhere until `on: true`. |

**How a request gets its store.** One execution = one store, held in `CUR_` and read with `store_()`.
- The page sends its store with every call: on the `/exec` link through `google.script.run.api(store, fn, args)`, in the app through `{"fn", "args", "store"}` in the POST body. `api()` / `doPost` call `useStore_(id)` first. No store (a page from before 2026-11-16, e.g. an app that hasn't updated itself yet) = the first store.
- Triggers and the menu loop over stores with `inStore_(st, fn)`.
- An unknown id, or a store with `on: false`, is refused (`없는 점포예요…`).

**What is per store** (everything a worker sees):

| Thing | First store (legacy) | Any other store |
|---|---|---|
| Sheets | `폐기목록`, `직원`, `출근일지`, `월별 합계` | `<short> 폐기목록` … e.g. `두왕점 폐기목록` (`sheetName_`). Made by themselves on the store's first request (`storeSheets_`), then marked with Script Property `SHEETS_<id>`. A sheet deleted by hand is made again (empty). |
| Script Properties | `VER`, `LIVE_AT`, `BGF_PW`, … | the same key + `_<id>`: `VER_31949`, `BGF_PW_31949` (`pget_` / `pset_` / `pdel_`) |
| CacheService keys | — | key + `\|<id>` (`ck_`): kept BGF login, `live_running`, password tries |
| Page localStorage | `chwisik.me`, `chwisik.tok`, `chwisik.cache` | `chwisik.me.<id>`, `chwisik.tok.<id>`, `chwisik.cache.<id>` (`chwisik.sumView`, the 월별 합계 view, `chwisik.hoursView`, the 근무 시간 view, and `chwisik.sumSort`, its table sorting, are one key each for all stores) |

**Shared by all stores:** the spreadsheet file, `가져오기 기록` (lines of other stores start with `[두왕점]`), `PW_SALT` / `TOKEN_KEY` / `DEV_PW_HASH`, `LIVE_OFF`, `LIVE_TRIGGER`, `JEO_DIV` (a BGF-wide code), the triggers, the page and the app.

**One thing crosses stores: 근무 시간.** The same person (same **full name**) can work in 2 or 3 stores, so the 월별 합계 tab's 근무 시간 table adds up every store's shifts per person (owner, 2026-11-16). `getMonth` therefore carries the other stores' shifts of that month (`others`), and a store's data version includes the other stores' shift versions (`SVER`), so a shift saved in 두왕 reaches an open 둘리 page. 취식 / 폐기 totals stay per store.

**Page.** The title is the store name; with 2+ stores it is a button that opens `점포 바꾸기`. A phone that never chose (and has no name remembered from before stores) is asked `어느 점포인가요?` once. Switching keeps a separate name / password token / cached list per store; the name used in the store you came from is taken over when that name is on the new store's 직원 list (a name with a password asks for it).

### Adding a CU store

1. Add a line to `STORES` (`id` = BGF 점포코드, `short` = the sheet prefix, `chain: 'CU'`, `userNo` = BGF id, `on: true`). No `ss` needed.
2. Push. Its sheets appear on the first request (or run `setup()` in the editor).
3. Spreadsheet → reload → menu **취식 관리 → BGF 점포시스템 비밀번호 입력 · <store>** (the menu has one such item per store; a 4th store needs one more `menuSetPasswordN` function). It test-logs in and shows the store name BGF answered.
4. From then on the store is in the nightly and live imports. Past days: menu **기간 지정해서 가져오기** (asks which store).

Until step 3 the page shows `전산 연결 전` and an empty list; 출근일지 works right away.

### Another chain (GS25) — what is prepared, what is left

GS25's 전산 is a different system (not BGF, not Nexacro SSV as far as we know), so nothing of `bgfLogin_` / `fetchSlips_` can be reused. What is ready:
- **The store is already in `STORES`** (`gs-sinjeong`, `on: false`) and the chain in `CHAINS.GS25` (`system`, `pwKey: 'GS_PW'`, `jeo: false`, no import functions yet).
- **Everything outside the import is chain-neutral**: sheets, 직원, passwords, tagging, 출근일지, 근무 시간 across stores, the page. With `on: true` and no adapter the store already works for 출근일지 (the page shows `전산 연결 전`, hides the 저회전 tab, and no import runs).
- **The adapter contract** (comment above `CHAINS`): `live(from, to, known)`, `range(from, to)`, `check()`; both imports return `{ chits, jeoChits, fetched, items, jeoErr, session }` with items `{ key, date, time, name, code, cat, qty, wprice, wamt, mprice, mamt, chit, src }`. `appendItems_`, the dedupe by key, the cancel pairing and the page need nothing else.
- The menu already offers a password item for any store whose chain has `check`.

Left to do when the owner starts it:
1. Get from the owner: the GS25 점포 전산 address, the store id, and which screen lists 폐기 (and whether GS25 has anything like 저회전상품철수).
2. Capture the login and the 폐기 list / detail calls in the browser (the same way BGF was done: hook `XMLHttpRequest.prototype.send` / `fetch` before pressing 로그인; the owner types the password, never an agent). Note: captcha, OTP, password encryption, session cookies.
3. Write `gsLogin_`, `gsFetch_` → items in the shape above. Decide the key (must be unique and stable per line; e.g. 전표번호-순번) and how GS25 marks a canceled line (the cancel pairing expects a negative 수량 line of the same 상품코드).
4. Fill `CHAINS.GS25.live / range / check`, set the store `on: true`, add a `tests/server.test.js` case with a fake GS25 answer.
5. If GS25 has no 원가 per line, decide with the owner what the page's 원가 columns show for that store.

## Sheets

One set per store. The names below are the first store's; another store's start with its short name (`두왕점 폐기목록`, `두왕점 직원`, …). `가져오기 기록` is the only shared one.

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
- A 저회전 row takes `취식`, `폐기` or empty, like a 폐기 row (until 2026-11-15 `setTag` refused `폐기` on it).
- **Canceled lines (BGF 취소)**: a line with a negative 수량 / 단가 / 금액 cancels an earlier line of the same product (same 상품코드, else 품명) **and the same slip kind** (폐기 and 저회전 never cancel each other). `cancelMatch_()` walks the whole sheet in 생성시각 order and uses up the quantity of the newest earlier line(s), untagged lines first; a partial cancel leaves the rest standing (amounts scaled). A negative line with no earlier match is ignored (shown with `⚠ 앞에 같은 상품 폐기가 없어요`). The sheet itself is not changed: `getMonth` leaves canceled lines and all negative lines out of `rows` and lists the negatives in `cancels` (the 취소 tab). The sheet's 월별 합계 QUERY still counts a tagged line that was later canceled.

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

Rules (server-side): from the page a worker can only edit or delete their own rows (the system itself may change another's 퇴근: 자동 퇴근, 교대 맞춤); one worker's shifts may not overlap; an open shift counts as "근무 중" for 16 h at most (after that the page shows "퇴근 기록 없음" until someone fixes it); no future times (+60 min slack). The owner can edit the sheet directly.

**Times are entered by hand only** (`saveShift`). The [출근] / [퇴근] buttons (`clockIn` / `clockOut`) were removed on 2026-11-15 (owner: "we don't [count] minutes as 근무시간 … we'll only use manual recording"). Worker's own row = a button that opens the editor; a 근무 중 row is closed by opening it and filling in 퇴근.
- **Editor defaults (new entry):** 날짜 = today (or the 1st of a past month), 출근 = the worker's usual 출근 (`usual`), **퇴근 blank** (since 2026-11-15; it used to be the usual 퇴근). `내가 근무했어요` on an empty-time gap fills both ends of the gap. A fixed grey note under the times (`#sfNote`) says to set 퇴근 to the next worker's 출근 (`예: 다음 사람이 14:00 출근이면 퇴근도 14:00`).
- **30-min slots:** the store counts work in 30-min slots (`SLOT_MIN` 30), so `saveShift` rounds both times to the nearest :00 / :30. Exactly :15 / :45 goes the worker's way: 출근 down, 퇴근 up (09:13 출근 → 09:00; 09:18 → 09:30; 22:07 퇴근 → 22:00; 22:16 → 22:30; 23:50 출근 → next day 00:00). The time inputs have `step="1800"`, and the editor's hint says `30분 단위로 HH:mm – HH:mm로 적어요` when the typed time will move. Times that round onto each other (09:05 – 09:10) are refused. A 근무 중 row (퇴근 empty) may start up to 15 min after now (a rounded-up 출근), so an open shift counts as 근무 중 from 15 min before its start (server `isLive_`, page `span`).
- **Who is working now (page):** `span().on` = an open shift that is `live`, **or a shift whose 퇴근 is written but still ahead** (from 15 min before 출근 until 퇴근: 이국환 13:00 – 22:00 at 14:40 is 근무 중). It drives `지금 근무 중` chips, the `출근일지` tab count (`N명`) and the worker's own card (`근무 중 · HH:mm 출근 · N째 · 22:00 퇴근으로 적혀 있어요. 다르면 …`). The row's duration label stays as before (a written-ahead shift shows its length, not `근무 중 · N`). Server rules (`isLive_`: one open shift per worker, 자동 퇴근 targets) still mean 퇴근 empty.
- **자동 퇴근** (`planAutoOut_`): saving a row (new, or its 날짜/출근 moved; 퇴근 empty **or filled in**, since 2026-11-15) whose 출근 has come (≤ 15 min ahead of now) while another worker is still 근무 중 (forgot 퇴근) closes that worker's shift and adds `자동 퇴근` to its memo, but only if their shift started 1 h+ before the new 출근 (`AUTO_OUT_MIN_H`; someone who started within the hour, or after, is taken to be working alongside). Closed at the new 출근, or, where overlapping is the habit at that handover (`overlapUsual_`, below), at that worker's usual 퇴근 (`usualShifts_`, same 출근) when it is up to 2 h later: 전병훈 07:30 on a weekday → 김성휘 08:00. A finished new row that ends before that worker's usual 퇴근 (same 출근) is a helper inside their shift and closes nobody. Stale open shifts (16 h+) are left alone. The snack says `· 이름 HH:mm 자동 퇴근`.
- **Catch-up** (`autoOutAll_`, run by every `refreshNow`: page open, pull, each minute while the page is open, the 5-min trigger): any 근무 중 shift that a later shift of another worker (started in the last 16 h, open or finished) should have closed is closed the same way, earliest 출근 first so each forgotten shift closes at the next 출근. Covers rows entered before this rule (the 2026-11-15 cases: 전병훈 08:00 entered by hand while 김성휘 was still open from 11/14 22:00; 이국환 13:00–22:00 entered with its 퇴근 while 전병훈 08:00 was open) and a race between two phones.
- **Confirming it:** for 2 h the worker's card says **자동 퇴근** (`다음 사람이 출근해서 HH:mm 퇴근으로 적었어요. 다르면 아래 내 기록을 눌러 고쳐 주세요.`). Saving their own row in the editor (any change, or none) drops the `자동 퇴근` mark, so a memo still showing it means the worker never checked it.

**교대 겹침 정리** (`planTrim_`, in `saveShift` when it's a new row or its 날짜/출근 changed):
- When a worker's 출근 falls inside another worker's **recorded** (closed) shift, that shift's 퇴근 moves to the new 출근, and its memo gets `교대 맞춤 (원래 HH:mm)` (`TRIM_MEMO`), so the earlier worker sees what happened and the original time. The snack says `· 이름 퇴근 HH:mm로 맞춤`.
- Only for a handover: the earlier shift started 1 h+ before (`AUTO_OUT_MIN_H`; less = working alongside), and the new shift ends at or after it (or is open). A short shift inside a longer one (a helper 12:00–14:00 inside 09:00–18:00) leaves it alone.
- **Unless overlapping is the habit** (`overlapUsual_`): look at the last 90 days of handovers (`handoffs_`: for each shift, the other worker's shift whose 퇴근 is nearest its 출근, started 1 h+ before it, ending ≤ 30 min before it or later, not a shift inside a longer one), at the same time of day (출근 ±60 min; all handovers if fewer than 3 there). If those that overlapped outnumber those that met or left a gap, the overlap is kept. Fewer than 3 seen, or a tie → trim (the owner's rule).
- History leaves out shifts whose 퇴근 the system set (`교대 맞춤`, or still `자동 퇴근`), so the rule can't feed itself. If the earlier worker edits their 퇴근, the `교대 맞춤` mark leaves the memo and the shift counts again.
- The same habit check picks the 자동 퇴근 time (above).
- Live data on 2026-11-15: the 07:30 weekday handover (전병훈 07:30 while 김성휘's night shift runs to 08:00) overlapped 32 of 32 times → kept; every other handover (12:30, 13:00, 22:00, …) met → trimmed.

### 직원
A = full name, B = first name for 폐기 (auto: drops a 1-char surname, or a 2-char one such as 남궁/황보/제갈/선우), C = memo ("웹에서 추가" when a worker added themself), D = 비밀번호(암호): salted SHA-256 hash of the worker's password, or empty = no password. Never the password itself. Clearing D removes the password.

### 월별 합계
A QUERY over 폐기목록 grouped by 월, 구분, 직원, 등록이름, with count, quantity, 원가, 매가 totals. Rebuilt by `setup()`. 저회전 rows are counted under their 구분 `취식` / `폐기` like other rows (untagged 저회전 rows have no 구분, so they are not counted).

### 월별 마감 (one row per person per closed month)
Made on first use (`closeSheet_`), one per store (`두왕점 월별 마감`, …). Columns: **월** (`yyyy-MM`, text) · **직원** (full name, or `(미등록)`) · **폐기 수량** · **폐기 원가** · **취식 수량** · **취식 원가** · **마감시각** (`yyyy-MM-dd HH:mm`). The `(미등록)` row holds that month's untagged 폐기 (저회전 not counted) in the 폐기 columns, and is written even when nobody tagged anything, so every closed month has at least one row. Newest month on top.

- **When:** a month is closed once `CLOSE_AFTER_DAYS` (1) of the next month have passed, i.e. at the nightly run of the **2nd** at 00:01 (after it re-read the 1st and the last day), or the first 5-min tick after that. The one extra day lets a night worker tag the last day's lines the next morning, and lets an early cancel slip land. `closeDue_` closes every month up to `closeTarget_()` that has 폐기목록 lines and no rows here yet, then sets ● `CLOSED`.
- **What it fixes:** from then on the page's 월별 합계 for that month shows these numbers (`getMonth` → `closed`), whatever happens later: a BGF cancel slip of the next month (it still hides the line in the lists, see *Canceled lines*), a late or cleared tag, a re-import, a hand edit of 폐기목록. Each line's 원가 itself was already fixed at import (BGF's slip amount, never looked up again). The line lists and the 금액합계 card still show the lines as they are now.
- **Redo / fix:** menu **월 마감 다시 하기** rewrites one month from 폐기목록 as it is now (only that month's rows). Or edit the numbers here by hand (moves the version, pages follow). Deleting a month's rows makes the page show the live totals again; it is not closed again by itself (`CLOSED` is past it), so use the menu item.
- A past month whose lines arrive after `CLOSED` has passed it (e.g. an old range imported later) is not closed by itself either: use the menu item.
- October 2026 (둘리점) is closed by the first tick after this went live (2026-11-18), from the numbers as they were then.

### 가져오기 기록
One row per import run: time, date range, slip count, new lines, result. Nightly/manual runs always log; live runs log only when they add lines or when a failure streak starts. The result shows `· 저회전 N장` or `· 저회전 실패: …`. Nightly failures also email the owner.

## Script Properties (Apps Script → Project settings)

Keys marked ● are **per store**: the first store uses the key as written, any other store the key + `_<id>` (`BGF_PW_31949`). The others are shared. The server reads all properties once per execution (`snap_()`), and writes go through `pset_` / `gset_`.

| Key | Set by | Meaning |
|---|---|---|
| ● `BGF_PW` | menu BGF 점포시스템 비밀번호 입력 · <store> | BGF store password (only place it exists). A store without it is not imported. |
| `ACCOUNTS` | `setAccount_` / `delAccount_`: sign-in (`gLogin`), mail link, menu 접근 계정, the page's 접근 계정 screen (`setAccess`) | JSON of Google accounts: `{email: {s: ok / wait / no, t, a, n}}` (see *Access*). |
| `ACCNAMES` | `noteActor_` (every 취식/폐기 tag, 출근 save / delete made with a device key), `setAccName`, `delAccount_` | JSON of the names shown on 접근 계정: `{email: {c: {전체 이름: [count, last ms]}, nm: the owner's name}}`; at most 8 names counted per account (see *Access*). |
| `ACCESS_KEY` | `secret_` (first use), menu 모든 폰 다시 로그인하게 하기 | HMAC key of the device keys. Changing it makes every phone sign in again (accounts stay allowed). |
| `ALLOW_KEY` | `secret_` (first request mail) | HMAC key of the 허용 links in request mails. Changing it voids links already sent. |
| `ACCESS_OFF` | by hand only | `1` = no access check (emergency, e.g. if the check itself breaks). Phones without a key still see the sign-in screen; any phone with a key gets in. Delete it to turn the check back on. |
| ● `BGF_SS` | `bgfSsFromLogin_` (not the first store) | JSON of the store's `SS_*` variables, taken from its last login answer |
| ● `SHEETS` | `storeSheets_` (not the first store) | `1` = the store's sheets were made. Delete it (or run `setup()`) to have them checked again. |
| ● `VER` | every write/import (`bumpVersion_`), hand edits (`onEdit`) | data version; the page polls `getMonth` with it, and the month cache is keyed by it |
| ● `SVER` | shift writes (`bumpVersion_(true)`), hand edits of 출근일지 | version of the store's 출근일지; part of the **other** stores' version (근무 시간 crosses stores) |
| ● `LIVE_AT` | live import | start of the last live attempt (throttle) |
| ● `LIVE_OK_AT`, `LIVE_MS`, `LIVE_ERR` | live import | last success time, its duration, last error ('' = ok) |
| ● `CLOSED` | `closeDue_` (nightly, 5-min tick) | newest month already closed into 월별 마감 (`yyyy-MM`); nothing to do while it equals `closeTarget_()` |
| `LIVE_OFF` | menu 실시간 끄기 | `1` = live import off |
| `LIVE_TRIGGER` | `installLiveTrigger_` | minutes of the live trigger that exists (`5`); any other value → `refreshNow` reinstalls it. (Was `1` for the old 10-min trigger.) |
| `JEO_DIV` | `jeoDiv_` | cached 전표구분 search code for 저회전상품철수 (from common code S312). Delete it to look it up again. |
| ● `JEO_ERR` | live import | last 저회전 error ('' = ok); only the first failure of a streak is logged |
| `JEO_BACKFILL` (first store only) | `jeoBackfill_` | `1` = 저회전 for all past dates in the sheet was imported once. Delete it (or use the menu item) to run it again. |
| `JEO_BACKFILL_TRY` (first store only) | `jeoBackfill_` | time of the last backfill try; a failed try waits 1 h before the next automatic one |
| `OCT_IMPORT`, `OCT_IMPORT_TRY` | `octImport_` | `1` = October 2026 (폐기 + 저회전) was imported once; time of the last try (a failed try waits 1 h). |
| `OCT_APPLY`, `OCT_APPLY2`, `OCT_APPLY_TRY` | `octApply_`, `octApply2_` (Oct2026.gs) | `1` = October 취식 tags and shifts were written once / the untouched lines were written as 이국환's 취식 once; time of the last try (a failed try waits 10 min). |
| `PW_SALT`, `TOKEN_KEY` | first use | password hashing salt / token HMAC key. Deleting `TOKEN_KEY` logs every phone out; deleting `PW_SALT` invalidates every stored password |
| `DEV_PW_HASH` | menu 개발자 비밀번호 설정 | hash of the developer bypass password |
| `BAK_<slot>`, `BAK_AT_<slot>` | `backupTo_` | id of a backup spreadsheet file and the time of its last copy (`yyyy-MM-dd HH:mm`). Slots: `D0`–`D6` weekday (일–토), `M1`–`M12` month end, `H` 직접, `R` 되살리기 직전. Delete a pair to forget that file (the next backup of the slot makes a new one). |

## Access (Google 계정, since 2026-11-25)

Why: the page (GitHub Pages) and the server address (in the public repo and inside the APK) are public, so anyone who
found them could read every name, 취식 / 폐기 count and shift. First a shared 접근 코드 (+ a key built into each APK)
kept them out; the owner then replaced both (2026-11-25): "instead of 접근코드 or apk access, allow permission through
google account. one the account is allowed, always allow the account".

- **Every data call needs a device key of an allowed Google account.** `api(store, fn, args, dev)` and `doPost`
  (`{fn, args, store, dev}`) run `checkAccess_(fn, dev)` first; without one they answer
  `[접근] Google 계정으로 들어와 주세요.` Open without a key: `getPage` (the page source is public anyway, and old apps
  must be able to update), `gLogin`, `gPoll`.
- **Direct `google.script.run` calls are refused too.** Each public data function (`getBoot`, `getInit`, `getMonth`,
  `setTag`, `saveShift`, `deleteShift`, `addMember`, `login`, `setPassword`, `refreshNow`) starts with `access_()`,
  which passes only when this execution came through `api()` / `doPost()` with a good key (`ACCESS_`, false at the
  start of every execution). **A new public data function must start with `access_()`.**
- **Device key** = `g:<email>:<sig>`, `sig` = HMAC-SHA256(`ACCESS_KEY`, `g|<email>`), 32 signs. Every call checks the
  sig **and** that the account is allowed now, so cutting an account stops all its phones at the next call. Same key
  for the account on every phone; nothing stored per phone.
- **Sign-in** (Google sign-in by OpenID Connect redirect, OAuth client `GOOGLE_CLIENT_ID`, the same value in
  `Code.gs` and `app/www/login.html`; Web client, authorized JavaScript origin `https://kiiwoom8.github.io`, authorized
  redirect URI `https://kiiwoom8.github.io/chwisik/login.html`, only the basic email scope, so no Google review and no
  "unverified" screen):
  Google Cloud project `chwisik` (owner's noerror96 account), Google Auth Platform: app name 취식, audience External,
  **In production** (Testing would let only listed test users sign in), home page `https://kiiwoom8.github.io/chwisik/`,
  privacy page `app/www/privacy.html`, authorized domain `kiiwoom8.github.io`; client "chwisik web" (its secret is not
  used anywhere: GIS needs only the ID). Adding a logo would require Google's verification, so there is none.
  1. The gate (`#gate`) shows one button, a link to `login.html?n=<nonce>` (`&app=1` in the Android app). On the
     GitHub Pages page in a browser tab (`gSameTab()`) it opens in the same tab; elsewhere (home-screen app, `/exec`
     copy, Android app) in a new tab; the Android app's WebView hands it to the phone's browser (Capacitor opens other hosts outside, and
     Google refuses sign-in inside a WebView anyway). The nonce: 24 random signs, `chwisik.gn` in localStorage (kept
     across reloads, new after 5 h).
  2. `login.html` (GitHub Pages) at once sends the tab to Google's account chooser (`accounts.google.com/o/oauth2/v2/auth`,
     `response_type=id_token`, `scope=openid email`, `nonce` = the nonce, `state` = nonce + `.app` from the app,
     `prompt=select_account`); Google comes back to `login.html#id_token=…&state=…`. No popup and no Google script
     (the GIS popup button opened a window in the owner's Chrome and never came back). The ID token goes to
     `gLogin(nonce, token)`: Google's tokeninfo endpoint checks it (`aud` = our client, issuer Google,
     `email_verified`, not expired, `nonce` = this nonce, so a token can't be used for another phone) → email (lower case),
     kept as `gl:<nonce>` in the script cache for 6 h. A new account is added as waiting and the owner gets a mail.
     Not from the app: once allowed it stores the key in that browser (`gPoll` with `chwisik.devOld`) and goes
     straight to `./` signed in, no button (owner, 2026-11-26); while waiting it goes to `./` too if this browser
     opened the sign-in (the gate waits there). From the app (`app=1`) it opens the app at once by the launcher intent,
     with a [취식 앱으로 돌아가기] button as fallback.
  3. The page asks `gPoll(nonce, oldKey)` every 2.5 s for 3 min after the button, then every 10 s, and at once when it
     comes back to the front: `{s: 'none' | 'wait' | 'no'}` with the email, or `{s: 'ok', dev}` → key stored, page boots.
- **Accounts** (Script Property `ACCOUNTS`, JSON `{email: {s: 'ok' | 'wait' | 'no', t: first seen, a: allowed at, n: note}}`,
  changed only by `setAccount_` under the script lock). **Once allowed, always allowed** on any phone, also after
  모든 폰 다시 로그인; only the owner cuts it. The owner's own account (the one the script runs as) is always allowed.
  At most 40 waiting entries (oldest dropped), at most 20 request mails a day.
- **Allowing**: the request mail (`notifyOwner_`) has a link `/exec?allow=<email>&s=<sig>` (sig = HMAC(`ALLOW_KEY`,
  `allow|<email>`)): a page with one [허용] button (`allowPage_` → `allowAccount`), so a mail scanner opening the link
  allows nothing. Or menu **접근 계정 (허용 · 끊기)**: the list; a number flips 허용 ↔ 끊기 (waiting → 허용); an email
  address allows that account ahead of time. Or **in the page: 더보기 → 접근 계정** (below).
- **접근 계정 screen in the page (owner only, since 2026-11-25).** The owner: "implement allowing google account button or
  tab. which is only visible by administrator". `checkAccess_` keeps the key's account in `CALLER_`; `ownerCaller_()`
  = that account is the owner's (the account the script runs as). Only then `getInit` adds `admin: {wait: n}`, so on
  every other phone the menu item, its divider and the dot simply don't exist. `getAccounts()` / `setAccess(email, s)`
  start with `ownerOnly_()` (`access_()` + owner key, `[관리자] …` otherwise). `ACCESS_OFF` does **not** open them:
  they always need the owner's own device key.
  Page: 더보기 menu → divider → **접근 계정** (shield icon, red count of waiting requests; a red dot on the 더보기 tab
  while any wait). It opens a bottom sheet: an email field + [허용] (allow ahead of time), then **허용 기다림** (거절 /
  허용), **허용됨** (the owner's own account on top, `사장님`, no button; others [끊기] behind a confirm), **끊김**
  (지우기 with 되돌리기 / 허용). Lazy like every save: the row changes at once (faded until the server answers), calls run
  one at a time in order, the last answer replaces the list; a refusal shows the error and reloads the list. The list
  is fetched when the sheet opens and when the owner's page comes back to the front (so the count stays fresh).
- **A name per account on 접근 계정 (since 2026-11-25).** The owner: "display the most frequently modifying name to the
  email (the most used name with the google account). set the name also editable by me." Every save made with a
  device key (`setTag`, `saveShift`, `deleteShift`; not reads, not `ACCESS_OFF` calls without a key) counts the
  staff name it was made as for that account (`noteActor_`, Script Property `ACCNAMES`, after the save and outside
  its lock; a busy lock skips the count rather than slow or fail the save). `getAccounts` sends `nm` (the owner's
  name) and `u` (the most-used name; a tie goes to the latest) per account, and `own` for the owner's account.
  Counting started 2026-11-25: older sheet rows don't record the account, so an account shows a name after its first
  save. The page shows `nm`, else `u`, as the row title (pencil icon; the email goes under it, smaller) and its first
  letter in the avatar; with `nm` set and a different `u`, the meta line adds "주로 <u>". Tapping the name edits it in
  place (20 letters): Enter or leaving the box saves (lazy, like the rest), Esc puts it back; an empty name or the
  most-used name typed back clears `nm`, so the row follows `u` again. `setAccName(email, name)` is owner-only,
  allows the owner's own email, and refuses an email not in `ACCOUNTS`. 지우기 drops the account's names too. The
  sheet menu 접근 계정 lists the name before each email.
- **When someone leaves**: 더보기 → 접근 계정 → [끊기] on their account, or menu 접근 계정 → their number (끊김). Their phones are out at once; nobody else is touched.
  **모든 폰 다시 로그인하게 하기** makes a new `ACCESS_KEY`: every phone must sign in again (allowed accounts get straight
  back in).
- **Moving over from the 접근 코드** (until `ACCESS_OLD_UNTIL` = 2026-12-09): a phone that had a key from the 접근 코드 or
  the APK key (`id.sig`) keeps it as `chwisik.devOld` when the gate opens and sends it with `gPoll`; a waiting account
  that comes with a good old key is allowed by itself (note `접근 코드 쓰던 폰`), since that phone was invited already.
  Old keys alone open nothing. After that day this does nothing; it can be deleted.
- **Page** (`Index.html`): key in localStorage `chwisik.dev` (all stores). No key at start → the gate before any data
  call. A call refused with `[접근]` (account cut, or 모든 폰 다시 로그인) → the key and every `chwisik.cache*` are
  deleted and the gate opens; `boot()` doesn't retry meanwhile. Old `#code=` invite links are only cleaned from the
  address.
- **Not verified until a real run**: the Google button and tokeninfo on the live site, the Android app opening
  `login.html` in the phone's browser, iPhone home-screen app opening it in Safari and noticing when it comes back.
- iPhone: the home-screen copy has its own storage; the Safari address carries the key into it (see App → iPhone without paying).
- History: until 2026-11-25 an 8-sign 접근 코드 (`ACCESS_CODE`, `redeem`, invite link `#code=`) and a per-build APK key
  (`AppKeys.gs`, `redeemApp`, `APP_ACCESS_OFF`); all removed. Those Script Properties can be deleted.

## Passwords (optional, per name)

- A worker can make, change or remove a password from the page (나: … **비밀번호**). 4–30 characters. No password is fine; the name then works for anyone.
- Choosing a name that has a password (🔒) asks for it once per phone. The server returns a token (HMAC of name + hash with `TOKEN_KEY`), kept in localStorage (`chwisik.tok`). Every write sends it: `setTag`, `saveShift`, `deleteShift`, `setPassword`. Changing the password changes the token, so other phones must enter the new one.
- 5 wrong tries for a name → that name is locked for 10 min (CacheService).
- **Developer bypass**: menu **개발자 비밀번호 설정** stores `DEV_PW_HASH`. Typing that password in any name's password box unlocks that name. Menu **직원 비밀번호 지우기** removes one worker's password.

## Spreadsheet menu: 취식 관리

- **BGF 점포시스템 비밀번호 입력 · <store>** (one item per store with an import adapter): stores that store's password and test-logs in; the alert shows the store name BGF answered. Handlers: `menuSetPassword`, `menuSetPassword2`, `menuSetPassword3` (by position in `STORES`).
- **오늘 폐기·저회전 지금 가져오기**: one live import now for every store that has a password (ignores the 50 s limit), shows each store's result.
- **어제 폐기·저회전 지금 가져오기**: runs `nightly()` now (every store).
- **기간 지정해서 가져오기**: asks which store (a number; empty = all), then the range, e.g. `20261101-20261108` (both kinds; safe to repeat).
- **저회전 지난 날짜 모두 가져오기 (둘리점)**: first store only (a one-time catch-up from before 저회전 import existed): from the earliest 일자 in 폐기목록 to today (safe to repeat).
- **월 마감 다시 하기 (지난 달 합계를 지금 숫자로)**: asks which store, then a past month (`2026-10`); rewrites that month in 월별 마감 from 폐기목록 as it is now (`closeMonth_`). Not for the current month or one not due yet.
- **매일 자동 가져오기 켜기**: recreates the nightly trigger.
- **실시간 가져오기 켜기 / 끄기**: the 5-min trigger and the on-open refresh, for all stores. 끄기 sets `LIVE_OFF=1`; the nightly import keeps running.
- **지금 백업하기**: copies everything into the `직접` backup file now (`menuBackupNow`); the alert gives the file's link.
- **백업에서 되살리기**: lists the backups (newest first), asks which one and which sheets (empty = all, or names with commas), confirms, then restores (`menuRestore` → `restoreFrom_`). See *Backups*.
- **개발자 비밀번호 설정** (all stores), **직원 비밀번호 지우기** (asks which store): see *Passwords*.
- **접근 계정 (허용 · 끊기)**, **모든 폰 다시 로그인하게 하기**: see *Access (Google 계정)*.

## Backups (since 2026-11-20)

Why: the data (tags, 출근일지, 직원 and their password hashes, 월별 마감) exists only in the one spreadsheet. Anyone with the /exec link can write under password-less names, and an editor can empty or delete the file. Only 폐기 lines can be fetched from BGF again.

- **Where:** separate spreadsheet files in the owner's Drive (root folder), named `직원 취식 목록 백업 · <slot>`: `월요일` … `일요일` (each overwritten a week later), `1월 말` … `12월 말` (overwritten a year later), `직접` (menu), `되살리기 직전`. So the last 7 days and the last 12 month ends are always there, also if this spreadsheet is deleted.
- **When:** `nightly()` (00:01) after the import: today's weekday file, and on the 1st also last month's month-end file (`backupNightly_`). A backup failure fails the nightly run, so Google's trigger-failure email reaches the owner; the run's text says `백업 실패: …`.
- **What:** every sheet (values + formats, `Sheet.copyTo`) except the `월별 합계` sheets (formulas; `setup()` writes them again), plus a `백업 정보` sheet (time, source, rows per sheet). New copies are made before the old ones are deleted, so a run that dies keeps the old backup. Script Properties are **not** copied (they hold the BGF passwords); losing `PW_SALT` / `TOKEN_KEY` means workers set passwords again.
- **Restore** (`restoreFrom_(slot, only)`): first copies the live data into `되살리기 직전` (so a restore can be undone the same way), then inside the script lock: each backup sheet is copied in; a live sheet keeps its place and settings and gets the backup's contents + formats; a missing sheet comes back whole. Every store's `VER` / `SVER` moves, so open pages read again. 폐기 lines that came in after the backup: menu 기간 지정해서 가져오기.
- **Permission:** only `SpreadsheetApp` (`create`, `openById`, `copyTo`), which the script already had. No `DriveApp`, so no new consent and no break of the /exec link. Side effect: old backup files can't be deleted by the script; the slots reuse the same 21 files at most.
- **Not covered:** losing the owner's Google account itself (backups live in the same Drive). Between two nightly backups, Google Sheets' own version history (파일 → 버전 기록) covers single bad edits.

## BGF 점포시스템 protocol (reverse-engineered 2026-11-08, extended 2026-11-09)

The site is a **Nexacro 17** app at `https://store.bgfretail.com/websrc/deploy/index.html`. Every call is
`POST https://store.bgfretail.com/<service>` with an **SSV** body (`Content-Type: text/xml`).

SSV format:
- records separated by `\x1e` (RS), fields by `\x1f` (US), null = `\x03`
- first record `SSV:utf-8`, then `NAME=value` variables, then `Dataset:<name>`, a header record
  `_RowType_␟COL:STRING(256)␟…`, data rows starting with `N`, and an empty record to end the dataset
- a request may have variables only and no dataset (`ssvVarsOnly_`)
- responses carry `ErrorCode:string=0` (anything else is an error; `ErrorMsg` explains)

Variables sent with every call: `GV_USERFLAG=HOME`, the `SS_*` store variables (`ssVars_(store)`), `GV_MENU_ID`, `GV_CHANNELTYPE=HOME`. The session is a cookie, kept in a small cookie jar (`Session_`, one per store).

**The `SS_*` store variables** (read from BGF's own script, 2026-11-16: `websrc/deploy/nexacro17lib/component/extPrototype.js`, `_gfn_loginCallback`): after login the site sets, for each of `STORE_CD, PRE_STORE_CD, STORE_NM, SLC_CD, LOC_CD, ADM_SECT_CD, STORE_OWNER_NM, STORE_POS_QTY, STORE_IP, SV_EMP_NO, SSTORE_ID, RCV_ID, FC_CD, USER_GRP_ID, USER_NO, SGGD_CD, LOGIN_USER_NO`, `SS_<name>` = column `<name>` of row 0 of the login answer's `GDS_JUMPO` (`STORE_NM` and `STORE_OWNER_NM` base64-encoded), and sends them with every call both as cookies and as leading variables of the SSV body. On a fresh browser the login itself is sent without them. So:
- the first store keeps the values captured from the browser in 2026-11 (`STORES[0].ss`), unchanged;
- any other CU store logs in with only `SS_STORE_CD`, `SS_USER_GRP_ID`, `SS_USER_NO`, `SS_LOGIN_USER_NO`, then `bgfSsFromLogin_` fills the rest from `GDS_JUMPO` the same way and keeps them in `BGF_SS_<id>`. `strStoreCd` of the slip calls is the store's `SS_STORE_CD`.
- An account with several stores gets one active store per login; BGF's own store switch is a re-login as the other 점포코드 (`MULTI_YN=Y`). Not used here: each store logs in with its own id and password.

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

> **Confirmed on the live site 2026-11-16 06:10: the 두왕점 login** (SS_* from its own login answer). The owner entered the password in the menu (`로그인 확인 완료 (울산두왕점)`); the live import then brought in 38 폐기 lines for 11/15–11/16 into `두왕점 폐기목록`, and both stores show `업데이트 06:10`. If a later slip call fails, 가져오기 기록 shows `[두왕점] … 실패: …`, and Script Property `BGF_SS_31949` shows which values the login answer gave.

> The 저회전 path was built from the site's scripts without a logged-in test (Claude may not type the BGF password). After the first deploy check 가져오기 기록 for `저회전 N장` or `저회전 실패: …`, and the `JEO_DIV` Script Property.

Verified (폐기): 11/1–11/8 import = 103 slips / 225 lines, identical to the site's own totals.

If BGF changes its login (captcha, OTP, password encryption), the nightly import fails and emails the owner. Re-capture the login request in the browser: hook `XMLHttpRequest.prototype.send` on the login page **before** pressing 로그인 (logging out reloads the page and clears the hook). Static form scripts can be read without logging in: `https://store.bgfretail.com/websrc/deploy/<prefix>/<FORM>.xfdl.js` (e.g. `GJ/STGJ020_M0.xfdl.js`).

## Web app API (google.script.run and JSON)

The page calls the server with `run(fn, …args)`, always for its store. On the `/exec` link that is `google.script.run.api(store, fn, args)`. In the app (`window.CHWISIK_API` set by the loader) it is `fetch(POST /exec)` with a `text/plain` body `{"fn": name, "args": [...], "store": id}` (text/plain avoids a CORS preflight; Apps Script answers through a redirect to `script.googleusercontent.com`, which allows any origin). `doPost` answers `{"ok": true, "r": result}` or `{"ok": false, "err": message}`. Both entries only run the names in `apiFns_()`, all of which are also public on their own (a page from before stores existed calls them directly and gets the first store).

`run()` drops an answer that arrives after the phone switched to another store (its promise never settles), so nothing from the old store can land in the new one.

| Function | Purpose |
|---|---|
| `getBoot(me, token)` | `{init: getInit(…), month: getMonth(newest month, '')}`: the page's first call (one round trip instead of two) |
| `getPage(knownHash)` | `{hash, html}` of `Index.html`, or `null` if the app already has that hash (app self-update) |
| `api(store, fn, args)` | the `/exec` page's entry: sets the store, runs one of the functions below |
| `getInit(me, token)` | members (`{full, short, hasPw}`), months (items + shifts), data version, live-import info (`{label, off, error, added, wait}`; `wait` = `'pw'` no 전산 password yet, `'adapter'` no import for this chain, else `''`), `meOk` (false = this phone must enter the password again), `store` (id), `stores` (`[{id, name, short, chain, jeo}]`, the stores that are on), `admin` (`{wait}`, only when the caller's key is the owner's account) |
| `getMonth(month, knownVersion, fresh)` | rows + cancels + shifts + `usual` + `others` + `closed` for `yyyy-MM`, with `store` and `version`; `null` if `knownVersion` is current (cheap polling). Kept in the cache per (store, month, version); `fresh = true` (pull to refresh, sync button) reads the sheets anyway. |
| `setTag(rowHint, key, type, memberFull, month, note, me, token)` | type `취식` / `폐기` / `''` (clear). `note='근무외'` kept only for 폐기. Refuses rows another worker tagged. Returns the fresh month. |
| `addMember(full)` | adds to 직원 |
| `saveShift(key, date, memberFull, start, end, memo, month, token)` | create (`key=''`) or edit own shift; checks format, overlap, future times; may trim another worker's 퇴근 (교대 겹침 정리), listed in `res.trimmed: [[member, end]]` |
| `deleteShift(key, memberFull, month, token)` | delete own shift |
| `login(full, pw)` | returns `{token}`; accepts the developer password too |
| `setPassword(full, token, newPw)` | `newPw=''` removes it; returns `{token, members}` |
| `refreshNow()` | live import if the last one was ≥ 50 s ago; returns `{label, error, off, added}` |
| `getAccounts()` | owner key only: `{owner, own: {nm, u}, list: [{e, s: 'wait' / 'ok' / 'no', t, a, n, nm, u}]}`, waiting first, then allowed (newest allowed first), then cut; the owner is not in `list`; `nm` = the owner's name for the account, `u` = the name it saved with most |
| `setAccess(email, s)` | owner key only: `s` = `'ok'` (allow; an unknown email = allowed ahead of time, note `미리 허용`; a waiting one gets `앱에서 허용`), `'no'` (cut), `'del'` (remove from the list); refuses the owner's own email and a bad address; returns `getAccounts()` |
| `setAccName(email, name)` | owner key only: the name shown for an account (the owner's own too), up to 20 letters; `''` = follow the most-used name again; returns `getAccounts()` |

Shapes sent to the page:
- Row: `[sheetRow, key, time, name, qty, wprice, wamt, mamt, type, memberFull, who, date, note, src]` — `src` (index 13) is `''` for 폐기, `'저회전'` for 저회전. `wprice` / `wamt` (원가) are rounded to whole won per line (BGF sends decimals; new rows are also stored rounded by the import), so every 원가 total on the page is whole won too. The page's `fmt` also rounds.
- Cancel: `[time, name, qty, wamt, date, [[origTime, qty, type, memberFull], …], src]` (empty list = no earlier line, ignored).
- Shift: `[sheetRow, key, date, memberFull, start, end, memo]`. A month's shifts also include the last day of the month before (overnight shifts).
- `usual` = `{fullName: [출근, 퇴근], '*': [...]}`: the most frequent closed shift pair per worker over the last 90 days (ties → most recent).
- `others` = `[{id, short, shifts: [[date, memberFull, start, end], …]}]`: the month's shifts of every other store, for the 근무 시간 table.
- `closed` = `null` (month not closed) or `{at: 'yyyy-MM-dd HH:mm', rows: [[memberFull, 폐기 수량, 폐기 원가, 취식 수량, 취식 원가], …], todo: [미등록 수량, 미등록 원가]}` from the 월별 마감 sheet.

**Month cache (2026-11-16).** `getMonth` keeps its answer in CacheService (`mo|store|month|version`, cut into 30,000-character pieces, 1 h), so only the first caller after a change reads the sheets; every other phone's poll and every page start gets the kept answer. `getInitData_` keeps the list of months the same way (`mons|store|version`). What keeps it right:
- every write flushes the sheet **before** the new version is set (`bumpVersion_` calls `SpreadsheetApp.flush()`), so nobody can read old data under the new version;
- a hand edit in the spreadsheet moves the version through the simple trigger `onEdit` (edits of 폐기목록 / 직원 / 출근일지 of any store);
- a change that moves nothing (a row deleted by hand, a script run in the editor) shows after a pull to refresh (`fresh`), or within the hour.

Auth failures throw a message containing `[비밀번호]`; the page then opens the password box.

**Anything public is callable.** Every top-level function in Code.gs whose name does not end in `_` can be called by anyone with the /exec link (`google.script.run` from the browser console), running as the owner. Keep helpers private with a trailing `_`. Menu / editor / trigger functions guard themselves: menu items call `SpreadsheetApp.getUi()` first (throws outside the spreadsheet); `setup`, `installNightlyTrigger`, `importThisMonth` call `adminOnly_()`; `nightly(e)` / `liveTick(e)` accept their own trigger's `triggerUid` or else `adminOnly_()`.

`setTag` writes only the acting worker's own name and refuses to change or clear a row another worker tagged (the page greys those buttons out). Wrong tags are fixed by the owner in the sheet (clear columns M–P of that row).

The page polls `getMonth` every 5 s while visible; the version changes on every write or import (and with another store's shift), so unchanged polls return `null` without opening the spreadsheet.

## Page behavior (Index.html)

- **Start**: if localStorage `chwisik.cache` (per store) holds this month's data (saved on every `take` of the newest month), the page draws it at once, then one `getBoot` call replaces it. The BGF check (`refreshNow`) starts at the same moment as `getBoot`, not after it. The Google Fonts stylesheet loads without blocking the first draw (`media=print` swap).
- **Loading screen** (redone 2026-11-16): while a month's data is on its way (`!S.ready`) the page shows
  - a thin **progress bar** at the very top (`#pbar`; `pend(±1)`): on during `getBoot`, a month or store change, and a manual refresh, also while kept data is already on screen;
  - a **skeleton shaped like the open tab** (`skeleton()`): 출근 = my card + shift rows, 월별 합계 = table rows, the lists = lines with two buttons; with a shimmer;
  - a line under the tabs: `불러오는 중…`, after 5 s `조금 느리네요. 계속 불러오고 있어요…`, after 14 s `연결이 느려요. 조금만 더 기다려 주세요…`;
  - the tab counters and `이번 달 취식 / 폐기` show `–` instead of `0`.
  When the data comes, the lists rise in softly (`.arrive`, 0.24 s; off with reduced motion).
- **If the start fails**: with nothing on screen, a card `목록을 불러오지 못했어요` + the reason + **[다시 시도]** (`#fail`); the page also tries again by itself (after 3 s, 6 s, 12 s … at most 30 s apart) and when the phone comes back online. With kept data on screen it stays up and the sync label says `연결 끊김 · 다시 시도 중`.
- **Months seen stay in memory** (`MONTHS`, this session, this store): going back to a month draws it at once and only asks whether it changed. A month not seen yet shows the loading screen.
- **Store** (see *Stores*): the title is the store name; tapping it (2+ stores) opens `점포 바꾸기`. A store whose 전산 isn't linked yet shows `전산 연결 전` in the sync label and `이 점포는 아직 전산과 연결되지 않았어요…` in the empty lists. A store whose chain has no 저회전 slips has no 저회전 tab (the tab bar's columns follow the tabs shown).
- **Never wider than the screen** (2026-11-17): phones with big text or screen zoom (a Galaxy Z Flip 4 in the app) used to scroll sideways. Grid columns are `minmax(0, 1fr)` (a plain `1fr` or the default column can't shrink below its content), and `html, body { overflow-x: clip }` (clip, not hidden, so the sticky bar still works). To check: in the page stub at 360 px, run in the console a loop that sets every element's inline `font-size` to 1.3–1.6 × its computed size, then compare `document.documentElement.scrollWidth` with `innerWidth` and look for elements whose right edge is past the screen.
- **Saving is lazy** (owner, 2026-11-19), for tags and 근무 기록 alike: the screen changes at once and the call runs behind it. A shift save closes the sheet and adds / changes the row with the times rounded like the server will (`slotHm`), faded (`.srow.pending`, temp key `tmp:…` for a new one) until the answer; a delete removes the row at once. While any write is on its way (`S.busy`) the sync label says `저장 중…`, polls don't overwrite the screen, a pending row can't be opened (`아직 저장 중이에요…`) and leaving the page asks first (`beforeunload`). The answer's month is taken once no other write is on its way; `res.trimmed` / `res.closed` show in a second snack. A refusal undoes the change, reopens the editor with what was typed (`저장하지 못했어요: …`) and reads the month again.
- **Small touches**: buttons press in slightly, a tag gives a short vibration where the phone allows it.

- **Month switcher** (‹ 2026년 11월 ›): steps one calendar month at a time, from **12 months before the oldest month with data** (`MONTHS_BACK`) up to the newest (this month). Months with no data open too (empty lists), so old 근무 can be added there with `+ 근무 직접 입력`; in a past month the editor's date starts at that month's 1st, and an empty 출근 tab says `이 달의 근무 기록이 없어요. ‘+ 근무 직접 입력’으로 적을 수 있어요.` (Before 2026-11-13 ‹ stopped at the oldest month with data.) The server never limited how early a hand-entered shift can be; `saveShift` only refuses times more than 1 h ahead (`아직 오지 않은 시간이에요. 어젯밤 근무면 날짜를 어제로 골라 주세요.`).
- **A 출근 not yet come today = yesterday's shift** (since 2026-11-26; owner: night workers writing at dawn were stuck on `아직 오지 않은 시간`). In 근무 직접 입력, while the date is today and the 출근 is more than 1 h ahead of now (the server's limit), the date moves to yesterday by itself, hint `아직 안 온 시간이라 어제 근무로 적어요: M월 D일 (요일) 출근`; changing the 출근 to a time that has come moves it back to today. Only while the date was not picked by hand and not for an existing record (`edDate`, flags `edAuto` / `edHand`); a hand-picked today with a future 출근 gets the red hint instead.
- **Pull to refresh**: at the top of the page, drag down and let go (pull past 64 px; the spinner turns green) = tap on the sync label: `refreshLive()` + `load(true)` + `checkAppUpdate()` (app only: new page code → reload into it); the spinner stays until the reload answers (at least 0.45 s). Ignored when the page is scrolled down, a bottom sheet is open, or the swipe is sideways or upward. `overscroll-behavior-y: contain` stops the browser's own pull-to-refresh (which would reload the whole page) where the page is the top-level document.
- **Tabs** (7, one row, fits 360 px): 출근 · 미등록 · 취식 · 폐기 · **저회전** · 월별 합계 · **더보기**. 출근 is first and always opens first. **전체** and **취소** are rarely used, so they sit in a small menu under **더보기** (tap → menu drops down under the tab, right-aligned; each item shows its name, a one-line hint and its count). While one of them is open, the 더보기 tab shows that view's name and count (`취소 21 ⌄`) in the selected style, and the menu marks it. The menu closes on picking an item, a tap outside, scrolling more than 12 px, or Esc.
  - 미등록 = untagged **폐기** lines (저회전 is never 미등록).
  - 취식 = every 취식 line, 폐기 and 저회전 (저회전 lines carry a green `저회전` label). 폐기 likewise includes 저회전 폐기 lines.
  - 폐기 = 폐기-tagged lines. 전체 = every 폐기-slip line. 저회전 = **only unregistered** 저회전 lines. Once registered as 취식 or 폐기 a line moves to that tab (green `저회전` label); **[취소]** there makes it untagged again, so it comes back to 저회전 (the row keeps 전표 `저회전`). One-line explanation on top and **[취식] [폐기]** per line. The tab count leaves registered lines out, and there is no name filter (nobody owns an unregistered line). The snack says `· 취식 탭으로 옮겼어요` / `· 폐기 탭으로 옮겼어요` / `· 저회전 탭으로 돌아갔어요`.
  - 취소 = BGF cancel lines (both kinds; 저회전 ones say so).
- In the 취식 / 폐기 tabs each line's right button is **취소** (removes that tag) and the left one switches to the other type. Lines tagged by another worker have disabled buttons.
- **금액합계** card on top of the **미등록** and **취식** tabs only: 수량 and 원가 total of the lines shown (follows the name filter and the search). On 취식 it also lists each person's 수량 · 원가 (largest first, all lines look the same) when more than one person is shown. Other tabs have no card. On these two tabs the card and the name filter sit at the bottom of the sticky bar (`#pin`), so they stay on screen while scrolling; on other tabs the name filter is above the list as before.
- **Header.** Two parts: `.hdr` (title + month, 나: 이름 + sync label, 이번 달 취식 / 폐기) scrolls away with the page; `.top` (tab bar, search, `#pin`) sticks to the top. It slides away while scrolling down and glides back on a slight scroll up (like Chrome's toolbar / Material's enter-always app bar): after it sticks it stays for one more bar height of scrolling; past that it moves with the content pixel for pixel (inline `transform`, no transition): up and away while scrolling down, back down while scrolling up. When scrolling stops (120 ms without a scroll event) with the bar part way, it glides the rest: back in if the last move was 5 px or more up, else to the nearer end. The glide takes 220–450 ms depending on the distance left, on a gentle ease-in-out curve (`cubic-bezier(.4, 0, .2, 1)`). Never hidden above that point, while the search box has focus or while a sheet is open; tapping a tab scrolls to the top, so it shows. This keeps the stuck part short at 360 px (취식 with 모두 ≈ 260 px, 미등록 ≈ 170 px, 출근 ≈ 70 px). The safe-area top padding is on `.hdr`, so if the app ever goes edge-to-edge the stuck `.top` would need it too.
- Name filter (모두 + names that have something in that tab this month) on every tab except 미등록 and 취소. (일) is red and (토) blue in day headings.
- Header "이번 달 취식 / 폐기" and the 월별 합계 table count 저회전 취식 / 폐기 as 취식 / 폐기; its footer shows only 미등록 **폐기**.
- 월별 합계 tab shows every column at once (fits a 360 px phone). A small ghost button at the right end of the per-person table's title line (`.fchip`: no border or fill, text color, 16 px line funnel icon · current view in 14 px semibold · chevron-down, 6 px apart, 30 px tall, faint background on hover / press / open, chevron turns up while open, tap area padded) opens a small menu right under it (`.moremenu.fmenu`, `menuitemradio` items with a check on the current one; keyboard focus = inset 2 px ring (`outline-offset: -2px`, never outside: it spills past the menu edge) + light background on an unchecked item; closes on a pick, a tap outside, a scroll or Esc; ↑ ↓ move inside) that picks the view, remembered per phone for all stores in localStorage `chwisik.sumView` (`eat` / `all`; anything else = `eat`): **취식** (default) = title `직원별 취식`, 직원 · 취식 수량 · 취식 원가, only people with some 취식, sorted by 취식 원가 most first (then 폐기 + 취식 원가, then name); **폐기 + 취식** = title `직원별 폐기 / 취식`, 직원 · 폐기 수량 · 폐기 원가 · 취식 수량 · 취식 원가 (취식 on the right), everyone, sorted by 폐기 원가 + 취식 원가 (then 취식 원가, then name), note with 미등록 폐기. Both: no 매가, the 취식 원가 합계 is red, this store only. Switching redraws only that table. **Every column header of every 월별 합계 table sorts** (`table(…, sort)`; a `<button class="sortbtn">` inside each `th`, `aria-sort` on the sorted one): a 9 px triangle after the label, at 60 % of the header color unless it is the sort column (then full text color), down = descending, turned up = ascending. First tap: descending (직원: ascending, Korean order); same header again: reversed; the 합계 row stays at the bottom; values compare as numbers (`keys` per row), names as text. Defaults: 직원별 취식 = 취식 원가 ↓, 직원별 폐기 / 취식 = 폐기 + 취식 원가 ↓ (no column of its own, so no triangle is lit), 근무 시간 = 근무 시간 ↓; the default keeps the old tie-break order. The choice is kept per phone in localStorage `chwisik.sumSort` (`{people|hours: {h: header, d: "asc"|"desc"}}`; broken or missing = default); switching the 직원별 view keeps it only if that column exists in the new view, else it is cleared. Numeric headers have 2 px left / 9 px right padding and a 1 px gap so the 5-column table still fits 328 px. Below it, **근무 시간** = 직원 · 근무일 · 근무 시간. Names are full names only.
  - **A closed month shows its 월별 마감 numbers** (`S.closed`), not a sum of the lines, and the note ends with `· M월 D일 마감한 숫자예요 (그 뒤로는 안 바뀌어요)`. The name filter still picks one person's row. The current month is never closed, so the header's 이번 달 취식 / 폐기 is always live.
  - **근무 시간 is summed per person over all stores** (owner, 2026-11-16: the same person can work in 2 or 3 stores). Same full name = same person. The table lists everyone who worked in any store that month; 근무일 counts a day once even if worked in two stores; a person with hours outside this store has a small line under the name (`둘리점 10시간 · 두왕점 6시간`). When other stores add hours the note says `여러 점포에서 일한 시간을 사람별로 합쳤어요`. Shifts without 퇴근 are left out in every store (counted in the note).
  - **근무 시간 filter** (owner, 2026-11-20: "set filters so one can see the current store's 시간 and total 시간 (all stores included. this case is default)"): when 2+ stores are on (`S.others` not empty), the 근무 시간 title line carries the same `.fchip` chip + menu as the 직원별 table, with **모든 점포** (default: the all-store total above) and **the current store's short name** (e.g. `둘리점`: only this store's shifts, no per-store lines, note ends `· 둘리점에서 일한 시간만`). Remembered per phone in localStorage `chwisik.hoursView` (`all` / `here`; anything else = `all`); with one store there is no chip and the title says `(모든 점포)` only if other stores added hours (never, then). Only one of the two menus is open at a time: tapping the other chip closes the first and opens its own.
- Off-shift 폐기 check runs in the page: the line's 생성시각 must fall inside one of the worker's shifts, 30 min grace either side; an open shift counts up to now. Lines with only a date pass if any shift touches that day. Each line shows who was working then (`근무 지은`).
- **Empty-time warning (출근 tab)**: for each past day of the month, from the first recorded day to yesterday, the page joins everyone's shifts (including overnight ones from the day before) over 00:00–24:00 and lists gaps ≥ 15 min. The store is treated as **open 24 h**. A shift without 퇴근 from a past day counts as unknown. Each gap has **내가 근무했어요**, which opens 근무 직접 입력 prefilled. Hidden while a name filter is on.
- 출근 timeline bars: overlap with 2 people = yellow, 3+ = red, with "겹침 N분". **One row per shift** (not merged per person). Overnight shifts also show on the next day as their own row `00:00 – 퇴근` (`전날 N`, sub line `전날 HH:mm 출근`); on the start day such a shift shows only its part, `22:30 – 24:00 · 당일 N`, when the next day's row is shown (next day in this month and not in the future), else `22:30 – 08:00 (+1)`. A shift still running past midnight shows `22:30 – 24:00` (done) on its start day and `00:00 – · 근무 중 · 전날 N` (time since 00:00) on today's row. Rows in a day are sorted by start, latest on top, a carried-over shift counting as 00:00; from the bottom: 야간 (carry-over) → 오전 → 오후 → 야간 (tonight). Ties: later end on top. Your own rows are a button that opens the editor.

## App (Android, and the installable page)

Why: the `/exec` link is slow to open (Google's wrapper page, two iframes, then the API calls), shows the "created by a Google Apps Script user" banner, and on some phones Google asks to sign in. The app runs the same page **directly**, without Google's page, and talks to the server through the JSON API.

- **One page for both.** `app/www/index.html` is a small loader. It takes the newest page the server gave last time (localStorage `chwisik.page` = `{hash, html}`), else the copy shipped in the app (`www/page.html`, copied from `apps-script/Index.html` by `app/build.mjs` at build time), adds `window.CHWISIK_API` / `CHWISIK_PAGE_HASH` and the viewport meta, drops `<base>`, and `document.write`s it.
- **Self-update.** The Android app and installed web page ask `getPage(hash)` on start, when returning to the foreground, on reconnect, every minute while visible, and on a pull or sync tap. A new page waits while the app is hidden, a form is open, search has focus, an undo is available, or a staff write is in flight. The app retries applying it every five seconds. Once safe, it stores the page for the loader and reloads automatically. A storage failure keeps the current screen running. On a page from before this fix, pull down or tap sync once to get it. Page deployments do not need a new APK. The separate Google-hosted `/exec` browser link uses the browser's own reload.
- **Safety net.** The loader sets `chwisik.pageTry = hash` before running a downloaded page; the page clears it as soon as its script starts. If it is still set next launch, that page broke: the loader drops it and runs the shipped copy (which then downloads the newest page again).
- **Android build** (`.github/workflows/android.yml`, on push to `app/**` or by hand): `npm ci` → `build.mjs` → `npx cap add android` (project generated fresh each time, not committed) → our icons/splash from `app/android-res/` (Capacitor's logo files removed) → `versionCode` = run number → **targetSdk 34** (Android 15 forces edge-to-edge for target 35, which would put the page under the status bar) → `assembleRelease` + zipalign + apksigner with the key from secrets → GitHub Releases: a versioned release **android-1.<run>** (kept as history) and **android-latest** (always the newest; `chwisik.apk`), plus a workflow artifact. Owner's rule: every app build is published to Releases. Without the secrets it builds a **debug** APK and warns: a phone with the debug build must uninstall it before a release-signed one installs.
- **Signing key**: PKCS12, alias `chwisik`, made 2026-11-09 with openssl, kept in `C:\Users\kiiwo\chwisik-android-key\` (README there). Lose it and phones must uninstall and reinstall to get a new build.
- **Installing**: the repo is public since 2026-11-25, so the APK link works for anyone: `https://github.com/kiiwoom8/chwisik/releases/download/android-latest/chwisik.apk` (send it in KakaoTalk; the owner used to download the file and send it); staff allow "install unknown apps" once. App id `com.kiiwoom8.chwisik`, name 취식.
- **iPhone app (TestFlight)** (owner, 2026-11-25: "manually setting them to add 홈화면 in ios sucks … app would be the most convenient"): the same Capacitor shell as Android, built by `.github/workflows/ios.yml` on a GitHub macOS runner (`macos-26`, free because the repo is public). App id `com.kiiwoom8.chwisik`, name 취식, iPhone only (`TARGETED_DEVICE_FAMILY=1`), version 1.0 (build = run number), `ITSAppUsesNonExemptEncryption = false`, icon + launch screen from `app/ios-res/` (`make-icons.py`).
  - **Needs the owner's Apple Developer Program membership** (₩129,000 / year in Korea, checked 2026-11-25; approval 24–48 h) and four repo secrets: `ASC_KEY_P8` (the App Store Connect API key file's text, role Admin, so CI can make the signing certificate and profile itself), `ASC_KEY_ID`, `ASC_ISSUER_ID`, `APPLE_TEAM_ID`. Plus an app record in App Store Connect for the bundle id.
  - With the secrets: archive with automatic signing (`-allowProvisioningUpdates` + API key) → export with `destination upload` → TestFlight → release `ios-1.<run>`. Without them: a simulator build only (a check that it compiles), with a warning; nothing uploaded or released.
  - Staff install: the TestFlight app, then the public link (repo variable `TESTFLIGHT_URL`; `ios-latest` and `ios-1.<run>` show it). The first build needs Apple's Beta App Review (give the reviewer a test Google account allowed ahead of time in menu 접근 계정); later builds usually don't. Builds stop opening 90 days after upload, so `ios.yml` also runs on the 1st of every month.
  - Inside the app the page runs edge to edge (Capacitor's `contentInset` never), so `.top` sticks at `env(safe-area-inset-top)` and `body::before` covers the status bar area (both 0 everywhere else).
  - Not verified until the first signed run: signing, upload, the WKWebView talking to the server (CORS from `capacitor://localhost`; the Android WebView works the same way). The unsigned build is checked on every push.
- **iPhone without paying (the current way)** (owner, 2026-11-25: "find another way of not paying money"): there is no free real app (free sideloading needs a computer and expires every 7 days; a Web Clip profile is more taps with an "unverified" warning), so the home-screen page is made as short as possible:
  - Staff tap the link in KakaoTalk → it opens in Safari (loader) → Google sign-in (*Access*) → a step card (`iosHint`, `#iosBar`): 주소창 옆 ⋯ (iOS 27: ≡; iOS 18: the 공유 button below) → 공유 → 홈 화면에 추가 → 웹 앱으로 열기 on → 추가. (The Korean label of "Open as Web App" is my reading; check on a phone.)
  - **No second sign-in**: `manifest.webmanifest` has no `start_url`, so 홈 화면에 추가 saves the address on screen, and in iPhone Safari the page keeps that address at `?k=<device key>&store=<id>&me=<name>` (`installUrl()`: at start, after sign-in, after picking a name). The home-screen app's first start (`takeInstallUrl`) stores key, store and name if it has none, then cleans the address. Anywhere else (not iPhone Safari) these parameters are only read and removed. Anyone given that Safari address gets in as that account; cutting the account (or 모든 폰 다시 로그인) stops it like every key.
- **iPhone without the app**: staff can also use the installable page `app/www` on the home screen: Safari → 공유 (iOS 26: ⋯ → 공유) → 홈 화면에 추가 gives a 취식 icon that opens full screen, without Google's banner, and updates itself like the Android app.
  - **Host**: GitHub Pages, `https://kiiwoom8.github.io/chwisik/`, built by `.github/workflows/pages.yml` on push to `app/www/**`, `app/build.mjs` or `apps-script/Index.html` (`node app/build.mjs` → upload `app/www` → deploy-pages). Live since 2026-11-25 (repo made public that day for this; free Pages needs a public repo; Settings → Pages → Source = *GitHub Actions*). If the repo ever goes private again the job is skipped and the site stops updating.
  - **Home-screen tags**: the loader `document.write`s the staff page over its own head, so `show()` writes the manifest, apple-touch-icon, `apple-mobile-web-app-*` and light/dark `theme-color` tags into the new head too; without them Safari's 홈 화면에 추가 saw none (screenshot icon, opened in Safari on iOS before 26).
  - **KakaoTalk**: its in-app browser can't add to the home screen; the loader sends the same address to the phone's browser (`kakaotalk://web/openExternal?url=…`). Staff get the link in KakaoTalk, so this is the usual path.
  - **Install bar** (`iosHint` in Index.html, `#iosBar`): on an iPhone/iPad, not standalone, not the Android app: the hosted copy shows `앱으로 쓰기: 공유 → 홈 화면에 추가 (공유가 안 보이면 ⋯ 안에)`; the `/exec` page shows `아이폰에서는 앱처럼 쓸 수 있어요. 설치하기` linking to `WEB_APP?store=<this store>` (`WEB_APP` = `https://kiiwoom8.github.io/chwisik/`; empty would hide the bar). × hides it on that phone for good (`chwisik.iosHint` = `off`).
  - **One address** (owner, 2026-11-25: "combine 2 urls into one"): `doGet` without `?stay=1` serves `Move.html` (주소가 바뀌었어요 + [새 주소로 열기]). It reads the old address's localStorage (`chwisik.store`, `chwisik.me[.<id>]`; not sign-in tokens, so a password holder enters it once more), and sends the top window to `WEB_APP_URL?store=…#move=<json>`; Google's sandboxed frame may need the tap. The loader copies `#move` keys it doesn't have yet into its own storage and removes the hash.
  - **Service worker** (`sw.js`, `chwisik-v3`): the page itself is network first, so a pushed loader is used on the next open; offline (or a network slower than 4 s) it opens from the stored copy. Until v3 it was cache-first, and with GitHub Pages' `max-age=600` a phone saw a new loader only two opens and 10 min later.
  - The home-screen copy has its own storage (not Safari's): staff pick the store and their name once more there. Home-screen apps keep their localStorage (no 7-day Safari limit).
- **Testing without a phone**: copy `app/www` (after `node app/build.mjs`) to a scratch folder, point `API` in its `index.html` at a small local server that answers POST with fake `{ok, r}` JSON, open it at 375 px. Done 2026-11-09: boot, name picker, tabs, cache-first start all worked.

## Live import (오늘 폐기·저회전)

- **Per store.** `refreshNow()` (page, every 1 min while visible, for the page's store) and `liveTick()` (5-min trigger) go through the same gate (`liveGate_`): the store's `LIVE_AT` must be ≥ `LIVE_MIN_GAP_S` = 50 s old, and a 90 s cache flag stops two runs at once. So each store's BGF account is read **at most once per 50 s**, and only while someone has that store's page open. The trigger reads **one store per run**, the one read longest ago: every 5 min with one store, every 10 min each with two. That keeps the trigger's daily runtime where it was (see Load). A store without a 전산 password is skipped. Each run also does the 자동 퇴근 catch-up for every store. A new BGF slip shows on the page within about 1 min while it is open (plus the 5 s data poll on other phones).
- **Kept login** (`liveFetch_`): the BGF cookie jar is kept in CacheService (`bgf_session|<id>`, one per store) and reused for up to `BGF_SESSION_MIN` = 60 min after its login, so most runs skip the login (fewer BGF logins than the old 2-min pace). A kept session is only trusted when it answers cleanly: if it throws, returns no slips at all for yesterday..today, or the 저회전 list fails, the run logs in fresh and reads again, so an expired session can't hide slips. Not confirmed yet how BGF answers an expired session (the fallback covers both an error and an empty answer). Delete the cache by waiting 60 min, or change `BGF_SESSION_MIN` to 0 to log in every run.
- **A new store starts from yesterday.** Nothing older is imported by itself (it would arrive as a pile of 미등록); the owner brings past days in with the menu's 기간 지정해서 가져오기.
- **Past days (first store)**: the live import only reads yesterday..today, so on its own it would never fill 저회전 for days before 저회전 import existed (2026-11-09: only 11/8 came in). After a successful live run, `jeoBackfill_` imports 저회전 once for the whole range from the earliest 일자 in 폐기목록 to today, reusing the same login, then sets `JEO_BACKFILL=1`. The log row says `(저회전 지난 날짜)`. Any new slip kind added later needs the same kind of backfill.
- One run = login (unless kept) + 폐기 list + 저회전 list (+ the S312 lookup once, until `JEO_DIV` is cached) + detail calls **only for slips not fully in the sheet** (`knownChits_()` counts lines per 전표번호 and compares with `ITEM_CNT`). The nightly import re-reads every slip as a safety net.
- `LIVE_OK_AT` = start of the last successful run → the page header shows "업데이트 21:31 ↻" (another day: "업데이트 11/8 21:31 ↻"). The whole label is one round button (text + ↻ icon); tapping it = pull to refresh; the icon spins during `정보 가져오는 중…`, is green when connected and red when not. `LIVE_ERR` holds the last error; only the first failure of a streak goes to 가져오기 기록, and live failures don't email (the nightly one does).
- Load: 288 trigger runs/day × 2–8 s ≈ 10–40 min of the 90 min/day trigger quota (page calls don't count against it). With the page open all day: ≤ 1,700 runs × ~3–5 fetches ≈ 5–8k UrlFetch/day, under the 20k limit. (Measured 2026-11-10: a live run ≈ 6–8 s with login, a gated no-op call ≈ 2 s.) Don't make the trigger every 1 min: 1,440 runs would pass the 90 min quota.
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
   Ready-made: `python tests/page-stub.py apps-script/Index.html <dir>/index.html` writes such a copy (two stores of made-up data; `?delay=`, `?fail=`, `?store=`, `?gs=1`, see the file's top).
3. Server code: `node tests/server.test.js` runs `Code.gs` against a mock of SpreadsheetApp / PropertiesService / CacheService / UrlFetchApp (a fake BGF) and checks the store plumbing, the caches, imports and passwords. It can't prove what the real BGF or the real Apps Script quotas do: after the push, watch the Actions run, then the 가져오기 기록 sheet and the page.
4. JSON API after a deploy: `curl -sL -H 'Content-Type: text/plain' -d '{"fn":"getInit","args":["",""],"store":"31949"}' <exec URL>` must print `{"ok":true,…}` (leave `store` out for the first store).

## Operations

- **Password changed at BGF** → menu 취식 관리 → BGF 점포시스템 비밀번호 입력 · that store.
- **New store's lists stay empty (`전산 연결 전`)** → its BGF password was never entered: same menu item.
- **A worker works in two stores** → they add the same full name in each store (이름 바꾸기 → 추가); 근무 시간 is then one total. A different spelling = a different person.
- **Missed days** → 기간 지정해서 가져오기 (safe to repeat; dedupes by key).
- **저회전 not coming in** → check 가져오기 기록 for `저회전 실패: …`; delete Script Property `JEO_DIV` to redo the S312 lookup; check that `CHIT_ID` is still `24` on the site.
- **저회전 missing for older days** → menu 저회전 지난 날짜 모두 가져오기 (or 기간 지정해서 가져오기 for a specific range).
- **After code changes** → commit and push to `main`. GitHub Actions deploys it. The `/exec` URL stays the same.
- **Code got deleted in the editor** → restore from `apps-script/` in this repo (push again or run the workflow by hand).
- **A wrong tag by another worker** → owner clears columns M–P of that row in 폐기목록.
- **Data ruined or deleted** (someone emptied sheets, deleted the 직원 list, wiped tags) → menu 취식 관리 → 백업에서 되살리기, pick the last good backup (empty = all sheets). If the whole spreadsheet file is gone: open the newest `직원 취식 목록 백업 · …` file in Drive (or restore the original from Drive's 휴지통 within 30 days). One bad edit only → 파일 → 버전 기록 in the spreadsheet.

## Known limits / gotchas

- Names without a password are open: anyone can tag or clock in under them. With a password, only phones that entered it (or the developer password) can.
- The off-shift warning is advisory: the worker can still save; the row is marked `근무외`. It only runs for lines from before today.
- A line is tagged as a whole. Quantity 3 cannot yet be split into 1 취식 + 2 폐기.
- The JSON API is as open as the link: anyone can POST the same public functions. Nothing new is exposed (they were all callable through `google.script.run` already).
- The public link has no Google login. Anyone with it can tag lines under password-less names or add a name. 등록시각 is the audit trail.
- The 월별 합계 sheet counts tagged lines that BGF later canceled; the page doesn't.
- Apps Script web apps show a "created by a Google Apps Script user" banner on the `/exec` link. It can't be removed there; the app doesn't have it.
- The page runs two iframes deep inside Google's `/exec` page, whose own background is white and can't be styled (`addMetaTag` takes only a few names; no `theme-color`). Keep the viewport meta without `viewport-fit=cover`: with it, phones draw the page under the bottom system bar, outside our frame, and Google's white shows there as a strip. `env(safe-area-inset-*)` in the CSS is harmless (0 inside the frame).
- In Claude's Chrome tab group, the web app's inner frame sometimes stayed blank (extension-side issue). Normal Chrome tabs and phones work.
- The BGF site page can freeze Chrome's screenshot tool (CDP timeout); use `javascript_tool` to read it instead.
- Apps Script quotas (consumer account): UrlFetch 20k/day, total trigger runtime 90 min/day. This project uses a small fraction. More stores don't add trigger runtime (one store per tick), but each open page adds its own store's reads.
- CacheService values are 100 KB at most; a month's answer is cut into pieces (`bigPut_`). If a piece is evicted the answer is simply read from the sheets again.
- Inside a lock don't call `storeSheets_` / `inStore_` for a store whose sheets might be missing: it takes the script lock itself and its release would end yours. (Requests make the sheets before any lock: `useStore_`.)
- The page must never `location.reload()` on the `/exec` link (Google's frame comes back blank). Switching store is done in place (`setStore`).

## History

Full change log with reasons: `docs/HISTORY.md`.
