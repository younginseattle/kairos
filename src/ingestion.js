#!/usr/bin/env node
/**
 * Job ingestion pipeline for the Kairos job search app.
 * Fetches → Filters → Normalizes → Deduplicates → Inserts → Evaluates
 *
 * Usage (from React app):
 *   import { runJobIngestion, SOURCES } from './ingestion.js'
 *   await runJobIngestion(supabaseClient, anthropicApiKey, candidateProfile)
 *
 * All board IDs below have been verified against live Greenhouse/Lever APIs.
 * FAANG companies use Workday — not compatible with this pipeline.
 *
 * Run standalone:
 *   node --env-file=.env src/run-ingestion.mjs
 */
