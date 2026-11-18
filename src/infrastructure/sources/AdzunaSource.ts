import type { JobOffer } from "../../domain/entities/JobOffer.js";
import type { ProfileConfig } from "../../domain/entities/Profile.js";
import type { JobSourcePort } from "../../domain/ports/JobSourcePort.js";
import { detectLanguage, fetchJson, formatSalary, normalizeDate, stripHtml } from "./utils.js";

const SUPPORTED_ADZUNA_COUNTRIES = new Set([
  "us", "gb", "ca", "de", "es", "nl", "au", "fr", "it", "br", "mx", "pl", "za", "in", "sg", "nz", "at", "be", "ch",
]);

interface AdzunaJob {
  id: string;
  title: string;
  description?: string;
  redirect_url: string;
  created?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  salary_min?: number;
  salary_max?: number;
  category?: { label?: string };
}

interface AdzunaResponse {
  results?: AdzunaJob[];
}

export class AdzunaSource implements JobSourcePort {
  readonly id = "adzuna" as const;
  readonly requiresKey = true;

  isKeyConfigured(): boolean {
    return Boolean(process.env.ADZUNA_APP_ID?.trim() && process.env.ADZUNA_APP_KEY?.trim());
  }

  async fetchJobs(profile: ProfileConfig): Promise<JobOffer[]> {
    const appId = process.env.ADZUNA_APP_ID?.trim();
    const appKey = process.env.ADZUNA_APP_KEY?.trim();
    if (!appId || !appKey) return [];

    const countries = profile.locations.targetCountries
      .map((c) => c.toLowerCase())
      .filter((c) => SUPPORTED_ADZUNA_COUNTRIES.has(c))
      .slice(0, 4);

    if (countries.length === 0) {
      countries.push("es", "mx");
    }

    const query = profile.searchQueries[0] || profile.targetRole;

    const settled = await Promise.allSettled(
      countries.map(async (country) => {
        const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/1`);
        url.searchParams.set("app_id", appId);
        url.searchParams.set("app_key", appKey);
        url.searchParams.set("results_per_page", "20");
        url.searchParams.set("what", query);
        const data = await fetchJson<AdzunaResponse>(url.toString());
        return { country: country.toUpperCase(), results: data.results ?? [] };
      })
    );

    const offers: JobOffer[] = [];
    for (const res of settled) {
      if (res.status !== "fulfilled") continue;
      for (const job of res.value.results) {
        const cleanDesc = stripHtml(job.description);
        const loc = job.location?.display_name || res.value.country;
        const isRemote = /\bremote|remoto\b/i.test(`${job.title} ${cleanDesc} ${loc}`);

        offers.push({
          id: `adzuna-${res.value.country}-${job.id}`,
          title: stripHtml(job.title),
          company: job.company?.display_name || "Unknown Company",
          location: loc,
          country: res.value.country,
          isRemote,
          url: job.redirect_url,
          description: cleanDesc,
          tags: job.category?.label ? [job.category.label] : [],
          publishedAt: normalizeDate(job.created),
          salary: formatSalary(job.salary_min, job.salary_max, "USD"),
          source: "adzuna",
          language: detectLanguage(`${job.title} ${cleanDesc}`),
        });
      }
    }

    if (offers.length === 0 && settled.every((r) => r.status === "rejected")) {
      const firstErr = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
      throw new Error(String(firstErr?.reason ?? "Adzuna request failed"));
    }

    return offers;
  }
}
