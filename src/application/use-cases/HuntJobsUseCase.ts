import type { JobOffer, PipelineRunSummary, SourceFetchReport } from "../../domain/entities/JobOffer.js";
import type { ProfileConfig } from "../../domain/entities/Profile.js";
import type { JobScorerPort } from "../../domain/ports/JobScorerPort.js";
import type { JobSourcePort } from "../../domain/ports/JobSourcePort.js";
import type { NotificationPort } from "../../domain/ports/NotificationPort.js";
import type { ProfileRepositoryPort } from "../../domain/ports/ProfileRepositoryPort.js";
import type { SeenJobsRepositoryPort } from "../../domain/ports/SeenJobsRepositoryPort.js";
import type { JobFilterService } from "../../domain/services/JobFilterService.js";

export interface HuntJobsOptions {
  dryRun?: boolean;
  ignoreSeen?: boolean;
  notifyTelegram?: boolean;
  profileOverride?: ProfileConfig;
  onLog?: (message: string) => void;
}

export class HuntJobsUseCase {
  constructor(
    private readonly sources: JobSourcePort[],
    private readonly scorer: JobScorerPort,
    private readonly notifier: NotificationPort,
    private readonly profileRepo: ProfileRepositoryPort,
    private readonly seenRepo: SeenJobsRepositoryPort,
    private readonly filterService: JobFilterService
  ) {}

  async execute(options: HuntJobsOptions = {}): Promise<PipelineRunSummary> {
    const log = options.onLog ?? ((msg: string) => console.log(msg));
    const dryRun = Boolean(options.dryRun);
    const ignoreSeen = Boolean(options.ignoreSeen ?? dryRun);
    const notifyTelegram = options.notifyTelegram ?? !dryRun;

    const profile = options.profileOverride ?? this.profileRepo.load();
    log(`🎯 Buscando ofertas para: ${profile.targetRole}`);

    const { offers: rawOffers, reports } = await this.fetchFromEnabledSources(profile);
    for (const report of reports) {
      if (report.status === "ok") {
        log(`  ✔ ${report.source}: ${report.fetchedCount} ofertas obtenidas`);
      } else if (report.status === "error") {
        log(`  ✖ ${report.source}: error (${report.error})`);
      }
    }

    const deduped = this.filterService.deduplicate(rawOffers);
    const unseen = ignoreSeen ? deduped : this.seenRepo.filterUnseen(deduped);
    const preFiltered = this.filterService.preFilterAndRank(unseen, profile);
    const candidates = preFiltered.slice(0, profile.scoring.maxJobsToEvaluate);

    log(
      `📊 Totales: ${rawOffers.length} brutas → ${deduped.length} únicas → ${unseen.length} nuevas → ${preFiltered.length} pre-filtradas (evaluando top ${candidates.length})`
    );

    const scored = await this.scorer.scoreOffers(candidates, profile, log);
    const qualified = scored.filter((job) => job.keep);
    log(`✨ Ofertas aprobadas (puntaje ≥ ${profile.scoring.minScoreToNotify}/10): ${qualified.length}`);

    let telegramSent = false;
    let telegramError: string | undefined;

    if (notifyTelegram && qualified.length > 0) {
      try {
        const tgResult = await this.notifier.sendJobs(qualified, profile);
        telegramSent = tgResult.sent;
        telegramError = tgResult.error;
        if (tgResult.sent) {
          log(`📨 Enviadas ${qualified.length} ofertas a Telegram (${tgResult.messageCount} mensaje(s)).`);
        } else if (tgResult.error) {
          log(`⚠️ Telegram no enviado: ${tgResult.error}`);
        }
      } catch (err) {
        telegramError = err instanceof Error ? err.message : String(err);
        log(`✖ Error enviando a Telegram: ${telegramError}`);
      }
    }

    if (!dryRun && qualified.length > 0 && (telegramSent || !notifyTelegram || !this.notifier.isConfigured())) {
      this.seenRepo.markAsSeen(qualified);
    }

    const summary: PipelineRunSummary = {
      ranAt: new Date().toISOString(),
      dryRun,
      totalFetched: rawOffers.length,
      afterDedupe: deduped.length,
      afterSeenFilter: unseen.length,
      afterPreFilter: preFiltered.length,
      evaluatedCount: scored.length,
      qualifiedCount: qualified.length,
      notifiedCount: telegramSent ? qualified.length : 0,
      telegramSent,
      telegramError,
      sourceReports: reports,
      results: scored,
    };

    this.seenRepo.saveLatestResults(summary);
    return summary;
  }

  private async fetchFromEnabledSources(
    profile: ProfileConfig
  ): Promise<{ offers: JobOffer[]; reports: SourceFetchReport[] }> {
    const results = await Promise.all(
      this.sources.map(async (connector): Promise<{ offers: JobOffer[]; report: SourceFetchReport }> => {
        const enabled = Boolean(profile.sources[connector.id]);
        const keyConfigured = connector.isKeyConfigured();

        if (!enabled || (connector.requiresKey && !keyConfigured)) {
          return {
            offers: [],
            report: {
              source: connector.id,
              enabled,
              requiresKey: connector.requiresKey,
              keyConfigured,
              fetchedCount: 0,
              status: "skipped",
            },
          };
        }

        try {
          const offers = await connector.fetchJobs(profile);
          return {
            offers,
            report: {
              source: connector.id,
              enabled,
              requiresKey: connector.requiresKey,
              keyConfigured,
              fetchedCount: offers.length,
              status: "ok",
            },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            offers: [],
            report: {
              source: connector.id,
              enabled,
              requiresKey: connector.requiresKey,
              keyConfigured,
              fetchedCount: 0,
              status: "error",
              error: message,
            },
          };
        }
      })
    );

    return {
      offers: results.flatMap((r) => r.offers),
      reports: results.map((r) => r.report),
    };
  }
}
