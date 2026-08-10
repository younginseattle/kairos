#!/usr/bin/env node
/**
 * Clean up duplicate rows ALREADY in the pipeline.
 *
 * The ingestion paths now dedup on role identity (see src/jobIdentity.js), so
 * no new duplicates are created — but roles that were cross-posted to several
 * sites before that fix are still sitting in the pipeline two or three times.
 * This collapses each group down to one row.
 *
 *   node --env-file=.env scripts/dedupe-existing-jobs.mjs             # dry run
 *   node --env-file=.env scripts/dedupe-existing-jobs.mjs --apply     # write
 *
 * Which row survives, in order:
 *   1. an engaged row (applied / interviewing / offer / rejected / reviewing) —
 *      the one carrying the real history always wins, and is never deleted
 *   2. the more authoritative source (own ATS board > LinkedIn > aggregator)
 *   3. the row that already has a score, so an evaluation isn't thrown away
 *   4. the oldest row, to preserve the original discovery date
 *
 * Before the losers are removed, anything the survivor is missing (score and
 * evaluation fields, description, applied_at) is copied across, so collapsing
 * never costs information.
 */

if (typeof globalThis.WebSocket === 'undefined') {
  try { globalThis.WebSocket = (await import('ws')).default; } catch { /* realtime unused here */ }
}
const { createClient } = await import('@supabase/supabase-js');
const { jobIdentityKey, canonicalUrlKey, sourceRank } = await import('../src/jobIdentity.js');

const APPLY = process.argv.includes('--apply');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('✗ Missing Supabase env'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ENGAGED = new Set(['reviewing', 'applied', 'interviewing', 'offer', 'rejected']);

// Evaluation columns worth rescuing from a row that is about to be removed.
const EVAL_COLUMNS = [
  'score', 'recommendation', 'strengths', 'gaps', 'quick_wins', 'verdict',
  'skills_match', 'experience_match', 'culture_match', 'compensation_score',
  'work_life_balance_score', 'growth_score', 'location_score', 'company_score',
  'confidence_score', 'missing_keywords', 'strategic_gaps', 'score_explanation',
  'top_candidate_signal', 'fit_score', 'fit_confidence', 'fit_model_version', 'fit_detail',
];

async function loadAllJobs() {
  const PAGE = 1000;
  const rows = [];
  for (let page = 0; ; page++) {
    const from = page * PAGE;
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error(`✗ Load failed at offset ${from}: ${error.message}`); process.exit(1); }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

/** Groups rows that describe the same role, by URL key and identity key. */
function groupDuplicates(rows) {
  const groupOf = new Map();   // key → group id
  const groups  = new Map();   // group id → rows

  for (const row of rows) {
    const keys = [];
    const urlKey = canonicalUrlKey(row.url);
    if (urlKey) keys.push(`url:${urlKey}`);
    const identity = jobIdentityKey(row);
    if (identity) keys.push(`id:${identity}`);
    if (keys.length === 0) continue;

    // A row can bridge two existing groups (same URL as one, same identity as
    // another) — merge them so each role ends up in exactly one group.
    const hits = [...new Set(keys.map(k => groupOf.get(k)).filter(g => g !== undefined))];
    let groupId;
    if (hits.length === 0) {
      groupId = row.id;
      groups.set(groupId, []);
    } else {
      groupId = hits[0];
      for (const other of hits.slice(1)) {
        groups.get(groupId).push(...groups.get(other));
        groups.delete(other);
        for (const [k, g] of groupOf) if (g === other) groupOf.set(k, groupId);
      }
    }
    groups.get(groupId).push(row);
    for (const k of keys) groupOf.set(k, groupId);
  }

  return [...groups.values()].filter(g => g.length > 1);
}

function pickSurvivor(group) {
  return [...group].sort((a, b) => {
    const engaged = Number(ENGAGED.has(b.status)) - Number(ENGAGED.has(a.status));
    if (engaged) return engaged;
    const source = sourceRank(b.source) - sourceRank(a.source);
    if (source) return source;
    const scored = Number(b.score != null) - Number(a.score != null);
    if (scored) return scored;
    return new Date(a.created_at) - new Date(b.created_at);
  })[0];
}

/** Fields the survivor is missing that a losing row can supply. */
function rescueFields(survivor, losers) {
  const updates = {};

  if (survivor.score == null) {
    const scored = losers.find(l => l.score != null);
    if (scored) for (const col of EVAL_COLUMNS) {
      if (scored[col] != null) updates[col] = scored[col];
    }
  }
  if (!survivor.description) {
    const withDesc = losers.find(l => l.description);
    if (withDesc) updates.description = withDesc.description;
  }
  if (!survivor.applied_at) {
    const applied = losers.find(l => l.applied_at);
    if (applied) updates.applied_at = applied.applied_at;
  }
  return updates;
}

async function main() {
  console.log(`\n◆ Kairos duplicate cleanup ${APPLY ? '(APPLY — rows will be removed)' : '(dry run — nothing will be written)'}\n`);

  const rows = await loadAllJobs();
  console.log(`  Loaded ${rows.length} row(s)`);

  const groups = groupDuplicates(rows);
  if (groups.length === 0) {
    console.log('  No duplicate roles found. Nothing to do.\n');
    return;
  }

  const totalExtra = groups.reduce((n, g) => n + g.length - 1, 0);
  console.log(`  Found ${groups.length} role(s) present more than once — ${totalExtra} redundant row(s)\n`);

  let removed = 0, rescued = 0, failed = 0;

  for (const group of groups) {
    const survivor = pickSurvivor(group);
    const losers   = group.filter(r => r.id !== survivor.id);
    // An engaged row is history — never delete one, even as a duplicate.
    const removable = losers.filter(r => !ENGAGED.has(r.status));
    const kept      = losers.filter(r => ENGAGED.has(r.status));

    console.log(`  "${survivor.title}" — ${survivor.company}`);
    // Print each row's OWN title. The group header shows only the survivor's,
    // which hid the first run's real problem: rows with visibly different
    // titles sitting in one group, readable only by squinting at URL slugs.
    const line = (verb, r) =>
      `    ${verb} ${r.source || 'unknown'} · ${r.status} · ${r.title || '(no title)'}\n           ${r.url}`;
    console.log(line('keep  ', survivor));
    for (const r of removable) console.log(line('remove', r));

    const distinctTitles = new Set(group.map(r => (r.title || '').trim().toLowerCase())).size;
    if (distinctTitles > 1) {
      console.log(`    ⚠  ${distinctTitles} distinct titles in this group — check before applying`);
    }
    for (const r of kept)      console.log(`    KEPT   ${r.source || 'unknown'} · ${r.status} · in-process, left alone`);

    const updates = rescueFields(survivor, losers);
    if (Object.keys(updates).length > 0) {
      console.log(`    rescue ${Object.keys(updates).join(', ')}`);
    }

    if (!APPLY) { console.log(''); continue; }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from('jobs').update(updates).eq('id', survivor.id);
      if (error) { console.error(`    ✗ rescue failed: ${error.message}`); failed++; }
      else rescued++;
    }

    if (removable.length > 0) {
      const { error } = await supabase.from('jobs').delete().in('id', removable.map(r => r.id));
      if (error) { console.error(`    ✗ delete failed: ${error.message}`); failed++; }
      else removed += removable.length;
    }
    console.log('');
  }

  console.log('── Summary');
  if (APPLY) {
    console.log(`   Removed  : ${removed}`);
    console.log(`   Rescued  : ${rescued} survivor row(s) backfilled`);
    if (failed > 0) console.log(`   Failed   : ${failed}`);
  } else {
    console.log(`   Would remove ${totalExtra} row(s). Re-run with --apply to write.`);
  }
  console.log('   Done ✓\n');
}

main().catch(err => { console.error('✗ Fatal:', err.message); process.exit(1); });
