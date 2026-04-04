import type { CliError } from "../../core/errors.js";
import type { JsonObject, RuntimeContext } from "../../core/types.js";
import { getWriteActionMatrixDecisions } from "../../../shared/risk-state.js";
import {
  RuntimeStoreError,
  SQLiteRuntimeStore,
  type AppendRunEventInput,
  type AppendGateAuditRecordInput,
  type UpsertGateApprovalInput,
  type UpsertRunInput,
  resolveRuntimeStorePath
} from "./sqlite-runtime-store.js";

const resolveSessionId = (summary: JsonObject): string | null => {
  const directSession = summary.sessionId;
  if (typeof directSession === "string" && directSession.length > 0) {
    return directSession;
  }

  const directSnake = summary.session_id;
  if (typeof directSnake === "string" && directSnake.length > 0) {
    return directSnake;
  }

  const transport = summary.transport;
  if (transport && typeof transport === "object" && !Array.isArray(transport)) {
    const nested = (transport as Record<string, unknown>).session_id;
    if (typeof nested === "string" && nested.length > 0) {
      return nested;
    }
  }

  return null;
};

const toSummaryText = (summary: JsonObject): string => JSON.stringify(summary);

const asObject = (value: unknown): JsonObject | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const asInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

const asBoolean = (value: unknown): boolean => value === true;

const buildEvent = (
  context: RuntimeContext,
  input: Omit<AppendRunEventInput, "runId" | "eventTime">
): AppendRunEventInput => ({
  runId: context.run_id,
  eventTime: new Date().toISOString(),
  ...input
});

interface RuntimeStoreWriter {
  upsertRun(input: UpsertRunInput): Promise<unknown>;
  appendRunEvent(input: AppendRunEventInput): Promise<unknown>;
  upsertGateApproval?(input: UpsertGateApprovalInput): Promise<unknown>;
  appendGateAuditRecord?(input: AppendGateAuditRecordInput): Promise<unknown>;
  close(): void;
}

const extractGateApprovalInput = (
  source: JsonObject
): UpsertGateApprovalInput | null => {
  const approvalRecord = asObject(source.approval_record);
  if (!approvalRecord) {
    return null;
  }

  const runId =
    asString(source.run_id) ??
    asString((asObject(source.audit_record) ?? {}).run_id) ??
    asString((asObject(source.gate_input) ?? {}).run_id);
  if (!runId) {
    return null;
  }

  const checksObject = asObject(approvalRecord.checks) ?? {};
  return {
    runId,
    approved: asBoolean(approvalRecord.approved),
    approver: asString(approvalRecord.approver),
    approvedAt: asString(approvalRecord.approved_at),
    checks: Object.fromEntries(
      Object.entries(checksObject).map(([key, value]) => [key, asBoolean(value)])
    )
  };
};

const extractGateAuditRecordInput = (
  source: JsonObject
): AppendGateAuditRecordInput | null => {
  const auditRecord = asObject(source.audit_record);
  const transitionAudit = asObject(source.risk_transition_audit);
  const gateInput = asObject(source.gate_input);
  const consumerGateResult = asObject(source.consumer_gate_result);
  const providedWriteActionDecisions = asObject(source.write_action_matrix_decisions);
  if (!auditRecord) {
    return null;
  }

  const derivedIssueScope =
    asString(auditRecord.issue_scope) ??
    asString(gateInput?.issue_scope) ??
    asString(transitionAudit?.issue_scope);
  const derivedActionType =
    asString(auditRecord.action_type) ??
    asString(consumerGateResult?.action_type) ??
    asString(gateInput?.action_type) ??
    asString(providedWriteActionDecisions?.action_type);
  const derivedRequestedExecutionMode =
    asString(auditRecord.requested_execution_mode) ??
    asString(consumerGateResult?.requested_execution_mode) ??
    asString(gateInput?.requested_execution_mode) ??
    asString(providedWriteActionDecisions?.requested_execution_mode);
  const derivedWriteActionDecisions =
    derivedIssueScope && derivedActionType && derivedRequestedExecutionMode
      ? getWriteActionMatrixDecisions(
          derivedIssueScope,
          derivedActionType,
          derivedRequestedExecutionMode
        )
      : null;
  const runId =
    asString(auditRecord.run_id) ?? asString(gateInput?.run_id) ?? asString(source.run_id);
  const sessionId =
    asString(auditRecord.session_id) ??
    asString(gateInput?.session_id) ??
    asString(source.session_id);
  const profile = asString(auditRecord.profile) ?? asString(gateInput?.profile) ?? asString(source.profile);
  const eventId = asString(auditRecord.event_id);
  const riskState = asString(auditRecord.risk_state) ?? asString(consumerGateResult?.risk_state);
  const issueScope =
    asString(auditRecord.issue_scope) ??
    asString(gateInput?.issue_scope) ??
    asString(transitionAudit?.issue_scope) ??
    asString(consumerGateResult?.issue_scope) ??
    asString(providedWriteActionDecisions?.issue_scope);
  const nextState =
    asString(auditRecord.next_state) ?? asString(transitionAudit?.next_state) ?? riskState;
  const transitionTrigger =
    asString(auditRecord.transition_trigger) ??
    asString(transitionAudit?.trigger) ??
    "gate_evaluation";
  const targetDomain = asString(auditRecord.target_domain);
  const targetTabId = asInteger(auditRecord.target_tab_id);
  const targetPage = asString(auditRecord.target_page);
  const actionType =
    asString(auditRecord.action_type) ??
    asString(consumerGateResult?.action_type) ??
    asString(gateInput?.action_type) ??
    asString(providedWriteActionDecisions?.action_type);
  const requestedExecutionMode =
    asString(auditRecord.requested_execution_mode) ??
    asString(consumerGateResult?.requested_execution_mode) ??
    asString(gateInput?.requested_execution_mode) ??
    asString(providedWriteActionDecisions?.requested_execution_mode) ??
    asString(derivedWriteActionDecisions?.requested_execution_mode);
  const effectiveExecutionMode =
    asString(auditRecord.effective_execution_mode) ??
    asString(consumerGateResult?.effective_execution_mode) ??
    requestedExecutionMode;
  const gateDecision =
    asString(auditRecord.gate_decision) ??
    asString(consumerGateResult?.gate_decision) ??
    asString(asObject(source.gate_outcome)?.gate_decision);
  const recordedAt = asString(auditRecord.recorded_at);
  const gateReasons = Array.isArray(auditRecord.gate_reasons)
    ? auditRecord.gate_reasons.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0
      )
    : Array.isArray(consumerGateResult?.gate_reasons)
      ? consumerGateResult.gate_reasons.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        )
    : [];

  if (
    !runId ||
    !sessionId ||
    !profile ||
    !issueScope ||
    !eventId ||
    !riskState ||
    !nextState ||
    !transitionTrigger ||
    !targetDomain ||
    targetTabId === null ||
    !targetPage ||
    !requestedExecutionMode ||
    !effectiveExecutionMode ||
    !gateDecision ||
    !recordedAt ||
    gateReasons.length === 0
  ) {
    return null;
  }

  return {
    eventId,
    runId,
    sessionId,
    profile,
    issueScope,
    riskState,
    nextState,
    transitionTrigger,
    targetDomain,
    targetTabId,
    targetPage,
    actionType,
    requestedExecutionMode,
    effectiveExecutionMode,
    gateDecision,
    gateReasons,
    approver: asString(auditRecord.approver),
    approvedAt: asString(auditRecord.approved_at),
    recordedAt
  };
};

export class RuntimeStoreRecorder {
  #store: RuntimeStoreWriter;
  #startedAtByRunId = new Map<string, string>();

  constructor(cwd: string, store?: RuntimeStoreWriter) {
    this.#store = store ?? new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
  }

  close(): void {
    this.#store.close();
  }

  #ensureStartedAt(runId: string): string {
    const existing = this.#startedAtByRunId.get(runId);
    if (existing) {
      return existing;
    }
    const startedAt = new Date().toISOString();
    this.#startedAtByRunId.set(runId, startedAt);
    return startedAt;
  }

  async #recordGateArtifacts(source: JsonObject): Promise<void> {
    const approvalInput = extractGateApprovalInput(source);
    if (approvalInput && this.#store.upsertGateApproval) {
      await this.#store.upsertGateApproval(approvalInput);
    }

    const auditInput = extractGateAuditRecordInput(source);
    if (auditInput && this.#store.appendGateAuditRecord) {
      await this.#store.appendGateAuditRecord(auditInput);
    }
  }

  async recordStart(context: RuntimeContext): Promise<void> {
    await this.#store.upsertRun({
      runId: context.run_id,
      sessionId: null,
      profileName: context.profile ?? "anonymous",
      command: context.command,
      status: "running",
      startedAt: this.#ensureStartedAt(context.run_id),
      endedAt: null,
      errorCode: null
    });
    await this.#store.appendRunEvent(
      buildEvent(context, {
        stage: "boot",
        component: "cli",
        eventType: "started",
        diagnosisCategory: null,
        failurePoint: null,
        summary: "command started"
      })
    );
  }

  async recordSuccess(context: RuntimeContext, summary: JsonObject): Promise<void> {
    try {
      await this.#store.upsertRun({
        runId: context.run_id,
        sessionId: resolveSessionId(summary),
        profileName: context.profile ?? "anonymous",
        command: context.command,
        status: "succeeded",
        startedAt: this.#ensureStartedAt(context.run_id),
        endedAt: new Date().toISOString(),
        errorCode: null
      });
      await this.#store.appendRunEvent(
        buildEvent(context, {
          stage: "command",
          component: "runtime",
          eventType: "succeeded",
          diagnosisCategory: null,
          failurePoint: null,
          summary: toSummaryText(summary)
        })
      );
      await this.#recordGateArtifacts(summary);
    } finally {
      this.#startedAtByRunId.delete(context.run_id);
    }
  }

  async recordFailure(context: RuntimeContext, error: CliError): Promise<void> {
    try {
      await this.#store.upsertRun({
        runId: context.run_id,
        sessionId: null,
        profileName: context.profile ?? "anonymous",
        command: context.command,
        status: "failed",
        startedAt: this.#ensureStartedAt(context.run_id),
        endedAt: new Date().toISOString(),
        errorCode: error.code
      });
      await this.#store.appendRunEvent(
        buildEvent(context, {
          stage: "command",
          component: "runtime",
          eventType: "failed",
          diagnosisCategory: "execution_error",
          failurePoint: context.command,
          summary: `${error.code}: ${error.message}`
        })
      );
      if (error.details) {
        await this.#recordGateArtifacts(error.details);
      }
    } finally {
      this.#startedAtByRunId.delete(context.run_id);
    }
  }
}

export const createRuntimeStoreRecorder = (cwd: string): RuntimeStoreRecorder =>
  process.env.WEBENVOY_RUNTIME_STORE_FORCE_UNAVAILABLE === "1"
    ? (() => {
        throw new RuntimeStoreError(
          "ERR_RUNTIME_STORE_UNAVAILABLE",
          "runtime store unavailable (forced)"
        );
      })()
    : new RuntimeStoreRecorder(cwd);
