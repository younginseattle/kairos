# Kairos — Gmail Job Alert Automation

Fetches LinkedIn job alert emails every 6 hours, parses job listings, and inserts new ones into Supabase automatically via GitHub Actions. (Google's own job postings are handled separately by `scripts/scan-google-jobs.mjs` — see that script's header comment.)

---

## 1. Create Google Cloud OAuth credentials

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a new project (or use an existing one).
2. Enable the **Gmail API**: APIs & Services → Library → search "Gmail API" → Enable.
3. Configure the OAuth consent screen: APIs & Services → OAuth consent screen.
   - User type: **External**
   - Add your Gmail address as a test user
   - Scopes: add `https://www.googleapis.com/auth/gmail.readonly`
4. Create credentials: APIs & Services → Credentials → Create Credentials → **OAuth client ID**.
   - Application type: **Desktop app**
   - Name it anything (e.g. "Kairos local")
5. Download the JSON or copy the **Client ID** and **Client Secret**.

---

## 2. Generate a refresh token (one-time, run locally)

```bash
cd scripts
npm install

GMAIL_CLIENT_ID=your-client-id \
GMAIL_CLIENT_SECRET=your-client-secret \
node get-gmail-token.js
```

The script prints an authorization URL. Open it, grant access, paste the code back into the terminal. The refresh token is printed to the console — copy it.

---

## 3. Add secrets to GitHub

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**.

Add these five secrets:

| Secret name | Where to get it |
|---|---|
| `GMAIL_CLIENT_ID` | Google Cloud OAuth credential |
| `GMAIL_CLIENT_SECRET` | Google Cloud OAuth credential |
| `GMAIL_REFRESH_TOKEN` | Output of `get-gmail-token.js` |
| `SUPABASE_URL` | Supabase project → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API → service_role key |

> Use the **service_role** key (not anon) so the script can bypass Row Level Security.

---

## 4. Verify it's working

**Trigger manually first:**
1. GitHub repo → **Actions** tab → "Fetch Job Alerts" → **Run workflow**
2. Click into the run to see logs. Look for the `── Summary` block:
   ```
   ── Summary
      Inserted : 4
      Skipped  : 12 (already in pipeline)
      Done ✓
   ```

**Check Supabase:**
- Open your Supabase project → Table Editor → `jobs`
- Filter `source = 'linkedin_alert'` and sort by `created_at desc`
- New rows should appear with `status = 'new'`

**Scheduled runs:**
- The workflow runs automatically every 6 hours at :00 UTC (midnight, 6am, noon, 6pm)
- Check Actions tab for run history and any failures

---

## 5. Change the run frequency

Edit `.github/workflows/fetch-jobs.yml`:

```yaml
on:
  schedule:
    - cron: '0 */6 * * *'   # ← change this
```

Also update `FETCH_INTERVAL_HOURS` in the same file to match (the script uses it to set the Gmail lookback window):

```yaml
env:
  FETCH_INTERVAL_HOURS: '6'   # ← match your cron interval
```

Common cron expressions:

| Frequency | Cron | FETCH_INTERVAL_HOURS |
|---|---|---|
| Every 6 hours | `0 */6 * * *` | `6` |
| Every 4 hours | `0 */4 * * *` | `4` |
| Every 12 hours | `0 */12 * * *` | `12` |
| Once daily (8am UTC) | `0 8 * * *` | `24` |

---

## Files

```
scripts/
├── fetch-jobs.js        # Main ingestion script
├── get-gmail-token.js   # One-time OAuth helper (run locally)
└── package.json         # Script dependencies (googleapis, @supabase/supabase-js)

.github/workflows/
└── fetch-jobs.yml       # GitHub Actions workflow
```
