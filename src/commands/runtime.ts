import { CliError } from "../core/errors.js";
import type { CommandDefinition, RuntimeContext } from "../core/types.js";
import {
  WRITE_INTERACTION_TIER,
  getWriteActionMatrixDecisions
} from "../../shared/risk-state.js";
import {
  NativeMessagingBridge,
  NativeMessagingTransportError
} from "../runtime/native-messaging/bridge.js";
import { NativeHostBridgeTransport } from "../runtime/native-messaging/host.js";
import { createLoopbackNativeBridgeTransport } from "../runtime/native-messaging/loopback.js";
import { ProfileRuntimeService } from "../runtime/profile-runtime.js";
import {
  buildUnifiedRiskStateOutput,
  resolveRiskState,
  type RiskState
} from "../runtime/risk-state.js";
import {
  RuntimeStoreError,
  SQLiteRuntimeStore,
  resolveRuntimeStorePath
} from "../runtime/store/sqlite-runtime-store.js";

const asBoolean = (value: unknown): boolean => value === true;
const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;
const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

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
const profileRuntime = new ProfileRuntimeService();

const deriveWriteActionDecisions = (auditRecord: Record<string, unknown>) =>
  getWriteActionMatrixDecisions(
    asString(auditRecord.issue_scope),
    asString(auditRecord.action_type),
    asString(auditRecord.requested_execution_mode)
  );

const enrichAuditRecordWithWriteTier = (auditRecord: Record<string, unknown>) => {
  const writeActionMatrixDecisions = deriveWriteActionDecisions(auditRecord);
  const existingGateReasons = asStringArray(auditRecord.gate_reasons);
  const derivedGateReasons = [...existingGateReasons];
  const tierReason = `WRITE_INTERACTION_TIER_${String(writeActionMatrixDecisions.write_interaction_tier).toUpperCase()}`;
  if (
    writeActionMatrixDecisions.action_type !== "read" &&
    !derivedGateReasons.some((reason) => reason === tierReason)
  ) {
    derivedGateReasons.push(tierReason);
  }
  return {
    ...auditRecord,
    gate_reasons: derivedGateReasons,
    write_interaction_tier: writeActionMatrixDecisions.write_interaction_tier,
    write_action_matrix_decisions: writeActionMatrixDecisions
  };
};

const resolveCurrentRiskState = (
  approvalRecord: Record<string, unknown> | null,
  auditRecords: Record<string, unknown>[]
): RiskState => {
  const latestAudit = auditRecords[0] ?? null;
  const auditNextState = latestAudit?.next_state;
  const auditRiskState = latestAudit?.risk_state;
  if (typeof auditNextState === "string") {
    return resolveRiskState(auditNextState);
  }
  const latestRequestedMode =
    typeof latestAudit?.requested_execution_mode === "string"
      ? latestAudit.requested_execution_mode
      : null;
  const latestGateDecision =
    latestAudit?.gate_decision === "allowed" || latestAudit?.gate_decision === "blocked"
      ? latestAudit.gate_decision
      : null;
  const isLatestLiveMode =
    latestRequestedMode === "live_read_limited" ||
    latestRequestedMode === "live_read_high_risk" ||
    latestRequestedMode === "live_write";

  if (latestGateDecision === "blocked" && isLatestLiveMode) {
    const resolvedAuditRiskState = resolveRiskState(auditRiskState);
    if (resolvedAuditRiskState === "allowed") {
      return "limited";
    }
    if (resolvedAuditRiskState === "limited") {
      return "paused";
    }
    return resolvedAuditRiskState;
  }

  if (typeof auditRiskState === "string") {
    return resolveRiskState(auditRiskState);
  }

  const approvalChecks = asObject(approvalRecord?.checks);
  if (approvalRecord?.approved === true && approvalChecks?.risk_state_checked === true) {
    return "allowed";
  }

  const gateReasons = Array.isArray(latestAudit?.gate_reasons)
    ? latestAudit.gate_reasons.filter((item): item is string => typeof item === "string")
    : [];
  if (gateReasons.some((reason) => reason === "RISK_STATE_LIMITED")) {
    return "limited";
  }
  return "paused";
};

const runtimePing = async (context: RuntimeContext) => {
  if (asBoolean(context.params.simulate_runtime_unavailable)) {
    throw new CliError("ERR_RUNTIME_UNAVAILABLE", "运行时不可用", { retryable: true });
  }

  if (asBoolean(context.params.force_fail)) {
    throw new Error("forced execution failure");
  }

  try {
    const bridge = resolveRuntimeBridge();
    return await bridge.runtimePing({
      runId: context.run_id,
      profile: context.profile,
      cwd: context.cwd,
      params: context.params
    });
  } catch (error) {
    if (error instanceof NativeMessagingTransportError) {
      throw new CliError("ERR_RUNTIME_UNAVAILABLE", `通信链路不可用: ${error.code}`, {
        retryable: error.retryable,
        cause: error
      });
    }
    throw error;
  }
};

const runtimeStart = async (context: RuntimeContext) =>
  profileRuntime.start({
    cwd: context.cwd,
    profile: context.profile ?? "",
    runId: context.run_id,
    params: context.params
  });

const runtimeLogin = async (context: RuntimeContext) =>
  profileRuntime.login({
    cwd: context.cwd,
    profile: context.profile ?? "",
    runId: context.run_id,
    params: context.params
  });

const runtimeStatus = async (context: RuntimeContext) =>
  profileRuntime.status({
    cwd: context.cwd,
    profile: context.profile ?? "",
    runId: context.run_id,
    params: context.params
  });

const runtimeStop = async (context: RuntimeContext) =>
  profileRuntime.stop({
    cwd: context.cwd,
    profile: context.profile ?? "",
    runId: context.run_id,
    params: context.params
  });

const runtimeAuditQuery = async (context: RuntimeContext) => {
  const runId = asString(context.params.run_id);
  const sessionId = asString(context.params.session_id);
  const profile = asString(context.params.profile);
  const limitRaw = asInteger(context.params.limit);
  const limit = limitRaw === null ? 20 : Math.max(1, Math.min(100, limitRaw));

  if (!runId && !sessionId && !profile) {
    throw new CliError("ERR_CLI_INVALID_ARGS", "审计查询参数不合法", {
      details: {
        ability_id: "runtime.audit",
        stage: "input_validation",
        reason: "AUDIT_QUERY_FILTER_MISSING"
      }
    });
  }

  let store: SQLiteRuntimeStore | null = null;
  try {
    store = new SQLiteRuntimeStore(resolveRuntimeStorePath(context.cwd));
    if (runId) {
      const trail = await store.getGateAuditTrail(runId);
      const enrichedAuditRecords = trail.auditRecords.map((record) =>
        enrichAuditRecordWithWriteTier(record as unknown as Record<string, unknown>)
      );
      const currentRiskState = resolveCurrentRiskState(
        asObject(trail.approvalRecord),
        enrichedAuditRecords
      );
      return {
        query: {
          run_id: runId
        },
        approval_record: trail.approvalRecord,
        audit_records: enrichedAuditRecords,
        write_interaction_tier: WRITE_INTERACTION_TIER,
        write_action_matrix_decisions:
          (enrichedAuditRecords[0] as Record<string, unknown> | undefined)
            ?.write_action_matrix_decisions ?? null,
        risk_state_output: buildUnifiedRiskStateOutput(currentRiskState, {
          auditRecords: enrichedAuditRecords
        })
      };
    }

    const records = await store.listGateAuditRecords({
      sessionId: sessionId ?? undefined,
      profile: profile ?? undefined,
      limit
    });
    const enrichedAuditRecords = records.map((record) =>
      enrichAuditRecordWithWriteTier(record as unknown as Record<string, unknown>)
    );
    const currentRiskState = resolveCurrentRiskState(
      null,
      enrichedAuditRecords
    );
    return {
      query: {
        ...(sessionId ? { session_id: sessionId } : {}),
        ...(profile ? { profile } : {}),
        limit
      },
      audit_records: enrichedAuditRecords,
      write_interaction_tier: WRITE_INTERACTION_TIER,
      write_action_matrix_decisions:
        (enrichedAuditRecords[0] as Record<string, unknown> | undefined)
          ?.write_action_matrix_decisions ?? null,
      risk_state_output: buildUnifiedRiskStateOutput(currentRiskState, {
        auditRecords: enrichedAuditRecords
      })
    };
  } catch (error) {
    if (error instanceof RuntimeStoreError) {
      if (error.code === "ERR_RUNTIME_STORE_INVALID_INPUT") {
        throw new CliError("ERR_CLI_INVALID_ARGS", "审计查询参数不合法", {
          details: {
            ability_id: "runtime.audit",
            stage: "input_validation",
            reason: "AUDIT_QUERY_INVALID_INPUT"
          }
        });
      }
      throw new CliError("ERR_RUNTIME_UNAVAILABLE", `运行记录存储失败: ${error.code}`, {
        retryable: error.code !== "ERR_RUNTIME_STORE_SCHEMA_MISMATCH",
        cause: error
      });
    }
    throw error;
  } finally {
    try {
      store?.close();
    } catch {
      // Best-effort close for read-only query path.
    }
  }
};

const runtimeHelp = async () => ({
  usage: "webenvoy <command> [--params '<json>'] [--profile <profile>] [--run-id <run_id>]",
  commands: [
    "runtime.help",
    "runtime.ping",
    "runtime.start",
    "runtime.login",
    "runtime.status",
    "runtime.stop",
    "runtime.audit",
    "xhs.search"
  ],
  notes: ["--params 必须是 JSON 对象字符串", "stdout 只输出单个 JSON 对象"]
});

export const runtimeCommands = (): CommandDefinition[] => [
  {
    name: "runtime.help",
    status: "implemented",
    handler: runtimeHelp
  },
  {
    name: "runtime.ping",
    status: "implemented",
    handler: runtimePing
  },
  {
    name: "runtime.start",
    status: "implemented",
    requiresProfile: true,
    handler: runtimeStart
  },
  {
    name: "runtime.login",
    status: "implemented",
    requiresProfile: true,
    handler: runtimeLogin
  },
  {
    name: "runtime.status",
    status: "implemented",
    requiresProfile: true,
    handler: runtimeStatus
  },
  {
    name: "runtime.stop",
    status: "implemented",
    requiresProfile: true,
    handler: runtimeStop
  },
  {
    name: "runtime.audit",
    status: "implemented",
    handler: runtimeAuditQuery
  }
];
