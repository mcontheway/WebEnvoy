import { readFileSync } from "node:fs";
import { release } from "node:os";

import type { JsonObject } from "../core/types.js";
import type { ProfileMeta } from "./profile-store.js";
import {
  buildFingerprintRuntimeContext,
  normalizeArch,
  normalizePlatform,
  type FingerprintEnvironment,
  type FingerprintRuntimeContext
} from "../../shared/fingerprint-profile.js";

const LINUX_OS_RELEASE_PATHS = ["/etc/os-release", "/usr/lib/os-release"] as const;

let cachedLinuxDistributionVersion: string | null | undefined;

const parseOsReleaseValue = (value: string): string => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const resolveLinuxDistributionVersion = (): string | null => {
  if (cachedLinuxDistributionVersion !== undefined) {
    return cachedLinuxDistributionVersion;
  }

  for (const filePath of LINUX_OS_RELEASE_PATHS) {
    try {
      const raw = readFileSync(filePath, "utf8");
      for (const line of raw.split(/\r?\n/u)) {
        const normalized = line.trim();
        if (normalized.length === 0 || normalized.startsWith("#")) {
          continue;
        }
        const delimiterIndex = normalized.indexOf("=");
        if (delimiterIndex <= 0) {
          continue;
        }
        const key = normalized.slice(0, delimiterIndex).trim();
        if (key !== "VERSION_ID") {
          continue;
        }
        const value = parseOsReleaseValue(normalized.slice(delimiterIndex + 1));
        if (value.length > 0) {
          cachedLinuxDistributionVersion = value;
          return cachedLinuxDistributionVersion;
        }
      }
    } catch {
      continue;
    }
  }

  cachedLinuxDistributionVersion = null;
  return cachedLinuxDistributionVersion;
};

const resolveCurrentOsVersion = (osFamily: string): string => {
  if (osFamily === "linux") {
    return resolveLinuxDistributionVersion() ?? "unknown";
  }
  return release();
};

const resolveTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export const resolveCurrentFingerprintEnvironment = (): FingerprintEnvironment => {
  const osFamily = normalizePlatform(process.platform);
  return {
    os_family: osFamily,
    os_version: resolveCurrentOsVersion(osFamily),
    arch: normalizeArch(process.arch)
  };
};

export const buildFingerprintContextForMeta = (
  profile: string,
  meta: Pick<ProfileMeta, "fingerprintSeeds" | "fingerprintProfileBundle"> | null,
  options?: { requestedExecutionMode?: string | null }
): FingerprintRuntimeContext =>
  buildFingerprintRuntimeContext({
    profile,
    metaPresent: meta !== null,
    fingerprintSeeds: meta?.fingerprintSeeds ?? null,
    existingBundle: meta?.fingerprintProfileBundle ?? null,
    actualEnvironment: resolveCurrentFingerprintEnvironment(),
    requestedExecutionMode: options?.requestedExecutionMode ?? null,
    timezone: resolveTimezone()
  });

export const appendFingerprintContext = (
  params: JsonObject,
  fingerprintContext: FingerprintRuntimeContext
): JsonObject => ({
  ...params,
  fingerprint_context: fingerprintContext
});
