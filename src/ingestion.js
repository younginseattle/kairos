/**
 * ═══════════════════════════════════════════════════════════════
 * JOB INGESTION PIPELINE
 * Fetches → Filters → Normalizes → Deduplicates → Inserts → Evaluates
 *
 * Usage (from React app):
 *   import { runJobIngestion, SOURCES } from './ingestion.js'
 *   await runJobIngestion(supabaseClient, anthropicApiKey, candidateProfile)
 *
 * All board IDs below have been verified against live Greenhouse/Lever APIs.
 * FAANG companies (Google, Apple, Microsoft, Amazon, Meta) use proprietary
 * Workday-based ATS systems and are not accessible via these APIs.
 * Use the Search Plan tab in the app to surface FAANG roles manually.
 * ═══════════════════════════════════════════════════════════════
 */

import { computeFit, shouldAutoPass } from "./scoring.js";
import { FIT_EXTRACTION_PROMPT, buildFitUserMessage, extractionToSignals } from "./fitPrompt.js";

// ─────────────────────────────────────────────────────────────────
// SOURCES — verified Greenhouse and Lever board IDs
// Grouped by domain relevance to observability/platform/infra PM roles
// ─────────────────────────────────────────────────────────────────

// Companies where broader title filtering applies — they hire senior PMs
// at Director/VP level but may title them differently (e.g. "Product Manager L7")
const BROAD_FILTER_COMPANIES = new Set([
  "anthropic", "openai", "deepmind", "cohere", "mistral",
  "github", "linear", "vercel", "harness",
]);

export const SOURCES = [
  // ── Observability / monitoring ────────────────────────────────
  { id: "datadog",              ats: "greenhouse", tier: 1, domain: "observability"                    },
  { id: "elastic",              ats: "greenhouse", tier: 1, domain: "observability"                    },
  { id: "newrelic",             ats: "greenhouse", tier: 1, domain: "observability"                    },
  { id: "pagerduty",            ats: "greenhouse", tier: 1, domain: "observability"                    },
  { id: "grafanalabs",          ats: "greenhouse", tier: 1, domain: "observability"                    },
  { id: "honeycomb",            ats: "greenhouse", tier: 1, domain: "observability",  broadFilter: true },
  { id: "sumologic",            ats: "greenhouse", tier: 1, domain: "observability"                    },
  { id: "arizeai",              ats: "greenhouse", tier: 1, domain: "observability",  broadFilter: true },
  // Previously noted as unreachable ("Host not in allowlist") — that was this dev
  // sandbox's own outbound proxy policy blocking ashbyhq.com, not a real
  // restriction on these companies' boards. Two live GitHub Actions runs
  // confirmed: (1) fiddler-ai and Braintrust are real, reachable Ashby boards
  // — the actual blocker was fetchAshbyJobs reading the wrong field name
  // (`jobPostings` vs the real `jobs`), now fixed with evidence from that
  // run's diagnostic logging; (2) observeinc and galileo (Rippling) returned
  // genuine HTTP 404 despite live, human-browsable pages at those URLs —
  // their public APIs are evidently disabled even though the site itself
  // works. Not re-added; use LinkedIn alerts for those two instead.
  { id: "fiddler-ai",           ats: "ashby",      tier: 1, domain: "observability",  broadFilter: true },
  { id: "Braintrust",           ats: "ashby",      tier: 1, domain: "observability",  broadFilter: true },

  // ── AI / ML platforms (broad filter — any senior PM role) ────
  { id: "anthropic",            ats: "greenhouse", tier: 1, domain: "platform",       broadFilter: true },
  { id: "databricks",           ats: "greenhouse", tier: 1, domain: "platform",       broadFilter: true },
  { id: "gleanwork",            ats: "greenhouse", tier: 1, domain: "platform",       broadFilter: true },

  // ── Infrastructure / cloud ────────────────────────────────────
  { id: "cloudflare",           ats: "greenhouse", tier: 1, domain: "infrastructure" },
  { id: "coreweave",            ats: "greenhouse", tier: 1, domain: "infrastructure" },
  { id: "temporaltechnologies", ats: "greenhouse", tier: 1, domain: "platform"       },
  { id: "launchdarkly",         ats: "greenhouse", tier: 2, domain: "platform"       },

  // ── Developer / software delivery tools ──────────────────────
  { id: "vercel",               ats: "greenhouse", tier: 2, domain: "devtools",       broadFilter: true },
  { id: "postman",              ats: "greenhouse", tier: 2, domain: "devtools"        },
  { id: "dbtlabsinc",           ats: "greenhouse", tier: 2, domain: "platform"        },
  { id: "harnessinc",           ats: "greenhouse", tier: 1, domain: "devtools", broadFilter: true },
  
  // ── Platform / data / SaaS ────────────────────────────────────
  { id: "twilio",               ats: "greenhouse", tier: 1, domain: "platform"        },
  { id: "mongodb",              ats: "greenhouse", tier: 2, domain: "platform"        },
  { id: "stripe",               ats: "greenhouse", tier: 2, domain: "platform"        },
  { id: "gitlab",               ats: "greenhouse", tier: 1, domain: "devtools"        },

  // ── Seattle ecosystem ─────────────────────────────────────────
  { id: "smartsheet",           ats: "greenhouse", tier: 1, domain: "platform"        },
  { id: "Samsara",              ats: "greenhouse", tier: 2, domain: "infrastructure"  },

  // ── Observability (expanded) ──────────────────────────────────
  { id: "cribl",             ats: "greenhouse", tier: 1, domain: "observability"             },
  { id: "kentik",            ats: "greenhouse", tier: 2, domain: "observability"             },
  { id: "chronospherejobs",  ats: "ashby",      tier: 1, domain: "observability", broadFilter: true },
  { id: "montecarlodata",    ats: "ashby",      tier: 1, domain: "observability", broadFilter: true },

  // ── AI / ML platforms (expanded) ─────────────────────────────
  { id: "scaleai",           ats: "greenhouse", tier: 1, domain: "platform",  broadFilter: true },
  { id: "pinecone",          ats: "ashby",      tier: 1, domain: "platform",  broadFilter: true },

  // ── Infrastructure / data platform (expanded) ─────────────────
  { id: "fastly",            ats: "greenhouse", tier: 1, domain: "infrastructure"            },
  { id: "fivetran",          ats: "greenhouse", tier: 2, domain: "platform"                  },
  // snowflakecomputing and airbyte returned genuine HTTP 404 from a real GitHub
  // Actions run despite live, human-browsable Greenhouse pages at those tokens —
  // public API access is evidently disabled for both. Not re-added; use
  // LinkedIn alerts for these instead.
  { id: "confluent",         ats: "ashby",      tier: 1, domain: "platform",  broadFilter: true },

  // ── Developer / software delivery tools (expanded) ────────────
  // retool returned HTTP 404 from a real Actions run for the same reason —
  // dropped rather than re-guessed. Use LinkedIn alerts for it instead.
  { id: "posthog",           ats: "ashby",      tier: 2, domain: "devtools",  broadFilter: true },

  // ── Defense tech ─────────────────────────────────────────────
  // Note: Anduril, Palantir, Shield AI, Rebellion Defense, Skydio, Joby, Wisk, Archer,
  // Rocket Lab, Planet, Axiom Space, Relativity Space all return "Host not in allowlist"
  // on their Greenhouse/Lever boards — public API access is disabled by those companies.
  { id: "epirus",            ats: "greenhouse", tier: 2, domain: "defense"                   },

  // ── Aggregators — broaden beyond the hand-curated company list above ──
  // `id` here is a feed identifier, not a company — company comes from each
  // listing. Wellfound/AngelList was considered but has no public API, only
  // third-party scrapers of its site; not added for that reason.
  { id: "remoteok",              ats: "remoteok",       tier: 3, domain: "aggregator" },
  { id: "remote-product-jobs",   ats: "weworkremotely", tier: 3, domain: "aggregator" },
];
// ─────────────────────────────────────────────────────────────────
// FILTER CONFIGURATION
// ─────────────────────────────────────────────────────────────────

const SENIORITY_KEYWORDS = [
  "director",
  "head of product",
  "vp of product",
  "vp product",
  "vice president of product",
  "vice president, product",
  "group product manager",
  "group pm",
  "staff product manager",
  "staff pm",
  "principal product manager",
  "principal pm",
];

const DOMAIN_KEYWORD = "product";

/**
 * Drop any title containing these — prevents false positives like
 * "Principal Product Marketing Manager" or "Director of Product Engineering".
 */
const EXCLUSION_KEYWORDS = [
  "marketing",
  "engineer",
  "developer",
  "designer",
  "analyst",
  "counsel",
  "finance",
  "sales",
  "recruiter",
  "data science",
  "research",
  "operations",
  "security",
  "design",
];

// ─────────────────────────────────────────────────────────────────
// CLAUDE EVALUATION PROMPT
// Keep in sync with FIT_PROMPT in App.jsx
// ─────────────────────────────────────────────────────────────────

// FIT_PROMPT removed — replaced by the shared extraction prompt in fitPrompt.js.
// See scoring.js for why the model no longer emits a fit score directly.


const DEFAULT_CANDIDATE_PROFILE = `VP / Director-level Product Leader

Target roles: Director / Sr Director / VP / Staff PM / Group PM
Focus areas: Platform, Infrastructure, AI, Data products, Observability

Experience:
- VMware: Led platform product strategy for observability and infrastructure tooling
- Puppet: Product leadership for DevOps automation SaaS platform
- HPE: Enterprise infrastructure product management
- Domotz: Scaled SaaS network management platform (ARR growth, churn reduction)

Core strengths:
- Platform & API-first products (infrastructure, observability, developer tools)
- Scaling SaaS businesses — ARR growth, retention, PLG motions
- Leading cross-functional teams of PMs and engineers
- Data-driven product strategy and roadmap prioritization
- Automation and AI-enabled product workflows`;

// ─────────────────────────────────────────────────────────────────
// LOCATION FILTER — US only
// ─────────────────────────────────────────────────────────────────

const NON_US_COUNTRIES = [
  "united kingdom", "england", "scotland", "wales", ", uk",
  "canada", "germany", "netherlands", "france", "spain", "italy",
  "australia", "new zealand", "ireland", "india", "singapore",
  "japan", "south korea", "brazil", "mexico", "sweden", "norway",
  "denmark", "finland", "switzerland", "austria", "belgium",
  "poland", "czech", "hungary", "romania", "portugal",
  "israel", "dubai", "uae", "south africa", "philippines",
];

// Domains that should never appear in job URLs — job aggregators and
// non-primary sources that don't represent direct employer postings.
const BLOCKED_URL_DOMAINS = [
  "theladders.com",
  "ladder.io",
  "ziprecruiter.com",
  "simplyhired.com",
  "careerbuilder.com",
  "monster.com",
  "dice.com",
];

/**
 * Returns false if the job URL is from a blocked aggregator domain.
 */
function isAllowedURL(url) {
  if (!url) return true;
  const u = url.toLowerCase();
  return !BLOCKED_URL_DOMAINS.some(d => u.includes(d));
}

/**
 * Returns true if the job location is in the US (or remote with no country qualifier).
 * When location is empty/null/"remote", also scans the description for explicit
 * non-US country requirements to catch roles where Greenhouse omits the location field.
 */
export function isUSJob(job) {
  const loc = (job.location || "").toLowerCase().trim();

  // If location is clearly non-US, reject immediately
  if (loc && NON_US_COUNTRIES.some(c => loc.includes(c))) return false;

  // If location is absent or generic ("remote"), scan description for explicit
  // non-US country mentions that indicate a geographic requirement
  if (!loc || loc === "remote") {
    const desc = (job.description || "").toLowerCase();
    // Only reject when the country appears near a location-requirement signal
    const nonUSInDesc = NON_US_COUNTRIES.some(country =>
      new RegExp(`(locat|based|office|headquarter|must reside|work from).{0,60}${country}|${country}.{0,60}(locat|based|office|headquarter|only)`, "i").test(desc)
    );
    if (nonUSInDesc) return false;
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────
// LOGGING
// ─────────────────────────────────────────────────────────────────

function log(msg)      { console.log(`[ingestion] ${msg}`); }
function logError(msg) { console.error(`[ingestion] ERROR: ${msg}`); }

// ─────────────────────────────────────────────────────────────────
// 1. JOB FETCHERS
// ─────────────────────────────────────────────────────────────────

function fetchWithTimeout(url, { timeoutMs = 10000, headers } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal, headers }).finally(() => clearTimeout(timer));
}

async function fetchGreenhouseJobs(companyId) {
  const res = await fetchWithTimeout(`https://boards-api.greenhouse.io/v1/boards/${companyId}/jobs`);
  if (!res.ok) throw new Error(`Greenhouse fetch failed for "${companyId}" — HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.jobs)) throw new Error(`Greenhouse: unexpected response for "${companyId}"`);
  return data.jobs.map(job => ({
    title:       job.title,
    location:    job.location?.name || null,
    url:         job.absolute_url,
    description: job.content || "",
    company:     companyId,
    source:      "greenhouse",
  }));
}

async function fetchLeverJobs(companyId) {
  const res = await fetchWithTimeout(`https://api.lever.co/v0/postings/${companyId}?mode=json`);
  if (!res.ok) throw new Error(`Lever fetch failed for "${companyId}" — HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`Lever: unexpected response for "${companyId}"`);
  return data.map(job => ({
    title:       job.text,
    location:    job.categories?.location || null,
    url:         job.hostedUrl,
    description: job.description || "",
    company:     companyId,
    source:      "lever",
  }));
}

async function fetchAshbyJobs(companyId) {
  const res = await fetchWithTimeout(`https://api.ashbyhq.com/posting-api/job-board/${companyId}`);
  if (!res.ok) throw new Error(`Ashby fetch failed for "${companyId}" — HTTP ${res.status}`);
  const data = await res.json();
  // Confirmed via a live run's diagnostic logging (not guessed): Ashby's
  // posting-api actually returns the array under `jobs`, with `apiVersion`
  // alongside it — not `jobPostings` as originally assumed. Keeping the
  // diagnostic error for any other unrecognized shape so a future mismatch
  // is debuggable from the log instead of opaque.
  if (!Array.isArray(data.jobs)) {
    throw new Error(`Ashby: unexpected response shape for "${companyId}" — no jobs array (keys: ${Object.keys(data).join(", ") || "none"})`);
  }
  return data.jobs.map(job => ({
    title:       job.title,
    location:    job.locationName || null,
    url:         job.jobUrl || job.applyUrl,
    description: job.descriptionHtml || "",
    company:     companyId,
    source:      "ashby",
  }));
}

async function fetchRipplingJobs(companyId) {
  const res = await fetchWithTimeout(`https://ats.rippling.com/api/v2/jobs?companySlug=${companyId}`);
  if (!res.ok) throw new Error(`Rippling fetch failed for "${companyId}" — HTTP ${res.status}`);
  const data = await res.json();
  const jobs = Array.isArray(data) ? data : data.jobs;
  if (!Array.isArray(jobs)) throw new Error(`Rippling: unexpected response for "${companyId}"`);
  return jobs.map(job => ({
    title:       job.title || job.jobTitle,
    location:    job.location || job.locationName || null,
    url:         job.url || job.applyUrl || job.jobUrl,
    description: job.description || job.descriptionHtml || "",
    company:     companyId,
    source:      "rippling",
  }));
}

// ── Aggregators ──────────────────────────────────────────────────
// Unlike the ATS fetchers above, one request here returns jobs from many
// different companies — so `company` is read per-listing from the job data
// itself, not defaulted to the source id (which is just a feed identifier).

async function fetchRemoteOkJobs() {
  const res = await fetchWithTimeout("https://remoteok.com/api", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; KairosJobBot/1.0)" },
  });
  if (!res.ok) throw new Error(`RemoteOK fetch failed — HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("RemoteOK: unexpected response — not an array");
  // The first element is a legal/metadata notice, not a job posting.
  return data.slice(1).map(job => ({
    title:       job.position,
    location:    job.location || "Remote",
    url:         job.apply_url || job.url,
    description: job.description || "",
    company:     job.company || "",
    source:      "remoteok",
  }));
}

async function fetchWeWorkRemotelyJobs(feedSlug) {
  const res = await fetchWithTimeout(`https://weworkremotely.com/categories/${feedSlug}.rss`);
  if (!res.ok) throw new Error(`WeWorkRemotely fetch failed for "${feedSlug}" — HTTP ${res.status}`);
  const xml = await res.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.map(item => {
    const rawTitle    = extractXmlField(item, "title");
    const link        = extractXmlField(item, "link");
    const description = extractXmlField(item, "description");
    // WWR's RSS convention: title is rendered as "Company: Job Title".
    const colonIndex = rawTitle.indexOf(":");
    const company = colonIndex > -1 ? rawTitle.slice(0, colonIndex).trim() : "";
    const title   = colonIndex > -1 ? rawTitle.slice(colonIndex + 1).trim() : rawTitle;
    return { title, company, location: "Remote", url: link, description, source: "weworkremotely" };
  });
}

function extractXmlField(block, tag) {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
  if (!m) return "";
  return m[1]
    .replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
}

/**
 * Dispatches to the correct fetcher.
 * Failures are isolated — one bad source never blocks the rest.
 */
async function fetchJobsFromSource({ id, ats }) {
  try {
    log(`Fetching ${ats} → ${id}…`);
    let jobs;
    if      (ats === "greenhouse")     jobs = await fetchGreenhouseJobs(id);
    else if (ats === "lever")          jobs = await fetchLeverJobs(id);
    else if (ats === "ashby")          jobs = await fetchAshbyJobs(id);
    else if (ats === "rippling")       jobs = await fetchRipplingJobs(id);
    else if (ats === "remoteok")       jobs = await fetchRemoteOkJobs();
    else if (ats === "weworkremotely") jobs = await fetchWeWorkRemotelyJobs(id);
    else throw new Error(`Unknown ats type "${ats}"`);
    log(`  ✓ ${jobs.length} jobs from ${id}`);
    return jobs;
  } catch (err) {
    logError(`  ✗ ${id} (${ats}): ${err.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────
// 2. ROLE FILTERING
// ─────────────────────────────────────────────────────────────────

/**
 * Returns true only if the title:
 *   - contains a seniority keyword
 *   - contains "product"
 *   - does NOT contain any exclusion keyword
 */
export function isRelevantJob(job, source = null) {
  if (!job.title) return false;
  const title = job.title.toLowerCase();
  const isExcluded = EXCLUSION_KEYWORDS.some(kw => title.includes(kw));
  if (isExcluded) return false;

  // Broad filter: for top AI/dev-tool companies, accept any senior PM role
  // regardless of exact title — catches "Product Manager L7", "PM, Core" etc.
  // "manager" alone is intentionally excluded — too many non-senior PM roles slip through.
  const useBroadFilter = source?.broadFilter === true;
  if (useBroadFilter) {
    const hasProduct  = title.includes("product");
    const hasSenior   = title.includes("senior") || title.includes("staff") ||
                        title.includes("principal") || title.includes("director") ||
                        title.includes("lead") || title.includes("head") ||
                        title.includes("group") || title.includes("vp");
    return hasProduct && hasSenior;
  }

  // Standard filter: must have seniority signal + "product"
  const hasSeniority = SENIORITY_KEYWORDS.some(kw => title.includes(kw));
  const hasProduct   = title.includes(DOMAIN_KEYWORD);
  return hasSeniority && hasProduct;
}

// ─────────────────────────────────────────────────────────────────
// 3. NORMALIZATION
// ─────────────────────────────────────────────────────────────────

/**
 * Maps raw job to the Supabase jobs table shape.
 * Includes the `source` column added via SQL migration.
 */
export function normalizeJob(job) {
  return {
    title:       (job.title       || "").trim(),
    company:     (job.company     || "").trim(),
    description: (job.description || "").trim(),
    location:    (job.location    || "Remote").trim(),
    url:         (job.url         || "").trim(),
    source:      job.source || "manual",
    status:      "new",
    created_at:  new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────
// 4. DEDUPLICATION
// ─────────────────────────────────────────────────────────────────

// LinkedIn serves the same posting at both linkedin.com/jobs/view/{id}/ and
// linkedin.com/comm/jobs/view/{id} (no trailing slash) — dedup by the
// extracted numeric id when the URL is a LinkedIn job link, so any variant
// matches an existing row; exact string match for everything else.
function extractLinkedInJobId(url) {
  const m = /linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/.exec(url || "");
  return m ? m[1] : null;
}

/**
 * Returns true if a job with this URL already exists in Supabase.
 * On DB error, returns false (assume not duplicate) to avoid silent drops.
 */
export async function isDuplicateJob(supabaseClient, url) {
  if (!url) return false;
  const jobId = extractLinkedInJobId(url);
  // .limit(1) + array-length check rather than .maybeSingle() — the ilike
  // pattern (and, given pre-existing duplicate rows, even an exact match in
  // rare cases) can match more than one row, and .maybeSingle() throws if so.
  const query = jobId
    ? supabaseClient.from("jobs").select("id").ilike("url", `%jobs/view/${jobId}%`)
    : supabaseClient.from("jobs").select("id").eq("url", url);
  const { data, error } = await query.limit(1);
  if (error) {
    logError(`Duplicate check failed for "${url}": ${error.message}`);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

// ─────────────────────────────────────────────────────────────────
// 5. INSERTION
// ─────────────────────────────────────────────────────────────────

/**
 * Inserts a normalized job into Supabase.
 * Returns the inserted row (with generated id).
 */
export async function insertJob(supabaseClient, job) {
  const { data, error } = await supabaseClient
    .from("jobs")
    .insert(job)
    .select()
    .single();
  if (error) throw new Error(`Insert failed for "${job.title}": ${error.message}`);
  return data;
}

// ─────────────────────────────────────────────────────────────────
// 6. CLAUDE EVALUATION
// ─────────────────────────────────────────────────────────────────

/**
 * Evaluates a job against the candidate profile using Claude.
 * Writes scoring results back to the Supabase row.
 * Returns the evaluation object, or null on failure.
 */
export async function runClaudeEvaluation(supabaseClient, job, anthropicApiKey, candidateProfile) {
  if (!anthropicApiKey) {
    logError("No Anthropic API key — skipping evaluation");
    return null;
  }

  // Claude EXTRACTS structured evidence; scoring.js computes the number.
  // Claude is never asked "score this 0-100" — that is what produced the old
  // distribution where a third of the pipeline came back as exactly 72.
  let extraction;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         anthropicApiKey.trim(),
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-6",
        max_tokens: 1500,
        temperature: 0,   // extraction is not a creative task
        system:     FIT_EXTRACTION_PROMPT,
        messages:   [{ role: "user", content: buildFitUserMessage({
          title: job.title, company: job.company, location: job.location, jd: job.description,
        }) }],
      }),
    });
    if (!res.ok) throw new Error(`Claude API HTTP ${res.status}`);
    const payload = await res.json();
    if (payload.error) throw new Error(payload.error.message);
    const raw = payload.content.map(b => b.text || "").join("").trim()
      .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();
    extraction = JSON.parse(raw);
  } catch (err) {
    logError(`Claude extraction failed for "${job.title}" at ${job.company}: ${err.message}`);
    return null;
  }

  // Deterministic scoring from the extracted signals.
  let fit;
  try {
    const signals = extractionToSignals(extraction, { company: job.company, jd: job.description });
    // Manual overrides already recorded on the row always win over inference.
    if (job.comp_verified_tc != null) signals.compVerifiedTc = job.comp_verified_tc;
    if (job.burden_verified   != null) signals.burdenOverride  = job.burden_verified;
    fit = computeFit(signals);
  } catch (err) {
    logError(`Fit computation failed for "${job.title}" at ${job.company}: ${err.message}`);
    return null;
  }

  // Legacy-compatible view so existing UI/queries keep working unchanged.
  const evaluation = {
    overall_score: fit.score,
    confidence:    fit.confidence,
    fit,
    extraction,
    strengths:  extraction.strengths  || [],
    gaps:       extraction.gaps       || [],
    quick_wins: extraction.quick_wins || [],
    verdict:    extraction.verdict    || "",
    recommendation:
      fit.band.key === "apply_now"  ? "apply" :
      fit.band.key === "apply_if"   ? "apply_with_note" :
      fit.band.key === "warm_intro" ? "stretch" : "skip",
    missing_keywords: (extraction.known_gaps || []).map(g => g.gap),
    strategic_gaps:   (extraction.known_gaps || []).filter(g => g.level === "required").map(g => g.why || g.gap),
    skills_match:      fit.subscores.non_interchangeability,
    experience_match:  fit.subscores.level,
    culture_match:     fit.subscores.burden,
    compensation_score: fit.subscores.compensation,
    location_score:     fit.subscores.burden,
    company_score:      fit.subscores.domain,
    work_life_balance_score: fit.subscores.burden,
    growth_score:       fit.subscores.domain,
    score_explanation: {
      key_factor: fit.explanations.domain,
      strengths:  extraction.strengths || [],
      weaknesses: Object.values(fit.gates).map(g => g.reason),
    },
    top_candidate_signal: {
      level: fit.score >= 85 ? "HIGH" : fit.score >= 70 ? "MEDIUM" : "LOW",
      reason: fit.explanations.non_interchangeability,
    },
  };

  // Write evaluation fields back to the Supabase row
  try {
    const { error } = await supabaseClient
      .from("jobs")
      .update({
        score:                   evaluation.overall_score,
        recommendation:          evaluation.recommendation,
        strengths:               evaluation.strengths               || [],
        gaps:                    evaluation.gaps                    || [],
        quick_wins:              evaluation.quick_wins              || [],
        missing_keywords:        evaluation.missing_keywords        || [],
        strategic_gaps:          evaluation.strategic_gaps          || [],
        verdict:                 evaluation.verdict,
        skills_match:            evaluation.skills_match,
        experience_match:        evaluation.experience_match,
        culture_match:           evaluation.culture_match,
        compensation_score:      evaluation.compensation_score,
        work_life_balance_score: evaluation.work_life_balance_score,
        growth_score:            evaluation.growth_score,
        location_score:          evaluation.location_score,
        company_score:           evaluation.company_score,
        confidence_score:        evaluation.confidence,
        score_explanation:       evaluation.score_explanation       || null,
        top_candidate_signal:    evaluation.top_candidate_signal    || null,
        // v2 columns — additive, existing consumers are unaffected
        fit_score:               fit.score,
        fit_confidence:          fit.confidence,
        fit_model_version:       fit.model_version,
        fit_detail: {
          subscores:    fit.subscores,
          explanations: fit.explanations,
          gates:        fit.gates,
          gaps:         fit.gaps,
          math:         fit.math,
          band:         fit.band,
          confidence_reasons: fit.confidence_reasons,
          extraction,
        },
      })
      .eq("id", job.id);
    if (error) logError(`Failed to write evaluation for job ${job.id}: ${error.message}`);
  } catch (err) {
    logError(`Supabase update failed for job ${job.id}: ${err.message}`);
  }

  return evaluation;
}

// ─────────────────────────────────────────────────────────────────
// 7. MAIN INGESTION PIPELINE
// ─────────────────────────────────────────────────────────────────

/**
 * Orchestrates the full pipeline:
 *   fetch → filter → normalize → deduplicate → insert → evaluate
 *
 * @param {object} supabaseClient      — initialized Supabase client
 * @param {string} anthropicApiKey     — Anthropic API key (skips eval if null)
 * @param {string} [candidateProfile]  — override candidate profile text
 * @param {Array}  [sources]           — override source list (default: SOURCES)
 *
 * @returns {{ total, filtered, inserted, evaluated, skipped, sourceResults }}
 */
export async function runJobIngestion(
  supabaseClient,
  anthropicApiKey  = null,
  candidateProfile = DEFAULT_CANDIDATE_PROFILE,
  sources          = SOURCES,
) {
  log("═══ Ingestion started ═══");
  const startTime = Date.now();

  // 1. Fetch from all sources in parallel — failures isolated per source
  const fetchResults = await Promise.all(
    sources.map(async source => {
      const jobs = await fetchJobsFromSource(source);
      return { source, jobs };
    })
  );

  // Build per-source summary for UI display
  const sourceResults = fetchResults.map(({ source, jobs }) => ({
    id:       source.id,
    ats:      source.ats,
    tier:     source.tier,
    domain:   source.domain,
    fetched:  jobs.length,
    failed:   jobs.length === 0,
  }));

  const allJobs = fetchResults.flatMap(r => r.jobs);
  log(`Total fetched: ${allJobs.length}`);

  // 2. Filter for relevant roles — pass source config so broadFilter companies work
  const relevantJobs = fetchResults.flatMap(({ source, jobs }) =>
    jobs.filter(job => isRelevantJob(job, source) && isUSJob(job) && isAllowedURL(job.url))
  );
  log(`Relevant after filter: ${relevantJobs.length}`);

  if (relevantJobs.length === 0) {
    log("No relevant jobs found — nothing to insert.");
    return { total: allJobs.length, filtered: 0, inserted: 0, evaluated: 0, skipped: 0, sourceResults };
  }

  // 3. Normalize
  const normalizedJobs = relevantJobs.map(normalizeJob);

  // 4–6. Deduplicate → Insert → Evaluate
  let insertedCount  = 0;
  let skippedCount   = 0;
  let evaluatedCount = 0;

  for (const job of normalizedJobs) {
    if (!job.url) {
      logError(`No URL — skipping: "${job.title}" at ${job.company}`);
      skippedCount++;
      continue;
    }

    const duplicate = await isDuplicateJob(supabaseClient, job.url);
    if (duplicate) {
      log(`  Duplicate — skipping: "${job.title}" at ${job.company}`);
      skippedCount++;
      continue;
    }

    let insertedJob;
    try {
      insertedJob = await insertJob(supabaseClient, job);
      insertedCount++;
      log(`  ✓ Inserted: "${job.title}" at ${job.company}`);
    } catch (err) {
      logError(`  ✗ Insert failed: "${job.title}" — ${err.message}`);
      skippedCount++;
      continue;
    }

    if (anthropicApiKey) {
      const evaluation = await runClaudeEvaluation(
        supabaseClient, insertedJob, anthropicApiKey, candidateProfile,
      );
      if (evaluation) {
        evaluatedCount++;
        log(`  ✓ Evaluated: "${job.title}" — score ${evaluation.overall_score}`);
        // Hide ONLY on a structural disqualifier, never on a borderline score.
        // See shouldAutoPass() in scoring.js — the old `score < 55` rule buried
        // 87% of the pipeline when the comp model was misreading base as TC.
        const autoPass = shouldAutoPass(evaluation.fit);
        if (autoPass.pass) {
          await supabaseClient.from("jobs").update({ status: "pass" }).eq("id", insertedJob.id);
          log(`  → Auto-passed (${autoPass.reason}, score ${evaluation.overall_score})`);
        } else if (evaluation.overall_score < 55) {
          // Kept visible on purpose — ranking handles it, hiding does not.
          log(`  → Low score ${evaluation.overall_score} but left visible (${autoPass.reason})`);
        }
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log("═══ Ingestion complete ═══");
  log(`  Fetched:   ${allJobs.length}`);
  log(`  Filtered:  ${relevantJobs.length}`);
  log(`  Inserted:  ${insertedCount}`);
  log(`  Evaluated: ${evaluatedCount}`);
  log(`  Skipped:   ${skippedCount}`);
  log(`  Time:      ${elapsed}s`);

  return {
    total:         allJobs.length,
    filtered:      relevantJobs.length,
    inserted:      insertedCount,
    evaluated:     evaluatedCount,
    skipped:       skippedCount,
    sourceResults,
  };
}