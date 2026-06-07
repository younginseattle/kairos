#!/usr/bin/env node
// Fix: applied date shows wrong day due to UTC→local timezone conversion.
// Replaces toLocaleDateString() with direct ISO date extraction (no tz math).
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const path = join(dirname(fileURLToPath(import.meta.url)), 'src', 'App.jsx');
let src = readFileSync(path, 'utf8');
const orig = src;

// 1. Add fmtAppliedDate helper before doCopyReportCsv
src = src.replace(
  `  function doCopyReportCsv() {`,
  `  function fmtAppliedDate(isoStr) {
    if (!isoStr) return "";
    const [y, m, d] = isoStr.split("T")[0].split("-");
    return \`\${+m}/\${+d}/\${y}\`;
  }

  function doCopyReportCsv() {`
);

// 2. Replace all 3 call sites
src = src.replaceAll(
  `new Date(j.applied_at || j.created_at).toLocaleDateString()`,
  `fmtAppliedDate(j.applied_at || j.created_at)`
);

if (src === orig) {
  console.log('✗ No changes — patterns not found. Already applied or file differs.');
  process.exit(1);
}

writeFileSync(path, src, 'utf8');
const count = (src.match(/fmtAppliedDate/g) || []).length;
console.log(`✓ Fixed applied date display (${count - 1} call sites updated, timezone-safe)`);
