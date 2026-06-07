#!/usr/bin/env node
// Fix: fallback path in handleStatusChange wasn't setting applied_at in local state,
// causing report to fall back to created_at (ingestion date) instead of applied date.
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const path = join(dirname(fileURLToPath(import.meta.url)), 'src', 'App.jsx');
let src = readFileSync(path, 'utf8');
const orig = src;

src = src.replace(
  `      if (fallbackError) return;\n      setSupabaseJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: newStatus } : j));\n      return;`,
  `      if (fallbackError) return;\n      setSupabaseJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: newStatus, ...(newStatus === "applied" && !j.applied_at ? { applied_at: new Date().toISOString() } : {}) } : j));\n      return;`
);

if (src === orig) {
  console.log('✗ No changes — pattern not found. Already applied or file differs.');
  process.exit(1);
}

writeFileSync(path, src, 'utf8');
console.log('✓ Fixed: applied_at now set in local state even when DB column is missing');
