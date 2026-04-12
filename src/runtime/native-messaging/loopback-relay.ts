import { BRIDGE_PROTOCOL, ensureBridgeRequestEnvelope, type BridgeRequestEnvelope } from "./protocol.js";
import { RELAY_PATH, buildLoopbackGate } from "./loopback-gate.js";
import { buildLoopbackAuditRecord } from "./loopback-gate-audit.js";
import { buildLoopbackGatePayload } from "./loopback-gate-payload.js";
import type { ContentMessage, HostMessage } from "./loopback-messages.js";
import type { InMemoryPort } from "./loopback-port.js";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const resolveApprovalRecord = (
  options: Record<string, unknown>
): Record<string, unknown> | null => asRecord(options.approval_record) ?? asRecord(options.approval);

const resolveLoopbackApprovalId = (
  approvalRecord: Record<string, unknown> | null,
  decisionId: string
): string | null => {
  const checks = asRecord(approvalRecord?.checks);
  const approvalComplete =
    approvalRecord?.approved === true &&
    typeof approvalRecord.approver === "string" &&
    approvalRecord.approver.trim().length > 0 &&
    typeof approvalRecord.approved_at === "string" &&
    approvalRecord.approved_at.trim().length > 0 &&
    checks?.target_domain_confirmed === true &&
    checks?.target_tab_confirmed === true &&
    checks?.target_page_confirmed === true &&
    checks?.risk_state_checked === true &&
    checks?.action_type_confirmed === true;
  if (!approvalComplete) {
    return null;
  }
  const approvalDecisionId = asString(approvalRecord?.decision_id);
  const approvalId = asString(approvalRecord?.approval_id);
  if (approvalDecisionId && approvalDecisionId !== decisionId) {
    return null;
  }
  if (approvalId && !approvalDecisionId) {
    return null;
  }
  return approvalId ?? `gate_appr_${decisionId}`;
};

const buildLoopbackGateSeedOptions = (input: {
  options: Record<string, unknown>;
  decisionId: string;
  approvalId: string | null;
  approvalRecord: Record<string, unknown> | null;
}): Record<string, unknown> => {
  const nextOptions = { ...input.options };
  const approvalDecisionId = asString(input.approvalRecord?.decision_id);
  const approvalId = asString(input.approvalRecord?.approval_id);
  const canSeedApprovalRecord =
    input.approvalRecord &&
    (!approvalDecisionId || approvalDecisionId === input.decisionId) &&
    (!approvalId || approvalDecisionId === input.decisionId);
  if (canSeedApprovalRecord) {
    const seededApprovalRecord = {
      ...input.approvalRecord,
      decision_id: input.decisionId,
      ...(input.approvalId ? { approval_id: input.approvalId } : {})
    };
    nextOptions.approval_record = seededApprovalRecord;
    nextOptions.approval = seededApprovalRecord;
  }
  return nextOptions;
};

const resolveGateDecisionId = (input: {
  runId: string;
  requestId: string;
  commandRequestId?: unknown;
}): string => {
  const commandRequestId = asString(input.commandRequestId);
  const baseDecisionId = `gate_decision_${input.runId}_${input.requestId}`;
  return commandRequestId ? `${baseDecisionId}_${commandRequestId}` : baseDecisionId;
};

const mergeGateArtifactsIntoCommandParams = (
  commandParams: Record<string, unknown>,
  gatePayload?: Record<string, unknown>
): Record<string, unknown> => {
  if (!gatePayload) {
    return commandParams;
  }
  const approvalRecord = asRecord(gatePayload.approval_record);
  const auditRecord = asRecord(gatePayload.audit_record);
  if (!approvalRecord && !auditRecord) {
    return commandParams;
  }

  const normalized: Record<string, unknown> = { ...commandParams };
  const normalizedOptions = asRecord(commandParams.options)
    ? { ...(asRecord(commandParams.options) as Record<string, unknown>) }
    : {};

  if (approvalRecord) {
    normalized.approval_record = approvalRecord;
    normalized.approval = approvalRecord;
    normalizedOptions.approval_record = approvalRecord;
    normalizedOptions.approval = approvalRecord;
  }
  if (auditRecord) {
    normalized.audit_record = auditRecord;
    normalizedOptions.audit_record = auditRecord;
  }

  normalized.options = normalizedOptions;
  return normalized;
};

export class InMemoryBackgroundRelay {
  #pendingForward = new Map<
    string,
    {
      request: BridgeRequestEnvelope;
      gatePayload?: Record<string, unknown>;
    }
  >();
  #sessionId = "nm-session-001";

  constructor(
    private readonly hostPort: InMemoryPort<HostMessage>,
    private readonly contentPort: InMemoryPort<ContentMessage>
  ) {
    this.hostPort.onMessage((message) => {
      if (message.kind !== "request") {
        return;
      }

      this.handleHostRequest(message.envelope);
    });

    this.contentPort.onMessage((message) => {
      if (message.kind !== "result") {
        return;
      }

      this.handleContentResult(message);
    });
  }

  private handleHostRequest(request: BridgeRequestEnvelope): void {
    ensureBridgeRequestEnvelope(request);

    if (request.method === "bridge.open") {
      this.hostPort.postMessage({
        kind: "response",
        envelope: {
          id: request.id,
          status: "success",
          summary: {
            protocol: BRIDGE_PROTOCOL,
            session_id: this.#sessionId,
            state: "ready",
            relay_path: RELAY_PATH
          },
          error: null
        }
      });
      return;
    }

    if (request.method === "__ping__") {
      this.hostPort.postMessage({
        kind: "response",
        envelope: {
          id: request.id,
          status: "success",
          summary: {
            session_id: this.#sessionId,
            relay_path: RELAY_PATH
          },
          error: null
        }
      });
      return;
    }

    if (request.method === "bridge.forward") {
      const command = String(request.params.command ?? "");
      const commandParams =
        typeof request.params.command_params === "object" && request.params.command_params !== null
          ? (request.params.command_params as Record<string, unknown>)
          : {};
      const runId = String(request.params.run_id ?? request.id);
      const sessionId = String(request.params.session_id ?? this.#sessionId);
      let gatePayload: Record<string, unknown> | undefined;

      if (command === "xhs.search") {
        const ability =
          typeof commandParams.ability === "object" && commandParams.ability !== null
            ? (commandParams.ability as Record<string, unknown>)
            : {};
        const options =
          typeof commandParams.options === "object" && commandParams.options !== null
            ? (commandParams.options as Record<string, unknown>)
            : {};
        const approvalRecord = resolveApprovalRecord(options);
        const decisionId = resolveGateDecisionId({
          runId,
          requestId: request.id,
          commandRequestId: commandParams.request_id
        });
        const approvalId = resolveLoopbackApprovalId(approvalRecord, decisionId);
        const gate = buildLoopbackGate(
          buildLoopbackGateSeedOptions({
            options,
            decisionId,
            approvalId,
            approvalRecord
          }),
          asString(ability.action),
          {
            runId,
            decisionId,
            approvalId: approvalId ?? undefined
          }
        );
        const auditRecord = buildLoopbackAuditRecord({
          runId,
          sessionId,
          profile: "loopback_profile",
          gate
        });
        gatePayload = buildLoopbackGatePayload({
          runId,
          sessionId,
          profile: "loopback_profile",
          gate,
          auditRecord
        });
        const consumerGateResult = asRecord(gatePayload.consumer_gate_result);
        if (consumerGateResult?.gate_decision === "blocked") {
          this.hostPort.postMessage({
            kind: "response",
            envelope: {
              id: request.id,
              status: "error",
              summary: {
                relay_path: RELAY_PATH
              },
              payload: {
                details: {
                  ability_id: String(ability.id ?? "xhs.note.search.v1"),
                  stage: "execution",
                  reason: "EXECUTION_MODE_GATE_BLOCKED"
                },
                ...gatePayload
              },
              error: {
                code: "ERR_EXECUTION_FAILED",
                message: `执行模式门禁阻断了当前 ${command} 请求`
              }
            }
          });
          return;
        }
      }

      if (command === "xhs.interact") {
        this.hostPort.postMessage({
          kind: "response",
          envelope: {
            id: request.id,
            status: "error",
            summary: {},
            error: {
              code: "ERR_TRANSPORT_FORWARD_FAILED",
              message: "unsupported command"
            }
          }
        });
        return;
      }

      this.#pendingForward.set(request.id, { request, gatePayload });
      this.contentPort.postMessage({
        kind: "forward",
        id: request.id,
        command,
        commandParams: mergeGateArtifactsIntoCommandParams(commandParams, gatePayload),
        runId,
        sessionId
      });
      return;
    }

    this.hostPort.postMessage({
      kind: "response",
      envelope: {
        id: request.id,
        status: "error",
        summary: {},
        error: {
          code: "ERR_TRANSPORT_FORWARD_FAILED",
          message: `unknown method: ${request.method}`
        }
      }
    });
  }

  private handleContentResult(result: Extract<ContentMessage, { kind: "result" }>): void {
    const pending = this.#pendingForward.get(result.id);
    if (!pending) {
      return;
    }
    this.#pendingForward.delete(result.id);

    const request = pending.request;
    const payload =
      typeof result.payload === "object" && result.payload !== null
        ? { ...(result.payload as Record<string, unknown>) }
        : {};
    const summary =
      typeof payload.summary === "object" && payload.summary !== null
        ? (payload.summary as Record<string, unknown>)
        : null;
    if (pending.gatePayload) {
      for (const [key, value] of Object.entries(pending.gatePayload)) {
        const hasInPayload = Object.prototype.hasOwnProperty.call(payload, key);
        const hasInSummary =
          summary !== null && Object.prototype.hasOwnProperty.call(summary, key);
        if (!hasInPayload && !hasInSummary) {
          if (summary !== null) {
            summary[key] = value;
          } else {
            payload[key] = value;
          }
        }
      }
    }

    if (!result.ok) {
      this.hostPort.postMessage({
        kind: "response",
        envelope: {
          id: request.id,
          status: "error",
          summary: {
            relay_path: RELAY_PATH
          },
          payload,
          error: result.error ?? {
            code: "ERR_TRANSPORT_FORWARD_FAILED",
            message: "content script failed"
          }
        }
      });
      return;
    }

    this.hostPort.postMessage({
      kind: "response",
      envelope: {
        id: request.id,
        status: "success",
        summary: {
          session_id: String(request.params.session_id ?? this.#sessionId),
          run_id: String(request.params.run_id ?? request.id),
          command: String(request.params.command ?? "runtime.ping"),
          relay_path: RELAY_PATH
        },
        payload,
        error: null
      }
    });
  }
}
