#!/usr/bin/env node
/**
 * Backfill scores for existing rows sitting at score: null.
 *
 * scripts/fetch-jobs.js (the LinkedIn alert parser) used to insert rows with
 * no fit evaluation at all — it only wrote title/company/location/url/status.
 * Those rows never appear in the Discover tab or the main Saved-tab pipeline
 * view (both filter on score != null); they were only reachable via the
 * Saved tab's "Unscored" filter chip. fetch-jobs.js now scores on insert
 * (see runBulkImport() in src/bulkImport.js), so this is a one-time backfill
 * for rows that were inserted before that fix. Safe to re-run — anything
 * already scored is skipped by the query itself.
 *
 * For each row:
 *   1. Fetch the actual JD from its URL (best-effort — LinkedIn's own
 *      /jobs/view/ pages are not always scrapable without login).
 *   2. Falls back to a title/company/location-only stub when the fetch
 *      misses, so every row ends up scored (at lower confidence) rather
 *      than staying invisible forever — same behavior runBulkImport() uses
 *      for a fresh insert whose board won't answer.
 *   3. Scores with Claude (src/ingestion.js runClaudeEvaluation) and applies
 *      the same shouldAutoPass() gate as every other ingestion path.
 *
 *   node --env-file=.env scripts/score-unscored-jobs.mjs --plan
 *   node --env-file=.env scripts/score-unscored-jobs.mjs --dry-run --limit=5
 *   node --env-file=.env scripts/score-unscored-jobs.mjs --since=30d
 *   node --env-file=.env scripts/score-unscored-jobs.mjs
 *
 * --since=30d (or a bare number of days, or an ISO date) narrows the
 * selection to rows created in that window — same flag and semantics as
 * rescore-jobs.mjs. There's no separate "date posted" column; created_at is
 * when the row entered the pipeline, which for a LinkedIn-alert row is close
 * enough to the posting date to use as the cutoff. Recommended for this
 * backlog: hundreds of these rows are old LinkedIn-alert postings that may
 * no longer even be open, and scoring a stale listing is a wasted API call.
 *
 * Must run where LinkedIn is reachable — a dev sandbox's egress proxy blocks
 * it the same way it blocks ATS hosts. Run via the "Score Unscored Jobs"
 * GitHub Action instead of locally.
 */

if (typeof globalThis.WebSocket === 'undefined') {
  try { globalThis.WebSocket = (await import('ws')).default; } catch { /* realtime unused here */ }
}
const { createClient } = await import('@supabase/supabase-js');
const { fetchJobDescription, describeFromRow, isStubDescription } = await import('../src/bulkImport.js');
const { runClaudeEvaluation } = await import('../src/ingestion.js');
const { shouldAutoPass } = await import('../src/scoring.js');

const PLAN    = process.argv.includes('--plan');
const DRY_RUN = process.argv.includes('--dry-run');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const LIMIT    = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

/** Accepts "30d", "30", or an ISO date. Returns an ISO cutoff, or null. */
function parseSince(raw) {
  if (!raw) return null;
  const m = /^(\d+)\s*d?$/i.exec(raw.trim());
  if (m) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(m[1], 10));
    return d.toISOString();
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    console.error(`✗ --since="${raw}" is not a number of days or a date`);
    process.exit(1);
  }
  return parsed.toISOString();
}
const sinceArg = process.argv.find(a => a.startsWith('--since='));
const SINCE    = parseSince(sinceArg ? sinceArg.split('=')[1] : null);

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL  || process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY   || process.env.VITE_ANTHROPIC_KEY;

const required = [['SUPABASE_URL', SUPABASE_URL], ['SUPABASE key', SUPABASE_KEY]];
if (!PLAN) required.push(['ANTHROPIC_API_KEY', ANTHROPIC_KEY]);
for (const [k, v] of required) {
  if (!v) { console.error(`✗ Missing ${k}`); process.exit(1); }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let query = supabase
  .from('jobs')
  .select('id, title, company, location, url, description, source, comp_verified_tc, burden_verified')
  .is('score', null)
  .order('created_at', { ascending: true });
if (SINCE) query = query.gte('created_at', SINCE);
if (LIMIT) query = query.limit(LIMIT);

const { data: rows, error } = await query;
if (error) { console.error(`✗ Query failed: ${error.message}`); process.exit(1); }

console.log(`\n◆ ${rows.length} unscored row(s) selected` +
            `${SINCE ? ` (created since ${SINCE.slice(0, 10)})` : ''}` +
            `${LIMIT ? ` (limit ${LIMIT})` : ''}\n`);

if (PLAN) {
  rows.forEach(r => console.log(`  · ${r.title} — ${r.company} (${r.source || 'unknown source'})`));
  console.log(`\n${rows.length} row(s) would be scored. No API calls made.`);
  process.exit(0);
}

let withJd = 0, stubbed = 0, evaluated = 0, autoPassed = 0, failed = 0;

for (const row of rows) {
  let description = row.description;
  if (isStubDescription(description)) {
    const fetched = await fetchJobDescription(row.url);
    description = fetched || describeFromRow(row);
    if (fetched) withJd++; else stubbed++;

    if (!DRY_RUN && description !== row.description) {
      const { error: updateError } = await supabase.from('jobs').update({ description }).eq('id', row.id);
      if (updateError) console.error(`  ✗ Description update failed for "${row.title}": ${updateError.message}`);
    }
  } else {
    withJd++;
  }

  if (DRY_RUN) {
    console.log(`  · [dry run] would score: "${row.title}" — ${row.company} (${description.length} chars, ${isStubDescription(description) ? 'stub' : 'real JD'})`);
    continue;
  }

  const evaluation = await runClaudeEvaluation(
    supabase, { ...row, description }, ANTHROPIC_KEY, undefined,
  );
  if (!evaluation) { failed++; console.error(`  ✗ Scoring failed: "${row.title}" — ${row.company}`); continue; }
  evaluated++;

  const autoPass = shouldAutoPass(evaluation.fit);
  if (autoPass.pass) {
    autoPassed++;
    await supabase.from('jobs').update({ status: 'pass' }).eq('id', row.id);
  }
  console.log(`  ✓ "${row.title}" — ${row.company}: score ${evaluation.overall_score}` +
              (autoPass.pass ? ` — auto-passed (${autoPass.reason})` : ''));
}

console.log(`\n── Summary`);
console.log(`   Rows        : ${rows.length}${DRY_RUN ? ' (dry run — nothing written)' : ''}`);
console.log(`   With JD     : ${withJd}`);
console.log(`   Stub only   : ${stubbed}`);
console.log(`   Evaluated   : ${evaluated}`);
console.log(`   Auto-passed : ${autoPassed}`);
if (failed > 0) console.log(`   Failed      : ${failed}`);
console.log('   Done ✓\n');
