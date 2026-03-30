import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProfileStore, PROFILE_META_FILENAME } from "../profile-store.js";
import {
  buildFingerprintProfileBundle,
  buildFingerprintRuntimeContext
} from "../../../shared/fingerprint-profile.js";

const tempDirs: string[] = [];
let browserPathBeforeTest: string | undefined;
let browserVersionBeforeTest: string | undefined;

const resolveCurrentTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

beforeEach(() => {
  browserPathBeforeTest = process.env.WEBENVOY_BROWSER_PATH;
  browserVersionBeforeTest = process.env.WEBENVOY_BROWSER_VERSION;
});

afterEach(async () => {
  if (browserPathBeforeTest === undefined) {
    delete process.env.WEBENVOY_BROWSER_PATH;
  } else {
    process.env.WEBENVOY_BROWSER_PATH = browserPathBeforeTest;
  }
  if (browserVersionBeforeTest === undefined) {
    delete process.env.WEBENVOY_BROWSER_VERSION;
  } else {
    process.env.WEBENVOY_BROWSER_VERSION = browserVersionBeforeTest;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

const createMockBrowserExecutable = async (
  versionOutput: string = "Chromium 146.0.0.0"
): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "webenvoy-profile-store-browser-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "mock-browser.mjs");
  await writeFile(
    scriptPath,
    `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  console.log(${JSON.stringify(versionOutput)});
  process.exit(0);
}
setInterval(() => {}, 1000);
`,
    "utf8"
  );
  await chmod(scriptPath, 0o755);
  return scriptPath;
};

const createStore = async () => {
  const root = await mkdtemp(join(tmpdir(), "webenvoy-profile-store-"));
  tempDirs.push(root);
  return new ProfileStore(root);
};

describe("profile-store", () => {
  it("creates profile directory and initializes minimal meta", async () => {
    const browserPath = await createMockBrowserExecutable("Chromium 146.0.0.0");
    process.env.WEBENVOY_BROWSER_PATH = browserPath;
    process.env.WEBENVOY_BROWSER_VERSION = "Chromium 9.9.9.9";

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
    expect(meta.fingerprintProfileBundle?.timezone).toBe(resolveCurrentTimezone());
    expect(meta.fingerprintProfileBundle?.ua).toContain("Chrome/146.0.0.0");
    expect(meta.fingerprintProfileBundle?.ua).not.toContain("Chrome/9.9.9.9");
    expect(meta.localStorageSnapshots).toEqual([]);

    const profileDir = store.getProfileDir("default");
    const metaPath = store.getMetaPath("default");
    expect(metaPath).toBe(join(profileDir, PROFILE_META_FILENAME));
  });

  it("does not persist fingerprint bundle when browser truth-source is unavailable during initialize", async () => {
    const unsupportedChromePath = await createMockBrowserExecutable("Google Chrome 137.0.0.0");
    process.env.WEBENVOY_BROWSER_PATH = unsupportedChromePath;
    delete process.env.WEBENVOY_BROWSER_VERSION;

    const store = await createStore();

    await expect(
      store.initializeMeta("missing-browser", "2026-03-19T10:00:00.000Z")
    ).rejects.toThrow(/browser/i);

    await expect(readFile(store.getMetaPath("missing-browser"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("reads and writes meta with stable profile identity", async () => {
    const browserPath = await createMockBrowserExecutable("Chromium 146.0.0.0");
    process.env.WEBENVOY_BROWSER_PATH = browserPath;
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
      persistentExtensionBinding: {
        extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        nativeHostName: "com.webenvoy.host",
        browserChannel: "chrome",
        manifestPath: "/tmp/native-host.json"
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
    expect(meta?.persistentExtensionBinding).toMatchObject({
      extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      nativeHostName: "com.webenvoy.host",
      browserChannel: "chrome",
      manifestPath: "/tmp/native-host.json"
    });
    expect(meta?.fingerprintSeeds.audioNoiseSeed).toBe("seed-a-001");
    expect(meta?.fingerprintProfileBundle).toEqual(expectedBundle);
    expect(meta?.localStorageSnapshots).toHaveLength(1);
  });

  it("reads legacy meta without bundle field as transient backfill by default", async () => {
    const browserPath = await createMockBrowserExecutable("Chromium 146.0.0.0");
    process.env.WEBENVOY_BROWSER_PATH = browserPath;
    process.env.WEBENVOY_BROWSER_VERSION = "Chromium 9.9.9.9";

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
    expect(meta?.fingerprintProfileBundle).toMatchObject({
      ua: expect.stringContaining("Chrome/146.0.0.0"),
      environment: {
        os_family: expect.any(String),
        os_version: expect.any(String),
        arch: expect.any(String)
      },
      timezone: "unknown",
      legacy_migration: {
        status: "backfilled_from_legacy",
        source_schema_version: 1,
        reason_codes: ["LEGACY_PROFILE_BUNDLE_MIGRATED"]
      }
    });
    expect(meta?.fingerprintProfileBundle?.ua).not.toContain("Chrome/9.9.9.9");
    expect(meta?.fingerprintProfileBundle?.timezone).not.toBe(resolveCurrentTimezone());

    const persistedRaw = await readFile(metaPath, "utf8");
    const persistedMeta = JSON.parse(persistedRaw) as {
      fingerprintProfileBundle?: {
        legacy_migration?: Record<string, unknown>;
      };
    };
    expect(persistedMeta.fingerprintProfileBundle).toBeUndefined();
  });

  it("reads legacy meta in readonly mode without persisting backfill", async () => {
    const browserPath = await createMockBrowserExecutable("Chromium 146.0.0.0");
    process.env.WEBENVOY_BROWSER_PATH = browserPath;

    const store = await createStore();
    await store.ensureProfileDir("legacy-readonly");
    const metaPath = store.getMetaPath("legacy-readonly");
    await writeFile(
      metaPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          profileName: "legacy-readonly",
          profileDir: store.getProfileDir("legacy-readonly"),
          profileState: "stopped",
          proxyBinding: null,
          fingerprintSeeds: {
            audioNoiseSeed: "legacy-audio-seed",
            canvasNoiseSeed: "legacy-canvas-seed"
          },
          localStorageSnapshots: [],
          createdAt: "2026-03-19T10:00:00.000Z",
          updatedAt: "2026-03-19T10:01:00.000Z",
          lastStartedAt: null,
          lastLoginAt: null,
          lastStoppedAt: "2026-03-19T10:01:00.000Z",
          lastDisconnectedAt: null
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const meta = await store.readMeta("legacy-readonly", { mode: "readonly" });
    expect(meta?.fingerprintProfileBundle?.legacy_migration).toMatchObject({
      status: "backfilled_from_legacy",
      reason_codes: ["LEGACY_PROFILE_BUNDLE_MIGRATED"]
    });

    const persistedRaw = await readFile(metaPath, "utf8");
    const persistedMeta = JSON.parse(persistedRaw) as { fingerprintProfileBundle?: unknown };
    expect(persistedMeta.fingerprintProfileBundle).toBeUndefined();
  });

  it("persists upgraded bundle when legacy meta is read in migrate mode", async () => {
    const browserPath = await createMockBrowserExecutable("Chromium 146.0.0.0");
    process.env.WEBENVOY_BROWSER_PATH = browserPath;

    const store = await createStore();
    await store.ensureProfileDir("legacy-migrate");
    const metaPath = store.getMetaPath("legacy-migrate");
    await writeFile(
      metaPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          profileName: "legacy-migrate",
          profileDir: store.getProfileDir("legacy-migrate"),
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

    const meta = await store.readMeta("legacy-migrate", { mode: "migrate" });
    expect(meta?.fingerprintProfileBundle?.legacy_migration).toMatchObject({
      status: "backfilled_from_legacy",
      reason_codes: ["LEGACY_PROFILE_BUNDLE_MIGRATED"]
    });
    expect(meta?.fingerprintProfileBundle?.timezone).toBe(resolveCurrentTimezone());
    expect(meta?.fingerprintProfileBundle?.ua).toContain("Chrome/146.0.0.0");

    const persistedRaw = await readFile(metaPath, "utf8");
    const persistedMeta = JSON.parse(persistedRaw) as {
      fingerprintProfileBundle?: {
        legacy_migration?: Record<string, unknown>;
        timezone?: string;
        ua?: string;
      };
    };
    expect(persistedMeta.fingerprintProfileBundle?.legacy_migration).toMatchObject({
      status: "backfilled_from_legacy",
      reason_codes: ["LEGACY_PROFILE_BUNDLE_MIGRATED"]
    });
    expect(persistedMeta.fingerprintProfileBundle?.timezone).toBe(resolveCurrentTimezone());
    expect(persistedMeta.fingerprintProfileBundle?.ua).toContain("Chrome/146.0.0.0");
  });

  it("does not persist upgraded legacy bundle when browser truth-source is unavailable in migrate mode", async () => {
    const unsupportedChromePath = await createMockBrowserExecutable("Google Chrome 137.0.0.0");
    process.env.WEBENVOY_BROWSER_PATH = unsupportedChromePath;
    delete process.env.WEBENVOY_BROWSER_VERSION;

    const store = await createStore();
    await store.ensureProfileDir("legacy-migrate-no-browser");
    const metaPath = store.getMetaPath("legacy-migrate-no-browser");
    await writeFile(
      metaPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          profileName: "legacy-migrate-no-browser",
          profileDir: store.getProfileDir("legacy-migrate-no-browser"),
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

    await expect(store.readMeta("legacy-migrate-no-browser", { mode: "migrate" })).rejects.toThrow(
      /browser/i
    );

    const persistedRaw = await readFile(metaPath, "utf8");
    const persistedMeta = JSON.parse(persistedRaw) as { fingerprintProfileBundle?: unknown };
    expect(persistedMeta.fingerprintProfileBundle).toBeUndefined();
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

  it("rejects invalid persistentExtensionBinding.nativeHostName format", async () => {
    const store = await createStore();
    await store.ensureProfileDir("broken_binding");
    const metaPath = store.getMetaPath("broken_binding");
    await writeFile(
      metaPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          profileName: "broken_binding",
          profileDir: store.getProfileDir("broken_binding"),
          profileState: "stopped",
          proxyBinding: null,
          persistentExtensionBinding: {
            extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            nativeHostName: "com..invalid",
            browserChannel: "chrome",
            manifestPath: "/tmp/native-host.json"
          },
          fingerprintSeeds: {
            audioNoiseSeed: "seed-a-001",
            canvasNoiseSeed: "seed-c-001"
          },
          localStorageSnapshots: [],
          createdAt: "2026-03-19T10:00:00.000Z",
          updatedAt: "2026-03-19T10:01:00.000Z",
          lastStartedAt: null,
          lastLoginAt: null,
          lastStoppedAt: "2026-03-19T10:01:00.000Z",
          lastDisconnectedAt: null
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await expect(store.readMeta("broken_binding")).rejects.toThrow(
      /persistentExtensionBinding\.nativeHostName/i
    );
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

  it("keeps Chromium-compatible Intel Mac UA token on macOS even when profile arch is arm64", () => {
    const bundle = buildFingerprintProfileBundle({
      profileName: "default",
      fingerprintSeeds: {
        audioNoiseSeed: "default-audio-seed",
        canvasNoiseSeed: "default-canvas-seed"
      },
      environment: {
        os_family: "macos",
        os_version: "15.0",
        arch: "arm64"
      },
      timezone: "Asia/Shanghai"
    });

    expect(bundle.ua).toContain("Macintosh; Intel Mac OS X");
    expect(bundle.ua).not.toContain("Macintosh; ARM Mac OS X");
  });

  it("uses arm64 architecture token for Linux default UA when profile arch is arm64", () => {
    const bundle = buildFingerprintProfileBundle({
      profileName: "default",
      fingerprintSeeds: {
        audioNoiseSeed: "default-audio-seed",
        canvasNoiseSeed: "default-canvas-seed"
      },
      environment: {
        os_family: "linux",
        os_version: "6.8.0",
        arch: "arm64"
      },
      timezone: "Asia/Shanghai"
    });

    expect(bundle.ua).toContain("X11; Linux arm64");
    expect(bundle.ua).not.toContain("Linux x86_64");
  });

  it("keeps linux legacy kernel-version bundle live-compatible after distro-version truth source switch", () => {
    const existingBundle = buildFingerprintProfileBundle({
      profileName: "linux-profile",
      fingerprintSeeds: {
        audioNoiseSeed: "linux-audio-seed",
        canvasNoiseSeed: "linux-canvas-seed"
      },
      environment: {
        os_family: "linux",
        os_version: "6.8.0-55-generic",
        arch: "x64"
      },
      timezone: "Asia/Shanghai",
      browserVersion: "Chromium 146.0.0.0"
    });

    const runtime = buildFingerprintRuntimeContext({
      profile: "linux-profile",
      metaPresent: true,
      fingerprintSeeds: {
        audioNoiseSeed: "linux-audio-seed",
        canvasNoiseSeed: "linux-canvas-seed"
      },
      existingBundle,
      actualEnvironment: {
        os_family: "linux",
        os_version: "24.04",
        arch: "x64"
      },
      requestedExecutionMode: "live_read_limited",
      timezone: "Asia/Shanghai"
    });

    expect(runtime.fingerprint_profile_bundle.environment).toMatchObject({
      os_family: "linux",
      os_version: "24.04",
      arch: "x64"
    });
    expect(runtime.fingerprint_consistency_check.reason_codes).not.toContain("OS_VERSION_MISMATCH");
    expect(runtime.execution.live_allowed).toBe(true);
  });
});
