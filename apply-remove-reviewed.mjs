#!/usr/bin/env node
// Removes the legacy "reviewed" status from App.jsx
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)));
const path = join(root, 'src', 'App.jsx');
let src = readFileSync(path, 'utf8');
const orig = src;

// 1. Remove the "Reviewed" option from StatusButtons
src = src.replace(
  `    { label: "Reviewed", value: "reviewed", color: T.blue,  bg: T.blueBg,  border: T.blueBorder  },\n    { label: "Applied",  value: "applied",  color: T.green, bg: T.greenBg, border: T.greenBorder },`,
  `    { label: "Applied",  value: "applied",  color: T.green, bg: T.greenBg, border: T.greenBorder },`
);

// 2. Simplify the reviewing count (drop the || reviewed branch)
src = src.replace(
  `supabaseJobs.filter(j => j.status === "reviewing" || j.status === "reviewed").length`,
  `supabaseJobs.filter(j => j.status === "reviewing").length`
);

if (src === orig) {
  console.log('✗ No changes made — patterns not found. Already applied or file differs.');
  process.exit(1);
}

writeFileSync(path, src, 'utf8');
console.log('✓ Applied: removed "reviewed" status from App.jsx');
