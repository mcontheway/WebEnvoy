import { randomUUID } from "node:crypto";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserLaunchError } from "./browser-launcher-shared.js";
export const EXTENSION_STAGING_DIRNAME = "__webenvoy_extension_staging";
export const EXTENSION_BOOTSTRAP_FILENAME = "__webenvoy_fingerprint_bootstrap.json";
export const EXTENSION_BOOTSTRAP_SCRIPT_FILENAME = "__webenvoy_fingerprint_bootstrap.js";
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
const pathExists = async (path) => {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
};
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
const replaceSourceToken = (input) => {
    if (!input.source.includes(input.target)) {
        throw new BrowserLaunchError("BROWSER_LAUNCH_FAILED", input.errorMessage);
    }
    return input.source.replace(input.target, input.replacement);
};
const buildExtensionBootstrapEnvelope = (input) => ({
    schemaVersion: 1,
    runId: input.runId,
    writtenAt: new Date().toISOString(),
    extension_bootstrap: input.extensionBootstrap
});
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
const rewriteStagedContentScriptSourceForBridge = (input) => {
    let rewritten = input.source;
    rewritten = rewritten.replace("/* WebEnvoy classic content script bundle for Chrome MV3 content_scripts. */", "/* WebEnvoy staged content script bundle: generated at runtime for MV3 classic script compatibility. */");
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
const buildStagedContentScriptBundle = async (input) => {
    return readFile(join(input.extensionSourceDir, CONTENT_SCRIPT_ENTRY_PATH), "utf8");
};
export const resolveExtensionSourceDir = async () => {
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
export const writeExtensionBootstrapFiles = async (input) => {
    const bootstrapPath = join(input.stagedExtensionDir, EXTENSION_BOOTSTRAP_FILENAME);
    await writeFile(bootstrapPath, `${JSON.stringify(buildExtensionBootstrapEnvelope({
        runId: input.runId,
        extensionBootstrap: input.extensionBootstrap
    }), null, 2)}\n`, "utf8");
    const bootstrapScriptPath = join(input.stagedExtensionDir, EXTENSION_BOOTSTRAP_SCRIPT_PATH);
    await writeFile(bootstrapScriptPath, buildBootstrapScriptSource({
        payload: buildBridgeBootstrapPayload({
            bridgeSecret: input.bridgeSecret,
            extensionBootstrap: input.extensionBootstrap
        })
    }), "utf8");
    return { bootstrapPath, bootstrapScriptPath };
};
const rewriteStagedContentScriptForRuntime = async (input) => {
    const bundleSource = await buildStagedContentScriptBundle({
        extensionSourceDir: input.extensionSourceDir
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
export const rewriteExtensionStagingArtifacts = async (input) => {
    await rewriteStagedContentScriptForRuntime({
        stagedExtensionDir: input.stagedExtensionDir,
        extensionSourceDir: input.extensionSourceDir,
        bridgeSecret: input.bridgeSecret,
        extensionBootstrap: input.extensionBootstrap
    });
    await rewriteStagedMainWorldBridgeForRuntime({
        stagedExtensionDir: input.stagedExtensionDir,
        bridgeSecret: input.bridgeSecret
    });
    await injectBootstrapScriptIntoManifest(join(input.stagedExtensionDir, "manifest.json"));
};
export const resolveExtensionBootstrapPayload = (input) => {
    if (input.extensionBootstrap) {
        return { ...input.extensionBootstrap };
    }
    const fromParams = asRecord(input.params[EXTENSION_BOOTSTRAP_PARAMS_KEY]);
    return fromParams ? { ...fromParams } : null;
};
export const stageExtensionForRun = async (input) => {
    const extensionSourceDir = await resolveExtensionSourceDir();
    const stagedExtensionDir = join(input.profileDir, EXTENSION_STAGING_DIRNAME, sanitizePathSegment(input.runId));
    const stagedExtensionParent = join(input.profileDir, EXTENSION_STAGING_DIRNAME);
    await mkdir(stagedExtensionParent, { recursive: true });
    await rm(stagedExtensionDir, { recursive: true, force: true });
    await cp(extensionSourceDir, stagedExtensionDir, { recursive: true });
    const bridgeSecret = randomUUID();
    const { bootstrapPath, bootstrapScriptPath } = await writeExtensionBootstrapFiles({
        stagedExtensionDir,
        runId: input.runId,
        bridgeSecret,
        extensionBootstrap: input.extensionBootstrap
    });
    await rewriteExtensionStagingArtifacts({
        stagedExtensionDir,
        extensionSourceDir,
        bridgeSecret,
        extensionBootstrap: input.extensionBootstrap
    });
    return { stagedExtensionDir, bootstrapPath, bootstrapScriptPath };
};
export const cleanupStagedExtensions = async (profileDir) => {
    await rm(join(profileDir, EXTENSION_STAGING_DIRNAME), { recursive: true, force: true });
};
