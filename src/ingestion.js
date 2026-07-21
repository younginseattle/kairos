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

const FIT_PROMPT = `You are a PM recruiting specialist evaluating VP/Director-level Product candidates. The candidate is a Product Manager, not an engineer. Return ONLY raw JSON — no markdown, no explanation.

Schema:
{
  "overall_score": integer 0-100, "confidence": number 0-100,
  "skills_match": integer 0-100, "experience_match": integer 0-100, "culture_match": integer 0-100,
  "compensation_score": integer 0-100, "work_life_balance_score": integer 0-100,
  "growth_score": integer 0-100, "location_score": integer 0-100, "company_score": integer 0-100,
  "strengths": [up to 4 short strings], "gaps": [up to 3 short strings], "quick_wins": [up to 3 short strings],
  "missing_keywords": [important JD keywords not in resume, up to 8],
  "strategic_gaps": [real gaps that could weaken candidacy, up to 4],
  "verdict": "2-3 sentence honest assessment",
  "recommendation": "apply" | "apply_with_note" | "stretch" | "skip",
  "score_explanation": { "key_factor": "string", "strengths": [2-3 strings], "weaknesses": [1-2 strings] },
  "top_candidate_signal": { "level": "HIGH | MEDIUM | LOW", "reason": "1 sentence" }
}

HOW TO SCORE experience_match (PM career fit, NOT engineering credentials):
  75-90: 10+ yrs PM at this seniority level, domain is a direct match
  60-75: 10+ yrs PM at this seniority level, adjacent domain (transferable)
  50-60: Right seniority, domain requires learning curve; or strong domain, slightly below target seniority
  40-50: Meaningful gap in seniority OR domain, candidate can still make the case
  Below 40: ONLY if candidate has never operated near this level, OR the title is an engineering role (VP Eng, CTO, Principal Engineer) not a PM role
  CRITICAL: "Engineering leadership", "hands-on Slurm/Kubernetes/InfiniBand/RDMA", "research lab background" in a VP/Director Product JD are NOT factors in experience_match. Those are tools the PM leader must understand, not operate.

HOW TO SCORE skills_match (PM skills, NOT technical tool mastery):
  70-85: Product strategy, roadmapping, cross-functional leadership, domain knowledge all align
  55-70: Strong PM toolkit, domain knowledge requires ramp
  45-55: Solid PM skills, notable domain gaps
  Below 45: ONLY if role requires skills the candidate genuinely lacks (hardware PM, consumer gaming, heavy healthcare compliance)
  CRITICAL: skills_match is NOT reduced because the candidate cannot personally operate Slurm, InfiniBand, RDMA, or GPU clusters.

ROLE CLASSIFICATION:
  - Title has VP/Director/Head of/Group PM/Staff PM/Principal PM → Product leadership role, use PM scoring above
  - Title is VP Engineering/CTO/Principal Engineer/Director Engineering → engineering role, penalize for PM candidate
  - Vague JD under 200 words → confidence below 50, score below 60

OVERALL SCORE:
  75-90: VP/Director PM in exact target domain, remote-friendly, tier-1 company
  65-75: VP/Director PM in adjacent domain, or tier-1 company with one meaningful gap
  55-65: VP/Director PM with real but bridgeable gaps (strong engineering requirements, location friction) → stretch or apply_with_note
  45-55: Right level, domain stretch or seniority gap → apply_with_note or stretch
  Below 45: Wrong level, wrong function, or outside all target domains

CALIBRATION ANCHORS — match your output to these:
  Ex1: "VP, Product AI/ML" CoreWeave (AI cloud infra, tier-1 target). JD lists HPC/Slurm/InfiniBand depth and "engineering leadership". No explicit remote. Candidate: 10+ yr VP-level PM, strong platform/infra/distributed-systems background, no hands-on HPC.
    → experience_match:68, skills_match:65, location_score:40, company_score:90, compensation_score:95, work_life_balance_score:58, overall:68, recommendation:apply_with_note
    Rationale: right seniority, tier-1 target, exact domain. "Engineering leadership" in a VP Product JD = technical influence ability. Real gaps are HPC tooling and location ambiguity — bridgeable, not disqualifying.

  Ex2: "Director of Product Management" Datadog, observability platform, remote-friendly. Candidate: platform PM, distributed systems experience.
    → experience_match:80, skills_match:78, location_score:97, company_score:90, overall:80, recommendation:apply

  Ex3: "Director of Product" mid-size HR SaaS. Candidate: strong PM, wrong domain.
    → experience_match:55, skills_match:58, overall:52, recommendation:apply_with_note

  Ex4: "VP of Engineering" (pure engineering management, no Product in title). Candidate: PM background.
    → experience_match:22, skills_match:28, overall:26, recommendation:skip

TARGET COMPANIES (company_score 80-95): CoreWeave, Anthropic, Databricks, Grafana Labs, Datadog, Elastic, New Relic, Cloudflare, Temporal, LaunchDarkly, PagerDuty, Honeycomb, Sumo Logic, Cribl, Scale AI, Glean, Stripe, GitLab, MongoDB

LOCATION (candidate: Seattle, no relocation). The LOCATION field in the message is authoritative — if it says "Remote" or any remote variant, use location_score 95-100 without further analysis. If LOCATION is blank or "Not specified", scan the full JD body for remote signals ("remote", "remotely", "remote option", "remote eligible", "work remotely") — if found, treat as remote. Score: Remote=95-100, Seattle/WA=90-95, Hybrid Seattle=80-85, Hybrid other=60-75, In-office non-Seattle=40-60, Requires relocation=10-30.

work_life_balance_score: 85-100=remote-first, explicit flexibility, generous PTO; 70-84=hybrid+flexibility, no on-call, public/stable company; 50-69=high-growth startup, fast-paced language; 30-49=on-call, always-on, early-stage.

compensation_score: Base $250K+=90-100, $200-250K=80-90, $160-200K=70-80, $130-160K=55-70, below $130K or unspecified=40-60.`;

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