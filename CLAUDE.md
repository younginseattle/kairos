# CLAUDE.md — Kairos Project Context

This file gives Claude Code persistent context about the Kairos codebase. Read this before making any changes.

---

## What This Project Is

Kairos is a personal job search intelligence tool for a VP/Director-level Product leader targeting Platform, Infrastructure, Observability, and AI/ML companies. It is a single-user app, not a SaaS product.

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
- `isRelevantJob(job, source)` — title filter for VP/Director/Staff/Group PM roles
- `normalizeJob(job)` — maps raw job to Supabase schema
- `isDuplicateJob(supabaseClient, url)` — dedup check
- `insertJob(supabaseClient, job)` — insert to Supabase
- `runJobIngestion(supabaseClient, anthropicApiKey, candidateProfile)` — full pipeline

### `src/run-ingestion.mjs`
Node.js script. Reads env from `.env` file. Calls `runJobIngestion`. Run as:
```bash
node --env-file=.env src/run-ingestion.mjs
```

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
- **Scoring bias:** Do not penalize for "overqualified" at Director level

The full candidate profile string is defined inside `ingestion.js` as `candidateProfile` and inside `App.jsx` as `profile`.

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
- FAANG companies are not accessible via Greenhouse/Lever — they use Workday. Do not add them to `SOURCES`.

---

## What NOT to Change Without Asking

- The `FIT_PROMPT` scoring rules and schema — these are calibrated to Matt's profile
- The `SOURCES` list — each entry has been verified against live ATS APIs
- The `T` design token object — the visual identity is intentional
- Supabase column names — changing them requires a migration
