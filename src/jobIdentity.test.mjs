/**
 * DEDUP TESTS — one role, however many sites it was posted to, is one row.
 *
 * The cases below are the real shapes the pipeline sees: a Greenhouse board
 * posting, the same role on an aggregator feed, and the same role again in a
 * LinkedIn job-alert email — three different URLs, one job.
 *
 * Run:  node src/jobIdentity.test.mjs
 */

import {
  normalizeCompany, normalizeTitle, jobIdentityKey,
  canonicalUrlKey, sourceRank, isBetterSource, dedupeBatch,
} from "./jobIdentity.js";
import { JobIndex } from "./jobIndex.js";

let passed = 0, failed = 0;
const failures = [];

function check(label, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(`${label}${detail ? " — " + detail : ""}`); console.log(`  ✗ ${label}${detail ? " — " + detail : ""}`); }
}

function same(label, a, b) {
  check(label, a === b, `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

function differs(label, a, b) {
  check(label, a !== b, `both ${JSON.stringify(a)}`);
}

// ─────────────────────────────────────────────────────────────────
console.log("\n── Company normalization");
// ─────────────────────────────────────────────────────────────────

same("board id vs display name — New Relic",   normalizeCompany("newrelic"),             normalizeCompany("New Relic"));
same("board id vs display name — Grafana",     normalizeCompany("grafanalabs"),          normalizeCompany("Grafana Labs"));
same("legal suffix on board id — Harness",     normalizeCompany("harnessinc"),           normalizeCompany("Harness"));
same("legal suffix — dbt Labs",                normalizeCompany("dbtlabsinc"),           normalizeCompany("dbt Labs, Inc."));
same("alias — Temporal",                       normalizeCompany("temporaltechnologies"), normalizeCompany("Temporal"));
same("alias — Glean",                          normalizeCompany("gleanwork"),            normalizeCompany("Glean"));
same("alias — Chronosphere",                   normalizeCompany("chronospherejobs"),     normalizeCompany("Chronosphere"));
same("alias — Monte Carlo",                    normalizeCompany("montecarlodata"),       normalizeCompany("Monte Carlo"));
same("punctuation — Fiddler AI",               normalizeCompany("fiddler-ai"),           normalizeCompany("Fiddler AI"));
same("dot domain — Honeycomb",                 normalizeCompany("honeycomb.io"),         normalizeCompany("Honeycomb"));
same("case and spacing — Sumo Logic",          normalizeCompany("sumologic"),            normalizeCompany("Sumo Logic"));
differs("distinct companies stay distinct",    normalizeCompany("Datadog"),              normalizeCompany("Databricks"));
differs("short name not chewed by suffix rule", normalizeCompany("Cisco"),               normalizeCompany("Cis"));

// ─────────────────────────────────────────────────────────────────
console.log("\n── Title normalization");
// ─────────────────────────────────────────────────────────────────

same("comma vs 'of'",       normalizeTitle("Director, Product Management"), normalizeTitle("Director of Product Management"));
same("abbreviation — Sr.",  normalizeTitle("Sr. Product Manager"),          normalizeTitle("Senior Product Manager"));
same("abbreviation — VP",   normalizeTitle("VP, Product"),                  normalizeTitle("Vice President of Product"));
same("abbreviation — GPM",  normalizeTitle("GPM, Observability"),           normalizeTitle("Group Product Manager, Observability"));
same("location suffix",     normalizeTitle("Director of Product (Remote, US)"), normalizeTitle("Director of Product"));
same("req id",              normalizeTitle("Director, Product Management #12345"), normalizeTitle("Director, Product Management"));
same("word order",          normalizeTitle("Director, Product Management — Observability"),
                            normalizeTitle("Observability Product Management Director"));
differs("seniority levels stay distinct", normalizeTitle("Director, Product"),        normalizeTitle("Senior Director, Product"));
differs("different domains stay distinct", normalizeTitle("Director, Product — Billing"), normalizeTitle("Director, Product — Observability"));

// ─────────────────────────────────────────────────────────────────
console.log("\n── URL keys");
// ─────────────────────────────────────────────────────────────────

same("LinkedIn /comm/ variant",
  canonicalUrlKey("https://www.linkedin.com/jobs/view/4123456789/"),
  canonicalUrlKey("https://linkedin.com/comm/jobs/view/4123456789?refId=abc"));
same("tracking params stripped",
  canonicalUrlKey("https://boards.greenhouse.io/datadog/jobs/1234?utm_source=remoteok"),
  canonicalUrlKey("https://boards.greenhouse.io/datadog/jobs/1234"));
same("trailing slash / host case",
  canonicalUrlKey("https://Boards.Greenhouse.io/datadog/jobs/1234/"),
  canonicalUrlKey("https://boards.greenhouse.io/datadog/jobs/1234"));
differs("different postings keep different keys",
  canonicalUrlKey("https://boards.greenhouse.io/datadog/jobs/1234"),
  canonicalUrlKey("https://boards.greenhouse.io/datadog/jobs/5678"));

// ─────────────────────────────────────────────────────────────────
console.log("\n── Source preference");
// ─────────────────────────────────────────────────────────────────

check("ATS outranks aggregator",   sourceRank("greenhouse") > sourceRank("remoteok"));
check("ATS outranks LinkedIn",     sourceRank("greenhouse") > sourceRank("linkedin_alert"));
check("LinkedIn outranks feeds",   sourceRank("linkedin_alert") > sourceRank("weworkremotely"));
check("manual outranks everything", sourceRank("manual") > sourceRank("greenhouse"));
check("isBetterSource is strict",  !isBetterSource("greenhouse", "greenhouse"));

// ─────────────────────────────────────────────────────────────────
console.log("\n── The reported bug: one role, three sites");
// ─────────────────────────────────────────────────────────────────

const THE_ROLE = [
  {
    title: "Director, Product Management — Observability",
    company: "grafanalabs",
    url: "https://boards.greenhouse.io/grafanalabs/jobs/7712345",
    source: "greenhouse",
  },
  {
    title: "Observability Product Management Director",
    company: "Grafana Labs",
    url: "https://remoteok.com/remote-jobs/998877-director-product",
    source: "remoteok",
  },
  {
    title: "Director of Product Management, Observability (Remote)",
    company: "Grafana Labs, Inc.",
    url: "https://www.linkedin.com/jobs/view/4123456789/",
    source: "linkedin_alert",
  },
];

const { unique, duplicates } = dedupeBatch(THE_ROLE);
same("three listings collapse to one", unique.length, 1);
same("two duplicates recorded", duplicates.length, 2);
same("the ATS posting is the one kept", unique[0].source, "greenhouse");

// Order independence: the aggregator copy arriving first must not win.
const reversed = dedupeBatch([...THE_ROLE].reverse());
same("still one role when the feed copy arrives first", reversed.unique.length, 1);
same("ATS posting still wins on reversed order", reversed.unique[0].source, "greenhouse");

// A genuinely different role at the same company is untouched.
const withOther = dedupeBatch([
  ...THE_ROLE,
  { title: "Group Product Manager, Billing", company: "Grafana Labs", url: "https://boards.greenhouse.io/grafanalabs/jobs/9999", source: "greenhouse" },
]);
same("a distinct role is not swallowed", withOther.unique.length, 2);

// ─────────────────────────────────────────────────────────────────
console.log("\n── Index lookup against existing rows");
// ─────────────────────────────────────────────────────────────────

const index = new JobIndex([
  { id: "row-1", title: "Director, Product Management — Observability", company: "grafanalabs",
    url: "https://boards.greenhouse.io/grafanalabs/jobs/7712345", source: "greenhouse", status: "new" },
  { id: "row-2", title: "Staff Product Manager, Pipelines", company: "Cribl",
    url: "https://boards.greenhouse.io/cribl/jobs/4455", source: "greenhouse", status: "new" },
]);

const viaLinkedIn = index.find(THE_ROLE[2]);
check("LinkedIn copy matches the existing Greenhouse row", viaLinkedIn?.row.id === "row-1", `got ${JSON.stringify(viaLinkedIn)}`);
same("matched by identity, not URL", viaLinkedIn?.reason, "identity");

const viaSameUrl = index.find({ title: "Whatever The Feed Called It", company: "", url: "https://boards.greenhouse.io/cribl/jobs/4455/?utm_source=x" });
check("same link still matches with no company", viaSameUrl?.row.id === "row-2", `got ${JSON.stringify(viaSameUrl)}`);
same("matched by url", viaSameUrl?.reason, "url");

check("an unrelated role is not a duplicate",
  index.find({ title: "VP Product, Security", company: "Cloudflare", url: "https://boards.greenhouse.io/cloudflare/jobs/1" }) === null);

// A row with no company can't be identity-matched — must not merge on title.
const noCompanyIndex = new JobIndex([
  { id: "row-3", title: "Director, Product", company: "", url: "https://example.com/a", source: "remoteok" },
]);
check("blank company never identity-matches",
  noCompanyIndex.find({ title: "Director, Product", company: "", url: "https://example.com/b" }) === null);

check("identity key is null without both halves", jobIdentityKey({ title: "Director, Product", company: "" }) === null);

// ─────────────────────────────────────────────────────────────────

// ── Generic titles are NOT identities ────────────────────────────
// The first cleanup run proposed deleting 343 rows. Most were distinct jobs:
// 22 Stripe roles, 38 Databricks roles and 30 Microsoft roles collapsed
// because each company posts many different roles under one plain title.
console.log("\nGeneric titles are not identities");

for (const [company, title] of [
  ["Stripe", "Staff Product Manager"],
  ["Microsoft", "Principal Product Manager"],
  ["Twilio", "Director, Product Management"],
  ["Oracle", "Senior Director, Product Management"],
  ["Acme", "Principal Product Manager, Technical"],
]) {
  check(`"${title}" at ${company} is url-match-only`,
    jobIdentityKey({ company, title }) === null);
}

for (const [company, title] of [
  ["Lambda", "Manager, Group Product Manager - Platform"],
  ["Snowflake", "Principal Product Manager - Snowpark"],
  ["ClickHouse", "Director of Product, ClickHouse Cloud"],
  ["grafanalabs", "Senior Product Manager, Infrastructure Observability | US | Remote"],
  ["Amazon", "Principal Product Manager - Technical, External Services, Amazon Aurora"],
]) {
  check(`"${title.slice(0, 44)}" still dedups`,
    jobIdentityKey({ company, title }) !== null);
}

// The motivating cross-post case must still collapse: same role, two sites,
// same words in a different order and with a different company spelling.
same("a scoped role still matches across sources despite word order",
  jobIdentityKey({ company: "Grafana Labs, Inc.", title: "Director, Product Management \u2014 Observability" }),
  jobIdentityKey({ company: "grafanalabs",        title: "Observability \u2014 Product Management Director" }));

// Not asserted: that "Director, Product Management \u2014 Observability" matches
// "Observability Product Director". Those differ by a real word, and making
// them match means dropping manager/management from the signature entirely \u2014
// which is how distinct roles start colliding again. Order independence is
// the guarantee; synonym-collapsing the function word is not.
same("mgmt abbreviations fold into the same signature",
  jobIdentityKey({ company: "Oracle", title: "Director, Product Mgmt \u2014 Cloud Storage" }),
  jobIdentityKey({ company: "Oracle", title: "Director, Product Management, Cloud Storage" }));

// Two DIFFERENT scoped roles at one company must stay apart.
differs("two different scoped roles at one company stay separate",
  jobIdentityKey({ company: "Stripe", title: "Staff Product Manager, Payments" }),
  jobIdentityKey({ company: "Stripe", title: "Staff Product Manager, Dashboard" }));

console.log(`\n── ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
