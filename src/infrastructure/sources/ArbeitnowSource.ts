import type { JobOffer } from "../../domain/entities/JobOffer.js";
import type { JobSourcePort } from "../../domain/ports/JobSourcePort.js";
import { detectLanguage, fetchJson, inferCountryCode, normalizeDate, stripHtml } from "./utils.js";

interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  tags?: string[];
  job_types?: string[];
  location?: string;
  created_at?: number;
}

interface ArbeitnowResponse {
  data?: ArbeitnowJob[];
}

export class ArbeitnowSource implements JobSourcePort {
  readonly id = "arbeitnow" as const;
  readonly requiresKey = false;

  isKeyConfigured(): boolean {
    return true;
  }

  async fetchJobs(): Promise<JobOffer[]> {
    const data = await fetchJson<ArbeitnowResponse>("https://www.arbeitnow.com/api/job-board-api");
    if (!Array.isArray(data.data)) return [];

    return data.data.slice(0, 100).map((job): JobOffer => {
      const cleanDesc = stripHtml(job.description);
      const location = job.location?.trim() || (job.remote ? "Remote / Europe" : "Europe");
      const tags = [
        ...(Array.isArray(job.tags) ? job.tags : []),
        ...(Array.isArray(job.job_types) ? job.job_types : []),
      ];

      return {
        id: `arbeitnow-${job.slug}`,
        title: job.title,
        company: job.company_name,
        location,
        country: inferCountryCode(location, job.remote),
        isRemote: Boolean(job.remote),
        url: job.url,
        description: cleanDesc,
        tags,
        publishedAt: normalizeDate(job.created_at),
        source: "arbeitnow",
        language: detectLanguage(`${job.title} ${cleanDesc}`),
      };
    });
  }
}
