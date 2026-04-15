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
  transformed = transformed.replace(/^\s*export\s*\{[^;]*\}\s*from\s*["'][^"']+["'];\s*$/gm, "");
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
  const issue209AdmissionSource = await readSource(
    join(sharedRoot, "issue209-live-read", "admission.js")
  );
  const issue209SourceSource = await readSource(join(sharedRoot, "issue209-live-read", "source.js"));
  const issue209IdentitySource = await readSource(
    join(sharedRoot, "issue209-live-read", "identity.js")
  );
  const issue209GateSource = await readSource(join(sharedRoot, "issue209-live-read", "gate.js"));
  const issue209PostGateAuditSource = await readSource(
    join(sharedRoot, "issue209-live-read", "postgate-audit.js")
  );
  const issue209SourceValidationSource = await readSource(
    join(sharedRoot, "issue209-live-read", "source-validation.js")
  );
  const sharedXhsGateSource = await readSource(join(sharedRoot, "xhs-gate.js"));
  const xhsSearchTypesSource = await readSource(join(buildRoot, "xhs-search-types.js"));
  const xhsSearchTelemetrySource = await readSource(join(buildRoot, "xhs-search-telemetry.js"));
  const xhsSearchGateSource = await readSource(join(buildRoot, "xhs-search-gate.js"));
  const xhsSearchExecutionSource = await readSource(join(buildRoot, "xhs-search-execution.js"));
  const xhsSearchSource = await readSource(join(buildRoot, "xhs-search.js"));
  const xhsReadExecutionSource = await readSource(join(buildRoot, "xhs-read-execution.js"));
  const xhsDetailSource = await readSource(join(buildRoot, "xhs-detail.js"));
  const xhsUserHomeSource = await readSource(join(buildRoot, "xhs-user-home.js"));
  const xhsEditorInputSource = await readSource(join(buildRoot, "xhs-editor-input.js"));
  const xhsCommandContractSource = await readSource(join(buildRoot, "xhs-command-contract.js"));
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

  const issue209AdmissionModule = renderClassicModule({
    moduleVar: "__webenvoy_module_issue209_admission",
    sourceBody: issue209AdmissionSource,
    exports: [
      "cloneIssue209AdmissionContext",
      "createIssue209AdmissionDraft",
      "bindIssue209AdmissionToSession"
    ]
  });

  const issue209IdentityModule = renderClassicModule({
    moduleVar: "__webenvoy_module_issue209_identity",
    sourceBody: issue209IdentitySource,
    exports: [
      "ISSUE209_LIVE_READ_EXECUTION_MODES",
      "isIssue209LiveReadMode",
      "isIssue209LiveReadGateRequest",
      "prepareIssue209LiveReadIdentity",
      "resolveIssue209LiveReadDecisionId",
      "resolveIssue209LiveReadApprovalId"
    ]
  });

  const issue209SourceModule = renderClassicModule({
    moduleVar: "__webenvoy_module_issue209_source",
    prelude: [
      "const { APPROVAL_CHECK_KEYS } = __webenvoy_module_risk_state;",
      "const {",
      "  resolveIssue209LiveReadApprovalId,",
      "  resolveIssue209LiveReadDecisionId",
      "} = __webenvoy_module_issue209_identity;"
    ].join("\n"),
    sourceBody: issue209SourceSource,
    exports: [
      "APPROVAL_CHECK_KEYS",
      "cloneIssue209AdmissionContext",
      "normalizeApprovalAdmissionEvidence",
      "normalizeAuditAdmissionEvidence",
      "resolveConsumedIssue209AdmissionEvidence",
      "normalizeProvidedApprovalSource",
      "normalizeProvidedAuditSource",
      "prepareIssue209LiveReadSource"
    ]
  });

  const issue209GateModule = renderClassicModule({
    moduleVar: "__webenvoy_module_issue209_gate",
    prelude: [
      "const { APPROVAL_CHECK_KEYS } = __webenvoy_module_risk_state;",
      "const { cloneIssue209AdmissionContext } = __webenvoy_module_issue209_admission;",
      "const { normalizeProvidedApprovalSource } = __webenvoy_module_issue209_source;",
      "const {",
      "  validateIssue209ApprovalSourceAgainstCurrentLinkage,",
      "  validateIssue209AuditSourceAgainstCurrentLinkage",
      "} = __webenvoy_module_issue209_source_validation;"
    ].join("\n"),
    sourceBody: issue209GateSource,
    exports: [
      "validateIssue209ApprovalSourceAgainstCurrentLinkage",
      "collectIssue209LiveReadMatrixGateReasons"
    ]
  });

  const issue209SourceValidationModule = renderClassicModule({
    moduleVar: "__webenvoy_module_issue209_source_validation",
    prelude: [
      "const { APPROVAL_CHECK_KEYS } = __webenvoy_module_risk_state;",
      "const {",
      "  normalizeProvidedApprovalSource,",
      "  normalizeProvidedAuditSource",
      "} = __webenvoy_module_issue209_source;"
    ].join("\n"),
    sourceBody: issue209SourceValidationSource,
    exports: [
      "validateIssue209ApprovalSourceAgainstCurrentLinkage",
      "validateIssue209AuditSourceAgainstCurrentLinkage"
    ]
  });

  const issue209PostGateAuditModule = renderClassicModule({
    moduleVar: "__webenvoy_module_issue209_postgate_audit",
    prelude: [
      "const { APPROVAL_CHECK_KEYS, buildRiskTransitionAudit } = __webenvoy_module_risk_state;",
      "const { resolveIssue209LiveReadApprovalId } = __webenvoy_module_issue209_identity;",
      "const { resolveConsumedIssue209AdmissionEvidence } = __webenvoy_module_issue209_source;"
    ].join("\n"),
    sourceBody: issue209PostGateAuditSource,
    exports: ["buildIssue209PostGateArtifacts"]
  });

  const sharedXhsGateModule = renderClassicModule({
    moduleVar: "__webenvoy_module_shared_xhs_gate",
    prelude: [
      "const {",
      "  APPROVAL_CHECK_KEYS,",
      "  EXECUTION_MODES,",
      "  WRITE_INTERACTION_TIER,",
      "  getIssueActionMatrixEntry,",
      "  getWriteActionMatrixDecisions,",
      "  resolveIssueScope: resolveSharedIssueScope,",
      "  resolveRiskState: resolveSharedRiskState",
      "} = __webenvoy_module_risk_state;",
      "const { resolveConsumedIssue209AdmissionEvidence } = __webenvoy_module_issue209_source;",
      "const { collectIssue209LiveReadMatrixGateReasons } = __webenvoy_module_issue209_gate;",
      "const { buildIssue209PostGateArtifacts } = __webenvoy_module_issue209_postgate_audit;",
      "const {",
      "  isIssue209LiveReadGateRequest,",
      "  resolveIssue209LiveReadApprovalId",
      "} = __webenvoy_module_issue209_identity;"
    ].join("\n"),
    sourceBody: sharedXhsGateSource,
    exports: [
      "XHS_ALLOWED_DOMAINS",
      "XHS_READ_DOMAIN",
      "XHS_WRITE_DOMAIN",
      "buildIssue209PostGateArtifacts",
      "evaluateXhsGate",
      "resolveXhsGateDecisionId"
    ]
  });

  const xhsSearchTypesModule = renderClassicModule({
    moduleVar: "__webenvoy_module_xhs_search_types",
    sourceBody: xhsSearchTypesSource,
    exports: ["SEARCH_ENDPOINT"]
  });

  const xhsSearchTelemetryModule = renderClassicModule({
    moduleVar: "__webenvoy_module_xhs_search_telemetry",
    prelude: [
      "const { SEARCH_ENDPOINT } = __webenvoy_module_xhs_search_types;",
      "const {",
      "  buildUnifiedRiskStateOutput,",
      "  resolveRiskState: resolveSharedRiskState",
      "} = __webenvoy_module_risk_state;"
    ].join("\n"),
    sourceBody: xhsSearchTelemetrySource,
    exports: [
      "buildEditorInputEvidence",
      "containsCookie",
      "createDiagnosis",
      "createFailure",
      "createObservability",
      "inferFailure",
      "inferRequestException",
      "isTrustedEditorInputValidation",
      "parseCount",
      "resolveSimulatedResult",
      "resolveRiskStateOutput",
      "resolveXsCommon"
    ]
  });

  const xhsSearchGateModule = renderClassicModule({
    moduleVar: "__webenvoy_module_xhs_search_gate",
    prelude: [
      "const {",
      "  buildRiskTransitionAudit,",
      "  resolveIssueScope: resolveSharedIssueScope,",
      "  resolveRiskState: resolveSharedRiskState",
      "} = __webenvoy_module_risk_state;",
      "const {",
      "  evaluateXhsGate,",
      "  resolveXhsGateDecisionId,",
      "  XHS_READ_DOMAIN,",
      "  XHS_WRITE_DOMAIN,",
      "  buildIssue209PostGateArtifacts",
      "} = __webenvoy_module_shared_xhs_gate;",
      "const { resolveRiskStateOutput } = __webenvoy_module_xhs_search_telemetry;"
    ].join("\n"),
    sourceBody: xhsSearchGateSource,
    exports: ["createAuditRecord", "createGateOnlySuccess", "resolveGate"]
  });

  const xhsSearchExecutionModule = renderClassicModule({
    moduleVar: "__webenvoy_module_xhs_search_execution",
    prelude: [
      "const { SEARCH_ENDPOINT } = __webenvoy_module_xhs_search_types;",
      "const {",
      "  createAuditRecord,",
      "  createGateOnlySuccess,",
      "  resolveGate",
      "} = __webenvoy_module_xhs_search_gate;",
      "const {",
      "  buildEditorInputEvidence,",
      "  containsCookie,",
      "  createDiagnosis,",
      "  createFailure,",
      "  createObservability,",
      "  inferFailure,",
      "  inferRequestException,",
      "  isTrustedEditorInputValidation,",
      "  parseCount,",
      "  resolveSimulatedResult,",
      "  resolveRiskStateOutput,",
      "  resolveXsCommon",
      "} = __webenvoy_module_xhs_search_telemetry;"
    ].join("\n"),
    sourceBody: xhsSearchExecutionSource,
    exports: ["executeXhsSearch"]
  });

  const xhsSearchModule = renderClassicModule({
    moduleVar: "__webenvoy_module_xhs_search",
    prelude: "const { executeXhsSearch: executeXhsSearchImpl } = __webenvoy_module_xhs_search_execution;",
    sourceBody: xhsSearchSource,
    exports: ["executeXhsSearch"]
  });

  const xhsReadExecutionModule = renderClassicModule({
    moduleVar: "__webenvoy_module_xhs_read_execution",
    prelude: [
      "const { createAuditRecord, resolveGate } = __webenvoy_module_xhs_search_gate;",
      "const {",
      "  containsCookie,",
      "  createDiagnosis,",
      "  createFailure,",
      "  resolveRiskStateOutput,",
      "  resolveXsCommon",
      "} = __webenvoy_module_xhs_search_telemetry;"
    ].join("\n"),
    sourceBody: xhsReadExecutionSource,
    exports: ["executeXhsDetail", "executeXhsUserHome"]
  });

  const xhsDetailModule = renderClassicModule({
    moduleVar: "__webenvoy_module_xhs_detail",
    prelude: "const { executeXhsDetail: executeXhsDetailImpl } = __webenvoy_module_xhs_read_execution;",
    sourceBody: xhsDetailSource,
    exports: ["executeXhsDetail"]
  });

  const xhsUserHomeModule = renderClassicModule({
    moduleVar: "__webenvoy_module_xhs_user_home",
    prelude:
      "const { executeXhsUserHome: executeXhsUserHomeImpl } = __webenvoy_module_xhs_read_execution;",
    sourceBody: xhsUserHomeSource,
    exports: ["executeXhsUserHome"]
  });

  const xhsEditorInputModule = renderClassicModule({
    moduleVar: "__webenvoy_module_xhs_editor_input",
    sourceBody: xhsEditorInputSource,
    exports: ["performEditorInputValidation"]
  });

  const xhsCommandContractModule = renderClassicModule({
    moduleVar: "__webenvoy_module_xhs_command_contract",
    sourceBody: xhsCommandContractSource,
    exports: ["ExtensionContractError", "validateXhsCommandInputForExtension"]
  });

  const contentScriptMainWorldModule = renderClassicModule({
    moduleVar: "__webenvoy_module_content_script_main_world",
    sourceBody: contentScriptMainWorldSource,
    exports: [
      "encodeMainWorldPayload",
      "installFingerprintRuntimeViaMainWorld",
      "installMainWorldEventChannelSecret",
      "MAIN_WORLD_EVENT_BOOTSTRAP",
      "readPageStateViaMainWorld",
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
      "const { executeXhsDetail } = __webenvoy_module_xhs_detail;",
      "const { executeXhsUserHome } = __webenvoy_module_xhs_user_home;",
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
      "  ExtensionContractError,",
      "  validateXhsCommandInputForExtension",
      "} = __webenvoy_module_xhs_command_contract;",
      "const {",
      "  encodeMainWorldPayload,",
      "  installFingerprintRuntimeViaMainWorld,",
      "  installMainWorldEventChannelSecret,",
      "  MAIN_WORLD_EVENT_BOOTSTRAP,",
      "  readPageStateViaMainWorld,",
      "  resetMainWorldEventChannelForContract,",
      "  resolveMainWorldEventNamesForSecret",
      "} = __webenvoy_module_content_script_main_world;"
    ].join("\n"),
    sourceBody: handlerSource,
    exports: [
      "ContentScriptHandler",
      "ExtensionContractError",
      "encodeMainWorldPayload",
      "installFingerprintRuntimeViaMainWorld",
      "installMainWorldEventChannelSecret",
      "readPageStateViaMainWorld",
      "resolveFingerprintContextForContract",
      "validateXhsCommandInputForExtension",
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
    issue209AdmissionModule,
    issue209IdentityModule,
    issue209SourceModule,
    issue209SourceValidationModule,
    issue209GateModule,
    issue209PostGateAuditModule,
    sharedXhsGateModule,
    xhsSearchTypesModule,
    xhsSearchTelemetryModule,
    xhsSearchGateModule,
    xhsSearchExecutionModule,
    xhsSearchModule,
    xhsReadExecutionModule,
    xhsDetailModule,
    xhsUserHomeModule,
    xhsEditorInputModule,
    xhsCommandContractModule,
    contentScriptMainWorldModule,
    contentScriptFingerprintModule,
    handlerModule,
    contentScriptModule
  ].join("\n");
};

const bundle = await buildContentScriptBundle();
await writeFile(join(buildRoot, "content-script.js"), `${bundle}\n`, "utf8");
