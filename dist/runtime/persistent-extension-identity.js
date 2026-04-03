import { execFile } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { CliError } from "../core/errors.js";
import { isValidNativeHostName } from "../install/native-host.js";
import { BrowserLaunchError, isUnsupportedBrandedChromeForExtensions, resolvePreferredBrowserVersionTruthSource } from "./browser-launcher.js";
const DEFAULT_NATIVE_HOST_NAME = "com.webenvoy.host";
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
const BROWSER_CHANNELS = ["chrome", "chrome_beta", "chromium", "brave", "edge"];
const execFileAsync = promisify(execFile);
const DEFAULT_IDENTITY_PREFLIGHT_ADAPTERS = {
    resolvePreferredBrowserVersionTruthSource,
    isUnsupportedBrandedChromeForExtensions,
    execFile: execFileAsync,
    platform: () => process.platform
};
let identityPreflightAdapters = DEFAULT_IDENTITY_PREFLIGHT_ADAPTERS;
export const setIdentityPreflightAdaptersForTests = (overrides) => {
    identityPreflightAdapters = {
        ...DEFAULT_IDENTITY_PREFLIGHT_ADAPTERS,
        ...overrides
    };
};
export const resetIdentityPreflightAdaptersForTests = () => {
    identityPreflightAdapters = DEFAULT_IDENTITY_PREFLIGHT_ADAPTERS;
};
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const isBrowserChannel = (value) => BROWSER_CHANNELS.includes(value);
const ensureValidNativeHostName = (nativeHostName) => {
    if (!isValidNativeHostName(nativeHostName)) {
        throw new CliError("ERR_PROFILE_INVALID", "persistent_extension_identity.native_host_name 格式非法，必须满足 Chrome Native Messaging host 命名规则", {
            details: {
                ability_id: "runtime.identity_preflight",
                stage: "input_validation",
                reason: "IDENTITY_BINDING_INVALID_NATIVE_HOST_NAME"
            }
        });
    }
};
const resolveManifestPathForChannel = (browserChannel, nativeHostName) => {
    const platform = identityPreflightAdapters.platform();
    if (platform === "darwin") {
        const baseByChannel = {
            chrome: join(homedir(), "Library", "Application Support", "Google", "Chrome"),
            chrome_beta: join(homedir(), "Library", "Application Support", "Google", "Chrome Beta"),
            chromium: join(homedir(), "Library", "Application Support", "Chromium"),
            brave: join(homedir(), "Library", "Application Support", "BraveSoftware", "Brave-Browser"),
            edge: join(homedir(), "Library", "Application Support", "Microsoft Edge")
        };
        return join(baseByChannel[browserChannel], "NativeMessagingHosts", `${nativeHostName}.json`);
    }
    if (platform === "linux") {
        const baseByChannel = {
            chrome: join(homedir(), ".config", "google-chrome"),
            chrome_beta: join(homedir(), ".config", "google-chrome-beta"),
            chromium: join(homedir(), ".config", "chromium"),
            brave: join(homedir(), ".config", "BraveSoftware", "Brave-Browser"),
            edge: join(homedir(), ".config", "microsoft-edge")
        };
        return join(baseByChannel[browserChannel], "NativeMessagingHosts", `${nativeHostName}.json`);
    }
    return join(homedir(), `${nativeHostName}.json`);
};
const resolveWindowsRegistryKeyForChannel = (browserChannel, nativeHostName) => {
    if (identityPreflightAdapters.platform() !== "win32") {
        return null;
    }
    const keyByChannel = {
        chrome: "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts",
        chrome_beta: "HKCU\\Software\\Google\\Chrome Beta\\NativeMessagingHosts",
        chromium: "HKCU\\Software\\Chromium\\NativeMessagingHosts",
        brave: "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts",
        edge: "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts"
    };
    return `${keyByChannel[browserChannel]}\\${nativeHostName}`;
};
const inferResolvedBrowserChannel = (input) => {
    const normalizedVersion = input.browserVersion?.trim().toLowerCase() ?? "";
    const normalizedPath = input.browserPath?.toLowerCase() ?? "";
    if (normalizedVersion.includes("google chrome beta") || normalizedPath.includes("chrome beta")) {
        return "chrome_beta";
    }
    if (normalizedVersion.includes("google chrome")) {
        return "chrome";
    }
    if (normalizedVersion.includes("chromium") || normalizedPath.includes("chromium")) {
        return "chromium";
    }
    if (normalizedVersion.includes("microsoft edge") || normalizedPath.includes("microsoft/edge")) {
        return "edge";
    }
    if (normalizedVersion.includes("brave") || normalizedPath.includes("brave")) {
        return "brave";
    }
    return null;
};
const expandWindowsEnvVariables = (value) => value.replace(/%([^%]+)%/g, (_match, name) => process.env[name] ?? `%${name}%`);
const parseWindowsRegistryDefaultValue = (stdout) => {
    const lines = stdout.split(/\r?\n/);
    for (const line of lines) {
        const match = line.match(/^\s*\(Default\)\s+REG_\w+\s+(.+?)\s*$/);
        if (match) {
            const expanded = expandWindowsEnvVariables(match[1].trim());
            return isAbsolute(expanded) ? expanded : resolve(expanded);
        }
    }
    return null;
};
const resolveManifestPathForBinding = async (binding, _profileDir) => {
    if (binding.manifestPath) {
        return binding.manifestPath;
    }
    if (identityPreflightAdapters.platform() === "win32") {
        const registryKey = resolveWindowsRegistryKeyForChannel(binding.browserChannel, binding.nativeHostName);
        if (registryKey) {
            try {
                const { stdout } = await identityPreflightAdapters.execFile("reg", ["query", registryKey, "/ve"], {
                    encoding: "utf8"
                });
                const manifestPath = parseWindowsRegistryDefaultValue(stdout);
                if (manifestPath) {
                    return manifestPath;
                }
            }
            catch {
                // Windows Native Messaging discovery is registry-based; without a registered key
                // there is no stable manifest path we can trust as the official install.
            }
        }
        return null;
    }
    return resolveManifestPathForChannel(binding.browserChannel, binding.nativeHostName);
};
const parsePersistentExtensionBindingFromParams = (params) => {
    const raw = asRecord(params.persistent_extension_identity) ??
        asRecord(params.persistentExtensionIdentity);
    if (!raw) {
        return null;
    }
    const extensionId = asNonEmptyString(raw.extension_id) ?? asNonEmptyString(raw.extensionId);
    if (!extensionId || !EXTENSION_ID_PATTERN.test(extensionId)) {
        throw new CliError("ERR_PROFILE_INVALID", "persistent_extension_identity.extension_id 必须是 32 位 Chrome extension id", {
            details: {
                ability_id: "runtime.identity_preflight",
                stage: "input_validation",
                reason: "IDENTITY_BINDING_INVALID_EXTENSION_ID"
            }
        });
    }
    const nativeHostName = asNonEmptyString(raw.native_host_name) ??
        asNonEmptyString(raw.nativeHostName) ??
        DEFAULT_NATIVE_HOST_NAME;
    ensureValidNativeHostName(nativeHostName);
    const browserChannelRaw = asNonEmptyString(raw.browser_channel) ?? asNonEmptyString(raw.browserChannel) ?? "chrome";
    if (!isBrowserChannel(browserChannelRaw)) {
        throw new CliError("ERR_PROFILE_INVALID", "persistent_extension_identity.browser_channel 不受支持", {
            details: {
                ability_id: "runtime.identity_preflight",
                stage: "input_validation",
                reason: "IDENTITY_BINDING_INVALID_BROWSER_CHANNEL"
            }
        });
    }
    const manifestPathRaw = asNonEmptyString(raw.manifest_path) ??
        asNonEmptyString(raw.manifestPath) ??
        asNonEmptyString(process.env.WEBENVOY_NATIVE_HOST_MANIFEST_PATH) ??
        null;
    const manifestPath = manifestPathRaw === null
        ? null
        : isAbsolute(manifestPathRaw)
            ? manifestPathRaw
            : resolve(manifestPathRaw);
    return {
        extensionId,
        nativeHostName,
        browserChannel: browserChannelRaw,
        manifestPath
    };
};
const parsePersistentExtensionBindingFromMeta = (meta) => {
    const raw = meta?.persistentExtensionBinding;
    if (!raw) {
        return null;
    }
    if (typeof raw.extensionId !== "string" ||
        !EXTENSION_ID_PATTERN.test(raw.extensionId) ||
        typeof raw.browserChannel !== "string" ||
        !isBrowserChannel(raw.browserChannel)) {
        return null;
    }
    if (typeof raw.nativeHostName !== "string") {
        return null;
    }
    const nativeHostName = raw.nativeHostName.trim();
    if (nativeHostName.length === 0) {
        return null;
    }
    if (!isValidNativeHostName(nativeHostName)) {
        throw new CliError("ERR_PROFILE_INVALID", "profile meta 中的 persistentExtensionBinding.nativeHostName 格式非法", {
            details: {
                ability_id: "runtime.identity_preflight",
                stage: "input_validation",
                reason: "IDENTITY_BINDING_INVALID_NATIVE_HOST_NAME"
            }
        });
    }
    if (raw.manifestPath !== null && typeof raw.manifestPath !== "string") {
        return null;
    }
    return {
        extensionId: raw.extensionId,
        nativeHostName,
        browserChannel: raw.browserChannel,
        manifestPath: raw.manifestPath === null
            ? null
            : isAbsolute(raw.manifestPath)
                ? raw.manifestPath
                : resolve(raw.manifestPath)
    };
};
const readNativeHostManifest = async (manifestPath) => {
    try {
        const raw = await readFile(manifestPath, "utf8");
        const parsed = JSON.parse(raw);
        const name = asNonEmptyString(parsed.name);
        const allowedOrigins = Array.isArray(parsed.allowed_origins)
            ? parsed.allowed_origins.filter((entry) => typeof entry === "string")
            : [];
        if (!name) {
            return null;
        }
        return {
            name,
            allowed_origins: allowedOrigins
        };
    }
    catch {
        return null;
    }
};
const readProfileExtensionStateFromPreferences = (input, extensionId) => {
    const extensions = asRecord(input.extensions);
    const settings = asRecord(extensions?.settings);
    const extensionEntry = asRecord(settings?.[extensionId]);
    if (!extensionEntry) {
        return {
            state: "missing",
            unpackedPath: null
        };
    }
    const state = extensionEntry.state;
    const unpackedPath = extensionEntry.location === 4 && asNonEmptyString(extensionEntry.path)
        ? asNonEmptyString(extensionEntry.path)
        : null;
    if (state === 1 || state === true) {
        return {
            state: "enabled",
            unpackedPath
        };
    }
    if (typeof state === "number" || typeof state === "boolean") {
        return {
            state: "disabled",
            unpackedPath
        };
    }
    return {
        state: "enabled",
        unpackedPath
    };
};
const resolveProfileExtensionState = async (profileDir, extensionId) => {
    const preferenceCandidates = [
        join(profileDir, "Default", "Preferences"),
        join(profileDir, "Default", "Secure Preferences"),
        join(profileDir, "Secure Preferences")
    ];
    let foundDisabled = false;
    let enabledInPreferences = false;
    let unpackedPath = null;
    for (const preferencePath of preferenceCandidates) {
        try {
            const raw = await readFile(preferencePath, "utf8");
            const parsed = JSON.parse(raw);
            const record = asRecord(parsed);
            if (!record) {
                continue;
            }
            const preferenceState = readProfileExtensionStateFromPreferences(record, extensionId);
            if (preferenceState.state === "enabled") {
                enabledInPreferences = true;
                if (preferenceState.unpackedPath) {
                    unpackedPath = preferenceState.unpackedPath;
                }
                continue;
            }
            if (preferenceState.state === "disabled") {
                foundDisabled = true;
            }
        }
        catch {
            // ignore preference file read/parse failures and continue probing
        }
    }
    if (!enabledInPreferences) {
        return foundDisabled ? "disabled" : "missing";
    }
    if (unpackedPath) {
        try {
            await access(unpackedPath);
            return "enabled";
        }
        catch {
            return "missing";
        }
    }
    try {
        const installedVersions = await readdir(join(profileDir, "Default", "Extensions", extensionId));
        return installedVersions.length > 0 ? "enabled" : "missing";
    }
    catch {
        return "missing";
    }
};
const buildBlockingResult = (input) => ({
    ...input,
    blocking: true
});
export const buildIdentityPreflightError = (result) => {
    const details = {
        ability_id: "runtime.identity_preflight",
        stage: "execution",
        reason: result.failureReason,
        identity_binding_state: result.identityBindingState,
        browser_mode: result.mode,
        browser_version: result.browserVersion,
        browser_path: result.browserPath,
        extension_id: result.binding?.extensionId ?? null,
        native_host_name: result.binding?.nativeHostName ?? null,
        browser_channel: result.binding?.browserChannel ?? null,
        manifest_path: result.manifestPath,
        expected_origin: result.expectedOrigin,
        allowed_origins: result.allowedOrigins
    };
    if (result.failureReason === "BOOTSTRAP_PENDING") {
        return new CliError("ERR_RUNTIME_BOOTSTRAP_PENDING", "identity preflight 已通过，但 persistent extension bootstrap 尚未实现", { details, retryable: false });
    }
    if (result.identityBindingState === "missing") {
        return new CliError("ERR_RUNTIME_IDENTITY_NOT_BOUND", "official Chrome persistent extension identity 未绑定，无法进入运行阶段", { details, retryable: false });
    }
    return new CliError("ERR_RUNTIME_IDENTITY_MISMATCH", "official Chrome persistent extension identity 不一致，已阻止继续执行", { details, retryable: false });
};
export const runIdentityPreflight = async (input) => {
    let browserPath = null;
    let browserVersion = null;
    try {
        const truth = await identityPreflightAdapters.resolvePreferredBrowserVersionTruthSource(input.params);
        browserPath = truth.executablePath;
        browserVersion = truth.browserVersion;
    }
    catch (error) {
        if (!(error instanceof BrowserLaunchError)) {
            return {
                mode: "load_extension",
                browserPath: null,
                browserVersion: null,
                identityBindingState: "not_applicable",
                binding: null,
                manifestPath: null,
                expectedOrigin: null,
                allowedOrigins: [],
                blocking: false,
                failureReason: "IDENTITY_PREFLIGHT_NOT_REQUIRED"
            };
        }
        return {
            mode: "load_extension",
            browserPath: null,
            browserVersion: null,
            identityBindingState: "not_applicable",
            binding: null,
            manifestPath: null,
            expectedOrigin: null,
            allowedOrigins: [],
            blocking: false,
            failureReason: "IDENTITY_PREFLIGHT_NOT_REQUIRED"
        };
    }
    if (!identityPreflightAdapters.isUnsupportedBrandedChromeForExtensions(browserVersion)) {
        return {
            mode: "load_extension",
            browserPath,
            browserVersion,
            identityBindingState: "not_applicable",
            binding: null,
            manifestPath: null,
            expectedOrigin: null,
            allowedOrigins: [],
            blocking: false,
            failureReason: "IDENTITY_PREFLIGHT_NOT_REQUIRED"
        };
    }
    const binding = parsePersistentExtensionBindingFromParams(input.params) ??
        parsePersistentExtensionBindingFromMeta(input.meta);
    if (!binding) {
        return buildBlockingResult({
            mode: "official_chrome_persistent_extension",
            browserPath,
            browserVersion,
            identityBindingState: "missing",
            binding: null,
            manifestPath: null,
            expectedOrigin: null,
            allowedOrigins: [],
            failureReason: "IDENTITY_BINDING_MISSING"
        });
    }
    const expectedOrigin = `chrome-extension://${binding.extensionId}/`;
    const profileDir = asNonEmptyString(input.meta?.profileDir) ?? asNonEmptyString(input.profileDir);
    const resolvedBrowserChannel = inferResolvedBrowserChannel({
        browserPath,
        browserVersion
    });
    if (resolvedBrowserChannel !== null && binding.browserChannel !== resolvedBrowserChannel) {
        return buildBlockingResult({
            mode: "official_chrome_persistent_extension",
            browserPath,
            browserVersion,
            identityBindingState: "mismatch",
            binding,
            manifestPath: binding.manifestPath,
            expectedOrigin,
            allowedOrigins: [],
            failureReason: "IDENTITY_BINDING_CONFLICT"
        });
    }
    const manifestPath = await resolveManifestPathForBinding(binding, profileDir ?? null);
    if (manifestPath === null) {
        return buildBlockingResult({
            mode: "official_chrome_persistent_extension",
            browserPath,
            browserVersion,
            identityBindingState: "mismatch",
            binding,
            manifestPath: null,
            expectedOrigin,
            allowedOrigins: [],
            failureReason: "IDENTITY_MANIFEST_MISSING"
        });
    }
    const manifest = await readNativeHostManifest(manifestPath);
    if (!manifest) {
        return buildBlockingResult({
            mode: "official_chrome_persistent_extension",
            browserPath,
            browserVersion,
            identityBindingState: "mismatch",
            binding: {
                ...binding,
                manifestPath
            },
            manifestPath,
            expectedOrigin,
            allowedOrigins: [],
            failureReason: "IDENTITY_MANIFEST_MISSING"
        });
    }
    if (manifest.name !== binding.nativeHostName) {
        return buildBlockingResult({
            mode: "official_chrome_persistent_extension",
            browserPath,
            browserVersion,
            identityBindingState: "mismatch",
            binding: {
                ...binding,
                manifestPath
            },
            manifestPath,
            expectedOrigin,
            allowedOrigins: manifest.allowed_origins,
            failureReason: "IDENTITY_NATIVE_HOST_NAME_MISMATCH"
        });
    }
    if (!manifest.allowed_origins.includes(expectedOrigin)) {
        return buildBlockingResult({
            mode: "official_chrome_persistent_extension",
            browserPath,
            browserVersion,
            identityBindingState: "mismatch",
            binding: {
                ...binding,
                manifestPath
            },
            manifestPath,
            expectedOrigin,
            allowedOrigins: manifest.allowed_origins,
            failureReason: "IDENTITY_ALLOWED_ORIGIN_MISSING"
        });
    }
    if (profileDir) {
        const extensionState = await resolveProfileExtensionState(profileDir, binding.extensionId);
        if (extensionState !== "enabled") {
            return buildBlockingResult({
                mode: "official_chrome_persistent_extension",
                browserPath,
                browserVersion,
                identityBindingState: "missing",
                binding: {
                    ...binding,
                    manifestPath
                },
                manifestPath,
                expectedOrigin,
                allowedOrigins: manifest.allowed_origins,
                failureReason: "IDENTITY_BINDING_MISSING"
            });
        }
    }
    return {
        mode: "official_chrome_persistent_extension",
        browserPath,
        browserVersion,
        identityBindingState: "bound",
        binding: {
            ...binding,
            manifestPath
        },
        manifestPath,
        expectedOrigin,
        allowedOrigins: manifest.allowed_origins,
        blocking: false,
        failureReason: "IDENTITY_PREFLIGHT_PASSED"
    };
};
