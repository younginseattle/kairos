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

import { computeFit, scoreBand, MODEL_VERSION } from "./scoring.js";
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
      knownGaps: [{ gap: "k8s_operators", level: "preferred" }],
      jdChars: 3500,
    },
  },

  coreweave: {
    label: "CoreWeave — Staff PM, Insights",
    outcome: "Reached finals, LOST ON EXPERIENCE-LEVEL MISMATCH, $320K + $100K variable",
    targetLo: 50, targetHi: 66,
    signals: {
      company: "CoreWeave",
      domain: { primary: "non_interchangeable", secondary: "novel" }, // observability ON GPU infra
      titleBand: "target",                             // Staff PM — IN the band by title
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
        { gap: "k8s_operators", level: "required" },   // Helm / operators
      ],
      jdChars: 2800,
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

// Unknown is not neutral.
const elasticUnknownCo = computeFit({ ...CASES.elastic.signals, company: "Some Company Nobody Curated" });
check("unknown company lowers confidence",
  elasticUnknownCo.confidence < results.elastic.confidence,
  `${elasticUnknownCo.confidence} vs ${results.elastic.confidence}`);

const thinJd = computeFit({ ...CASES.bmc.signals, jdChars: 150 });
check("thin JD produces visibly low confidence even on a high score",
  thinJd.confidence < 55, `confidence ${thinJd.confidence} on score ${thinJd.score}`);

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
