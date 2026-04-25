import type { CommandDefinition, CommandExecutionResult, JsonObject, RuntimeContext } from "../core/types.js";
import { CliError } from "../core/errors.js";
import { mapCapabilitySummaryForContract } from "../core/capability-output.js";
import {
  NativeMessagingBridge,
  NativeMessagingTransportError
} from "../runtime/native-messaging/bridge.js";
import { NativeHostBridgeTransport } from "../runtime/native-messaging/host.js";
import { createLoopbackNativeBridgeTransport } from "../runtime/native-messaging/loopback.js";
import { appendFingerprintContext, buildFingerprintContextForMeta } from "../runtime/fingerprint-runtime.js";
import { ProfileStore } from "../runtime/profile-store.js";
import {
  isAccountSafetyReason,
  toAccountSafetyStatus,
  type AccountSafetyReason
} from "../runtime/account-safety.js";
import { toXhsCloseoutRhythmStatus } from "../runtime/xhs-closeout-rhythm.js";
import { ProfileRuntimeService } from "../runtime/profile-runtime.js";
import { resolveRuntimeProfileRoot } from "../runtime/worktree-root.js";
import { prepareOfficialChromeRuntime } from "../runtime/official-chrome-runtime.js";
import { buildOfficialChromeRuntimeStatusParams } from "../runtime/official-chrome-runtime.js";
import {
  AbilityRef,
  AbilityAction,
  AbilityEnvelope,
  buildCapabilityResult,
  ISSUE209_INTERNAL_ADMISSION_DRAFT_KEY,
  normalizeGateOptionsForContract,
  parseAbilityEnvelopeForContract,
  parseDetailInputForContract,
  parseSearchInputForContract,
  parseUserHomeInputForContract,
  prepareIssue209LiveReadEnvelopeForContract,
  XhsExecutionMode
} from "./xhs-input.js";

type AbilityLayer = "L3" | "L2" | "L1";
type AbilityActionName = AbilityAction;

export { buildOfficialChromeRuntimeStatusParams } from "../runtime/official-chrome-runtime.js";
export { normalizeGateOptionsForContract } from "./xhs-input.js";

const asObject = (value: unknown): JsonObject | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const asInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
};

const hasOwn = (record: Record<string, unknown> | undefined | null, key: string): boolean =>
  !!record && Object.prototype.hasOwnProperty.call(record, key);

const LIVE_XHS_EXECUTION_MODES = new Set<XhsExecutionMode>([
  "live_read_limited",
  "live_read_high_risk",
  "live_write"
]);

const isLiveXhsExecutionMode = (mode: XhsExecutionMode): boolean =>
  LIVE_XHS_EXECUTION_MODES.has(mode);

const ACCOUNT_SAFETY_REASON_ALIASES: Record<string, AccountSafetyReason> = {
  SESSION_EXPIRED: "SESSION_EXPIRED",
  XHS_LOGIN_REQUIRED: "XHS_LOGIN_REQUIRED",
  LOGIN_REQUIRED: "XHS_LOGIN_REQUIRED",
  ACCOUNT_ABNORMAL: "ACCOUNT_ABNORMAL",
  XHS_ACCOUNT_RISK_PAGE: "XHS_ACCOUNT_RISK_PAGE",
  CAPTCHA_REQUIRED: "CAPTCHA_REQUIRED",
  BROWSER_ENV_ABNORMAL: "BROWSER_ENV_ABNORMAL"
};

const normalizeAccountSafetyReason = (value: unknown): AccountSafetyReason | null => {
  const raw = asString(value);
  if (!raw) {
    return null;
  }
  const normalized = raw.trim().toUpperCase();
  const mapped = ACCOUNT_SAFETY_REASON_ALIASES[normalized];
  return mapped && isAccountSafetyReason(mapped) ? mapped : null;
};

const pickCanonicalSummaryField = (
  payload: Record<string, unknown>,
  key: "request_admission_result" | "execution_audit"
): JsonObject | null | undefined => {
  const summary = asObject(payload.summary);
  const value = hasOwn(payload, key)
    ? payload[key]
    : hasOwn(summary ?? undefined, key)
      ? summary?.[key]
      : undefined;
  if (!hasOwn(payload, key) && !hasOwn(summary ?? undefined, key)) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return asObject(value) ?? undefined;
};

const isTransportFailureCode = (code: unknown): code is string =>
  code === "ERR_TRANSPORT_HANDSHAKE_FAILED" ||
  code === "ERR_TRANSPORT_TIMEOUT" ||
  code === "ERR_TRANSPORT_DISCONNECTED" ||
  code === "ERR_TRANSPORT_FORWARD_FAILED" ||
  code === "ERR_TRANSPORT_NOT_READY";

const resolveRuntimeBridge = (): NativeMessagingBridge => {
  if (process.env.WEBENVOY_NATIVE_TRANSPORT === "loopback") {
    return new NativeMessagingBridge({
      transport: createLoopbackNativeBridgeTransport()
    });
  }

  return new NativeMessagingBridge({
    transport: new NativeHostBridgeTransport()
  });
};

const asObservabilityInput = (value: unknown): CommandExecutionResult["observability"] => {
  const object = asObject(value);
  return object ?? undefined;
};

const asDiagnosisInput = (value: unknown): CliError["diagnosis"] => {
  const object = asObject(value);
  return object ?? undefined;
};

const pickGateErrorDetails = (
  payload: Record<string, unknown>,
  details?: JsonObject | null
): JsonObject => {
  const detailKeys = [
    "validation_action",
    "target_page",
    "editor_locator",
    "input_text",
    "before_text",
    "visible_text",
    "post_blur_text",
    "focus_confirmed",
    "preserved_after_blur",
    "success_signals",
    "failure_signals",
    "minimum_replay",
    "out_of_scope_actions",
    "execution_failure",
    "scope_context",
    "gate_input",
    "gate_outcome",
    "read_execution_policy",
    "issue_action_matrix",
    "write_interaction_tier",
    "write_action_matrix_decisions",
    "consumer_gate_result",
    "request_admission_result",
    "execution_audit",
    "approval_record",
    "audit_record",
    "risk_state_output",
    "account_safety",
    "xhs_closeout_rhythm",
    "runtime_stop",
    "status_code",
    "platform_code"
  ] as const;
  const picked: JsonObject = {};
  const hasOwn = (record: Record<string, unknown> | undefined | null, key: string): boolean =>
    !!record && Object.prototype.hasOwnProperty.call(record, key);
  for (const key of detailKeys) {
    const value = hasOwn(payload, key)
      ? payload[key]
      : hasOwn(details ?? undefined, key)
        ? details?.[key]
        : undefined;
    if (!hasOwn(payload, key) && !hasOwn(details ?? undefined, key)) {
      continue;
    }
    if (value === null) {
      picked[key] = null;
      continue;
    }
    const object = asObject(value);
    if (object) {
      picked[key] = object;
      continue;
    }
    if (Array.isArray(value)) {
      picked[key] = value;
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      picked[key] = value;
    }
  }
  return picked;
};

const toCliExecutionError = (
  ability: AbilityRef,
  payload: Record<string, unknown>,
  fallbackMessage: string
): CliError => {
  const details = asObject(payload.details);
  const reason =
    typeof details?.reason === "string" && details.reason.trim().length > 0
      ? details.reason.trim()
      : "TARGET_API_RESPONSE_INVALID";
  const consumerGateResult = asObject(payload.consumer_gate_result);

  return new CliError("ERR_EXECUTION_FAILED", fallbackMessage, {
    retryable: payload.retryable === true,
    details: {
      ability_id: ability.id,
      stage:
        details?.stage === "input_validation" ||
        details?.stage === "output_mapping" ||
        details?.stage === "execution"
          ? details.stage
          : "execution",
      reason,
      ...(consumerGateResult ?? {}),
      ...pickGateErrorDetails(payload, details)
    },
    observability: asObservabilityInput(payload.observability),
    diagnosis: asDiagnosisInput(payload.diagnosis)
  });
};

const toTransportCliError = (error: NativeMessagingTransportError, ability: AbilityRef): CliError =>
  new CliError("ERR_RUNTIME_UNAVAILABLE", `通信链路不可用: ${error.code}`, {
    retryable: error.retryable,
    cause: error,
    details: {
      ability_id: ability.id,
      stage: "execution",
      reason: error.code
    }
  });

const firstRecord = (value: unknown): JsonObject | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  for (const item of value) {
    const record = asObject(item);
    if (record) {
      return record;
    }
  }
  return null;
};

const resolveNestedObject = (
  record: JsonObject | null | undefined,
  key: string
): JsonObject | null => asObject(record?.[key]);

const resolveAccountSafetySignal = (
  payload: Record<string, unknown>,
  fallback: {
    command: string;
    targetDomain: string | null;
    targetTabId: number | null;
    targetPage: string | null;
  }
): {
  reason: AccountSafetyReason;
  sourceCommand: string;
  targetDomain: string | null;
  targetTabId: number | null;
  pageUrl: string | null;
  statusCode: number | null;
  platformCode: number | null;
} | null => {
  const details = asObject(payload.details);
  const observability = asObject(payload.observability);
  const pageState = resolveNestedObject(observability, "page_state");
  const keyRequest = firstRecord(observability?.key_requests);
  const gateInput = asObject(payload.gate_input) ?? asObject(details?.gate_input);
  const consumerGateResult = asObject(payload.consumer_gate_result);
  const auditRecord = asObject(payload.audit_record);
  const diagnosis = asObject(payload.diagnosis);
  const diagnosisEvidence = Array.isArray(diagnosis?.evidence) ? diagnosis?.evidence : [];
  const reason =
    normalizeAccountSafetyReason(details?.reason) ??
    normalizeAccountSafetyReason(keyRequest?.failure_reason) ??
    normalizeAccountSafetyReason(diagnosisEvidence.find((item) => normalizeAccountSafetyReason(item))) ??
    (() => {
      const statusCode = asInteger(details?.status_code) ?? asInteger(keyRequest?.status_code);
      const platformCode = asInteger(details?.platform_code);
      if (statusCode === 401) {
        return "SESSION_EXPIRED" as const;
      }
      if (statusCode === 461 || platformCode === 300011) {
        return "ACCOUNT_ABNORMAL" as const;
      }
      if (platformCode === 300015) {
        return "BROWSER_ENV_ABNORMAL" as const;
      }
      return null;
    })();
  if (!reason) {
    return null;
  }
  const targetTabId =
    asInteger(details?.target_tab_id) ??
    asInteger(consumerGateResult?.target_tab_id) ??
    asInteger(gateInput?.target_tab_id) ??
    asInteger(auditRecord?.target_tab_id) ??
    fallback.targetTabId;
  return {
    reason,
    sourceCommand: fallback.command,
    targetDomain:
      asString(details?.target_domain) ??
      asString(consumerGateResult?.target_domain) ??
      asString(gateInput?.target_domain) ??
      asString(auditRecord?.target_domain) ??
      fallback.targetDomain,
    targetTabId,
    pageUrl:
      asString(details?.page_url) ??
      asString(pageState?.url) ??
      fallback.targetPage,
    statusCode: asInteger(details?.status_code) ?? asInteger(keyRequest?.status_code),
    platformCode: asInteger(details?.platform_code)
  };
};

const mergeAccountSafetyIntoFailurePayload = (
  payload: Record<string, unknown>,
  accountSafety: JsonObject,
  xhsCloseoutRhythm?: JsonObject | null,
  runtimeStop?: JsonObject | null
): void => {
  const details = asObject(payload.details) ?? {};
  payload.details = {
    ...details,
    account_safety: accountSafety,
    ...(xhsCloseoutRhythm ? { xhs_closeout_rhythm: xhsCloseoutRhythm } : {}),
    ...(runtimeStop ? { runtime_stop: runtimeStop } : {})
  };
  payload.account_safety = accountSafety;
  if (xhsCloseoutRhythm) {
    payload.xhs_closeout_rhythm = xhsCloseoutRhythm;
  }
  if (runtimeStop) {
    payload.runtime_stop = runtimeStop;
  }
};

const isXhsRecoveryProbe = (input: {
  command: string;
  ability: AbilityRef;
  options: JsonObject;
}): boolean =>
  input.command === "xhs.search" &&
  input.ability.id === "xhs.note.search.v1" &&
  input.options.xhs_recovery_probe === true;

const assertXhsLivePreflightAllowsCommand = (input: {
  command: string;
  ability: AbilityRef;
  accountSafety: JsonObject;
  xhsCloseoutRhythm: JsonObject;
  options: JsonObject;
  requestedExecutionMode: XhsExecutionMode;
}): void => {
  const recoveryProbe = isXhsRecoveryProbe(input);
  const rhythmState = asString(input.xhsCloseoutRhythm.state);
  const fullBundleBlocked = input.xhsCloseoutRhythm.full_bundle_blocked === true;
  const singleProbeRequired = input.xhsCloseoutRhythm.single_probe_required === true;
  const probeRunId = asString(input.xhsCloseoutRhythm.probe_run_id);

  if (
    recoveryProbe &&
    input.requestedExecutionMode === "recon" &&
    rhythmState === "single_probe_required" &&
    input.accountSafety.state !== "account_risk_blocked" &&
    probeRunId === null
  ) {
    return;
  }

  throw new CliError("ERR_EXECUTION_FAILED", "XHS account-safety gate blocked current live command", {
    retryable: false,
    details: {
      ability_id: input.ability.id,
      stage: "execution",
      reason:
        input.accountSafety.state === "account_risk_blocked"
          ? "ACCOUNT_RISK_BLOCKED"
          : recoveryProbe && input.requestedExecutionMode !== "recon"
            ? "XHS_RECOVERY_PROBE_MODE_INVALID"
          : fullBundleBlocked || singleProbeRequired
            ? "XHS_CLOSEOUT_RHYTHM_BLOCKED"
            : "XHS_CLOSEOUT_RHYTHM_UNAVAILABLE",
      account_safety: input.accountSafety,
      xhs_closeout_rhythm: input.xhsCloseoutRhythm
    }
  });
};

export const ensureOfficialChromeRuntimeReady = async (
  context: RuntimeContext,
  ability: AbilityRef,
  requestedExecutionMode: XhsExecutionMode,
  bridge: NativeMessagingBridge,
  fingerprintContext: ReturnType<typeof buildFingerprintContextForMeta>,
  gate: ReturnType<typeof normalizeGateOptionsForContract> & {
    targetResourceId?: string | null;
  },
  readStatus?: () => Promise<JsonObject>
): Promise<void> => {
  await prepareOfficialChromeRuntime({
    context,
    consumerId: ability.id,
    requestedExecutionMode,
    bridge,
    fingerprintContext,
    bootstrapTargetTabId: gate.targetTabId,
    bootstrapTargetDomain: gate.targetDomain,
    bootstrapTargetPage: gate.targetPage,
    bootstrapTargetResourceId: gate.targetResourceId ?? null,
    readStatus
  });
};

const resolveBootstrapTargetResourceId = (
  command: string,
  parsedInput: JsonObject
): string | null => {
  if (command === "xhs.detail") {
    return typeof parsedInput.note_id === "string" && parsedInput.note_id.trim().length > 0
      ? parsedInput.note_id.trim()
      : null;
  }
  if (command === "xhs.user_home") {
    return typeof parsedInput.user_id === "string" && parsedInput.user_id.trim().length > 0
      ? parsedInput.user_id.trim()
      : null;
  }
  return null;
};

const xhsSearch = async (context: RuntimeContext): Promise<CommandExecutionResult> => {
  return xhsReadCommand(context, {
    fixtureDataRefKey: "query",
    parseInput: (envelope, gate) =>
      parseSearchInputForContract(
        envelope.input,
        envelope.ability.id,
        gate.options,
        envelope.ability.action
      )
  });
};

const xhsDetail = async (context: RuntimeContext): Promise<CommandExecutionResult> => {
  return xhsReadCommand(context, {
    fixtureDataRefKey: "note_id",
    parseInput: (envelope) => parseDetailInputForContract(envelope.input, envelope.ability.id)
  });
};

const xhsUserHome = async (context: RuntimeContext): Promise<CommandExecutionResult> => {
  return xhsReadCommand(context, {
    fixtureDataRefKey: "user_id",
    parseInput: (envelope) => parseUserHomeInputForContract(envelope.input, envelope.ability.id)
  });
};

const xhsReadCommand = async (
  context: RuntimeContext,
  inputConfig: {
    fixtureDataRefKey: "query" | "note_id" | "user_id";
    parseInput: (
      envelope: AbilityEnvelope,
      gate: ReturnType<typeof normalizeGateOptionsForContract>
    ) => JsonObject;
  }
): Promise<CommandExecutionResult> => {
  const envelope = parseAbilityEnvelopeForContract(context.params);
  const gate = normalizeGateOptionsForContract(envelope.options, envelope.ability.id, {
    command: context.command,
    abilityAction: envelope.ability.action,
    runtimeProfile: context.profile ?? null,
    upstreamAuthorization: envelope.upstreamAuthorization
  });
  const parsedInput = inputConfig.parseInput(envelope, gate);

  if (
    process.env.NODE_ENV === "test" &&
    process.env.WEBENVOY_ALLOW_FIXTURE_SUCCESS === "1" &&
    gate.options.fixture_success === true
  ) {
    const dataRefValue =
      typeof parsedInput[inputConfig.fixtureDataRefKey] === "string"
        ? String(parsedInput[inputConfig.fixtureDataRefKey])
        : null;
    return {
      summary: mapCapabilitySummaryForContract(
        envelope.ability.id,
        buildCapabilityResult(envelope.ability, {
          data_ref: dataRefValue ? { [inputConfig.fixtureDataRefKey]: dataRefValue } : {},
          metrics: {
            count: 0
          }
        })
      )
    };
  }

  if (envelope.input.force_bad_output === true) {
    return {
      summary: mapCapabilitySummaryForContract(envelope.ability.id, {})
    };
  }

  const profileStore = new ProfileStore(resolveRuntimeProfileRoot(context.cwd));
  const profileMeta = context.profile ? await profileStore.readMeta(context.profile) : null;
  const accountSafetyStatus = toAccountSafetyStatus(profileMeta?.accountSafety);
  const xhsCloseoutRhythmStatus = toXhsCloseoutRhythmStatus({
    rhythm: profileMeta?.xhsCloseoutRhythm,
    accountSafety: profileMeta?.accountSafety
  });
  const profileRuntime = new ProfileRuntimeService();
  const recoveryProbeRequested = isXhsRecoveryProbe({
    command: context.command,
    ability: envelope.ability,
    options: gate.options
  });
  if (
    context.profile &&
    (isLiveXhsExecutionMode(gate.requestedExecutionMode) || recoveryProbeRequested)
  ) {
    const rhythmState = asString(xhsCloseoutRhythmStatus.state);
    const shouldRunRhythmGate =
      recoveryProbeRequested ||
      accountSafetyStatus.state === "account_risk_blocked" ||
      (rhythmState !== null && rhythmState !== "not_required");
    if (shouldRunRhythmGate) {
      assertXhsLivePreflightAllowsCommand({
        command: context.command,
        ability: envelope.ability,
        accountSafety: accountSafetyStatus,
        xhsCloseoutRhythm: xhsCloseoutRhythmStatus,
        options: gate.options,
        requestedExecutionMode: gate.requestedExecutionMode
      });
    }
  }
  const bridge = resolveRuntimeBridge();
  const fingerprintContext = buildFingerprintContextForMeta(context.profile ?? "unknown", profileMeta, {
    requestedExecutionMode: gate.requestedExecutionMode
  });
  try {
    const preparedIssue209LiveRead = prepareIssue209LiveReadEnvelopeForContract({
      options: gate.options,
      requestId: envelope.requestId,
      gateInvocationId: envelope.gateInvocationId,
      runId: context.run_id
    });
    await ensureOfficialChromeRuntimeReady(
      context,
      envelope.ability,
      gate.requestedExecutionMode,
      bridge,
      fingerprintContext,
      {
        ...gate,
        targetResourceId: resolveBootstrapTargetResourceId(context.command, parsedInput)
      }
    );
    const bridgeSessionId = await bridge.ensureSession({
      profile: context.profile
    });
    if (
      context.profile &&
      recoveryProbeRequested
    ) {
      await profileRuntime.claimXhsCloseoutSingleProbe({
        cwd: context.cwd,
        profile: context.profile,
        runId: context.run_id,
        params: {}
      });
    }
    const transportIsLoopback = process.env.WEBENVOY_NATIVE_TRANSPORT === "loopback";
    const {
      __anonymous_isolation_verified: anonymousIsolationVerified,
      target_site_logged_in: targetSiteLoggedIn,
      ...preparedGateOptions
    } = preparedIssue209LiveRead.options;
    const runtimeGateOptions = {
      ...preparedGateOptions,
      ...(transportIsLoopback && typeof anonymousIsolationVerified === "boolean"
        ? { __anonymous_isolation_verified: anonymousIsolationVerified }
        : {}),
      ...(transportIsLoopback && typeof targetSiteLoggedIn === "boolean"
        ? { target_site_logged_in: targetSiteLoggedIn }
        : {}),
      ...(typeof context.profile === "string" ? { __runtime_profile_ref: context.profile } : {})
    };
    const commandParams = appendFingerprintContext(
      {
        ...(preparedIssue209LiveRead.commandRequestId
          ? { request_id: preparedIssue209LiveRead.commandRequestId }
          : {}),
        ...(preparedIssue209LiveRead.gateInvocationId
          ? { gate_invocation_id: preparedIssue209LiveRead.gateInvocationId }
          : {}),
        ...(preparedIssue209LiveRead.admissionDraft
          ? {
              [ISSUE209_INTERNAL_ADMISSION_DRAFT_KEY]: preparedIssue209LiveRead.admissionDraft
            }
          : {}),
        target_domain: gate.targetDomain,
        target_tab_id: gate.targetTabId,
        target_page: gate.targetPage,
        requested_execution_mode: gate.requestedExecutionMode,
        ability: envelope.ability,
        input: parsedInput,
        options: runtimeGateOptions,
        session_id: bridgeSessionId
      },
      fingerprintContext
    );
    const bridgeResult = await bridge.runCommand({
      runId: context.run_id,
      profile: context.profile,
      cwd: context.cwd,
      command: context.command,
      params: commandParams
    });

    if (!bridgeResult.ok) {
      const accountSafetySignal =
        context.profile && isLiveXhsExecutionMode(gate.requestedExecutionMode)
          ? resolveAccountSafetySignal(bridgeResult.payload, {
              command: context.command,
              targetDomain: gate.targetDomain,
              targetTabId: gate.targetTabId,
              targetPage: gate.targetPage
            })
          : null;
      if (accountSafetySignal && context.profile) {
        const accountSafetyResult = await profileRuntime.markAccountSafetyBlocked({
          cwd: context.cwd,
          profile: context.profile,
          runId: context.run_id,
          params: {},
          signal: accountSafetySignal
        });
        const accountSafety = asObject(accountSafetyResult.account_safety);
        const xhsCloseoutRhythm = asObject(accountSafetyResult.xhs_closeout_rhythm);
        const runtimeStop = asObject(accountSafetyResult.runtime_stop);
        if (accountSafety) {
          mergeAccountSafetyIntoFailurePayload(
            bridgeResult.payload,
            accountSafety,
            xhsCloseoutRhythm,
            runtimeStop
          );
        }
      }
      throw toCliExecutionError(
        envelope.ability,
        bridgeResult.payload,
        bridgeResult.error.message
      );
    }

    const consumerGateResult = asObject(bridgeResult.payload.consumer_gate_result);
    const requestAdmissionResult = pickCanonicalSummaryField(
      bridgeResult.payload,
      "request_admission_result"
    );
    const executionAudit = pickCanonicalSummaryField(
      bridgeResult.payload,
      "execution_audit"
    );
    const summary = mapCapabilitySummaryForContract(envelope.ability.id, {
      ...(asObject(bridgeResult.payload.summary) ?? {}),
      ...(consumerGateResult ? { consumer_gate_result: consumerGateResult } : {}),
      ...(requestAdmissionResult !== undefined
        ? { request_admission_result: requestAdmissionResult }
        : {}),
      ...(executionAudit !== undefined ? { execution_audit: executionAudit } : {})
    });

    if (
      context.profile &&
      recoveryProbeRequested
    ) {
      await profileRuntime.markXhsCloseoutSingleProbePassed({
        cwd: context.cwd,
        profile: context.profile,
        runId: context.run_id,
        params: {}
      });
    }

    return {
      summary,
      observability: asObservabilityInput(bridgeResult.payload.observability)
    };
  } catch (error) {
    if (error instanceof NativeMessagingTransportError) {
      throw toTransportCliError(error, envelope.ability);
    }
    throw error;
  }
};

export const xhsCommands = (): CommandDefinition[] => [
  {
    name: "xhs.search",
    status: "implemented",
    requiresProfile: true,
    handler: xhsSearch
  },
  {
    name: "xhs.detail",
    status: "implemented",
    requiresProfile: true,
    handler: xhsDetail
  },
  {
    name: "xhs.user_home",
    status: "implemented",
    requiresProfile: true,
    handler: xhsUserHome
  }
];
