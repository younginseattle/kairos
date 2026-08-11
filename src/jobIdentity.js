/**
 * ═══════════════════════════════════════════════════════════════
 * JOB IDENTITY — what makes two listings "the same role"
 *
 * The pipeline pulls the same opening from several places: the company's
 * own ATS board, an aggregator feed (RemoteOK / WeWorkRemotely), and a
 * LinkedIn job-alert email. Each gives it a different URL, so URL-only
 * dedup let one role land in the pipeline three times.
 *
 * This module produces a source-independent identity for a listing —
 * normalized company + normalized title — plus a canonical URL key that
 * still catches the same-URL-different-string case.
 *
 * Pure functions only, no imports: both src/ingestion.js and
 * scripts/fetch-jobs.js load this file directly.
 * ═══════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────
// COMPANY
// ─────────────────────────────────────────────────────────────────

// Legal suffixes to drop. Applied both as whole words ("Harness Inc") and
// as a trailing fragment of the squashed form ("harnessinc" — how the ATS
// board id arrives). "co" is deliberately absent: it would eat the tail of
// real names like "cisco".
const LEGAL_SUFFIXES = ["incorporated", "inc", "llc", "ltd", "limited", "corp", "corporation", "plc", "gmbh"];

/**
 * ATS board ids that don't squash to the company's display name.
 * Keys are already-normalized (lowercase, no punctuation/space) forms.
 * Only add an entry when the two forms genuinely can't be reconciled by
 * the generic rules below — every entry is a merge decision.
 */
const COMPANY_ALIASES = {
  temporaltechnologies: "temporal",
  gleanwork:            "glean",
  gleantechnologies:    "glean",
  chronospherejobs:     "chronosphere",
  montecarlodata:       "montecarlo",
  snowflakecomputing:   "snowflake",
  honeycombio:          "honeycomb",
  lambdalabs:           "lambda",
  elasticco:            "elastic",
  elasticsearch:        "elastic",
  newrelicinc:          "newrelic",
  amazonwebservices:    "aws",
  alphabetgoogle:       "google",
};

/**
 * Canonical company key: lowercase, punctuation-free, whitespace-squashed.
 * "Grafana Labs", "grafanalabs" and "Grafana Labs, Inc." all collapse to
 * "grafanalabs"; the alias table handles the rest.
 */
export function normalizeCompany(name) {
  let s = (name || "").toLowerCase().trim();
  if (!s) return "";

  s = s
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  s = s.replace(/^the /, "");

  // Whole-word legal suffixes, repeatedly ("Foo Corp Inc" → "foo")
  let words = s.split(" ").filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.includes(words[words.length - 1])) words.pop();

  let squashed = words.join("");

  // Trailing legal suffix on the squashed form ("harnessinc" → "harness").
  // Guarded by a length floor so short names aren't chewed down to nothing.
  for (const suffix of LEGAL_SUFFIXES) {
    if (squashed.length > suffix.length + 3 && squashed.endsWith(suffix)) {
      squashed = squashed.slice(0, -suffix.length);
      break;
    }
  }

  return COMPANY_ALIASES[squashed] || squashed;
}

// ─────────────────────────────────────────────────────────────────
// TITLE
// ─────────────────────────────────────────────────────────────────

// Abbreviation → expansion, applied per-token so "Sr. PM" and
// "Senior Product Manager" reach the same signature.
const TITLE_EXPANSIONS = {
  sr: "senior", snr: "senior", jr: "junior",
  vp: "vice president", svp: "senior vice president", evp: "executive vice president",
  avp: "associate vice president",
  pm: "product manager", pms: "product manager",
  gpm: "group product manager", tpm: "technical product manager",
  dir: "director", mgr: "manager", mgmt: "manager",
  // "management" folds into "manager" so the word-order case this module was
  // written for actually collapses: "Director, Product Management —
  // Observability" and "Observability Product Director" are one role.
  management: "manager",
  prod: "product", eng: "engineering", ops: "operations",
  "sr.": "senior",
};

// Words that carry no role identity — hiring boilerplate, geography, and
// grammatical filler. Dropped before the signature is built so
// "Director of Product Management (Remote, US)" and
// "Director, Product Management" match.
const TITLE_STOPWORDS = new Set([
  "a", "an", "the", "of", "for", "and", "to", "in", "at", "on", "with", "our",
  "remote", "hybrid", "onsite", "on-site", "us", "usa", "u", "s", "united", "states",
  "full", "part", "time", "fulltime", "parttime", "contract", "permanent",
  "new", "open", "opening", "role", "position", "job", "opportunity",
  "f", "m", "d", "x", "w",
]);

/**
 * Canonical title key: an order-independent signature of the meaningful
 * words in the title.
 *
 * Order independence is deliberate — the same role is posted as
 * "Director, Product Management — Observability" on Greenhouse and
 * "Observability Product Director" on an aggregator. It does mean two
 * genuinely distinct roles that share a title at one company collapse into
 * one row; with only a title to go on those are indistinguishable anyway,
 * and the alternative (three rows per role) is the bug being fixed.
 */
export function normalizeTitle(title) {
  let s = (title || "").toLowerCase().trim();
  if (!s) return "";

  s = s
    .replace(/\([^)]*\)/g, " ")        // "(Remote)", "(REQ-1234)"
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/#\s*\d+/g, " ")          // "#12345" req ids
    .replace(/\breq[a-z]*[-\s]?\d+/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = [];
  for (const raw of s.split(" ")) {
    if (!raw) continue;
    const expanded = TITLE_EXPANSIONS[raw] || raw;
    for (const word of expanded.split(" ")) {
      if (!word) continue;
      if (TITLE_STOPWORDS.has(word)) continue;
      if (/^\d+$/.test(word)) continue;   // bare req numbers / level digits
      tokens.push(word);
    }
  }

  return [...new Set(tokens)].sort().join(" ");
}

/**
 * Source-independent identity for a listing, or null when there isn't
 * enough to identify it (aggregator rows sometimes arrive with no company —
 * those fall back to URL-only dedup rather than merging on title alone).
 */
/**
 * Tokens that describe LEVEL and FUNCTION but not WHICH product.
 * A title made only of these names a rank, not a role.
 */
const CORE_TITLE_TOKENS = new Set([
  "senior", "sr", "staff", "principal", "lead", "group", "director",
  "vp", "vice", "president", "head", "chief", "manager", "management",
  "product", "products", "technical", "tech", "owner", "ii", "iii",
]);

/**
 * True when a title carries no scope of its own — "Staff Product Manager",
 * "Principal Product Manager", "Director, Product Management".
 *
 * These are not identities. Stripe posts many distinct roles as plain
 * "Staff Product Manager"; WeWorkRemotely's RSS renders every one of them as
 * "Stripe: Staff Product Manager" no matter which team it is for; Microsoft
 * had thirty separate "Principal Product Manager" postings. Treating
 * company+title as identity collapsed all of them into one role — 343 rows
 * proposed for deletion in the first cleanup run, most of them distinct jobs.
 */
export function isGenericTitle(title) {
  const norm = normalizeTitle(title);
  if (!norm) return true;
  return norm.split(" ").every(t => CORE_TITLE_TOKENS.has(t));
}

/**
 * Source-independent identity for a role, or null when the row does not
 * carry enough to identify one.
 *
 * Returns null for generic titles ON PURPOSE. Null means "URL matching only"
 * — the caller keeps both rows rather than guessing. Over-merging deletes a
 * real job and is silent; under-merging leaves a visible duplicate. Those
 * costs are not symmetric.
 */
export function jobIdentityKey(job) {
  const company = normalizeCompany(job?.company);
  const title   = normalizeTitle(job?.title);
  if (!company || !title) return null;
  if (isGenericTitle(job?.title)) return null;
  return `${company}::${title}`;
}

// ─────────────────────────────────────────────────────────────────
// URL
// ─────────────────────────────────────────────────────────────────

// LinkedIn serves one posting at linkedin.com/jobs/view/{id}/ and
// linkedin.com/comm/jobs/view/{id} — key on the numeric id.
export function extractLinkedInJobId(url) {
  const m = /linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/.exec(url || "");
  return m ? m[1] : null;
}

// Tracking params that vary per email/feed for the same listing.
const TRACKING_PARAMS = /^(utm_|gh_|lever-|ref$|refid$|source$|src$|trk$|trackingid$|eblt|midtoken|mid$)/i;

/**
 * Params that ARE the listing's identity and must survive canonicalisation,
 * checked before TRACKING_PARAMS.
 *
 * `gh_jid` is the Greenhouse job id and matches the `gh_` tracking prefix, so
 * it was being stripped as noise. For every company that puts the id in the
 * query string rather than the path — Stripe, MongoDB, Databricks, Harness,
 * Fastly, Fivetran, Elastic, Cribl, Arize — that collapsed the entire board
 * to one key: every Stripe posting became "stripe.com/jobs/search". Fifteen
 * distinct Stripe roles were queued for deletion as one duplicate.
 */
const IDENTITY_PARAMS = /^(gh_jid|jid|job_?id|posting_?id|req_?id|vacancy_?id)$/i;

/**
 * Canonical URL key: protocol/host-case/trailing-slash/tracking-param
 * insensitive, so the same link in two shapes keys the same.
 */
export function canonicalUrlKey(url) {
  const raw = (url || "").trim();
  if (!raw) return "";

  const linkedInId = extractLinkedInJobId(raw);
  if (linkedInId) return `linkedin:${linkedInId}`;

  try {
    const u = new URL(raw);
    const params = [...u.searchParams.entries()]
      .filter(([k]) => IDENTITY_PARAMS.test(k) || !TRACKING_PARAMS.test(k))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}${params ? `?${params}` : ""}`;
  } catch {
    return raw.toLowerCase().replace(/\/+$/, "");
  }
}

// ─────────────────────────────────────────────────────────────────
// SOURCE PREFERENCE
// ─────────────────────────────────────────────────────────────────

/**
 * When the same role arrives from several places, keep the most
 * authoritative link. A company's own ATS posting beats a LinkedIn alert,
 * which beats an aggregator's redirect URL. Anything Matt entered by hand
 * outranks everything — automation never overwrites a manual row.
 */
const SOURCE_RANK = {
  manual:         5,
  greenhouse:     4,
  lever:          4,
  ashby:          4,
  rippling:       4,
  workday:        4,
  linkedin_alert: 3,
  linkedin:       3,
  remoteok:       2,
  weworkremotely: 2,
};

export function sourceRank(source) {
  return SOURCE_RANK[(source || "").toLowerCase()] ?? 1;
}

/** True if `candidate` is a more authoritative posting than `current`. */
export function isBetterSource(candidate, current) {
  return sourceRank(candidate) > sourceRank(current);
}

/**
 * Collapses a freshly fetched batch so one role can't be inserted twice
 * within a single run — the case URL dedup could never catch, since both
 * copies are new to the database at check time.
 *
 * Returns { unique, duplicates } where `duplicates` records what was
 * dropped and which listing it merged into, for logging.
 */
export function dedupeBatch(jobs) {
  const byKey = new Map();   // dedup key → index into `unique`
  const unique = [];
  const duplicates = [];

  for (const job of jobs) {
    const keys = [];
    const urlKey = canonicalUrlKey(job.url);
    if (urlKey) keys.push(`url:${urlKey}`);
    const identity = jobIdentityKey(job);
    if (identity) keys.push(`id:${identity}`);
    if (keys.length === 0) { unique.push(job); continue; }

    const hitIndex = keys.map(k => byKey.get(k)).find(i => i !== undefined);
    if (hitIndex === undefined) {
      const index = unique.length;
      unique.push(job);
      for (const k of keys) byKey.set(k, index);
      continue;
    }

    const kept = unique[hitIndex];
    if (isBetterSource(job.source, kept.source)) {
      // The better-sourced copy wins the slot; the weaker one is recorded
      // as the duplicate so the keys keep pointing at a real listing.
      unique[hitIndex] = job;
      duplicates.push({ dropped: kept, keptFrom: job });
    } else {
      duplicates.push({ dropped: job, keptFrom: kept });
    }
    for (const k of keys) byKey.set(k, hitIndex);
  }

  return { unique, duplicates };
}
