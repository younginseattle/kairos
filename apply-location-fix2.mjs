#!/usr/bin/env node
// Fix: check remote signals in original text (not just stripped text)
// so teamContextPattern can't accidentally strip "offices or remotely in..."
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const path = join(dirname(fileURLToPath(import.meta.url)), 'src', 'App.jsx');
let src = readFileSync(path, 'utf8');
const orig = src;

src = src.replace(
  `    if (relocationCities.some(city => cityInText(city, lines))) {
      const hasRemoteOk = usWideSignal ||
        lines.includes("remote ok") || lines.includes("remote-ok") ||
        lines.includes("fully remote") || lines.includes("work from anywhere") ||
        lines.includes("remote first") || lines.includes("remote-first") ||
        lines.includes("or remote") || lines.includes("or remotely") ||
        lines.includes("remotely in") || lines.includes("remote in the u") ||
        lines.includes("remote option") || lines.includes("remote eligible") ||
        lines.includes("remote work") || lines.includes("can be remote") ||
        /work(?:ing)? remotely/.test(lines);`,
  `    if (relocationCities.some(city => cityInText(city, lines))) {
      // Check remote signals in BOTH stripped lines AND original text —
      // stripping can remove "offices or remotely in..." which kills the remote signal
      const remoteCheck = lines + "\\n" + t;
      const hasRemoteOk = usWideSignal ||
        remoteCheck.includes("remote ok") || remoteCheck.includes("remote-ok") ||
        remoteCheck.includes("fully remote") || remoteCheck.includes("work from anywhere") ||
        remoteCheck.includes("remote first") || remoteCheck.includes("remote-first") ||
        remoteCheck.includes("or remote") || remoteCheck.includes("or remotely") ||
        remoteCheck.includes("remotely in") || remoteCheck.includes("remote in the u") ||
        remoteCheck.includes("remote option") || remoteCheck.includes("remote eligible") ||
        remoteCheck.includes("remote work") || remoteCheck.includes("can be remote") ||
        /work(?:ing)? remotely/.test(remoteCheck);`
);

if (src === orig) {
  console.log('✗ No changes — pattern not found. Already applied or file differs.');
  process.exit(1);
}

writeFileSync(path, src, 'utf8');
console.log('✓ Fixed: remote signals now checked in original text, not just stripped text');
