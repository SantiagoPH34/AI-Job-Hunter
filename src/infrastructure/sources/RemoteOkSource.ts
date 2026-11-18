import type { JobOffer } from "../../domain/entities/JobOffer.js";
import type { JobSourcePort } from "../../domain/ports/JobSourcePort.js";
import {
  detectLanguage,
  fetchJson,
  formatSalary,
  inferCountryCode,
  normalizeDate,
  stripHtml,
} from "./utils.js";

interface RemoteOkItem {
  id?: string | number;
  slug?: string;
  epoch?: number;
  date?: string;
  company?: string;
  position?: string;
  tags?: string[];
  location?: string;
  salary_min?: number;
  salary_max?: number;
  url?: string;
  apply_url?: string;
  description?: string;
}

export class RemoteOkSource implements JobSourcePort {
  readonly id = "remoteok" as const;
  readonly requiresKey = false;

  isKeyConfigured(): boolean {
    return true;
  }

  async fetchJobs(): Promise<JobOffer[]> {
    const raw = await fetchJson<RemoteOkItem[]>("https://remoteok.com/api");
    if (!Array.isArray(raw)) return [];

    const items = raw.filter((item) => Boolean(item.position && item.company));

    return items.slice(0, 120).map((job): JobOffer => {
      const cleanDesc = stripHtml(job.description);
      const location = job.location?.trim() || "Worldwide";
      const url = job.url?.startsWith("http")
        ? job.url
        : job.slug
          ? `https://remoteok.com/remote-jobs/${job.slug}`
          : job.apply_url || "https://remoteok.com";

      return {
        id: `remoteok-${job.id ?? job.slug ?? url}`,
        title: job.position!,
        company: job.company!,
        location,
        country: inferCountryCode(location, true),
        isRemote: true,
        url,
        description: cleanDesc,
        tags: Array.isArray(job.tags) ? job.tags : [],
        publishedAt: normalizeDate(job.date ?? job.epoch),
        salary: formatSalary(job.salary_min, job.salary_max, "USD"),
        source: "remoteok",
        language: detectLanguage(`${job.position} ${cleanDesc}`),
      };
    });
  }
}
