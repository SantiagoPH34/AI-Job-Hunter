import type { JobOffer } from "../../domain/entities/JobOffer.js";
import type { ProfileConfig } from "../../domain/entities/Profile.js";
import type { JobSourcePort } from "../../domain/ports/JobSourcePort.js";
import { detectLanguage, fetchJson, inferCountryCode, normalizeDate, stripHtml } from "./utils.js";

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  tags?: string[];
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
}

interface RemotiveResponse {
  jobs?: RemotiveJob[];
}

export class RemotiveSource implements JobSourcePort {
  readonly id = "remotive" as const;
  readonly requiresKey = false;

  isKeyConfigured(): boolean {
    return true;
  }

  async fetchJobs(profile: ProfileConfig): Promise<JobOffer[]> {
    const queries = profile.searchQueries.slice(0, 2);
    const urls = [
      ...queries.map((q) => `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=40`),
      "https://remotive.com/api/remote-jobs?category=software-dev&limit=50",
    ];

    const settled = await Promise.allSettled(urls.map((u) => fetchJson<RemotiveResponse>(u)));
    const allJobs: RemotiveJob[] = [];
    for (const res of settled) {
      if (res.status === "fulfilled" && Array.isArray(res.value.jobs)) {
        allJobs.push(...res.value.jobs);
      }
    }

    if (allJobs.length === 0 && settled.every((r) => r.status === "rejected")) {
      const firstErr = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
      throw new Error(String(firstErr?.reason ?? "Remotive request failed"));
    }

    return allJobs.map((job): JobOffer => {
      const cleanDesc = stripHtml(job.description);
      const location = job.candidate_required_location?.trim() || "Worldwide";
      return {
        id: `remotive-${job.id}`,
        title: job.title,
        company: job.company_name,
        location,
        country: inferCountryCode(location, true),
        isRemote: true,
        url: job.url,
        description: cleanDesc,
        tags: Array.isArray(job.tags) ? job.tags : [],
        publishedAt: normalizeDate(job.publication_date),
        salary: job.salary?.trim() || undefined,
        source: "remotive",
        language: detectLanguage(`${job.title} ${cleanDesc}`),
      };
    });
  }
}
