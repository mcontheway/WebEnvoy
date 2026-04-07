import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
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
const readTrimmedEnvString = (value) => {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
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
const pathExists = async (path) => {
    try {
        await access(path, fsConstants.F_OK);
        return true;
    }
    catch {
        return false;
    }
};
export class BrowserLaunchError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = "BrowserLaunchError";
        this.code = code;
    }
}
export const resolvePreferredBrowserCandidates = (platform, explicitFromEnv) => [explicitFromEnv, ...(KNOWN_BROWSER_CANDIDATES[platform] ?? [])].filter((item) => item !== null);
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
const resolveBrowserExecutableCandidatePath = async (candidate) => {
    if (isAbsolute(candidate) || hasPathSegment(candidate)) {
        if (await pathExists(candidate)) {
            return candidate;
        }
        return null;
    }
    return resolveCommandFromPath(candidate);
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
export const resolveBrowserExecutablePath = async (params, options) => {
    const explicitFromParams = parseOptionalString(params.browserPath);
    if (explicitFromParams !== null) {
        throw new BrowserLaunchError("BROWSER_INVALID_ARGUMENT", "params.browserPath 不受支持，请使用受信环境变量 WEBENVOY_BROWSER_PATH");
    }
    const explicitFromEnv = parseOptionalString(process.env.WEBENVOY_BROWSER_PATH);
    const candidates = resolvePreferredBrowserCandidates(process.platform, explicitFromEnv);
    let brandedChromeRejected = false;
    for (const candidate of candidates) {
        const resolvedCandidate = await resolveBrowserExecutableCandidatePath(candidate);
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
    const executablePath = await resolveBrowserExecutableCandidatePath(candidate);
    if (executablePath === null) {
        return null;
    }
    return {
        executablePath,
        browserVersion: readTrimmedEnvString(await readBrowserVersionOutput(executablePath))
    };
};
export const resolveBrowserVersionTruthSource = async (params = {}, options) => {
    const executablePath = await resolveBrowserExecutablePath(params, options);
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
    const candidates = resolvePreferredBrowserCandidates(process.platform, explicitFromEnv);
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
