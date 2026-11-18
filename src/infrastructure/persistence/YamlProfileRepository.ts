import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { ProfileConfig } from "../../domain/entities/Profile.js";
import type { ProfileRepositoryPort } from "../../domain/ports/ProfileRepositoryPort.js";

export const DEFAULT_PROFILE_PATH = path.resolve(process.cwd(), "config/profile.yaml");

export const WorkModeSchema = z.enum(["remote", "hybrid", "relocation", "onsite"]);

export const ProfileSchema = z.object({
  targetRole: z.string().trim().min(1, "El rol objetivo es requerido"),
  searchQueries: z.array(z.string().trim().min(1)).min(1, "Incluye al menos una consulta de búsqueda"),
  yearsOfExperience: z.number().min(0).max(50),
  primaryStack: z.array(z.string().trim().min(1)).default([]),
  secondaryStack: z.array(z.string().trim().min(1)).default([]),
  excludeKeywords: z.array(z.string().trim().min(1)).default([]),
  bio: z.string().trim().default(""),
  languages: z.object({
    primary: z.string().trim().min(2).default("es"),
    accepted: z.array(z.string().trim().min(2)).min(1).default(["es"]),
    englishLevel: z.string().trim().min(1).default("Sin inglés / Básico"),
  }),
  locations: z.object({
    includeGlobalRemote: z.boolean().default(true),
    homeCountry: z.string().trim().min(2).max(5).default("CO"),
    targetCountries: z
      .array(z.string().trim().min(2).max(5))
      .default(["CO", "MX", "AR", "CL", "PE", "ES", "UY", "EC", "CR", "PA"]),
    workModes: z.array(WorkModeSchema).min(1).default(["remote", "hybrid", "relocation"]),
  }),
  scoring: z.object({
    minScoreToNotify: z.number().int().min(1).max(10).default(7),
    maxJobsToEvaluate: z.number().int().min(1).max(100).default(25),
  }),
  sources: z.object({
    remotive: z.boolean().default(false),
    remoteok: z.boolean().default(true),
    weworkremotely: z.boolean().default(false),
    jobicy: z.boolean().default(false),
    himalayas: z.boolean().default(false),
    arbeitnow: z.boolean().default(false),
    getonboard: z.boolean().default(true),
    jsearch: z.boolean().default(true),
    adzuna: z.boolean().default(true),
    jooble: z.boolean().default(true),
  }),
});

export function getDefaultProfile(): ProfileConfig {
  return {
    targetRole: "Desarrollador Flutter Semi-Senior (Mid-Level)",
    searchQueries: ["Flutter", "Desarrollador Flutter", "Flutter Developer", "Mobile Flutter"],
    yearsOfExperience: 3,
    primaryStack: ["Flutter", "Dart", "Bloc", "Riverpod", "Firebase"],
    secondaryStack: ["REST API", "GraphQL", "Clean Architecture", "CI/CD", "TypeScript"],
    excludeKeywords: [
      "intern",
      "internship",
      "unpaid",
      "wordpress",
      "php only",
      "staff engineer",
      "principal engineer",
      "8+ years",
      "10+ years",
      "8+ años",
      "10+ años",
    ],
    bio: "Desarrollador Mobile Semi-Senior (Mid-level) con 3 años de experiencia en Flutter y Dart, manejo de estado con Bloc y Riverpod, Firebase, arquitectura limpia y consumo de APIs. No manejo inglés conversacional, por lo que busco vacantes 100% en español para LATAM, Colombia o España acordes a un perfil Semi-Senior (2 a 4 años de experiencia).",
    languages: {
      primary: "es",
      accepted: ["es"],
      englishLevel: "Sin inglés / Básico",
    },
    locations: {
      includeGlobalRemote: true,
      homeCountry: "CO",
      targetCountries: ["CO", "MX", "AR", "CL", "PE", "ES", "UY", "EC", "CR", "PA"],
      workModes: ["remote", "hybrid", "relocation"],
    },
    scoring: {
      minScoreToNotify: 7,
      maxJobsToEvaluate: 25,
    },
    sources: {
      remotive: false,
      remoteok: true,
      weworkremotely: false,
      jobicy: false,
      himalayas: false,
      arbeitnow: false,
      getonboard: true,
      jsearch: true,
      adzuna: true,
      jooble: true,
    },
  };
}

export function normalizeProfile(raw: unknown): ProfileConfig {
  const parsed = ProfileSchema.parse(raw);
  return {
    ...parsed,
    languages: {
      ...parsed.languages,
      primary: parsed.languages.primary.toLowerCase(),
      accepted: Array.from(new Set(parsed.languages.accepted.map((l) => l.toLowerCase()))),
    },
    locations: {
      ...parsed.locations,
      homeCountry: parsed.locations.homeCountry.toUpperCase(),
      targetCountries: Array.from(new Set(parsed.locations.targetCountries.map((c) => c.toUpperCase()))),
    },
  };
}

export class YamlProfileRepository implements ProfileRepositoryPort {
  constructor(private readonly profilePath = DEFAULT_PROFILE_PATH) {}

  load(): ProfileConfig {
    if (!fs.existsSync(this.profilePath)) {
      const fallback = getDefaultProfile();
      this.save(fallback);
      return fallback;
    }

    const content = fs.readFileSync(this.profilePath, "utf-8");
    const parsedYaml = YAML.parse(content);
    return normalizeProfile(parsedYaml);
  }

  save(profile: ProfileConfig): ProfileConfig {
    const validated = normalizeProfile(profile);
    const dir = path.dirname(this.profilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const yamlContent = YAML.stringify(validated, { lineWidth: 100 });
    fs.writeFileSync(this.profilePath, yamlContent, "utf-8");
    return validated;
  }
}
