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
import { dedupeBatch, canonicalUrlKey } from "./jobIdentity.js";
import { loadJobIndex, upgradeExistingJob } from "./jobIndex.js";
import { isRelevantTitle, looksLikeSeniorTitle, isExcludedCompany } from "./titleFilter.js";

// Per-company cap on SmartRecruiters detail requests, and page cap on the
// Amazon search API — both fetch N+1 requests per source, so they need a
// ceiling to keep one company from dominating an ingestion run.
const MAX_DETAIL_FETCHES = 25;
const AMAZON_MAX_PAGES   = 5;

// ─────────────────────────────────────────────────────────────────
// SOURCES — verified Greenhouse and Lever board IDs
// Grouped by domain relevance to observability/platform/infra PM roles
// ─────────────────────────────────────────────────────────────────

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

  // ── Verified 2026-08-06 by scripts/verify-boards.mjs (Actions run 31059467660) ──
  // Every entry below responded with a non-empty job list in that run; the
  // count in each comment is how many titles passed the filter at the time.
  // Zero-match boards are kept on purpose — a live board with nothing open
  // today is exactly what a poller is for.

  // Data / analytics infrastructure
  { id: "snowflake",         ats: "ashby",      tier: 1, domain: "platform",       broadFilter: true }, // 15 matching — note the working token is Ashby, not the greenhouse "snowflakecomputing" that 404'd before
  { id: "clickhouse",        ats: "greenhouse", tier: 1, domain: "platform",       broadFilter: true }, // 6 matching
  { id: "startree",          ats: "greenhouse", tier: 2, domain: "platform",       broadFilter: true },
  { id: "materialize",       ats: "ashby",      tier: 2, domain: "platform",       broadFilter: true },
  { id: "airbyte",           ats: "ashby",      tier: 2, domain: "platform",       broadFilter: true }, // Ashby works; the earlier Greenhouse 404 was a wrong token
  { id: "prefect",           ats: "ashby",      tier: 2, domain: "platform",       broadFilter: true },
  { id: "astronomer",        ats: "ashby",      tier: 2, domain: "platform",       broadFilter: true }, // 2 matching

  // AI / GPU infrastructure
  { id: "crusoe",            ats: "ashby",      tier: 1, domain: "infrastructure", broadFilter: true }, // 5 matching
  { id: "lambda",            ats: "ashby",      tier: 1, domain: "infrastructure", broadFilter: true }, // 4 matching
  { id: "nebius",            ats: "greenhouse", tier: 2, domain: "infrastructure", broadFilter: true }, // 4 matching
  { id: "modal",             ats: "ashby",      tier: 1, domain: "infrastructure", broadFilter: true },
  { id: "anyscale",          ats: "ashby",      tier: 1, domain: "platform",       broadFilter: true }, // 1 matching
  { id: "togetherai",        ats: "greenhouse", tier: 1, domain: "infrastructure", broadFilter: true },
  { id: "baseten",           ats: "ashby",      tier: 1, domain: "infrastructure", broadFilter: true },
  { id: "langchain",         ats: "ashby",      tier: 1, domain: "platform",       broadFilter: true },

  // Observability
  { id: "sentry",            ats: "ashby",      tier: 1, domain: "observability",  broadFilter: true },

  // Developer platforms / cloud
  { id: "render",            ats: "ashby",      tier: 2, domain: "infrastructure", broadFilter: true }, // 4 matching
  { id: "pulumicorporation", ats: "greenhouse", tier: 1, domain: "devtools",       broadFilter: true }, // 2 matching — Seattle HQ
  { id: "supabase",          ats: "ashby",      tier: 2, domain: "platform",       broadFilter: true },
  { id: "circleci",          ats: "greenhouse", tier: 2, domain: "devtools",       broadFilter: true },
  { id: "sourcegraph91",     ats: "greenhouse", tier: 2, domain: "devtools",       broadFilter: true },
  { id: "linear",            ats: "ashby",      tier: 3, domain: "devtools",       broadFilter: true },

  // ── Verified 2026-08-06, second probe (Actions run 31059866905) ───
  { id: "cerebras",          ats: "ashby",      tier: 2, domain: "infrastructure", broadFilter: true },
  { id: "neon",              ats: "ashby",      tier: 2, domain: "platform",       broadFilter: true },
  { id: "influxdata",        ats: "ashby",      tier: 1, domain: "observability",  broadFilter: true },
  { id: "qumulo",            ats: "ashby",      tier: 2, domain: "infrastructure", broadFilter: true }, // Seattle HQ
  { id: "auviknetworks",     ats: "greenhouse", tier: 2, domain: "observability",  broadFilter: true },

  // ── Verified 2026-08-27 by scripts/verify-boards.mjs (Actions run) ──
  // 13 of the 20 candidates added 2026-08-25 responded. Promoted here from
  // src/candidateSources.js; the other 7 are recorded in KNOWN_UNREACHABLE.
  { id: "docker",            ats: "ashby",      tier: 1, domain: "devtools",       broadFilter: true }, // 2 matching
  { id: "openai",            ats: "ashby",      tier: 1, domain: "platform",       broadFilter: true }, // 1 matching
  { id: "sysdig",            ats: "lever",      tier: 1, domain: "observability"                     },
  { id: "cohere",            ats: "ashby",      tier: 1, domain: "platform",       broadFilter: true },
  { id: "jfrog",             ats: "greenhouse", tier: 2, domain: "devtools"                           }, // 2 matching
  { id: "logicmonitor",      ats: "greenhouse", tier: 2, domain: "observability"                      }, // 1 matching
  { id: "cockroachlabs",     ats: "greenhouse", tier: 2, domain: "platform",       broadFilter: true }, // 1 matching
  { id: "redis",             ats: "ashby",      tier: 2, domain: "platform",       broadFilter: true }, // 1 matching
  { id: "kong",              ats: "ashby",      tier: 2, domain: "devtools",       broadFilter: true }, // 1 matching
  { id: "netlify",           ats: "greenhouse", tier: 2, domain: "devtools",       broadFilter: true }, // 1 matching
  { id: "axiom",             ats: "ashby",      tier: 2, domain: "observability"                      },
  { id: "planetscale",       ats: "greenhouse", tier: 2, domain: "platform",       broadFilter: true },
  { id: "buildkite",         ats: "greenhouse", tier: 2, domain: "devtools",       broadFilter: true },

  // ── Amazon / AWS — public search API, not an ATS board ────────────
  // `id` is the search query. business_category confines it to AWS: the
  // unfiltered query returned 482 roles / 105 matching, mostly Amazon
  // retail (Homepage and NavX, Amazon Lists, Last Mile Execution
  // Planning). With the category it is 131 / 35, and the matches are S3,
  // Aurora, IAM, VPC, Serverless Compute — the roles worth seeing.
  // "amazon-web-services" and "aws" returned identical result sets in the
  // probe, so amazon.jobs evidently aliases them.
  { id: "product manager", ats: "amazon", tier: 1, domain: "infrastructure",
    businessCategory: "amazon-web-services" },

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

// Title matching now lives in src/titleFilter.js, shared with
// scripts/fetch-jobs.js. The two copies had drifted — the LinkedIn parser
// caught "Principal AI Product Manager" and "Sr. Product Manager, Platform"
// while this path did not, so the same role appeared or vanished depending
// on which pipeline saw it first.

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
- Working Kubernetes knowledge — Helm chart authorship, operator patterns, cloud-native packaging
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

async function fetchSmartRecruitersJobs(companyId) {
  // The postings list carries no description, so pull detail only for the
  // titles that could plausibly matter — a full detail sweep would be
  // hundreds of requests per company for a handful of usable rows.
  const res = await fetchWithTimeout(
    `https://api.smartrecruiters.com/v1/companies/${companyId}/postings?limit=100`,
  );
  if (!res.ok) throw new Error(`SmartRecruiters fetch failed for "${companyId}" — HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.content)) throw new Error(`SmartRecruiters: unexpected response for "${companyId}"`);

  const shortlist = data.content.filter(p => looksLikeSeniorTitle(p.name)).slice(0, MAX_DETAIL_FETCHES);
  return Promise.all(shortlist.map(async posting => {
    let description = "";
    try {
      const d = await fetchWithTimeout(
        `https://api.smartrecruiters.com/v1/companies/${companyId}/postings/${posting.id}`,
      );
      if (d.ok) {
        const detail = await d.json();
        description = Object.values(detail.jobAd?.sections || {})
          .map(s => s?.text || "").filter(Boolean).join("\n\n");
      }
    } catch {
      // Detail is best-effort — a posting with no description still gets
      // inserted and can be evaluated later rather than silently dropped.
    }
    const loc = posting.location || {};
    return {
      title:       posting.name,
      location:    [loc.city, loc.region, loc.country].filter(Boolean).join(", ") ||
                   (loc.remote ? "Remote" : null),
      url:         `https://jobs.smartrecruiters.com/${companyId}/${posting.id}`,
      description,
      company:     companyId,
      source:      "smartrecruiters",
    };
  }));
}

async function fetchWorkableJobs(companyId) {
  const res = await fetchWithTimeout(
    `https://apply.workable.com/api/v1/widget/accounts/${companyId}?details=true`,
  );
  if (!res.ok) throw new Error(`Workable fetch failed for "${companyId}" — HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.jobs)) throw new Error(`Workable: unexpected response for "${companyId}"`);
  return data.jobs.map(job => ({
    title:       job.title,
    location:    [job.city, job.state, job.country].filter(Boolean).join(", ") || null,
    url:         job.url || job.application_url,
    description: [job.description, job.requirements].filter(Boolean).join("\n\n"),
    company:     data.name || companyId,
    source:      "workable",
  }));
}

/**
 * Amazon / AWS — amazon.jobs exposes a public search JSON endpoint, which
 * is why Amazon can be polled here even though CLAUDE.md notes FAANG
 * companies are unreachable via Greenhouse/Lever. This covers AWS, where
 * the observability and infrastructure PM roles sit.
 *
 * `id` is the base_query, not a board token, so several Amazon entries
 * with different queries can coexist in SOURCES.
 *
 * `businessCategory` matters a lot: an unfiltered "product manager" query
 * returned 482 roles of which 105 passed the title filter, and most were
 * Amazon retail (Homepage and NavX, Amazon Lists, Last Mile Execution
 * Planning) — noise that would dominate an ingestion run and burn a
 * Claude evaluation each.
 */
async function fetchAmazonJobs({ id: baseQuery = "product manager", businessCategory } = {}) {
  const PAGE_SIZE = 100;
  const jobs = [];
  for (let page = 0; page < AMAZON_MAX_PAGES; page++) {
    const params = new URLSearchParams({
      base_query:   baseQuery,
      result_limit: String(PAGE_SIZE),
      offset:       String(page * PAGE_SIZE),
      sort:         "recent",
    });
    params.append("normalized_country_code[]", "USA");
    if (businessCategory) params.append("business_category[]", businessCategory);
    const res = await fetchWithTimeout(`https://www.amazon.jobs/search.json?${params}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KairosJobBot/1.0)" },
      timeoutMs: 15000,
    });
    if (!res.ok) throw new Error(`Amazon fetch failed — HTTP ${res.status}`);
    const data = await res.json();
    const batch = Array.isArray(data.jobs) ? data.jobs : [];
    jobs.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return jobs.map(job => ({
    title:       job.title,
    location:    job.normalized_location || job.location || null,
    url:         job.job_path ? `https://www.amazon.jobs${job.job_path}` : null,
    description: [job.description, job.basic_qualifications, job.preferred_qualifications]
                   .filter(Boolean).join("\n\n"),
    // AWS roles are posted under company_name "Amazon Web Services" — keep
    // that distinction so scoring sees the actual business unit.
    company:     job.company_name || "Amazon",
    source:      "amazon",
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
 * Dispatches to the correct fetcher and lets failures propagate.
 * Exported so scripts/verify-boards.mjs can see the real error for an
 * unverified board ID instead of an empty array.
 */
export async function fetchSourceJobs(source) {
  {
    const { id, ats } = source;
    let jobs;
    if      (ats === "greenhouse")     jobs = await fetchGreenhouseJobs(id);
    else if (ats === "lever")          jobs = await fetchLeverJobs(id);
    else if (ats === "ashby")          jobs = await fetchAshbyJobs(id);
    else if (ats === "rippling")       jobs = await fetchRipplingJobs(id);
    else if (ats === "smartrecruiters") jobs = await fetchSmartRecruitersJobs(id);
    else if (ats === "workable")       jobs = await fetchWorkableJobs(id);
    else if (ats === "amazon")         jobs = await fetchAmazonJobs(source);
    else if (ats === "remoteok")       jobs = await fetchRemoteOkJobs();
    else if (ats === "weworkremotely") jobs = await fetchWeWorkRemotelyJobs(id);
    else throw new Error(`Unknown ats type "${ats}"`);
    return jobs;
  }
}

/**
 * Wrapper used by the pipeline: failures are isolated and logged so one
 * bad source never blocks the rest of the run.
 */
async function fetchJobsFromSource(source) {
  try {
    log(`Fetching ${source.ats} → ${source.id}…`);
    const jobs = await fetchSourceJobs(source);
    log(`  ✓ ${jobs.length} jobs from ${source.id}`);
    return jobs;
  } catch (err) {
    logError(`  ✗ ${source.id} (${source.ats}): ${err.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────
// 2. ROLE FILTERING
// ─────────────────────────────────────────────────────────────────

/**
 * Delegates to the shared filter. `broadFilter` sources drop the
 * platform-scope requirement on senior-level (non-lead) titles — at
 * Anthropic or Vercel a "Senior Product Manager, Core" is worth seeing
 * even when the title says nothing about the domain.
 */
export function isRelevantJob(job, source = null) {
  if (isExcludedCompany(job.company)) return false;
  return isRelevantTitle(job.title, { broad: source?.broadFilter === true });
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

// Identity-level dedup (same role, different site) lives in jobIdentity.js /
// jobIndex.js and is what the pipeline uses — see findExistingJob below.
// The URL-only check here remains for one-off callers that just want to ask
// "is this exact link already in the pipeline?" without loading the index.

/**
 * Returns true if a job with this URL already exists in Supabase.
 * On DB error, returns false (assume not duplicate) to avoid silent drops.
 *
 * URL-only: a role cross-posted to Greenhouse, an aggregator and LinkedIn
 * has three different URLs and will NOT be caught here. Use
 * loadJobIndex() + index.find(job) for real dedup.
 */
export async function isDuplicateJob(supabaseClient, url) {
  if (!url) return false;
  const urlKey = canonicalUrlKey(url);
  const linkedInId = urlKey.startsWith("linkedin:") ? urlKey.slice("linkedin:".length) : null;
  // .limit(1) + array-length check rather than .maybeSingle() — the ilike
  // pattern (and, given pre-existing duplicate rows, even an exact match in
  // rare cases) can match more than one row, and .maybeSingle() throws if so.
  const query = linkedInId
    ? supabaseClient.from("jobs").select("id").ilike("url", `%jobs/view/${linkedInId}%`)
    : supabaseClient.from("jobs").select("id").eq("url", url);
  const { data, error } = await query.limit(1);
  if (error) {
    logError(`Duplicate check failed for "${url}": ${error.message}`);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/**
 * Identity-aware duplicate lookup against a preloaded index.
 * Re-exported here so callers of the pipeline have one import site.
 */
export { loadJobIndex, JobIndex } from "./jobIndex.js";
export { jobIdentityKey, normalizeCompany, normalizeTitle, canonicalUrlKey } from "./jobIdentity.js";

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
    return { total: allJobs.length, filtered: 0, distinct: 0, crossPosted: 0, inserted: 0, upgraded: 0, evaluated: 0, skipped: 0, sourceResults };
  }

  // 3. Normalize
  const normalizedJobs = relevantJobs.map(normalizeJob);

  // 4a. Collapse duplicates WITHIN this batch. A role listed on its own ATS
  //     board and on an aggregator feed arrives twice in the same run, and
  //     neither copy is in the database yet — so the database check below
  //     can't see it. Keeps the most authoritative source of each role.
  const { unique: batchJobs, duplicates: batchDuplicates } = dedupeBatch(normalizedJobs);
  for (const { dropped, keptFrom } of batchDuplicates) {
    log(`  Cross-posted in batch — keeping ${keptFrom.source}: "${dropped.title}" at ${dropped.company} (dropped ${dropped.source})`);
  }
  if (batchDuplicates.length > 0) {
    log(`Collapsed ${batchDuplicates.length} cross-posted listing(s) → ${batchJobs.length} distinct role(s)`);
  }

  // 4b. Load the existing pipeline once, indexed by canonical URL and by
  //     company+title identity — the per-URL query it replaces could never
  //     match the same role posted under a different site's URL.
  const jobIndex = await loadJobIndex(supabaseClient, { log, logError });

  // 4–6. Deduplicate → Insert → Evaluate
  let insertedCount  = 0;
  let skippedCount   = 0;
  let evaluatedCount = 0;
  let upgradedCount  = 0;

  for (const job of batchJobs) {
    if (!job.url) {
      logError(`No URL — skipping: "${job.title}" at ${job.company}`);
      skippedCount++;
      continue;
    }

    const duplicate = jobIndex.find(job);
    if (duplicate) {
      const via = duplicate.reason === "identity" ? "already in pipeline from another site" : "same listing";
      log(`  Duplicate (${via}) — skipping: "${job.title}" at ${job.company}`);
      // If this copy comes from a more authoritative source, repoint the
      // existing row at it rather than leaving a stale aggregator link.
      const upgraded = await upgradeExistingJob(supabaseClient, duplicate.row, job, { log, logError });
      if (upgraded) upgradedCount++;
      skippedCount++;
      continue;
    }

    let insertedJob;
    try {
      insertedJob = await insertJob(supabaseClient, job);
      insertedCount++;
      // Index it immediately so a later listing of the same role in this
      // same run matches it instead of inserting a second row.
      jobIndex.add(insertedJob);
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
  log(`  Distinct:  ${batchJobs.length} (${batchDuplicates.length} cross-posted)`);
  log(`  Inserted:  ${insertedCount}`);
  log(`  Upgraded:  ${upgradedCount}`);
  log(`  Evaluated: ${evaluatedCount}`);
  log(`  Skipped:   ${skippedCount}`);
  log(`  Time:      ${elapsed}s`);

  return {
    total:         allJobs.length,
    filtered:      relevantJobs.length,
    distinct:      batchJobs.length,
    crossPosted:   batchDuplicates.length,
    inserted:      insertedCount,
    upgraded:      upgradedCount,
    evaluated:     evaluatedCount,
    skipped:       skippedCount,
    sourceResults,
  };
}