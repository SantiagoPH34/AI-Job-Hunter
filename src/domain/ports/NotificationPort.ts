import type { ScoredJobOffer } from "../entities/JobOffer.js";
import type { ProfileConfig } from "../entities/Profile.js";

export interface NotificationResult {
  sent: boolean;
  messageCount: number;
  error?: string;
}

export interface NotificationPort {
  isConfigured(): boolean;
  sendJobs(
    jobs: ScoredJobOffer[],
    profile: ProfileConfig,
    options?: { notifyWhenEmpty?: boolean }
  ): Promise<NotificationResult>;
  sendTestMessage(profile: ProfileConfig): Promise<void>;
}
