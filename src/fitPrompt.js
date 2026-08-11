/**
 * ═══════════════════════════════════════════════════════════════
 * FIT EXTRACTION PROMPT (single source of truth)
 *
 * Previously this prompt lived in TWO places — ingestion.js and App.jsx —
 * with a "keep in sync" comment. They had already drifted apart (App.jsx
 * gained a 5th calibration anchor and expanded prose that ingestion.js never
 * got), which meant a job scored via the Evaluate tab and the same job scored
 * via the pipeline could get different numbers. One module, imported by both.
 *
 * CRITICAL DESIGN POINT
 * This prompt does NOT ask the model for a fit score. The previous version
 * asked for `overall_score` 0-100 against a prose rubric, and 33% of the entire
 * pipeline came back as the single value 72. Open-ended LLM scoring regresses
 * hard to the middle of whatever band the rubric describes.
 *
 * Instead the model EXTRACTS structured evidence and src/scoring.js does the
 * arithmetic deterministically. The model classifies; it never scores.
 * ═══════════════════════════════════════════════════════════════
 */

export const CANDIDATE_PROFILE = `Matt Young — Seattle, WA. 15+ years in infrastructure automation, observability, and agentic platforms.

CAREER
- Domotz — VP Product. 500K+ managed endpoints. Built an MCP-based agentic remediation platform.
- VMware Wavefront — Director PM. Telemetry and observability at cloud scale. Churn 20% → 7%, 25% YoY revenue growth. Lyft and DoorDash as named partners.
- Puppet — Sr Director / Director PM. Agent-based automation across 10M+ endpoints, 75% of the Fortune 100. Puppet Pipelines CI/CD (used by Disney).
- HPE — Group / Senior PM. Co-created Monasca, an OpenStack observability project.
- Sila Solutions — supporting Boeing Digital Aviation.

OPEN SOURCE: OpenStack, CNCF, CDF, Puppet core product ownership.

PLATFORM ENGINEERING FLUENCY: Working Kubernetes knowledge — Helm chart authorship and
operator patterns, cloud-native deployment and packaging. Cloud-native telemetry at
200K+ containers per cluster at Wavefront. Treat a Kubernetes, Helm or operator
requirement as MET, not as a gap.

WHAT HE IS ACTUALLY OPTIMIZING FOR (this is not negotiable and is frequently missed):
He is DELIBERATELY targeting Senior Director, Group PM, Staff, or Principal roles at
established companies. He is stepping back from CPO and VP-of-everything scope ON PURPOSE
— lower variance, better cash compensation, more predictable hours. His son is a senior in
2026-2027 and he intends to be present for it. A CPO role at a hot startup is a BAD fit
right now no matter how well the keywords line up.`;

export const FIT_EXTRACTION_PROMPT = `You are an evidence extractor for a job-fit model. You do NOT score fit. You classify a job posting into structured signals; deterministic code computes the score from what you return.

Return ONLY raw JSON — no markdown fences, no preamble.

Schema:
{
  "domain": { "primary": "non_interchangeable" | "adjacent" | "novel",
              "secondary": same enum or null,
              "why": "one sentence" },
  "title_band": "target" | "staff" | "director" | "vp_scoped" | "org_owner" | "senior_pm" | "below" | "non_pm",
  "title_band_why": "one sentence",
  "non_interchangeable_matches": [ { "proof": "<proof key>", "strength": "direct" | "partial", "why": "one sentence" } ],
  "stated_tc": number | null,
  "stated_base": number | null,
  "stated_variable": number | null,
  "comp_note": "what the posting actually said about money, or 'not stated'",
  "location_posture": one of the enum values below, OR an array of them when the
                      posting offers a choice of sites,
  "on_call": boolean,
  "travel_heavy": boolean,
  "known_gaps": [ { "gap": "<gap key>", "level": "required" | "preferred", "why": "one sentence" } ],
  "strengths": [up to 4 short strings],
  "gaps": [up to 3 short strings],
  "quick_wins": [up to 3 short strings],
  "verdict": "2-3 sentence honest assessment"
}

── DOMAIN CLASSIFICATION ──
"non_interchangeable" — roles where he BUILT the thing the JD describes, not roles his
  experience merely maps to: observability and telemetry, ITOM/AIOps, network and IT
  operations management, infrastructure automation, agentic/MCP platforms, developer tooling.
"adjacent" — general cloud infrastructure, data platform, SRE tooling, security operations.
"novel" — GPU infrastructure, MicroVM/Firecracker, ML training platforms and direct MLflow
  ownership, consumer, fintech, healthcare, martech.

Use "secondary" when a role genuinely blends two classes. This matters: an observability
product delivered ON GPU infrastructure is primary=non_interchangeable, secondary=novel,
and the blend is what surfaces the real risk. Do not force a single class to be tidy.

── TITLE BAND ──
"target"     — Senior Director, Group PM, Principal PM. The band he wants.
"staff"      — Staff PM. One rung below target on the individual-contributor ladder — still
               senior, still worth showing him, priced with its own (small) discount.
"director"   — Director. Adjacent to target.
"vp_scoped"  — VP of Product at a LARGE company where the role is scoped, not "own everything".
"org_owner"  — CPO, Head of Product, or VP of Product where he would BE the ENTIRE product
               function: no peer product groups, typically reporting to the CEO. He is
               deliberately avoiding this. Classify honestly even when the posting is
               attractive. If the JD names peer product lines, or the role reports into a
               larger product organisation, it is NOT org_owner.
"senior_pm"  — Senior Product Manager ("Senior PM", "Sr. PM", "Sr Product Manager"). A further
               rung below Staff on the individual-contributor ladder — still worth showing
               him, priced with a larger discount than "staff".
"below"      — More junior than Senior PM: a bare "Product Manager", "Associate Product
               Manager", or "PM I/II" with no seniority modifier at all.
"non_pm"     — an engineering role wearing product language (VP Engineering, CTO, Principal Engineer).

For "target", "director", "vp_scoped" and "org_owner", classify by the SCOPE OF THE PRODUCT
ORG, not by whether the role manages people. Managing PMs does not by itself make a role
org_owner — a first-line manager who owns ONE product group inside a larger product org is
squarely "target". So is a player-coach who owns strategy directly while hiring the team
that will own it later.

A leading "Manager," or "Manager of" in a title denotes a people-management line, not a
diminished scope: "Manager, Group Product Manager — Platform" is a Group PM role and
belongs in "target". Read the whole posting before deciding: a role that hires three PMs
for named sub-areas of a platform, alongside other product groups at the same company, is
target — not org_owner and not below.

"staff", "senior_pm" and "below" are different: read them LITERALLY off the seniority word
in the title — "Staff", "Senior"/"Sr", or neither — not off scope. These are
individual-contributor rungs. Do not promote a Senior PM to "staff" or "target" because the
JD describes broad ownership, and do not demote a Staff PM to "below" because it manages no
one — the discount for each band is already priced in downstream. If a title genuinely
reads as both a management line AND a bare IC ladder rung (rare), prefer the management
reading and use "target"/"director" instead.

── NON-INTERCHANGEABILITY PROOF KEYS ──
Emit a match ONLY when the JD describes a specific problem he has already solved. Generic
senior-product-leader vocabulary is NOT a match — leave the array empty in that case.
  "mcp_agentic"       — MCP-based agentic infrastructure (built at Domotz before BMC announced Agent Gateway)
  "telemetry_econ"    — high-cardinality telemetry and observability economics (Wavefront)
  "agent_fleet"       — agent-based fleet management at 10M+ endpoint scale (Puppet)
  "gitops_cicd"       — GitOps and CI/CD (Puppet Pipelines, Disney)
  "open_source"       — OpenStack / CNCF / CDF track record, co-created Monasca
  "usage_metering"    — consumption-based pricing, metering and billing for infrastructure usage
                        (telemetry ingestion pricing at Wavefront, SaaS pricing and ARR at Domotz)
  "identity_security" — enterprise identity, RBAC, policy and compliance surfaces
                        (Fortune 100 fleet policy at Puppet, network security monitoring at Domotz)
  "k8s_platform"      — Kubernetes platform depth: Helm chart authorship, operator patterns,
                        cloud-native packaging and telemetry at 200K+ containers per cluster
"direct" = the JD names this problem. "partial" = clearly adjacent but not the same problem.

── KNOWN GAP KEYS ──
Emit only when the JD actually asks for it. "required" if listed as a requirement,
"preferred" if a nice-to-have.
  "gpu_infra"      — GPU infrastructure
  "microvm"        — MicroVM / Firecracker
  "mlflow"         — direct MLflow ownership / ML training platforms
  "vendor_fluency" — deep single-vendor internal product knowledge an internal hire would have

Kubernetes, Helm and operators are NOT a gap — see PLATFORM ENGINEERING FLUENCY in the
candidate profile. A Kubernetes requirement is met; emit "k8s_platform" as a proof point
instead of a gap.

── COMPENSATION ──
Report ONLY what the posting states, in THOUSANDS of USD. 320 means $320,000.
Never return 320000. Never return a dollars figure.

Almost every posting quotes a BASE SALARY range, because pay-transparency law requires
it — total compensation is essentially never quoted, since it depends on an equity grant
and bonus target the posting does not contain. Therefore:
  - A salary range or single salary figure → put the MIDPOINT in "stated_base".
  - Use "stated_tc" ONLY when the posting explicitly says "total compensation",
    "OTE", or "total rewards package" and gives a number for it.
  - When in doubt it is a base. Put it in stated_base.
  - Put a separately stated bonus or commission target in "stated_variable".

If nothing is stated, return null for all three. DO NOT estimate, infer from company
reputation, or substitute a typical value. A null here is correct and expected; a guess
corrupts the model.

── LOCATION POSTURE ──
"remote"            — genuinely remote
"seattle"           — Seattle / Bellevue / Redmond / WA based
"hybrid_local"      — hybrid in the Seattle area
"hybrid_remote"     — hybrid requiring regular presence in another metro (Bay Area, NYC, etc.)
"office_relocation" — requires relocating

Be literal. If the posting says "hybrid — 3 days in our San Francisco office", that is
hybrid_remote and it is a serious negative, not a detail.

When the posting offers a CHOICE of sites, return ALL of them as an array — the
candidate picks, so the role is scored on the option he would actually take.
"Bellevue or San Francisco, 4 days per week" is ["hybrid_local", "hybrid_remote"],
NOT hybrid_remote. Returning only the non-Seattle site turns a local job into a
Bay Area job. A single site is still a plain string.`;

/** Builds the user message for an extraction call. */
export function buildFitUserMessage({ title, company, location, jd }) {
  return [
    `JOB TITLE: ${title || "Not specified"}`,
    `COMPANY: ${company || "Not specified"}`,
    `LOCATION: ${location || "Not specified"}`,
    ``,
    `JOB DESCRIPTION:`,
    jd || "(no description available)",
    ``,
    `CANDIDATE PROFILE:`,
    CANDIDATE_PROFILE,
  ].join("\n");
}

/** Maps the raw extraction JSON onto the signal shape computeFit() expects. */
export function extractionToSignals(x, { company, jd }) {
  return {
    company,
    domain: { primary: x?.domain?.primary, secondary: x?.domain?.secondary || null },
    titleBand: x?.title_band,
    nonInterchangeableMatches: Array.isArray(x?.non_interchangeable_matches) ? x.non_interchangeable_matches : [],
    statedTc: x?.stated_tc ?? null,
    statedBase: x?.stated_base ?? null,
    statedVariable: x?.stated_variable ?? null,
    locationPosture: x?.location_posture,
    onCall: !!x?.on_call,
    travelHeavy: !!x?.travel_heavy,
    knownGaps: Array.isArray(x?.known_gaps) ? x.known_gaps : [],
    jdChars: (jd || "").trim().length,
  };
}
