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

interface GetOnBoardCompanyAttributes {
  name?: string;
  country?: string;
}

interface GetOnBoardJobAttributes {
  title?: string;
  description?: string;
  projects?: string;
  functions?: string;
  desirable?: string;
  remote?: boolean;
  remote_modality?: string;
  remote_zone?: string | null;
  countries?: string[];
  lang?: string;
  category_name?: string;
  min_salary?: number | null;
  max_salary?: number | null;
  published_at?: number | string;
  company?: {
    data?: {
      attributes?: GetOnBoardCompanyAttributes;
    };
  };
}

interface GetOnBoardJobItem {
  id: string;
  attributes?: GetOnBoardJobAttributes;
  links?: {
    public_url?: string;
  };
}

interface GetOnBoardResponse {
  data?: GetOnBoardJobItem[];
}

export class GetOnBoardSource implements JobSourcePort {
  readonly id = "getonboard" as const;
  readonly requiresKey = false;

  isKeyConfigured(): boolean {
    return true;
  }

  async fetchJobs(profile: ProfileConfig): Promise<JobOffer[]> {
    const queries = Array.from(
      new Set(["flutter", "dart", "movil", ...profile.searchQueries.slice(0, 2)])
    ).slice(0, 4);

    const settled = await Promise.allSettled(
      queries.map((q) => {
        const url = new URL("https://www.getonbrd.com/api/v0/search/jobs");
        url.searchParams.set("query", q);
        url.searchParams.set("per_page", "30");
        url.searchParams.set("expand", '["company"]');
        return fetchJson<GetOnBoardResponse>(url.toString());
      })
    );

    const items: GetOnBoardJobItem[] = [];
    for (const res of settled) {
      if (res.status === "fulfilled" && Array.isArray(res.value.data)) {
        items.push(...res.value.data);
      }
    }

    if (items.length === 0 && settled.every((r) => r.status === "rejected")) {
      const firstErr = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
      throw new Error(String(firstErr?.reason ?? "Get on Board request failed"));
    }

    return items
      .filter((item) => Boolean(item.attributes?.title))
      .map((item): JobOffer => {
        const attr = item.attributes!;
        const title = attr.title!.trim();
        const companyAttrs = attr.company?.data?.attributes;
        const company = companyAttrs?.name?.trim() || "Empresa en Get on Board";

        const descParts = [
          stripHtml(attr.projects),
          stripHtml(attr.description),
          stripHtml(attr.functions),
          stripHtml(attr.desirable),
        ].filter(Boolean);
        const description = descParts.join("\n\n");

        const countriesList = Array.isArray(attr.countries) ? attr.countries.filter(Boolean) : [];
        const isRemote = Boolean(attr.remote);
        const location =
          countriesList.length > 0
            ? countriesList.join(", ")
            : attr.remote_zone?.trim() || (isRemote ? "Remoto LATAM" : companyAttrs?.country || "LATAM");

        const inferredCountry =
          countriesList.length === 1 && countriesList[0].toLowerCase() !== "remote"
            ? inferCountryCode(countriesList[0], isRemote)
            : isRemote
              ? "LATAM"
              : companyAttrs?.country?.toUpperCase() || inferCountryCode(location, isRemote);

        const rawLang = attr.lang?.trim().toLowerCase() ?? "";
        const lang = /^[a-z]{2}$/.test(rawLang) ? rawLang : detectLanguage(`${title} ${description}`);
        const tags = [attr.category_name, attr.remote_modality].filter((t): t is string => Boolean(t));

        return {
          id: `getonboard-${item.id}`,
          title,
          company,
          location,
          country: inferredCountry,
          isRemote,
          url: item.links?.public_url || `https://www.getonbrd.com/jobs/${item.id}`,
          description,
          tags,
          publishedAt: normalizeDate(attr.published_at),
          salary: formatSalary(attr.min_salary, attr.max_salary, "USD"),
          source: "getonboard",
          language: lang,
        };
      });
  }
}
