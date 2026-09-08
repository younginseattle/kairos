#!/usr/bin/env node
/**
 * Read-only lookup: find rows in the `jobs` table by a company/title
 * substring and print their full state. For diagnosing "I don't see X in
 * the app" reports without needing direct Supabase access — this reuses
 * the same SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY secrets every other
 * script already uses. Writes nothing.
 *
 *   node --env-file=.env scripts/find-jobs.mjs --q=docker
 */

if (typeof globalThis.WebSocket === 'undefined') {
  try { globalThis.WebSocket = (await import('ws')).default; } catch { /* realtime unused here */ }
}
const { createClient } = await import('@supabase/supabase-js');

const qArg = process.argv.find(a => a.startsWith('--q='));
const QUERY = qArg ? qArg.split('=')[1] : null;
if (!QUERY) { console.error('✗ Usage: node scripts/find-jobs.mjs --q=<search term>'); process.exit(1); }

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('✗ Missing Supabase env'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const { data, error } = await supabase
  .from('jobs')
  .select('id, title, company, url, source, status, score, created_at')
  .or(`title.ilike.%${QUERY}%,company.ilike.%${QUERY}%`)
  .order('created_at', { ascending: false });

if (error) { console.error(`✗ Query failed: ${error.message}`); process.exit(1); }

console.log(`\n◆ ${data.length} row(s) matching "${QUERY}"\n`);
for (const row of data) {
  console.log(`  · [${row.id}]`);
  console.log(`      "${row.title}" — ${row.company}`);
  console.log(`      status: ${row.status}   score: ${row.score ?? 'null'}   source: ${row.source}`);
  console.log(`      created_at: ${row.created_at}`);
  console.log(`      url: ${row.url}`);
  console.log('');
}
if (data.length === 0) console.log('  No matching rows. Nothing in the table with this company/title substring.\n');
