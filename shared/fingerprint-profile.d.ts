export interface FingerprintEnvironment {
  os_family: string;
  os_version: string;
  arch: string;
}

export interface FingerprintScreen {
  width: number;
  height: number;
  colorDepth: number;
  pixelDepth: number;
}

export interface FingerprintBattery {
  level: number;
  charging: boolean;
}

export interface FingerprintProfileBundle {
  ua: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  screen: FingerprintScreen;
  battery: FingerprintBattery;
  timezone: string;
  audioNoiseSeed: number;
  canvasNoiseSeed: number;
  environment: FingerprintEnvironment;
  legacy_migration?: {
    status: "backfilled_from_legacy";
    migrated_at: string;
    source_schema_version: number;
    reason_codes: string[];
  };
}

export interface FingerprintPatchManifest {
  profile: string;
  manifest_version: string;
  required_patches: string[];
  optional_patches: string[];
  field_dependencies: Record<string, string[]>;
  unsupported_reason_codes: string[];
}

export interface FingerprintConsistencyCheck {
  profile: string;
  expected_environment: FingerprintEnvironment;
  actual_environment: FingerprintEnvironment;
  decision: "match" | "mismatch";
  reason_codes: string[];
}

export interface FingerprintRuntimeContext {
  profile: string;
  source: "profile_meta" | "profile_missing";
  fingerprint_profile_bundle: FingerprintProfileBundle | null;
  fingerprint_patch_manifest: FingerprintPatchManifest | null;
  fingerprint_consistency_check: FingerprintConsistencyCheck;
  execution: {
    live_allowed: boolean;
    live_decision: "allowed" | "dry_run_only";
    allowed_execution_modes: string[];
    reason_codes: string[];
  };
}

export interface FingerprintSeedSource {
  audioNoiseSeed?: string;
  canvasNoiseSeed?: string;
}

export declare const REQUIRED_PATCHES: string[];
export declare const OPTIONAL_PATCHES: string[];
export declare const FIELD_DEPENDENCIES: Record<string, string[]>;
export declare const DEFAULT_PLUGIN_DESCRIPTORS: Array<{
  name: string;
  filename: string;
  description: string;
}>;
export declare const DEFAULT_MIME_TYPE_DESCRIPTORS: Array<{
  type: string;
  suffixes: string;
  description: string;
  enabledPlugin: string;
}>;

export declare const normalizePlatform: (platform: unknown) => string;
export declare const normalizeArch: (arch: unknown) => string;
export declare const isFingerprintProfileBundle: (
  value: unknown
) => value is FingerprintProfileBundle;
export declare const isConsistencyCheck: (
  value: unknown
) => value is FingerprintConsistencyCheck;
export declare const isRuntimeContext: (value: unknown) => value is FingerprintRuntimeContext;
export declare const buildFingerprintProfileBundle: (input: {
  profileName: string;
  fingerprintSeeds?: FingerprintSeedSource | null;
  existingBundle?: unknown;
  environment?: Partial<FingerprintEnvironment> | null;
  timezone?: string | null;
  ua?: string | null;
}) => FingerprintProfileBundle;
export declare const markFingerprintProfileBundleAsLegacyBackfilled: (input: {
  profileName: string;
  fingerprintSeeds?: FingerprintSeedSource | null;
  existingBundle?: unknown;
  environment?: Partial<FingerprintEnvironment> | null;
  timezone?: string | null;
  ua?: string | null;
  migratedAt?: string | null;
  sourceSchemaVersion?: number | null;
  reasonCodes?: string[] | null;
}) => FingerprintProfileBundle;
export declare const buildFingerprintPatchManifest: (input: {
  profile: string;
  bundle: FingerprintProfileBundle;
}) => FingerprintPatchManifest;
export declare const buildFingerprintConsistencyCheck: (input: {
  profile: string;
  bundle: FingerprintProfileBundle | null;
  actualEnvironment?: Partial<FingerprintEnvironment> | null;
}) => FingerprintConsistencyCheck;
export declare const buildFingerprintRuntimeContext: (input: {
  profile: string;
  metaPresent: boolean;
  fingerprintSeeds?: FingerprintSeedSource | null;
  existingBundle?: unknown;
  actualEnvironment?: Partial<FingerprintEnvironment> | null;
  requestedExecutionMode?: string | null;
  timezone?: string | null;
  ua?: string | null;
}) => FingerprintRuntimeContext;
export declare const buildIncompleteFingerprintRuntimeContext: (input: {
  profile: string;
  metaPresent: boolean;
  actualEnvironment?: Partial<FingerprintEnvironment> | null;
  reasonCode: string;
}) => FingerprintRuntimeContext;
export declare const ensureFingerprintRuntimeContext: (
  value: unknown
) => FingerprintRuntimeContext | null;
