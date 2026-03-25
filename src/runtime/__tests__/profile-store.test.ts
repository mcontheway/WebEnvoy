import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProfileStore, PROFILE_META_FILENAME } from "../profile-store.js";
import { buildFingerprintProfileBundle } from "../../../shared/fingerprint-profile.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

const createStore = async () => {
  const root = await mkdtemp(join(tmpdir(), "webenvoy-profile-store-"));
  tempDirs.push(root);
  return new ProfileStore(root);
};

describe("profile-store", () => {
  it("creates profile directory and initializes minimal meta", async () => {
    const store = await createStore();
    const meta = await store.initializeMeta("default", "2026-03-19T10:00:00.000Z");

    expect(meta.profileName).toBe("default");
    expect(meta.profileState).toBe("uninitialized");
    expect(meta.proxyBinding).toBeNull();
    expect(meta.fingerprintSeeds).toMatchObject({
      audioNoiseSeed: "default-audio-seed",
      canvasNoiseSeed: "default-canvas-seed"
    });
    expect(meta.fingerprintProfileBundle).toBeDefined();
    expect(meta.fingerprintProfileBundle?.audioNoiseSeed).toBeTypeOf("number");
    expect(meta.fingerprintProfileBundle?.canvasNoiseSeed).toBeTypeOf("number");
    expect(meta.fingerprintProfileBundle?.environment).toMatchObject({
      os_family: expect.any(String),
      os_version: expect.any(String),
      arch: expect.any(String)
    });
    expect(meta.localStorageSnapshots).toEqual([]);

    const profileDir = store.getProfileDir("default");
    const metaPath = store.getMetaPath("default");
    expect(metaPath).toBe(join(profileDir, PROFILE_META_FILENAME));
  });

  it("reads and writes meta with stable profile identity", async () => {
    const store = await createStore();
    await store.initializeMeta("default", "2026-03-19T10:00:00.000Z");
    const expectedBundle = {
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_0) AppleWebKit/537.36",
      hardwareConcurrency: 8,
      deviceMemory: 8,
      screen: {
        width: 1440,
        height: 900,
        colorDepth: 30,
        pixelDepth: 30
      },
      battery: {
        level: 0.73,
        charging: false
      },
      timezone: "Asia/Shanghai",
      audioNoiseSeed: 0.000047231,
      canvasNoiseSeed: 0.000083154,
      environment: {
        os_family: "macos",
        os_version: "14.6",
        arch: "arm64"
      }
    };

    await store.writeMeta("default", {
      schemaVersion: 1,
      profileName: "default",
      profileDir: store.getProfileDir("default"),
      profileState: "ready",
      proxyBinding: {
        url: "http://127.0.0.1:8080/",
        boundAt: "2026-03-19T10:01:00.000Z",
        source: "runtime.start"
      },
      fingerprintSeeds: {
        audioNoiseSeed: "seed-a-001",
        canvasNoiseSeed: "seed-c-001"
      },
      fingerprintProfileBundle: expectedBundle,
      localStorageSnapshots: [
        {
          origin: "https://example.com",
          entries: [{ key: "session", value: "token" }]
        }
      ],
      createdAt: "2026-03-19T10:00:00.000Z",
      updatedAt: "2026-03-19T10:01:00.000Z",
      lastStartedAt: "2026-03-19T10:01:00.000Z",
      lastLoginAt: null,
      lastStoppedAt: null,
      lastDisconnectedAt: null
    });

    const meta = await store.readMeta("default");
    expect(meta?.profileState).toBe("ready");
    expect(meta?.proxyBinding?.url).toBe("http://127.0.0.1:8080/");
    expect(meta?.fingerprintSeeds.audioNoiseSeed).toBe("seed-a-001");
    expect(meta?.fingerprintProfileBundle).toEqual(expectedBundle);
    expect(meta?.localStorageSnapshots).toHaveLength(1);
  });

  it("keeps legacy meta without bundle field untouched for runtime-level migration handling", async () => {
    const store = await createStore();
    await store.ensureProfileDir("legacy");
    const metaPath = store.getMetaPath("legacy");
    await writeFile(
      metaPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          profileName: "legacy",
          profileDir: store.getProfileDir("legacy"),
          profileState: "ready",
          proxyBinding: null,
          fingerprintSeeds: {
            audioNoiseSeed: "legacy-audio-seed",
            canvasNoiseSeed: "legacy-canvas-seed"
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

    const meta = await store.readMeta("legacy");
    expect(meta).not.toBeNull();
    expect(meta?.fingerprintProfileBundle).toBeUndefined();
  });

  it("returns null when meta does not exist", async () => {
    const store = await createStore();
    const meta = await store.readMeta("missing-profile");
    expect(meta).toBeNull();
  });

  it("rejects malformed meta structure", async () => {
    const store = await createStore();
    await store.ensureProfileDir("broken");
    const metaPath = store.getMetaPath("broken");
    await writeFile(
      metaPath,
      `${JSON.stringify({ profileName: "broken", profileState: "ready" }, null, 2)}\n`,
      "utf8"
    );

    await expect(store.readMeta("broken")).rejects.toThrow(/invalid profile meta structure/i);
  });

  it("rejects invalid profile name", async () => {
    const store = await createStore();
    await expect(store.initializeMeta("../escape", "2026-03-19T10:00:00.000Z")).rejects.toThrow(
      /invalid profile name/i
    );
    await expect(store.initializeMeta(".", "2026-03-19T10:00:00.000Z")).rejects.toThrow(
      /invalid profile name/i
    );
    await expect(store.initializeMeta("..", "2026-03-19T10:00:00.000Z")).rejects.toThrow(
      /invalid profile name/i
    );
  });

  it("normalizes macOS darwin kernel version for bundle environment and default UA", () => {
    const bundle = buildFingerprintProfileBundle({
      profileName: "default",
      fingerprintSeeds: {
        audioNoiseSeed: "default-audio-seed",
        canvasNoiseSeed: "default-canvas-seed"
      },
      environment: {
        os_family: "darwin",
        os_version: "24.4.0",
        arch: "arm64"
      },
      timezone: "Asia/Shanghai"
    });

    expect(bundle.environment).toMatchObject({
      os_family: "macos",
      os_version: "15.0",
      arch: "arm64"
    });
    expect(bundle.ua).toContain("Mac OS X 15_0");
    expect(bundle.ua).not.toContain("Mac OS X 24_4_0");
  });
});
