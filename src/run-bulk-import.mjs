/**
 * run-bulk-import.mjs
 * ─────────────────────────────────────────────────────────────────
 * Adds a file full of jobs to the pipeline in one shot.
 *
 * Accepts CSV, TSV, a markdown table (what a Google Sheet exports as),
 * or a JSON array. Every row goes through the same dedup and scoring
 * logic as ATS and LinkedIn jobs.
 *
 *   node --env-file=.env src/run-bulk-import.mjs src/data/pm-job-scan-2026-08-04.csv
 *
 * Options:
 *   --dry-run        parse, dedup and fetch JDs, but write nothing
 *   --no-fetch       skip job-description fetching (much faster, lower confidence)
 *   --no-score       insert without calling Claude
 *   --filter         apply the ATS title filter (off by default — see bulkImport.js)
 *   --source=NAME    value written to jobs.source (default: manual)
 *
 * Requires Node 20.6+ for --env-file.
 * ─────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { parseJobRows, runBulkImport } from './bulkImport.js';

// ── Args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));

if (!file) {
  console.error('Usage: node --env-file=.env src/run-bulk-import.mjs <file.csv> [--dry-run] [--no-fetch] [--no-score] [--filter] [--source=NAME]');
  process.exit(1);
}

const DRY_RUN   = args.includes('--dry-run');
const NO_FETCH  = args.includes('--no-fetch');
const NO_SCORE  = args.includes('--no-score');
const FILTER    = args.includes('--filter');
const SOURCE    = (args.find(a => a.startsWith('--source=')) || '--source=manual').split('=')[1];

// ── Env ───────────────────────────────────────────────────────────
const SUPABASE_URL  = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY  = process.env.VITE_SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = process.env.VITE_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;

// A dry run never calls Claude, so it must not demand a key to get started —
// checking what a file would do is exactly when you haven't set one up yet.
const NEEDS_KEY = !NO_SCORE && !DRY_RUN;

const missing = [];
if (!SUPABASE_URL) missing.push('VITE_SUPABASE_URL');
if (!SUPABASE_KEY) missing.push('VITE_SUPABASE_ANON_KEY');
if (!ANTHROPIC_KEY && NEEDS_KEY) missing.push('VITE_ANTHROPIC_KEY (or ANTHROPIC_API_KEY) — or pass --no-score');

if (missing.length) {
  console.error('[run-bulk-import] Missing required env vars:');
  missing.forEach(v => console.error(`  · ${v}`));
  console.error('\nRun with: node --env-file=.env src/run-bulk-import.mjs <file>');
  process.exit(1);
}

// ── Parse ─────────────────────────────────────────────────────────
let text;
try {
  text = readFileSync(file, 'utf8');
} catch (err) {
  console.error(`[run-bulk-import] Could not read ${file}: ${err.message}`);
  process.exit(1);
}

const rows = parseJobRows(text);
if (rows.length === 0) {
  console.error(`[run-bulk-import] No job rows found in ${file}.`);
  console.error('The file needs a header row naming at least a title column and a url column.');
  process.exit(1);
}

if (!ANTHROPIC_KEY && !NO_SCORE) {
  console.warn('[run-bulk-import] No Anthropic key set — this dry run is fine, but the real run will need');
  console.warn('[run-bulk-import] ANTHROPIC_API_KEY in .env, or --no-score to import without scoring.');
  console.warn('');
}

console.log(`[run-bulk-import] Parsed ${rows.length} job row${rows.length === 1 ? '' : 's'} from ${file}`);
console.log(`[run-bulk-import] ${new Date().toLocaleString()}`);
console.log('');

// ── Run ───────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

try {
  const result = await runBulkImport(supabase, NEEDS_KEY ? ANTHROPIC_KEY : null, rows, {
    source:            SOURCE,
    fetchDescriptions: !NO_FETCH,
    applyTitleFilter:  FILTER,
    dryRun:            DRY_RUN,
  });

  console.log('');
  console.log('═══ BULK IMPORT SUMMARY ═══');
  console.log(`  Rows:        ${result.total}`);
  console.log(`  Imported:    ${result.imported}${DRY_RUN ? ' (dry run — nothing written)' : ''}`);
  console.log(`  Skipped:     ${result.skipped}`);
  console.log(`  Evaluated:   ${result.evaluated}`);
  console.log(`  Auto-passed: ${result.autoPassed}`);
  console.log('');

  const notable = result.results.filter(r => r.status !== 'imported');
  if (notable.length) {
    console.log('Rows not imported:');
    notable.forEach(r => console.log(`  · [${r.status}] ${r.title} — ${r.company}${r.detail ? ` (${r.detail})` : ''}`));
    console.log('');
  }

  process.exit(0);
} catch (err) {
  console.error('[run-bulk-import] Failed:', err.message);
  process.exit(1);
}
