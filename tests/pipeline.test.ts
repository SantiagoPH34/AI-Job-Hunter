import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HuntJobsUseCase } from "../src/application/use-cases/HuntJobsUseCase.js";
import type { JobOffer, PipelineRunSummary, ScoredJobOffer } from "../src/domain/entities/JobOffer.js";
import type { ProfileConfig } from "../src/domain/entities/Profile.js";
import type { JobScorerPort } from "../src/domain/ports/JobScorerPort.js";
import type { JobSourcePort } from "../src/domain/ports/JobSourcePort.js";
import type { NotificationPort } from "../src/domain/ports/NotificationPort.js";
import type { ProfileRepositoryPort } from "../src/domain/ports/ProfileRepositoryPort.js";
import type { SeenJobsRepositoryPort } from "../src/domain/ports/SeenJobsRepositoryPort.js";
import { JobFilterService } from "../src/domain/services/JobFilterService.js";
import { HeuristicJobScorer } from "../src/infrastructure/ai/HeuristicJobScorer.js";
import { buildTelegramMessages, escapeHtml } from "../src/infrastructure/notifications/TelegramNotifier.js";
import {
  YamlProfileRepository,
  getDefaultProfile,
  normalizeProfile,
} from "../src/infrastructure/persistence/YamlProfileRepository.js";

function makeOffer(overrides: Partial<JobOffer> = {}): JobOffer {
  return {
    id: "job-1",
    title: "Senior Flutter Developer",
    company: "Acme Mobile",
    location: "Worldwide",
    country: "GLOBAL",
    isRemote: true,
    url: "https://example.com/jobs/flutter-1",
    description:
      "We are looking for a Flutter Developer with 4+ years of experience using Dart, Bloc, Riverpod and Firebase in English.",
    tags: ["flutter", "dart", "firebase"],
    publishedAt: "2026-11-18T10:00:00.000Z",
    source: "remotive",
    language: "en",
    ...overrides,
  };
}

describe("Profile configuration (YamlProfileRepository)", () => {
  it("normalizes languages and country codes", () => {
    const base = getDefaultProfile();
    const normalized = normalizeProfile({
      ...base,
      languages: {
        primary: "EN",
        accepted: ["EN", "es", "en"],
        englishLevel: "C1",
      },
      locations: {
        ...base.locations,
        homeCountry: "co",
        targetCountries: ["us", "gb", "US"],
      },
    });

    expect(normalized.languages.primary).toBe("en");
    expect(normalized.languages.accepted).toEqual(["en", "es"]);
    expect(normalized.locations.homeCountry).toBe("CO");
    expect(normalized.locations.targetCountries).toEqual(["US", "GB"]);
  });

  it("saves and reloads profile.yaml cleanly", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-hunter-test-"));
    const profileFile = path.join(tmpDir, "profile.yaml");

    try {
      const repo = new YamlProfileRepository(profileFile);
      const profile = getDefaultProfile();
      profile.targetRole = "Lead Flutter Architect";
      repo.save(profile);

      const loaded = repo.load();
      expect(loaded.targetRole).toBe("Lead Flutter Architect");
      expect(loaded.primaryStack).toContain("Bloc");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("Domain filtering (JobFilterService)", () => {
  const filterService = new JobFilterService();

  it("deduplicates by URL (ignoring query params) and company+title", () => {
    const offers: JobOffer[] = [
      makeOffer({ id: "1", url: "https://jobs.dev/role?utm_source=a" }),
      makeOffer({ id: "2", url: "https://jobs.dev/role?utm_source=b", title: "Different Title" }),
      makeOffer({ id: "3", url: "https://other.dev/role", company: "Acme Mobile", title: "Senior Flutter Developer" }),
      makeOffer({ id: "4", url: "https://unique.dev/role", company: "Beta Corp", title: "Dart Engineer" }),
    ];

    const unique = filterService.deduplicate(offers);
    expect(unique).toHaveLength(2);
    expect(unique.map((o) => o.id)).toEqual(["1", "4"]);
  });

  it("filters out excluded keywords, unaccepted languages, and unrelated jobs", () => {
    const profile = getDefaultProfile();

    const strong = makeOffer({
      id: "strong",
      title: "Desarrollador Flutter Semi-Senior",
      description: "Buscamos desarrollador Flutter con 3 años de experiencia en Dart, Bloc, Riverpod y Firebase.",
      language: "es",
    });
    const excluded = makeOffer({ id: "excluded", title: "Práctica Flutter (Unpaid)", language: "es" });
    const wrongLang = makeOffer({ id: "wrong-lang", language: "en" });
    const unrelated = makeOffer({
      id: "unrelated",
      title: "Contador Senior",
      description: "Buscamos contador público para auditorías.",
      tags: ["finance"],
      language: "es",
    });

    const filtered = filterService.preFilterAndRank([excluded, wrongLang, unrelated, strong], profile);
    expect(filtered.map((o) => o.id)).toEqual(["strong"]);
  });

  it("prioritizes Spanish Semi-Senior offers ahead of English Senior offers when both languages are accepted", () => {
    const profile = getDefaultProfile();
    profile.languages.accepted = ["es", "en"];
    const enSenior = makeOffer({ id: "en-senior", title: "Senior Flutter Developer", language: "en" });
    const esSemiSenior = makeOffer({
      id: "es-ssr",
      title: "Desarrollador Flutter Semi-Senior",
      description: "Buscamos desarrollador Flutter con 3 años de experiencia en Dart, Bloc, Riverpod y Firebase.",
      language: "es",
    });

    const ranked = filterService.preFilterAndRank([enSenior, esSemiSenior], profile);
    expect(ranked.map((o) => o.id)).toEqual(["es-ssr", "en-senior"]);
  });
});

describe("Heuristic scoring (HeuristicJobScorer)", () => {
  const scorer = new HeuristicJobScorer();

  it("gives high score to strong Flutter/Bloc/Riverpod/Firebase match and low score to weak/restricted match", () => {
    const profile = getDefaultProfile();

    const great = scorer.scoreOffer(
      makeOffer({
        title: "Desarrollador Flutter Semi-Senior",
        description:
          "Buscamos desarrollador Flutter con 3 años de experiencia en Dart, Bloc, Riverpod y Firebase en español.",
        language: "es",
      }),
      profile
    );
    expect(great.score).toBeGreaterThanOrEqual(7);
    expect(great.keep).toBe(true);
    expect(great.matchedSkills).toEqual(expect.arrayContaining(["Flutter", "Dart", "Bloc", "Riverpod", "Firebase"]));

    const restricted = scorer.scoreOffer(
      makeOffer({
        id: "restricted",
        title: "Backend Java Developer",
        location: "US Only",
        country: "US",
        description: "Must reside in the US. Work authorization in the US required. 9+ years Java and blockchain.",
        tags: ["java", "blockchain"],
      }),
      profile
    );
    expect(restricted.score).toBeLessThan(7);
    expect(restricted.keep).toBe(false);
    expect(restricted.matchedSkills).not.toContain("Bloc");
  });
});

describe("Telegram message formatting", () => {
  it("escapes HTML and splits large job batches under 4096 chars", () => {
    const profile = getDefaultProfile();
    const baseScored: ScoredJobOffer = {
      ...makeOffer(),
      title: "Senior Flutter <Mobile> & Dart",
      company: "Tech & Co",
      score: 9,
      keep: true,
      matchedSkills: ["Flutter", "Dart", "Bloc", "Riverpod", "Firebase"],
      missingSkills: [],
      languageFit: "Idioma principal (ES)",
      locationFit: "Remoto global",
      reasoning: "Coincide perfectamente con tu stack Flutter + Bloc + Riverpod + Firebase.",
      scoredBy: "gemini",
    };

    const manyJobs = Array.from({ length: 20 }, (_, i) => ({
      ...baseScored,
      id: `job-${i}`,
      url: `https://example.com/job/${i}`,
    }));

    const messages = buildTelegramMessages(manyJobs, profile);
    expect(messages.length).toBeGreaterThan(1);
    for (const msg of messages) {
      expect(msg.length).toBeLessThanOrEqual(4096);
    }
    expect(escapeHtml("A & B <C>")).toBe("A &amp; B &lt;C&gt;");
    expect(messages[0]).toContain("Senior Flutter &lt;Mobile&gt; &amp; Dart");
  });
});

describe("Application Use Case (HuntJobsUseCase with mocked ports)", () => {
  it("orchestrates source fetching, filtering, scoring, notification and seen persistence", async () => {
    const profile = getDefaultProfile();
    const matchingOffer = makeOffer({
      id: "es-flutter-1",
      title: "Desarrollador Flutter Semi-Senior",
      description: "Buscamos desarrollador Flutter con Bloc, Riverpod y Firebase.",
      language: "es",
      source: "getonboard",
    });

    const mockSource: JobSourcePort = {
      id: "getonboard",
      requiresKey: false,
      isKeyConfigured: () => true,
      fetchJobs: async () => [matchingOffer],
    };

    const mockScorer: JobScorerPort = {
      scoreOffers: async (offers) =>
        offers.map((o) => ({
          ...o,
          score: 9,
          keep: true,
          matchedSkills: ["Flutter", "Bloc", "Riverpod", "Firebase"],
          missingSkills: [],
          languageFit: "Idioma principal (ES)",
          locationFit: "Remoto LATAM",
          reasoning: "Coincidencia exacta con el perfil Semi-Senior.",
          scoredBy: "gemini",
        })),
    };

    let notifiedJobs: ScoredJobOffer[] = [];
    const mockNotifier: NotificationPort = {
      isConfigured: () => true,
      sendJobs: async (jobs) => {
        notifiedJobs = jobs;
        return { sent: true, messageCount: 1 };
      },
      sendTestMessage: async () => undefined,
    };

    const mockProfileRepo: ProfileRepositoryPort = {
      load: () => profile,
      save: (p: ProfileConfig) => p,
    };

    let markedSeenIds: string[] = [];
    let savedSummary: PipelineRunSummary | null = null;
    const mockSeenRepo: SeenJobsRepositoryPort = {
      filterUnseen: (offers) => offers,
      markAsSeen: (offers) => {
        markedSeenIds = offers.map((o) => o.id);
      },
      saveLatestResults: (summary) => {
        savedSummary = summary;
      },
      loadLatestResults: () => savedSummary,
    };

    const useCase = new HuntJobsUseCase(
      [mockSource],
      mockScorer,
      mockNotifier,
      mockProfileRepo,
      mockSeenRepo,
      new JobFilterService()
    );

    const summary = await useCase.execute({ dryRun: false, notifyTelegram: true, onLog: () => undefined });

    expect(summary.totalFetched).toBe(1);
    expect(summary.qualifiedCount).toBe(1);
    expect(summary.telegramSent).toBe(true);
    expect(notifiedJobs.map((j) => j.id)).toEqual(["es-flutter-1"]);
    expect(markedSeenIds).toEqual(["es-flutter-1"]);
    expect(mockSeenRepo.loadLatestResults()?.qualifiedCount).toBe(1);
  });
});
