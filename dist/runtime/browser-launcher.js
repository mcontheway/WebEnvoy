import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
const KNOWN_BROWSER_CANDIDATES = {
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
const hasPathSegment = (value) => /[\\/]/.test(value);
export class BrowserLaunchError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = "BrowserLaunchError";
        this.code = code;
    }
}
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
        return markerStat.mtimeMs >= launchedAtMs;
    }
    catch {
        return false;
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
const resolveExecutablePath = async (params) => {
    const explicitFromParams = parseOptionalString(params.browserPath);
    if (explicitFromParams !== null) {
        throw new BrowserLaunchError("BROWSER_INVALID_ARGUMENT", "params.browserPath 不受支持，请使用受信环境变量 WEBENVOY_BROWSER_PATH");
    }
    const explicitFromEnv = parseOptionalString(process.env.WEBENVOY_BROWSER_PATH);
    const candidates = [
        explicitFromEnv,
        ...(KNOWN_BROWSER_CANDIDATES[process.platform] ?? [])
    ].filter((item) => item !== null);
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
    throw new BrowserLaunchError("BROWSER_NOT_FOUND", "未找到系统 Chrome/Chromium，可通过受信环境变量 WEBENVOY_BROWSER_PATH 显式指定");
};
const shouldLaunchHeadless = (params) => params.headless !== false;
const READY_WAIT_MAX_ATTEMPTS = 20;
const READY_WAIT_INTERVAL_MS = 150;
const READY_MIN_UPTIME_MS = 600;
const READY_CONFIRM_DELAY_MS = 120;
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
            await new Promise((resolve) => {
                setTimeout(resolve, READY_CONFIRM_DELAY_MS);
            });
            assertProcessAlive(pid);
            return;
        }
        await new Promise((resolve) => {
            setTimeout(resolve, READY_WAIT_INTERVAL_MS);
        });
    }
    throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", "浏览器启动超时，未完成最小 profile 初始化");
};
const launchProcess = async (executablePath, args) => {
    const child = spawn(executablePath, args, {
        detached: true,
        stdio: "ignore"
    });
    const launchedAtMs = Date.now();
    const launchedAt = new Date(launchedAtMs).toISOString();
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
    const executablePath = await resolveExecutablePath(input.params);
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
    const shouldHeadless = input.command === "runtime.login" ? false : shouldLaunchHeadless(input.params);
    if (shouldHeadless) {
        launchArgs.push("--headless=new");
    }
    launchArgs.push(parseStartUrl(input.params));
    try {
        const launched = await launchProcess(executablePath, launchArgs);
        await waitForBrowserReady(input.profileDir, launched.pid, launched.launchedAtMs);
        return {
            browserPath: executablePath,
            browserPid: launched.pid,
            launchArgs: [...launchArgs],
            launchedAt: launched.launchedAt
        };
    }
    catch (error) {
        if (error instanceof BrowserLaunchError) {
            throw error;
        }
        throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", "浏览器启动失败", {
            cause: error
        });
    }
};
