import type { JobOffer } from "../../domain/entities/JobOffer.js";
import type { ProfileConfig } from "../../domain/entities/Profile.js";
import type { JobSourcePort } from "../../domain/ports/JobSourcePort.js";
import { detectLanguage, fetchJson, inferCountryCode, normalizeDate, stripHtml } from "./utils.js";

const COUNTRY_CODE_TO_JOOBLE_LOCATION: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  DE: "Germany",
  ES: "Spain",
  NL: "Netherlands",
  AU: "Australia",
  CO: "Colombia",
  MX: "Mexico",
  AR: "Argentina",
  BR: "Brazil",
};

interface JoobleJob {
  id?: string | number;
  title: string;
  location?: string;
  snippet?: string;
  salary?: string;
  source?: string;
  type?: string;
  link: string;
  company?: string;
  updated?: string;
}

interface JoobleResponse {
  jobs?: JoobleJob[];
}

export class JoobleSource implements JobSourcePort {
  readonly id = "jooble" as const;
  readonly requiresKey = true;

  isKeyConfigured(): boolean {
    return Boolean(process.env.JOOBLE_API_KEY?.trim());
  }

  async fetchJobs(profile: ProfileConfig): Promise<JobOffer[]> {
    const apiKey = process.env.JOOBLE_API_KEY?.trim();
    if (!apiKey) return [];

    const query = profile.searchQueries[0] || profile.targetRole;
    const locationsToQuery: string[] = [];
    if (profile.locations.includeGlobalRemote) {
      locationsToQuery.push("remote");
    }
    for (const code of profile.locations.targetCountries.slice(0, 3)) {
      locationsToQuery.push(COUNTRY_CODE_TO_JOOBLE_LOCATION[code] || code);
    }

    const endpoint = `https://jooble.org/api/${encodeURIComponent(apiKey)}`;
    const settled = await Promise.allSettled(
      locationsToQuery.map(async (loc) => {
        const data = await fetchJson<JoobleResponse>(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keywords: query, location: loc, page: 1 }),
        });
        return { loc, jobs: data.jobs ?? [] };
      })
    );

    const offers: JobOffer[] = [];
    for (const res of settled) {
      if (res.status !== "fulfilled") continue;
      for (const job of res.value.jobs) {
        const cleanDesc = stripHtml(job.snippet);
        const location = job.location?.trim() || res.value.loc;
        const isRemote = /\bremote|remoto\b/i.test(`${job.title} ${cleanDesc} ${location}`);

        offers.push({
          id: `jooble-${job.id ?? job.link}`,
          title: stripHtml(job.title),
          company: job.company?.trim() || job.source || "Unknown Company",
          location,
          country: inferCountryCode(location, isRemote),
          isRemote,
          url: job.link,
          description: cleanDesc,
          tags: job.type ? [job.type] : [],
          publishedAt: normalizeDate(job.updated),
          salary: job.salary?.trim() || undefined,
          source: "jooble",
          language: detectLanguage(`${job.title} ${cleanDesc}`),
        });
      }
    }

    if (offers.length === 0 && settled.every((r) => r.status === "rejected")) {
      const firstErr = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
      throw new Error(String(firstErr?.reason ?? "Jooble request failed"));
    }

    return offers;
  }
}
