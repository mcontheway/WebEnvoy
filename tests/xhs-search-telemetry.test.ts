import { describe, expect, it } from "vitest";
import {
  classifyPageKind,
  classifyXhsAccountSafetySurface,
  createObservability,
  inferFailure
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
        bodyText:
          "这是一篇普通笔记，讨论账号异常、安全验证、操作频繁、稍后再试和环境异常天气如何应对。"
      })
    ).toBeNull();
  });

  it("does not classify ordinary login wording as a login-required surface", () => {
    expect(
      classifyXhsAccountSafetySurface({
        href: "https://www.xiaohongshu.com/search_result?keyword=%E7%99%BB%E5%BD%95",
        title: "小红书 - 搜索",
        bodyText: "这是一篇普通教程笔记，登录后可以看到更多内容，输入手机号只是示例文案。"
      })
    ).toBeNull();
  });

  it("does not classify account-safety words from query parameters as risk URLs", () => {
    for (const href of [
      "https://www.xiaohongshu.com/search_result?redirect=%2Flogin",
      "https://www.xiaohongshu.com/explore/note-001?next=/security/verify",
      "https://www.xiaohongshu.com/explore/note-002?keyword=captcha",
      "https://www.xiaohongshu.com/explore/note-003#risk"
    ]) {
      expect(
        classifyXhsAccountSafetySurface({
          href,
          title: "小红书",
          bodyText: "普通页面"
        })
      ).toBeNull();
    }
  });

  it("does not classify title text alone as an account-safety surface", () => {
    for (const title of ["账号异常排查笔记", "安全验证体验记录", "访问异常问题复盘"]) {
      expect(
        classifyXhsAccountSafetySurface({
          href: "https://www.xiaohongshu.com/explore/note-title-text-001",
          title,
          bodyText: "普通笔记正文，没有平台拦截 UI。"
        })
      ).toBeNull();
    }
  });

  it("does not classify body-only risk phrases as an account-safety surface", () => {
    expect(
      classifyXhsAccountSafetySurface({
        href: "https://www.xiaohongshu.com/explore/note-body-risk-text-001",
        title: "普通笔记",
        bodyText:
          "当前访问存在安全风险、请完成安全验证、访问异常，请稍后重试、扫码登录、输入手机号、300011、300015、当前浏览器环境异常，这些只是笔记内容。"
      })
    ).toBeNull();
  });

  it("does not promote generic API environment warnings into account-risk fuse reasons", () => {
    expect(inferFailure(400, { msg: "操作频繁，请稍后再试" })).toMatchObject({
      reason: "TARGET_API_RESPONSE_INVALID"
    });
    expect(inferFailure(400, { msg: "环境异常，请稍后再试" })).toMatchObject({
      reason: "TARGET_API_RESPONSE_INVALID"
    });
  });

  it("normalizes string platform risk codes before classifying API failures", () => {
    expect(inferFailure(200, { code: "300011", msg: "account abnormal" })).toMatchObject({
      reason: "ACCOUNT_ABNORMAL"
    });
    expect(inferFailure(200, { code: "300015", msg: "browser environment abnormal" })).toMatchObject({
      reason: "BROWSER_ENV_ABNORMAL"
    });
  });

  it("classifies high-confidence XHS account safety surfaces", () => {
    expect(
      classifyXhsAccountSafetySurface({
        href: "https://www.xiaohongshu.com/security/verify",
        title: "安全验证",
        bodyText: "安全验证后继续访问"
      })
    ).toMatchObject({
      reason: "XHS_ACCOUNT_RISK_PAGE"
    });
    expect(
      classifyXhsAccountSafetySurface({
        href: "https://www.xiaohongshu.com/login",
        title: "小红书 - 登录",
        bodyText: "登录后推荐更懂你的笔记 扫码登录 输入手机号"
      })
    ).toMatchObject({
      reason: "XHS_LOGIN_REQUIRED"
    });
  });

  it("classifies high-confidence XHS overlays even when the page URL stays unchanged", () => {
    expect(
      classifyXhsAccountSafetySurface({
        href: "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
        title: "小红书 - 你的生活兴趣社区",
        bodyText: "登录后推荐更懂你的笔记 可用小红书或微信扫码 输入手机号 新用户可直接登录"
      })
    ).toBeNull();
    expect(
      classifyXhsAccountSafetySurface({
        href: "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
        title: "小红书 - 你的生活兴趣社区",
        overlay: {
          source: "dom_overlay",
          selector: '[role="dialog"]',
          text: "登录后推荐更懂你的笔记 可用小红书或微信扫码 输入手机号 新用户可直接登录"
        }
      })
    ).toBeNull();
    expect(
      classifyXhsAccountSafetySurface({
        href: "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
        title: "小红书 - 你的生活兴趣社区",
        bodyText: "普通页面",
        overlay: {
          source: "dom_overlay",
          selector: '.login-modal',
          text: "登录后推荐更懂你的笔记 可用小红书或微信扫码 输入手机号 新用户可直接登录"
        }
      })
    ).toMatchObject({
      reason: "XHS_LOGIN_REQUIRED"
    });
    expect(
      classifyXhsAccountSafetySurface({
        href: "https://www.xiaohongshu.com/explore/note-risk-overlay-001",
        title: "小红书",
        overlay: {
          source: "dom_overlay",
          selector: ".risk-modal",
          text: "当前访问存在安全风险 验证后继续访问"
        }
      })
    ).toMatchObject({
      reason: "XHS_ACCOUNT_RISK_PAGE"
    });
    expect(
      classifyXhsAccountSafetySurface({
        href: "https://www.xiaohongshu.com/explore/note-captcha-overlay-001",
        title: "小红书",
        overlay: {
          source: "dom_overlay",
          selector: ".captcha-container",
          text: "请完成验证 拖动滑块"
        }
      })
    ).toMatchObject({
      reason: "CAPTCHA_REQUIRED"
    });
    expect(
      classifyXhsAccountSafetySurface({
        href: "https://www.xiaohongshu.com/search_result",
        title: "小红书",
        overlay: {
          source: "dom_overlay",
          selector: ".risk-modal",
          text: "账号异常 平台拒绝当前请求"
        }
      })
    ).toMatchObject({
      reason: "ACCOUNT_ABNORMAL"
    });
    expect(
      classifyXhsAccountSafetySurface({
        href: "https://www.xiaohongshu.com/search_result",
        title: "小红书",
        overlay: {
          source: "dom_overlay",
          selector: ".risk-modal",
          text: "Browser environment abnormal"
        }
      })
    ).toMatchObject({
      reason: "BROWSER_ENV_ABNORMAL"
    });
  });
});
