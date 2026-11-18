import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { JobOffer, ScoredJobOffer } from "../../domain/entities/JobOffer.js";
import type { ProfileConfig } from "../../domain/entities/Profile.js";
import type { JobScorerPort } from "../../domain/ports/JobScorerPort.js";
import { HeuristicJobScorer } from "./HeuristicJobScorer.js";

const GeminiScoreItemSchema = z.object({
  id: z.string(),
  score: z.number().min(1).max(10),
  keep: z.boolean(),
  matchedSkills: z.array(z.string()).default([]),
  missingSkills: z.array(z.string()).default([]),
  languageFit: z.string().default("Compatible"),
  locationFit: z.string().default("Compatible"),
  reasoning: z.string().default(""),
});

const GeminiBatchResponseSchema = z.object({
  evaluations: z.array(GeminiScoreItemSchema),
});

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    evaluations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          score: { type: "integer", minimum: 1, maximum: 10 },
          keep: { type: "boolean" },
          matchedSkills: { type: "array", items: { type: "string" } },
          missingSkills: { type: "array", items: { type: "string" } },
          languageFit: { type: "string" },
          locationFit: { type: "string" },
          reasoning: { type: "string" },
        },
        required: [
          "id",
          "score",
          "keep",
          "matchedSkills",
          "missingSkills",
          "languageFit",
          "locationFit",
          "reasoning",
        ],
      },
    },
  },
  required: ["evaluations"],
};

const FALLBACK_GEMINI_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
];

function isRetryableModelError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("404") ||
    msg.includes("not_found") ||
    msg.includes("no longer available") ||
    msg.includes("503") ||
    msg.includes("unavailable") ||
    msg.includes("high demand") ||
    msg.includes("429") ||
    msg.includes("resource_exhausted") ||
    msg.includes("fetch failed")
  );
}

function buildGeminiPrompt(offers: JobOffer[], profile: ProfileConfig): string {
  const candidateSummary = {
    targetRole: profile.targetRole,
    yearsOfExperience: profile.yearsOfExperience,
    primaryStack: profile.primaryStack,
    secondaryStack: profile.secondaryStack,
    excludeKeywords: profile.excludeKeywords,
    bio: profile.bio,
    languages: profile.languages,
    locations: profile.locations,
    minScoreToNotify: profile.scoring.minScoreToNotify,
  };

  const compactOffers = offers.map((o) => ({
    id: o.id,
    title: o.title,
    company: o.company,
    location: o.location,
    country: o.country,
    isRemote: o.isRemote,
    language: o.language,
    tags: o.tags.slice(0, 10),
    salary: o.salary ?? "Not specified",
    source: o.source,
    description: o.description.slice(0, 1800),
  }));

  return `You are an expert technical recruiter and career advisor.
Evaluate each job offer below against the candidate's profile and assign an objective score from 1 to 10.

SCORING CRITERIA (1 to 10):
- 9-10: Strong match on target role, primary stack (e.g. Flutter, Dart, Bloc, Riverpod, Firebase), Semi-Senior / Mid-level fit (~${profile.yearsOfExperience} years of experience, e.g. 2-4 years), written in primary preferred language (${profile.languages.primary.toUpperCase()}), and compatible location/remote policy for a candidate based in ${profile.locations.homeCountry}.
- 7-8: Solid fit with most key skills, realistic seniority for ${profile.yearsOfExperience} years of experience, and accepted language (${profile.languages.accepted.join(", ").toUpperCase()}) / location.
- 4-6: Partial stack overlap, Senior (+5 years) / Lead / Staff requirement above the candidate's ${profile.yearsOfExperience} years Semi-Senior level, or unclear geographic/visa restrictions.
- 1-3: Unrelated tech stack, excluded keywords, incompatible language, or non-viable location.

IMPORTANT SENIORITY & LANGUAGE RULES:
- The candidate has ${profile.yearsOfExperience} years of experience and targets a Semi-Senior / Mid-level role (${profile.targetRole}). Penalize roles explicitly requiring Senior (+5 years), Tech Lead, Staff, or Principal unless they clearly accept 3 years of experience.
- Prioritize offers in ${profile.languages.primary.toUpperCase()} over secondary accepted languages.

Set "keep": true ONLY if score >= ${profile.scoring.minScoreToNotify} AND the job does not violate hard exclusions or strict location/language incompatibility.
Write "languageFit", "locationFit", and "reasoning" concisely in Spanish (1-2 sentences max for reasoning).

CANDIDATE PROFILE:
${JSON.stringify(candidateSummary, null, 2)}

JOB OFFERS TO EVALUATE:
${JSON.stringify(compactOffers, null, 2)}
`;
}

export class GeminiJobScorer implements JobScorerPort {
  constructor(private readonly fallbackScorer = new HeuristicJobScorer()) {}

  async scoreOffers(
    offers: JobOffer[],
    profile: ProfileConfig,
    onProgress?: (msg: string) => void
  ): Promise<ScoredJobOffer[]> {
    if (offers.length === 0) return [];

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      onProgress?.("GEMINI_API_KEY no configurada: usando evaluador heurístico local.");
      return this.fallbackScorer.scoreOffers(offers, profile);
    }

    const ai = new GoogleGenAI({ apiKey });
    const configuredModel = process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite";
    let modelsToTry = Array.from(new Set([configuredModel, ...FALLBACK_GEMINI_MODELS]));
    const batchSize = 10;
    const scored: ScoredJobOffer[] = [];

    for (let i = 0; i < offers.length; i += batchSize) {
      const batch = offers.slice(i, i + batchSize);
      onProgress?.(`Evaluando ofertas ${i + 1}-${i + batch.length} de ${offers.length} con Gemini (${modelsToTry[0]})...`);

      try {
        const { scored: batchResult, modelUsed } = await this.scoreBatchWithGemini(ai, batch, profile, modelsToTry);
        modelsToTry = [modelUsed, ...modelsToTry.filter((m) => m !== modelUsed)];
        scored.push(...batchResult);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onProgress?.(`Fallo Gemini en lote (${msg}); usando fallback heurístico para este lote.`);
        scored.push(...batch.map((o) => this.fallbackScorer.scoreOffer(o, profile)));
      }
    }

    return scored.sort((a, b) => b.score - a.score);
  }

  private async scoreBatchWithGemini(
    ai: GoogleGenAI,
    batch: JobOffer[],
    profile: ProfileConfig,
    modelsToTry: string[]
  ): Promise<{ scored: ScoredJobOffer[]; modelUsed: string }> {
    const prompt = buildGeminiPrompt(batch, profile);

    let response: Awaited<ReturnType<typeof ai.models.generateContent>> | undefined;
    let modelUsed = modelsToTry[0];
    let lastErr: unknown;

    for (const model of modelsToTry) {
      try {
        response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            temperature: 0.2,
            responseMimeType: "application/json",
            responseJsonSchema: RESPONSE_JSON_SCHEMA,
          },
        });
        modelUsed = model;
        break;
      } catch (err) {
        lastErr = err;
        if (!isRetryableModelError(err)) {
          throw err;
        }
      }
    }

    if (!response) {
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "No Gemini model available"));
    }

    const text = response.text?.trim();
    if (!text) {
      throw new Error("Empty response from Gemini");
    }

    const parsedJson = JSON.parse(text);
    const validated = GeminiBatchResponseSchema.parse(parsedJson);
    const byId = new Map(validated.evaluations.map((item) => [item.id, item]));

    const scored = batch.map((offer) => {
      const evalItem = byId.get(offer.id);
      if (!evalItem) {
        return this.fallbackScorer.scoreOffer(offer, profile);
      }

      const score = Math.max(1, Math.min(10, Math.round(evalItem.score)));
      return {
        ...offer,
        score,
        keep: evalItem.keep && score >= profile.scoring.minScoreToNotify,
        matchedSkills: evalItem.matchedSkills,
        missingSkills: evalItem.missingSkills,
        languageFit: evalItem.languageFit,
        locationFit: evalItem.locationFit,
        reasoning: evalItem.reasoning,
        scoredBy: "gemini" as const,
      };
    });

    return { scored, modelUsed };
  }
}
