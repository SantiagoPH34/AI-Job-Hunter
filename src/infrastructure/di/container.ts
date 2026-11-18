import { HuntJobsUseCase } from "../../application/use-cases/HuntJobsUseCase.js";
import { ManageProfileUseCase } from "../../application/use-cases/ManageProfileUseCase.js";
import { TestNotificationUseCase } from "../../application/use-cases/TestNotificationUseCase.js";
import type { EnvStatus } from "../../domain/entities/Profile.js";
import { JobFilterService } from "../../domain/services/JobFilterService.js";
import { GeminiJobScorer } from "../ai/GeminiJobScorer.js";
import { HeuristicJobScorer } from "../ai/HeuristicJobScorer.js";
import { TelegramNotifier } from "../notifications/TelegramNotifier.js";
import { JsonSeenJobsRepository } from "../persistence/JsonSeenJobsRepository.js";
import { YamlProfileRepository } from "../persistence/YamlProfileRepository.js";
import { createJobSources } from "../sources/index.js";

export interface AppContainer {
  huntJobsUseCase: HuntJobsUseCase;
  manageProfileUseCase: ManageProfileUseCase;
  testNotificationUseCase: TestNotificationUseCase;
  getEnvStatus: () => EnvStatus;
}

export function createAppContainer(): AppContainer {
  const profileRepo = new YamlProfileRepository();
  const seenRepo = new JsonSeenJobsRepository();
  const filterService = new JobFilterService();
  const heuristicScorer = new HeuristicJobScorer();
  const scorer = new GeminiJobScorer(heuristicScorer);
  const notifier = new TelegramNotifier();
  const sources = createJobSources();

  const huntJobsUseCase = new HuntJobsUseCase(
    sources,
    scorer,
    notifier,
    profileRepo,
    seenRepo,
    filterService
  );
  const manageProfileUseCase = new ManageProfileUseCase(profileRepo, seenRepo);
  const testNotificationUseCase = new TestNotificationUseCase(notifier, profileRepo, seenRepo);

  const getEnvStatus = (): EnvStatus => ({
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    telegramConfigured: notifier.isConfigured(),
    rapidApiConfigured: Boolean(process.env.RAPIDAPI_KEY?.trim()),
    adzunaConfigured: Boolean(process.env.ADZUNA_APP_ID?.trim() && process.env.ADZUNA_APP_KEY?.trim()),
    joobleConfigured: Boolean(process.env.JOOBLE_API_KEY?.trim()),
  });

  return {
    huntJobsUseCase,
    manageProfileUseCase,
    testNotificationUseCase,
    getEnvStatus,
  };
}
