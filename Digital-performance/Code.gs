/*************************************************************
 * HYSSOP DIGITAL PERFORMANCE SYSTEM v2 - Code.gs
 *
 * Backend for the three web forms and the scoring engine.
 *   1. Weekly projection   (employee)    -> WEEKLY_COMMITMENTS   (staff)
 *   2. Lead capture        (owner only)  -> LEADS_REGISTER
 *   3. Weekly actuals      (owner only)  -> WEEKLY_ACTUALS
 * After every save the engine recalculates the computed tabs
 * (WEEKLY_KPI_RESULTS, WEEKLY_SUMMARY, MONTHLY_KPI_RESULTS,
 * MONTHLY_SCORECARD, DATA_HEALTH) that the dashboard reads.
 *************************************************************/

const HYSSOP = {
  spreadsheetId: "1z-jMr2A4bwBECrihgoZUCPdM7XYOnek2Wn0SiJSdN_8",
  tabs: {
    library: "KPI_LIBRARY", commitments: "WEEKLY_COMMITMENTS", actuals: "WEEKLY_ACTUALS",
    leads: "LEADS_REGISTER", activities: "MARKETING_ACTIVITIES", review: "WEEKLY_MANAGEMENT_REVIEW",
    config: "CONFIG", weekly: "WEEKLY_KPI_RESULTS", summary: "WEEKLY_SUMMARY",
    monthlyKpi: "MONTHLY_KPI_RESULTS", monthly: "MONTHLY_SCORECARD", health: "DATA_HEALTH"
  },
  cap: 1.2,        // company rule: each KPI attainment capped at 120%
  bonusMin: 85,    // 85 and above: bonus-eligible
  onTrackMin: 70   // 70 to 84: on track; below 70: coaching plan
};

// Who owns which reporting area. Faith is the Marketing Coordinator role holder (per the role document).
const PEOPLE = {
  "Faith": ["Digital team", "Marketing Coordinator"],
  "Chege": ["Digital team"],
  "Derrick": ["Digital team"],
  "Dan": ["Ads", "Website"]
};
const SCORECARD_OF = {
  "Faith|Digital team": "Faith",
  "Faith|Marketing Coordinator": "Marketing Coordinator",
  "Chege|Digital team": "Chege",
  "Derrick|Digital team": "Derrick",
  "Dan|Ads": "Dan - Ads",
  "Dan|Website": "Dan - Website"
};
const SCORECARDS = ["Faith", "Chege", "Derrick", "Dan - Ads", "Dan - Website", "Marketing Coordinator"];
const DAN_WEIGHTS = { "Dan - Ads": 0.7, "Dan - Website": 0.3 };

// Each lead source belongs to one scorecard. This is how leads are credited automatically.
const SOURCE_OWNER = {
  "TikTok": "Faith", "Instagram": "Chege", "Facebook": "Derrick",
  "Meta Ads": "Dan - Ads", "Website": "Dan - Website", "Influencer": "Marketing Coordinator",
  "Referral": "", "Other": ""
};
const SOURCES = Object.keys(SOURCE_OWNER);
const AGENTS = ["Faith", "Chege", "Derrick", "Dan", "Sales team", "Unassigned"];

const CAT_ORDER = ["LS", "RB", "EN", "PD", "LH", "IC", "BA", "CE", "RE"];
const CAT_NAMES = {
  LS: "Leads and site visits", RB: "Reach and brand growth", EN: "Engagement", PD: "Process discipline",
  LH: "Lead handoff", IC: "Influencer and collaboration", BA: "Branding assets and sales materials",
  CE: "Campaign and content execution", RE: "Reporting and events"
};
// Category weights from the two company documents. Dan - Ads has no reach or engagement KPIs,
// so its categories are re-weighted over the categories it does have (see README, decision D2).
const CATEGORY_WEIGHTS = {
  "Faith": { LS: 40, RB: 20, EN: 20, PD: 20 },
  "Chege": { LS: 40, RB: 20, EN: 20, PD: 20 },
  "Derrick": { LS: 40, RB: 20, EN: 20, PD: 20 },
  "Dan - Ads": { LS: 40, PD: 20 },
  "Dan - Website": { LS: 40, RB: 20, EN: 20, PD: 20 },
  "Marketing Coordinator": { LH: 30, IC: 20, BA: 20, CE: 15, RE: 15 }
};

// Scoring metadata for every approved KPI in KPI_LIBRARY.
// agg: how monthly results combine weekly results (SUM, AVG, or ratio of summed counts).
// metric: present when the value is calculated automatically from LEADS_REGISTER or spend/visitor inputs.
const RULE_META = {
  "Faith|Leads": { cat: "LS", agg: "SUM", metric: "LEADS" },
  "Faith|Site visits": { cat: "LS", agg: "SUM", metric: "VISITS" },
  "Faith|New followers": { cat: "RB", agg: "SUM" },
  "Faith|Videos above 10k views": { cat: "RB", agg: "SUM" },
  "Faith|Engagement rate": { cat: "EN", agg: "AVG" },
  "Faith|Videos posted": { cat: "PD", agg: "SUM" },
  "Faith|TikTok live sessions": { cat: "PD", agg: "SUM" },
  "Faith|Comment reply time": { cat: "PD", agg: "AVG" },

  "Chege|Leads": { cat: "LS", agg: "SUM", metric: "LEADS" },
  "Chege|Site visits": { cat: "LS", agg: "SUM", metric: "VISITS" },
  "Chege|New followers": { cat: "RB", agg: "SUM" },
  "Chege|Reach growth": { cat: "RB", agg: "SUM" },
  "Chege|Engagement rate": { cat: "EN", agg: "AVG" },
  "Chege|DM reply time": { cat: "PD", agg: "AVG" },

  "Derrick|Organic leads": { cat: "LS", agg: "SUM", metric: "LEADS" },
  "Derrick|Site visits": { cat: "LS", agg: "SUM", metric: "VISITS" },
  "Derrick|New followers": { cat: "RB", agg: "SUM" },
  "Derrick|Engagement rate": { cat: "EN", agg: "AVG" },
  "Derrick|Posts per week": { cat: "PD", agg: "AVG" },
  "Derrick|Local groups posted daily": { cat: "PD", agg: "AVG" },
  "Derrick|Collaboration posts": { cat: "PD", agg: "SUM" },
  "Derrick|Facebook live sessions": { cat: "PD", agg: "SUM" },

  "Dan - Ads|Leads": { cat: "LS", agg: "SUM", metric: "LEADS" },
  "Dan - Ads|Qualified leads (%)": { cat: "LS", agg: "RATIO", metric: "QUAL_PCT" },
  "Dan - Ads|Contacted within 15 min (%)": { cat: "PD", agg: "RATIO", metric: "WITHIN15_PCT" },
  "Dan - Ads|Site visits": { cat: "LS", agg: "SUM", metric: "VISITS" },
  "Dan - Ads|Cost per qualified lead": { cat: "LS", agg: "RATIO", metric: "CPQL" },

  "Dan - Website|Leads": { cat: "LS", agg: "SUM", metric: "LEADS" },
  "Dan - Website|Website visitors": { cat: "RB", agg: "SUM" },
  "Dan - Website|Visitor-to-enquiry rate (%)": { cat: "EN", agg: "RATIO", metric: "V2E_PCT" },
  "Dan - Website|Blog posts": { cat: "PD", agg: "SUM" },

  "Marketing Coordinator|Leads logged with source (%)": { cat: "LH", agg: "RATIO", metric: "SOURCED_PCT" },
  "Marketing Coordinator|Leads handed to agent within 15 min (%)": { cat: "LH", agg: "RATIO", metric: "HANDOFF_PCT" },
  "Marketing Coordinator|Campaigns launched on schedule (%)": { cat: "CE", agg: "AVG" },
  "Marketing Coordinator|Content calendar followed (%)": { cat: "CE", agg: "AVG" },
  "Marketing Coordinator|Influencer posts delivered on schedule (%)": { cat: "IC", agg: "AVG" },
  "Marketing Coordinator|Influencers with tracked contact (%)": { cat: "IC", agg: "AVG" },
  "Marketing Coordinator|Influencer shoots coordinated": { cat: "IC", agg: "SUM" },
  "Marketing Coordinator|Influencer leads": { cat: "IC", agg: "SUM", metric: "LEADS" },
  "Marketing Coordinator|Brand-guideline compliance (%)": { cat: "BA", agg: "AVG" },
  "Marketing Coordinator|Asset library updated within 48 hrs (%)": { cat: "BA", agg: "AVG" },
  "Marketing Coordinator|Outdated materials in circulation": { cat: "BA", agg: "SUM" },
  "Marketing Coordinator|Weekly reports delivered on time": { cat: "RE", agg: "SUM" }
};

// Projection items are commitments and results that are not scored against the approved scorecard.
// They are measured in the weekly commitment view (measure B).
const PROJECTION_ITEMS = [
  { kpi: "Posts planned", actualKpi: "Posts published", unit: "count", dir: "Higher is better", agg: "SUM", metric: null },
  { kpi: "Expected conversions", actualKpi: "Expected conversions", unit: "count", dir: "Higher is better", agg: "SUM", metric: "WON" }
];

// Column headers. Setup appends any missing ones on the right; existing data is never deleted.
const HEAD = {
  commitments: ["Timestamp", "Week Starting (Monday)", "Employee", "KPI", "What I commit to deliver this week", "Committed Target", "Unit", "Planned actions / approach", "Dependency or support needed", "Evidence / tracking link", "Employee confirmation", "Scorecard Key", "Program Month", "Row Type"],
  actuals: ["Timestamp", "Week Starting (Monday)", "Employee", "KPI", "Approved Monthly Target (reference)", "Weekly Committed Target", "Actual Delivered", "Unit", "Evidence URL / screenshot reference", "Administrator validation", "Variance vs commitment", "Delivery %", "Administrator notes", "Scorecard Key", "Program Month", "Row Type"],
  leads: ["Timestamp", "Lead Date", "Lead Name / ID", "Phone (restricted access)", "Lead Source", "Campaign / UTM / tracked link", "Assigned Agent", "Qualified?", "Contacted within 15 minutes?", "Site Visit Status", "Sale Status", "Sale Value (KES)", "Entered / verified by", "Notes", "Plots Sold", "Handoff to agent within 15 min?", "Week Starting (Monday)", "Program Month", "Scorecard Owner", "Duplicate of earlier lead?"],
  config: ["Key", "Value", "Notes"],
  weekly: ["Week Starting (Monday)", "Program Month", "Scorecard Key", "Row Type", "KPI", "Category", "Unit", "Scoring Direction", "Monthly Target (ref)", "Weekly Committed", "Weekly Actual", "Delivery % (capped at 120)", "Status"],
  summary: ["Week Starting (Monday)", "Scorecard Key", "KPIs committed", "KPIs reported", "KPIs at or above 100%", "Commitment delivery % (reported KPIs)"],
  monthlyKpi: ["Program Month", "Scorecard Key", "KPI", "Category", "Unit", "Scoring Direction", "Monthly Target", "Actual (month)", "Attainment % (capped at 120)", "Status"],
  monthly: ["Program Month", "Scorecard Key"].concat(CAT_ORDER.map(c => CAT_NAMES[c] + " (%)"), ["Total score (out of 100)", "Band", "KPIs with no data"]),
  health: ["Check", "Scope", "Detail", "Action"],
  activities: ["Timestamp", "Activity Date", "Activity Type", "Campaign / Activity Name", "Channel", "Owner", "Planned Output", "Actual Output", "Spend (KES)", "Status", "Evidence URL", "Notes"],
  review: ["Week Starting", "Employee", "KPIs Committed", "KPIs Delivered", "Commitment Delivery %", "Approved KPI Score %", "Leads", "Site Visits", "Spend (KES)", "Key Wins", "Missed Commitments / Risks", "Corrective Action", "Action Owner", "Due Date", "Management Comments"]
};

/* ============================ WEB APP ============================ */

function doGet(e) {
  const requested = e && e.parameter && e.parameter.page;
  const page = ["weekly", "leads", "actuals"].includes(requested) ? requested : "weekly";

  // Leads and actuals: only the account that owns this script.
  if (page === "actuals" && !isOwner_()) return denied_("Restricted", "This page is only available to the account that owns this system.");
  if (page === "leads" && !isOwner_()) return denied_("Restricted", "This page is only available to the account that owns this system.");

  // Weekly projection: staff only (anyone in the organisation unless StaffEmails is set).
  if (page === "weekly" && !isStaff_()) return denied_("Access restricted", "Your Google account is not on the staff list. Ask the administrator.");

  const t = HtmlService.createTemplateFromFile("Index");
  t.page = page;
  t.peopleJson = JSON.stringify(PEOPLE);
  t.sourcesJson = JSON.stringify(SOURCES);
  t.agentsJson = JSON.stringify(AGENTS);
  t.isAdmin = isOwner_();
  t.baseUrl = ScriptApp.getService().getUrl();
  return t.evaluate().setTitle("Hyssop Digital Performance | " + page).addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function denied_(title, msg) {
  return HtmlService.createHtmlOutput('<div style="font-family:Arial;padding:30px;max-width:600px"><h2>' + title + '</h2><p>' + msg + '</p></div>').setTitle(title);
}

/* ============================ FORM 1: WEEKLY PROJECTION ============================ */

// Called by the projection page when employee, area or week changes. Returns the KPI rows and any saved values.
function getProjectionTemplate(employee, area, weekStarting) {
  assertStaff_();
  const ctx = context_(employee, area, weekStarting);
  const e = makeEngine_(loadData_());
  const rows = (e.items[ctx.key] || []).map(it => ({
    kpi: it.kpi,
    unit: it.unit,
    dir: it.dir,
    monthlyTarget: it.t[ctx.month - 1],
    covered: it.metric === "LEADS",          // covered by the Expected leads field
    suggested: suggestWeekly_(it.t[ctx.month - 1], it.unit),
    saved: e.committedFor(ctx.week, ctx.key, it)
  }));
  return {
    scorecard: ctx.key, week: ctx.week, month: ctx.month, rows,
    posts: e.cv(ctx.week, ctx.key, "Posts planned"),
    expectedLeads: e.cv(ctx.week, ctx.key, "Expected leads"),
    expectedConversions: e.cv(ctx.week, ctx.key, "Expected conversions")
  };
}

function submitWeeklyPlan(p) {
  assertStaff_();
  required_(p, ["employee", "reportingArea", "weekStarting", "posts", "expectedLeads", "expectedConversions"]);
  const ctx = context_(p.employee, p.reportingArea, p.weekStarting);
  const e = makeEngine_(loadData_());
  const rows = [
    commitRow_(p, ctx, "Posts planned", "count", nonNeg_(p.posts, "Posts planned"), "PROJECTION"),
    commitRow_(p, ctx, "Expected leads", "count", nonNeg_(p.expectedLeads, "Expected leads"), "PROJECTION"),
    commitRow_(p, ctx, "Expected conversions", "count", nonNeg_(p.expectedConversions, "Expected conversions"), "PROJECTION")
  ];
  const k = p.kpis || {};
  (e.items[ctx.key] || []).forEach(it => {
    if (it.metric === "LEADS") return;                    // covered by Expected leads
    const raw = k[it.kpi];
    if (raw === undefined || raw === null || raw === "") return;
    const n = nonNeg_(raw, it.kpi);
    checkPct_(it.unit, n, it.kpi);
    rows.push(commitRow_(p, ctx, it.kpi, it.unit, n, "KPI"));
  });
  appendRows_(HYSSOP.tabs.commitments, rows);
  const warn = refreshSafe_();
  return { ok: true, message: "Weekly projection saved (" + rows.length + " entries). " + warn };
}

function commitRow_(p, ctx, kpi, unit, value, rowType) {
  return {
    "Timestamp": new Date(),
    "Week Starting (Monday)": toDateObj_(ctx.week),
    "Employee": p.employee,
    "KPI": kpi,
    "What I commit to deliver this week": kpi,
    "Committed Target": value,
    "Unit": unit,
    "Planned actions / approach": p.actions || "",
    "Dependency or support needed": p.support || "",
    "Evidence / tracking link": p.evidence || "",
    "Employee confirmation": "Confirmed via weekly projection form",
    "Scorecard Key": ctx.key,
    "Program Month": ctx.month,
    "Row Type": rowType
  };
}

/* ============================ FORM 2: LEAD CAPTURE (OWNER ONLY) ============================ */

function submitLead(p) {
  assertOwner_();
  required_(p, ["leadDate", "leadName", "source", "assignedAgent", "qualified", "contacted", "handoff", "siteVisit", "saleStatus"]);
  if (!SOURCE_OWNER.hasOwnProperty(p.source)) throw new Error("Choose a valid lead source.");
  if (!AGENTS.includes(p.assignedAgent)) throw new Error("Choose a valid assigned agent.");
  const date = toKey_(p.leadDate);
  if (!date) throw new Error("Invalid lead date.");
  if (date > toKey_(new Date())) throw new Error("Lead date cannot be in the future.");
  const plots = int_(p.plotsSold || 0, "Plots sold");
  const value = nonNeg_(p.saleValue || 0, "Sale value");
  if (p.saleStatus === "Won" && (plots < 1 || value <= 0)) throw new Error("A Won sale needs at least 1 plot and a sale value above 0.");
  if (p.saleStatus !== "Won" && plots !== 0) throw new Error("Plots sold must be 0 unless the sale status is Won.");

  const cfg = readConfig_();
  const week = mondayKey_(date);
  const phone = phoneKey_(p.phone);
  const dup = !!phone && readObjects_(HYSSOP.tabs.leads).some(r => phoneKey_(r["Phone (restricted access)"]) === phone);

  appendRows_(HYSSOP.tabs.leads, [{
    "Timestamp": new Date(),
    "Lead Date": toDateObj_(date),
    "Lead Name / ID": p.leadName,
    "Phone (restricted access)": p.phone || "",
    "Lead Source": p.source,
    "Campaign / UTM / tracked link": p.campaign || "",
    "Assigned Agent": p.assignedAgent,
    "Qualified?": p.qualified,
    "Contacted within 15 minutes?": p.contacted,
    "Handoff to agent within 15 min?": p.handoff,
    "Site Visit Status": p.siteVisit,
    "Sale Status": p.saleStatus,
    "Sale Value (KES)": value,
    "Entered / verified by": p.enteredBy || "",
    "Notes": p.notes || "",
    "Plots Sold": plots,
    "Week Starting (Monday)": toDateObj_(week),
    "Program Month": programMonth_(week, cfg.programStart),
    "Scorecard Owner": SOURCE_OWNER[p.source] || "Unattributed",
    "Duplicate of earlier lead?": dup ? "Yes" : "No"
  }]);
  const warn = refreshSafe_();
  const msg = dup
    ? "Saved, but this phone number is already in the register. It is recorded as a duplicate and is not counted."
    : "Lead recorded and credited to " + (SOURCE_OWNER[p.source] || "unattributed") + ".";
  return { ok: true, message: msg + " " + warn };
}

/* ============================ FORM 3: WEEKLY ACTUALS (OWNER ONLY) ============================ */

// Returns the KPI rows for one employee, area and week: auto values are live, manual inputs show any saved value.
function getActualsTemplate(employee, area, weekStarting) {
  assertOwner_();
  const ctx = context_(employee, area, weekStarting);
  const e = makeEngine_(loadData_());
  const rows = allItems_(e.items, ctx.key).map(it => {
    const name = it.actualKpi || it.kpi;
    const auto = !!it.metric;
    return {
      name,
      unit: it.unit,
      dir: it.dir,
      category: it.projection ? "Projection (not scored)" : CAT_NAMES[it.cat],
      monthlyTarget: it.projection ? null : it.t[ctx.month - 1],
      committed: e.committedFor(ctx.week, ctx.key, it),
      auto,
      live: auto ? e.metricAt(it.metric, ctx.key, ctx.week) : null,
      saved: auto ? null : e.actVal(ctx.week, ctx.key, name)
    };
  });
  const extras = ctx.key === "Dan - Ads"
    ? [{ name: "Ad spend (KES)", unit: "KES", dir: "Lower is better", category: "Spend input (not scored)", monthlyTarget: null, committed: null, auto: false, live: null, saved: e.actVal(ctx.week, ctx.key, "Ad spend (KES)") }]
    : [];
  return { scorecard: ctx.key, week: ctx.week, month: ctx.month, rows: rows.concat(extras) };
}

function submitActual(p) {
  assertOwner_();
  required_(p, ["employee", "reportingArea", "weekStarting"]);
  if (!(p.evidenceChecked === true || p.evidenceChecked === "true")) throw new Error("Tick 'I checked the evidence for this week' before saving.");
  const ctx = context_(p.employee, p.reportingArea, p.weekStarting);
  const e = makeEngine_(loadData_());
  const v = p.values || {};
  const rows = [];

  allItems_(e.items, ctx.key).forEach(it => {
    const name = it.actualKpi || it.kpi;
    const committed = e.committedFor(ctx.week, ctx.key, it);
    const target = it.projection ? null : it.t[ctx.month - 1];
    if (it.metric) {                                        // automatic: store a snapshot for audit
      const live = e.metricAt(it.metric, ctx.key, ctx.week);
      if (live != null) rows.push(actRow_(p, ctx, name, it.unit, live, target, committed, it.dir, "KPI-AUTO-SNAPSHOT"));
      return;
    }
    const raw = v[name];
    if (raw === undefined || raw === null || raw === "") return;
    const n = nonNeg_(raw, name);
    checkPct_(it.unit, n, name);
    rows.push(actRow_(p, ctx, name, it.unit, n, target, committed, it.dir, it.projection ? "PROJECTION" : "KPI"));
  });

  if (ctx.key === "Dan - Ads" && v["Ad spend (KES)"] !== undefined && v["Ad spend (KES)"] !== "") {
    rows.push(actRow_(p, ctx, "Ad spend (KES)", "KES", nonNeg_(v["Ad spend (KES)"], "Ad spend"), null, null, "Lower is better", "HELPER"));
  }
  if (!rows.length) throw new Error("Enter at least one actual result before saving.");

  appendRows_(HYSSOP.tabs.actuals, rows);
  const out = rebuildScorecards_();
  return { ok: true, message: "Actuals saved (" + rows.length + " entries). " + scoreLine_(out, ctx.key, ctx.month) };
}

function actRow_(p, ctx, name, unit, val, target, committed, dir, rowType) {
  const att = committed == null ? null : attain_(val, committed, dir);
  return {
    "Timestamp": new Date(),
    "Week Starting (Monday)": toDateObj_(ctx.week),
    "Employee": p.employee,
    "KPI": name,
    "Approved Monthly Target (reference)": target == null ? "" : target,
    "Weekly Committed Target": committed == null ? "" : committed,
    "Actual Delivered": val,
    "Unit": unit,
    "Evidence URL / screenshot reference": p.evidence || "",
    "Administrator validation": "Validated",
    "Variance vs commitment": committed == null ? "" : round1_(val - committed),
    "Delivery %": att == null ? "" : round1_(att * 100),
    "Administrator notes": p.notes || "",
    "Scorecard Key": ctx.key,
    "Program Month": ctx.month,
    "Row Type": rowType
  };
}

function scoreLine_(out, key, month) {
  const row = out.monthly.find(r => r[0] === month && r[1] === key);
  if (!row) return "";
  return row[11] === "" ? "Month " + month + " score: not yet available (no data)." : "Month " + month + " score so far: " + row[11] + " (" + row[12] + ").";
}

/* ============================ SCORING ENGINE ============================ */

// Builds the KPI item list per scorecard, from KPI_LIBRARY and the rule table above.
function buildItems_(libRows, issues) {
  const items = {};
  libRows.forEach(r => {
    const key = String(r["Employee / Reporting Area"] || "").trim();
    const kpi = String(r["KPI"] || "").trim();
    if (!key || !kpi) return;
    const meta = RULE_META[key + "|" + kpi];
    if (!meta) { issues.push(["KPI not mapped to a scoring category", "KPI_LIBRARY", key + " | " + kpi, "Not scored until mapped"]); return; }
    (items[key] = items[key] || []).push({
      key, kpi,
      unit: String(r["Unit"] || ""),
      dir: String(r["Scoring Direction"] || "Higher is better").trim(),
      t: [1, 2, 3].map(i => toNum_(r["Month " + i + " Approved Target"])),
      cat: meta.cat, agg: meta.agg, metric: meta.metric || null, projection: false
    });
  });
  return items;
}

function allItems_(items, key) {
  return (items[key] || []).concat(PROJECTION_ITEMS.map(p => Object.assign({ key, cat: null, t: [null, null, null], projection: true }, p)));
}

function normLead_(r, start) {
  const date = toKey_(r["Lead Date"]);
  const week = date ? mondayKey_(date) : "";
  return {
    date, week, month: programMonth_(week, start),
    source: String(r["Lead Source"] || "").trim(),
    qualified: String(r["Qualified?"] || "").trim(),
    within15: String(r["Contacted within 15 minutes?"] || "").trim(),
    handoff15: String(r["Handoff to agent within 15 min?"] || "").trim(),
    visit: String(r["Site Visit Status"] || "").trim(),
    sale: String(r["Sale Status"] || "").trim(),
    plots: toNum_(r["Plots Sold"]) || 0,
    value: toNum_(r["Sale Value (KES)"]) || 0,
    duplicate: String(r["Duplicate of earlier lead?"] || "").trim().startsWith("Yes")
  };
}

function normCommit_(r) {
  const d = toKey_(r["Week Starting (Monday)"]);
  return { week: d ? mondayKey_(d) : "", key: String(r["Scorecard Key"] || "").trim(), kpi: String(r["KPI"] || "").trim(), value: toNum_(r["Committed Target"]) };
}

function normAct_(r) {
  const d = toKey_(r["Week Starting (Monday)"]);
  return { week: d ? mondayKey_(d) : "", key: String(r["Scorecard Key"] || "").trim(), kpi: String(r["KPI"] || "").trim(), value: toNum_(r["Actual Delivered"]) };
}

// The engine keeps one row per week, scorecard and KPI (the latest one wins), so resubmissions correct, not double count.
function makeEngine_(d) {
  const start = d.start || "";
  const issues = [];
  const leads = d.leads.map(r => normLead_(r, start)).filter(l => l.date);
  const items = buildItems_(d.library, issues);
  const commit = lastBy_(d.commitments.map(normCommit_).filter(r => r.week && r.key), r => r.week + "|" + r.key + "|" + r.kpi);
  const acts = lastBy_(d.actuals.map(normAct_).filter(r => r.week && r.key), r => r.week + "|" + r.key + "|" + r.kpi);
  const actList = Object.values(acts);
  const monthOf = w => programMonth_(w, start);
  const sourcesFor = (metric, key) => (metric === "SOURCED_PCT" || metric === "HANDOFF_PCT") ? null : SOURCES.filter(s => SOURCE_OWNER[s] === key);
  const actVal = (w, key, kpi) => { const r = acts[w + "|" + key + "|" + kpi]; return r && r.value != null ? r.value : null; };
  const cv = (w, key, kpi) => { const r = commit[w + "|" + key + "|" + kpi]; return r && r.value != null ? r.value : null; };
  const committedFor = (w, key, it) => {
    let c = cv(w, key, it.kpi);
    if (c == null && it.metric === "LEADS") c = cv(w, key, "Expected leads");
    return c;
  };
  const sumAct_ = (key, m, kpi) => aggregate_(actList.filter(r => r.key === key && r.kpi === kpi && monthOf(r.week) === m).map(r => r.value), "SUM");
  const metricAt = (metric, key, w) => metricValue_(metric, countLeads_(leads.filter(l => l.week === w), sourcesFor(metric, key)),
    { spend: actVal(w, key, "Ad spend (KES)"), visitors: actVal(w, key, "Website visitors") });
  const metricMonth = (metric, key, m) => metricValue_(metric, countLeads_(leads.filter(l => l.month === m), sourcesFor(metric, key)),
    { spend: sumAct_(key, m, "Ad spend (KES)"), visitors: sumAct_(key, m, "Website visitors") });
  return { start, issues, leads, items, commit, acts, actList, monthOf, actVal, cv, committedFor, metricAt, metricMonth, sumAct_ };
}

function computeAll_(d) {
  const e = makeEngine_(d);
  const weekly = [], summary = [], monthlyKpi = [], monthly = [], cards = {};

  // Measure B: weekly commitment delivery
  const pairs = {};
  Object.values(e.commit).concat(e.actList).forEach(r => { pairs[r.week + "|" + r.key] = true; });
  Object.keys(pairs).sort().forEach(pk => {
    const parts = pk.split("|"), week = parts[0], key = parts[1];
    const month = e.monthOf(week);
    let committedN = 0, reportedN = 0, hitN = 0, sumAtt = 0;
    allItems_(e.items, key).forEach(it => {
      const committed = e.committedFor(week, key, it);
      const actual = it.metric ? e.metricAt(it.metric, key, week) : e.actVal(week, key, it.actualKpi || it.kpi);
      const att = attain_(actual, committed, it.dir);
      if (committed != null) committedN++;
      if (att != null) { reportedN++; sumAtt += att; if (att >= 1) hitN++; }
      const status = committed == null ? "Not committed" : (att == null ? "Awaiting actual" : "Reported");
      const target = it.projection || it.t[month - 1] == null ? "" : it.t[month - 1];
      weekly.push([week, month, key, it.projection ? "PROJECTION" : "KPI", it.kpi,
        it.projection ? "Projection (not scored)" : CAT_NAMES[it.cat], it.unit, it.dir, target,
        committed == null ? "" : committed, actual == null ? "" : round1_(actual),
        att == null ? "" : round1_(att * 100), status]);
    });
    summary.push([week, key, committedN, reportedN, hitN, reportedN ? round1_(100 * sumAtt / reportedN) : ""]);
  });

  // Measure A: monthly approved scorecard vs Month 1 / 2 / 3 targets
  SCORECARDS.forEach(key => {
    const its = e.items[key] || [];
    [1, 2, 3].forEach(m => {
      if (!its.length) return;
      const scored = [];
      its.forEach(it => {
        const target = it.t[m - 1];
        const actual = it.metric
          ? e.metricMonth(it.metric, key, m)
          : aggregate_(e.actList.filter(r => r.key === key && r.kpi === it.kpi && e.monthOf(r.week) === m).map(r => r.value), it.agg);
        const att = attain_(actual, target, it.dir);
        const status = actual == null ? "No data" : (target == null ? "No target" : "Reported");
        scored.push({ cat: it.cat, att: att == null ? 0 : att, reported: att != null });
        monthlyKpi.push([m, key, it.kpi, CAT_NAMES[it.cat], it.unit, it.dir, target == null ? "" : target,
          actual == null ? "" : round1_(actual), att == null ? "" : round1_(att * 100), status]);
      });
      const card = scoreCard_(key, scored);
      cards[key + "|" + m] = card;
      monthly.push([m, key].concat(CAT_ORDER.map(c => card.catAvg[c] == null ? "" : round1_(card.catAvg[c] * 100)),
        [card.total == null ? "" : card.total, card.band, card.noData]));
    });
  });
  [1, 2, 3].forEach(m => {
    const a = cards["Dan - Ads|" + m], b = cards["Dan - Website|" + m];
    if (a && b && a.total != null && b.total != null) {
      const t = round1_(DAN_WEIGHTS["Dan - Ads"] * a.total + DAN_WEIGHTS["Dan - Website"] * b.total);
      monthly.push([m, "Dan (combined 70/30)"].concat(CAT_ORDER.map(() => ""), [t, bandOf_(t), a.noData + b.noData]));
    }
  });

  // Data health
  const health = e.issues.slice();
  const legacyC = d.commitments.filter(r => String(r["KPI"] || "").trim() && !String(r["Scorecard Key"] || "").trim()).length;
  if (legacyC) health.push(["Legacy commitment rows ignored (no Scorecard Key)", "WEEKLY_COMMITMENTS", legacyC + " rows", "Ask the employee to resubmit that week"]);
  const legacyA = d.actuals.filter(r => String(r["KPI"] || "").trim() && !String(r["Scorecard Key"] || "").trim()).length;
  if (legacyA) health.push(["Legacy actual rows ignored (no Scorecard Key)", "WEEKLY_ACTUALS", legacyA + " rows", "Re-enter those weeks in the actuals form"]);
  const badSrc = e.leads.filter(l => !SOURCE_OWNER.hasOwnProperty(l.source)).length;
  if (badSrc) health.push(["Leads with an unknown source (not credited)", "LEADS_REGISTER", badSrc + " rows", "Correct the source"]);
  const dups = e.leads.filter(l => l.duplicate).length;
  if (dups) health.push(["Duplicate leads excluded from all KPIs", "LEADS_REGISTER", dups + " rows", "Confirm they are genuine duplicates"]);
  const outside = e.leads.filter(l => !(l.month >= 1 && l.month <= 3)).length;
  if (outside) health.push(["Leads outside the 3-month plan (not scored)", "LEADS_REGISTER", outside + " rows", "Check Lead Date and ProgramStart"]);
  if (!d.start) health.push(["ProgramStart is not set", "CONFIG", "Scores cannot be assigned to months", "Enter the first day of Month 1"]);
  SCORECARDS.forEach(key => [1, 2, 3].forEach(m => {
    const miss = monthlyKpi.filter(r => r[0] === m && r[1] === key && r[9] === "No data").length;
    if (miss) health.push(["KPIs with no actual yet", key + " | Month " + m, miss + " KPIs", "Enter actuals, or record zero"]);
  }));
  if (!health.length) health.push(["All checks passed", "System", "No issues found", "None"]);

  return { weekly, summary, monthlyKpi, monthly, health };
}

// Category score = average KPI attainment in the category x weight. Categories with no KPIs are re-weighted out.
function scoreCard_(key, scored) {
  const w = CATEGORY_WEIGHTS[key] || {};
  const by = {};
  scored.forEach(s => { if (s.cat) (by[s.cat] = by[s.cat] || []).push(s.att); });
  const catAvg = {};
  let pts = 0, wsum = 0;
  Object.keys(w).forEach(c => {
    const a = by[c];
    if (!a || !a.length) return;
    catAvg[c] = a.reduce((x, y) => x + y, 0) / a.length;
    pts += w[c] * catAvg[c];
    wsum += w[c];
  });
  const anyReported = scored.some(s => s.reported);
  const total = anyReported && wsum ? round1_(pts / wsum * 100) : null;
  return { catAvg, total, band: bandOf_(total), noData: scored.filter(s => !s.reported).length };
}

// Attainment = actual / target, capped at 120%. Lower-is-better KPIs use target / actual.
function attain_(actual, target, dir) {
  if (actual == null || target == null) return null;
  const a = Number(actual), t = Number(target);
  if (!isFinite(a) || !isFinite(t)) return null;
  const CAP = HYSSOP.cap;
  if (dir === "Lower is better") {
    if (t === 0) return a === 0 ? 1 : 0;
    if (a === 0) return CAP;
    return Math.min(t / a, CAP);
  }
  if (t === 0) return a > 0 ? CAP : 1;
  return Math.min(a / t, CAP);
}

function bandOf_(t) {
  if (t == null) return "No data";
  if (t >= HYSSOP.bonusMin) return "Bonus-eligible";
  if (t >= HYSSOP.onTrackMin) return "On track";
  return "Coaching plan for next month";
}

function countLeads_(leads, sources) {
  const c = { total: 0, qual: 0, within15: 0, handoff15: 0, sourced: 0, visits: 0, won: 0, plots: 0, value: 0 };
  leads.forEach(l => {
    if (l.duplicate) return;
    if (sources && !sources.includes(l.source)) return;
    c.total++;
    if (l.qualified === "Qualified") c.qual++;
    if (l.within15 === "Yes") c.within15++;
    if (l.handoff15 === "Yes") c.handoff15++;
    if (l.source) c.sourced++;
    if (l.visit === "Completed") c.visits++;
    if (l.sale === "Won") { c.won++; c.plots += l.plots; c.value += l.value; }
  });
  return c;
}

function metricValue_(metric, c, x) {
  const pct = (n, d) => d ? 100 * n / d : null;
  switch (metric) {
    case "LEADS": return c.total;
    case "VISITS": return c.visits;
    case "WON": return c.won;
    case "QUAL_PCT": return pct(c.qual, c.total);
    case "WITHIN15_PCT": return pct(c.within15, c.total);
    case "HANDOFF_PCT": return pct(c.handoff15, c.total);
    case "SOURCED_PCT": return pct(c.sourced, c.total);
    case "CPQL": return (x.spend != null && c.qual > 0) ? x.spend / c.qual : null;
    case "V2E_PCT": return (x.visitors != null && x.visitors > 0) ? 100 * c.total / x.visitors : null;
    default: return null;
  }
}

function aggregate_(vals, agg) {
  const v = vals.filter(x => x != null && isFinite(x));
  if (!v.length) return null;
  const s = v.reduce((a, b) => a + b, 0);
  return agg === "AVG" ? s / v.length : s;
}

function suggestWeekly_(t, unit) {
  if (t == null) return "";
  if (["per week", "per day", "%", "hours", "KES"].includes(unit)) return t;
  if (unit === "reports") return Math.round(t / 4);
  return Math.round(t / 4.33 * 10) / 10;
}

function lastBy_(rows, keyFn) {
  const m = {};
  rows.forEach(r => { m[keyFn(r)] = r; });
  return m;
}

/* ============================ DATA ACCESS ============================ */

function getSS_() { return SpreadsheetApp.openById(HYSSOP.spreadsheetId); }
function getSheet_(tab) {
  const s = getSS_().getSheetByName(tab);
  if (!s) throw new Error("Missing tab: " + tab + ". Run setupHyssopSystem() once from the Apps Script editor.");
  return s;
}
function headers_(s) { return s.getRange(1, 1, 1, s.getLastColumn()).getDisplayValues()[0]; }

function readObjects_(tab) {
  const v = getSheet_(tab).getDataRange().getValues();
  if (v.length < 2) return [];
  const h = v[0].map(String);
  return v.slice(1).filter(r => r.some(c => c !== "" && c !== null)).map(r => {
    const o = {};
    h.forEach((k, i) => { o[k] = r[i]; });
    return o;
  });
}

function readConfig_() {
  const rows = getSheet_(HYSSOP.tabs.config).getDataRange().getValues().slice(1);
  const m = {};
  rows.forEach(r => { if (r[0]) m[String(r[0]).trim()] = r[1]; });
  return {
    programStart: toKey_(m.ProgramStart || ""),
    staffEmails: listCfg_(m.StaffEmails)
  };
}

function loadData_() {
  const cfg = readConfig_();
  return {
    start: cfg.programStart,
    library: readObjects_(HYSSOP.tabs.library),
    commitments: readObjects_(HYSSOP.tabs.commitments),
    actuals: readObjects_(HYSSOP.tabs.actuals),
    leads: readObjects_(HYSSOP.tabs.leads)
  };
}

function appendRows_(tab, objs) {
  if (!objs.length) return;
  const sh = getSheet_(tab), h = headers_(sh);
  const rows = objs.map(o => h.map(k => Object.prototype.hasOwnProperty.call(o, k) ? o[k] : ""));
  const start = sh.getLastRow() + 1, need = start + rows.length - 1;
  if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());   // workbook tabs ship with 1,000 rows
  sh.getRange(start, 1, rows.length, h.length).setValues(rows);
}

function writeTab_(name, headers, rows) {
  const sh = getSheet_(name);
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function rebuildScorecards_() {
  const out = computeAll_(loadData_());
  writeTab_(HYSSOP.tabs.weekly, HEAD.weekly, out.weekly);
  writeTab_(HYSSOP.tabs.summary, HEAD.summary, out.summary);
  writeTab_(HYSSOP.tabs.monthlyKpi, HEAD.monthlyKpi, out.monthlyKpi);
  writeTab_(HYSSOP.tabs.monthly, HEAD.monthly, out.monthly);
  writeTab_(HYSSOP.tabs.health, HEAD.health, out.health);
  return out;
}

// Saves always succeed even if the refresh fails; the owner is told to rebuild.
function refreshSafe_() {
  try { rebuildScorecards_(); return "Scorecards updated."; }
  catch (err) { return "Saved, but the scorecard refresh failed (" + err.message + "). Use Hyssop > Rebuild scorecards."; }
}

/* ============================ ACCESS, VALIDATION, UTILITIES ============================ */

// The email of the person currently using the page ("" if unknown).
function userEmail_() { try { return (Session.getActiveUser().getEmail() || "").toLowerCase(); } catch (e) { return ""; } }

// The email of the account that owns this script (the web app runs as this account).
function ownerEmail_() { try { return (Session.getEffectiveUser().getEmail() || "").toLowerCase(); } catch (e) { return ""; } }

function listCfg_(v) { return String(v || "").split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean); }

// True only when the person using the page is the owner of this script.
function isOwner_() {
  const me = userEmail_();
  return !!me && me === ownerEmail_();
}

// Weekly projection: open to anyone who can reach the web app, unless StaffEmails is filled in.
// The owner always passes.
function isStaff_() {
  try {
    if (isOwner_()) return true;
    const c = readConfig_();
    if (!c.staffEmails.length) return true;
    return c.staffEmails.includes(userEmail_());
  } catch (e) { return false; }
}

function assertOwner_() {
  if (!isOwner_()) throw new Error("This page is only available to the account that owns this system.");
}
function assertStaff_() {
  if (!isStaff_()) throw new Error("Your Google account is not on the staff list. Ask the administrator.");
}

function context_(employee, area, weekStarting) {
  const key = SCORECARD_OF[employee + "|" + area];
  if (!key) throw new Error("Choose a valid employee and reporting area.");
  const week = toKey_(weekStarting);
  if (!week || mondayKey_(week) !== week) throw new Error("Week starting date must be a Monday.");
  const cfg = readConfig_();
  if (!cfg.programStart) throw new Error("ProgramStart is not set in the CONFIG tab, so weeks cannot be assigned to months.");
  const month = programMonth_(week, cfg.programStart);
  if (!(month >= 1 && month <= 3)) throw new Error("That week is outside the 3-month plan (Month 1 to 3).");
  return { key, week, month };
}

function checkPct_(unit, n, label) { if (unit === "%" && n > 100) throw new Error(label + " is a percentage and cannot exceed 100."); }
function required_(p, keys) {
  if (!p) throw new Error("No data received.");
  keys.forEach(k => { if (p[k] === undefined || p[k] === null || String(p[k]).trim() === "") throw new Error("Required field missing: " + k); });
}
function nonNeg_(v, label) {
  const n = Number(v);
  if (v === "" || v === null || v === undefined || !isFinite(n) || n < 0) throw new Error(label + " must be a number, 0 or more.");
  return n;
}
function int_(v, label) { const n = nonNeg_(v, label); if (!Number.isInteger(n)) throw new Error(label + " must be a whole number."); return n; }
function toNum_(v) { if (v === "" || v === null || v === undefined) return null; const n = Number(v); return isFinite(n) ? n : null; }
function round1_(x) { return Math.round(x * 10) / 10; }
function phoneKey_(s) { const d = String(s || "").replace(/\D/g, ""); return d.length >= 9 ? d.slice(-9) : ""; }

function tz_() { return typeof Session !== "undefined" ? Session.getScriptTimeZone() : "UTC"; }
function toKey_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, tz_(), "yyyy-MM-dd");
  const s = String(v == null ? "" : v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  const d = new Date(s);
  return isNaN(d) ? "" : Utilities.formatDate(d, tz_(), "yyyy-MM-dd");
}
function mondayKey_(k) {
  const p = k.split("-").map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function programMonth_(k, start) {
  if (!k || !start) return null;
  const a = k.split("-").map(Number), b = start.split("-").map(Number);
  return (a[0] - b[0]) * 12 + (a[1] - b[1]) + 1;
}
function toDateObj_(k) { return new Date(k + "T12:00:00"); }

/* ============================ SETUP AND MENU ============================ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu("Hyssop")
    .addItem("Rebuild scorecards", "menuRebuild_")
    .addItem("Set up or repair tabs", "setupHyssopSystem")
    .addItem("Install hourly refresh", "installHourlyRefresh")
    .addToUi();
}

function menuRebuild_() { rebuildScorecards_(); SpreadsheetApp.getActive().toast("Scorecards rebuilt."); }
function refreshTrigger_() { rebuildScorecards_(); }

function installHourlyRefresh() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === "refreshTrigger_") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("refreshTrigger_").timeBased().everyHours(1).create();
}

// Run once from the Apps Script editor. Adds missing tabs and columns. Never deletes or rewrites existing data.
function setupHyssopSystem() {
  const ss = getSS_();
  const tabs = {};
  tabs[HYSSOP.tabs.commitments] = HEAD.commitments;
  tabs[HYSSOP.tabs.actuals] = HEAD.actuals;
  tabs[HYSSOP.tabs.leads] = HEAD.leads;
  tabs[HYSSOP.tabs.activities] = HEAD.activities;
  tabs[HYSSOP.tabs.review] = HEAD.review;
  tabs[HYSSOP.tabs.config] = HEAD.config;
  tabs[HYSSOP.tabs.weekly] = HEAD.weekly;
  tabs[HYSSOP.tabs.summary] = HEAD.summary;
  tabs[HYSSOP.tabs.monthlyKpi] = HEAD.monthlyKpi;
  tabs[HYSSOP.tabs.monthly] = HEAD.monthly;
  tabs[HYSSOP.tabs.health] = HEAD.health;

  Object.keys(tabs).forEach(name => {
    const heads = tabs[name];
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    const cur = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(String) : [];
    if (!cur.some(c => c)) {
      sh.getRange(1, 1, 1, heads.length).setValues([heads]);
    } else {
      const missing = heads.filter(h => !cur.includes(h));
      if (missing.length) sh.getRange(1, cur.length + 1, 1, missing.length).setValues([missing]);
    }
    const width = Math.max(sh.getLastColumn(), heads.length);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, width).setBackground("#17365D").setFontColor("#FFFFFF").setFontWeight("bold").setWrap(true);
  });

  const cfg = ss.getSheetByName(HYSSOP.tabs.config);
  if (cfg.getLastRow() < 2) {
    cfg.getRange(2, 1, 2, 3).setValues([
      ["ProgramStart", "", "First day of Month 1, format YYYY-MM-DD. REQUIRED. Month 2 and 3 follow by calendar month."],
      ["StaffEmails", "", "Optional. If filled, only these accounts can use the weekly projection form. Leads and actuals are always owner-only."]
    ]);
  }
  if (!ss.getSheetByName(HYSSOP.tabs.library)) throw new Error("KPI_LIBRARY tab is missing. Upload the company workbook first.");
  Logger.log("Hyssop setup complete. Existing data was not deleted.");
  return "Setup complete. Existing data was not deleted.";
}
