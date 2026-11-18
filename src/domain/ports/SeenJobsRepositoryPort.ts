import type { JobOffer, PipelineRunSummary } from "../entities/JobOffer.js";

export interface SeenJobsRepositoryPort {
  filterUnseen(offers: JobOffer[]): JobOffer[];
  markAsSeen(offers: JobOffer[]): void;
  saveLatestResults(summary: PipelineRunSummary): void;
  loadLatestResults(): PipelineRunSummary | null;
}
