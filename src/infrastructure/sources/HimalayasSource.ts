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

interface HimalayasJob {
  guid?: string;
  title?: string;
  companyName?: string;
  applicationLink?: string;
  pubDate?: number | string;
  description?: string;
  excerpt?: string;
  locationRestrictions?: string[];
  categories?: string[];
  seniority?: string[];
  minSalary?: number;
  maxSalary?: number;
  currency?: string;
}

interface HimalayasResponse {
  jobs?: HimalayasJob[];
}

export class HimalayasSource implements JobSourcePort {
  readonly id = "himalayas" as const;
  readonly requiresKey = false;

  isKeyConfigured(): boolean {
    return true;
  }

  async fetchJobs(): Promise<JobOffer[]> {
    const data = await fetchJson<HimalayasResponse>("https://himalayas.app/jobs/api?limit=60");
    if (!Array.isArray(data.jobs)) return [];

    return data.jobs
      .filter((job) => Boolean(job.title && job.companyName))
      .map((job, idx): JobOffer => {
        const cleanDesc = stripHtml(job.description || job.excerpt);
        const restrictions = Array.isArray(job.locationRestrictions) ? job.locationRestrictions : [];
        const location = restrictions.length > 0 ? restrictions.join(", ") : "Worldwide";
        const tags = [
          ...(Array.isArray(job.categories) ? job.categories : []),
          ...(Array.isArray(job.seniority) ? job.seniority : []),
        ];

        return {
          id: `himalayas-${job.guid ?? idx}`,
          title: job.title!,
          company: job.companyName!,
          location,
          country: inferCountryCode(location, true),
          isRemote: true,
          url: job.applicationLink || job.guid || "https://himalayas.app/jobs",
          description: cleanDesc,
          tags,
          publishedAt: normalizeDate(job.pubDate),
          salary: formatSalary(job.minSalary, job.maxSalary, job.currency || "USD"),
          source: "himalayas",
          language: detectLanguage(`${job.title} ${cleanDesc}`),
        };
      });
  }
}
