import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resetIdentityPreflightAdaptersForTests,
  runIdentityPreflight,
  setIdentityPreflightAdaptersForTests
} from "../persistent-extension-identity.js";
import type { ProfileMeta } from "../profile-store.js";

const EXTENSION_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DEFAULT_TIMESTAMP = "2026-03-27T00:00:00.000Z";

const createProfileMeta = (manifestPath: string | null): ProfileMeta => ({
  schemaVersion: 1,
  profileName: "identity-profile",
  profileDir: "/tmp/identity-profile",
  profileState: "uninitialized",
  proxyBinding: null,
  persistentExtensionBinding: {
    extensionId: EXTENSION_ID,
    nativeHostName: "com.webenvoy.host",
    browserChannel: "chrome",
    manifestPath
  },
  fingerprintSeeds: {
    audioNoiseSeed: "audio-seed",
    canvasNoiseSeed: "canvas-seed"
  },
  localStorageSnapshots: [],
  createdAt: DEFAULT_TIMESTAMP,
  updatedAt: DEFAULT_TIMESTAMP,
  lastStartedAt: null,
  lastLoginAt: null,
  lastStoppedAt: null,
  lastDisconnectedAt: null
});

afterEach(() => {
  resetIdentityPreflightAdaptersForTests();
  vi.unstubAllEnvs();
});

describe("runIdentityPreflight", () => {
  it("keeps load-extension mode when launcher can still select Chromium fallback", async () => {
    const resolvePreferredBrowserVersionTruthSource = vi.fn().mockResolvedValue({
      executablePath: "/mock/chromium",
      browserVersion: "Chromium 146.0.0.0"
    });

    setIdentityPreflightAdaptersForTests({
      resolvePreferredBrowserVersionTruthSource,
      isUnsupportedBrandedChromeForExtensions: vi.fn().mockReturnValue(false)
    });

    const result = await runIdentityPreflight({
      params: {},
      meta: null
    });

    expect(resolvePreferredBrowserVersionTruthSource).toHaveBeenCalledTimes(1);
    expect(resolvePreferredBrowserVersionTruthSource).toHaveBeenCalledWith({});
    expect(result).toMatchObject({
      mode: "load_extension",
      browserPath: "/mock/chromium",
      browserVersion: "Chromium 146.0.0.0",
      identityBindingState: "not_applicable",
      blocking: false,
      failureReason: "IDENTITY_PREFLIGHT_NOT_REQUIRED"
    });
  });

  it("reads the Windows native host manifest path from registry when binding omits manifestPath", async () => {
    const manifestDir = await mkdtemp(join(tmpdir(), "webenvoy-native-host-registry-"));
    const manifestPath = join(manifestDir, "com.webenvoy.host.json");
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          name: "com.webenvoy.host",
          allowed_origins: [`chrome-extension://${EXTENSION_ID}/`]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const resolvePreferredBrowserVersionTruthSource = vi.fn().mockResolvedValue({
      executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      browserVersion: "Google Chrome 146.0.7680.154"
    });
    const execFile = vi.fn().mockResolvedValue({
      stdout: [
        "HKEY_CURRENT_USER\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.webenvoy.host",
        `    (Default)    REG_SZ    ${manifestPath}`,
        ""
      ].join("\r\n"),
      stderr: ""
    });

    setIdentityPreflightAdaptersForTests({
      resolvePreferredBrowserVersionTruthSource,
      isUnsupportedBrandedChromeForExtensions: vi.fn().mockReturnValue(true),
      execFile,
      platform: () => "win32"
    });

    const result = await runIdentityPreflight({
      params: {},
      meta: createProfileMeta(null)
    });

    expect(execFile).toHaveBeenCalledWith(
      "reg",
      ["query", "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.webenvoy.host", "/ve"],
      { encoding: "utf8" }
    );
    expect(result).toMatchObject({
      mode: "official_chrome_persistent_extension",
      browserPath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      browserVersion: "Google Chrome 146.0.7680.154",
      identityBindingState: "bound",
      blocking: false,
      failureReason: "BOOTSTRAP_PENDING",
      manifestPath,
      expectedOrigin: `chrome-extension://${EXTENSION_ID}/`,
      allowedOrigins: [`chrome-extension://${EXTENSION_ID}/`]
    });
  });

  it("blocks when binding browser_channel disagrees with the resolved official Chrome channel", async () => {
    const resolvePreferredBrowserVersionTruthSource = vi.fn().mockResolvedValue({
      executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      browserVersion: "Google Chrome 146.0.7680.154"
    });

    setIdentityPreflightAdaptersForTests({
      resolvePreferredBrowserVersionTruthSource,
      isUnsupportedBrandedChromeForExtensions: vi.fn().mockReturnValue(true),
      platform: () => "win32"
    });

    const result = await runIdentityPreflight({
      params: {},
      meta: {
        ...createProfileMeta("C:\\manifest.json"),
        persistentExtensionBinding: {
          extensionId: EXTENSION_ID,
          nativeHostName: "com.webenvoy.host",
          browserChannel: "chromium",
          manifestPath: "C:\\manifest.json"
        }
      }
    });

    expect(result.identityBindingState).toBe("mismatch");
    expect(result.failureReason).toBe("IDENTITY_BINDING_CONFLICT");
  });
});
