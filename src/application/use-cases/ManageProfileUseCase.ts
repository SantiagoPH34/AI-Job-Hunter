import type { PipelineRunSummary } from "../../domain/entities/JobOffer.js";
import type { ProfileConfig } from "../../domain/entities/Profile.js";
import type { ProfileRepositoryPort } from "../../domain/ports/ProfileRepositoryPort.js";
import type { SeenJobsRepositoryPort } from "../../domain/ports/SeenJobsRepositoryPort.js";

export class ManageProfileUseCase {
  constructor(
    private readonly profileRepo: ProfileRepositoryPort,
    private readonly seenRepo: SeenJobsRepositoryPort
  ) {}

  getProfile(): ProfileConfig {
    return this.profileRepo.load();
  }

  updateProfile(profile: ProfileConfig): ProfileConfig {
    return this.profileRepo.save(profile);
  }

  getLatestResults(): PipelineRunSummary | null {
    return this.seenRepo.loadLatestResults();
  }
}
