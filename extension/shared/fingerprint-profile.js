const REQUIRED_PATCHES = [
  "audio_context",
  "battery",
  "navigator_plugins",
  "navigator_mime_types"
];

const OPTIONAL_PATCHES = [
  "hardware_concurrency",
  "device_memory",
  "performance_memory",
  "screen_color_depth",
  "screen_pixel_depth",
  "permissions_api",
  "navigator_connection"
];

const FIELD_DEPENDENCIES = {
  audio_context: ["audioNoiseSeed"],
  battery: ["battery.level", "battery.charging"],
  navigator_plugins: [],
  navigator_mime_types: [],
  hardware_concurrency: ["hardwareConcurrency"],
  device_memory: ["deviceMemory"],
  performance_memory: ["deviceMemory"],
  screen_color_depth: ["screen.colorDepth"],
  screen_pixel_depth: ["screen.pixelDepth"],
  permissions_api: [],
  navigator_connection: []
};

const LIVE_EXECUTION_MODES = new Set([
  "live_read_limited",
  "live_read_high_risk",
  "live_write"
]);

const DEFAULT_PLUGIN_DESCRIPTORS = [
  {
    name: "Chrome PDF Viewer",
    filename: "internal-pdf-viewer",
    description: "Portable Document Format"
  },
  {
    name: "Chromium PDF Viewer",
    filename: "internal-pdf-viewer",
    description: "Portable Document Format"
  },
  {
    name: "Microsoft Edge PDF Viewer",
    filename: "internal-pdf-viewer",
    description: "Portable Document Format"
  },
  {
    name: "PDF Viewer",
    filename: "internal-pdf-viewer",
    description: "Portable Document Format"
  }
];

const DEFAULT_MIME_TYPE_DESCRIPTORS = [
  {
    type: "application/pdf",
    suffixes: "pdf",
    description: "Portable Document Format",
    enabledPlugin: "Chrome PDF Viewer"
  },
  {
    type: "text/pdf",
    suffixes: "pdf",
    description: "Portable Document Format",
    enabledPlugin: "Chrome PDF Viewer"
  }
];

const SCREEN_CANDIDATES = [
  { width: 1440, height: 900, colorDepth: 30, pixelDepth: 30 },
  { width: 1512, height: 982, colorDepth: 24, pixelDepth: 24 },
  { width: 1680, height: 1050, colorDepth: 24, pixelDepth: 24 },
  { width: 1728, height: 1117, colorDepth: 30, pixelDepth: 30 },
  { width: 1920, height: 1080, colorDepth: 24, pixelDepth: 24 }
];

const DEVICE_MEMORY_CANDIDATES = [4, 8, 16];

const isObjectRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizePlatform = (platform) => {
  if (platform === "darwin") {
    return "macos";
  }
  if (platform === "win32") {
    return "windows";
  }
  if (platform === "linux") {
    return "linux";
  }
  return typeof platform === "string" && platform.length > 0 ? platform : "unknown";
};

const normalizeArch = (arch) => {
  if (arch === "x64") {
    return "x64";
  }
  if (arch === "arm64") {
    return "arm64";
  }
  return typeof arch === "string" && arch.length > 0 ? arch : "unknown";
};

const normalizeOsVersion = (osFamily, rawVersion) => {
  if (typeof rawVersion !== "string" || rawVersion.length === 0) {
    return "unknown";
  }

  if (osFamily !== "macos") {
    return rawVersion;
  }

  const matched = rawVersion.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!matched) {
    return rawVersion;
  }

  const darwinMajor = Number.parseInt(matched[1], 10);
  if (!Number.isInteger(darwinMajor)) {
    return rawVersion;
  }

  // `os.release()` on macOS returns Darwin kernel versions (for example: 24.4.0),
  // while browser UA must use macOS product versions.
  if (darwinMajor >= 20) {
    return `${darwinMajor - 9}.0`;
  }
  if (darwinMajor >= 4 && darwinMajor <= 19) {
    return `10.${darwinMajor - 4}`;
  }

  return rawVersion;
};

const hashString = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const stableUnit = (seed) => hashString(seed) / 0xffffffff;

const roundNumber = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const selectBySeed = (seed, candidates) => candidates[hashString(seed) % candidates.length];

const extractChromeVersion = (value) => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const uaMatch = value.match(/\b(?:Chrome|Chromium)\/(\d+\.\d+\.\d+\.\d+)\b/i);
  if (uaMatch) {
    return uaMatch[1];
  }

  const binaryVersionMatch = value.match(
    /\b(?:Google Chrome|Chrome for Testing|Chromium)\s+(\d+\.\d+\.\d+\.\d+)\b/i
  );
  if (binaryVersionMatch) {
    return binaryVersionMatch[1];
  }

  return null;
};

const resolveChromeVersion = (input) => {
  const explicitVersion = extractChromeVersion(input.browserVersion);
  if (explicitVersion) {
    return explicitVersion;
  }

  if (typeof navigator !== "undefined" && typeof navigator.userAgent === "string") {
    const fromNavigator = extractChromeVersion(navigator.userAgent);
    if (fromNavigator) {
      return fromNavigator;
    }
  }

  return null;
};

const buildDefaultUserAgent = (environment, input) => {
  const archToken = environment.arch === "arm64" ? "ARM 64" : "Win64; x64";
  const linuxArchToken = environment.arch === "arm64" ? "arm64" : "x86_64";
  const chromeVersion = resolveChromeVersion(input) ?? "0.0.0.0";

  if (environment.os_family === "macos") {
    const version = String(environment.os_version ?? "14_0").replace(/\./g, "_");
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X ${version}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  }

  if (environment.os_family === "windows") {
    return `Mozilla/5.0 (Windows NT 10.0; ${archToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  }

  return `Mozilla/5.0 (X11; Linux ${linuxArchToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
};

const isLikelyLinuxKernelVersion = (value) =>
  typeof value === "string" &&
  /^\d+\.\d+\.\d+/.test(value);

const harmonizeExistingBundleEnvironment = (bundle, actualEnvironment) => {
  const cloned = cloneJson(bundle);
  if (!isEnvironment(cloned.environment)) {
    return cloned;
  }

  const actualOsFamily = normalizePlatform(actualEnvironment?.os_family);
  const actualOsVersion = normalizeOsVersion(actualOsFamily, actualEnvironment?.os_version ?? "unknown");
  if (
    actualOsFamily === "linux" &&
    cloned.environment.os_family === "linux" &&
    isLikelyLinuxKernelVersion(cloned.environment.os_version) &&
    actualOsVersion !== "unknown" &&
    cloned.environment.os_version !== actualOsVersion
  ) {
    cloned.environment = {
      ...cloned.environment,
      os_version: actualOsVersion
    };
  }

  return cloned;
};

const readPath = (target, path) => {
  const segments = path.split(".");
  let current = target;
  for (const segment of segments) {
    if (!isObjectRecord(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
};

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const isEnvironment = (value) =>
  isObjectRecord(value) &&
  typeof value.os_family === "string" &&
  typeof value.os_version === "string" &&
  typeof value.arch === "string";

const isScreen = (value) =>
  isObjectRecord(value) &&
  Number.isInteger(value.width) &&
  Number.isInteger(value.height) &&
  Number.isInteger(value.colorDepth) &&
  Number.isInteger(value.pixelDepth);

const isBattery = (value) =>
  isObjectRecord(value) &&
  typeof value.charging === "boolean" &&
  typeof value.level === "number" &&
  Number.isFinite(value.level) &&
  value.level >= 0 &&
  value.level <= 1;

const isLegacyMigration = (value) =>
  isObjectRecord(value) &&
  value.status === "backfilled_from_legacy" &&
  typeof value.migrated_at === "string" &&
  value.migrated_at.length > 0 &&
  Number.isInteger(value.source_schema_version) &&
  Array.isArray(value.reason_codes) &&
  value.reason_codes.every((code) => typeof code === "string");

const isFingerprintProfileBundle = (value) =>
  isObjectRecord(value) &&
  typeof value.ua === "string" &&
  Number.isInteger(value.hardwareConcurrency) &&
  Number.isInteger(value.deviceMemory) &&
  isScreen(value.screen) &&
  isBattery(value.battery) &&
  typeof value.timezone === "string" &&
  typeof value.audioNoiseSeed === "number" &&
  Number.isFinite(value.audioNoiseSeed) &&
  typeof value.canvasNoiseSeed === "number" &&
  Number.isFinite(value.canvasNoiseSeed) &&
  isEnvironment(value.environment) &&
  (value.legacy_migration === undefined || isLegacyMigration(value.legacy_migration));

const isPatchManifest = (value) =>
  isObjectRecord(value) &&
  typeof value.profile === "string" &&
  typeof value.manifest_version === "string" &&
  Array.isArray(value.required_patches) &&
  Array.isArray(value.optional_patches) &&
  isObjectRecord(value.field_dependencies) &&
  Array.isArray(value.unsupported_reason_codes);

const isConsistencyCheck = (value) =>
  isObjectRecord(value) &&
  typeof value.profile === "string" &&
  isEnvironment(value.expected_environment) &&
  isEnvironment(value.actual_environment) &&
  (value.decision === "match" || value.decision === "mismatch") &&
  Array.isArray(value.reason_codes);

const isRuntimeContext = (value) =>
  isObjectRecord(value) &&
  typeof value.profile === "string" &&
  (value.source === "profile_meta" || value.source === "profile_missing") &&
  (value.fingerprint_profile_bundle === null || isFingerprintProfileBundle(value.fingerprint_profile_bundle)) &&
  (value.fingerprint_patch_manifest === null || isPatchManifest(value.fingerprint_patch_manifest)) &&
  isConsistencyCheck(value.fingerprint_consistency_check) &&
  isObjectRecord(value.execution) &&
  typeof value.execution.live_allowed === "boolean" &&
  (value.execution.live_decision === "allowed" || value.execution.live_decision === "dry_run_only") &&
  Array.isArray(value.execution.allowed_execution_modes) &&
  value.execution.allowed_execution_modes.every((mode) => typeof mode === "string") &&
  Array.isArray(value.execution.reason_codes) &&
  value.execution.reason_codes.every((code) => typeof code === "string");

const buildIncompleteFingerprintRuntimeContext = (input) => {
  const reasonCode = input.reasonCode;
  const actualOsFamily = normalizePlatform(input.actualEnvironment?.os_family);
  return {
    profile: input.profile,
    source: input.metaPresent ? "profile_meta" : "profile_missing",
    fingerprint_profile_bundle: null,
    fingerprint_patch_manifest: null,
    fingerprint_consistency_check: {
      profile: input.profile,
      expected_environment: {
        os_family: "unknown",
        os_version: "unknown",
        arch: "unknown"
      },
      actual_environment: {
        os_family: actualOsFamily,
        os_version: normalizeOsVersion(actualOsFamily, input.actualEnvironment?.os_version ?? "unknown"),
        arch: normalizeArch(input.actualEnvironment?.arch)
      },
      decision: "mismatch",
      reason_codes: [reasonCode]
    },
    execution: {
      live_allowed: false,
      live_decision: "dry_run_only",
      allowed_execution_modes: ["dry_run", "recon"],
      reason_codes: [reasonCode]
    }
  };
};

const buildFingerprintProfileBundle = (input) => {
  const osFamily = normalizePlatform(input.environment?.os_family);
  const environment = {
    os_family: osFamily,
    os_version: normalizeOsVersion(osFamily, input.environment?.os_version ?? "unknown"),
    arch: normalizeArch(input.environment?.arch)
  };

  const profileName = typeof input.profileName === "string" ? input.profileName : "default";
  const fingerprintSeeds = isObjectRecord(input.fingerprintSeeds) ? input.fingerprintSeeds : {};
  const audioSeedSource =
    typeof fingerprintSeeds.audioNoiseSeed === "string"
      ? fingerprintSeeds.audioNoiseSeed
      : `${profileName}-audio-seed`;
  const canvasSeedSource =
    typeof fingerprintSeeds.canvasNoiseSeed === "string"
      ? fingerprintSeeds.canvasNoiseSeed
      : `${profileName}-canvas-seed`;

  if (isFingerprintProfileBundle(input.existingBundle)) {
    return harmonizeExistingBundleEnvironment(input.existingBundle, input.environment);
  }

  const screen = selectBySeed(`${profileName}:screen`, SCREEN_CANDIDATES);
  const deviceMemory = selectBySeed(`${profileName}:device-memory`, DEVICE_MEMORY_CANDIDATES);
  const hardwareConcurrency =
    deviceMemory >= 16
      ? selectBySeed(`${profileName}:hardware`, [8, 10, 12])
      : deviceMemory >= 8
        ? selectBySeed(`${profileName}:hardware`, [8, 10])
        : selectBySeed(`${profileName}:hardware`, [4, 8]);

  return {
    ua:
      typeof input.ua === "string" && input.ua.length > 0
        ? input.ua
        : buildDefaultUserAgent(environment, input),
    hardwareConcurrency,
    deviceMemory,
    screen: cloneJson(screen),
    battery: {
      level: roundNumber(0.52 + stableUnit(`${profileName}:battery-level`) * 0.39, 4),
      charging: stableUnit(`${profileName}:battery-charging`) >= 0.5
    },
    timezone:
      typeof input.timezone === "string" && input.timezone.length > 0 ? input.timezone : "UTC",
    audioNoiseSeed: roundNumber(stableUnit(audioSeedSource) / 1_000, 9),
    canvasNoiseSeed: roundNumber(stableUnit(canvasSeedSource) / 1_000, 9),
    environment
  };
};

const markFingerprintProfileBundleAsLegacyBackfilled = (input) => {
  const bundle = buildFingerprintProfileBundle(input);
  const sourceSchemaVersion =
    Number.isInteger(input.sourceSchemaVersion) && input.sourceSchemaVersion > 0
      ? input.sourceSchemaVersion
      : 1;
  const reasonCodes =
    Array.isArray(input.reasonCodes) && input.reasonCodes.every((code) => typeof code === "string")
      ? [...new Set(input.reasonCodes)]
      : ["LEGACY_PROFILE_BUNDLE_MIGRATED"];
  return {
    ...bundle,
    legacy_migration: {
      status: "backfilled_from_legacy",
      migrated_at:
        typeof input.migratedAt === "string" && input.migratedAt.length > 0
          ? input.migratedAt
          : new Date().toISOString(),
      source_schema_version: sourceSchemaVersion,
      reason_codes: reasonCodes
    }
  };
};

const buildFingerprintPatchManifest = (input) => {
  const bundle = input.bundle;
  const unsupportedReasonCodes = [];

  for (const patchName of REQUIRED_PATCHES) {
    const dependencies = FIELD_DEPENDENCIES[patchName] ?? [];
    const missing = dependencies.filter((path) => readPath(bundle, path) === undefined);
    if (missing.length > 0) {
      unsupportedReasonCodes.push("PROFILE_FIELD_MISSING");
      break;
    }
  }

  if (isLegacyMigration(bundle.legacy_migration)) {
    unsupportedReasonCodes.push(...bundle.legacy_migration.reason_codes);
  }

  return {
    profile: input.profile,
    manifest_version: "1",
    required_patches: [...REQUIRED_PATCHES],
    optional_patches: [...OPTIONAL_PATCHES],
    field_dependencies: cloneJson(FIELD_DEPENDENCIES),
    unsupported_reason_codes: unsupportedReasonCodes
  };
};

const buildFingerprintConsistencyCheck = (input) => {
  const expected =
    input.bundle && isEnvironment(input.bundle.environment)
      ? input.bundle.environment
      : {
          os_family: "unknown",
          os_version: "unknown",
          arch: "unknown"
        };
  const actualOsFamily = normalizePlatform(input.actualEnvironment?.os_family);
  const actual = {
    os_family: actualOsFamily,
    os_version: normalizeOsVersion(actualOsFamily, input.actualEnvironment?.os_version ?? "unknown"),
    arch: normalizeArch(input.actualEnvironment?.arch)
  };
  const reasonCodes = [];

  if (!input.bundle) {
    reasonCodes.push("PROFILE_META_MISSING");
  } else {
    if (expected.os_family !== actual.os_family) {
      reasonCodes.push("OS_FAMILY_MISMATCH");
    }
    if (expected.os_version !== actual.os_version) {
      reasonCodes.push("OS_VERSION_MISMATCH");
    }
    if (expected.arch !== actual.arch) {
      reasonCodes.push("ARCH_MISMATCH");
    }
  }

  return {
    profile: input.profile,
    expected_environment: expected,
    actual_environment: actual,
    decision: reasonCodes.length === 0 ? "match" : "mismatch",
    reason_codes: reasonCodes
  };
};

const buildFingerprintRuntimeContext = (input) => {
  const profile = typeof input.profile === "string" ? input.profile : "unknown";

  if (!input.metaPresent) {
    return buildIncompleteFingerprintRuntimeContext({
      profile,
      metaPresent: false,
      actualEnvironment: input.actualEnvironment,
      reasonCode: "PROFILE_META_MISSING"
    });
  }

  if (!isFingerprintProfileBundle(input.existingBundle)) {
    return buildIncompleteFingerprintRuntimeContext({
      profile,
      metaPresent: true,
      actualEnvironment: input.actualEnvironment,
      reasonCode: "PROFILE_FIELD_MISSING"
    });
  }

  const bundle = buildFingerprintProfileBundle({
    ...input,
    existingBundle: input.existingBundle,
    environment: input.actualEnvironment
  });
  const manifest = buildFingerprintPatchManifest({
    profile,
    bundle
  });
  const consistencyCheck = buildFingerprintConsistencyCheck({
    profile,
    bundle,
    actualEnvironment: input.actualEnvironment
  });
  const reasonCodes = [
    ...manifest.unsupported_reason_codes,
    ...consistencyCheck.reason_codes
  ];
  const liveAllowed = reasonCodes.length === 0;
  const requestedExecutionMode =
    typeof input.requestedExecutionMode === "string" ? input.requestedExecutionMode : null;
  const requestedLiveMode =
    requestedExecutionMode !== null && LIVE_EXECUTION_MODES.has(requestedExecutionMode);

  return {
    profile,
    source: "profile_meta",
    fingerprint_profile_bundle: bundle,
    fingerprint_patch_manifest: manifest,
    fingerprint_consistency_check: consistencyCheck,
    execution: {
      live_allowed: liveAllowed,
      live_decision:
        liveAllowed || !requestedLiveMode ? "allowed" : "dry_run_only",
      allowed_execution_modes: liveAllowed
        ? ["dry_run", "recon", "live_read_limited", "live_read_high_risk", "live_write"]
        : ["dry_run", "recon"],
      reason_codes: reasonCodes
    }
  };
};

const ensureFingerprintRuntimeContext = (value) => {
  if (!isRuntimeContext(value)) {
    return null;
  }
  return cloneJson(value);
};

export {
  DEFAULT_MIME_TYPE_DESCRIPTORS,
  DEFAULT_PLUGIN_DESCRIPTORS,
  FIELD_DEPENDENCIES,
  OPTIONAL_PATCHES,
  REQUIRED_PATCHES,
  buildFingerprintConsistencyCheck,
  buildFingerprintPatchManifest,
  buildFingerprintProfileBundle,
  buildFingerprintRuntimeContext,
  buildIncompleteFingerprintRuntimeContext,
  markFingerprintProfileBundleAsLegacyBackfilled,
  ensureFingerprintRuntimeContext,
  isConsistencyCheck,
  isFingerprintProfileBundle,
  isRuntimeContext,
  normalizeArch,
  normalizePlatform
};
