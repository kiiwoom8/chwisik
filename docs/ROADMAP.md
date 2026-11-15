# Roadmap — 직원 취식 목록

The `/exec` web link stays the main way in. Apps for workers come next and use **the same backend**, so the link and the apps always show the same data.

## Phase 1 — Worker app (next)

Goal: staff get an app icon on their phone that opens straight to the list, with notifications.

0. ~~**Android app**~~ Done 2026-11-09: Capacitor shell in `app/`, APK on release android-latest, self-updating page, JSON API (`doPost`). Next: set the signing secrets, try it on staff phones, maybe Play internal testing.
1. **Installable web app (PWA)** — files ready in `app/www` (manifest, service worker, icons); JSON endpoint done (`doPost`). Left: host it on HTTPS (needs a public repo for GitHub Pages, or Cloudflare Pages / Netlify) so iPhones can 홈 화면에 추가.
   - Host a small static shell (GitHub Pages from this repo, `app/` folder) with a manifest, an icon, and a service worker.
   - The shell talks to the Apps Script backend through a JSON endpoint (`doPost` / `doGet?api=…` returning `ContentService` JSON), instead of `google.script.run`. This also removes the Google banner and iframe.
   - "홈 화면에 추가" on Android and iOS gives an app icon.
2. **Store apps (Android first, then iOS)**, if a PWA isn't enough.
   - Wrap the same shell with **Capacitor** (or a Trusted Web Activity on Android) so there is one codebase.
   - Distribute on Android as an APK or through the Play internal-testing track. iOS needs TestFlight and an Apple developer account.
3. **Push notifications.** After the nightly import: "어제 폐기 23건이 올라왔어요. 등록해 주세요." Use Firebase Cloud Messaging, called from Apps Script with UrlFetch.

## Phase 2 — Features staff asked for or will likely need

- **Split quantity**: a line with qty 3 can be 1 취식 + 2 폐기, possibly by different people.
- ~~**Light identity**: a PIN per staff member~~ Done 2026-11-09 (optional password per name, developer bypass).
- Store hours setting for the empty-time warning (today it assumes 24 h).
- **Admin view**: lock a month once settled, export the month (CSV / Excel), and correct tags made by mistake.
- **Monthly report** emailed or messaged to the owner on the 1st: totals per person, 취식 원가/매가.
- **Reminders**: on the morning after import, show staff how many items are still 미등록.
- ~~출근일지 + off-shift 폐기 warning~~ Done 2026-11-08. Next: owner view to approve or fix shifts, night-hours split, export for payroll.
- ~~Live import of today's 폐기~~ Done 2026-11-08 (on open + every 10 min). ~~Keep the session cookie between runs~~ Done 2026-11-10 (with every 1 min while open, trigger every 5 min). Next: confirm how BGF answers an expired session; if BGF ever offers push or a cheaper "anything new?" call, use it.
- ~~저회전상품철수 import + 저회전 tab (취식 only)~~ Done 2026-11-09. ~~폐기 on 저회전 too~~ Done 2026-11-15. Next: confirm on the live site; maybe a 저회전 column in 월별 합계 (how much of 취식 came from 저회전).
- **History filters**: by person, by product, by day.
- ~~Faster start, a proper loading screen~~ Done 2026-11-16 (month answers kept in the cache, tab-shaped skeleton, progress bar, retry). Next, if it still feels slow: keep the previous month on the phone too; a nicer first screen in the app loader (`app/www/index.html`, needs a new APK).

## Phase 3 — Engineering

- ~~clasp + GitHub Actions auto-deploy~~ Done 2026-11-08 (see DEVNOTES → Auto-deploy).
- Alert if the deploy secret stops working (a failed Actions run already emails the repo owner by default).
- **Storage**: Sheets is fine up to tens of thousands of rows. If it gets slow, move items to Firestore or Supabase and keep the sheet as a monthly export.
- ~~**Multi-store**: store code and `SS_*` variables in config, so other stores can use the same app.~~ Done 2026-11-16 (`STORES`, CU 울산두왕점 added; see DEVNOTES → Stores). Next: confirm the 두왕점 BGF login on the live site (owner enters the password in the menu).
- **GS25 울산신정중앙점** (owner, 2026-11-16: "its 전산 is different … prepare it for the future dev (for now, not yet)"). Prepared: the store is in `STORES` with `on: false`, the chain in `CHAINS.GS25`, and everything but the import is chain-neutral. Left: capture the GS25 전산 login and 폐기 calls with the owner, write the adapter, turn it on. Steps: DEVNOTES → Stores → *Another chain (GS25)*.
- **Owner view across stores**: one screen with every store's 미등록 count and who is working now.
- ~~Run server code without Apps Script~~ Done 2026-11-16 (`tests/`). Next: run `node tests/server.test.js` in the deploy workflow before `clasp push`.
- **Health check**: if the nightly import fails 2 nights in a row, send a stronger alert (KakaoTalk / SMS).
