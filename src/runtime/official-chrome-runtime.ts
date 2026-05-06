import { randomUUID } from "node:crypto";

import { CliError } from "../core/errors.js";
import type { JsonObject, RuntimeContext } from "../core/types.js";
import { NativeMessagingBridge } from "./native-messaging/bridge.js";
import { buildFingerprintContextForMeta } from "./fingerprint-runtime.js";
import { buildRuntimeBootstrapContextId } from "./runtime-bootstrap.js";
import { ProfileRuntimeService } from "./profile-runtime.js";

type RuntimeReadiness = "blocked" | "pending" | "ready" | "recoverable" | "unknown";
type BootstrapState = "not_started" | "pending" | "ready" | "stale" | "failed";
type TransportState = "not_connected" | "ready" | "disconnected";

type RuntimeStatusReader = () => Promise<JsonObject>;
type RuntimeAttachReader = () => Promise<JsonObject>;

type RuntimeTakeoverEvidence = {
  mode?: "ready_attach" | "recoverable_rebind" | "stale_bootstrap_rebind" | null;
  attachableReadyRuntime?: boolean;
  orphanRecoverable?: boolean;
  staleBootstrapRecoverable?: boolean;
  observedRunId?: string;
  observedRuntimeInstanceId?: string | null;
  runtimeContextId?: string | null;
  requestRunId?: string | null;
  requestRuntimeContextId?: string | null;
  freshness?: string;
  identityBound?: boolean;
  ownerConflictFree?: boolean;
  controllerBrowserContinuity?: boolean;
  managedTargetTabId?: number | null;
  managedTargetDomain?: string | null;
  managedTargetPage?: string | null;
  targetTabContinuity?: string | null;
  observedRuntimeSessionId?: string | null;
  takeoverEvidenceObservedAt?: string | null;
};

type OfficialChromeBootstrapTarget = {
  targetTabId?: number | null;
  targetDomain?: string | null;
  targetPage?: string | null;
  targetResourceId?: string | null;
  requestedAt?: string | null;
};

const OFFICIAL_CHROME_BOOTSTRAP_READINESS_MAX_ATTEMPTS = 5;
const OFFICIAL_CHROME_BOOTSTRAP_READINESS_RETRY_DELAY_MS = 50;
const profileRuntime = new ProfileRuntimeService();

const asObject = (value: unknown): JsonObject | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;

const asPositiveInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

const buildForwardTimeoutParams = (params: JsonObject): JsonObject => {
  const timeoutMs = asPositiveInteger(params.timeout_ms);
  return timeoutMs ? { timeout_ms: timeoutMs } : {};
};

const readRuntimeTakeoverEvidence = (status: JsonObject): RuntimeTakeoverEvidence => {
  const evidence = asObject(status.runtimeTakeoverEvidence);
  return evidence ?? {};
};

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const asInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

const isIsoTimestampAtOrAfter = (value: unknown, floor: unknown): boolean => {
  if (typeof value !== "string" || typeof floor !== "string") {
    return false;
  }
  const valueMs = Date.parse(value);
  const floorMs = Date.parse(floor);
  return Number.isFinite(valueMs) && Number.isFinite(floorMs) && valueMs >= floorMs;
};

const buildObservedRuntimeInstanceId = (input: {
  sessionId: string;
  runId: string;
  runtimeContextId: string;
}): string => `${input.sessionId}:${input.runId}:${input.runtimeContextId}`;

const hasObservedRuntimeContinuity = (input: {
  status: JsonObject;
  evidence: RuntimeTakeoverEvidence;
}): boolean => {
  const profile = asNonEmptyString(input.status.profile);
  const observedRunId = asNonEmptyString(input.evidence.observedRunId);
  const observedRuntimeSessionId = asNonEmptyString(input.evidence.observedRuntimeSessionId);
  const observedRuntimeContextId = asNonEmptyString(input.evidence.runtimeContextId);
  const observedRuntimeInstanceId = asNonEmptyString(input.evidence.observedRuntimeInstanceId);
  if (
    profile === null ||
    observedRunId === null ||
    observedRuntimeSessionId === null ||
    observedRuntimeContextId === null ||
    observedRuntimeInstanceId === null
  ) {
    return false;
  }
  if (observedRuntimeContextId !== buildRuntimeBootstrapContextId(profile, observedRunId)) {
    return false;
  }
  return (
    observedRuntimeInstanceId ===
    buildObservedRuntimeInstanceId({
      sessionId: observedRuntimeSessionId,
      runId: observedRunId,
      runtimeContextId: observedRuntimeContextId
    })
  );
};

const hasStaleBootstrapRebindEvidence = (input: {
  status: JsonObject;
  evidence: RuntimeTakeoverEvidence;
  target: OfficialChromeBootstrapTarget;
}): boolean =>
  input.evidence.mode === "stale_bootstrap_rebind" &&
  input.evidence.staleBootstrapRecoverable === true &&
  input.evidence.freshness === "fresh" &&
  input.evidence.identityBound === true &&
  input.evidence.ownerConflictFree === true &&
  input.evidence.controllerBrowserContinuity === true &&
  asNonEmptyString(input.evidence.requestRunId) === asNonEmptyString(input.status.runId) &&
  asNonEmptyString(input.evidence.requestRuntimeContextId) ===
    buildRuntimeBootstrapContextId(
      asNonEmptyString(input.status.profile) ?? "",
      asNonEmptyString(input.status.runId) ?? ""
    ) &&
  hasObservedRuntimeContinuity({
    status: input.status,
    evidence: input.evidence
  }) &&
  asInteger(input.evidence.managedTargetTabId) === input.target.targetTabId &&
  asNonEmptyString(input.evidence.managedTargetDomain) === input.target.targetDomain &&
  asNonEmptyString(input.evidence.managedTargetPage) === input.target.targetPage &&
  input.evidence.targetTabContinuity === "runtime_trust_state" &&
  isIsoTimestampAtOrAfter(input.evidence.takeoverEvidenceObservedAt, input.target.requestedAt) &&
  input.status.executionSurface === "real_browser" &&
  input.status.headless === false &&
  typeof input.target.targetTabId === "number" &&
  Number.isInteger(input.target.targetTabId) &&
  typeof input.target.targetDomain === "string" &&
  input.target.targetDomain.length > 0 &&
  typeof input.target.targetPage === "string" &&
  input.target.targetPage.length > 0;

const isTransportFailureCode = (code: unknown): code is string =>
  code === "ERR_TRANSPORT_HANDSHAKE_FAILED" ||
  code === "ERR_TRANSPORT_TIMEOUT" ||
  code === "ERR_TRANSPORT_DISCONNECTED" ||
  code === "ERR_TRANSPORT_FORWARD_FAILED" ||
  code === "ERR_TRANSPORT_NOT_READY";

const isRuntimeBootstrapPendingCode = (code: unknown): code is string =>
  code === "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED" ||
  code === "ERR_RUNTIME_BOOTSTRAP_ACK_TIMEOUT";

const isRuntimeBootstrapFailureCode = (code: unknown): code is string =>
  code === "ERR_RUNTIME_BOOTSTRAP_ACK_STALE" ||
  code === "ERR_RUNTIME_BOOTSTRAP_IDENTITY_MISMATCH" ||
  code === "ERR_RUNTIME_READY_SIGNAL_CONFLICT";

const buildOfficialChromeRuntimeReadiness = (input: {
  lockHeld: boolean;
  identityBindingState: string;
  transportState: string;
  bootstrapState: string;
}): RuntimeReadiness => {
  if (input.identityBindingState === "missing" || input.identityBindingState === "mismatch") {
    return "blocked";
  }
  if (!input.lockHeld) {
    return input.transportState === "disconnected" ? "recoverable" : "blocked";
  }
  if (input.transportState === "disconnected") {
    return "recoverable";
  }
  if (input.transportState === "ready" && input.bootstrapState === "ready") {
    return "ready";
  }
  if (input.identityBindingState === "bound" && (input.bootstrapState === "pending" || input.bootstrapState === "not_started")) {
    return "pending";
  }
  if (input.bootstrapState === "failed") {
    return "recoverable";
  }
  if (input.bootstrapState === "stale") {
    return "blocked";
  }
  return "unknown";
};

const buildRuntimeBootstrapEnvelope = (input: {
  profile: string;
  runId: string;
  fingerprintRuntime: ReturnType<typeof buildFingerprintContextForMeta>;
  requestedAt?: string | null;
  targetTabId?: number | null;
  targetDomain?: string | null;
  targetPage?: string | null;
  targetResourceId?: string | null;
  timeoutMs?: number | null;
}): JsonObject & {
  version: "v1";
  run_id: string;
  runtime_context_id: string;
  profile: string;
  main_world_secret: string;
} => ({
  version: "v1",
  run_id: input.runId,
  runtime_context_id: buildRuntimeBootstrapContextId(input.profile, input.runId),
  profile: input.profile,
  ...(typeof input.requestedAt === "string" && input.requestedAt.length > 0
    ? { requested_at: input.requestedAt }
    : {}),
  ...(typeof input.targetTabId === "number" && Number.isInteger(input.targetTabId)
    ? { target_tab_id: input.targetTabId }
    : {}),
  ...(typeof input.targetDomain === "string" && input.targetDomain.length > 0
    ? { target_domain: input.targetDomain }
    : {}),
  ...(typeof input.targetPage === "string" && input.targetPage.length > 0
    ? { target_page: input.targetPage }
    : {}),
  ...(typeof input.targetResourceId === "string" && input.targetResourceId.length > 0
    ? { target_resource_id: input.targetResourceId }
    : {}),
  ...(typeof input.timeoutMs === "number" && Number.isInteger(input.timeoutMs) && input.timeoutMs > 0
    ? { timeout_ms: input.timeoutMs }
    : {}),
  fingerprint_runtime: input.fingerprintRuntime,
  fingerprint_patch_manifest: asObject(input.fingerprintRuntime.fingerprint_patch_manifest) ?? {},
  main_world_secret: randomUUID()
});

const sleep = async (ms: number): Promise<void> =>
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const buildOfficialChromeTargetParams = (
  input: OfficialChromeBootstrapTarget = {}
): JsonObject => ({
  ...(typeof input.requestedAt === "string" && input.requestedAt.length > 0
    ? { requested_at: input.requestedAt }
    : {}),
  ...(typeof input.targetTabId === "number" && Number.isInteger(input.targetTabId)
    ? { target_tab_id: input.targetTabId }
    : {}),
  ...(typeof input.targetDomain === "string" && input.targetDomain.length > 0
    ? { target_domain: input.targetDomain }
    : {}),
  ...(typeof input.targetPage === "string" && input.targetPage.length > 0
    ? { target_page: input.targetPage }
    : {}),
  ...(typeof input.targetResourceId === "string" && input.targetResourceId.length > 0
    ? { target_resource_id: input.targetResourceId }
    : {})
});

const readOfficialChromeRuntimeReadinessViaBridge = async (input: {
  lockHeld: boolean;
  context: RuntimeContext;
  bridge: NativeMessagingBridge;
  consumerId: string;
  identityBindingState: string;
  target?: OfficialChromeBootstrapTarget;
}): Promise<{
  identityBindingState: string;
  transportState: TransportState;
  bootstrapState: BootstrapState;
  runtimeReadiness: RuntimeReadiness;
}> => {
  const readinessResult = await input.bridge.runCommand({
    runId: input.context.run_id,
    profile: input.context.profile,
    cwd: input.context.cwd,
    command: "runtime.readiness",
    params: {
      run_id: input.context.run_id,
      runtime_context_id: buildRuntimeBootstrapContextId(
        input.context.profile ?? "",
        input.context.run_id
      ),
      ...buildForwardTimeoutParams(input.context.params ?? {}),
      ...buildOfficialChromeTargetParams(input.target)
    }
  });
  if (!readinessResult.ok) {
    if (isTransportFailureCode(readinessResult.error.code)) {
      throw new CliError("ERR_RUNTIME_UNAVAILABLE", `通信链路不可用: ${readinessResult.error.code}`, {
        retryable: true,
        details: {
          ability_id: input.consumerId,
          stage: "execution",
          reason: readinessResult.error.code
        }
      });
    }
    throw new CliError(
      "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED",
      "official Chrome runtime readiness 未获得执行面确认",
      {
        retryable: true,
        details: {
          ability_id: input.consumerId,
          stage: "execution",
          reason: readinessResult.error.code
        }
      }
    );
  }

  const payload = asObject(readinessResult.payload);
  const hasTransportState =
    payload?.transport_state === "disconnected" ||
    payload?.transport_state === "ready" ||
    payload?.transport_state === "not_connected";
  const hasBootstrapState =
    payload?.bootstrap_state === "not_started" ||
    payload?.bootstrap_state === "pending" ||
    payload?.bootstrap_state === "ready" ||
    payload?.bootstrap_state === "stale" ||
    payload?.bootstrap_state === "failed";
  if (!hasTransportState && !hasBootstrapState) {
    throw new CliError(
      "ERR_RUNTIME_UNAVAILABLE",
      "official Chrome runtime readiness 缺少执行面信号",
      {
        retryable: true,
        details: {
          ability_id: input.consumerId,
          stage: "execution",
          reason: "ERR_RUNTIME_READINESS_SIGNAL_MISSING",
          relay_path: readinessResult.relay_path
        }
      }
    );
  }
  const transportState =
    payload?.transport_state === "disconnected"
      ? "disconnected"
      : payload?.transport_state === "ready"
        ? "ready"
        : "not_connected";
  const bootstrapState =
    payload?.bootstrap_state === "not_started" ||
    payload?.bootstrap_state === "pending" ||
    payload?.bootstrap_state === "ready" ||
    payload?.bootstrap_state === "stale" ||
    payload?.bootstrap_state === "failed"
      ? (String(payload.bootstrap_state) as BootstrapState)
      : "not_started";

  return {
    identityBindingState: input.identityBindingState,
    transportState,
    bootstrapState,
    runtimeReadiness: buildOfficialChromeRuntimeReadiness({
      lockHeld: input.lockHeld,
      identityBindingState: input.identityBindingState,
      transportState,
      bootstrapState
    })
  };
};

const waitForOfficialChromeRuntimeReadinessViaBridge = async (input: {
  lockHeld: boolean;
  context: RuntimeContext;
  bridge: NativeMessagingBridge;
  consumerId: string;
  identityBindingState: string;
  target?: OfficialChromeBootstrapTarget;
}): Promise<{
  identityBindingState: string;
  transportState: TransportState;
  bootstrapState: BootstrapState;
  runtimeReadiness: RuntimeReadiness;
}> => {
  let readiness = await readOfficialChromeRuntimeReadinessViaBridge(input);

  for (let attempt = 1; attempt < OFFICIAL_CHROME_BOOTSTRAP_READINESS_MAX_ATTEMPTS; attempt += 1) {
    if (readiness.runtimeReadiness === "ready") {
      return readiness;
    }
    if (readiness.identityBindingState !== "bound" || readiness.transportState !== "ready") {
      return readiness;
    }
    if (readiness.bootstrapState !== "pending" && readiness.bootstrapState !== "not_started") {
      return readiness;
    }
    await sleep(OFFICIAL_CHROME_BOOTSTRAP_READINESS_RETRY_DELAY_MS);
    readiness = await readOfficialChromeRuntimeReadinessViaBridge(input);
  }

  return readiness;
};

const applyReadinessToStatus = (
  status: JsonObject,
  input: {
    runtimeReadiness: string;
    identityBindingState: string;
    bootstrapState: string;
    transportState: string;
    lockHeld: boolean;
  }
): JsonObject => ({
  ...status,
  runtimeReadiness: input.runtimeReadiness,
  identityBindingState: input.identityBindingState,
  bootstrapState: input.bootstrapState,
  transportState: input.transportState,
  lockHeld: input.lockHeld
});

export const buildOfficialChromeRuntimeStatusParams = (
  _context: RuntimeContext,
  requestedExecutionMode: string,
  target: OfficialChromeBootstrapTarget = {}
): JsonObject => {
  return {
    requested_execution_mode: requestedExecutionMode,
    ...buildForwardTimeoutParams(_context.params ?? {}),
    ...buildOfficialChromeTargetParams(target)
  };
};

export const prepareOfficialChromeRuntime = async (input: {
  context: RuntimeContext;
  consumerId: string;
  requestedExecutionMode: string;
  bridge: NativeMessagingBridge;
  fingerprintContext: ReturnType<typeof buildFingerprintContextForMeta>;
  bootstrapTargetTabId?: number | null;
  bootstrapTargetDomain?: string | null;
  bootstrapTargetPage?: string | null;
  bootstrapTargetResourceId?: string | null;
  readStatus?: RuntimeStatusReader;
  attachRuntime?: RuntimeAttachReader;
}): Promise<JsonObject> => {
  const runtimeBootstrapRequestedAt = new Date().toISOString();
  const readStatus =
    input.readStatus ??
    (async () =>
        await profileRuntime.status({
          cwd: input.context.cwd,
          profile: input.context.profile ?? "",
          runId: input.context.run_id,
          params: buildOfficialChromeRuntimeStatusParams(
            input.context,
            input.requestedExecutionMode,
            {
              requestedAt: runtimeBootstrapRequestedAt,
              targetTabId: input.bootstrapTargetTabId,
              targetDomain: input.bootstrapTargetDomain,
              targetPage: input.bootstrapTargetPage,
              targetResourceId: input.bootstrapTargetResourceId
            }
          )
        }));
  const attachRuntime =
    input.attachRuntime ??
    (async () =>
        await profileRuntime.attach({
          cwd: input.context.cwd,
          profile: input.context.profile ?? "",
          runId: input.context.run_id,
          params: buildOfficialChromeRuntimeStatusParams(
            input.context,
            input.requestedExecutionMode,
            {
              requestedAt: runtimeBootstrapRequestedAt,
              targetTabId: input.bootstrapTargetTabId,
              targetDomain: input.bootstrapTargetDomain,
              targetPage: input.bootstrapTargetPage,
              targetResourceId: input.bootstrapTargetResourceId
            }
          )
        }));

  let status = await readStatus();
  const identityPreflight = asObject(status.identityPreflight);
  if (identityPreflight?.mode !== "official_chrome_persistent_extension") {
    return status;
  }

  let profileState =
    typeof status.profileState === "string" ? status.profileState : "uninitialized";
  let confirmationRequired = status.confirmationRequired === true;
  let runtimeReadiness =
    typeof status.runtimeReadiness === "string" ? status.runtimeReadiness : "unknown";
  let lockHeld = status.lockHeld === true;
  let identityBindingState =
    typeof status.identityBindingState === "string" ? status.identityBindingState : "missing";
  let bootstrapState =
    typeof status.bootstrapState === "string" ? status.bootstrapState : "not_started";
  let transportState =
    typeof status.transportState === "string" ? status.transportState : "not_connected";
  const runtimeTakeoverEvidence = readRuntimeTakeoverEvidence(status);
  const preLockOrphanRecoverable = runtimeTakeoverEvidence.orphanRecoverable === true;
  const preLockAttachableReadyRuntime = runtimeTakeoverEvidence.attachableReadyRuntime === true;
  const bootstrapTarget = {
    requestedAt: runtimeBootstrapRequestedAt,
    targetTabId: input.bootstrapTargetTabId,
    targetDomain: input.bootstrapTargetDomain,
    targetPage: input.bootstrapTargetPage,
    targetResourceId: input.bootstrapTargetResourceId
  };

  const syncRuntimeStatus = (nextStatus: JsonObject): void => {
    status = nextStatus;
    profileState =
      typeof status.profileState === "string" ? status.profileState : "uninitialized";
    confirmationRequired = status.confirmationRequired === true;
    runtimeReadiness =
      typeof status.runtimeReadiness === "string" ? status.runtimeReadiness : "unknown";
    lockHeld = status.lockHeld === true;
    identityBindingState =
      typeof status.identityBindingState === "string" ? status.identityBindingState : "missing";
    bootstrapState =
      typeof status.bootstrapState === "string" ? status.bootstrapState : "not_started";
    transportState =
      typeof status.transportState === "string" ? status.transportState : "not_connected";
  };

  const buildBaseDetails = () => ({
    ability_id: input.consumerId,
    stage: "execution" as const,
    runtime_readiness: runtimeReadiness,
    identity_binding_state: identityBindingState,
    bootstrap_state: bootstrapState,
    transport_state: transportState,
    lock_held: lockHeld,
    profile_state: profileState,
    confirmation_required: confirmationRequired
  });

  const shouldAttemptAttach =
    !lockHeld &&
    identityBindingState === "bound" &&
    ((bootstrapState !== "stale" &&
      (preLockAttachableReadyRuntime ||
        (runtimeReadiness === "recoverable" &&
          preLockOrphanRecoverable &&
          (profileState === "disconnected" || profileState === "ready")))) ||
      (bootstrapState === "stale" &&
        hasStaleBootstrapRebindEvidence({
          status,
          evidence: runtimeTakeoverEvidence,
          target: bootstrapTarget
        })));

  if (shouldAttemptAttach) {
    syncRuntimeStatus(await attachRuntime());
  }

  const attemptExecutionBootstrap = async (): Promise<void> => {
    const envelope = buildRuntimeBootstrapEnvelope({
      profile: input.context.profile ?? "",
      runId: input.context.run_id,
      fingerprintRuntime: input.fingerprintContext,
      requestedAt: runtimeBootstrapRequestedAt,
      targetTabId: input.bootstrapTargetTabId,
      targetDomain: input.bootstrapTargetDomain ?? null,
      targetPage: input.bootstrapTargetPage ?? null,
      targetResourceId: input.bootstrapTargetResourceId ?? null,
      timeoutMs: asPositiveInteger(input.context.params?.timeout_ms)
    });
    const bootstrapResult = await input.bridge.runCommand({
      runId: input.context.run_id,
      profile: input.context.profile,
      cwd: input.context.cwd,
      command: "runtime.bootstrap",
      params: envelope
    });
    if (!bootstrapResult.ok) {
      const failurePayload = asObject(bootstrapResult.payload);
      const failureDetails = asObject(failurePayload?.details);
      const failureReason =
        typeof failureDetails?.reason === "string" && failureDetails.reason.length > 0
          ? failureDetails.reason
          : null;
      if (
        failureReason === "TARGET_TAB_DISPATCH_FAILED" ||
        failureReason === "TARGET_TAB_UNAVAILABLE" ||
        failureReason === "TARGET_TAB_NOT_FOUND"
      ) {
        throw new CliError("ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED", "official Chrome runtime bootstrap target tab 不可达", {
          details: {
            ...buildBaseDetails(),
            ...failureDetails,
            reason: failureReason
          },
          retryable: true
        });
      }
      if (isTransportFailureCode(bootstrapResult.error.code)) {
        throw new CliError("ERR_RUNTIME_UNAVAILABLE", `通信链路不可用: ${bootstrapResult.error.code}`, {
          details: {
            ability_id: input.consumerId,
            stage: "execution",
            reason: bootstrapResult.error.code
          },
          retryable: true
        });
      }
      if (isRuntimeBootstrapPendingCode(bootstrapResult.error.code)) {
        return;
      }
      if (isRuntimeBootstrapFailureCode(bootstrapResult.error.code)) {
        throw new CliError(bootstrapResult.error.code, bootstrapResult.error.message, {
          details: {
            ability_id: input.consumerId,
            stage: "execution",
            reason: bootstrapResult.error.code
          },
          retryable: bootstrapResult.error.code !== "ERR_RUNTIME_BOOTSTRAP_IDENTITY_MISMATCH"
        });
      }
      throw new CliError("ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED", "official Chrome runtime bootstrap 未获得执行面确认", {
        details: {
          ability_id: input.consumerId,
          stage: "execution",
          reason: bootstrapResult.error.code
        },
        retryable: true
      });
    }

    const payload = asObject(bootstrapResult.payload);
    const ack = asObject(payload?.result);
    const ackVersion = typeof ack?.version === "string" ? ack.version : null;
    const ackStatus = typeof ack?.status === "string" ? ack.status : null;
    const ackRunId = typeof ack?.run_id === "string" ? ack.run_id : null;
    const ackContextId = typeof ack?.runtime_context_id === "string" ? ack.runtime_context_id : null;
    const ackProfile = typeof ack?.profile === "string" ? ack.profile : null;
    if (
      ackStatus !== "ready" ||
      ackVersion !== envelope.version ||
      ackRunId !== envelope.run_id ||
      ackContextId !== envelope.runtime_context_id ||
      ackProfile !== envelope.profile
    ) {
      throw new CliError(
        ackStatus === "stale"
          ? "ERR_RUNTIME_BOOTSTRAP_ACK_STALE"
          : "ERR_RUNTIME_READY_SIGNAL_CONFLICT",
        ackStatus === "stale"
          ? "official Chrome runtime bootstrap 返回了陈旧 ack"
          : "official Chrome runtime bootstrap ack 与当前运行上下文不一致",
        {
          details: {
            ability_id: input.consumerId,
            stage: "execution",
            reason:
              ackStatus === "stale"
                ? "ERR_RUNTIME_BOOTSTRAP_ACK_STALE"
                : "ERR_RUNTIME_READY_SIGNAL_CONFLICT"
          },
          retryable: true
        }
      );
    }
  };

  if (runtimeReadiness === "ready" && lockHeld) {
    return applyReadinessToStatus(status, {
      runtimeReadiness,
      identityBindingState,
      bootstrapState,
      transportState,
      lockHeld
    });
  }

  if (profileState === "logging_in" || confirmationRequired) {
    throw new CliError("ERR_RUNTIME_UNAVAILABLE", "official Chrome runtime 登录确认未完成", {
      details: {
        ...buildBaseDetails(),
        reason: "ERR_RUNTIME_LOGIN_CONFIRMATION_REQUIRED"
      },
      retryable: false
    });
  }

  if (
    lockHeld &&
    identityBindingState === "bound" &&
    runtimeReadiness !== "ready" &&
    bootstrapState !== "stale" &&
    transportState !== "ready"
  ) {
    const bridgedReadiness = await readOfficialChromeRuntimeReadinessViaBridge({
      lockHeld,
      context: input.context,
      bridge: input.bridge,
      consumerId: input.consumerId,
      identityBindingState,
      target: {
        requestedAt: runtimeBootstrapRequestedAt,
        targetTabId: input.bootstrapTargetTabId,
        targetDomain: input.bootstrapTargetDomain,
        targetPage: input.bootstrapTargetPage,
        targetResourceId: input.bootstrapTargetResourceId
      }
    });
    runtimeReadiness = bridgedReadiness.runtimeReadiness;
    identityBindingState = bridgedReadiness.identityBindingState;
    bootstrapState = bridgedReadiness.bootstrapState;
    transportState = bridgedReadiness.transportState;
    if (runtimeReadiness === "ready") {
      return applyReadinessToStatus(status, {
        runtimeReadiness,
        identityBindingState,
        bootstrapState,
        transportState,
        lockHeld
      });
    }
  }

  if (
    lockHeld &&
    identityBindingState === "bound" &&
    transportState === "ready" &&
    (bootstrapState === "not_started" ||
      bootstrapState === "pending" ||
      bootstrapState === "stale" ||
      bootstrapState === "failed")
  ) {
    await attemptExecutionBootstrap();
    syncRuntimeStatus(await readStatus());

    if (runtimeReadiness !== "ready" && lockHeld && identityBindingState === "bound") {
      const bridgedReadiness = await readOfficialChromeRuntimeReadinessViaBridge({
        lockHeld,
        context: input.context,
        bridge: input.bridge,
        consumerId: input.consumerId,
        identityBindingState,
        target: {
          requestedAt: runtimeBootstrapRequestedAt,
          targetTabId: input.bootstrapTargetTabId,
          targetDomain: input.bootstrapTargetDomain,
          targetPage: input.bootstrapTargetPage,
          targetResourceId: input.bootstrapTargetResourceId
        }
      });
      runtimeReadiness = bridgedReadiness.runtimeReadiness;
      identityBindingState = bridgedReadiness.identityBindingState;
      bootstrapState = bridgedReadiness.bootstrapState;
      transportState = bridgedReadiness.transportState;
      if (runtimeReadiness !== "ready" && bootstrapState !== "stale") {
        const convergedReadiness = await waitForOfficialChromeRuntimeReadinessViaBridge({
          lockHeld,
          context: input.context,
          bridge: input.bridge,
          consumerId: input.consumerId,
          identityBindingState,
          target: {
            requestedAt: runtimeBootstrapRequestedAt,
            targetTabId: input.bootstrapTargetTabId,
            targetDomain: input.bootstrapTargetDomain,
            targetPage: input.bootstrapTargetPage,
            targetResourceId: input.bootstrapTargetResourceId
          }
        });
        runtimeReadiness = convergedReadiness.runtimeReadiness;
        identityBindingState = convergedReadiness.identityBindingState;
        bootstrapState = convergedReadiness.bootstrapState;
        transportState = convergedReadiness.transportState;
      }
    }

    if (runtimeReadiness === "ready") {
      return applyReadinessToStatus(status, {
        runtimeReadiness,
        identityBindingState,
        bootstrapState,
        transportState,
        lockHeld
      });
    }
  }

  if (identityBindingState === "missing") {
    throw new CliError("ERR_RUNTIME_IDENTITY_NOT_BOUND", "official Chrome runtime identity 未绑定", {
      details: {
        ...buildBaseDetails(),
        reason: "ERR_RUNTIME_IDENTITY_NOT_BOUND"
      }
    });
  }
  if (identityBindingState === "mismatch") {
    throw new CliError("ERR_RUNTIME_IDENTITY_MISMATCH", "official Chrome runtime identity 不一致", {
      details: {
        ...buildBaseDetails(),
        reason: "ERR_RUNTIME_IDENTITY_MISMATCH"
      }
    });
  }
  if (bootstrapState === "stale") {
    throw new CliError("ERR_RUNTIME_BOOTSTRAP_ACK_STALE", "official Chrome runtime bootstrap 上下文已陈旧", {
      details: {
        ...buildBaseDetails(),
        reason: "ERR_RUNTIME_BOOTSTRAP_ACK_STALE"
      },
      retryable: true
    });
  }
  if (!lockHeld) {
    throw new CliError("ERR_PROFILE_LOCKED", "official Chrome runtime 未持有 profile 锁", {
      details: {
        ...buildBaseDetails(),
        reason: "ERR_PROFILE_LOCKED"
      },
      retryable: true
    });
  }
  if (transportState !== "ready") {
    throw new CliError("ERR_RUNTIME_UNAVAILABLE", "official Chrome runtime 传输链路未就绪", {
      details: {
        ...buildBaseDetails(),
        reason: "ERR_RUNTIME_TRANSPORT_NOT_READY"
      },
      retryable: true
    });
  }
  if (bootstrapState === "not_started" || bootstrapState === "pending") {
    throw new CliError("ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED", "official Chrome runtime bootstrap 未就绪", {
      details: {
        ...buildBaseDetails(),
        reason: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED"
      },
      retryable: true
    });
  }

  throw new CliError("ERR_RUNTIME_UNAVAILABLE", "official Chrome runtime 未就绪", {
    details: {
      ...buildBaseDetails(),
      reason: "ERR_RUNTIME_NOT_READY"
    },
    retryable: true
  });
};
