import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

const createStoreWithMockedEnvironment = async (environment: {
  os_family: string;
  os_version: string;
  arch: string;
}) => {
  vi.doMock("../fingerprint-runtime.js", () => ({
    resolveCurrentFingerprintEnvironment: () => environment
  }));
  const module = await import("../profile-store.js");
  const rootDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-store-linux-compat-"));
  tempDirs.push(rootDir);
  return new module.ProfileStore(rootDir);
};

const writeMetaWithBundle = async (input: {
  store: {
    ensureProfileDir(profileName: string): Promise<string>;
    getMetaPath(profileName: string): string;
    getProfileDir(profileName: string): string;
  };
  profileName: string;
  osFamily: string;
  osVersion: string;
}) => {
  await input.store.ensureProfileDir(input.profileName);
  await writeFile(
    input.store.getMetaPath(input.profileName),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        profileName: input.profileName,
        profileDir: input.store.getProfileDir(input.profileName),
        profileState: "ready",
        proxyBinding: null,
        fingerprintSeeds: {
          audioNoiseSeed: `${input.profileName}-audio-seed`,
          canvasNoiseSeed: `${input.profileName}-canvas-seed`
        },
        fingerprintProfileBundle: {
          ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
          hardwareConcurrency: 8,
          deviceMemory: 8,
          screen: {
            width: 1440,
            height: 900,
            colorDepth: 24,
            pixelDepth: 24
          },
          battery: {
            level: 0.73,
            charging: false
          },
          timezone: "UTC",
          audioNoiseSeed: 0.000047231,
          canvasNoiseSeed: 0.000083154,
          environment: {
            os_family: input.osFamily,
            os_version: input.osVersion,
            arch: "x64"
          }
        },
        localStorageSnapshots: [],
        createdAt: "2026-03-19T10:00:00.000Z",
        updatedAt: "2026-03-19T10:01:00.000Z",
        lastStartedAt: "2026-03-19T10:01:00.000Z",
        lastLoginAt: null,
        lastStoppedAt: null,
        lastDisconnectedAt: null
      },
      null,
      2
    )}\n`,
    "utf8"
  );
};

afterEach(async () => {
  vi.resetModules();
  vi.doUnmock("../fingerprint-runtime.js");
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("profile-store linux legacy os_version compatibility", () => {
  it("returns migrated Linux os_version in readonly mode without persisting", async () => {
    const store = await createStoreWithMockedEnvironment({
      os_family: "linux",
      os_version: "24.04",
      arch: "x64"
    });
    await writeMetaWithBundle({
      store,
      profileName: "legacy-linux-readonly",
      osFamily: "linux",
      osVersion: "6.8.0-55-generic"
    });

    const meta = await store.readMeta("legacy-linux-readonly", { mode: "readonly" });
    expect(meta?.fingerprintProfileBundle?.environment.os_version).toBe("24.04");

    const persistedRaw = await readFile(store.getMetaPath("legacy-linux-readonly"), "utf8");
    const persisted = JSON.parse(persistedRaw) as {
      fingerprintProfileBundle?: { environment?: { os_version?: string } };
    };
    expect(persisted.fingerprintProfileBundle?.environment?.os_version).toBe("6.8.0-55-generic");
  });

  it("persists Linux os_version migration in default mode", async () => {
    const store = await createStoreWithMockedEnvironment({
      os_family: "linux",
      os_version: "24.04",
      arch: "x64"
    });
    await writeMetaWithBundle({
      store,
      profileName: "legacy-linux-migrate",
      osFamily: "linux",
      osVersion: "6.8.0-55-generic"
    });

    const meta = await store.readMeta("legacy-linux-migrate");
    expect(meta?.fingerprintProfileBundle?.environment.os_version).toBe("24.04");

    const persistedRaw = await readFile(store.getMetaPath("legacy-linux-migrate"), "utf8");
    const persisted = JSON.parse(persistedRaw) as {
      fingerprintProfileBundle?: { environment?: { os_version?: string } };
    };
    expect(persisted.fingerprintProfileBundle?.environment?.os_version).toBe("24.04");
  });

  it("does not relax non-Linux bundle os_version", async () => {
    const store = await createStoreWithMockedEnvironment({
      os_family: "macos",
      os_version: "15.0",
      arch: "arm64"
    });
    await writeMetaWithBundle({
      store,
      profileName: "non-linux-unchanged",
      osFamily: "macos",
      osVersion: "24.4.0"
    });

    const meta = await store.readMeta("non-linux-unchanged");
    expect(meta?.fingerprintProfileBundle?.environment.os_version).toBe("24.4.0");

    const persistedRaw = await readFile(store.getMetaPath("non-linux-unchanged"), "utf8");
    const persisted = JSON.parse(persistedRaw) as {
      fingerprintProfileBundle?: { environment?: { os_version?: string } };
    };
    expect(persisted.fingerprintProfileBundle?.environment?.os_version).toBe("24.4.0");
  });
});
