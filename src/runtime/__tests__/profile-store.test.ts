import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProfileStore, PROFILE_META_FILENAME } from "../profile-store.js";

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
    expect(meta.localStorageSnapshots).toEqual([]);

    const profileDir = store.getProfileDir("default");
    const metaPath = store.getMetaPath("default");
    expect(metaPath).toBe(join(profileDir, PROFILE_META_FILENAME));
  });

  it("reads and writes meta with stable profile identity", async () => {
    const store = await createStore();
    await store.initializeMeta("default", "2026-03-19T10:00:00.000Z");

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
    expect(meta?.localStorageSnapshots).toHaveLength(1);
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
});
