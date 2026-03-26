import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import {
  buildFingerprintProfileBundle,
  isFingerprintProfileBundle,
  markFingerprintProfileBundleAsLegacyBackfilled,
  type FingerprintProfileBundle
} from "../../shared/fingerprint-profile.js";
import { resolveBrowserVersionTruthSource } from "./browser-launcher.js";
import { resolveCurrentFingerprintEnvironment } from "./fingerprint-runtime.js";
import type { ProfileState } from "./profile-state.js";
import type { ProxyBinding } from "./proxy-binding.js";

export const PROFILE_META_FILENAME = "__webenvoy_meta.json";
export type ReadMetaMode = "readonly" | "migrate";

export interface ReadMetaOptions {
  mode?: ReadMetaMode;
}

export interface FingerprintSeeds {
  audioNoiseSeed: string;
  canvasNoiseSeed: string;
}

export interface LocalStorageSnapshotEntry {
  key: string;
  value: string;
}

export interface LocalStorageSnapshot {
  origin: string;
  entries: LocalStorageSnapshotEntry[];
}

export interface ProfileMeta {
  schemaVersion: number;
  profileName: string;
  profileDir: string;
  profileState: ProfileState;
  proxyBinding: ProxyBinding | null;
  fingerprintSeeds: FingerprintSeeds;
  fingerprintProfileBundle?: FingerprintProfileBundle;
  localStorageSnapshots: LocalStorageSnapshot[];
  createdAt: string;
  updatedAt: string;
  lastStartedAt: string | null;
  lastLoginAt: string | null;
  lastStoppedAt: string | null;
  lastDisconnectedAt: string | null;
}

interface FileSystemAdapter {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(path: string, data: string, encoding: "utf8"): Promise<unknown>;
  rename(oldPath: string, newPath: string): Promise<unknown>;
}

const DEFAULT_FILE_SYSTEM: FileSystemAdapter = {
  mkdir,
  readFile,
  writeFile,
  rename
};

const PROFILE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const PROFILE_STATES: readonly ProfileState[] = [
  "uninitialized",
  "starting",
  "ready",
  "logging_in",
  "disconnected",
  "stopping",
  "stopped"
];
const PROXY_BINDING_SOURCES = ["runtime.start", "runtime.login"] as const;
const LINUX_KERNEL_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+._][0-9A-Za-z._+-]+)*$/u;

const validateProfileName = (profileName: string, rootDir: string): void => {
  if (!PROFILE_NAME_PATTERN.test(profileName)) {
    throw new Error(`Invalid profile name: ${profileName}`);
  }
  if (profileName === "." || profileName === "..") {
    throw new Error(`Invalid profile name: ${profileName}`);
  }

  const resolvedProfileDir = resolve(rootDir, profileName);
  const rootWithSeparator = rootDir.endsWith(sep) ? rootDir : `${rootDir}${sep}`;
  if (!resolvedProfileDir.startsWith(rootWithSeparator)) {
    throw new Error(`Invalid profile name: ${profileName}`);
  }
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isIsoTimestamp = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));

const isOptionalIsoTimestamp = (value: unknown): value is string | null =>
  value === null || isIsoTimestamp(value);

const resolveCurrentTimezone = (): string => {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof timezone === "string" && timezone.length > 0 ? timezone : "UTC";
  } catch {
    return "UTC";
  }
};

const resolveBrowserVersionFromResolvedExecutable = async (): Promise<string | null> => {
  try {
    return (await resolveBrowserVersionTruthSource()).browserVersion;
  } catch {
    return null;
  }
};

const resolveRequiredBrowserVersionFromResolvedExecutable = async (): Promise<string> => {
  const browserVersion = await resolveBrowserVersionTruthSource();
  if (typeof browserVersion.browserVersion !== "string" || browserVersion.browserVersion.length === 0) {
    throw new Error("Browser version truth-source unavailable");
  }
  return browserVersion.browserVersion;
};

const withBrowserVersion = <T extends object>(input: T, browserVersion: string | null): T =>
  ({ ...(input as Record<string, unknown>), browserVersion } as T);

const isLegacyLinuxKernelVersion = (value: string): boolean =>
  LINUX_KERNEL_VERSION_PATTERN.test(value);

const migrateLegacyLinuxKernelBundleOsVersion = (meta: ProfileMeta): ProfileMeta | null => {
  if (!meta.fingerprintProfileBundle) {
    return null;
  }

  const expectedEnvironment = meta.fingerprintProfileBundle.environment;
  if (expectedEnvironment.os_family !== "linux") {
    return null;
  }

  const actualEnvironment = resolveCurrentFingerprintEnvironment();
  if (actualEnvironment.os_family !== "linux") {
    return null;
  }
  if (actualEnvironment.os_version === "unknown") {
    return null;
  }
  if (expectedEnvironment.os_version === actualEnvironment.os_version) {
    return null;
  }
  if (!isLegacyLinuxKernelVersion(expectedEnvironment.os_version)) {
    return null;
  }

  return {
    ...meta,
    fingerprintProfileBundle: {
      ...meta.fingerprintProfileBundle,
      environment: {
        ...expectedEnvironment,
        os_version: actualEnvironment.os_version
      }
    }
  };
};

function assertProfileMeta(value: unknown): asserts value is ProfileMeta {
  if (!isObjectRecord(value)) {
    throw new Error("Invalid profile meta structure: expected object");
  }

  if (!Number.isInteger(value.schemaVersion) || (value.schemaVersion as number) <= 0) {
    throw new Error("Invalid profile meta structure: schemaVersion");
  }
  if (typeof value.profileName !== "string" || value.profileName.length === 0) {
    throw new Error("Invalid profile meta structure: profileName");
  }
  if (typeof value.profileDir !== "string" || value.profileDir.length === 0) {
    throw new Error("Invalid profile meta structure: profileDir");
  }
  if (
    typeof value.profileState !== "string" ||
    !PROFILE_STATES.includes(value.profileState as ProfileState)
  ) {
    throw new Error("Invalid profile meta structure: profileState");
  }
  if (!isIsoTimestamp(value.createdAt) || !isIsoTimestamp(value.updatedAt)) {
    throw new Error("Invalid profile meta structure: createdAt/updatedAt");
  }
  if (
    !isOptionalIsoTimestamp(value.lastStartedAt) ||
    !isOptionalIsoTimestamp(value.lastLoginAt) ||
    !isOptionalIsoTimestamp(value.lastStoppedAt) ||
    !isOptionalIsoTimestamp(value.lastDisconnectedAt)
  ) {
    throw new Error("Invalid profile meta structure: last* timestamps");
  }

  if (value.proxyBinding !== null) {
    if (!isObjectRecord(value.proxyBinding)) {
      throw new Error("Invalid profile meta structure: proxyBinding");
    }
    if (value.proxyBinding.url !== null && typeof value.proxyBinding.url !== "string") {
      throw new Error("Invalid profile meta structure: proxyBinding.url");
    }
    if (!isIsoTimestamp(value.proxyBinding.boundAt)) {
      throw new Error("Invalid profile meta structure: proxyBinding.boundAt");
    }
    if (
      typeof value.proxyBinding.source !== "string" ||
      !PROXY_BINDING_SOURCES.includes(value.proxyBinding.source as (typeof PROXY_BINDING_SOURCES)[number])
    ) {
      throw new Error("Invalid profile meta structure: proxyBinding.source");
    }
  }

  if (!isObjectRecord(value.fingerprintSeeds)) {
    throw new Error("Invalid profile meta structure: fingerprintSeeds");
  }
  if (
    typeof value.fingerprintSeeds.audioNoiseSeed !== "string" ||
    typeof value.fingerprintSeeds.canvasNoiseSeed !== "string"
  ) {
    throw new Error("Invalid profile meta structure: fingerprintSeeds.*");
  }
  if (
    value.fingerprintProfileBundle !== undefined &&
    !isFingerprintProfileBundle(value.fingerprintProfileBundle)
  ) {
    throw new Error("Invalid profile meta structure: fingerprintProfileBundle");
  }

  if (!Array.isArray(value.localStorageSnapshots)) {
    throw new Error("Invalid profile meta structure: localStorageSnapshots");
  }
  for (const snapshot of value.localStorageSnapshots) {
    if (!isObjectRecord(snapshot)) {
      throw new Error("Invalid profile meta structure: localStorageSnapshot");
    }
    if (typeof snapshot.origin !== "string") {
      throw new Error("Invalid profile meta structure: localStorageSnapshot.origin");
    }
    if (!Array.isArray(snapshot.entries)) {
      throw new Error("Invalid profile meta structure: localStorageSnapshot.entries");
    }
    for (const entry of snapshot.entries) {
      if (!isObjectRecord(entry)) {
        throw new Error("Invalid profile meta structure: localStorageSnapshot.entry");
      }
      if (typeof entry.key !== "string" || typeof entry.value !== "string") {
        throw new Error("Invalid profile meta structure: localStorageSnapshot.entry.key/value");
      }
    }
  }
}

const parseMeta = (raw: string): ProfileMeta => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Invalid profile meta structure: invalid JSON");
  }
  assertProfileMeta(parsed);
  return parsed;
};

const buildLegacyBundleMigration = async (input: {
  meta: ProfileMeta;
  browserVersion: string | null;
  timezone: string;
  intent: "transient_backfill" | "persistent_upgrade";
}): Promise<FingerprintProfileBundle> => {
  const browserVersion =
    input.intent === "persistent_upgrade"
      ? await resolveRequiredBrowserVersionFromResolvedExecutable()
      : input.browserVersion;
  return markFingerprintProfileBundleAsLegacyBackfilled(
    withBrowserVersion(
      {
        profileName: input.meta.profileName,
        fingerprintSeeds: input.meta.fingerprintSeeds,
        timezone: input.timezone,
        environment: resolveCurrentFingerprintEnvironment(),
        migratedAt:
          input.intent === "persistent_upgrade" ? new Date().toISOString() : input.meta.updatedAt,
        sourceSchemaVersion: input.meta.schemaVersion,
        reasonCodes: ["LEGACY_PROFILE_BUNDLE_MIGRATED"]
      },
      browserVersion
    )
  );
};

export class ProfileStore {
  private readonly rootDir: string;

  private readonly fs: FileSystemAdapter;

  constructor(rootDir: string, fsAdapter: FileSystemAdapter = DEFAULT_FILE_SYSTEM) {
    this.rootDir = resolve(rootDir);
    this.fs = fsAdapter;
  }

  getProfileDir(profileName: string): string {
    validateProfileName(profileName, this.rootDir);
    return join(this.rootDir, profileName);
  }

  getMetaPath(profileName: string): string {
    return join(this.getProfileDir(profileName), PROFILE_META_FILENAME);
  }

  async ensureProfileDir(profileName: string): Promise<string> {
    const profileDir = this.getProfileDir(profileName);
    await this.fs.mkdir(profileDir, { recursive: true });
    return profileDir;
  }

  async readMeta(profileName: string, options: ReadMetaOptions = {}): Promise<ProfileMeta | null> {
    const metaPath = this.getMetaPath(profileName);
    try {
      const raw = await this.fs.readFile(metaPath, "utf8");
      const parsed = parseMeta(raw);
      if (parsed.fingerprintProfileBundle === undefined) {
        const legacyBackfillMode = options.mode === "migrate" ? "migrate" : "readonly";
        const browserVersion = await resolveBrowserVersionFromResolvedExecutable();
        const migratedMeta: ProfileMeta = {
          ...parsed,
          fingerprintProfileBundle: await buildLegacyBundleMigration({
            meta: parsed,
            browserVersion,
            timezone: legacyBackfillMode === "migrate" ? resolveCurrentTimezone() : "unknown",
            intent:
              legacyBackfillMode === "migrate" ? "persistent_upgrade" : "transient_backfill"
          })
        };
        if (legacyBackfillMode === "migrate") {
          await this.writeMeta(profileName, migratedMeta);
        }
        return migratedMeta;
      }
      const migratedLinuxMeta = migrateLegacyLinuxKernelBundleOsVersion(parsed);
      if (migratedLinuxMeta) {
        if (options.mode !== "readonly") {
          await this.writeMeta(profileName, migratedLinuxMeta);
        }
        return migratedLinuxMeta;
      }
      return parsed;
    } catch (error) {
      const maybeNodeError = error as NodeJS.ErrnoException;
      if (maybeNodeError.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async writeMeta(profileName: string, meta: ProfileMeta): Promise<void> {
    if (meta.profileName !== profileName) {
      throw new Error("Profile name mismatch when writing meta");
    }

    const profileDir = await this.ensureProfileDir(profileName);
    if (meta.profileDir !== profileDir) {
      throw new Error("Profile directory mismatch when writing meta");
    }

    const metaPath = this.getMetaPath(profileName);
    const tempPath = `${metaPath}.tmp`;
    const json = `${JSON.stringify(meta, null, 2)}\n`;
    await this.fs.writeFile(tempPath, json, "utf8");
    await this.fs.rename(tempPath, metaPath);
  }

  async initializeMeta(profileName: string, nowIso: string): Promise<ProfileMeta> {
    const profileDir = await this.ensureProfileDir(profileName);
    const browserVersion = await resolveRequiredBrowserVersionFromResolvedExecutable();
    const timezone = resolveCurrentTimezone();

    const meta: ProfileMeta = {
      schemaVersion: 1,
      profileName,
      profileDir,
      profileState: "uninitialized",
      proxyBinding: null,
      fingerprintSeeds: {
        audioNoiseSeed: `${profileName}-audio-seed`,
        canvasNoiseSeed: `${profileName}-canvas-seed`
      },
      fingerprintProfileBundle: buildFingerprintProfileBundle({
        ...withBrowserVersion(
          {
            profileName,
            fingerprintSeeds: {
              audioNoiseSeed: `${profileName}-audio-seed`,
              canvasNoiseSeed: `${profileName}-canvas-seed`
            },
            timezone,
            environment: resolveCurrentFingerprintEnvironment()
          },
          browserVersion
        )
      }),
      localStorageSnapshots: [],
      createdAt: nowIso,
      updatedAt: nowIso,
      lastStartedAt: null,
      lastLoginAt: null,
      lastStoppedAt: null,
      lastDisconnectedAt: null
    };

    await this.writeMeta(profileName, meta);
    return meta;
  }
}
