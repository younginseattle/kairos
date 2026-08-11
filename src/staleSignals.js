/**
 * ═══════════════════════════════════════════════════════════════
 * STALE SIGNAL DETECTION
 *
 * Decides whether a stored extraction predates the current signal
 * vocabulary, so re-reading the JD could produce signals the stored one
 * could not have contained.
 *
 * This is what makes a TARGETED re-extraction possible. Re-running the
 * whole table is one Claude call per row; this narrows it to the rows a
 * model change can actually move.
 *
 * Lives in src/ rather than inside scripts/rescore-jobs.mjs so it can be
 * tested without Supabase credentials — the script spends real money on
 * the strength of this function's answer.
 * ═══════════════════════════════════════════════════════════════
 */

import { KNOWN_GAPS, PROOF_POINTS } from "./scoring.js";

/**
 * JD topics that map to proof keys added after most rows were extracted.
 * A JD hit here with no corresponding proof cited means the extraction ran
 * against a vocabulary that had no way to express it.
 */
export const NEW_PROOF_TOPICS = {
  usage_metering:    /\b(meter(ing|ed)?|billing|invoic\w*|usage[- ]based|consumption[- ]based|monetiz\w*)\b/i,
  identity_security: /\b(identity|iam\b|rbac\b|sso\b|authentication|authoriz\w*|access management|compliance)\b/i,
  k8s_platform:      /\b(kubernetes|k8s\b|helm\b|operator pattern)\b/i,
};

/** Postures a multi-site posting could have been flattened into. */
export const FLATTENABLE_POSTURES = new Set(["hybrid_remote", "office_relocation"]);

/**
 * title_band values whose MEANING changed when "staff" and "senior_pm" were
 * split out as their own bands: "target" used to include Staff PM, and
 * "below" used to include Senior PM. A row stored under either value could
 * be the correctly-classified case OR the folded-in one that now belongs to
 * a different band entirely — that can only be resolved by re-reading the
 * JD, never by replaying scoring.js over the stored extraction. Deliberately
 * broad: this covers most of the pipeline, so scope a rescore run with
 * --status/--since/--company/--limit rather than running it unbounded.
 */
export const SPLIT_TITLE_BANDS = new Set(["target", "below"]);

/**
 * @param {object} job — a jobs row with fit_detail and description
 * @returns {string|null} why the row is stale, or null if it is current
 */
export function staleReason(job) {
  const x = job?.fit_detail?.extraction;
  if (!x) return "no stored extraction";

  // Gap keys that no longer exist — k8s_operators, retired when Kubernetes
  // became a proof point. The row still asserts a gap that is not one.
  const retired = (x.known_gaps || [])
    .map(g => (typeof g === "string" ? g : g?.gap))
    .filter(k => k && !KNOWN_GAPS[k]);
  if (retired.length) return `retired gap key: ${retired.join(", ")}`;

  // "target" and "below" absorbed Staff PM and Senior PM respectively before
  // those became their own bands. A stored value here is ambiguous, not
  // necessarily wrong.
  if (SPLIT_TITLE_BANDS.has(x.title_band)) {
    return `title_band "${x.title_band}" may have absorbed staff/senior_pm before the split`;
  }

  // A single non-local posture may be a multi-site posting flattened to its
  // worst option — the Lambda "Bellevue or San Francisco" case. An array is
  // already current, so only a bare string qualifies.
  if (typeof x.location_posture === "string" && FLATTENABLE_POSTURES.has(x.location_posture)) {
    return `single posture "${x.location_posture}" — may be a multi-site posting`;
  }

  // The JD covers something a new proof key describes, but the extraction
  // cites no such proof — it could not have, the key did not exist yet.
  const cited = new Set((x.non_interchangeable_matches || [])
    .map(m => (typeof m === "string" ? m : m?.proof)).filter(Boolean));
  const jd = job.description || "";
  const uncredited = Object.entries(NEW_PROOF_TOPICS)
    .filter(([key, re]) => PROOF_POINTS[key] && !cited.has(key) && re.test(jd))
    .map(([key]) => key);
  if (uncredited.length) return `JD covers uncredited proof key(s): ${uncredited.join(", ")}`;

  return null;
}
