/**
 * BULK IMPORT TESTS
 *
 * Covers the two things that can silently lose jobs: the parser (a row that
 * fails to parse is a role that never enters the pipeline) and the import
 * loop's routing (duplicate vs insert vs score).
 *
 * The HTTP side is exercised against a localhost stub server, so these run
 * offline and never touch a real job board or Supabase.
 *
 * Run:  node src/bulkImport.test.mjs
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { parseJobRows, describeFromRow, fetchJobDescription, runBulkImport, isStubDescription } from "./bulkImport.js";

let passed = 0, failed = 0;
const failures = [];

function check(label, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(`${label}${detail ? " — " + detail : ""}`); console.log(`  ✗ ${label}${detail ? " — " + detail : ""}`); }
}

// ── Parsing ───────────────────────────────────────────────────────
console.log("\nPARSING");

const csv = readFileSync(new URL("./data/pm-job-scan-2026-08-04.csv", import.meta.url), "utf8");
const csvRows = parseJobRows(csv);
check("shipped CSV parses to 38 rows", csvRows.length === 38, `got ${csvRows.length}`);
check("quoted commas stay inside one field",
  csvRows[1].title === "Staff Product Manager, Real Time Data Analytics Platform", csvRows[1].title);
check("every row keeps its URL", csvRows.every(r => /^https:\/\//.test(r.url)));
check("unmapped columns are kept as extras", csvRows[0].extra["fit tier"] === "A");

const markdown = `
|  |  |  |  |
| :-: | :-: | :-: | :-: |
| Fit Rank | Title | Company | URL |
| 1 | Staff Product Manager \\_ Observability | Lambda | https://example.test/a |

|  |  |
| :-: | :-: |
| Board | Filter applied / finding |
| Traversal | All 13 open roles reviewed — no PM listings. |
`;
const mdRows = parseJobRows(markdown);
check("markdown table parses, trailing non-job block ignored", mdRows.length === 1, `got ${mdRows.length}`);
check("markdown escaping is stripped from cells",
  mdRows[0].title === "Staff Product Manager _ Observability", mdRows[0].title);

const tsvRows = parseJobRows("Job Title\tCompany\tLink\nStaff PM\tLambda\thttps://example.test/b");
check("TSV parses via header aliases", tsvRows.length === 1 && tsvRows[0].url === "https://example.test/b");
check("missing location defaults to Remote", tsvRows[0].location === "Remote");

const jsonRows = parseJobRows('[{"title":"Director of Product","company":"ClickHouse","url":"https://example.test/c"}]');
check("JSON array still parses (Discover-tab shape)", jsonRows.length === 1 && jsonRows[0].company === "ClickHouse");

check("empty input yields no rows", parseJobRows("").length === 0);
check("headerless text yields no rows", parseJobRows("just some notes\nabout jobs").length === 0);
check("stub description names the role", describeFromRow(csvRows[0]).includes("Lambda"));

// ── JD fetch ──────────────────────────────────────────────────────
console.log("\nJD FETCH");

const longBody = "Responsibilities: own the observability platform roadmap. ".repeat(20);
let throttleHits = 0;
const server = createServer((req, res) => {
  if (req.url === "/throttled") {
    // 429 on the first ask, the posting on the second — what Confluent does
    // when a run hits six of its listings back to back.
    throttleHits++;
    if (throttleHits === 1) {
      res.writeHead(429, { "Retry-After": "1" });
      res.end("slow down");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<html><body><p>${longBody}</p></body></html>`);
  } else if (req.url === "/always429") {
    res.writeHead(429, { "Retry-After": "1" });
    res.end("slow down");
  } else if (req.url === "/full") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<html><head><style>.x{}</style><script>var a=1</script></head><body><h1>Role</h1><ul><li>${longBody}</li></ul></body></html>`);
  } else if (req.url === "/shell") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body><div id=root></div></body></html>");
  } else {
    res.writeHead(404); res.end("nope");
  }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const fullJd = await fetchJobDescription(`${base}/full`);
check("HTML posting is fetched and de-tagged", fullJd.includes("observability platform roadmap"));
check("script and style content is dropped", !fullJd.includes("var a=1") && !fullJd.includes(".x{}"));
check("JS shell page is treated as no JD", (await fetchJobDescription(`${base}/shell`)) === "");

const retried = await fetchJobDescription(`${base}/throttled`);
check("a 429 is retried and the posting recovered", retried.includes("observability platform roadmap"));
check("the retry honoured Retry-After rather than giving up", throttleHits === 2, `hits: ${throttleHits}`);
check("a board that only ever 429s gives up and returns no JD",
  (await fetchJobDescription(`${base}/always429`)) === "");
check("404 is treated as no JD", (await fetchJobDescription(`${base}/missing`)) === "");
check("empty URL is treated as no JD", (await fetchJobDescription("")) === "");

// ── Import pipeline ───────────────────────────────────────────────
console.log("\nIMPORT PIPELINE");

// Minimal stand-in for the Supabase client: supports the exact call shapes
// loadJobIndex(), refetchStubRow() and insertJob() use, and records what was
// written. loadJobIndex pages with .order().range(), so those resolve to the
// whole row set; the id/url lookups still resolve through .limit().
function fakeSupabase(existing = []) {
  // `existing` may be plain URLs or full rows — a row lets a test control the
  // description, which is what the --refetch path keys off.
  const rows = existing.map((e, i) => (typeof e === "string" ? { id: `row-${i}`, url: e } : { id: `row-${i}`, ...e }));
  const inserted = [];
  const updates  = [];
  return {
    inserted,
    updates,
    from() {
      const q = {
        _url: null,
        _id: null,
        select() { return q; },
        eq(col, val) {
          if (col === "url") q._url = val;
          if (col === "id")  q._id  = val;
          return q;
        },
        ilike(_col, pattern) { q._url = pattern.replace(/%/g, ""); return q; },
        order() { return q; },
        // First page returns everything, later pages are empty so paging stops.
        range(from) { return Promise.resolve({ data: from === 0 ? rows : [], error: null }); },
        limit() {
          const hits = q._id
            ? rows.filter(r => r.id === q._id)
            : rows.filter(r => q._url && r.url.includes(q._url));
          return Promise.resolve({ data: hits, error: null });
        },
        insert(row) {
          inserted.push(row);
          return { select: () => ({ single: () => Promise.resolve({ data: { id: `id-${inserted.length}`, ...row }, error: null }) }) };
        },
        update(fields) {
          updates.push(fields);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
      return q;
    },
  };
}

const rows = [
  { title: "Staff Product Manager, Observability", company: "Lambda",  location: "Bellevue, WA", url: `${base}/full`,  description: "", extra: { "fit tier": "A" } },
  { title: "Principal Product Manager",            company: "ClickHouse", location: "US (remote)", url: `${base}/shell`, description: "", extra: {} },
  { title: "Director of Product",                  company: "Dupe Co",  location: "Remote",      url: "https://example.test/dupe", description: "", extra: {} },
  { title: "Senior Product Manager",               company: "Elsewhere", location: "London, United Kingdom", url: "https://example.test/uk", description: "", extra: {} },
];

const db = fakeSupabase(["https://example.test/dupe"]);
const result = await runBulkImport(db, null, rows, { source: "manual" });

check("duplicate row is skipped, not re-inserted",
  result.results.find(r => r.company === "Dupe Co").status === "duplicate");
check("non-US row is filtered",
  result.results.find(r => r.company === "Elsewhere").status === "filtered");
check("two rows imported", result.imported === 2, `got ${result.imported}`);
check("nothing scored without an API key", result.evaluated === 0);
check("fetched JD is written to the row", db.inserted[0].description.includes("observability platform roadmap"));
check("row with no reachable JD falls back to a stub",
  db.inserted[1].description.includes("No job description retrieved"));
check("source column is set", db.inserted.every(r => r.source === "manual"));
check("status starts at new", db.inserted.every(r => r.status === "new"));

const dryDb = fakeSupabase();
const dry = await runBulkImport(dryDb, null, rows.slice(0, 1), { dryRun: true });
check("dry run writes nothing", dryDb.inserted.length === 0 && dry.imported === 1);

// ── Backfilling stubs (--refetch) ─────────────────────────────────
console.log("\nREFETCH");

check("a stub is recognised", isStubDescription(describeFromRow(csvRows[0])));
check("a real posting is not", !isStubDescription("Responsibilities: own the roadmap…"));
check("an empty description counts as a stub", isStubDescription(""));

const stubRow = [{ title: "Staff PM", company: "Lambda", location: "Remote", url: `${base}/full`, description: "", extra: {} }];

const stubDb = fakeSupabase([{ url: `${base}/full`, description: describeFromRow(stubRow[0]) }]);
const backfill = await runBulkImport(stubDb, null, stubRow, { refetchStubs: true });
check("a stubbed row in the pipeline is backfilled, not skipped",
  backfill.refetched === 1 && backfill.results[0].status === "refetched");
check("the backfill writes the real JD to the existing row",
  stubDb.updates.some(u => u.description?.includes("observability platform roadmap")));
check("the backfill updates rather than inserting a second row", stubDb.inserted.length === 0);

const realDb = fakeSupabase([{ url: `${base}/full`, description: "A job description I pasted by hand, at length." }]);
const noClobber = await runBulkImport(realDb, null, stubRow, { refetchStubs: true });
check("a row that already has a real JD is left alone",
  realDb.updates.length === 0 && noClobber.results[0].detail === "already has a real JD");

const unreachableDb = fakeSupabase([{ url: `${base}/shell`, description: describeFromRow(stubRow[0]) }]);
const stillStub = await runBulkImport(unreachableDb, null,
  [{ ...stubRow[0], url: `${base}/shell` }], { refetchStubs: true });
check("a row whose board still won't answer keeps its stub",
  unreachableDb.updates.length === 0 && stillStub.results[0].detail === "still no JD available");

const dryRefetchDb = fakeSupabase([{ url: `${base}/full`, description: describeFromRow(stubRow[0]) }]);
await runBulkImport(dryRefetchDb, null, stubRow, { refetchStubs: true, dryRun: true });
check("a dry-run backfill writes nothing", dryRefetchDb.updates.length === 0);

check("without --refetch a stubbed duplicate is still skipped",
  (await runBulkImport(fakeSupabase([{ url: `${base}/full`, description: describeFromRow(stubRow[0]) }]), null, stubRow, {}))
    .results[0].status === "duplicate");

const filtered = await runBulkImport(fakeSupabase(), null,
  [{ title: "Product Marketing Manager", company: "X", location: "Remote", url: "https://example.test/pmm", extra: {} }],
  { applyTitleFilter: true });
check("title filter drops non-PM titles when enabled",
  filtered.results[0].status === "filtered" && filtered.imported === 0);

// ── Identity dedup ────────────────────────────────────────────────
// The reason this path exists at all. A curated list is collected by hand
// from LinkedIn, an aggregator or a search result, so the same role arrives
// under a link that shares nothing with the ATS URL already in the table.
// URL-only dedup let every one of those through as a second row.
console.log("\nIDENTITY DEDUP");

const crossPosted = [{
  title: "Staff Product Manager, Observability", company: "Lambda",
  location: "Bellevue, WA", url: "https://linkedin.test/jobs/view/12345", extra: {},
}];

const identityDb = fakeSupabase([{
  title: "Staff Product Manager, Observability", company: "Lambda Labs",
  url: "https://jobs.ashbyhq.com/lambda/abc-123", source: "ashby", status: "new",
}]);
const identityRun = await runBulkImport(identityDb, null, crossPosted, { source: "manual" });
check("same role under a different site's URL is caught by identity",
  identityRun.results[0].status === "duplicate" && identityDb.inserted.length === 0,
  `status ${identityRun.results[0].status}, inserted ${identityDb.inserted.length}`);
check("the identity match says so rather than claiming the same listing",
  /another site/.test(identityRun.results[0].detail || ""), identityRun.results[0].detail);

const upgradeDb = fakeSupabase([{
  title: "Director of Product, Platform", company: "Crusoe",
  url: "https://remoteok.test/l/999", source: "remoteok", status: "new",
}]);
await runBulkImport(upgradeDb, null, [{
  title: "Director of Product, Platform", company: "Crusoe",
  location: "Remote", url: "https://crusoe.test/careers/dir-platform", extra: {},
}], { source: "manual" });
check("a hand-curated row repoints an aggregator link at the better URL",
  upgradeDb.updates.some(u => u.source === "manual" && /crusoe\.test/.test(u.url || "")),
  JSON.stringify(upgradeDb.updates));

const dryUpgradeDb = fakeSupabase([{
  title: "Director of Product, Platform", company: "Crusoe",
  url: "https://remoteok.test/l/999", source: "remoteok", status: "new",
}]);
await runBulkImport(dryUpgradeDb, null, [{
  title: "Director of Product, Platform", company: "Crusoe",
  location: "Remote", url: "https://crusoe.test/careers/dir-platform", extra: {},
}], { source: "manual", dryRun: true });
check("a dry run upgrades nothing", dryUpgradeDb.updates.length === 0);

const twiceDb = fakeSupabase();
const twice = await runBulkImport(twiceDb, null, [
  { title: "Group Product Manager, Infrastructure", company: "Nebius", location: "Remote", url: `${base}/full`,       extra: {} },
  { title: "Group Product Manager, Infrastructure", company: "Nebius", location: "Remote", url: "https://nebius.test/2", extra: {} },
], { source: "manual" });
check("the same role listed twice in one file inserts once",
  twiceDb.inserted.length === 1 && twice.imported === 1,
  `inserted ${twiceDb.inserted.length}, imported ${twice.imported}`);

server.close();

// ── Summary ───────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log("\nFailures:");
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
