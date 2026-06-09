#!/usr/bin/env node
/**
 * Reads Connections.csv from the project root, classifies each connection,
 * and writes src/data/connections.json.
 *
 * LinkedIn CSV format has a note on line 1 and column headers on line 2.
 * Run from the project root:
 *   node src/scripts/process-connections.js
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const csvText = readFileSync(join(ROOT, "Connections.csv"), "utf8");
const lines = csvText.split("\n");

// LinkedIn exports vary: disclaimer is 1-2 lines before the actual headers.
// Find the header line by looking for "First Name".
const headerIdx = lines.findIndex(l => /first.?name/i.test(l));
if (headerIdx === -1) { console.error("Could not find header row in CSV"); process.exit(1); }
const headerLine = lines[headerIdx];
const dataLines = lines.slice(headerIdx + 1);

function parseCsvLine(line) {
  const result = [];
  let field = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { field += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      result.push(field.trim());
      field = "";
    } else {
      field += ch;
    }
  }
  result.push(field.trim());
  return result;
}

const headers = parseCsvLine(headerLine).map(h =>
  h.replace(/"/g, "").replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, "_")
);
console.log("Headers detected:", headers);

function getSeniority(position) {
  const p = (position || "").toLowerCase();
  if (/\b(ceo|cto|cpo|coo|cfo|president)\b|\bfounder\b|co-founder/.test(p)) return "C-Suite / Founder";
  if (/\b(svp|evp|senior vice president|executive vice president)\b/.test(p)) return "SVP / EVP";
  if (/\bvp\b|\bvice president\b/.test(p)) return "VP";
  if (/\bsenior director\b|\bsr\.?\s*director\b/.test(p)) return "Senior Director";
  if (/\bdirector\b/.test(p)) return "Director";
  if (/\bprincipal\b|\bstaff\b|\bdistinguished\b|\bfellow\b/.test(p)) return "Principal / Staff";
  if (/\bmanager\b|\bhead of\b/.test(p)) return "Manager / Head";
  if (/\bsenior\b|\bsr\.\b/.test(p)) return "Senior IC";
  if (/\bassociate\b|\banalyst\b|\bcoordinator\b|\bspecialist\b/.test(p)) return "Associate / Analyst";
  return "IC";
}

function getFunction(position) {
  const p = (position || "").toLowerCase();
  if (/\bproduct manager\b|\bhead of product\b|\bvp.{0,5}product\b|\bchief product\b|\bcpo\b/.test(p)) return "Product Management";
  if (/\bengineer\b|\bdeveloper\b|\barchitect\b|\bsre\b|\bdevops\b/.test(p)) return "Engineering";
  if (/\bdesign\b|\bux\b|\bui\b|\bcreative director\b/.test(p)) return "Design / UX";
  if (/\brecruit\b|\btalent\b|\bstaffing\b|\bexecutive search\b/.test(p)) return "Recruiting / Talent";
  if (/\bsales\b|\baccount executive\b|\bbusiness development\b|\bgtm\b|\brevenue\b/.test(p)) return "Sales / BD / GTM";
  if (/\bmarketing\b|\bcontent\b|\bbrand\b|\bcommunications\b|\bgrowth\b/.test(p)) return "Marketing";
  if (/\b(ceo|cto|coo|cfo|president|founder)\b/.test(p)) return "Executive / Leadership";
  if (/\bprogram manager\b|\bproject manager\b|\bchief of staff\b|\boperations\b/.test(p)) return "Program / Operations";
  return "Other";
}

function getIndustry(company) {
  const c = (company || "").toLowerCase();
  if (/datadog|new relic|grafana|honeycomb|splunk|dynatrace|elastic|chronosphere|cribl|mezmo|lightstep|wavefront|sumo logic|kentik|observe\.inc|coralogix/.test(c)) return "Observability / Monitoring";
  if (/\bai\b|openai|anthropic|deepmind|cohere|mistral|databricks|arize|fiddler|galileo|scale ai|hugging face|glean|braintrust/.test(c)) return "AI / ML / LLMOps";
  if (/servicenow|bmc software|cherwell|ivanti|itsm/.test(c)) return "IT Operations / ITSM";
  if (/puppet|hashicorp|chef|ansible|pulumi|upbound|circleci|harness|launchdarkly/.test(c)) return "DevOps / IaC / Platform Eng";
  if (/github|gitlab|atlassian|linear|figma|productboard|postman|dbt labs|fivetran/.test(c)) return "Developer Tools / Productivity";
  if (/vmware|suse|red hat|redhat|docker|rancher|coreweave|vercel|temporal/.test(c)) return "Cloud Native / Infra";
  if (/amazon web services|aws|google cloud|microsoft azure|azure/.test(c)) return "Cloud Providers / Hyperscalers";
  if (/recruit|talent acquisition|staffing|headhunt|executive search|search firm|korn ferry|spencer stuart|heidrick|russell reynolds|true search/.test(c)) return "Recruiting / Talent Firms";
  if (/venture|bessemer|sequoia|insight partners|andreessen|a16z|general catalyst|greylock|battery|accel|lightspeed|tiger global/.test(c)) return "VC / PE / Investors";
  if (/palo alto networks|crowdstrike|zscaler|cisco|fortinet|okta|sentinelone/.test(c)) return "Network / Security";
  if (/\bmicrosoft\b|google|amazon|\bibm\b|oracle|sap|\bhpe\b|\bdell\b|broadcom|salesforce|workday/.test(c)) return "Enterprise Tech (Big Co)";
  if (/bank|financial|stripe|coinbase|visa|capital|fund|fintech|brex|plaid/.test(c)) return "Financial Services / FinTech";
  if (/boeing|lockheed|raytheon|federal|government|defense|epirus|anduril|palantir/.test(c)) return "Aerospace / Defense / Gov";
  if (/health|medical|pharma|biotech|clinical|optum|humana/.test(c)) return "Healthcare / Life Sciences";
  if (/accenture|deloitte|mckinsey|kpmg|pwc|consulting|advisors/.test(c)) return "Consulting / Advisory";
  return "Other / Misc";
}

const SENIORITY_WEIGHTS = {
  "C-Suite / Founder": 7, "SVP / EVP": 6, "VP": 5, "Senior Director": 4,
  "Director": 3, "Principal / Staff": 3, "Manager / Head": 2, "Senior IC": 1,
  "Associate / Analyst": 0, "IC": 1,
};

const INDUSTRY_WEIGHTS = {
  "Observability / Monitoring": 10, "AI / ML / LLMOps": 9,
  "IT Operations / ITSM": 8, "Recruiting / Talent Firms": 8,
  "DevOps / IaC / Platform Eng": 8, "Developer Tools / Productivity": 7,
  "Cloud Native / Infra": 7, "VC / PE / Investors": 7,
  "Network / Security": 6, "Cloud Providers / Hyperscalers": 5,
  "Enterprise Tech (Big Co)": 4, "Consulting / Advisory": 3,
  "Financial Services / FinTech": 2, "Aerospace / Defense / Gov": 2,
  "Other / Misc": 2, "Healthcare / Life Sciences": 1,
};

function getPriorityScore(seniority, industry, fn) {
  const sw = SENIORITY_WEIGHTS[seniority] ?? 1;
  const iw = INDUSTRY_WEIGHTS[industry] ?? 1;
  const fb = fn === "Product Management" ? 5 : fn === "Recruiting / Talent" ? 3 : 0;
  return sw * iw + fb;
}

const connections = [];
for (const line of dataLines) {
  if (!line.trim()) continue;
  const fields = parseCsvLine(line);
  if (fields.length < 5) continue;
  const obj = {};
  headers.forEach((h, i) => { obj[h] = (fields[i] || "").replace(/^"|"$/g, ""); });

  const position = obj.position || "";
  const company = obj.company || "";
  const seniority = getSeniority(position);
  const fn = getFunction(position);
  const industry = getIndustry(company);
  const priority = getPriorityScore(seniority, industry, fn);

  // Fuzzy field lookup — handles header variations across LinkedIn export formats
  const get = (...keys) => {
    for (const k of keys) { if (obj[k]) return obj[k]; }
    return "";
  };

  connections.push({
    firstName: get("first_name", "firstname", "first"),
    lastName: get("last_name", "lastname", "last"),
    url: get("url", "linkedin_url", "profile_url"),
    email: get("email_address", "email", "e-mail"),
    company,
    position,
    connectedOn: get("connected_on", "connection_date", "connected"),
    seniority,
    function: fn,
    industry,
    priority,
  });
}

connections.sort((a, b) => b.priority - a.priority);

const outDir = join(__dirname, "..", "data");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "connections.json");
writeFileSync(outPath, JSON.stringify(connections, null, 2));
console.log(`✓ Wrote ${connections.length} connections → src/data/connections.json`);
