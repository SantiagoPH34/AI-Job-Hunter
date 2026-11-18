import type { SourceId } from "./Profile.js";

export interface JobOffer {
  id: string;
  title: string;
  company: string;
  location: string;
  country: string;
  isRemote: boolean;
  url: string;
  description: string;
  tags: string[];
  publishedAt: string;
  salary?: string;
  source: SourceId;
  language: string;
}

export interface ScoredJobOffer extends JobOffer {
  score: number;
  keep: boolean;
  matchedSkills: string[];
  missingSkills: string[];
  languageFit: string;
  locationFit: string;
  reasoning: string;
  scoredBy: "gemini" | "heuristic";
}

export interface SourceFetchReport {
  source: SourceId;
  enabled: boolean;
  requiresKey: boolean;
  keyConfigured: boolean;
  fetchedCount: number;
  status: "ok" | "skipped" | "error";
  error?: string;
}

export interface PipelineRunSummary {
  ranAt: string;
  dryRun: boolean;
  totalFetched: number;
  afterDedupe: number;
  afterSeenFilter: number;
  afterPreFilter: number;
  evaluatedCount: number;
  qualifiedCount: number;
  notifiedCount: number;
  telegramSent: boolean;
  telegramError?: string;
  sourceReports: SourceFetchReport[];
  results: ScoredJobOffer[];
}
