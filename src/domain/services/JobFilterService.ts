import type { JobOffer } from "../entities/JobOffer.js";
import type { ProfileConfig } from "../entities/Profile.js";

export function containsKeyword(text: string, keyword: string): boolean {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return false;
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i");
  return pattern.test(text);
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export class JobFilterService {
  deduplicate(offers: JobOffer[]): JobOffer[] {
    const seenUrls = new Set<string>();
    const seenSignatures = new Set<string>();
    const result: JobOffer[] = [];

    for (const offer of offers) {
      const cleanUrl = offer.url.split("?")[0].trim().toLowerCase();
      const signature = `${normalizeKey(offer.company)}::${normalizeKey(offer.title)}`;

      if ((cleanUrl && seenUrls.has(cleanUrl)) || seenSignatures.has(signature)) {
        continue;
      }

      if (cleanUrl) seenUrls.add(cleanUrl);
      seenSignatures.add(signature);
      result.push(offer);
    }

    return result;
  }

  preFilterAndRank(offers: JobOffer[], profile: ProfileConfig): JobOffer[] {
    const excludeLower = profile.excludeKeywords.map((k) => k.toLowerCase()).filter(Boolean);
    const queryTokens = Array.from(
      new Set(
        profile.searchQueries
          .flatMap((q) => q.toLowerCase().split(/\s+/))
          .filter(
            (token) =>
              token.length >= 3 && !["and", "the", "for", "with", "developer", "engineer", "senior"].includes(token)
          )
      )
    );
    const roleTokens = profile.targetRole
      .toLowerCase()
      .split(/[\s/(),.-]+/)
      .filter(
        (token) =>
          token.length >= 3 &&
          !["senior", "semi", "junior", "mid", "level", "developer", "engineer", "desarrollador"].includes(token)
      );
    const wantsSenior =
      /\bsenior\b/i.test(profile.targetRole) && !/\bsemi[-\s]?senior\b/i.test(profile.targetRole);
    const stackLower = [...profile.primaryStack, ...profile.secondaryStack].map((s) => s.toLowerCase());
    const acceptedLanguages = new Set(profile.languages.accepted.map((l) => l.toLowerCase()));
    const targetCountries = new Set(profile.locations.targetCountries.map((c) => c.toUpperCase()));
    targetCountries.add(profile.locations.homeCountry.toUpperCase());

    const scored: Array<{ offer: JobOffer; relevance: number }> = [];

    for (const offer of offers) {
      const haystack = `${offer.title} ${offer.tags.join(" ")} ${offer.description}`.toLowerCase();
      const titleAndTags = `${offer.title} ${offer.tags.join(" ")}`.toLowerCase();

      if (excludeLower.some((bad) => containsKeyword(haystack, bad))) {
        continue;
      }

      if (acceptedLanguages.size > 0 && !acceptedLanguages.has(offer.language.toLowerCase())) {
        continue;
      }

      const countryUpper = offer.country.toUpperCase();
      const isGlobal = countryUpper === "GLOBAL" || countryUpper === "LATAM" || countryUpper === "EU";
      const locationMatches =
        (offer.isRemote && profile.locations.includeGlobalRemote && isGlobal) ||
        targetCountries.has(countryUpper) ||
        (offer.isRemote && profile.locations.workModes.includes("remote") && countryUpper === "UNKNOWN");

      const offersRelocation =
        profile.locations.workModes.includes("relocation") &&
        /\b(relocat|visa\s+sponsor|sponsorship)\b/i.test(haystack);

      if (!locationMatches && !offersRelocation) {
        continue;
      }

      let relevance = 0;

      for (const q of profile.searchQueries) {
        if (containsKeyword(titleAndTags, q)) relevance += 10;
      }
      for (const token of [...queryTokens, ...roleTokens]) {
        if (containsKeyword(titleAndTags, token)) relevance += 4;
        else if (containsKeyword(haystack, token)) relevance += 1;
      }
      for (const tech of profile.primaryStack) {
        if (containsKeyword(titleAndTags, tech)) relevance += 5;
        else if (containsKeyword(haystack, tech)) relevance += 2;
      }
      for (const tech of profile.secondaryStack) {
        if (containsKeyword(haystack, tech)) relevance += 1;
      }

      const hasMinimalDomainMatch =
        relevance > 0 ||
        stackLower.some((s) => containsKeyword(haystack, s)) ||
        profile.searchQueries.some((q) => containsKeyword(haystack, q));

      if (!hasMinimalDomainMatch) {
        continue;
      }

      if (offer.language.toLowerCase() === profile.languages.primary.toLowerCase()) {
        relevance += 12;
      }

      if (profile.yearsOfExperience <= 4 && !wantsSenior) {
        const isSeniorTitle =
          /\b(staff|principal|lead|tech lead|architect|senior|sr\.?)\b/i.test(offer.title) &&
          !/\bsemi[-\s]?senior\b/i.test(offer.title);
        if (isSeniorTitle) {
          relevance -= 6;
        } else if (/\b(semi[-\s]?senior|mid[-\s]?level|ssr|intermedio)\b/i.test(titleAndTags)) {
          relevance += 3;
        }
      }

      scored.push({ offer, relevance });
    }

    scored.sort((a, b) => {
      if (b.relevance !== a.relevance) return b.relevance - a.relevance;
      return b.offer.publishedAt.localeCompare(a.offer.publishedAt);
    });

    return scored.map((entry) => entry.offer);
  }
}
