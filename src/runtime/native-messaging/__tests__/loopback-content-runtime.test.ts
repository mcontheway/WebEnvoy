import { describe, expect, it } from "vitest";

import type { ContentMessage } from "../loopback-messages.js";
import { createPortPair } from "../loopback-port.js";
import { InMemoryContentScriptRuntime } from "../loopback-content-runtime.js";

describe("native messaging loopback content runtime", () => {
  it("acks runtime.bootstrap after the attestation delay", async () => {
    const [left, right] = createPortPair<ContentMessage>();

    new InMemoryContentScriptRuntime(right);

    const first = new Promise<Record<string, unknown>>((resolve) => {
      const off = left.onMessage((message) => {
        if (message.kind === "result") {
          off();
          resolve(message as Record<string, unknown>);
        }
      });
    });

    left.postMessage({
      kind: "forward",
      id: "bootstrap-001",
      command: "runtime.bootstrap",
      runId: "run-001",
      sessionId: "session-001",
      commandParams: {
        version: "v1",
        run_id: "run-001",
        runtime_context_id: "runtime-001",
        profile: "profile-a",
        fingerprint_runtime: {},
        fingerprint_patch_manifest: {},
        main_world_secret: "secret-001"
      }
    });

    const bootstrap = await first;
    expect(bootstrap).toMatchObject({
      ok: false,
      error: {
        code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED"
      }
    });
  });

  it("rejects xhs.detail with missing note_id instead of emitting an empty data_ref", async () => {
    const [left, right] = createPortPair<ContentMessage>();

    new InMemoryContentScriptRuntime(right);

    const resultPromise = new Promise<Record<string, unknown>>((resolve) => {
      const off = left.onMessage((message) => {
        if (message.kind === "result") {
          off();
          resolve(message as Record<string, unknown>);
        }
      });
    });

    left.postMessage({
      kind: "forward",
      id: "xhs-detail-missing-note-001",
      command: "xhs.detail",
      runId: "run-001",
      sessionId: "session-001",
      commandParams: {
        ability: {
          id: "xhs.note.detail.v1",
          layer: "L3",
          action: "read"
        },
        input: {},
        options: {
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 11,
          target_page: "explore_detail_tab",
          action_type: "read",
          requested_execution_mode: "dry_run",
          risk_state: "paused"
        }
      }
    });

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
});
