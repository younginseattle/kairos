/**
 * ═══════════════════════════════════════════════════════════════
 * SHARED TITLE FILTER
 *
 * One definition of "is this a role Matt would actually consider",
 * used by both ingestion paths:
 *   · src/ingestion.js        — ATS board polling
 *   · scripts/fetch-jobs.js   — LinkedIn job-alert email parsing
 *
 * These two had drifted apart: the LinkedIn parser had grown regex
 * patterns for "Principal <domain> Product Manager" and "Sr. Product
 * Manager" that the ATS path never got, so the same role would be
 * caught from an email alert and dropped from the company's own board.
 * This module is the merge of the two.
 *
 * Deliberately NOT matched: a bare "Product Manager" with no seniority
 * modifier. That is an IC-entry title and is noise at this level.
 * ═══════════════════════════════════════════════════════════════
 */

/**
 * Lead-level signals. A title carrying one of these is in scope on its
 * own — no domain qualification needed, because the level alone makes it
 * worth a look regardless of what the product is.
 */
export const LEAD_LEVEL_PATTERNS = [
  /\bdirector\b/i,
  /\bhead\s+of\s+product/i,
  /\bvice\s+president\b.{0,30}\bproducts?\b/i,
  /\bvp\b.{0,20}\bproducts?\b/i,
  /\bgroup\b.{0,30}\bproducts?\b/i,
  /\bprincipal\b.{0,30}\bproducts?\b/i,
  /\bstaff\b.{0,30}\bproducts?\b/i,
  /\bgpm\b/i,
];

/**
 * Senior-but-not-lead signals. These only qualify when the title ALSO
 * carries platform/infra scope (see PLATFORM_SCOPE_PATTERNS) — a Senior
 * PM on an observability platform is a real fit; a Senior PM on billing
 * or growth is not, and matching those unconditionally floods the
 * pipeline with roles that score in the 40s.
 */
export const SENIOR_LEVEL_PATTERNS = [
  /\bsenior\b.{0,30}\bproducts?\b/i,
  /\bsr\.?\b.{0,30}\bproducts?\b/i,
  /\blead\b.{0,20}\bproducts?\s+manager/i,
];

/**
 * Domain scope that promotes a Senior PM title into scope.
 * Mirrors the manual-scan rule: "Senior PM only when platform / infra /
 * observability / dev-facing scope".
 */
export const PLATFORM_SCOPE_PATTERNS = [
  /\bplatform/i,
  /\binfra(structure)?\b/i,
  /\bobservabilit/i,
  /\btelemetry\b/i,
  /\bmonitoring\b/i,
  /\bcloud\b/i,
  /\bdeveloper\b|\bdev\s?tools?\b|\bdevops\b/i,
  /\bapi\b/i,
  /\bdata\b|\banalytics\b/i,
  /\bai\b|\bml\b|\bmachine\s+learning\b|\bagent(ic)?\b|\bllm\b|\bgenai\b/i,
  /\bcompute\b|\bkubernetes\b|\bnetworking\b|\bstorage\b/i,
  /\breliability\b|\bsre\b/i,
  /\bintegrations?\b|\becosystem\b/i,
  // Observability-specific vocabulary. A Senior PM title at a core
  // observability company (Datadog, Elastic, New Relic, PagerDuty, Grafana
  // Labs, Sumo Logic, Cribl, Kentik — none of them broadFilter) names the
  // product surface, not the word "observability" itself: "Senior Product
  // Manager, APM" or "...Tracing" or "...Incident Response" were all
  // silently dropped for lacking a scope word, even though these are
  // exactly the roles this pipeline exists to find.
  /\bapm\b/i,
  /\btracing\b/i,
  /\blog(s|ging)?\b/i,
  /\bmetrics?\b/i,
  /\balert(s|ing)?\b/i,
  /\bincidents?\b/i,
  /\buptime\b/i,
  /\bdashboards?\b/i,
  /\blatency\b/i,
  // ITOM/AIOps and network/IT operations management — Matt's other named
  // proof-point domain (Puppet, Domotz). Distinct from the generic
  // "operations" word EXCLUSION_PATTERNS blocks below, which targets
  // non-technical ops functions (Sales/Revenue/Business Ops) that happen
  // to get labeled "product" in some ATS taxonomies.
  /\bitom\b|\baiops\b|\bit\s+operations\b|\bnetwork\s+operations\b|\bnoc\b/i,
];

/**
 * Titles that are not product-management roles even though they contain
 * the word "product".
 *
 * "developer" is intentionally absent: "Director of Product, Developer
 * Platform" is exactly the kind of role we want, and "engineer" already
 * catches the software-engineering titles this was meant to block.
 */
export const EXCLUSION_PATTERNS = [
  /\bmarketing\b/i,
  /\bengineer(ing)?\b/i,
  /\bdesigner?\b/i,
  /\banalyst\b/i,
  /\bcounsel\b/i,
  /\bfinance\b/i,
  /\bsales\b/i,
  /\brecruit/i,
  /\bdata\s+scien/i,
  /\bresearch(er)?\b/i,
  // A bare /\boperations\b/i used to block EVERY "operations" title,
  // including "IT Operations Management" and "Network Operations" — Matt's
  // ITOM/AIOps proof-point domain (see PLATFORM_SCOPE_PATTERNS above), not
  // the non-technical ops functions this is actually meant to catch.
  // Narrowed to the specific flavors that get mislabeled "product" in ATS
  // taxonomies; "marketing operations" is already caught by /\bmarketing\b/i
  // and "sales operations" by /\bsales\b/i above.
  /\b(revenue|business|people|hr|customer|deal|partner|vendor|gtm)\s+operations\b/i,
  /\bsecurity\b/i,
  /\bsupport\b/i,
  /\bproduct\s+owner\b/i,
  // Caught by the first verification run against live boards:
  // Crusoe's "Senior Supervisor, Product Quality" is a manufacturing role,
  // and Modal's "Member of Technical Staff - Product (Backend)" is an
  // engineering role — both matched on the seniority word alone.
  /\bsupervisor\b/i,
  /\bmember\s+of\s+technical\s+staff\b/i,
  /\bproduct\s+quality\b/i,
];

/**
 * Loose "does this line read like a seniority-level PM title" check, with
 * no exclusion or scope rules applied. Used by the LinkedIn email parsers
 * to pick the title line out of a job card — the real relevance decision
 * happens afterwards in isRelevantTitle().
 */
export function looksLikeSeniorTitle(line) {
  if (!line) return false;
  const t = String(line).toLowerCase();
  if (!t.includes("product")) return false;
  return LEAD_LEVEL_PATTERNS.some(re => re.test(t))
      || SENIOR_LEVEL_PATTERNS.some(re => re.test(t));
}

export function hasPlatformScope(title) {
  return PLATFORM_SCOPE_PATTERNS.some(re => re.test(title));
}

/**
 * @param {string} title
 * @param {object} [opts]
 * @param {boolean} [opts.broad] — for the handful of companies where any
 *   senior product role is worth surfacing regardless of stated domain
 *   (see BROAD_FILTER in ingestion.js SOURCES). Drops the platform-scope
 *   requirement on senior-level titles; everything else still applies.
 * @returns {boolean}
 */
export function isRelevantTitle(title, { broad = false } = {}) {
  if (!title) return false;
  const t = String(title).toLowerCase();

  if (!t.includes("product")) return false;
  if (EXCLUSION_PATTERNS.some(re => re.test(t))) return false;

  if (LEAD_LEVEL_PATTERNS.some(re => re.test(t))) return true;

  if (SENIOR_LEVEL_PATTERNS.some(re => re.test(t))) {
    return broad || hasPlatformScope(t);
  }

  return false;
}

/**
 * Why a title was accepted or rejected — used by the verification script
 * and the verbose ingestion logs so a filter decision is inspectable
 * rather than a silent boolean.
 */
export function explainTitle(title, { broad = false } = {}) {
  if (!title) return { relevant: false, reason: "empty title" };
  const t = String(title).toLowerCase();
  if (!t.includes("product")) return { relevant: false, reason: "no 'product' in title" };

  const excluded = EXCLUSION_PATTERNS.find(re => re.test(t));
  if (excluded) return { relevant: false, reason: `excluded by ${excluded}` };

  if (LEAD_LEVEL_PATTERNS.some(re => re.test(t))) {
    return { relevant: true, reason: "lead-level title" };
  }
  if (SENIOR_LEVEL_PATTERNS.some(re => re.test(t))) {
    if (broad) return { relevant: true, reason: "senior-level title at a broad-filter company" };
    if (hasPlatformScope(t)) return { relevant: true, reason: "senior-level title with platform scope" };
    return { relevant: false, reason: "senior-level title without platform scope" };
  }
  return { relevant: false, reason: "no seniority signal" };
}
