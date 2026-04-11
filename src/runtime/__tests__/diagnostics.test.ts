import { describe, expect, it } from "vitest";

import { buildDiagnosis, createMinimalDiagnosis } from "../diagnostics.js";

describe("diagnostics", () => {
  it("classifies runtime unavailable from signals", () => {
    const diagnosis = buildDiagnosis({
      signals: {
        runtime_unavailable: true,
        request_failed: true
      },
      failure_site: {
        stage: "runtime",
        component: "cli",
        target: "native-messaging",
        summary: "host unavailable"
      },
      evidence: ["runtime bootstrap failed"]
    });

    expect(diagnosis.category).toBe("runtime_unavailable");
    expect(diagnosis.stage).toBe("runtime");
    expect(diagnosis.component).toBe("cli");
  });

  it("classifies transport/bridge failures as execution interrupted", () => {
    const diagnosis = buildDiagnosis({
      signals: {
        runtime_unavailable: true,
        execution_interrupted: true
      },
      failure_site: {
        stage: "transport",
        component: "bridge",
        target: "native-messaging",
        summary: "bridge disconnected during run"
      }
    });

    expect(diagnosis.category).toBe("execution_interrupted");
    expect(diagnosis.stage).toBe("transport");
    expect(diagnosis.component).toBe("bridge");
  });

  it("uses explicit category and bounds evidence payload", () => {
    const diagnosis = buildDiagnosis(
      {
        category: "page_changed",
        failure_site: {
          stage: "action",
          component: "page",
          target: "selector:#publish",
          summary: "selector missing"
        },
        evidence: [
          "  expected selector missing  ",
          "x".repeat(200),
          "",
          "layout shifted",
          "ignored"
        ]
      },
      {
        maxEvidenceItems: 3,
        maxEvidenceLength: 40
      }
    );

    expect(diagnosis.category).toBe("page_changed");
    expect(diagnosis.evidence).toHaveLength(3);
    expect(diagnosis.evidence[0]).toBe("expected selector missing");
    expect(diagnosis.evidence[1]).toHaveLength(40);
  });

  it("redacts sensitive evidence fragments before returning payload", () => {
    const diagnosis = buildDiagnosis(
      {
        category: "request_failed",
        failure_site: {
          stage: "request",
          component: "network",
          target: "/api/feed",
          summary: "request failed"
        },
        evidence: [
          "Authorization: Bearer top-secret-token",
          "Cookie: sid=abc123; token=raw-token",
          "GET /api/feed?token=raw&signature=abc123",
          "signature=deadbeef auth: raw-auth-value"
        ]
      },
      {
        maxEvidenceItems: 4,
        maxEvidenceLength: 200
      }
    );

    expect(diagnosis.evidence[0]).toBe("authorization: [REDACTED]");
    expect(diagnosis.evidence[1]).toContain("cookie: [REDACTED]");
    expect(diagnosis.evidence[2]).toContain("?token=[REDACTED]&signature=[REDACTED]");
    expect(diagnosis.evidence[3]).toContain("signature=[REDACTED]");
    expect(diagnosis.evidence[3]).toContain("auth: [REDACTED]");
  });

  it("prefers failure site over generic signal priority when determining root category", () => {
    const diagnosis = buildDiagnosis({
      signals: {
        runtime_unavailable: true,
        request_failed: true
      },
      failure_site: {
        stage: "request",
        component: "network",
        target: "/api/feed",
        summary: "upstream timeout"
      }
    });

    expect(diagnosis.category).toBe("request_failed");
    expect(diagnosis.failure_site.component).toBe("network");
  });

  it("preserves explicit failure_site truncation markers from shaped input", () => {
    const diagnosis = buildDiagnosis({
      failure_site: {
        stage: "request",
        component: "network",
        target: "/api/feed",
        summary: "already clipped upstream",
        summary_truncated: true
      }
    });

    expect(diagnosis.failure_site.summary).toBe("already clipped upstream");
    expect(diagnosis.failure_site.summary_truncated).toBe(true);
  });

  it("prefers execution_interrupted signal over runtime_unavailable when no failure site is available", () => {
    const diagnosis = buildDiagnosis({
      signals: {
        runtime_unavailable: true,
        execution_interrupted: true
      }
    });

    expect(diagnosis.category).toBe("execution_interrupted");
  });

  it("creates minimal unknown diagnosis when no signal is available", () => {
    const diagnosis = createMinimalDiagnosis();

    expect(diagnosis).toMatchObject({
      category: "unknown",
      stage: "unknown",
      component: "unknown",
      failure_site: {
        stage: "unknown",
        component: "unknown",
        target: "unknown",
        summary: "diagnosis unavailable"
      }
    });
  });
});
