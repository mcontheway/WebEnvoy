import { describe, expect, it } from "vitest";
import {
  classifyPageKind,
  classifyXhsAccountSafetySurface,
  createObservability
} from "../extension/xhs-search-telemetry.js";

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

  it("does not classify ordinary content text as an account-risk page", () => {
    expect(
      classifyXhsAccountSafetySurface({
        href: "https://www.xiaohongshu.com/search_result?keyword=%E9%A3%8E%E9%99%A9",
        title: "小红书 - 搜索",
        bodyText: "这是一篇普通笔记，讨论露营投资风险和环境异常天气如何应对。"
      })
    ).toBeNull();
  });

  it("classifies high-confidence XHS account safety surfaces", () => {
    expect(
      classifyXhsAccountSafetySurface({
        href: "https://www.xiaohongshu.com/explore",
        title: "安全验证",
        bodyText: "安全验证后继续访问"
      })
    ).toMatchObject({
      reason: "XHS_ACCOUNT_RISK_PAGE"
    });
    expect(
      classifyXhsAccountSafetySurface({
        href: "https://www.xiaohongshu.com/explore",
        title: "小红书 - 登录",
        bodyText: "登录后推荐更懂你的笔记 扫码登录 输入手机号"
      })
    ).toMatchObject({
      reason: "XHS_LOGIN_REQUIRED"
    });
  });
});
