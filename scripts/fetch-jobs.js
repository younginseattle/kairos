#!/usr/bin/env node
/**
 * Fetches LinkedIn and Google job alert emails from Gmail,
 * parses job listings, and inserts new ones into Supabase.
 *
 * Required environment variables:
 *   GMAIL_CLIENT_ID
 *   GMAIL_CLIENT_SECRET
 *   GMAIL_REFRESH_TOKEN
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   FETCH_INTERVAL_HOURS  (optional, default 6)
 */

import ws from 'ws';

// Must be set before @supabase/supabase-js is loaded — it checks
// globalThis.WebSocket at import time and throws on Node < 22 without it.
globalThis.WebSocket = ws;

const { createClient } = await import('@supabase/supabase-js');

// ─────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────

const INTERVAL_HOURS  = parseInt(process.env.FETCH_INTERVAL_HOURS || '6', 10);
const LOOKBACK_HOURS  = INTERVAL_HOURS + 1; // overlap to prevent gaps
const GMAIL_SENDERS   = 'from:(jobalerts-noreply@linkedin.com OR googlealerts-noreply@google.com)';
const SEARCH_QUERY    = `${GMAIL_SENDERS} newer_than:${LOOKBACK_HOURS}h`;

// Accept GOOGLE_* or GMAIL_* env vars interchangeably
const GMAIL_CLIENT_ID     = process.env.GMAIL_CLIENT_ID     || process.env.GOOGLE_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN;
const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
  console.error('✗ Missing Gmail credentials (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN)');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('✗ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────
// Title / location filter
// ─────────────────────────────────────────────────────────────────

const SENIORITY_KEYWORDS = [
  'director', 'head of product',
  'vp of product', 'vp product', 'vp, product',
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
const NON_US_COUNTRIES = [
  'united kingdom', 'england', 'scotland', 'wales', ', uk',
  'canada', 'germany', 'netherlands', 'france', 'spain', 'italy',
  'australia', 'new zealand', 'ireland', 'india', 'singapore',
  'japan', 'south korea', 'brazil', 'mexico', 'sweden', 'norway',
  'denmark', 'finland', 'switzerland', 'austria', 'belgium',
  'poland', 'czech', 'hungary', 'romania', 'portugal',
  'israel', 'dubai', 'uae', 'south africa',
];

const BLOCKED_URL_DOMAINS = [
  'theladders.com',
  'ladder.io',
  'ziprecruiter.com',
  'simplyhired.com',
  'careerbuilder.com',
  'monster.com',
  'dice.com',
];

function isRelevantTitle(title) {
  const t = title.toLowerCase();
  if (!t.includes('product')) return false;
  if (EXCLUSION_KEYWORDS.some(kw => t.includes(kw))) return false;
  return SENIORITY_KEYWORDS.some(kw => t.includes(kw));
}

function isUSLocation(location) {
  const loc = (location || '').toLowerCase();
  if (!loc) return true;
  return !NON_US_COUNTRIES.some(c => loc.includes(c));
}

function isAllowedURL(url) {
  if (!url) return true;
  const u = url.toLowerCase();
  return !BLOCKED_URL_DOMAINS.some(d => u.includes(d));
}

// ─────────────────────────────────────────────────────────────────
// Gmail via native fetch (avoids googleapis HTTP client issues in CI)
// ─────────────────────────────────────────────────────────────────

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`OAuth token refresh failed: ${data.error} — ${data.error_description}`);
  return data.access_token;
}

async function gmailGet(accessToken, path, params = {}) {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me${path}?` + new URLSearchParams(params);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail API ${res.status}: ${body}`);
  }
  return res.json();
}

async function fetchEmailBodies() {
  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error('✗ OAuth token refresh failed:', err.message);
    return [];
  }

  let threadList;
  try {
    threadList = await gmailGet(accessToken, '/threads', { q: SEARCH_QUERY });
  } catch (err) {
    console.error('✗ Gmail threads.list failed:', err.message);
    return [];
  }

  const threads = threadList.threads || [];
  console.log(`  Found ${threads.length} matching thread(s)`);

  const bodies = [];
  for (const { id } of threads) {
    try {
      const thread = await gmailGet(accessToken, `/threads/${id}`, { format: 'full' });
      const firstMessage = thread.messages?.[0];
      if (!firstMessage) continue;
      const body = extractPlainText(firstMessage.payload);
      if (body) bodies.push(body);
    } catch (err) {
      console.error(`  ✗ Could not fetch thread ${id}:`, err.message);
    }
  }
  return bodies;
}

function extractPlainText(payload) {
  if (!payload) return '';

  // Single-part plain text
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  // Multipart — walk parts recursively, prefer text/plain
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
  }
  return '';
}

// ─────────────────────────────────────────────────────────────────
// Job parser
// ─────────────────────────────────────────────────────────────────

const SKIP_PATTERNS = [
  /^your job alert/i,
  /^results from/i,
  /^see all jobs/i,
  /^stand out/i,
  /view job/i,
  /connection/i,
  /alumni/i,
  /actively hiring/i,
  /apply with/i,
  /match your preferences/i,
  /new jobs? for you/i,
  // LinkedIn email noise lines that shift title/company/location parsing
  /^promoted$/i,
  /^easy apply$/i,
  /^full[\s-]?time$/i,
  /^part[\s-]?time$/i,
  /^contract$/i,
  /^internship$/i,
  /^temporary$/i,
  /^be an early applicant/i,
  /^over \d[\d,]* applicants?/i,
  /^\d[\d,]*\+?\s+applicants?/i,
  /^\$[\d,]+/,              // salary like "$180,000" or "$180K"
  /^[\d,.]+[kK]\/yr/i,     // salary like "180K/yr"
  /^\d[\d,.]*[kK]?\s*[-–]\s*\d/,  // salary range like "180K–230K"
];

function shouldSkipLine(line) {
  // Skip "30 new jobs" / "30+ new jobs" header lines
  if (/\d+\+?\s+new\s+jobs?/i.test(line.slice(0, 50))) return true;
  return SKIP_PATTERNS.some(re => re.test(line));
}

function parseJobsFromBody(body) {
  const jobs = [];

  // Find every LinkedIn job URL — handles /jobs/view/ and /comm/jobs/view/
  // with or without tracking params or trailing slash
  const urlRe = /https?:\/\/(?:www\.)?linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)[^\s]*/g;
  let m;

  while ((m = urlRe.exec(body)) !== null) {
    const jobId = m[1];
    const url   = `https://www.linkedin.com/jobs/view/${jobId}/`;

    // Grab the text block before this URL (up to 600 chars back)
    const before = body.slice(Math.max(0, m.index - 600), m.index);

    // Split into non-empty, non-noise lines — take the last few.
    // Also strip LinkedIn's "· N school alum(s)" annotation that appears
    // inline in location strings, e.g. "United States · 1 school alum".
    const lines = before
      .split(/\r?\n/)
      .map(l => l.trim().replace(/\s*[·•]\s*\d+\s+school\s+alum\w*/gi, '').trim())
      .filter(l => l.length > 2 && l.length < 150 && !shouldSkipLine(l)
                   && !/^https?:\/\//i.test(l));   // skip any URL lines

    if (lines.length < 2) continue;

    // The last meaningful lines before the URL are: title, company, location.
    // LinkedIn now sometimes injects a business-unit/vertical line between
    // company and location (e.g. "M&A, Strategy and Technology Partnerships").
    // Detect that pattern: if the second-to-last line looks like a department
    // description (long, contains conjunctions) rather than a company name,
    // use the line above it as the company instead.
    let location = lines[lines.length - 1] || 'United States';
    let company  = lines[lines.length - 2] || '';
    let companyOffset = 2;
    if (company.length > 40 && /\b(and|&)\b/i.test(company)) {
      // Looks like a department/vertical — skip it
      companyOffset = 3;
      company = lines[lines.length - 3] || lines[lines.length - 2];
    }

    // Scan backwards to find the title line — it must contain a seniority
    // keyword. This is robust against any remaining noise lines.
    let title = lines[lines.length - (companyOffset + 1)] || company;
    for (let i = lines.length - (companyOffset + 1); i >= 0; i--) {
      const candidate = lines[i].toLowerCase();
      if (SENIORITY_KEYWORDS.some(kw => candidate.includes(kw))) {
        title = lines[i];
        break;
      }
    }

    if (!title || title.length > 120 || company.length > 100) continue;
    if (!isRelevantTitle(title)) continue;
    if (!isUSLocation(location)) continue;
    if (!isAllowedURL(url)) continue;

    jobs.push({ title, company, location, url });
  }

  return jobs;
}

// ─────────────────────────────────────────────────────────────────
// Supabase
// ─────────────────────────────────────────────────────────────────

function buildSupabaseClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function urlExists(supabase, url) {
  const { data, error } = await supabase
    .from('jobs')
    .select('id')
    .eq('url', url)
    .maybeSingle();
  if (error) {
    console.error(`  ✗ Supabase dedup check failed for ${url}:`, error.message);
    return false; // assume not duplicate so we don't silently drop
  }
  return !!data;
}

async function insertJob(supabase, job) {
  const { error } = await supabase.from('jobs').insert({
    title:    job.title,
    company:  job.company,
    location: job.location,
    url:      job.url,
    status:   'new',
    source:   'linkedin_alert',
  });
  if (error) {
    console.error(`  ✗ Insert failed for "${job.title}" (${job.url}):`, error.message);
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n◆ Kairos job fetch — lookback ${LOOKBACK_HOURS}h`);
  console.log(`  Query: ${SEARCH_QUERY}\n`);

  const supabase = buildSupabaseClient();

  // 1. Fetch email bodies
  console.log('── Fetching Gmail threads…');
  const bodies = await fetchEmailBodies();
  console.log(`  Fetched ${bodies.length} email body/bodies\n`);

  // 2. Parse all jobs across all emails
  console.log('── Parsing job listings…');
  const allJobs = bodies.flatMap(parseJobsFromBody);

  // Dedup within this batch by URL
  const seen     = new Set();
  const uniqueJobs = allJobs.filter(j => {
    if (seen.has(j.url)) return false;
    seen.add(j.url);
    return true;
  });
  console.log(`  Parsed ${uniqueJobs.length} unique job(s) from emails\n`);

  if (uniqueJobs.length === 0) {
    console.log('  Nothing to insert. Done.');
    return;
  }

  // 3. Dedup against Supabase and insert
  console.log('── Inserting into Supabase…');
  let inserted = 0, skipped = 0, failed = 0;

  for (const job of uniqueJobs) {
    const exists = await urlExists(supabase, job.url);
    if (exists) {
      skipped++;
      continue;
    }
    const ok = await insertJob(supabase, job);
    if (ok) {
      inserted++;
      console.log(`  ✓ ${job.title} — ${job.company}`);
    } else {
      failed++;
    }
  }

  console.log(`\n── Summary`);
  console.log(`   Inserted : ${inserted}`);
  console.log(`   Skipped  : ${skipped} (already in pipeline)`);
  if (failed > 0) console.log(`   Failed   : ${failed}`);
  console.log('   Done ✓\n');
}

main().catch(err => {
  console.error('✗ Fatal error:', err.message);
  process.exit(1);
});
