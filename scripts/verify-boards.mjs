#!/usr/bin/env node
/**
 * BOARD VERIFICATION
 * ─────────────────────────────────────────────────────────────────
 * Probes every {ats, id} guess in src/candidateSources.js against the
 * live ATS APIs and reports which ones are real, how many jobs they
 * carry, and how many pass the title filter.
 *
 * Run this in GitHub Actions, not in a dev sandbox — sandbox egress
 * proxies block boards-api.greenhouse.io and api.ashbyhq.com, and a
 * blocked host is indistinguishable from a dead board in the output.
 *
 *   Actions:  workflow_dispatch → "Verify Job Boards"
 *   Local:    node scripts/verify-boards.mjs [--only=clickhouse,lambda]
 *
 * No credentials required — nothing is written to Supabase. The output
 * ends with paste-ready SOURCES lines for every confirmed board.
 */

import { fetchSourceJobs } from '../src/ingestion.js';
import { CANDIDATE_SOURCES, candidateProbes } from '../src/candidateSources.js';
import { isRelevantTitle } from '../src/titleFilter.js';

const onlyArg = process.argv.find(a => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.split('=')[1].toLowerCase().split(',').map(s => s.trim()) : null;

const candidates = ONLY
  ? CANDIDATE_SOURCES.filter(c => ONLY.some(o => c.company.toLowerCase().includes(o)))
  : CANDIDATE_SOURCES;

if (!candidates.length) {
  console.error(`✗ No candidates matched --only=${ONLY.join(',')}`);
  process.exit(1);
}

const probes = candidateProbes(candidates);
console.log(`Probing ${probes.length} board guesses across ${candidates.length} companies\n`);

const CONCURRENCY = 6;
const results = [];

async function runPool(items, worker) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) await worker(queue.shift());
    })
  );
}

await runPool(probes, async probe => {
  const label = `${probe.company} [${probe.ats}/${probe.id}]`;
  try {
    const jobs = await fetchSourceJobs(probe);
    const matches = jobs.filter(j => isRelevantTitle(j.title, { broad: probe.broadFilter }));
    results.push({ ...probe, ok: true, total: jobs.length, matches: matches.map(j => j.title) });
    console.log(`  ✓ ${label} — ${jobs.length} jobs, ${matches.length} matching`);
  } catch (err) {
    results.push({ ...probe, ok: false, error: err.message });
    console.log(`  ✗ ${label} — ${err.message}`);
  }
});

// ── Summary ────────────────────────────────────────────────────────
// One winner per company: prefer the guess with matching roles, then the
// one with any jobs at all. A board that responds with an empty array is
// still a real board — the company just has nothing open right now.
const byCompany = new Map();
for (const r of results) {
  if (!r.ok) continue;
  const current = byCompany.get(r.company);
  const better = !current
    || r.matches.length > current.matches.length
    || (r.matches.length === current.matches.length && r.total > current.total);
  if (better) byCompany.set(r.company, r);
}

const confirmed = [...byCompany.values()].sort((a, b) => b.matches.length - a.matches.length);
const deadCompanies = candidates
  .map(c => c.company)
  .filter(name => !byCompany.has(name));

console.log(`\n${'═'.repeat(70)}`);
console.log(`CONFIRMED — ${confirmed.length} of ${candidates.length} companies reachable`);
console.log('═'.repeat(70));
for (const r of confirmed) {
  console.log(`\n${r.company} → ${r.ats}/${r.id}  (${r.total} jobs, ${r.matches.length} matching)`);
  r.matches.slice(0, 10).forEach(t => console.log(`    · ${t}`));
  if (r.matches.length > 10) console.log(`    … and ${r.matches.length - 10} more`);
}

console.log(`\n${'═'.repeat(70)}`);
console.log(`UNREACHABLE — ${deadCompanies.length} companies, every guess failed`);
console.log('═'.repeat(70));
for (const name of deadCompanies) {
  const c = candidates.find(x => x.company === name);
  const errs = results.filter(r => r.company === name && !r.ok)
    .map(r => `${r.ats}/${r.id}: ${r.error}`);
  console.log(`\n${name}${c.fromScan ? '  ← had live matching roles in the manual scan' : ''}`);
  errs.forEach(e => console.log(`    ${e}`));
}
if (deadCompanies.some(n => candidates.find(x => x.company === n)?.fromScan)) {
  console.log(`
Note: a company marked "had live matching roles in the manual scan" is not a
dead company — its board is real and browsable by a human. Either the token
guesses are wrong or the company has disabled public API access. Route those
through a LinkedIn job alert instead of dropping them.`);
}

console.log(`\n${'═'.repeat(70)}`);
console.log('PASTE-READY SOURCES ENTRIES');
console.log('═'.repeat(70));
for (const r of confirmed) {
  const broad = r.broadFilter ? ', broadFilter: true' : '';
  console.log(`  { id: "${r.id}", ats: "${r.ats}", tier: ${r.tier}, domain: "${r.domain}"${broad} },  // ${r.company} — ${r.matches.length} matching at verification`);
}
console.log('');
