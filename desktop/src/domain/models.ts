import type { RawSigil } from '../shared/contracts';

export interface CatalogTrait {
  readonly id: string;
  readonly hash: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly category: string;
  readonly canPrimary: boolean;
  readonly canSecondary: boolean;
  readonly maxLevel: number | null;
  readonly iconFile?: string;
}

export interface CatalogData {
  readonly schemaVersion: number;
  readonly catalogVersion: string;
  readonly gameVersion: string;
  readonly categories: readonly { readonly id: string; readonly nameZh: string; readonly order: number }[];
  readonly traits: readonly CatalogTrait[];
}

export interface BuildProfile {
  readonly schemaVersion: 3;
  readonly catalogVersion: string;
  readonly name: string;
  readonly mandatory: readonly string[];
  readonly basicPrimary: readonly string[];
  readonly forceBasicPrimary: boolean;
  readonly allowBasicSubstitution: boolean;
  readonly basicSubstitutionOrder: readonly string[];
  readonly attackPrimary: readonly string[];
  readonly forceAttackPrimary: boolean;
  readonly defensePrimary: readonly string[];
  readonly forceDefensePrimary: boolean;
  readonly optional: readonly string[];
  readonly forbidden: readonly string[];
  readonly avoid: readonly string[];
}

export interface SolverRequest {
  readonly profile: BuildProfile;
  readonly catalog: CatalogData;
  readonly inventory: readonly RawSigil[];
  readonly maxSlots: number;
  readonly resultLimit: number;
  readonly runSeed: number;
  readonly timeLimitMs?: number;
  readonly memoryLimitMiB?: number;
}

export interface SolverResult {
  readonly selected: readonly RawSigil[];
  readonly signature: string;
  readonly mandatorySatisfied: boolean;
  readonly primaryMatched: number;
  readonly primaryRequired: number;
  readonly exactPrimaryCoverage: readonly boolean[];
  readonly basicSubstitutionUsage: readonly number[];
  readonly optionalMatched: number;
  readonly optionalCoverage: readonly boolean[];
  readonly avoidOccurrences: number;
  readonly usedSlots: number;
  readonly levelSum: number;
  readonly tieA: number;
  readonly tieB: number;
}

export interface SolverAnalysis {
  readonly status: 'completed' | 'no-solution';
  readonly results: readonly SolverResult[];
  readonly candidateTypeCount: number;
  readonly exploredStateCount: number;
}
