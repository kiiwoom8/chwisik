# 직원 취식 목록 (chwisik)

Staff meal (취식) and waste (폐기) tracker for one owner's convenience stores: **CU 울산둘리점** and **CU 울산두왕점** (GS25 울산신정중앙점 is prepared, not on yet). One page and one app; the worker picks the store once.

- 폐기 and 저회전상품철수 slips are pulled from the BGF 점포시스템 into a Google Sheet automatically: every night around 00:01, and during the day every few minutes.
- Staff open one link on their phone (no Google login), pick their name once, and tap **취식** or **폐기** on each item. 저회전 items have their own tab and can be 취식 or 폐기 (tagging them is optional).
- 출근일지: staff clock in/out; the page warns about 폐기 outside one's shift and about hours nobody recorded.
- Monthly totals per person (items and hours) are shown in the app and in the sheet. Hours are summed per person across stores.
- Each store has its own lists, staff and shift log (`docs/DEVNOTES.md` → Stores). A link can open a store directly: the staff link + `?store=31949` (두왕점).

**Android app:** GitHub → Releases → `android-latest` → `chwisik.apk` (send it to staff; the app updates its page by itself).

**iPhone app:** TestFlight (built by `.github/workflows/ios.yml`; needs the owner's Apple Developer membership and 4 secrets, see `docs/DEVNOTES.md` → App). Until then: the home-screen page (Releases → `ios-latest`).

**Access:** the Android app gets in by itself (a key built into each APK; menu 안드로이드 앱 자동 접근 turns that off). Every other phone enters the 접근 코드 once (spreadsheet menu 취식 관리 → 접근 코드 보기 gives the message to post: a link that opens straight in + the code). When someone leaves: 모든 폰 접근 끊기 + 새 접근 코드.

**Staff link (one address for everyone, phones and PC):** https://kiiwoom8.github.io/chwisik/ — iPhone: Safari → 공유 → 홈 화면에 추가 (Releases → `ios-latest` has the steps and a QR code). The old Google link (`…/exec`) now sends people there; `…/exec?stay=1` still opens the page on Google if GitHub Pages is ever down.

| Folder | Contents |
|---|---|
| `apps-script/` | `Code.gs` (server, BGF import, API) and `Index.html` (staff page) |
| `app/` | Android app (Capacitor shell) and installable page (iPhone: `https://kiiwoom8.github.io/chwisik/`, `.github/workflows/pages.yml`); APK built by `.github/workflows/android.yml` |
| `tests/` | run the server code in Node (`node tests/server.test.js`), a browser copy of the page with a fake server |
| `docs/DEVNOTES.md` | how it works, BGF protocol, sheets, Script Properties, API, operations, troubleshooting |
| `docs/CODEMAP.md` | where each function is and what it does, data flows, how to make common changes |
| `docs/HISTORY.md` | every change, with reasons |
| `docs/ROADMAP.md` | worker app and future plans |
| `CLAUDE.md` | working rules: always push to `main`, push = live, update docs with every change |

After cloning: `scripts/setup-hooks.sh` (turns on auto-push after every commit).
