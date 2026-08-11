/**
 * STALE SIGNAL TESTS
 *
 * scripts/rescore-jobs.mjs spends one Claude call per row this function
 * selects, and skips every row it clears. Both directions cost something:
 * a false positive is money, a false negative is a role that keeps its
 * stale score forever. Pin the boundaries.
 *
 * Run:  node src/staleSignals.test.mjs
 */

import { staleReason } from "./staleSignals.js";

let passed = 0, failed = 0;
const failures = [];

function check(label, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(`${label}${detail ? " — " + detail : ""}`); console.log(`  ✗ ${label}${detail ? " — " + detail : ""}`); }
}

/** A row extracted under the CURRENT vocabulary, with nothing stale in it. */
const current = {
  description: "Own the observability roadmap for a distributed telemetry platform.",
  fit_detail: {
    extraction: {
      known_gaps: [{ gap: "gpu_infra", level: "preferred" }],
      location_posture: "remote",
      non_interchangeable_matches: [{ proof: "telemetry_econ", strength: "direct" }],
    },
  },
};

console.log("\nCurrent rows are left alone");
check("a fully current extraction is not stale", staleReason(current) === null,
  staleReason(current) || "");
check("a multi-site array is already current",
  staleReason({ ...current, fit_detail: { extraction: {
    ...current.fit_detail.extraction, location_posture: ["hybrid_local", "hybrid_remote"] } } }) === null);
check("a local single posture is not stale",
  staleReason({ ...current, fit_detail: { extraction: {
    ...current.fit_detail.extraction, location_posture: "seattle" } } }) === null);

console.log("\nRows needing re-extraction are caught");
check("no stored extraction at all",
  staleReason({ description: "x", fit_detail: null }) === "no stored extraction");
check("missing fit_detail entirely",
  staleReason({ description: "x" }) === "no stored extraction");
check("the retired k8s_operators gap key",
  /retired gap key: k8s_operators/.test(staleReason({ ...current, fit_detail: { extraction: {
    ...current.fit_detail.extraction,
    known_gaps: [{ gap: "k8s_operators", level: "required" }] } } })));
check("a bare hybrid_remote posture may be a flattened multi-site posting",
  /may be a multi-site posting/.test(staleReason({ ...current, fit_detail: { extraction: {
    ...current.fit_detail.extraction, location_posture: "hybrid_remote" } } })));
check("a bare office_relocation posture likewise",
  /may be a multi-site posting/.test(staleReason({ ...current, fit_detail: { extraction: {
    ...current.fit_detail.extraction, location_posture: "office_relocation" } } })));

console.log("\ntitle_band split — target/below absorbed staff/senior_pm before the split");
check("a stored \"target\" is stale — may have been Staff PM",
  /may have absorbed staff\/senior_pm/.test(staleReason({ ...current, fit_detail: { extraction: {
    ...current.fit_detail.extraction, title_band: "target" } } })));
check("a stored \"below\" is stale — may have been Senior PM",
  /may have absorbed staff\/senior_pm/.test(staleReason({ ...current, fit_detail: { extraction: {
    ...current.fit_detail.extraction, title_band: "below" } } })));
check("a stored \"staff\" is already current — post-split value",
  staleReason({ ...current, fit_detail: { extraction: {
    ...current.fit_detail.extraction, title_band: "staff" } } }) === null);
check("a stored \"senior_pm\" is already current — post-split value",
  staleReason({ ...current, fit_detail: { extraction: {
    ...current.fit_detail.extraction, title_band: "senior_pm" } } }) === null);
check("a stored \"director\" is untouched by the split",
  staleReason({ ...current, fit_detail: { extraction: {
    ...current.fit_detail.extraction, title_band: "director" } } }) === null);

console.log("\nJD topics with no citable proof key at extraction time");
const billingJd = { ...current,
  description: "Own metering and billing for usage-based GPU compute, from per-minute billing to committed contracts." };
check("a billing JD with no usage_metering proof is stale",
  /usage_metering/.test(staleReason(billingJd) || ""), staleReason(billingJd) || "not stale");

const identityJd = { ...current,
  description: "Shape the identity and access management surfaces enterprise teams need, including SSO and RBAC." };
check("an identity JD with no identity_security proof is stale",
  /identity_security/.test(staleReason(identityJd) || ""), staleReason(identityJd) || "not stale");

const k8sJd = { ...current, description: "Deep experience with Kubernetes and Helm required." };
check("a Kubernetes JD with no k8s_platform proof is stale",
  /k8s_platform/.test(staleReason(k8sJd) || ""), staleReason(k8sJd) || "not stale");

check("a billing JD that ALREADY cites usage_metering is not stale",
  staleReason({ ...billingJd, fit_detail: { extraction: {
    ...current.fit_detail.extraction,
    non_interchangeable_matches: [{ proof: "usage_metering", strength: "direct" }] } } }) === null);

console.log("\nJD topics with no citable GAP key at extraction time (Pulumi diagnosis)");
const cliJd = { ...current,
  description: "Every keystroke matters. Own our CLI's error messages and progressive disclosure." };
check("a CLI/DevUX JD with no cli_devux gap is stale",
  /cli_devux/.test(staleReason(cliJd) || ""), staleReason(cliJd) || "not stale");

const iacJd = { ...current,
  description: "Deep experience with Terraform and declarative infrastructure-as-code required." };
check("an IaC JD with no iac_tooling gap is stale",
  /iac_tooling/.test(staleReason(iacJd) || ""), staleReason(iacJd) || "not stale");

const sdkJd = { ...current,
  description: "Own SDKs across multiple languages for our developer platform." };
check("a multi-language SDK JD with no multilang_sdk gap is stale",
  /multilang_sdk/.test(staleReason(sdkJd) || ""), staleReason(sdkJd) || "not stale");

check("a CLI JD that ALREADY cites cli_devux is not stale",
  staleReason({ ...cliJd, fit_detail: { extraction: {
    ...current.fit_detail.extraction,
    known_gaps: [{ gap: "cli_devux", level: "required" }] } } }) === null);

console.log("\nNo false positives on unrelated wording");
check("a plain observability JD does not trip the new topics",
  staleReason(current) === null);
check("string-form proof matches are read, not just objects",
  staleReason({ ...billingJd, fit_detail: { extraction: {
    ...current.fit_detail.extraction,
    non_interchangeable_matches: ["usage_metering"] } } }) === null);
check("string-form gap entries are read, not just objects",
  /retired gap key/.test(staleReason({ ...current, fit_detail: { extraction: {
    ...current.fit_detail.extraction, known_gaps: ["k8s_operators"] } } })));
check("an empty JD does not trip topic matching",
  staleReason({ description: "", fit_detail: current.fit_detail }) === null);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log("\nFailures:");
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
