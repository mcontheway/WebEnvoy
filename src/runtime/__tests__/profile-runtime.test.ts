import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProfileRuntimeService } from "../profile-runtime.js";
import type { ProfileMeta } from "../profile-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

class FailingWriteProfileStore {
  readonly #rootDir: string;

  constructor(rootDir: string) {
    this.#rootDir = rootDir;
  }

  async ensureProfileDir(profileName: string): Promise<string> {
    const profileDir = this.getProfileDir(profileName);
    await mkdir(profileDir, { recursive: true });
    return profileDir;
  }

  getProfileDir(profileName: string): string {
    return join(this.#rootDir, profileName);
  }

  async readMeta(_profileName: string): Promise<ProfileMeta | null> {
    return null;
  }

  async initializeMeta(profileName: string, nowIso: string): Promise<ProfileMeta> {
    const profileDir = await this.ensureProfileDir(profileName);
    return {
      schemaVersion: 1,
      profileName,
      profileDir,
      profileState: "uninitialized",
      proxyBinding: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastStartedAt: null,
      lastLoginAt: null,
      lastStoppedAt: null,
      lastDisconnectedAt: null
    };
  }

  async writeMeta(_profileName: string, _meta: ProfileMeta): Promise<void> {
    throw new Error("simulated meta write failure");
  }
}

describe("profile-runtime start rollback", () => {
  it("rolls back lock file when meta write fails", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-"));
    tempDirs.push(baseDir);
    const profileRootDir = join(baseDir, ".webenvoy", "profiles");
    const service = new ProfileRuntimeService({
      storeFactory: () => new FailingWriteProfileStore(profileRootDir)
    });

    await expect(
      service.start({
        cwd: baseDir,
        profile: "rollback_profile",
        runId: "run-runtime-test-001",
        params: {}
      })
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_UNAVAILABLE"
    });

    const lockPath = join(profileRootDir, "rollback_profile", "__webenvoy_lock.json");
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});
