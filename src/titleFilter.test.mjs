/**
 * TITLE FILTER TESTS
 *
 * Pinned against the manual 24-board scan: the titles below were judged
 * by hand as in-scope or out-of-scope for Matt. The filter has to agree,
 * or the automated pipeline will keep missing roles the manual scan found.
 *
 * Run:  node src/titleFilter.test.mjs
 */

import { isRelevantTitle, looksLikeSeniorTitle, explainTitle } from "./titleFilter.js";

let passed = 0, failed = 0;
const failures = [];

function want(title, expected, opts = {}) {
  const got = isRelevantTitle(title, opts);
  if (got === expected) { passed++; console.log(`  ✓ ${expected ? "IN " : "OUT"}  ${title}`); }
  else {
    failed++;
    const why = explainTitle(title, opts).reason;
    failures.push(`${title} — expected ${expected ? "IN" : "OUT"}, got ${got ? "IN" : "OUT"} (${why})`);
    console.log(`  ✗ ${title} — expected ${expected ? "IN" : "OUT"}, got ${got ? "IN" : "OUT"} (${why})`);
  }
}

console.log("\nLead-level titles — in scope on level alone");
want("Director of Product Management", true);
want("VP of Product", true);
want("VP, Product Management", true);
want("Vice President, Products", true);
want("Head of Product", true);
want("Group Product Manager", true);
want("Principal Product Manager", true);
want("Staff Product Manager", true);
// The pattern cases — a domain word sitting between level and "product".
want("Principal AI Product Manager", true);
want("Principal Product Manager, Observability", true);
want("Group Product Manager, Data Platform", true);
want("Director, Product — Cloud Infrastructure", true);

console.log("\nSenior-level titles — in scope only with platform scope");
want("Senior Product Manager, Platform", true);
want("Senior Product Manager, Observability", true);
want("Sr. Product Manager, Developer Experience", true);
want("Senior Product Manager, ML Infrastructure", true);
want("Senior Product Manager, Kubernetes", true);
want("Senior Product Manager, Growth", false);
want("Senior Product Manager, Billing", false);
want("Sr Product Manager, Retail Checkout", false);
// …unless the source is one where any senior PM role is worth surfacing.
want("Senior Product Manager, Growth", true, { broad: true });

console.log("\nBare and junior titles — out of scope");
want("Product Manager", false);
want("Product Manager II", false);
want("Associate Product Manager", false);
want("Product Manager, Platform", false);

console.log("\nNon-PM roles that contain 'product' — out of scope");
want("Director of Product Marketing", false);
want("Principal Product Marketing Manager", false);
want("Director of Product Engineering", false);
want("Senior Product Designer", false);
want("Product Analyst", false);
want("Director, Product Security", false);
want("Senior Technical Product Owner", false);
want("VP of Engineering", false);
want("Director of Sales", false);

console.log("\n'developer' must NOT be an exclusion — these are target roles");
want("Director of Product, Developer Platform", true);
want("VP Product, Developer Tools", true);

console.log("\nlooksLikeSeniorTitle — loose title-line detection for email cards");
for (const [line, expected] of [
  ["Director of Product Management", true],
  ["Senior Product Manager, Growth", true],   // loose: no scope rule here
  ["Datadog", false],
  ["Seattle, WA (Remote)", false],
  ["Actively recruiting", false],
  ["Product Manager", false],
]) {
  const got = looksLikeSeniorTitle(line);
  if (got === expected) { passed++; console.log(`  ✓ ${got ? "TITLE" : "not  "}  ${line}`); }
  else { failed++; failures.push(`looksLikeSeniorTitle("${line}") — expected ${expected}, got ${got}`); console.log(`  ✗ ${line}`); }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log("\nFailures:");
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
