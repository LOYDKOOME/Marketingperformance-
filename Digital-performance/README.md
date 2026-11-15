# Hyssop Digital Performance System v2

Three web forms, one scoring engine, one dashboard. Everything runs on your Google Sheet, so there is no separate server to maintain.

```
Employee (projection form) ─┐
Staff  (lead capture form) ─┼─► Google Sheet (system of record)
Admin  (actuals form)      ─┘        │
                                      ▼
                    Scoring engine (Code.gs, runs after every save)
                    WEEKLY_KPI_RESULTS · WEEKLY_SUMMARY · MONTHLY_KPI_RESULTS
                    MONTHLY_SCORECARD · DATA_HEALTH
                                      │
                                      ▼
                    Dashboard (app.R, Shiny) – read-only, no personal data
```

## What is in this package

| File | Purpose |
|---|---|
| `Code.gs` | Backend: three forms, validation, scoring engine, computed tabs, access control |
| `Index.html` | The three forms (one HTML file, shown by `?page=`) |
| `appsscript.json` | Time zone (Africa/Nairobi) and web app settings |
| `app.R` | Dashboard that reads the computed tabs |
| `tests/` | Automated checks of the scoring engine with hand-calculated expected values |

## 1. Set up the spreadsheet and Apps Script (about 20 minutes)

1. Open the master Google Sheet (`1z-jMr2A4bwBECrihgoZUCPdM7XYOnek2Wn0SiJSdN_8`). If you are starting from the uploaded `.xlsx`, upload it to Google Drive and open it with Google Sheets. If the ID changes, update it in `Code.gs` (`spreadsheetId`) and set `HYSSOP_SHEET_ID` for the dashboard.
2. Open **Extensions > Apps Script**.
3. Replace the contents of `Code.gs` with the supplied file.
4. Click **+ > HTML** and name it exactly `Index`. Paste the contents of `Index.html`.
5. Open **Project Settings**, tick **Show "appsscript.json" manifest file**, then paste the supplied `appsscript.json`.
6. Save. Select `setupHyssopSystem` in the function menu and click **Run**. Authorise it. This adds any missing tabs and columns. It never deletes data.
7. Go back to the spreadsheet and fill in the **CONFIG** tab:
   - `ProgramStart`: the first day of Month 1 (format `YYYY-MM-DD`). Nothing is scored until this is set. Month 2 and Month 3 follow by calendar month.
   - `AdminEmails`: the Google accounts allowed to open the actuals page (comma-separated).
   - `StaffEmails` (optional): if filled, only these accounts can use the projection and lead forms.

## 2. Publish the forms

1. **Deploy > New deployment > Web app**.
2. Execute as: **Me**.
3. Who has access: **Anyone within your organisation** (requires Google Workspace). This is what makes the admin and staff checks work. If staff use personal Gmail accounts, choose "Anyone with a Google account" and test that the admin page refuses non-admins before go-live.
4. Copy the deployment URL. Your three entry points are:
   - Weekly projection: `URL?page=weekly`
   - Lead capture: `URL?page=leads`
   - Weekly actuals (admin): `URL?page=actuals`
5. Run **Hyssop > Rebuild scorecards** once from the spreadsheet menu. Optionally, **Hyssop > Install hourly refresh** keeps the scores current.

## 3. Publish the dashboard

1. In Google Cloud, create a service account with the Sheets read scope. Download its JSON key.
2. Share the spreadsheet with the service account's email address as **Viewer**. Do not use "Anyone with the link": the lead register holds personal data.
3. Install packages: `install.packages(c("shiny","shinydashboard","googlesheets4","dplyr","tidyr","ggplot2","DT","scales"))`.
4. Deploy with `HYSSOP_SA_JSON` pointing to the key (shinyapps.io or Posit Connect). Keep the key in the host's secret settings, not in the code.

## 4. How each KPI is measured

Every approved KPI in `KPI_LIBRARY` has one scoring category, one aggregation rule, and one source. The table below shows which are calculated automatically and which the administrator enters at week end.

| Scorecard | Automatic from the lead register | Entered by administrator (with evidence) |
|---|---|---|
| Faith (TikTok) | Leads, site visits | Followers, 10k-view videos, engagement, videos posted, live sessions, comment reply time |
| Chege (Instagram) | Leads, site visits | Followers, reach growth, engagement, DM reply time |
| Derrick (Facebook) | Organic leads, site visits | Followers, engagement, posts per week, local groups per day, collaboration posts, live sessions |
| Dan – Ads | Leads, qualified %, contacted within 15 min %, site visits, cost per qualified lead* | *Ad spend (KES) per week |
| Dan – Website | Leads, visitor-to-enquiry % | Website visitors (GA4), blog posts |
| Marketing Coordinator (Faith) | Leads logged with source %, leads handed to agent within 15 min %, influencer leads | Campaign and content schedule, influencer delivery, shoots, brand compliance, asset library, outdated materials, weekly reports |

Sixteen of the 43 approved KPIs are fully automatic. The other 27 depend on platform numbers (TikTok, Meta, GA4) that this build does not pull directly. The administrator enters them at week end from the platform export, with an evidence link. Nothing in the approved scorecard is unmeasured. Connecting the platforms by API would be a separate phase.

**Where each number comes from**
- A lead is credited to the scorecard that owns its source: TikTok → Faith, Instagram → Chege, Facebook → Derrick, Meta Ads → Dan – Ads, Website → Dan – Website, Influencer → Marketing Coordinator. The assigned agent does not change credit, so a Meta lead handled by the sales team still counts for Dan.
- A lead's week is the Monday on or before its lead date. Month is the program month of that week.
- Duplicate phone numbers are saved for audit but excluded from every KPI.
- Automatic KPIs are recalculated live from the register. The actuals form stores a snapshot for audit, but the scores use the live figure, so a late lead for a closed week still counts.
- Resubmitting the same employee, area, week and KPI replaces the earlier value. It never adds to it.

**Scoring (follows the company documents)**
- Each KPI attainment is actual ÷ target, capped at 120%. For lower-is-better KPIs (reply times, cost per qualified lead, outdated materials) it is target ÷ actual.
- Category score = average attainment in the category × category weight. The sum is the total out of 100 (it can reach 120 because of the cap).
- Bands: 85 and above bonus-eligible; 70 to 84 on track; below 70 coaching plan.
- Dan's combined score = 70% Ads + 30% Website.
- Missing actuals count as zero and are flagged in DATA_HEALTH, so a gap cannot raise a score.
- Measure A (monthly scorecard vs approved targets) and measure B (weekly commitment vs actual) are kept separate, as the workbook requires. Nothing is blended without management approval.

## 5. Operating rhythm

| When | Who | What |
|---|---|---|
| Monday, before 9:00 | Each employee | Submit the weekly projection (posts, expected leads, expected conversions, KPI commitments, actions, support) |
| Every day | Lead handlers | Record each lead the same day in the lead form |
| Friday close of business | Administrator | Enter weekly actuals per employee and area; tick "checked the evidence" |
| Monday | Management | Review the dashboard: scores, commitment delivery, data health |

## 6. Decisions that need management sign-off

These are my proposals where the documents were silent. Each one is a single setting you can change.

- **D1. Faith holds two scorecards.** The Marketing Coordinator role document names Faith as role holder, so Faith has both a Digital team scorecard and a Marketing Coordinator scorecard. The v1 code wrongly assigned the Marketing Coordinator to Dan.
- **D2. Dan – Ads has no reach or engagement KPIs.** Its categories are re-weighted over leads/site visits (40) and process (20), so its score is out of 100 on those two. Confirm this, or add Ads reach and engagement KPIs to the library.
- **D3. Category for each Digital KPI.** The Digital scorecard says every person is scored on four categories but does not map each KPI to a category. The mapping is in `RULE_META` in `Code.gs`.
- **D4. Site visit counts when completed**, not when booked (the v1 dashboard counted both).
- **D5. Missing data scores zero.** Alternative: exclude missing KPIs and re-weight. Zero is the stricter option.
- **D6. Program months are calendar months** from `ProgramStart`. Confirm the Month 1 start date.

## 7. Conflicts and gaps in the company documents

These are not decisions for the system to make. They need an owner's answer.

1. **Chege's posting cadence** (4 feed, 2 reels, 10 stories per week) is in the Digital scorecard but not in `KPI_LIBRARY`, so it is not scored.
2. **Derrick's inbox reply time** (2h / 1h / 1h) is in the Digital scorecard but not in `KPI_LIBRARY`, so it is not scored.
3. **Marketing Coordinator's "monthly report by the 5th"** is in the role document but not in `KPI_LIBRARY`, so it is not scored.
4. **Two scoring frameworks.** The Digital scorecard uses four categories (40/20/20/20). The role document uses five (30/20/20/15/15). The system applies each document to its own scorecard.
5. **Local groups target.** The Digital scorecard says "10+" for Month 3, the library says 10. The system uses 10.
6. **The workbook's START_HERE tab** refers to a `Hyssop_Google_Setup.gs` script that creates Google Forms. This package does not create Google Forms; it uses the web app above. Update that tab once you adopt this system.

## 8. Problems fixed from the v1 package

- `app.R` could not run (a `.==` syntax error on the Qualified leads box).
- Marketing Coordinator was assigned to Dan instead of Faith (D1).
- Faith selecting "Marketing Coordinator" was given her TikTok KPIs.
- Dan's Ads and Website "Leads" were merged, because commitments matched on employee and KPI only. They now match on scorecard.
- The projection's posts and conversions were never matchable to actuals, because they were not in the approved library. They now are, as "Posts planned" and "Expected conversions".
- The dashboard added posts, leads and conversions together. Delivery is now measured per KPI.
- Lower-is-better KPIs were scored as higher-is-better. They now use the library's Scoring Direction.
- The sheet was public and the dashboard displayed phone numbers. The dashboard now reads only computed tabs, and names and phone numbers are excluded.
- The workbook tabs ship with 1,000 rows, so the v1 append would fail once they filled. Appends now extend the tab automatically.
- The "Other weekly deliverables" text was compared against the wrong label, so the employee's typed deliverables were replaced by a generic "Weekly projection" label. Projection entries are now saved as plain KPI rows.

## 9. Testing and what is not yet tested

**Tested here**
- `tests/engine.test.js` runs the real `Code.gs` scoring engine against a known scenario: 28 checks, including duplicate exclusion, lower-is-better scoring, resubmission replacing earlier values, the 120% cap, bands, the 70/30 Dan combination, and the separation of Faith's two scorecards. Expected values were calculated by hand.
- The form JavaScript in `Index.html` passes a syntax check.

**Not tested here** (run these in a copy of the sheet before going live)
- Live Apps Script deployment, the three web forms in a browser, and the admin access checks with real Google accounts.
- The Shiny dashboard. R was not available in the build environment, so the code was checked for structure but not executed. Run `shiny::runApp()` once against the test sheet.
- Load: the engine reads each tab in full on every save. This should be fine at the volumes described, but test it with a few thousand leads before relying on it.
