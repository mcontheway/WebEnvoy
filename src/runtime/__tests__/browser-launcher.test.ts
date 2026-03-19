import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BrowserLaunchError, launchBrowser } from "../browser-launcher.js";

const tempDirs: string[] = [];

const originalBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
const originalBrowserMockLog = process.env.WEBENVOY_BROWSER_MOCK_LOG;

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

afterEach(async () => {
  process.env.WEBENVOY_BROWSER_PATH = originalBrowserPath;
  process.env.WEBENVOY_BROWSER_MOCK_LOG = originalBrowserMockLog;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("browser-launcher", () => {
  it("launches browser executable with profile user-data-dir args", async () => {
    const { scriptPath, logPath } = await createMockBrowserExecutable();
    const profileDir = join(tmpdir(), "webenvoy-browser-launcher-profile");
    process.env.WEBENVOY_BROWSER_PATH = scriptPath;
    process.env.WEBENVOY_BROWSER_MOCK_LOG = logPath;

    const launched = await launchBrowser({
      command: "runtime.start",
      profileDir,
      proxyUrl: "http://127.0.0.1:8080",
      params: {}
    });
    expect(launched.browserPath).toBe(scriptPath);
    expect(launched.browserPid).toBeGreaterThan(0);

    const launchLog = await waitForLaunchLog(logPath);
    expect(launchLog).toContain(`--user-data-dir=${profileDir}`);
    expect(launchLog).toContain("--proxy-server=http://127.0.0.1:8080");
    expect(launchLog).toContain("about:blank");
  });

  it("rejects invalid startUrl", async () => {
    const { scriptPath } = await createMockBrowserExecutable();
    process.env.WEBENVOY_BROWSER_PATH = scriptPath;

    await expect(
      launchBrowser({
        command: "runtime.start",
        profileDir: join(tmpdir(), "webenvoy-browser-launcher-profile-invalid"),
        proxyUrl: null,
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
    process.env.WEBENVOY_BROWSER_PATH = scriptPath;
    process.env.WEBENVOY_BROWSER_MOCK_LOG = logPath;

    await launchBrowser({
      command: "runtime.login",
      profileDir: join(tmpdir(), "webenvoy-browser-launcher-login-visible"),
      proxyUrl: null,
      params: {
        headless: true
      }
    });

    const launchLog = await waitForLaunchLog(logPath);
    expect(launchLog).not.toContain("--headless=new");
  });

  it("rejects request-scoped browserPath override", async () => {
    const { scriptPath } = await createMockBrowserExecutable();
    process.env.WEBENVOY_BROWSER_PATH = scriptPath;

    await expect(
      launchBrowser({
        command: "runtime.start",
        profileDir: join(tmpdir(), "webenvoy-browser-launcher-reject-override"),
        proxyUrl: null,
        params: {
          browserPath: scriptPath
        }
      })
    ).rejects.toMatchObject({
      name: "BrowserLaunchError",
      code: "BROWSER_INVALID_ARGUMENT"
    } satisfies Partial<BrowserLaunchError>);
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
        params: {}
      })
    ).rejects.toMatchObject({
      name: "BrowserLaunchError",
      code: "BROWSER_LAUNCH_FAILED"
    } satisfies Partial<BrowserLaunchError>);
  });
});
