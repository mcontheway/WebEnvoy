import { describe, expect, it } from "vitest";

import { shapeErrorResponse, shapeSuccessResponse } from "../response-shaping.js";

describe("response-shaping", () => {
  it("adds observability to success payload without mutating input", () => {
    const base = {
      run_id: "run-1",
      command: "runtime.ping",
      status: "success" as const,
      summary: { message: "ok" },
      timestamp: "2026-03-19T12:00:00.000Z"
    };

    const shaped = shapeSuccessResponse(base, {
      page_state: {
        page_kind: "feed",
        url: "https://example.com/feed?token=abc",
        title: "Feed",
        ready_state: "complete"
      },
      key_requests: [],
      failure_site: null
    });

    expect(shaped).not.toBe(base);
    expect(base).not.toHaveProperty("observability");
    expect(shaped.observability.coverage).toBe("complete");
    expect(shaped.observability.request_evidence).toBe("none");
    expect(shaped.observability.page_state?.url).toBe("https://example.com/feed");
  });

  it("adds diagnosis to error payload and preserves core fields", () => {
    const base = {
      run_id: "run-2",
      command: "runtime.ping",
      status: "error" as const,
      error: {
        code: "ERR_EXECUTION_FAILED",
        message: "命令执行失败",
        retryable: false
      },
      timestamp: "2026-03-19T12:00:00.000Z"
    };

    const shaped = shapeErrorResponse(
      base,
      {
        page_state: {
          page_kind: "unknown",
          url: "https://example.com/path?code=secret",
          title: "Example",
          ready_state: "complete"
        },
        key_requests: [],
        failure_site: {
          stage: "request",
          component: "network",
          target: "/api/feed",
          summary: "request timeout"
        }
      },
      {
        signals: {
          request_failed: true
        },
        evidence: ["upstream timeout"]
      }
    );

    expect(shaped.error.code).toBe("ERR_EXECUTION_FAILED");
    expect(shaped.error.retryable).toBe(false);
    expect(shaped.error.diagnosis.category).toBe("request_failed");
    expect(shaped.observability.page_state?.url).toBe("https://example.com/path");
  });

  it("keeps runtime unavailable response observable without fabricating page state", () => {
    const base = {
      run_id: "run-3",
      command: "runtime.ping",
      status: "error" as const,
      error: {
        code: "ERR_RUNTIME_UNAVAILABLE",
        message: "运行时不可用",
        retryable: true
      },
      timestamp: "2026-03-19T12:00:00.000Z"
    };

    const shaped = shapeErrorResponse(
      base,
      {
        page_state: null,
        key_requests: null,
        failure_site: null
      },
      {
        signals: {
          runtime_unavailable: true
        },
        evidence: ["runtime bridge not ready"]
      }
    );

    expect(shaped.error.diagnosis.category).toBe("runtime_unavailable");
    expect(shaped.observability.coverage).toBe("unavailable");
    expect(shaped.observability.request_evidence).toBe("none");
    expect(shaped.observability.page_state).toBeNull();
    expect(shaped.observability.key_requests).toEqual([]);
  });

  it("keeps execution_interrupted distinct from runtime_unavailable in shaped errors", () => {
    const base = {
      run_id: "run-4",
      command: "runtime.ping",
      status: "error" as const,
      error: {
        code: "ERR_EXECUTION_FAILED",
        message: "执行链路中断",
        retryable: false
      },
      timestamp: "2026-03-19T12:00:00.000Z"
    };

    const shaped = shapeErrorResponse(
      base,
      {
        page_state: null,
        key_requests: [],
        failure_site: {
          stage: "transport",
          component: "bridge",
          target: "native-messaging",
          summary: "bridge disconnected"
        }
      },
      {
        signals: {
          runtime_unavailable: true,
          execution_interrupted: true
        }
      }
    );

    expect(shaped.error.diagnosis.category).toBe("execution_interrupted");
    expect(shaped.error.diagnosis.failure_site.stage).toBe("transport");
    expect(shaped.error.diagnosis.failure_site.component).toBe("bridge");
  });
});
