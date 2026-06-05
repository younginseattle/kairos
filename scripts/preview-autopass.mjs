#!/usr/bin/env node
/**
 * Preview which existing active jobs would be auto-passed under each option.
 * Does NOT write anything to Supabase.
 *
 * Run: node --env-file=../.env scripts/preview-autopass.mjs
 */

import ws from 'ws';
globalThis.WebSocket = ws;
const { createClient } = await import('@supabase/supabase-js');

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].forEach(k => {
  if (!process.env[k]) { console.error(`✗ Missing ${k}`); process.exit(1); }
});

const AUTO_PASS_THRESHOLD = 48;

// ── Replicate app scoring logic ──────────────────────────────────

function deriveConfidence({ confidence_score, parsed = true, jd_text = "", skills_match, experience_match, culture_match }) {
  let d = 50;
  if (parsed === true) d += 15; if (parsed === false) d -= 20;
  const len = (jd_text || "").trim().length;
  if (len > 800) d += 20; else if (len >= 300) d += 10; else d -= 10;
  const fc = [skills_match, experience_match, culture_match].filter(v => v != null).length;
  if (fc === 3) d += 15; else if (fc === 2) d += 5; else d -= 10;
  d = Math.max(15, Math.min(95, d));
  const b = confidence_score != null ? Math.round(confidence_score * 0.6 + d * 0.4) : d;
  return Math.max(15, Math.min(95, b)) / 100;
}

function calculateFinalScore({ skills_match, experience_match, culture_match, confidence_score, parsed = true, jd_text = "", missing_keywords = [], strategic_gaps = [] }) {
  const mk = missing_keywords || [], sg = strategic_gaps || [];
  const base = ((skills_match ?? 0) + (experience_match ?? 0) + (culture_match ?? 0)) / 3;
  let rp = 0;
  if (skills_match == null) rp += 15; if (experience_match == null) rp += 10; if (culture_match == null) rp += 5;
  const penalty = Math.min(rp, 20), adjusted = Math.max(0, base - penalty);
  const cf = deriveConfidence({ confidence_score, parsed, jd_text, skills_match, experience_match, culture_match });
  const weighted = adjusted * (0.6 + cf * 0.4);
  const sp = Math.min(10, (mk.length + sg.length * 1.5) * 1.5);
  const boosted = Math.min(Math.max(0, weighted - sp) + ((base >= 70 && cf >= 0.7 && parsed !== false) ? 8 : 0), 100);
  const scaled = Math.round(100 * Math.pow(boosted / 100, 0.85));
  const final_score = Math.min(Math.max(scaled, 0), parsed === false ? 55 : 100);
  const confidence_pct = Math.round(cf * 100);
  return { final_score, base: Math.round(base), confidence_pct };
}

// ── Fetch active jobs ────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const { data: jobs, error } = await supabase
  .from('jobs')
  .select('id, title, company, status, score, confidence_score, skills_match, experience_match, culture_match, missing_keywords, strategic_gaps, description, recommendation')
  .not('status', 'in', '("pass","closed","rejected")')
  .order('created_at', { ascending: false });

if (error) { console.error('✗ Query failed:', error.message); process.exit(1); }

const active = (jobs || []).filter(j => j.skills_match != null || j.experience_match != null);

// ── Score each job ───────────────────────────────────────────────

const scored = active.map(j => {
  const { final_score, base, confidence_pct } = calculateFinalScore({
    skills_match:     j.skills_match,
    experience_match: j.experience_match,
    culture_match:    j.culture_match,
    confidence_score: j.confidence_score,
    parsed:           true,
    jd_text:          j.description || "",
    missing_keywords: j.missing_keywords || [],
    strategic_gaps:   j.strategic_gaps || [],
  });
  return { ...j, final_score, base, confidence_pct };
}).sort((a, b) => a.final_score - b.final_score);

const below48       = scored.filter(j => j.final_score < AUTO_PASS_THRESHOLD);
const highConfBelow = scored.filter(j => j.final_score < AUTO_PASS_THRESHOLD && j.confidence_pct > 60);
const lowConfBelow  = scored.filter(j => j.final_score < AUTO_PASS_THRESHOLD && j.confidence_pct <= 60);

// ── Report ───────────────────────────────────────────────────────

console.log(`\n◆ Auto-pass preview  (threshold: final_score < ${AUTO_PASS_THRESHOLD})\n`);
console.log(`  Active scored jobs : ${scored.length}`);
console.log(`  Would be auto-passed:`);
console.log(`    Option 1 – Full sweep (all below ${AUTO_PASS_THRESHOLD})         : ${below48.length} jobs`);
console.log(`    Option 2 – High-confidence only (confidence > 60) : ${highConfBelow.length} jobs`);
console.log(`    Option 3 – Uncertain / left for manual review     : ${lowConfBelow.length} jobs\n`);

if (below48.length === 0) {
  console.log('  No active jobs would be auto-passed at this threshold.\n');
  process.exit(0);
}

console.log('-'.repeat(90));
console.log(`${'SCORE'.padEnd(7)}${'CONF%'.padEnd(7)}${'BASE'.padEnd(6)}${'CLAUDE REC'.padEnd(14)}${'STATUS'.padEnd(12)}${'JD LEN'.padEnd(8)}TITLE — COMPANY`);
console.log('-'.repeat(90));

for (const j of below48) {
  const flag   = j.confidence_pct <= 60 ? ' ⚠ low-conf' : '';
  const recStr = (j.recommendation || 'n/a').padEnd(13);
  const jdLen  = (j.description || '').trim().length;
  const status = (j.status || '').padEnd(11);
  console.log(
    `${String(j.final_score).padEnd(7)}${String(j.confidence_pct + '%').padEnd(7)}${String(j.base).padEnd(6)}${recStr} ${status}${String(jdLen).padEnd(8)}${j.title} — ${j.company}`
  );
}

console.log('-'.repeat(90));
console.log(`\n⚠  Low-confidence jobs (${lowConfBelow.length}) — short JDs, may score higher with full description:`);
for (const j of lowConfBelow) {
  const jdLen = (j.description || '').trim().length;
  console.log(`   score=${j.final_score}  conf=${j.confidence_pct}%  jd=${jdLen}chars  ${j.title} — ${j.company}`);
}
console.log('\nNo changes written to Supabase.\n');
