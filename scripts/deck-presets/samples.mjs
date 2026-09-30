// Sample decks rendered into the preset gallery previews. Figures are illustrative; each deck
// exercises the layouts people use most (charts, tables, process, timeline, cards, KPIs).

const lecture = {
  title: "How Memory **Consolidates**",
  kicker: "Cognitive Psychology · Lecture 4",
  footer: "PSY 201 · Learning & Memory",
  date: "Week 4",
  author: "Department of Psychology",
  slides: [
    { type: "cover", title: "How Memory **Consolidates**", subtitle: "From a fleeting experience to a durable memory, and what that means for how you study.", eyebrow: "Lecture 4", tagline: "Encode, consolidate, retrieve.", kpis: [{ value: "3", label: "Stages of memory" }, { value: "45", unit: "min", label: "Session length" }] },
    { type: "agenda", title: "Today's session", items: [{ title: "Three stages of memory", body: "Encoding, consolidation and retrieval" }, { title: "The forgetting curve", body: "Why most of what we read fades within days" }, { title: "Techniques that work", body: "Spacing, retrieval practice and interleaving" }, { title: "Applying it", body: "A weekly study plan you can use" }] },
    { type: "process", section: "Foundations", title: "Memory is built in **three stages**", subtitle: "Each stage can fail, and each has its own fix", steps: [{ title: "Encoding", body: "Attention turns an experience into a memory trace. Distraction here means nothing is stored.", metric: "Seconds" }, { title: "Consolidation", body: "Sleep and rehearsal stabilise the trace and link it to what you already know.", metric: "Hours to days" }, { title: "Retrieval", body: "Recalling a memory strengthens it, and each successful recall makes the next one easier.", metric: "Every review" }], takeaway: "Studying is not storing; it is **practising retrieval**." },
    { type: "chart", section: "Forgetting", title: "Without review, most new material fades **within a week**", subtitle: "Share of material recalled after learning (%)", chart: { type: "line", title: "Recall over time", unit: "%", categories: ["Day 0", "Day 1", "Day 2", "Day 6", "Day 31"], series: [{ name: "No review", values: [100, 58, 44, 34, 21] }, { name: "Spaced review", values: [100, 92, 89, 86, 80] }] }, insights: [{ title: "The steep drop", body: "About 40% is lost in the first day without review." }, { title: "Spacing flattens it", body: "Short reviews at growing intervals keep recall high." }], source: "Illustrative, after Ebbinghaus (1885)" },
    { type: "cards", section: "Techniques", title: "Three techniques with **strong evidence**", cards: [{ kicker: "Spacing", title: "Spread it out", body: "Review after 1 day, 3 days, then a week. The same hours spaced out beat one long session." }, { kicker: "Retrieval", title: "Test yourself", body: "Close the book and recall. Flashcards and practice questions beat rereading." }, { kicker: "Interleaving", title: "Mix problem types", body: "Alternate topics so you learn to choose the right method, not just repeat one." }] },
    { type: "table", section: "Foundations", title: "Each memory system has its own **capacity and duration**", table: { title: "Memory systems compared", columns: ["System", "Capacity", "Duration", "Study implication"], rows: [["Sensory", "Large", "< 1 second", "Pay attention or it is gone"], ["Working", "About 4 chunks", "15–30 seconds", "Chunk material into groups"], ["Long-term", "Effectively unlimited", "Years", "Build it with spaced retrieval"]], highlight_row: 2 } },
    { type: "section", section: "Applying it", title: "Applying it", subtitle: "Turning the research into a weekly routine" },
    { type: "summary", section: "Applying it", title: "Key takeaways", findings: [{ title: "Memory is a process", body: "Encoding, consolidation and retrieval each need attention." }, { title: "Forgetting is fast", body: "Plan reviews before the curve drops, not after." }, { title: "Test, don't reread", body: "Retrieval practice is the single highest-value habit." }] }
  ]
};

const study = {
  title: "Morning Study Sessions Lift **90-Day Retention**",
  kicker: "Research Methods · Final Study",
  footer: "Microlearning & memory retention study",
  date: "May 2026",
  author: "Study team",
  source: "Illustrative sample data",
  slides: [
    { type: "cover", title: "Morning Study Sessions Lift **90-Day Retention**", subtitle: "A randomised study of study timing, review cadence and long-term memory.", eyebrow: "Final study", kpis: [{ value: "96", label: "Participants per arm" }, { value: "63", unit: "%", label: "Retention at 90 days" }, { value: "6", unit: "weeks", label: "Intervention" }] },
    { type: "kpis", section: "Results", title: "Retention was **twice as high** with spaced morning review", subtitle: "Intervention vs control at 90-day follow-up", kpis: [{ value: "63", unit: "%", label: "Intervention retention", delta: "+32 pts", status: "up" }, { value: "31", unit: "%", label: "Control retention" }, { value: "5.4", unit: "days", label: "Memory half-life", delta: "+3.6 days", status: "up" }, { value: "0.81", label: "Effect size (d)" }] },
    { type: "chart", section: "Results", title: "Morning sessions retained the most, **midday the least**", subtitle: "Share of items recalled at 30 days by session time (%)", chart: { type: "column", title: "Recall by session time", unit: "%", categories: ["Morning", "Midday", "Evening"], series: [{ name: "Recall", values: [58, 44, 51] }], highlight: 0 }, insights: [{ title: "14-point gap", body: "Morning beat midday by 14 points on the same material." }, { title: "Evening in between", body: "Sleep soon after study may help consolidation." }] },
    { type: "table", section: "Method", title: "Two arms, **one variable** changed", table: { title: "Study design", columns: ["Arm", "Participants", "Review cadence", "Session time", "Follow-up"], rows: [["Control", "96", "None", "Self-chosen", "90 days"], ["Intervention", "96", "Days 1, 3, 7, 14", "Self-chosen", "90 days"]], highlight_row: 1 } },
    { type: "process", section: "Method", title: "From recruitment to **90-day follow-up**", steps: [{ title: "Recruit", body: "Online survey; 412 responses screened to 192 eligible students." }, { title: "Randomise", body: "Stratified by baseline score into two equal arms." }, { title: "Intervene", body: "Six weeks of 15-minute daily microlearning sessions." }, { title: "Follow up", body: "Recall tested at 30 and 90 days on held-out items." }] },
    { type: "bignumber", section: "Results", title: "The spaced-review group kept **63%** of what they learned", value: "63", unit: "%", label: "Items recalled at 90 days", body: "Versus 31% in the control group, a gap that held across every subject area tested.", compare: { value: "31", unit: "%", label: "Control group" } },
    { type: "section", section: "Discussion", title: "Discussion", subtitle: "What the results mean, and their limits" },
    { type: "summary", section: "Discussion", title: "Conclusions and limits", findings: [{ title: "Spacing works", body: "A simple review schedule doubled long-term retention." }, { title: "Timing matters", body: "Morning sessions outperformed midday by 14 points." }, { title: "Limits", body: "One university sample; self-reported session times." }], kpis: [{ value: "2×", label: "Retention vs control" }, { value: "+14", unit: "pts", label: "Morning vs midday" }] }
  ]
};

const project = {
  title: "Cutting Campus **Food Waste**",
  kicker: "Group Project · Environmental Studies",
  footer: "Team 4 · Campus Sustainability",
  date: "Spring 2026",
  author: "Team 4",
  source: "Illustrative sample data",
  slides: [
    { type: "cover", title: "Cutting Campus **Food Waste**", subtitle: "A four-week plan to halve plate waste in the main dining hall.", eyebrow: "Group project", tagline: "Measure, nudge, share.", kpis: [{ value: "1.2", unit: "t", label: "Waste per week" }, { value: "−50", unit: "%", label: "Target" }] },
    { type: "agenda", title: "Our presentation", items: [{ title: "The problem", body: "How much food we throw away" }, { title: "What's in the bin", body: "Our waste audit results" }, { title: "Our plan", body: "Three interventions over four weeks" }, { title: "Who does what", body: "Roles and deliverables" }] },
    { type: "cards", section: "Problem", title: "Why dining-hall waste is **so high**", cards: [{ kicker: "Portions", title: "Plates are too full", body: "Fixed portions ignore appetite, so a third of every plate goes uneaten.", metric: { value: "34", unit: "%", label: "Of served food wasted" } }, { kicker: "Trays", title: "Trays invite excess", body: "Students take more when they can carry more.", metric: { value: "2.3", label: "Items per tray" } }, { kicker: "Awareness", title: "No one sees the bin", body: "Waste is out of sight, so habits never change.", metric: { value: "12", unit: "%", label: "Know the figure" } }] },
    { type: "chart", section: "Audit", title: "Starches and vegetables make up **over half** the waste", subtitle: "Plate waste by food type, one-week audit (%)", chart: { type: "donut", title: "Waste composition", unit: "%", points: [{ label: "Starches", value: 31 }, { label: "Vegetables", value: 24 }, { label: "Protein", value: 18 }, { label: "Desserts", value: 15 }, { label: "Other", value: 12 }] }, insights: [{ title: "Starches lead", body: "Rice and pasta portions are the biggest single target." }, { title: "Vegetables next", body: "Better seasoning could cut this share." }] },
    { type: "timeline", section: "Plan", title: "A **four-week** rollout", items: [{ date: "Week 1", title: "Baseline audit", body: "Weigh plate waste at every meal.", tag: "Measure" }, { date: "Week 2", title: "Trayless days", body: "Remove trays Monday to Wednesday.", tag: "Nudge", highlight: true }, { date: "Week 3", title: "Smaller portions", body: "Offer half portions with free seconds.", tag: "Nudge" }, { date: "Week 4", title: "Share results", body: "Post the weekly figure at the exit.", tag: "Share" }] },
    { type: "table", section: "Plan", title: "Clear roles for **every team member**", table: { title: "Team roles", columns: ["Role", "Owns", "Deliverable", "Due"], rows: [["Research lead", "Waste audit", "Audit dataset", "Week 1"], ["Design lead", "Signage & posters", "Poster set", "Week 2"], ["Outreach lead", "Dining staff liaison", "Staff briefing", "Week 2"], ["Analyst", "Before/after comparison", "Results chart", "Week 4"]] } },
    { type: "kpis", section: "Plan", title: "How we will **measure success**", kpis: [{ value: "−50", unit: "%", label: "Plate waste per meal" }, { value: "600", unit: "kg", label: "Waste avoided per week" }, { value: "70", unit: "%", label: "Students aware of the figure" }] },
    { type: "bullets", section: "Plan", title: "Next steps", points: [{ title: "Get approval", body: "Present the plan to dining services this week." }, { title: "Run the audit", body: "Start weighing on Monday with two volunteers per meal." }, { title: "Report back", body: "Share week-four results with the class and the campus paper." }] }
  ]
};

const review = {
  title: "Q3 Operations Review & **Q4 Plan**",
  kicker: "Operations · Quarterly Business Review",
  footer: "Q3 2026 operations review",
  date: "October 2026",
  author: "Operations team",
  source: "Illustrative sample data",
  slides: [
    { type: "cover", title: "Q3 Operations Review & **Q4 Plan**", subtitle: "Volume beat target; three efficiency KPIs missed, all traced to one causal chain.", eyebrow: "Quarterly review", tagline: "Volume up, costs explained.", kpis: [{ value: "326", unit: "k", label: "Orders" }, { value: "105", unit: "%", label: "Of target" }, { value: "5.1", unit: "$", label: "Cost per order" }] },
    { type: "kpis", section: "Scorecard", title: "Volume met target; **three efficiency KPIs** missed", kpis: [{ value: "326", unit: "k", label: "Orders", delta: "+5.2%", status: "met" }, { value: "31", unit: "min", label: "Avg. cycle time", delta: "+3 min", status: "missed" }, { value: "89.1", unit: "%", label: "Uptime", delta: "−2.9 pts", status: "missed" }, { value: "5.1", unit: "$", label: "Cost per order", delta: "+0.5", status: "missed" }] },
    { type: "chart", section: "Volume", title: "Orders rose for **nine straight months**", subtitle: "Monthly orders (thousands)", chart: { type: "column", title: "Monthly orders", unit: "k", categories: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"], series: [{ name: "Orders", values: [82, 86, 91, 95, 99, 104, 106, 109, 111] }], highlight: 8 } },
    { type: "chart", section: "Cost", title: "The **$0.50 overrun** is fully explained", subtitle: "Change in cost per order, Q2 to Q3 ($)", chart: { type: "waterfall", title: "Cost bridge", unit: "$", points: [{ label: "Q2 cost", value: 4.6, total: true }, { label: "Maintenance", value: 0.2 }, { label: "Battery swaps", value: 0.15 }, { label: "Remote takeover", value: 0.1 }, { label: "Other", value: 0.05 }, { label: "Q3 cost", value: 5.1, total: true }] } },
    { type: "table", section: "Scorecard", title: "Scorecard: target vs **actual**", table: { title: "Q3 scorecard", columns: ["Metric", "Target", "Actual", "Gap", "Status"], rows: [["Orders (k)", "310", "326", "+16", "Met"], ["Cycle time (min)", "28", "31", "+3", "Missed"], ["Uptime (%)", "92.0", "89.1", "−2.9", "Missed"], ["Cost per order ($)", "4.6", "5.1", "+0.5", "Missed"]], highlight_row: 0 } },
    { type: "section", section: "Q4 plan", title: "Q4 plan", subtitle: "Three fixes, one owner each" },
    { type: "process", section: "Q4 plan", title: "Three fixes to **recover efficiency**", steps: [{ title: "Stabilise uptime", body: "Weatherproof the charging bays before the rainy season.", metric: "Oct" }, { title: "Cut cycle time", body: "Re-route the two slowest zones and add a handoff buffer.", metric: "Nov" }, { title: "Lower unit cost", body: "Renegotiate battery swaps and reduce remote takeovers.", metric: "Dec" }] },
    { type: "decision", section: "Q4 plan", title: "Decisions needed **today**", items: [{ title: "Approve the charging-bay upgrade", body: "$120k, payback in five months.", owner: "COO", due: "Oct 15", status: "For vote" }, { title: "Pilot re-routing in two zones", body: "Four-week pilot, reversible.", owner: "Ops lead", due: "Oct 20", status: "Ready" }] }
  ]
};

const memo = {
  title: "Investment Case: **Regional Logistics** Platform",
  kicker: "Investment Committee · Final Memo",
  footer: "Project Harbor · Confidential draft",
  date: "July 2026",
  author: "Deal team",
  source: "Illustrative sample data",
  slides: [
    { type: "cover", title: "Investment Case: **Regional Logistics** Platform", subtitle: "Proceed at a lower entry value; returns depend on route density, not new cities.", eyebrow: "Investment memo", tagline: "Conditional approval recommended.", kpis: [{ value: "33.5", unit: "$m", label: "Proposed value" }, { value: "21", unit: "%", label: "Base-case IRR" }, { value: "2.4", unit: "×", label: "MOIC" }] },
    { type: "summary", section: "Summary", title: "Attractive asset; **price and cash quality** need work", findings: [{ title: "Market", body: "Consolidating region growing 11% a year; target is number two." }, { title: "Earnings", body: "Adjusted EBITDA margin of 13.6%, but cash conversion lags at 46%." }, { title: "Recommendation", body: "Proceed at 11.8% below the seller's ask, with an earn-out." }], kpis: [{ value: "13.6", unit: "%", label: "EBITDA margin" }, { value: "46", unit: "%", label: "Cash conversion" }] },
    { type: "chart", section: "Market", title: "Revenue has compounded at **18% a year**", subtitle: "Revenue and EBITDA ($m)", chart: { type: "column", title: "Revenue and EBITDA", unit: "$m", categories: ["2022", "2023", "2024", "2025"], series: [{ name: "Revenue", values: [48, 57, 66, 79] }, { name: "EBITDA", values: [5.1, 6.9, 8.6, 10.7] }] } },
    { type: "chart", section: "Valuation", title: "Value bridge from the **seller's ask**", subtitle: "Enterprise value ($m)", chart: { type: "waterfall", title: "Valuation bridge", unit: "$m", points: [{ label: "Seller ask", value: 38, total: true }, { label: "Cash conversion", value: -2.6 }, { label: "Capex catch-up", value: -1.4 }, { label: "Synergies", value: 1.2 }, { label: "Earn-out", value: -1.7 }, { label: "Our offer", value: 33.5, total: true }] } },
    { type: "table", section: "Valuation", title: "Three scenarios; **base case** clears the hurdle", table: { title: "Returns by scenario", columns: ["Scenario", "Probability", "Exit EV ($m)", "IRR", "MOIC"], rows: [["Downside", "25%", "41", "9%", "1.4×"], ["Base", "55%", "68", "21%", "2.4×"], ["Upside", "20%", "92", "31%", "3.3×"]], highlight_row: 1 } },
    { type: "section", section: "Risks", title: "Risks", subtitle: "What could break the case" },
    { type: "matrix", section: "Risks", title: "Most risk sits in **integration**, not the market", x_axis: { label: "Likelihood", low: "Low", high: "High" }, y_axis: { label: "Impact", low: "Low", high: "High" }, quadrants: [{ title: "Mitigate now", body: "High impact, likely.", items: ["Cash conversion", "Key-client churn"] }, { title: "Monitor", body: "High impact, less likely.", items: ["Fuel prices"] }, { title: "Accept", body: "Low impact, likely.", items: ["IT migration delays"] }, { title: "Ignore", body: "Low impact, unlikely.", items: ["Brand confusion"] }] },
    { type: "decision", section: "Risks", title: "Committee **decision requested**", items: [{ title: "Approve entry at $33.5m", body: "With a $1.7m earn-out tied to cash conversion above 60%.", owner: "IC", due: "Jul 24", status: "For vote" }, { title: "Confirm 100-day plan", body: "Working-capital programme and pricing review.", owner: "Deal team", due: "Aug 1", status: "Ready" }] }
  ]
};

const pitch = {
  title: "Brightloop: **Smarter Energy** for Small Buildings",
  kicker: "Brightloop · Seed Round",
  footer: "Brightloop · Investor presentation",
  date: "2026",
  author: "Brightloop",
  source: "Illustrative sample data",
  slides: [
    { type: "cover", title: "Brightloop: **Smarter Energy** for Small Buildings", subtitle: "Plug-in sensors and software that cut small-building energy bills by a fifth.", eyebrow: "Seed round", tagline: "Less energy, zero retrofits.", kpis: [{ value: "18", unit: "%", label: "Average bill saving" }, { value: "140", label: "Buildings live" }] },
    { type: "statement", section: "Problem", statement: "Small buildings waste **a third of their energy**, and nobody is watching the meter.", attribution: "Why we started Brightloop", points: [{ title: "No building manager", body: "Owners run heating on timers set years ago." }, { title: "Retrofits are costly", body: "Traditional building-management systems cost too much for small sites." }] },
    { type: "cards", section: "Solution", title: "Three steps, **no retrofit**", cards: [{ kicker: "01", title: "Plug in", body: "Wireless sensors install in under an hour per floor." }, { kicker: "02", title: "Learn", body: "Software maps occupancy and heat loss within two weeks." }, { kicker: "03", title: "Save", body: "Automatic schedules cut waste; owners see savings monthly." }] },
    { type: "chart", section: "Market", title: "A **$9bn** market that big vendors ignore", subtitle: "Addressable market by segment ($bn)", chart: { type: "hbar", title: "Market by segment", unit: "$bn", points: [{ label: "Offices < 5,000 m²", value: 3.4 }, { label: "Retail units", value: 2.6 }, { label: "Schools", value: 1.8 }, { label: "Clinics", value: 1.2 }], highlight: 0 } },
    { type: "chart", section: "Traction", title: "Buildings live have grown **6× in a year**", subtitle: "Buildings using Brightloop, by quarter", chart: { type: "line", title: "Buildings live", categories: ["Q2 25", "Q3 25", "Q4 25", "Q1 26", "Q2 26"], series: [{ name: "Buildings", values: [23, 41, 67, 102, 140] }] }, insights: [{ title: "Net revenue retention", body: "128%, as owners add more sites." }, { title: "Payback", body: "Customers recover the cost in seven months." }] },
    { type: "section", section: "Plan", title: "The plan", subtitle: "Where the seed round takes us" },
    { type: "timeline", section: "Plan", title: "From **140 to 1,000** buildings", items: [{ date: "Q3 2026", title: "Close seed", body: "Hire sales and install teams.", tag: "$3m" }, { date: "Q1 2027", title: "Two new cities", body: "Partner with regional installers.", tag: "400 buildings", highlight: true }, { date: "Q4 2027", title: "Series A ready", body: "1,000 buildings and $4m ARR.", tag: "1,000 buildings" }] },
    { type: "kpis", section: "Plan", title: "The **ask**", kpis: [{ value: "3", unit: "$m", label: "Seed round" }, { value: "18", unit: "months", label: "Runway" }, { value: "1,000", label: "Buildings by end of 2027" }] }
  ]
};

export const SAMPLES = { lecture, study, project, review, memo, pitch };

// Which sample each gallery category previews with.
export const SAMPLE_FOR_CATEGORY = {
  lecture: "lecture",
  research: "study",
  group: "project",
  class: "project",
  business: "review",
  report: "review",
  finance: "memo",
  pitch: "pitch",
  marketing: "pitch"
};
