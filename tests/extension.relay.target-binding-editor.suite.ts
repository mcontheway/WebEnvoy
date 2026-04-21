import { describe, expect, it, vi } from "vitest";
import { waitForResponse, asRecord, resolveWriteInteractionTier, completeIssue208ApprovalRecord, createAttestedEditorInputValidationResult, createApprovedReadAdmissionContext, createCapturedSearchRequestContextReader, createIssue209GateInvocationId, approvedLiveOptions, BackgroundRelay, ContentScriptHandler, type BridgeResponse } from "./extension.relay.shared.js";

describe("extension background relay contract / target binding and editor input", () => {
  it("blocks issue_208 write action in paused state and returns reversible write tier", async () => {
    let fetchCalled = false;
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-issue-208-paused-write-id",
        getLocationHref: () => "https://creator.xiaohongshu.com/publish/publish",
        getDocumentTitle: () => "Creator Publish",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => ({
          "X-s": "signed",
          "X-t": "1"
        }),
        fetchJson: async () => {
          fetchCalled = true;
          throw new Error("paused issue_208 write should not hit fetch");
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-issue-208-paused-write-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue-208-paused-write-001",
        command: "xhs.search",
        command_params: {
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "write"
          },
          input: {
            query: "露营装备"
          },
          options: {
            target_domain: "creator.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "creator_publish_tab",
            issue_scope: "issue_208",
            requested_execution_mode: "dry_run",
            risk_state: "allowed",
            approval_record: {
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
            },
            admission_context: createApprovedReadAdmissionContext({
              run_id: "run-xhs-live-allowed-001",
              session_id: "nm-session-001",
              requested_execution_mode: "live_read_high_risk",
              risk_state: "allowed"
            }),
            audit_record: {
              event_id: "gate_evt_target_binding_live_allowed_001",
              issue_scope: "issue_209",
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 32,
              target_page: "search_result_tab",
              action_type: "read",
              requested_execution_mode: "live_read_high_risk",
              gate_decision: "allowed",
              recorded_at: "2026-03-23T10:00:30Z"
            }
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      profile: "profile-a",
      timeout_ms: 200
    });

    const response = await responsePromise;
    expect(response.status).toBe("error");
    expect(response.error?.code).toBe("ERR_EXECUTION_FAILED");
    const payload = asRecord(response.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(fetchCalled).toBe(false);
  });

  it("keeps issue_208 blocked live_write on fallback mode in relay path", async () => {
    let fetchCalled = false;
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-issue-208-paused-live-write-id",
        getLocationHref: () => "https://creator.xiaohongshu.com/publish/publish",
        getDocumentTitle: () => "Creator Publish",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => ({
          "X-s": "signed",
          "X-t": "1"
        }),
        fetchJson: async () => {
          fetchCalled = true;
          throw new Error("blocked issue_208 live_write should not hit fetch");
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-issue-208-paused-live-write-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue-208-paused-live-write-001",
        command: "xhs.search",
        command_params: {
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "write"
          },
          input: {
            query: "露营装备"
          },
          options: {
            target_domain: "creator.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "creator_publish_tab",
            issue_scope: "issue_208",
            action_type: "write",
            requested_execution_mode: "live_write",
            risk_state: "paused",
            approval_record: {
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
            },
            audit_record: {
              event_id: "gate_evt_target_binding_live_allowed_001",
              issue_scope: "issue_209",
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 32,
              target_page: "search_result_tab",
              action_type: "read",
              requested_execution_mode: "live_read_high_risk",
              gate_decision: "allowed",
              recorded_at: "2026-03-23T10:00:30Z"
            }
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      profile: "profile-a",
      timeout_ms: 200
    });

    const response = await responsePromise;
    expect(response.status).toBe("error");
    expect(response.error?.code).toBe("ERR_EXECUTION_FAILED");
    expect(response.payload).toMatchObject({
      details: {
        reason: "EXECUTION_MODE_GATE_BLOCKED"
      },
      gate_outcome: {
        effective_execution_mode: "dry_run",
        gate_decision: "blocked"
      },
      consumer_gate_result: {
        issue_scope: "issue_208",
        action_type: "write",
        requested_execution_mode: "live_write",
        effective_execution_mode: "dry_run",
        gate_decision: "blocked"
      }
    });
    expect(fetchCalled).toBe(false);
  });

  it("keeps issue_208 dry_run write blocked even when approval is complete", async () => {
    const states: Array<"limited" | "allowed"> = ["limited", "allowed"];
    for (const state of states) {
      const blockedContentScript = new ContentScriptHandler({
        xhsEnv: {
          now: () => 1_000,
          randomId: () => `relay-issue-208-${state}-missing-approval-id`,
          getLocationHref: () => "https://creator.xiaohongshu.com/publish/publish",
          getDocumentTitle: () => "Creator Publish",
          getReadyState: () => "complete",
          getCookie: () => "a1=valid;",
          callSignature: async () => ({
            "X-s": "signed",
            "X-t": "1"
          }),
          fetchJson: async () => {
            throw new Error("missing approval should not hit fetch");
          }
        }
      });
      const blockedRelay = new BackgroundRelay(blockedContentScript, { forwardTimeoutMs: 200 });
      const blockedResponsePromise = waitForResponse(blockedRelay);
      blockedRelay.onNativeRequest({
        id: `forward-xhs-issue-208-${state}-missing-approval-001`,
        method: "bridge.forward",
        params: {
          session_id: "nm-session-001",
          run_id: `run-xhs-issue-208-${state}-missing-approval-001`,
          command: "xhs.search",
          command_params: {
            ability: {
              id: "xhs.note.search.v1",
              layer: "L3",
              action: "write"
            },
            input: {
              query: "露营装备"
            },
            options: {
              target_domain: "creator.xiaohongshu.com",
              target_tab_id: 32,
              target_page: "creator_publish_tab",
              issue_scope: "issue_208",
              action_type: "write",
              requested_execution_mode: "dry_run",
              risk_state: state,
              approval_record: {
                approved: false,
                approver: null,
                approved_at: null,
                checks: {
                  target_domain_confirmed: false,
                  target_tab_confirmed: false,
                  target_page_confirmed: false,
                  risk_state_checked: false,
                  action_type_confirmed: false
                }
              }
            }
          },
          cwd: "/workspace/WebEnvoy"
        },
        profile: "profile-a",
        timeout_ms: 200
      });
      const blockedResponse = await blockedResponsePromise;
      expect(blockedResponse.status).toBe("error");
      const blockedPayload = asRecord(blockedResponse.payload) ?? {};
      const blockedConsumerGateResult = asRecord(blockedPayload.consumer_gate_result);
      expect(blockedConsumerGateResult?.gate_decision).toBe("blocked");
      expect(resolveWriteInteractionTier(blockedPayload)).toBe("reversible_interaction");

      const approvedContentScript = new ContentScriptHandler({
        xhsEnv: {
          now: () => 1_000,
          randomId: () => `relay-issue-208-${state}-approved-id`,
          getLocationHref: () => "https://creator.xiaohongshu.com/publish/publish",
          getDocumentTitle: () => "Creator Publish",
          getReadyState: () => "complete",
          getCookie: () => "a1=valid;",
          callSignature: async () => ({
            "X-s": "signed",
            "X-t": "1"
          }),
          fetchJson: async () => {
            throw new Error("issue_208 reversible write should remain gate-only in contract test");
          }
        }
      });
      const approvedRelay = new BackgroundRelay(approvedContentScript, { forwardTimeoutMs: 200 });
      const approvedResponsePromise = waitForResponse(approvedRelay);
      approvedRelay.onNativeRequest({
        id: `forward-xhs-issue-208-${state}-approved-001`,
        method: "bridge.forward",
        params: {
          session_id: "nm-session-001",
          run_id: `run-xhs-issue-208-${state}-approved-001`,
          command: "xhs.search",
          command_params: {
            ability: {
              id: "xhs.note.search.v1",
              layer: "L3",
              action: "write"
            },
            input: {
              query: "露营装备"
            },
            options: {
              simulate_result: "success",
              target_domain: "creator.xiaohongshu.com",
              target_tab_id: 32,
              target_page: "creator_publish_tab",
              issue_scope: "issue_208",
              action_type: "write",
              requested_execution_mode: "dry_run",
              risk_state: state,
              approval_record: {
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
              }
            }
          },
          cwd: "/workspace/WebEnvoy"
        },
        profile: "profile-a",
        timeout_ms: 200
      });
      const approvedResponse = await approvedResponsePromise;
      expect(approvedResponse.status).toBe("error");
      const approvedPayload = asRecord(approvedResponse.payload) ?? {};
      const approvedConsumerGateResult = asRecord(approvedPayload.consumer_gate_result);
      expect(approvedConsumerGateResult?.gate_decision).toBe("blocked");
      expect(resolveWriteInteractionTier(approvedPayload)).toBe("reversible_interaction");
    }
  });

  it("allows issue_208 live_write when editor_input attestation is complete", async () => {
    let fetchCalled = false;
    let validationCalled = false;
    const validationText = "最小正式验证";
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-editor-input-id",
        getLocationHref: () => "https://creator.xiaohongshu.com/publish/publish",
        getDocumentTitle: () => "Creator Publish",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => {
          throw new Error("editor_input validation should not reach signature fetch");
        },
        fetchJson: async () => {
          fetchCalled = true;
          throw new Error("editor_input validation should not reach live fetch");
        },
        performEditorInputValidation: async (input) => {
          validationCalled = true;
          expect(input.text).toBe(validationText);
          expect(input.focusAttestation).toMatchObject({
            source: "chrome_debugger",
            target_tab_id: 32,
            editable_state: "entered",
            focus_confirmed: true
          });
          return createAttestedEditorInputValidationResult(input.text);
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-issue-208-editor-input-allowed-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue-208-editor-input-allowed-001",
        command: "xhs.search",
        command_params: {
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "write"
          },
          input: {
            query: validationText
          },
          options: {
            issue_scope: "issue_208",
            target_domain: "creator.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "creator_publish_tab",
            action_type: "write",
            requested_execution_mode: "live_write",
            risk_state: "allowed",
            validation_action: "editor_input",
            validation_text: validationText,
            editor_focus_attestation: {
              source: "chrome_debugger",
              target_tab_id: 32,
              editable_state: "entered",
              focus_confirmed: true,
              entry_button_locator: "button.新的创作",
              entry_button_target_key: "body > button:nth-of-type(1)",
              editor_locator: "div.tiptap.ProseMirror",
              editor_target_key: "body > div:nth-of-type(1)",
              failure_reason: null
            },
            approval_record: completeIssue208ApprovalRecord
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      profile: "profile-a",
      timeout_ms: 200
    });

    const response = await responsePromise;
    expect(response.status).toBe("success");
    expect(validationCalled).toBe(true);
    expect(fetchCalled).toBe(false);
      expect(response.payload).toMatchObject({
      summary: {
        capability_result: {
          ability_id: "xhs.note.search.v1",
          layer: "L3",
          action: "write",
          outcome: "success"
        },
        gate_outcome: {
          gate_decision: "allowed",
          effective_execution_mode: "live_write"
        },
        consumer_gate_result: {
          requested_execution_mode: "live_write",
          effective_execution_mode: "live_write",
          gate_decision: "allowed",
          gate_reasons: expect.arrayContaining([
            "WRITE_INTERACTION_APPROVED",
            "ISSUE_208_EDITOR_INPUT_VALIDATION_APPROVED"
          ])
        },
        interaction_result: {
          validation_action: "editor_input",
          target_page: "creator.xiaohongshu.com/publish",
          validation_attestation: "controlled_real_interaction",
          success_signals: ["editable_state_entered", "editor_focus_attested", "text_visible", "text_persisted_after_blur"],
          failure_signals: [],
          minimum_replay: ["enter_editable_mode", "focus_editor", "type_short_text", "blur_or_reobserve"],
          out_of_scope_actions: ["image_upload", "submit", "publish_confirm"]
        }
      }
    });
  });

  it("blocks issue_208 live_write when editor_input lacks background focus attestation", async () => {
    let validationCalled = false;
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-editor-input-missing-attestation-id",
        getLocationHref: () => "https://creator.xiaohongshu.com/publish/publish",
        getDocumentTitle: () => "Creator Publish",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => {
          throw new Error("blocked editor_input case should not reach signature fetch");
        },
        fetchJson: async () => {
          throw new Error("blocked editor_input case should not reach live fetch");
        },
        performEditorInputValidation: async (input) => {
          validationCalled = true;
          expect(input.focusAttestation).toBeNull();
          return {
            ok: false,
            mode: "dom_editor_input_validation" as const,
            attestation: "dom_self_certified" as const,
            editor_locator: "div.tiptap.ProseMirror",
            input_text: "最小正式验证",
            before_text: "",
            visible_text: "",
            post_blur_text: "",
            focus_confirmed: false,
            focus_attestation_source: null,
            focus_attestation_reason: null,
            preserved_after_blur: false,
            success_signals: [],
            failure_signals: ["missing_focus_attestation"],
            minimum_replay: ["enter_editable_mode", "focus_editor", "type_short_text", "blur_or_reobserve"]
          };
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-issue-208-editor-input-missing-attestation-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue-208-editor-input-missing-attestation-001",
        command: "xhs.search",
        command_params: {
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "write"
          },
          input: {
            query: "最小正式验证"
          },
          options: {
            issue_scope: "issue_208",
            target_domain: "creator.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "creator_publish_tab",
            action_type: "write",
            requested_execution_mode: "live_write",
            risk_state: "allowed",
            validation_action: "editor_input",
            validation_text: "最小正式验证",
            approval_record: completeIssue208ApprovalRecord
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      profile: "profile-a",
      timeout_ms: 200
    });

    const response = await responsePromise;
    expect(validationCalled).toBe(true);
    expect(response.status).toBe("error");
    expect(response.error?.code).toBe("ERR_EXECUTION_FAILED");
    const payload = asRecord(response.payload) ?? {};
    const details = asRecord(payload.details);
    expect(details?.reason).toBe("EDITOR_INPUT_VALIDATION_FAILED");
    expect(details?.focus_attestation_source).toBeNull();
  });

  it("blocks issue_208 live_write when editor_input target binding is ambiguous", async () => {
    let validationCalled = false;
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-editor-input-ambiguous-target-id",
        getLocationHref: () => "https://creator.xiaohongshu.com/publish/publish",
        getDocumentTitle: () => "Creator Publish",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => {
          throw new Error("ambiguous target case should not reach signature fetch");
        },
        fetchJson: async () => {
          throw new Error("ambiguous target case should not reach live fetch");
        },
        performEditorInputValidation: async (input) => {
          validationCalled = true;
          expect(input.focusAttestation).toMatchObject({
            source: "chrome_debugger",
            editor_locator: "div.tiptap.ProseMirror",
            editor_target_key: "body > div:nth-of-type(2)",
            focus_confirmed: true
          });
          return {
            ok: false,
            mode: "dom_editor_input_validation" as const,
            attestation: "dom_self_certified" as const,
            editor_locator: "div.tiptap.ProseMirror",
            input_text: "最小正式验证",
            before_text: "",
            visible_text: "最小正式验证",
            post_blur_text: "最小正式验证",
            focus_confirmed: false,
            focus_attestation_source: "chrome_debugger",
            focus_attestation_reason: null,
            preserved_after_blur: true,
            success_signals: ["editable_state_entered"],
            failure_signals: ["ambiguous_editor_target"],
            minimum_replay: ["enter_editable_mode", "focus_editor", "type_short_text", "blur_or_reobserve"]
          };
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-issue-208-editor-input-ambiguous-target-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue-208-editor-input-ambiguous-target-001",
        command: "xhs.search",
        command_params: {
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "write"
          },
          input: {
            query: "最小正式验证"
          },
          options: {
            issue_scope: "issue_208",
            target_domain: "creator.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "creator_publish_tab",
            action_type: "write",
            requested_execution_mode: "live_write",
            risk_state: "allowed",
            validation_action: "editor_input",
            validation_text: "最小正式验证",
            editor_focus_attestation: {
              source: "chrome_debugger",
              target_tab_id: 32,
              editable_state: "entered",
              focus_confirmed: true,
              entry_button_locator: "button.新的创作",
              entry_button_target_key: "body > button:nth-of-type(1)",
              editor_locator: "div.tiptap.ProseMirror",
              editor_target_key: "body > div:nth-of-type(2)",
              failure_reason: null
            },
            approval_record: completeIssue208ApprovalRecord
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      profile: "profile-a",
      timeout_ms: 200
    });

    const response = await responsePromise;
    expect(validationCalled).toBe(true);
    expect(response.status).toBe("error");
    expect(response.error?.code).toBe("ERR_EXECUTION_FAILED");
    const payload = asRecord(response.payload) ?? {};
    const details = asRecord(payload.details);
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(details?.reason).toBe("EDITOR_INPUT_VALIDATION_FAILED");
    expect(details?.validation_attestation).toBe("dom_self_certified");
    expect(details?.failure_signals).toEqual(expect.arrayContaining(["ambiguous_editor_target"]));
    expect(consumerGateResult?.gate_decision).toBe("allowed");
  });

  it("returns structured failure with audit metadata when editor_input validation throws", async () => {
    let validationCalled = false;
    const runId = "run-xhs-issue-208-editor-input-validation-throw-001";
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-editor-input-validation-throw-id",
        getLocationHref: () => "https://creator.xiaohongshu.com/publish/publish",
        getDocumentTitle: () => "Creator Publish",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => {
          throw new Error("editor_input validation throw case should not reach signature fetch");
        },
        fetchJson: async () => {
          throw new Error("editor_input validation throw case should not reach live fetch");
        },
        performEditorInputValidation: async () => {
          validationCalled = true;
          throw new Error("editor_input probe crashed");
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-issue-208-editor-input-validation-throw-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: runId,
        command: "xhs.search",
        command_params: {
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "write"
          },
          input: {
            query: "最小正式验证"
          },
          options: {
            issue_scope: "issue_208",
            target_domain: "creator.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "creator_publish_tab",
            action_type: "write",
            requested_execution_mode: "live_write",
            risk_state: "allowed",
            validation_action: "editor_input",
            validation_text: "最小正式验证",
            editor_focus_attestation: {
              source: "chrome_debugger",
              target_tab_id: 32,
              editable_state: "entered",
              focus_confirmed: true,
              entry_button_locator: "button.新的创作",
              entry_button_target_key: "body > button:nth-of-type(1)",
              editor_locator: "div.tiptap.ProseMirror",
              editor_target_key: "body > div:nth-of-type(1)",
              failure_reason: null
            },
            approval_record: completeIssue208ApprovalRecord
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      profile: "profile-a",
      timeout_ms: 200
    });

    const response = await responsePromise;
    expect(validationCalled).toBe(true);
    expect(response.status).toBe("error");
    expect(response.error?.code).toBe("ERR_EXECUTION_FAILED");
    const payload = asRecord(response.payload) ?? {};
    const details = asRecord(payload.details);
    const gateInput = asRecord(payload.gate_input);
    const auditRecord = asRecord(payload.audit_record);
    expect(details?.reason).toBe("EDITOR_INPUT_VALIDATION_FAILED");
    expect(details?.validation_exception).toBe("editor_input probe crashed");
    expect(gateInput?.run_id).toBe(runId);
    expect(gateInput?.session_id).toBe("nm-session-001");
    expect(gateInput?.profile).toBe("profile-a");
    expect(auditRecord?.run_id).toBe(runId);
    expect(auditRecord?.session_id).toBe("nm-session-001");
    expect(auditRecord?.profile).toBe("profile-a");
    expect(payload.execution_audit ?? null).toBeNull();
  });

  it.each([
    {
      label: "missing editor_input validation",
      id: "forward-xhs-issue-208-editor-input-missing-001",
      runId: "run-xhs-issue-208-editor-input-missing-001",
      options: {
        issue_scope: "issue_208",
        target_domain: "creator.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "creator_publish_tab",
        action_type: "write",
        requested_execution_mode: "live_write",
        risk_state: "allowed",
        approval_record: completeIssue208ApprovalRecord
      },
      expectedReason: "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND"
    },
    {
      label: "out-of-bounds write against the read domain",
      id: "forward-xhs-issue-208-editor-input-oob-001",
      runId: "run-xhs-issue-208-editor-input-oob-001",
      options: {
        issue_scope: "issue_208",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "write",
        requested_execution_mode: "live_write",
        risk_state: "allowed",
        validation_action: "editor_input",
        validation_text: "最小正式验证",
        approval_record: completeIssue208ApprovalRecord
      },
      expectedReason: "ACTION_DOMAIN_MISMATCH"
    }
  ] as const)("blocks issue_208 live_write when $label", async ({ id, runId, options, expectedReason }) => {
    let validationCalled = false;
    let fetchCalled = false;
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-editor-input-blocked-id",
        getLocationHref: () => "https://creator.xiaohongshu.com/publish/publish",
        getDocumentTitle: () => "Creator Publish",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => {
          throw new Error("blocked editor_input case should not reach signature fetch");
        },
        fetchJson: async () => {
          fetchCalled = true;
          throw new Error("blocked editor_input case should not reach live fetch");
        },
        performEditorInputValidation: async () => {
          validationCalled = true;
          return createAttestedEditorInputValidationResult("最小正式验证");
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id,
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: runId,
        command: "xhs.search",
        command_params: {
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "write"
          },
          input: {
            query: "最小正式验证"
          },
          options
        },
        cwd: "/workspace/WebEnvoy"
      },
      profile: "profile-a",
      timeout_ms: 200
    });

    const response = await responsePromise;
    expect(response.status).toBe("error");
    expect(response.error?.code).toBe("ERR_EXECUTION_FAILED");
    expect(validationCalled).toBe(false);
    expect(fetchCalled).toBe(false);
    const payload = asRecord(response.payload) ?? {};
    const details = asRecord(payload.details);
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    const requestAdmissionResult = asRecord(payload.request_admission_result);
    expect(details?.reason).toBe("EXECUTION_MODE_GATE_BLOCKED");
    expect(consumerGateResult).toMatchObject({
      gate_decision: "blocked"
    });
    expect(consumerGateResult?.gate_reasons).toEqual(expect.arrayContaining([expectedReason]));
    expect(requestAdmissionResult?.admission_decision).toBe("blocked");
    expect(requestAdmissionResult?.reason_codes).toEqual(expect.arrayContaining([expectedReason]));
    expect(payload.execution_audit ?? null).toBeNull();
  });

  it("returns structured execution failure when editor_input validation throws", async () => {
    let fetchCalled = false;
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-editor-input-throw-id",
        getLocationHref: () => "https://creator.xiaohongshu.com/publish/publish",
        getDocumentTitle: () => "Creator Publish",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => {
          throw new Error("editor_input validation throw should not reach signature fetch");
        },
        fetchJson: async () => {
          fetchCalled = true;
          throw new Error("editor_input validation throw should not reach live fetch");
        },
        performEditorInputValidation: async () => {
          throw new Error("debugger detached before validation completed");
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-issue-208-editor-input-throw-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue-208-editor-input-throw-001",
        command: "xhs.search",
        command_params: {
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "write"
          },
          input: {
            query: "最小正式验证"
          },
          options: {
            issue_scope: "issue_208",
            target_domain: "creator.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "creator_publish_tab",
            action_type: "write",
            requested_execution_mode: "live_write",
            risk_state: "allowed",
            validation_action: "editor_input",
            validation_text: "最小正式验证",
            editor_focus_attestation: {
              source: "chrome_debugger",
              target_tab_id: 32,
              editable_state: "entered",
              focus_confirmed: true,
              entry_button_locator: "button.新的创作",
              entry_button_target_key: "body > button:nth-of-type(1)",
              editor_locator: "div.tiptap.ProseMirror",
              editor_target_key: "body > div:nth-of-type(1)",
              failure_reason: null
            },
            approval_record: completeIssue208ApprovalRecord
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      profile: "profile-a",
      timeout_ms: 200
    });

    const response = await responsePromise;
    expect(response.status).toBe("error");
    expect(response.error?.code).toBe("ERR_EXECUTION_FAILED");
    expect(fetchCalled).toBe(false);
    const payload = asRecord(response.payload) ?? {};
    const details = asRecord(payload.details);
    const auditRecord = asRecord(payload.audit_record);
    expect(details?.reason).toBe("EDITOR_INPUT_VALIDATION_FAILED");
    expect(details?.validation_exception).toBe("debugger detached before validation completed");
    expect(auditRecord?.run_id).toBe("run-xhs-issue-208-editor-input-throw-001");
    expect(auditRecord?.session_id).toBe("nm-session-001");
    expect(payload.execution_audit ?? null).toBeNull();
  });

  it("keeps issue_208 irreversible_write blocked and returns irreversible write tier", async () => {
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-issue-208-irreversible-id",
        getLocationHref: () => "https://creator.xiaohongshu.com/publish/publish",
        getDocumentTitle: () => "Creator Publish",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => ({
          "X-s": "signed",
          "X-t": "1"
        }),
        fetchJson: async () => {
          throw new Error("irreversible write should not hit fetch");
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-issue-208-irreversible-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue-208-irreversible-001",
        command: "xhs.search",
        command_params: {
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "write"
          },
          input: {
            query: "露营装备"
          },
          options: {
            target_domain: "creator.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "creator_publish_tab",
            issue_scope: "issue_208",
            action_type: "irreversible_write",
            requested_execution_mode: "dry_run",
            risk_state: "allowed",
            approval_record: {
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
            }
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      profile: "profile-a",
      timeout_ms: 200
    });

    const response = await responsePromise;
    expect(response.status).toBe("error");
    const payload = asRecord(response.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(resolveWriteInteractionTier(payload)).toBe("irreversible_write");
  });

  it("blocks live approval when caller target scope mismatches actual context", async () => {
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-target-mismatch-id",
        getLocationHref: () => "https://www.xiaohongshu.com/search_result",
        getDocumentTitle: () => "Search Result",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        readCapturedRequestContext: createCapturedSearchRequestContextReader(),
        callSignature: async () => ({
          "X-s": "signed",
          "X-t": "1"
        }),
        fetchJson: async () => {
          throw new Error("mismatched target scope should not hit fetch");
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-target-mismatch-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-target-mismatch-001",
        command: "xhs.search",
        command_params: {
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "read"
          },
          input: {
            query: "露营装备"
          },
          options: {
            target_domain: "creator.xiaohongshu.com",
            target_tab_id: 99,
            target_page: "creator_publish_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            risk_state: "allowed",
            approval_record: {
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
            }
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      profile: "profile-a",
      timeout_ms: 200
    });

    const response = await responsePromise;
    expect(response.status).toBe("error");
    expect(
      (((response.payload as Record<string, unknown>).consumer_gate_result as Record<string, unknown>)
        .gate_reasons as string[])
    ).toEqual(
      expect.arrayContaining([
        "TARGET_DOMAIN_CONTEXT_MISMATCH",
        "TARGET_TAB_CONTEXT_MISMATCH",
        "TARGET_PAGE_CONTEXT_MISMATCH"
      ])
    );
  });

  it("blocks live approval when actual target page cannot be classified", async () => {
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-target-page-unresolved-id",
        getLocationHref: () => "https://www.xiaohongshu.com/explore/123456",
        getDocumentTitle: () => "Explore Detail",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => ({
          "X-s": "signed",
          "X-t": "1"
        }),
        fetchJson: async () => {
          throw new Error("unresolved target page should not hit fetch");
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-target-page-unresolved-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-target-page-unresolved-001",
        command: "xhs.search",
        command_params: {
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "read"
          },
          input: {
            query: "露营装备"
          },
          options: {
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            risk_state: "allowed",
            approval_record: {
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
            },
            audit_record: {
              event_id: "gate_evt_target_binding_live_allowed_001",
              issue_scope: "issue_209",
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 32,
              target_page: "search_result_tab",
              action_type: "read",
              requested_execution_mode: "live_read_high_risk",
              gate_decision: "allowed",
              recorded_at: "2026-03-23T10:00:30Z"
            }
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      profile: "profile-a",
      timeout_ms: 200
    });

    const response = await responsePromise;
    expect(response.status).toBe("error");
    expect(
      (((response.payload as Record<string, unknown>).consumer_gate_result as Record<string, unknown>)
        .gate_reasons as string[])
    ).toEqual(expect.arrayContaining(["TARGET_PAGE_CONTEXT_UNRESOLVED"]));
  });

  it("returns structured payload when xhs.search request times out", async () => {
    const timeoutError = new Error("request timeout");
    timeoutError.name = "AbortError";
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-timeout-id",
        getLocationHref: () => "https://www.xiaohongshu.com/search_result",
        getDocumentTitle: () => "Search Result",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        readCapturedRequestContext: createCapturedSearchRequestContextReader(),
        callSignature: async () => ({
          "X-s": "signed",
          "X-t": "1"
        }),
        fetchJson: async () => {
          throw timeoutError;
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-timeout-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-timeout-001",
        command: "xhs.search",
        command_params: {
          request_id: "issue209-relay-timeout-001",
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "read"
          },
          input: {
            query: "露营装备"
          },
          options: {
            ...approvedLiveOptions,
            admission_context: createApprovedReadAdmissionContext({
              run_id: "run-xhs-timeout-001",
              request_id: "issue209-relay-timeout-001",
              session_id: "nm-session-001",
              requested_execution_mode: "live_read_high_risk",
              risk_state: "allowed"
            }),
            audit_record: {
              event_id: "gate_evt_target_binding_timeout_001",
              decision_id: "gate_decision_run-xhs-timeout-001_issue209-relay-timeout-001",
              approval_id: "gate_appr_gate_decision_run-xhs-timeout-001_issue209-relay-timeout-001",
              issue_scope: "issue_209",
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 32,
              target_page: "search_result_tab",
              action_type: "read",
              requested_execution_mode: "live_read_high_risk",
              gate_decision: "allowed",
              recorded_at: "2026-03-23T10:00:30Z"
            }
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      profile: "profile-a",
      timeout_ms: 200
    });

    const response = await responsePromise;
    expect(response.status).toBe("error");
    expect(response.error?.code).toBe("ERR_EXECUTION_FAILED");
    expect(response.payload).toMatchObject({
      details: {
        reason: "REQUEST_TIMEOUT"
      },
      diagnosis: {
        category: "request_failed"
      },
      observability: {
        failure_site: {
          target: "/api/sns/web/v1/search/notes"
        }
      }
    });
  });

  it("blocks live_read_high_risk without manual approval in relay path", async () => {
    let fetchCalled = false;
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-gate-blocked-id",
        getLocationHref: () => "https://www.xiaohongshu.com/search_result",
        getDocumentTitle: () => "Search Result",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        readCapturedRequestContext: createCapturedSearchRequestContextReader(),
        callSignature: async () => ({
          "X-s": "signed",
          "X-t": "1"
        }),
        fetchJson: async () => {
          fetchCalled = true;
          return { status: 200, body: { code: 0, data: { items: [] } } };
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-live-blocked-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-blocked-001",
        command: "xhs.search",
        command_params: {
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "read"
          },
          input: {
            query: "露营装备"
          },
          options: {
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            risk_state: "allowed"
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      profile: "profile-a",
      timeout_ms: 200
    });

    const response = await responsePromise;
    expect(response.status).toBe("error");
    expect(response.error?.code).toBe("ERR_EXECUTION_FAILED");
    expect(response.payload).toMatchObject({
      details: {
        reason: "EXECUTION_MODE_GATE_BLOCKED"
      },
      consumer_gate_result: {
        requested_execution_mode: "live_read_high_risk",
        effective_execution_mode: "dry_run",
        gate_decision: "blocked"
      }
    });
    expect(
      ((response.payload as Record<string, unknown>).consumer_gate_result as Record<string, unknown>)
        .gate_reasons as string[]
    ).toEqual(expect.arrayContaining(["MANUAL_CONFIRMATION_MISSING"]));
    expect(fetchCalled).toBe(false);
  });

  it("blocks issue_209 write live_read_limited with fallback mode in relay path", async () => {
    let fetchCalled = false;
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-issue209-write-limited-blocked-id",
        getLocationHref: () => "https://creator.xiaohongshu.com/publish/publish",
        getDocumentTitle: () => "Publish",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => ({
          "X-s": "signed",
          "X-t": "1"
        }),
        fetchJson: async () => {
          fetchCalled = true;
          return { status: 200, body: { code: 0, data: { items: [] } } };
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-issue209-write-limited-blocked-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue209-write-limited-blocked-001",
        command: "xhs.search",
        command_params: {
          gate_invocation_id: createIssue209GateInvocationId(
            "run-xhs-issue209-write-limited-blocked-001",
            "write-live-read-limited"
          ),
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "write"
          },
          input: {
            query: "露营装备"
          },
          options: {
            target_domain: "creator.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "creator_publish_tab",
            issue_scope: "issue_209",
            action_type: "write",
            requested_execution_mode: "live_read_limited",
            risk_state: "limited",
            approval_record: {
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
            }
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      profile: "profile-a",
      timeout_ms: 200
    });

    const response = await responsePromise;
    expect(response.status).toBe("error");
    expect(response.error?.code).toBe("ERR_EXECUTION_FAILED");
    expect(response.payload).toMatchObject({
      details: {
        reason: "EXECUTION_MODE_GATE_BLOCKED"
      },
      consumer_gate_result: {
        issue_scope: "issue_209",
        action_type: "write",
        requested_execution_mode: "live_read_limited",
        effective_execution_mode: "recon",
        gate_decision: "blocked"
      }
    });
    expect(
      ((response.payload as Record<string, unknown>).consumer_gate_result as Record<string, unknown>)
        .gate_reasons as string[]
    ).toEqual(
      expect.arrayContaining([
        "ACTION_TYPE_MODE_MISMATCH",
        "RISK_STATE_LIMITED",
        "ISSUE_ACTION_MATRIX_BLOCKED"
      ])
    );
    expect(fetchCalled).toBe(false);
  });

  it("blocks issue_209 write live_read_high_risk with fallback mode in relay path", async () => {
    let fetchCalled = false;
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-issue209-write-live-blocked-id",
        getLocationHref: () => "https://creator.xiaohongshu.com/publish/publish",
        getDocumentTitle: () => "Publish",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => ({
          "X-s": "signed",
          "X-t": "1"
        }),
        fetchJson: async () => {
          fetchCalled = true;
          return { status: 200, body: { code: 0, data: { items: [] } } };
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-issue209-write-live-blocked-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue209-write-live-blocked-001",
        command: "xhs.search",
        command_params: {
          gate_invocation_id: createIssue209GateInvocationId(
            "run-xhs-issue209-write-live-blocked-001",
            "write-live-read-high-risk"
          ),
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "write"
          },
          input: {
            query: "露营装备"
          },
          options: {
            target_domain: "creator.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "creator_publish_tab",
            issue_scope: "issue_209",
            action_type: "write",
            requested_execution_mode: "live_read_high_risk",
            risk_state: "allowed",
            approval_record: {
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
            }
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      profile: "profile-a",
      timeout_ms: 200
    });

    const response = await responsePromise;
    expect(response.status).toBe("error");
    expect(response.error?.code).toBe("ERR_EXECUTION_FAILED");
    expect(response.payload).toMatchObject({
      details: {
        reason: "EXECUTION_MODE_GATE_BLOCKED"
      },
      consumer_gate_result: {
        issue_scope: "issue_209",
        action_type: "write",
        requested_execution_mode: "live_read_high_risk",
        effective_execution_mode: "dry_run",
        gate_decision: "blocked"
      }
    });
    expect(
      ((response.payload as Record<string, unknown>).consumer_gate_result as Record<string, unknown>)
        .gate_reasons as string[]
    ).toEqual(
      expect.arrayContaining([
        "ACTION_TYPE_MODE_MISMATCH",
        "RISK_STATE_ALLOWED",
        "ISSUE_ACTION_MATRIX_BLOCKED"
      ])
    );
    expect(fetchCalled).toBe(false);
  });

  it("allows live_read_high_risk with approval and returns consumer gate result", async () => {
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-gate-allowed-id",
        getLocationHref: () => "https://www.xiaohongshu.com/search_result",
        getDocumentTitle: () => "Search Result",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        readCapturedRequestContext: createCapturedSearchRequestContextReader(),
        callSignature: async () => ({
          "X-s": "signed",
          "X-t": "1"
        }),
        fetchJson: async () => ({
          status: 200,
          body: {
            code: 0,
            data: {
              items: []
            }
          }
        })
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-live-allowed-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-allowed-001",
        command: "xhs.search",
        command_params: {
          request_id: "issue209-relay-live-high-risk-allowed-001",
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "read"
          },
          input: {
            query: "露营装备"
          },
          options: {
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            risk_state: "allowed",
            approval_record: {
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
            },
            admission_context: createApprovedReadAdmissionContext({
              run_id: "run-xhs-live-allowed-001",
              request_id: "issue209-relay-live-high-risk-allowed-001",
              session_id: "nm-session-001",
              requested_execution_mode: "live_read_high_risk",
              risk_state: "allowed"
            }),
            audit_record: {
              event_id: "gate_evt_target_binding_live_allowed_001",
              decision_id: "gate_decision_run-xhs-live-allowed-001_issue209-relay-live-high-risk-allowed-001",
              approval_id: "gate_appr_gate_decision_run-xhs-live-allowed-001_issue209-relay-live-high-risk-allowed-001",
              issue_scope: "issue_209",
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 32,
              target_page: "search_result_tab",
              action_type: "read",
              requested_execution_mode: "live_read_high_risk",
              gate_decision: "allowed",
              recorded_at: "2026-03-23T10:00:30Z"
            }
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      profile: "profile-a",
      timeout_ms: 200
    });

    const response = await responsePromise;
    expect(response.status).toBe("success");
    expect(response.payload).toMatchObject({
      summary: {
        scope_context: {
          platform: "xhs",
          read_domain: "www.xiaohongshu.com",
          write_domain: "creator.xiaohongshu.com",
          domain_mixing_forbidden: true
        },
        gate_input: {
          run_id: "run-xhs-live-allowed-001",
          session_id: "nm-session-001",
          profile: "profile-a",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed"
        },
        gate_outcome: {
          effective_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"],
          requires_manual_confirmation: true
        },
        read_execution_policy: {
          default_mode: "dry_run",
          allowed_modes: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
          blocked_actions: ["expand_new_live_surface_without_gate"]
        },
        consumer_gate_result: {
          requested_execution_mode: "live_read_high_risk",
          effective_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"]
        },
        approval_record: {
          approved: true,
          approver: "reviewer-a",
          approved_at: "2026-03-23T08:00:00Z"
        },
        audit_record: {
          run_id: "run-xhs-live-allowed-001",
          session_id: "nm-session-001",
          profile: "profile-a",
          risk_state: "allowed",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          effective_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"],
          approver: "reviewer-a",
          approved_at: "2026-03-23T08:00:00Z",
          audited_checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          },
          risk_signal: false,
          recovery_signal: false,
          session_rhythm_state: "normal",
          cooldown_until: null,
          recovery_started_at: null
        }
      }
    });
    expect(
      typeof (((response.payload as Record<string, unknown>).summary as Record<string, unknown>).audit_record as Record<string, unknown>).event_id
    ).toBe("string");
    expect(
      typeof (((response.payload as Record<string, unknown>).summary as Record<string, unknown>).audit_record as Record<string, unknown>).recorded_at
    ).toBe("string");
  });
});
