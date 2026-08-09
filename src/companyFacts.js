/**
 * ═══════════════════════════════════════════════════════════════
 * COMPANY FACTS
 *
 * Curated company-level data that is NOT inferable from a job posting.
 * This table exists because the fit model depends on three things a JD
 * never states: whether a VP background reads as an asset or a mismatch
 * at this company, whether equity is actually liquid, and where the
 * company pays relative to a ~$400K cash-heavy anchor.
 *
 * Without this, GitKraken-style roles score ~75 on JD text alone (developer
 * tooling is a top-band domain) and the model recommends applying to
 * exactly the roles Matt has decided to decline.
 *
 * FIELDS
 *   tier          established | growth | small
 *   ownership     public | private | pe | startup
 *   equity        liquid | semi | illiquid
 *                   liquid   = public, or credibly near-IPO
 *                   semi     = late-stage private w/ secondary market
 *                   illiquid = PE-owned, or early-stage paper
 *   vpBackground  asset | neutral | mismatch
 *                   Does a VP-of-Product background read as an asset here,
 *                   or as something to explain? This is the signal that makes
 *                   the CoreWeave two-stretch case work: Staff PM is IN the
 *                   target band by title, but at a hyper-growth GPU company
 *                   expecting hands-on domain depth, a VP background reads as
 *                   a downlevel question mark. Title alone cannot capture this.
 *   remote        remote_first | hybrid | office
 *   tcBand        top | strong | mid | below
 *                   Where this company typically lands for the target level
 *                   band, used ONLY when comp is not stated in the posting.
 *                   Never used to override a stated number.
 *
 * Unknown companies return null and the caller drops confidence rather than
 * guessing. Adding a row is cheap; guessing is not.
 * ═══════════════════════════════════════════════════════════════
 */

const FACTS = {
  // ── Calibration-set companies (known outcomes) ────────────────
  "bmc":         { tier: "established", ownership: "pe",      equity: "illiquid", vpBackground: "asset",    remote: "hybrid",       tcBand: "strong" },
  "google":      { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "hybrid",       tcBand: "top" },
  "coreweave":   { tier: "growth",      ownership: "public",  equity: "liquid",   vpBackground: "mismatch", remote: "hybrid",       tcBand: "strong" },
  "elastic":     { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "remote_first", tcBand: "mid" },
  "gitkraken":   { tier: "small",       ownership: "pe",      equity: "illiquid", vpBackground: "neutral",  remote: "hybrid",       tcBand: "below" },

  // ── Observability / monitoring ────────────────────────────────
  "datadog":     { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "hybrid",       tcBand: "top" },
  "newrelic":    { tier: "established", ownership: "pe",      equity: "illiquid", vpBackground: "asset",    remote: "remote_first", tcBand: "mid" },
  "pagerduty":   { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "remote_first", tcBand: "mid" },
  "grafana":     { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "asset",    remote: "remote_first", tcBand: "strong" },
  "honeycomb":   { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "neutral",  remote: "remote_first", tcBand: "mid" },
  "sumologic":   { tier: "established", ownership: "pe",      equity: "illiquid", vpBackground: "asset",    remote: "hybrid",       tcBand: "mid" },
  "cribl":       { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "asset",    remote: "remote_first", tcBand: "strong" },
  "chronosphere":{ tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "asset",    remote: "remote_first", tcBand: "strong" },
  "montecarlo":  { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "neutral",  remote: "remote_first", tcBand: "mid" },
  "arize":       { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "neutral",  remote: "remote_first", tcBand: "mid" },
  "fiddler":     { tier: "small",       ownership: "startup", equity: "illiquid", vpBackground: "neutral",  remote: "hybrid",       tcBand: "below" },
  "observe":     { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "asset",    remote: "remote_first", tcBand: "mid" },
  "kentik":      { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "asset",    remote: "remote_first", tcBand: "mid" },
  "splunk":      { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "hybrid",       tcBand: "top" },
  "cisco":       { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "hybrid",       tcBand: "strong" },
  "dynatrace":   { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "hybrid",       tcBand: "strong" },

  // ── AI / ML / data platforms ──────────────────────────────────
  "anthropic":   { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "neutral",  remote: "hybrid",       tcBand: "top" },
  "databricks":  { tier: "established", ownership: "private", equity: "semi",     vpBackground: "asset",    remote: "hybrid",       tcBand: "top" },
  "confluent":   { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "remote_first", tcBand: "strong" },
  "snowflake":   { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "hybrid",       tcBand: "top" },
  "mongodb":     { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "remote_first", tcBand: "strong" },
  "glean":       { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "neutral",  remote: "hybrid",       tcBand: "strong" },
  "scaleai":     { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "mismatch", remote: "hybrid",       tcBand: "strong" },
  "pinecone":    { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "neutral",  remote: "remote_first", tcBand: "mid" },
  "weightsbiases":{tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "mismatch", remote: "hybrid",       tcBand: "mid" },

  // ── Infrastructure / cloud / dev tools ────────────────────────
  "microsoft":   { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "hybrid",       tcBand: "top" },
  "amazon":      { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "office",       tcBand: "top" },
  "aws":         { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "office",       tcBand: "top" },
  "cloudflare":  { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "remote_first", tcBand: "strong" },
  "gitlab":      { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "remote_first", tcBand: "strong" },
  "github":      { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "remote_first", tcBand: "strong" },
  "temporal":    { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "asset",    remote: "remote_first", tcBand: "strong" },
  "launchdarkly":{ tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "asset",    remote: "remote_first", tcBand: "mid" },
  "hashicorp":   { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "remote_first", tcBand: "strong" },
  "docker":      { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "neutral",  remote: "remote_first", tcBand: "mid" },
  "puppet":      { tier: "established", ownership: "pe",      equity: "illiquid", vpBackground: "asset",    remote: "remote_first", tcBand: "mid" },
  "fastly":      { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "remote_first", tcBand: "mid" },
  "twilio":      { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "remote_first", tcBand: "strong" },
  "stripe":      { tier: "established", ownership: "private", equity: "semi",     vpBackground: "asset",    remote: "hybrid",       tcBand: "top" },
  "samsara":     { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "hybrid",       tcBand: "strong" },
  "smartsheet":  { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "hybrid",       tcBand: "mid" },
  "posthog":     { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "neutral",  remote: "remote_first", tcBand: "mid" },
  "vercel":      { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "neutral",  remote: "remote_first", tcBand: "strong" },
  "netapp":      { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "hybrid",       tcBand: "mid" },
  "nvidia":      { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "mismatch", remote: "hybrid",       tcBand: "top" },
  "oracle":      { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "hybrid",       tcBand: "mid" },
  "ibm":         { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "hybrid",       tcBand: "mid" },
  "salesforce":  { tier: "established", ownership: "public",  equity: "liquid",   vpBackground: "asset",    remote: "hybrid",       tcBand: "strong" },
  "domotz":      { tier: "small",       ownership: "startup", equity: "illiquid", vpBackground: "asset",    remote: "remote_first", tcBand: "below" },

  // ── Companies onboarded 2026-08-06 with the SOURCES expansion ──
  // Every board added in that pass was absent here, so each of their roles
  // scored with vpBackground "neutral", a default 0.70 cash share and a 15
  // point confidence deduction — the Lambda platform role capped at 80 on a
  // flawless read purely for want of a row.
  //
  // NOTE: these are estimates from public information (headcount, funding
  // stage, posted ranges), not verified like the calibration-set rows above.
  // tcBand only ever applies when a posting states no salary. Correct any row
  // that reads wrong — a wrong fact here is worse than no fact.

  // AI / GPU infrastructure
  "lambda":      { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "asset",    remote: "hybrid",       tcBand: "top" },
  "crusoe":      { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "asset",    remote: "hybrid",       tcBand: "strong" },
  "nebius":      { tier: "growth",      ownership: "public",  equity: "liquid",   vpBackground: "neutral",  remote: "hybrid",       tcBand: "strong" },
  "cerebras":    { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "mismatch", remote: "hybrid",       tcBand: "strong" },
  "modal":       { tier: "small",       ownership: "startup", equity: "illiquid", vpBackground: "neutral",  remote: "hybrid",       tcBand: "mid" },
  "anyscale":    { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "neutral",  remote: "hybrid",       tcBand: "strong" },
  "togetherai":  { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "neutral",  remote: "hybrid",       tcBand: "strong" },
  "baseten":     { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "neutral",  remote: "hybrid",       tcBand: "strong" },
  "langchain":   { tier: "small",       ownership: "startup", equity: "illiquid", vpBackground: "neutral",  remote: "hybrid",       tcBand: "mid" },

  // Data / analytics infrastructure
  "clickhouse":  { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "asset",    remote: "remote_first", tcBand: "strong" },
  "startree":    { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "asset",    remote: "remote_first", tcBand: "mid" },
  "materialize": { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "neutral",  remote: "remote_first", tcBand: "mid" },
  "airbyte":     { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "neutral",  remote: "remote_first", tcBand: "mid" },
  "prefect":     { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "neutral",  remote: "remote_first", tcBand: "mid" },
  "astronomer":  { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "asset",    remote: "remote_first", tcBand: "strong" },

  // Observability
  "sentry":      { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "asset",    remote: "hybrid",       tcBand: "strong" },
  "influxdata":  { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "asset",    remote: "remote_first", tcBand: "mid" },
  "auvik":       { tier: "growth",      ownership: "pe",      equity: "illiquid", vpBackground: "asset",    remote: "remote_first", tcBand: "mid" },

  // Developer platforms / cloud
  "pulumi":      { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "asset",    remote: "hybrid",       tcBand: "strong" }, // Seattle HQ
  "qumulo":      { tier: "established", ownership: "private", equity: "semi",     vpBackground: "asset",    remote: "hybrid",       tcBand: "mid"    }, // Seattle HQ
  "render":      { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "neutral",  remote: "remote_first", tcBand: "mid" },
  "supabase":    { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "neutral",  remote: "remote_first", tcBand: "strong" },
  "circleci":    { tier: "established", ownership: "private", equity: "semi",     vpBackground: "neutral",  remote: "remote_first", tcBand: "mid" },
  "sourcegraph": { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "neutral",  remote: "remote_first", tcBand: "strong" },
  "neon":        { tier: "growth",      ownership: "private", equity: "semi",     vpBackground: "neutral",  remote: "remote_first", tcBand: "mid" },
  "linear":      { tier: "small",       ownership: "private", equity: "semi",     vpBackground: "mismatch", remote: "remote_first", tcBand: "strong" },
};

/** Aliases → canonical key. Handles ATS slugs and common name variants. */
const ALIASES = {
  "grafanalabs": "grafana", "grafana labs": "grafana",
  "new relic": "newrelic", "sumo logic": "sumologic",
  "monte carlo": "montecarlo", "montecarlodata": "montecarlo", "monte carlo data": "montecarlo",
  "arizeai": "arize", "arize ai": "arize",
  "fiddler-ai": "fiddler", "fiddler ai": "fiddler",
  "observeinc": "observe", "observe inc": "observe",
  "scale ai": "scaleai",
  "weights & biases": "weightsbiases", "weights and biases": "weightsbiases", "wandb": "weightsbiases",
  "amazon web services": "aws", "amazon web services (aws)": "aws",
  "google cloud": "google", "google cloud platform": "google", "gcp": "google",
  "microsoft ai": "microsoft", "mojang studios": "microsoft",
  "temporaltechnologies": "temporal", "temporal technologies": "temporal",
  "dbtlabsinc": "dbtlabs", "dbt labs": "dbtlabs",
  "harnessinc": "harness",
  "bmc software": "bmc",
  "docker, inc": "docker", "docker inc": "docker",
  "snowflakecomputing": "snowflake",
  "gleanwork": "glean",
  "chronospherejobs": "chronosphere",
  "puppet labs": "puppet", "perforce": "puppet",
  // ATS board tokens and display names for the 2026-08-06 SOURCES expansion.
  // The `company` column is whatever the board reports — usually the token —
  // so these must map or the facts row is never found.
  "pulumicorporation": "pulumi", "pulumi corporation": "pulumi",
  "auviknetworks": "auvik", "auvik networks": "auvik",
  "sourcegraph91": "sourcegraph",
  "together ai": "togetherai", "together": "togetherai",
  "modal labs": "modal",
  "lambda labs": "lambda", "lambdalabs": "lambda", "lambda ai": "lambda",
  "crusoe energy": "crusoe", "crusoeenergy": "crusoe",
  "influxdb": "influxdata", "influx data": "influxdata",
  "clickhouse inc": "clickhouse",
  "neon database": "neon", "neondatabase": "neon",
  "dagster labs": "dagsterlabs",
};

/**
 * Look up curated facts for a company name.
 * Returns null when unknown — callers MUST drop confidence rather than
 * substituting a default. An unknown company is a known unknown.
 */
export function getCompanyFacts(companyName) {
  if (!companyName) return null;
  const raw = String(companyName).toLowerCase().trim()
    .replace(/[.,]/g, "")
    .replace(/\s+(inc|llc|corp|corporation|ltd|co)$/g, "")
    .trim();
  const key = ALIASES[raw] || raw.replace(/\s+/g, "");
  return FACTS[key] || FACTS[ALIASES[key]] || null;
}

export function isKnownCompany(companyName) {
  return getCompanyFacts(companyName) !== null;
}

export const COMPANY_COUNT = Object.keys(FACTS).length;
export { FACTS as _FACTS };
