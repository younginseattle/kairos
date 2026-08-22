/**
 * CALIBRATION TESTS — fit scoring model v2
 *
 * These pin the model against five roles with KNOWN real-world outcomes.
 * They are not unit tests of arithmetic; they are a regression harness for
 * judgement. If a future prompt or weight change breaks one of these, the
 * change is wrong until proven otherwise — the history is not negotiable.
 *
 * Run:  node src/scoring.test.mjs
 */

import { computeFit, scoreBand, MODEL_VERSION, shouldAutoPass, MIN_AUTOPASS_CONFIDENCE, scoreExperienceGate, CANDIDATE_YEARS } from "./scoring.js";
import { getCompanyFacts, COMPANY_COUNT } from "./companyFacts.js";

let passed = 0, failed = 0;
const failures = [];

function check(label, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(`${label}${detail ? " — " + detail : ""}`); console.log(`  ✗ ${label}${detail ? " — " + detail : ""}`); }
}

function inRange(label, value, lo, hi) {
  check(`${label}: ${value} in [${lo}, ${hi}]`, value >= lo && value <= hi, `got ${value}`);
}

// ─────────────────────────────────────────────────────────────────
// The five calibration cases, expressed as EXTRACTED SIGNALS —
// i.e. what the LLM is asked to pull out of a JD, never a score.
// ─────────────────────────────────────────────────────────────────

const CASES = {
  bmc: {
    label: "BMC — Senior Director, Control-M + Agentic/Data portfolio",
    outcome: "Advanced deep, strong HM interview, ~$400K TC",
    targetLo: 85, targetHi: 100,
    signals: {
      company: "BMC Software",
      domain: { primary: "non_interchangeable" },      // ITOM/AIOps + agentic platform
      titleBand: "target",                             // Senior Director
      nonInterchangeableMatches: [
        { proof: "mcp_agentic", strength: "direct" },  // built MCP agentic before BMC's Agent Gateway
        { proof: "agent_fleet", strength: "direct" },
        { proof: "telemetry_econ", strength: "partial" },
        { proof: "open_source", strength: "partial" },
      ],
      statedTc: 400,
      locationPosture: "remote",
      knownGaps: [{ gap: "vendor_fluency", level: "preferred" }],
      jdChars: 3200,
    },
  },

  google: {
    label: "Google Cloud — Group PM, ACI Infrastructure",
    outcome: "Multiple rounds completed, ~$400K",
    targetLo: 85, targetHi: 100,
    signals: {
      company: "Google",
      domain: { primary: "non_interchangeable", secondary: "adjacent" }, // infra automation, but compute-primitive layer
      titleBand: "target",                             // Group PM
      nonInterchangeableMatches: [
        { proof: "agent_fleet", strength: "direct" },  // Puppet 10M+ endpoint self-healing fleet
        { proof: "telemetry_econ", strength: "direct" },
        { proof: "open_source", strength: "partial" },
      ],
      statedTc: 400,
      locationPosture: "seattle",
      // Carried a k8s_operators gap until 2026-08-06. Kubernetes, Helm
      // authorship and operator patterns are working knowledge, so the gap
      // key was retired and this anchor no longer claims it.
      knownGaps: [],
      jdChars: 3500,
    },
  },

  coreweave: {
    label: "CoreWeave — Staff PM, Insights",
    outcome: "Reached finals, LOST ON EXPERIENCE-LEVEL MISMATCH, $320K + $100K variable",
    targetLo: 48, targetHi: 64,
    signals: {
      company: "CoreWeave",
      domain: { primary: "non_interchangeable", secondary: "novel" }, // observability ON GPU infra
      titleBand: "staff",                              // Staff PM — its own band, small discount
      nonInterchangeableMatches: [
        { proof: "telemetry_econ", strength: "direct" },
        { proof: "agent_fleet", strength: "partial" },
      ],
      statedBase: 320, statedVariable: 100,
      locationPosture: "hybrid_local",                 // Bellevue
      knownGaps: [{ gap: "gpu_infra", level: "required" }],
      jdChars: 3000,
    },
  },

  elastic: {
    label: "Elastic — Principal PM, AI Agent Builder / Telemetry Collection",
    outcome: "Applied with honest gap acknowledgment on Elastic depth + Helm/K8s operators",
    targetLo: 70, targetHi: 84,
    signals: {
      company: "Elastic",
      domain: { primary: "non_interchangeable" },      // telemetry collection + agentic
      titleBand: "target",                             // Principal PM
      nonInterchangeableMatches: [
        { proof: "telemetry_econ", strength: "direct" },
        { proof: "mcp_agentic", strength: "direct" },
        { proof: "open_source", strength: "partial" },
      ],
      statedTc: null,                                  // not stated — must NOT be imputed
      locationPosture: "remote",
      knownGaps: [
        { gap: "vendor_fluency", level: "required" },  // Elastic product depth
        // The Helm/operators gap this application acknowledged is no longer a
        // gap — retired 2026-08-06. The outcome line above is left as the
        // historical record of what was said at the time.
      ],
      jdChars: 2800,
    },
  },

  salesforceAgentFabric: {
    label: "Salesforce — Product Manager, Agent Fabric  [BUG: scored 90 in production]",
    outcome: "JD Requirements section: '2-4 years in Product Management... L8 candidates "
      + "will have 4-6 years.' Base comp $148.5K-$313.7K (IC band). Matt has 15+ years — "
      + "9 years above the stated ceiling. titleBand below simulates the real misread that "
      + "produced 90: JD is dense with MCP/OTel/agentic keywords, no seniority word in the "
      + "title itself, so title_band got read as target instead of below. The experience "
      + "gate must catch this independent of that misread.",
    targetLo: 25, targetHi: 45,
    signals: {
      company: "Salesforce",
      domain: { primary: "non_interchangeable" },      // MCP, OTel, agent frameworks named explicitly
      titleBand: "target",                              // the misread — gate must still fire
      nonInterchangeableMatches: [
        { proof: "mcp_agentic", strength: "direct" },
        { proof: "telemetry_econ", strength: "direct" },
        { proof: "open_source", strength: "partial" },
      ],
      statedBase: 231,                                  // midpoint of $148.5K-$313.7K
      statedYearsMin: 2, statedYearsMax: 6,              // spans L7 (2-4) through L8 (4-6)
      locationPosture: "remote",
      knownGaps: [],
      jdChars: 3000,
    },
  },

  salesforceHyperforce: {
    label: "Salesforce — Senior Director, Hyperforce",
    outcome: "Correctly senior-level role for comparison — an explicit but OPEN-floor "
      + "experience requirement ('10+ years') must not gate an overqualified read the way "
      + "a bounded range does.",
    targetLo: 85, targetHi: 100,
    signals: {
      company: "Salesforce",
      domain: { primary: "non_interchangeable" },
      titleBand: "target",                              // Senior Director
      nonInterchangeableMatches: [
        { proof: "mcp_agentic", strength: "direct" },
        { proof: "telemetry_econ", strength: "direct" },
        { proof: "agent_fleet", strength: "partial" },
      ],
      statedTc: 400,
      statedYearsMin: 10, statedYearsMax: null,          // "10+ years" — open floor, no ceiling
      locationPosture: "remote",
      knownGaps: [],
      jdChars: 3200,
    },
  },

  gitkraken: {
    label: "GitKraken — CPO  [DECLINED]",
    outcome: "DECLINED — process too extensive, illiquid PE equity, misaligned priorities",
    targetLo: 0, targetHi: 49,
    signals: {
      company: "GitKraken",
      domain: { primary: "non_interchangeable" },      // developer tooling IS a top-band domain
      titleBand: "org_owner",                          // CPO — own the entire product org
      nonInterchangeableMatches: [
        { proof: "gitops_cicd", strength: "direct" },
        { proof: "open_source", strength: "partial" },
      ],
      statedTc: null,
      locationPosture: "hybrid_remote",
      knownGaps: [],
      jdChars: 2400,
    },
  },
};

// ─────────────────────────────────────────────────────────────────

console.log(`\nFIT SCORING CALIBRATION — model ${MODEL_VERSION}, ${COMPANY_COUNT} companies in facts table`);
console.log("=".repeat(76));

const results = {};
for (const [key, c] of Object.entries(CASES)) {
  const r = computeFit(c.signals);
  results[key] = r;
  console.log(`\n${c.label}`);
  console.log(`  actual outcome: ${c.outcome}`);
  console.log(`  subscores: domain ${r.subscores.domain} | level ${r.subscores.level} | non-inter ${r.subscores.non_interchangeability} | comp ${r.subscores.compensation ?? "n/a"} | burden ${r.subscores.burden}`);
  console.log(`  base ${r.math.base} → gaps -${r.math.gap_penalty} → ×${r.math.two_stretch_multiplier} (ds ${r.math.domain_stretch} / ls ${r.math.level_stretch}) → ceiling ${r.math.ceiling}`);
  if (r.gates.length) r.gates.forEach(g => console.log(`  GATE: ${g.reason} → ${g.ceiling}`));
  console.log(`  SCORE ${r.score}  confidence ${r.confidence}%  band: ${r.band.label}`);
  inRange(`  ${key} score`, r.score, c.targetLo, c.targetHi);
}

// ═══════════════════════════════════════════════════════════════
// AUTO-PASS — the only place the pipeline hides a job
// ═══════════════════════════════════════════════════════════════

const strongRole = {
  domain: { primary: "non_interchangeable", secondary: null },
  titleBand: "target",
  nonInterchangeableMatches: [{ proof: "telemetry_econ", strength: "direct" }],
  locationPosture: "remote", knownGaps: [], jdChars: 5000,
};

// The exact shape that buried 943 rows: an uncurated company quoting a base.
// Even scoring low it must stay VISIBLE — a score is not a structural fact.
const uncuratedLowComp = computeFit({ ...strongRole, company: "Nobody Curated Inc", statedBase: 180 });
check("a low-scoring role is no longer hidden on score alone",
  !shouldAutoPass(uncuratedLowComp).pass,
  `score ${uncuratedLowComp.score}, ${shouldAutoPass(uncuratedLowComp).reason}`);

// Structural disqualifiers still hide — no recalibration reverses them.
const cpoRole = computeFit({ ...strongRole, company: "Datadog", titleBand: "org_owner" });
check("an org-owner role IS auto-passed (outside target level band)",
  shouldAutoPass(cpoRole).pass, shouldAutoPass(cpoRole).reason);

const belowRole = computeFit({ ...strongRole, company: "Datadog", titleBand: "below" });
check("a below-Senior-PM role (bare PM / APM) IS auto-passed",
  shouldAutoPass(belowRole).pass, shouldAutoPass(belowRole).reason);

const relocationRole = computeFit({ ...strongRole, company: "Datadog", locationPosture: "office_relocation" });
check("a relocation-required role IS auto-passed",
  shouldAutoPass(relocationRole).pass, shouldAutoPass(relocationRole).reason);

// Staff and Senior PM are accepted bands now, priced by their own discount —
// neither is a structural disqualifier, so neither hides the job.
const staffRole = computeFit({ ...strongRole, company: "Datadog", titleBand: "staff" });
check("a Staff PM role is NOT auto-passed",
  !shouldAutoPass(staffRole).pass, shouldAutoPass(staffRole).reason);

const seniorPmRole = computeFit({ ...strongRole, company: "Datadog", titleBand: "senior_pm" });
check("a Senior PM role is NOT auto-passed",
  !shouldAutoPass(seniorPmRole).pass, shouldAutoPass(seniorPmRole).reason);

// The whole point of the request: accepted but discounted, and the discount
// gets bigger as the title drops a rung — target > staff > senior_pm — while
// none of the three ever trips the outside-target-level-band gate. Comp is
// stated here so the "unverified" gate (ceiling 84) doesn't mask the level
// dimension's effect on score by compressing all three toward the same cap.
const levelCompareRole = { ...strongRole, company: "Datadog", statedTc: 400 };
const targetScore    = computeFit({ ...levelCompareRole, titleBand: "target" }).score;
const staffScore     = computeFit({ ...levelCompareRole, titleBand: "staff" }).score;
const seniorPmScore  = computeFit({ ...levelCompareRole, titleBand: "senior_pm" }).score;
check("staff scores below target — a small discount",
  staffScore < targetScore, `target ${targetScore} vs staff ${staffScore}`);
check("senior_pm scores below staff — the larger of the two discounts",
  seniorPmScore < staffScore, `staff ${staffScore} vs senior_pm ${seniorPmScore}`);
check("senior_pm still clears the below/org_owner gate ceiling (45)",
  seniorPmScore > 45, `senior_pm ${seniorPmScore}`);
check("neither staff nor senior_pm trips the outside-target-level-band gate",
  !staffRole.gates.some(g => g.reason === "outside target level band") &&
  !seniorPmRole.gates.some(g => g.reason === "outside target level band"));

// Relocation is stated as non-negotiable and must be the harshest gate in the
// model — stricter than a title-band miss, even though both auto-pass.
check("relocation gate ceiling is stricter than the title-band-mismatch gate",
  relocationRole.gates.find(g => g.reason === "relocation required").ceiling <
  cpoRole.gates.find(g => g.reason === "outside target level band").ceiling,
  `relocation ${relocationRole.gates.find(g => g.reason === "relocation required").ceiling} vs title-band ${cpoRole.gates.find(g => g.reason === "outside target level band").ceiling}`);

// A comp gate is a calibration artefact, not a structural fact — must not hide.
const compGated = computeFit({ ...strongRole, company: "Nobody Curated Inc", statedBase: 120 });
check("the sub-$300K comp gate does NOT trigger auto-pass",
  compGated.gates.some(g => g.reason.includes("$300K")) && !shouldAutoPass(compGated).pass,
  `score ${compGated.score}, gates ${JSON.stringify(compGated.gates.map(g => g.reason))}`);

// Never hide on evidence we do not trust.
const thinJdBelowBand = computeFit({ ...strongRole, company: "Datadog", titleBand: "below", jdChars: 120 });
check("a thin JD is never auto-passed, even with a structural gate",
  thinJdBelowBand.confidence < MIN_AUTOPASS_CONFIDENCE && !shouldAutoPass(thinJdBelowBand).pass,
  `confidence ${thinJdBelowBand.confidence}%`);

const garbage = computeFit({ ...strongRole, company: "Datadog", domain: { primary: "???" }, titleBand: "???" });
check("a malformed extraction is never auto-passed",
  !shouldAutoPass(garbage).pass,
  `confidence ${garbage.confidence}%, ${shouldAutoPass(garbage).reason}`);

check("shouldAutoPass tolerates a missing fit result",
  !shouldAutoPass(null).pass && !shouldAutoPass(undefined).pass);


console.log("\n" + "=".repeat(76));
console.log("ORDERING + INVARIANTS");

const rank = Object.entries(results).sort((a, b) => b[1].score - a[1].score).map(([k]) => k);
console.log(`  ranking: ${rank.join(" > ")}`);

// The single most important test in this file. GitKraken looks strong on paper
// (developer tooling scores 92 on domain) and must still score below CoreWeave.
check(
  "CRITICAL — GitKraken ranks BELOW CoreWeave (level + comp-liquidity logic works)",
  results.gitkraken.score < results.coreweave.score,
  `gitkraken ${results.gitkraken.score} vs coreweave ${results.coreweave.score}`
);

check("BMC and Google both reach apply-now tier",
  results.bmc.band.key === "apply_now" && results.google.band.key === "apply_now");
check("Elastic lands in apply-if-warranted tier",
  results.elastic.band.key === "apply_if", `got ${results.elastic.band.key}`);
check("CoreWeave lands in warm-intro tier",
  results.coreweave.band.key === "warm_intro", `got ${results.coreweave.band.key}`);
check("GitKraken lands in skip tier",
  results.gitkraken.band.key === "skip", `got ${results.gitkraken.band.key}`);

check("two-stretch multiplier fires for CoreWeave (both axes stretched)",
  results.coreweave.math.two_stretch_multiplier < 1);
check("two-stretch multiplier does NOT fire for Elastic (only one axis at most)",
  results.elastic.math.two_stretch_multiplier === 1);

check("GitKraken hits the outside-target-level-band gate",
  results.gitkraken.gates.some(g => g.reason.includes("level band")));
check("BMC does NOT hit the illiquid-equity gate (cash-heavy package at a PE-owned co)",
  !results.bmc.gates.some(g => g.reason.includes("illiquid")));

console.log("\n" + "=".repeat(76));
console.log("BEHAVIOURAL INVARIANTS");

// ── Title band is the single most consequential extraction field ──
// Lambda's "Manager, Group Product Manager - Platform" — a first-line manager
// owning one product group among several — scored 43 through two model fixes
// because the extraction classified it outside the target band. Everything
// else about the role was right; that one enum cost 42 points.
const lambdaPlatform = {
  company: "Lambda",
  domain: { primary: "non_interchangeable" },
  nonInterchangeableMatches: [
    { proof: "telemetry_econ", strength: "direct" },
    { proof: "usage_metering", strength: "direct" },
  ],
  statedBase: 360.5,
  locationPosture: ["hybrid_local", "hybrid_remote"],
  knownGaps: [{ gap: "gpu_infra", level: "preferred" }],
  jdChars: 6000,
};
const asTarget   = computeFit({ ...lambdaPlatform, titleBand: "target" });
const asOrgOwner = computeFit({ ...lambdaPlatform, titleBand: "org_owner" });

check("a correctly-banded group PM role reaches the apply tiers",
  asTarget.score >= 80, `scored ${asTarget.score}`);
check("misreading it as org_owner costs more than 35 points",
  asTarget.score - asOrgOwner.score > 35,
  `target ${asTarget.score} vs org_owner ${asOrgOwner.score}`);
check("the out-of-band gate is what does the damage",
  asOrgOwner.gates.some(g => g.reason === "outside target level band"));
check("and it makes the role auto-passable — hidden, not just low",
  shouldAutoPass(asOrgOwner).pass === true, shouldAutoPass(asOrgOwner).reason);

// ── Multi-site postings ──────────────────────────────────────────
// The Lambda platform role: "Bellevue or San Francisco, 4 days per week".
// Reading only the Bay Area site turned a 20-minute commute into a 58-point
// burden penalty, and would have tripped the relocation auto-pass if the
// posting had said "relocate to SF or work from Bellevue".
const multiSite = { ...CASES.coreweave.signals, company: "Lambda",
  locationPosture: ["hybrid_local", "hybrid_remote"] };
const sfOnly    = { ...multiSite, locationPosture: "hybrid_remote" };
const localOnly = { ...multiSite, locationPosture: "hybrid_local" };

check("a choice of sites scores on the best option, not the worst",
  computeFit(multiSite).score === computeFit(localOnly).score,
  `${computeFit(multiSite).score} vs local-only ${computeFit(localOnly).score}`);
check("a choice of sites beats being read as Bay-Area-only",
  computeFit(multiSite).score > computeFit(sfOnly).score,
  `${computeFit(multiSite).score} vs ${computeFit(sfOnly).score}`);
check("the offered alternatives are disclosed in the burden explanation",
  /best of 2 offered sites/.test(computeFit(multiSite).explanations.burden),
  computeFit(multiSite).explanations.burden);

const reloOrLocal = computeFit({ ...multiSite, locationPosture: ["office_relocation", "seattle"] });
check("relocation gate does NOT fire when a local option is offered",
  !reloOrLocal.gates.some(g => g.reason === "relocation required"));
check("a relocation-or-local role is therefore never auto-passed",
  shouldAutoPass(reloOrLocal).pass === false, shouldAutoPass(reloOrLocal).reason);

const reloOnly = computeFit({ ...multiSite, locationPosture: ["office_relocation"] });
check("relocation gate still fires when relocation is the only option",
  reloOnly.gates.some(g => g.reason === "relocation required"));

// ── Kubernetes is a strength, not a gap ──────────────────────────
const withStaleK8sGap = computeFit({ ...CASES.elastic.signals,
  knownGaps: [{ gap: "k8s_operators", level: "required" }] });
const withNoGap = computeFit({ ...CASES.elastic.signals, knownGaps: [] });
check("the retired k8s_operators key no longer deducts",
  withStaleK8sGap.math.gap_penalty === withNoGap.math.gap_penalty,
  `${withStaleK8sGap.math.gap_penalty} vs ${withNoGap.math.gap_penalty}`);

const withK8sProof = computeFit({ ...CASES.coreweave.signals,
  nonInterchangeableMatches: [...CASES.coreweave.signals.nonInterchangeableMatches,
    { proof: "k8s_platform", strength: "direct" }] });
check("k8s_platform is creditable as a proof point",
  withK8sProof.subscores.non_interchangeability > results.coreweave.subscores.non_interchangeability,
  `${withK8sProof.subscores.non_interchangeability} vs ${results.coreweave.subscores.non_interchangeability}`);

// ── Platform-role proof points ───────────────────────────────────
// A platform group owning metering/billing and identity/security could cite
// no proof key at all, so a real match capped at 63 on the differentiator.
const platformRole = computeFit({ ...CASES.coreweave.signals, company: "Lambda",
  nonInterchangeableMatches: [
    { proof: "telemetry_econ", strength: "direct" },
    { proof: "usage_metering", strength: "direct" },
    { proof: "identity_security", strength: "partial" },
  ] });
check("metering and identity evidence lifts non-interchangeability above the old cap",
  platformRole.subscores.non_interchangeability > 63,
  `${platformRole.subscores.non_interchangeability}`);

// Unknown is not neutral.
const elasticUnknownCo = computeFit({ ...CASES.elastic.signals, company: "Some Company Nobody Curated" });
check("unknown company lowers confidence",
  elasticUnknownCo.confidence < results.elastic.confidence,
  `${elasticUnknownCo.confidence} vs ${results.elastic.confidence}`);

const thinJd = computeFit({ ...CASES.bmc.signals, jdChars: 150 });
check("thin JD produces visibly low confidence even on a high score",
  thinJd.confidence < 55, `confidence ${thinJd.confidence} on score ${thinJd.score}`);

// ── Experience gate ───────────────────────────────────────────────
// The bug this file exists to pin: Salesforce "Product Manager - Agent
// Fabric" scored 90 in production. Its Requirements section stated
// "2-4 years... L8 candidates 4-6 years" — a literal number the old model
// never read at all. The gate must catch this REGARDLESS of titleBand,
// and must not fire on an open-ended "X+ years" floor.
console.log("\n" + "=".repeat(76));
console.log("EXPERIENCE GATE");

check("no gate when the JD states no explicit years requirement",
  scoreExperienceGate({ statedYearsMin: null, statedYearsMax: null }) === null);

check("no gate for an open-ended '10+ years' floor cleared by 15 years",
  scoreExperienceGate({ statedYearsMin: 10, statedYearsMax: null, candidateYears: 15 }) === null);

check("no gate for a bounded range the candidate sits inside",
  scoreExperienceGate({ statedYearsMin: 10, statedYearsMax: 18, candidateYears: 15 }) === null);

const overGate = scoreExperienceGate({ statedYearsMin: 2, statedYearsMax: 6, candidateYears: CANDIDATE_YEARS });
check("overqualification gates on a bounded upper bound (2-4/4-6 yrs vs 15)",
  overGate && overGate.ceiling <= 38,
  JSON.stringify(overGate));

const underGate = scoreExperienceGate({ statedYearsMin: 12, statedYearsMax: 18, candidateYears: 4 });
check("under-qualification gates symmetrically",
  underGate && underGate.reason.includes("under-qualified"),
  JSON.stringify(underGate));

check("Salesforce Agent Fabric drops from a 90-scoring extraction into a defensible range",
  results.salesforceAgentFabric.score >= 25 && results.salesforceAgentFabric.score <= 45,
  `scored ${results.salesforceAgentFabric.score}`);
check("...and the experience gate is what does it, not titleBand (which is 'target' here)",
  results.salesforceAgentFabric.gates.some(g => g.reason.includes("stated experience requirement")),
  JSON.stringify(results.salesforceAgentFabric.gates));
check("...and it is NOT hidden via auto-pass (title-band-based structural set is untouched)",
  !shouldAutoPass(results.salesforceAgentFabric).pass,
  shouldAutoPass(results.salesforceAgentFabric).reason);

check("Salesforce Hyperforce (correctly senior, open-floor '10+ years') is NOT gated",
  !results.salesforceHyperforce.gates.some(g => g.reason.includes("stated experience requirement")),
  JSON.stringify(results.salesforceHyperforce.gates));
check("...and still reaches apply-now",
  results.salesforceHyperforce.band.key === "apply_now",
  `scored ${results.salesforceHyperforce.score}`);

check("BMC Senior Director (no stated years language at all) is unaffected",
  !results.bmc.gates.some(g => g.reason.includes("stated experience requirement")) &&
  results.bmc.band.key === "apply_now");

const noComp = computeFit({ ...CASES.bmc.signals, statedTc: null, company: "Unknown Co Ltd" });
check("comp unknown + company unknown → comp dimension EXCLUDED, not imputed",
  !noComp.math.dimensions_used.includes("comp"));
check("comp unverified cannot reach apply-now tier (ceiling 84)",
  noComp.score <= 84, `got ${noComp.score}`);

// Compensation units. Found in production: a Microsoft role with a ~$209K base
// came back from the LLM as 208800 (dollars, not thousands). That scored comp
// 95/95 instead of 28 AND slipped past the sub-$300K gate, inflating the role
// from ~55 to 89. The prompt already says "in thousands"; models ignore it.
const dollarsBase = {
  company: "Microsoft",
  domain: { primary: "non_interchangeable", secondary: "adjacent" },
  titleBand: "target",
  nonInterchangeableMatches: [{ proof: "mcp_agentic", strength: "direct" }],
  locationPosture: "seattle",
  knownGaps: [],
  jdChars: 3000,
};
const inDollars   = computeFit({ ...dollarsBase, statedBase: 208800 });
const inThousands = computeFit({ ...dollarsBase, statedBase: 209 });
check("comp stated in dollars is normalised to thousands (208800 -> 209)",
  inDollars.score === inThousands.score,
  `dollars ${inDollars.score} vs thousands ${inThousands.score}`);
check("a ~$209K base does NOT score max compensation",
  inDollars.subscores.compensation < 95, `got ${inDollars.subscores.compensation}`);
// NOTE: this figure no longer trips the sub-$300K gate, and that is correct.
// $209K is a BASE at Microsoft; grossed up it is ~$348K TC, which is genuinely
// above the gate threshold. The gate is exercised against a truly low package
// further down ("genuinely low base still trips the sub-$300K gate").
check("a dollars-denominated figure is not mistaken for a $200M package",
  inDollars.subscores.compensation === inThousands.subscores.compensation);
check("realistic thousands values are left untouched (420 stays 420)",
  computeFit({ ...dollarsBase, statedTc: 420 }).subscores.compensation === 95);

// Base salary is not total comp. Pay-transparency postings state base only, and
// the $400K anchor is a TC anchor — comparing the two directly understated the
// Microsoft Principal PM role enough to trip the sub-$300K gate at ~$209K base
// when the real package is ~$350K.
const basedOnly = computeFit({ ...dollarsBase, statedBase: 209 });
check("stated base at a KNOWN company is grossed up to TC",
  basedOnly.explanations.compensation.includes("grossed up"),
  basedOnly.explanations.compensation);
check("gross-up clears the sub-$300K gate for a ~$209K base at Microsoft",
  !basedOnly.gates.some(g => g.reason.includes("$300K")),
  JSON.stringify(basedOnly.gates.map(g => g.reason)));
check("gross-up is disclosed in confidence reasons, not presented as quoted",
  basedOnly.confidence_reasons.some(r => r.includes("inferred from stated base")));

// An unknown company still grosses up, using the conservative 0.70 default.
// Declining to gross up is not "no assumption" — it is the assumption that base
// IS total comp, which is wrong on essentially every US posting and used to bury
// the role: base < $300K tripped the gate, ceiling 55 landed it at ~54, and
// ingestion auto-passes anything under 55 into a hidden status.
const unknownCo = computeFit({ ...dollarsBase, company: "Nobody Curated Inc", statedBase: 209 });
check("unknown company grosses up using the default cash share",
  unknownCo.explanations.compensation.includes("grossed up"),
  unknownCo.explanations.compensation);
check("the default cash share is labelled as assumed, not stated as fact",
  unknownCo.explanations.compensation.includes("company not in facts table"),
  unknownCo.explanations.compensation);
check("an uncurated gross-up is flagged as the weakest comp read",
  unknownCo.confidence_reasons.some(r => r.includes("DEFAULT cash share")),
  JSON.stringify(unknownCo.confidence_reasons));
// A curated company must still beat an uncurated one on the same figure —
// 0.70 is deliberately more conservative than Microsoft's 0.60.
const curatedCo = computeFit({ ...dollarsBase, statedBase: 209 });
check("curated cash share still beats the conservative default",
  curatedCo.subscores.compensation > unknownCo.subscores.compensation,
  `curated ${curatedCo.subscores.compensation} vs unknown ${unknownCo.subscores.compensation}`);

// The bug this fixes: quoting a salary must not score WORSE than quoting none.
const quotesSalary = computeFit({ ...dollarsBase, company: "Nobody Curated Inc", statedBase: 250 });
const quotesNothing = computeFit({ ...dollarsBase, company: "Nobody Curated Inc", statedBase: null });
check("a $250K base at an uncurated company clears the sub-$300K gate",
  !quotesSalary.gates.some(g => g.reason.includes("$300K")),
  JSON.stringify(quotesSalary.gates.map(g => g.reason)));
// Not "quoting must score at least as well" — a genuinely low salary SHOULD
// score below an unknown one. The bug was the size of the drop: quoting $250K
// used to cost 30 points against silence (54 vs 84) purely because the figure
// was read as total comp. A few points of honest difference is fine; a cliff
// that clears the auto-pass threshold is not.
check("quoting a salary costs a few points against silence, not a cliff",
  quotesNothing.score - quotesSalary.score <= 5,
  `quoted ${quotesSalary.score} vs silent ${quotesNothing.score}`);
check("a quoted-salary role at an uncurated company survives the <55 auto-pass",
  quotesSalary.score >= 55, `score ${quotesSalary.score}`);

// A genuinely low package must still gate even after gross-up.
const trulyLow = computeFit({ ...dollarsBase, statedBase: 140 });
check("genuinely low base still trips the sub-$300K gate after gross-up",
  trulyLow.gates.some(g => g.reason.includes("$300K")),
  `tc after gross-up implies ~$${Math.round(140 / 0.6)}K`);

// base + variable stated together is already a fuller picture — don't gross up.
const baseAndVar = computeFit({ ...dollarsBase, statedBase: 209, statedVariable: 100 });
check("base + variable stated together is NOT grossed up",
  !baseAndVar.explanations.compensation.includes("grossed up"),
  baseAndVar.explanations.compensation);

// The LLM put the ~$209K base midpoint in stated_tc rather than stated_base,
// so the gross-up never fired and the role stayed gated at 55. Field choice is
// unreliable; magnitude is not. A figure well below what this company pays at
// this level is a base figure regardless of which field it arrived in.
const misfiled = computeFit({ ...dollarsBase, statedTc: 209 });
check("a stated_tc far below the company's level band is re-read as base",
  misfiled.explanations.compensation.includes("read as base"),
  misfiled.explanations.compensation);
check("re-read base clears the spurious sub-$300K gate",
  !misfiled.gates.some(g => g.reason.includes("$300K")),
  JSON.stringify(misfiled.gates.map(g => g.reason)));
check("misfiled stated_tc now matches the stated_base path exactly",
  misfiled.score === basedOnly.score, `${misfiled.score} vs ${basedOnly.score}`);

// A genuine, plausible stated TC must NOT be re-read as base.
const genuineTc = computeFit({ ...dollarsBase, statedTc: 400 });
check("a plausible stated TC is left alone (not re-read as base)",
  !genuineTc.explanations.compensation.includes("read as base"),
  genuineTc.explanations.compensation);
check("a plausible stated TC still scores on its own merits",
  genuineTc.subscores.compensation === 95, String(genuineTc.subscores.compensation));

// Unknown company has no level band to compare against — stay conservative.
const misfiledUnknown = computeFit({ ...dollarsBase, company: "Nobody Curated Inc", statedTc: 209 });
check("unknown company does NOT re-read stated_tc as base (no band to judge against)",
  !misfiledUnknown.explanations.compensation.includes("read as base"),
  misfiledUnknown.explanations.compensation);

// Manual overrides.
const overridden = computeFit({ ...CASES.elastic.signals, compVerifiedTc: 420 });
check("manual comp override raises the score above the unverified case",
  overridden.score > results.elastic.score,
  `${overridden.score} vs ${results.elastic.score}`);

// Every score ships with its reasoning.
for (const [k, r] of Object.entries(results)) {
  check(`${k} emits a per-dimension explanation for every scored dimension`,
    Object.entries(r.subscores).every(([dim, v]) => v == null || (r.explanations[dim] || "").length > 0));
}

console.log("\n" + "=".repeat(76));
if (failed === 0) {
  console.log(`ALL ${passed} CHECKS PASSED`);
} else {
  console.log(`${passed} passed, ${failed} FAILED:`);
  failures.forEach(f => console.log(`   ✗ ${f}`));
  process.exit(1);
}
