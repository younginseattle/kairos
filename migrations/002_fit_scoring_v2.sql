-- ═══════════════════════════════════════════════════════════════
-- Fit scoring v2 — additive migration
--
-- Nothing is dropped or altered. The legacy `score`, `skills_match`,
-- `experience_match` etc. columns keep being written so existing queries,
-- the report view, and any saved filters continue to work unchanged.
-- The v2 model writes alongside them.
--
-- Run in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════

-- Headline v2 score (0-100). Separate from `score` so a rollback is just
-- "stop reading fit_score" rather than a data restore.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS fit_score integer;

-- Confidence 0-100, driven by how much of the posting was actually parseable.
-- Deliberately NOT folded into fit_score: a high score on a thin posting must
-- be visibly untrustworthy rather than silently discounted.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS fit_confidence integer;

-- Which model version produced fit_score, so a future recalibration can find
-- and re-run only the stale rows.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS fit_model_version text;

-- Per-dimension subscores, one-line explanation per dimension, gates applied,
-- known-gap deductions, and the full arithmetic trail.
-- This is what makes a score falsifiable instead of a bare number.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS fit_detail jsonb;

-- ── Manual overrides ──────────────────────────────────────────
-- Set these after a recruiter call. They beat anything inferred from the JD.
-- Comp is rarely stated in a posting and "how brutal is the process" is never
-- stated; pretending to infer either would be the same mistake the v1 model
-- made when it imputed neutral values for missing signals.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS comp_verified_tc integer;   -- total comp, $K
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS burden_verified integer;    -- 0-100, process/life burden

-- ── Outcome tracking ──────────────────────────────────────────
-- `status` records WHAT happened; this records WHY. Without it the calibration
-- set can only ever be hand-maintained in the test file. With a season of data
-- here, calibration can eventually become empirical rather than prompt-embedded.
-- Suggested values: level_mismatch | domain_gap | comp_mismatch | candidate_declined
--                 | process_burden | no_response | ghosted | hired | other
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS outcome_reason text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS outcome_notes text;

-- Sort/filter the pipeline by the new score without a sequential scan.
CREATE INDEX IF NOT EXISTS jobs_fit_score_idx ON jobs (fit_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS jobs_fit_model_version_idx ON jobs (fit_model_version);

-- Verify:
--   select column_name, data_type from information_schema.columns
--   where table_name = 'jobs' and column_name like 'fit%' or column_name like 'outcome%';
