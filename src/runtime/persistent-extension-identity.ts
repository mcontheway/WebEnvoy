import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { CliError } from "../core/errors.js";
import type { JsonObject } from "../core/types.js";
import {
  isUnsupportedBrandedChromeForExtensions,
  resolveBrowserVersionTruthSource
} from "./browser-launcher.js";
import type { ProfileMeta, PersistentExtensionBinding } from "./profile-store.js";

export type IdentityBindingState = "not_applicable" | "missing" | "bound" | "mismatch";
export type RuntimeIdentityMode = "load_extension" | "official_chrome_persistent_extension";

interface NativeHostManifest {
  name: string;
  allowed_origins: string[];
}

export interface IdentityPreflightResult {
  mode: RuntimeIdentityMode;
  browserPath: string | null;
  browserVersion: string | null;
  identityBindingState: IdentityBindingState;
  binding: PersistentExtensionBinding | null;
  manifestPath: string | null;
  expectedOrigin: string | null;
  allowedOrigins: string[];
  blocking: boolean;
  failureReason:
    | "IDENTITY_PREFLIGHT_NOT_REQUIRED"
    | "IDENTITY_BINDING_MISSING"
    | "IDENTITY_BINDING_INVALID"
    | "IDENTITY_MANIFEST_MISSING"
    | "IDENTITY_NATIVE_HOST_NAME_MISMATCH"
    | "IDENTITY_ALLOWED_ORIGIN_MISSING"
    | "IDENTITY_BINDING_CONFLICT"
    | "BOOTSTRAP_PENDING";
}

const DEFAULT_NATIVE_HOST_NAME = "com.webenvoy.host";
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
const BROWSER_CHANNELS = ["chrome", "chrome_beta", "chromium", "brave", "edge"] as const;
type BrowserChannel = (typeof BROWSER_CHANNELS)[number];

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const isBrowserChannel = (value: string): value is BrowserChannel =>
  BROWSER_CHANNELS.includes(value as BrowserChannel);

const resolveManifestPathForChannel = (
  browserChannel: BrowserChannel,
  nativeHostName: string
): string => {
  if (process.platform === "darwin") {
    const baseByChannel: Record<BrowserChannel, string> = {
      chrome: join(homedir(), "Library", "Application Support", "Google", "Chrome"),
      chrome_beta: join(homedir(), "Library", "Application Support", "Google", "Chrome Beta"),
      chromium: join(homedir(), "Library", "Application Support", "Chromium"),
      brave: join(
        homedir(),
        "Library",
        "Application Support",
        "BraveSoftware",
        "Brave-Browser"
      ),
      edge: join(homedir(), "Library", "Application Support", "Microsoft Edge")
    };
    return join(baseByChannel[browserChannel], "NativeMessagingHosts", `${nativeHostName}.json`);
  }

  if (process.platform === "linux") {
    const baseByChannel: Record<BrowserChannel, string> = {
      chrome: join(homedir(), ".config", "google-chrome"),
      chrome_beta: join(homedir(), ".config", "google-chrome-beta"),
      chromium: join(homedir(), ".config", "chromium"),
      brave: join(homedir(), ".config", "BraveSoftware", "Brave-Browser"),
      edge: join(homedir(), ".config", "microsoft-edge")
    };
    return join(baseByChannel[browserChannel], "NativeMessagingHosts", `${nativeHostName}.json`);
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? process.env.APPDATA ?? homedir();
    return join(localAppData, "WebEnvoy", `${nativeHostName}.json`);
  }

  return join(homedir(), `${nativeHostName}.json`);
};

const parsePersistentExtensionBindingFromParams = (
  params: JsonObject
): PersistentExtensionBinding | null => {
  const raw =
    asRecord(params.persistent_extension_identity) ??
    asRecord(params.persistentExtensionIdentity);
  if (!raw) {
    return null;
  }

  const extensionId = asNonEmptyString(raw.extension_id) ?? asNonEmptyString(raw.extensionId);
  if (!extensionId || !EXTENSION_ID_PATTERN.test(extensionId)) {
    throw new CliError(
      "ERR_PROFILE_INVALID",
      "persistent_extension_identity.extension_id 必须是 32 位 Chrome extension id",
      {
        details: {
          ability_id: "runtime.identity_preflight",
          stage: "input_validation",
          reason: "IDENTITY_BINDING_INVALID_EXTENSION_ID"
        }
      }
    );
  }

  const nativeHostName =
    asNonEmptyString(raw.native_host_name) ??
    asNonEmptyString(raw.nativeHostName) ??
    DEFAULT_NATIVE_HOST_NAME;
  const browserChannelRaw =
    asNonEmptyString(raw.browser_channel) ?? asNonEmptyString(raw.browserChannel) ?? "chrome";
  if (!isBrowserChannel(browserChannelRaw)) {
    throw new CliError(
      "ERR_PROFILE_INVALID",
      "persistent_extension_identity.browser_channel 不受支持",
      {
        details: {
          ability_id: "runtime.identity_preflight",
          stage: "input_validation",
          reason: "IDENTITY_BINDING_INVALID_BROWSER_CHANNEL"
        }
      }
    );
  }

  const manifestPath =
    asNonEmptyString(raw.manifest_path) ??
    asNonEmptyString(raw.manifestPath) ??
    asNonEmptyString(process.env.WEBENVOY_NATIVE_HOST_MANIFEST_PATH) ??
    null;

  return {
    extensionId,
    nativeHostName,
    browserChannel: browserChannelRaw,
    manifestPath
  };
};

const readNativeHostManifest = async (manifestPath: string): Promise<NativeHostManifest | null> => {
  try {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const name = asNonEmptyString(parsed.name);
    const allowedOrigins = Array.isArray(parsed.allowed_origins)
      ? parsed.allowed_origins.filter((entry): entry is string => typeof entry === "string")
      : [];
    if (!name) {
      return null;
    }
    return {
      name,
      allowed_origins: allowedOrigins
    };
  } catch {
    return null;
  }
};

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
    expected_origin: result.expectedOrigin,
    allowed_origins: result.allowedOrigins
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
}): Promise<IdentityPreflightResult> => {
  let browserPath: string | null = null;
  let browserVersion: string | null = null;

  try {
    const truth = await resolveBrowserVersionTruthSource(input.params, {
      allowUnsupportedExtensionBrowser: true
    });
    browserPath = truth.executablePath;
    browserVersion = truth.browserVersion;
  } catch {
    return {
      mode: "load_extension",
      browserPath: null,
      browserVersion: null,
      identityBindingState: "not_applicable",
      binding: null,
      manifestPath: null,
      expectedOrigin: null,
      allowedOrigins: [],
      blocking: false,
      failureReason: "IDENTITY_PREFLIGHT_NOT_REQUIRED"
    };
  }

  if (!isUnsupportedBrandedChromeForExtensions(browserVersion)) {
    return {
      mode: "load_extension",
      browserPath,
      browserVersion,
      identityBindingState: "not_applicable",
      binding: null,
      manifestPath: null,
      expectedOrigin: null,
      allowedOrigins: [],
      blocking: false,
      failureReason: "IDENTITY_PREFLIGHT_NOT_REQUIRED"
    };
  }

  const bindingFromParams = parsePersistentExtensionBindingFromParams(input.params);
  const bindingFromMeta = input.meta?.persistentExtensionBinding ?? null;
  if (bindingFromParams && bindingFromMeta) {
    const sameBinding =
      bindingFromParams.extensionId === bindingFromMeta.extensionId &&
      bindingFromParams.nativeHostName === bindingFromMeta.nativeHostName &&
      bindingFromParams.browserChannel === bindingFromMeta.browserChannel;
    if (!sameBinding) {
      return buildBlockingResult({
        mode: "official_chrome_persistent_extension",
        browserPath,
        browserVersion,
        identityBindingState: "mismatch",
        binding: bindingFromMeta,
        manifestPath: bindingFromParams.manifestPath ?? bindingFromMeta.manifestPath ?? null,
        expectedOrigin: `chrome-extension://${bindingFromMeta.extensionId}/`,
        allowedOrigins: [],
        failureReason: "IDENTITY_BINDING_CONFLICT"
      });
    }
  }

  const binding = bindingFromParams ?? bindingFromMeta;
  if (!binding) {
    return buildBlockingResult({
      mode: "official_chrome_persistent_extension",
      browserPath,
      browserVersion,
      identityBindingState: "missing",
      binding: null,
      manifestPath: null,
      expectedOrigin: null,
      allowedOrigins: [],
      failureReason: "IDENTITY_BINDING_MISSING"
    });
  }

  const expectedOrigin = `chrome-extension://${binding.extensionId}/`;
  const manifestPath =
    binding.manifestPath ??
    resolveManifestPathForChannel(binding.browserChannel, binding.nativeHostName);
  const manifest = await readNativeHostManifest(manifestPath);
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
      expectedOrigin,
      allowedOrigins: [],
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
      expectedOrigin,
      allowedOrigins: manifest.allowed_origins,
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
      expectedOrigin,
      allowedOrigins: manifest.allowed_origins,
      failureReason: "IDENTITY_ALLOWED_ORIGIN_MISSING"
    });
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
    expectedOrigin,
    allowedOrigins: manifest.allowed_origins,
    blocking: false,
    failureReason: "BOOTSTRAP_PENDING"
  };
};
