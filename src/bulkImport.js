/**
 * ═══════════════════════════════════════════════════════════════
 * BULK JOB IMPORT
 * Paste/CSV/TSV/markdown table → parse → fetch JD → dedup → insert → score
 *
 * This is the *same* back half of the pipeline that ATS ingestion uses —
 * it calls normalizeJob, isDuplicateJob, insertJob, runClaudeEvaluation and
 * shouldAutoPass from ingestion.js rather than reimplementing any of them.
 * The only thing bulk import replaces is the front half: instead of fetching
 * from a Greenhouse/Ashby API, rows come from a file a human curated.
 *
 * Usage (CLI):
 *   node --env-file=.env src/run-bulk-import.mjs src/data/pm-job-scan-2026-08-04.csv
 *
 * Usage (module):
 *   import { parseJobRows, runBulkImport } from './bulkImport.js'
 *   const rows = parseJobRows(pastedText)
 *   await runBulkImport(supabase, anthropicKey, rows)
 * ═══════════════════════════════════════════════════════════════
 */

import {
  normalizeJob,
  isDuplicateJob,
  insertJob,
  runClaudeEvaluation,
  isRelevantJob,
  isUSJob,
} from "./ingestion.js";
import { shouldAutoPass } from "./scoring.js";

function log(msg)      { console.log(`[bulk-import] ${msg}`); }
function logError(msg) { console.error(`[bulk-import] ERROR: ${msg}`); }

// ─────────────────────────────────────────────────────────────────
// 1. PARSING
// Accepts whatever the source happens to be: a Google Sheets export
// (CSV), a copy-paste out of the sheet (TSV), a markdown table (what
// Drive/Claude hand back), or a JSON array.
// ─────────────────────────────────────────────────────────────────

// Header aliases → canonical field. Anything unrecognised is kept as an
// extra column and folded into the JD stub, so a sheet can carry its own
// idiosyncratic columns (Fit Tier, Remote Type, Level…) without code changes.
const HEADER_ALIASES = {
  title: "title", "job title": "title", role: "title", position: "title",
  company: "company", employer: "company", org: "company", organization: "company",
  location: "location", loc: "location", city: "location",
  url: "url", link: "url", "job url": "url", "job link": "url", posting: "url",
  description: "description", jd: "description", "job description": "description",
  source: "source",
};

/** Splits one CSV line, honouring "quoted, fields" and "" escapes. */
function splitCsvLine(line) {
  const out = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function splitRow(line, delimiter) {
  if (delimiter === "\t")  return line.split("\t");
  if (delimiter === "|") {
    // Markdown table row: | a | b | c |  → drop the leading/trailing empties
    const cells = line.split("|");
    if (cells[0].trim() === "")                cells.shift();
    if (cells[cells.length - 1].trim() === "") cells.pop();
    return cells;
  }
  return splitCsvLine(line);
}

/** Markdown alignment row: |:-:|---|:--| — structural, never data. */
function isSeparatorRow(line) {
  return /^[\s|:-]+$/.test(line) && /-/.test(line);
}

function detectDelimiter(line) {
  if (line.trim().startsWith("|")) return "|";
  if (line.includes("\t"))         return "\t";
  return ",";
}

function cleanCell(v) {
  return String(v ?? "")
    .trim()
    .replace(/^"(.*)"$/s, "$1")    // stray wrapping quotes
    .replace(/\\([_*|[\]])/g, "$1") // markdown escaping from Drive exports
    .trim();
}

function canonicalHeader(cell) {
  const key = cleanCell(cell).toLowerCase().replace(/\s+/g, " ");
  return HEADER_ALIASES[key] || key;
}

/**
 * Parses pasted/imported text into job row objects.
 * Requires a header line containing at least a title-ish and a url-ish column.
 * Rows without a title or URL are dropped — those are the sheet's spacer,
 * summary and "boards with no results" blocks, not jobs.
 *
 * @returns {Array<{title, company, location, url, description, source, extra}>}
 */
export function parseJobRows(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];

  // JSON array — the shape the Discover tab's briefing import already uses.
  if (raw.startsWith("[")) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.map(normalizeParsedRow);
    } catch { /* fall through to table parsing */ }
  }

  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  let header = null, rows = [];
  for (const line of lines) {
    if (isSeparatorRow(line)) continue;
    const d     = detectDelimiter(line);
    const cells = splitRow(line, d).map(cleanCell);

    if (!header) {
      const canon = cells.map(canonicalHeader);
      // A header must name both a title and a URL column. Anything before
      // that (blank leading row of a Drive markdown export, a title banner)
      // is skipped rather than mistaken for data.
      if (canon.includes("title") && canon.includes("url")) header = canon;
      continue;
    }

    if (cells.length < 2) continue;
    const rec = {};
    header.forEach((h, i) => { if (h) rec[h] = cells[i] ?? ""; });
    // A repeat of the header line (multi-block sheets) is not a row.
    if (canonicalHeader(rec.title || "") === "title") continue;
    if (!rec.title || !/^https?:\/\//i.test(rec.url || "")) continue;
    rows.push(normalizeParsedRow(rec));
  }

  return rows;
}

function normalizeParsedRow(rec) {
  const known = new Set(["title", "company", "location", "url", "description", "source"]);
  const extra = {};
  for (const [k, v] of Object.entries(rec)) {
    if (!known.has(k) && v) extra[k] = v;
  }
  return {
    title:       cleanCell(rec.title),
    company:     cleanCell(rec.company),
    location:    cleanCell(rec.location) || "Remote",
    url:         cleanCell(rec.url),
    description: cleanCell(rec.description),
    source:      cleanCell(rec.source) || "",
    extra,
  };
}

// ─────────────────────────────────────────────────────────────────
// 2. JOB DESCRIPTION FETCH
// Curated sheets carry a URL but no JD, and the scorer reads the JD —
// with an empty one every role lands at low confidence. Best effort:
// pull the real posting text, fall back to a metadata stub.
// ─────────────────────────────────────────────────────────────────

const MAX_JD_CHARS = 24000;
// Below this a "successful" fetch is really a JS shell or a cookie wall,
// not a posting — treat it as a miss so the stub is used instead.
const MIN_JD_CHARS = 400;

function htmlToText(html) {
  return String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Statuses worth trying again: the board is throttling or briefly unwell,
// not saying no. A run of roles at one company (six Confluent listings in a
// row) trips this reliably, and the postings are there on the second ask.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS  = [2000, 5000];

async function fetchOnce(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        // Some boards return a stub body to unknown agents.
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
      },
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status     = res.status;
      err.retryAfter = Number(res.headers.get("retry-after")) * 1000 || 0;
      throw err;
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, { timeoutMs = 15000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchOnce(url, timeoutMs);
    } catch (err) {
      const canRetry = RETRYABLE_STATUS.has(err.status) && attempt < RETRY_DELAYS_MS.length;
      if (!canRetry) throw err;
      // Honour Retry-After when the board sends a sane one, else back off.
      const wait = err.retryAfter > 0 && err.retryAfter <= 30000
        ? err.retryAfter
        : RETRY_DELAYS_MS[attempt];
      log(`  ${url} → HTTP ${err.status}, retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

/** job-boards.greenhouse.io/{board}/jobs/{id} → the board API, which returns clean HTML. */
async function fetchGreenhouseDescription(url) {
  const m = /greenhouse\.io\/(?:embed\/job_app\?for=)?([^/?#]+)\/jobs\/(\d+)/i.exec(url);
  if (!m) return "";
  const [, board, id] = m;
  const body = await fetchText(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}?content=true`);
  const json = JSON.parse(body);
  return htmlToText(json.content || "");
}

/**
 * Ashby postings, whether served from jobs.ashbyhq.com/{org}/{uuid} or from a
 * company's own domain (careers.confluent.io/jobs/job/{uuid}). The custom
 * domains front the same board, and scraping them gets you throttled —
 * Confluent 429s every request, retries included — while the API answers
 * fine. So: pull the UUID from anywhere in the URL and try the org names the
 * hostname suggests.
 */
async function fetchAshbyDescription(url) {
  const idMatch = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(url);
  if (!idMatch) return "";
  const id = idMatch[1];

  const orgs = [];
  const direct = /ashbyhq\.com\/([^/?#]+)\//i.exec(url);
  if (direct) orgs.push(direct[1]);
  try {
    // careers.confluent.io → try "confluent"; jobs.acme.com → "acme".
    const host = new URL(url).hostname.replace(/^www\./, "");
    const labels = host.split(".").filter(l => !["careers", "jobs", "job", "com", "io", "ai", "co", "net"].includes(l));
    if (labels.length) orgs.push(labels[labels.length - 1], labels[0]);
  } catch { /* not a parseable URL — the direct match is all we have */ }

  for (const org of [...new Set(orgs)]) {
    const body = await fetchText(`https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=true`);
    const json = JSON.parse(body);
    const posting = (json.jobs || []).find(j => j.id === id || j.jobUrl?.includes(id));
    if (posting) return htmlToText(posting.descriptionHtml || posting.descriptionPlain || "");
  }
  return "";
}

/**
 * Best-effort JD retrieval. Never throws — a miss returns "" and the caller
 * falls back to the metadata stub, exactly as a JD-less LinkedIn alert does.
 */
export async function fetchJobDescription(url) {
  if (!url) return "";
  const strategies = [];
  if (/greenhouse\.io/i.test(url)) strategies.push(fetchGreenhouseDescription);
  // Any URL carrying a UUID might be an Ashby board on a custom domain, so
  // this runs before the scrape — the API is both cleaner and un-throttled.
  if (/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(url)) strategies.push(fetchAshbyDescription);
  strategies.push(async u => htmlToText(await fetchText(u)));

  for (const strategy of strategies) {
    try {
      const text = await strategy(url);
      if (text && text.length >= MIN_JD_CHARS) return text.slice(0, MAX_JD_CHARS);
    } catch (err) {
      logError(`  JD fetch (${url}): ${err.message}`);
    }
  }
  return "";
}

/**
 * What the row itself tells us, in JD shape. Keeps the scorer honest: it is
 * short on purpose, so computeConfidence marks these rows low-confidence
 * rather than scoring a stub as if it were a full posting.
 */
// Written into every stub, and the way --refetch later recognises a row that
// still needs a real posting. Changing the wording means older stubs stop
// being detected, so keep the marker itself stable.
export const STUB_MARKER = "(No job description retrieved";

export function describeFromRow(row) {
  const meta = Object.entries(row.extra || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return [
    `${row.title} at ${row.company}`,
    `Location: ${row.location}`,
    meta,
    "",
    `${STUB_MARKER} — imported from a curated list. ` +
    "Open the listing and paste the full JD in the Evaluate tab to rescore.)",
  ].filter(Boolean).join("\n");
}

/** True when a row is carrying a metadata stub rather than a real posting. */
export function isStubDescription(description) {
  return !description || description.includes(STUB_MARKER);
}

// ─────────────────────────────────────────────────────────────────
// 3. PIPELINE
// ─────────────────────────────────────────────────────────────────

/**
 * Backfills one row that is already in the pipeline but still holding a stub.
 * Leaves rows with a real description alone — a JD you pasted by hand is
 * better evidence than anything a scraper returns, and must not be clobbered.
 */
async function refetchStubRow(supabaseClient, anthropicApiKey, row, { dryRun, candidateProfile }) {
  const { data, error } = await supabaseClient
    .from("jobs")
    .select("id, title, company, location, description, comp_verified_tc, burden_verified")
    .eq("url", row.url)
    .limit(1);

  if (error)            return { status: "error",     detail: `lookup failed: ${error.message}` };
  const existing = data?.[0];
  if (!existing)        return { status: "duplicate", detail: "already in pipeline (different URL form)" };
  if (!isStubDescription(existing.description)) {
    return { status: "duplicate", detail: "already has a real JD" };
  }

  const description = await fetchJobDescription(row.url);
  if (!description) {
    log(`  · Still no JD — leaving stub: "${row.title}" at ${row.company}`);
    return { status: "duplicate", detail: "still no JD available" };
  }

  if (dryRun) {
    log(`  · [dry run] would backfill: "${row.title}" at ${row.company} — JD ${description.length} chars`);
    return { refetched: true, status: "would-refetch", detail: `JD ${description.length} chars` };
  }

  const { error: updateError } = await supabaseClient
    .from("jobs").update({ description }).eq("id", existing.id);
  if (updateError) return { status: "error", detail: `update failed: ${updateError.message}` };
  log(`  ✓ Backfilled JD: "${row.title}" at ${row.company} (${description.length} chars)`);

  if (!anthropicApiKey) return { refetched: true, status: "refetched", detail: "not rescored (no API key)" };

  const evaluation = await runClaudeEvaluation(
    supabaseClient, { ...existing, description }, anthropicApiKey, candidateProfile,
  );
  if (!evaluation) return { refetched: true, status: "refetched", detail: "rescoring failed" };

  const autoPass = shouldAutoPass(evaluation.fit);
  if (autoPass.pass) {
    await supabaseClient.from("jobs").update({ status: "pass" }).eq("id", existing.id);
  }
  return {
    refetched: true, evaluated: true, status: "refetched",
    detail: `rescored ${evaluation.overall_score} (confidence ${evaluation.confidence})${autoPass.pass ? ` — auto-passed: ${autoPass.reason}` : ""}`,
  };
}

/**
 * Imports curated rows through the standard dedup + scoring path.
 *
 * @param {object}  supabaseClient
 * @param {?string} anthropicApiKey        — skips scoring when null
 * @param {Array}   rows                   — from parseJobRows()
 * @param {object}  [opts]
 * @param {string}  [opts.source="manual"] — value written to jobs.source
 * @param {boolean} [opts.fetchDescriptions=true]
 * @param {boolean} [opts.applyTitleFilter=false]
 *        Off by default: these rows were curated by hand, and the ATS title
 *        filter exists to strip ATS noise. It drops anything containing
 *        "security"/"design"/"research" ("Principal PM, Security" included)
 *        and only matches "Senior", never "Sr." — real roles on a curated
 *        list. Turn it on to hold an untrusted list to the same bar.
 * @param {boolean} [opts.dryRun=false]
 * @param {boolean} [opts.refetchStubs=false]
 *        Instead of skipping a row already in the pipeline, backfill it when
 *        it is still carrying a stub: fetch the posting, write it to the
 *        existing row, rescore. Without this a role that imported before its
 *        board would answer stays a stub forever, since dedup skips it.
 * @param {string}  [opts.candidateProfile]
 * @param {function}[opts.onProgress]      — ({ index, total, row, status }) => void
 *
 * @returns {{ total, imported, refetched, skipped, evaluated, autoPassed, withJd, stubbed, results }}
 */
export async function runBulkImport(supabaseClient, anthropicApiKey, rows, opts = {}) {
  const {
    source            = "manual",
    fetchDescriptions = true,
    applyTitleFilter  = false,
    dryRun            = false,
    refetchStubs      = false,
    candidateProfile,
    onProgress,
  } = opts;

  const startTime = Date.now();
  log(`═══ Bulk import started — ${rows.length} row${rows.length === 1 ? "" : "s"} ═══`);

  const results = [];
  let imported = 0, skipped = 0, evaluated = 0, autoPassed = 0, refetched = 0;
  let withJd = 0, stubbed = 0;

  const record = (row, status, detail = "") => {
    results.push({ title: row.title, company: row.company, url: row.url, status, detail });
    if (onProgress) onProgress({ index: results.length, total: rows.length, row, status, detail });
  };

  for (const row of rows) {
    if (!row.url) { skipped++; record(row, "skipped", "no URL"); continue; }

    if (applyTitleFilter && !isRelevantJob(row, { broadFilter: true })) {
      skipped++; record(row, "filtered", "title filter");
      continue;
    }

    // Same duplicate check as every other source, including the LinkedIn
    // URL-variant handling — a role already in the pipeline is never re-added.
    let duplicate;
    try {
      duplicate = await isDuplicateJob(supabaseClient, row.url);
    } catch (err) {
      skipped++; record(row, "error", `dedup failed: ${err.message}`);
      continue;
    }
    if (duplicate) {
      if (!refetchStubs) {
        skipped++; record(row, "duplicate");
        log(`  · Duplicate — skipping: "${row.title}" at ${row.company}`);
        continue;
      }
      const outcome = await refetchStubRow(supabaseClient, anthropicApiKey, row, {
        dryRun, candidateProfile,
      });
      if (outcome.refetched) { refetched++; withJd++; if (outcome.evaluated) evaluated++; }
      else skipped++;
      record(row, outcome.status, outcome.detail);
      continue;
    }

    let description = row.description;
    if (!description && fetchDescriptions) description = await fetchJobDescription(row.url);
    const jdFetched = Boolean(description);
    if (jdFetched) withJd++; else stubbed++;
    if (!description) description = describeFromRow(row);

    const job = normalizeJob({ ...row, description, source: row.source || source });

    if (!isUSJob(job)) {
      skipped++; record(row, "filtered", "non-US location");
      continue;
    }

    if (dryRun) {
      imported++;
      record(row, "would-import", jdFetched ? `JD ${description.length} chars` : "no JD (stub)");
      log(`  · [dry run] "${job.title}" at ${job.company} — ${jdFetched ? `JD ${description.length} chars` : "no JD"}`);
      continue;
    }

    let insertedJob;
    try {
      insertedJob = await insertJob(supabaseClient, job);
      imported++;
      log(`  ✓ Inserted: "${job.title}" at ${job.company}${jdFetched ? ` (JD ${description.length} chars)` : " (no JD — stub)"}`);
    } catch (err) {
      skipped++; record(row, "error", err.message);
      logError(`  ✗ Insert failed: "${job.title}" — ${err.message}`);
      continue;
    }

    if (!anthropicApiKey) {
      record(row, "imported", "not scored (no API key)");
      continue;
    }

    // Identical scoring path to ATS ingestion: Claude extracts evidence,
    // scoring.js computes the number, shouldAutoPass decides visibility.
    const evaluation = await runClaudeEvaluation(supabaseClient, insertedJob, anthropicApiKey, candidateProfile);
    if (!evaluation) {
      record(row, "imported", "scoring failed");
      continue;
    }
    evaluated++;

    const autoPass = shouldAutoPass(evaluation.fit);
    if (autoPass.pass) {
      autoPassed++;
      await supabaseClient.from("jobs").update({ status: "pass" }).eq("id", insertedJob.id);
      log(`  → Auto-passed (${autoPass.reason}, score ${evaluation.overall_score})`);
    }
    record(row, "imported",
      `score ${evaluation.overall_score} (confidence ${evaluation.confidence})${autoPass.pass ? ` — auto-passed: ${autoPass.reason}` : ""}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log("═══ Bulk import complete ═══");
  log(`  Rows:        ${rows.length}`);
  log(`  Imported:    ${imported}${dryRun ? " (dry run — nothing written)" : ""}`);
  if (refetchStubs) log(`  Backfilled:  ${refetched}`);
  log(`  With JD:     ${withJd}`);
  log(`  Stub only:   ${stubbed}`);
  log(`  Skipped:     ${skipped}`);
  log(`  Evaluated:   ${evaluated}`);
  log(`  Auto-passed: ${autoPassed}`);
  log(`  Time:        ${elapsed}s`);

  return { total: rows.length, imported, refetched, skipped, evaluated, autoPassed, withJd, stubbed, results };
}
