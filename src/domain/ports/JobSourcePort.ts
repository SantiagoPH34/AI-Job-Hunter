import type { JobOffer } from "../entities/JobOffer.js";
import type { ProfileConfig, SourceId } from "../entities/Profile.js";

export interface JobSourcePort {
  readonly id: SourceId;
  readonly requiresKey: boolean;
  isKeyConfigured(): boolean;
  fetchJobs(profile: ProfileConfig): Promise<JobOffer[]>;
}
