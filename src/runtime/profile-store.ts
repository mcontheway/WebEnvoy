import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import type { ProfileState } from "./profile-state.js";
import type { ProxyBinding } from "./proxy-binding.js";

export const PROFILE_META_FILENAME = "__webenvoy_meta.json";

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

const parseMeta = (raw: string): ProfileMeta => JSON.parse(raw) as ProfileMeta;

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

  async readMeta(profileName: string): Promise<ProfileMeta | null> {
    const metaPath = this.getMetaPath(profileName);
    try {
      const raw = await this.fs.readFile(metaPath, "utf8");
      return parseMeta(raw);
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
