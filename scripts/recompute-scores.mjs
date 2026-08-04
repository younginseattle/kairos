#!/usr/bin/env node
/**
 * Replay the current scoring model over every job that already has a stored
 * extraction — with NO Claude calls.
 *
 * Scoring v2 splits the work in two: one Claude call EXTRACTS evidence, then
 * src/scoring.js computes the number from that evidence deterministically.
 * The extraction is persisted in fit_detail.extraction, so any change to the
 * scoring half can be replayed over the whole pipeline for free. Only rows with
 * no stored extraction (v1-era rows) need the paid path — scripts/rescore-jobs.mjs.
 *
 *   node --env-file=.env scripts/recompute-scores.mjs --dry-run
 *   node --env-file=.env scripts/recompute-scores.mjs
 *   node --env-file=.env scripts/recompute-scores.mjs --restore-passed
 *
 * --dry-run          compute and print, write nothing
 * --restore-passed   also flip historically auto-passed rows back to 'new'
 *                    when the CURRENT rule (shouldAutoPass) would not hide them
 */

// Supabase's realtime client wants a global WebSocket. Node 22 has one natively;
// older runtimes do not. Shim only when it is missing, and do not hard-depend on
// `ws` — it is not a declared dependency, it only resolves transitively through
// @supabase/supabase-js today, so a hoisting or version change would break this.
if (typeof globalThis.WebSocket === 'undefined') {
  try { globalThis.WebSocket = (await import('ws')).default; } catch { /* realtime unused here */ }
}
const { createClient } = await import('@supabase/supabase-js');
const { computeFit, MODEL_VERSION, shouldAutoPass } = await import('../src/scoring.js');
const { extractionToSignals } = await import('../src/fitPrompt.js');

const DRY_RUN = process.argv.includes('--dry-run');
const RESTORE = process.argv.includes('--restore-passed');

// The OLD ingestion rule, used only to RECOGNISE historical auto-passes:
//   recommendation === 'skip' || overall_score < 55
// Whether a row should STAY hidden is decided by the current rule,
// shouldAutoPass(), which fires on structural disqualifiers rather than a score.
const LEGACY_AUTO_PASS_THRESHOLD = 55;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('✗ Missing Supabase env'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/** PostgREST caps a single select at 1000 rows silently — page explicitly. */
const PAGE = 1000;
async function fetchAllJobs() {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('jobs')
      .select('id,title,company,description,status,score,recommendation,fit_score,fit_detail,comp_verified_tc,burden_verified')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) { console.error('✗ Supabase read failed:', error.message); process.exit(1); }
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

function stats(v) {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b), n = s.length;
  const mean = v.reduce((a, b) => a + b, 0) / n;
  return { n, min: s[0], max: s[n - 1], mean,
    median: n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2,
    sd: Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / n) };
}

console.log(`\n◆ Offline recompute with ${MODEL_VERSION}${DRY_RUN ? '  [DRY RUN — no writes]' : ''}\n`);

const jobs = await fetchAllJobs();
console.log(`  ${jobs.length} row(s) in the table\n`);

const withExtraction = jobs.filter(j => j.fit_detail?.extraction);
const withoutExtraction = jobs.filter(j => !j.fit_detail?.extraction);
console.log(`  ${withExtraction.length} have a stored extraction — recomputable for free`);
console.log(`  ${withoutExtraction.length} do not — these need scripts/rescore-jobs.mjs (one Claude call each)\n`);

const rows = [];
let failed = 0;

for (const job of withExtraction) {
  try {
    const signals = extractionToSignals(job.fit_detail.extraction, {
      company: job.company, jd: job.description,
    });
    if (job.comp_verified_tc != null) signals.compVerifiedTc = job.comp_verified_tc;
    if (job.burden_verified != null)  signals.burdenOverride  = job.burden_verified;
    const fit = computeFit(signals);

    const before = job.fit_score ?? job.score;
    // Only rows the AUTO-pass rule would have hidden are restore candidates.
    // A job manually passed at a healthy score is left alone.
    const looksAutoPassed = job.status === 'pass' &&
      (job.recommendation === 'skip' || (before != null && before < LEGACY_AUTO_PASS_THRESHOLD));
    const stillHides = shouldAutoPass(fit);
    rows.push({
      id: job.id, title: job.title, company: job.company,
      before, after: fit.score, delta: before != null ? fit.score - before : null,
      status: job.status, looksAutoPassed,
      restore: looksAutoPassed && !stillHides.pass,
      keptReason: stillHides.reason,
      fit,
    });
  } catch (err) {
    console.log(`  FAILED ${job.title} — ${err.message}`);
    failed++;
  }
}

// ── Writes ────────────────────────────────────────────────────────
let written = 0, restored = 0;
if (!DRY_RUN) {
  for (const r of rows) {
    const patch = {
      fit_score: r.fit.score,
      fit_confidence: r.fit.confidence,
      fit_model_version: r.fit.model_version,
      score: r.fit.score,
      fit_detail: {
        subscores: r.fit.subscores, explanations: r.fit.explanations,
        gates: r.fit.gates, gaps: r.fit.gaps, math: r.fit.math, band: r.fit.band,
        confidence_reasons: r.fit.confidence_reasons,
        extraction: jobs.find(j => j.id === r.id).fit_detail.extraction,
      },
    };
    if (RESTORE && r.restore) { patch.status = 'new'; restored++; }
    const { error } = await supabase.from('jobs').update(patch).eq('id', r.id);
    if (error) { console.log(`  write failed ${r.id}: ${error.message}`); failed++; }
    else written++;
  }
}

// ── Report ────────────────────────────────────────────────────────
const movers = rows.filter(r => r.delta != null && r.delta !== 0)
  .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 30);

console.log('='.repeat(92));
console.log('LARGEST MOVERS (top 30)');
console.log('='.repeat(92));
for (const r of movers) {
  const flag = r.restore ? ' ⟵ UNHIDE' : '';
  console.log(`${((r.delta > 0 ? '+' : '') + r.delta).padStart(5)}  ${String(r.before).padStart(3)} → ${String(r.after).padStart(3)}  ${(r.title || '').slice(0, 40).padEnd(40)} ${(r.company || '').slice(0, 16).padEnd(16)}${flag}`);
}

const before = rows.filter(r => r.before != null).map(r => r.before);
const after = rows.map(r => r.after);
const sb = stats(before), sa = stats(after);
console.log('\n' + '='.repeat(92));
console.log('DISTRIBUTION');
console.log('='.repeat(92));
if (sb && sa) {
  const f = s => `n=${s.n} min=${s.min} max=${s.max} mean=${s.mean.toFixed(1)} median=${s.median} sd=${s.sd.toFixed(2)}`;
  console.log(`  BEFORE  ${f(sb)}`);
  console.log(`  AFTER   ${f(sa)}`);
}

const candidates = rows.filter(r => r.looksAutoPassed);
const wouldRestore = rows.filter(r => r.restore);
console.log('\n' + '='.repeat(92));
console.log('AUTO-PASSED BACKLOG');
console.log('='.repeat(92));
console.log(`  ${candidates.length} row(s) look auto-passed (status=pass, hidden under the legacy <${LEGACY_AUTO_PASS_THRESHOLD} rule)`);
console.log(`  ${wouldRestore.length} of those have no structural disqualifier and ${RESTORE && !DRY_RUN ? 'were restored to' : 'WOULD be restored to'} 'new'`);
const stayHidden = candidates.filter(r => !r.restore);
console.log(`  ${stayHidden.length} stay hidden — structurally out of scope:`);
const byReason = {};
stayHidden.forEach(r => { byReason[r.keptReason] = (byReason[r.keptReason] || 0) + 1; });
for (const [reason, n] of Object.entries(byReason)) console.log(`      ${String(n).padStart(4)}  ${reason}`);
if ((!RESTORE || DRY_RUN) && wouldRestore.length) console.log(`  → re-run with --restore-passed to un-hide them`);

console.log(`\n  ${written} row(s) written, ${restored} restored, ${failed} failed${DRY_RUN ? '  [DRY RUN — nothing written]' : ''}\n`);
