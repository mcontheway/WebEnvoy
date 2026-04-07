#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const extensionRoot = join(repoRoot, "extension");
const buildRoot = join(extensionRoot, "build");
const sharedRoot = join(extensionRoot, "shared");

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

const renderClassicModule = ({ moduleVar, prelude = "", sourceBody, exports }) =>
  [
    `const ${moduleVar} = (() => {`,
    prelude,
    sourceBody,
    `return { ${exports.join(", ")} };`,
    "})();",
    ""
  ]
    .filter((line) => line.length > 0)
    .join("\n");

const readSource = async (path) =>
  stripEsmSyntaxForClassicScript(await readFile(path, "utf8"));

const buildContentScriptBundle = async () => {
  const fingerprintSource = await readSource(join(sharedRoot, "fingerprint-profile.js"));
  const riskStateSource = await readSource(join(sharedRoot, "risk-state.js"));
  const xhsSearchSource = await readSource(join(buildRoot, "xhs-search.js"));
  const xhsEditorInputSource = await readSource(join(buildRoot, "xhs-editor-input.js"));
  const contentScriptMainWorldSource = await readSource(
    join(buildRoot, "content-script-main-world.js")
  );
  const contentScriptFingerprintSource = await readSource(
    join(buildRoot, "content-script-fingerprint.js")
  );
  const handlerSource = await readSource(join(buildRoot, "content-script-handler.js"));
  const contentScriptSource = await readSource(join(buildRoot, "content-script.js"));

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

  const xhsEditorInputModule = renderClassicModule({
    moduleVar: "__webenvoy_module_xhs_editor_input",
    sourceBody: xhsEditorInputSource,
    exports: ["performEditorInputValidation"]
  });

  const contentScriptMainWorldModule = renderClassicModule({
    moduleVar: "__webenvoy_module_content_script_main_world",
    sourceBody: contentScriptMainWorldSource,
    exports: [
      "encodeMainWorldPayload",
      "installFingerprintRuntimeViaMainWorld",
      "installMainWorldEventChannelSecret",
      "MAIN_WORLD_EVENT_BOOTSTRAP",
      "resetMainWorldEventChannelForContract",
      "resolveMainWorldEventNamesForSecret",
      "verifyFingerprintRuntimeViaMainWorld"
    ]
  });

  const contentScriptFingerprintModule = renderClassicModule({
    moduleVar: "__webenvoy_module_content_script_fingerprint",
    prelude: [
      "const { ensureFingerprintRuntimeContext } = __webenvoy_module_fingerprint_profile;",
      "const {",
      "  installFingerprintRuntimeViaMainWorld,",
      "  verifyFingerprintRuntimeViaMainWorld",
      "} = __webenvoy_module_content_script_main_world;"
    ].join("\n"),
    sourceBody: contentScriptFingerprintSource,
    exports: [
      "buildFailedFingerprintInjectionContext",
      "hasInstalledFingerprintInjection",
      "installFingerprintRuntimeWithVerification",
      "resolveFingerprintContextForContract",
      "resolveFingerprintContextFromMessage",
      "resolveMissingRequiredFingerprintPatches",
      "summarizeFingerprintRuntimeContext"
    ]
  });

  const handlerModule = renderClassicModule({
    moduleVar: "__webenvoy_module_content_script_handler",
    prelude: [
      "const { executeXhsSearch } = __webenvoy_module_xhs_search;",
      "const { performEditorInputValidation } = __webenvoy_module_xhs_editor_input;",
      "const { ensureFingerprintRuntimeContext } = __webenvoy_module_fingerprint_profile;",
      "const {",
      "  buildFailedFingerprintInjectionContext,",
      "  hasInstalledFingerprintInjection,",
      "  installFingerprintRuntimeWithVerification,",
      "  resolveFingerprintContextForContract,",
      "  resolveFingerprintContextFromMessage,",
      "  resolveMissingRequiredFingerprintPatches,",
      "  summarizeFingerprintRuntimeContext",
      "} = __webenvoy_module_content_script_fingerprint;",
      "const {",
      "  encodeMainWorldPayload,",
      "  installFingerprintRuntimeViaMainWorld,",
      "  installMainWorldEventChannelSecret,",
      "  MAIN_WORLD_EVENT_BOOTSTRAP,",
      "  resetMainWorldEventChannelForContract,",
      "  resolveMainWorldEventNamesForSecret",
      "} = __webenvoy_module_content_script_main_world;"
    ].join("\n"),
    sourceBody: handlerSource,
    exports: [
      "ContentScriptHandler",
      "encodeMainWorldPayload",
      "installFingerprintRuntimeViaMainWorld",
      "installMainWorldEventChannelSecret",
      "resolveFingerprintContextForContract",
      "resolveMainWorldEventNamesForSecret"
    ]
  });

  const contentScriptModule = renderClassicModule({
    moduleVar: "__webenvoy_module_content_script",
    prelude: [
      "const {",
      "  ContentScriptHandler,",
      "  installFingerprintRuntimeViaMainWorld,",
      "  installMainWorldEventChannelSecret",
      "} = __webenvoy_module_content_script_handler;",
      "const { ensureFingerprintRuntimeContext } = __webenvoy_module_fingerprint_profile;"
    ].join("\n"),
    sourceBody: contentScriptSource,
    exports: ["bootstrapContentScript"]
  });

  return [
    "/* WebEnvoy classic content script bundle for Chrome MV3 content_scripts. */",
    "",
    riskStateModule,
    fingerprintModule,
    xhsSearchModule,
    xhsEditorInputModule,
    contentScriptMainWorldModule,
    contentScriptFingerprintModule,
    handlerModule,
    contentScriptModule
  ].join("\n");
};

const bundle = await buildContentScriptBundle();
await writeFile(join(buildRoot, "content-script.js"), `${bundle}\n`, "utf8");
