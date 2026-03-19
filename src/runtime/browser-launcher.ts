import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { JsonObject } from "../core/types.js";

type BrowserLaunchErrorCode =
  | "BROWSER_NOT_FOUND"
  | "BROWSER_LAUNCH_FAILED"
  | "BROWSER_INVALID_ARGUMENT";

const KNOWN_BROWSER_CANDIDATES: Record<NodeJS.Platform, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ],
  linux: [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "google-chrome-stable",
    "google-chrome",
    "chromium-browser",
    "chromium"
  ],
  win32: [
    "chrome.exe",
    "chromium.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Chromium\\Application\\chrome.exe"
  ],
  aix: [],
  android: [],
  freebsd: [],
  haiku: [],
  openbsd: [],
  netbsd: [],
  sunos: [],
  cygwin: []
};

const hasPathSegment = (value: string): boolean => /[\\/]/.test(value);

export class BrowserLaunchError extends Error {
  readonly code: BrowserLaunchErrorCode;

  constructor(code: BrowserLaunchErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BrowserLaunchError";
    this.code = code;
  }
}

export const BROWSER_STATE_FILENAME = "__webenvoy_browser_instance.json";
export const BROWSER_CONTROL_FILENAME = "__webenvoy_browser_control.json";

export interface BrowserLaunchInput {
  command: "runtime.start" | "runtime.login";
  profileDir: string;
  proxyUrl: string | null;
  runId: string;
  params: JsonObject;
}

export interface BrowserLaunchResult {
  browserPath: string;
  browserPid: number;
  controllerPid: number;
  launchArgs: string[];
  launchedAt: string;
}

export interface BrowserShutdownInput {
  profileDir: string;
  controllerPid: number;
  runId: string;
  timeoutMs?: number;
}

interface BrowserInstanceState {
  schemaVersion: 1;
  launchToken: string;
  profileDir: string;
  runId: string;
  browserPath: string;
  controllerPid: number;
  browserPid: number;
  launchedAt: string;
}

interface SupervisorShutdownCommand {
  action: "shutdown";
  launchToken: string;
  requestedAt: string;
}

const READY_WAIT_MAX_ATTEMPTS = 20;
const READY_WAIT_INTERVAL_MS = 150;
const READY_MIN_UPTIME_MS = 600;
const READY_CONFIRM_DELAY_MS = 120;
const SUPERVISOR_STATE_WAIT_ATTEMPTS = 40;
const SUPERVISOR_STATE_WAIT_INTERVAL_MS = 80;
const SUPERVISOR_SHUTDOWN_TIMEOUT_MS = 4_000;

const parseOptionalString = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new BrowserLaunchError("BROWSER_INVALID_ARGUMENT", "浏览器启动参数必须是字符串");
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new BrowserLaunchError("BROWSER_INVALID_ARGUMENT", "浏览器启动参数不能为空字符串");
  }
  return normalized;
};

const parseStartUrl = (params: JsonObject): string => {
  const raw = params.startUrl;
  if (raw === undefined || raw === null) {
    return "about:blank";
  }
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new BrowserLaunchError(
      "BROWSER_INVALID_ARGUMENT",
      "params.startUrl 必须是非空字符串"
    );
  }
  const normalized = raw.trim();
  if (normalized === "about:blank") {
    return normalized;
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new BrowserLaunchError(
        "BROWSER_INVALID_ARGUMENT",
        "params.startUrl 仅支持 http/https/about:blank"
      );
    }
    return normalized;
  } catch (error) {
    if (error instanceof BrowserLaunchError) {
      throw error;
    }
    throw new BrowserLaunchError("BROWSER_INVALID_ARGUMENT", "params.startUrl 不是有效 URL", {
      cause: error
    });
  }
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const isFreshReadyMarker = async (path: string, launchedAtMs: number): Promise<boolean> => {
  try {
    const markerStat = await stat(path);
    return markerStat.mtimeMs >= launchedAtMs;
  } catch {
    return false;
  }
};

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isProcessAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const deleteFileQuietly = async (path: string): Promise<void> => {
  try {
    await unlink(path);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }
};

const waitForProcessExit = async (pid: number, deadlineMs: number): Promise<boolean> => {
  while (Date.now() < deadlineMs) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await sleep(100);
  }
  return !isProcessAlive(pid);
};

const cleanupSupervisorArtifacts = async (profileDir: string): Promise<void> => {
  await deleteFileQuietly(getStateFilePath(profileDir));
  await deleteFileQuietly(getControlFilePath(profileDir));
};

const terminateBrowserPid = async (browserPid: number, timeoutMs: number): Promise<boolean> => {
  if (!isProcessAlive(browserPid)) {
    return true;
  }

  try {
    process.kill(browserPid, "SIGTERM");
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ESRCH") {
      throw error;
    }
    return true;
  }

  const gracefulDeadline = Date.now() + timeoutMs;
  if (await waitForProcessExit(browserPid, gracefulDeadline)) {
    return true;
  }

  try {
    process.kill(browserPid, "SIGKILL");
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ESRCH") {
      throw error;
    }
    return true;
  }

  return waitForProcessExit(browserPid, Date.now() + 1_000);
};

const getStateFilePath = (profileDir: string): string => join(profileDir, BROWSER_STATE_FILENAME);
const getControlFilePath = (profileDir: string): string => join(profileDir, BROWSER_CONTROL_FILENAME);

const parseInstanceState = (raw: string): BrowserInstanceState | null => {
  const parsed = JSON.parse(raw) as Partial<BrowserInstanceState>;
  if (
    parsed.schemaVersion !== 1 ||
    typeof parsed.launchToken !== "string" ||
    typeof parsed.profileDir !== "string" ||
    typeof parsed.runId !== "string" ||
    typeof parsed.browserPath !== "string" ||
    !Number.isInteger(parsed.controllerPid) ||
    !Number.isInteger(parsed.browserPid) ||
    typeof parsed.launchedAt !== "string"
  ) {
    return null;
  }
  return parsed as BrowserInstanceState;
};

const readInstanceState = async (path: string): Promise<BrowserInstanceState | null> => {
  try {
    const raw = await readFile(path, "utf8");
    return parseInstanceState(raw);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return null;
    }
    return null;
  }
};

const resolveCommandFromPath = async (command: string): Promise<string | null> => {
  const pathEnv = process.env.PATH ?? "";
  if (pathEnv.trim().length === 0) {
    return null;
  }
  const dirs = pathEnv.split(delimiter).filter((segment) => segment.length > 0);
  const extensions =
    process.platform === "win32"
      ? ((process.env.PATHEXT ?? ".EXE;.CMD;.BAT")
          .split(";")
          .filter((ext) => ext.length > 0)
          .map((ext) => ext.toLowerCase()))
      : [""];
  const hasExtension = /\.[A-Za-z0-9]+$/.test(command);

  for (const dir of dirs) {
    const candidates =
      process.platform === "win32" && !hasExtension
        ? extensions.map((ext) => join(dir, `${command}${ext}`))
        : [join(dir, command)];
    for (const candidate of candidates) {
      if (await pathExists(candidate)) {
        return candidate;
      }
    }
  }
  return null;
};

const resolveExecutablePath = async (params: JsonObject): Promise<string> => {
  const explicitFromParams = parseOptionalString(params.browserPath);
  if (explicitFromParams !== null) {
    throw new BrowserLaunchError(
      "BROWSER_INVALID_ARGUMENT",
      "params.browserPath 不受支持，请使用受信环境变量 WEBENVOY_BROWSER_PATH"
    );
  }
  const explicitFromEnv = parseOptionalString(process.env.WEBENVOY_BROWSER_PATH);
  const candidates = [
    explicitFromEnv,
    ...(KNOWN_BROWSER_CANDIDATES[process.platform] ?? [])
  ].filter((item): item is string => item !== null);

  for (const candidate of candidates) {
    if (isAbsolute(candidate) || hasPathSegment(candidate)) {
      if (await pathExists(candidate)) {
        return candidate;
      }
      continue;
    }
    const resolved = await resolveCommandFromPath(candidate);
    if (resolved !== null) {
      return resolved;
    }
  }

  throw new BrowserLaunchError(
    "BROWSER_NOT_FOUND",
    "未找到系统 Chrome/Chromium，可通过受信环境变量 WEBENVOY_BROWSER_PATH 显式指定"
  );
};

const resolveSupervisorScriptPath = async (): Promise<string> => {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "browser-supervisor.js"),
    join(process.cwd(), "dist", "runtime", "browser-supervisor.js")
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", "缺少浏览器控制进程脚本 browser-supervisor.js");
};

const shouldLaunchHeadless = (params: JsonObject): boolean => params.headless !== false;

const assertProcessAlive = (pid: number): void => {
  try {
    process.kill(pid, 0);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ESRCH") {
      throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", "浏览器启动后立即退出");
    }
    throw error;
  }
};

const waitForBrowserReady = async (
  profileDir: string,
  pid: number,
  launchedAtMs: number
): Promise<void> => {
  const readyMarkers = [join(profileDir, "Local State"), join(profileDir, "Default", "Preferences")];

  for (let attempt = 0; attempt < READY_WAIT_MAX_ATTEMPTS; attempt += 1) {
    assertProcessAlive(pid);

    let markerReady = false;
    for (const marker of readyMarkers) {
      if (await isFreshReadyMarker(marker, launchedAtMs)) {
        markerReady = true;
        break;
      }
    }

    if (markerReady && Date.now() - launchedAtMs >= READY_MIN_UPTIME_MS) {
      await sleep(READY_CONFIRM_DELAY_MS);
      assertProcessAlive(pid);
      return;
    }

    await sleep(READY_WAIT_INTERVAL_MS);
  }

  throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", "浏览器启动超时，未完成最小 profile 初始化");
};

const waitForSupervisorState = async (input: {
  stateFilePath: string;
  expectedToken: string;
  expectedControllerPid: number;
}): Promise<BrowserInstanceState> => {
  for (let attempt = 0; attempt < SUPERVISOR_STATE_WAIT_ATTEMPTS; attempt += 1) {
    const state = await readInstanceState(input.stateFilePath);
    if (
      state &&
      state.launchToken === input.expectedToken &&
      state.controllerPid === input.expectedControllerPid &&
      state.browserPid > 0
    ) {
      return state;
    }
    await sleep(SUPERVISOR_STATE_WAIT_INTERVAL_MS);
  }
  throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", "浏览器控制进程未写入可用状态");
};

const launchProcess = async (
  supervisorScriptPath: string,
  executablePath: string,
  args: string[],
  input: {
    stateFilePath: string;
    controlFilePath: string;
    launchToken: string;
    profileDir: string;
    runId: string;
  }
): Promise<{ pid: number; launchedAt: string; launchedAtMs: number }> => {
  const launchedAtMs = Date.now();
  const launchedAt = new Date(launchedAtMs).toISOString();
  const launchArgsBase64 = Buffer.from(JSON.stringify(args), "utf8").toString("base64");
  const child = spawn(
    process.execPath,
    [
      supervisorScriptPath,
      "--browser-path",
      executablePath,
      "--launch-args-b64",
      launchArgsBase64,
      "--state-file",
      input.stateFilePath,
      "--control-file",
      input.controlFilePath,
      "--launch-token",
      input.launchToken,
      "--profile-dir",
      input.profileDir,
      "--run-id",
      input.runId
    ],
    {
      detached: true,
      stdio: "ignore"
    }
  );
  child.unref();

  const launched = await new Promise<boolean>((resolve, reject) => {
    let settled = false;
    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });
    child.once("spawn", () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(true);
    });
    setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(false);
    }, 150);
  });

  if (!launched || typeof child.pid !== "number" || child.pid <= 0) {
    throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", "浏览器启动失败，未获取到有效进程 PID");
  }

  return {
    pid: child.pid,
    launchedAt,
    launchedAtMs
  };
};

export const launchBrowser = async (input: BrowserLaunchInput): Promise<BrowserLaunchResult> => {
  const executablePath = await resolveExecutablePath(input.params);
  const supervisorScriptPath = await resolveSupervisorScriptPath();
  const launchArgs = [
    `--user-data-dir=${input.profileDir}`,
    "--profile-directory=Default",
    "--new-window",
    "--no-first-run",
    "--no-default-browser-check"
  ];
  if (input.proxyUrl !== null) {
    launchArgs.push(`--proxy-server=${input.proxyUrl}`);
  }
  const shouldHeadless =
    input.command === "runtime.login" ? false : shouldLaunchHeadless(input.params);
  if (shouldHeadless) {
    launchArgs.push("--headless=new");
  }
  launchArgs.push(parseStartUrl(input.params));

  const launchToken = randomUUID();
  const stateFilePath = getStateFilePath(input.profileDir);
  const controlFilePath = getControlFilePath(input.profileDir);
  let controllerPid: number | null = null;
  try {
    await mkdir(input.profileDir, { recursive: true });
    await deleteFileQuietly(stateFilePath);
    await deleteFileQuietly(controlFilePath);
    const launched = await launchProcess(supervisorScriptPath, executablePath, launchArgs, {
      stateFilePath,
      controlFilePath,
      launchToken,
      profileDir: input.profileDir,
      runId: input.runId
    });
    controllerPid = launched.pid;
    const state = await waitForSupervisorState({
      stateFilePath,
      expectedToken: launchToken,
      expectedControllerPid: launched.pid
    });
    await waitForBrowserReady(input.profileDir, state.browserPid, launched.launchedAtMs);
    return {
      browserPath: executablePath,
      browserPid: state.browserPid,
      controllerPid: state.controllerPid,
      launchArgs: [...launchArgs],
      launchedAt: launched.launchedAt
    };
  } catch (error) {
    if (controllerPid !== null && isProcessAlive(controllerPid)) {
      try {
        process.kill(controllerPid, "SIGTERM");
      } catch {
        // ignore cleanup failure
      }
    }
    if (error instanceof BrowserLaunchError) {
      throw error;
    }
    throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", "浏览器启动失败", {
      cause: error
    });
  }
};

export const shutdownBrowserSession = async (input: BrowserShutdownInput): Promise<void> => {
  const timeoutMs = input.timeoutMs ?? SUPERVISOR_SHUTDOWN_TIMEOUT_MS;
  const stateFilePath = getStateFilePath(input.profileDir);
  const controlFilePath = getControlFilePath(input.profileDir);
  const state = await readInstanceState(stateFilePath);
  if (!state) {
    throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", "浏览器实例状态缺失，无法安全停止");
  }
  if (state.controllerPid !== input.controllerPid) {
    throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", "浏览器控制进程与锁所有者不一致");
  }
  if (state.runId !== input.runId) {
    throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", "浏览器实例 run_id 与 stop 请求不一致");
  }
  if (!isProcessAlive(input.controllerPid)) {
    if (await terminateBrowserPid(state.browserPid, timeoutMs)) {
      await cleanupSupervisorArtifacts(input.profileDir);
      return;
    }
    throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", "浏览器控制进程已断开，且孤儿浏览器关闭超时");
  }

  const command: SupervisorShutdownCommand = {
    action: "shutdown",
    launchToken: state.launchToken,
    requestedAt: new Date().toISOString()
  };
  await writeFile(controlFilePath, `${JSON.stringify(command, null, 2)}\n`, "utf8");

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const controllerAlive = isProcessAlive(input.controllerPid);
    const nextState = await readInstanceState(stateFilePath);
    if (!controllerAlive && nextState === null) {
      return;
    }
    await sleep(100);
  }

  if (isProcessAlive(input.controllerPid)) {
    try {
      process.kill(input.controllerPid, "SIGTERM");
    } catch {
      // ignore signal failure
    }
  }

  const gracefulDeadline = Date.now() + 1_000;
  while (Date.now() < gracefulDeadline) {
    const controllerAlive = isProcessAlive(input.controllerPid);
    const nextState = await readInstanceState(stateFilePath);
    if (!controllerAlive && nextState === null) {
      return;
    }
    await sleep(100);
  }

  if (await terminateBrowserPid(state.browserPid, 1_000)) {
    await cleanupSupervisorArtifacts(input.profileDir);
    return;
  }

  throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", "浏览器控制进程关闭超时");
};
