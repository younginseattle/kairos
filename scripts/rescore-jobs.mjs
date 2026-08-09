#!/usr/bin/env node
/**
 * Rescore every job in the pipeline with fit scoring v2 and print a
 * before/after table sorted by largest score movement.
 *
 * Requires the 002_fit_scoring_v2.sql migration to have been run first.
 *
 *   node --env-file=.env scripts/rescore-jobs.mjs --plan
 *   node --env-file=.env scripts/rescore-jobs.mjs --stale-signals --limit=10
 *   node --env-file=.env scripts/rescore-jobs.mjs --company=lambda,crusoe
 *
 * SELECTION — every selected row is one Claude call, so narrow it first.
 * --plan                 list what WOULD be processed and exit. Zero API calls.
 *                        Unlike --dry-run, this costs nothing.
 * --limit=N              cap at N rows, applied AFTER the filters below
 * --company=a,b          only these companies (substring, case-insensitive)
 * --stale-signals        only rows whose stored extraction predates the current
 *                        signal vocabulary — see isStale() for what counts
 * --missing-extraction   only rows with no stored extraction at all. These
 *                        cannot be replayed by recompute-scores.mjs at any
 *                        price, so this is the bucket that only re-extraction
 *                        can reach.
 * --only-new             skip jobs already carrying a fit_model_version
 *
 * EXECUTION
 * --dry-run   still calls Claude for every selected row; only the DB write is
 *             skipped. Use --plan when the goal is to avoid spending calls.
 */

// Supabase's realtime client wants a global WebSocket. Node 22 has one natively;
// older runtimes do not. Shim only when it is missing, and do not hard-depend on
// `ws` — it is not a declared dependency, it only resolves transitively through
// @supabase/supabase-js today, so a hoisting or version change would break this.
if (typeof globalThis.WebSocket === 'undefined') {
  try { globalThis.WebSocket = (await import('ws')).default; } catch { /* realtime unused here */ }
}
const { createClient } = await import('@supabase/supabase-js');

const { computeFit, MODEL_VERSION } = await import('../src/scoring.js');
const { FIT_EXTRACTION_PROMPT, buildFitUserMessage, extractionToSignals } = await import('../src/fitPrompt.js');
const { staleReason } = await import('../src/staleSignals.js');

const DRY_RUN  = process.argv.includes('--dry-run');
const PLAN     = process.argv.includes('--plan');
const ONLY_NEW = process.argv.includes('--only-new');
const STALE    = process.argv.includes('--stale-signals');
const MISSING  = process.argv.includes('--missing-extraction');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const LIMIT    = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;
const compArg  = process.argv.find(a => a.startsWith('--company='));
const COMPANIES = compArg
  ? compArg.split('=')[1].toLowerCase().split(',').map(s => s.trim()).filter(Boolean)
  : null;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_KEY;

// --plan makes no API calls, so it must not demand an Anthropic key.
const required = [['SUPABASE_URL', SUPABASE_URL], ['SUPABASE key', SUPABASE_KEY]];
if (!PLAN) required.push(['ANTHROPIC_API_KEY', ANTHROPIC_KEY]);
for (const [k, v] of required) {
  if (!v) { console.error(`✗ Missing ${k}`); process.exit(1); }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function extract(job) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY.trim(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      temperature: 0,   // extraction is not a creative task
      system: FIT_EXTRACTION_PROMPT,
      messages: [{ role: 'user', content: buildFitUserMessage({
        title: job.title, company: job.company, location: job.location, jd: job.description,
      }) }],
    }),
  });
  if (!res.ok) throw new Error(`Claude HTTP ${res.status}`);
  const payload = await res.json();
  if (payload.error) throw new Error(payload.error.message);
  const raw = payload.content.map(b => b.text || '').join('').trim()
    .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(raw);
}

function stats(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return {
    n, min: s[0], max: s[n - 1], mean,
    median: n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2,
    sd, p10: s[Math.floor(n * 0.10)], p90: s[Math.floor(n * 0.90)],
  };
}

function histogram(values, label) {
  console.log(`\n  ${label}`);
  for (let b = 0; b <= 90; b += 10) {
    const c = values.filter(v => v >= b && v < b + 10).length;
    console.log(`    ${String(b).padStart(3)}-${b + 9}: ${'#'.repeat(c)} ${c}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────
console.log(`\n◆ Rescore with ${MODEL_VERSION}${DRY_RUN ? '  [DRY RUN — no writes]' : ''}\n`);

// PostgREST caps a single select at db-max-rows (1000 on Supabase) SILENTLY —
// no error, no flag. The pipeline is already past that, so a bare select here
// would quietly skip the oldest rows. Page unless an explicit --limit is set.
const COLS = 'id,title,company,location,description,status,score,fit_score,fit_model_version,fit_detail,comp_verified_tc,burden_verified';
const PAGE = 1000;

// Always page the full table. --limit is applied AFTER filtering now: capping
// at fetch time would take the N most recent rows and then filter those down,
// so "--company=lambda --limit=10" could return nothing while ten Lambda rows
// sat further down the table.
async function loadJobs() {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from('jobs').select(COLS).order('created_at', { ascending: false });
    if (ONLY_NEW) q = q.is('fit_model_version', null);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return { data: all, error: null };
}

const { data: allJobs, error } = await loadJobs();
if (error) { console.error('✗ Supabase read failed:', error.message); process.exit(1); }

// ── Selection ─────────────────────────────────────────────────────
const reasons = new Map();   // job id -> why it was selected
let pool = allJobs;
const filtersApplied = [];

if (COMPANIES) {
  pool = pool.filter(j => COMPANIES.some(c => (j.company || '').toLowerCase().includes(c)));
  filtersApplied.push(`company matches ${COMPANIES.join(' / ')}`);
}
if (MISSING) {
  pool = pool.filter(j => !j.fit_detail?.extraction);
  pool.forEach(j => reasons.set(j.id, 'no stored extraction'));
  filtersApplied.push('no stored extraction');
}
if (STALE) {
  pool = pool.filter(j => {
    const why = staleReason(j);
    if (why) reasons.set(j.id, why);
    return why != null;
  });
  filtersApplied.push('stale signals');
}

const selected = LIMIT ? pool.slice(0, LIMIT) : pool;

console.log(`  ${allJobs.length} row(s) in the table`);
if (filtersApplied.length) console.log(`  filters: ${filtersApplied.join(' AND ')}`);
console.log(`  ${pool.length} match${LIMIT && pool.length > LIMIT ? `, capped at ${LIMIT}` : ''}`);
console.log(`  ${selected.length} job(s) to process — ${selected.length} Claude call(s)\n`);

if (!filtersApplied.length && selected.length > 100 && !PLAN) {
  console.log(`  ⚠  No selection filter set: this will re-extract ${selected.length} rows.`);
  console.log(`     Narrow with --stale-signals / --company= / --limit=, or run --plan first.\n`);
}

// ── Plan mode — spend nothing, just show the work ─────────────────
if (PLAN) {
  const byReason = {};
  for (const j of selected) {
    const why = reasons.get(j.id) || staleReason(j) || 'current — no re-extraction needed';
    (byReason[why] ||= []).push(j);
  }
  console.log('='.repeat(96));
  console.log('SELECTION PLAN — no API calls made');
  console.log('='.repeat(96));
  for (const [why, list] of Object.entries(byReason).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ${list.length} × ${why}`);
    for (const j of list.slice(0, 8)) {
      console.log(`      ${String(j.score ?? '–').padStart(3)}  ${(j.title || '').slice(0, 46).padEnd(46)} ${(j.company || '').slice(0, 20)}`);
    }
    if (list.length > 8) console.log(`      … and ${list.length - 8} more`);
  }
  console.log(`\n  Running without --plan would make ${selected.length} Claude call(s).\n`);
  process.exit(0);
}

const jobs = selected;
if (!jobs.length) { console.log('  Nothing selected — no work to do.\n'); process.exit(0); }

const rows = [];
let ok = 0, failed = 0;

for (let i = 0; i < jobs.length; i++) {
  const job = jobs[i];
  process.stdout.write(`  [${i + 1}/${jobs.length}] ${(job.title || '').slice(0, 48).padEnd(48)} `);
  try {
    const extraction = await extract(job);
    const signals = extractionToSignals(extraction, { company: job.company, jd: job.description });
    if (job.comp_verified_tc != null) signals.compVerifiedTc = job.comp_verified_tc;
    if (job.burden_verified != null)  signals.burdenOverride  = job.burden_verified;
    const fit = computeFit(signals);

    rows.push({
      title: job.title, company: job.company,
      before: job.score, after: fit.score,
      delta: job.score != null ? fit.score - job.score : null,
      confidence: fit.confidence, band: fit.band.key,
      gates: fit.gates.map(g => g.reason),
    });

    if (!DRY_RUN) {
      const { error: upErr } = await supabase.from('jobs').update({
        fit_score: fit.score,
        fit_confidence: fit.confidence,
        fit_model_version: fit.model_version,
        fit_detail: {
          subscores: fit.subscores, explanations: fit.explanations,
          gates: fit.gates, gaps: fit.gaps, math: fit.math, band: fit.band,
          confidence_reasons: fit.confidence_reasons, extraction,
        },
      }).eq('id', job.id);
      if (upErr) throw new Error(upErr.message);
    }
    console.log(`${String(job.score ?? '–').padStart(3)} → ${String(fit.score).padStart(3)}  (conf ${fit.confidence}%)`);
    ok++;
  } catch (err) {
    console.log(`FAILED — ${err.message}`);
    failed++;
  }
}

// ── Before / after report ─────────────────────────────────────────
const movers = rows.filter(r => r.delta != null).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

console.log('\n' + '='.repeat(96));
console.log('BEFORE / AFTER — largest movers first');
console.log('='.repeat(96));
console.log(`${'Δ'.padStart(6)}  ${'before'.padStart(6)} ${'after'.padStart(6)}  ${'conf'.padStart(5)}  ${'band'.padEnd(11)} role`);
console.log('-'.repeat(96));
for (const r of movers) {
  const arrow = r.delta > 0 ? '+' : '';
  const label = `${(r.title || '').slice(0, 42)} · ${(r.company || '').slice(0, 18)}`;
  console.log(`${(arrow + r.delta).padStart(6)}  ${String(r.before).padStart(6)} ${String(r.after).padStart(6)}  ${String(r.confidence + '%').padStart(5)}  ${r.band.padEnd(11)} ${label}`);
}

const before = rows.filter(r => r.before != null).map(r => r.before);
const after  = rows.map(r => r.after);
const sb = stats(before), sa = stats(after);

console.log('\n' + '='.repeat(96));
console.log('DISTRIBUTION');
console.log('='.repeat(96));
if (sb && sa) {
  const fmt = s => `n=${s.n}  min=${s.min}  max=${s.max}  mean=${s.mean.toFixed(1)}  median=${s.median}  sd=${s.sd.toFixed(2)}  p10=${s.p10}  p90=${s.p90}`;
  console.log(`  BEFORE  ${fmt(sb)}`);
  console.log(`  AFTER   ${fmt(sa)}`);
  console.log(`\n  standard deviation: ${sb.sd.toFixed(2)} → ${sa.sd.toFixed(2)}  (${sa.sd > sb.sd ? '+' : ''}${(sa.sd - sb.sd).toFixed(2)})`);
  console.log(`  p90 − p10 spread:   ${sb.p90 - sb.p10} → ${sa.p90 - sa.p10}`);
  histogram(before, 'BEFORE');
  histogram(after, 'AFTER');
}

const bands = {};
rows.forEach(r => bands[r.band] = (bands[r.band] || 0) + 1);
console.log('\n  Operational bands:');
for (const [b, c] of Object.entries(bands)) {
  console.log(`    ${b.padEnd(12)} ${String(c).padStart(3)}  (${(c / rows.length * 100).toFixed(0)}%)`);
}

console.log(`\n  ${ok} rescored, ${failed} failed${DRY_RUN ? '  [DRY RUN — nothing written]' : ''}\n`);
