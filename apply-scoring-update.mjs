#!/usr/bin/env node
// Scoring model update:
// 1. Reweight base: experience 40%, skills 35%, culture 25%
// 2. recommendation "skip" → -8 pts, "stretch" → -4 pts (post-scaling)
// 3. top_candidate_signal HIGH → +5, LOW → -5 (post-scaling)
// 4. enrichJob passes recommendation + top_candidate_signal to calculateFinalScore
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const path = join(dirname(fileURLToPath(import.meta.url)), 'src', 'App.jsx');
let src = readFileSync(path, 'utf8');
const orig = src;

// 1. Reweight base + add new params to calculateFinalScore signature
src = src.replace(
  `function calculateFinalScore({ skills_match, experience_match, culture_match, confidence_score, parsed = true, jd_text = "", missing_keywords = [], strategic_gaps = [], location_penalty = 0 }) {
  const mk = missing_keywords || [], sg = strategic_gaps || [];
  const base = ((skills_match ?? 0) + (experience_match ?? 0) + (culture_match ?? 0)) / 3;`,
  `function calculateFinalScore({ skills_match, experience_match, culture_match, confidence_score, parsed = true, jd_text = "", missing_keywords = [], strategic_gaps = [], location_penalty = 0, recommendation = null, top_candidate_signal = null }) {
  const mk = missing_keywords || [], sg = strategic_gaps || [];
  const base = (
    (experience_match ?? 0) * 0.40 +
    (skills_match     ?? 0) * 0.35 +
    (culture_match    ?? 0) * 0.25
  );`
);

// 2. Apply recommendation + signal adjustments post-scaling (before final clamp)
src = src.replace(
  `  // Apply location penalty AFTER scaling — direct point deduction, not weighted
  const locPenalty = Math.abs(location_penalty); // location_penalty is negative, e.g. -10
  const final_score = Math.min(Math.max(scaled - locPenalty, 0), parsed === false ? 55 : 100);`,
  `  // Apply location, recommendation, and signal adjustments AFTER scaling
  const locPenalty = Math.abs(location_penalty);
  const recAdj = recommendation === "skip" ? -8 : recommendation === "stretch" ? -4 : 0;
  const sigAdj = top_candidate_signal?.level === "HIGH" ? 5 : top_candidate_signal?.level === "LOW" ? -5 : 0;
  const final_score = Math.min(Math.max(scaled - locPenalty + recAdj + sigAdj, 0), parsed === false ? 55 : 100);`
);

// 3. Pass recommendation + top_candidate_signal through enrichJob
src = src.replace(
  `  const scoring = calculateFinalScore({
    skills_match:     job.skills_match,
    experience_match: job.experience_match,
    culture_match:    job.culture_match,
    confidence_score: job.confidence_score,
    parsed:           job.parsed ?? true,
    jd_text:          jd,
    missing_keywords: mk,
    strategic_gaps:   sg,
    location_penalty: locClassification.penalty,
  });`,
  `  const scoring = calculateFinalScore({
    skills_match:         job.skills_match,
    experience_match:     job.experience_match,
    culture_match:        job.culture_match,
    confidence_score:     job.confidence_score,
    parsed:               job.parsed ?? true,
    jd_text:              jd,
    missing_keywords:     mk,
    strategic_gaps:       sg,
    location_penalty:     locClassification.penalty,
    recommendation:       job.recommendation,
    top_candidate_signal: job.top_candidate_signal,
  });`
);

if (src === orig) {
  console.log('✗ No changes — patterns not found. Already applied or file differs.');
  process.exit(1);
}

writeFileSync(path, src, 'utf8');
const changes = [
  src.includes('experience_match ?? 0) * 0.40') ? '✓' : '✗',
  src.includes('recAdj') ? '✓' : '✗',
  src.includes('top_candidate_signal:') ? '✓' : '✗',
];
console.log(`${changes[0]} Base reweighted: experience 40% / skills 35% / culture 25%`);
console.log(`${changes[1]} Post-scaling adjustments: skip -8, stretch -4, HIGH +5, LOW -5`);
console.log(`${changes[2]} enrichJob passes recommendation + top_candidate_signal`);
