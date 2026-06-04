import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const appPath = join(__dir, 'src/App.jsx');
let src = readFileSync(appPath, 'utf8');

// 1. Insert parseJobUrlForCheck + checkJobIsOpen after ScoreBar closing brace
const afterScoreBar = `  );
}

function PursuitBadge`;
const checkFunctions = `  );
}

// ─────────────────────────────────────────────────────────────────
// JOB STATUS CHECKER — Greenhouse + Lever public APIs are CORS-safe
// LinkedIn cannot be checked from the browser (CORS blocked)
// ─────────────────────────────────────────────────────────────────

function parseJobUrlForCheck(url) {
  if (!url) return null;
  let m = url.match(/greenhouse\\.io\\/([^/?#]+)\\/jobs\\/(\\d+)/);
  if (m) return { ats: "greenhouse", company: m[1], jobId: m[2] };
  m = url.match(/jobs\\.lever\\.co\\/([^/?#]+)\\/([a-f0-9-]{36})/);
  if (m) return { ats: "lever", company: m[1], jobId: m[2] };
  if (/linkedin\\.com\\/jobs/.test(url)) return { ats: "linkedin" };
  return null;
}

async function checkJobIsOpen(url) {
  const p = parseJobUrlForCheck(url);
  if (!p) return { open: null, reason: "unsupported" };
  if (p.ats === "linkedin") return { open: null, reason: "linkedin" };
  const apiUrl =
    p.ats === "greenhouse"
      ? \`https://boards-api.greenhouse.io/v1/boards/\${p.company}/jobs/\${p.jobId}\`
      : \`https://api.lever.co/v0/postings/\${p.company}/\${p.jobId}\`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(timer);
    return { open: res.ok, reason: res.ok ? "open" : String(res.status) };
  } catch {
    return { open: null, reason: "error" };
  }
}

function PursuitBadge`;

if (!src.includes('parseJobUrlForCheck')) {
  src = src.replace(afterScoreBar, checkFunctions);
  console.log('✓ Inserted parseJobUrlForCheck + checkJobIsOpen');
} else {
  console.log('· parseJobUrlForCheck already present, skipping');
}

// 2. Insert 3 state vars after reportCopied
const afterReportCopied = `  const [reportCopied, setReportCopied] = useState("");
  const [emailFilter,`;
const withCheckState = `  const [reportCopied, setReportCopied] = useState("");
  const [checkingJobIds, setCheckingJobIds] = useState(new Set());
  const [checkRunning,   setCheckRunning]   = useState(false);
  const [checkSummary,   setCheckSummary]   = useState(null);
  const [emailFilter,`;

if (!src.includes('checkRunning')) {
  src = src.replace(afterReportCopied, withCheckState);
  console.log('✓ Inserted check state vars');
} else {
  console.log('· check state vars already present, skipping');
}

// 3. Insert doCheckOpenJobs before doBulkDelete
const beforeBulkDelete = `  async function doBulkDelete() {`;
const withCheckHandler = `  async function doCheckOpenJobs() {
    if (checkRunning) return;
    setCheckRunning(true);
    setCheckSummary(null);
    const candidates = supabaseJobs.filter(j =>
      j.status !== "pass" && j.status !== "closed" && j.url
    );
    let checked = 0, closed = 0, skipped = 0;
    const BATCH = 5;
    for (let i = 0; i < candidates.length; i += BATCH) {
      const batch = candidates.slice(i, i + BATCH);
      setCheckingJobIds(prev => new Set([...prev, ...batch.map(j => j.id)]));
      await Promise.all(batch.map(async job => {
        const result = await checkJobIsOpen(job.url);
        setCheckingJobIds(prev => { const n = new Set(prev); n.delete(job.id); return n; });
        if (result.open === null) { if (result.reason === "linkedin") skipped++; return; }
        checked++;
        if (!result.open) { closed++; await handleStatusChange(job.id, "closed"); }
      }));
    }
    setCheckRunning(false);
    setCheckSummary({ checked, closed, skipped, total: candidates.length });
  }

  async function doBulkDelete() {`;

if (!src.includes('doCheckOpenJobs')) {
  src = src.replace(beforeBulkDelete, withCheckHandler);
  console.log('✓ Inserted doCheckOpenJobs handler');
} else {
  console.log('· doCheckOpenJobs already present, skipping');
}

// 4. Add "Closed" filter pill
const withoutClosed = `{ label: "Interviewing", status: "interviewing" },
            ].map`;
const withClosed = `{ label: "Interviewing", status: "interviewing" }, { label: "Closed", status: "closed" },
            ].map`;

if (!src.includes('{ label: "Closed", status: "closed" }')) {
  src = src.replace(withoutClosed, withClosed);
  console.log('✓ Added Closed filter pill');
} else {
  console.log('· Closed filter pill already present, skipping');
}

// 5. Add Check Closed button after the refresh button
const afterRefreshBtn = `<Btn small onClick={doRefreshSupabase} disabled={reEvalRunning}>↻</Btn>
              <Btn small onClick={() => setShowReport`;
const withCheckBtn = `<Btn small onClick={doRefreshSupabase} disabled={reEvalRunning}>↻</Btn>
              <Btn small onClick={doCheckOpenJobs} disabled={checkRunning} title="Check Greenhouse + Lever jobs for closed listings. LinkedIn requires manual check.">{checkRunning ? "Checking…" : "🔍 Check Closed"}</Btn>
              <Btn small onClick={() => setShowReport`;

if (!src.includes('Check Closed')) {
  src = src.replace(afterRefreshBtn, withCheckBtn);
  console.log('✓ Added Check Closed button');
} else {
  console.log('· Check Closed button already present, skipping');
}

// 6. Add closed count footer + checkSummary banner after pass count section
const afterPassCount = `restore all</button>
            </div>
          )}

          {[...supabaseJobs].filter(j => !dismissedSaved`;
const withClosedFooter = `restore all</button>
            </div>
          )}
          {supabaseJobs.filter(j => j.status === "closed").length > 0 && savedFilter.status !== "closed" && (
            <div style={{ marginBottom: 8, fontFamily: T.fontMono, fontSize: 9, color: T.textMuted }}>
              {supabaseJobs.filter(j => j.status === "closed").length} closed · <button onClick={() => setSavedFilter(f => ({ ...f, status: "closed" }))} style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>view</button> · <button onClick={() => supabaseJobs.filter(j => j.status === "closed").forEach(j => handleStatusChange(j.id, "new"))} style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>restore all</button>
            </div>
          )}
          {checkSummary && (
            <div style={{ marginBottom: 10, padding: "8px 12px", background: T.surface, border: \`1px solid \${T.borderFaint}\`, borderRadius: 6, fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>🔍 Checked {checkSummary.checked} job{checkSummary.checked !== 1 ? "s" : ""}{checkSummary.closed > 0 ? \` · \${checkSummary.closed} closed\` : " · all open"}{checkSummary.skipped > 0 ? \` · \${checkSummary.skipped} LinkedIn (manual check)\` : ""}</span>
              <button onClick={() => setCheckSummary(null)} style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, fontFamily: T.fontMono, fontSize: 9, padding: 0 }}>✕</button>
            </div>
          )}

          {[...supabaseJobs].filter(j => !dismissedSaved`;

if (!src.includes('supabaseJobs.filter(j => j.status === "closed").length > 0')) {
  src = src.replace(afterPassCount, withClosedFooter);
  console.log('✓ Added closed footer + checkSummary banner');
} else {
  console.log('· closed footer already present, skipping');
}

// 7. Exclude closed jobs from default pipeline view
const oldFilter = `j.status !== "pass").filter(j => {`;
const newFilter = `j.status !== "pass" && (j.status !== "closed" || savedFilter.status === "closed")).filter(j => {`;

if (!src.includes('j.status !== "closed" || savedFilter')) {
  src = src.replace(oldFilter, newFilter);
  console.log('✓ Updated pipeline filter to hide closed jobs by default');
} else {
  console.log('· pipeline filter already updated, skipping');
}

// 8. Add CLOSED badge + checking indicator to card title
const oldTitle = `<div style={{ fontFamily: T.fontSans, fontWeight: 500, fontSize: 13, color: T.textPrimary, marginBottom: 2 }}>{job.title || "Untitled"}</div>
                  <div style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, marginBottom: 8`;
const newTitle = `<div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2, flexWrap: "wrap" }}>
                    <div style={{ fontFamily: T.fontSans, fontWeight: 500, fontSize: 13, color: job.status === "closed" ? T.textMuted : T.textPrimary }}>{job.title || "Untitled"}</div>
                    {job.status === "closed" && <span style={{ fontFamily: T.fontMono, fontSize: 8, fontWeight: 700, letterSpacing: "0.1em", color: T.textMuted, background: T.surface, border: \`1px solid \${T.border}\`, borderRadius: 3, padding: "1px 5px" }}>CLOSED</span>}
                    {checkingJobIds.has(job.id) && <span className="pulse" style={{ fontFamily: T.fontMono, fontSize: 8, letterSpacing: "0.08em", color: T.textMuted }}>checking…</span>}
                  </div>
                  <div style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, marginBottom: 8`;

if (!src.includes('checkingJobIds.has(job.id)')) {
  src = src.replace(oldTitle, newTitle);
  console.log('✓ Added CLOSED badge + checking indicator to card title');
} else {
  console.log('· CLOSED badge already present, skipping');
}

writeFileSync(appPath, src, 'utf8');
console.log('\nDone! App.jsx updated.');
