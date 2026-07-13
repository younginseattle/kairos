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
  // Note: fiddler-ai, observeinc, braintrust (Ashby) and galileo (Rippling) return
  // "Host not in allowlist" — their boards restrict public API access. Use LinkedIn alerts.

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

  // ── AI / ML platforms (expanded) ─────────────────────────────
  { id: "scaleai",           ats: "greenhouse", tier: 1, domain: "platform",  broadFilter: true },

  // ── Infrastructure / data platform (expanded) ─────────────────
  { id: "fastly",            ats: "greenhouse", tier: 1, domain: "infrastructure"            },
  { id: "fivetran",          ats: "greenhouse", tier: 2, domain: "platform"                  },

  // ── Defense tech ─────────────────────────────────────────────
  // Note: Anduril, Palantir, Shield AI, Rebellion Defense, Skydio, Joby, Wisk, Archer,
  // Rocket Lab, Planet, Axiom Space, Relativity Space all return "Host not in allowlist"
  // on their Greenhouse/Lever boards — public API access is disabled by those companies.
  { id: "epirus",            ats: "greenhouse", tier: 2, domain: "defense"                   },
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

const FIT_PROMPT = `You are a senior career coach specializing in Product Management leadership roles. Analyze the fit between a job description and a candidate profile. Return ONLY raw JSON — no markdown fences, no explanation.

Schema:
{
  "overall_score": integer 0-100,
  "confidence": number 0-100,
  "skills_match": integer 0-100,
  "experience_match": integer 0-100,
  "culture_match": integer 0-100,
  "compensation_score": integer 0-100,
  "work_life_balance_score": integer 0-100,
  "growth_score": integer 0-100,
  "location_score": integer 0-100,
  "company_score": integer 0-100,
  "strengths": [up to 4 short strings],
  "gaps": [up to 3 short strings],
  "quick_wins": [up to 3 short strings],
  "missing_keywords": [important JD keywords not in resume, up to 8],
  "strategic_gaps": [real gaps that could weaken candidacy, up to 4],
  "verdict": "2-3 sentence honest assessment",
  "recommendation": "apply" | "apply_with_note" | "stretch" | "skip",
  "score_explanation": {
    "key_factor": "single most important factor",
    "strengths": [2-3 short strings],
    "weaknesses": [1-2 short strings]
  },
  "top_candidate_signal": {
    "level": "HIGH | MEDIUM | LOW",
    "reason": "1 sentence"
  }
}

STRICT RULES:
- Not clearly Manager/Director/VP/Staff/Group PM level → below 60
- Outside observability/platform/infrastructure/data/AI → subtract 15+
- Experience mismatch → cap at 65
- Vague/minimal JD → confidence below 50, score below 60
- PRODUCT ROLE PROTECTION — MANDATORY: If the job title contains VP, Director, Head of, Group PM, Staff PM, or Principal PM, apply ALL of the following without exception:
  * experience_match: score against PM leadership tenure and domain relevance ONLY. Do NOT factor in engineering management history, hands-on use of specific infra tools (Slurm, InfiniBand, RDMA, Kubernetes ops, etc.), or research lab background. A VP of Product candidate with 10+ years PM experience in a relevant domain gets experience_match ≥ 55. With partial domain overlap, experience_match ≥ 45. experience_match below 40 is invalid for a VP/Director PM role.
  * skills_match: score against product strategy, roadmapping, cross-functional leadership, and domain knowledge. Technical fluency to partner with engineering is sufficient — the candidate does not need to personally operate infrastructure tools. skills_match ≥ 45 for any VP/Director PM role in target domains.
  * overall_score floor: 50 minimum for a VP/Director PM role at a target company (CoreWeave, Anthropic, Datadog, etc.) even when real gaps exist. Score 50-65 = stretch/apply_with_note. Score below 45 requires the role to not be a PM role at all.
  * Use recommendation="stretch" (not "skip") when the role is clearly a PM title but requires engineering depth the candidate lacks.
- TARGET COMPANIES (company_score 80-95): CoreWeave, Anthropic, Databricks, Grafana Labs, Datadog, Elastic, New Relic, Cloudflare, Temporal, LaunchDarkly, PagerDuty, Honeycomb, Sumo Logic, Cribl, Scale AI, Glean
- LOCATION (candidate is Seattle-based, no relocation): Always scan the FULL job description for remote signals ("or remote", "or remotely", "remotely in", "remote option", "remote eligible", "work remotely") — if any are present, treat as remote regardless of what the location field says. Remote=95-100, Seattle/WA area=90-95, Hybrid Seattle=80-85, Hybrid elsewhere=60-75, In-office non-Seattle=40-60, Requires relocation=10-30
- work_life_balance_score: 85-100=remote-first or async culture, explicit flexibility signals, generous PTO, established company with balance-positive signals; 70-84=hybrid with flexibility, public/established company, no on-call signals, standard benefits; 50-69=high-growth startup, "fast-paced"/"high-velocity"/"wear many hats" language, implicit intensity, Series A/B; 30-49=on-call required, "always-on" culture, early-stage startup, 24/7 availability signals, explicit high-intensity language

SCORING: weight experience_match 40%, skills_match 30%, role level gate.
Most jobs 50-75. Only 80+ for clearly strong senior SaaS/platform fits.
Scores below 40 require explicit justification that the role title itself is not a PM role.

Breakdown:
- compensation_score: seniority + company size signals
- work_life_balance_score: culture, startup vs enterprise
- growth_score: upward mobility, scope
- location_score: Remote=90-100, major hub=75-90, hybrid=65-80, relocation=30-60
- company_score: brand, growth trajectory, relevance to platform/infra/AI`;

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

function fetchWithTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
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
  if (!Array.isArray(data.jobPostings)) throw new Error(`Ashby: unexpected response for "${companyId}"`);
  return data.jobPostings.map(job => ({
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

/**
 * Dispatches to the correct fetcher.
 * Failures are isolated — one bad source never blocks the rest.
 */
async function fetchJobsFromSource({ id, ats }) {
  try {
    log(`Fetching ${ats} → ${id}…`);
    const jobs =
      ats === "greenhouse" ? await fetchGreenhouseJobs(id) :
      ats === "lever"      ? await fetchLeverJobs(id)      :
      ats === "ashby"      ? await fetchAshbyJobs(id)      :
                             await fetchRipplingJobs(id);
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

/**
 * Returns true if a job with this URL already exists in Supabase.
 * On DB error, returns false (assume not duplicate) to avoid silent drops.
 */
export async function isDuplicateJob(supabaseClient, url) {
  if (!url) return false;
  const { data, error } = await supabaseClient
    .from("jobs")
    .select("id")
    .eq("url", url)
    .maybeSingle();
  if (error) {
    logError(`Duplicate check failed for "${url}": ${error.message}`);
    return false;
  }
  return !!data;
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

  const jdText = [job.title, job.company, job.location, job.description]
    .filter(Boolean).join("\n");

  let evaluation;
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
        system:     FIT_PROMPT,
        messages:   [{ role: "user", content: `JOB DESCRIPTION:\n${jdText}\n\nCANDIDATE PROFILE:\n${candidateProfile}` }],
      }),
    });
    if (!res.ok) throw new Error(`Claude API HTTP ${res.status}`);
    const payload = await res.json();
    if (payload.error) throw new Error(payload.error.message);
    const raw = payload.content.map(b => b.text || "").join("").trim()
      .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();
    evaluation = JSON.parse(raw);
  } catch (err) {
    logError(`Claude evaluation failed for "${job.title}" at ${job.company}: ${err.message}`);
    return null;
  }

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
        if (evaluation.recommendation === "skip" || evaluation.overall_score < 55) {
          await supabaseClient.from("jobs").update({ status: "pass" }).eq("id", insertedJob.id);
          log(`  → Auto-passed (score ${evaluation.overall_score}, ${evaluation.recommendation})`);
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