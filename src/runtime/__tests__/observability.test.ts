import { describe, expect, it } from "vitest";

import {
  buildObservabilityPayload,
  normalizeKeyRequests,
  normalizePageState
} from "../observability.js";

describe("observability", () => {
  it("normalizes page state and strips query/fragment from page url", () => {
    const pageState = normalizePageState({
      page_kind: "feed",
      url: "https://example.com/feed?token=secret#section-1",
      title: "Example Feed",
      ready_state: "complete"
    });

    expect(pageState).toMatchObject({
      page_kind: "feed",
      url: "https://example.com/feed",
      title: "Example Feed",
      ready_state: "complete"
    });
  });

  it("normalizes key requests and keeps only bounded records", () => {
    const keyRequests = normalizeKeyRequests(
      [
        {
          request_id: "req-1",
          stage: "request",
          method: "GET",
          url: "/api/feed?token=abc",
          outcome: "completed",
          status_code: 200
        },
        {
          request_id: "req-2",
          stage: "request",
          method: "POST",
          url: "https://example.com/api/action?signature=secret",
          outcome: "failed",
          failure_reason: "timeout"
        }
      ],
      { maxRequests: 1 }
    );

    expect(keyRequests).toHaveLength(1);
    expect(keyRequests[0]).toMatchObject({
      request_id: "req-1",
      url: "/api/feed",
      method: "GET",
      outcome: "completed",
      status_code: 200
    });
  });

  it("builds bounded observability payload", () => {
    const payload = buildObservabilityPayload(
      {
        page_state: {
          page_kind: "detail",
          url: "https://example.com/post/1?code=secret#hash",
          title: "A".repeat(120),
          ready_state: "interactive"
        },
        key_requests: [
          {
            request_id: "req-1",
            stage: "request",
            method: "GET",
            url: "https://example.com/api/feed?token=abc",
            outcome: "failed",
            failure_reason: "request timeout because upstream overloaded"
          },
          {
            request_id: "req-2",
            stage: "request",
            method: "POST",
            url: "https://example.com/api/feed?token=abc",
            outcome: "completed"
          }
        ],
        failure_site: {
          stage: "request",
          component: "network",
          target: "/api/feed",
          summary: "x".repeat(200)
        }
      },
      {
        maxRequests: 1,
        maxTitleLength: 32,
        maxFailureSummaryLength: 64,
        maxRequestReasonLength: 12
      }
    );

    expect(payload.coverage).toBe("complete");
    expect(payload.request_evidence).toBe("available");
    expect(payload.page_state).not.toBeNull();
    expect(payload.page_state?.title).toHaveLength(32);
    expect(payload.page_state?.title_truncated).toBe(true);
    expect(payload.page_state?.url).toBe("https://example.com/post/1");
    expect(payload.key_requests).toHaveLength(1);
    expect(payload.key_requests[0].url).toBe("https://example.com/api/feed");
    expect(payload.key_requests[0].failure_reason).toHaveLength(12);
    expect(payload.key_requests[0].failure_reason_truncated).toBe(true);
    expect(payload.failure_site?.summary).toHaveLength(64);
    expect(payload.failure_site?.summary_truncated).toBe(true);
    expect(payload.truncation).toEqual({
      truncated: true,
      fields: [
        "key_requests",
        "key_requests[].failure_reason",
        "page_state.title",
        "failure_site.summary"
      ]
    });
  });

  it("does not fabricate page state when no observability source exists", () => {
    const payload = buildObservabilityPayload({
      page_state: null,
      key_requests: null,
      failure_site: null
    });

    expect(payload.coverage).toBe("unavailable");
    expect(payload.request_evidence).toBe("none");
    expect(payload.page_state).toBeNull();
    expect(payload.key_requests).toEqual([]);
    expect(payload.truncation).toEqual({
      truncated: false,
      fields: []
    });
  });

  it("marks page state as partial when required page signals are missing", () => {
    const payload = buildObservabilityPayload({
      page_state: {
        page_kind: "feed",
        url: "https://example.com/feed",
        title: "Feed"
      },
      key_requests: [],
      failure_site: null
    });

    expect(payload.coverage).toBe("partial");
    expect(payload.page_state?.partial_observable).toBe(true);
    expect(payload.request_evidence).toBe("none");
  });

  it("sanitizes and bounds failure site target", () => {
    const payload = buildObservabilityPayload(
      {
        page_state: null,
        key_requests: [],
        failure_site: {
          stage: "request",
          component: "network",
          target: "https://example.com/api/feed?token=raw-token&signature=deadbeef#frag",
          summary: "request failed"
        }
      },
      {
        maxFailureTargetLength: 24
      }
    );

    expect(payload.failure_site).not.toBeNull();
    expect(payload.failure_site?.target).toBe("https://example.com/api/");
    expect(payload.failure_site?.target).not.toContain("?");
    expect(payload.failure_site?.target).not.toContain("signature");
    expect(payload.failure_site?.target_truncated).toBe(true);
    expect(payload.truncation.truncated).toBe(true);
    expect(payload.truncation.fields).toContain("failure_site.target");
  });
});
