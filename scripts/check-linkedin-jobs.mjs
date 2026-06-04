#!/usr/bin/env node
/**
 * Checks LinkedIn job URLs for closed/expired status.
 * Runs server-side (no CORS restrictions) against all active LinkedIn jobs
 * in the pipeline that aren't already closed or passed.
 *
 * Required environment variables:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional:
 *   DRY_RUN=true   — report findings without writing to Supabase
 *   DELAY_MS=1500  — milliseconds between requests (default 1500)
 */

import ws from 'ws';
globalThis.WebSocket = ws;

const { createClient } = await import('@supabase/supabase-js');

// ─────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────

const DRY_RUN  = process.env.DRY_RUN === 'true';
const DELAY_MS = parseInt(process.env.DELAY_MS || '1500', 10);

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].forEach(name => {
  if (!process.env[name]) {
    console.error(`✗ Missing required environment variable: ${name}`);
    process.exit(1);
  }
});

// ─────────────────────────────────────────────────────────────────
// Closed-page signals (case-insensitive substring match)
// ─────────────────────────────────────────────────────────────────

const CLOSED_SIGNALS = [
  'no longer accepting applications',
  'this job is no longer available',
  'job is no longer available',
  'this position has been filled',
  'posting has been removed',
  'this posting has expired',
  'job has been removed',
  'no longer available',
  'application deadline has passed',
];

// LinkedIn returns 999 for aggressive bot detection — treat as unknown, not closed
const BOT_BLOCK_STATUS = 999;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

// ─────────────────────────────────────────────────────────────────
// URL checker
// ─────────────────────────────────────────────────────────────────

async function checkUrl(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':      USER_AGENT,
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control':   'no-cache',
      },
    });
    clearTimeout(timer);

    // Bot-blocked — can't determine status
    if (res.status === BOT_BLOCK_STATUS) return { open: null, reason: 'bot-blocked (999)' };

    // Hard 404 — job definitely removed
    if (res.status === 404) return { open: false, reason: '404 not found' };

    // Redirected to a search/browse page — job expired
    const finalUrl = res.url || url;
    if (
      finalUrl.includes('/jobs/search') ||
      finalUrl.includes('/jobs/collections') ||
      finalUrl.includes('linkedin.com/jobs/?') ||
      finalUrl.includes('/authwall')
    ) {
      return { open: false, reason: `redirected to ${new URL(finalUrl).pathname}` };
    }

    // Rate limited — skip, don't mark closed
    if (res.status === 429) return { open: null, reason: 'rate-limited (429)' };

    // Read body and scan for closed signals
    const html = await res.text();
    const lower = html.toLowerCase();

    const signal = CLOSED_SIGNALS.find(s => lower.includes(s));
    if (signal) return { open: false, reason: `"${signal}"` };

    if (res.ok) return { open: true, reason: 'ok' };

    return { open: null, reason: `http-${res.status}` };
  } catch (err) {
    if (err.name === 'AbortError') return { open: null, reason: 'timeout' };
    return { open: null, reason: err.message.slice(0, 60) };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n◆ Kairos LinkedIn job status check${DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log(`  Delay between requests: ${DELAY_MS}ms\n`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Fetch all active LinkedIn jobs (not already closed/passed/deleted)
  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('id, title, company, url, status')
    .like('url', '%linkedin.com%')
    .not('status', 'in', '("pass","closed")')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('✗ Supabase query failed:', error.message);
    process.exit(1);
  }

  const candidates = (jobs || []).filter(j => j.url);
  console.log(`── Found ${candidates.length} active LinkedIn job(s) to check\n`);

  if (candidates.length === 0) {
    console.log('  Nothing to check. Done.');
    return;
  }

  let open = 0, closed = 0, unknown = 0, failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const job = candidates[i];
    process.stdout.write(`  [${i + 1}/${candidates.length}] ${job.title} — ${job.company} … `);

    const result = await checkUrl(job.url);

    if (result.open === true) {
      open++;
      console.log(`✓ open`);
    } else if (result.open === false) {
      closed++;
      console.log(`✗ closed (${result.reason})`);
      if (!DRY_RUN) {
        const { error: updateErr } = await supabase
          .from('jobs')
          .update({ status: 'closed' })
          .eq('id', job.id);
        if (updateErr) {
          console.error(`    ✗ Supabase update failed: ${updateErr.message}`);
          failed++;
        }
      }
    } else {
      unknown++;
      console.log(`? unknown (${result.reason})`);
    }

    // Polite delay between requests — avoids rate-limiting
    if (i < candidates.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n── Summary`);
  console.log(`   Checked : ${candidates.length}`);
  console.log(`   Open    : ${open}`);
  console.log(`   Closed  : ${closed}${DRY_RUN ? ' (dry run — not written)' : ''}`);
  console.log(`   Unknown : ${unknown} (bot-blocked, timeout, or rate-limited)`);
  if (failed > 0) console.log(`   Failed  : ${failed} (Supabase update errors)`);
  console.log('   Done ✓\n');
}

main().catch(err => {
  console.error('✗ Fatal error:', err.message);
  process.exit(1);
});
