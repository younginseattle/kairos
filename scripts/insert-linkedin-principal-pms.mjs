#!/usr/bin/env node
/**
 * Inserts missed Principal PM roles found in LinkedIn email alerts (past 7 days).
 * Adds as stubs (no JD) — open each in the app Evaluate tab to paste JD and score.
 *
 * Run: node --env-file=../.env scripts/insert-linkedin-principal-pms.mjs
 */

import ws from 'ws';
globalThis.WebSocket = ws;
const { createClient } = await import('@supabase/supabase-js');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL) { console.error('✗ Missing VITE_SUPABASE_URL'); process.exit(1); }
if (!SUPABASE_KEY) { console.error('✗ Missing VITE_SUPABASE_ANON_KEY'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const JOBS = [
  {
    title:    "Principal Product Manager",
    company:  "Pulumi",
    location: "Greater Seattle Area",
    url:      "https://www.linkedin.com/comm/jobs/view/4424422798",
  },
  {
    title:    "Principal Product Management, Agentic Automation",
    company:  "UiPath",
    location: "Bellevue, WA",
    url:      "https://www.linkedin.com/comm/jobs/view/4419223048",
  },
  {
    title:    "Principal AI Product Manager",
    company:  "Amperity",
    location: "Seattle, WA",
    url:      "https://www.linkedin.com/comm/jobs/view/4341897196",
  },
  {
    title:    "Principal Product Manager, Filesystems",
    company:  "WEKA",
    location: "United States",
    url:      "https://www.linkedin.com/comm/jobs/view/4381677265",
  },
  {
    title:    "Principal Product Manager - Workday AI",
    company:  "Workday",
    location: "Seattle, WA",
    url:      "https://www.linkedin.com/comm/jobs/view/4410303224",
  },
  {
    title:    "Principal Product Manager - Activation & Deployment, Evisort AI",
    company:  "Workday",
    location: "Seattle, WA",
    url:      "https://www.linkedin.com/comm/jobs/view/4400449954",
  },
  {
    title:    "Principal Product Manager, Growth",
    company:  "Docker, Inc",
    location: "United States",
    url:      "https://www.linkedin.com/comm/jobs/view/4421292446",
  },
  {
    title:    "Principal Product Manager - AI",
    company:  "Talkdesk",
    location: "Seattle, WA",
    url:      "https://www.linkedin.com/comm/jobs/view/4414209719",
  },
  {
    title:    "Principal Product Manager - Containers",
    company:  "IBM",
    location: "Seattle, WA",
    url:      "https://www.linkedin.com/comm/jobs/view/4411537262",
  },
];

let inserted = 0, skipped = 0;

for (const job of JOBS) {
  // Check for duplicate by URL
  const { data: existing } = await supabase
    .from('jobs')
    .select('id')
    .eq('url', job.url)
    .maybeSingle();

  if (existing) {
    console.log(`  ~ Already exists: ${job.title} — ${job.company}`);
    skipped++;
    continue;
  }

  const { error } = await supabase.from('jobs').insert({
    title:       job.title,
    company:     job.company,
    location:    job.location,
    url:         job.url,
    source:      'linkedin_alert',
    status:      'new',
    description: '',
    created_at:  new Date().toISOString(),
  });

  if (error) {
    console.error(`  ✗ Failed: ${job.title} — ${error.message}`);
  } else {
    console.log(`  ✓ Inserted: ${job.title} — ${job.company} (${job.location})`);
    inserted++;
  }
}

console.log(`\nDone. Inserted: ${inserted}  Skipped (already exists): ${skipped}`);
console.log('\nNext: open each in the app Evaluate tab, paste the JD, and score.\n');
