import { isAbsolute, resolve } from "node:path";

import { CliError } from "../core/errors.js";
import type { JsonObject } from "../core/types.js";
import { isValidNativeHostName } from "../install/native-host.js";

export const DEFAULT_PERSISTENT_EXTENSION_NATIVE_HOST_NAME = "com.webenvoy.host";
export const PERSISTENT_EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
export const PERSISTENT_EXTENSION_BROWSER_CHANNELS = [
  "chrome",
  "chrome_beta",
  "chromium",
  "brave",
  "edge"
] as const;

export type PersistentExtensionBrowserChannel =
  (typeof PERSISTENT_EXTENSION_BROWSER_CHANNELS)[number];

export interface PersistentExtensionBinding {
  extensionId: string;
  nativeHostName: string;
  browserChannel: PersistentExtensionBrowserChannel;
  manifestPath: string | null;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

export const isPersistentExtensionId = (value: string): boolean =>
  PERSISTENT_EXTENSION_ID_PATTERN.test(value);

export const isPersistentExtensionBrowserChannel = (
  value: string
): value is PersistentExtensionBrowserChannel =>
  PERSISTENT_EXTENSION_BROWSER_CHANNELS.includes(value as PersistentExtensionBrowserChannel);

const invalidIdentityBindingInput = (
  reason: string,
  message: string
): CliError =>
  new CliError("ERR_PROFILE_INVALID", message, {
    details: {
      ability_id: "runtime.identity_preflight",
      stage: "input_validation",
      reason
    }
  });

const assertNativeHostNameForParams = (nativeHostName: string): void => {
  if (!isValidNativeHostName(nativeHostName)) {
    throw invalidIdentityBindingInput(
      "IDENTITY_BINDING_INVALID_NATIVE_HOST_NAME",
      "persistent_extension_identity.native_host_name 格式非法，必须满足 Chrome Native Messaging host 命名规则"
    );
  }
};

const assertNativeHostNameForMeta = (nativeHostName: string): void => {
  if (!isValidNativeHostName(nativeHostName)) {
    throw new CliError(
      "ERR_PROFILE_INVALID",
      "profile meta 中的 persistentExtensionBinding.nativeHostName 格式非法",
      {
        details: {
          ability_id: "runtime.identity_preflight",
          stage: "input_validation",
          reason: "IDENTITY_BINDING_INVALID_NATIVE_HOST_NAME"
        }
      }
    );
  }
};

export const parsePersistentExtensionBindingFromParams = (
  params: JsonObject
): PersistentExtensionBinding | null => {
  const raw =
    asRecord(params.persistent_extension_identity) ??
    asRecord(params.persistentExtensionIdentity);
  if (!raw) {
    return null;
  }

  const extensionId = asNonEmptyString(raw.extension_id) ?? asNonEmptyString(raw.extensionId);
  if (!extensionId || !isPersistentExtensionId(extensionId)) {
    throw invalidIdentityBindingInput(
      "IDENTITY_BINDING_INVALID_EXTENSION_ID",
      "persistent_extension_identity.extension_id 必须是 32 位 Chrome extension id"
    );
  }

  const nativeHostName =
    asNonEmptyString(raw.native_host_name) ??
    asNonEmptyString(raw.nativeHostName) ??
    DEFAULT_PERSISTENT_EXTENSION_NATIVE_HOST_NAME;
  assertNativeHostNameForParams(nativeHostName);

  const browserChannelRaw =
    asNonEmptyString(raw.browser_channel) ?? asNonEmptyString(raw.browserChannel) ?? "chrome";
  if (!isPersistentExtensionBrowserChannel(browserChannelRaw)) {
    throw invalidIdentityBindingInput(
      "IDENTITY_BINDING_INVALID_BROWSER_CHANNEL",
      "persistent_extension_identity.browser_channel 不受支持"
    );
  }

  const manifestPathRaw =
    asNonEmptyString(raw.manifest_path) ??
    asNonEmptyString(raw.manifestPath) ??
    asNonEmptyString(process.env.WEBENVOY_NATIVE_HOST_MANIFEST_PATH) ??
    null;

  return {
    extensionId,
    nativeHostName,
    browserChannel: browserChannelRaw,
    manifestPath:
      manifestPathRaw === null
        ? null
        : isAbsolute(manifestPathRaw)
          ? manifestPathRaw
          : resolve(manifestPathRaw)
  };
};

export const readPersistentExtensionBindingFromMetaValue = (
  value: unknown
): PersistentExtensionBinding | null => {
  const raw = asRecord(value);
  if (!raw) {
    return null;
  }
  const extensionId = asNonEmptyString(raw.extensionId);
  const browserChannel = asNonEmptyString(raw.browserChannel);
  if (
    !extensionId ||
    !isPersistentExtensionId(extensionId) ||
    !browserChannel ||
    !isPersistentExtensionBrowserChannel(browserChannel)
  ) {
    return null;
  }
  const nativeHostName = asNonEmptyString(raw.nativeHostName);
  if (!nativeHostName) {
    return null;
  }
  assertNativeHostNameForMeta(nativeHostName);
  const manifestPath = asNonEmptyString(raw.manifestPath);
  return {
    extensionId,
    nativeHostName,
    browserChannel,
    manifestPath: manifestPath ?? null
  };
};

export const inferPersistentExtensionBrowserChannel = (input: {
  browserPath: string | null;
  browserVersion: string | null;
}): PersistentExtensionBrowserChannel | null => {
  const normalizedVersion = input.browserVersion?.trim().toLowerCase() ?? "";
  const normalizedPath = input.browserPath?.toLowerCase() ?? "";

  if (normalizedVersion.includes("google chrome beta") || normalizedPath.includes("chrome beta")) {
    return "chrome_beta";
  }
  if (normalizedVersion.includes("google chrome")) {
    return "chrome";
  }
  if (normalizedVersion.includes("chromium") || normalizedPath.includes("chromium")) {
    return "chromium";
  }
  if (normalizedVersion.includes("microsoft edge") || normalizedPath.includes("microsoft/edge")) {
    return "edge";
  }
  if (normalizedVersion.includes("brave") || normalizedPath.includes("brave")) {
    return "brave";
  }
  return null;
};

export function assertPersistentExtensionBindingShape(
  value: unknown
): asserts value is PersistentExtensionBinding {
  const record = asRecord(value);
  if (!record) {
    throw new Error("Invalid profile meta structure: persistentExtensionBinding");
  }

  const extensionId = asNonEmptyString(record.extensionId);
  if (!extensionId || !isPersistentExtensionId(extensionId)) {
    throw new Error("Invalid profile meta structure: persistentExtensionBinding.extensionId");
  }

  const nativeHostName = asNonEmptyString(record.nativeHostName);
  if (!nativeHostName || !isValidNativeHostName(nativeHostName)) {
    throw new Error("Invalid profile meta structure: persistentExtensionBinding.nativeHostName");
  }

  const browserChannel = asNonEmptyString(record.browserChannel);
  if (!browserChannel || !isPersistentExtensionBrowserChannel(browserChannel)) {
    throw new Error("Invalid profile meta structure: persistentExtensionBinding.browserChannel");
  }

  const manifestPath = record.manifestPath;
  if (manifestPath !== null && typeof manifestPath !== "string") {
    throw new Error("Invalid profile meta structure: persistentExtensionBinding.manifestPath");
  }
}
