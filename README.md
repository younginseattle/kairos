# Kairos — AI-Powered Job Search Agent

> VP / Director-level · Platform, Infrastructure, Observability, AI

Kairos is a personal job search intelligence tool built for senior Product leaders. It automates discovery, scoring, and resume tailoring across dozens of target companies — so you spend time on the roles worth pursuing, not sifting through noise.

---

## What It Does

**Discover** — Automatically pulls new PM roles from Greenhouse and Lever ATS boards at 40+ target companies (Datadog, Elastic, Grafana, Anthropic, etc.), filters for Director/VP/Staff/Group PM titles, deduplicates, and stores them in Supabase.

**Evaluate** — Paste any job description and Claude scores it across 8 dimensions: overall fit, skills match, experience match, culture, compensation, work/life balance, growth, and location. Outputs a structured verdict with strengths, gaps, and a recommendation (`apply` / `apply_with_note` / `stretch` / `skip`).

**Saved** — Full pipeline view of all scored roles with status tracking (`new → reviewing → applied → interviewing → offer → pass`). Supports bulk re-evaluation and selective filtering.

**Tailor** — Generates a role-specific resume tailored to the job description, with keyword matching, language transformations, and section relevance scoring. Exports as formatted plain text.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite |
| Database | Supabase (PostgreSQL) |
| AI | Anthropic Claude (`claude-sonnet-4-20250514`) |
| Job sources | Greenhouse API, Lever API |
| Automation | Node.js scripts (`run-ingestion.mjs`, `run-briefing.mjs`) |

---

## Project Structure

```
kairos/
├── src/
│   ├── App.jsx              # Main React app — all 4 tabs
│   ├── ingestion.js         # Job fetch → filter → normalize → score pipeline
│   ├── run-ingestion.mjs    # Node script: runs full ingestion pipeline
│   ├── run-briefing.mjs     # Node script: generates daily markdown briefing
│   ├── supabaseClient.js    # Supabase client init
│   └── main.jsx             # React entry point
├── public/
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

> The `VITE_` prefix is required for variables used in the browser (Vite convention). `ANTHROPIC_API_KEY` is used by the Node.js scripts only.

### 3. Run the dev server

```bash
npm run dev
```

The app runs at `http://localhost:5173`. Your Anthropic API key is entered directly in the app's Settings panel at runtime — it is never stored server-side.

---

## Running Ingestion

The ingestion pipeline fetches jobs from all configured sources, filters for relevant roles, deduplicates against Supabase, inserts new jobs, and triggers Claude evaluations.

```bash
node --env-file=.env src/run-ingestion.mjs
```

Run this on a schedule (cron, Cowork, etc.) to keep the pipeline fresh. Recommended: once or twice daily.

---

## Running the Daily Briefing

Generates a markdown briefing file to `~/Desktop` summarizing new roles scored in the last 24 hours, grouped by priority tier.

```bash
node --env-file=.env src/run-briefing.mjs
```

Recommended: run 15 minutes after ingestion.

---

## Target Companies

Kairos covers 40+ companies across three domains:

**Observability / Monitoring** — Datadog, Elastic, New Relic, PagerDuty, Grafana Labs, Honeycomb, Sumo Logic, Arize AI

**AI / ML Platforms** — Anthropic, OpenAI, Cohere, Weights & Biases, Scale AI, Hugging Face, Runway, Glean

**Infrastructure / Cloud / DevTools** — HashiCorp, Cloudflare, Fastly, Vercel, Harness, LaunchDarkly, Temporal, Pulumi, GitHub, Linear, Snyk, and more

> FAANG companies (Google, Apple, Microsoft, Amazon, Meta) use proprietary ATS systems not accessible via Greenhouse/Lever. Use the **Search Plan** tab in the app to surface those roles manually.

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

Scores below 60 indicate a mismatch in level, domain, or location. Scores 75+ indicate strong alignment.

---

## Environment Variables Reference

| Variable | Used By | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | App + scripts | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | App + scripts | Supabase anonymous (public) key |
| `ANTHROPIC_API_KEY` | Scripts only | Used for server-side Claude calls in ingestion |

The Anthropic key used in the browser app is entered at runtime via the Settings panel and stored in `localStorage` — it never touches the server.

---

## License

Private. Not for redistribution.
