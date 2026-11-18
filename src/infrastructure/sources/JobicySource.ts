import type { JobOffer } from "../../domain/entities/JobOffer.js";
import type { ProfileConfig } from "../../domain/entities/Profile.js";
import type { JobSourcePort } from "../../domain/ports/JobSourcePort.js";
import {
  detectLanguage,
  fetchJson,
  formatSalary,
  inferCountryCode,
  normalizeDate,
  stripHtml,
} from "./utils.js";

interface JobicyJob {
  id: number;
  url: string;
  jobTitle: string;
  companyName: string;
  jobGeo?: string;
  jobType?: string | string[];
  pubDate?: string;
  jobDescription?: string;
  jobExcerpt?: string;
  annualSalaryMin?: string | number;
  annualSalaryMax?: string | number;
  salaryCurrency?: string;
  jobIndustry?: string | string[];
}

interface JobicyResponse {
  jobs?: JobicyJob[];
}

export class JobicySource implements JobSourcePort {
  readonly id = "jobicy" as const;
  readonly requiresKey = false;

  isKeyConfigured(): boolean {
    return true;
  }

  async fetchJobs(profile: ProfileConfig): Promise<JobOffer[]> {
    const firstTag = profile.primaryStack[0]?.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const urls = [
      "https://jobicy.com/api/v2/remote-jobs?count=50",
      ...(firstTag ? [`https://jobicy.com/api/v2/remote-jobs?count=30&tag=${encodeURIComponent(firstTag)}`] : []),
    ];

    const settled = await Promise.allSettled(urls.map((u) => fetchJson<JobicyResponse>(u)));
    const jobs: JobicyJob[] = [];
    for (const res of settled) {
      if (res.status === "fulfilled" && Array.isArray(res.value.jobs)) {
        jobs.push(...res.value.jobs);
      }
    }

    if (jobs.length === 0 && settled.every((r) => r.status === "rejected")) {
      const firstErr = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
      throw new Error(String(firstErr?.reason ?? "Jobicy request failed"));
    }

    return jobs.map((job): JobOffer => {
      const cleanDesc = stripHtml(job.jobDescription || job.jobExcerpt);
      const location = job.jobGeo?.trim() || "Worldwide";
      const industryTags = Array.isArray(job.jobIndustry)
        ? job.jobIndustry
        : job.jobIndustry
          ? [job.jobIndustry]
          : [];
      const typeTags = Array.isArray(job.jobType) ? job.jobType : job.jobType ? [job.jobType] : [];

      return {
        id: `jobicy-${job.id}`,
        title: job.jobTitle,
        company: job.companyName,
        location,
        country: inferCountryCode(location, true),
        isRemote: true,
        url: job.url,
        description: cleanDesc,
        tags: [...industryTags, ...typeTags].filter(Boolean),
        publishedAt: normalizeDate(job.pubDate),
        salary: formatSalary(job.annualSalaryMin, job.annualSalaryMax, job.salaryCurrency || "USD"),
        source: "jobicy",
        language: detectLanguage(`${job.jobTitle} ${cleanDesc}`),
      };
    });
  }
}
