#!/usr/bin/env node
/**
 * Backfills applied_at for jobs already marked "applied" that have no applied_at set.
 * Uses created_at as a fallback (best approximation we have).
 *
 * Run AFTER adding the column in Supabase:
 *   alter table jobs add column if not exists applied_at timestamptz;
 *
 * Then run: node --env-file=../.env scripts/backfill-applied-at.mjs
 */

import ws from 'ws';
globalThis.WebSocket = ws;
const { createClient } = await import('@supabase/supabase-js');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL) { console.error('✗ Missing VITE_SUPABASE_URL'); process.exit(1); }
if (!SUPABASE_KEY) { console.error('✗ Missing VITE_SUPABASE_ANON_KEY'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Fetch all applied jobs with no applied_at
const { data: jobs, error } = await supabase
  .from('jobs')
  .select('id, title, company, created_at, applied_at')
  .eq('status', 'applied');

if (error) { console.error('✗ Query failed:', error.message); process.exit(1); }

const needsBackfill = (jobs || []).filter(j => !j.applied_at);
const alreadySet    = (jobs || []).filter(j => j.applied_at);

console.log(`\nApplied jobs total  : ${(jobs || []).length}`);
console.log(`Already have date   : ${alreadySet.length}`);
console.log(`Need backfill       : ${needsBackfill.length}\n`);

if (needsBackfill.length === 0) {
  console.log('Nothing to backfill.\n');
  process.exit(0);
}

console.log('Jobs to backfill (will use created_at as applied_at):');
for (const j of needsBackfill) {
  console.log(`  ${j.created_at.split('T')[0]}  ${j.title} — ${j.company}`);
}

const DRY_RUN = process.argv.includes('--dry-run');
if (DRY_RUN) {
  console.log('\n[dry-run] No changes written. Remove --dry-run to apply.\n');
  process.exit(0);
}

console.log('\nWriting...');
let updated = 0, failed = 0;
for (const j of needsBackfill) {
  const { error: upErr } = await supabase
    .from('jobs')
    .update({ applied_at: j.created_at })
    .eq('id', j.id);
  if (upErr) {
    console.error(`  ✗ ${j.title} — ${upErr.message}`);
    failed++;
  } else {
    console.log(`  ✓ ${j.title} — ${j.company}  → ${j.created_at.split('T')[0]}`);
    updated++;
  }
}

console.log(`\nDone. Updated: ${updated}  Failed: ${failed}\n`);
if (failed > 0) process.exit(1);
