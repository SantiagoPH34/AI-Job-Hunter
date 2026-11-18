import type { JobOffer, ScoredJobOffer } from "../entities/JobOffer.js";
import type { ProfileConfig } from "../entities/Profile.js";

export interface JobScorerPort {
  scoreOffers(
    offers: JobOffer[],
    profile: ProfileConfig,
    onProgress?: (message: string) => void
  ): Promise<ScoredJobOffer[]>;
}
