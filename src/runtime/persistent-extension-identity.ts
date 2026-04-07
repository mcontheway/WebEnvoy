import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { CliError } from "../core/errors.js";
import type { JsonObject } from "../core/types.js";
import {
  BrowserLaunchError,
  isUnsupportedBrandedChromeForExtensions,
  resolvePreferredBrowserVersionTruthSource
} from "./browser-launcher.js";
import {
  inferPersistentExtensionBrowserChannel,
  parsePersistentExtensionBindingFromParams,
  readPersistentExtensionBindingFromMetaValue
} from "./persistent-extension-binding.js";
import {
  type IdentityPreflightInstallDiagnostics,
  type IdentityManifestAdapters,
  type ManifestSource,
  readNativeHostManifest,
  resolveInstallDiagnostics,
  resolveManifestPathForBinding,
  resolveProfileExtensionState
} from "./persistent-extension-identity-install.js";
import type { ProfileMeta, PersistentExtensionBinding } from "./profile-store.js";

export type IdentityBindingState = "not_applicable" | "missing" | "bound" | "mismatch";
export type RuntimeIdentityMode = "load_extension" | "official_chrome_persistent_extension";

export interface IdentityPreflightResult {
  mode: RuntimeIdentityMode;
  browserPath: string | null;
  browserVersion: string | null;
  identityBindingState: IdentityBindingState;
  binding: PersistentExtensionBinding | null;
  manifestPath: string | null;
  manifestSource: ManifestSource | null;
  expectedOrigin: string | null;
  allowedOrigins: string[];
  installDiagnostics: IdentityPreflightInstallDiagnostics;
  blocking: boolean;
  failureReason:
    | "IDENTITY_PREFLIGHT_NOT_REQUIRED"
    | "IDENTITY_PREFLIGHT_PASSED"
    | "IDENTITY_BINDING_MISSING"
    | "IDENTITY_BINDING_INVALID"
    | "IDENTITY_MANIFEST_MISSING"
    | "IDENTITY_NATIVE_HOST_NAME_MISMATCH"
    | "IDENTITY_ALLOWED_ORIGIN_MISSING"
    | "IDENTITY_BINDING_CONFLICT"
    | "BOOTSTRAP_PENDING";
}

const execFileAsync = promisify(execFile);

interface IdentityPreflightAdapters extends IdentityManifestAdapters {
  resolvePreferredBrowserVersionTruthSource: typeof resolvePreferredBrowserVersionTruthSource;
  isUnsupportedBrandedChromeForExtensions: typeof isUnsupportedBrandedChromeForExtensions;
}

const DEFAULT_IDENTITY_PREFLIGHT_ADAPTERS: IdentityPreflightAdapters = {
  resolvePreferredBrowserVersionTruthSource,
  isUnsupportedBrandedChromeForExtensions,
  execFile: execFileAsync,
  platform: () => process.platform
};

let identityPreflightAdapters: IdentityPreflightAdapters = DEFAULT_IDENTITY_PREFLIGHT_ADAPTERS;
const EMPTY_INSTALL_DIAGNOSTICS: IdentityPreflightInstallDiagnostics = {
  launcherPath: null,
  launcherExists: null,
  launcherExecutable: null,
  bundleRuntimePath: null,
  bundleRuntimeExists: null,
  launcherProfileRoot: null,
  expectedProfileRoot: null,
  profileRootMatches: null,
  legacyLauncherDetected: null
};

export const setIdentityPreflightAdaptersForTests = (
  overrides: Partial<IdentityPreflightAdapters>
): void => {
  identityPreflightAdapters = {
    ...DEFAULT_IDENTITY_PREFLIGHT_ADAPTERS,
    ...overrides
  };
};

export const resetIdentityPreflightAdaptersForTests = (): void => {
  identityPreflightAdapters = DEFAULT_IDENTITY_PREFLIGHT_ADAPTERS;
};

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const buildBlockingResult = (
  input: Omit<IdentityPreflightResult, "blocking">
): IdentityPreflightResult => ({
  ...input,
  blocking: true
});

export const buildIdentityPreflightError = (
  result: IdentityPreflightResult
): CliError => {
  const details = {
    ability_id: "runtime.identity_preflight",
    stage: "execution" as const,
    reason: result.failureReason,
    identity_binding_state: result.identityBindingState,
    browser_mode: result.mode,
    browser_version: result.browserVersion,
    browser_path: result.browserPath,
    extension_id: result.binding?.extensionId ?? null,
    native_host_name: result.binding?.nativeHostName ?? null,
    browser_channel: result.binding?.browserChannel ?? null,
    manifest_path: result.manifestPath,
    manifest_source: result.manifestSource,
    expected_origin: result.expectedOrigin,
    allowed_origins: result.allowedOrigins,
    launcher_path: result.installDiagnostics.launcherPath,
    launcher_exists: result.installDiagnostics.launcherExists,
    launcher_executable: result.installDiagnostics.launcherExecutable,
    bundle_runtime_path: result.installDiagnostics.bundleRuntimePath,
    bundle_runtime_exists: result.installDiagnostics.bundleRuntimeExists,
    launcher_profile_root: result.installDiagnostics.launcherProfileRoot,
    expected_profile_root: result.installDiagnostics.expectedProfileRoot,
    profile_root_matches: result.installDiagnostics.profileRootMatches,
    legacy_launcher_detected: result.installDiagnostics.legacyLauncherDetected
  };

  if (result.failureReason === "BOOTSTRAP_PENDING") {
    return new CliError(
      "ERR_RUNTIME_BOOTSTRAP_PENDING",
      "identity preflight 已通过，但 persistent extension bootstrap 尚未实现",
      { details, retryable: false }
    );
  }

  if (result.identityBindingState === "missing") {
    return new CliError(
      "ERR_RUNTIME_IDENTITY_NOT_BOUND",
      "official Chrome persistent extension identity 未绑定，无法进入运行阶段",
      { details, retryable: false }
    );
  }

  return new CliError(
    "ERR_RUNTIME_IDENTITY_MISMATCH",
    "official Chrome persistent extension identity 不一致，已阻止继续执行",
    { details, retryable: false }
  );
};

export const runIdentityPreflight = async (input: {
  params: JsonObject;
  meta: ProfileMeta | null;
  profileDir?: string | null;
}): Promise<IdentityPreflightResult> => {
  let browserPath: string | null = null;
  let browserVersion: string | null = null;

  try {
    const truth = await identityPreflightAdapters.resolvePreferredBrowserVersionTruthSource(input.params);
    browserPath = truth.executablePath;
    browserVersion = truth.browserVersion;
  } catch (error) {
    if (!(error instanceof BrowserLaunchError)) {
      return {
        mode: "load_extension",
        browserPath: null,
        browserVersion: null,
        identityBindingState: "not_applicable",
        binding: null,
        manifestPath: null,
        manifestSource: null,
        expectedOrigin: null,
        allowedOrigins: [],
        installDiagnostics: EMPTY_INSTALL_DIAGNOSTICS,
        blocking: false,
        failureReason: "IDENTITY_PREFLIGHT_NOT_REQUIRED"
      };
    }
    return {
      mode: "load_extension",
      browserPath: null,
      browserVersion: null,
      identityBindingState: "not_applicable",
      binding: null,
      manifestPath: null,
      manifestSource: null,
      expectedOrigin: null,
      allowedOrigins: [],
      installDiagnostics: EMPTY_INSTALL_DIAGNOSTICS,
      blocking: false,
      failureReason: "IDENTITY_PREFLIGHT_NOT_REQUIRED"
    };
  }

  if (!identityPreflightAdapters.isUnsupportedBrandedChromeForExtensions(browserVersion)) {
    return {
      mode: "load_extension",
      browserPath,
      browserVersion,
      identityBindingState: "not_applicable",
      binding: null,
      manifestPath: null,
      manifestSource: null,
      expectedOrigin: null,
      allowedOrigins: [],
      installDiagnostics: EMPTY_INSTALL_DIAGNOSTICS,
      blocking: false,
      failureReason: "IDENTITY_PREFLIGHT_NOT_REQUIRED"
    };
  }

  const binding =
    parsePersistentExtensionBindingFromParams(input.params) ??
    readPersistentExtensionBindingFromMetaValue(input.meta?.persistentExtensionBinding);
  if (!binding) {
    return buildBlockingResult({
      mode: "official_chrome_persistent_extension",
      browserPath,
      browserVersion,
      identityBindingState: "missing",
      binding: null,
      manifestPath: null,
      manifestSource: null,
      expectedOrigin: null,
      allowedOrigins: [],
      installDiagnostics: EMPTY_INSTALL_DIAGNOSTICS,
      failureReason: "IDENTITY_BINDING_MISSING"
    });
  }

  const expectedOrigin = `chrome-extension://${binding.extensionId}/`;
  const profileDir =
    asNonEmptyString(input.meta?.profileDir) ?? asNonEmptyString(input.profileDir);
  const resolvedBrowserChannel = inferPersistentExtensionBrowserChannel({
    browserPath,
    browserVersion
  });
  if (resolvedBrowserChannel !== null && binding.browserChannel !== resolvedBrowserChannel) {
    return buildBlockingResult({
      mode: "official_chrome_persistent_extension",
      browserPath,
      browserVersion,
      identityBindingState: "mismatch",
      binding,
      manifestPath: binding.manifestPath,
      manifestSource: binding.manifestPath ? "binding" : null,
      expectedOrigin,
      allowedOrigins: [],
      installDiagnostics: EMPTY_INSTALL_DIAGNOSTICS,
      failureReason: "IDENTITY_BINDING_CONFLICT"
    });
  }
  const manifestResolution = await resolveManifestPathForBinding(binding, {
    execFile: identityPreflightAdapters.execFile,
    platform: identityPreflightAdapters.platform
  });
  const manifestPath = manifestResolution.manifestPath;
  if (manifestPath === null) {
    return buildBlockingResult({
      mode: "official_chrome_persistent_extension",
      browserPath,
      browserVersion,
      identityBindingState: "mismatch",
      binding,
      manifestPath: null,
      manifestSource: manifestResolution.manifestSource,
      expectedOrigin,
      allowedOrigins: [],
      installDiagnostics: EMPTY_INSTALL_DIAGNOSTICS,
      failureReason: "IDENTITY_MANIFEST_MISSING"
    });
  }
  const manifest = await readNativeHostManifest(manifestPath);
  const installDiagnostics = await resolveInstallDiagnostics({
    manifest,
    manifestPath,
    profileDir: profileDir ?? null,
    platform: identityPreflightAdapters.platform()
  });
  if (!manifest) {
    return buildBlockingResult({
      mode: "official_chrome_persistent_extension",
      browserPath,
      browserVersion,
      identityBindingState: "mismatch",
      binding: {
        ...binding,
        manifestPath
      },
      manifestPath,
      manifestSource: manifestResolution.manifestSource,
      expectedOrigin,
      allowedOrigins: [],
      installDiagnostics,
      failureReason: "IDENTITY_MANIFEST_MISSING"
    });
  }
  const installBroken =
    installDiagnostics.launcherExists === false ||
    installDiagnostics.launcherExecutable === false ||
    installDiagnostics.legacyLauncherDetected === true ||
    installDiagnostics.profileRootMatches === false ||
    (installDiagnostics.launcherExists === true &&
      installDiagnostics.bundleRuntimePath !== null &&
      installDiagnostics.bundleRuntimeExists === false);
  if (installBroken) {
    return buildBlockingResult({
      mode: "official_chrome_persistent_extension",
      browserPath,
      browserVersion,
      identityBindingState: "mismatch",
      binding: {
        ...binding,
        manifestPath
      },
      manifestPath,
      manifestSource: manifestResolution.manifestSource,
      expectedOrigin,
      allowedOrigins: manifest.allowed_origins,
      installDiagnostics,
      failureReason: "IDENTITY_MANIFEST_MISSING"
    });
  }

  if (manifest.name !== binding.nativeHostName) {
    return buildBlockingResult({
      mode: "official_chrome_persistent_extension",
      browserPath,
      browserVersion,
      identityBindingState: "mismatch",
      binding: {
        ...binding,
        manifestPath
      },
      manifestPath,
      manifestSource: manifestResolution.manifestSource,
      expectedOrigin,
      allowedOrigins: manifest.allowed_origins,
      installDiagnostics,
      failureReason: "IDENTITY_NATIVE_HOST_NAME_MISMATCH"
    });
  }

  if (!manifest.allowed_origins.includes(expectedOrigin)) {
    return buildBlockingResult({
      mode: "official_chrome_persistent_extension",
      browserPath,
      browserVersion,
      identityBindingState: "mismatch",
      binding: {
        ...binding,
        manifestPath
      },
      manifestPath,
      manifestSource: manifestResolution.manifestSource,
      expectedOrigin,
      allowedOrigins: manifest.allowed_origins,
      installDiagnostics,
      failureReason: "IDENTITY_ALLOWED_ORIGIN_MISSING"
    });
  }

  if (profileDir) {
    const extensionState = await resolveProfileExtensionState(profileDir, binding.extensionId);
    if (extensionState !== "enabled") {
      return buildBlockingResult({
        mode: "official_chrome_persistent_extension",
        browserPath,
        browserVersion,
        identityBindingState: "missing",
        binding: {
          ...binding,
          manifestPath
        },
        manifestPath,
        manifestSource: manifestResolution.manifestSource,
        expectedOrigin,
        allowedOrigins: manifest.allowed_origins,
        installDiagnostics,
        failureReason: "IDENTITY_BINDING_MISSING"
      });
    }
  }

  return {
    mode: "official_chrome_persistent_extension",
    browserPath,
    browserVersion,
    identityBindingState: "bound",
    binding: {
      ...binding,
      manifestPath
    },
    manifestPath,
    manifestSource: manifestResolution.manifestSource,
    expectedOrigin,
    allowedOrigins: manifest.allowed_origins,
    installDiagnostics,
    blocking: false,
    failureReason: "IDENTITY_PREFLIGHT_PASSED"
  };
};
