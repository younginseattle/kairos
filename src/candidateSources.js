/**
 * ═══════════════════════════════════════════════════════════════
 * CANDIDATE SOURCES — unverified board IDs awaiting a live probe
 *
 * SOURCES in ingestion.js is a verified list: every entry there has been
 * confirmed against a live ATS API. This file is the staging area in
 * front of it. Board tokens are guesses — a company's Ashby slug, its
 * Greenhouse token, and its display name are frequently all different,
 * and a wrong guess is indistinguishable from a company that has
 * disabled public API access (both return 404).
 *
 * Workflow:
 *   1. Add candidates here, with every plausible {ats, id} guess.
 *   2. Push — the Verify Job Boards workflow runs on any change to this
 *      file. Do not probe from a dev sandbox: egress proxies there block
 *      the ATS hosts, so every board looks dead.
 *   3. Promote what it confirms into SOURCES, and record the finding for
 *      what it does not.
 *
 * A response with zero jobs does not count as confirmation — see the note
 * in verify-boards.mjs.
 * ═══════════════════════════════════════════════════════════════
 */

export const CANDIDATE_SOURCES = [
  // ── Amazon business-category slug check ──────────────────────────
  // The AWS entry in SOURCES filters by business_category to keep Amazon
  // retail PM roles out. If that slug is wrong the filter silently returns
  // nothing, so it is probed here alongside slug alternates.
  { company: "AWS (category slug check)", tier: 1, domain: "infrastructure",
    guesses: [
      { ats: "amazon", id: "product manager", businessCategory: "amazon-web-services" },
      { ats: "amazon", id: "product manager", businessCategory: "aws" },
    ] },

  // ── Companies whose boards responded with an empty list ──────────
  // Verified 2026-08-06: these answered HTTP 200 with zero jobs. Splunk,
  // Nutanix, Dynatrace and Remitly all have hundreds of open roles, so an
  // empty list means the host accepted a token it does not serve. Retrying
  // with different tokens before writing them off.
  { company: "Splunk", tier: 1, domain: "observability",
    guesses: [{ ats: "smartrecruiters", id: "SplunkInc" }, { ats: "smartrecruiters", id: "Splunk1" }, { ats: "greenhouse", id: "splunkinc" }] },
  { company: "Dynatrace", tier: 1, domain: "observability",
    guesses: [{ ats: "smartrecruiters", id: "Dynatrace" }, { ats: "workable", id: "dynatrace-1" }, { ats: "greenhouse", id: "dynatrace1" }] },
  { company: "Infoblox", tier: 2, domain: "infrastructure",
    guesses: [{ ats: "smartrecruiters", id: "Infoblox1" }, { ats: "workable", id: "infoblox-inc" }, { ats: "greenhouse", id: "infobloxinc" }] },
  { company: "Nutanix", tier: 2, domain: "infrastructure",
    guesses: [{ ats: "smartrecruiters", id: "Nutanix1" }, { ats: "greenhouse", id: "nutanixinc" }] },
  { company: "Netdata", tier: 1, domain: "observability", broadFilter: true,
    guesses: [{ ats: "workable", id: "netdata-1" }, { ats: "greenhouse", id: "netdata" }, { ats: "lever", id: "netdata" }] },
  { company: "Dagster Labs", tier: 2, domain: "platform", broadFilter: true,
    guesses: [{ ats: "ashby", id: "dagsterlabs" }, { ats: "lever", id: "dagster" }] },
  { company: "Remitly", tier: 3, domain: "platform",
    guesses: [{ ats: "smartrecruiters", id: "Remitly1" }, { ats: "greenhouse", id: "remitlyinc" }] },

  // ── Unreachable on every guess so far ────────────────────────────
  // Verified 2026-08-06: all guesses 404'd. Their careers pages are live
  // and human-browsable, so these are either wrong tokens or companies
  // with public API access disabled. Fresh guesses below; if these fail
  // too, route them through a LinkedIn job alert instead.
  { company: "Weights & Biases", tier: 1, domain: "platform", broadFilter: true,
    guesses: [{ ats: "ashby", id: "weightsandbiases" }, { ats: "greenhouse", id: "wandb" }, { ats: "ashby", id: "wandbai" }] },
  { company: "Groq", tier: 1, domain: "infrastructure", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "groqinc" }, { ats: "ashby", id: "groqinc" }, { ats: "greenhouse", id: "groq75" }] },
  { company: "Cerebras", tier: 2, domain: "infrastructure", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "cerebrassystems" }, { ats: "ashby", id: "cerebras" }] },
  { company: "Redpanda", tier: 1, domain: "platform", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "redpanda" }, { ats: "ashby", id: "redpandadata" }, { ats: "lever", id: "redpanda" }] },
  { company: "Timescale", tier: 2, domain: "platform", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "timescaledb" }, { ats: "ashby", id: "timescaledb" }] },
  { company: "InfluxData", tier: 1, domain: "observability", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "influxdb" }, { ats: "ashby", id: "influxdata" }] },
  { company: "Neon", tier: 2, domain: "platform", broadFilter: true,
    guesses: [{ ats: "ashby", id: "neon" }, { ats: "greenhouse", id: "neondatabase" }] },
  { company: "Retool", tier: 2, domain: "devtools", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "retoolhq" }, { ats: "ashby", id: "retoolhq" }] },
  { company: "Tecton", tier: 2, domain: "platform", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "tectonai" }, { ats: "lever", id: "tecton" }] },
  { company: "Coralogix", tier: 1, domain: "observability", broadFilter: true,
    guesses: [{ ats: "ashby", id: "coralogix" }, { ats: "greenhouse", id: "coralogixltd" }] },
  { company: "Logz.io", tier: 1, domain: "observability", broadFilter: true,
    guesses: [{ ats: "ashby", id: "logzio" }, { ats: "greenhouse", id: "logz" }] },
  { company: "Groundcover", tier: 1, domain: "observability", broadFilter: true,
    guesses: [{ ats: "ashby", id: "groundcoverlabs" }, { ats: "lever", id: "groundcover" }] },
  { company: "Qumulo", tier: 2, domain: "infrastructure", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "qumuloinc" }, { ats: "ashby", id: "qumulo" }, { ats: "smartrecruiters", id: "Qumulo" }] },
  { company: "Auvik", tier: 2, domain: "observability", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "auviknetworks" }, { ats: "ashby", id: "auvik" }, { ats: "smartrecruiters", id: "Auvik" }] },
  { company: "Middleware", tier: 2, domain: "observability", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "middlewarelabs" }, { ats: "ashby", id: "middlewarelabs" }] },
];

/**
 * Flattens candidates into individual probe targets.
 */
export function candidateProbes(candidates = CANDIDATE_SOURCES) {
  return candidates.flatMap(c =>
    c.guesses.map(g => ({
      company: c.company, tier: c.tier, domain: c.domain,
      broadFilter: c.broadFilter === true, fromScan: c.fromScan === true,
      ...g,
    }))
  );
}
