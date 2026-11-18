import fs from "node:fs";
import path from "node:path";
import type { JobOffer, PipelineRunSummary } from "../../domain/entities/JobOffer.js";
import type { SeenJobsRepositoryPort } from "../../domain/ports/SeenJobsRepositoryPort.js";

export const DEFAULT_SEEN_PATH = path.resolve(process.cwd(), "data/seen_jobs.json");
export const DEFAULT_RESULTS_PATH = path.resolve(process.cwd(), "data/latest_results.json");

interface SeenRecord {
  seenAt: string;
  title: string;
  company: string;
}

type SeenStoreData = Record<string, SeenRecord>;

const MAX_SEEN_ENTRIES = 5000;

export function buildJobFingerprint(offer: Pick<JobOffer, "id" | "url" | "company" | "title">): string {
  const cleanUrl = offer.url.split("?")[0].trim().toLowerCase();
  if (cleanUrl && cleanUrl !== "https://www.google.com/search?q=jobs") {
    return cleanUrl;
  }
  return `${offer.id}::${offer.company.toLowerCase()}::${offer.title.toLowerCase()}`;
}

export class JsonSeenJobsRepository implements SeenJobsRepositoryPort {
  constructor(
    private readonly seenPath = DEFAULT_SEEN_PATH,
    private readonly resultsPath = DEFAULT_RESULTS_PATH
  ) {}

  filterUnseen(offers: JobOffer[]): JobOffer[] {
    const seen = this.loadSeenStore();
    return offers.filter((offer) => !seen[buildJobFingerprint(offer)]);
  }

  markAsSeen(offers: JobOffer[]): void {
    if (offers.length === 0) return;

    const seen = this.loadSeenStore();
    const now = new Date().toISOString();

    for (const offer of offers) {
      seen[buildJobFingerprint(offer)] = {
        seenAt: now,
        title: offer.title,
        company: offer.company,
      };
    }

    const entries = Object.entries(seen);
    const trimmed: SeenStoreData =
      entries.length > MAX_SEEN_ENTRIES
        ? Object.fromEntries(
            entries
              .sort((a, b) => b[1].seenAt.localeCompare(a[1].seenAt))
              .slice(0, MAX_SEEN_ENTRIES)
          )
        : seen;

    const dir = path.dirname(this.seenPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.seenPath, JSON.stringify(trimmed, null, 2), "utf-8");
  }

  saveLatestResults(summary: PipelineRunSummary): void {
    const dir = path.dirname(this.resultsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.resultsPath, JSON.stringify(summary, null, 2), "utf-8");
  }

  loadLatestResults(): PipelineRunSummary | null {
    if (!fs.existsSync(this.resultsPath)) return null;
    try {
      const raw = fs.readFileSync(this.resultsPath, "utf-8");
      return JSON.parse(raw) as PipelineRunSummary;
    } catch {
      return null;
    }
  }

  private loadSeenStore(): SeenStoreData {
    if (!fs.existsSync(this.seenPath)) return {};
    try {
      const raw = fs.readFileSync(this.seenPath, "utf-8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as SeenStoreData) : {};
    } catch {
      return {};
    }
  }
}
