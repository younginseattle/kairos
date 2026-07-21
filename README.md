# Kairos — AI-Powered Job Search Agent

> VP / Director-level · Platform, Infrastructure, Observability, AI

Kairos is a personal job search intelligence tool built for senior Product leaders. It automates discovery, scoring, and resume tailoring across dozens of target companies — so you spend time on the roles worth pursuing, not sifting through noise.

---

## What It Does

**Discover** — Automatically pulls new PM roles from Greenhouse and Ashby ATS boards across 38 target companies (Datadog, Elastic, Grafana, Anthropic, Confluent, Pinecone, etc.), plus RemoteOK and We Work Remotely aggregator feeds for companies outside the hand-curated list — filters for Director/VP/Staff/Group/Principal PM titles, deduplicates, and stores them in Supabase. Also ingests LinkedIn job alert emails from Gmail (parsed from each email's HTML structure, with a plaintext fallback) and Google Careers job alert emails, automatically.

**Evaluate** — Paste any job description and Claude scores it across 8 dimensions: overall fit, skills match, experience match, culture, compensation, work/life balance, growth, and location. Outputs a structured verdict with strengths, gaps, and a recommendation (`apply` / `apply_with_note` / `stretch` / `skip`).

**Pipeline** — Full pipeline view of all scored roles with status tracking (`new → reviewing → applied → interviewing → offer → rejected / pass / closed`). Supports bulk re-evaluation, persistent pass/delete, low-confidence filtering, contact logging, and inline JD re-scoring.

**Tailor** — Generates a role-specific resume tailored to the job description, with keyword matching, language transformations, and section relevance scoring. Exports as formatted plain text.

**Report** — Job search log formatted for WA unemployment audit requirements. Shows every applied, interviewing, offer, and rejected role with dates, company, title, and status. Supports contact sub-rows (meeting dates, names, notes) and exports as CSV or plain text.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite |
| Database | Supabase (PostgreSQL) |
| AI | Anthropic Claude (`claude-sonnet-4-20250514`) |
| Job sources | Greenhouse + Ashby APIs, RemoteOK + We Work Remotely aggregators, Gmail (LinkedIn alerts, HTML-parsed), Google Careers email scan |
| Automation | GitHub Actions (4 pipelines), Node.js scripts |

---

## Project Structure

```
kairos/
├── src/
│   ├── App.jsx              # Main React app — all tabs + report + contact logging
│   ├── ingestion.js         # Job fetch → filter → normalize → score pipeline
│   ├── run-ingestion.mjs    # Node script: runs full ingestion pipeline
│   ├── run-briefing.mjs     # Node script: generates daily markdown briefing
│   ├── supabaseClient.js    # Supabase client init
│   └── main.jsx             # React entry point
├── scripts/
│   ├── fetch-jobs.js          # Gmail alert fetcher — LinkedIn alerts, HTML-parsed via cheerio (GitHub Actions)
│   ├── scan-google-jobs.mjs   # Google Careers email scanner (GitHub Actions)
│   ├── check-linkedin-jobs.mjs # Marks pipeline jobs closed once the LinkedIn posting expires (GitHub Actions)
│   ├── get-gmail-token.js     # One-time OAuth helper to get Gmail refresh token
│   └── package.json           # Script dependencies
├── .github/workflows/
│   ├── Discover_Jobs.yml      # ATS + aggregator ingestion twice daily (6am + 6pm UTC)
│   ├── fetch-jobs.yml         # LinkedIn Gmail alerts every 6 hours
│   ├── scan-google-jobs.yml   # Google Careers emails Mon + Thu at 9am UTC
│   └── check-linkedin-jobs.yml # Daily check for closed/expired LinkedIn postings
├── public/
│   └── autoeval.html        # Standalone auto-evaluator (no scraping required)
├── index.html
├── vite.config.js
└── .env                     # Local env vars (not committed)
```

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/myoung76/kairos.git
cd kairos
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
ANTHROPIC_API_KEY=sk-ant-...
```

> The `VITE_` prefix is required for variables used in the browser (Vite convention). `ANTHROPIC_API_KEY` is used by the Node.js scripts only. The Anthropic key for the browser app is entered at runtime in the Settings panel and stored in `localStorage`.

### 3. Run the Supabase migrations

Run these in the Supabase SQL Editor to enable all features:

```sql
-- Contact logging (for unemployment audit tracking)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS contacts jsonb DEFAULT '[]'::jsonb;

-- Application date tracking
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS applied_at timestamptz;
```

### 4. Run the dev server

```bash
npm run dev
```

The app runs at `http://localhost:5173`.

---

## GitHub Actions Automation

Four pipelines run automatically — no manual steps required after initial setup.

### Discover Jobs (`Discover_Jobs.yml`)
Runs the full ATS ingestion pipeline twice daily (6am and 6pm UTC). Fetches jobs from all 40 sources — 31 Greenhouse companies, 7 Ashby companies, and 2 aggregator feeds (RemoteOK, We Work Remotely) — filters for relevant roles, auto-scores with Claude, and inserts new ones into Supabase. Roles scoring below 55 are automatically passed.

Lever and Rippling fetchers exist in `ingestion.js` but currently have zero active sources: Lever was never populated, and the one Rippling candidate (Galileo) returned a 404 from its public API despite a live, browsable careers page — dropped rather than guessed a third time. See the comments in `SOURCES` for the specific companies that were tried and rejected (public API disabled server-side) versus never attempted.

**Required GitHub secrets:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`

### Fetch LinkedIn Alerts (`fetch-jobs.yml`)
Runs every 6 hours. Reads LinkedIn job alert emails from Gmail using native OAuth (no `googleapis` dependency), and parses each job card from the email's **HTML** structure via `cheerio` — anchoring on real DOM boundaries (logo image + title link per card) instead of guessing field order from plaintext line position. Falls back to the old plaintext heuristic only if an email has no HTML part, or HTML parsing finds zero cards. Filters out aggregator sites (The Ladders, ZipRecruiter, etc.) and non-US roles, deduplicates against Supabase, and inserts new roles with `source: linkedin_alert`.

Supports manual backfill via `workflow_dispatch` with a configurable `hours` lookback window, and a `verbose` flag that logs every parsed job and filter decision.

**Required GitHub secrets:** `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

### Scan Google Careers (`scan-google-jobs.yml`)
Runs every Monday and Thursday at 9am UTC. Reads Google Careers job alert emails directly, parses listings, filters for Director/VP/Staff/Group/Principal PM titles in US locations, and inserts matched roles with `source: google_alert`. This is a separate mechanism from LinkedIn alert parsing above — it targets Google's own job postings specifically, since Google uses Workday and isn't reachable via the Greenhouse/Ashby APIs.

Supports `--dry-run` and `--days=N` options via `workflow_dispatch`.

**Required GitHub secrets:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

### Check LinkedIn Job Status (`check-linkedin-jobs.yml`)
Runs daily at 8am UTC, after the overnight `Discover Jobs` run. Checks every active LinkedIn-sourced job in the pipeline against its live posting and marks it `closed` in Supabase once the listing has expired or been taken down, so the pipeline view doesn't accumulate dead postings.

Supports a `dry_run` flag via `workflow_dispatch` to report findings without writing to Supabase.

**Required GitHub secrets:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

To generate OAuth tokens for Gmail/Google Careers:
```bash
cd scripts
npm install
GMAIL_CLIENT_ID=xxx GMAIL_CLIENT_SECRET=xxx node get-gmail-token.js
```

---

## Running Ingestion Manually

```bash
node --env-file=.env src/run-ingestion.mjs
```

---

## Running the Daily Briefing

Generates a markdown briefing file to `~/Desktop` summarizing new roles scored in the last 24 hours, grouped by priority tier.

```bash
node --env-file=.env src/run-briefing.mjs
```

Recommended: run 15 minutes after ingestion.

---

## Pipeline Features

### Status Tracking
Jobs move through: `new → reviewing → applied → interviewing → offer → rejected / pass / closed`. Marking a job as `rejected` or `closed` auto-hides it from the pipeline view while keeping it in the report.

### Persistent Pass & Delete
Jobs can be permanently passed (`status: pass`) or deleted from the database. Passed jobs are hidden from the pipeline by default with an option to restore them.

### Contact Logging
Each pipeline job supports a contact log for tracking hiring team conversations — required for WA unemployment audit compliance. Each contact entry records date, name/role, and optional notes. Contacts roll up to the parent job row in the report.

Requires the `contacts` column migration (see Setup step 3).

### Application Report
The 📋 Report view in the Pipeline tab generates a job search log for unemployment documentation. It includes every applied, interviewing, offer, and rejected role, sorted by date. Each row shows company, position, and status; contact sub-rows show meeting dates and names. Exports as CSV or plain text.

### Manual Job Entry (Recruiter Briefs)
The Evaluate tab supports adding jobs without a URL or job description — for roles that come via recruiter email or phone brief. Fill in just a title and company, then click **Save to Pipeline** to track status without requiring a full JD or score.

### URL Blocklist
Jobs from aggregator sites (The Ladders, ZipRecruiter, SimplyHired, CareerBuilder, Monster, Dice) are automatically filtered out across all ingestion paths.

### Non-US Filtering
Jobs with non-US locations are filtered out at ingestion. When a job lists "Remote" with no country, the description is scanned for country-specific office or residency requirements before inclusion.

### Low Confidence Filter
A `⚠ Low Conf` filter pill surfaces roles that were scored without a full job description (scraped JD under 600 chars, null score dimensions, or confidence below 60%). These cards expose an inline JD paste field — paste the full description and re-score in place without leaving the pipeline view.

### Bulk Re-Evaluation
The "Re-score all" button in the Pipeline tab runs Claude scoring across all unscored or selected jobs in the pipeline. Useful for evaluating a batch of newly ingested roles or re-scoring after a prompt update.

### JSON Briefing Import
Paste a JSON job list from the daily Claude briefing directly into the app. Uses a broad title filter that accepts Senior, Principal, VP, Director, Lead, Head, Group PM, and Manager titles in addition to the standard filter.

---

## Target Companies

Kairos covers 38 named companies across five domains, plus 2 aggregator feeds that pull from companies outside this list entirely.

**Observability / Monitoring** — Datadog, Elastic, New Relic, PagerDuty, Grafana Labs, Honeycomb, Sumo Logic, Cribl, Kentik, Arize AI, Fiddler AI, Braintrust, Chronosphere, Monte Carlo Data

**AI / ML / Data Platforms** — Anthropic, Databricks, Glean, Scale AI, Pinecone, Confluent, Temporal, dbt Labs, MongoDB, Stripe, Smartsheet, Fivetran, LaunchDarkly, Twilio

**Infrastructure / Cloud** — Cloudflare, CoreWeave, Samsara, Fastly

**Developer Tools** — Vercel, Postman, Harness, GitLab, PostHog

**Defense Tech** — Epirus

**Aggregators** — RemoteOK, We Work Remotely (product-category feed) — these return jobs from many companies per fetch, not one, so they're the mechanism for reaching beyond the hand-curated list above.

> FAANG companies (Google, Apple, Microsoft, Amazon, Meta) use proprietary ATS systems not accessible via Greenhouse/Ashby. LinkedIn and Google Careers alerts are captured via Gmail ingestion. Use the **Search Plan** tab in the app to surface manual search targets.
>
> Several companies were tried and dropped after their public APIs returned errors from a live production run despite having real, browsable careers pages: Observe Inc and Galileo AI (public API access disabled server-side), Snowflake, Airbyte, and Retool (same). Wellfound/AngelList has no public API at all — only third-party site scrapers — and was deliberately not integrated for that reason. All of these remain reachable via LinkedIn alert emails.

---

## Scoring Model

Each role is evaluated across 8 dimensions weighted to reflect seniority-level priorities:

| Dimension | Weight |
|---|---|
| Experience match | 40% |
| Skills match | 30% |
| Role level gate | Hard gate |
| Location | Remote-first bias |
| Work/life balance | Startup penalty applied |
| Culture, Compensation, Growth | Supplementary |

Scores below 60 indicate a mismatch in level, domain, or location. Scores 75+ indicate strong alignment with observability, AI/ML, or infrastructure domains. Roles scoring below 55 are auto-passed at ingestion.

**Location scoring:**
- Remote / remote-first: 95–100
- Seattle / WA hybrid: 80–90
- Requires relocation: 10–30

**Work/life balance adjustments:**
- Startup "fast-paced / wear many hats" language: 50–69
- On-call required: 30–49

---

## Environment Variables Reference

| Variable | Used By | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | App + scripts | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | App + scripts | Supabase anonymous (public) key |
| `ANTHROPIC_API_KEY` | Scripts only | Used for server-side Claude calls in ingestion |
| `SUPABASE_SERVICE_ROLE_KEY` | GitHub Actions | Service role key for server-side writes |
| `GMAIL_CLIENT_ID` | GitHub Actions | Google OAuth client ID (LinkedIn alert fetch) |
| `GMAIL_CLIENT_SECRET` | GitHub Actions | Google OAuth client secret |
| `GMAIL_REFRESH_TOKEN` | GitHub Actions | Long-lived Gmail refresh token |
| `GOOGLE_CLIENT_ID` | GitHub Actions | Google OAuth client ID (Google Careers scan) |
| `GOOGLE_CLIENT_SECRET` | GitHub Actions | Google OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | GitHub Actions | Long-lived Google OAuth refresh token |

> `GMAIL_*` and `GOOGLE_*` may point to the same OAuth app if using a single Google Cloud project.

The Anthropic key used in the browser app is entered at runtime via the Settings panel and stored in `localStorage` — it never touches the server.

---

## License

Private. Not for redistribution.
