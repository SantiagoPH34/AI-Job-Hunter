export type WorkMode = "remote" | "hybrid" | "relocation" | "onsite";

export type SourceId =
  | "remotive"
  | "remoteok"
  | "weworkremotely"
  | "jobicy"
  | "himalayas"
  | "arbeitnow"
  | "getonboard"
  | "jsearch"
  | "adzuna"
  | "jooble";

export interface LanguagesConfig {
  /** Primary preferred language ISO code (e.g. "es", "en") */
  primary: string;
  /** Accepted language ISO codes (e.g. ["es"] or ["es", "en"]) */
  accepted: string[];
  /** Self-assessed English proficiency level */
  englishLevel: string;
}

export interface LocationsConfig {
  /** Include global / worldwide / LATAM remote roles */
  includeGlobalRemote: boolean;
  /** Candidate's base/home country ISO alpha-2 code (e.g. "CO", "MX", "ES") */
  homeCountry: string;
  /** Target country ISO alpha-2 codes to search across */
  targetCountries: string[];
  /** Acceptable work arrangements */
  workModes: WorkMode[];
}

export interface ScoringConfig {
  /** Minimum score (1-10) required to keep and notify a job offer */
  minScoreToNotify: number;
  /** Maximum number of filtered offers sent to AI scoring per run */
  maxJobsToEvaluate: number;
}

export type SourcesConfig = Record<SourceId, boolean>;

export interface ProfileConfig {
  targetRole: string;
  searchQueries: string[];
  yearsOfExperience: number;
  primaryStack: string[];
  secondaryStack: string[];
  excludeKeywords: string[];
  bio: string;
  languages: LanguagesConfig;
  locations: LocationsConfig;
  scoring: ScoringConfig;
  sources: SourcesConfig;
}

export interface EnvStatus {
  geminiConfigured: boolean;
  telegramConfigured: boolean;
  rapidApiConfigured: boolean;
  adzunaConfigured: boolean;
  joobleConfigured: boolean;
}
