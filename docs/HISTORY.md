# History — 직원 취식 목록

Every change in order, newest last, with the reason behind it. Add an entry with every change (see `CLAUDE.md`). Commit ids are short hashes on `main`; the newest entry may not have one yet (see `git log`).

Times are KST.

## Before the repo

- **2026-11-04 — one-off October split.** The October 폐기 list was copied into Excel Online, then turned into a shared "tap to remove" page (first a Claude artifact, then an Apps Script web app on a sheet named **10월 폐기 정리**) so 4 people could split the items. This showed the need for a permanent tool and for automating the BGF download.

## 2026-11-08

- **23:03 `ef62541` — initial commit.** `Code.gs`: BGF login (Nexacro SSV protocol reverse-engineered from the browser), nightly 폐기 import into 폐기목록, sheet setup, web app API. `Index.html`: staff page with one-tap 취식 / 폐기 and monthly totals. Docs: DEVNOTES, ROADMAP, CLAUDE.md (always push to `main`). `.githooks/post-commit` auto-pushes `main`.
  - Why: replace the monthly manual copy of 폐기 slips and the ad-hoc split page.
  - Decisions: Google Sheets + Apps Script so it runs with the owner's computer off and costs nothing; the staff link has no login (the store's phones are shared); 취식 records the full name, 폐기 only the first name (how the store writes it).
  - Verified: 11/1–11/8 import = 103 slips / 225 lines, same as the site.
- **23:05 `1aae58f`** — `.gitattributes`: LF endings, `.gs` shown as JavaScript.
- **23:10 `ddda78e` — auto-deploy.** `.clasp.json` + `.github/workflows/deploy.yml`: on push to `main`, syntax check → `clasp push` → `clasp deploy` onto the existing web app deployment, so the `/exec` link never changes. Why: GitHub becomes the source of truth; no hand edits in the Apps Script editor.
- **23:18 `7432842`** — `appsscript.json` pulled from the live project (Asia/Seoul, V8, execute as owner, `ANYONE_ANONYMOUS`); CLAUDE.md "push = live"; DEVNOTES auto-deploy section (secret `CLASPRC_JSON`, renewal steps).
- **23:56 `2433f3d` — 출근일지, off-shift warning, live import.**
  - 출근일지 sheet; [출근]/[퇴근] or manual entry (overnight allowed); everyone's shifts by day; monthly hours.
  - 폐기 on a line outside the worker's recorded shift (±30 min) asks first and is saved with `근무외` (column R). Why: 폐기 should be registered by whoever was working when the slip was made.
  - Live import: today's 폐기 on page open, every 3 min while open, and every 10 min by trigger; at most one BGF login per 2 min; details only for new slips. Header shows "폐기 HH:mm까지". Why: staff tag items the same day, not the next morning.
  - Each line shows who was working at its time.

## 2026-11-09

- **00:26 `7b333c1` — 출근 first, filters, passwords, usual times, empty-time warning.**
  - 출근 tab first and default. Name filter (모두 + names). (일) red / (토) blue.
  - Optional password per name: salted hash in 직원 column D, token per phone, every write checks it, 5 wrong tries lock for 10 min; developer password in the menu opens any name. Why: stop people tagging under someone else's name, without forcing logins on everyone.
  - 근무 직접 입력 prefilled with the worker's most frequent shift (90 days).
  - Past days list gaps nobody recorded (store open 24 h) with "내가 근무했어요".
- **00:37 `5b2cd6c`** — 출근 timeline: overlapping time colored (2 people yellow, 3+ red) with "겹침" duration.
- **00:44 `473923e`** — overnight shifts (e.g. 22:30–08:00) now also show on the next day as `00:00 – 퇴근`; before, the morning part was invisible.
- **01:01 `8df6a04` — BGF cancels + security.**
  - A negative 폐기 line cancels the newest earlier line(s) of the same product (untagged first, partial allowed); both leave the lists and totals; new 취소 tab lists them. Why: BGF corrects mistakes with negative slips, which looked like extra items to tag.
  - 취식 / 폐기 tabs: right button = 취소, left = switch type.
  - Locked down public functions: `setup`, trigger installers, `importThisMonth` need the owner; `nightly` / `liveTick` accept only their own trigger; `importRange_`, `installLiveTrigger_` made private. Why: every non-`_` function is callable from the public link.
- **01:03 `762e845`** — `setTag` writes only the actor's own name and refuses rows another worker tagged; the page greys those buttons out. Why: closes a way to overwrite or clear someone else's tag.
- **01:08 `c33e880`** — 취소 tab: the "no earlier 폐기" note is colored so it stands out.
- **01:39 `e59472e` — 저회전상품철수 import + 저회전 tab; docs overhaul.**
  - The owner asked to pull **통합전표 조회 → 저회전상품철수** slips the same way as 폐기, show them in a new tab right after 취소, allow **취식 only** (never 폐기), and not require every line to be tagged.
  - BGF facts found in the site's static form scripts (no login): the detail popup `GJ/STGJ020_P1.xfdl.js` names CHIT_ID `24` "저회전상품철수전표" and handles it exactly like `04` (폐기): `searchDetailType1` / `dsListType1`. The list screen fills its 전표구분 dropdown from common code `S312` via `/stco010/selComCd`.
  - Server: 폐기목록 gets column S `전표` (`''` = 폐기, `저회전`), added to old sheets by `itemsSheet_()`. `fetchPyegi_` became `fetchAll_` + `fetchSlips_`: one login, 폐기 then 저회전. The 저회전 search code is looked up from S312 by name (`jeoDiv_`, cached in `JEO_DIV`), falling back to 전체; slips are always filtered to CHIT_ID 24. A 저회전 failure never blocks 폐기 (`jeoErr`, logged once per streak via `JEO_ERR`). `appendItems_` also dedupes within one batch. `cancelMatch_` keeps the two kinds apart. `setTag` refuses 폐기 on a 저회전 row. Menu labels say 폐기·저회전.
  - Page: 8th tab **저회전** (after 취소) with an explanation line and a single [취식] button per line; 미등록 and the 월별 합계 미등록 footer ignore 저회전; 전체 shows 폐기 lines only; 취식 tab and my totals include 저회전 취식 (green `저회전` label); 취소 tab labels 저회전 cancels. Tab text shrinks under 380 px so 8 tabs fit at 360 px (checked with a mock page).
  - Not tested against the live BGF site (Claude may not enter the BGF password). First check after deploy: 가져오기 기록 shows `저회전 N장` or `저회전 실패: …`.
  - Docs: DEVNOTES rewritten in detail (Script Properties table, BGF code systems, page behavior, how to check changes, two stale statements about other workers' tags fixed); new `docs/CODEMAP.md` (function map, flows, recipes) and this `docs/HISTORY.md`; CLAUDE.md now requires updating the docs with every change.
  - Result: deployed fine; the first live run (01:40) logged `저회전 4장` — the BGF path works.
- **01:45 `a9e5674` — 저회전 one-time backfill.**
  - Problem (reported by the owner): 저회전 showed only 11/8. The live import reads only yesterday..today, so 11/1–11/7 저회전 slips were never requested (폐기 had the same gap and was filled by the one-off 11/1–11/8 import on 11/8).
  - Fix: `jeoBackfill_` runs once after a successful live import: 저회전 from the earliest 일자 in 폐기목록 to today, reusing that run's login (`fetchAll_` now returns its session). Sets `JEO_BACKFILL=1` on success; a failure is logged and retried at most hourly. New menu item 저회전 지난 날짜 모두 가져오기 runs it on demand.
  - Lesson (in CODEMAP recipe): any new slip kind needs a backfill for past days.
  - Result: ran at 01:48 on the first live tick after deploy: `20261101~20261109 (저회전 지난 날짜)`, 27 slips, 40 new lines. 폐기목록 now has 저회전 lines on every day 11/1–11/8 (44 lines in all).
- **저회전 tab: [취소] on registered lines.** The owner asked for the 저회전 tab to work like the 취식 / 폐기 tabs: a registered line's button now reads **취소** (grey undo style) instead of a highlighted 취식; unregistered lines still show **취식**. Page only (`rowEl`); checked on the mock page at 360 px.
