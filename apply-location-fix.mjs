#!/usr/bin/env node
// Fixes location classifier: strips team-context city mentions; treats "based in U.S." as no-relocation
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)));
const path = join(root, 'src', 'App.jsx');
let src = readFileSync(path, 'utf8');
const orig = src;

src = src.replace(
  `    const payRangePattern = /(?:base pay|salary|compensation|pay range|range)[^.]*(?:san francisco|new york|boston|chicago|austin|los angeles|seattle|denver|atlanta|miami|dallas|houston|phoenix|portland|cambridge|manhattan|brooklyn)[^.]*/g;
    const aboutPattern = /headquartered in[^.]*\\./gi;
    const tStripped = t.replace(payRangePattern, "").replace(aboutPattern, "");`,
  `    const payRangePattern = /(?:base pay|salary|compensation|pay range|range)[^.]*(?:san francisco|new york|boston|chicago|austin|los angeles|seattle|denver|atlanta|miami|dallas|houston|phoenix|portland|cambridge|manhattan|brooklyn)[^.]*/g;
    const aboutPattern = /headquartered in[^.]*\\./gi;
    // Strip team/office location context — city mentions that describe where the *team* is, not where *you* work
    const teamContextPattern = /(?:team|office|offices|hub|region|presence|employees|colleagues|staff)[^.]*(?:across|in|based in|located in|spanning)[^.]*/gi;
    const acrossPattern = /(?:across|spanning)[^.]*(?:north america|europe|asia|apac|emea|latam|the globe|the world|regions|geographies|time zones)[^.]*/gi;
    // "based in the U.S." without a specific city = US-wide, no relocation
    const usWideSignal = /\\bbased in(?: the)?\\s+(?:u\\.?s\\.?a?|united states|north america|u\\.s\\.? or canada|us or canada)\\b/i.test(t);
    const tStripped = t.replace(payRangePattern, "").replace(aboutPattern, "").replace(teamContextPattern, "").replace(acrossPattern, "");`
);

src = src.replace(
  `      const hasRemoteOk = lines.includes("remote ok") || lines.includes("remote-ok") ||`,
  `      const hasRemoteOk = usWideSignal ||\n        lines.includes("remote ok") || lines.includes("remote-ok") ||`
);

if (src === orig) {
  console.log('✗ No changes made — patterns not found. Already applied or file differs.');
  process.exit(1);
}

writeFileSync(path, src, 'utf8');
console.log('✓ Applied: location classifier fix (team-context stripping + US-wide signal)');
