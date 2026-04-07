import type { ContentMessage } from "./loopback-messages.js";
import { buildLoopbackGate } from "./loopback-gate.js";
import { buildLoopbackAuditRecord } from "./loopback-gate-audit.js";
import { buildLoopbackGatePayload } from "./loopback-gate-payload.js";
import { InMemoryPort } from "./loopback-port.js";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const resolveApprovalRecord = (options: Record<string, unknown>): Record<string, unknown> | null =>
  asRecord(options.approval_record) ?? asRecord(options.approval);

export class InMemoryContentScriptRuntime {
  static readonly BOOTSTRAP_ATTEST_DELAY_MS = 10;

  #bootstrapContext: {
    runId: string;
    runtimeContextId: string;
    profile: string;
    version: string;
    attested: boolean;
  } | null = null;

  constructor(private readonly port: InMemoryPort<ContentMessage>) {
    this.port.onMessage((message) => {
      if (message.kind !== "forward") {
        return;
      }

      this.port.postMessage(this.handleForward(message));
    });
  }

  private handleForward(message: Extract<ContentMessage, { kind: "forward" }>): ContentMessage {
    if (message.command === "runtime.ping") {
      return {
        kind: "result",
        id: message.id,
        ok: true,
        payload: {
          message: "pong",
          runtime_bootstrap_attested: this.#bootstrapContext?.attested === true
        }
      };
    }

    if (message.command === "runtime.bootstrap") {
      const commandParams = asRecord(message.commandParams) ?? {};
      const version = asString(commandParams.version);
      const runId = asString(commandParams.run_id);
      const runtimeContextId = asString(commandParams.runtime_context_id);
      const profile = asString(commandParams.profile);
      const fingerprintRuntime = asRecord(commandParams.fingerprint_runtime);
      const fingerprintPatchManifest = asRecord(commandParams.fingerprint_patch_manifest);
      const mainWorldSecret = asString(commandParams.main_world_secret);

      if (
        !version ||
        !runId ||
        !runtimeContextId ||
        !profile ||
        !fingerprintRuntime ||
        !fingerprintPatchManifest ||
        !mainWorldSecret
      ) {
        return {
          kind: "result",
          id: message.id,
          ok: false,
          error: {
            code: "ERR_RUNTIME_READY_SIGNAL_CONFLICT",
            message: "invalid runtime bootstrap envelope"
          }
        };
      }

      const currentBootstrapContext = this.#bootstrapContext;
      if (
        currentBootstrapContext &&
        currentBootstrapContext.attested &&
        currentBootstrapContext.version === version &&
        currentBootstrapContext.runId === runId &&
        currentBootstrapContext.runtimeContextId === runtimeContextId &&
        currentBootstrapContext.profile === profile
      ) {
        return {
          kind: "result",
          id: message.id,
          ok: true,
          payload: {
            method: "runtime.bootstrap.ack",
            result: {
              version,
              run_id: runId,
              runtime_context_id: runtimeContextId,
              profile,
              status: "ready"
            },
            runtime_bootstrap_attested: true
          }
        };
      }

      this.#bootstrapContext = {
        version,
        runId,
        runtimeContextId,
        profile,
        attested: false
      };
      setTimeout(() => {
        const bootstrapContext = this.#bootstrapContext;
        if (
          bootstrapContext &&
          bootstrapContext.runId === runId &&
          bootstrapContext.runtimeContextId === runtimeContextId &&
          bootstrapContext.profile === profile
        ) {
          this.#bootstrapContext = {
            ...bootstrapContext,
            attested: true
          };
        }
      }, InMemoryContentScriptRuntime.BOOTSTRAP_ATTEST_DELAY_MS);

      return {
        kind: "result",
        id: message.id,
        ok: false,
        error: {
          code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED",
          message: "runtime bootstrap 尚未获得执行面确认"
        }
      };
    }

    if (message.command === "runtime.readiness") {
      const commandParams = asRecord(message.commandParams) ?? {};
      const runId = asString(commandParams.run_id);
      const runtimeContextId = asString(commandParams.runtime_context_id);

      let bootstrapState: "not_started" | "pending" | "ready" | "stale" = "not_started";
      if (this.#bootstrapContext) {
        bootstrapState =
          runId === this.#bootstrapContext.runId &&
          runtimeContextId === this.#bootstrapContext.runtimeContextId
            ? (this.#bootstrapContext.attested ? "ready" : "pending")
            : "stale";
      }

      return {
        kind: "result",
        id: message.id,
        ok: true,
        payload: {
          transport_state: "ready",
          bootstrap_state: bootstrapState
        }
      };
    }

    if (message.command === "xhs.search") {
      const simulated =
        typeof message.commandParams.options === "object" &&
        message.commandParams.options !== null &&
        typeof (message.commandParams.options as Record<string, unknown>).simulate_result === "string"
          ? String((message.commandParams.options as Record<string, unknown>).simulate_result)
          : "success";
      const ability =
        typeof message.commandParams.ability === "object" && message.commandParams.ability !== null
          ? (message.commandParams.ability as Record<string, unknown>)
          : {};
      const input =
        typeof message.commandParams.input === "object" && message.commandParams.input !== null
          ? (message.commandParams.input as Record<string, unknown>)
          : {};
      const options =
        typeof message.commandParams.options === "object" && message.commandParams.options !== null
          ? (message.commandParams.options as Record<string, unknown>)
          : {};
      const approvalRecord = resolveApprovalRecord(options);
      const decisionId = `gate_decision_${message.runId}_${message.id}`;
      const gate = buildLoopbackGate(options, asString(ability.action), {
        runId: message.runId,
        decisionId,
        approvalId: asString(approvalRecord?.approval_id) ?? undefined
      });
      const consumerGateResult = gate.consumerGateResult;
      const auditRecord = buildLoopbackAuditRecord({
        runId: message.runId,
        sessionId: message.sessionId,
        profile: "loopback_profile",
        gate
      });
      const gateBundle = buildLoopbackGatePayload({
        runId: message.runId,
        sessionId: message.sessionId,
        profile: "loopback_profile",
        gate,
        auditRecord
      });
      if (consumerGateResult.gate_decision === "blocked") {
        return {
          kind: "result",
          id: message.id,
          ok: false,
          error: {
            code: "ERR_EXECUTION_FAILED",
            message: "执行模式门禁阻断了当前 xhs.search 请求"
          },
          payload: {
            details: {
              ability_id: String(ability.id ?? "xhs.note.search.v1"),
              stage: "execution",
              reason: "EXECUTION_MODE_GATE_BLOCKED"
            },
            ...gateBundle
          }
        };
      }
      if (
        consumerGateResult.effective_execution_mode === "dry_run" ||
        consumerGateResult.effective_execution_mode === "recon"
      ) {
        return {
          kind: "result",
          id: message.id,
          ok: true,
          payload: {
            summary: {
              capability_result: {
                ability_id: String(ability.id ?? "xhs.note.search.v1"),
                layer: String(ability.layer ?? "L3"),
                action: String(consumerGateResult.action_type ?? ability.action ?? "read"),
                outcome: "partial",
                data_ref: {
                  query: String(input.query ?? "")
                },
                metrics: {
                  count: 0
                }
              },
              ...gateBundle
            },
            observability: {
              page_state: {
                page_kind: "search",
                url: "https://www.xiaohongshu.com/search_result",
                title: "Search Result",
                ready_state: "complete",
                observation_status: "complete"
              },
              key_requests: [],
              failure_site: null
            }
          }
        };
      }

      if (
        consumerGateResult.effective_execution_mode === "live_write" &&
        options.validation_action === "editor_input"
      ) {
        const validationText =
          typeof options.validation_text === "string" && options.validation_text.trim().length > 0
            ? options.validation_text.trim()
            : "WebEnvoy editor_input validation";
        return {
          kind: "result",
          id: message.id,
          ok: false,
          payload: {
            summary: {
              capability_result: {
                ability_id: String(ability.id ?? "xhs.issue208.editor_input"),
                layer: String(ability.layer ?? "L3"),
                action: String(consumerGateResult.action_type ?? ability.action ?? "write"),
                outcome: "blocked",
                data_ref: {
                  validation_action: "editor_input"
                },
                metrics: {
                  duration_ms: 12
                }
              },
              ...gateBundle,
              interaction_result: {
                validation_action: "editor_input",
                target_page: "creator.xiaohongshu.com/publish",
                success_signals: [],
                failure_signals: ["EDITOR_INPUT_VALIDATION_REQUIRED"],
                minimum_replay: ["focus_editor", "type_short_text", "blur_or_reobserve"],
                out_of_scope_actions: ["image_upload", "submit", "publish_confirm"]
              }
            },
            observability: {
              page_state: {
                page_kind: "compose",
                url: "https://creator.xiaohongshu.com/publish/publish",
                title: "Creator Publish",
                ready_state: "complete",
                observation_status: "complete"
              },
              key_requests: [],
              failure_site: {
                stage: "execution",
                component: "page",
                target: "editor_input",
                summary: "loopback transport cannot attest controlled editor_input validation"
              }
            }
          },
          error: {
            code: "ERR_EXECUTION_FAILED",
            message: `editor_input validation requires a controlled execution surface: ${validationText}`
          }
        };
      }

      if (simulated === "success") {
        return {
          kind: "result",
          id: message.id,
          ok: true,
          payload: {
            summary: {
              capability_result: {
                ability_id: String(ability.id ?? "xhs.note.search.v1"),
                layer: String(ability.layer ?? "L3"),
                action: String(consumerGateResult.action_type ?? ability.action ?? "read"),
                outcome: "success",
                data_ref: {
                  query: String(input.query ?? ""),
                  search_id: "loopback-search-id"
                },
                metrics: {
                  count: 2,
                  duration_ms: 12
                }
              },
              ...gateBundle
            },
            observability: {
              page_state: {
                page_kind: "search",
                url: "https://www.xiaohongshu.com/search_result",
                title: "Search Result",
                ready_state: "complete",
                observation_status: "complete"
              },
              key_requests: [
                {
                  request_id: "req-loopback-001",
                  stage: "request",
                  method: "POST",
                  url: "/api/sns/web/v1/search/notes",
                  outcome: "completed",
                  status_code: 200
                }
              ],
              failure_site: null
            }
          }
        };
      }

      return {
        kind: "result",
        id: message.id,
        ok: false,
        error: {
          code: "ERR_EXECUTION_FAILED",
          message:
            simulated === "login_required"
              ? "登录态缺失，无法执行 xhs.search"
              : simulated === "account_abnormal"
                ? "账号异常，平台拒绝当前请求"
                : simulated === "browser_env_abnormal"
                  ? "浏览器环境异常，平台拒绝当前请求"
                  : simulated === "captcha_required"
                    ? "平台要求额外人机验证，无法继续执行"
                    : simulated === "signature_entry_missing"
                      ? "页面签名入口不可用"
                      : "网关调用失败，当前上下文不足以完成搜索请求"
        },
        payload: {
          details: {
            ability_id: String(ability.id ?? "xhs.note.search.v1"),
            stage: "execution",
            reason:
              simulated === "login_required"
                ? "SESSION_EXPIRED"
                : simulated === "account_abnormal"
                  ? "ACCOUNT_ABNORMAL"
                  : simulated === "browser_env_abnormal"
                    ? "BROWSER_ENV_ABNORMAL"
                    : simulated === "captcha_required"
                      ? "CAPTCHA_REQUIRED"
                      : simulated === "signature_entry_missing"
                        ? "SIGNATURE_ENTRY_MISSING"
                        : "GATEWAY_INVOKER_FAILED"
          },
          ...gateBundle,
            observability: {
              page_state: {
                page_kind: simulated === "login_required" ? "login" : "search",
                url:
                  simulated === "login_required"
                    ? "https://www.xiaohongshu.com/login"
                    : "https://www.xiaohongshu.com/search_result",
                title: "Search Result",
                ready_state: "complete",
                observation_status: "complete"
              },
            key_requests:
              simulated === "signature_entry_missing"
                ? []
                : [
                    {
                      request_id: "req-loopback-001",
                      stage: "request",
                      method: "POST",
                      url: "/api/sns/web/v1/search/notes",
                      outcome: "failed",
                      status_code:
                        simulated === "account_abnormal"
                          ? 461
                          : simulated === "browser_env_abnormal"
                            ? 200
                            : simulated === "captcha_required"
                              ? 429
                              : simulated === "gateway_invoker_failed"
                                ? 500
                                : undefined,
                      failure_reason: simulated
                    }
                  ],
            failure_site: {
              stage: simulated === "signature_entry_missing" ? "action" : "request",
              component: simulated === "signature_entry_missing" ? "page" : "network",
              target:
                simulated === "signature_entry_missing"
                  ? "window._webmsxyw"
                  : "/api/sns/web/v1/search/notes",
              summary: simulated
            }
          },
          diagnosis: {
            category: simulated === "signature_entry_missing" ? "page_changed" : "request_failed",
            stage: simulated === "signature_entry_missing" ? "action" : "request",
            component: simulated === "signature_entry_missing" ? "page" : "network",
            failure_site: {
              stage: simulated === "signature_entry_missing" ? "action" : "request",
              component: simulated === "signature_entry_missing" ? "page" : "network",
              target:
                simulated === "signature_entry_missing"
                  ? "window._webmsxyw"
                  : "/api/sns/web/v1/search/notes",
              summary: simulated
            },
            evidence: [simulated]
          }
        }
      };
    }

    return {
      kind: "result",
      id: message.id,
      ok: true,
      payload: {
        message: "pong"
      }
    };
  }
}
