import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { CliError } from "../core/errors.js";
import { isUnsupportedBrandedChromeForExtensions, resolveBrowserVersionTruthSource } from "./browser-launcher.js";
const DEFAULT_NATIVE_HOST_NAME = "com.webenvoy.host";
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
const BROWSER_CHANNELS = ["chrome", "chrome_beta", "chromium", "brave", "edge"];
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const isBrowserChannel = (value) => BROWSER_CHANNELS.includes(value);
const resolveManifestPathForChannel = (browserChannel, nativeHostName) => {
    if (process.platform === "darwin") {
        const baseByChannel = {
            chrome: join(homedir(), "Library", "Application Support", "Google", "Chrome"),
            chrome_beta: join(homedir(), "Library", "Application Support", "Google", "Chrome Beta"),
            chromium: join(homedir(), "Library", "Application Support", "Chromium"),
            brave: join(homedir(), "Library", "Application Support", "BraveSoftware", "Brave-Browser"),
            edge: join(homedir(), "Library", "Application Support", "Microsoft Edge")
        };
        return join(baseByChannel[browserChannel], "NativeMessagingHosts", `${nativeHostName}.json`);
    }
    if (process.platform === "linux") {
        const baseByChannel = {
            chrome: join(homedir(), ".config", "google-chrome"),
            chrome_beta: join(homedir(), ".config", "google-chrome-beta"),
            chromium: join(homedir(), ".config", "chromium"),
            brave: join(homedir(), ".config", "BraveSoftware", "Brave-Browser"),
            edge: join(homedir(), ".config", "microsoft-edge")
        };
        return join(baseByChannel[browserChannel], "NativeMessagingHosts", `${nativeHostName}.json`);
    }
    if (process.platform === "win32") {
        const localAppData = process.env.LOCALAPPDATA ?? process.env.APPDATA ?? homedir();
        return join(localAppData, "WebEnvoy", `${nativeHostName}.json`);
    }
    return join(homedir(), `${nativeHostName}.json`);
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
        const truth = await resolveBrowserVersionTruthSource(input.params, {
            allowUnsupportedExtensionBrowser: true
        });
        browserPath = truth.executablePath;
        browserVersion = truth.browserVersion;
    }
    catch {
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
    if (!isUnsupportedBrandedChromeForExtensions(browserVersion)) {
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
    const bindingFromParams = parsePersistentExtensionBindingFromParams(input.params);
    const bindingFromMeta = input.meta?.persistentExtensionBinding ?? null;
    const mergedBindingFromParams = bindingFromParams === null
        ? null
        : {
            ...bindingFromParams,
            manifestPath: bindingFromParams.manifestPath ?? bindingFromMeta?.manifestPath ?? null
        };
    if (mergedBindingFromParams && bindingFromMeta) {
        const sameBinding = mergedBindingFromParams.extensionId === bindingFromMeta.extensionId &&
            mergedBindingFromParams.nativeHostName === bindingFromMeta.nativeHostName &&
            mergedBindingFromParams.browserChannel === bindingFromMeta.browserChannel &&
            mergedBindingFromParams.manifestPath === bindingFromMeta.manifestPath;
        if (!sameBinding) {
            return buildBlockingResult({
                mode: "official_chrome_persistent_extension",
                browserPath,
                browserVersion,
                identityBindingState: "mismatch",
                binding: bindingFromMeta,
                manifestPath: mergedBindingFromParams.manifestPath ?? bindingFromMeta.manifestPath ?? null,
                expectedOrigin: `chrome-extension://${bindingFromMeta.extensionId}/`,
                allowedOrigins: [],
                failureReason: "IDENTITY_BINDING_CONFLICT"
            });
        }
    }
    const binding = mergedBindingFromParams ?? bindingFromMeta;
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
    const manifestPath = binding.manifestPath ??
        resolveManifestPathForChannel(binding.browserChannel, binding.nativeHostName);
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
        failureReason: "BOOTSTRAP_PENDING"
    };
};
