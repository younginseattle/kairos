/**
 * ═══════════════════════════════════════════════════════════════
 * FIT SCORING MODEL v2
 *
 * Replaces the v1 design in which an LLM was asked to emit an
 * `overall_score` 0-100 directly. That produced a distribution with 33% of
 * all jobs landing on the single value 72 and half the pipeline inside a
 * 13-point band, because the rubric's dominant axis (domain x company tier)
 * had already been collapsed upstream by the ingestion filters — every job
 * reaching the model was already domain-matched and tier-1.
 *
 * ARCHITECTURE
 *   The LLM extracts EVIDENCE. This module computes the SCORE.
 *   The LLM never emits a fit number, so it cannot regress toward 70-85.
 *
 *   signals (from LLM + company facts)  ->  deterministic arithmetic  ->  score
 *
 * FORMULA
 *   base         = weighted mean over AVAILABLE dimensions
 *                  (unknown dimensions are excluded and weights renormalise;
 *                   a missing signal is never imputed as a neutral middle value)
 *   afterGaps    = base - known-gap deductions (capped at -20)
 *   afterStretch = afterGaps x (1 - 0.40 x domainStretch x levelStretch)
 *   final        = min(afterStretch, lowest applicable gate ceiling)
 *
 * The two-stretch term is MULTIPLICATIVE by design: it only bites when a role
 * is simultaneously a domain stretch and a level stretch. One stretch alone is
 * already priced into its own additive dimension. This is the CoreWeave lesson
 * — finals reached, lost on stated experience-level mismatch, where observability
 * strength masked the fact that GPU-infra novelty and level friction compounded.
 * ═══════════════════════════════════════════════════════════════
 */

import { getCompanyFacts } from "./companyFacts.js";

export const MODEL_VERSION = "fit-v2";

export const WEIGHTS = {
  domain:   0.30,  // domain proximity          — heaviest
  level:    0.25,  // level fit                 — second heaviest
  nonInter: 0.20,  // non-interchangeability    — the differentiator
  comp:     0.15,  // compensation realism
  burden:   0.10,  // process & life burden
};

const TWO_STRETCH_K = 0.40;  // max compounding loss when BOTH axes stretched
const STRETCH_SPAN  = 60;    // points below 85 that map to full stretch
const MAX_GAP_PENALTY = 20;

export const BANDS = [
  { min: 85, key: "apply_now",    label: "Apply now — tailor a resume" },
  { min: 70, key: "apply_if",     label: "Apply if the JD warrants the effort" },
  { min: 50, key: "warm_intro",   label: "Only with a warm introduction" },
  { min: 0,  key: "skip",         label: "Skip" },
];

export function scoreBand(score) {
  return BANDS.find(b => score >= b.min) || BANDS[BANDS.length - 1];
}

// ─────────────────────────────────────────────────────────────────
// DIMENSION 1 — DOMAIN PROXIMITY
// ─────────────────────────────────────────────────────────────────

const DOMAIN_CLASS_SCORE = {
  // Roles where Matt built the thing the JD describes, not roles his
  // experience "maps to": observability/telemetry, ITOM/AIOps, network and
  // IT ops management, infrastructure automation, agentic/MCP, dev tooling.
  non_interchangeable: 92,
  // General cloud infra, data platform, SRE tooling, security operations.
  adjacent: 68,
  // GPU infra, MicroVM/Firecracker, ML training platforms and MLflow
  // ownership, consumer, fintech, healthcare, martech.
  novel: 30,
};

/**
 * A role is frequently a blend — CoreWeave "Insights" is observability
 * (non-interchangeable) delivered on GPU infrastructure (novel). Scoring only
 * the primary class would hide exactly the risk that cost the offer.
 */
export function scoreDomain({ primary, secondary = null }) {
  const p = DOMAIN_CLASS_SCORE[primary];
  if (p == null) return { score: null, note: `unknown domain class "${primary}"` };
  if (!secondary || !DOMAIN_CLASS_SCORE[secondary]) {
    return { score: p, note: `${primary.replace(/_/g, "-")} domain` };
  }
  const s = DOMAIN_CLASS_SCORE[secondary];
  const blended = Math.round(p * 0.6 + s * 0.4);
  return { score: blended, note: `${primary.replace(/_/g, "-")} primary blended with ${secondary} secondary` };
}

// ─────────────────────────────────────────────────────────────────
// DIMENSION 2 — LEVEL FIT
//
// Title band alone is insufficient and gets the calibration set wrong.
// CoreWeave's "Staff PM" reads one rung below target, so a title-only model
// assigns no level stretch, the compounding penalty never fires, and the role
// scores ~70 instead of ~54. Level fit must combine the title band with
// whether this company reads a VP background as an asset or a mismatch.
//
// Staff and Senior PM are accepted bands, not gated ones — he will look at
// both — but they are a real rung below the Director/Group-PM/Principal band
// he is actually targeting, so each carries its own, larger, discount.
// ─────────────────────────────────────────────────────────────────

const LEVEL_MATRIX = {
  // target band = Senior Director, Group PM, Principal PM. The band he wants.
  target: { asset: 95, neutral: 78, mismatch: 58 },
  // Staff PM — one rung below target on the IC ladder. Small discount.
  staff: { asset: 88, neutral: 73, mismatch: 53 },
  // Director — adjacent to target, fine at an established company
  director: { asset: 88, neutral: 74, mismatch: 56 },
  // VP of Product at a large company where the role is scoped, not "own everything"
  vp_scoped: { asset: 72, neutral: 60, mismatch: 45 },
  // CPO / VP-of-everything — owning an entire product org again. Deliberately avoided.
  org_owner: { asset: 30, neutral: 22, mismatch: 18 },
  // Senior PM — a further rung below Staff on the IC ladder. Larger discount
  // than Staff, but still an accepted band: not gated as "outside target
  // level band" the way below/org_owner/non_pm are.
  senior_pm: { asset: 75, neutral: 60, mismatch: 42 },
  // Below Senior PM — a bare "Product Manager", Associate PM, or PM I/II with
  // no seniority modifier at all.
  below: { asset: 22, neutral: 18, mismatch: 14 },
  // Engineering role wearing product language
  non_pm: { asset: 15, neutral: 12, mismatch: 10 },
};

export function scoreLevel({ titleBand, companyFacts, tier = null }) {
  const row = LEVEL_MATRIX[titleBand];
  if (!row) return { score: null, note: `unknown title band "${titleBand}"` };

  // Unknown company -> neutral column. This is NOT imputing a middle value for
  // the dimension; it is the honest reading of "we don't know how they'd see it",
  // and the caller separately drops confidence for the unknown company.
  let vp = companyFacts?.vpBackground || "neutral";
  const effTier = tier || companyFacts?.tier;

  // A small company hiring at target/staff band still means being the whole
  // product function. That is the scope Matt is deliberately stepping back
  // from, regardless of what the title says.
  if (effTier === "small" && (titleBand === "target" || titleBand === "director" || titleBand === "staff")) {
    vp = "mismatch";
  }
  const score = row[vp];
  const noteBits = [`${titleBand.replace(/_/g, " ")} title band`];
  if (companyFacts) noteBits.push(`VP background reads as ${vp} here`);
  else noteBits.push("company unknown — neutral read");
  if (effTier === "small") noteBits.push("small company: whole product function");
  return { score, note: noteBits.join("; ") };
}

// ─────────────────────────────────────────────────────────────────
// DIMENSION 3 — NON-INTERCHANGEABILITY
//
// The differentiator. Score up only when the JD describes a specific problem
// already solved with NAMED evidence; score down when the match is generic
// senior-product-leader vocabulary.
// ─────────────────────────────────────────────────────────────────

export const PROOF_POINTS = {
  mcp_agentic:    "MCP-based agentic infrastructure built at Domotz before BMC announced Agent Gateway",
  telemetry_econ: "High-cardinality telemetry and observability economics from VMware Wavefront",
  agent_fleet:    "Agent-based fleet management at 10M+ endpoint scale from Puppet",
  gitops_cicd:    "GitOps and CI/CD from Puppet Pipelines (Disney)",
  open_source:    "OpenStack / CNCF / CDF open source track record, co-created Monasca",
  // Added after the Lambda diagnosis: a platform-group role built on
  // metering/billing and identity/security could cite no proof point at all,
  // so a genuinely strong match topped out at 63 on the differentiator.
  usage_metering: "Consumption-based pricing and metering for telemetry ingestion at Wavefront; SaaS ARR, pricing and retention ownership at Domotz",
  identity_security: "Enterprise RBAC, policy and compliance surfaces across Fortune 100 fleets at Puppet; network security monitoring at Domotz",
  k8s_platform:   "Working Kubernetes platform knowledge — Helm chart authorship, operator patterns, cloud-native telemetry at 200K+ containers per cluster",
};

const BASE_NON_INTER = 30;
const DIRECT_CREDIT  = 22;
const PARTIAL_CREDIT = 11;
// A proof point that answers a peripheral mention in the JD — one bullet
// among many, a value-story aside, a nice-to-have — is not the same evidence
// as one that answers the role's core, load-bearing ask. Full credit for a
// peripheral hit let keyword co-occurrence pass as equivalence: the Pulumi
// "Senior/Principal PM, Open Source" JD cited real proof for "open source"
// track record while its actual center of gravity — CLI/DevUX craft — went
// unscored because nothing in the vocabulary could dock it. Peripheral
// matches still count, just at half weight.
const PERIPHERAL_DISCOUNT = 0.5;

export function scoreNonInterchangeability(matches = []) {
  let score = BASE_NON_INTER;
  const cited = [];
  for (const m of matches) {
    const key = typeof m === "string" ? m : m.proof;
    const strength = typeof m === "string" ? "direct" : (m.strength || "direct");
    const centrality = typeof m === "string" ? "core" : (m.centrality || "core");
    if (!PROOF_POINTS[key]) continue;
    let credit = strength === "direct" ? DIRECT_CREDIT : PARTIAL_CREDIT;
    if (centrality === "peripheral") credit *= PERIPHERAL_DISCOUNT;
    score += credit;
    cited.push(`${key} (${strength}${centrality === "peripheral" ? ", peripheral" : ""})`);
  }
  score = Math.min(Math.round(score), 95);
  return {
    score,
    note: cited.length
      ? `named evidence: ${cited.join(", ")}`
      : "no named proof point matched — generic senior-product overlap only",
  };
}

// ─────────────────────────────────────────────────────────────────
// DIMENSION 4 — COMPENSATION REALISM
//
// Anchor ~$400K TC, cash-heavy. Liquid equity is worth materially more than
// illiquid PE or early-stage paper. Unstated comp returns null so the caller
// excludes the dimension entirely — it is never imputed.
// ─────────────────────────────────────────────────────────────────

const TC_BAND_ESTIMATE = { top: 420, strong: 370, mid: 310, below: 250 };

/**
 * Typical cash share of total comp. This matters more than it looks: applying a
 * liquidity discount to the WHOLE package wrongly punishes a cash-heavy offer at
 * a PE-owned company. A $400K cash-heavy package at BMC is not an
 * "illiquid-equity-heavy" package — the illiquid paper is a small slice of it.
 * Only the equity slice should be discounted.
 */
function cashShareFor(companyFacts) {
  if (!companyFacts) return 0.70;
  const { ownership, tier } = companyFacts;
  if (tier === "small" || ownership === "startup") return 0.55;  // equity-upside pitch
  if (ownership === "pe")     return 0.85;                        // PE pays cash, paper is thin
  if (ownership === "public") return 0.60;
  return 0.65;                                                    // private growth
}

/**
 * The extraction prompt asks for compensation in thousands ("320" for $320,000),
 * but models routinely return raw dollars instead. Observed in production: a
 * Microsoft role with a ~$209K base came back as 208800, which scored comp 95/95
 * instead of 28 AND slipped past the sub-$300K gate (208800 > 300) that should
 * have capped the whole role at 55 — an ~34-point error from a units mismatch.
 *
 * No plausible role in this search has a $2M+ package, so anything above 2000 is
 * unambiguously dollars. Normalising here rather than in the prompt because
 * prompt instructions are advisory and this failure is silent.
 */
export function normalizeTcThousands(v) {
  if (v == null || !Number.isFinite(v)) return null;
  return v > 2000 ? v / 1000 : v;
}

export function scoreCompensation({ statedTc = null, statedBase = null, statedVariable = null, companyFacts = null }) {
  const equity = companyFacts?.equity || null;

  statedTc       = normalizeTcThousands(statedTc);
  statedBase     = normalizeTcThousands(statedBase);
  statedVariable = normalizeTcThousands(statedVariable);

  // US pay-transparency postings state a BASE range; total comp is essentially
  // never quoted, because it requires an RSU grant and bonus target the posting
  // does not contain. So a figure landing in stated_tc that sits well below what
  // this company pays at this level is a base figure in the wrong field.
  //
  // Observed twice now on the same Microsoft role: first the model returned
  // dollars instead of thousands, then — after that was fixed — it put the
  // ~$209K base midpoint in stated_tc rather than stated_base, so the gross-up
  // never fired and the sub-$300K gate capped a ~$350K package at 55. Field
  // choice is not reliable, so this is inferred from magnitude instead.
  let reinterpretedAsBase = false;
  if (statedTc != null && statedBase == null && companyFacts?.tcBand) {
    const expected = TC_BAND_ESTIMATE[companyFacts.tcBand];
    if (statedTc < expected * 0.75) {
      statedBase = statedTc;
      statedTc = null;
      reinterpretedAsBase = true;
    }
  }

  // Heavy variable comp is not equivalent to guaranteed base. Discount it 50%.
  let tc = statedTc;
  let grossedUp = false;
  if (tc == null && statedBase != null) {
    tc = statedBase + (statedVariable != null ? statedVariable * 0.5 : 0);

    // Base salary is NOT total comp, and the $400K anchor is a TC anchor.
    // Most large-company postings state base only (pay-transparency law), so
    // comparing a base figure against a TC anchor understates the package by
    // roughly the equity share. Observed: a Microsoft Principal PM role listing
    // a ~$209K base scored comp 28 and tripped the sub-$300K gate — a gate meant
    // for genuinely low-paying roles — when the real package is ~$350K.
    //
    // This used to gross up ONLY for companies in the facts table, on the
    // reasoning that an uncurated cash share would be a guess. That was the
    // wrong call: declining to gross up is not "no guess", it is the implicit
    // guess that cash share = 100%, i.e. that base IS total comp. That guess is
    // wrong in a known direction on essentially every US posting, and it
    // compounded — base < $300K tripped the sub-$300K gate, ceiling 55 put the
    // role at ~54, and ingestion auto-passes anything under 55 into a hidden
    // status. The net effect was that an uncurated company quoting its salary
    // got buried while the identical role at a curated company scored 90, and
    // quoting no salary at all scored better than quoting one.
    //
    // So gross up either way, using the curated cash share when we have it and a
    // conservative 0.70 default when we do not. Confidence already drops for an
    // unknown company, and the note below says which share was used.
    if (statedVariable == null) {
      tc = tc / cashShareFor(companyFacts);
      grossedUp = true;
    }
  }

  let estimated = false;
  if (tc == null) {
    if (!companyFacts?.tcBand) {
      return { score: null, tc: null, estimated: false, equityShare: null, note: "compensation not stated and company unknown — dimension excluded, confidence reduced" };
    }
    tc = TC_BAND_ESTIMATE[companyFacts.tcBand];
    estimated = true;
  }

  const cashShare = cashShareFor(companyFacts);
  const equityShare = 1 - cashShare;
  const liquidityFactor = equity === "liquid" ? 1.0 : equity === "semi" ? 0.80 : equity === "illiquid" ? 0.55 : 0.85;
  const effective = tc * cashShare + tc * equityShare * liquidityFactor;

  // Map effective TC against the ~$400K cash-heavy anchor.
  let score;
  if      (effective >= 400) score = 95;
  else if (effective >= 360) score = 85;
  else if (effective >= 320) score = 74;
  else if (effective >= 280) score = 60;
  else if (effective >= 240) score = 44;
  else                        score = 28;

  const noteBits = [];
  if (grossedUp) {
    const src = reinterpretedAsBase
      ? `quoted ~$${Math.round(statedBase)}K read as base (postings quote base, not TC)`
      : `stated base ~$${Math.round(statedBase)}K`;
    const shareSrc = companyFacts ? "at this company" : "assumed — company not in facts table";
    noteBits.push(`${src} grossed up to ~$${Math.round(tc)}K TC (${Math.round(cashShare * 100)}% cash, ${shareSrc})`);
  } else {
    noteBits.push(`${estimated ? "estimated" : "stated"} TC ~$${Math.round(tc)}K`);
  }
  if (equity) noteBits.push(`${Math.round(equityShare * 100)}% ${equity} equity`);
  noteBits.push(`effective ~$${Math.round(effective)}K vs $400K anchor`);
  return { score, tc, effective, estimated, grossedUp, equityShare, note: noteBits.join(", ") };
}

// ─────────────────────────────────────────────────────────────────
// DIMENSION 5 — PROCESS & LIFE BURDEN
//
// Only what is genuinely inferable from a posting. "Multi-month interview
// gauntlet" is not knowable from a JD — it is a manual override field, set
// after a recruiter call, not something this model pretends to infer.
// ─────────────────────────────────────────────────────────────────

const LOCATION_POSTURE_SCORE = {
  remote:            92,  // genuinely remote
  seattle:           90,  // Seattle / WA local
  hybrid_local:      82,  // hybrid, Seattle area
  hybrid_remote:     32,  // hybrid requiring regular Bay Area (or other) presence
  office_relocation: 18,  // requires moving
};

/**
 * A posting that offers a CHOICE of sites — "Bellevue or San Francisco" — is
 * not a Bay Area role. The candidate picks, so the role should be scored on
 * the option he would actually take.
 *
 * This was worth 58 points of burden on the Lambda platform role: the enum is
 * single-valued, the extraction prompt says "be literal", so naming SF at all
 * could pull the posture to hybrid_remote (32) when Bellevue (90) was on the
 * table the whole time. Accepts a string or an array; an array resolves to its
 * best-scoring member.
 */
export function bestPosture(locationPosture) {
  if (!Array.isArray(locationPosture)) return locationPosture;
  const known = locationPosture.filter(p => LOCATION_POSTURE_SCORE[p] != null);
  if (!known.length) return locationPosture[0];
  return known.reduce((a, p) => LOCATION_POSTURE_SCORE[p] > LOCATION_POSTURE_SCORE[a] ? p : a);
}

export function scoreBurden({ locationPosture, onCall = false, travelHeavy = false, companyFacts = null, burdenOverride = null }) {
  if (burdenOverride != null) {
    return { score: burdenOverride, note: `manual override (${burdenOverride}) — verified after recruiter contact` };
  }
  const offered = Array.isArray(locationPosture) ? locationPosture : null;
  const posture = bestPosture(locationPosture);
  const base = LOCATION_POSTURE_SCORE[posture];
  if (base == null) return { score: null, note: `unknown location posture "${posture}"` };

  let score = base;
  const bits = [posture.replace(/_/g, " ")];
  if (offered && offered.length > 1) {
    bits.push(`best of ${offered.length} offered sites (${offered.map(p => p.replace(/_/g, " ")).join(" / ")})`);
  }
  if (onCall)      { score -= 12; bits.push("on-call / always-on signals (-12)"); }
  if (travelHeavy) { score -= 10; bits.push("heavy travel (-10)"); }
  if (companyFacts?.tier === "growth") { score -= 8; bits.push("hyper-growth intensity (-8)"); }
  if (companyFacts?.tier === "small")  { score -= 12; bits.push("small company: wear every hat (-12)"); }

  return { score: Math.max(0, Math.min(100, score)), note: bits.join(", ") };
}

// ─────────────────────────────────────────────────────────────────
// KNOWN GAPS — explicit deductions, always surfaced
// ─────────────────────────────────────────────────────────────────

export const KNOWN_GAPS = {
  gpu_infra:        { label: "GPU infrastructure",                      required: 8, preferred: 3 },
  microvm:          { label: "MicroVM / Firecracker",                   required: 8, preferred: 3 },
  mlflow:           { label: "Direct MLflow ownership / ML training",   required: 7, preferred: 3 },
  vendor_fluency:   { label: "Deep single-vendor internal fluency",     required: 6, preferred: 2 },
  // Added after the Pulumi diagnosis: a named, core requirement with no
  // matching gap key simply had nowhere to be scored — the LLM's free-text
  // "gaps" field is display-only prose, never read by scoreKnownGaps, so a
  // requirement outside this vocabulary was silently dropped rather than
  // penalized. cli_devux is priced highest of the three: on a role whose own
  // posting names CLI/DevUX craft as its hardest, most central problem, this
  // is not a peripheral nice-to-have.
  cli_devux:        { label: "CLI / developer-experience product craft",  required: 10, preferred: 4 },
  iac_tooling:      { label: "Declarative IaC tooling ownership (Terraform/CloudFormation/Pulumi-style)", required: 7, preferred: 3 },
  multilang_sdk:    { label: "Multi-language SDK ownership",             required: 5, preferred: 2 },
  // k8s_operators removed — Kubernetes, Helm authorship and operator
  // patterns are working knowledge, not a gap. It is now a proof point
  // (k8s_platform) instead. Rows stored before this change still carry the
  // old key; scoreKnownGaps ignores unrecognised keys, so those simply stop
  // deducting on the next re-score rather than erroring.
};

export function scoreKnownGaps(gaps = []) {
  let total = 0;
  const applied = [];
  for (const g of gaps) {
    const key = typeof g === "string" ? g : g.gap;
    const level = typeof g === "string" ? "required" : (g.level || "required");
    const def = KNOWN_GAPS[key];
    if (!def) continue;
    const penalty = level === "required" ? def.required : def.preferred;
    total += penalty;
    applied.push({ gap: key, label: def.label, level, penalty });
  }
  const capped = Math.min(total, MAX_GAP_PENALTY);
  return { penalty: capped, applied, capped: total > MAX_GAP_PENALTY };
}

// ─────────────────────────────────────────────────────────────────
// GATES — ceilings, not nudges
// ─────────────────────────────────────────────────────────────────

export function computeGates({ compResult, locationPosture, titleBand, companyFacts, compStated }) {
  const gates = [];
  if (compResult?.tc != null && !compResult.estimated && compResult.tc < 300) {
    gates.push({ reason: "stated comp below $300K", ceiling: 55 });
  } else if (compResult?.tc != null && !compResult.estimated
             && (compResult.effective ?? compResult.tc) < 360) {
    // A STATED package that clears the sub-$300K floor can still sit well
    // under his ~$400K TC target — Pulumi's Principal-level base capped at
    // $227,850 grossed up to an effective ~$326K, comfortably above 300 but
    // nowhere near the range BMC and Google Cloud actually offered. The comp
    // DIMENSION already scores this proportionally (15% weight), but 15% is
    // too small to function as the "hard modifier" a stated below-target
    // package should be: strong skill-match elsewhere could still buy an
    // apply-now score for a role that pays materially less than he is
    // targeting. This gate keeps that combination out of apply-now (85+)
    // without cratering the score the way the sub-$300K gate does — it is a
    // real ceiling, not a nudge, but a milder one than genuinely low pay.
    gates.push({ reason: "stated comp well below $400K target range", ceiling: 72 });
  }
  // Only when relocation is the ONLY option. This gate is also an auto-pass
  // trigger, so reading "Bellevue or San Francisco" as a relocation role would
  // hide a local job outright.
  //
  // Ceiling 25 — heavier than every other gate, including title-level
  // mismatches (45). Relocation is stated as non-negotiable in the candidate
  // profile: no amount of domain or comp strength changes it, so it should
  // read as the harshest structural fact a posting can carry.
  if (bestPosture(locationPosture) === "office_relocation") {
    gates.push({ reason: "relocation required", ceiling: 25 });
  }
  // Fires only when the package actually DEPENDS on illiquid paper. A cash-heavy
  // package at a PE-owned company is not an illiquid-equity-heavy package.
  if (companyFacts?.equity === "illiquid" && (compResult?.equityShare ?? 0) > 0.30) {
    gates.push({ reason: "package depends on illiquid / PE equity", ceiling: 60 });
  }
  // Staff and Senior PM are NOT gated here — they are accepted bands, priced
  // by their own (larger) LEVEL_MATRIX discount instead. Only org_owner,
  // below (junior IC, no seniority modifier) and non_pm are outside the band
  // entirely.
  if (titleBand === "org_owner" || titleBand === "below" || titleBand === "non_pm") {
    gates.push({ reason: "outside target level band", ceiling: 45 });
  }
  if (!compStated) {
    // Unknown is not neutral. Without verified comp a role cannot earn
    // "apply now, tailor a resume" status.
    gates.push({ reason: "compensation unverified — cannot reach apply-now tier", ceiling: 84 });
  }
  return gates;
}

// ─────────────────────────────────────────────────────────────────
// AUTO-PASS — the only place the pipeline HIDES a job
// ─────────────────────────────────────────────────────────────────

/**
 * Ingestion used to hide anything scoring under 55. That rule turned a scoring
 * bug into an invisible one: when the comp model read a stated base as if it
 * were total comp, every uncurated company quoting a salary landed at ~54 and
 * was filed away. 943 of 1083 rows — 87% of the pipeline — ended up hidden, and
 * because hiding is silent the symptom was "the app is missing jobs", not "the
 * comp model is wrong".
 *
 * The lesson is not "pick a better threshold". It is that a numeric score is the
 * wrong trigger for a destructive action, because the score is exactly the thing
 * a model change moves. So auto-pass now fires only on STRUCTURAL disqualifiers
 * — facts about the role that no recalibration of domain, comp or evidence
 * weighting can reverse:
 *
 *   - outside target level band — a role below Senior PM, a CPO/org-owner, or
 *     an engineering role wearing product language. This is what the job IS,
 *     not how well it scores. Staff and Senior PM are NOT in this set — they
 *     are accepted, discounted bands, not structural disqualifiers.
 *   - relocation required — he is not moving. Stated in the profile as
 *     non-negotiable, and the harshest gate in the model (ceiling 25).
 *
 * Everything else stays visible and is handled by ranking. The Saved tab already
 * sorts by score and dims sub-60 rows, which is the non-destructive version of
 * the same intent.
 *
 * Confidence gates the whole thing: hiding a job on the strength of an
 * extraction we do not trust is how a thin JD or a malformed response becomes a
 * permanently missing role.
 */
export const MIN_AUTOPASS_CONFIDENCE = 60;

export const STRUCTURAL_PASS_REASONS = new Set([
  "outside target level band",
  "relocation required",
]);

export function shouldAutoPass(fit) {
  if (!fit) return { pass: false, reason: "no fit result" };
  if (fit.confidence < MIN_AUTOPASS_CONFIDENCE) {
    return { pass: false, reason: `confidence ${fit.confidence}% below ${MIN_AUTOPASS_CONFIDENCE}% — not confident enough to hide` };
  }
  const hit = (fit.gates || []).find(g => STRUCTURAL_PASS_REASONS.has(g.reason));
  if (hit) return { pass: true, reason: hit.reason };
  return { pass: false, reason: "no structural disqualifier" };
}

// ─────────────────────────────────────────────────────────────────
// CONFIDENCE — driven by how much was actually parseable
// ─────────────────────────────────────────────────────────────────

export function computeConfidence({ jdChars = 0, companyKnown, compStated, dimsAvailable, dimsTotal, missingCritical = [] }) {
  let c = 40;
  const reasons = [];

  // A JD this thin means domain, level and evidence extraction — 75% of the
  // total weight — were effectively guessed. Deducting points is not enough:
  // confidence gets a hard CEILING, mirroring how score gates work. A high
  // score on a thin posting must be visibly untrustworthy, not merely nudged.
  let ceiling = 97;
  if (jdChars > 2000)      { c += 25; }
  else if (jdChars > 800)  { c += 18; }
  else if (jdChars > 300)  { c += 6;  reasons.push("short JD — some signals inferred"); }
  else if (jdChars > 0)    { c -= 25; ceiling = 30; reasons.push("JD too thin to read — most dimensions are guesses"); }
  else                     { c -= 25; ceiling = 20; reasons.push("no JD text available"); }

  if (companyKnown) c += 15;
  else { c -= 12; reasons.push("company not in facts table — level and equity read are assumptions"); }

  if (compStated) c += 15;
  else { c -= 8; reasons.push("compensation not stated"); }

  const coverage = dimsAvailable / dimsTotal;
  c += Math.round((coverage - 1) * 25);
  if (coverage < 1) reasons.push(`${dimsTotal - dimsAvailable} of ${dimsTotal} dimensions unavailable`);

  // Domain and level carry 55% of the weight between them. If either failed to
  // resolve — a malformed extraction, an unrecognised enum — the remaining
  // dimensions renormalise and can still yield a plausible-LOOKING number.
  // Observed: a garbage extraction scored 43 at 57% confidence, which reads as
  // a confident "skip" when nothing is actually known. Cap hard so the output
  // is visibly untrustworthy instead of quietly wrong.
  if (missingCritical.length) {
    ceiling = Math.min(ceiling, 25);
    reasons.push(`${missingCritical.join(" and ")} could not be determined — score is not trustworthy`);
  }

  return { confidence: Math.max(5, Math.min(ceiling, Math.round(c))), reasons };
}

// ─────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────

function stretchOf(score) {
  if (score == null) return 0;
  return Math.max(0, Math.min(1, (85 - score) / STRETCH_SPAN));
}

/**
 * Compute a full fit result from extracted signals.
 *
 * @param {object} signals - evidence extracted by the LLM (never a score)
 * @returns {{score, confidence, band, subscores, explanations, gates, gaps, math}}
 */
export function computeFit(signals) {
  const {
    company = "",
    domain = {},
    titleBand = "target",
    nonInterchangeableMatches = [],
    statedTc = null, statedBase = null, statedVariable = null,
    locationPosture = "remote",
    onCall = false, travelHeavy = false,
    knownGaps = [],
    jdChars = 0,
    compVerifiedTc = null,   // manual override
    burdenOverride = null,   // manual override
  } = signals;

  const facts = getCompanyFacts(company);

  const d = scoreDomain(domain);
  const l = scoreLevel({ titleBand, companyFacts: facts });
  const n = scoreNonInterchangeability(nonInterchangeableMatches);
  const c = scoreCompensation({
    statedTc: compVerifiedTc ?? statedTc,
    statedBase, statedVariable, companyFacts: facts,
  });
  const b = scoreBurden({ locationPosture, onCall, travelHeavy, companyFacts: facts, burdenOverride });

  const compStated = (compVerifiedTc ?? statedTc) != null || statedBase != null;

  // Weighted mean over AVAILABLE dimensions only. A null dimension is dropped
  // and the remaining weights renormalise — never replaced with a middle value.
  const dims = [
    { key: "domain",   res: d, w: WEIGHTS.domain },
    { key: "level",    res: l, w: WEIGHTS.level },
    { key: "nonInter", res: n, w: WEIGHTS.nonInter },
    { key: "comp",     res: c, w: WEIGHTS.comp },
    { key: "burden",   res: b, w: WEIGHTS.burden },
  ];
  const available = dims.filter(x => x.res.score != null);
  const totalW = available.reduce((a, x) => a + x.w, 0) || 1;
  const base = available.reduce((a, x) => a + x.res.score * (x.w / totalW), 0);

  const gapResult = scoreKnownGaps(knownGaps);
  const afterGaps = base - gapResult.penalty;

  const ds = stretchOf(d.score);
  const ls = stretchOf(l.score);
  const multiplier = 1 - TWO_STRETCH_K * ds * ls;
  const afterStretch = afterGaps * multiplier;

  const gates = computeGates({ compResult: c, locationPosture, titleBand, companyFacts: facts, compStated });
  const ceiling = gates.length ? Math.min(...gates.map(g => g.ceiling)) : 100;

  // Gates cap, but must not FLATTEN. A hard `min(raw, ceiling)` collapsed every
  // gated role onto the identical value — 31 of 92 real jobs landed on exactly
  // 45 — which reproduces the v1 pathology (one dominant spike) at a new number
  // and leaves the capped band with no internal ordering. Instead, a clipped
  // score is compressed into the top decile beneath its ceiling, so "all of
  // these are skips" still answers "which skip is least bad".
  let capped = afterStretch;
  if (afterStretch > ceiling) {
    capped = ceiling * 0.9 + (Math.min(afterStretch, 100) / 100) * (ceiling * 0.1);
  }
  const score = Math.max(0, Math.min(Math.round(capped), ceiling));

  const missingCritical = [];
  if (d.score == null) missingCritical.push("domain proximity");
  if (l.score == null) missingCritical.push("level fit");

  const { confidence, reasons } = computeConfidence({
    jdChars,
    companyKnown: facts != null,
    compStated,
    dimsAvailable: available.length,
    dimsTotal: dims.length,
    missingCritical,
  });
  // A TC derived from a stated base is weaker evidence than a stated TC. Say so
  // rather than presenting the grossed-up figure as if it were quoted.
  if (c.grossedUp) {
    reasons.push(facts
      ? "total comp inferred from stated base — verify before treating comp as settled"
      : "total comp inferred from stated base using a DEFAULT cash share — company is not in the facts table, so this is the weakest comp read the model produces");
  }

  return {
    score,
    confidence,
    band: scoreBand(score),
    model_version: MODEL_VERSION,
    subscores: {
      domain: d.score, level: l.score, non_interchangeability: n.score,
      compensation: c.score, burden: b.score,
    },
    explanations: {
      domain: d.note, level: l.note, non_interchangeability: n.note,
      compensation: c.note, burden: b.note,
    },
    gates,
    gaps: gapResult,
    confidence_reasons: reasons,
    math: {
      base: Number(base.toFixed(2)),
      gap_penalty: gapResult.penalty,
      after_gaps: Number(afterGaps.toFixed(2)),
      domain_stretch: Number(ds.toFixed(3)),
      level_stretch: Number(ls.toFixed(3)),
      two_stretch_multiplier: Number(multiplier.toFixed(3)),
      after_stretch: Number(afterStretch.toFixed(2)),
      ceiling,
      dimensions_used: available.map(x => x.key),
    },
  };
}
