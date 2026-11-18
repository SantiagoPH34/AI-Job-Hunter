import { XMLParser } from "fast-xml-parser";
import type { JobOffer } from "../../domain/entities/JobOffer.js";
import type { JobSourcePort } from "../../domain/ports/JobSourcePort.js";
import { detectLanguage, fetchText, inferCountryCode, normalizeDate, stripHtml } from "./utils.js";

interface WwrRssItem {
  title?: string;
  link?: string;
  guid?: string | { "#text"?: string };
  pubDate?: string;
  description?: string;
  region?: string;
  category?: string | string[];
}

interface WwrRssDoc {
  rss?: {
    channel?: {
      item?: WwrRssItem | WwrRssItem[];
    };
  };
}

export class WeWorkRemotelySource implements JobSourcePort {
  readonly id = "weworkremotely" as const;
  readonly requiresKey = false;

  isKeyConfigured(): boolean {
    return true;
  }

  async fetchJobs(): Promise<JobOffer[]> {
    const xml = await fetchText("https://weworkremotely.com/remote-jobs.rss");
    const parser = new XMLParser({
      ignoreAttributes: false,
      trimValues: true,
      processEntities: false,
    });
    const parsed = parser.parse(xml) as WwrRssDoc;
    const rawItems = parsed.rss?.channel?.item;
    const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

    return items.slice(0, 120).map((item, idx): JobOffer => {
      const fullTitle = stripHtml(item.title) || "Remote Role";
      const colonIdx = fullTitle.indexOf(":");
      const company = colonIdx > 0 ? fullTitle.slice(0, colonIdx).trim() : "WeWorkRemotely Employer";
      const title = colonIdx > 0 ? fullTitle.slice(colonIdx + 1).trim() : fullTitle;
      const cleanDesc = stripHtml(item.description);
      const location = item.region?.trim() || "Worldwide";
      const link = item.link?.trim() || "";
      const guidVal = typeof item.guid === "string" ? item.guid : item.guid?.["#text"];
      const tags = Array.isArray(item.category) ? item.category : item.category ? [item.category] : [];

      return {
        id: `wwr-${guidVal ?? link ?? idx}`,
        title,
        company,
        location,
        country: inferCountryCode(location, true),
        isRemote: true,
        url: link,
        description: cleanDesc,
        tags,
        publishedAt: normalizeDate(item.pubDate),
        source: "weworkremotely",
        language: detectLanguage(`${title} ${cleanDesc}`),
      };
    });
  }
}
