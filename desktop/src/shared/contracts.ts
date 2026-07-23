export type TargetDomain =
  | 'mandatory'
  | 'basicPrimary'
  | 'attackPrimary'
  | 'defensePrimary'
  | 'optional'
  | 'basicSubstitutionOrder'
  | 'forbidden'
  | 'avoid';

export interface EngineHello {
  readonly engineVersion: string;
  readonly buildManifestHash: string;
  readonly catalogSchemaVersion: string;
  readonly maxFrameBytes: number;
  readonly capabilities: readonly string[];
}

export interface SaveFileGrant {
  readonly grantId: string;
  readonly displayName: string;
  readonly size: number;
  readonly expiresAt: string;
}

export interface DesktopApi {
  getEngineHello(): Promise<EngineHello>;
  getCachedInventory(): Promise<ImportedInventory | null>;
  chooseSaveFile(): Promise<SaveFileGrant | null>;
  importSaveFile(grantId: string): Promise<ImportedInventory>;
}

export interface RawSigil {
  readonly gemUnitId: number;
  readonly inventorySlotId: number;
  readonly sigilHash: number;
  readonly sigilLevel: number;
  readonly primaryTraitHash: number;
  /** Raw IDType 1702 value. It is retained for save compatibility and must not be presented as one sigil's contributed trait level. */
  readonly primaryLevel: number;
  readonly secondaryTraitHash: number;
  /** Raw IDType 1702 value. It commonly matches the trait cap (30/45/65), not the equipped sigil level. */
  readonly secondaryLevel: number;
  readonly flags: number;
  readonly wornByCharacterId: string | null;
}

export interface DesktopDiagnostic {
  readonly severity: string;
  readonly code: string;
  readonly message: string;
  readonly metadata: Readonly<Record<string, string>> | null;
}

export interface ImportedInventory {
  readonly inventoryId: string;
  readonly parserVersion: string;
  readonly saveFormatVersion: string;
  readonly sigils: readonly RawSigil[];
  readonly diagnostics: readonly DesktopDiagnostic[];
  readonly sourceDisplayName?: string;
  readonly cachedAt?: string;
}
