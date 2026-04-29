import { describe, expect, it, vi } from "vitest";

import * as contentScriptMainWorldModule from "../extension/content-script-main-world.js";
import {
  ContentScriptHandler,
  type BackgroundToContentMessage
} from "../extension/content-script-handler.js";
import type { XhsSearchEnvironment } from "../extension/xhs-search-types.js";

const approvedLiveOptions = {
  target_domain: "www.xiaohongshu.com",
  target_tab_id: 32,
  target_page: "explore_detail_tab",
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
  admission_context: {
    approval_admission_evidence: {
      approval_admission_ref: "gate_appr_content_read_001",
      run_id: "run-contract-001",
      session_id: "nm-session-001",
      issue_scope: "issue_209",
      target_domain: "www.xiaohongshu.com",
      target_tab_id: 32,
      target_page: "explore_detail_tab",
      action_type: "read",
      requested_execution_mode: "live_read_high_risk",
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
      audit_admission_ref: "gate_evt_content_read_001",
      run_id: "run-contract-001",
      session_id: "nm-session-001",
      issue_scope: "issue_209",
      target_domain: "www.xiaohongshu.com",
      target_tab_id: 32,
      target_page: "explore_detail_tab",
      action_type: "read",
      requested_execution_mode: "live_read_high_risk",
      risk_state: "allowed",
      audited_checks: {
        target_domain_confirmed: true,
        target_tab_confirmed: true,
        target_page_confirmed: true,
        risk_state_checked: true,
        action_type_confirmed: true
      },
      recorded_at: "2026-03-23T10:00:30Z"
    }
  },
  audit_record: {
    event_id: "audit-content-read-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: 32,
    target_page: "explore_detail_tab",
    action_type: "read",
    requested_execution_mode: "live_read_high_risk",
    gate_decision: "allowed",
    recorded_at: "2026-03-23T10:00:30Z"
  }
} as const;

const createInstalledFingerprintContext = () => ({
  profile: "xhs_001",
  source: "profile_meta" as const,
  fingerprint_profile_bundle: null,
  fingerprint_patch_manifest: null,
  fingerprint_consistency_check: {
    profile: "xhs_001",
    expected_environment: {
      os_family: "linux",
      os_version: "6.8",
      arch: "x64"
    },
    actual_environment: {
      os_family: "linux",
      os_version: "6.8",
      arch: "x64"
    },
    decision: "match" as const,
    reason_codes: []
  },
  execution: {
    live_allowed: true,
    live_decision: "allowed" as const,
    allowed_execution_modes: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
    reason_codes: []
  },
  injection: {
    installed: true,
    required_patches: [],
    missing_required_patches: [],
    source: "main_world"
  }
});

const createActiveFallbackRuntimeAttestation = () => ({
  source: "official_chrome_runtime_readiness",
  runtime_readiness: "ready",
  profile_ref: "xhs_001",
  session_id: "nm-session-001",
  run_id: "run-contract-001",
  execution_surface: "real_browser",
  headless: false,
  observed_at: "2026-04-29T00:00:00.000Z"
});

const anonymousReadOptions = {
  target_domain: "www.xiaohongshu.com",
  target_tab_id: 32,
  target_page: "explore_detail_tab",
  action_type: "read",
  requested_execution_mode: "dry_run",
  upstream_authorization_request: {
    action_request: {
      request_ref: "upstream-anon-read-001",
      action_name: "xhs.read_note_detail",
      action_category: "read"
    },
    resource_binding: {
      binding_ref: "binding-anon-read-001",
      resource_kind: "anonymous_context",
      profile_ref: null,
      binding_constraints: {
        anonymous_required: true,
        reuse_logged_in_context_forbidden: true
      }
    },
    authorization_grant: {
      grant_ref: "grant-anon-read-001",
      allowed_actions: ["xhs.read_note_detail"],
      binding_scope: {
        allowed_resource_kinds: ["anonymous_context"],
        allowed_profile_refs: []
      },
      target_scope: {
        allowed_domains: ["www.xiaohongshu.com"],
        allowed_pages: ["explore_detail_tab"]
      },
      approval_refs: [],
      audit_refs: [],
      resource_state_snapshot: "paused"
    },
    runtime_target: {
      target_ref: "target-anon-read-001",
      domain: "www.xiaohongshu.com",
      page: "explore_detail_tab",
      tab_id: 32,
      url: "https://www.xiaohongshu.com/explore/abc123"
    }
  }
} as const;

const waitForSingleResult = (handler: ContentScriptHandler) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => {
      off();
      reject(new Error("did not receive content-script result"));
    }, 2_000);
    const off = handler.onResult((message) => {
      clearTimeout(timeout);
      off();
      resolve(message as unknown as Record<string, unknown>);
    });
  });

const createMessage = (input: {
  command: "xhs.detail" | "xhs.user_home";
  abilityId: string;
  targetPage: "explore_detail_tab" | "profile_tab";
  href: string;
  payload: Record<string, unknown>;
  cookie?: string;
  options?: Record<string, unknown>;
  fingerprintContext?: Record<string, unknown> | null;
  xhsEnvOverrides?: Partial<XhsSearchEnvironment>;
}): {
  handler: ContentScriptHandler;
  message: BackgroundToContentMessage;
} => {
  const mergedOptions = {
    ...approvedLiveOptions,
    ...(input.options ?? {}),
    target_page: input.targetPage,
    audit_record: {
      ...(approvedLiveOptions.audit_record),
      target_page: input.targetPage
    },
    admission_context: {
      approval_admission_evidence: {
        ...(approvedLiveOptions.admission_context.approval_admission_evidence),
        target_page: input.targetPage
      },
      audit_admission_evidence: {
        ...(approvedLiveOptions.admission_context.audit_admission_evidence),
        target_page: input.targetPage
      }
    }
  };
  if (!Object.prototype.hasOwnProperty.call(input.options ?? {}, "simulate_result")) {
    mergedOptions.simulate_result = "success";
  }

  const handler = new ContentScriptHandler({
    xhsEnv: {
      now: () => Date.now(),
      randomId: () => "req-contract-001",
      getLocationHref: () => input.href,
      getDocumentTitle: () => "contract-title",
      getReadyState: () => "complete",
      getCookie: () => input.cookie ?? "a1=session-cookie",
      callSignature: async () => ({
        "X-s": "signature",
        "X-t": "timestamp"
      }),
      fetchJson: async () => ({
        status: 200,
        body: {
          code: 0
        }
      }),
      ...(input.xhsEnvOverrides ?? {})
    }
  });

  return {
    handler,
    message: {
      kind: "forward",
      id: `msg-${input.command}`,
      runId: "run-contract-001",
      tabId: 32,
      profile: "xhs_001",
      cwd: "/tmp/webenvoy",
      timeoutMs: 3_000,
      command: input.command,
      params: {
        session_id: "nm-session-001"
      },
      ...(input.fingerprintContext ? { fingerprintContext: input.fingerprintContext } : {}),
      commandParams: {
        request_id: "req-contract-001",
        gate_invocation_id: `issue209-gate-${input.command}-001`,
        ability: {
          id: input.abilityId,
          layer: "L3",
          action: "read"
        },
        input: input.payload,
        options: mergedOptions
      }
    }
  };
};

describe("content-script handler xhs read commands", () => {
  it("routes xhs.detail through the unified xhs read execution path", async () => {
    const { handler, message } = createMessage({
      command: "xhs.detail",
      abilityId: "xhs.note.detail.v1",
      targetPage: "explore_detail_tab",
      href: "https://www.xiaohongshu.com/explore/abc123",
      payload: {
        note_id: "abc123"
      }
    });

    const resultPromise = waitForSingleResult(handler);
    expect(handler.onBackgroundMessage(message)).toBe(true);
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(
      (((result.payload as Record<string, unknown>).summary as Record<string, unknown>)
        .capability_result as Record<string, unknown>).ability_id
    ).toBe("xhs.note.detail.v1");
    expect(
      (((result.payload as Record<string, unknown>).summary as Record<string, unknown>)
        .execution_audit as Record<string, unknown> | null)
    ).toBeNull();
  });

  it("routes xhs.user_home through the unified xhs read execution path", async () => {
    const { handler, message } = createMessage({
      command: "xhs.user_home",
      abilityId: "xhs.user.home.v1",
      targetPage: "profile_tab",
      href: "https://www.xiaohongshu.com/user/profile/user-001",
      payload: {
        user_id: "user-001"
      }
    });

    const resultPromise = waitForSingleResult(handler);
    expect(handler.onBackgroundMessage(message)).toBe(true);
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(
      (((result.payload as Record<string, unknown>).summary as Record<string, unknown>)
        .capability_result as Record<string, unknown>).ability_id
    ).toBe("xhs.user.home.v1");
    expect(
      (((result.payload as Record<string, unknown>).summary as Record<string, unknown>)
        .execution_audit as Record<string, unknown> | null)
    ).toBeNull();
  });

  it("reinstalls the main-world channel secret for xhs.detail and xhs.user_home forwards", async () => {
    const installSecret = vi.spyOn(
      contentScriptMainWorldModule,
      "installMainWorldEventChannelSecret"
    );

    for (const input of [
      {
        command: "xhs.detail" as const,
        abilityId: "xhs.note.detail.v1",
        targetPage: "explore_detail_tab" as const,
        href: "https://www.xiaohongshu.com/explore/note-001",
        payload: { note_id: "note-001" }
      },
      {
        command: "xhs.user_home" as const,
        abilityId: "xhs.user.home.v1",
        targetPage: "profile_tab" as const,
        href: "https://www.xiaohongshu.com/user/profile/user-001",
        payload: { user_id: "user-001" }
      }
    ]) {
      installSecret.mockClear();
      const { handler, message } = createMessage(input);
      message.commandParams.main_world_secret = `secret-${input.command}`;

      const resultPromise = waitForSingleResult(handler);
      expect(handler.onBackgroundMessage(message)).toBe(true);
      await resultPromise;

      expect(installSecret).toHaveBeenCalledWith(`secret-${input.command}`);
    }
  });

  it("admits anonymous_context on the extension path when the target site is actually logged out", async () => {
    const { handler, message } = createMessage({
      command: "xhs.detail",
      abilityId: "xhs.note.detail.v1",
      targetPage: "explore_detail_tab",
      href: "https://www.xiaohongshu.com/explore/abc123",
      cookie: "",
      options: anonymousReadOptions as unknown as Record<string, unknown>,
      payload: {
        note_id: "abc123"
      }
    });

    const resultPromise = waitForSingleResult(handler);
    expect(handler.onBackgroundMessage(message)).toBe(true);
    const result = await resultPromise;
    const summary = ((result.payload as Record<string, unknown>).summary ?? {}) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect((summary.request_admission_result as Record<string, unknown>).admission_decision).toBe(
      "allowed"
    );
    expect(summary.execution_audit).toBeNull();
  });

  it("does not trust caller-supplied anonymous override flags when the target site is actually logged in", async () => {
    const { handler, message } = createMessage({
      command: "xhs.detail",
      abilityId: "xhs.note.detail.v1",
      targetPage: "explore_detail_tab",
      href: "https://www.xiaohongshu.com/explore/abc123",
      cookie: "a1=session-cookie",
      options: {
        ...anonymousReadOptions,
        __anonymous_isolation_verified: true,
        target_site_logged_in: false
      } as Record<string, unknown>,
      payload: {
        note_id: "abc123"
      }
    });

    const resultPromise = waitForSingleResult(handler);
    expect(handler.onBackgroundMessage(message)).toBe(true);
    const result = await resultPromise;
    const payload = (result.payload ?? {}) as Record<string, unknown>;
    const details = (payload.details ?? {}) as Record<string, unknown>;
    const requestAdmissionResult = (payload.request_admission_result ?? {}) as Record<string, unknown>;

    expect(result.ok).toBe(false);
    expect(details.reason).toBe("EXECUTION_MODE_GATE_BLOCKED");
    expect(requestAdmissionResult.admission_decision).toBe("blocked");
    expect(payload.execution_audit).toBeNull();
  });

  it("rejects xhs.detail when note_id is missing on the extension path", async () => {
    const { handler, message } = createMessage({
      command: "xhs.detail",
      abilityId: "xhs.note.detail.v1",
      targetPage: "explore_detail_tab",
      href: "https://www.xiaohongshu.com/explore/abc123",
      payload: {}
    });

    const resultPromise = waitForSingleResult(handler);
    expect(handler.onBackgroundMessage(message)).toBe(true);
    const result = await resultPromise;

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "ERR_CLI_INVALID_ARGS"
      },
      payload: {
        details: {
          reason: "NOTE_ID_MISSING"
        }
      }
    });
  });

  it("rejects xhs.user_home when user_id is missing on the extension path", async () => {
    const { handler, message } = createMessage({
      command: "xhs.user_home",
      abilityId: "xhs.user.home.v1",
      targetPage: "profile_tab",
      href: "https://www.xiaohongshu.com/user/profile/user-001",
      payload: {}
    });

    const resultPromise = waitForSingleResult(handler);
    expect(handler.onBackgroundMessage(message)).toBe(true);
    const result = await resultPromise;

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "ERR_CLI_INVALID_ARGS"
      },
      payload: {
        details: {
          reason: "USER_ID_MISSING"
        }
      }
    });
  });

  it("preserves request-context incompatible diagnostics for xhs.detail failures on the extension path", async () => {
    const { handler, message } = createMessage({
      command: "xhs.detail",
      abilityId: "xhs.note.detail.v1",
      targetPage: "explore_detail_tab",
      href: "https://www.xiaohongshu.com/explore/abc123",
      options: {
        simulate_result: null
      },
      payload: {
        note_id: "abc123"
      },
      xhsEnvOverrides: {
        readCapturedRequestContext: async () =>
          ({
            source_kind: "page_request",
            transport: "fetch",
            method: "POST",
            path: "/api/sns/web/v1/feed",
            url: "https://www.xiaohongshu.com/api/sns/web/v1/feed",
            status: 200,
            captured_at: 1_710_000_000_000,
            page_context_namespace: "xhs.detail",
            shape_key:
              '{"command":"xhs.detail","method":"POST","pathname":"/api/sns/web/v1/feed","note_id":"abc123"}',
            shape: undefined,
            request: {
              headers: {},
              body: {
                source_note_id: "abc123"
              }
            },
            response: {
              headers: {},
              body: {
                code: 0,
                data: {
                  note: {
                    note_id: "note-999"
                  }
                }
              }
            }
          }) as never
      }
    });

    const resultPromise = waitForSingleResult(handler);
    expect(handler.onBackgroundMessage(message)).toBe(true);
    const result = await resultPromise;
    const payload = (result.payload ?? {}) as Record<string, unknown>;
    const details = (payload.details ?? {}) as Record<string, unknown>;

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "ERR_EXECUTION_FAILED"
    });
    expect(details).toMatchObject({
      reason: "REQUEST_CONTEXT_INCOMPATIBLE",
      request_context_result: "request_context_incompatible",
      request_context_lookup_state: "incompatible",
      request_context_miss_reason: "shape_mismatch",
      captured_request_shape: {
        note_id: "note-999"
      }
    });
  });

	  it("configures active fallback provenance before consuming an already-stamped captured request context", async () => {
	    const callOrder: string[] = [];
    let configuredProvenance: Record<string, unknown> | null = null;
    const callSignature = vi.fn(async () => ({
      "X-s": "signature",
      "X-t": "timestamp"
    }));
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          note: {
            note_id: "abc123"
          }
        }
      }
    }));
    const { handler, message } = createMessage({
      command: "xhs.detail",
      abilityId: "xhs.note.detail.v1",
      targetPage: "explore_detail_tab",
      href: "https://www.xiaohongshu.com/explore/abc123",
	      options: {
	        simulate_result: null,
	        active_api_fetch_fallback: {
	          enabled: true,
	          account_safety_state: "clear",
	          rhythm_state: "allowed",
	          runtime_attestation: createActiveFallbackRuntimeAttestation()
	        }
	      },
	      fingerprintContext: createInstalledFingerprintContext(),
	      payload: {
	        note_id: "abc123"
	      },
      xhsEnvOverrides: {
        now: () => 1_710_000_100_000,
        configureCapturedRequestContextProvenance: async (input) => {
          callOrder.push("configure");
          configuredProvenance = input as unknown as Record<string, unknown>;
        },
        readCapturedRequestContext: async (input) => {
          callOrder.push("read");
          expect(configuredProvenance).toMatchObject({
            profile_ref: "xhs_001",
            session_id: "nm-session-001",
            target_tab_id: 32,
            run_id: "run-contract-001",
            action_ref: "read",
            page_url: "https://www.xiaohongshu.com/explore/abc123"
          });
          return {
            page_context_namespace: input.page_context_namespace,
            shape_key: input.shape_key,
            admitted_template: {
              route_evidence_class: "passive_api_capture",
              source_kind: "page_request",
              transport: "fetch",
              method: "POST",
              path: "/api/sns/web/v1/feed",
              url: "https://www.xiaohongshu.com/api/sns/web/v1/feed",
              status: 200,
              captured_at: 1_710_000_099_000,
              observed_at: 1_710_000_099_000,
              page_context_namespace: input.page_context_namespace,
              shape_key: input.shape_key,
              shape: {
                command: "xhs.detail",
                method: "POST",
                pathname: "/api/sns/web/v1/feed",
                note_id: "abc123"
              },
              profile_ref: "xhs_001",
              session_id: "nm-session-001",
              target_tab_id: 32,
              run_id: "run-contract-001",
              action_ref: "read",
              page_url: "https://www.xiaohongshu.com/explore/abc123",
              request: {
                headers: {
                  "X-S-Common": "{\"detailId\":\"captured-detail-id\"}"
                },
                body: {
                  source_note_id: "abc123"
                }
              },
              response: {
                headers: {},
                body: {
                  code: 0,
                  data: {
                    note: {
                      note_id: "abc123"
                    }
                  }
                }
              },
              referrer:
                "https://www.xiaohongshu.com/explore/abc123?xsec_token=token-abc123&xsec_source=pc_search"
            },
            rejected_observation: null,
            incompatible_observation: null,
            available_shape_keys: [input.shape_key]
          } as never;
        },
        callSignature,
        fetchJson
      }
    });

    const resultPromise = waitForSingleResult(handler);
    expect(handler.onBackgroundMessage(message)).toBe(true);
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(callOrder).toEqual(["configure", "read"]);
	    expect(callSignature).toHaveBeenCalled();
	    expect(fetchJson).toHaveBeenCalled();
	  });

	  it("blocks active fallback when browser surface is only caller self-attested on the extension path", async () => {
	    const callSignature = vi.fn(async () => ({
	      "X-s": "signature",
	      "X-t": "timestamp"
	    }));
	    const fetchJson = vi.fn(async () => ({
	      status: 200,
	      body: {
	        code: 0,
	        data: {
	          note: {
	            note_id: "abc123"
	          }
	        }
	      }
	    }));
	    const { handler, message } = createMessage({
	      command: "xhs.detail",
	      abilityId: "xhs.note.detail.v1",
	      targetPage: "explore_detail_tab",
	      href: "https://www.xiaohongshu.com/explore/abc123",
	      options: {
	        simulate_result: null,
	        active_api_fetch_fallback: {
	          enabled: true,
	          account_safety_state: "clear",
	          rhythm_state: "allowed",
	          fingerprint_validation_state: "ready",
	          execution_surface: "real_browser",
	          headless: false
	        }
	      },
	      payload: {
	        note_id: "abc123"
	      },
	      xhsEnvOverrides: {
	        now: () => 1_710_000_100_000,
	        readCapturedRequestContext: async (input) => ({
	          page_context_namespace: input.page_context_namespace,
	          shape_key: input.shape_key,
	          admitted_template: {
	            route_evidence_class: "passive_api_capture",
	            source_kind: "page_request",
	            transport: "fetch",
	            method: "POST",
	            path: "/api/sns/web/v1/feed",
	            url: "https://www.xiaohongshu.com/api/sns/web/v1/feed",
	            status: 200,
	            captured_at: 1_710_000_099_000,
	            observed_at: 1_710_000_099_000,
	            page_context_namespace: input.page_context_namespace,
	            shape_key: input.shape_key,
	            shape: {
	              command: "xhs.detail",
	              method: "POST",
	              pathname: "/api/sns/web/v1/feed",
	              note_id: "abc123"
	            },
	            profile_ref: "xhs_001",
	            session_id: "nm-session-001",
	            target_tab_id: 32,
	            run_id: "run-contract-001",
	            action_ref: "read",
	            page_url: "https://www.xiaohongshu.com/explore/abc123",
	            request: {
	              headers: {
	                "X-S-Common": "{\"detailId\":\"captured-detail-id\"}"
	              },
	              body: {
	                source_note_id: "abc123"
	              }
	            },
	            response: {
	              headers: {},
	              body: {
	                code: 0,
	                data: {
	                  note: {
	                    note_id: "abc123"
	                  }
	                }
	              }
	            },
	            referrer:
	              "https://www.xiaohongshu.com/explore/abc123?xsec_token=token-abc123&xsec_source=pc_search"
	          },
	          rejected_observation: null,
	          incompatible_observation: null,
	          available_shape_keys: [input.shape_key]
	        }) as never,
	        callSignature,
	        fetchJson
	      }
	    });

	    const resultPromise = waitForSingleResult(handler);
	    expect(handler.onBackgroundMessage(message)).toBe(true);
	    const result = await resultPromise;
	    const payload = (result.payload ?? {}) as Record<string, unknown>;
	    const details = (payload.details ?? {}) as Record<string, unknown>;
	    const activeGate = (details.active_api_fetch_fallback_gate ?? {}) as Record<string, unknown>;

	    expect(result.ok).toBe(false);
	    expect(result.error).toMatchObject({
	      code: "ERR_EXECUTION_FAILED"
	    });
	    expect(details).toMatchObject({
	      reason: "ACTIVE_API_FETCH_FALLBACK_GATE_BLOCKED"
	    });
	    expect(activeGate.reason_codes).toEqual(
	      expect.arrayContaining([
	        "FINGERPRINT_VALIDATION_NOT_READY",
	        "RUNTIME_ATTESTATION_REQUIRED",
	        "EXECUTION_SURFACE_NOT_REAL_BROWSER",
	        "HEADLESS_NOT_FALSE"
	      ])
	    );
	    expect(callSignature).not.toHaveBeenCalled();
	    expect(fetchJson).not.toHaveBeenCalled();
	  });

	  it("preserves page-state fallback diagnostics for xhs.user_home failures on the extension path", async () => {
    const { handler, message } = createMessage({
      command: "xhs.user_home",
      abilityId: "xhs.user.home.v1",
      targetPage: "profile_tab",
      href: "https://www.xiaohongshu.com/user/profile/user-001",
      options: {
        simulate_result: null
      },
      payload: {
        user_id: "user-001"
      },
      xhsEnvOverrides: {
        readCapturedRequestContext: async () => null,
        readPageStateRoot: async () => ({
          user: {
            userId: "user-001"
          },
          board: {},
          note: {}
        }),
        fetchJson: async () => ({ status: 200, body: { code: 0 } })
      }
    });

    const resultPromise = waitForSingleResult(handler);
    expect(handler.onBackgroundMessage(message)).toBe(true);
    const result = await resultPromise;
    const payload = (result.payload ?? {}) as Record<string, unknown>;
    const details = (payload.details ?? {}) as Record<string, unknown>;
    const observability = (payload.observability ?? {}) as Record<string, unknown>;

    expect(result.ok).toBe(false);
    expect(details).toMatchObject({
      reason: "REQUEST_CONTEXT_MISSING",
      request_context_result: "request_context_missing",
      request_context_lookup_state: "miss",
      request_context_miss_reason: "template_missing"
    });
    expect(observability).toMatchObject({
      page_state: {
        fallback_used: true
      },
      failure_site: {
        target: "captured_request_context"
      }
    });
    expect((observability.key_requests as unknown[] | undefined) ?? []).toEqual([
      expect.objectContaining({
        stage: "page_state_fallback",
        outcome: "completed",
        fallback_reason: "REQUEST_CONTEXT_MISSING"
      })
    ]);
  });
});
