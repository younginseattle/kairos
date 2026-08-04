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

// Node 22 has a native WebSocket; older runtimes do not. Shim only when needed
// and do not hard-depend on `ws`, which resolves only transitively here.
if (typeof globalThis.WebSocket === 'undefined') {
  try { globalThis.WebSocket = (await import('ws')).default; } catch { /* realtime unused */ }
}

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

// Safety valve for a bulk destructive job. Real-world closure rates are low and
// gradual; anything above this points at a systemic misread, not reality.
const MAX_CLOSED_RATE       = 0.40;
const MIN_SAMPLE_FOR_GUARD  = 10;

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

    // A redirect away from the job page is NOT evidence the job closed.
    //
    // /authwall is LinkedIn's LOGIN wall. It is served to unauthenticated
    // requests — which is every request this script makes, since it carries no
    // session cookie. It means "you are not signed in", not "this job is gone".
    // Treating it as closed archived live roles every single day: 54 of the
    // highest-scoring roles in the pipeline (Grafana 91, Cisco 88, Splunk 87,
    // NVIDIA, Google, AWS, Microsoft…) ended up 'closed', which the app hides.
    //
    // /jobs/search and /jobs/collections are the same problem in a milder form:
    // LinkedIn does redirect expired postings there, but it also bounces
    // anonymous traffic there, and from outside a session the two are
    // indistinguishable. The cost is wildly asymmetric — a stale row left
    // visible costs one glance, a live role archived mid-interview can cost the
    // opportunity — so anything short of proof now reads as unknown.
    const finalUrl = res.url || url;
    if (finalUrl.includes('/authwall')) {
      return { open: null, reason: 'authwall — not signed in, status unknowable' };
    }
    if (
      finalUrl.includes('/jobs/search') ||
      finalUrl.includes('/jobs/collections') ||
      finalUrl.includes('linkedin.com/jobs/?')
    ) {
      return { open: null, reason: `redirected to ${new URL(finalUrl).pathname} — anonymous bounce or expiry, cannot tell` };
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
    // Never touch a role you are IN PROCESS on. A posting coming down while you
    // interview is the normal case — the req closes once they have a pipeline —
    // and archiving it destroys real-world state the app cannot re-derive.
    // status is a single column, so writing 'closed' over 'interviewing' erases
    // the only record that you were ever interviewing.
    .not('status', 'in', '("pass","closed","applied","interviewing","offer","rejected")')
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
  const toClose = [];

  // Decide everything BEFORE writing anything, so the sanity check below sees
  // the whole picture. Writing as we went meant a systemic misread was already
  // half-applied by the time it was observable.
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
      toClose.push({ job, reason: result.reason });
    } else {
      unknown++;
      console.log(`? unknown (${result.reason})`);
    }

    // Polite delay between requests — avoids rate-limiting
    if (i < candidates.length - 1) await sleep(DELAY_MS);
  }

  // Jobs do not close en masse overnight. A high closed-rate is far better
  // explained by something systemic — an auth change, a layout change, a block
  // — than by the roles actually disappearing. This is the guard that was
  // missing when an /authwall misread archived the best roles in the pipeline
  // one day at a time. Refuse the batch and make a human look.
  const decided = closed + open;
  const closedRate = decided > 0 ? closed / decided : 0;
  if (!DRY_RUN && decided >= MIN_SAMPLE_FOR_GUARD && closedRate > MAX_CLOSED_RATE) {
    console.error(`\n✗ ABORTED — ${closed}/${decided} (${Math.round(closedRate * 100)}%) came back closed, above the ${Math.round(MAX_CLOSED_RATE * 100)}% ceiling.`);
    console.error(`  Jobs do not close at that rate. This is far more likely an auth or layout change.`);
    console.error(`  Nothing was written. Re-run with DRY_RUN=true and read the reasons before overriding.`);
    process.exit(1);
  }

  if (!DRY_RUN) {
    for (const { job } of toClose) {
      const { error: updateErr } = await supabase
        .from('jobs')
        .update({ status: 'closed' })
        .eq('id', job.id);
      if (updateErr) {
        console.error(`    ✗ Supabase update failed for ${job.id}: ${updateErr.message}`);
        failed++;
      }
    }
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
