import { useState, useMemo } from "react";
import rawConnections from "./data/connections.json";

/* ═══════════════════════════════════════════════════════════════════
   NETWORK INTELLIGENCE VIEW
   Visualizes LinkedIn connections as a job-search asset.
   Data is pre-classified by src/scripts/process-connections.js.
═══════════════════════════════════════════════════════════════════ */

const ALL_SENIORITIES = [
  "C-Suite / Founder", "SVP / EVP", "VP", "Senior Director",
  "Director", "Principal / Staff", "Manager / Head", "Senior IC",
  "Associate / Analyst", "IC",
];

const ALL_FUNCTIONS = [
  "Product Management", "Engineering", "Design / UX", "Recruiting / Talent",
  "Sales / BD / GTM", "Marketing", "Executive / Leadership",
  "Program / Operations", "Other",
];

const INDUSTRY_ORDER = [
  "Observability / Monitoring",
  "AI / ML / LLMOps",
  "IT Operations / ITSM",
  "Recruiting / Talent Firms",
  "DevOps / IaC / Platform Eng",
  "Developer Tools / Productivity",
  "Cloud Native / Infra",
  "VC / PE / Investors",
  "Network / Security",
  "Cloud Providers / Hyperscalers",
  "Enterprise Tech (Big Co)",
  "Consulting / Advisory",
  "Financial Services / FinTech",
  "Aerospace / Defense / Gov",
  "Healthcare / Life Sciences",
  "Other / Misc",
];

const TARGET_INDUSTRIES = new Set([
  "Observability / Monitoring", "AI / ML / LLMOps", "IT Operations / ITSM",
  "Recruiting / Talent Firms", "DevOps / IaC / Platform Eng",
  "Developer Tools / Productivity", "Cloud Native / Infra", "VC / PE / Investors",
  "Network / Security",
]);

const SENIORITY_COLORS = (T) => ({
  "C-Suite / Founder": { color: T.amber, bg: T.amberBg, border: T.amberBorder },
  "SVP / EVP":         { color: "#f97316", bg: "rgba(249,115,22,0.1)", border: "rgba(249,115,22,0.3)" },
  "VP":                { color: T.green, bg: T.greenBg, border: T.greenBorder },
  "Senior Director":   { color: "#22d3ee", bg: "rgba(34,211,238,0.08)", border: "rgba(34,211,238,0.25)" },
  "Director":          { color: T.blue, bg: T.blueBg, border: T.blueBorder },
  "Principal / Staff": { color: "#a78bfa", bg: "rgba(167,139,250,0.1)", border: "rgba(167,139,250,0.3)" },
  "Manager / Head":    { color: T.textSecondary, bg: T.panel, border: T.border },
  "Senior IC":         { color: T.textMuted, bg: T.surface, border: T.borderFaint },
  "Associate / Analyst":{ color: T.textMuted, bg: T.surface, border: T.borderFaint },
  "IC":                { color: T.textMuted, bg: T.surface, border: T.borderFaint },
});

const NETWORK_GAPS = [
  { company: "Arize AI",      gap: "AI/ML observability — tier 1 target",             severity: "No path" },
  { company: "Dynatrace",     gap: "Observability market leader, limited connections", severity: "Thin"    },
  { company: "Databricks",    gap: "Data/AI platform — strong fit, few direct paths",  severity: "Weak"    },
  { company: "Anthropic",     gap: "AI safety platform — aspirational target",         severity: "No path" },
  { company: "Chronosphere",  gap: "Cloud-native observability — no connections found",severity: "No path" },
  { company: "Cribl",         gap: "Observability pipeline — limited connections",     severity: "Thin"    },
  { company: "FICO",          gap: "Decision intelligence — some analytics overlap",   severity: "Weak"    },
  { company: "Coralogix",     gap: "Log analytics platform — no direct connections",   severity: "No path" },
  { company: "Sumo Logic",    gap: "Observability/SIEM — very few connections",        severity: "Thin"    },
  { company: "Kentik",        gap: "Network observability — no connections found",     severity: "No path" },
];

const PAGE_SIZE = 50;

function Pill({ color, bg, border, children }) {
  return (
    <span style={{
      fontFamily: "inherit", fontSize: 10, fontWeight: 600, letterSpacing: "0.05em",
      padding: "2px 7px", borderRadius: 4, border: `1px solid ${border}`,
      background: bg, color, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function SeniorityBadge({ level, T }) {
  const c = SENIORITY_COLORS(T)[level] || { color: T.textMuted, bg: T.surface, border: T.borderFaint };
  return <Pill color={c.color} bg={c.bg} border={c.border}>{level}</Pill>;
}

function InnerTab({ label, active, onClick, T }) {
  return (
    <button onClick={onClick} style={{
      fontFamily: T.fontSans, fontSize: 12, fontWeight: 500,
      padding: "5px 14px", borderRadius: 5, border: "none", cursor: "pointer",
      transition: "all 0.15s",
      background: active ? T.panel : "transparent",
      color: active ? T.textPrimary : T.textMuted,
      boxShadow: active ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
    }}>{label}</button>
  );
}

function StatCard({ label, value, T }) {
  return (
    <div style={{
      flex: 1, minWidth: 90, background: T.surface, border: `1px solid ${T.borderFaint}`,
      borderRadius: 8, padding: "10px 14px",
    }}>
      <div style={{ fontFamily: T.fontMono, fontSize: 20, fontWeight: 600, color: T.textPrimary, lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: T.fontSans, fontSize: 11, color: T.textMuted, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function ContactRow({ c, T }) {
  const sc = SENIORITY_COLORS(T)[c.seniority] || { color: T.textMuted, bg: T.surface, border: T.borderFaint };
  return (
    <tr style={{ borderBottom: `1px solid ${T.borderFaint}` }}>
      <td style={{ padding: "7px 10px", fontFamily: T.fontSans, fontSize: 12, color: T.blue }}>
        {c.url
          ? <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ color: T.blue, textDecoration: "none" }}>
              {c.firstName} {c.lastName}
            </a>
          : `${c.firstName} ${c.lastName}`}
      </td>
      <td style={{ padding: "7px 10px", fontFamily: T.fontSans, fontSize: 11, color: T.textSecondary, maxWidth: 200 }}>{c.position}</td>
      <td style={{ padding: "7px 10px", fontFamily: T.fontSans, fontSize: 11, color: T.textMuted }}>{c.company}</td>
      <td style={{ padding: "7px 10px" }}>
        <Pill color={sc.color} bg={sc.bg} border={sc.border}>{c.seniority}</Pill>
      </td>
      <td style={{ padding: "7px 10px", fontFamily: T.fontSans, fontSize: 11, color: T.textMuted }}>{c.function}</td>
      <td style={{ padding: "7px 10px", fontFamily: T.fontSans, fontSize: 11, color: T.textMuted }}>{c.industry}</td>
    </tr>
  );
}

function ContactTable({ contacts, T }) {
  const headers = ["Name", "Title", "Company", "Seniority", "Function", "Industry"];
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${T.border}` }}>
            {headers.map(h => (
              <th key={h} style={{ padding: "6px 10px", fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", color: T.textMuted, textAlign: "left", textTransform: "uppercase" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {contacts.map((c, i) => <ContactRow key={i} c={c} T={T} />)}
        </tbody>
      </table>
    </div>
  );
}

// ─── Tab: By Industry ────────────────────────────────────────────
function IndustryTab({ connections, T }) {
  const [selectedIndustry, setSelectedIndustry] = useState(null);

  const byIndustry = useMemo(() => {
    const map = {};
    for (const c of connections) {
      if (!map[c.industry]) map[c.industry] = [];
      map[c.industry].push(c);
    }
    return map;
  }, [connections]);

  const maxCount = useMemo(() =>
    Math.max(1, ...Object.values(byIndustry).map(arr => arr.length)), [byIndustry]);

  const sorted = INDUSTRY_ORDER.filter(ind => byIndustry[ind]);

  const selectedContacts = useMemo(() => {
    if (!selectedIndustry || !byIndustry[selectedIndustry]) return [];
    return [...byIndustry[selectedIndustry]].sort((a, b) => b.priority - a.priority);
  }, [selectedIndustry, byIndustry]);

  const seniorCount = (arr) =>
    arr.filter(c => ["C-Suite / Founder", "SVP / EVP", "VP", "Senior Director"].includes(c.seniority)).length;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        {sorted.map(ind => {
          const arr = byIndustry[ind];
          const isTarget = TARGET_INDUSTRIES.has(ind);
          const isSelected = selectedIndustry === ind;
          const barColor = isTarget ? T.green : T.textMuted;
          const barWidth = Math.round((arr.length / maxCount) * 100);
          return (
            <div key={ind}
              onClick={() => setSelectedIndustry(isSelected ? null : ind)}
              style={{
                background: isSelected ? T.panelHover : T.surface,
                border: `1px solid ${isSelected ? T.border : T.borderFaint}`,
                borderRadius: 8, padding: "12px 14px", cursor: "pointer",
                transition: "all 0.15s",
              }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <span style={{ fontFamily: T.fontSans, fontSize: 12, fontWeight: 500, color: isTarget ? T.textPrimary : T.textSecondary }}>
                  {isTarget && <span style={{ color: T.green, marginRight: 5 }}>◆</span>}
                  {ind}
                </span>
                <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.textPrimary, fontWeight: 600 }}>{arr.length}</span>
              </div>
              <div style={{ fontFamily: T.fontSans, fontSize: 10, color: T.textMuted, marginBottom: 6 }}>
                {seniorCount(arr)} VP+
              </div>
              <div style={{ background: T.borderFaint, borderRadius: 2, height: 4, overflow: "hidden" }}>
                <div style={{ width: `${barWidth}%`, height: "100%", background: barColor, borderRadius: 2, transition: "width 0.4s" }} />
              </div>
            </div>
          );
        })}
      </div>

      {selectedIndustry && selectedContacts.length > 0 && (
        <div className="fade-up" style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: T.textSecondary }}>
              {selectedIndustry.toUpperCase()} — {selectedContacts.length} connections
            </span>
            <button onClick={() => setSelectedIndustry(null)}
              style={{ fontFamily: T.fontMono, fontSize: 10, background: "transparent", border: "none", color: T.textMuted, cursor: "pointer" }}>✕</button>
          </div>
          <ContactTable contacts={selectedContacts} T={T} />
        </div>
      )}
    </div>
  );
}

// ─── Tab: All Connections ────────────────────────────────────────
function AllConnectionsTab({ connections, T }) {
  const [query, setQuery] = useState("");
  const [filterSeniority, setFilterSeniority] = useState("");
  const [filterFunction, setFilterFunction] = useState("");
  const [filterIndustry, setFilterIndustry] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return connections.filter(c => {
      if (q && !`${c.firstName} ${c.lastName} ${c.position} ${c.company}`.toLowerCase().includes(q)) return false;
      if (filterSeniority && c.seniority !== filterSeniority) return false;
      if (filterFunction && c.function !== filterFunction) return false;
      if (filterIndustry && c.industry !== filterIndustry) return false;
      return true;
    });
  }, [connections, query, filterSeniority, filterFunction, filterIndustry]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const resetPage = () => setPage(0);

  const selectStyle = {
    background: T.surface, border: `1px solid ${T.border}`, color: T.textPrimary,
    fontFamily: T.fontSans, fontSize: 12, padding: "6px 10px", borderRadius: 6,
    outline: "none", cursor: "pointer",
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input
          className="jsa-input"
          style={{ flex: 2, minWidth: 180 }}
          placeholder="Search name, title, company…"
          value={query}
          onChange={e => { setQuery(e.target.value); resetPage(); }}
        />
        <select style={{ ...selectStyle, flex: 1, minWidth: 140 }} value={filterSeniority}
          onChange={e => { setFilterSeniority(e.target.value); resetPage(); }}>
          <option value="">All seniority</option>
          {ALL_SENIORITIES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={{ ...selectStyle, flex: 1, minWidth: 140 }} value={filterFunction}
          onChange={e => { setFilterFunction(e.target.value); resetPage(); }}>
          <option value="">All functions</option>
          {ALL_FUNCTIONS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select style={{ ...selectStyle, flex: 1, minWidth: 160 }} value={filterIndustry}
          onChange={e => { setFilterIndustry(e.target.value); resetPage(); }}>
          <option value="">All industries</option>
          {INDUSTRY_ORDER.map(i => <option key={i} value={i}>{i}</option>)}
        </select>
      </div>

      <div style={{ fontFamily: T.fontMono, fontSize: 10, color: T.textMuted, marginBottom: 10 }}>
        {filtered.length} connections{query || filterSeniority || filterFunction || filterIndustry ? " (filtered)" : ""}
        {totalPages > 1 && ` · page ${page + 1} of ${totalPages}`}
      </div>

      <ContactTable contacts={paginated} T={T} />

      {totalPages > 1 && (
        <div style={{ display: "flex", gap: 6, marginTop: 12, justifyContent: "center" }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            style={{ fontFamily: T.fontMono, fontSize: 11, padding: "4px 12px", borderRadius: 5, border: `1px solid ${T.border}`, background: T.surface, color: T.textSecondary, cursor: page === 0 ? "default" : "pointer", opacity: page === 0 ? 0.4 : 1 }}>
            ← Prev
          </button>
          <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.textMuted, padding: "4px 8px" }}>
            {page + 1} / {totalPages}
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
            style={{ fontFamily: T.fontMono, fontSize: 11, padding: "4px 12px", borderRadius: 5, border: `1px solid ${T.border}`, background: T.surface, color: T.textSecondary, cursor: page === totalPages - 1 ? "default" : "pointer", opacity: page === totalPages - 1 ? 0.4 : 1 }}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Priority List ──────────────────────────────────────────
function PriorityTab({ connections, T }) {
  const top50 = useMemo(() => connections.slice(0, 50), [connections]);
  return (
    <div>
      <div style={{ fontFamily: T.fontSans, fontSize: 12, color: T.textMuted, marginBottom: 12, lineHeight: 1.6 }}>
        Top 50 contacts ranked by seniority × industry relevance to your target roles.
        High-priority = senior person at a target company or recruiter with relevant scope.
      </div>
      <ContactTable contacts={top50} T={T} />
    </div>
  );
}

// ─── Tab: Recruiters ────────────────────────────────────────────
const EXEC_SEARCH_FIRMS = /true search|korn ferry|spencer stuart|heidrick|russell reynolds|egon zehnder/i;
const VC_FIRMS = /insight partners|bessemer|sequoia|andreessen|a16z|general catalyst|greylock/i;

function classifyRecruiter(c) {
  const pos = (c.position || "").toLowerCase();
  const comp = (c.company || "").toLowerCase();
  if (EXEC_SEARCH_FIRMS.test(comp)) return "Executive Search";
  if (VC_FIRMS.test(comp)) return "VC Portfolio Talent";
  if (/managing director|partner/.test(pos) && /search|recruit|talent/.test(comp)) return "Executive Search";
  if (/recruit|talent/.test(comp) && !/tech|software|cloud|data|platform/.test(comp)) return "Boutique / Independent";
  return "Internal Recruiter";
}

const RECRUITER_GROUP_ORDER = ["Executive Search", "VC Portfolio Talent", "Internal Recruiter", "Boutique / Independent"];

const RECRUITER_GROUP_COLORS = (T) => ({
  "Executive Search":     { color: T.amber, bg: T.amberBg, border: T.amberBorder },
  "VC Portfolio Talent":  { color: "#a78bfa", bg: "rgba(167,139,250,0.1)", border: "rgba(167,139,250,0.3)" },
  "Internal Recruiter":   { color: T.blue, bg: T.blueBg, border: T.blueBorder },
  "Boutique / Independent":{ color: T.textSecondary, bg: T.panel, border: T.border },
});

function RecruitersTab({ connections, T }) {
  const grouped = useMemo(() => {
    const recruiters = connections.filter(c => c.function === "Recruiting / Talent");
    const map = { "Executive Search": [], "VC Portfolio Talent": [], "Internal Recruiter": [], "Boutique / Independent": [] };
    for (const c of recruiters) {
      const type = classifyRecruiter(c);
      map[type].push({ ...c, _recruiterType: type });
    }
    return map;
  }, [connections]);

  const total = Object.values(grouped).reduce((s, arr) => s + arr.length, 0);
  const groupColors = RECRUITER_GROUP_COLORS(T);

  return (
    <div>
      <div style={{ fontFamily: T.fontMono, fontSize: 10, color: T.textMuted, marginBottom: 14 }}>
        {total} recruiters & talent professionals in your network
      </div>
      {RECRUITER_GROUP_ORDER.map(group => {
        const arr = grouped[group];
        if (!arr.length) return null;
        const gc = groupColors[group];
        return (
          <div key={group} style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", color: gc.color }}>
                {group.toUpperCase()}
              </span>
              <span style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted }}>{arr.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {arr.sort((a, b) => b.priority - a.priority).map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: T.surface, border: `1px solid ${T.borderFaint}`, borderRadius: 6 }}>
                  <div style={{ flex: 1 }}>
                    {c.url
                      ? <a href={c.url} target="_blank" rel="noopener noreferrer"
                          style={{ fontFamily: T.fontSans, fontSize: 12, color: T.blue, textDecoration: "none", fontWeight: 500 }}>
                          {c.firstName} {c.lastName}
                        </a>
                      : <span style={{ fontFamily: T.fontSans, fontSize: 12, color: T.textPrimary }}>{c.firstName} {c.lastName}</span>
                    }
                    <div style={{ fontFamily: T.fontSans, fontSize: 11, color: T.textMuted, marginTop: 1 }}>{c.position}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: T.fontSans, fontSize: 11, color: T.textSecondary }}>{c.company}</div>
                    <div style={{ marginTop: 3 }}>
                      <Pill color={gc.color} bg={gc.bg} border={gc.border}>{group}</Pill>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Tab: Network Gaps ───────────────────────────────────────────
const SEVERITY_COLORS = (T) => ({
  "No path": { color: T.red, bg: T.redBg, border: T.redBorder },
  "Thin":    { color: T.amber, bg: T.amberBg, border: T.amberBorder },
  "Weak":    { color: T.textSecondary, bg: T.panel, border: T.border },
});

function GapsTab({ connections, T }) {
  const companyCounts = useMemo(() => {
    const map = {};
    for (const c of connections) {
      const co = (c.company || "").toLowerCase();
      map[co] = (map[co] || 0) + 1;
    }
    return map;
  }, [connections]);

  const sc = SEVERITY_COLORS(T);
  return (
    <div>
      <div style={{ fontFamily: T.fontSans, fontSize: 12, color: T.textMuted, marginBottom: 14, lineHeight: 1.6 }}>
        Target companies with no direct connections or a weak network path. These are warm-outreach gaps to close.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {NETWORK_GAPS.map(g => {
          const matchCount = Object.entries(companyCounts)
            .filter(([co]) => co.includes(g.company.toLowerCase()))
            .reduce((s, [, n]) => s + n, 0);
          const sev = sc[g.severity] || sc["Weak"];
          return (
            <div key={g.company} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: T.surface, border: `1px solid ${T.borderFaint}`, borderRadius: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: T.fontSans, fontSize: 13, fontWeight: 500, color: T.textPrimary, marginBottom: 3 }}>{g.company}</div>
                <div style={{ fontFamily: T.fontSans, fontSize: 11, color: T.textMuted }}>{g.gap}</div>
              </div>
              {matchCount > 0 && (
                <div style={{ fontFamily: T.fontMono, fontSize: 10, color: T.green, background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 4, padding: "2px 7px" }}>
                  {matchCount} conn
                </div>
              )}
              <Pill color={sev.color} bg={sev.bg} border={sev.border}>{g.severity}</Pill>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────
export default function NetworkView({ T }) {
  const [activeTab, setActiveTab] = useState("industry");

  const connections = rawConnections;

  const stats = useMemo(() => {
    const total = connections.length;
    const cSuite = connections.filter(c => c.seniority === "C-Suite / Founder").length;
    const vp = connections.filter(c => ["SVP / EVP", "VP"].includes(c.seniority)).length;
    const product = connections.filter(c => c.function === "Product Management").length;
    const recruiters = connections.filter(c => c.function === "Recruiting / Talent").length;
    const industryCount = {};
    for (const c of connections) {
      if (TARGET_INDUSTRIES.has(c.industry)) {
        industryCount[c.industry] = (industryCount[c.industry] || 0) + 1;
      }
    }
    const topIndustry = Object.entries(industryCount).sort((a, b) => b[1] - a[1])[0];
    return { total, cSuite, vp, product, recruiters, topIndustry: topIndustry ? topIndustry[0] : "—" };
  }, [connections]);

  const INNER_TABS = [
    { key: "industry",   label: "By Industry" },
    { key: "all",        label: "All Connections" },
    { key: "priority",   label: "Priority List" },
    { key: "recruiters", label: "Recruiters" },
    { key: "gaps",       label: "Network Gaps" },
  ];

  if (connections.length === 0) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center" }}>
        <div style={{ fontFamily: T.fontMono, fontSize: 12, color: T.textMuted, marginBottom: 16 }}>NO CONNECTIONS DATA</div>
        <div style={{ fontFamily: T.fontSans, fontSize: 13, color: T.textSecondary, lineHeight: 1.7 }}>
          Place your LinkedIn <code style={{ fontFamily: T.fontMono, fontSize: 12, color: T.amber }}>Connections.csv</code> export
          in the project root, then run:<br />
          <code style={{ fontFamily: T.fontMono, fontSize: 12, color: T.green }}>node src/scripts/process-connections.js</code>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-up">
      {/* Summary stats */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <StatCard label="Total connections" value={stats.total.toLocaleString()} T={T} />
        <StatCard label="C-Suite / Founders" value={stats.cSuite} T={T} />
        <StatCard label="VP-level" value={stats.vp} T={T} />
        <StatCard label="Product roles" value={stats.product} T={T} />
        <StatCard label="Recruiters" value={stats.recruiters} T={T} />
        <div style={{ flex: 2, minWidth: 140, background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: T.green, marginBottom: 4 }}>TOP INDUSTRY</div>
          <div style={{ fontFamily: T.fontSans, fontSize: 12, color: T.textPrimary, lineHeight: 1.4 }}>{stats.topIndustry}</div>
        </div>
      </div>

      {/* Inner tab bar */}
      <div style={{ display: "flex", gap: 2, marginBottom: 18, background: T.surface, borderRadius: 7, padding: 3, border: `1px solid ${T.borderFaint}` }}>
        {INNER_TABS.map(t => (
          <InnerTab key={t.key} label={t.label} active={activeTab === t.key} onClick={() => setActiveTab(t.key)} T={T} />
        ))}
      </div>

      {activeTab === "industry"   && <IndustryTab connections={connections} T={T} />}
      {activeTab === "all"        && <AllConnectionsTab connections={connections} T={T} />}
      {activeTab === "priority"   && <PriorityTab connections={connections} T={T} />}
      {activeTab === "recruiters" && <RecruitersTab connections={connections} T={T} />}
      {activeTab === "gaps"       && <GapsTab connections={connections} T={T} />}
    </div>
  );
}
