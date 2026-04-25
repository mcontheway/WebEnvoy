import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupStagedExtensions, EXTENSION_BOOTSTRAP_FILENAME, EXTENSION_BOOTSTRAP_SCRIPT_FILENAME, EXTENSION_STAGING_DIRNAME, resolveExtensionBootstrapPayload, stageExtensionForRun } from "./browser-extension-staging.js";
import { isUnsupportedBrandedChromeForExtensions, resolveBrowserExecutablePath, resolveBrowserVersionOutputForFingerprint, resolveBrowserVersionTruthSource, resolveExecutablePath, resolvePreferredBrowserCandidates, resolvePreferredBrowserVersionTruthSource } from "./browser-discovery.js";
import { BrowserLaunchError } from "./browser-launcher-shared.js";
export { BrowserLaunchError } from "./browser-launcher-shared.js";
export { EXTENSION_BOOTSTRAP_FILENAME, EXTENSION_BOOTSTRAP_SCRIPT_FILENAME, EXTENSION_STAGING_DIRNAME, isUnsupportedBrandedChromeForExtensions, resolveBrowserExecutablePath, resolveExecutablePath, resolveBrowserVersionOutputForFingerprint, resolveBrowserVersionTruthSource, resolvePreferredBrowserCandidates, resolvePreferredBrowserVersionTruthSource };
export const BROWSER_STATE_FILENAME = "__webenvoy_browser_instance.json";
export const BROWSER_CONTROL_FILENAME = "__webenvoy_browser_control.json";
const READY_WAIT_MAX_ATTEMPTS = 80;
const READY_WAIT_INTERVAL_MS = 150;
const READY_MIN_UPTIME_MS = 600;
const READY_CONFIRM_DELAY_MS = 120;
const READY_MARKER_GRANULARITY_TOLERANCE_MS = 1_000;
const SUPERVISOR_STATE_WAIT_ATTEMPTS = 40;
const SUPERVISOR_STATE_WAIT_INTERVAL_MS = 80;
const SUPERVISOR_SHUTDOWN_TIMEOUT_MS = 4_000;
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
        await access(path);
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
const getBrowserInstanceArtifactPaths = (profileDir) => ({
    stateFilePath: join(profileDir, BROWSER_STATE_FILENAME),
    controlFilePath: join(profileDir, BROWSER_CONTROL_FILENAME)
});
const cleanupSupervisorArtifacts = async (profileDir) => {
    const artifactPaths = getBrowserInstanceArtifactPaths(profileDir);
    await deleteFileQuietly(artifactPaths.stateFilePath);
    await deleteFileQuietly(artifactPaths.controlFilePath);
};
const parseBrowserInstanceState = (raw) => {
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
const readBrowserInstanceState = async (path) => {
    try {
        const raw = await readFile(path, "utf8");
        return parseBrowserInstanceState(raw);
    }
    catch (error) {
        const nodeError = error;
        if (nodeError.code === "ENOENT") {
            return null;
        }
        return null;
    }
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
const prepareBrowserInstanceArtifacts = async (profileDir) => {
    const artifactPaths = getBrowserInstanceArtifactPaths(profileDir);
    await mkdir(profileDir, { recursive: true });
    await deleteFileQuietly(artifactPaths.stateFilePath);
    await deleteFileQuietly(artifactPaths.controlFilePath);
};
const waitForBrowserInstanceState = async (input) => {
    for (let attempt = 0; attempt < SUPERVISOR_STATE_WAIT_ATTEMPTS; attempt += 1) {
        const state = await readBrowserInstanceState(input.stateFilePath);
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
    const executionSurface = shouldHeadless ? "headless_browser" : "real_browser";
    if (shouldHeadless) {
        launchArgs.push("--headless=new");
    }
    launchArgs.push(startUrl);
    const launchToken = randomUUID();
    const artifactPaths = getBrowserInstanceArtifactPaths(input.profileDir);
    let controllerPid = null;
    let launchSucceeded = false;
    try {
        await prepareBrowserInstanceArtifacts(input.profileDir);
        const launched = await launchProcess(supervisorScriptPath, executablePath, launchArgs, {
            stateFilePath: artifactPaths.stateFilePath,
            controlFilePath: artifactPaths.controlFilePath,
            launchToken,
            profileDir: input.profileDir,
            runId: input.runId
        });
        controllerPid = launched.pid;
        const state = await waitForBrowserInstanceState({
            stateFilePath: artifactPaths.stateFilePath,
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
            launchedAt: launched.launchedAt,
            headless: shouldHeadless,
            executionSurface
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
    const artifactPaths = getBrowserInstanceArtifactPaths(input.profileDir);
    const state = await readBrowserInstanceState(artifactPaths.stateFilePath);
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
    await writeFile(artifactPaths.controlFilePath, `${JSON.stringify(command, null, 2)}\n`, "utf8");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const controllerAlive = isProcessAlive(input.controllerPid);
        const nextState = await readBrowserInstanceState(artifactPaths.stateFilePath);
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
        const nextState = await readBrowserInstanceState(artifactPaths.stateFilePath);
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
