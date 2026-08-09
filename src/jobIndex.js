/**
 * ═══════════════════════════════════════════════════════════════
 * JOB INDEX — dedup against what is already in the pipeline
 *
 * Loads the existing rows once per run and indexes them by canonical URL
 * *and* by source-independent identity (company + title). A per-row URL
 * query could only ever catch the same link twice; the identity index is
 * what stops the same role entering three times because it was posted to
 * three different sites.
 *
 * Only depends on a Supabase client being passed in — no client of its
 * own — so the browser app, src/ingestion.js and scripts/fetch-jobs.js
 * can all use it.
 * ═══════════════════════════════════════════════════════════════
 */

import { canonicalUrlKey, jobIdentityKey, isBetterSource, sourceRank } from "./jobIdentity.js";

const PAGE_SIZE = 1000;

// Columns needed to dedup and to decide which copy of a role to keep.
// Descriptions are deliberately not loaded — they'd multiply the payload
// by orders of magnitude for a decision that never reads them.
const INDEX_COLUMNS = "id, title, company, url, source, status, score, created_at";

export class JobIndex {
  constructor(rows = []) {
    this.byUrl      = new Map();
    this.byIdentity = new Map();
    for (const row of rows) this.add(row);
  }

  add(row) {
    const urlKey = canonicalUrlKey(row.url);
    if (urlKey && !this.byUrl.has(urlKey)) this.byUrl.set(urlKey, row);

    const identity = jobIdentityKey(row);
    if (!identity) return;
    const existing = this.byIdentity.get(identity);
    // Pre-existing duplicate rows are possible; keep the most
    // authoritative one as the match target so merges land on it.
    if (!existing || isBetterSource(row.source, existing.source)) {
      this.byIdentity.set(identity, row);
    }
  }

  /**
   * Returns { row, reason } for an existing listing of the same role, or
   * null. `reason` is "url" for the same link and "identity" for the same
   * role reached through a different site.
   */
  find(job) {
    const urlKey = canonicalUrlKey(job.url);
    if (urlKey) {
      const hit = this.byUrl.get(urlKey);
      if (hit) return { row: hit, reason: "url" };
    }
    const identity = jobIdentityKey(job);
    if (identity) {
      const hit = this.byIdentity.get(identity);
      if (hit) return { row: hit, reason: "identity" };
    }
    return null;
  }

  get size() {
    return this.byIdentity.size + this.byUrl.size;
  }
}

/**
 * Loads every job row and builds the index. Pages through the result set —
 * Supabase caps a single select at 1000 rows, and a silently truncated
 * index would reintroduce duplicates for the oldest roles.
 *
 * On a query failure the index comes back empty, which degrades to the old
 * insert-anyway behaviour rather than silently dropping new roles.
 */
export async function loadJobIndex(supabaseClient, { log = () => {}, logError = () => {} } = {}) {
  const rows = [];
  for (let page = 0; ; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabaseClient
      .from("jobs")
      .select(INDEX_COLUMNS)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      logError(`Job index load failed at offset ${from}: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  log(`Job index: ${rows.length} existing row(s)`);
  return new JobIndex(rows);
}

/**
 * A duplicate isn't always worthless — an aggregator row we already have
 * may be superseded by the company's own ATS posting for the same role.
 * When the incoming copy comes from a more authoritative source, point the
 * existing row at the better link instead of inserting a second row.
 *
 * Returns true if the row was upgraded.
 */
export async function upgradeExistingJob(supabaseClient, existingRow, job, { log = () => {}, logError = () => {} } = {}) {
  if (!isBetterSource(job.source, existingRow.source)) return false;

  const updates = { url: job.url, source: job.source };
  if (job.description && job.description.trim()) updates.description = job.description;
  if (job.location && (!existingRow.location || existingRow.location === "Remote")) {
    updates.location = job.location;
  }

  const { error } = await supabaseClient.from("jobs").update(updates).eq("id", existingRow.id);
  if (error) {
    logError(`Failed to upgrade "${existingRow.title}" to ${job.source}: ${error.message}`);
    return false;
  }

  log(`  ↑ Upgraded "${existingRow.title}" at ${existingRow.company}: ${existingRow.source || "unknown"} → ${job.source}`);
  Object.assign(existingRow, updates);
  return true;
}

export { sourceRank };
