import { describe, expect, it, vi } from "vitest";

import { startChromeBackgroundBridge } from "../extension/background.js";

const createMockPort = () => {
  const onMessageListeners: Array<(message: Record<string, unknown>) => void> = [];
  const onDisconnectListeners: Array<() => void> = [];
  const postMessage = vi.fn();

  return {
    postMessage,
    onMessageListeners,
    onDisconnectListeners,
    port: {
      postMessage,
      onMessage: {
        addListener: (listener: (message: Record<string, unknown>) => void) => {
          onMessageListeners.push(listener);
        }
      },
      onDisconnect: {
        addListener: (listener: () => void) => {
          onDisconnectListeners.push(listener);
        }
      },
      disconnect: vi.fn()
    }
  };
};

const createEditorInputProbeResult = (overrides?: {
  entryButton?: Record<string, unknown> | null;
  editor?: Record<string, unknown> | null;
  editorFocused?: boolean;
}) => ({
  entryButton: overrides?.entryButton ?? null,
  editor:
    overrides?.editor ?? {
      locator: "div.tiptap.ProseMirror",
      targetKey: "body > div:nth-of-type(1)",
      centerX: 120,
      centerY: 48
    },
  editorFocused: overrides?.editorFocused ?? true
});

const createChromeApi = (ports: ReturnType<typeof createMockPort>[]) => {
  let connectIndex = 0;
  const runtimeMessageListeners: Array<
    (
      message: unknown,
      sender: { tab?: { id?: number; url?: string }; url?: string },
      sendResponse?: (response: unknown) => void
    ) => boolean | void
  > = [];
  const executeScript = vi.fn(async (input: Record<string, unknown>) => {
    const args = Array.isArray(input.args) ? input.args : [];
    if (Array.isArray(args[0]) && Array.isArray(args[1])) {
      return [{ result: createEditorInputProbeResult() }];
    }
    return [{ result: { "X-s": "signed", "X-t": "1700000000" } }];
  });
  const debuggerAttach = vi.fn(async () => {});
  const debuggerSendCommand = vi.fn(async () => ({}));
  const debuggerDetach = vi.fn(async () => {});
  const chromeApi = {
    runtime: {
      connectNative: vi.fn(() => {
        const current = ports[Math.min(connectIndex, ports.length - 1)];
        connectIndex += 1;
        return current.port;
      }),
      getURL: vi.fn((path: string) => `chrome-extension://test-extension/${path}`),
      onMessage: {
        addListener: (
          listener: (
            message: unknown,
            sender: { tab?: { id?: number; url?: string }; url?: string },
            sendResponse: (response: unknown) => void
          ) => boolean | void
        ) => {
          runtimeMessageListeners.push(listener);
        }
      },
      onInstalled: {
        addListener: vi.fn()
      },
      onStartup: {
        addListener: vi.fn()
      }
    },
    tabs: {
      query: vi.fn(async () => [{ id: 11 }]),
      sendMessage: vi.fn(async () => {})
    },
    scripting: {
      executeScript
    },
    debugger: {
      attach: debuggerAttach,
      sendCommand: debuggerSendCommand,
      detach: debuggerDetach
    }
  };

  return {
    chromeApi,
    runtimeMessageListeners,
    executeScript,
    debuggerAttach,
    debuggerSendCommand,
    debuggerDetach
  };
};

const respondHandshake = (
  mockPort: ReturnType<typeof createMockPort>,
  options?: { protocol?: string; sessionId?: string }
) => {
  const protocol = options?.protocol ?? "webenvoy.native-bridge.v1";
  const sessionId = options?.sessionId ?? "nm-session-001";
  const handshakeCall = mockPort.postMessage.mock.calls.find(
    (call) => (call[0] as { method?: string }).method === "bridge.open"
  );
  expect(handshakeCall).toBeDefined();
  const handshakeId = String((handshakeCall?.[0] as { id: string }).id);
  mockPort.onMessageListeners[0]?.({
    id: handshakeId,
    status: "success",
    summary: {
      protocol,
      session_id: sessionId,
      state: "ready"
    },
    error: null
  });
};

const waitForBridgeTurn = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const waitForPostedMessage = async (
  spy: ReturnType<typeof vi.fn>,
  expected: Record<string, unknown>
): Promise<void> => {
  await vi.waitFor(() => {
    expect(spy).toHaveBeenCalledWith(expect.objectContaining(expected));
  });
};

const primeTrustedFingerprintContext = async (input: {
  runtimeMessageListeners: Array<
    (
      message: unknown,
      sender: { tab?: { id?: number; url?: string }; url?: string },
      sendResponse?: (response: unknown) => void
    ) => boolean | void
  >;
  runId: string;
  profile: string;
  fingerprintContext: Record<string, unknown>;
  runtimeContextId?: string;
  sessionId?: string;
  tabId?: number;
  tabUrl?: string;
}) => {
  const fingerprintContext =
    asRecord(input.fingerprintContext.injection) !== null
      ? input.fingerprintContext
      : {
          ...input.fingerprintContext,
          injection: {
            installed: true,
            required_patches:
              ((asRecord(input.fingerprintContext.fingerprint_patch_manifest)?.required_patches ??
                []) as string[]) ?? [],
            missing_required_patches: [],
            source: "main_world"
          }
        };
  input.runtimeMessageListeners[0]?.(
    {
      kind: "result",
      id: `startup-fingerprint-trust:${input.runId}`,
      ok: true,
      payload: {
        startup_fingerprint_trust: {
          run_id: input.runId,
          runtime_context_id: input.runtimeContextId,
          profile: input.profile,
          session_id: input.sessionId ?? "nm-session-001",
          fingerprint_runtime: fingerprintContext,
          trust_source: "extension_bootstrap_context",
          bootstrap_attested: true,
          main_world_result_used_for_trust: false
        }
      }
    },
    {
      tab: {
        id: input.tabId ?? 32,
        url: input.tabUrl ?? "https://www.xiaohongshu.com/search_result?keyword=露营"
      }
    }
  );
  await Promise.resolve();
  await Promise.resolve();
};

const promoteBootstrapReadinessThroughPing = async (input: {
  runtimeMessageListeners: Array<
    (
      message: unknown,
      sender: { tab?: { id?: number; url?: string }; url?: string },
      sendResponse?: (response: unknown) => void
    ) => boolean | void
  >;
  pingId: string;
  fingerprintContext: Record<string, unknown>;
  tabId?: number;
  tabUrl?: string;
}) => {
  const requiredPatches =
    ((asRecord(input.fingerprintContext.fingerprint_patch_manifest)?.required_patches ?? []) as string[]) ??
    [];
  input.runtimeMessageListeners[0]?.(
    {
      kind: "result",
      id: input.pingId,
      ok: true,
      payload: {
        fingerprint_runtime: {
          ...input.fingerprintContext,
          injection: {
            installed: true,
            required_patches: requiredPatches,
            missing_required_patches: [],
            source: "main_world"
          }
        },
        target_tab_id: input.tabId ?? 77,
        summary: {
          capability_result: {
            outcome: "success"
          }
        }
      }
    },
    {
      tab: {
        id: input.tabId ?? 77,
        url: input.tabUrl
      }
    }
  );
  await Promise.resolve();
  await Promise.resolve();
};

const createXhsCommandParams = (overrides?: Record<string, unknown>) => {
  const requestRunId =
    typeof overrides?.run_id === "string" && overrides.run_id.length > 0 ? overrides.run_id : "run-sw-001";
  const requestSessionId =
    typeof overrides?.session_id === "string" && overrides.session_id.length > 0
      ? overrides.session_id
      : "nm-session-001";
  const merged = {
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: 32,
    target_page: "search_result_tab",
    action_type: "read",
    risk_state: "paused",
    requested_execution_mode: "dry_run",
    limited_read_rollout_ready_true: true,
    audit_record: createApprovedReadAuditRecord(),
    ...overrides
  };
  const issue209LiveReadRequested =
    merged.issue_scope === "issue_209" &&
    (merged.requested_execution_mode === "live_read_limited" ||
      merged.requested_execution_mode === "live_read_high_risk");
  if (
    issue209LiveReadRequested &&
    !(typeof merged.gate_invocation_id === "string" && merged.gate_invocation_id.length > 0)
  ) {
    issue209GateInvocationCounter += 1;
    merged.gate_invocation_id = `issue209-gate-${requestRunId}-sw-${issue209GateInvocationCounter}`;
  }

  if (merged.admission_context === undefined) {
    merged.admission_context = createApprovedReadAdmissionContext({
      run_id: requestRunId,
      ...(typeof merged.request_id === "string" ? { request_id: merged.request_id } : {}),
      session_id: requestSessionId,
      target_tab_id: typeof merged.target_tab_id === "number" ? merged.target_tab_id : undefined,
      target_page: typeof merged.target_page === "string" ? merged.target_page : undefined,
      requested_execution_mode:
        merged.requested_execution_mode === "live_read_high_risk"
          ? "live_read_high_risk"
          : "live_read_limited",
      risk_state:
        merged.risk_state === "allowed" || merged.risk_state === "limited"
          ? merged.risk_state
          : "paused"
    });
  }

  return merged;
};

let issue209GateInvocationCounter = 0;

const createRequestBoundXhsCommandParams = (
  input: {
    runId: string;
    sessionId?: string;
    requestId?: string;
  } & Record<string, unknown>
) => {
  const { runId, sessionId, requestId, ...overrides } = input;
  return createXhsCommandParams({
    ...overrides,
    run_id: runId,
    ...(requestId ? { request_id: requestId } : {}),
    session_id: sessionId ?? "nm-session-001"
  });
};

const createXhsEditorInputCommandParams = (overrides?: Record<string, unknown>) => ({
  issue_scope: "issue_208",
  target_domain: "creator.xiaohongshu.com",
  target_tab_id: 32,
  target_page: "creator_publish_tab",
  action_type: "write",
  requested_execution_mode: "live_write",
  risk_state: "allowed",
  approval_record: createApprovedReadApprovalRecord(),
  validation_action: "editor_input",
  validation_text: "测试发布文案",
  ability: {
    id: "xhs.note.search.v1",
    layer: "L3",
    action: "write"
  },
  input: {
    query: "测试发布文案"
  },
  ...overrides
});

const createApprovedReadApprovalRecord = () => ({
  approved: true,
  approver: "qa-reviewer",
  approved_at: "2026-03-23T10:00:00Z",
  checks: {
    target_domain_confirmed: true,
    target_tab_confirmed: true,
    target_page_confirmed: true,
    risk_state_checked: true,
    action_type_confirmed: true
  }
});

const createApprovedReadAuditRecord = (overrides?: Record<string, unknown>) => ({
  event_id: "gate_evt_issue209_read_001",
  issue_scope: "issue_209",
  target_domain: "www.xiaohongshu.com",
  target_tab_id: 32,
  target_page: "search_result_tab",
  action_type: "read",
  requested_execution_mode: "live_read_limited",
  gate_decision: "allowed",
  recorded_at: "2026-03-23T10:05:00Z",
  ...overrides
});

function createApprovedReadAdmissionContext(overrides?: {
  run_id?: string;
  request_id?: string;
  session_id?: string;
  decision_id?: string;
  approval_id?: string;
  target_tab_id?: number;
  target_page?: string;
  requested_execution_mode?: "live_read_limited" | "live_read_high_risk";
  risk_state?: "limited" | "allowed" | "paused";
}) {
  const runId = overrides?.run_id ?? "run-sw-001";
  const requestId = overrides?.request_id;
  const decisionId = overrides?.decision_id;
  const approvalId = overrides?.approval_id;
  const refSuffix = requestId ? `${runId}_${requestId}` : runId;
  return {
  approval_admission_evidence: {
    approval_admission_ref: `approval_admission_${refSuffix}`,
    ...(decisionId ? { decision_id: decisionId } : {}),
    ...(approvalId ? { approval_id: approvalId } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    run_id: runId,
    session_id: overrides?.session_id ?? "nm-session-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: overrides?.target_tab_id ?? 32,
    target_page: overrides?.target_page ?? "search_result_tab",
    action_type: "read",
    requested_execution_mode: overrides?.requested_execution_mode ?? "live_read_limited",
    approved: true,
    approver: "qa-reviewer",
    approved_at: "2026-03-23T10:00:00Z",
    checks: {
      target_domain_confirmed: true,
      target_tab_confirmed: true,
      target_page_confirmed: true,
      risk_state_checked: true,
      action_type_confirmed: true
    },
    recorded_at: "2026-03-23T10:00:00Z"
  },
  audit_admission_evidence: {
    audit_admission_ref: `audit_admission_${refSuffix}`,
    ...(decisionId ? { decision_id: decisionId } : {}),
    ...(approvalId ? { approval_id: approvalId } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    run_id: runId,
    session_id: overrides?.session_id ?? "nm-session-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: overrides?.target_tab_id ?? 32,
    target_page: overrides?.target_page ?? "search_result_tab",
    action_type: "read",
    requested_execution_mode: overrides?.requested_execution_mode ?? "live_read_limited",
    risk_state: overrides?.risk_state ?? "paused",
    audited_checks: {
      target_domain_confirmed: true,
      target_tab_confirmed: true,
      target_page_confirmed: true,
      risk_state_checked: true,
      action_type_confirmed: true
    },
    recorded_at: "2026-03-23T10:05:00Z"
  }
  };
}

const createApprovedReadAuditRecordForRequest = (input: {
  runId: string;
  requestId?: string;
  overrides?: Record<string, unknown>;
}) => {
  const decisionId = input.requestId
    ? `gate_decision_${input.runId}_${input.requestId}`
    : `gate_decision_${input.runId}`;
  return createApprovedReadAuditRecord({
    event_id: `gate_evt_${decisionId}`,
    decision_id: decisionId,
    approval_id: `gate_appr_${decisionId}`,
    ...(input.overrides ?? {})
  });
};

const createFingerprintRuntimeContext = (executionOverrides?: Record<string, unknown>) => ({
  profile: "profile-a",
  source: "profile_meta",
  fingerprint_profile_bundle: {
    ua: "Mozilla/5.0",
    hardwareConcurrency: 8,
    deviceMemory: 8,
    screen: {
      width: 1440,
      height: 900,
      colorDepth: 24,
      pixelDepth: 24
    },
    battery: {
      level: 0.73,
      charging: false
    },
    timezone: "Asia/Shanghai",
    audioNoiseSeed: 0.000047231,
    canvasNoiseSeed: 0.000083154,
    environment: {
      os_family: "macos",
      os_version: "14.6",
      arch: "arm64"
    }
  },
  fingerprint_patch_manifest: {
    profile: "profile-a",
    manifest_version: "1",
    required_patches: ["audio_context", "battery", "navigator_plugins", "navigator_mime_types"],
    optional_patches: [],
    field_dependencies: {
      audio_context: ["audioNoiseSeed"],
      battery: ["battery.level", "battery.charging"]
    },
    unsupported_reason_codes: []
  },
  fingerprint_consistency_check: {
    profile: "profile-a",
    expected_environment: {
      os_family: "macos",
      os_version: "14.6",
      arch: "arm64"
    },
    actual_environment: {
      os_family: "macos",
      os_version: "14.6",
      arch: "arm64"
    },
    decision: "match",
    reason_codes: []
  },
  execution: {
    live_allowed: true,
    live_decision: "allowed",
    allowed_execution_modes: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
    reason_codes: [],
    ...(executionOverrides ?? {})
  }
});

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const resolveWriteInteractionTier = (payload: Record<string, unknown>): string | null => {
  const direct = payload.write_interaction_tier;
  if (typeof direct === "string") {
    return direct;
  }
  const consumerGateResult = asRecord(payload.consumer_gate_result);
  if (typeof consumerGateResult?.write_interaction_tier === "string") {
    return consumerGateResult.write_interaction_tier;
  }
  const writeActionMatrix = asRecord(payload.write_action_matrix);
  if (typeof writeActionMatrix?.write_interaction_tier === "string") {
    return writeActionMatrix.write_interaction_tier;
  }
  const writeActionMatrixDecisions = asRecord(payload.write_action_matrix_decisions);
  if (typeof writeActionMatrixDecisions?.write_interaction_tier === "string") {
    return writeActionMatrixDecisions.write_interaction_tier;
  }
  return null;
};


Object.assign(globalThis as Record<string, unknown>, {
  __webenvoyExtensionServiceWorkerContract: {
    describe,
    expect,
    it,
    vi,
    startChromeBackgroundBridge,
    createMockPort,
    createEditorInputProbeResult,
    createChromeApi,
    respondHandshake,
    waitForBridgeTurn,
    waitForPostedMessage,
    primeTrustedFingerprintContext,
    promoteBootstrapReadinessThroughPing,
    createXhsCommandParams,
    createRequestBoundXhsCommandParams,
    createXhsEditorInputCommandParams,
    createApprovedReadApprovalRecord,
    createApprovedReadAuditRecord,
    createApprovedReadAuditRecordForRequest,
    createFingerprintRuntimeContext,
    asRecord,
    resolveWriteInteractionTier
  }
});

export {};
