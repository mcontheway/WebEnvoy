import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resetIdentityPreflightAdaptersForTests,
  runIdentityPreflight,
  setIdentityPreflightAdaptersForTests
} from "../persistent-extension-identity.js";
import type { ProfileMeta } from "../profile-store.js";

const EXTENSION_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DEFAULT_TIMESTAMP = "2026-03-27T00:00:00.000Z";

const createProfileMeta = (
  profileDir: string,
  overrides: Partial<Pick<ProfileMeta, "persistentExtensionBinding">> = {}
): ProfileMeta => ({
  schemaVersion: 1,
  profileName: "identity-profile",
  profileDir,
  profileState: "uninitialized",
  proxyBinding: null,
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
  lastDisconnectedAt: null,
  ...overrides
});

const writeProfileExtensionPreferences = async (input: {
  profileDir: string;
  extensionId: string;
  state?: 0 | 1;
  location?: number;
  extensionPath?: string;
}): Promise<void> => {
  const defaultDir = join(input.profileDir, "Default");
  await mkdir(defaultDir, { recursive: true });
  await writeFile(
    join(defaultDir, "Preferences"),
    `${JSON.stringify(
      {
        extensions: {
          settings: {
            [input.extensionId]: {
              ...(input.state === undefined ? {} : { state: input.state }),
              ...(input.location === undefined ? {} : { location: input.location }),
              ...(input.extensionPath === undefined ? {} : { path: input.extensionPath })
            }
          }
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
};

const writeInstalledProfileExtension = async (input: {
  profileDir: string;
  extensionId: string;
}): Promise<void> => {
  const extensionDir = join(input.profileDir, "Default", "Extensions", input.extensionId, "1.0.0");
  await mkdir(extensionDir, { recursive: true });
  await writeFile(join(extensionDir, "manifest.json"), "{\n  \"manifest_version\": 3\n}\n", "utf8");
};

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
    const profileDir = await mkdtemp(join(tmpdir(), "webenvoy-native-host-profile-"));
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
    await writeProfileExtensionPreferences({
      profileDir,
      extensionId: EXTENSION_ID,
      state: 1
    });
    await writeInstalledProfileExtension({
      profileDir,
      extensionId: EXTENSION_ID
    });

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
      params: {
        persistent_extension_identity: {
          extension_id: EXTENSION_ID
        }
      },
      meta: createProfileMeta(profileDir),
      profileDir
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
      failureReason: "IDENTITY_PREFLIGHT_PASSED",
      manifestPath,
      expectedOrigin: `chrome-extension://${EXTENSION_ID}/`,
      allowedOrigins: [`chrome-extension://${EXTENSION_ID}/`]
    });
  });

  it("blocks when binding browser_channel disagrees with the resolved official Chrome channel", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "webenvoy-native-host-profile-channel-"));
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
      params: {
        persistent_extension_identity: {
          extension_id: EXTENSION_ID,
          browser_channel: "chromium",
          manifest_path: "C:\\manifest.json"
        }
      },
      meta: createProfileMeta(profileDir),
      profileDir
    });

    expect(result.identityBindingState).toBe("mismatch");
    expect(result.failureReason).toBe("IDENTITY_BINDING_CONFLICT");
  });

  it("rejects invalid native_host_name from params", async () => {
    setIdentityPreflightAdaptersForTests({
      resolvePreferredBrowserVersionTruthSource: vi.fn().mockResolvedValue({
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        browserVersion: "Google Chrome 146.0.7680.154"
      }),
      isUnsupportedBrandedChromeForExtensions: vi.fn().mockReturnValue(true),
      platform: () => "darwin"
    });

    await expect(
      runIdentityPreflight({
        params: {
          persistent_extension_identity: {
            extension_id: EXTENSION_ID,
            native_host_name: "Com.WebEnvoy.Host"
          }
        },
        meta: null
      })
    ).rejects.toMatchObject({
      code: "ERR_PROFILE_INVALID",
      details: {
        stage: "input_validation",
        reason: "IDENTITY_BINDING_INVALID_NATIVE_HOST_NAME"
      }
    });
  });

  it("returns missing when manifest is valid but profile extension files are absent", async () => {
    const manifestDir = await mkdtemp(join(tmpdir(), "webenvoy-native-host-manifest-absent-"));
    const profileDir = await mkdtemp(join(tmpdir(), "webenvoy-native-host-profile-absent-"));
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
    await writeProfileExtensionPreferences({
      profileDir,
      extensionId: EXTENSION_ID,
      state: 1
    });

    setIdentityPreflightAdaptersForTests({
      resolvePreferredBrowserVersionTruthSource: vi.fn().mockResolvedValue({
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        browserVersion: "Google Chrome 146.0.7680.154"
      }),
      isUnsupportedBrandedChromeForExtensions: vi.fn().mockReturnValue(true),
      platform: () => "darwin"
    });

    const result = await runIdentityPreflight({
      params: {
        persistent_extension_identity: {
          extension_id: EXTENSION_ID,
          manifest_path: manifestPath
        }
      },
      meta: createProfileMeta(profileDir),
      profileDir
    });

    expect(result.identityBindingState).toBe("missing");
    expect(result.failureReason).toBe("IDENTITY_BINDING_MISSING");
    expect(result.blocking).toBe(true);
  });

  it("returns missing when profile extension is disabled", async () => {
    const manifestDir = await mkdtemp(join(tmpdir(), "webenvoy-native-host-manifest-disabled-"));
    const profileDir = await mkdtemp(join(tmpdir(), "webenvoy-native-host-profile-disabled-"));
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
    await writeProfileExtensionPreferences({
      profileDir,
      extensionId: EXTENSION_ID,
      state: 0
    });
    await writeInstalledProfileExtension({
      profileDir,
      extensionId: EXTENSION_ID
    });

    setIdentityPreflightAdaptersForTests({
      resolvePreferredBrowserVersionTruthSource: vi.fn().mockResolvedValue({
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        browserVersion: "Google Chrome 146.0.7680.154"
      }),
      isUnsupportedBrandedChromeForExtensions: vi.fn().mockReturnValue(true),
      platform: () => "darwin"
    });

    const result = await runIdentityPreflight({
      params: {
        persistent_extension_identity: {
          extension_id: EXTENSION_ID,
          manifest_path: manifestPath
        }
      },
      meta: createProfileMeta(profileDir),
      profileDir
    });

    expect(result.identityBindingState).toBe("missing");
    expect(result.failureReason).toBe("IDENTITY_BINDING_MISSING");
    expect(result.blocking).toBe(true);
  });

  it("returns missing for a fresh profile when params provide binding but the extension is not installed", async () => {
    const manifestDir = await mkdtemp(join(tmpdir(), "webenvoy-native-host-manifest-fresh-"));
    const profileDir = await mkdtemp(join(tmpdir(), "webenvoy-native-host-profile-fresh-"));
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

    setIdentityPreflightAdaptersForTests({
      resolvePreferredBrowserVersionTruthSource: vi.fn().mockResolvedValue({
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        browserVersion: "Google Chrome 146.0.7680.154"
      }),
      isUnsupportedBrandedChromeForExtensions: vi.fn().mockReturnValue(true),
      platform: () => "darwin"
    });

    const result = await runIdentityPreflight({
      params: {
        persistent_extension_identity: {
          extension_id: EXTENSION_ID,
          manifest_path: manifestPath
        }
      },
      meta: null,
      profileDir
    });

    expect(result.identityBindingState).toBe("missing");
    expect(result.failureReason).toBe("IDENTITY_BINDING_MISSING");
    expect(result.blocking).toBe(true);
  });

  it("resolves the native host manifest from browser channel defaults when binding omits manifestPath", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "webenvoy-native-host-profile-scoped-"));
    const fakeHome = await mkdtemp(join(tmpdir(), "webenvoy-native-host-home-"));
    const manifestPath = join(
      fakeHome,
      "Library",
      "Application Support",
      "Google",
      "Chrome",
      "NativeMessagingHosts",
      "com.webenvoy.host.json"
    );
    vi.stubEnv("HOME", fakeHome);
    await mkdir(dirname(manifestPath), { recursive: true });
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
    await writeProfileExtensionPreferences({
      profileDir,
      extensionId: EXTENSION_ID,
      state: 1
    });
    await writeInstalledProfileExtension({
      profileDir,
      extensionId: EXTENSION_ID
    });

    setIdentityPreflightAdaptersForTests({
      resolvePreferredBrowserVersionTruthSource: vi.fn().mockResolvedValue({
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        browserVersion: "Google Chrome 146.0.7680.154"
      }),
      isUnsupportedBrandedChromeForExtensions: vi.fn().mockReturnValue(true),
      platform: () => "darwin"
    });

    const result = await runIdentityPreflight({
      params: {
        persistent_extension_identity: {
          extension_id: EXTENSION_ID
        }
      },
      meta: createProfileMeta(profileDir),
      profileDir
    });

    expect(result).toMatchObject({
      identityBindingState: "bound",
      failureReason: "IDENTITY_PREFLIGHT_PASSED",
      manifestPath,
      expectedOrigin: `chrome-extension://${EXTENSION_ID}/`,
      allowedOrigins: [`chrome-extension://${EXTENSION_ID}/`]
    });
    expect(result.manifestPath?.startsWith(profileDir)).toBe(false);
  });

  it("treats developer-mode unpacked extension path as enabled when profile Extensions dir is absent", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "webenvoy-native-host-profile-unpacked-"));
    const fakeHome = await mkdtemp(join(tmpdir(), "webenvoy-native-host-home-unpacked-"));
    const manifestPath = join(
      fakeHome,
      "Library",
      "Application Support",
      "Google",
      "Chrome",
      "NativeMessagingHosts",
      "com.webenvoy.host.json"
    );
    const unpackedDir = await mkdtemp(join(tmpdir(), "webenvoy-unpacked-extension-"));
    vi.stubEnv("HOME", fakeHome);
    await mkdir(dirname(manifestPath), { recursive: true });
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
    await writeProfileExtensionPreferences({
      profileDir,
      extensionId: EXTENSION_ID,
      location: 4,
      extensionPath: unpackedDir
    });

    setIdentityPreflightAdaptersForTests({
      resolvePreferredBrowserVersionTruthSource: vi.fn().mockResolvedValue({
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        browserVersion: "Google Chrome 146.0.7680.154"
      }),
      isUnsupportedBrandedChromeForExtensions: vi.fn().mockReturnValue(true),
      platform: () => "darwin"
    });

    const result = await runIdentityPreflight({
      params: {
        persistent_extension_identity: {
          extension_id: EXTENSION_ID
        }
      },
      meta: createProfileMeta(profileDir),
      profileDir
    });

    expect(result).toMatchObject({
      identityBindingState: "bound",
      failureReason: "IDENTITY_PREFLIGHT_PASSED",
      manifestPath
    });
  });

  it("falls back to persistent binding from profile meta when params omit identity", async () => {
    const manifestDir = await mkdtemp(join(tmpdir(), "webenvoy-native-host-manifest-meta-"));
    const profileDir = await mkdtemp(join(tmpdir(), "webenvoy-native-host-profile-meta-"));
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
    await writeProfileExtensionPreferences({
      profileDir,
      extensionId: EXTENSION_ID,
      state: 1
    });
    await writeInstalledProfileExtension({
      profileDir,
      extensionId: EXTENSION_ID
    });

    setIdentityPreflightAdaptersForTests({
      resolvePreferredBrowserVersionTruthSource: vi.fn().mockResolvedValue({
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        browserVersion: "Google Chrome 146.0.7680.154"
      }),
      isUnsupportedBrandedChromeForExtensions: vi.fn().mockReturnValue(true),
      platform: () => "darwin"
    });

    const result = await runIdentityPreflight({
      params: {},
      meta: createProfileMeta(profileDir, {
        persistentExtensionBinding: {
          extensionId: EXTENSION_ID,
          nativeHostName: "com.webenvoy.host",
          browserChannel: "chrome",
          manifestPath
        }
      }),
      profileDir
    });

    expect(result).toMatchObject({
      mode: "official_chrome_persistent_extension",
      identityBindingState: "bound",
      binding: {
        extensionId: EXTENSION_ID,
        nativeHostName: "com.webenvoy.host",
        browserChannel: "chrome",
        manifestPath
      },
      manifestPath,
      failureReason: "IDENTITY_PREFLIGHT_PASSED",
      blocking: false
    });
  });

  it("rejects invalid nativeHostName when reading binding from profile meta", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "webenvoy-native-host-profile-invalid-meta-"));
    setIdentityPreflightAdaptersForTests({
      resolvePreferredBrowserVersionTruthSource: vi.fn().mockResolvedValue({
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        browserVersion: "Google Chrome 146.0.7680.154"
      }),
      isUnsupportedBrandedChromeForExtensions: vi.fn().mockReturnValue(true),
      platform: () => "darwin"
    });

    await expect(
      runIdentityPreflight({
        params: {},
        meta: createProfileMeta(profileDir, {
          persistentExtensionBinding: {
            extensionId: EXTENSION_ID,
            nativeHostName: "com..invalid",
            browserChannel: "chrome",
            manifestPath: "/tmp/native-host.json"
          }
        }),
        profileDir
      })
    ).rejects.toMatchObject({
      code: "ERR_PROFILE_INVALID",
      details: {
        stage: "input_validation",
        reason: "IDENTITY_BINDING_INVALID_NATIVE_HOST_NAME"
      }
    });
  });
});
