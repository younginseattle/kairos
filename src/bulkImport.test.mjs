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
import { parseJobRows, describeFromRow, fetchJobDescription, runBulkImport } from "./bulkImport.js";

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
const server = createServer((req, res) => {
  if (req.url === "/full") {
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
check("404 is treated as no JD", (await fetchJobDescription(`${base}/missing`)) === "");
check("empty URL is treated as no JD", (await fetchJobDescription("")) === "");

// ── Import pipeline ───────────────────────────────────────────────
console.log("\nIMPORT PIPELINE");

// Minimal stand-in for the Supabase client: supports the exact call shapes
// isDuplicateJob() and insertJob() use, and records what was written.
function fakeSupabase(existingUrls = []) {
  const inserted = [];
  const client = {
    inserted,
    from() {
      const q = {
        _url: null,
        select() { return q; },
        eq(col, val) { if (col === "url") q._url = val; return q; },
        ilike(_col, pattern) { q._url = pattern.replace(/%/g, ""); return q; },
        limit() {
          const hit = existingUrls.some(u => q._url && u.includes(q._url));
          return Promise.resolve({ data: hit ? [{ id: "existing" }] : [], error: null });
        },
        insert(row) {
          inserted.push(row);
          return { select: () => ({ single: () => Promise.resolve({ data: { id: `id-${inserted.length}`, ...row }, error: null }) }) };
        },
        update() { return { eq: () => Promise.resolve({ error: null }) }; },
      };
      return q;
    },
  };
  return client;
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

const filtered = await runBulkImport(fakeSupabase(), null,
  [{ title: "Product Marketing Manager", company: "X", location: "Remote", url: "https://example.test/pmm", extra: {} }],
  { applyTitleFilter: true });
check("title filter drops non-PM titles when enabled",
  filtered.results[0].status === "filtered" && filtered.imported === 0);

server.close();

// ── Summary ───────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log("\nFailures:");
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
