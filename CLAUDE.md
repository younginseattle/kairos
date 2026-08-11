# CLAUDE.md — Kairos Project Context

This file gives Claude Code persistent context about the Kairos codebase. Read this before making any changes.

---

## What This Project Is

Kairos is a personal job search intelligence tool for Matt Young — a VP/Director-level Product leader targeting Platform, Infrastructure, Observability, and AI/ML companies. It is a single-user app, not a SaaS product.

The app automates job discovery, AI-powered fit scoring, and resume tailoring. It runs locally via Vite and connects to Supabase for persistence and the Anthropic API for AI features.

---

## Architecture

```
React frontend (Vite)
  └── App.jsx              ← All UI and state. Single-file React app (~1500 lines).
  └── ingestion.js         ← Job pipeline logic (fetch, filter, normalize, score, insert)
  └── run-ingestion.mjs    ← Node CLI script for running ingestion
  └── run-briefing.mjs     ← Node CLI script for generating daily markdown briefing
  └── supabaseClient.js    ← Supabase client singleton

Supabase (PostgreSQL)
  └── jobs table           ← All discovered and manually entered jobs

Anthropic API
  └── claude-sonnet-4-20250514   ← Used for fit evaluation, tailoring, search plan, briefing
```

---

## Key Files

### `src/App.jsx`
The entire frontend. Four tabs: Discover, Evaluate, Saved, Tailor.

- **Discover tab** — triggers ingestion, shows today's top jobs from Supabase, displays auto-eval scores
- **Evaluate tab** — manual JD paste → Claude fit scoring → save to Supabase
- **Saved tab** — full pipeline view with status management and bulk re-evaluation
- **Tailor tab** — resume tailoring against a specific job description

Important patterns:
- Design tokens are defined in the `T` object at the top of the file
- All Claude API calls go through `fetch("https://api.anthropic.com/v1/messages", ...)` directly from the browser
- The Anthropic API key is stored in React state (`anthropicKey`) and persisted to `localStorage` — it is entered by the user in the Settings panel
- Supabase client is imported from `supabaseClient.js`

### `src/ingestion.js`
The job ingestion pipeline. Importable as a module.

Key exports:
- `SOURCES` — array of all target companies with ATS type and domain
- `isRelevantJob(job, source)` — title filter; delegates to `src/titleFilter.js`
- `fetchSourceJobs(source)` — fetch one board, errors propagate (used by the verifier)
- `normalizeJob(job)` — maps raw job to Supabase schema
- `isDuplicateJob(supabaseClient, url)` — URL-only check for one-off callers; does NOT catch cross-posted roles
- `insertJob(supabaseClient, job)` — insert to Supabase
- `runJobIngestion(supabaseClient, anthropicApiKey, candidateProfile)` — full pipeline

### `src/jobIdentity.js` + `src/jobIndex.js`
Deduplication. A single role is routinely posted to the company's own ATS board, an
aggregator feed, and a LinkedIn job alert — three different URLs, so URL matching alone
put the same job in the pipeline three times.

- `jobIdentity.js` (pure, no imports — also loaded by `scripts/`): `normalizeCompany`,
  `normalizeTitle`, `jobIdentityKey` (company + title, source-independent),
  `canonicalUrlKey`, `sourceRank` / `isBetterSource`, `dedupeBatch`
- `jobIndex.js`: `loadJobIndex(supabaseClient)` builds an index of the existing pipeline
  keyed by both URL and identity; `index.find(job)` is the real dedup check.
  `upgradeExistingJob` repoints an existing row at a more authoritative link instead of
  inserting a second row.

Source authority, highest first: `manual` → own ATS (`greenhouse`/`lever`/`ashby`/`rippling`)
→ `linkedin_alert` → aggregators (`remoteok`/`weworkremotely`). Automation never overwrites
a manual row.

Every insert path goes through this: `ingestion.js`, `scripts/fetch-jobs.js`, and the
three App.jsx save paths (quick score, autoeval save, manual Evaluate save).
Tests: `node src/jobIdentity.test.mjs`.

Rows created before this existed are cleaned up with
`node --env-file=.env scripts/dedupe-existing-jobs.mjs` (dry run; `--apply` to write).
Supported `ats` values: `greenhouse`, `lever`, `ashby`, `rippling`, `smartrecruiters`,
`workable`, `amazon`, `remoteok`, `weworkremotely`.

### `src/titleFilter.js`
The single definition of which job titles are in scope, shared by `ingestion.js`,
`scripts/fetch-jobs.js` and `scripts/scan-google-jobs.mjs` — these three had drifted
into three different filters, so the same role was caught or dropped depending on
which pipeline saw it.

Rules:
- Lead-level titles (Director / VP / Head / Group / Principal / Staff) are in scope on level alone
- Senior / Sr titles are in scope **only** with platform-infra-observability-AI-dev scope in the title, or when the source sets `broadFilter`
- A bare "Product Manager" with no seniority modifier is never in scope
- `developer` is deliberately not an exclusion keyword — "Director of Product, Developer Platform" is a target role

Pinned by `src/titleFilter.test.mjs` (`node src/titleFilter.test.mjs`).

### `src/candidateSources.js`
Staging area for **unverified** board IDs. `SOURCES` stays a verified list; guesses
go here, get probed by `scripts/verify-boards.mjs`, and only confirmed entries are
promoted. A wrong board token and a company with public API access disabled both
return 404, so guessing directly into `SOURCES` silently rots it.

### `scripts/verify-boards.mjs`
Probes every candidate board and prints paste-ready `SOURCES` lines for the ones
that respond. **Run it in GitHub Actions** (`Verify Job Boards` → workflow_dispatch),
not in a dev sandbox — sandbox egress proxies block the ATS hosts and every board
looks dead.

### `scripts/import-jobs-csv.mjs`
One-off importer for hand-collected job rows (CSV/TSV; export an .xlsx to CSV first).
Fetches each JD from its URL, then runs the same normalize → dedupe → insert →
evaluate path as the pipeline. For boards that cannot be polled — anything reachable
belongs in `SOURCES` instead.

```bash
node --env-file=.env scripts/import-jobs-csv.mjs jobs.csv --dry-run
```

### `src/run-ingestion.mjs`
Node.js script. Reads env from `.env` file. Calls `runJobIngestion`. Run as:
```bash
node --env-file=.env src/run-ingestion.mjs
```

### Rescoring existing rows
Two paths, and the difference is money:

- `scripts/recompute-scores.mjs` — replays `scoring.js` / `companyFacts.js` changes
  over stored extractions. **Free, no Claude calls.** Only reaches rows that have a
  `fit_detail.extraction`. Add `--restore-passed` to un-hide rows the legacy `<55`
  rule buried that the current structural rule would not hide.
- `scripts/rescore-jobs.mjs` — re-reads each JD with Claude. **One call per row.**
  The only way to pick up changes to `fitPrompt.js` or the signal vocabulary.
  Narrow the selection first: `--plan` (costs nothing) then `--stale-signals`,
  `--missing-extraction`, `--company=`, `--limit=`.

`--dry-run` on rescore-jobs still calls Claude — only the write is skipped. Use
`--plan` to spend nothing. Which rows are stale is decided by `src/staleSignals.js`,
pinned by `src/staleSignals.test.mjs`.

Both have workflow_dispatch workflows (`Recompute Fit Scores`, `Rescore Jobs`).
**Both default to the repo's default branch** — pick the working branch in the
Run workflow dropdown, or the run replays the old model and nothing moves.

### `src/bulkImport.js`
Bulk import of a curated list of jobs (a spreadsheet export, a scan result, a pasted table).

Reuses the back half of `ingestion.js` — `normalizeJob`, `insertJob`, `runClaudeEvaluation`,
`shouldAutoPass` — plus `jobIndex.js` for dedup, so imported rows dedup and score exactly
like ATS and LinkedIn jobs. Only the front half differs: rows come from a file instead of
an ATS API.

Key exports:
- `parseJobRows(text)` — CSV, TSV, markdown table, or JSON array → row objects. Needs a
  header row naming a title column and a url column; unrecognized columns are kept and
  folded into the fallback description.
- `fetchJobDescription(url)` — best-effort JD retrieval (Greenhouse and Ashby board APIs,
  generic HTML strip otherwise). Returns `""` on failure. Ashby is tried for any URL
  carrying a UUID, not just `ashbyhq.com` ones — Confluent serves an Ashby board from
  `careers.confluent.io` and 429s every scrape of it, while the API answers fine.
- `isStubDescription(text)` — true when a row holds a metadata stub rather than a real posting.
- `runBulkImport(supabase, anthropicKey, rows, opts)` — dedup → insert → score → auto-pass.

Dedup goes through `loadJobIndex` / `index.find`, not `isDuplicateJob`. A curated list is
the case URL-only matching fails hardest: rows are collected by hand from LinkedIn, an
aggregator or a search result, so the same role arrives under a link sharing nothing with
the ATS URL already in the table. A hand-curated row also outranks an aggregator one, so a
duplicate repoints the existing row at the better link rather than being silently dropped.

The ATS title filter is **off** by default here: curated rows are already vetted, and the
filter drops anything containing "security" and every "Sr." that isn't spelled "Senior".
Pass `applyTitleFilter: true` (CLI `--filter`) for an untrusted list.

### `src/run-bulk-import.mjs`
Node CLI for the above. Run as:
```bash
node --env-file=.env src/run-bulk-import.mjs src/data/pm-job-scan-2026-08-04.csv
```
Flags: `--dry-run` `--no-fetch` `--no-score` `--filter` `--refetch` `--source=NAME`

`--refetch` backfills rows already in the pipeline that are still carrying a stub: it
fetches the posting, writes it to the existing row, and rescores. Rows with a real
description are never overwritten — a hand-pasted JD outranks anything a scraper returns.
Use it after a board that was down or throttling starts answering.

The same parser backs the Discover tab's import box, so a table can be pasted straight into
the app. Note the split with `scripts/import-jobs-csv.mjs`: that one is a standalone CLI
for a file on disk, this one is the shared module the browser also loads.

Tests: `node src/bulkImport.test.mjs` (offline — HTTP is stubbed on localhost).

### `src/run-briefing.mjs`
Node.js script. Queries Supabase for last 24h jobs. Writes markdown briefing to `~/Desktop`. Run as:
```bash
node --env-file=.env src/run-briefing.mjs
```

---

## Supabase Schema — `jobs` table

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Auto-generated |
| `created_at` | timestamptz | Set at insert time |
| `title` | text | Job title |
| `company` | text | Company name |
| `url` | text | ATS listing URL (used for dedup) |
| `location` | text | Raw location string |
| `description` | text | Full job description |
| `source` | text | `greenhouse`, `lever`, `manual`, `linkedin_alert` |
| `status` | text | `new`, `reviewing`, `applied`, `interviewing`, `offer`, `pass` |
| `score` | integer | Overall fit score 0–100 |
| `recommendation` | text | `apply`, `apply_with_note`, `stretch`, `skip` |
| `strengths` | text[] | Array of strength strings |
| `gaps` | text[] | Array of gap strings |
| `quick_wins` | text[] | Array of quick win strings |
| `verdict` | text | 2–3 sentence assessment |
| `skills_match` | integer | 0–100 |
| `experience_match` | integer | 0–100 |
| `culture_match` | integer | 0–100 |
| `compensation_score` | integer | 0–100 |
| `work_life_balance_score` | integer | 0–100 |
| `growth_score` | integer | 0–100 |
| `location_score` | integer | 0–100 |
| `company_score` | integer | 0–100 |
| `confidence_score` | integer | 0–100 |
| `missing_keywords` | text[] | Keywords in JD not in resume |
| `strategic_gaps` | text[] | Real gaps that could weaken candidacy |
| `score_explanation` | jsonb | `{ key_factor, strengths[], weaknesses[] }` |
| `top_candidate_signal` | jsonb | `{ level: "HIGH|MEDIUM|LOW", reason }` |

---

## Candidate Profile

Matt Young — VP/Director-level Product leader.
- **Target domains:** Observability, infrastructure, platform SaaS, AI/ML tooling
- **Location:** Seattle, WA — no relocation. Remote-first preferred.
- **Experience:** 10+ years, comfortable at Director/VP level
- **Platform fluency:** Working Kubernetes knowledge — Helm chart authorship and operator
  patterns. This is a strength, not a gap; it is a proof point (`k8s_platform`), and the
  old `k8s_operators` gap key was retired on 2026-08-06.
- **Scoring bias:** Do not penalize for "overqualified" at Director level

The full candidate profile string is defined inside `ingestion.js` as `candidateProfile` and inside `App.jsx` as `profile`.

---

## Target Companies

### Observability / Monitoring (tier 1 priority)
Datadog, Elastic, New Relic, PagerDuty, Grafana Labs, Honeycomb, Sumo Logic, Cribl, Kentik,
Arize AI, Fiddler AI, Observe Inc, Galileo AI, Braintrust

### AI / ML Platforms
Anthropic, Databricks, Glean, Scale AI

### Infrastructure / Cloud / DevTools
Cloudflare, CoreWeave, Temporal, LaunchDarkly, Vercel, Postman, Harness, Fastly, Fivetran, Twilio, MongoDB, Stripe, GitLab, Smartsheet, Samsara

Removed from `SOURCES` — see `RETIRED_SOURCES` in `src/candidateSources.js` before adding either back:
**dbt Labs** (board token 404s as of 2026-08-10) and **Chronosphere** (acquired).

### Defense Tech
Epirus (others — Anduril, Palantir, etc. — have locked Greenhouse boards)

---

## Scoring Rules (do not change without discussion)

- Score below 60 = level mismatch, wrong domain, or bad location
- Score 65–75 = data platforms, developer tools, cloud-native SaaS
- Score 75+ = observability, distributed telemetry, AI/ML platforms, agentic infra
- Remote = location score 95–100; Seattle/WA hybrid = 80–90; requires relocation = 10–30
- Startup "fast-paced" / "wear many hats" language → work_life_balance_score 50–69
- On-call required → work_life_balance_score 30–49

---

## Claude API Usage

Model: `claude-sonnet-4-20250514`
Max tokens: 1000 (evaluation), 4000 (tailoring)

All prompts are defined as constants in their respective files:
- `FIT_PROMPT` in `ingestion.js` and `App.jsx` (keep in sync)
- `TAILOR_PROMPT` in `App.jsx`
- `SEARCH_PLAN_PROMPT` in `App.jsx`

All prompts return **raw JSON only** — no markdown fences, no preamble. Parse with `JSON.parse()` after stripping any accidental backtick fences.

---

## Environment Variables

```env
VITE_SUPABASE_URL=          # Supabase project URL
VITE_SUPABASE_ANON_KEY=     # Supabase anon key
ANTHROPIC_API_KEY=          # Used by Node scripts only
```

The Anthropic key in the browser app is entered by the user at runtime via the Settings panel — it is stored in `localStorage` under `jsa_anthropic_key`.

---

## Development Notes

- `npm run dev` starts the Vite dev server at `http://localhost:5173`
- `npm run build` produces a production build in `/dist`
- No TypeScript — plain JavaScript/JSX throughout
- No CSS modules — all styles are inline via the `T` design token object
- No component library — custom UI only
- FAANG companies are not accessible via Greenhouse/Lever — they use Workday. Do not guess ATS
  board tokens for them. Two exceptions have working non-ATS paths: **Amazon/AWS** via the public
  `amazon.jobs/search.json` endpoint (the `amazon` ats type — its `id` is the search query, not a
  board token), and **Google** via Careers alert emails in `scripts/scan-google-jobs.mjs`.

---

## What NOT to Change Without Asking

- The `FIT_PROMPT` scoring rules and schema — these are calibrated to Matt's profile
- The `SOURCES` list — each entry has been verified against live ATS APIs
- The `T` design token object — the visual identity is intentional
- Supabase column names — changing them requires a migration
