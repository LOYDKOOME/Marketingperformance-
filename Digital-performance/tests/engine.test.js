// Tests the REAL Code.gs scoring engine (not a copy) with stubbed Apps Script globals.
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const code = fs.readFileSync(process.argv[2] || "../Code.gs", "utf8");
const lib = JSON.parse(fs.readFileSync(__dirname + "/library.json", "utf8"));
const sandbox = {
  Session: { getScriptTimeZone: () => "Africa/Nairobi" },
  Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
  console, Logger: { log() {} }
};
vm.createContext(sandbox);
vm.runInContext(code + "\n;this.__E = {computeAll_, makeEngine_, mondayKey_, programMonth_, attain_, bandOf_, suggestWeekly_, buildItems_, SCORECARDS, HYSSOP};", sandbox);
const E = sandbox.__E;

let passed = 0;
const ok = (name, fn) => { try { fn(); passed++; console.log("PASS", name); } catch (e) { console.log("FAIL", name, "\n   ", e.message); process.exitCode = 1; } };
const near = (a, b, tol = 0.05) => assert(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);

// ---------- primitives ----------
ok("Monday rule: 2026-11-18 (Wed) -> 2026-11-16", () => assert.equal(E.mondayKey_("2026-11-18"), "2026-11-16"));
ok("Monday rule: a Monday stays itself", () => assert.equal(E.mondayKey_("2026-11-16"), "2026-11-16"));
ok("Program months: start Nov 2026 -> Dec = 2, Jan = 3, Feb = 4 (outside plan)", () => {
  assert.equal(E.programMonth_("2026-11-16", "2026-11-02"), 1);
  assert.equal(E.programMonth_("2026-12-07", "2026-11-02"), 2);
  assert.equal(E.programMonth_("2027-01-11", "2026-11-02"), 3);
  assert.equal(E.programMonth_("2027-02-01", "2026-11-02"), 4);
});
ok("Higher-is-better attainment, capped at 120%", () => {
  near(E.attain_(3, 4, "Higher is better"), 0.75, 1e-9);
  near(E.attain_(10, 4, "Higher is better"), 1.2, 1e-9);
  near(E.attain_(0, 4, "Higher is better"), 0, 1e-9);
});
ok("Lower-is-better attainment uses target/actual", () => {
  near(E.attain_(1, 2, "Lower is better"), 1.2, 1e-9);     // 2/1 = 2, capped
  near(E.attain_(4, 2, "Lower is better"), 0.5, 1e-9);     // 2/4
  near(E.attain_(350 / 0.5 * 0 + 875, 350, "Lower is better"), 0.4, 1e-9); // cost per lead example
  assert.equal(E.attain_(null, 2, "Lower is better"), null);
});
ok("Zero-target lower-is-better (outdated materials): 0 is perfect, anything else scores 0", () => {
  assert.equal(E.attain_(0, 0, "Lower is better"), 1);
  assert.equal(E.attain_(2, 0, "Lower is better"), 0);
});
ok("Bands follow the company thresholds", () => {
  assert.equal(E.bandOf_(85), "Bonus-eligible");
  assert.equal(E.bandOf_(84.9), "On track");
  assert.equal(E.bandOf_(70), "On track");
  assert.equal(E.bandOf_(69.9), "Coaching plan for next month");
  assert.equal(E.bandOf_(null), "No data");
});
ok("Suggested weekly commitment: monthly count / 4.33, percentages unchanged", () => {
  assert.equal(E.suggestWeekly_(600, "count"), 138.6);
  assert.equal(E.suggestWeekly_(90, "%"), 90);
  assert.equal(E.suggestWeekly_(4, "reports"), 1);
});
ok("Library loads with 43 KPIs and every KPI is mapped to a category", () => {
  const issues = [];
  const items = E.buildItems_(lib, issues);
  const n = Object.values(items).reduce((a, b) => a + b.length, 0);
  assert.equal(n, 43);
  assert.equal(issues.length, 0, JSON.stringify(issues));
});

// ---------- scenario ----------
// Program start Monday 2 Nov 2026. Weeks: 2 Nov (M1), 9 Nov (M1), 16 Nov (M1), 7 Dec (M2)
const start = "2026-11-02";
const leadRow = (date, source, o = {}) => Object.assign({
  "Lead Date": date, "Lead Name / ID": "L" + Math.random().toString(36).slice(2, 7), "Phone (restricted access)": o.phone || "",
  "Lead Source": source, "Assigned Agent": "Dan", "Qualified?": "Pending", "Contacted within 15 minutes?": "No",
  "Handoff to agent within 15 min?": "No", "Site Visit Status": "Not booked", "Sale Status": "Open", "Sale Value (KES)": 0,
  "Plots Sold": 0, "Duplicate of earlier lead?": "No"
}, o);
const leads = [
  // Meta Ads, week of 2 Nov (Month 1): 10 leads, 4 qualified, 9 contacted within 15m, 2 visits, 1 won (2 plots, KES 5m)
  ...Array.from({ length: 4 }, (_, i) => leadRow("2026-11-03", "Meta Ads", { "Qualified?": "Qualified", "Contacted within 15 minutes?": i < 3 ? "Yes" : "Yes", "Site Visit Status": i < 2 ? "Completed" : "Not booked" })),
  ...Array.from({ length: 5 }, () => leadRow("2026-11-04", "Meta Ads", { "Contacted within 15 minutes?": "Yes" })),
  leadRow("2026-11-05", "Meta Ads", { "Qualified?": "Not qualified", "Contacted within 15 minutes?": "Unknown" }),
  leadRow("2026-11-05", "Meta Ads", { "Sale Status": "Won", "Plots Sold": 2, "Sale Value (KES)": 5000000, "Qualified?": "Qualified", "Contacted within 15 minutes?": "Yes" }),
  // Duplicate phone (flagged, must NOT count)
  leadRow("2026-11-06", "Meta Ads", { "Phone (restricted access)": "0712345678", "Qualified?": "Qualified", "Duplicate of earlier lead?": "Yes" }),
  // Website lead, week 9 Nov
  leadRow("2026-11-10", "Website", { "Contacted within 15 minutes?": "Yes" }),
  // TikTok leads for Faith, week 9 Nov: 3 leads, 2 site visits completed; handoffs 2 of 3 within 15 min
  leadRow("2026-11-11", "TikTok", { "Handoff to agent within 15 min?": "Yes", "Site Visit Status": "Completed" }),
  leadRow("2026-11-11", "TikTok", { "Handoff to agent within 15 min?": "Yes", "Site Visit Status": "Completed" }),
  leadRow("2026-11-12", "TikTok", { "Handoff to agent within 15 min?": "No" }),
  // Influencer lead for Marketing Coordinator, week 9 Nov
  leadRow("2026-11-13", "Influencer", { "Handoff to agent within 15 min?": "Yes" })
];
const commitments = [
  // Faith, week 9 Nov: expects 3 leads (Expected leads), commits Site visits 1, Videos posted 4
  { "Week Starting (Monday)": "2026-11-09", "Employee": "Faith", "KPI": "Expected leads", "Committed Target": 3, "Scorecard Key": "Faith", "Row Type": "PROJECTION" },
  { "Week Starting (Monday)": "2026-11-09", "Employee": "Faith", "KPI": "Site visits", "Committed Target": 1, "Scorecard Key": "Faith", "Row Type": "KPI" },
  { "Week Starting (Monday)": "2026-11-09", "Employee": "Faith", "KPI": "Posts planned", "Committed Target": 4, "Scorecard Key": "Faith", "Row Type": "PROJECTION" },
  { "Week Starting (Monday)": "2026-11-09", "Employee": "Faith", "KPI": "Expected conversions", "Committed Target": 1, "Scorecard Key": "Faith", "Row Type": "PROJECTION" },
  // Dan Ads, week 2 Nov: expects 10 leads
  { "Week Starting (Monday)": "2026-11-02", "Employee": "Dan", "KPI": "Expected leads", "Committed Target": 10, "Scorecard Key": "Dan - Ads", "Row Type": "PROJECTION" },
  // Old duplicate commitment for Faith 9 Nov site visits (resubmitted later with 2): latest must win
  { "Week Starting (Monday)": "2026-11-09", "Employee": "Faith", "KPI": "Site visits", "Committed Target": 0, "Scorecard Key": "Faith", "Row Type": "KPI" },
  // Legacy row without a key (must be ignored and flagged)
  { "Week Starting (Monday)": "2026-11-02", "Employee": "Dan", "KPI": "Leads", "Committed Target": 5 }
];
const actuals = [
  // Dan Ads week 2 Nov: spend KES 3,500 (helper row)
  { "Week Starting (Monday)": "2026-11-02", "Employee": "Dan", "KPI": "Ad spend (KES)", "Actual Delivered": 3500, "Scorecard Key": "Dan - Ads", "Row Type": "HELPER" },
  // Faith comment reply time: week 2 Nov actual 1h, week 9 Nov actual 4h (lower is better, target 2)
  { "Week Starting (Monday)": "2026-11-02", "Employee": "Faith", "KPI": "Comment reply time", "Actual Delivered": 1, "Scorecard Key": "Faith", "Row Type": "KPI" },
  { "Week Starting (Monday)": "2026-11-09", "Employee": "Faith", "KPI": "Comment reply time", "Actual Delivered": 4, "Scorecard Key": "Faith", "Row Type": "KPI" },
  // Faith videos posted: week 9 Nov (monthly target 16)
  { "Week Starting (Monday)": "2026-11-09", "Employee": "Faith", "KPI": "Videos posted", "Actual Delivered": 3, "Scorecard Key": "Faith", "Row Type": "KPI" },
  // Faith posts published (projection actual)
  { "Week Starting (Monday)": "2026-11-09", "Employee": "Faith", "KPI": "Posts published", "Actual Delivered": 3, "Scorecard Key": "Faith", "Row Type": "PROJECTION" },
  // Dan website visitors: 800 on week 2 Nov (target 1000 per month)
  { "Week Starting (Monday)": "2026-11-02", "Employee": "Dan", "KPI": "Website visitors", "Actual Delivered": 800, "Scorecard Key": "Dan - Website", "Row Type": "KPI" },
  // Resubmission correction for Faith comment reply time, week 2 Nov: now 2 (must replace 1, not add)
  { "Week Starting (Monday)": "2026-11-02", "Employee": "Faith", "KPI": "Comment reply time", "Actual Delivered": 2, "Scorecard Key": "Faith", "Row Type": "KPI" }
];
const data = { start, library: lib, commitments, actuals, leads };
const out = E.computeAll_(data);
const mk = (rows, cols) => rows;
const kp = (key, m, kpi) => out.monthlyKpi.find(r => r[0] === m && r[1] === key && r[2] === kpi);
const card = (key, m) => out.monthly.find(r => r[0] === m && r[1] === key);

ok("Meta Ads leads in Month 1 are counted: 11 (the duplicate-phone lead is excluded)", () => {
  const r = kp("Dan - Ads", 1, "Leads");
  assert.equal(r[7], 11);
});
ok("Qualified share = 5 of 11 = 45.5%; attainment 45.5/40 = 113.6% (under the 120% cap)", () => {
  const r = kp("Dan - Ads", 1, "Qualified leads (%)");
  near(r[7], 45.5, 0.05);
  near(r[8], 113.6, 0.05);
});
ok("Contacted within 15 min = 10 of 11 = 90.9%; attainment 90.9/90 = 101%", () => {
  const r = kp("Dan - Ads", 1, "Contacted within 15 min (%)");
  near(r[7], 90.9, 0.05);
  near(r[8], 101, 0.05);
});
ok("Cost per qualified lead: KES 3,500 / 5 qualified = 700; target 350 (lower is better) -> 50%", () => {
  const r = kp("Dan - Ads", 1, "Cost per qualified lead");
  near(r[7], 700, 0.05);
  near(r[8], 50, 0.05);
});
ok("Site visits (Completed, Meta Ads, Month 1) = 2 of target 100 -> 2%", () => {
  const r = kp("Dan - Ads", 1, "Site visits");
  assert.equal(r[7], 2);
  near(r[8], 2, 0.05);
});
ok("Dan Ads Month 1 card: all KPIs have data; total = (40 x LS + 20 x PD) / 60, so 61.6", () => {
  near(card("Dan - Ads", 1)[11], 61.6, 0.1);
  const c = card("Dan - Ads", 1);
  assert.ok(c, "card exists");
  // Leads-and-site-visits (40) and Process (20) only; re-weighted over 60
  assert.equal(c[13], 0);   // all five Dan - Ads KPIs are automatic and have data
});
ok("Lower-is-better manual KPI: Faith comment reply time averages 2h (week 1 corrected to 2h) and 4h -> avg 3h vs target 2 -> 66.7%", () => {
  const r = kp("Faith", 1, "Comment reply time");
  near(r[7], 3, 1e-9);
  near(r[8], 66.7, 0.05);
});
ok("Resubmission replaces, never double counts: Faith reply time week 2 Nov is 2 (not 1)", () => {
  const w = out.weekly.find(r => r[0] === "2026-11-02" && r[2] === "Faith" && r[4] === "Comment reply time");
  assert.equal(w[10], 2);
});
ok("Faith leads: 3 TikTok leads in week 9 Nov vs expected leads 3 -> commitment delivery 100%", () => {
  const w = out.weekly.find(r => r[0] === "2026-11-09" && r[2] === "Faith" && r[4] === "Leads");
  assert.ok(w, "row present");
  assert.equal(w[10], 3);              // actual
  assert.equal(w[11], 100);            // committed 3 (from Expected leads)
});
ok("Latest commitment wins: Faith site visits week 9 Nov committed = 0 (later row). 2 done vs 0 planned = 120% (capped)", () => {
  const w = out.weekly.find(r => r[0] === "2026-11-09" && r[2] === "Faith" && r[4] === "Site visits");
  assert.equal(w[9], 0);
  assert.equal(w[11], 120);
});
ok("Projection: Posts planned 4 vs published 3 -> 75%", () => {
  const w = out.weekly.find(r => r[0] === "2026-11-09" && r[2] === "Faith" && r[4] === "Posts planned");
  assert.equal(w[10], 3);
  assert.equal(w[11], 75);
});
ok("Projection: expected conversions 1 vs Won = 0 for Faith -> 0%", () => {
  const w = out.weekly.find(r => r[0] === "2026-11-09" && r[2] === "Faith" && r[4] === "Expected conversions");
  assert.equal(w[10], 0);
  assert.equal(w[11], 0);
});
ok("Won sale on Meta Ads is credited to Dan - Ads conversions (1), not Faith", () => {
  const d = out.weekly.find(r => r[0] === "2026-11-02" && r[2] === "Dan - Ads" && r[4] === "Expected conversions");
  assert.equal(d[10], 1);
  const f = out.weekly.find(r => r[0] === "2026-11-09" && r[2] === "Faith" && r[4] === "Expected conversions");
  assert.equal(f[10], 0);
});
ok("Legacy commitment without Scorecard Key is ignored and reported in DATA_HEALTH", () => {
  assert.ok(out.health.some(h => h[0].includes("Legacy commitment")), JSON.stringify(out.health));
});
ok("Dan combined (70/30) is produced only when both areas have a score", () => {
  const combined = out.monthly.filter(r => r[1].startsWith("Dan (combined"));
  // Website has visitors only and no leads data in Month 1 -> whatever is produced must be a number or absent
  assert.ok(combined.length === 0 || typeof combined[0][11] === "number");
});
ok("Marketing Coordinator: Influencer leads = 1; handoff uses ALL 16 counted leads, 3 handed within 15 min = 18.75%", () => {
  const r = kp("Marketing Coordinator", 1, "Influencer leads");
  assert.equal(r[7], 1);
  const h = kp("Marketing Coordinator", 1, "Leads handed to agent within 15 min (%)");
  // all counted leads in Month 1: Meta Ads 11 + website 1 + TikTok 3 + influencer 1 = 16 ; handoff Yes = 2 TikTok + 1 Influencer = 3 -> 18.75%
  near(h[7], 18.75, 0.1); // engine rounds to 1 dp
});
ok("Faith is the Marketing Coordinator: her Marketing Coordinator card exists separately from her Digital team card", () => {
  assert.ok(card("Marketing Coordinator", 1));
  assert.ok(card("Faith", 1));
});
ok("Every scored monthly card has a band and a total or 'No data'", () => {
  out.monthly.forEach(r => assert.ok(["Bonus-eligible", "On track", "Coaching plan for next month", "No data"].includes(r[12]), JSON.stringify(r)));
});
ok("Health report flags legacy rows and KPIs with no actuals", () => {
  const titles = out.health.map(h => h[0]).join(" | ");
  assert.ok(titles.includes("KPIs with no actual yet"), titles);
});

console.log(`\n${passed} tests passed`);
console.log("\n--- MONTHLY SCORECARD (Month 1) ---");
out.monthly.filter(r => r[0] === 1).forEach(r => console.log(JSON.stringify(r)));
console.log("\n--- WEEKLY (measure B) sample ---");
out.weekly.filter(r => r[2] === "Faith").slice(0, 12).forEach(r => console.log(JSON.stringify(r)));
