#!/usr/bin/env node
/**
 * List every job currently sitting at status='pass' — i.e. hidden from the
 * Saved tab pipeline by shouldAutoPass() — with the stored gate reason that
 * hid it. Read-only; writes nothing.
 *
 * The Saved tab filters out status='pass' rows entirely, but the daily
 * briefing (run-briefing.mjs) queries the jobs table with no status filter
 * at all, so an auto-passed job still shows up there. This script exists to
 * make that gap legible without clicking through the app: run it whenever a
 * job seen in a briefing is missing from the pipeline.
 *
 *   node --env-file=.env scripts/list-autopassed.mjs
 *   node --env-file=.env scripts/list-autopassed.mjs --days=30
 *   node --env-file=.env scripts/list-autopassed.mjs --company=google
 *   node --env-file=.env scripts/list-autopassed.mjs --all
 *
 * --days=N     only rows passed/created in the last N days (default 14)
 * --all        no day window — every currently-passed row
 * --company=x  substring match on company, case-insensitive
 */

if (typeof globalThis.WebSocket === 'undefined') {
  try { globalThis.WebSocket = (await import('ws')).default; } catch { /* realtime unused here */ }
}
const { createClient } = await import('@supabase/supabase-js');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('✗ Missing Supabase env'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = process.argv.slice(2);
const ALL = args.includes('--all');
const daysArg = args.find(a => a.startsWith('--days='));
const DAYS = daysArg ? Number(daysArg.slice('--days='.length)) : 14;
const companyArg = args.find(a => a.startsWith('--company='));
const COMPANY = companyArg ? companyArg.slice('--company='.length).toLowerCase() : null;

let query = supabase
  .from('jobs')
  .select('id,title,company,url,status,score,created_at,fit_detail')
  .eq('status', 'pass')
  .order('created_at', { ascending: false });

if (!ALL) {
  const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();
  query = query.gte('created_at', cutoff);
}

const { data: rows, error } = await query;
if (error) { console.error('✗ Supabase query failed:', error.message); process.exit(1); }

let jobs = rows || [];
if (COMPANY) jobs = jobs.filter(j => (j.company || '').toLowerCase().includes(COMPANY));

console.log(`\n◆ Auto-passed jobs ${ALL ? '(all time)' : `(last ${DAYS}d)`}${COMPANY ? ` — company contains "${COMPANY}"` : ''}\n`);

if (!jobs.length) {
  console.log('  None found. If you expected one here, check --all or widen --days.\n');
  process.exit(0);
}

for (const j of jobs) {
  const gates = j.fit_detail?.gates || [];
  const extraction = j.fit_detail?.extraction || null;
  const confidence = j.fit_detail?.confidence ?? j.fit_detail?.fit?.confidence ?? null;

  console.log('-'.repeat(78));
  console.log(`${j.title || '(no title)'} — ${j.company || '(no company)'}`);
  console.log(`  score ${j.score ?? 'n/a'}${confidence != null ? `  confidence ${confidence}%` : ''}  added ${(j.created_at || '').slice(0, 10)}`);
  if (j.url) console.log(`  ${j.url}`);

  if (gates.length) {
    for (const g of gates) console.log(`  GATE: ${g.reason} → ceiling ${g.ceiling}`);
  } else {
    console.log('  (no stored gates — passed under an older scoring version, or the row predates fit_detail.gates)');
  }

  if (extraction) {
    const bits = [];
    if (extraction.title_band) bits.push(`title_band=${extraction.title_band}`);
    if (extraction.location_posture) bits.push(`location_posture=${JSON.stringify(extraction.location_posture)}`);
    if (extraction.stated_experience_years) {
      const { min, max } = extraction.stated_experience_years;
      if (min != null || max != null) bits.push(`stated_experience_years=${min ?? '?'}-${max ?? '+'}`);
    }
    if (bits.length) console.log(`  extraction: ${bits.join('  ')}`);
  }
  console.log('');
}

console.log('-'.repeat(78));
console.log(`\n${jobs.length} job(s) hidden from the Saved tab. Restore individually via Saved tab → Passed filter → select → Restore,`);
console.log('or all at once via the "passed · restore all" banner.\n');
