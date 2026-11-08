# 직원 취식 목록 (chwisik)

Staff meal (취식) and waste (폐기) tracker for CU store 25377.

- 폐기 and 저회전상품철수 slips are pulled from the BGF 점포시스템 into a Google Sheet automatically: every night around 00:01, and during the day every few minutes.
- Staff open one link on their phone (no Google login), pick their name once, and tap **취식** or **폐기** on each item. 저회전 items have their own tab and can only be 취식 (tagging them is optional).
- 출근일지: staff clock in/out; the page warns about 폐기 outside one's shift and about hours nobody recorded.
- Monthly totals per person (items and hours) are shown in the app and in the sheet.

**Staff link:** https://script.google.com/macros/s/AKfycbzmsekRKq8HY5jqog-Dpb80yJqv-n3H4fZMItLZPISuM39M6RVyr3qOtqtz864YwlRKpw/exec

| Folder | Contents |
|---|---|
| `apps-script/` | `Code.gs` (server, BGF import, API) and `Index.html` (staff page) |
| `docs/DEVNOTES.md` | how it works, BGF protocol, sheets, Script Properties, API, operations, troubleshooting |
| `docs/CODEMAP.md` | where each function is and what it does, data flows, how to make common changes |
| `docs/HISTORY.md` | every change, with reasons |
| `docs/ROADMAP.md` | worker app and future plans |
| `CLAUDE.md` | working rules: always push to `main`, push = live, update docs with every change |

After cloning: `scripts/setup-hooks.sh` (turns on auto-push after every commit).
