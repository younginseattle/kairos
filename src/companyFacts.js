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
