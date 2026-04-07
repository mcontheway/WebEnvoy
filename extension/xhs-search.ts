import type { EditorInputValidationResult } from "./xhs-editor-input.js";
import type {
  FetchResult,
  JsonRecord,
  SearchExecutionResult,
  SignatureResult,
  XhsSearchEnvironment,
  XhsSearchExecutionInput,
} from "./xhs-search-contract.js";
import {
  buildEditorInputEvidence,
  createAuditRecord,
  createGateOnlySuccess,
  isIssue208EditorInputValidation,
  isTrustedEditorInputValidation,
  resolveEditorFocusAttestation,
  resolveEditorValidationText,
  resolveGate,
  resolveRiskStateOutput
} from "./xhs-search-gate.js";
import {
  classifyPageKind,
  createDiagnosis,
  createFailure,
  createObservability,
  inferFailure,
  inferRequestException,
  parseCount,
  resolveSimulatedResult
} from "./xhs-search-observability.js";

const SEARCH_ENDPOINT = "/api/sns/web/v1/search/notes";

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const containsCookie = (cookie: string, key: string): boolean =>
  cookie
    .split(";")
    .map((item) => item.trim())
    .some((item) => item.startsWith(`${key}=`));


const resolveXsCommon = (value: unknown): string => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return "{}";
};

export const executeXhsSearch = async (
  input: XhsSearchExecutionInput,
  env: XhsSearchEnvironment
): Promise<SearchExecutionResult> => {
  const gate = resolveGate(input.options);
  const auditRecord = createAuditRecord(input.executionContext, gate, env);
  if (gate.consumer_gate_result.gate_decision === "blocked") {
    return createFailure(
      "ERR_EXECUTION_FAILED",
      "执行模式门禁阻断了当前 xhs.search 请求",
      {
        ability_id: input.abilityId,
        stage: "execution",
        reason: "EXECUTION_MODE_GATE_BLOCKED"
      },
      {
        page_state: {
          page_kind: classifyPageKind(env.getLocationHref()),
          url: env.getLocationHref(),
          title: env.getDocumentTitle(),
          ready_state: env.getReadyState()
        },
        key_requests: [],
        failure_site: {
          stage: "execution",
          component: "gate",
          target: "requested_execution_mode",
          summary: "执行模式门禁阻断"
        }
      },
      {
        category: "request_failed",
        stage: "execution",
        component: "gate",
        failure_site: {
          stage: "execution",
          component: "gate",
          target: "requested_execution_mode",
          summary: "执行模式门禁阻断"
        },
        evidence: gate.consumer_gate_result.gate_reasons
      },
      gate,
      auditRecord
    );
  }

  if (
    gate.consumer_gate_result.effective_execution_mode === "dry_run" ||
    gate.consumer_gate_result.effective_execution_mode === "recon"
  ) {
    return createGateOnlySuccess(input, gate, auditRecord, env);
  }

  if (isIssue208EditorInputValidation(input.options)) {
    const startedAt = env.now();
    const validationText = resolveEditorValidationText(input.options);
    const focusAttestation = resolveEditorFocusAttestation(input.options);
    const validationResult: EditorInputValidationResult = env.performEditorInputValidation
      ? await env.performEditorInputValidation({
          text: validationText,
          focusAttestation
        })
      : {
          ok: false,
          mode: "dom_editor_input_validation" as const,
          attestation: "dom_self_certified" as const,
          editor_locator: null,
          input_text: validationText,
          before_text: "",
          visible_text: "",
          post_blur_text: "",
          focus_confirmed: false,
          focus_attestation_source: focusAttestation?.source ?? null,
          focus_attestation_reason: focusAttestation?.failure_reason ?? null,
          preserved_after_blur: false,
          success_signals: [],
          failure_signals: ["missing_focus_attestation", "dom_variant"],
          minimum_replay: [
            "enter_editable_mode",
            "focus_editor",
            "type_short_text",
            "blur_or_reobserve"
          ]
        };

    if (!isTrustedEditorInputValidation(validationResult)) {
      return createFailure(
        "ERR_EXECUTION_FAILED",
        "editor_input 真实验证失败",
        {
          ability_id: input.abilityId,
          stage: "execution",
          reason: "EDITOR_INPUT_VALIDATION_FAILED",
          ...buildEditorInputEvidence(validationResult)
        },
        {
          page_state: {
            page_kind: classifyPageKind(env.getLocationHref()),
            url: env.getLocationHref(),
            title: env.getDocumentTitle(),
            ready_state: env.getReadyState()
          },
          key_requests: [],
          failure_site: {
            stage: "execution",
            component: "page",
            target: validationResult.editor_locator ?? "editor_input",
            summary:
              validationResult.failure_signals[0] ?? "editor_input validation failed"
          }
        },
        {
          category: "page_changed",
          reason: "EDITOR_INPUT_VALIDATION_FAILED",
          summary: validationResult.failure_signals[0] ?? "editor_input validation failed"
        },
        gate,
        auditRecord
      );
    }

    return {
      ok: true,
      payload: {
        summary: {
          capability_result: {
            ability_id: input.abilityId,
            layer: input.abilityLayer,
            action: gate.consumer_gate_result.action_type ?? input.abilityAction,
            outcome: "success",
            data_ref: {
              validation_action: "editor_input"
            },
            metrics: {
              duration_ms: Math.max(0, env.now() - startedAt)
            }
          },
          scope_context: gate.scope_context,
          gate_input: {
            run_id: auditRecord.run_id,
            session_id: auditRecord.session_id,
            profile: auditRecord.profile,
            ...gate.gate_input
          },
          gate_outcome: gate.gate_outcome,
          read_execution_policy: gate.read_execution_policy,
          issue_action_matrix: gate.issue_action_matrix,
          write_interaction_tier: gate.write_interaction_tier,
          write_action_matrix_decisions: gate.write_action_matrix_decisions,
          consumer_gate_result: gate.consumer_gate_result,
          approval_record: gate.approval_record,
          risk_state_output: resolveRiskStateOutput(gate, auditRecord),
          audit_record: auditRecord,
          interaction_result: buildEditorInputEvidence(validationResult)
        },
        observability: {
          page_state: {
            page_kind: classifyPageKind(env.getLocationHref()),
            url: env.getLocationHref(),
            title: env.getDocumentTitle(),
            ready_state: env.getReadyState()
          },
          key_requests: [],
          failure_site: null
        }
      }
    };
  }

  const simulated = resolveSimulatedResult(input.options.simulate_result, input.params, input.options, env);
  if (simulated) {
    if (simulated.ok) {
      const summary = asRecord(simulated.payload.summary) ?? {};
      const capability = asRecord(summary.capability_result) ?? {};
      capability.ability_id = input.abilityId;
      capability.layer = input.abilityLayer;
      capability.action = gate.consumer_gate_result.action_type ?? input.abilityAction;
      return {
        ok: true,
        payload: {
          ...simulated.payload,
          summary: {
            capability_result: capability,
            scope_context: gate.scope_context,
            gate_input: {
              run_id: auditRecord.run_id,
              session_id: auditRecord.session_id,
              profile: auditRecord.profile,
              ...gate.gate_input
            },
            gate_outcome: gate.gate_outcome,
            read_execution_policy: gate.read_execution_policy,
            issue_action_matrix: gate.issue_action_matrix,
            consumer_gate_result: gate.consumer_gate_result,
            approval_record: gate.approval_record,
            risk_state_output: resolveRiskStateOutput(gate, auditRecord),
            audit_record: auditRecord
          }
        }
      };
    }

    return {
      ...simulated,
      payload: {
        ...simulated.payload,
        details: {
          ability_id: input.abilityId,
          ...(asRecord(simulated.payload.details) ?? {})
        },
        read_execution_policy: gate.read_execution_policy,
        issue_action_matrix: gate.issue_action_matrix,
        consumer_gate_result: gate.consumer_gate_result,
        approval_record: gate.approval_record,
        risk_state_output: resolveRiskStateOutput(gate, auditRecord),
        audit_record: auditRecord
      }
    };
  }

  const startedAt = env.now();
  const href = env.getLocationHref();
  const title = env.getDocumentTitle();
  const readyState = env.getReadyState();
  const requestId = `req-${env.randomId()}`;
  const timeoutMs =
    typeof input.options.timeout_ms === "number" && Number.isFinite(input.options.timeout_ms)
      ? Math.max(1, Math.floor(input.options.timeout_ms))
      : 30_000;

  if (!containsCookie(env.getCookie(), "a1")) {
    return createFailure(
      "ERR_EXECUTION_FAILED",
      "登录态缺失，无法执行 xhs.search",
      {
        ability_id: input.abilityId,
        stage: "execution",
        reason: "SESSION_EXPIRED"
      },
      createObservability({
        href,
        title,
        readyState,
        requestId,
        outcome: "failed",
        failureReason: "SESSION_EXPIRED"
      }),
      createDiagnosis({
        reason: "SESSION_EXPIRED",
        summary: "登录态缺失，无法执行 xhs.search"
      }),
      gate,
      auditRecord
    );
  }

  const payload: JsonRecord = {
    keyword: input.params.query,
    page: input.params.page ?? 1,
    page_size: input.params.limit ?? 20,
    search_id: input.params.search_id ?? env.randomId(),
    sort: input.params.sort ?? "general",
    note_type: input.params.note_type ?? 0
  };

  let signature: SignatureResult;
  try {
    signature = await env.callSignature(SEARCH_ENDPOINT, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createFailure(
      "ERR_EXECUTION_FAILED",
      "页面签名入口不可用",
      {
        ability_id: input.abilityId,
        stage: "execution",
        reason: "SIGNATURE_ENTRY_MISSING"
      },
      createObservability({
        href,
        title,
        readyState,
        requestId,
        outcome: "failed",
        failureReason: message,
        includeKeyRequest: false,
        failureSite: {
          stage: "action",
          component: "page",
          target: "window._webmsxyw",
          summary: "页面签名入口不可用"
        }
      }),
      createDiagnosis({
        reason: "SIGNATURE_ENTRY_MISSING",
        summary: "页面签名入口不可用"
      }),
      gate,
      auditRecord
    );
  }

  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json;charset=utf-8",
    "X-s": String(signature["X-s"]),
    "X-t": String(signature["X-t"]),
    "X-S-Common": resolveXsCommon(input.options.x_s_common),
    "x-b3-traceid": env.randomId().replace(/-/g, ""),
    "x-xray-traceid": env.randomId().replace(/-/g, "")
  };

  let response: FetchResult;
  try {
    response = await env.fetchJson({
      url: SEARCH_ENDPOINT,
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      timeoutMs
    });
  } catch (error) {
    const failure = inferRequestException(error);
    return createFailure(
      "ERR_EXECUTION_FAILED",
      failure.message,
      {
        ability_id: input.abilityId,
        stage: "execution",
        reason: failure.reason
      },
      createObservability({
        href,
        title,
        readyState,
        requestId,
        outcome: "failed",
        failureReason: failure.detail
      }),
      createDiagnosis({
        reason: failure.reason,
        summary: failure.message
      }),
      gate,
      auditRecord
    );
  }

  const responseRecord = asRecord(response.body);
  const businessCode = responseRecord?.code;
  if (response.status >= 400 || (typeof businessCode === "number" && businessCode !== 0)) {
    const failure = inferFailure(response.status, response.body);
    return createFailure(
      "ERR_EXECUTION_FAILED",
      failure.message,
      {
        ability_id: input.abilityId,
        stage: "execution",
        reason: failure.reason
      },
      createObservability({
        href,
        title,
        readyState,
        requestId,
        outcome: "failed",
        statusCode: response.status,
        failureReason: failure.reason
      }),
      createDiagnosis({
        reason: failure.reason,
        summary: failure.message
      }),
      gate,
      auditRecord
    );
  }

  const count = parseCount(response.body);
  return {
    ok: true,
    payload: {
      summary: {
        capability_result: {
          ability_id: input.abilityId,
          layer: input.abilityLayer,
          action: gate.consumer_gate_result.action_type ?? input.abilityAction,
          outcome: "success",
          data_ref: {
            query: input.params.query,
            search_id: payload.search_id
          },
          metrics: {
            count,
            duration_ms: Math.max(0, env.now() - startedAt)
          }
        },
        scope_context: gate.scope_context,
        gate_input: {
          run_id: auditRecord.run_id,
          session_id: auditRecord.session_id,
          profile: auditRecord.profile,
          ...gate.gate_input
        },
        gate_outcome: gate.gate_outcome,
        read_execution_policy: gate.read_execution_policy,
        issue_action_matrix: gate.issue_action_matrix,
        consumer_gate_result: gate.consumer_gate_result,
        approval_record: gate.approval_record,
        risk_state_output: resolveRiskStateOutput(gate, auditRecord),
        audit_record: auditRecord
      },
      observability: createObservability({
        href,
        title,
        readyState,
        requestId,
        outcome: "completed",
        statusCode: response.status
      })
    }
  };
};

export type {
  SearchExecutionResult,
  XhsSearchEnvironment
} from "./xhs-search-contract.js";
