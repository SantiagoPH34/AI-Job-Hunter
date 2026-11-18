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

interface JSearchJob {
  job_id: string;
  job_title: string;
  employer_name?: string;
  job_country?: string;
  job_city?: string;
  job_state?: string;
  job_is_remote?: boolean;
  job_apply_link?: string;
  job_google_link?: string;
  job_description?: string;
  job_posted_at_datetime_utc?: string;
  job_min_salary?: number;
  job_max_salary?: number;
  job_salary_currency?: string;
  job_required_skills?: string[] | null;
}

interface JSearchResponse {
  data?: JSearchJob[];
}

export class JSearchSource implements JobSourcePort {
  readonly id = "jsearch" as const;
  readonly requiresKey = true;

  isKeyConfigured(): boolean {
    return Boolean(process.env.RAPIDAPI_KEY?.trim());
  }

  async fetchJobs(profile: ProfileConfig): Promise<JobOffer[]> {
    const apiKey = process.env.RAPIDAPI_KEY?.trim();
    if (!apiKey) return [];

    const queries = profile.searchQueries.slice(0, 2);
    const requestParams: Array<{ query: string; country?: string; remoteOnly?: boolean }> = [];

    for (const q of queries) {
      if (profile.locations.includeGlobalRemote) {
        requestParams.push({ query: `${q} remote`, remoteOnly: true });
      }
      for (const country of profile.locations.targetCountries.slice(0, 2)) {
        requestParams.push({ query: q, country: country.toLowerCase(), remoteOnly: false });
      }
    }

    const headers = {
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
    };

    const limitedRequests = requestParams.slice(0, 2);
    const allJobs: JSearchJob[] = [];
    let lastError: unknown;

    for (let i = 0; i < limitedRequests.length; i++) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      const req = limitedRequests[i];
      const url = new URL("https://jsearch.p.rapidapi.com/search");
      url.searchParams.set("query", req.query);
      url.searchParams.set("page", "1");
      url.searchParams.set("num_pages", "1");
      url.searchParams.set("date_posted", "week");
      if (req.country) url.searchParams.set("country", req.country);
      if (req.remoteOnly) url.searchParams.set("remote_jobs_only", "true");

      try {
        const res = await fetchJson<JSearchResponse>(url.toString(), { headers });
        if (Array.isArray(res.data)) {
          allJobs.push(...res.data);
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (allJobs.length === 0 && lastError) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    return allJobs.map((job): JobOffer => {
      const cleanDesc = stripHtml(job.job_description);
      const locParts = [job.job_city, job.job_state, job.job_country].filter(Boolean);
      const location = locParts.length > 0 ? locParts.join(", ") : job.job_is_remote ? "Remote" : "Unknown";
      const country = job.job_country?.toUpperCase() || inferCountryCode(location, Boolean(job.job_is_remote));

      return {
        id: `jsearch-${job.job_id}`,
        title: job.job_title,
        company: job.employer_name || "Unknown Company",
        location,
        country,
        isRemote: Boolean(job.job_is_remote),
        url: job.job_apply_link || job.job_google_link || "https://www.google.com/search?q=jobs",
        description: cleanDesc,
        tags: Array.isArray(job.job_required_skills) ? job.job_required_skills : [],
        publishedAt: normalizeDate(job.job_posted_at_datetime_utc),
        salary: formatSalary(job.job_min_salary, job.job_max_salary, job.job_salary_currency || "USD"),
        source: "jsearch",
        language: detectLanguage(`${job.job_title} ${cleanDesc}`),
      };
    });
  }
}
