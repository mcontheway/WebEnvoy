import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
const KNOWN_BROWSER_CANDIDATES = {
    darwin: [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
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
const hasPathSegment = (value) => /[\\/]/.test(value);
export const resolvePreferredBrowserCandidates = (platform, explicitFromEnv) => [explicitFromEnv, ...(KNOWN_BROWSER_CANDIDATES[platform] ?? [])].filter((item) => item !== null);
export class BrowserLaunchError extends Error {
    code;
    constructor(code, message, options) {
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
const READY_WAIT_MAX_ATTEMPTS = 80;
const READY_WAIT_INTERVAL_MS = 150;
const READY_MIN_UPTIME_MS = 600;
const READY_CONFIRM_DELAY_MS = 120;
const READY_MARKER_GRANULARITY_TOLERANCE_MS = 1_000;
const SUPERVISOR_STATE_WAIT_ATTEMPTS = 40;
const SUPERVISOR_STATE_WAIT_INTERVAL_MS = 80;
const SUPERVISOR_SHUTDOWN_TIMEOUT_MS = 4_000;
const EXTENSION_BOOTSTRAP_PARAMS_KEY = "extensionBootstrap";
const CONTENT_SCRIPT_ENTRY_PATH = "build/content-script.js";
const MAIN_WORLD_BRIDGE_ENTRY_PATH = "build/main-world-bridge.js";
const EXTENSION_BOOTSTRAP_SCRIPT_PATH = `build/${EXTENSION_BOOTSTRAP_SCRIPT_FILENAME}`;
const SHARED_FINGERPRINT_PROFILE_PATH = "fingerprint-profile.js";
const SHARED_RISK_STATE_PATH = "risk-state.js";
const FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY = "__webenvoy_fingerprint_bootstrap_payload__";
const BRIDGE_BOOTSTRAP_PAYLOAD_KEY = "bridge_bootstrap";
const MAIN_WORLD_EVENT_NAMESPACE = "webenvoy.main_world.bridge.v1";
const MAIN_WORLD_EVENT_REQUEST_PREFIX = "__mw_req__";
const MAIN_WORLD_EVENT_RESULT_PREFIX = "__mw_res__";
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const hashMainWorldEventChannel = (value) => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
};
const resolveMainWorldEventNamesForSecret = (secret) => {
    const channel = hashMainWorldEventChannel(`${MAIN_WORLD_EVENT_NAMESPACE}|${secret}`);
    return {
        requestEvent: `${MAIN_WORLD_EVENT_REQUEST_PREFIX}${channel}`,
        resultEvent: `${MAIN_WORLD_EVENT_RESULT_PREFIX}${channel}`
    };
};
const sanitizePathSegment = (value) => {
    const normalized = value.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^_+|_+$/g, "");
    return normalized.length > 0 ? normalized : "default";
};
const parseOptionalString = (value) => {
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
const readTrimmedEnvString = (value) => {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
};
const parseStartUrl = (params) => {
    const raw = params.startUrl;
    if (raw === undefined || raw === null) {
        return "about:blank";
    }
    if (typeof raw !== "string" || raw.trim().length === 0) {
        throw new BrowserLaunchError("BROWSER_INVALID_ARGUMENT", "params.startUrl 必须是非空字符串");
    }
    const normalized = raw.trim();
    if (normalized === "about:blank") {
        return normalized;
    }
    try {
        const parsed = new URL(normalized);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new BrowserLaunchError("BROWSER_INVALID_ARGUMENT", "params.startUrl 仅支持 http/https/about:blank");
        }
        return normalized;
    }
    catch (error) {
        if (error instanceof BrowserLaunchError) {
            throw error;
        }
        throw new BrowserLaunchError("BROWSER_INVALID_ARGUMENT", "params.startUrl 不是有效 URL", {
            cause: error
        });
    }
};
const pathExists = async (path) => {
    try {
        await access(path, fsConstants.F_OK);
        return true;
    }
    catch {
        return false;
    }
};
const isFreshReadyMarker = async (path, launchedAtMs) => {
    try {
        const markerStat = await stat(path);
        return markerStat.mtimeMs + READY_MARKER_GRANULARITY_TOLERANCE_MS >= launchedAtMs;
    }
    catch {
        return false;
    }
};
const sleep = async (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});
const isProcessAlive = (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
};
const deleteFileQuietly = async (path) => {
    try {
        await unlink(path);
    }
    catch (error) {
        const nodeError = error;
        if (nodeError.code !== "ENOENT") {
            throw error;
        }
    }
};
const waitForProcessExit = async (pid, deadlineMs) => {
    while (Date.now() < deadlineMs) {
        if (!isProcessAlive(pid)) {
            return true;
        }
        await sleep(100);
    }
    return !isProcessAlive(pid);
};
const cleanupSupervisorArtifacts = async (profileDir) => {
    await deleteFileQuietly(getStateFilePath(profileDir));
    await deleteFileQuietly(getControlFilePath(profileDir));
};
const terminateBrowserPid = async (browserPid, timeoutMs) => {
    if (!isProcessAlive(browserPid)) {
        return true;
    }
    try {
        process.kill(browserPid, "SIGTERM");
    }
    catch (error) {
        const nodeError = error;
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
    }
    catch (error) {
        const nodeError = error;
        if (nodeError.code !== "ESRCH") {
            throw error;
        }
        return true;
    }
    return waitForProcessExit(browserPid, Date.now() + 1_000);
};
const getStateFilePath = (profileDir) => join(profileDir, BROWSER_STATE_FILENAME);
const getControlFilePath = (profileDir) => join(profileDir, BROWSER_CONTROL_FILENAME);
const parseInstanceState = (raw) => {
    const parsed = JSON.parse(raw);
    if (parsed.schemaVersion !== 1 ||
        typeof parsed.launchToken !== "string" ||
        typeof parsed.profileDir !== "string" ||
        typeof parsed.runId !== "string" ||
        typeof parsed.browserPath !== "string" ||
        !Number.isInteger(parsed.controllerPid) ||
        !Number.isInteger(parsed.browserPid) ||
        typeof parsed.launchedAt !== "string") {
        return null;
    }
    return parsed;
};
const readInstanceState = async (path) => {
    try {
        const raw = await readFile(path, "utf8");
        return parseInstanceState(raw);
    }
    catch (error) {
        const nodeError = error;
        if (nodeError.code === "ENOENT") {
            return null;
        }
        return null;
    }
};
const resolveCommandFromPath = async (command) => {
    const pathEnv = process.env.PATH ?? "";
    if (pathEnv.trim().length === 0) {
        return null;
    }
    const dirs = pathEnv.split(delimiter).filter((segment) => segment.length > 0);
    const extensions = process.platform === "win32"
        ? ((process.env.PATHEXT ?? ".EXE;.CMD;.BAT")
            .split(";")
            .filter((ext) => ext.length > 0)
            .map((ext) => ext.toLowerCase()))
        : [""];
    const hasExtension = /\.[A-Za-z0-9]+$/.test(command);
    for (const dir of dirs) {
        const candidates = process.platform === "win32" && !hasExtension
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
const resolveExplicitBrowserPathFromEnv = async () => {
    const explicitFromEnv = readTrimmedEnvString(process.env.WEBENVOY_BROWSER_PATH);
    if (!explicitFromEnv) {
        return null;
    }
    if (isAbsolute(explicitFromEnv) || hasPathSegment(explicitFromEnv)) {
        return explicitFromEnv;
    }
    return resolveCommandFromPath(explicitFromEnv);
};
const readBrowserVersionOutput = async (executablePath) => {
    return await new Promise((resolve) => {
        const child = spawn(executablePath, ["--version"], {
            stdio: ["ignore", "pipe", "pipe"],
            env: process.env
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        const finish = (value) => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(value);
        };
        const timer = setTimeout(() => {
            try {
                child.kill("SIGKILL");
            }
            catch {
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
export const isUnsupportedBrandedChromeForExtensions = (versionOutput) => {
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
const resolveExecutablePath = async (params, options) => {
    const explicitFromParams = parseOptionalString(params.browserPath);
    if (explicitFromParams !== null) {
        throw new BrowserLaunchError("BROWSER_INVALID_ARGUMENT", "params.browserPath 不受支持，请使用受信环境变量 WEBENVOY_BROWSER_PATH");
    }
    const explicitFromEnv = parseOptionalString(process.env.WEBENVOY_BROWSER_PATH);
    const candidates = resolvePreferredBrowserCandidates(process.platform, explicitFromEnv);
    let brandedChromeRejected = false;
    for (const candidate of candidates) {
        let resolvedCandidate = null;
        if (isAbsolute(candidate) || hasPathSegment(candidate)) {
            if (await pathExists(candidate)) {
                resolvedCandidate = candidate;
            }
        }
        else {
            resolvedCandidate = await resolveCommandFromPath(candidate);
        }
        if (resolvedCandidate === null) {
            continue;
        }
        const versionOutput = await readBrowserVersionOutput(resolvedCandidate);
        if (isUnsupportedBrandedChromeForExtensions(versionOutput)) {
            if (options?.allowUnsupportedExtensionBrowser) {
                return resolvedCandidate;
            }
            brandedChromeRejected = true;
            if (explicitFromEnv && candidate === explicitFromEnv) {
                throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", "Google Chrome 137+ 已禁用命令行 --load-extension；请改用 Chrome for Testing / Chromium，或通过 WEBENVOY_BROWSER_PATH 指向受支持浏览器");
            }
            continue;
        }
        return resolvedCandidate;
    }
    if (brandedChromeRejected) {
        throw new BrowserLaunchError("BROWSER_NOT_FOUND", "未找到受支持的可加载扩展浏览器；Google Chrome 137+ 已禁用命令行 --load-extension，请安装 Chrome for Testing / Chromium，或通过 WEBENVOY_BROWSER_PATH 指向它们");
    }
    throw new BrowserLaunchError("BROWSER_NOT_FOUND", "未找到系统 Chrome/Chromium，可通过受信环境变量 WEBENVOY_BROWSER_PATH 显式指定");
};
export const resolveBrowserVersionOutputForFingerprint = async (executablePath) => {
    if (executablePath) {
        return readTrimmedEnvString(await readBrowserVersionOutput(executablePath));
    }
    try {
        const truthSource = await resolveBrowserVersionTruthSource();
        return truthSource.browserVersion;
    }
    catch {
        return null;
    }
};
const resolveExecutableCandidate = async (candidate) => {
    let executablePath = null;
    if (isAbsolute(candidate) || hasPathSegment(candidate)) {
        if (await pathExists(candidate)) {
            executablePath = candidate;
        }
    }
    else {
        executablePath = await resolveCommandFromPath(candidate);
    }
    if (executablePath === null) {
        return null;
    }
    return {
        executablePath,
        browserVersion: readTrimmedEnvString(await readBrowserVersionOutput(executablePath))
    };
};
export const resolveBrowserVersionTruthSource = async (params = {}, options) => {
    const executablePath = await resolveExecutablePath(params, options);
    return {
        executablePath,
        browserVersion: readTrimmedEnvString(await readBrowserVersionOutput(executablePath))
    };
};
export const resolvePreferredBrowserVersionTruthSource = async (params = {}) => {
    const explicitFromParams = parseOptionalString(params.browserPath);
    if (explicitFromParams !== null) {
        throw new BrowserLaunchError("BROWSER_INVALID_ARGUMENT", "params.browserPath 不受支持，请使用受信环境变量 WEBENVOY_BROWSER_PATH");
    }
    const explicitFromEnv = parseOptionalString(process.env.WEBENVOY_BROWSER_PATH);
    const candidates = [
        explicitFromEnv,
        ...(KNOWN_BROWSER_CANDIDATES[process.platform] ?? [])
    ].filter((item) => item !== null);
    let officialChromePreferred = null;
    let fallbackCandidate = null;
    for (const candidate of candidates) {
        const resolved = await resolveExecutableCandidate(candidate);
        if (resolved === null) {
            continue;
        }
        if (explicitFromEnv && candidate === explicitFromEnv) {
            return resolved;
        }
        if (isUnsupportedBrandedChromeForExtensions(resolved.browserVersion)) {
            officialChromePreferred ??= resolved;
            continue;
        }
        fallbackCandidate ??= resolved;
    }
    if (officialChromePreferred) {
        return officialChromePreferred;
    }
    if (fallbackCandidate) {
        return fallbackCandidate;
    }
    return resolveBrowserVersionTruthSource(params);
};
const resolveSupervisorScriptPath = async () => {
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
const resolveExtensionSourceDir = async () => {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const candidates = [join(moduleDir, "..", "..", "extension"), join(process.cwd(), "extension")];
    for (const candidate of candidates) {
        const manifestPath = join(candidate, "manifest.json");
        const backgroundPath = join(candidate, "build", "background.js");
        const contentScriptPath = join(candidate, "build", "content-script.js");
        if ((await pathExists(manifestPath)) &&
            (await pathExists(backgroundPath)) &&
            (await pathExists(contentScriptPath))) {
            return candidate;
        }
    }
    throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", "缺少可加载 extension 构建产物，请先构建 extension");
};
const resolveSharedSourceDir = async (extensionSourceDir) => {
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
    throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", "缺少 shared 指纹/risk-state 构建产物，无法生成 staged content script bundle");
};
const resolveExtensionBootstrapPayload = (input) => {
    if (input.extensionBootstrap) {
        return { ...input.extensionBootstrap };
    }
    const fromParams = asRecord(input.params[EXTENSION_BOOTSTRAP_PARAMS_KEY]);
    return fromParams ? { ...fromParams } : null;
};
const resolveBootstrapInstallRuntime = (extensionBootstrap) => {
    const runtimeRecord = asRecord(extensionBootstrap?.fingerprint_runtime ?? extensionBootstrap);
    if (!runtimeRecord) {
        return null;
    }
    const patchManifest = asRecord(runtimeRecord.fingerprint_patch_manifest ?? null);
    const bundle = asRecord(runtimeRecord.fingerprint_profile_bundle ?? null);
    const batteryRecord = asRecord(bundle?.battery ?? null);
    const batteryLevel = typeof batteryRecord?.level === "number" && Number.isFinite(batteryRecord.level)
        ? batteryRecord.level
        : null;
    const batteryCharging = typeof batteryRecord?.charging === "boolean" ? batteryRecord.charging : null;
    const audioNoiseSeed = typeof bundle?.audioNoiseSeed === "number" && Number.isFinite(bundle.audioNoiseSeed)
        ? bundle.audioNoiseSeed
        : null;
    return {
        fingerprint_patch_manifest: {
            required_patches: Array.isArray(patchManifest?.required_patches)
                ? patchManifest.required_patches.filter((entry) => typeof entry === "string")
                : []
        },
        fingerprint_profile_bundle: {
            ...(audioNoiseSeed === null ? {} : { audioNoiseSeed }),
            ...(batteryLevel === null || batteryCharging === null
                ? {}
                : { battery: { level: batteryLevel, charging: batteryCharging } })
        }
    };
};
const buildBridgeBootstrapPayload = (input) => {
    const payload = {
        [BRIDGE_BOOTSTRAP_PAYLOAD_KEY]: input.bridgeSecret
    };
    const installRuntime = resolveBootstrapInstallRuntime(input.extensionBootstrap);
    if (installRuntime) {
        payload.fingerprint_runtime = installRuntime;
    }
    return payload;
};
const buildBootstrapScriptSource = (input) => [
    "(() => {",
    `  const payloadKey = ${JSON.stringify(FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY)};`,
    `  const bootstrapPayload = ${JSON.stringify(input.payload)};`,
    "  const host = typeof globalThis === \"object\" && globalThis !== null ? globalThis : null;",
    "  if (!host) {",
    "    return;",
    "  }",
    "  try {",
    "    Object.defineProperty(host, payloadKey, {",
    "      configurable: false,",
    "      enumerable: false,",
    "      writable: false,",
    "      value: bootstrapPayload",
    "    });",
    "  } catch {",
    "    try {",
    "      host[payloadKey] = bootstrapPayload;",
    "    } catch {",
    "      // ignore assignment fallback failure",
    "    }",
    "  }",
    "})();",
    ""
].join("\n");
const replaceSourceToken = (input) => {
    if (!input.source.includes(input.target)) {
        throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", input.errorMessage);
    }
    return input.source.replace(input.target, input.replacement);
};
const rewriteStagedContentScriptSourceForBridge = (input) => {
    let rewritten = input.source;
    const startupTrustRuntime = asRecord(input.extensionBootstrap?.fingerprint_runtime ?? null);
    const startupTrustRunId = typeof input.extensionBootstrap?.run_id === "string"
        ? input.extensionBootstrap.run_id
        : typeof input.extensionBootstrap?.runId === "string"
            ? input.extensionBootstrap.runId
            : null;
    const startupTrustSessionId = typeof input.extensionBootstrap?.session_id === "string"
        ? input.extensionBootstrap.session_id
        : typeof input.extensionBootstrap?.sessionId === "string"
            ? input.extensionBootstrap.sessionId
            : null;
    rewritten = replaceSourceToken({
        source: rewritten,
        target: "const STAGED_STARTUP_TRUST_RUN_ID = undefined;",
        replacement: `const STAGED_STARTUP_TRUST_RUN_ID = ${JSON.stringify(startupTrustRunId)};`,
        errorMessage: "staged content-script 缺少 startup trust run_id 锚点，无法注入同步 trust 常量"
    });
    rewritten = replaceSourceToken({
        source: rewritten,
        target: "const STAGED_STARTUP_TRUST_SESSION_ID = undefined;",
        replacement: `const STAGED_STARTUP_TRUST_SESSION_ID = ${JSON.stringify(startupTrustSessionId)};`,
        errorMessage: "staged content-script 缺少 startup trust session_id 锚点，无法注入同步 trust 常量"
    });
    rewritten = replaceSourceToken({
        source: rewritten,
        target: "const STAGED_STARTUP_TRUST_FINGERPRINT_RUNTIME = undefined;",
        replacement: `const STAGED_STARTUP_TRUST_FINGERPRINT_RUNTIME = ${JSON.stringify(startupTrustRuntime)};`,
        errorMessage: "staged content-script 缺少 startup trust fingerprint_runtime 锚点，无法注入同步 trust 常量"
    });
    rewritten = replaceSourceToken({
        source: rewritten,
        target: "  installMainWorldEventChannelSecret(bootstrapInput.mainWorldSecret);",
        replacement: [
            `  const bridgeBootstrapFallbackSecret = ${JSON.stringify(input.bridgeSecret)};`,
            "  const bridgeBootstrapSecret =",
            "    typeof bootstrapPayload === \"object\" &&",
            "    bootstrapPayload !== null &&",
            "    !Array.isArray(bootstrapPayload) &&",
            `    typeof bootstrapPayload.${BRIDGE_BOOTSTRAP_PAYLOAD_KEY} === \"string\"`,
            `      ? bootstrapPayload.${BRIDGE_BOOTSTRAP_PAYLOAD_KEY}`,
            "      : bridgeBootstrapFallbackSecret;",
            "  const bootstrapMainWorldSecret =",
            "    typeof bootstrapInput.mainWorldSecret === \"string\" && bootstrapInput.mainWorldSecret.length > 0",
            "      ? bootstrapInput.mainWorldSecret",
            "      : bridgeBootstrapSecret;",
            "  installMainWorldEventChannelSecret(bootstrapMainWorldSecret);"
        ].join("\n"),
        errorMessage: "staged content-script 缺少 main-world secret 安装锚点，无法注入 per-run secret channel"
    });
    rewritten = replaceSourceToken({
        source: rewritten,
        target: "      installMainWorldEventChannelSecret(resolvedBootstrap.mainWorldSecret);",
        replacement: [
            "      const resolvedMainWorldSecret =",
            "        typeof resolvedBootstrap.mainWorldSecret === \"string\" &&",
            "        resolvedBootstrap.mainWorldSecret.length > 0",
            "          ? resolvedBootstrap.mainWorldSecret",
            "          : bridgeBootstrapSecret;",
            "      installMainWorldEventChannelSecret(resolvedMainWorldSecret);"
        ].join("\n"),
        errorMessage: "staged content-script 缺少 fallback main-world secret 安装锚点，无法注入 per-run secret channel"
    });
    return rewritten;
};
const rewriteStagedMainWorldBridgeSourceForBridge = (input) => {
    const expectedEventNames = resolveMainWorldEventNamesForSecret(input.bridgeSecret);
    let rewritten = input.source;
    rewritten = replaceSourceToken({
        source: rewritten,
        target: 'const MAIN_WORLD_EVENT_RESULT_PREFIX = "__mw_res__";',
        replacement: [
            'const MAIN_WORLD_EVENT_RESULT_PREFIX = "__mw_res__";',
            `const EXPECTED_MAIN_WORLD_REQUEST_EVENT = ${JSON.stringify(expectedEventNames.requestEvent)};`,
            `const EXPECTED_MAIN_WORLD_RESULT_EVENT = ${JSON.stringify(expectedEventNames.resultEvent)};`
        ].join("\n"),
        errorMessage: "staged main-world-bridge 缺少 event 常量锚点，无法注入 secret-derived channel"
    });
    rewritten = replaceSourceToken({
        source: rewritten,
        target: "    if (!isValidChannelEventName(requestEvent, MAIN_WORLD_EVENT_REQUEST_PREFIX)) {",
        replacement: [
            "    if (",
            "      requestEvent !== EXPECTED_MAIN_WORLD_REQUEST_EVENT ||",
            "      resultEvent !== EXPECTED_MAIN_WORLD_RESULT_EVENT",
            "    ) {",
            "      return null;",
            "    }",
            "    if (!isValidChannelEventName(requestEvent, MAIN_WORLD_EVENT_REQUEST_PREFIX)) {"
        ].join("\n"),
        errorMessage: "staged main-world-bridge 缺少 channel 校验锚点，无法注入 secret-derived channel"
    });
    return rewritten;
};
const stripEsmSyntaxForClassicScript = (source) => {
    let transformed = source;
    transformed = transformed.replace(/^\s*import\s+[^;]+;\s*$/gm, "");
    transformed = transformed.replace(/^\s*export\s*\{[^;]*\};\s*$/gm, "");
    transformed = transformed.replace(/\bexport\s+const\s+/g, "const ");
    transformed = transformed.replace(/\bexport\s+class\s+/g, "class ");
    transformed = transformed.replace(/\bexport\s+function\s+/g, "function ");
    transformed = transformed.replace(/\nexport\s*\{[\s\S]*?\};?\s*$/m, "\n");
    return transformed.trim();
};
const renderClassicModule = (input) => [
    `const ${input.moduleVar} = (() => {`,
    input.prelude ?? "",
    input.sourceBody,
    `return { ${input.exports.join(", ")} };`,
    "})();",
    ""
]
    .filter((line) => line.length > 0)
    .join("\n");
const buildStagedContentScriptBundle = async (input) => {
    const readSource = async (path) => stripEsmSyntaxForClassicScript(await readFile(path, "utf8"));
    const fingerprintSource = await readSource(join(input.sharedSourceDir, SHARED_FINGERPRINT_PROFILE_PATH));
    const riskStateSource = await readSource(join(input.sharedSourceDir, SHARED_RISK_STATE_PATH));
    const xhsSearchSource = await readSource(join(input.extensionSourceDir, "build", "xhs-search.js"));
    const handlerSource = await readSource(join(input.extensionSourceDir, "build", "content-script-handler.js"));
    const contentScriptSource = await readSource(join(input.extensionSourceDir, CONTENT_SCRIPT_ENTRY_PATH));
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
const rewriteStagedContentScriptForRuntime = async (input) => {
    const sharedSourceDir = await resolveSharedSourceDir(input.extensionSourceDir);
    const bundleSource = await buildStagedContentScriptBundle({
        extensionSourceDir: input.extensionSourceDir,
        sharedSourceDir
    });
    const rewrittenBundleSource = rewriteStagedContentScriptSourceForBridge({
        source: bundleSource,
        bridgeSecret: input.bridgeSecret,
        extensionBootstrap: input.extensionBootstrap
    });
    await writeFile(join(input.stagedExtensionDir, CONTENT_SCRIPT_ENTRY_PATH), `${rewrittenBundleSource}\n`, "utf8");
};
const rewriteStagedMainWorldBridgeForRuntime = async (input) => {
    const mainWorldBridgePath = join(input.stagedExtensionDir, MAIN_WORLD_BRIDGE_ENTRY_PATH);
    const raw = await readFile(mainWorldBridgePath, "utf8");
    const rewritten = rewriteStagedMainWorldBridgeSourceForBridge({
        source: raw,
        bridgeSecret: input.bridgeSecret
    });
    await writeFile(mainWorldBridgePath, rewritten, "utf8");
};
const injectBootstrapScriptIntoManifest = async (manifestPath) => {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    const contentScripts = parsed.content_scripts;
    if (!Array.isArray(contentScripts)) {
        throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", "staged extension manifest 缺少 content_scripts，无法注入 bootstrap 脚本");
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
        const scripts = jsEntries.filter((item) => typeof item === "string");
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
        throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", "staged extension manifest 未包含 build/content-script.js，无法注入 bootstrap 脚本");
    }
    await writeFile(manifestPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
};
const stageExtensionForRun = async (input) => {
    const extensionSourceDir = await resolveExtensionSourceDir();
    const stagedExtensionDir = join(input.profileDir, EXTENSION_STAGING_DIRNAME, sanitizePathSegment(input.runId));
    const stagedExtensionParent = join(input.profileDir, EXTENSION_STAGING_DIRNAME);
    await mkdir(stagedExtensionParent, { recursive: true });
    await rm(stagedExtensionDir, { recursive: true, force: true });
    await cp(extensionSourceDir, stagedExtensionDir, { recursive: true });
    const bridgeSecret = randomUUID();
    const bootstrapPath = join(stagedExtensionDir, EXTENSION_BOOTSTRAP_FILENAME);
    const envelope = {
        schemaVersion: 1,
        runId: input.runId,
        writtenAt: new Date().toISOString(),
        extension_bootstrap: input.extensionBootstrap
    };
    await writeFile(bootstrapPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
    const bootstrapScriptPath = join(stagedExtensionDir, EXTENSION_BOOTSTRAP_SCRIPT_PATH);
    const bootstrapScriptPayload = buildBridgeBootstrapPayload({
        bridgeSecret,
        extensionBootstrap: input.extensionBootstrap
    });
    await writeFile(bootstrapScriptPath, buildBootstrapScriptSource({
        payload: bootstrapScriptPayload
    }), "utf8");
    await rewriteStagedContentScriptForRuntime({
        stagedExtensionDir,
        extensionSourceDir,
        bridgeSecret,
        extensionBootstrap: input.extensionBootstrap
    });
    await rewriteStagedMainWorldBridgeForRuntime({
        stagedExtensionDir,
        bridgeSecret
    });
    await injectBootstrapScriptIntoManifest(join(stagedExtensionDir, "manifest.json"));
    return { stagedExtensionDir, bootstrapPath, bootstrapScriptPath };
};
const cleanupStagedExtensions = async (profileDir) => {
    await rm(join(profileDir, EXTENSION_STAGING_DIRNAME), { recursive: true, force: true });
};
const shouldLaunchHeadless = (params) => params.headless !== false;
const assertProcessAlive = (pid) => {
    try {
        process.kill(pid, 0);
    }
    catch (error) {
        const nodeError = error;
        if (nodeError.code === "ESRCH") {
            throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", "浏览器启动后立即退出");
        }
        throw error;
    }
};
const waitForBrowserReady = async (profileDir, pid, launchedAtMs) => {
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
const waitForSupervisorState = async (input) => {
    for (let attempt = 0; attempt < SUPERVISOR_STATE_WAIT_ATTEMPTS; attempt += 1) {
        const state = await readInstanceState(input.stateFilePath);
        if (state &&
            state.launchToken === input.expectedToken &&
            state.controllerPid === input.expectedControllerPid &&
            state.browserPid > 0) {
            return state;
        }
        await sleep(SUPERVISOR_STATE_WAIT_INTERVAL_MS);
    }
    throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", "浏览器控制进程未写入可用状态");
};
const launchProcess = async (supervisorScriptPath, executablePath, args, input) => {
    const launchedAtMs = Date.now();
    const launchedAt = new Date(launchedAtMs).toISOString();
    const launchArgsBase64 = Buffer.from(JSON.stringify(args), "utf8").toString("base64");
    const child = spawn(process.execPath, [
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
    ], {
        detached: true,
        stdio: "ignore"
    });
    child.unref();
    const launched = await new Promise((resolve, reject) => {
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
export const launchBrowser = async (input) => {
    const launchMode = input.launchMode ?? "load_extension";
    const executablePath = await resolveExecutablePath(input.params, {
        allowUnsupportedExtensionBrowser: launchMode === "official_chrome_persistent_extension"
    });
    const supervisorScriptPath = await resolveSupervisorScriptPath();
    const startUrl = parseStartUrl(input.params);
    const launchArgs = [
        `--user-data-dir=${input.profileDir}`,
        "--profile-directory=Default",
        "--new-window",
        "--no-first-run",
        "--no-default-browser-check"
    ];
    if (launchMode === "load_extension") {
        const extensionBootstrap = resolveExtensionBootstrapPayload(input);
        const extensionStaging = await stageExtensionForRun({
            profileDir: input.profileDir,
            runId: input.runId,
            extensionBootstrap
        });
        launchArgs.push(`--disable-extensions-except=${extensionStaging.stagedExtensionDir}`, `--load-extension=${extensionStaging.stagedExtensionDir}`);
    }
    if (input.proxyUrl !== null) {
        launchArgs.push(`--proxy-server=${input.proxyUrl}`);
    }
    const shouldHeadless = input.command === "runtime.login" ? false : shouldLaunchHeadless(input.params);
    if (shouldHeadless) {
        launchArgs.push("--headless=new");
    }
    launchArgs.push(startUrl);
    const launchToken = randomUUID();
    const stateFilePath = getStateFilePath(input.profileDir);
    const controlFilePath = getControlFilePath(input.profileDir);
    let controllerPid = null;
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
    }
    catch (error) {
        if (controllerPid !== null && isProcessAlive(controllerPid)) {
            try {
                process.kill(controllerPid, "SIGTERM");
            }
            catch {
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
    finally {
        if (!launchSucceeded && launchMode === "load_extension") {
            await cleanupStagedExtensions(input.profileDir);
        }
    }
};
export const shutdownBrowserSession = async (input) => {
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
    const command = {
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
        }
        catch {
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
