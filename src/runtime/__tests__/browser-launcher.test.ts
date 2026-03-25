import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  BROWSER_CONTROL_FILENAME,
  EXTENSION_BOOTSTRAP_FILENAME,
  EXTENSION_BOOTSTRAP_SCRIPT_FILENAME,
  EXTENSION_STAGING_DIRNAME,
  BROWSER_STATE_FILENAME,
  BrowserLaunchError,
  launchBrowser,
  resolveBrowserVersionOutputForFingerprint,
  shutdownBrowserSession
} from "../browser-launcher.js";

const tempDirs: string[] = [];

const originalBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
const originalBrowserMockLog = process.env.WEBENVOY_BROWSER_MOCK_LOG;
const originalBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
const originalRealChromeBin = process.env.WEBENVOY_REAL_CHROME_BIN;
const originalRealBrowserPath = process.env.WEBENVOY_REAL_BROWSER_PATH;
const originalBrowserVersion = process.env.WEBENVOY_BROWSER_VERSION;

const restoreEnv = (
  key:
    | "WEBENVOY_BROWSER_PATH"
    | "WEBENVOY_BROWSER_MOCK_LOG"
    | "WEBENVOY_BROWSER_MOCK_VERSION"
    | "WEBENVOY_REAL_CHROME_BIN"
    | "WEBENVOY_REAL_BROWSER_PATH"
    | "WEBENVOY_BROWSER_VERSION",
  value: string | undefined
): void => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
};

const createMockBrowserExecutable = async (): Promise<{ scriptPath: string; logPath: string }> => {
  const dir = await mkdtemp(join(tmpdir(), "webenvoy-browser-launcher-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "mock-browser.mjs");
  const logPath = join(dir, "launch.log");
  await writeFile(
    scriptPath,
    `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
const logPath = process.env.WEBENVOY_BROWSER_MOCK_LOG;
const versionOutput = process.env.WEBENVOY_BROWSER_MOCK_VERSION ?? "Chromium 146.0.0.0";
if (process.argv.includes("--version")) {
  console.log(versionOutput);
  process.exit(0);
}
let profileDir = "";
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--user-data-dir=")) {
    profileDir = arg.slice("--user-data-dir=".length);
  }
}
if (profileDir) {
  mkdirSync(profileDir + "/Default", { recursive: true });
  writeFileSync(profileDir + "/Local State", "{}");
  writeFileSync(profileDir + "/Default/Preferences", "{}");
}
if (logPath) {
  appendFileSync(logPath, JSON.stringify({ args: process.argv.slice(2) }) + "\\n");
}
setInterval(() => {}, 1000);
`,
    "utf8"
  );
  await chmod(scriptPath, 0o755);
  return { scriptPath, logPath };
};

const createCrashBrowserExecutable = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "webenvoy-browser-launcher-crash-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "crash-browser.mjs");
  await writeFile(
    scriptPath,
    `#!/usr/bin/env node
setTimeout(() => process.exit(0), 50);
`,
    "utf8"
  );
  await chmod(scriptPath, 0o755);
  return scriptPath;
};

const createFixedVersionBrowserExecutable = async (versionOutput: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "webenvoy-browser-launcher-fixed-version-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "fixed-version-browser.mjs");
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

const waitForLaunchLog = async (logPath: string): Promise<string> => {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const content = await readFile(logPath, "utf8");
      if (content.trim().length > 0) {
        return content;
      }
    } catch (error) {
      lastError = error;
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ENOENT") {
        throw error;
      }
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  throw lastError ?? new Error("mock browser launch log not written in time");
};

const parseLaunchArgs = (launchLog: string): string[] => {
  const firstLine = launchLog
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return [];
  }
  const parsed = JSON.parse(firstLine) as { args?: unknown };
  return Array.isArray(parsed.args) ? (parsed.args as string[]) : [];
};

const findArgValue = (args: string[], prefix: string): string | null => {
  for (const arg of args) {
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }
  return null;
};

const waitForExit = async (pid: number): Promise<void> => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ESRCH") {
        return;
      }
      throw error;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  throw new Error(`process ${pid} did not exit in time`);
};

afterEach(async () => {
  restoreEnv("WEBENVOY_BROWSER_PATH", originalBrowserPath);
  restoreEnv("WEBENVOY_BROWSER_MOCK_LOG", originalBrowserMockLog);
  restoreEnv("WEBENVOY_BROWSER_MOCK_VERSION", originalBrowserMockVersion);
  restoreEnv("WEBENVOY_REAL_CHROME_BIN", originalRealChromeBin);
  restoreEnv("WEBENVOY_REAL_BROWSER_PATH", originalRealBrowserPath);
  restoreEnv("WEBENVOY_BROWSER_VERSION", originalBrowserVersion);
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("browser-launcher", () => {
  it("binds fingerprint browser version probe to the resolved executable path", async () => {
    const resolvedExecutable = await createFixedVersionBrowserExecutable("Chromium 146.0.0.0");
    const unrelatedExecutable = await createFixedVersionBrowserExecutable("Chromium 999.0.0.0");
    process.env.WEBENVOY_BROWSER_PATH = resolvedExecutable;
    process.env.WEBENVOY_REAL_CHROME_BIN = unrelatedExecutable;
    process.env.WEBENVOY_REAL_BROWSER_PATH = unrelatedExecutable;
    process.env.WEBENVOY_BROWSER_VERSION = "Chromium 1.0.0.0";

    const versionOutput = await resolveBrowserVersionOutputForFingerprint();
    expect(versionOutput).toBe("Chromium 146.0.0.0");
  });

  it("launches browser executable with profile user-data-dir args", async () => {
    const { scriptPath, logPath } = await createMockBrowserExecutable();
    const profileBaseDir = await mkdtemp(join(tmpdir(), "webenvoy-browser-launcher-profile-"));
    tempDirs.push(profileBaseDir);
    const profileDir = join(profileBaseDir, "nested", "profile");
    process.env.WEBENVOY_BROWSER_PATH = scriptPath;
    process.env.WEBENVOY_BROWSER_MOCK_LOG = logPath;

    const launched = await launchBrowser({
      command: "runtime.start",
      profileDir,
      proxyUrl: "http://127.0.0.1:8080",
      runId: "run-launcher-test-001",
      params: {}
    });
    expect(launched.browserPath).toBe(scriptPath);
    expect(launched.browserPid).toBeGreaterThan(0);
    expect(launched.controllerPid).toBeGreaterThan(0);
    const profileStat = await stat(profileDir);
    expect(profileStat.isDirectory()).toBe(true);

    const launchLog = await waitForLaunchLog(logPath);
    const launchArgs = parseLaunchArgs(launchLog);
    expect(launchArgs).toContain(`--user-data-dir=${profileDir}`);
    expect(launchArgs).toContain("--proxy-server=http://127.0.0.1:8080");
    expect(launchArgs).toContain("about:blank");
    const disableExtensionsExcept = findArgValue(launchArgs, "--disable-extensions-except=");
    const loadExtension = findArgValue(launchArgs, "--load-extension=");
    expect(disableExtensionsExcept).toBeTruthy();
    expect(loadExtension).toBeTruthy();
    expect(disableExtensionsExcept).toBe(loadExtension);

    await shutdownBrowserSession({
      profileDir,
      controllerPid: launched.controllerPid,
      runId: "run-launcher-test-001"
    });
    await expect(readFile(join(profileDir, BROWSER_STATE_FILENAME), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readFile(join(profileDir, BROWSER_CONTROL_FILENAME), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(
      stat(join(profileDir, EXTENSION_STAGING_DIRNAME))
    ).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("stages per-run extension payload and writes bootstrap file", async () => {
    const { scriptPath, logPath } = await createMockBrowserExecutable();
    const profileDir = await mkdtemp(join(tmpdir(), "webenvoy-browser-launcher-extension-stage-"));
    tempDirs.push(profileDir);
    process.env.WEBENVOY_BROWSER_PATH = scriptPath;
    process.env.WEBENVOY_BROWSER_MOCK_LOG = logPath;
    const extensionBootstrap = {
      fingerprint_profile_bundle: {
        ua: "unit-test-agent"
      },
      fingerprint_patch_manifest: {
        required_patches: ["audio_context"]
      }
    };

    const launched = await launchBrowser({
      command: "runtime.start",
      profileDir,
      proxyUrl: null,
      runId: "run-launcher-test-extension-stage-001",
      params: {},
      extensionBootstrap
    });

    const launchArgs = parseLaunchArgs(await waitForLaunchLog(logPath));
    const stagedExtensionPath = findArgValue(launchArgs, "--load-extension=");
    expect(stagedExtensionPath).toBeTruthy();
    expect(stagedExtensionPath).toContain(EXTENSION_STAGING_DIRNAME);
    expect(stagedExtensionPath).toContain("run-launcher-test-extension-stage-001");
    const manifestRaw = await readFile(join(stagedExtensionPath as string, "manifest.json"), "utf8");
    const manifest = JSON.parse(manifestRaw) as {
      content_scripts?: Array<{ world?: string; js?: string[] }>;
    };
    const contentScripts = manifest.content_scripts ?? [];
    const mainWorldEntry = contentScripts.find((entry) => entry.world === "MAIN");
    expect(mainWorldEntry?.js).toContain("build/main-world-bridge.js");
    const isolatedWorldEntry = contentScripts.find(
      (entry) => !entry.world || entry.world === "ISOLATED"
    );
    const isolatedWorldScripts = isolatedWorldEntry?.js ?? [];
    const bootstrapIndex = isolatedWorldScripts.indexOf(
      `build/${EXTENSION_BOOTSTRAP_SCRIPT_FILENAME}`
    );
    const contentScriptIndex = isolatedWorldScripts.indexOf("build/content-script.js");
    expect(bootstrapIndex).toBeGreaterThanOrEqual(0);
    expect(contentScriptIndex).toBeGreaterThanOrEqual(0);
    expect(bootstrapIndex).toBeLessThan(contentScriptIndex);
    const bootstrapRaw = await readFile(
      join(stagedExtensionPath as string, EXTENSION_BOOTSTRAP_FILENAME),
      "utf8"
    );
    const bootstrap = JSON.parse(bootstrapRaw) as {
      schemaVersion: number;
      runId: string;
      extension_bootstrap: Record<string, unknown> | null;
    };
    expect(bootstrap.schemaVersion).toBe(1);
    expect(bootstrap.runId).toBe("run-launcher-test-extension-stage-001");
    expect(bootstrap.extension_bootstrap).toEqual(extensionBootstrap);
    const bootstrapScriptRaw = await readFile(
      join(stagedExtensionPath as string, "build", EXTENSION_BOOTSTRAP_SCRIPT_FILENAME),
      "utf8"
    );
    expect(bootstrapScriptRaw).not.toContain("__webenvoy_fingerprint_bootstrap_payload__");
    expect(bootstrapScriptRaw).toContain("__webenvoy_main_world_request__");
    expect(bootstrapScriptRaw).toContain("fingerprint-install");
    expect(bootstrapScriptRaw).not.toContain("__webenvoy_main_world_result__");
    expect(bootstrapScriptRaw).not.toContain("startup-fingerprint-trust:");
    expect(bootstrapScriptRaw).not.toContain("unit-test-agent");
    const bundledContentScriptRaw = await readFile(
      join(stagedExtensionPath as string, "build", "content-script.js"),
      "utf8"
    );
    expect(bundledContentScriptRaw).not.toContain('import { ContentScriptHandler } from');
    expect(bundledContentScriptRaw).toContain("bootstrapContentScript");
    expect(bundledContentScriptRaw).toContain("WebEnvoy staged content script bundle");
    expect(bundledContentScriptRaw).toContain("__webenvoy_module_content_script");

    await shutdownBrowserSession({
      profileDir,
      controllerPid: launched.controllerPid,
      runId: "run-launcher-test-extension-stage-001"
    });
  });

  it("rejects invalid startUrl", async () => {
    const { scriptPath } = await createMockBrowserExecutable();
    process.env.WEBENVOY_BROWSER_PATH = scriptPath;

    await expect(
      launchBrowser({
        command: "runtime.start",
        profileDir: join(tmpdir(), "webenvoy-browser-launcher-profile-invalid"),
        proxyUrl: null,
        runId: "run-launcher-test-002",
        params: {
          startUrl: "javascript:alert(1)"
        }
      })
    ).rejects.toMatchObject({
      name: "BrowserLaunchError",
      code: "BROWSER_INVALID_ARGUMENT"
    } satisfies Partial<BrowserLaunchError>);
  });

  it("keeps runtime.login visible by default", async () => {
    const { scriptPath, logPath } = await createMockBrowserExecutable();
    const profileDir = join(tmpdir(), "webenvoy-browser-launcher-login-visible");
    process.env.WEBENVOY_BROWSER_PATH = scriptPath;
    process.env.WEBENVOY_BROWSER_MOCK_LOG = logPath;

    const launched = await launchBrowser({
      command: "runtime.login",
      profileDir,
      proxyUrl: null,
      runId: "run-launcher-test-003",
      params: {
        headless: true
      }
    });

    const launchLog = await waitForLaunchLog(logPath);
    expect(launchLog).not.toContain("--headless=new");
    await shutdownBrowserSession({
      profileDir,
      controllerPid: launched.controllerPid,
      runId: "run-launcher-test-003"
    });
  });

  it("rejects request-scoped browserPath override", async () => {
    const { scriptPath } = await createMockBrowserExecutable();
    process.env.WEBENVOY_BROWSER_PATH = scriptPath;

    await expect(
      launchBrowser({
        command: "runtime.start",
        profileDir: join(tmpdir(), "webenvoy-browser-launcher-reject-override"),
        proxyUrl: null,
        runId: "run-launcher-test-004",
        params: {
          browserPath: scriptPath
        }
      })
    ).rejects.toMatchObject({
      name: "BrowserLaunchError",
      code: "BROWSER_INVALID_ARGUMENT"
    } satisfies Partial<BrowserLaunchError>);
  });

  it("fails fast for branded Google Chrome 137+ when only WEBENVOY_BROWSER_PATH is provided", async () => {
    const { scriptPath } = await createMockBrowserExecutable();
    process.env.WEBENVOY_BROWSER_PATH = scriptPath;
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Google Chrome 146.0.7680.154";

    await expect(
      launchBrowser({
        command: "runtime.start",
        profileDir: join(tmpdir(), "webenvoy-browser-launcher-branded-chrome"),
        proxyUrl: null,
        runId: "run-branded-chrome-unsupported",
        params: {}
      })
    ).rejects.toMatchObject({
      name: "BrowserLaunchError",
      code: "BROWSER_LAUNCH_FAILED"
    } satisfies Partial<BrowserLaunchError>);
  });

  it("does not false-fail ready markers on reused profile when fresh markers are written quickly", async () => {
    const { scriptPath } = await createMockBrowserExecutable();
    const profileDir = await mkdtemp(join(tmpdir(), "webenvoy-browser-launcher-fast-markers-"));
    tempDirs.push(profileDir);
    await mkdir(join(profileDir, "Default"), { recursive: true });
    await writeFile(join(profileDir, "Local State"), "{\"stale\":true}", "utf8");
    await writeFile(join(profileDir, "Default", "Preferences"), "{\"stale\":true}", "utf8");
    process.env.WEBENVOY_BROWSER_PATH = scriptPath;

    const launched = await launchBrowser({
      command: "runtime.start",
      profileDir,
      proxyUrl: null,
      runId: "run-launcher-test-006",
      params: {}
    });

    expect(launched.controllerPid).toBeGreaterThan(0);
    expect(launched.browserPid).toBeGreaterThan(0);
    await shutdownBrowserSession({
      profileDir,
      controllerPid: launched.controllerPid,
      runId: "run-launcher-test-006"
    });
  });

  it("stops orphan browser directly when supervisor has already died", async () => {
    const { scriptPath } = await createMockBrowserExecutable();
    const profileDir = await mkdtemp(join(tmpdir(), "webenvoy-browser-launcher-orphan-stop-"));
    tempDirs.push(profileDir);
    process.env.WEBENVOY_BROWSER_PATH = scriptPath;

    const launched = await launchBrowser({
      command: "runtime.start",
      profileDir,
      proxyUrl: null,
      runId: "run-launcher-test-007",
      params: {}
    });

    process.kill(launched.controllerPid, "SIGKILL");
    await waitForExit(launched.controllerPid);

    await shutdownBrowserSession({
      profileDir,
      controllerPid: launched.controllerPid,
      runId: "run-launcher-test-007"
    });

    await waitForExit(launched.browserPid);
    await expect(readFile(join(profileDir, BROWSER_STATE_FILENAME), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readFile(join(profileDir, BROWSER_CONTROL_FILENAME), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("rejects launch when existing profile markers are stale and browser exits quickly", async () => {
    const scriptPath = await createCrashBrowserExecutable();
    const profileDir = await mkdtemp(join(tmpdir(), "webenvoy-browser-launcher-stale-profile-"));
    tempDirs.push(profileDir);
    await mkdir(join(profileDir, "Default"), { recursive: true });
    await writeFile(join(profileDir, "Local State"), "{}", "utf8");
    await writeFile(join(profileDir, "Default", "Preferences"), "{}", "utf8");
    process.env.WEBENVOY_BROWSER_PATH = scriptPath;

    await expect(
      launchBrowser({
        command: "runtime.start",
        profileDir,
        proxyUrl: null,
        runId: "run-launcher-test-005",
        params: {}
      })
    ).rejects.toMatchObject({
      name: "BrowserLaunchError",
      code: "BROWSER_LAUNCH_FAILED"
    } satisfies Partial<BrowserLaunchError>);
  });
});
