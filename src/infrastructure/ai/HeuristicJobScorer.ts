import type { JobOffer, ScoredJobOffer } from "../../domain/entities/JobOffer.js";
import type { ProfileConfig } from "../../domain/entities/Profile.js";
import type { JobScorerPort } from "../../domain/ports/JobScorerPort.js";
import { containsKeyword } from "../../domain/services/JobFilterService.js";

function clampScore(value: number): number {
  return Math.max(1, Math.min(10, Math.round(value)));
}

function extractRequiredYears(text: string): number | null {
  const matches = Array.from(text.matchAll(/(\d{1,2})\s*\+?\s*(?:years|yrs|años)/gi));
  if (matches.length === 0) return null;
  const nums = matches
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 20);
  if (nums.length === 0) return null;
  return Math.min(...nums);
}

export class HeuristicJobScorer implements JobScorerPort {
  scoreOffer(offer: JobOffer, profile: ProfileConfig): ScoredJobOffer {
    const titleLower = offer.title.toLowerCase();
    const fullText = `${offer.title} ${offer.tags.join(" ")} ${offer.description}`.toLowerCase();

    let rawScore = 3.5;

    const matchedSkills: string[] = [];
    const missingSkills: string[] = [];

    for (const skill of profile.primaryStack) {
      if (containsKeyword(fullText, skill)) {
        matchedSkills.push(skill);
        rawScore += containsKeyword(titleLower, skill) ? 1.4 : 0.9;
      } else {
        missingSkills.push(skill);
      }
    }

    for (const skill of profile.secondaryStack) {
      if (containsKeyword(fullText, skill)) {
        matchedSkills.push(skill);
        rawScore += 0.4;
      }
    }

    const roleHits =
      profile.searchQueries.some((q) => containsKeyword(titleLower, q)) ||
      profile.targetRole
        .toLowerCase()
        .split(/[\s/(),.-]+/)
        .filter((w) => w.length >= 4 && !["senior", "semi", "level", "desarrollador"].includes(w))
        .some((w) => containsKeyword(titleLower, w));

    if (roleHits) rawScore += 1.2;

    const wantsSenior =
      /\bsenior\b/i.test(profile.targetRole) && !/\bsemi[-\s]?senior\b/i.test(profile.targetRole);
    if (profile.yearsOfExperience <= 4 && !wantsSenior) {
      const isSeniorTitle =
        /\b(staff|principal|lead|tech lead|architect|senior|sr\.?)\b/i.test(offer.title) &&
        !/\bsemi[-\s]?senior\b/i.test(offer.title);
      if (isSeniorTitle) {
        rawScore -= 1.5;
      } else if (/\b(semi[-\s]?senior|mid[-\s]?level|ssr|intermedio)\b/i.test(fullText)) {
        rawScore += 0.6;
      }
    }

    const requiredYears = extractRequiredYears(offer.description);
    if (requiredYears !== null) {
      if (requiredYears <= profile.yearsOfExperience) {
        rawScore += 0.8;
      } else if (requiredYears - profile.yearsOfExperience >= 3) {
        rawScore -= 2.0;
      } else if (requiredYears > profile.yearsOfExperience + 1) {
        rawScore -= 1.0;
      }
    }

    const offerLang = offer.language.toLowerCase();
    const primaryLang = profile.languages.primary.toLowerCase();
    const acceptedLangs = profile.languages.accepted.map((l) => l.toLowerCase());
    let languageFit = `Idioma detectado: ${offerLang.toUpperCase()}`;

    if (offerLang === primaryLang) {
      rawScore += 1.0;
      languageFit = `Idioma principal (${offerLang.toUpperCase()})`;
    } else if (acceptedLangs.includes(offerLang)) {
      rawScore -= 0.3;
      languageFit = `Idioma aceptado (${offerLang.toUpperCase()})`;
    } else {
      rawScore -= 2.5;
      languageFit = `Idioma fuera de preferencia (${offerLang.toUpperCase()})`;
    }

    const locLower = offer.location.toLowerCase();
    const countryUpper = offer.country.toUpperCase();
    const homeUpper = profile.locations.homeCountry.toUpperCase();
    let locationFit = offer.location || countryUpper;

    const isWorldwide =
      countryUpper === "GLOBAL" || /\b(worldwide|anywhere|global|latam|remote)\b/i.test(locLower);
    const restrictedUsOnly =
      /\b(us only|united states only|u\.s\. only|must reside in the us|work authorization in the us)\b/i.test(
        fullText
      );

    if (restrictedUsOnly && homeUpper !== "US") {
      rawScore -= 2.0;
      locationFit = `Restringido a EE. UU. (${offer.location})`;
    } else if (countryUpper === homeUpper || (offer.isRemote && isWorldwide)) {
      rawScore += 0.6;
      locationFit = offer.isRemote ? `Remoto compatible (${offer.location})` : offer.location;
    } else if (profile.locations.targetCountries.map((c) => c.toUpperCase()).includes(countryUpper)) {
      locationFit = `País objetivo (${countryUpper})`;
    }

    if (profile.excludeKeywords.some((kw) => containsKeyword(fullText, kw))) {
      rawScore -= 4;
    }

    const score = clampScore(rawScore);
    const keep = score >= profile.scoring.minScoreToNotify;

    const summaryParts = [
      matchedSkills.length > 0
        ? `Coincide con ${matchedSkills.slice(0, 4).join(", ")}.`
        : "Pocas coincidencias directas con tu stack principal.",
      requiredYears !== null ? `Experiencia estimada pedida: ${requiredYears}+ años.` : null,
      restrictedUsOnly && homeUpper !== "US" ? "Posible restricción geográfica a EE. UU." : null,
    ].filter(Boolean);

    return {
      ...offer,
      score,
      keep,
      matchedSkills,
      missingSkills: missingSkills.slice(0, 4),
      languageFit,
      locationFit,
      reasoning: summaryParts.join(" "),
      scoredBy: "heuristic",
    };
  }

  async scoreOffers(offers: JobOffer[], profile: ProfileConfig): Promise<ScoredJobOffer[]> {
    return offers.map((offer) => this.scoreOffer(offer, profile)).sort((a, b) => b.score - a.score);
  }
}
