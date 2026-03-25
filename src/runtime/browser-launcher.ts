import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { JsonObject } from "../core/types.js";

type BrowserLaunchErrorCode =
  | "BROWSER_NOT_FOUND"
  | "BROWSER_LAUNCH_FAILED"
  | "BROWSER_INVALID_ARGUMENT";

const KNOWN_BROWSER_CANDIDATES: Record<NodeJS.Platform, string[]> = {
  darwin: [
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
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
export const EXTENSION_STAGING_DIRNAME = "__webenvoy_extension_staging";
export const EXTENSION_BOOTSTRAP_FILENAME = "__webenvoy_fingerprint_bootstrap.json";
export const EXTENSION_BOOTSTRAP_SCRIPT_FILENAME = "__webenvoy_fingerprint_bootstrap.js";

export interface BrowserLaunchInput {
  command: "runtime.start" | "runtime.login";
  profileDir: string;
  proxyUrl: string | null;
  runId: string;
  params: JsonObject;
  extensionBootstrap?: JsonObject | null;
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

interface ExtensionBootstrapEnvelope {
  schemaVersion: 1;
  runId: string;
  writtenAt: string;
  extension_bootstrap: Record<string, unknown> | null;
}

const READY_WAIT_MAX_ATTEMPTS = 20;
const READY_WAIT_INTERVAL_MS = 150;
const READY_MIN_UPTIME_MS = 600;
const READY_CONFIRM_DELAY_MS = 120;
const SUPERVISOR_STATE_WAIT_ATTEMPTS = 40;
const SUPERVISOR_STATE_WAIT_INTERVAL_MS = 80;
const SUPERVISOR_SHUTDOWN_TIMEOUT_MS = 4_000;
const EXTENSION_BOOTSTRAP_PARAMS_KEY = "extensionBootstrap";
const FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY = "__webenvoy_fingerprint_bootstrap_payload__";
const CONTENT_SCRIPT_ENTRY_PATH = "build/content-script.js";
const EXTENSION_BOOTSTRAP_SCRIPT_PATH = `build/${EXTENSION_BOOTSTRAP_SCRIPT_FILENAME}`;
const SHARED_FINGERPRINT_PROFILE_PATH = "fingerprint-profile.js";
const SHARED_RISK_STATE_PATH = "risk-state.js";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const sanitizePathSegment = (value: string): string => {
  const normalized = value.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "default";
};

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

const readBrowserVersionOutput = async (executablePath: string): Promise<string | null> => {
  return await new Promise<string | null>((resolve) => {
    const child = spawn(executablePath, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (value: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore kill failures
      }
      finish(null);
    }, 2_000);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const combined = `${stdout}\n${stderr}`.trim();
      finish(combined.length > 0 ? combined : null);
    });
  });
};

const isUnsupportedBrandedChromeForExtensions = (versionOutput: string | null): boolean => {
  if (!versionOutput) {
    return false;
  }
  const normalized = versionOutput.trim();
  if (!/^Google Chrome\s/i.test(normalized) || /Google Chrome for Testing/i.test(normalized)) {
    return false;
  }
  const match = normalized.match(/(\d+)\./);
  if (!match) {
    return false;
  }
  const major = Number.parseInt(match[1], 10);
  return Number.isInteger(major) && major >= 137;
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
  let brandedChromeRejected = false;

  for (const candidate of candidates) {
    let resolvedCandidate: string | null = null;
    if (isAbsolute(candidate) || hasPathSegment(candidate)) {
      if (await pathExists(candidate)) {
        resolvedCandidate = candidate;
      }
    } else {
      resolvedCandidate = await resolveCommandFromPath(candidate);
    }
    if (resolvedCandidate === null) {
      continue;
    }

    const versionOutput = await readBrowserVersionOutput(resolvedCandidate);
    if (isUnsupportedBrandedChromeForExtensions(versionOutput)) {
      brandedChromeRejected = true;
      if (explicitFromEnv && candidate === explicitFromEnv) {
        throw new BrowserLaunchError(
          "BROWSER_LAUNCH_FAILED",
          "Google Chrome 137+ 已禁用命令行 --load-extension；请改用 Chrome for Testing / Chromium，或通过 WEBENVOY_BROWSER_PATH 指向受支持浏览器"
        );
      }
      continue;
    }
    return resolvedCandidate;
  }

  if (brandedChromeRejected) {
    throw new BrowserLaunchError(
      "BROWSER_NOT_FOUND",
      "未找到受支持的可加载扩展浏览器；Google Chrome 137+ 已禁用命令行 --load-extension，请安装 Chrome for Testing / Chromium，或通过 WEBENVOY_BROWSER_PATH 指向它们"
    );
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

const resolveExtensionSourceDir = async (): Promise<string> => {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(moduleDir, "..", "..", "extension"), join(process.cwd(), "extension")];
  for (const candidate of candidates) {
    const manifestPath = join(candidate, "manifest.json");
    const backgroundPath = join(candidate, "build", "background.js");
    const contentScriptPath = join(candidate, "build", "content-script.js");
    if (
      (await pathExists(manifestPath)) &&
      (await pathExists(backgroundPath)) &&
      (await pathExists(contentScriptPath))
    ) {
      return candidate;
    }
  }
  throw new BrowserLaunchError(
    "BROWSER_LAUNCH_FAILED",
    "缺少可加载 extension 构建产物，请先构建 extension"
  );
};

const resolveSharedSourceDir = async (extensionSourceDir: string): Promise<string> => {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(extensionSourceDir, "..", "shared"),
    join(moduleDir, "..", "..", "shared"),
    join(process.cwd(), "shared")
  ];
  for (const candidate of candidates) {
    const fingerprintPath = join(candidate, SHARED_FINGERPRINT_PROFILE_PATH);
    const riskStatePath = join(candidate, SHARED_RISK_STATE_PATH);
    if ((await pathExists(fingerprintPath)) && (await pathExists(riskStatePath))) {
      return candidate;
    }
  }
  throw new BrowserLaunchError(
    "BROWSER_LAUNCH_FAILED",
    "缺少 shared 指纹/risk-state 构建产物，无法生成 staged content script bundle"
  );
};

const resolveExtensionBootstrapPayload = (input: BrowserLaunchInput): Record<string, unknown> | null => {
  if (input.extensionBootstrap) {
    return { ...input.extensionBootstrap };
  }
  const fromParams = asRecord(input.params[EXTENSION_BOOTSTRAP_PARAMS_KEY]);
  return fromParams ? { ...fromParams } : null;
};

const buildBootstrapScriptSource = (payload: Record<string, unknown> | null): string =>
  [
    "(() => {",
    `  globalThis["${FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY}"] = ${JSON.stringify(payload)};`,
    "})();",
    ""
  ].join("\n");

const stripEsmSyntaxForClassicScript = (source: string): string => {
  let transformed = source;
  transformed = transformed.replace(/^\s*import\s+[^;]+;\s*$/gm, "");
  transformed = transformed.replace(/^\s*export\s*\{[^;]*\};\s*$/gm, "");
  transformed = transformed.replace(/\bexport\s+const\s+/g, "const ");
  transformed = transformed.replace(/\bexport\s+class\s+/g, "class ");
  transformed = transformed.replace(/\bexport\s+function\s+/g, "function ");
  transformed = transformed.replace(/\nexport\s*\{[\s\S]*?\};?\s*$/m, "\n");
  return transformed.trim();
};

const renderClassicModule = (input: {
  moduleVar: string;
  prelude?: string;
  sourceBody: string;
  exports: string[];
}): string =>
  [
    `const ${input.moduleVar} = (() => {`,
    input.prelude ?? "",
    input.sourceBody,
    `return { ${input.exports.join(", ")} };`,
    "})();",
    ""
  ]
    .filter((line) => line.length > 0)
    .join("\n");

const buildStagedContentScriptBundle = async (input: {
  extensionSourceDir: string;
  sharedSourceDir: string;
}): Promise<string> => {
  const readSource = async (path: string): Promise<string> =>
    stripEsmSyntaxForClassicScript(await readFile(path, "utf8"));

  const fingerprintSource = await readSource(
    join(input.sharedSourceDir, SHARED_FINGERPRINT_PROFILE_PATH)
  );
  const riskStateSource = await readSource(join(input.sharedSourceDir, SHARED_RISK_STATE_PATH));
  const xhsSearchSource = await readSource(join(input.extensionSourceDir, "build", "xhs-search.js"));
  const handlerSource = await readSource(
    join(input.extensionSourceDir, "build", "content-script-handler.js")
  );
  const contentScriptSource = await readSource(
    join(input.extensionSourceDir, CONTENT_SCRIPT_ENTRY_PATH)
  );

  const riskStateModule = renderClassicModule({
    moduleVar: "__webenvoy_module_risk_state",
    sourceBody: riskStateSource,
    exports: [
      "APPROVAL_CHECK_KEYS",
      "EXECUTION_MODES",
      "WRITE_INTERACTION_TIER",
      "buildRiskTransitionAudit",
      "buildUnifiedRiskStateOutput",
      "getWriteActionMatrixDecisions",
      "getIssueActionMatrixEntry",
      "resolveIssueScope",
      "resolveRiskState"
    ]
  });

  const fingerprintModule = renderClassicModule({
    moduleVar: "__webenvoy_module_fingerprint_profile",
    sourceBody: fingerprintSource,
    exports: [
      "DEFAULT_MIME_TYPE_DESCRIPTORS",
      "DEFAULT_PLUGIN_DESCRIPTORS",
      "ensureFingerprintRuntimeContext"
    ]
  });

  const xhsSearchModule = renderClassicModule({
    moduleVar: "__webenvoy_module_xhs_search",
    prelude: [
      "const {",
      "  APPROVAL_CHECK_KEYS,",
      "  EXECUTION_MODES,",
      "  WRITE_INTERACTION_TIER,",
      "  buildRiskTransitionAudit,",
      "  buildUnifiedRiskStateOutput,",
      "  getWriteActionMatrixDecisions,",
      "  getIssueActionMatrixEntry,",
      "  resolveIssueScope: resolveSharedIssueScope,",
      "  resolveRiskState: resolveSharedRiskState",
      "} = __webenvoy_module_risk_state;"
    ].join("\n"),
    sourceBody: xhsSearchSource,
    exports: ["executeXhsSearch"]
  });

  const handlerModule = renderClassicModule({
    moduleVar: "__webenvoy_module_content_script_handler",
    prelude: [
      "const { executeXhsSearch } = __webenvoy_module_xhs_search;",
      "const {",
      "  DEFAULT_MIME_TYPE_DESCRIPTORS,",
      "  DEFAULT_PLUGIN_DESCRIPTORS,",
      "  ensureFingerprintRuntimeContext",
      "} = __webenvoy_module_fingerprint_profile;"
    ].join("\n"),
    sourceBody: handlerSource,
    exports: ["ContentScriptHandler", "encodeMainWorldPayload", "resolveFingerprintContextForContract"]
  });

  const contentScriptModule = renderClassicModule({
    moduleVar: "__webenvoy_module_content_script",
    prelude: [
      "const { ContentScriptHandler } = __webenvoy_module_content_script_handler;",
      "const { ensureFingerprintRuntimeContext } = __webenvoy_module_fingerprint_profile;"
    ].join("\n"),
    sourceBody: contentScriptSource,
    exports: ["bootstrapContentScript"]
  });

  return [
    "/* WebEnvoy staged content script bundle: generated at runtime for MV3 classic script compatibility. */",
    "",
    riskStateModule,
    fingerprintModule,
    xhsSearchModule,
    handlerModule,
    contentScriptModule
  ].join("\n");
};

const rewriteStagedContentScriptForRuntime = async (input: {
  stagedExtensionDir: string;
  extensionSourceDir: string;
}): Promise<void> => {
  const sharedSourceDir = await resolveSharedSourceDir(input.extensionSourceDir);
  const bundleSource = await buildStagedContentScriptBundle({
    extensionSourceDir: input.extensionSourceDir,
    sharedSourceDir
  });
  await writeFile(join(input.stagedExtensionDir, CONTENT_SCRIPT_ENTRY_PATH), `${bundleSource}\n`, "utf8");
};

const injectBootstrapScriptIntoManifest = async (manifestPath: string): Promise<void> => {
  const raw = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const contentScripts = parsed.content_scripts;
  if (!Array.isArray(contentScripts)) {
    throw new BrowserLaunchError(
      "BROWSER_LAUNCH_FAILED",
      "staged extension manifest 缺少 content_scripts，无法注入 bootstrap 脚本"
    );
  }

  let injected = false;
  for (const entry of contentScripts) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const jsEntries = record.js;
    if (!Array.isArray(jsEntries)) {
      continue;
    }
    const scripts = jsEntries.filter((item): item is string => typeof item === "string");
    const contentIndex = scripts.indexOf(CONTENT_SCRIPT_ENTRY_PATH);
    if (contentIndex < 0) {
      continue;
    }
    const deduped = scripts.filter((item) => item !== EXTENSION_BOOTSTRAP_SCRIPT_PATH);
    const insertIndex = deduped.indexOf(CONTENT_SCRIPT_ENTRY_PATH);
    deduped.splice(insertIndex, 0, EXTENSION_BOOTSTRAP_SCRIPT_PATH);
    record.js = deduped;
    injected = true;
  }

  if (!injected) {
    throw new BrowserLaunchError(
      "BROWSER_LAUNCH_FAILED",
      "staged extension manifest 未包含 build/content-script.js，无法注入 bootstrap 脚本"
    );
  }
  await writeFile(manifestPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
};

const stageExtensionForRun = async (input: {
  profileDir: string;
  runId: string;
  extensionBootstrap: Record<string, unknown> | null;
}): Promise<{ stagedExtensionDir: string; bootstrapPath: string; bootstrapScriptPath: string }> => {
  const extensionSourceDir = await resolveExtensionSourceDir();
  const stagedExtensionDir = join(
    input.profileDir,
    EXTENSION_STAGING_DIRNAME,
    sanitizePathSegment(input.runId)
  );
  const stagedExtensionParent = join(input.profileDir, EXTENSION_STAGING_DIRNAME);
  await mkdir(stagedExtensionParent, { recursive: true });
  await rm(stagedExtensionDir, { recursive: true, force: true });
  await cp(extensionSourceDir, stagedExtensionDir, { recursive: true });

  const bootstrapPath = join(stagedExtensionDir, EXTENSION_BOOTSTRAP_FILENAME);
  const envelope: ExtensionBootstrapEnvelope = {
    schemaVersion: 1,
    runId: input.runId,
    writtenAt: new Date().toISOString(),
    extension_bootstrap: input.extensionBootstrap
  };
  await writeFile(bootstrapPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");

  const bootstrapScriptPath = join(stagedExtensionDir, EXTENSION_BOOTSTRAP_SCRIPT_PATH);
  const bootstrapScriptPayload = {
    ...(input.extensionBootstrap ?? {}),
    run_id: input.runId
  };
  await writeFile(
    bootstrapScriptPath,
    buildBootstrapScriptSource(bootstrapScriptPayload),
    "utf8"
  );
  await rewriteStagedContentScriptForRuntime({
    stagedExtensionDir,
    extensionSourceDir
  });
  await injectBootstrapScriptIntoManifest(join(stagedExtensionDir, "manifest.json"));

  return { stagedExtensionDir, bootstrapPath, bootstrapScriptPath };
};

const cleanupStagedExtensions = async (profileDir: string): Promise<void> => {
  await rm(join(profileDir, EXTENSION_STAGING_DIRNAME), { recursive: true, force: true });
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
  const extensionBootstrap = resolveExtensionBootstrapPayload(input);
  const extensionStaging = await stageExtensionForRun({
    profileDir: input.profileDir,
    runId: input.runId,
    extensionBootstrap
  });
  const launchArgs = [
    `--user-data-dir=${input.profileDir}`,
    "--profile-directory=Default",
    "--new-window",
    "--no-first-run",
    "--no-default-browser-check",
    `--disable-extensions-except=${extensionStaging.stagedExtensionDir}`,
    `--load-extension=${extensionStaging.stagedExtensionDir}`
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
  let launchSucceeded = false;
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
    launchSucceeded = true;
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
  } finally {
    if (!launchSucceeded) {
      await cleanupStagedExtensions(input.profileDir);
    }
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
      await cleanupStagedExtensions(input.profileDir);
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
      await cleanupStagedExtensions(input.profileDir);
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
      await cleanupStagedExtensions(input.profileDir);
      return;
    }
    await sleep(100);
  }

  if (await terminateBrowserPid(state.browserPid, 1_000)) {
    await cleanupSupervisorArtifacts(input.profileDir);
    await cleanupStagedExtensions(input.profileDir);
    return;
  }

  throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", "浏览器控制进程关闭超时");
};
