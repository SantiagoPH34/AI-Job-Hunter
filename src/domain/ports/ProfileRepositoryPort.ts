import type { ProfileConfig } from "../entities/Profile.js";

export interface ProfileRepositoryPort {
  load(): ProfileConfig;
  save(profile: ProfileConfig): ProfileConfig;
}
