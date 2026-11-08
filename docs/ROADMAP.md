# Roadmap — 직원 취식 목록

The `/exec` web link stays the main way in. Apps for workers come next and use **the same backend**, so the link and the apps always show the same data.

## Phase 1 — Worker app (next)

Goal: staff get an app icon on their phone that opens straight to the list, with notifications.

1. **Installable web app (PWA) first.** Fastest and cheapest.
   - Host a small static shell (GitHub Pages from this repo, `app/` folder) with a manifest, an icon, and a service worker.
   - The shell talks to the Apps Script backend through a JSON endpoint (`doPost` / `doGet?api=…` returning `ContentService` JSON), instead of `google.script.run`. This also removes the Google banner and iframe.
   - "홈 화면에 추가" on Android and iOS gives an app icon.
2. **Store apps (Android first, then iOS)**, if a PWA isn't enough.
   - Wrap the same shell with **Capacitor** (or a Trusted Web Activity on Android) so there is one codebase.
   - Distribute on Android as an APK or through the Play internal-testing track. iOS needs TestFlight and an Apple developer account.
3. **Push notifications.** After the nightly import: "어제 폐기 23건이 올라왔어요. 등록해 주세요." Use Firebase Cloud Messaging, called from Apps Script with UrlFetch.

## Phase 2 — Features staff asked for or will likely need

- **Split quantity**: a line with qty 3 can be 1 취식 + 2 폐기, possibly by different people.
- **Light identity**: a 4-digit PIN per staff member, so others can't tag in their name. Keep it optional so the link stays one tap.
- **Admin view**: lock a month once settled, export the month (CSV / Excel), and correct tags made by mistake.
- **Monthly report** emailed or messaged to the owner on the 1st: totals per person, 취식 원가/매가.
- **Reminders**: on the morning after import, show staff how many items are still 미등록.
- **History filters**: by person, by product, by day.

## Phase 3 — Engineering

- **clasp + GitHub Actions**: on push to `main`, `clasp push` the `apps-script/` folder and create a new deployment version automatically. That makes GitHub → Apps Script fully automatic. It needs the owner's clasp credentials stored as a GitHub secret (`CLASPRC_JSON`) and the script id in `.clasp.json`.
- Also commit `appsscript.json` (manifest: timezone Asia/Seoul, scopes, web app settings).
- **Storage**: Sheets is fine up to tens of thousands of rows. If it gets slow, move items to Firestore or Supabase and keep the sheet as a monthly export.
- **Multi-store**: store code and `SS_*` variables in config, so other stores can use the same app.
- **Health check**: if the nightly import fails 2 nights in a row, send a stronger alert (KakaoTalk / SMS).
