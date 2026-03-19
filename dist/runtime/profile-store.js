import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
export const PROFILE_META_FILENAME = "__webenvoy_meta.json";
const DEFAULT_FILE_SYSTEM = {
    mkdir,
    readFile,
    writeFile,
    rename
};
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const validateProfileName = (profileName, rootDir) => {
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
const parseMeta = (raw) => JSON.parse(raw);
export class ProfileStore {
    rootDir;
    fs;
    constructor(rootDir, fsAdapter = DEFAULT_FILE_SYSTEM) {
        this.rootDir = resolve(rootDir);
        this.fs = fsAdapter;
    }
    getProfileDir(profileName) {
        validateProfileName(profileName, this.rootDir);
        return join(this.rootDir, profileName);
    }
    getMetaPath(profileName) {
        return join(this.getProfileDir(profileName), PROFILE_META_FILENAME);
    }
    async ensureProfileDir(profileName) {
        const profileDir = this.getProfileDir(profileName);
        await this.fs.mkdir(profileDir, { recursive: true });
        return profileDir;
    }
    async readMeta(profileName) {
        const metaPath = this.getMetaPath(profileName);
        try {
            const raw = await this.fs.readFile(metaPath, "utf8");
            return parseMeta(raw);
        }
        catch (error) {
            const maybeNodeError = error;
            if (maybeNodeError.code === "ENOENT") {
                return null;
            }
            throw error;
        }
    }
    async writeMeta(profileName, meta) {
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
    async initializeMeta(profileName, nowIso) {
        const profileDir = await this.ensureProfileDir(profileName);
        const meta = {
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
