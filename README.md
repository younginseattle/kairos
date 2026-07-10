# Kairos — AI-Powered Job Search Agent

> VP / Director-level · Platform, Infrastructure, Observability, AI

Kairos is a personal job search intelligence tool built for senior Product leaders. It automates discovery, scoring, and resume tailoring across dozens of target companies — so you spend time on the roles worth pursuing, not sifting through noise.

---

## What It Does

**Discover** — Automatically pulls new PM roles from Greenhouse and Lever ATS boards at 45+ target companies (Datadog, Elastic, Grafana, Anthropic, etc.), filters for Director/VP/Staff/Group/Principal PM titles, deduplicates, and stores them in Supabase. Also ingests LinkedIn and Google Careers job alert emails from Gmail automatically.

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
| Job sources | Greenhouse API, Lever API, Gmail (LinkedIn + Google Careers alerts) |
| Automation | GitHub Actions (3 pipelines), Node.js scripts |

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
│   ├── fetch-jobs.js        # Gmail alert fetcher — LinkedIn + Google alerts (GitHub Actions)
│   ├── scan-google-jobs.mjs # Google Careers email scanner (GitHub Actions)
│   ├── get-gmail-token.js   # One-time OAuth helper to get Gmail refresh token
│   └── package.json         # Script dependencies
├── .github/workflows/
│   ├── Discover_Jobs.yml      # ATS ingestion twice daily (6am + 6pm UTC)
│   ├── fetch-jobs.yml         # LinkedIn/Google Gmail alerts every 6 hours
│   └── scan-google-jobs.yml   # Google Careers emails Mon + Thu at 9am UTC
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

Three pipelines run automatically — no manual steps required after initial setup.

### Discover Jobs (`Discover_Jobs.yml`)
Runs the full ATS ingestion pipeline twice daily (6am and 6pm UTC). Fetches jobs from all 45+ Greenhouse and Lever sources, filters for relevant roles, auto-scores with Claude, and inserts new ones into Supabase. Roles scoring below 55 are automatically passed.

**Required GitHub secrets:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`

### Fetch Gmail Alerts (`fetch-jobs.yml`)
Runs every 6 hours. Reads LinkedIn and Google job alert emails from Gmail using native OAuth (no external libraries), parses job listings, filters out aggregator sites (The Ladders, ZipRecruiter, etc.) and non-US roles, deduplicates against Supabase, and inserts new roles with `source: linkedin_alert`.

Supports manual backfill via `workflow_dispatch` with a configurable `hours` lookback window.

**Required GitHub secrets:** `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

### Scan Google Careers (`scan-google-jobs.yml`)
Runs every Monday and Thursday at 9am UTC. Reads Google Careers job alert emails directly, parses listings, filters for Director/VP/Staff/Group/Principal PM titles in US locations, and inserts matched roles with `source: google_alert`.

Supports `--dry-run` and `--days=N` options via `workflow_dispatch`.

**Required GitHub secrets:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

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

Kairos covers 45+ companies across three domains:

**Observability / Monitoring** — Datadog, Elastic, New Relic, PagerDuty, Grafana Labs, Honeycomb, Sumo Logic, Cribl, Kentik, Arize AI, Fiddler AI, Observe Inc, Galileo AI, Braintrust

**AI / ML Platforms** — Anthropic, Databricks, Glean, Scale AI

**Infrastructure / Cloud / DevTools** — Cloudflare, CoreWeave, Temporal, LaunchDarkly, Vercel, Postman, dbt Labs, Harness, Fastly, Fivetran, Twilio, MongoDB, Stripe, GitLab, Smartsheet, Samsara, Epirus

> FAANG companies (Google, Apple, Microsoft, Amazon, Meta) use proprietary ATS systems not accessible via Greenhouse/Lever. LinkedIn and Google Careers alerts are captured via Gmail ingestion. Use the **Search Plan** tab in the app to surface manual search targets.

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
