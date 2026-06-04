import { useState, useEffect } from "react";
import { supabase } from './supabaseClient'
import { runJobIngestion, SOURCES, isRelevantJob } from './ingestion.js'

/* ═══════════════════════════════════════════════════════════════════
   JOB SEARCH AGENT
   Tabs: Discover · Evaluate · Saved · Tailor Resume
═══════════════════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────────────────────────
// GOOGLE FONTS
// ─────────────────────────────────────────────────────────────────
if (typeof document !== "undefined" && !document.getElementById("jsa-fonts")) {
  const link = document.createElement("link");
  link.id = "jsa-fonts"; link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Serif:ital,wght@0,300;1,300&display=swap";
  document.head.appendChild(link);
}

// ─────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────
const DARK_TOKENS = {
  bg: "#0e0f11", surface: "#141518", panel: "#1a1c21", panelHover: "#1f2228",
  border: "#2a2d35", borderFaint: "#1f2228",
  textPrimary: "#e8eaf0", textSecondary: "#b0b8cc", textMuted: "#7a8090", textInverse: "#0e0f11",
  green: "#2ecc71", greenBg: "#0d1f15", greenBorder: "#1a4a2e",
  amber: "#f39c12", amberBg: "#1f1500", amberBorder: "#4a3000",
  red: "#e74c3c", redBg: "#1f0d0b", redBorder: "#4a1a15",
  blue: "#3498db", blueBg: "#0b1520", blueBorder: "#1a3a55",
  accent: "#2ecc71", accentDim: "#1a7a45",
  fontSans: "'IBM Plex Sans', system-ui, sans-serif",
  fontMono: "'IBM Plex Mono', monospace",
  fontSerif: "'IBM Plex Serif', serif",
};

const LIGHT_TOKENS = {
  bg: "#f8f9fb", surface: "#ffffff", panel: "#f0f2f5", panelHover: "#e8ebf0",
  border: "#d4d8e2", borderFaint: "#e4e7ee",
  textPrimary: "#1a1d26", textSecondary: "#4a5165", textMuted: "#8a92a6", textInverse: "#ffffff",
  green: "#16a34a", greenBg: "#f0fdf4", greenBorder: "#bbf7d0",
  amber: "#b45309", amberBg: "#fffbeb", amberBorder: "#fde68a",
  red: "#dc2626", redBg: "#fef2f2", redBorder: "#fecaca",
  blue: "#2563eb", blueBg: "#eff6ff", blueBorder: "#bfdbfe",
  accent: "#16a34a", accentDim: "#15803d",
  fontSans: "'IBM Plex Sans', system-ui, sans-serif",
  fontMono: "'IBM Plex Mono', monospace",
  fontSerif: "'IBM Plex Serif', serif",
};

const T = { ...LIGHT_TOKENS };

// ─────────────────────────────────────────────────────────────────
// GLOBAL STYLES
// ─────────────────────────────────────────────────────────────────
function buildGlobalStyles(tokens) {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, #root { background: ${tokens.bg}; min-height: 100vh; }
    body { font-family: ${tokens.fontSans}; color: ${tokens.textPrimary}; -webkit-font-smoothing: antialiased; }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: ${tokens.bg}; }
    ::-webkit-scrollbar-thumb { background: ${tokens.border}; border-radius: 2px; }
    .jsa-input { background: ${tokens.surface}; border: 1px solid ${tokens.border}; color: ${tokens.textPrimary}; font-family: ${tokens.fontSans}; font-size: 13px; padding: 8px 11px; border-radius: 6px; width: 100%; outline: none; transition: border-color 0.15s; }
    .jsa-input:focus { border-color: ${tokens.accentDim}; }
    .jsa-input::placeholder { color: ${tokens.textMuted}; }
    .jsa-textarea { background: ${tokens.surface}; border: 1px solid ${tokens.border}; color: ${tokens.textPrimary}; font-family: ${tokens.fontSans}; font-size: 12px; padding: 10px 12px; border-radius: 6px; width: 100%; outline: none; resize: vertical; line-height: 1.6; transition: border-color 0.15s; }
    .jsa-textarea:focus { border-color: ${tokens.accentDim}; }
    .jsa-textarea::placeholder { color: ${tokens.textMuted}; }
    .score-fill { transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1); }
    .jsa-tab:hover { background: ${tokens.panelHover} !important; }
    .jsa-card-hover:hover { border-color: ${tokens.border} !important; background: ${tokens.panelHover} !important; }
    .jsa-btn:hover { opacity: 0.85; }
    .jsa-btn-ghost:hover { background: ${tokens.panelHover} !important; border-color: ${tokens.border} !important; }
    .jsa-toggle:hover { background: ${tokens.panelHover} !important; }
    details summary { cursor: pointer; list-style: none; }
    details summary::-webkit-details-marker { display: none; }
    .mono { font-family: ${tokens.fontMono}; }
    @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .fade-up { animation: fadeUp 0.25s ease forwards; }
    @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
    .pulse { animation: pulse 1.4s ease-in-out infinite; }
  `;
}

if (typeof document !== "undefined") {
  let styleEl = document.getElementById("jsa-global-styles");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "jsa-global-styles";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = buildGlobalStyles(T);
}

// ─────────────────────────────────────────────────────────────────
// DEFAULT PROFILE
// ─────────────────────────────────────────────────────────────────
const DEFAULT_PROFILE = `VP / Director-level Product Leader — Observability, Infrastructure, AI Platform

Target roles: Director / Sr Director / VP / Staff PM / Group PM
Focus areas: Observability, AI/ML Platform, Infrastructure, Data Platform, Developer Tools

Experience:
- Domotz (VP Product, 2024–Present): Bessemer-backed infrastructure observability SaaS. Drove double-digit ARR growth, <2% churn, 4x release velocity. Shipped MCP-based agentic workflow platform. 500K+ managed endpoints. AWS Marketplace distribution.
- VMware Wavefront (Director PM, 2021–2024): Owned full telemetry stack — metrics, logs, traces, analytics — processing millions of data points/sec across cloud-native/Kubernetes environments. 50% MTTR reduction. 200K+ containers/cluster scale.
- Puppet (Sr. Director & Director PM, 2017–2021): Market-leading infrastructure automation platform. 10M+ endpoints, 40K+ customers, 75% Fortune 100. Agent-based distributed architecture, automated remediation, continuous compliance.
- HPE (Group PM & Sr. PM, 2012–2017): Multi-tenant cloud monitoring platform from beta to GA. Multi-cloud distributed infrastructure observability strategy. Enterprise pricing, packaging, GTM.

Core strengths:
- Distributed telemetry: metrics, logs, traces, histograms, SLO-driven monitoring
- AI/ML pipeline observability and LLM monitoring platforms
- Agentic workflows and MCP architecture
- API-first, extensible platform products with large integration ecosystems
- Enterprise SaaS scaling: PLG, ARR growth, land-and-expand, sub-2% churn
- High-cardinality, cloud-scale data processing (Kubernetes-native, cloud-native)
- Cross-functional PM org leadership across engineering, GTM, executive stakeholders
- Agent-based architecture and automated remediation / self-healing infrastructure

Keywords: AI Observability · LLM Monitoring · Distributed Telemetry · MCP Architecture · Agentic Workflows · Kubernetes Observability · High-Cardinality Telemetry · MTTR Reduction · SLO-Driven Performance · Automated Remediation · API-First Platforms · Product-Led Growth · Cloud-Scale Data Processing · Platform Extensibility`;
// ═════════════════════════════════════════════════════════════════
// DECISION ENGINE
// ═════════════════════════════════════════════════════════════════

function calculateStretchFactor(job) {
  return (job.missing_keywords?.length || 0) + ((job.strategic_gaps?.length || 0) * 1.5);
}

function getPursuitRecommendation(job) {
  const score = job.final_score || 0, confidence = job.confidence || 0;
  const stretch = calculateStretchFactor(job);
  if (score >= 75 && confidence >= 0.7 && stretch <= 3) return "PRIORITY";
  if (score >= 65 && confidence >= 0.6 && stretch <= 5) return "STRONG";
  if (score >= 55) return "SELECTIVE";
  return "PASS";
}

function getTimeStrategy(pursuit) {
  const m = { PRIORITY: "Deep tailoring + networking", STRONG: "Tailored resume", SELECTIVE: "Light customization", PASS: "Skip" };
  return m[pursuit] || "Skip";
}

function isLowConfidence(job) {
  const jd = job.description || "";
  const hasNullScores = job.skills_match == null || job.experience_match == null || job.culture_match == null;
  const shortJd = jd.trim().length > 0 && jd.trim().length < 600;
  const cf = deriveConfidence({
    confidence_score: job.confidence_score,
    parsed: job.parsed ?? true,
    jd_text: jd,
    skills_match: job.skills_match,
    experience_match: job.experience_match,
    culture_match: job.culture_match,
  });
  return job.score != null && (cf < 0.6 || hasNullScores || shortJd);
}

function deriveConfidence({ confidence_score, parsed = true, jd_text = "", skills_match, experience_match, culture_match }) {
  let d = 30;
  if (parsed === true) d += 15; if (parsed === false) d -= 20;
  const len = (jd_text || "").trim().length;
  if (len > 800) d += 20; else if (len >= 300) d += 10; else d -= 10;
  const fc = [skills_match, experience_match, culture_match].filter(v => v != null).length;
  if (fc === 3) d += 15; else if (fc === 2) d += 5; else d -= 10;
  d = Math.max(15, Math.min(95, d));
  const b = confidence_score != null ? Math.round(confidence_score * 0.6 + d * 0.4) : d;
  return Math.max(15, Math.min(95, b)) / 100;
}

function calculateFinalScore({ skills_match, experience_match, culture_match, confidence_score, parsed = true, jd_text = "", missing_keywords = [], strategic_gaps = [], location_penalty = 0 }) {
  const mk = missing_keywords || [], sg = strategic_gaps || [];
  const base = ((skills_match ?? 0) + (experience_match ?? 0) + (culture_match ?? 0)) / 3;
  let rp = 0;
  if (skills_match == null) rp += 15; if (experience_match == null) rp += 10; if (culture_match == null) rp += 5;
  const penalty = Math.min(rp, 20), adjusted = Math.max(0, base - penalty);
  const cf = deriveConfidence({ confidence_score, parsed, jd_text, skills_match, experience_match, culture_match });
  const weighted = adjusted * (0.6 + cf * 0.4);
  const sp = Math.min(10, (mk.length + sg.length * 1.5) * 1.5);
  const boosted = Math.min(Math.max(0, weighted - sp) + ((base >= 70 && cf >= 0.7 && parsed !== false) ? 8 : 0), 100);
  const scaled = Math.round(100 * Math.pow(boosted / 100, 0.85));
  // Apply location penalty AFTER scaling — direct point deduction, not weighted
  const locPenalty = Math.abs(location_penalty); // location_penalty is negative, e.g. -10
  const final_score = Math.min(Math.max(scaled - locPenalty, 0), parsed === false ? 55 : 100);
  return { final_score, _base: Math.round(base), _penalty: penalty, _confidence_pct: Math.round(cf * 100), _stretch_penalty: Math.round(sp), _location_penalty: locPenalty, _capped: parsed === false };
}

function enrichJob(job) {
  const mk = job.missing_keywords || [], sg = job.strategic_gaps || [], jd = job.jd_text || "";
  // Classify location — use job.location, falling back to location_score hints
  const locClassification = classifyLocation(job.location || "", jd);
  const scoring = calculateFinalScore({
    skills_match:     job.skills_match,
    experience_match: job.experience_match,
    culture_match:    job.culture_match,
    confidence_score: job.confidence_score,
    parsed:           job.parsed ?? true,
    jd_text:          jd,
    missing_keywords: mk,
    strategic_gaps:   sg,
    location_penalty: locClassification.penalty,
  });
  const cf = deriveConfidence({ confidence_score: job.confidence_score, parsed: job.parsed ?? true, jd_text: jd, skills_match: job.skills_match, experience_match: job.experience_match, culture_match: job.culture_match });
  const pursuit = getPursuitRecommendation({ final_score: scoring.final_score, confidence: cf, missing_keywords: mk, strategic_gaps: sg });
  return {
    ...job, confidence: cf, ...scoring,
    _stretch:           calculateStretchFactor({ ...job, missing_keywords: mk, strategic_gaps: sg }),
    _pursuit:           pursuit,
    _time_strategy:     getTimeStrategy(pursuit),
    _location_tier:     locClassification.tier,
    _location_label:    locClassification.label,
    _location_penalty:  Math.abs(locClassification.penalty),
  };
}

function getScoreExplanations({ skills_match, experience_match, culture_match, confidence_score, parsed = true, jd_text = "", missing_keywords = [], strategic_gaps = [], location = "" }) {
  const msgs = [];
  const cp = Math.round(deriveConfidence({ confidence_score, parsed, jd_text, skills_match, experience_match, culture_match }) * 100);
  if (cp < 40) msgs.push("Very low confidence — description too vague to score reliably");
  else if (cp < 60) msgs.push("Low confidence — limited data may affect accuracy");
  if (skills_match == null) msgs.push("Score reduced — skills match unavailable");
  if (experience_match == null) msgs.push("Score reduced — experience match unavailable");
  if (culture_match == null) msgs.push("Score reduced — culture fit unavailable");
  if (parsed === false) msgs.push("Score capped — description failed to parse");
  const stretch = (missing_keywords || []).length + ((strategic_gaps || []).length * 1.5);
  if (stretch > 8) msgs.push(`Stretch penalty — ${Math.round(stretch)} combined gap signals`);
  const len = (jd_text || "").trim().length;
  if (len > 0 && len < 300) msgs.push("Short description — paste full listing for accuracy");
  // Location warnings
  const locClass = classifyLocation(location, jd_text);
  if (locClass.tier === "relocation")  msgs.push("Relocation required — −10pts applied to final score");
  if (locClass.tier === "not_remote")  msgs.push("Not remote / not Seattle area — −5pts applied to final score");
  if (locClass.tier === "hybrid" && !["seattle", "bellevue", "redmond", "wa"].some(k => (location || "").toLowerCase().includes(k))) {
    msgs.push("Hybrid outside Seattle area — −5pts applied to final score");
  }
  return msgs;
}

// ─────────────────────────────────────────────────────────────────
// PURSUIT CONFIG
// ─────────────────────────────────────────────────────────────────
const PURSUIT_CONFIG = {
  PRIORITY:  { label: "PRIORITY",  color: T.green,    bg: T.greenBg,  border: T.greenBorder, icon: "●" },
  STRONG:    { label: "STRONG",    color: T.blue,     bg: T.blueBg,   border: T.blueBorder,  icon: "●" },
  SELECTIVE: { label: "SELECTIVE", color: T.amber,    bg: T.amberBg,  border: T.amberBorder, icon: "●" },
  PASS:      { label: "PASS",      color: T.textMuted, bg: T.surface, border: T.border,      icon: "○" },
};

const REC_CONFIG = {
  apply:           { label: "Apply Now",     color: T.green,    bg: T.greenBg,  border: T.greenBorder  },
  apply_with_note: { label: "Apply w/ Note", color: T.blue,     bg: T.blueBg,   border: T.blueBorder   },
  stretch:         { label: "Stretch",       color: T.amber,    bg: T.amberBg,  border: T.amberBorder  },
  skip:            { label: "Skip",          color: T.textMuted, bg: T.surface, border: T.border        },
};

// ─────────────────────────────────────────────────────────────────
// CLAUDE PROMPTS
// ─────────────────────────────────────────────────────────────────

const FIT_PROMPT = `You are a senior career coach specializing in Product Management leadership roles. Analyze the fit between a job description and a candidate profile. Return ONLY raw JSON — no markdown fences, no explanation, no extra text.

Schema:
{
  "overall_score": integer 0-100, "confidence": number 0-100,
  "skills_match": integer 0-100, "experience_match": integer 0-100, "culture_match": integer 0-100,
  "compensation_score": integer 0-100, "work_life_balance_score": integer 0-100,
  "growth_score": integer 0-100, "location_score": integer 0-100, "company_score": integer 0-100,
  "strengths": [up to 4 short strings], "gaps": [up to 3 short strings], "quick_wins": [up to 3 short strings],
  "missing_keywords": [important JD keywords not in resume, up to 8],
  "strategic_gaps": [real gaps that could weaken candidacy, up to 4],
  "verdict": "2-3 sentence honest assessment",
  "recommendation": "apply" | "apply_with_note" | "stretch" | "skip",
  "score_explanation": { "key_factor": "string", "strengths": [2-3 strings], "weaknesses": [1-2 strings] },
  "top_candidate_signal": { "level": "HIGH | MEDIUM | LOW", "reason": "1 sentence" }
}

STRICT RULES:
- Not clearly Manager/Director/VP/Staff/Group PM level → below 60
- Outside observability/platform/infrastructure/data/AI/ML/developer tools → subtract 15+
- Experience mismatch → cap at 65. Vague/minimal JD → confidence below 50, score below 60
- Strong fit signals (score 75+): distributed telemetry, LLM/AI observability, ML pipeline monitoring, agentic workflows, MCP, Kubernetes-native platforms, high-cardinality data, SLO monitoring, automated remediation, API-first platforms, cloud-scale SaaS
- Good fit signals (score 65-75): data platforms, developer tools, infrastructure automation, cloud-native products, PLG SaaS, enterprise B2B platform PM
- Candidate has 10+ years, VP/Director-level, Seattle-based, strong technical depth in distributed systems — do not penalize for "overqualified" at Director level
- LOCATION (candidate is Seattle-based, no relocation): Always scan the FULL job description for remote signals ("or remote", "or remotely", "remotely in", "remote option", "remote eligible", "work remotely") — if any are present, treat as remote regardless of what the location field says. Remote=95-100, Seattle/WA area=90-95, Hybrid Seattle=80-85, Hybrid elsewhere=60-75, In-office non-Seattle=40-60, Requires relocation=10-30
- work_life_balance_score: 85-100=remote-first or async culture, explicit flexibility signals, generous PTO, established company with balance-positive signals; 70-84=hybrid with flexibility, public/established company, no on-call signals, standard benefits; 50-69=high-growth startup, "fast-paced"/"high-velocity"/"wear many hats" language, implicit intensity, Series A/B; 30-49=on-call required, "always-on" culture, early-stage startup, 24/7 availability signals, explicit high-intensity language
SCORING: weight experience_match 40%, skills_match 30%, role level gate. Most jobs 50-75.`;

// Updated Search Plan prompt — explicitly surfaces FAANG career pages
// since those companies are inaccessible via Greenhouse/Lever APIs
const SEARCH_PLAN_PROMPT = `You are a senior PM recruiter and career strategist. Generate a targeted job search plan for a VP/Director-level Product leader with background in observability, infrastructure, and platform SaaS. Return ONLY raw valid JSON — no markdown, no comments.

Schema:
{
  "target_titles": string[],
  "faang_links": [{ "company": string, "url": string, "search_tip": string }],
  "companies": [{ "name": string, "career_url": string, "why": string }],
  "search_links": [{ "platform": string, "label": string, "url": string }],
  "tips": string[]
}

Rules:
- target_titles: exactly 6 specific title variations relevant to platform/infra/observability PM roles
- faang_links: exactly 5 entries, one per FAANG company (Google, Apple, Microsoft, Amazon, Meta).
  For each, provide the DIRECT career search URL pre-filtered for Product Manager roles, and a 1-sentence tip on how to find relevant platform/infra PM roles at that company specifically.
  Use these base URLs:
  Google: https://careers.google.com/jobs/results/?q=product+manager&employment_type=FULL_TIME
  Apple: https://jobs.apple.com/en-us/search?search=product+manager&sort=newest
  Microsoft: https://jobs.microsoft.com/en/jobs?q=product+manager&l=
  Amazon: https://amazon.jobs/en/search?query=product+manager&category[]=product-management
  Meta: https://www.metacareers.com/jobs?q=product+manager&divisions[]=product+management
- companies: exactly 8 non-FAANG companies in observability/platform/infra/cloud that are strong fits. Use real career page URLs.
- search_links: exactly 5 entries. Use these EXACT URLs — do not alter them:
  { "platform": "LinkedIn", "label": "Director/VP/Staff PM – Platform, Observability, Infra (Remote)", "url": "https://www.linkedin.com/jobs/search/?keywords=director+VP+staff+%22product+manager%22+platform+observability+infrastructure&f_E=5&f_WT=2" }
  { "platform": "Indeed", "label": "Director/VP PM – Platform & Observability (Remote)", "url": "https://www.indeed.com/jobs?q=director+OR+VP+OR+staff+%22product+manager%22+platform+OR+observability+OR+infrastructure&l=Remote&sc=0kf%3Aattr(DSQF7)%3B" }
  { "platform": "Google Jobs", "label": "Director/VP PM – Platform & Observability (Remote)", "url": "https://www.google.com/search?q=%22director+of+product%22+OR+%22VP+of+product%22+OR+%22group+product+manager%22+observability+OR+platform+OR+infrastructure+remote&ibp=htl;jobs" }
  { "platform": "Google Jobs", "label": "Staff/Principal PM – Infrastructure & DevTools (Remote)", "url": "https://www.google.com/search?q=%22staff+product+manager%22+OR+%22principal+product+manager%22+infrastructure+OR+%22developer+tools%22+OR+platform+remote&ibp=htl;jobs" }
  { "platform": "Google Jobs", "label": "Head of Product – AI/ML Platform (Remote or Seattle)", "url": "https://www.google.com/search?q=%22head+of+product%22+OR+%22director+of+product%22+%22AI+platform%22+OR+%22ML+platform%22+OR+%22data+platform%22+remote+OR+Seattle&ibp=htl;jobs" }
- tips: exactly 3 actionable search tips specifically for platform/infra PM roles`;

const TAILOR_PROMPT = `You are an elite executive resume strategist specializing in VP/Director Product roles in observability, infrastructure, AI/ML, and platform SaaS. Your job is to POSITION this candidate as the obvious top-tier choice for the target role. Return ONLY raw JSON. No markdown. No explanation. No trailing text after the closing brace.

CRITICAL: Your entire response must be valid, complete JSON. Do not truncate. If content would be too long, write shorter bullets rather than cutting off mid-response.

Schema: { "headline": string, "summary": string, "priority_experiences": string[], "keywords": string[], "missing_keywords": string[], "sections": [{ "title": string, "entries": [{ "heading": string, "relevance_score": number, "keep": boolean, "bullets": string[] }] }], "strategic_gaps": string[], "positioning_strategy": string, "transformation_notes": string[] }

EXECUTIVE RESUME PHILOSOPHY:
- This is a VP/Director-level executive resume, not a standard resume. Show TRANSFORMATION and LEADERSHIP BRAND, not just tasks.
- Every bullet uses the formula: [Leadership Action] + [Strategic Initiative] + [Business Outcome at Scale]
- Bullets must lead with IMPACT (metric or outcome) — never start with a verb or responsibility statement.
- Frame experience as "what changed because of you" — before/after states, scale of impact, organizational transformation.
- Show span of control: team size, budget ownership, P&L responsibility, reporting structure context.

BULLET WRITING RULES (from Resume Bullet Writer skill):
- Apply X-Y-Z formula: "Accomplished [X] as measured by [Y] by doing [Z]"
- Every bullet must have at least ONE specific metric (%, $, scale, time saved, users, endpoints)
- Max 2 lines per bullet. If too long, prioritize the most impressive metric.
- Active verbs only — never "responsible for", "helped with", "assisted in", "participated in"
- Strong verbs: Drove, Architected, Scaled, Delivered, Reduced, Grew, Unified, Launched, Owned
- Do NOT invent metrics or facts not in the original resume — use conservative estimates only if clearly stated

ATS + KEYWORD RULES (from ATS Optimizer + Tech Resume Optimizer skills):
- Extract exact keyword phrases from the JD and incorporate them naturally into bullets and summary
- Place critical keywords in: summary (2-3x), skills, and first bullet of most relevant roles
- Use exact JD terminology — if JD says "distributed systems" use that, not "scalable architecture"
- For missing_keywords: list only terms from JD that are genuinely absent from the resume
- Never keyword-stuff — incorporate naturally in context

TAILORING RULES (from Resume Tailor skill):
- Reorder experience bullets so most JD-relevant achievements lead each role
- Rewrite summary to mirror the target role's key requirements and language
- Highlight transferable signals: Wavefront telemetry → LLM/AI observability; Puppet agent scale → enterprise platform; Domotz MCP → agentic AI
- Show "Inherited [situation] → Implemented [change] → Achieved [outcome]" transformation arcs where possible

CANDIDATE-SPECIFIC LANGUAGE UPGRADES:
- "network monitoring" → "distributed infrastructure observability"
- "devices" → "infrastructure endpoints"
- "Domotz platform" → "Bessemer-backed infrastructure observability SaaS"
- "alerting" → "intelligent alerting and automated remediation"
- "integrations" → "API-first integration ecosystem"
- Add where truthfully applicable: cloud-scale, high-cardinality telemetry, enterprise-grade, Kubernetes-native, PLG, land-and-expand

SCORING:
1. relevance_score per role 0-100, keep=false if <40
2. Max 3 bullets per role
3. Max 4 keywords, 4 missing_keywords, 3 strategic_gaps, 3 transformation_notes
4. positioning_strategy: 2-3 sentences on how to frame this candidate as the obvious hire for this specific role`;

// ─────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────

function trunc(s = "", n = 100) { return s.length > n ? s.slice(0, n) + "…" : s; }
function scoreColor(n) { return n >= 75 ? T.green : n >= 50 ? T.amber : T.red; }

// ─────────────────────────────────────────────────────────────────
// LOCATION CLASSIFICATION
// Candidate base: Seattle, WA. No relocation. Will travel.
// ─────────────────────────────────────────────────────────────────

/**
 * Classifies a location string into one of four tiers:
 *   "remote"      — fully remote, no penalty
 *   "local"       — Seattle / WA / Pacific Northwest, no penalty
 *   "hybrid"      — hybrid arrangement, -2 pts
 *   "not_remote"  — in-office outside Seattle area, -5 pts
 *   "relocation"  — requires moving to another city, -10 pts
 *
 * Returns { tier, penalty, label }
 */
export function classifyLocation(locationStr = "", jdText = "") {
  const loc = (locationStr || "").toLowerCase().trim();

  // ── Shared city lists ────────────────────────────────────────────
  const seattleKeywords = [
    "seattle", "bellevue", "redmond", "kirkland", "bothell", "renton",
    "tacoma", "olympia", "pacific northwest", "pnw",
    "wa,", ", wa", "washington state",
  ];

  const relocationCities = [
    // US metros
    "new york", "san francisco", "sf,", "nyc", "manhattan", "brooklyn",
    "austin", "boston", "chicago", "los angeles", "la,", "denver", "atlanta",
    "miami", "dallas", "houston", "phoenix", "portland", "san jose",
    "mountain view", "menlo park", "palo alto", "cupertino", "sunnyvale",
    "cambridge", "pittsburgh", "detroit", "philadelphia", "washington, dc",
    "washington dc", "minneapolis", "salt lake city", "nashville", "raleigh",
    "san diego", "charlotte", "indianapolis", "columbus",
    // Canada
    "toronto", "vancouver", "montreal", "calgary", "ottawa",
    // Europe
    "london", "dublin", "amsterdam", "berlin", "paris", "madrid", "barcelona",
    "munich", "frankfurt", "hamburg", "zurich", "geneva", "stockholm",
    "copenhagen", "oslo", "helsinki", "warsaw", "prague", "budapest",
    "vienna", "brussels", "milan", "rome", "lisbon",
    // Asia-Pacific
    "singapore", "tokyo", "sydney", "melbourne", "bangalore", "bengaluru",
    "mumbai", "delhi", "hyderabad", "hong kong", "seoul", "taipei", "beijing",
    "shanghai", "shenzhen",
    // Other
    "dubai", "tel aviv",
  ];

  // Word-boundary city match — prevents "rome" matching inside "prometheus",
  // "oslo" inside "oslo-based" is fine but "milan" inside "similar" is not.
  function cityInText(city, text) {
    const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?<![a-z])' + escaped + '(?![a-z])', 'i');
    return re.test(text);
  }

  function classifyText(text) {
    const t = (text || "").toLowerCase();

    const payRangePattern = /(?:base pay|salary|compensation|pay range|range)[^.]*(?:san francisco|new york|boston|chicago|austin|los angeles|seattle|denver|atlanta|miami|dallas|houston|phoenix|portland|cambridge|manhattan|brooklyn)[^.]*/g;
    const aboutPattern = /headquartered in[^.]*\./gi;
    const tStripped = t.replace(payRangePattern, "").replace(aboutPattern, "");

    const lines = tStripped.split(/[\n\r]+/).filter(line => {
      const l = line.trim().toLowerCase();
      if ((l.includes("usd") || l.includes("salary") || l.includes("pay range") || l.includes("base pay") || l.includes("compensation")) &&
          relocationCities.some(city => cityInText(city, l))) return false;
      return true;
    }).join("\n");
    if (relocationCities.some(city => cityInText(city, lines))) {
      const hasRemoteOk = lines.includes("remote ok") || lines.includes("remote-ok") ||
        lines.includes("fully remote") || lines.includes("work from anywhere") ||
        lines.includes("remote first") || lines.includes("remote-first") ||
        lines.includes("or remote") || lines.includes("or remotely") ||
        lines.includes("remotely in") || lines.includes("remote in the u") ||
        lines.includes("remote option") || lines.includes("remote eligible") ||
        lines.includes("remote work") || lines.includes("can be remote") ||
        /work(?:ing)? remotely/.test(lines);
      const hasSeattle = seattleKeywords.some(kw => cityInText(kw, lines));
      if (!hasRemoteOk && !hasSeattle) {
        const matchedCity = relocationCities.find(city => cityInText(city, lines));
        const label = matchedCity
          ? matchedCity.charAt(0).toUpperCase() + matchedCity.slice(1).split(",")[0]
          : "Non-Seattle office";
        return { tier: "relocation", penalty: -10, label: "Relocation required (" + label + ")" };
      }
    }
    if (seattleKeywords.some(kw => cityInText(kw, lines))) {
      if (lines.includes("hybrid")) return { tier: "hybrid", penalty: -2, label: "Hybrid (Seattle area)" };
      return { tier: "local", penalty: 0, label: "Seattle area" };
    }
    const remoteSignals = ["remote", "work from home", "wfh", "distributed", "anywhere"];
    if (remoteSignals.some(kw => lines.includes(kw))) {
      return { tier: "remote", penalty: 0, label: "Remote" };
    }
    return null;
  }

  // Step 1: Try location metadata — skip if obviously generic
  const genericValues = ["", "unknown", "united states", "us", "usa", "anywhere", "worldwide", "global"];
  const locIsGeneric = !loc || genericValues.includes(loc);

  if (!locIsGeneric) {
    const remoteKeywords = ["remote", "work from home", "wfh", "distributed", "anywhere"];
    if (remoteKeywords.some(kw => loc.includes(kw))) {
      if (relocationCities.some(city => loc.includes(city))) {
        const matchedCity = relocationCities.find(city => loc.includes(city));
        return { tier: "not_remote", penalty: -5, label: "Remote (" + (matchedCity || "non-Seattle") + " preferred)" };
      }
      return { tier: "remote", penalty: 0, label: "Remote" };
    }
    if (seattleKeywords.some(kw => loc.includes(kw))) {
      if (loc.includes("hybrid")) return { tier: "hybrid", penalty: -2, label: "Hybrid (Seattle area)" };
      return { tier: "local", penalty: 0, label: "Seattle area" };
    }
    if (loc.includes("hybrid")) return { tier: "not_remote", penalty: -5, label: "Hybrid (not Seattle)" };
    const relocationKeywords = ["relocation", "relocate", "must relocate", "on-site required", "onsite required", "in-office"];
    if (relocationKeywords.some(kw => loc.includes(kw))) {
      return { tier: "relocation", penalty: -10, label: "Relocation required" };
    }
    if (relocationCities.some(city => loc.includes(city))) {
      const hasSeattle = seattleKeywords.some(kw => loc.includes(kw));
      if (!hasSeattle) {
        // Before penalizing, check if the JD description says remote is an option
        const jd = (jdText || "").toLowerCase();
        const jdHasRemote =
          jd.includes("or remote") || jd.includes("or remotely") ||
          jd.includes("remotely in") || jd.includes("remote in the u") ||
          jd.includes("remote ok") || jd.includes("remote-ok") ||
          jd.includes("fully remote") || jd.includes("work from anywhere") ||
          jd.includes("remote first") || jd.includes("remote-first") ||
          jd.includes("remote option") || jd.includes("remote eligible") ||
          jd.includes("remote work") || jd.includes("can be remote") ||
          /work(?:ing)? remotely/.test(jd);
        if (jdHasRemote) {
          const matchedCity = relocationCities.find(city => loc.includes(city));
          const label = matchedCity
            ? matchedCity.charAt(0).toUpperCase() + matchedCity.slice(1).split(",")[0]
            : "office";
          return { tier: "remote", penalty: 0, label: `Remote (${label} office optional)` };
        }
        const matchedCity = relocationCities.find(city => loc.includes(city));
        const label = matchedCity.charAt(0).toUpperCase() + matchedCity.slice(1).split(",")[0];
        return { tier: "relocation", penalty: -10, label: "Relocation required (" + label + ")" };
      }
    }
    return { tier: "not_remote", penalty: -5, label: "Office (location unclear)" };
  }

  // Step 2: Location metadata is generic — scan JD text
  if (jdText) {
    const fromJd = classifyText(jdText);
    if (fromJd) return fromJd;
  }

  // Step 3: Truly unknown — assume remote-friendly
  return { tier: "remote", penalty: 0, label: "Remote" };
}
// ─────────────────────────────────────────────────────────────────
// API FUNCTIONS
// ─────────────────────────────────────────────────────────────────

async function callClaude({ apiKey, system, userMessage, maxTokens = 1500 }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey.trim(), "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTokens, system, messages: [{ role: "user", content: userMessage }] }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Claude API: ${data.error.message}`);
  const raw = data.content.map(b => b.text || "").join("").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();
  return JSON.parse(raw);
}

async function generateSearchPlan({ apiKey, profile }) { return callClaude({ apiKey, system: SEARCH_PLAN_PROMPT, userMessage: `CANDIDATE PROFILE:\n${profile}`, maxTokens: 2500 }); }
async function runEvaluation({ apiKey, jd, profile, location }) { return callClaude({ apiKey, system: FIT_PROMPT, userMessage: `JOB DESCRIPTION:\n${jd}\n\nLOCATION: ${location || "Not specified"}\n\nCANDIDATE PROFILE:\n${profile}`, maxTokens: 1500 }); }
async function tailorResume({ apiKey, resume, jd, profile }) { return callClaude({ apiKey, system: TAILOR_PROMPT, userMessage: `JOB DESCRIPTION:\n${jd}\n\nMASTER RESUME:\n${resume}\n\nCANDIDATE PROFILE:\n${profile}`, maxTokens: 6000 }); }



// ─────────────────────────────────────────────────────────────────
// UI PRIMITIVES
// ─────────────────────────────────────────────────────────────────

function Label({ children, style = {} }) {
  return <div style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: T.textMuted, marginBottom: 6, ...style }}>{children}</div>;
}
function Divider({ style = {} }) {
  return <div style={{ height: 1, background: T.borderFaint, margin: "14px 0", ...style }} />;
}
function Card({ children, style = {}, onClick }) {
  return <div onClick={onClick} style={{ background: T.panel, border: `1px solid ${T.borderFaint}`, borderRadius: 8, padding: 12, marginBottom: 8, cursor: onClick ? "pointer" : "default", transition: "background 0.15s, border-color 0.15s", ...style }}>{children}</div>;
}
function Btn({ children, primary, small, onClick, disabled, style = {} }) {
  const base = { fontFamily: T.fontSans, fontWeight: 500, fontSize: small ? 11 : 12, padding: small ? "4px 10px" : "8px 16px", borderRadius: 6, cursor: disabled ? "default" : "pointer", border: "none", transition: "opacity 0.15s", opacity: disabled ? 0.5 : 1 };
  const theme = primary ? { background: T.accent, color: T.textInverse } : { background: T.surface, color: T.textSecondary, border: `1px solid ${T.border}` };
  return <button className={primary ? "jsa-btn" : "jsa-btn-ghost"} onClick={onClick} disabled={disabled} style={{ ...base, ...theme, ...style }}>{children}</button>;
}
function Pill({ children, color, bg, border, style = {} }) {
  return <span style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 3, color: color || T.textMuted, background: bg || T.surface, border: `1px solid ${border || T.border}`, ...style }}>{children}</span>;
}
function ErrBox({ msg }) {
  if (!msg) return null;
  return <div style={{ marginTop: 10, padding: "8px 12px", background: T.redBg, border: `1px solid ${T.redBorder}`, borderRadius: 6, fontSize: 12, color: T.red, fontFamily: T.fontSans }}>{msg}</div>;
}

function FilterBar({ filter, onChange, pills = [], placeholder = "Search…", count, total }) {
  const inputStyle = { fontFamily: T.fontMono, fontSize: 10, background: T.surface, border: `1px solid ${T.border}`, color: T.textPrimary, borderRadius: 4, padding: "4px 9px", outline: "none", width: 160 };
  const pillStyle = (active) => ({ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.07em", padding: "3px 9px", borderRadius: 3, cursor: "pointer", border: `1px solid ${active ? T.accentDim : T.border}`, background: active ? T.greenBg : "transparent", color: active ? T.green : T.textMuted, transition: "all 0.12s" });
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 10, padding: "8px 12px", background: T.surface, border: `1px solid ${T.borderFaint}`, borderRadius: 6 }}>
      <input className="jsa-input" style={{ ...inputStyle, width: 170 }} placeholder={placeholder}
        value={filter.text || ""} onChange={e => onChange({ ...filter, text: e.target.value })} />
      {pills.map(({ key, label, value }) => (
        <button key={value} onClick={() => onChange({ ...filter, [key]: value })} style={pillStyle(filter[key] === value)}>
          {label}
        </button>
      ))}
      {(filter.text || pills.some(p => filter[p.key] !== "all" && filter[p.key] !== undefined)) && (
        <button onClick={() => onChange(Object.fromEntries(["text", ...pills.map(p => p.key)].map(k => [k, k === "text" ? "" : "all"])))}
          style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, background: "none", border: "none", cursor: "pointer", padding: "3px 5px" }}>
          ✕ clear
        </button>
      )}
      {count !== undefined && total !== undefined && count !== total && (
        <span style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, marginLeft: "auto" }}>{count} / {total}</span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// SCORE NUMBER
// ─────────────────────────────────────────────────────────────────
function ScoreNum({ score, hero = false }) {
  const pct = Math.max(0, Math.min(100, score || 0));
  const color = scoreColor(pct);
  return (
    <span style={{ fontFamily: T.fontMono, fontSize: hero ? 48 : 24, fontWeight: 700, color, lineHeight: 1, flexShrink: 0 }}>{pct}</span>
  );
}

function ScoreBar({ label, score, compact = false }) {
  const color = scoreColor(score || 0);
  if (compact) return (
    <div style={{ marginBottom: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ fontFamily: T.fontSans, fontSize: 10, color: T.textMuted }}>{label}</span>
        <span style={{ fontFamily: T.fontMono, fontSize: 10, color }}>{score ?? "—"}</span>
      </div>
      <div style={{ height: 2, background: T.border, borderRadius: 1, overflow: "hidden" }}><div className="score-fill" style={{ height: "100%", width: `${score ?? 0}%`, background: color }} /></div>
    </div>
  );
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontFamily: T.fontSans, fontSize: 12, color: T.textSecondary }}>{label}</span>
        <span style={{ fontFamily: T.fontMono, fontSize: 12, fontWeight: 500, color }}>{score}%</span>
      </div>
      <div style={{ height: 3, background: T.border, borderRadius: 2, overflow: "hidden" }}><div className="score-fill" style={{ height: "100%", width: `${score}%`, background: color }} /></div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// JOB STATUS CHECKER — Greenhouse + Lever public APIs are CORS-safe
// LinkedIn cannot be checked from the browser (CORS blocked)
// ─────────────────────────────────────────────────────────────────

function parseJobUrlForCheck(url) {
  if (!url) return null;
  let m = url.match(/greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/);
  if (m) return { ats: "greenhouse", company: m[1], jobId: m[2] };
  m = url.match(/jobs\.lever\.co\/([^/?#]+)\/([a-f0-9-]{36})/);
  if (m) return { ats: "lever", company: m[1], jobId: m[2] };
  if (/linkedin\.com\/jobs/.test(url)) return { ats: "linkedin" };
  return null;
}

async function checkJobIsOpen(url) {
  const p = parseJobUrlForCheck(url);
  if (!p) return { open: null, reason: "unsupported" };
  if (p.ats === "linkedin") return { open: null, reason: "linkedin" };
  const apiUrl =
    p.ats === "greenhouse"
      ? `https://boards-api.greenhouse.io/v1/boards/${p.company}/jobs/${p.jobId}`
      : `https://api.lever.co/v0/postings/${p.company}/${p.jobId}`;
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

function PursuitBadge({ pursuit, strategy, compact = false }) {
  if (!pursuit) return null;
  const cfg = PURSUIT_CONFIG[pursuit] || PURSUIT_CONFIG.PASS;
  if (compact) return <Pill color={cfg.color} bg={cfg.bg} border={cfg.border}>{cfg.icon} {cfg.label}</Pill>;
  return (
    <div style={{ marginTop: 10, padding: "10px 12px", background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: strategy ? 4 : 0 }}>
        <span style={{ color: cfg.color, fontSize: 10 }}>●</span>
        <span style={{ fontFamily: T.fontMono, fontSize: 11, fontWeight: 600, color: cfg.color, letterSpacing: "0.08em" }}>{cfg.label} PURSUIT</span>
      </div>
      {strategy && <div style={{ fontFamily: T.fontSans, fontSize: 11, color: cfg.color, opacity: 0.75, paddingLeft: 18 }}>{strategy}</div>}
    </div>
  );
}

function RecBadge({ rec }) {
  const r = REC_CONFIG[rec] || REC_CONFIG.apply_with_note;
  return <Pill color={r.color} bg={r.bg} border={r.border}>{r.label}</Pill>;
}

function TopCandidateSignal({ signal }) {
  if (!signal?.level && !signal?.likelihood) return null;
  const level = signal.level || signal.likelihood;
  const map = { HIGH: { color: T.green, bg: T.greenBg, border: T.greenBorder }, MEDIUM: { color: T.amber, bg: T.amberBg, border: T.amberBorder }, LOW: { color: T.textMuted, bg: T.surface, border: T.border } };
  const c = map[level] || map.LOW;
  return (
    <div style={{ marginTop: 8, padding: "8px 12px", background: c.bg, border: `1px solid ${c.border}`, borderRadius: 6 }}>
      <div style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", color: c.color, marginBottom: signal.reason ? 4 : 0 }}>TOP CANDIDATE · {level}</div>
      {signal.reason && <div style={{ fontFamily: T.fontSans, fontSize: 11, color: c.color, opacity: 0.8 }}>{signal.reason}</div>}
    </div>
  );
}

function ScoreExplanationBlock({ explanation }) {
  if (!explanation) return null;
  const { key_factor, strengths, weaknesses } = explanation;
  return (
    <div style={{ marginTop: 8, padding: "10px 12px", background: T.surface, border: `1px solid ${T.borderFaint}`, borderRadius: 6 }}>
      {key_factor && <div style={{ fontFamily: T.fontSans, fontSize: 11, color: T.textSecondary, marginBottom: 8 }}><span style={{ color: T.textMuted, fontFamily: T.fontMono, fontSize: 9, letterSpacing: "0.08em" }}>KEY FACTOR </span>{key_factor}</div>}
      {strengths?.map((s, i) => <div key={i} style={{ fontFamily: T.fontSans, fontSize: 11, color: T.green, paddingLeft: 14, position: "relative", marginBottom: 2 }}><span style={{ position: "absolute", left: 0, fontFamily: T.fontMono }}>+</span>{s}</div>)}
      {weaknesses?.map((w, i) => <div key={i} style={{ fontFamily: T.fontSans, fontSize: 11, color: T.red, paddingLeft: 14, position: "relative", marginBottom: 2, marginTop: i === 0 ? 4 : 0 }}><span style={{ position: "absolute", left: 0, fontFamily: T.fontMono }}>−</span>{w}</div>)}
    </div>
  );
}

function ScoreWarnings({ job, jd_text = "" }) {
  const msgs = getScoreExplanations({ ...job, jd_text, location: job.location || "" });
  if (!msgs.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      {msgs.map((msg, i) => <div key={i} style={{ fontFamily: T.fontSans, fontSize: 11, color: T.amber, paddingLeft: 12, position: "relative", marginBottom: 3, lineHeight: 1.5 }}><span style={{ position: "absolute", left: 0, fontFamily: T.fontMono, fontSize: 10 }}>!</span>{msg}</div>)}
    </div>
  );
}

function ScoreMeta({ enriched }) {
  if (!enriched) return null;
  const { _base, _confidence_pct, _penalty, _stretch_penalty, _location_penalty, _capped } = enriched;
  return (
    <div style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, lineHeight: 1.8, textAlign: "right" }}>
      <span>raw {_base}</span><span style={{ margin: "0 4px", color: T.borderFaint }}>·</span><span>conf {_confidence_pct}%</span>
      {_penalty > 0 && <><span style={{ margin: "0 4px", color: T.borderFaint }}>·</span><span style={{ color: T.red }}>−{_penalty}pts</span></>}
      {_stretch_penalty > 0 && <><span style={{ margin: "0 4px", color: T.borderFaint }}>·</span><span style={{ color: T.amber }}>stretch −{Math.round(_stretch_penalty)}</span></>}
      {_location_penalty > 0 && <><span style={{ margin: "0 4px", color: T.borderFaint }}>·</span><span style={{ color: T.amber }}>location −{_location_penalty}</span></>}
      {_capped && <><span style={{ margin: "0 4px", color: T.borderFaint }}>·</span><span style={{ color: T.red }}>capped</span></>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// LOCATION BADGE
// Shows a warning when a job requires relocation, is not remote,
// or has a hybrid arrangement outside the Seattle area.
// ─────────────────────────────────────────────────────────────────
function LocationBadge({ job }) {
  const tier  = job._location_tier;
  const label = job._location_label;
  if (!tier || tier === "remote" || tier === "local") return null;

  const cfg = {
    relocation: { color: T.red,   bg: T.redBg,   border: T.redBorder,   icon: "✕", text: label || "Relocation required" },
    not_remote: { color: T.amber, bg: T.amberBg,  border: T.amberBorder, icon: "⊘", text: label || "Not remote"          },
    hybrid:     { color: T.amber, bg: T.amberBg,  border: T.amberBorder, icon: "↔", text: label || "Hybrid"              },
  }[tier];

  if (!cfg) return null;
  return (
    <div style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 4 }}>
      <span style={{ fontFamily: T.fontMono, fontSize: 9, color: cfg.color }}>{cfg.icon}</span>
      <span style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", color: cfg.color }}>
        {cfg.text.toUpperCase()}
        {job._location_penalty > 0 && <span style={{ opacity: 0.75 }}> · −{job._location_penalty}pts</span>}
      </span>
    </div>
  );
}

function ScoreBreakdown({ job }) {
  const fields = [{ label: "Compensation", key: "compensation_score" }, { label: "Work/Life", key: "work_life_balance_score" }, { label: "Growth", key: "growth_score" }, { label: "Location", key: "location_score" }, { label: "Company", key: "company_score" }, { label: "Confidence", key: "confidence_score" }];
  if (!fields.some(f => job[f.key] != null)) return null;
  return (
    <div style={{ marginTop: 10, padding: "10px 12px", background: T.surface, border: `1px solid ${T.borderFaint}`, borderRadius: 6 }}>
      <Label style={{ marginBottom: 8 }}>Score Breakdown</Label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
        {fields.map(({ label, key }) => <ScoreBar key={key} label={label} score={job[key]} compact />)}
      </div>
    </div>
  );
}

function StatusButtons({ jobId, currentStatus, onStatusChange }) {
  const OPTIONS = [
    { label: "Reviewed", value: "reviewed", color: T.blue,  bg: T.blueBg,  border: T.blueBorder  },
    { label: "Applied",  value: "applied",  color: T.green, bg: T.greenBg, border: T.greenBorder },
    { label: "Rejected", value: "rejected", color: T.red,   bg: T.redBg,   border: T.redBorder   },
    { label: "Closed",   value: "closed",   color: T.textMuted, bg: T.surface, border: T.border  },
  ];
  return (
    <div style={{ display: "flex", gap: 5, marginTop: 10, flexWrap: "wrap" }}>
      {OPTIONS.map(({ label, value, color, bg, border }) => {
        const active = currentStatus === value;
        return <button key={value} onClick={() => onStatusChange(jobId, value)} style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", padding: "3px 9px", borderRadius: 3, cursor: "pointer", border: `1px solid ${active ? border : T.border}`, background: active ? bg : "transparent", color: active ? color : T.textMuted, transition: "all 0.15s" }}>{active ? "✓ " : ""}{label}</button>;
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// TOP JOBS TODAY
// ─────────────────────────────────────────────────────────────────
function TopJobsToday({ jobs, onStatusChange }) {
  const top = jobs.map(j => enrichJob(j)).filter(j => j.status === "new" && j.score != null && j.final_score >= 75).sort((a, b) => b.final_score - a.final_score).slice(0, 5);
  if (!top.length) return null;
  return (
    <div style={{ marginBottom: 20, background: T.panel, border: `1px solid ${T.greenBorder}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.borderFaint}`, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: T.fontMono, fontSize: 9, letterSpacing: "0.12em", color: T.green }}>◆</span>
        <span style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: T.green }}>TOP MATCHES</span>
        <span style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, marginLeft: "auto" }}>{top.length} role{top.length !== 1 ? "s" : ""} ≥75</span>
      </div>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {top.map(job => (
          <div key={job.id} className="jsa-card-hover" style={{ background: T.surface, border: `1px solid ${T.borderFaint}`, borderRadius: 7, padding: "10px 12px", display: "flex", gap: 14, alignItems: "flex-start", transition: "background 0.15s" }}>
            <ScoreNum score={job.final_score} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: T.fontSans, fontWeight: 500, fontSize: 13, color: T.textPrimary, marginBottom: 2 }}>{job.title || "Untitled"}</div>
              <div style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, marginBottom: 8, letterSpacing: "0.04em" }}>{[job.company, job.location, job.created_at && new Date(job.created_at).toLocaleDateString()].filter(Boolean).join(" · ")}</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}><RecBadge rec={job.recommendation} /><PursuitBadge pursuit={job._pursuit} compact /></div>
              <LocationBadge job={job} />
              <StatusButtons jobId={job.id} currentStatus={job.status} onStatusChange={onStatusChange} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// EVAL PANEL
// ─────────────────────────────────────────────────────────────────
function EvalPanel({ title, subtitle, result, jd_text, loading, error, saving, saved, onSave, onTailor }) {
  if (!loading && !result && !error) return null;
  const enriched = result ? enrichJob({ ...result, jd_text }) : null;
  return (
    <div className="fade-up" style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
      {(title || subtitle) && (
        <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.borderFaint}`, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: T.fontMono, fontSize: 9, color: T.accentDim }}>EVAL</span>
          <span style={{ fontFamily: T.fontSans, fontSize: 12, fontWeight: 500, color: T.textPrimary }}>{title || ""}</span>
          {subtitle && <span style={{ fontFamily: T.fontSans, fontSize: 11, color: T.textMuted }}>{subtitle}</span>}
        </div>
      )}
      <div style={{ padding: 12 }}>
        {loading && <div className="pulse" style={{ textAlign: "center", padding: "28px 0", fontFamily: T.fontMono, fontSize: 11, color: T.textMuted, letterSpacing: "0.08em" }}>ANALYZING FIT…</div>}
        {error && <div style={{ padding: "8px 12px", background: T.redBg, border: `1px solid ${T.redBorder}`, borderRadius: 6, fontFamily: T.fontSans, fontSize: 12, color: T.red }}>{error}</div>}
        {result && !loading && enriched && (
          <>
            <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 14 }}>
              <ScoreNum score={enriched.final_score} hero />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}><RecBadge rec={result.recommendation} /><PursuitBadge pursuit={enriched._pursuit} compact /></div>
                <LocationBadge job={enriched} />
                <ScoreMeta enriched={enriched} />
              </div>
            </div>
            <TopCandidateSignal signal={result.top_candidate_signal} />
            <ScoreExplanationBlock explanation={result.score_explanation} />
            <ScoreWarnings job={{ ...result, location: result.location || "" }} jd_text={jd_text} />
            <Divider />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              {[
                { label: "Skills",      value: result.skills_match },
                { label: "Experience",  value: result.experience_match },
                { label: "Location",    value: result.location_score },
                { label: "Work/Life",   value: result.work_life_balance_score },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: T.surface, borderRadius: 7, padding: "10px 12px", border: `1px solid ${T.borderFaint}` }}>
                  <div style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, marginBottom: 4 }}>{label.toUpperCase()}</div>
                  <span style={{ fontFamily: T.fontMono, fontSize: 32, fontWeight: 700, color: scoreColor(value || 0), lineHeight: 1 }}>{value ?? "—"}</span>
                </div>
              ))}
            </div>
            <Divider />
            {[{ label: "Strengths", items: result.strengths, color: T.green }, { label: "Gaps", items: result.gaps, color: T.red }, { label: "Quick Wins", items: result.quick_wins, color: T.blue }].map(({ label, items, color }) =>
              items?.length ? <div key={label} style={{ marginBottom: 10 }}><Label>{label}</Label><div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{items.map(item => <span key={item} style={{ fontFamily: T.fontSans, fontSize: 11, color, padding: "2px 8px", border: `1px solid ${color}22`, borderRadius: 3 }}>{item}</span>)}</div></div> : null
            )}
            {result.missing_keywords?.length > 0 && <div style={{ marginBottom: 10 }}><Label>Missing Keywords</Label><div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{result.missing_keywords.map(kw => <span key={kw} style={{ fontFamily: T.fontMono, fontSize: 10, color: T.amber, padding: "2px 7px", border: `1px solid ${T.amberBorder}`, borderRadius: 3 }}>{kw}</span>)}</div></div>}
            <Divider />
            <div style={{ fontFamily: T.fontSerif, fontStyle: "italic", fontWeight: 300, fontSize: 13, color: T.textSecondary, lineHeight: 1.75, padding: "12px 14px", background: T.surface, borderRadius: 6, borderLeft: `2px solid ${T.accentDim}`, marginBottom: 14 }}>{result.verdict}</div>
            <div style={{ display: "flex", gap: 8 }}>
              {saved
                ? <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.green, letterSpacing: "0.06em" }}>✓ SAVED TO PIPELINE</span>
                : <Btn primary onClick={onSave} disabled={saving} style={{ flex: 1 }}>{saving ? "Saving…" : "Save to Pipeline"}</Btn>
              }
              {onTailor && <Btn onClick={onTailor} style={{ flex: 1 }}>Tailor Resume →</Btn>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// SEARCH PLAN RESULTS — with FAANG section
// ─────────────────────────────────────────────────────────────────

const FAANG_COLORS = {
  Google:    { color: "#4285F4", bg: "#0a1020", border: "#1a2f5a" },
  Apple:     { color: "#a0a0a0", bg: "#181818", border: "#333" },
  Microsoft: { color: "#00a4ef", bg: "#001520", border: "#003050" },
  Amazon:    { color: "#ff9900", bg: "#1a0f00", border: "#4a2f00" },
  Meta:      { color: "#1877f2", bg: "#0a1525", border: "#1a3050" },
};

function SearchPlanResults({ plan }) {
  if (!plan) return null;
  const { target_titles, faang_links, companies, search_links, tips } = plan;
  const sHead = { fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10, fontFamily: T.fontMono };
  return (
    <div className="fade-up">
      {/* FAANG direct links — prominently surfaced */}
      {faang_links?.length > 0 && (
        <Card style={{ borderColor: T.blueBorder, background: T.blueBg }}>
          <div style={{ ...sHead, color: T.blue, marginBottom: 4 }}>◆ FAANG Direct Search Links</div>
          <div style={{ fontFamily: T.fontSans, fontSize: 11, color: T.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
            These companies use proprietary ATS systems — auto-discover can't reach them. Use these links to search manually, then paste roles into the Evaluate tab.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {faang_links.map((item, i) => {
              const fc = FAANG_COLORS[item.company] || FAANG_COLORS.Google;
              return (
                <div key={i} style={{ padding: "10px 12px", background: fc.bg, border: `1px solid ${fc.border}`, borderRadius: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <span style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 600, color: fc.color, minWidth: 80 }}>{item.company.toUpperCase()}</span>
                    <a href={item.url} target="_blank" rel="noopener noreferrer"
                      style={{ fontFamily: T.fontMono, fontSize: 9, color: fc.color, textDecoration: "none", marginLeft: "auto", letterSpacing: "0.06em" }}>
                      SEARCH ↗
                    </a>
                  </div>
                  {item.search_tip && <div style={{ fontFamily: T.fontSans, fontSize: 11, color: T.textMuted, lineHeight: 1.5 }}>{item.search_tip}</div>}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card>
        <div style={sHead}>Target Titles</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {(target_titles || []).map(t => <span key={t} style={{ fontFamily: T.fontSans, fontSize: 11, color: T.textSecondary, padding: "4px 10px", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4 }}>{t}</span>)}
        </div>
      </Card>

      <Card>
        <div style={sHead}>Search Links</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[
            { platform: "LinkedIn", label: "Director of Product – Platform & Observability (Remote)", url: "https://www.linkedin.com/jobs/search/?keywords=%22director+of+product%22+platform+observability&f_E=5,6&f_JT=F&f_WT=3&f_TPR=r604800&sortBy=DD" },
            { platform: "LinkedIn", label: "VP of Product – Infrastructure & AI Platform (Remote)", url: "https://www.linkedin.com/jobs/search/?keywords=%22VP+of+product%22+OR+%22vice+president+of+product%22+infrastructure+platform&f_E=5,6&f_JT=F&f_WT=3&f_TPR=r604800&sortBy=DD" },
            { platform: "LinkedIn", label: "Staff PM / Group PM – Platform & Infra (Remote)", url: "https://www.linkedin.com/jobs/search/?keywords=%22staff+product+manager%22+OR+%22group+product+manager%22+platform+infrastructure&f_E=4,5&f_JT=F&f_WT=3&f_TPR=r604800&sortBy=DD" },
            { platform: "LinkedIn", label: "Head of Product – AI & Data Platform (Remote)", url: "https://www.linkedin.com/jobs/search/?keywords=%22head+of+product%22+platform&f_E=5,6&f_JT=F&f_WT=3&f_TPR=r604800&sortBy=DD" },
            { platform: "Indeed", label: "Director / VP PM – Platform & Observability (Remote)", url: "https://www.indeed.com/jobs?q=title%3A%28%22director+of+product%22+OR+%22VP+of+product%22+OR+%22head+of+product%22%29+%28platform+OR+observability+OR+infrastructure%29&l=Remote&fromage=14&jt=fulltime" },
          ].map((link, i) => (
            <a key={i} href={link.url} target="_blank" rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 6, textDecoration: "none", border: `1px solid ${T.border}`, background: T.surface, transition: "opacity 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.opacity = "0.8"} onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
              <span style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", color: T.blue, minWidth: 70 }}>{link.platform.toUpperCase()}</span>
              <span style={{ fontFamily: T.fontSans, fontSize: 12, color: T.textSecondary, flex: 1 }}>{link.label}</span>
              <span style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted }}>↗</span>
            </a>
          ))}
        </div>
      </Card>

      {companies?.length > 0 && (
        <Card>
          <div style={sHead}>Target Companies ({companies.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {companies.map((co, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "8px 10px", background: T.surface, border: `1px solid ${T.borderFaint}`, borderRadius: 5 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: T.fontSans, fontWeight: 500, fontSize: 12, color: T.textPrimary, marginBottom: 2 }}>{co.name}</div>
                  <div style={{ fontFamily: T.fontSans, fontSize: 11, color: T.textMuted, lineHeight: 1.5 }}>{co.why}</div>
                </div>
                {co.career_url && <a href={co.career_url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: T.fontMono, fontSize: 9, color: T.accentDim, textDecoration: "none", letterSpacing: "0.06em", whiteSpace: "nowrap", paddingTop: 2 }}>CAREERS ↗</a>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {tips?.length > 0 && (
        <Card>
          <div style={sHead}>Search Tips</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {tips.map((tip, i) => <div key={i} style={{ fontFamily: T.fontSans, fontSize: 12, color: T.textSecondary, lineHeight: 1.6, paddingLeft: 16, position: "relative" }}><span style={{ position: "absolute", left: 0, color: T.accentDim, fontFamily: T.fontMono, fontSize: 10 }}>→</span>{tip}</div>)}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// TAILORED RESUME PANEL
// ─────────────────────────────────────────────────────────────────
function TailoredResumePanel({ result, onDownload, downloading }) {
  if (!result) return null;
  const { headline, summary, keywords, missing_keywords, sections, transformation_notes, positioning_strategy, strategic_gaps, priority_experiences } = result;
  const sHead = { fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8, fontFamily: T.fontMono };
  return (
    <div className="fade-up" style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", marginTop: 12 }}>
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.borderFaint}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: T.fontMono, fontSize: 9, color: T.accentDim }}>◆</span>
          <span style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: T.textPrimary }}>POSITIONED RESUME</span>
        </div>
        <Btn small onClick={onDownload} disabled={downloading}>{downloading ? "Generating…" : "↓ Download .txt"}</Btn>
      </div>
      <div style={{ padding: 16 }}>
        <div style={{ marginBottom: 16 }}><Label>Executive Headline</Label><div style={{ fontFamily: T.fontSerif, fontStyle: "italic", fontSize: 17, fontWeight: 300, color: T.textPrimary, lineHeight: 1.4, marginTop: 6 }}>{headline}</div></div>
        <div style={{ marginBottom: 14 }}><Label>Summary</Label><div style={{ fontFamily: T.fontSans, fontSize: 12, color: T.textSecondary, lineHeight: 1.75, marginTop: 6, padding: "10px 12px", background: T.surface, borderRadius: 6, borderLeft: `2px solid ${T.accentDim}` }}>{summary}</div></div>
        {positioning_strategy && <div style={{ marginBottom: 14, padding: "10px 12px", background: T.blueBg, border: `1px solid ${T.blueBorder}`, borderRadius: 6 }}><Label style={{ color: T.blue, marginBottom: 6 }}>Positioning Strategy</Label><div style={{ fontFamily: T.fontSans, fontSize: 12, color: T.textSecondary, lineHeight: 1.7 }}>{positioning_strategy}</div></div>}
        {priority_experiences?.length > 0 && <div style={{ marginBottom: 14, padding: "10px 12px", background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 6 }}><Label style={{ color: T.green, marginBottom: 6 }}>Priority Experiences</Label>{priority_experiences.map((exp, i) => <div key={i} style={{ fontFamily: T.fontSans, fontSize: 11, color: T.textSecondary, paddingLeft: 14, position: "relative", marginBottom: 3 }}><span style={{ position: "absolute", left: 0, color: T.green, fontFamily: T.fontMono }}>★</span>{exp}</div>)}</div>}
        {strategic_gaps?.length > 0 && <div style={{ marginBottom: 14, padding: "10px 12px", background: T.redBg, border: `1px solid ${T.redBorder}`, borderRadius: 6 }}><Label style={{ color: T.red, marginBottom: 6 }}>Strategic Gaps</Label>{strategic_gaps.map((gap, i) => <div key={i} style={{ fontFamily: T.fontSans, fontSize: 11, color: T.textSecondary, paddingLeft: 14, position: "relative", marginBottom: 3 }}><span style={{ position: "absolute", left: 0, color: T.red, fontFamily: T.fontMono }}>!</span>{gap}</div>)}</div>}
        <div style={{ marginBottom: 14 }}><Label>Matched Keywords</Label><div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>{(keywords || []).map(kw => <span key={kw} style={{ fontFamily: T.fontMono, fontSize: 9, color: T.green, padding: "2px 7px", border: `1px solid ${T.greenBorder}`, borderRadius: 3, letterSpacing: "0.05em" }}>{kw}</span>)}</div></div>
        {missing_keywords?.length > 0 && <div style={{ marginBottom: 14 }}><Label>Keywords to Add</Label><div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>{missing_keywords.map(kw => <span key={kw} style={{ fontFamily: T.fontMono, fontSize: 9, color: T.amber, padding: "2px 7px", border: `1px solid ${T.amberBorder}`, borderRadius: 3, letterSpacing: "0.05em" }}>{kw}</span>)}</div></div>}
        <Divider />
        <Label style={{ marginBottom: 12 }}>Tailored Content</Label>
        {(sections || []).map((section, si) => (
          <div key={si} style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: T.accentDim, paddingBottom: 6, marginBottom: 8, borderBottom: `1px solid ${T.borderFaint}` }}>{section.title.toUpperCase()}</div>
            {(section.entries || []).map((entry, ei) => (
              <div key={ei} style={{ marginBottom: 10, opacity: entry.keep === false ? 0.35 : 1 }}>
                {entry.heading && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}><div style={{ fontFamily: T.fontSans, fontWeight: 500, fontSize: 12, color: entry.keep === false ? T.textMuted : T.textPrimary }}>{entry.heading}</div>{entry.relevance_score != null && <Pill color={entry.keep === false ? T.textMuted : entry.relevance_score >= 70 ? T.green : T.amber} bg={entry.keep === false ? T.surface : entry.relevance_score >= 70 ? T.greenBg : T.amberBg} border={entry.keep === false ? T.border : entry.relevance_score >= 70 ? T.greenBorder : T.amberBorder}>{entry.keep === false ? "OMIT" : `${entry.relevance_score}%`}</Pill>}</div>}
                {(entry.bullets || []).map((bullet, bi) => <div key={bi} style={{ fontFamily: T.fontSans, fontSize: 12, color: T.textSecondary, lineHeight: 1.65, paddingLeft: 14, position: "relative", marginBottom: 4 }}><span style={{ position: "absolute", left: 0, color: T.accentDim, fontFamily: T.fontMono }}>·</span>{bullet}</div>)}
              </div>
            ))}
          </div>
        ))}
        {transformation_notes?.length > 0 && <div style={{ padding: "10px 12px", background: T.blueBg, border: `1px solid ${T.blueBorder}`, borderRadius: 6 }}><Label style={{ color: T.blue, marginBottom: 6 }}>Language Transformations</Label>{transformation_notes.map((note, i) => <div key={i} style={{ fontFamily: T.fontSans, fontSize: 11, color: T.textSecondary, paddingLeft: 14, position: "relative", marginBottom: 2 }}><span style={{ position: "absolute", left: 0, color: T.blue, fontFamily: T.fontMono }}>→</span>{note}</div>)}</div>}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════
export default function JobSearchAgent() {

  const [theme, setTheme] = useState(() => localStorage.getItem("jsa_theme") || "light");

  // Update T tokens and global styles whenever theme changes
  Object.assign(T, theme === "dark" ? DARK_TOKENS : LIGHT_TOKENS);
  if (typeof document !== "undefined") {
    const styleEl = document.getElementById("jsa-global-styles");
    if (styleEl) styleEl.textContent = buildGlobalStyles(T);
  }

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    localStorage.setItem("jsa_theme", next);
    setTheme(next);
  };

  const [anthropicKey,  setAnthropicKey]  = useState(() => localStorage.getItem("jsa_anthropic_key") || "");
  const [profile,       setProfile]       = useState(DEFAULT_PROFILE);
  const [masterResume,  setMasterResume]  = useState(() => localStorage.getItem("jsa_master_resume") || "");
  const [settingsOpen,  setSettingsOpen]  = useState(false);
  const [tab, setTab] = useState("discover");

  // Discover
  const [discoverSection,   setDiscoverSection]   = useState("auto");
  const [ingestRunning,     setIngestRunning]      = useState(false);
  const [ingestResult,      setIngestResult]       = useState(null);
  const [ingestError,       setIngestError]        = useState("");
  const [searchPlan,        setSearchPlan]         = useState(() => { try { return JSON.parse(localStorage.getItem("jsa_search_plan") || "null"); } catch { return null; } });
  const [searchPlanLoading, setSearchPlanLoading]  = useState(false);
  const [searchPlanError,   setSearchPlanError]    = useState("");

  // Filters
  const [savedFilter,  setSavedFilter]  = useState({ text: "", status: "all", pursuit: "all" });
  const [savedSort,    setSavedSort]    = useState("score"); // "score" | "newest" | "oldest"
  const [showReport,   setShowReport]   = useState(false);
  const [reportCopied, setReportCopied] = useState("");
  const [checkingJobIds, setCheckingJobIds] = useState(new Set());
  const [checkRunning,   setCheckRunning]   = useState(false);
  const [checkSummary,   setCheckSummary]   = useState(null);
  const [emailFilter,  setEmailFilter]  = useState({ text: "" });

  // LinkedIn email alerts
  const [emailJobs,        setEmailJobs]        = useState(() => { try { return JSON.parse(localStorage.getItem("jsa_email_jobs") || "[]"); } catch { return []; } });
  const [emailLoading,     setEmailLoading]     = useState(false);
  const [emailError,       setEmailError]       = useState("");
  const [emailLastFetched, setEmailLastFetched] = useState(() => { const t = localStorage.getItem("jsa_email_fetched"); return t ? new Date(t) : null; });
  const [emailPaste,       setEmailPaste]       = useState("");
  const [quickScoring,     setQuickScoring]     = useState(() => { try { return JSON.parse(localStorage.getItem("jsa_quick_scoring") || "{}"); } catch { return {}; } }); // url → "scoring"|"saved"|"error:..."
  const [autoEvalScores,   setAutoEvalScores]   = useState({}); // url → { result, jd, status } | "pending" | "error:..."
  const [autoEvalRunning,  setAutoEvalRunning]  = useState(false);
  const [dismissedSaved,   setDismissedSaved]   = useState(() => { try { return JSON.parse(localStorage.getItem("jsa_dismissed_saved") || "[]"); } catch { return []; } }); // array of job ids

  // Evaluate
  const [evalResult,     setEvalResult]     = useState(null);
  const [evalLoading,    setEvalLoading]    = useState(false);
  const [evalError,      setEvalError]      = useState("");
  const [saving,         setSaving]         = useState(false);
  const [manualJd,       setManualJd]       = useState("");
  const [manualTitle,    setManualTitle]    = useState("");
  const [manualCompany,  setManualCompany]  = useState("");
  const [manualUrl,      setManualUrl]      = useState("");
  const [manualLocation, setManualLocation] = useState("");
  const [manualSaved,    setManualSaved]    = useState(false);
  const [manualJobId,    setManualJobId]    = useState(null); // set when re-evaluating existing job

  // Saved
  const [supabaseJobs,    setSupabaseJobs]    = useState([]);
  const [supabaseLoading, setSupabaseLoading] = useState(true);
  const [supabaseError,   setSupabaseError]   = useState("");
  const [reEvalRunning,   setReEvalRunning]   = useState(false);
  const [reEvalProgress,  setReEvalProgress]  = useState({ current: 0, total: 0, label: "" });
  const [reEvalError,     setReEvalError]     = useState("");
  const [selectedJobIds,  setSelectedJobIds]  = useState(new Set());
  const [inlineJdPaste,   setInlineJdPaste]   = useState({});
  const [inlineRescoring, setInlineRescoring] = useState({});
  const [inlineJdOpen,    setInlineJdOpen]    = useState({});

  // Tailor
  const [tailorMode,       setTailorMode]       = useState("paste");
  const [tailorJd,         setTailorJd]         = useState("");
  const [tailorJobTitle,   setTailorJobTitle]   = useState("");
  const [tailorCompany,    setTailorCompany]    = useState("");
  const [selectedSavedJob, setSelectedSavedJob] = useState(null);
  const [tailorResult,     setTailorResult]     = useState(null);
  const [tailorLoading,    setTailorLoading]    = useState(false);
  const [tailorError,      setTailorError]      = useState("");
  const [downloading,      setDownloading]      = useState(false);

  useEffect(() => {
    async function load() {
      setSupabaseLoading(true);
      const { data, error } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
      if (error) { console.error(error); setSupabaseError(error.message); }
      else setSupabaseJobs(data || []);
      setSupabaseLoading(false);
    }
    load();
  }, []);

  // ── Poll localStorage for autoeval results written by autoeval.html ──
  useEffect(() => {
    let interval = null;
    if (autoEvalRunning) {
      interval = setInterval(() => {
        try {
          const raw = localStorage.getItem("jsa_autoeval_results");
          if (!raw) return;
          const results = JSON.parse(raw);
          setAutoEvalScores(prev => {
            const next = { ...prev };
            let changed = false;
            Object.entries(results).forEach(([url, data]) => {
              if (!prev[url] || prev[url] === "pending") {
                next[url] = data.status === "done"
                  ? { result: data.result, jd: data.jd, status: "done" }
                  : `error:${data.error || "Unknown error"}`;
                changed = true;
              }
            });
            return changed ? next : prev;
          });
          const status = localStorage.getItem("jsa_autoeval_queue_status");
          if (status === "complete") {
            setAutoEvalRunning(false);
            clearInterval(interval);
            localStorage.removeItem("jsa_autoeval_queue_status");
          }
        } catch (e) { console.error("Poll error:", e); }
      }, 1500);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [autoEvalRunning]);

  function doLaunchAutoEval() {
    const pending = emailJobs.filter(j =>
      !quickScoring[j.url]?.startsWith("saved") &&
      !autoEvalScores[j.url] &&
      j.url
    );
    if (!pending.length) return;
    localStorage.setItem("jsa_autoeval_queue", JSON.stringify(pending));
    localStorage.setItem("jsa_autoeval_queue_status", "pending");
    localStorage.removeItem("jsa_autoeval_results");
    setAutoEvalScores(prev => {
      const next = { ...prev };
      pending.forEach(j => { next[j.url] = "pending"; });
      return next;
    });
    setAutoEvalRunning(true);
    window.open("/autoeval.html", "_blank");
  }

  async function doAutoEvalSave(job) {
    const ae = autoEvalScores[job.url];
    if (!ae || typeof ae !== "object" || ae.status !== "done") return;
    const { result, jd } = ae;
    if (job.url) {
      const { data: existing } = await supabase.from('jobs').select('id').eq('url', job.url).maybeSingle();
      if (existing) {
        setQuickScoring(prev => { const next = { ...prev, [job.url]: "saved" }; localStorage.setItem("jsa_quick_scoring", JSON.stringify(next)); return next; });
        return;
      }
    }
    const fields = {
      title: job.title || "LinkedIn Alert", company: job.company || "", url: job.url || "",
      location: job.location || "", description: jd || "", source: "linkedin_alert", status: "new",
      score: result.overall_score, recommendation: result.recommendation,
      strengths: result.strengths || [], gaps: result.gaps || [], quick_wins: result.quick_wins || [],
      verdict: result.verdict, skills_match: result.skills_match, experience_match: result.experience_match,
      culture_match: result.culture_match, compensation_score: result.compensation_score,
      work_life_balance_score: result.work_life_balance_score, growth_score: result.growth_score,
      location_score: result.location_score, company_score: result.company_score,
      confidence_score: result.confidence, missing_keywords: result.missing_keywords || [],
      strategic_gaps: result.strategic_gaps || [], score_explanation: result.score_explanation || null,
      top_candidate_signal: result.top_candidate_signal || null,
    };
    const { error } = await supabase.from('jobs').insert(fields);
    if (error) { console.error(error); return; }
    setSupabaseJobs(prev => [{ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...fields }, ...prev]);
    setQuickScoring(prev => { const next = { ...prev, [job.url]: "saved" }; localStorage.setItem("jsa_quick_scoring", JSON.stringify(next)); return next; });
  }

  function doImportJsonJobs() {
    setEmailError("");
    const raw = emailPaste.trim();
    if (!raw) return;

    let parsed = [];
    try {
      const clean = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();
      parsed = JSON.parse(clean);
      if (!Array.isArray(parsed)) throw new Error("Expected a JSON array");
    } catch {
      setEmailError("Couldn't parse JSON — paste the full JSON array from your Claude summary.");
      return;
    }

    // Use broadFilter — this is a curated list from Claude, not raw ATS noise.
    // broadFilter accepts any title with a seniority signal + "product":
    // senior, staff, principal, director, lead, head, group, vp, manager.
    const relevant = parsed.filter(j => j.title && j.url && isRelevantJob(j, { broadFilter: true }));

    if (relevant.length === 0) {
      setEmailError(`No relevant roles found after filtering (${parsed.length} total parsed). Jobs must include a seniority signal + "product" in the title.`);
      return;
    }

    // Dedup against Supabase jobs already saved + existing emailJobs staging
    const savedUrls = new Set([
      ...supabaseJobs.map(j => j.url),
      ...emailJobs.map(j => j.url),
    ]);

    const newJobs = relevant
      .filter(j => !savedUrls.has(j.url))
      .map(j => ({ title: j.title, company: j.company, location: j.location || "Remote", url: j.url, source: "linkedin_alert" }));

    const skipped = relevant.length - newJobs.length;

    if (newJobs.length === 0) {
      setEmailError(`All ${relevant.length} relevant roles are already in your pipeline or staging list.`);
      return;
    }

    setEmailJobs(prev => {
      const merged = [...prev, ...newJobs];
      localStorage.setItem("jsa_email_jobs", JSON.stringify(merged));
      return merged;
    });
    const now = new Date();
    setEmailLastFetched(now);
    localStorage.setItem("jsa_email_fetched", now.toISOString());
    setEmailPaste("");
    if (skipped > 0) {
      setEmailError(`Added ${newJobs.length} new role${newJobs.length !== 1 ? "s" : ""}. ${skipped} already in pipeline.`);
    }
  }

  function doClearEmailJobs() {
    setEmailJobs([]);
    localStorage.removeItem("jsa_email_jobs");
    localStorage.removeItem("jsa_email_fetched");
    setEmailLastFetched(null);
    // Also clear quickScoring for email jobs
    setQuickScoring(prev => {
      const next = { ...prev };
      emailJobs.forEach(j => delete next[j.url]);
      localStorage.setItem("jsa_quick_scoring", JSON.stringify(next));
      return next;
    });
  }

  function doRemoveEmailJob(url) {
    setEmailJobs(prev => {
      const updated = prev.filter(j => j.url !== url);
      localStorage.setItem("jsa_email_jobs", JSON.stringify(updated));
      return updated;
    });
  }

  function doDismissSavedJob(id) {
    setDismissedSaved(prev => {
      const updated = [...prev, id];
      localStorage.setItem("jsa_dismissed_saved", JSON.stringify(updated));
      return updated;
    });
  }

  function doRestoreDismissed() {
    setDismissedSaved([]);
    localStorage.removeItem("jsa_dismissed_saved");
  }

async function doQuickScore(job) {
    setQuickScoring(prev => { const next = { ...prev, [job.url]: "scoring" }; localStorage.setItem("jsa_quick_scoring", JSON.stringify(next)); return next; });
    try {
      // Check if autoeval already scored this job — use those results if available
      const autoevalCache = JSON.parse(localStorage.getItem('jsa_autoeval_results') || '{}');
      const cached = autoevalCache[job.url];
      const r = (cached?.status === 'done' && cached?.result?.overall_score > 0) ? cached.result : null;

      const { error } = await supabase.from('jobs').insert({
        title:                   job.title    || "LinkedIn Alert",
        company:                 job.company  || "",
        url:                     job.url      || "",
        location:                job.location || "",
        source:                  "linkedin_alert",
        status:                  "new",
        score:                   r?.overall_score           ?? null,
        recommendation:          r?.recommendation          ?? null,
        strengths:               r?.strengths               ?? [],
        gaps:                    r?.gaps                    ?? [],
        quick_wins:              r?.quick_wins              ?? [],
        verdict:                 r?.verdict                 ?? "Saved from LinkedIn alert — paste JD in Evaluate tab to score.",
        skills_match:            r?.skills_match            ?? null,
        experience_match:        r?.experience_match        ?? null,
        culture_match:           r?.culture_match           ?? null,
        compensation_score:      r?.compensation_score      ?? null,
        work_life_balance_score: r?.work_life_balance_score ?? null,
        growth_score:            r?.growth_score            ?? null,
        location_score:          r?.location_score          ?? null,
        company_score:           r?.company_score           ?? null,
        confidence_score:        r?.confidence              ?? null,
      });
      if (error) throw new Error(error.message);
      setSupabaseJobs(prev => [{
        id: crypto.randomUUID(), created_at: new Date().toISOString(),
        title: job.title || "LinkedIn Alert", company: job.company || "",
        url: job.url || "", location: job.location || "", source: "linkedin_alert",
        score: r?.overall_score ?? null,
        recommendation: r?.recommendation ?? null,
        status: "new",
        verdict: r?.verdict ?? "Saved from LinkedIn alert — paste JD in Evaluate tab to score.",
        strengths: r?.strengths ?? [], gaps: r?.gaps ?? [], quick_wins: r?.quick_wins ?? [],
      }, ...prev]);
      setQuickScoring(prev => { const next = { ...prev, [job.url]: "saved" }; localStorage.setItem("jsa_quick_scoring", JSON.stringify(next)); return next; });
    } catch (err) {
      console.error("[quickScore]", err.message);
      setQuickScoring(prev => { const next = { ...prev, [job.url]: "error:" + err.message }; localStorage.setItem("jsa_quick_scoring", JSON.stringify(next)); return next; });
    }
  }

  async function doSaveAllUnscored() {
    const toSave = emailJobs.filter(j =>
      !quickScoring[j.url]?.startsWith("saved") &&
      !quickScoring[j.url]?.startsWith("scoring")
    );
    for (const job of toSave) {
      await doQuickScore(job);
    }
  }

  async function doCheckOpenJobs() {
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

  async function doBulkDelete() {
    const ids = [...selectedJobIds];
    await Promise.all(ids.map(id => supabase.from('jobs').delete().eq('id', id)));
    setSupabaseJobs(prev => prev.filter(j => !selectedJobIds.has(j.id)));
    setSelectedJobIds(new Set());
  }

  async function doDeleteJob(id) {
    await supabase.from('jobs').delete().eq('id', id);
    setSupabaseJobs(prev => prev.filter(j => j.id !== id));
  }

  async function doPassJob(id) {
    await handleStatusChange(id, "pass");
  }

  async function doRunIngestion() {
    if (!anthropicKey) { setIngestError("Add your Anthropic API key in Settings."); return; }
    setIngestRunning(true); setIngestError(""); setIngestResult(null);
    try {
      const result = await runJobIngestion(supabase, anthropicKey, profile);
      setIngestResult(result);
      const { data } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
      if (data) setSupabaseJobs(data);
    } catch (e) { setIngestError(`Discovery failed: ${e.message}`); }
    setIngestRunning(false);
  }

  async function doGenerateSearchPlan() {
    if (!anthropicKey) { setSearchPlanError("Add your Anthropic API key in Settings."); return; }
    setSearchPlanLoading(true); setSearchPlanError(""); setSearchPlan(null); localStorage.removeItem("jsa_search_plan");
    try {
      const plan = await generateSearchPlan({ apiKey: anthropicKey, profile });
      setSearchPlan(plan);
      localStorage.setItem("jsa_search_plan", JSON.stringify(plan));
    }
    catch (e) { setSearchPlanError(`Search plan failed: ${e.message}`); }
    setSearchPlanLoading(false);
  }

  async function doManualEvaluate() {
    if (!anthropicKey) { setEvalError("Add your Anthropic API key in Settings."); return; }
    if (!manualJd.trim()) { setEvalError("Paste a job description first."); return; }
    setEvalResult(null); setEvalError(""); setManualSaved(false); setEvalLoading(true);
    try { setEvalResult(await runEvaluation({ apiKey: anthropicKey, jd: manualJd, profile, location: manualLocation })); }
    catch (e) { setEvalError(`Evaluation failed: ${e.message}`); }
    setEvalLoading(false);
  }

  async function doSave() {
    setSaving(true); setEvalError("");
    try {
      const fields = {
        title:                   manualTitle || 'Manual Entry',
        company:                 manualCompany || '',
        url:                     manualUrl || '',
        location:                manualLocation || '',
        description:             manualJd || '',
        score:                   evalResult.overall_score,
        recommendation:          evalResult.recommendation,
        strengths:               evalResult.strengths,
        gaps:                    evalResult.gaps,
        quick_wins:              evalResult.quick_wins,
        verdict:                 evalResult.verdict,
        skills_match:            evalResult.skills_match,
        experience_match:        evalResult.experience_match,
        culture_match:           evalResult.culture_match,
        compensation_score:      evalResult.compensation_score,
        work_life_balance_score: evalResult.work_life_balance_score,
        growth_score:            evalResult.growth_score,
        location_score:          evalResult.location_score,
        company_score:           evalResult.company_score,
        confidence_score:        evalResult.confidence,
        missing_keywords:        evalResult.missing_keywords || [],
        strategic_gaps:          evalResult.strategic_gaps || [],
        score_explanation:       evalResult.score_explanation || null,
        top_candidate_signal:    evalResult.top_candidate_signal || null,
      };
      if (manualJobId) {
        // Re-evaluating existing job — update the row
        const { error } = await supabase.from('jobs').update(fields).eq('id', manualJobId);
        if (error) throw new Error(error.message);
        setSupabaseJobs(prev => prev.map(j => j.id === manualJobId ? { ...j, ...fields } : j));
      } else {
        // New job — check for duplicate then insert
        if (manualUrl) {
          const { data: existing } = await supabase.from('jobs').select('id').eq('url', manualUrl).maybeSingle();
          if (existing) {
            setEvalError("This role is already in your pipeline. Use → Re-evaluate from the Saved tab to update it.");
            setSaving(false);
            return;
          }
        }
        const { error } = await supabase.from('jobs').insert({ ...fields, status: 'new' });
        if (error) throw new Error(error.message);
        setSupabaseJobs(prev => [{ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...fields, status: 'new' }, ...prev]);
      }
      setManualSaved(true);
    } catch (e) { setEvalError(`Save failed: ${e.message}`); }
    setSaving(false);
  }

  async function handleStatusChange(jobId, newStatus) {
    const updates = { status: newStatus };
    if (newStatus === "applied") updates.applied_at = new Date().toISOString();
    const { error } = await supabase.from('jobs').update(updates).eq('id', jobId);
    if (error) {
      // applied_at column may not exist yet — fall back to status-only update
      const { error: fallbackError } = await supabase.from('jobs').update({ status: newStatus }).eq('id', jobId);
      if (fallbackError) return;
      setSupabaseJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: newStatus } : j));
      return;
    }
    setSupabaseJobs(prev => prev.map(j => j.id === jobId ? { ...j, ...updates } : j));
  }


  function getAppliedJobs() {
    return [...supabaseJobs]
      .filter(j => ["applied", "interviewing", "offer"].includes(j.status))
      .sort((a, b) => new Date(a.applied_at || a.created_at) - new Date(b.applied_at || b.created_at));
  }

  function doCopyReportCsv() {
    const jobs = getAppliedJobs();
    const rows = [
      ["Date Applied", "Company", "Position", "Status"],
      ...jobs.map(j => [
        new Date(j.applied_at || j.created_at).toLocaleDateString(),
        j.company || "",
        j.title || "",
        (j.status || "").charAt(0).toUpperCase() + (j.status || "").slice(1),
      ]),
    ];
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    navigator.clipboard.writeText(csv);
    setReportCopied("csv");
    setTimeout(() => setReportCopied(""), 2000);
  }

  function doCopyReportText() {
    const jobs = getAppliedJobs();
    const generated = `Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`;
    const header = `JOB SEARCH LOG — WA Unemployment\n${generated}\n\n${"DATE".padEnd(14)}${"COMPANY".padEnd(28)}POSITION`;
    const divider = "─".repeat(78);
    const lines = jobs.map(j => {
      const date = new Date(j.applied_at || j.created_at).toLocaleDateString().padEnd(14);
      const company = (j.company || "").slice(0, 27).padEnd(28);
      return `${date}${company}${j.title || ""}`;
    });
    navigator.clipboard.writeText([header, divider, ...lines].join("\n"));
    setReportCopied("text");
    setTimeout(() => setReportCopied(""), 2000);
  }

  async function doRefreshSupabase() {
    setSupabaseLoading(true);
    const { data, error } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
    if (error) setSupabaseError(error.message); else setSupabaseJobs(data || []);
    setSupabaseLoading(false);
  }

  async function doInlineRescore(job) {
    const jd = inlineJdPaste[job.id]?.trim();
    if (!jd) return;
    if (!anthropicKey) { setReEvalError("Add your Anthropic API key in Settings."); return; }
    setInlineRescoring(prev => ({ ...prev, [job.id]: true }));
    try {
      const result = await runEvaluation({ apiKey: anthropicKey, jd, profile, location: job.location || "" });
      const fields = {
        description:             jd,
        score:                   result.overall_score,
        recommendation:          result.recommendation,
        strengths:               result.strengths               || [],
        gaps:                    result.gaps                    || [],
        quick_wins:              result.quick_wins              || [],
        verdict:                 result.verdict,
        skills_match:            result.skills_match,
        experience_match:        result.experience_match,
        culture_match:           result.culture_match,
        compensation_score:      result.compensation_score,
        work_life_balance_score: result.work_life_balance_score,
        growth_score:            result.growth_score,
        location_score:          result.location_score,
        company_score:           result.company_score,
        confidence_score:        result.confidence,
        missing_keywords:        result.missing_keywords        || [],
        strategic_gaps:          result.strategic_gaps          || [],
        score_explanation:       result.score_explanation       || null,
        top_candidate_signal:    result.top_candidate_signal    || null,
      };
      const { error } = await supabase.from('jobs').update(fields).eq('id', job.id);
      if (error) throw new Error(error.message);
      setSupabaseJobs(prev => prev.map(j => j.id === job.id ? { ...j, ...fields } : j));
      setInlineJdOpen(prev => ({ ...prev, [job.id]: false }));
      setInlineJdPaste(prev => ({ ...prev, [job.id]: "" }));
    } catch (e) {
      setReEvalError(`Re-score failed: ${e.message}`);
    }
    setInlineRescoring(prev => ({ ...prev, [job.id]: false }));
  }

  function doReScoreLowConfidence() {
    const lowConfIds = supabaseJobs.filter(j => isLowConfidence(j)).map(j => j.id);
    if (!lowConfIds.length) { setReEvalError("No low-confidence jobs found in pipeline."); return; }
    const idSet = new Set(lowConfIds);
    setSelectedJobIds(idSet);
    doReEvaluateAll(idSet);
  }

  async function doReEvaluateAll(overrideIds) {
    if (!anthropicKey) { setReEvalError("Add your Anthropic API key in Settings."); return; }
    const idsToUse = overrideIds ?? selectedJobIds;
    const jobs = supabaseJobs.filter(j => j.title && j.url && (idsToUse.size === 0 || idsToUse.has(j.id)));
    if (!jobs.length) { setReEvalError("No jobs to re-evaluate."); return; }

    setReEvalRunning(true);
    setReEvalError("");
    setReEvalProgress({ current: 0, total: jobs.length, label: "" });

    let succeeded = 0, failed = 0;

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      setReEvalProgress({ current: i + 1, total: jobs.length, label: `${job.title} · ${job.company || ""}` });

      const jdText = [job.title, job.company, job.location, job.description].filter(Boolean).join("\n");

      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicKey.trim(),
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 1500,
            system: FIT_PROMPT,
            messages: [{ role: "user", content: `JOB DESCRIPTION:\n${jdText}\n\nLOCATION: ${job.location || "Not specified"}\n\nCANDIDATE PROFILE:\n${profile}` }],
          }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        if (payload.error) throw new Error(payload.error.message);

        const raw = payload.content.map(b => b.text || "").join("").trim()
          .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();
        const ev = JSON.parse(raw);

        const { error: updateError } = await supabase.from('jobs').update({
          score:                   ev.overall_score,
          recommendation:          ev.recommendation,
          strengths:               ev.strengths               || [],
          gaps:                    ev.gaps                    || [],
          quick_wins:              ev.quick_wins              || [],
          verdict:                 ev.verdict,
          skills_match:            ev.skills_match,
          experience_match:        ev.experience_match,
          culture_match:           ev.culture_match,
          compensation_score:      ev.compensation_score,
          work_life_balance_score: ev.work_life_balance_score,
          growth_score:            ev.growth_score,
          location_score:          ev.location_score,
          company_score:           ev.company_score,
          confidence_score:        ev.confidence,
        }).eq('id', job.id);

        if (updateError) throw new Error(updateError.message);

        // Update local state immediately so UI reflects new scores
        setSupabaseJobs(prev => prev.map(j => j.id === job.id ? {
          ...j,
          score: ev.overall_score, recommendation: ev.recommendation,
          strengths: ev.strengths || [], gaps: ev.gaps || [],
          quick_wins: ev.quick_wins || [], verdict: ev.verdict,
          skills_match: ev.skills_match, experience_match: ev.experience_match,
          culture_match: ev.culture_match, compensation_score: ev.compensation_score,
          work_life_balance_score: ev.work_life_balance_score,
          growth_score: ev.growth_score, location_score: ev.location_score,
          company_score: ev.company_score, confidence_score: ev.confidence,
        } : j));

        succeeded++;
      } catch (err) {
        console.error(`[re-eval] Failed for "${job.title}": ${err.message}`);
        failed++;
      }
    }

    setReEvalRunning(false);
    setReEvalProgress({ current: jobs.length, total: jobs.length, label: `Done — ${succeeded} updated, ${failed} failed` });
  }

  async function doTailorResume() {
    if (!anthropicKey) { setTailorError("Add your Anthropic API key in Settings."); return; }
    if (!masterResume.trim()) { setTailorError("Add your master resume in Settings first."); return; }
    const jd = tailorMode === "saved" && selectedSavedJob ? `${selectedSavedJob.title || ""}\n${selectedSavedJob.company || ""}\n\nVERDICT: ${selectedSavedJob.verdict || ""}` : tailorJd;
    if (!jd.trim()) { setTailorError("Provide a job description."); return; }
    setTailorLoading(true); setTailorError(""); setTailorResult(null);
    try { setTailorResult(await tailorResume({ apiKey: anthropicKey, resume: masterResume, jd, profile })); }
    catch (e) { setTailorError(`Tailoring failed: ${e.message}`); }
    setTailorLoading(false);
  }

  async function doDownloadTxt() {
    if (!tailorResult) return;
    setDownloading(true);
    try {
      const { headline, summary, sections, keywords, missing_keywords, transformation_notes, positioning_strategy, strategic_gaps, priority_experiences } = tailorResult;
      const jobLabel = tailorMode === "saved" && selectedSavedJob ? `${selectedSavedJob.title || "Role"} — ${selectedSavedJob.company || ""}` : tailorJobTitle ? `${tailorJobTitle}${tailorCompany ? " — " + tailorCompany : ""}` : "Tailored Resume";
      const lines = [headline.toUpperCase(), "", "SUMMARY", "─".repeat(60), summary, ""];
      if (positioning_strategy) lines.push("POSITIONING STRATEGY", "─".repeat(60), positioning_strategy, "");
      if (priority_experiences?.length) lines.push("PRIORITY EXPERIENCES", "─".repeat(60), ...priority_experiences.map(e => `★ ${e}`), "");
      if (strategic_gaps?.length) lines.push("STRATEGIC GAPS", "─".repeat(60), ...strategic_gaps.map(g => `! ${g}`), "");
      lines.push("MATCHED KEYWORDS", "─".repeat(60), keywords.join(" · "), "");
      if (missing_keywords?.length) lines.push("KEYWORDS TO ADD", "─".repeat(60), missing_keywords.join(" · "), "");
      sections.forEach(section => { lines.push(section.title.toUpperCase(), "─".repeat(60)); section.entries?.forEach(entry => { if (entry.heading) lines.push(`${entry.heading}${entry.relevance_score != null ? ` [${entry.relevance_score}%${entry.keep === false ? " · OMIT" : ""}]` : ""}`); entry.bullets?.forEach(b => lines.push(`· ${b}`)); lines.push(""); }); });
      if (transformation_notes?.length) lines.push("LANGUAGE TRANSFORMATIONS", "─".repeat(60), ...transformation_notes.map(n => `→ ${n}`));
      const blob = new Blob([lines.join("\n")], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${jobLabel.replace(/[^a-z0-9]/gi, "_")}_resume.txt`; a.click(); URL.revokeObjectURL(url);
    } catch (e) { console.error(e); }
    setDownloading(false);
  }

  const grid2 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
  const grid3 = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 };
  const TABS = [{ key: "discover", label: "Search" }, { key: "manual", label: "Evaluate" }, { key: "saved", label: "Pipeline" }, { key: "tailor", label: "Tailor" }];

  // Domain badge colors
  const DOMAIN_COLORS = { observability: { color: T.green, bg: T.greenBg, border: T.greenBorder }, infrastructure: { color: T.blue, bg: T.blueBg, border: T.blueBorder }, platform: { color: T.amber, bg: T.amberBg, border: T.amberBorder }, defense: { color: "#f97316", bg: "rgba(249,115,22,0.12)", border: "rgba(249,115,22,0.4)" }, space: { color: "#818cf8", bg: "rgba(129,140,248,0.12)", border: "rgba(129,140,248,0.4)" } };

  return (
    <div style={{ fontFamily: T.fontSans, maxWidth: 820, margin: "0 auto", padding: "28px 18px", background: T.bg, minHeight: "100vh" }}>

      {/* HEADER */}
      <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${T.borderFaint}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 3 }}>
            <h1 style={{ fontFamily: T.fontMono, fontSize: 15, fontWeight: 600, letterSpacing: "0.08em", color: T.textPrimary }}>Kairos</h1>
            <span style={{ fontFamily: T.fontMono, fontSize: 9, color: T.accentDim, letterSpacing: "0.12em" }}>◆ ACTIVE</span>
          </div>
          <div style={{ fontFamily: T.fontSerif, fontStyle: "italic", fontWeight: 300, fontSize: 12, color: T.textMuted }}>VP / Director-level · Platform, Infrastructure, Observability, AI</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
          <button onClick={toggleTheme} style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.06em", padding: "4px 10px", borderRadius: 4, border: `1px solid ${T.border}`, background: T.surface, color: T.textSecondary, cursor: "pointer" }}>
            {theme === "light" ? "◑ Dark" : "◐ Light"}
          </button>
          <button onClick={() => setSettingsOpen(o => !o)} title="Settings" style={{ fontFamily: T.fontSans, fontSize: 15, padding: "2px 8px", borderRadius: 4, border: `1px solid ${settingsOpen ? T.accentDim : T.border}`, background: settingsOpen ? T.greenBg : T.surface, color: settingsOpen ? T.green : T.textMuted, cursor: "pointer", lineHeight: 1 }}>⚙</button>
        </div>
      </div>

      {/* SETTINGS DRAWER */}
      {settingsOpen && (
        <div style={{ marginBottom: 16, background: T.panel, border: `1px solid ${T.borderFaint}`, borderRadius: 8, padding: 12 }}>
          <div style={{ marginBottom: 10 }}><input type="password" className="jsa-input" value={anthropicKey} onChange={e => { setAnthropicKey(e.target.value); localStorage.setItem("jsa_anthropic_key", e.target.value); }} placeholder="Anthropic API key (sk-ant-…)" /></div>
          <div style={{ marginBottom: 10 }}><textarea className="jsa-textarea" style={{ height: 80 }} value={profile} onChange={e => setProfile(e.target.value)} placeholder="Candidate profile…" /></div>
          <div><textarea className="jsa-textarea" style={{ height: 100 }} value={masterResume} onChange={e => { setMasterResume(e.target.value); localStorage.setItem("jsa_master_resume", e.target.value); }} placeholder="Master resume — paste from PDF…" /></div>
        </div>
      )}

      {/* TABS */}
      <div style={{ display: "flex", gap: 2, marginBottom: 20, background: T.surface, borderRadius: 7, padding: 3, border: `1px solid ${T.borderFaint}` }}>
        {TABS.map(t => (
          <button key={t.key} className="jsa-tab"
            onClick={() => { if (t.key === tab) return; setTab(t.key); if (t.key === "manual") { setEvalResult(null); setEvalError(""); setManualJobId(null); } }}
            style={{ flex: 1, fontFamily: T.fontSans, fontSize: 13, fontWeight: 500, padding: "7px 0", borderRadius: 5, border: "none", cursor: "pointer", transition: "all 0.15s", background: tab === t.key ? T.panel : "transparent", color: tab === t.key ? T.textPrimary : T.textMuted, boxShadow: tab === t.key ? "0 1px 3px rgba(0,0,0,0.15)" : "none" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ════ SEARCH ════ */}
      {tab === "discover" && (
        <>
          <TopJobsToday jobs={supabaseJobs} onStatusChange={handleStatusChange} />
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {[{ key: "auto", label: "⚡ Auto-Discover" }, { key: "email", label: "📧 Email Alerts" }].map(s => (
              <button key={s.key} className="jsa-toggle" onClick={() => setDiscoverSection(s.key)}
                style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", padding: "6px 14px", borderRadius: 5, border: `1px solid ${discoverSection === s.key ? T.accentDim : T.border}`, background: discoverSection === s.key ? T.greenBg : "transparent", color: discoverSection === s.key ? T.green : T.textMuted, cursor: "pointer", transition: "all 0.15s" }}>
                {s.label}
              </button>
            ))}
          </div>

          {discoverSection === "auto" && (
            <>
              <Card>
                <div style={{ fontFamily: T.fontSans, fontSize: 12, color: T.textMuted, lineHeight: 1.7, marginBottom: 14 }}>
                  Fetches Director/VP/Staff/Group PM roles from configured company job boards, filters titles, deduplicates, inserts new roles into Supabase, and runs Claude evaluation automatically.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
                  {SOURCES.map(({ id, ats, tier, domain }) => {
                    const dc = DOMAIN_COLORS[domain] || DOMAIN_COLORS.platform;
                    return (
                      <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: T.surface, border: `1px solid ${T.borderFaint}`, borderRadius: 5 }}>
                        <span style={{ fontFamily: T.fontSans, fontSize: 12, color: T.textSecondary, flex: 1, textTransform: "capitalize" }}>{id}</span>
                        <Pill color={dc.color} bg={dc.bg} border={dc.border}>{domain}</Pill>
                        <Pill color={ats === "greenhouse" ? T.green : T.blue} bg={ats === "greenhouse" ? T.greenBg : T.blueBg} border={ats === "greenhouse" ? T.greenBorder : T.blueBorder}>{ats}</Pill>
                        {tier === 1 && <span style={{ fontFamily: T.fontMono, fontSize: 8, color: T.accentDim }}>T1</span>}
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, marginBottom: 14 }}>
                  Edit <code style={{ color: T.accentDim }}>SOURCES</code> in <code style={{ color: T.accentDim }}>ingestion.js</code> to add companies.
                  FAANG not available via API — use Search Plan tab instead.
                </div>
                <Btn primary onClick={doRunIngestion} disabled={ingestRunning}>{ingestRunning ? "Running…" : "⚡ Run Auto-Discovery →"}</Btn>
                <ErrBox msg={ingestError} />
              </Card>

              {ingestRunning && (
                <div className="pulse" style={{ textAlign: "center", padding: "24px 0", fontFamily: T.fontMono, fontSize: 10, letterSpacing: "0.1em", color: T.textMuted }}>
                  FETCHING · FILTERING · EVALUATING
                </div>
              )}

              {ingestResult && (
                <div className="fade-up" style={{ background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 8, padding: 14 }}>
                  <div style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: T.green, marginBottom: 12 }}>◆ DISCOVERY COMPLETE</div>

                  {/* Per-source breakdown */}
                  {ingestResult.sourceResults?.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontFamily: T.fontMono, fontSize: 9, color: T.accentDim, letterSpacing: "0.08em", marginBottom: 6 }}>SOURCE BREAKDOWN</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {ingestResult.sourceResults.map(s => (
                          <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", background: s.failed ? T.redBg : T.greenBg, border: `1px solid ${s.failed ? T.redBorder : T.greenBorder}`, borderRadius: 4 }}>
                            <span style={{ fontFamily: T.fontSans, fontSize: 11, color: s.failed ? T.red : T.textSecondary, textTransform: "capitalize" }}>{s.id}</span>
                            <span style={{ fontFamily: T.fontMono, fontSize: 10, color: s.failed ? T.red : T.green }}>{s.failed ? "FAILED" : `${s.fetched} fetched`}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Summary counts */}
                  {[
                    { label: "Total fetched",    value: ingestResult.total     },
                    { label: "Matched filter",   value: ingestResult.filtered  },
                    { label: "New inserted",     value: ingestResult.inserted  },
                    { label: "Evaluated",        value: ingestResult.evaluated },
                    { label: "Skipped (dup)",    value: ingestResult.skipped   },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${T.greenBorder}` }}>
                      <span style={{ fontFamily: T.fontSans, fontSize: 12, color: T.textSecondary }}>{label}</span>
                      <span style={{ fontFamily: T.fontMono, fontSize: 12, fontWeight: 600, color: T.green }}>{value}</span>
                    </div>
                  ))}
                  <div style={{ fontFamily: T.fontSans, fontSize: 11, color: T.green, opacity: 0.75, marginTop: 10 }}>
                    {ingestResult.inserted > 0 ? `${ingestResult.inserted} new role${ingestResult.inserted !== 1 ? "s" : ""} added — check Saved tab.` : "No new roles found — all matches already in pipeline."}
                  </div>
                </div>
              )}
            </>
          )}

          {discoverSection === "email" && (
            <>
              <Card>
                <div style={{ fontFamily: T.fontSans, fontSize: 12, color: T.textMuted, lineHeight: 1.7, marginBottom: 14 }}>
                  Paste the JSON summary from your daily Claude briefing. Jobs will be filtered for relevant titles, deduplicated against your pipeline, then added to the staging list below for scoring.
                </div>
                <textarea
                  className="jsa-textarea"
                  style={{ height: 140, marginBottom: 10 }}
                  value={emailPaste}
                  onChange={e => setEmailPaste(e.target.value)}
                  placeholder={'Paste JSON array from Claude summary:\n[\n  { "title": "...", "company": "...", "location": "...", "url": "..." },\n  ...\n]'}
                />
                <Btn primary onClick={doImportJsonJobs} disabled={!emailPaste.trim()}>Import Jobs →</Btn>
                <ErrBox msg={emailError} />
              </Card>

              {emailJobs.length > 0 && (
                <div className="fade-up">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", color: T.green }}>
                      ◆ {emailJobs.filter(j => !quickScoring[j.url]?.startsWith("saved")).length} ROLE{emailJobs.filter(j => !quickScoring[j.url]?.startsWith("saved")).length !== 1 ? "S" : ""} FROM DAILY BRIEFING
                      {emailJobs.some(j => quickScoring[j.url]?.startsWith("saved")) && (
                        <span style={{ color: T.textMuted, fontWeight: 400, marginLeft: 8 }}>
                          · {emailJobs.filter(j => quickScoring[j.url]?.startsWith("saved")).length} saved hidden
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {emailLastFetched && (
                        <span style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted }}>
                          {emailLastFetched.toLocaleTimeString()}
                        </span>
                      )}
                      {autoEvalRunning && (
                        <span className="pulse" style={{ fontFamily: T.fontMono, fontSize: 9, color: T.amber }}>
                          ⟳ Evaluating…
                        </span>
                      )}
                      {!autoEvalRunning && emailJobs.some(j => !quickScoring[j.url]?.startsWith("saved") && !autoEvalScores[j.url]) && anthropicKey && (
                        <button onClick={doLaunchAutoEval}
                          style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", padding: "3px 10px", borderRadius: 3, border: `1px solid ${T.amberBorder}`, background: T.amberBg, color: T.amber, cursor: "pointer" }}>
                          ⚡ Auto-Evaluate All
                        </button>
                      )}
                      {emailJobs.some(j => !quickScoring[j.url]?.startsWith("saved") && !quickScoring[j.url]?.startsWith("scoring")) && (
                        <button onClick={doSaveAllUnscored}
                          style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", padding: "3px 10px", borderRadius: 3, border: `1px solid ${T.greenBorder}`, background: T.greenBg, color: T.green, cursor: "pointer" }}>
                          ✓ Save All to Pipeline
                        </button>
                      )}
                      <button onClick={doClearEmailJobs}
                        style={{ fontFamily: T.fontMono, fontSize: 9, letterSpacing: "0.06em", padding: "2px 8px", borderRadius: 3, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, cursor: "pointer" }}>
                        ✕ Clear All
                      </button>
                    </div>
                  </div>

                  {autoEvalRunning && (
                    <div style={{ marginBottom: 10, padding: "10px 14px", background: T.amberBg, border: `1px solid ${T.amberBorder}`, borderRadius: 6 }}>
                      <div className="pulse" style={{ fontFamily: T.fontMono, fontSize: 9, color: T.amber, letterSpacing: "0.08em" }}>
                        ⟳ Auto-evaluator running in background tab — results will appear here automatically
                      </div>
                    </div>
                  )}

                  {!autoEvalRunning && emailJobs.some(j => !quickScoring[j.url]?.startsWith("saved") && !autoEvalScores[j.url]) && (
                    <div style={{ fontFamily: T.fontSans, fontSize: 11, color: T.textMuted, lineHeight: 1.6, padding: "8px 12px", background: T.blueBg, border: `1px solid ${T.blueBorder}`, borderRadius: 6, marginBottom: 10 }}>
                      Click <strong style={{ color: T.amber }}>⚡ Auto-Evaluate All</strong> to automatically scrape and score every role — a background tab opens and results appear here. Or use <strong style={{ color: T.textSecondary }}>→ Manual Evaluate</strong> for individual roles.
                    </div>
                  )}

                  <FilterBar
                    filter={emailFilter}
                    onChange={setEmailFilter}
                    placeholder="Filter by title or company…"
                    count={emailJobs.filter(j => !quickScoring[j.url]?.startsWith("saved") && (!(emailFilter.text) || j.title?.toLowerCase().includes(emailFilter.text.toLowerCase()) || j.company?.toLowerCase().includes(emailFilter.text.toLowerCase()))).length}
                    total={emailJobs.filter(j => !quickScoring[j.url]?.startsWith("saved")).length}
                  />

                  {emailJobs.filter(j => !quickScoring[j.url]?.startsWith("saved")).map((job, i) => {
                    const q = (emailFilter.text || "").toLowerCase();
                    if (q && !job.title?.toLowerCase().includes(q) && !job.company?.toLowerCase().includes(q) && !job.location?.toLowerCase().includes(q)) return null;
                    const qs = quickScoring[job.url];
                    const ae = autoEvalScores[job.url];
                    const aeLoading = ae === "pending";
                    const aeError = typeof ae === "string" && ae.startsWith("error:");
                    const aeScored = ae && typeof ae === "object" && ae.status === "done";
                    return (
                    <div key={i} className="jsa-card-hover" style={{ background: T.panel, border: `1px solid ${qs === "saved" ? T.greenBorder : aeScored ? T.blueBorder : T.borderFaint}`, borderRadius: 8, padding: "12px 14px", marginBottom: 6, transition: "background 0.15s, border-color 0.15s" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: T.fontSans, fontWeight: 500, fontSize: 13, color: T.textPrimary, marginBottom: 2 }}>{job.title}</div>
                          <div style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, letterSpacing: "0.04em" }}>
                            {[job.company, job.location].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                          {aeScored && <ScoreNum score={enrichJob({ ...ae.result, jd_text: ae.jd, location: job.location }).final_score} />}
                          <Pill color={T.blue} bg={T.blueBg} border={T.blueBorder}>LinkedIn</Pill>
                          <a href={job.url} target="_blank" rel="noopener noreferrer"
                            style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", color: T.green, textDecoration: "none", padding: "3px 9px", border: `1px solid ${T.greenBorder}`, borderRadius: 3, background: T.greenBg }}>
                            VIEW ↗
                          </a>
                        </div>
                      </div>
                      {aeLoading && (
                        <div className="pulse" style={{ marginTop: 8, fontFamily: T.fontMono, fontSize: 9, color: T.amber }}>⟳ Evaluating…</div>
                      )}
                      {aeError && (
                        <div style={{ marginTop: 8, fontFamily: T.fontMono, fontSize: 9, color: T.red }}>✗ {ae.replace("error:", "")}</div>
                      )}
                      {aeScored && (() => {
                        const enriched = enrichJob({ ...ae.result, jd_text: ae.jd, location: job.location });
                        return (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
                              <RecBadge rec={ae.result.recommendation} />
                              <PursuitBadge pursuit={enriched._pursuit} compact />
                              <LocationBadge job={enriched} />
                            </div>
                            {ae.result.verdict && <div style={{ fontFamily: T.fontSans, fontSize: 11, color: T.textMuted, lineHeight: 1.6, marginBottom: 6, padding: "8px 10px", background: T.surface, borderRadius: 5, borderLeft: `2px solid ${T.accentDim}` }}>{ae.result.verdict}</div>}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px 12px" }}>
                              <ScoreBar label="Skills" score={ae.result.skills_match} compact />
                              <ScoreBar label="Experience" score={ae.result.experience_match} compact />
                              <ScoreBar label="Culture" score={ae.result.culture_match} compact />
                            </div>
                          </div>
                        );
                      })()}
                      <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                        {qs === "saved" ? (
                          <span style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", color: T.green }}>✓ SAVED TO PIPELINE</span>
                        ) : aeScored ? (
                          <button onClick={() => doAutoEvalSave(job)}
                            style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", padding: "3px 10px", borderRadius: 3, border: `1px solid ${T.accentDim}`, background: T.greenBg, color: T.green, cursor: "pointer" }}>
                            ✓ Save to Pipeline →
                          </button>
                        ) : aeError ? (
                          <>
                            <span style={{ fontFamily: T.fontMono, fontSize: 9, color: T.red }}>✗ Scrape failed</span>
                            <button onClick={() => doQuickScore(job)} disabled={qs === "scoring"}
                              style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", padding: "3px 10px", borderRadius: 3, border: `1px solid ${T.accentDim}`, background: T.greenBg, color: T.green, cursor: qs === "scoring" ? "default" : "pointer", opacity: qs === "scoring" ? 0.6 : 1 }}>
                              {qs === "scoring" ? "Saving…" : "Save Unscored →"}
                            </button>
                          </>
                        ) : qs?.startsWith("error") ? (
                          <span style={{ fontFamily: T.fontMono, fontSize: 9, color: T.red }}>✗ {qs.replace("error:", "")}</span>
                        ) : !aeLoading ? (
                          <button onClick={() => doQuickScore(job)} disabled={qs === "scoring"}
                            style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", padding: "3px 10px", borderRadius: 3, border: `1px solid ${T.accentDim}`, background: T.greenBg, color: T.green, cursor: qs === "scoring" ? "default" : "pointer", opacity: qs === "scoring" ? 0.6 : 1 }}>
                            {qs === "scoring" ? "Saving…" : "⚡ Save Unscored →"}
                          </button>
                        ) : null}
          
                        <button onClick={() => doRemoveEmailJob(job.url)}
                          style={{ fontFamily: T.fontMono, fontSize: 9, padding: "3px 7px", borderRadius: 3, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, cursor: "pointer", marginLeft: "auto" }}>
                          ✕
                        </button>
                      </div>
                    </div>
                    );
                  })}
                  {emailJobs.every(j => quickScoring[j.url]?.startsWith("saved")) && emailJobs.length > 0 && (
                    <div style={{ textAlign: "center", padding: "20px 0", fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, letterSpacing: "0.1em" }}>
                      ALL ROLES SAVED TO PIPELINE ✓
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ════ EVALUATE ════ */}
      {tab === "manual" && (
        <>
          <Card>
            <div style={{ marginBottom: 10 }}>
              <input className="jsa-input" value={manualUrl} onChange={e => setManualUrl(e.target.value)} placeholder="Job URL (https://…)" style={{ fontSize: 14 }} />
            </div>
            <div style={{ ...grid3, marginBottom: 10 }}>
              <input className="jsa-input" value={manualTitle} onChange={e => setManualTitle(e.target.value)} placeholder="Job title" />
              <input className="jsa-input" value={manualCompany} onChange={e => setManualCompany(e.target.value)} placeholder="Company" />
              <input className="jsa-input" value={manualLocation} onChange={e => setManualLocation(e.target.value)} placeholder="Location" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <textarea className="jsa-textarea" style={{ height: 220 }} value={manualJd} onChange={e => { setManualJd(e.target.value); setEvalResult(null); setManualSaved(false); setEvalError(""); }} placeholder="Paste the full job description here…" />
            </div>
            <Btn primary onClick={doManualEvaluate} disabled={evalLoading} style={{ width: "100%" }}>{evalLoading ? "Analyzing…" : "Analyze Fit"}</Btn>
          </Card>
          <EvalPanel
            title={manualTitle || undefined}
            subtitle={manualCompany || undefined}
            result={evalResult}
            jd_text={manualJd}
            loading={evalLoading}
            error={evalError}
            saving={saving}
            saved={manualSaved}
            onSave={doSave}
            onTailor={evalResult ? () => {
              setTailorMode("paste");
              setTailorJd(manualJd);
              setTailorJobTitle(manualTitle);
              setTailorCompany(manualCompany);
              setTailorResult(null);
              setTailorError("");
              setTab("tailor");
            } : undefined}
          />
        </>
      )}

      {/* ════ PIPELINE ════ */}
      {tab === "saved" && (
        <>
          {/* STATUS SUMMARY */}
          {(() => {
            const counts = {
              new:          supabaseJobs.filter(j => j.status === "new").length,
              reviewing:    supabaseJobs.filter(j => j.status === "reviewing" || j.status === "reviewed").length,
              applied:      supabaseJobs.filter(j => j.status === "applied").length,
              interviewing: supabaseJobs.filter(j => j.status === "interviewing").length,
              offer:        supabaseJobs.filter(j => j.status === "offer").length,
              passed:       supabaseJobs.filter(j => j.status === "pass").length,
              rejected:     supabaseJobs.filter(j => j.status === "rejected").length,
              closed:       supabaseJobs.filter(j => j.status === "closed").length,
            };
            const total = supabaseJobs.length;
            const stats = [
              { label: "Total",        value: total,              color: T.textSecondary, bg: T.surface        },
              { label: "New",          value: counts.new,         color: T.textMuted,     bg: "transparent"    },
              { label: "Reviewing",    value: counts.reviewing,   color: T.blue,          bg: T.blueBg         },
              { label: "Applied",      value: counts.applied,     color: T.green,         bg: T.greenBg        },
              { label: "Interviewing", value: counts.interviewing, color: T.green,        bg: T.greenBg        },
              { label: "Offer",        value: counts.offer,       color: T.green,         bg: T.greenBg        },
              { label: "Passed",       value: counts.passed,      color: T.textMuted,     bg: T.surface        },
              { label: "Rejected",     value: counts.rejected,    color: T.red,           bg: T.redBg          },
              { label: "Closed",       value: counts.closed,      color: T.textMuted,     bg: T.surface        },
            ].filter(s => s.value > 0 || s.label === "Total");
            return (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16, padding: "10px 12px", background: T.surface, border: `1px solid ${T.borderFaint}`, borderRadius: 8 }}>
                {stats.map(({ label, value, color, bg }) => (
                  <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "4px 12px", borderRadius: 5, background: bg, border: `1px solid ${T.borderFaint}`, minWidth: 52 }}>
                    <span style={{ fontFamily: T.fontMono, fontSize: 15, fontWeight: 700, color, lineHeight: 1.2 }}>{value}</span>
                    <span style={{ fontFamily: T.fontMono, fontSize: 8, color: T.textMuted, letterSpacing: "0.07em", marginTop: 2 }}>{label.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* HERO — top new scored job */}
          {(() => {
            const heroJob = [...supabaseJobs]
              .filter(j => j.status === "new" && j.score != null && !dismissedSaved.includes(j.id))
              .map(j => enrichJob({ ...j, jd_text: j.description || "" }))
              .sort((a, b) => b.final_score - a.final_score)[0];
            if (!heroJob) return null;
            return (
              <div style={{ marginBottom: 20, background: T.panel, border: `1px solid ${T.greenBorder}`, borderRadius: 10, padding: 16, opacity: heroJob.final_score < 60 ? 0.45 : 1 }}>
                <div style={{ fontFamily: T.fontMono, fontSize: 9, color: T.green, letterSpacing: "0.1em", marginBottom: 10 }}>◆ TODAY'S TOP MATCH</div>
                <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                  <ScoreNum score={heroJob.final_score} hero />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: T.fontSans, fontWeight: 600, fontSize: 16, color: T.textPrimary, marginBottom: 2 }}>{heroJob.title || "Untitled"}</div>
                    <div style={{ fontFamily: T.fontMono, fontSize: 10, color: T.textMuted, marginBottom: 8 }}>{[heroJob.company, heroJob.location].filter(Boolean).join(" · ")}</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}><RecBadge rec={heroJob.recommendation} /><PursuitBadge pursuit={heroJob._pursuit} compact /></div>
                    {heroJob.verdict && <div style={{ fontFamily: T.fontSans, fontSize: 12, color: T.textMuted, lineHeight: 1.6, marginBottom: 10, borderLeft: `2px solid ${T.accentDim}`, paddingLeft: 10 }}>{heroJob.verdict.slice(0, 180)}{heroJob.verdict.length > 180 ? "…" : ""}</div>}
                    <div style={{ display: "flex", gap: 8 }}>
                      <Btn small primary onClick={() => { setTab("tailor"); setTailorMode("saved"); setSelectedSavedJob(heroJob); setTailorResult(null); setTailorError(""); }}>Tailor Resume →</Btn>
                      <Btn small onClick={() => { setManualTitle(heroJob.title || ""); setManualCompany(heroJob.company || ""); setManualLocation(heroJob.location || ""); setManualUrl(heroJob.url || ""); setManualJd(""); setManualJobId(heroJob.id || null); setEvalResult(null); setEvalError(""); setManualSaved(false); setTab("manual"); }}>Re-evaluate</Btn>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* FILTER BAR */}
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 12, padding: "8px 10px", background: T.surface, border: `1px solid ${T.borderFaint}`, borderRadius: 6 }}>
            {[
              { label: "All", status: "all" }, { label: "New", status: "new" },
              { label: "Reviewing", status: "reviewing" }, { label: "Applied", status: "applied" },
              { label: "Interviewing", status: "interviewing" }, { label: "Closed", status: "closed" },
            ].map(({ label, status }) => {
              const active = savedFilter.status === status;
              return <button key={status} onClick={() => setSavedFilter(f => ({ ...f, status }))} style={{ fontFamily: T.fontSans, fontSize: 12, fontWeight: active ? 500 : 400, padding: "3px 10px", borderRadius: 4, cursor: "pointer", border: `1px solid ${active ? T.accentDim : T.border}`, background: active ? T.greenBg : "transparent", color: active ? T.green : T.textMuted, transition: "all 0.12s" }}>{label}</button>;
            })}
            <div style={{ width: 1, height: 16, background: T.border, margin: "0 2px" }} />
            {[{ label: "Priority", value: "PRIORITY" }, { label: "Strong", value: "STRONG" }, { label: "Unscored", value: "unscored" }, { label: "⚠ Low Conf", value: "low_confidence" }, { label: "🚫 Relocation", value: "relocation" }].map(({ label, value }) => {
              const active = savedFilter.pursuit === value;
              const isRed = value === "relocation";
              return <button key={value} onClick={() => setSavedFilter(f => ({ ...f, pursuit: active ? "all" : value }))} style={{ fontFamily: T.fontSans, fontSize: 12, fontWeight: active ? 500 : 400, padding: "3px 10px", borderRadius: 4, cursor: "pointer", border: `1px solid ${active && isRed ? T.redBorder : T.border}`, background: active && isRed ? T.redBg : active ? T.surface : "transparent", color: active && isRed ? T.red : active ? T.textSecondary : T.textMuted, transition: "all 0.12s" }}>{label}</button>;
            })}
            <div style={{ width: 1, height: 16, background: T.border, margin: "0 2px" }} />
            {[{ label: "Score ↓", value: "score" }, { label: "Newest", value: "newest" }, { label: "Oldest", value: "oldest" }].map(({ label, value }) => {
              const active = savedSort === value;
              return <button key={value} onClick={() => setSavedSort(value)} style={{ fontFamily: T.fontSans, fontSize: 12, fontWeight: active ? 500 : 400, padding: "3px 10px", borderRadius: 4, cursor: "pointer", border: `1px solid ${active ? T.accentDim : T.border}`, background: active ? T.blueBg : "transparent", color: active ? T.blue : T.textMuted, transition: "all 0.12s" }}>{label}</button>;
            })}
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <Btn small onClick={doRefreshSupabase} disabled={reEvalRunning}>↻</Btn>
              <Btn small onClick={doCheckOpenJobs} disabled={checkRunning} title="Check Greenhouse + Lever jobs for closed listings. LinkedIn requires manual check.">{checkRunning ? "Checking…" : "🔍 Check Closed"}</Btn>
              <Btn small onClick={() => setShowReport(s => !s)} style={showReport ? { borderColor: T.accentDim, background: T.greenBg, color: T.green } : {}}>📋 Report</Btn>
              {selectedJobIds.size > 0 && (
                <Btn small onClick={doBulkDelete} style={{ borderColor: T.redBorder, background: T.redBg, color: T.red }}>
                  🗑 Delete ({selectedJobIds.size})
                </Btn>
              )}
              <Btn small onClick={doReScoreLowConfidence} disabled={reEvalRunning || !anthropicKey}>⚠ Re-score Low Conf</Btn>
              <Btn small primary onClick={() => doReEvaluateAll()} disabled={reEvalRunning || !supabaseJobs.length}>
                {reEvalRunning ? "Scoring…" : selectedJobIds.size > 0 ? `Re-score (${selectedJobIds.size})` : "Re-score all"}
              </Btn>
            </div>
          </div>

          {/* APPLICATION REPORT */}
          {showReport && (() => {
            const jobs = getAppliedJobs();
            return (
              <div style={{ marginBottom: 14, padding: "12px 14px", background: T.surface, border: `1px solid ${T.borderFaint}`, borderRadius: 7 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <span style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", color: T.textSecondary }}>
                      📋 JOB SEARCH LOG — WA UNEMPLOYMENT
                    </span>
                    <span style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, marginLeft: 10 }}>
                      {jobs.length} application{jobs.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={doCopyReportCsv} style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.07em", padding: "3px 10px", borderRadius: 3, border: `1px solid ${reportCopied === "csv" ? T.accentDim : T.border}`, background: reportCopied === "csv" ? T.greenBg : "transparent", color: reportCopied === "csv" ? T.green : T.textMuted, cursor: "pointer" }}>
                      {reportCopied === "csv" ? "✓ Copied" : "Copy CSV"}
                    </button>
                    <button onClick={doCopyReportText} style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.07em", padding: "3px 10px", borderRadius: 3, border: `1px solid ${reportCopied === "text" ? T.accentDim : T.border}`, background: reportCopied === "text" ? T.greenBg : "transparent", color: reportCopied === "text" ? T.green : T.textMuted, cursor: "pointer" }}>
                      {reportCopied === "text" ? "✓ Copied" : "Copy Text"}
                    </button>
                  </div>
                </div>
                {jobs.length === 0 ? (
                  <div style={{ fontFamily: T.fontSans, fontSize: 12, color: T.textMuted, padding: "8px 0" }}>
                    No applications yet — mark roles as Applied, Interviewing, or Offer to see them here.
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: T.fontMono, fontSize: 10 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                        {["Date Applied", "Company", "Position", "Status"].map(h => (
                          <th key={h} style={{ textAlign: "left", padding: "4px 8px 6px 0", fontWeight: 600, letterSpacing: "0.06em", color: T.textMuted, fontSize: 9 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map(j => (
                        <tr key={j.id} style={{ borderBottom: `1px solid ${T.borderFaint}` }}>
                          <td style={{ padding: "5px 8px 5px 0", color: T.textSecondary, whiteSpace: "nowrap" }}>
                            {new Date(j.applied_at || j.created_at).toLocaleDateString()}
                            {!j.applied_at && <span style={{ color: T.textMuted, fontSize: 8 }}> *</span>}
                          </td>
                          <td style={{ padding: "5px 8px 5px 0", color: T.textPrimary }}>{j.company || "—"}</td>
                          <td style={{ padding: "5px 8px 5px 0", color: T.textPrimary }}>{j.title || "—"}</td>
                          <td style={{ padding: "5px 0 5px 0", color: T.textSecondary, textTransform: "capitalize" }}>{j.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {jobs.some(j => !j.applied_at) && (
                  <div style={{ fontFamily: T.fontMono, fontSize: 8, color: T.textMuted, marginTop: 8 }}>
                    * Date shown is when the role was added to your pipeline, not when you applied. To track exact dates, run in Supabase SQL editor: <code style={{ background: T.panel, padding: "1px 4px", borderRadius: 2 }}>ALTER TABLE jobs ADD COLUMN applied_at timestamptz;</code>
                  </div>
                )}
              </div>
            );
          })()}

          {/* RE-EVAL PROGRESS */}
          {(reEvalRunning || reEvalProgress.label) && (
            <div style={{ marginBottom: 12, padding: "10px 14px", background: T.blueBg, border: `1px solid ${T.blueBorder}`, borderRadius: 7 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: reEvalRunning ? 8 : 0 }}>
                <span style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", color: T.blue }}>
                  {reEvalRunning ? `RE-SCORING ${reEvalProgress.current} / ${reEvalProgress.total}` : "◆ RE-SCORE COMPLETE"}
                </span>
                {!reEvalRunning && reEvalProgress.label && (
                  <span style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted }}>{reEvalProgress.label}</span>
                )}
              </div>
              {reEvalRunning && (
                <>
                  <div style={{ height: 3, background: T.border, borderRadius: 2, overflow: "hidden", marginBottom: 6 }}>
                    <div style={{ height: "100%", width: `${(reEvalProgress.current / reEvalProgress.total) * 100}%`, background: T.blue, borderRadius: 2, transition: "width 0.4s ease" }} />
                  </div>
                  <div style={{ fontFamily: T.fontSans, fontSize: 11, color: T.textMuted }} className="pulse">{reEvalProgress.label}</div>
                </>
              )}
            </div>
          )}
          {reEvalError && <ErrBox msg={reEvalError} />}
          {supabaseLoading && <div className="pulse" style={{ textAlign: "center", padding: "40px 0", fontFamily: T.fontMono, fontSize: 10, letterSpacing: "0.1em", color: T.textMuted }}>LOADING…</div>}
          {supabaseError && <ErrBox msg={supabaseError} />}
          {!supabaseLoading && supabaseJobs.length === 0 && !supabaseError && <div style={{ textAlign: "center", padding: "48px 0", fontFamily: T.fontMono, fontSize: 10, letterSpacing: "0.1em", color: T.textMuted }}>NO ROLES IN PIPELINE YET</div>}
          {dismissedSaved.length > 0 && <button onClick={doRestoreDismissed} style={{ marginBottom: 4, fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>show {dismissedSaved.length} hidden</button>}
          {supabaseJobs.filter(j => j.status === "pass").length > 0 && (
            <div style={{ marginBottom: 8, fontFamily: T.fontMono, fontSize: 9, color: T.textMuted }}>
              {supabaseJobs.filter(j => j.status === "pass").length} passed · <button onClick={() => supabaseJobs.filter(j => j.status === "pass").forEach(j => handleStatusChange(j.id, "new"))} style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>restore all</button>
            </div>
          )}
          {supabaseJobs.filter(j => j.status === "closed").length > 0 && savedFilter.status !== "closed" && (
            <div style={{ marginBottom: 8, fontFamily: T.fontMono, fontSize: 9, color: T.textMuted }}>
              {supabaseJobs.filter(j => j.status === "closed").length} closed · <button onClick={() => setSavedFilter(f => ({ ...f, status: "closed" }))} style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>view</button> · <button onClick={() => supabaseJobs.filter(j => j.status === "closed").forEach(j => handleStatusChange(j.id, "new"))} style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>restore all</button>
            </div>
          )}
          {checkSummary && (
            <div style={{ marginBottom: 10, padding: "8px 12px", background: T.surface, border: `1px solid ${T.borderFaint}`, borderRadius: 6, fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>🔍 Checked {checkSummary.checked} job{checkSummary.checked !== 1 ? "s" : ""}{checkSummary.closed > 0 ? ` · ${checkSummary.closed} closed` : " · all open"}{checkSummary.skipped > 0 ? ` · ${checkSummary.skipped} LinkedIn (manual check)` : ""}</span>
              <button onClick={() => setCheckSummary(null)} style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, fontFamily: T.fontMono, fontSize: 9, padding: 0 }}>✕</button>
            </div>
          )}

          {[...supabaseJobs].filter(j => !dismissedSaved.includes(j.id) && j.status !== "pass" && (j.status !== "closed" || savedFilter.status === "closed")).filter(j => {
            const ej = enrichJob({ ...j, jd_text: j.description || "" });
            if (savedFilter.status !== "all" && j.status !== savedFilter.status) return false;
            if (savedFilter.pursuit !== "all") {
              if (savedFilter.pursuit === "unscored") return j.score == null;
              if (savedFilter.pursuit === "low_confidence") return isLowConfidence(j);
              if (savedFilter.pursuit === "relocation") return ej._location_tier === "relocation";
              if (ej._pursuit !== savedFilter.pursuit) return false;
            }
            return true;
          }).map(j => enrichJob({ ...j, jd_text: j.description || "" })).sort((a, b) => {
            if (savedSort === "newest" || savedSort === "oldest") {
              const da = new Date(a.created_at || 0).getTime();
              const db = new Date(b.created_at || 0).getTime();
              return savedSort === "newest" ? db - da : da - db;
            }
            if (a.score == null && b.score == null) return 0;
            if (a.score == null) return 1;
            if (b.score == null) return -1;
            return b.final_score - a.final_score;
          }).map(job => (
            <div key={job.id} className="jsa-card-hover" style={{ background: T.panel, border: `1px solid ${job.score == null ? T.amberBorder : T.borderFaint}`, borderRadius: 8, padding: "10px 12px", marginBottom: 6, transition: "background 0.15s, border-color 0.15s", opacity: job.score != null && job.final_score < 60 ? 0.45 : 1 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div onClick={e => { e.stopPropagation(); setSelectedJobIds(prev => { const next = new Set(prev); next.has(job.id) ? next.delete(job.id) : next.add(job.id); return next; }); }}
                  style={{ width: 14, height: 14, flexShrink: 0, marginTop: 3, border: `1px solid ${selectedJobIds.has(job.id) ? T.accentDim : T.border}`, borderRadius: 3, background: selectedJobIds.has(job.id) ? T.greenBg : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {selectedJobIds.has(job.id) && <span style={{ fontFamily: T.fontMono, fontSize: 8, color: T.green }}>✓</span>}
                </div>
                {job.score == null ? (
                  <span style={{ fontFamily: T.fontMono, fontSize: 11, fontWeight: 600, color: T.amber, flexShrink: 0, marginTop: 1 }}>—</span>
                ) : (
                  <ScoreNum score={job.final_score} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2, flexWrap: "wrap" }}>
                    <div style={{ fontFamily: T.fontSans, fontWeight: 500, fontSize: 13, color: job.status === "closed" ? T.textMuted : T.textPrimary }}>{job.title || "Untitled"}</div>
                    {job.status === "closed" && <span style={{ fontFamily: T.fontMono, fontSize: 8, fontWeight: 700, letterSpacing: "0.1em", color: T.textMuted, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 3, padding: "1px 5px" }}>CLOSED</span>}
                    {checkingJobIds.has(job.id) && <span className="pulse" style={{ fontFamily: T.fontMono, fontSize: 8, letterSpacing: "0.08em", color: T.textMuted }}>checking…</span>}
                  </div>
                  <div style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, marginBottom: 8, letterSpacing: "0.04em" }}>{[job.company, job.location].filter(Boolean).join(" · ")}{job.created_at && ` · Added ${new Date(job.created_at).toLocaleDateString()}`}</div>
                  {job.score == null ? (
                    // Unscored card — show prompt to add JD
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontFamily: T.fontSans, fontSize: 11, color: T.amber, marginBottom: 8, lineHeight: 1.5 }}>
                        Open the role on LinkedIn, copy the full job description, then score it:
                      </div>
                      <button onClick={() => {
                        setManualTitle(job.title || "");
                        setManualCompany(job.company || "");
                        setManualLocation(job.location || "");
                        setManualUrl(job.url || "");
                        setManualJd("");
                        setManualJobId(job.id || null);
                        setEvalResult(null); setEvalError(""); setManualSaved(false);
                        setTab("manual");
                      }} style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", padding: "4px 10px", borderRadius: 3, border: `1px solid ${T.accentDim}`, background: T.greenBg, color: T.green, cursor: "pointer" }}>
                        → Paste JD & Score
                      </button>
                      {job.url && <a href={job.url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, textDecoration: "none", letterSpacing: "0.06em", marginLeft: 10 }}>VIEW ↗</a>}
                      <button onClick={() => doPassJob(job.id)}
                        style={{ marginLeft: "auto", fontFamily: T.fontMono, fontSize: 9, padding: "3px 7px", borderRadius: 3, border: `1px solid ${T.redBorder}`, background: T.redBg, color: T.red, cursor: "pointer" }}>
                        ✗ Pass
                      </button>
                      <button onClick={() => doDeleteJob(job.id)}
                        style={{ fontFamily: T.fontMono, fontSize: 9, padding: "3px 7px", borderRadius: 3, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, cursor: "pointer" }}>
                        🗑
                      </button>
                    </div>
                  ) : (
                    // Scored card — full display
                    <>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}><RecBadge rec={job.recommendation} /><PursuitBadge pursuit={job._pursuit} compact /></div>
                      <LocationBadge job={job} />
                      <div style={{ fontFamily: T.fontSans, fontSize: 11, color: T.textMuted, fontStyle: "italic", marginBottom: 8, marginTop: 4 }}>{job._time_strategy}</div>
                      {job.verdict && (
                        <div style={{ fontFamily: T.fontSans, fontSize: 11, color: T.textMuted, lineHeight: 1.6, marginBottom: 6, marginTop: 4, padding: "8px 10px", background: T.surface, borderRadius: 5, borderLeft: `2px solid ${T.accentDim}` }}>
                          {job.verdict}
                        </div>
                      )}
                      <TopCandidateSignal signal={job.top_candidate_signal} />
                      <ScoreExplanationBlock explanation={job.score_explanation} />
                      <ScoreBreakdown job={job} />
                      <ScoreWarnings job={job} jd_text={job.description || ""} />
                      {isLowConfidence(job) && (
                        <div style={{ marginTop: 8, marginBottom: 4 }}>
                          {!inlineJdOpen[job.id] ? (
                            <button
                              onClick={() => setInlineJdOpen(prev => ({ ...prev, [job.id]: true }))}
                              style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", padding: "3px 10px", borderRadius: 3, border: `1px solid ${T.amberBorder}`, background: T.amberBg, color: T.amber, cursor: "pointer" }}>
                              ⚠ Paste Full JD → Re-score
                            </button>
                          ) : (
                            <div style={{ marginTop: 6 }}>
                              <textarea
                                className="jsa-textarea"
                                style={{ height: 120, marginBottom: 6 }}
                                placeholder="Paste the full job description here for a higher-confidence re-score…"
                                value={inlineJdPaste[job.id] || ""}
                                onChange={e => setInlineJdPaste(prev => ({ ...prev, [job.id]: e.target.value }))}
                              />
                              <div style={{ display: "flex", gap: 6 }}>
                                <button
                                  onClick={() => doInlineRescore(job)}
                                  disabled={!inlineJdPaste[job.id]?.trim() || inlineRescoring[job.id]}
                                  style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", padding: "3px 12px", borderRadius: 3, border: `1px solid ${T.accentDim}`, background: T.greenBg, color: T.green, cursor: (!inlineJdPaste[job.id]?.trim() || inlineRescoring[job.id]) ? "default" : "pointer", opacity: (!inlineJdPaste[job.id]?.trim() || inlineRescoring[job.id]) ? 0.5 : 1 }}>
                                  {inlineRescoring[job.id] ? "Scoring…" : "⟳ Re-score with Full JD"}
                                </button>
                                <button
                                  onClick={() => { setInlineJdOpen(prev => ({ ...prev, [job.id]: false })); setInlineJdPaste(prev => ({ ...prev, [job.id]: "" })); }}
                                  style={{ fontFamily: T.fontMono, fontSize: 9, padding: "3px 8px", borderRadius: 3, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, cursor: "pointer" }}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      <ScoreMeta enriched={job} />
                      <StatusButtons jobId={job.id} currentStatus={job.status} onStatusChange={(id, status) => {
                        handleStatusChange(id, status);
                        // Auto-hide rejected jobs
                        if (status === "rejected" || status === "closed") {
                          setTimeout(() => doDismissSavedJob(id), 600);
                        }
                      }} />
                      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <button onClick={() => { setTab("tailor"); setTailorMode("saved"); setSelectedSavedJob(job); setTailorResult(null); setTailorError(""); }}
                          style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", padding: "4px 10px", borderRadius: 3, border: `1px solid ${T.blueBorder}`, background: T.blueBg, color: T.blue, cursor: "pointer" }}>
                          ◆ TAILOR →
                        </button>
                        <button onClick={() => {
                          setManualTitle(job.title || "");
                          setManualCompany(job.company || "");
                          setManualLocation(job.location || "");
                          setManualUrl(job.url || "");
                          setManualJd("");
                          setManualJobId(job.id || null);
                          setEvalResult(null); setEvalError(""); setManualSaved(false);
                          setTab("manual");
                        }}
                          style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", padding: "4px 10px", borderRadius: 3, border: `1px solid ${T.accentDim}`, background: T.greenBg, color: T.green, cursor: "pointer" }}>
                          → Re-evaluate
                        </button>
                        {job.url && <a href={job.url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, textDecoration: "none", letterSpacing: "0.06em" }}>VIEW ↗</a>}
                        <button onClick={() => doPassJob(job.id)}
                          style={{ marginLeft: "auto", fontFamily: T.fontMono, fontSize: 9, padding: "3px 7px", borderRadius: 3, border: `1px solid ${T.redBorder}`, background: T.redBg, color: T.red, cursor: "pointer" }}>
                          ✗ Pass
                        </button>
                        <button onClick={() => doDeleteJob(job.id)}
                          style={{ fontFamily: T.fontMono, fontSize: 9, padding: "3px 7px", borderRadius: 3, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, cursor: "pointer" }}>
                          🗑
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}

        </>
      )}

      {/* ════ TAILOR ════ */}
      {tab === "tailor" && (
        <>
          <Card>
            <div style={{ fontFamily: T.fontSans, fontSize: 12, color: T.textMuted, lineHeight: 1.7, marginBottom: 14 }}>Claude positions you as the top-tier candidate — rewriting bullets for impact, upgrading language, surfacing strategic gaps.</div>
            {!masterResume.trim() && <div style={{ marginBottom: 14, padding: "8px 12px", background: T.amberBg, border: `1px solid ${T.amberBorder}`, borderRadius: 6, fontFamily: T.fontMono, fontSize: 9, color: T.amber, letterSpacing: "0.08em" }}>⚠ ADD MASTER RESUME IN SETTINGS BEFORE TAILORING</div>}
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {[{ key: "paste", label: "PASTE JD" }, { key: "saved", label: "FROM SAVED" }].map(m => (
                  <button key={m.key} className="jsa-toggle" onClick={() => { setTailorMode(m.key); setTailorResult(null); setTailorError(""); }}
                    style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", padding: "5px 12px", borderRadius: 4, border: `1px solid ${tailorMode === m.key ? T.accentDim : T.border}`, background: tailorMode === m.key ? T.greenBg : "transparent", color: tailorMode === m.key ? T.green : T.textMuted, cursor: "pointer", transition: "all 0.15s" }}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            {tailorMode === "paste" && (
              <>
                <div style={{ ...grid2, marginBottom: 10 }}>
                  <div><input className="jsa-input" value={tailorJobTitle} onChange={e => setTailorJobTitle(e.target.value)} placeholder="Job title" /></div>
                  <div><input className="jsa-input" value={tailorCompany} onChange={e => setTailorCompany(e.target.value)} placeholder="Company" /></div>
                </div>
                <div style={{ marginBottom: 14 }}><textarea className="jsa-textarea" style={{ height: 180 }} value={tailorJd} onChange={e => { setTailorJd(e.target.value); setTailorResult(null); setTailorError(""); }} placeholder="Paste the full job description here…" /></div>
              </>
            )}
            {tailorMode === "saved" && (
              <div style={{ marginBottom: 14 }}>
                {supabaseJobs.length === 0
                  ? <div style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, padding: "12px 0", letterSpacing: "0.08em" }}>NO SAVED ROLES YET</div>
                  : <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 240, overflowY: "auto", marginTop: 6 }}>
                      {[...supabaseJobs].filter(j => !dismissedSaved.includes(j.id) && (j.status === "new" || j.status === "reviewing")).map(j => enrichJob({ ...j, jd_text: j.description || "" })).sort((a, b) => b.final_score - a.final_score).map(job => {
                        const isSel = selectedSavedJob?.id === job.id;
                        const cfg = PURSUIT_CONFIG[job._pursuit] || PURSUIT_CONFIG.PASS;
                        return (
                          <div key={job.id} onClick={() => { setSelectedSavedJob(job); setTailorResult(null); setTailorError(""); }}
                            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: 6, border: `1px solid ${isSel ? T.accentDim : T.borderFaint}`, background: isSel ? T.greenBg : T.surface, cursor: "pointer", transition: "all 0.15s" }}>
                            <div>
                              <div style={{ fontFamily: T.fontSans, fontWeight: isSel ? 500 : 400, fontSize: 12, color: isSel ? T.green : T.textPrimary }}>{job.title || "Untitled"}</div>
                              <div style={{ fontFamily: T.fontMono, fontSize: 9, color: T.textMuted, marginTop: 1 }}>{job.company}{job.location && ` · ${job.location}`}</div>
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <Pill color={cfg.color} bg={cfg.bg} border={cfg.border}>{cfg.label}</Pill>
                              <span style={{ fontFamily: T.fontMono, fontSize: 13, fontWeight: 600, color: scoreColor(job.final_score) }}>{job.final_score}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                }
              </div>
            )}
            <Btn primary onClick={doTailorResume} disabled={tailorLoading}>{tailorLoading ? "Positioning…" : "✦ Position My Resume →"}</Btn>
            <ErrBox msg={tailorError} />
          </Card>
          {tailorLoading && <div className="pulse" style={{ textAlign: "center", padding: "32px 0", fontFamily: T.fontMono, fontSize: 10, letterSpacing: "0.1em", color: T.textMuted }}>POSITIONING RESUME…</div>}
          <TailoredResumePanel result={tailorResult} onDownload={doDownloadTxt} downloading={downloading} />
        </>
      )}
    </div>
  );
}