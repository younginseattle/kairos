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
 *   2. Run scripts/verify-boards.mjs — in GitHub Actions, not locally,
 *      because the dev sandbox's proxy blocks these hosts.
 *   3. Promote the confirmed entries it prints into SOURCES, and delete
 *      them from this file with the finding recorded in a comment.
 *
 * Companies marked `fromScan` were found to have live, matching PM roles
 * during the manual 24-board scan — if a probe fails for one of these,
 * the board is real and the API is the problem, so it belongs on the
 * LinkedIn-alert path rather than being dropped.
 * ═══════════════════════════════════════════════════════════════
 */

export const CANDIDATE_SOURCES = [
  // ── Confirmed to have matching open roles in the manual scan ──────
  { company: "ClickHouse", tier: 1, domain: "platform", broadFilter: true, fromScan: true,
    guesses: [{ ats: "ashby", id: "ClickHouse" }, { ats: "greenhouse", id: "clickhouse" }, { ats: "lever", id: "clickhouse" }] },
  { company: "Infoblox", tier: 2, domain: "infrastructure", fromScan: true,
    guesses: [{ ats: "greenhouse", id: "infoblox" }, { ats: "smartrecruiters", id: "Infoblox" }, { ats: "workable", id: "infoblox" }] },
  { company: "Snowflake", tier: 1, domain: "platform", broadFilter: true, fromScan: true,
    // snowflakecomputing returned a genuine 404 on the Greenhouse API in an
    // earlier Actions run — retrying with alternate tokens and ATS types.
    guesses: [{ ats: "greenhouse", id: "snowflake" }, { ats: "ashby", id: "snowflake" }, { ats: "smartrecruiters", id: "Snowflake" }] },
  { company: "Lambda", tier: 1, domain: "infrastructure", broadFilter: true, fromScan: true,
    guesses: [{ ats: "ashby", id: "lambda" }, { ats: "ashby", id: "Lambda" }, { ats: "greenhouse", id: "lambdalabs" }] },
  { company: "Crusoe", tier: 1, domain: "infrastructure", broadFilter: true, fromScan: true,
    guesses: [{ ats: "ashby", id: "crusoe" }, { ats: "greenhouse", id: "crusoeenergy" }, { ats: "greenhouse", id: "crusoe" }] },

  // ── Amazon / AWS — public search API, not an ATS board ────────────
  // Where the AWS observability and infrastructure PM roles live. The id
  // is the search query, not a board token.
  { company: "Amazon Web Services", tier: 1, domain: "infrastructure", fromScan: true,
    guesses: [{ ats: "amazon", id: "product manager" }] },

  // ── Observability / telemetry — the tier-1 domain ─────────────────
  { company: "Dynatrace",   tier: 1, domain: "observability",
    guesses: [{ ats: "greenhouse", id: "dynatrace" }, { ats: "smartrecruiters", id: "Dynatrace1" }, { ats: "workable", id: "dynatrace" }] },
  { company: "Splunk",      tier: 1, domain: "observability",
    guesses: [{ ats: "greenhouse", id: "splunk" }, { ats: "smartrecruiters", id: "Splunk" }] },
  { company: "Sentry",      tier: 1, domain: "observability", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "sentry" }, { ats: "ashby", id: "sentry" }, { ats: "lever", id: "sentry" }] },
  { company: "Coralogix",   tier: 1, domain: "observability", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "coralogix" }, { ats: "workable", id: "coralogix" }, { ats: "lever", id: "coralogix" }] },
  { company: "Logz.io",     tier: 1, domain: "observability", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "logzio" }, { ats: "workable", id: "logzio" }, { ats: "lever", id: "logzio" }] },
  { company: "Netdata",     tier: 1, domain: "observability", broadFilter: true,
    guesses: [{ ats: "ashby", id: "netdata" }, { ats: "workable", id: "netdata" }] },
  { company: "Groundcover", tier: 1, domain: "observability", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "groundcover" }, { ats: "ashby", id: "groundcover" }, { ats: "workable", id: "groundcover" }] },
  { company: "Middleware",  tier: 2, domain: "observability", broadFilter: true,
    guesses: [{ ats: "ashby", id: "middleware" }, { ats: "lever", id: "middleware" }] },

  // ── Data / streaming infrastructure ──────────────────────────────
  { company: "Redpanda",   tier: 1, domain: "platform", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "redpandadata" }, { ats: "ashby", id: "redpanda" }, { ats: "greenhouse", id: "redpanda" }] },
  { company: "Materialize", tier: 2, domain: "platform", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "materialize" }, { ats: "ashby", id: "materialize" }] },
  { company: "StarTree",   tier: 2, domain: "platform", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "startree" }, { ats: "ashby", id: "startree" }, { ats: "lever", id: "startree" }] },
  { company: "Timescale",  tier: 2, domain: "platform", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "timescale" }, { ats: "ashby", id: "timescale" }, { ats: "lever", id: "timescale" }] },
  { company: "InfluxData", tier: 1, domain: "observability", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "influxdata" }, { ats: "lever", id: "influxdata" }] },
  { company: "Airbyte",    tier: 2, domain: "platform", broadFilter: true,
    // Earlier Greenhouse probe 404'd — retrying alternates before giving up.
    guesses: [{ ats: "ashby", id: "airbyte" }, { ats: "lever", id: "airbyte" }, { ats: "greenhouse", id: "airbyte" }] },
  { company: "Prefect",    tier: 2, domain: "platform", broadFilter: true,
    guesses: [{ ats: "ashby", id: "prefect" }, { ats: "greenhouse", id: "prefect" }] },
  { company: "Dagster Labs", tier: 2, domain: "platform", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "dagsterlabs" }, { ats: "ashby", id: "dagster" }] },
  { company: "Astronomer", tier: 2, domain: "platform", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "astronomer" }, { ats: "ashby", id: "astronomer" }] },

  // ── AI / ML infrastructure ───────────────────────────────────────
  { company: "Weights & Biases", tier: 1, domain: "platform", broadFilter: true,
    guesses: [{ ats: "ashby", id: "wandb" }, { ats: "greenhouse", id: "weightsandbiases" }, { ats: "lever", id: "wandb" }] },
  { company: "Anyscale",    tier: 1, domain: "platform", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "anyscale" }, { ats: "ashby", id: "anyscale" }] },
  { company: "Modal Labs",  tier: 1, domain: "infrastructure", broadFilter: true,
    guesses: [{ ats: "ashby", id: "modal" }, { ats: "ashby", id: "modallabs" }] },
  { company: "Baseten",     tier: 1, domain: "infrastructure", broadFilter: true,
    guesses: [{ ats: "ashby", id: "baseten" }, { ats: "greenhouse", id: "baseten" }] },
  { company: "Together AI", tier: 1, domain: "infrastructure", broadFilter: true,
    guesses: [{ ats: "ashby", id: "togetherai" }, { ats: "greenhouse", id: "togetherai" }, { ats: "ashby", id: "together" }] },
  { company: "Groq",        tier: 1, domain: "infrastructure", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "groq" }, { ats: "ashby", id: "groq" }, { ats: "lever", id: "groq" }] },
  { company: "Cerebras",    tier: 2, domain: "infrastructure", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "cerebras" }, { ats: "lever", id: "cerebras" }] },
  { company: "LangChain",   tier: 1, domain: "platform", broadFilter: true,
    guesses: [{ ats: "ashby", id: "langchain" }, { ats: "greenhouse", id: "langchain" }] },
  { company: "Nebius",      tier: 2, domain: "infrastructure", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "nebius" }, { ats: "ashby", id: "nebius" }] },
  { company: "Tecton",      tier: 2, domain: "platform", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "tecton" }, { ats: "ashby", id: "tecton" }] },

  // ── Developer platforms / delivery ───────────────────────────────
  { company: "Sourcegraph", tier: 2, domain: "devtools", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "sourcegraph91" }, { ats: "ashby", id: "sourcegraph" }, { ats: "greenhouse", id: "sourcegraph" }] },
  { company: "Pulumi",      tier: 1, domain: "devtools", broadFilter: true,
    // Seattle-headquartered — high location score by default.
    guesses: [{ ats: "greenhouse", id: "pulumicorporation" }, { ats: "lever", id: "pulumi" }, { ats: "ashby", id: "pulumi" }] },
  { company: "CircleCI",    tier: 2, domain: "devtools", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "circleci" }, { ats: "lever", id: "circleci" }] },
  { company: "Supabase",    tier: 2, domain: "platform", broadFilter: true,
    guesses: [{ ats: "ashby", id: "supabase" }, { ats: "greenhouse", id: "supabase" }] },
  { company: "Neon",        tier: 2, domain: "platform", broadFilter: true,
    guesses: [{ ats: "ashby", id: "neondatabase" }, { ats: "greenhouse", id: "neon" }] },
  { company: "Render",      tier: 2, domain: "infrastructure", broadFilter: true,
    guesses: [{ ats: "ashby", id: "render" }, { ats: "greenhouse", id: "render" }] },
  { company: "Retool",      tier: 2, domain: "devtools", broadFilter: true,
    // Earlier Greenhouse probe 404'd — retrying alternates.
    guesses: [{ ats: "ashby", id: "retool" }, { ats: "lever", id: "retool" }, { ats: "greenhouse", id: "retool" }] },
  { company: "Linear",      tier: 3, domain: "devtools", broadFilter: true,
    guesses: [{ ats: "ashby", id: "linear" }, { ats: "greenhouse", id: "linear" }] },

  // ── Seattle / Pacific Northwest ecosystem ────────────────────────
  { company: "Nutanix",     tier: 2, domain: "infrastructure",
    guesses: [{ ats: "greenhouse", id: "nutanix" }, { ats: "smartrecruiters", id: "Nutanix" }] },
  { company: "Qumulo",      tier: 2, domain: "infrastructure", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "qumulo" }, { ats: "lever", id: "qumulo" }] },
  { company: "Remitly",     tier: 3, domain: "platform",
    guesses: [{ ats: "greenhouse", id: "remitly" }, { ats: "smartrecruiters", id: "Remitly" }] },
  { company: "Auvik",       tier: 2, domain: "observability", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "auvik" }, { ats: "workable", id: "auvik" }, { ats: "lever", id: "auvik" }] },
];

/**
 * Flattens candidates into individual probe targets.
 */
export function candidateProbes(candidates = CANDIDATE_SOURCES) {
  return candidates.flatMap(c =>
    c.guesses.map(g => ({
      company: c.company, tier: c.tier, domain: c.domain,
      broadFilter: c.broadFilter === true, fromScan: c.fromScan === true,
      ats: g.ats, id: g.id,
    }))
  );
}
