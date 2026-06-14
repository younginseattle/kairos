#!/usr/bin/env node
/**
 * Scans Google Careers job alert emails and inserts matching roles into Supabase.
 *
 * SETUP (one time):
 *   1. Go to https://console.cloud.google.com → Create project → Enable Gmail API
 *   2. Credentials → OAuth 2.0 Client ID → Desktop app → Download JSON
 *   3. Save as scripts/google-credentials.json
 *   4. node scripts/scan-google-jobs.mjs --setup   ← opens browser, saves token
 *
 * RUN:
 *   node --env-file=.env scripts/scan-google-jobs.mjs
 *   node --env-file=.env scripts/scan-google-jobs.mjs --dry-run
 *   node --env-file=.env scripts/scan-google-jobs.mjs --days=14
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const DIR = dirname(fileURLToPath(import.meta.url));
const CREDS_FILE  = join(DIR, 'google-credentials.json');
const TOKEN_FILE  = join(DIR, 'google-token.json');

// ── Setup check ──────────────────────────────────────────────────
if (!existsSync(CREDS_FILE)) {
  console.error(`
✗ Missing scripts/google-credentials.json

Setup steps:
  1. Go to https://console.cloud.google.com
  2. Create or select a project
  3. APIs & Services → Enable APIs → search "Gmail API" → Enable
  4. APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID
  5. Application type: Desktop app → Create
  6. Download the JSON file and save it as:
       ${CREDS_FILE}
  7. Run: node scripts/scan-google-jobs.mjs --setup
`);
  process.exit(1);
}

const creds = JSON.parse(readFileSync(CREDS_FILE, 'utf8'));
const { client_id, client_secret, redirect_uris } = creds.installed || creds.web;

// ── Args ───────────────────────────────────────────────────────────────
const IS_SETUP   = process.argv.includes('--setup');
const DRY_RUN    = process.argv.includes('--dry-run');
const daysArg    = process.argv.find(a => a.startsWith('--days='));
const DAYS_BACK  = daysArg ? parseInt(daysArg.split('=')[1]) : 7;

// ── OAuth helpers ───────────────────────────────────────────────────
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const REDIRECT_URI = 'http://localhost:3456/oauth2callback';

async function getAccessToken() {
  if (existsSync(TOKEN_FILE)) {
    const token = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
    // Refresh if expired
    if (token.expiry_date && Date.now() > token.expiry_date - 60000) {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id, client_secret,
          refresh_token: token.refresh_token,
          grant_type: 'refresh_token',
        }),
      });
      const refreshed = await res.json();
      if (refreshed.error) throw new Error(`Token refresh failed: ${refreshed.error_description}`);
      const updated = { ...token, access_token: refreshed.access_token, expiry_date: Date.now() + refreshed.expires_in * 1000 };
      writeFileSync(TOKEN_FILE, JSON.stringify(updated, null, 2));
      return updated.access_token;
    }
    return token.access_token;
  }
  throw new Error('No token file — run with --setup first');
}

async function runSetup() {
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
    client_id,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  });

  console.log('\nOpening browser for Google OAuth...');
  console.log('If it does not open, visit:\n', authUrl, '\n');

  // Try to open browser
  const { execSync } = await import('child_process');
  try { execSync(`open "${authUrl}"`); } catch {}

  // Local server to catch callback
  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost:3456');
      const code = url.searchParams.get('code');
      if (code) {
        res.end('<h2>Auth complete — you can close this tab.</h2>');
        server.close();
        resolve(code);
      } else {
        res.end('<h2>Error — no code received.</h2>');
        server.close();
        reject(new Error('No code in callback'));
      }
    });
    server.listen(3456, () => console.log('Waiting for OAuth callback on port 3456...'));
    setTimeout(() => { server.close(); reject(new Error('Timeout')); }, 120000);
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id, client_secret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  const token = await res.json();
  if (token.error) throw new Error(`Token exchange failed: ${token.error_description}`);
  token.expiry_date = Date.now() + token.expires_in * 1000;
  writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2));
  console.log('✓ Token saved to', TOKEN_FILE);
  console.log('  Run the script without --setup to scan emails.\n');
}

if (IS_SETUP) { await runSetup(); process.exit(0); }

// ── Gmail API helpers ─────────────────────────────────────────────────
async function gmailGet(accessToken, path, params = {}) {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me${path}?` + new URLSearchParams(params);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Title filter ───────────────────────────────────────────────────
const SENIORITY_KEYWORDS = [
  'director', 'head of product', 'vp of product', 'vp product',
  'vice president of product', 'vice president, product',
  'group product manager', 'group pm',
  'staff product manager', 'staff pm',
  'principal product manager', 'principal pm',
];
const EXCLUSION_KEYWORDS = [
  'marketing', 'engineer', 'developer', 'designer', 'analyst',
  'counsel', 'finance', 'sales', 'recruiter', 'data science',
  'research', 'operations', 'security', 'design',
];
const DOMAIN_KEYWORD = 'product';

function isRelevantTitle(title) {
  const t = title.toLowerCase();
  if (!t.includes(DOMAIN_KEYWORD)) return false;
  if (EXCLUSION_KEYWORDS.some(kw => t.includes(kw))) return false;
  return SENIORITY_KEYWORDS.some(kw => t.includes(kw));
}

// ── Parse Google Careers email HTML ──────────────────────────
function parseGoogleJobsEmail(html) {
  const jobs = [];
  // href is unquoted in Google Careers emails
  const re = /href=(https:\/\/www\.google\.com\/about\/careers\/applications\/jobs\/results\/[^\s>]+)[^>]*><u>([^<]+)<\/u><\/a><\/h5><span[^>]*>([^<\n]+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const rawUrl   = m[1];
    const title    = m[2].trim();
    const compLoc  = m[3].replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '–').replace(/&amp;/g, '&').trim();
    const cleanUrl = rawUrl.split('?')[0];
    const [company, ...locParts] = compLoc.split('–').map(s => s.trim());
    const location = locParts.join('–').trim() || 'Multiple Sites';
    jobs.push({ title, company: company || 'Google', location, url: cleanUrl });
  }
  return jobs;
}

// ── Main ─────────────────────────────────────────────────────────────────
import ws from 'ws';
globalThis.WebSocket = ws;
const { createClient } = await import('@supabase/supabase-js');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL) { console.error('✗ Missing VITE_SUPABASE_URL'); process.exit(1); }
if (!SUPABASE_KEY) { console.error('✗ Missing VITE_SUPABASE_ANON_KEY'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const accessToken = await getAccessToken();
const afterDate   = new Date(Date.now() - DAYS_BACK * 86400 * 1000);
const afterEpoch  = Math.floor(afterDate.getTime() / 1000);

console.log(`\nScanning Google Careers emails from the last ${DAYS_BACK} days...\n`);

const { messages } = await gmailGet(accessToken, '/messages', {
  q: `from:careers-noreply@google.com after:${afterEpoch}`,
  maxResults: 50,
});

if (!messages?.length) {
  console.log('No Google Careers emails found in that window.\n');
  process.exit(0);
}

console.log(`Found ${messages.length} email(s) — parsing job listings...\n`);

const seenUrls = new Set();
const candidates = [];

for (const { id } of messages) {
  const msg  = await gmailGet(accessToken, `/messages/${id}`, { format: 'full' });
  const part = msg.payload?.parts?.find(p => p.mimeType === 'text/html') || msg.payload;
  const b64  = part?.body?.data;
  if (!b64) continue;
  const html = Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const jobs = parseGoogleJobsEmail(html);
  for (const job of jobs) {
    if (seenUrls.has(job.url)) continue;
    seenUrls.add(job.url);
    if (isRelevantTitle(job.title)) candidates.push(job);
  }
}

if (candidates.length === 0) {
  console.log('No matching roles found (director / group PM / staff PM / principal PM).\n');
  process.exit(0);
}

console.log(`Matched ${candidates.length} relevant role(s):\n`);
for (const j of candidates) {
  console.log(`  ${j.title}`);
  console.log(`  ${j.company} | ${j.location}`);
  console.log(`  ${j.url}\n`);
}

if (DRY_RUN) {
  console.log('[dry-run] No changes written.\n');
  process.exit(0);
}

let inserted = 0, skipped = 0;
for (const job of candidates) {
  const { data: existing } = await supabase
    .from('jobs').select('id').eq('url', job.url).maybeSingle();
  if (existing) { skipped++; continue; }

  const { error } = await supabase.from('jobs').insert({
    title:       job.title,
    company:     job.company,
    location:    job.location === 'Multiple Sites' ? 'Seattle, WA' : job.location,
    url:         job.url,
    source:      'google_alert',
    status:      'new',
    description: '',
    created_at:  new Date().toISOString(),
  });
  if (error) { console.error(`  ✗ ${job.title}: ${error.message}`); }
  else { console.log(`  ✓ Inserted: ${job.title}`); inserted++; }
}

console.log(`\nDone. Inserted: ${inserted}  Already in pipeline: ${skipped}\n`);
