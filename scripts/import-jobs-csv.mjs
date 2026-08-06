#!/usr/bin/env node
/**
 * CSV / TSV JOB IMPORT
 * ─────────────────────────────────────────────────────────────────
 * Loads hand-collected job rows into Supabase through the same
 * normalize → dedupe → insert → evaluate path the automated pipeline
 * uses, so imported rows are indistinguishable from discovered ones.
 *
 * This exists for the boards that cannot be polled — a company with a
 * live careers page but no public API. Anything reachable by
 * src/ingestion.js should be added to SOURCES instead of imported by
 * hand: the pipeline will keep finding it, an import happens once.
 *
 * INPUT
 *   A CSV or TSV file with a header row. Column names are matched
 *   case-insensitively and ignore spaces/underscores, so the manual
 *   scan's export works unchanged:
 *
 *     Fit Rank, Fit Tier, Title, Company, Location, Remote Type,
 *     Level, Posted, URL
 *
 *   Required: Title, Company, URL. Everything else is optional.
 *   To import from an .xlsx, save the sheet as CSV first.
 *
 * USAGE
 *   node --env-file=.env scripts/import-jobs-csv.mjs jobs.csv
 *   node --env-file=.env scripts/import-jobs-csv.mjs jobs.csv --dry-run
 *   node --env-file=.env scripts/import-jobs-csv.mjs jobs.csv --no-fetch
 *   node --env-file=.env scripts/import-jobs-csv.mjs jobs.csv --no-evaluate
 *
 * FLAGS
 *   --dry-run      Parse, filter and dedupe, then print. Writes nothing.
 *   --no-fetch     Skip fetching job descriptions from each URL.
 *   --no-evaluate  Insert without running Claude scoring.
 *   --source=NAME  Value for the `source` column (default: manual_import).
 *   --all-titles   Import every row, bypassing the title filter.
 *
 * ENV
 *   SUPABASE_URL / VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY
 *   ANTHROPIC_API_KEY   (only needed when evaluating)
 */

import { readFileSync } from 'fs';
import { normalizeJob, isDuplicateJob, insertJob, runClaudeEvaluation, isUSJob } from '../src/ingestion.js';
import { isRelevantTitle } from '../src/titleFilter.js';

// ── Args ───────────────────────────────────────────────────────────
const args     = process.argv.slice(2);
const file     = args.find(a => !a.startsWith('--'));
const DRY_RUN  = args.includes('--dry-run');
const FETCH_JD = !args.includes('--no-fetch');
const EVALUATE = !args.includes('--no-evaluate');
const ALL      = args.includes('--all-titles');
const SOURCE   = (args.find(a => a.startsWith('--source=')) || '--source=manual_import').split('=')[1];

if (!file) {
  console.error('Usage: node --env-file=.env scripts/import-jobs-csv.mjs <file.csv> [--dry-run] [--no-fetch] [--no-evaluate]');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_KEY;

if (!DRY_RUN && (!SUPABASE_URL || !SUPABASE_KEY)) {
  console.error('✗ Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!DRY_RUN && EVALUATE && !ANTHROPIC_KEY) {
  console.error('✗ Missing ANTHROPIC_API_KEY — pass --no-evaluate to import without scoring');
  process.exit(1);
}

// ── CSV parsing ────────────────────────────────────────────────────
// Hand-rolled rather than pulled in as a dependency: this handles quoted
// fields, escaped quotes and embedded newlines, which is the whole of
// what a spreadsheet export produces.
function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [], field = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"')            { inQuotes = true; }
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n')      { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r')      { field += ch; }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

const norm = s => String(s || '').toLowerCase().replace(/[\s_\-.]/g, '');

/** Finds a column by any of several accepted header spellings. */
function pick(record, ...names) {
  for (const n of names) {
    const key = norm(n);
    if (key in record && String(record[key]).trim() !== '') return String(record[key]).trim();
  }
  return '';
}

// ── Description fetch ──────────────────────────────────────────────
// Scoring without a JD is meaningless — the model has nothing to extract
// from — so by default each URL is fetched and stripped to text. A
// failure here is not fatal: the row still imports, just unscored.
async function fetchDescription(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KairosJobBot/1.0)' },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return '';
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 20000);
  } catch {
    return '';
  }
}

// ── Read and map rows ──────────────────────────────────────────────
const raw = readFileSync(file, 'utf8');
const delimiter = file.endsWith('.tsv') || (raw.split('\n')[0].includes('\t')) ? '\t' : ',';
const rows = parseDelimited(raw, delimiter);

if (rows.length < 2) {
  console.error('✗ File has no data rows');
  process.exit(1);
}

const headers = rows[0].map(norm);
const records = rows.slice(1).map(cells =>
  Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']))
);

console.log(`Read ${records.length} rows from ${file}`);
console.log(`Columns: ${rows[0].join(' | ')}\n`);

const mapped = records.map(r => {
  const remoteType = pick(r, 'remote type', 'remote', 'work type');
  const location   = pick(r, 'location', 'city', 'office') ||
                     (/remote/i.test(remoteType) ? 'Remote' : '');
  return {
    title:       pick(r, 'title', 'job title', 'role', 'position'),
    company:     pick(r, 'company', 'employer', 'organization'),
    url:         pick(r, 'url', 'link', 'job url', 'posting url', 'apply url'),
    // "Remote" from the Remote Type column is meaningful signal for the
    // location subscore, so it is folded into location rather than dropped.
    location:    remoteType && location && !new RegExp(remoteType, 'i').test(location)
                   ? `${location} (${remoteType})` : location,
    fitTier:     pick(r, 'fit tier', 'tier', 'fit'),
    level:       pick(r, 'level', 'seniority'),
    posted:      pick(r, 'posted', 'date posted', 'posted date'),
  };
});

// ── Filter ─────────────────────────────────────────────────────────
const problems = [];
const candidates = mapped.filter((j, i) => {
  const rowNum = i + 2; // header is row 1
  if (!j.title || !j.company || !j.url) {
    problems.push(`row ${rowNum}: missing ${!j.title ? 'title' : !j.company ? 'company' : 'url'}`);
    return false;
  }
  if (!/^https?:\/\//i.test(j.url)) {
    problems.push(`row ${rowNum}: "${j.url}" is not an http(s) URL`);
    return false;
  }
  // These rows were already vetted by hand, so the title filter is applied
  // as a safety net with broad:true rather than as a gate — and --all-titles
  // turns it off entirely.
  if (!ALL && !isRelevantTitle(j.title, { broad: true })) {
    problems.push(`row ${rowNum}: "${j.title}" does not pass the title filter (use --all-titles to force)`);
    return false;
  }
  if (!isUSJob({ location: j.location })) {
    problems.push(`row ${rowNum}: "${j.location}" is outside the US`);
    return false;
  }
  return true;
});

if (problems.length) {
  console.log(`Skipping ${problems.length} row(s):`);
  problems.forEach(p => console.log(`  · ${p}`));
  console.log('');
}
console.log(`${candidates.length} row(s) ready to import\n`);

if (DRY_RUN) {
  candidates.forEach(j => console.log(`  ${j.fitTier ? `[${j.fitTier}] ` : ''}${j.title} — ${j.company} — ${j.location || 'n/a'}`));
  console.log(`\nDry run — nothing written.`);
  process.exit(0);
}

// ── Import ─────────────────────────────────────────────────────────
// Loaded here rather than at the top so --dry-run works from a checkout
// with no node_modules installed — parsing and filtering need no deps.
const { default: ws } = await import('ws');
globalThis.WebSocket = ws;  // @supabase/supabase-js reads this at import time
const { createClient } = await import('@supabase/supabase-js');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let inserted = 0, duplicates = 0, failed = 0, evaluated = 0, noDescription = 0;

for (const j of candidates) {
  if (await isDuplicateJob(supabase, j.url)) {
    console.log(`  · duplicate — ${j.title} @ ${j.company}`);
    duplicates++;
    continue;
  }

  let description = '';
  if (FETCH_JD) {
    description = await fetchDescription(j.url);
    if (!description) noDescription++;
  }

  const record = normalizeJob({
    title: j.title, company: j.company, url: j.url,
    location: j.location, description, source: SOURCE,
  });

  let row;
  try {
    row = await insertJob(supabase, record);
    inserted++;
    console.log(`  ✓ ${j.title} @ ${j.company}${description ? '' : '  (no description)'}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${j.title} @ ${j.company} — ${err.message}`);
    continue;
  }

  // Scoring an empty JD produces a confident-looking number built on
  // nothing, which is worse than an unscored row — so skip it.
  if (EVALUATE && description) {
    const evaluation = await runClaudeEvaluation(supabase, row, ANTHROPIC_KEY);
    if (evaluation) {
      evaluated++;
      console.log(`      scored ${evaluation.overall_score} — ${evaluation.recommendation}`);
    }
  }
}

console.log(`
═══ IMPORT SUMMARY ═══
  Inserted:   ${inserted}
  Duplicates: ${duplicates}
  Failed:     ${failed}
  Evaluated:  ${evaluated}${noDescription ? `\n  No description fetched: ${noDescription} (left unscored — paste the JD in the Evaluate tab)` : ''}
`);
