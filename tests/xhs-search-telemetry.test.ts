import { describe, expect, it } from "vitest";
import { classifyPageKind, createObservability } from "../extension/xhs-search-telemetry.js";

describe("xhs-search telemetry helpers", () => {
  it("classifies page kinds from the current URL", () => {
    expect(classifyPageKind("https://www.xiaohongshu.com/login")).toBe("login");
    expect(classifyPageKind("https://creator.xiaohongshu.com/publish")).toBe("compose");
    expect(classifyPageKind("https://www.xiaohongshu.com/search_result")).toBe("search");
    expect(classifyPageKind("https://www.xiaohongshu.com/explore/123")).toBe("detail");
    expect(classifyPageKind("https://www.xiaohongshu.com/unknown")).toBe("unknown");
  });

  it("builds observability payloads for failure paths", () => {
    expect(
      createObservability({
        href: "https://www.xiaohongshu.com/search_result",
        title: "XHS",
        readyState: "complete",
        requestId: "req-1",
        outcome: "failed",
        failureReason: "SESSION_EXPIRED"
      })
    ).toMatchObject({
      page_state: {
        page_kind: "search",
        url: "https://www.xiaohongshu.com/search_result"
      },
      key_requests: [
        {
          request_id: "req-1",
          outcome: "failed",
          failure_reason: "SESSION_EXPIRED"
        }
      ]
    });
  });
});
