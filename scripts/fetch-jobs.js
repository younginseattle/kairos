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
import * as cheerio from 'cheerio';

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
  'vp of product', 'vp product', 'vp, product', 'vp, products',
  'vp of products', 'vp products',
  'vice president of product', 'vice president, product',
  'vice president of products', 'vice president, products',
  'group product manager', 'group pm',
  'staff product manager', 'staff pm',
  'principal product manager', 'principal pm',
  // Catch "Principal <domain> Product Manager" and similar patterns
  // where a domain word sits between the seniority level and "product"
  'senior product manager',
];
const EXCLUSION_KEYWORDS = [
  'marketing', 'engineer', 'designer', 'analyst',
  'counsel', 'finance', 'sales', 'recruiter', 'data science',
  'research', 'operations', 'security', 'design',
];

// "developer" is intentionally excluded from EXCLUSION_KEYWORDS because
// VP/Director PM roles for "developer platform" products would be wrongly blocked.
// "engineer" already catches software engineer job titles.
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

// Regex patterns for seniority levels where a domain word may sit between
// the level and "product" (e.g. "Principal AI Product Manager").
const SENIORITY_PATTERNS = [
  /\bprincipal\b.{0,30}\bproduct\b/i,
  /\bstaff\b.{0,30}\bproduct\b/i,
  /\bvice\s+president\b.{0,30}\bproduct/i,
  /\bvp\b.{0,20}\bproduct/i,
];

function isRelevantTitle(title) {
  const t = title.toLowerCase();
  if (!t.includes('product')) return false;
  if (EXCLUSION_KEYWORDS.some(kw => t.includes(kw))) return false;
  if (SENIORITY_KEYWORDS.some(kw => t.includes(kw))) return true;
  return SENIORITY_PATTERNS.some(re => re.test(t));
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

  // Returns { html, text } per thread — html is preferred for parsing
  // (real DOM boundaries per job card); text is kept as a fallback for
  // whenever html parsing yields nothing (missing html part, or a
  // template cheerio can't make sense of).
  const bodies = [];
  for (const { id } of threads) {
    try {
      const thread = await gmailGet(accessToken, `/threads/${id}`, { format: 'full' });
      const firstMessage = thread.messages?.[0];
      if (!firstMessage) continue;
      const html = extractPartByMime(firstMessage.payload, 'text/html');
      const text = extractPartByMime(firstMessage.payload, 'text/plain');
      if (html || text) bodies.push({ html, text });
    } catch (err) {
      console.error(`  ✗ Could not fetch thread ${id}:`, err.message);
    }
  }
  return bodies;
}

function extractPartByMime(payload, mimeType) {
  if (!payload) return '';

  if (payload.mimeType === mimeType && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  // Multipart — walk parts recursively, first match wins
  if (payload.parts) {
    for (const part of payload.parts) {
      const found = extractPartByMime(part, mimeType);
      if (found) return found;
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
  /^\d+\s+school\s+alum/i, // standalone "N school alum" line
  /^\$[\d,]+/,              // salary like "$180,000" or "$180K"
  /^[\d,.]+[kK]\/yr/i,     // salary like "180K/yr"
  /^\d[\d,.]*[kK]?\s*[-–]\s*\d/,  // salary range like "180K–230K"
];

function shouldSkipLine(line) {
  // Skip "30 new jobs" / "30+ new jobs" header lines
  if (/\d+\+?\s+new\s+jobs?/i.test(line.slice(0, 50))) return true;
  return SKIP_PATTERNS.some(re => re.test(line));
}

const VERBOSE = process.env.VERBOSE === 'true';

const JOB_URL_RE = /^https?:\/\/(?:www\.)?linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/i;

function cleanLine(s) {
  return (s || '')
    .replace(/[^\w\s]\s*\d+\s+school\s+alum\w*/gi, '') // "· 1 school alum"
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function applyCommonFilters(title, company, location, url, emailIndex, urlCount, strategy) {
  title = title.replace(/\s*[—–]\s*.{10,}$/, '').trim(); // strip dept suffix
  if (VERBOSE) {
    console.log(`\n  [email ${emailIndex + 1}] (${strategy}) URL #${urlCount}: ${url}`);
    console.log(`    Parsed → title: ${JSON.stringify(title)}  company: ${JSON.stringify(company)}  location: ${JSON.stringify(location)}`);
  }
  if (!title || title.length > 120 || company.length > 100) {
    if (VERBOSE) console.log(`    ✗ SKIP: title/company length check failed`);
    return null;
  }
  if (!isRelevantTitle(title)) {
    if (VERBOSE) {
      const t = title.toLowerCase();
      const hasProduct = t.includes('product');
      const hasSeniority = SENIORITY_KEYWORDS.some(kw => t.includes(kw));
      const excluded = EXCLUSION_KEYWORDS.find(kw => t.includes(kw));
      console.log(`    ✗ SKIP: isRelevantTitle failed — hasProduct:${hasProduct} hasSeniority:${hasSeniority} excluded:${excluded || 'none'}`);
    }
    return null;
  }
  if (!isUSLocation(location)) {
    if (VERBOSE) console.log(`    ✗ SKIP: non-US location: ${JSON.stringify(location)}`);
    return null;
  }
  if (!isAllowedURL(url)) {
    if (VERBOSE) console.log(`    ✗ SKIP: blocked URL domain`);
    return null;
  }
  if (VERBOSE) console.log(`    ✓ PASS: "${title}" @ ${company}`);
  return { title, company, location, url };
}

// ── Primary strategy: parse the HTML body with cheerio ─────────────
//
// LinkedIn digest emails render each job as a self-contained card
// (a table row / div block) containing a logo <img alt="Company logo">
// and one or two <a href="…jobs/view/…"> links (an image-wrapped link
// and a text link — both point at the same job). Anchoring on that DOM
// boundary — instead of "N lines of plaintext before the URL" — means
// company/title/location extraction only ever looks inside the correct
// card, so it can't bleed into a neighboring job's text.
function parseJobsFromHtml(html, emailIndex = 0) {
  const jobs = [];
  let $;
  try {
    $ = cheerio.load(html);
  } catch (err) {
    if (VERBOSE) console.log(`  [email ${emailIndex + 1}] ✗ cheerio.load failed: ${err.message}`);
    return jobs;
  }

  // Group all matching anchors by job id (image-link + text-link share one id)
  const byJobId = new Map();
  $('a[href*="jobs/view/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = JOB_URL_RE.exec(href);
    if (!match) return;
    const jobId = match[1];
    if (!byJobId.has(jobId)) byJobId.set(jobId, []);
    byJobId.get(jobId).push(el);
  });

  let urlCount = 0;
  for (const [jobId, anchors] of byJobId) {
    urlCount++;
    const url = `https://www.linkedin.com/jobs/view/${jobId}/`;

    // Title: prefer an anchor with substantial visible text (the text-link,
    // not the image-wrapped logo link).
    let title = '';
    for (const el of anchors) {
      const t = cleanLine($(el).text());
      if (t.length > 3 && !shouldSkipLine(t)) { title = t; break; }
    }

    // Card boundary: walk up from the first anchor until we find an
    // ancestor whose text is a reasonable card size and doesn't contain
    // a second job's anchor (avoids spanning multiple cards).
    let $card = $(anchors[0]);
    for (let depth = 0; depth < 6; depth++) {
      const $parent = $card.parent();
      if (!$parent.length) break;
      const otherJobIds = new Set();
      $parent.find('a[href*="jobs/view/"]').each((_, a) => {
        const m = JOB_URL_RE.exec($(a).attr('href') || '');
        if (m && m[1] !== jobId) otherJobIds.add(m[1]);
      });
      if (otherJobIds.size > 0) break; // parent spans multiple cards — stop here
      $card = $parent;
      if ($card.text().trim().length > 40) break; // enough context, stop growing
    }

    // Company: an <img alt="X logo"> inside the card is the most reliable signal.
    let company = '';
    $card.find('img[alt]').each((_, img) => {
      if (company) return;
      const alt = cleanLine($(img).attr('alt') || '');
      if (/logo$/i.test(alt)) company = alt.replace(/\s*logo$/i, '').trim();
    });

    // Fallback text lines within the card — split on block-level boundaries
    // rather than raw newlines, so each line maps to one visual element.
    const blockLines = [];
    $card.find('*').addBack().each((_, node) => {
      if (node.children?.some(c => c.type === 'tag')) return; // only leaf-ish nodes
      const t = cleanLine($(node).text());
      if (t && t.length > 1 && t.length < 150 && !shouldSkipLine(t) && !/^https?:\/\//i.test(t)) {
        blockLines.push(t);
      }
    });
    const uniqueLines = [...new Set(blockLines)].filter(l => l !== title && l !== company);

    if (!company) {
      company = uniqueLines.find(l => l.length < 60 && !/\b(remote|united states|,\s*[A-Z]{2}\b)/i.test(l)) || uniqueLines[0] || '';
    }
    const location = uniqueLines.find(l => l !== company && /\b(remote|united states|,\s*[A-Z]{2}\b)/i.test(l))
      || uniqueLines.find(l => l !== company)
      || 'United States';

    const job = applyCommonFilters(title, company, location, url, emailIndex, urlCount, 'html');
    if (job) jobs.push(job);
  }

  if (VERBOSE && urlCount === 0) {
    console.log(`  [email ${emailIndex + 1}] (html) No LinkedIn job URLs found`);
  }
  return jobs;
}

// ── Fallback strategy: the original plaintext line-position heuristic ──
// Kept only for emails where no usable html part exists, or where html
// parsing finds zero cards (e.g. a template cheerio can't make sense of).
// This is intentionally the old, less reliable logic — it's a safety net,
// not the primary path anymore.
function parseJobsFromPlainText(body, emailIndex = 0) {
  const jobs = [];
  const urlRe = /https?:\/\/(?:www\.)?linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)[^\s]*/g;
  let m;
  let urlCount = 0;

  while ((m = urlRe.exec(body)) !== null) {
    urlCount++;
    const jobId = m[1];
    const url   = `https://www.linkedin.com/jobs/view/${jobId}/`;

    const before = body.slice(Math.max(0, m.index - 600), m.index);
    const lines = before
      .split(/\r?\n/)
      .map(l => cleanLine(l))
      .filter(l => l.length > 2 && l.length < 150 && !shouldSkipLine(l) && !/^https?:\/\//i.test(l));

    if (lines.length < 2) {
      if (VERBOSE) console.log(`\n  [email ${emailIndex + 1}] (text) URL #${urlCount}: job ${jobId}\n    ✗ SKIP: fewer than 2 usable lines`);
      continue;
    }

    let location = cleanLine(lines[lines.length - 1] || 'United States');
    let company  = lines[lines.length - 2] || '';
    let companyOffset = 2;
    if (company.length > 40 && /\b(and|&)\b/i.test(company)) {
      companyOffset = 3;
      company = lines[lines.length - 3] || lines[lines.length - 2];
    }

    let title = lines[lines.length - (companyOffset + 1)] || company;
    for (let i = lines.length - (companyOffset + 1); i >= 0; i--) {
      const candidate = lines[i].toLowerCase();
      if (SENIORITY_KEYWORDS.some(kw => candidate.includes(kw))) {
        title = lines[i];
        break;
      }
    }

    const job = applyCommonFilters(title, company, location, url, emailIndex, urlCount, 'text');
    if (job) jobs.push(job);
  }

  if (VERBOSE && urlCount === 0) {
    console.log(`  [email ${emailIndex + 1}] (text) No LinkedIn job URLs found in body`);
  }
  return jobs;
}

// Runs the html parser first; only falls back to plaintext if html
// parsing was unavailable or came back empty, so a template change on
// LinkedIn's side degrades gracefully instead of losing the email entirely.
function parseJobsFromEmail({ html, text }, emailIndex = 0) {
  if (html) {
    const htmlJobs = parseJobsFromHtml(html, emailIndex);
    if (htmlJobs.length > 0) return htmlJobs;
    if (VERBOSE) console.log(`  [email ${emailIndex + 1}] html parse found 0 jobs — falling back to plaintext`);
  }
  if (text) return parseJobsFromPlainText(text, emailIndex);
  return [];
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
  const allJobs = bodies.flatMap((body, i) => parseJobsFromEmail(body, i));

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

// Guard so the module can be imported (e.g. from tests) without
// immediately hitting live Gmail/Supabase APIs — only run when this
// file is executed directly (`node fetch-jobs.js`).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('✗ Fatal error:', err.message);
    process.exit(1);
  });
}

export { parseJobsFromHtml, parseJobsFromPlainText, parseJobsFromEmail, isRelevantTitle, isUSLocation };
