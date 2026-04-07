import { BRIDGE_PROTOCOL, ensureBridgeRequestEnvelope } from "./protocol.js";
import { RELAY_PATH, buildLoopbackGate } from "./loopback-gate.js";
import { buildLoopbackAuditRecord } from "./loopback-gate-audit.js";
import { buildLoopbackGatePayload } from "./loopback-gate-payload.js";
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const resolveApprovalRecord = (options) => asRecord(options.approval_record) ?? asRecord(options.approval);
export class InMemoryBackgroundRelay {
    hostPort;
    contentPort;
    #pendingForward = new Map();
    #sessionId = "nm-session-001";
    constructor(hostPort, contentPort) {
        this.hostPort = hostPort;
        this.contentPort = contentPort;
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
    handleHostRequest(request) {
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
            const commandParams = typeof request.params.command_params === "object" && request.params.command_params !== null
                ? request.params.command_params
                : {};
            const runId = String(request.params.run_id ?? request.id);
            const sessionId = String(request.params.session_id ?? this.#sessionId);
            let gatePayload;
            if (command === "xhs.search") {
                const ability = typeof commandParams.ability === "object" && commandParams.ability !== null
                    ? commandParams.ability
                    : {};
                const options = typeof commandParams.options === "object" && commandParams.options !== null
                    ? commandParams.options
                    : {};
                const approvalRecord = resolveApprovalRecord(options);
                const decisionId = `gate_decision_${runId}_${request.id}`;
                const gate = buildLoopbackGate(options, asString(ability.action), {
                    runId,
                    decisionId,
                    approvalId: asString(approvalRecord?.approval_id) ?? undefined
                });
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
                commandParams,
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
    handleContentResult(result) {
        const pending = this.#pendingForward.get(result.id);
        if (!pending) {
            return;
        }
        this.#pendingForward.delete(result.id);
        const request = pending.request;
        const payload = typeof result.payload === "object" && result.payload !== null
            ? { ...result.payload }
            : {};
        const summary = typeof payload.summary === "object" && payload.summary !== null
            ? payload.summary
            : null;
        if (pending.gatePayload) {
            for (const [key, value] of Object.entries(pending.gatePayload)) {
                const hasInPayload = Object.prototype.hasOwnProperty.call(payload, key);
                const hasInSummary = summary !== null && Object.prototype.hasOwnProperty.call(summary, key);
                if (!hasInPayload && !hasInSummary) {
                    if (summary !== null) {
                        summary[key] = value;
                    }
                    else {
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
