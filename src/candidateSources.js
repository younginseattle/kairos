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
 *
 * Empty right now: two probe rounds on 2026-08-06 resolved every
 * candidate either into SOURCES or into KNOWN_UNREACHABLE below.
 * ═══════════════════════════════════════════════════════════════
 */

/**
 * Added 2026-08-25 in response to low ingestion volume. Not yet verified —
 * every entry needs a `Verify Job Boards` Actions run before promotion into
 * SOURCES. Chosen from gaps against the candidate profile (observability,
 * ITOM/AIOps, infrastructure automation, agentic/AI platforms, developer
 * tooling) that the existing ~65-company SOURCES list did not cover, and
 * cross-checked against KNOWN_UNREACHABLE / RETIRED_SOURCES below to avoid
 * re-guessing tokens already proven dead.
 */
export const CANDIDATE_SOURCES = [
  // ── Observability (expands beyond the literal "observability" — see the
  // titleFilter.js APM/tracing/logs/alerting/incident fix from the same pass) ──
  { company: "Sysdig", tier: 1, domain: "observability",
    guesses: [{ ats: "greenhouse", id: "sysdig" }, { ats: "ashby", id: "sysdig" }, { ats: "lever", id: "sysdig" }] },
  { company: "LogicMonitor", tier: 2, domain: "observability",
    guesses: [{ ats: "greenhouse", id: "logicmonitor" }, { ats: "workable", id: "logicmonitor" }, { ats: "ashby", id: "logicmonitor" }] },
  { company: "ExtraHop", tier: 1, domain: "observability", // Seattle HQ — network detection & response, direct local fit
    guesses: [{ ats: "greenhouse", id: "extrahop" }, { ats: "ashby", id: "extrahop" }, { ats: "lever", id: "extrahop" }] },
  { company: "incident.io", tier: 2, domain: "observability",
    guesses: [{ ats: "ashby", id: "incidentio" }, { ats: "greenhouse", id: "incidentio" }, { ats: "lever", id: "incidentio" }] },
  { company: "Axiom", tier: 2, domain: "observability",
    guesses: [{ ats: "ashby", id: "axiom" }, { ats: "greenhouse", id: "axiomhq" }, { ats: "lever", id: "axiom" }] },

  // ── AI / agentic platforms (broad filter — same reasoning as Anthropic/
  // Databricks/Scale AI already in SOURCES: internal PM titles rarely spell
  // out "platform" or "infrastructure") ──────────────────────────────────
  { company: "OpenAI", tier: 1, domain: "platform", broadFilter: true,
    guesses: [{ ats: "ashby", id: "openai" }, { ats: "greenhouse", id: "openai" }, { ats: "lever", id: "openai" }] },
  { company: "Hugging Face", tier: 1, domain: "platform", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "huggingface" }, { ats: "ashby", id: "huggingface" }, { ats: "lever", id: "huggingface" }] },
  { company: "Mistral AI", tier: 1, domain: "platform", broadFilter: true,
    guesses: [{ ats: "ashby", id: "mistralai" }, { ats: "greenhouse", id: "mistralai" }, { ats: "lever", id: "mistral" }] },
  { company: "Cohere", tier: 1, domain: "platform", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "cohere" }, { ats: "ashby", id: "cohere" }, { ats: "lever", id: "cohere" }] },
  { company: "Perplexity AI", tier: 1, domain: "platform", broadFilter: true,
    guesses: [{ ats: "ashby", id: "perplexityai" }, { ats: "greenhouse", id: "perplexityai" }, { ats: "lever", id: "perplexity" }] },

  // ── Infrastructure / data platform ──────────────────────────────────
  { company: "HashiCorp", tier: 1, domain: "infrastructure", broadFilter: true, // Terraform/Vault/Consul — infra provisioning, direct fit
    guesses: [{ ats: "greenhouse", id: "hashicorp" }, { ats: "ashby", id: "hashicorp" }, { ats: "lever", id: "hashicorp" }] },
  { company: "DigitalOcean", tier: 2, domain: "infrastructure", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "digitalocean" }, { ats: "ashby", id: "digitalocean" }, { ats: "lever", id: "digitalocean" }] },
  { company: "CockroachDB", tier: 2, domain: "platform", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "cockroachlabs" }, { ats: "ashby", id: "cockroachlabs" }, { ats: "lever", id: "cockroachlabs" }] },
  { company: "PlanetScale", tier: 2, domain: "platform", broadFilter: true,
    guesses: [{ ats: "ashby", id: "planetscale" }, { ats: "greenhouse", id: "planetscale" }, { ats: "lever", id: "planetscale" }] },
  { company: "Redis", tier: 2, domain: "platform", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "redis" }, { ats: "ashby", id: "redis" }, { ats: "greenhouse", id: "redislabs" }] },

  // ── Developer tooling ────────────────────────────────────────────────
  { company: "Kong Inc", tier: 2, domain: "devtools", broadFilter: true, // API gateway/management platform
    guesses: [{ ats: "greenhouse", id: "konginc" }, { ats: "ashby", id: "kong" }, { ats: "lever", id: "kong" }] },
  { company: "Docker Inc", tier: 1, domain: "devtools", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "docker" }, { ats: "ashby", id: "docker" }, { ats: "lever", id: "docker" }] },
  { company: "Netlify", tier: 2, domain: "devtools", broadFilter: true,
    guesses: [{ ats: "greenhouse", id: "netlify" }, { ats: "ashby", id: "netlify" }, { ats: "lever", id: "netlify" }] },
  { company: "Buildkite", tier: 2, domain: "devtools", broadFilter: true, // Seattle HQ
    guesses: [{ ats: "greenhouse", id: "buildkite" }, { ats: "ashby", id: "buildkite" }, { ats: "lever", id: "buildkite" }] },
  { company: "JFrog", tier: 2, domain: "devtools",
    guesses: [{ ats: "greenhouse", id: "jfrog" }, { ats: "workable", id: "jfrog" }, { ats: "lever", id: "jfrog" }] },
];

/**
 * Companies probed and not reachable by API, recorded so future sessions
 * do not burn another round re-guessing the same tokens. Each has a live,
 * human-browsable careers page — the API is what is unavailable, either
 * because public access is disabled or because the real token is not
 * guessable from the company name.
 *
 * `finding` values:
 *   404      — every guessed token returned HTTP 404
 *   empty    — host answered 200 with zero jobs for a company that
 *              demonstrably has open roles, i.e. it accepted a token it
 *              does not actually serve
 *
 * The route for all of these is a LinkedIn job alert, which
 * scripts/fetch-jobs.js already ingests.
 */
export const KNOWN_UNREACHABLE = [
  // Probed 2026-08-06, runs 31059467660 and 31059866905
  { company: "Splunk",           finding: "empty", tried: ["smartrecruiters/Splunk", "smartrecruiters/SplunkInc", "smartrecruiters/Splunk1", "greenhouse/splunk", "greenhouse/splunkinc"] },
  { company: "Dynatrace",        finding: "empty", tried: ["smartrecruiters/Dynatrace", "smartrecruiters/Dynatrace1", "workable/dynatrace", "workable/dynatrace-1", "greenhouse/dynatrace", "greenhouse/dynatrace1"] },
  { company: "Infoblox",         finding: "empty", tried: ["smartrecruiters/Infoblox", "smartrecruiters/Infoblox1", "workable/infoblox", "workable/infoblox-inc", "greenhouse/infoblox", "greenhouse/infobloxinc"] },
  { company: "Nutanix",          finding: "empty", tried: ["smartrecruiters/Nutanix", "smartrecruiters/Nutanix1", "greenhouse/nutanix", "greenhouse/nutanixinc"] },
  { company: "Remitly",          finding: "empty", tried: ["smartrecruiters/Remitly", "smartrecruiters/Remitly1", "greenhouse/remitly", "greenhouse/remitlyinc"] },
  { company: "Tecton",           finding: "empty", tried: ["lever/tecton", "greenhouse/tecton", "greenhouse/tectonai", "ashby/tecton"] },
  { company: "Netdata",          finding: "empty", tried: ["workable/netdata", "workable/netdata-1", "ashby/netdata", "greenhouse/netdata", "lever/netdata"] },
  { company: "Dagster Labs",     finding: "empty", tried: ["greenhouse/dagsterlabs", "ashby/dagster", "ashby/dagsterlabs", "lever/dagster"] },
  { company: "Weights & Biases", finding: "404",   tried: ["ashby/wandb", "ashby/wandbai", "ashby/weightsandbiases", "greenhouse/wandb", "greenhouse/weightsandbiases", "lever/wandb"] },
  { company: "Groq",             finding: "404",   tried: ["greenhouse/groq", "greenhouse/groqinc", "greenhouse/groq75", "ashby/groq", "ashby/groqinc", "lever/groq"] },
  { company: "Redpanda",         finding: "404",   tried: ["greenhouse/redpanda", "greenhouse/redpandadata", "ashby/redpanda", "ashby/redpandadata", "lever/redpanda"] },
  { company: "Timescale",        finding: "404",   tried: ["greenhouse/timescale", "greenhouse/timescaledb", "ashby/timescale", "ashby/timescaledb", "lever/timescale"] },
  { company: "Retool",           finding: "404",   tried: ["greenhouse/retool", "greenhouse/retoolhq", "ashby/retool", "ashby/retoolhq", "lever/retool"] },
  { company: "Coralogix",        finding: "404",   tried: ["greenhouse/coralogix", "greenhouse/coralogixltd", "ashby/coralogix", "workable/coralogix", "lever/coralogix"] },
  { company: "Logz.io",          finding: "404",   tried: ["greenhouse/logzio", "greenhouse/logz", "ashby/logzio", "workable/logzio", "lever/logzio"] },
  { company: "Groundcover",      finding: "404",   tried: ["greenhouse/groundcover", "ashby/groundcover", "ashby/groundcoverlabs", "workable/groundcover", "lever/groundcover"] },
  { company: "Middleware",       finding: "404",   tried: ["greenhouse/middlewarelabs", "ashby/middleware", "ashby/middlewarelabs", "lever/middleware"] },
];

/**
 * Boards that WERE in SOURCES and have been removed. Recorded so a future
 * session reading the target-company list does not "notice a gap" and add
 * them back — both removals are deliberate.
 */
export const RETIRED_SOURCES = [
  {
    company: "dbt Labs", was: "greenhouse/dbtlabsinc",
    removed: "2026-08-10",
    reason: "HTTP 404 on the ingestion run of 2026-08-10 — the board token no longer resolves. " +
            "Public API access was turned off or the board moved. Route is a LinkedIn job alert.",
  },
  {
    company: "Chronosphere", was: "ashby/chronospherejobs",
    removed: "2026-08-10",
    reason: "Acquired — no longer an independent target company. The board answered 200 with " +
            "zero jobs on 2026-08-10, consistent with a wound-down listing.",
  },
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
