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

import { google } from 'googleapis';
import ws         from 'ws';

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

const {
  GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET,
  GMAIL_REFRESH_TOKEN,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

function requireEnv(name) {
  if (!process.env[name]) {
    console.error(`✗ Missing required environment variable: ${name}`);
    process.exit(1);
  }
}
['GMAIL_CLIENT_ID','GMAIL_CLIENT_SECRET','GMAIL_REFRESH_TOKEN',
 'SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'].forEach(requireEnv);

// ─────────────────────────────────────────────────────────────────
// Gmail client
// ─────────────────────────────────────────────────────────────────

function buildGmailClient() {
  const auth = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth });
}

async function fetchEmailBodies(gmail) {
  let threads;
  try {
    const res = await gmail.users.threads.list({
      userId: 'me',
      q:      SEARCH_QUERY,
    });
    threads = res.data.threads || [];
  } catch (err) {
    console.error('✗ Gmail threads.list failed:', err.message);
    return [];
  }

  console.log(`  Found ${threads.length} matching thread(s)`);

  const bodies = [];
  for (const { id } of threads) {
    try {
      const res = await gmail.users.threads.get({
        userId: 'me',
        id,
        format: 'full',
      });
      const firstMessage = res.data.messages?.[0];
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
];

function shouldSkipLine(line) {
  // Skip "30 new jobs" / "30+ new jobs" header lines
  if (/\d+\+?\s+new\s+jobs?/i.test(line.slice(0, 50))) return true;
  return SKIP_PATTERNS.some(re => re.test(line));
}

function parseJobsFromBody(body) {
  const jobs = [];

  // Split on horizontal rules (10+ dashes) that separate job blocks
  const sections = body.split(/\n-{10,}\n/);

  for (const section of sections) {
    // LinkedIn job ID is the canonical dedup key
    const idMatch = section.match(/\/jobs\/view\/(\d+)\//);
    if (!idMatch) continue;

    const jobId = idMatch[1];
    const url   = `https://www.linkedin.com/jobs/view/${jobId}/`;

    const lines = section
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0 && !shouldSkipLine(l));

    if (lines.length < 2) continue;

    const title    = lines[0];
    const company  = lines[1];
    const location = lines[2] || 'United States';

    // Basic sanity — skip if title looks like a nav/footer line
    if (title.length > 120 || company.length > 80) continue;

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

  const gmail    = buildGmailClient();
  const supabase = buildSupabaseClient();

  // 1. Fetch email bodies
  console.log('── Fetching Gmail threads…');
  const bodies = await fetchEmailBodies(gmail);
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
