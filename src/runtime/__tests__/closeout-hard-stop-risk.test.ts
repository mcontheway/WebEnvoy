import { describe, expect, it } from "vitest";

import { classifyCloseoutHardStopRisk } from "../closeout-hard-stop-risk.js";

describe("closeout hard-stop risk classifier", () => {
  it.each([
    {
      name: "HTTP 461 account abnormal",
      input: {
        statusCode: 461,
        responseBody: {
          code: 300011,
          msg: "account abnormal"
        }
      },
      expected: {
        risk_class: "account_abnormal",
        reason: "ACCOUNT_ABNORMAL",
        source: "api_response"
      }
    },
    {
      name: "platform 300011 account abnormal",
      input: {
        responseBody: {
          code: "300011",
          msg: "Account abnormal. Switch account and retry."
        }
      },
      expected: {
        risk_class: "account_abnormal",
        reason: "ACCOUNT_ABNORMAL",
        source: "api_response"
      }
    },
    {
      name: "English account abnormal message without numeric code",
      input: {
        responseBody: {
          msg: "Account abnormal. Switch account and retry."
        }
      },
      expected: {
        risk_class: "account_abnormal",
        reason: "ACCOUNT_ABNORMAL",
        source: "api_response"
      }
    },
    {
      name: "response body 461 account abnormal",
      input: {
        responseBody: {
          code: "461",
          msg: "account abnormal"
        }
      },
      expected: {
        risk_class: "account_abnormal",
        reason: "ACCOUNT_ABNORMAL",
        source: "api_response"
      }
    },
    {
      name: "captcha challenge",
      input: {
        statusCode: 429,
        responseBody: {
          msg: "captcha required"
        }
      },
      expected: {
        risk_class: "captcha_required",
        reason: "CAPTCHA_REQUIRED",
        source: "api_response"
      }
    },
    {
      name: "plain HTTP 429 captcha challenge",
      input: {
        statusCode: 429
      },
      expected: {
        risk_class: "captcha_required",
        reason: "CAPTCHA_REQUIRED",
        source: "api_response"
      }
    },
    {
      name: "later key request captcha challenge",
      input: {
        statusCode: 500,
        apiResponses: [
          {
            statusCode: 500,
            fallbackMessage: "request_context_missing"
          },
          {
            statusCode: 429,
            fallbackMessage: "request_context_missing"
          }
        ]
      },
      expected: {
        risk_class: "captcha_required",
        reason: "CAPTCHA_REQUIRED",
        source: "api_response",
        evidence: {
          status_code: 429
        }
      }
    },
    {
      name: "later key request account abnormal platform code",
      input: {
        statusCode: 500,
        apiResponses: [
          {
            statusCode: 500,
            fallbackMessage: "request_context_missing"
          },
          {
            statusCode: 200,
            platformCode: 300011,
            fallbackMessage: "request_context_missing"
          }
        ]
      },
      expected: {
        risk_class: "account_abnormal",
        reason: "ACCOUNT_ABNORMAL",
        source: "api_response",
        evidence: {
          status_code: 200,
          platform_code: 300011
        }
      }
    },
    {
      name: "401 response with captcha challenge",
      input: {
        statusCode: 401,
        responseBody: {
          msg: "captcha required"
        }
      },
      expected: {
        risk_class: "captcha_required",
        reason: "CAPTCHA_REQUIRED",
        source: "api_response"
      }
    },
    {
      name: "login page",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/login",
          title: "小红书 - 登录"
        }
      },
      expected: {
        risk_class: "login_security_page",
        reason: "XHS_LOGIN_REQUIRED",
        source: "page_surface"
      }
    },
    {
      name: "title-only login page",
      input: {
        pageSurface: {
          title: "登录"
        }
      },
      expected: {
        risk_class: "login_security_page",
        reason: "XHS_LOGIN_REQUIRED",
        source: "page_surface"
      }
    },
    {
      name: "generic login api message",
      input: {
        responseBody: {
          msg: "login required"
        }
      },
      expected: {
        risk_class: "login_security_page",
        reason: "XHS_LOGIN_REQUIRED",
        source: "api_response"
      }
    },
    {
      name: "session expired API message without 401",
      input: {
        responseBody: {
          msg: "session expired"
        }
      },
      expected: {
        risk_class: "login_security_page",
        reason: "SESSION_EXPIRED",
        source: "api_response"
      }
    },
    {
      name: "Chinese session expired API message without 401",
      input: {
        responseBody: {
          msg: "登录失效，请重新登录"
        }
      },
      expected: {
        risk_class: "login_security_page",
        reason: "SESSION_EXPIRED",
        source: "api_response"
      }
    },
    {
      name: "English page-surface login wall",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "Login to view full content"
        }
      },
      expected: {
        risk_class: "login_security_page",
        reason: "XHS_LOGIN_REQUIRED",
        source: "page_surface"
      }
    },
    {
      name: "security page",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/security/verify",
          title: "安全验证"
        }
      },
      expected: {
        risk_class: "login_security_page",
        reason: "XHS_ACCOUNT_RISK_PAGE",
        source: "page_surface"
      }
    },
    {
      name: "security redirect page",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/security-redirect?target=/search_result"
        }
      },
      expected: {
        risk_class: "login_security_page",
        reason: "SECURITY_REDIRECT",
        source: "page_surface"
      }
    },
    {
      name: "security redirect API message",
      input: {
        responseBody: {
          msg: "SECURITY_REDIRECT"
        }
      },
      expected: {
        risk_class: "login_security_page",
        reason: "SECURITY_REDIRECT",
        source: "api_response"
      }
    },
    {
      name: "title-only security page",
      input: {
        pageSurface: {
          title: "安全验证"
        }
      },
      expected: {
        risk_class: "login_security_page",
        reason: "XHS_ACCOUNT_RISK_PAGE",
        source: "page_surface"
      }
    },
    {
      name: "generic modal captcha challenge",
      input: {
        pageSurface: {
          overlay: {
            selector: '[role="dialog"]',
            text: "请完成验证 拖动滑块"
          }
        }
      },
      expected: {
        risk_class: "captcha_required",
        reason: "CAPTCHA_REQUIRED",
        source: "page_surface"
      }
    },
    {
      name: "body-text security page",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "当前访问存在安全风险，请完成验证，验证后继续访问"
        }
      },
      expected: {
        risk_class: "login_security_page",
        reason: "XHS_ACCOUNT_RISK_PAGE",
        source: "page_surface"
      }
    },
    {
      name: "security route with body captcha challenge",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/security/verify",
          bodyText: "请完成验证 拖动滑块"
        }
      },
      expected: {
        risk_class: "captcha_required",
        reason: "CAPTCHA_REQUIRED",
        source: "page_surface"
      }
    },
    {
      name: "login route with body captcha challenge",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/login",
          bodyText: "请完成验证 拖动滑块"
        }
      },
      expected: {
        risk_class: "captcha_required",
        reason: "CAPTCHA_REQUIRED",
        source: "page_surface"
      }
    },
    {
      name: "English page-surface captcha challenge",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "Captcha required"
        }
      },
      expected: {
        risk_class: "captcha_required",
        reason: "CAPTCHA_REQUIRED",
        source: "page_surface"
      }
    },
    {
      name: "body-text security verification captcha prompt",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "请完成安全验证"
        }
      },
      expected: {
        risk_class: "captcha_required",
        reason: "CAPTCHA_REQUIRED",
        source: "page_surface"
      }
    },
    {
      name: "body-text verification code captcha prompt",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "请输入验证码"
        }
      },
      expected: {
        risk_class: "captcha_required",
        reason: "CAPTCHA_REQUIRED",
        source: "page_surface"
      }
    },
    {
      name: "long body-text security verification captcha prompt",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "为了保障账号安全，请完成安全验证后继续访问当前页面"
        }
      },
      expected: {
        risk_class: "captcha_required",
        reason: "CAPTCHA_REQUIRED",
        source: "page_surface"
      }
    },
    {
      name: "English page-surface security verification",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "Security verification required"
        }
      },
      expected: {
        risk_class: "login_security_page",
        reason: "XHS_ACCOUNT_RISK_PAGE",
        source: "page_surface"
      }
    },
    {
      name: "body-text slider verification variant",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "拖动滑块完成验证"
        }
      },
      expected: {
        risk_class: "captcha_required",
        reason: "CAPTCHA_REQUIRED",
        source: "page_surface"
      }
    },
    {
      name: "body-text login wall variant",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "登录后查看完整内容"
        }
      },
      expected: {
        risk_class: "login_security_page",
        reason: "XHS_LOGIN_REQUIRED",
        source: "page_surface"
      }
    },
    {
      name: "body-text account abnormal operation variant",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "账号存在异常操作"
        }
      },
      expected: {
        risk_class: "account_abnormal",
        reason: "ACCOUNT_ABNORMAL",
        source: "page_surface"
      }
    },
    {
      name: "body-text account abnormal with verification suffix",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "账号异常，请完成验证"
        }
      },
      expected: {
        risk_class: "account_abnormal",
        reason: "ACCOUNT_ABNORMAL",
        source: "page_surface"
      }
    },
    {
      name: "body-text browser environment with verification suffix",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "浏览器环境异常，请完成验证"
        }
      },
      expected: {
        risk_class: "browser_environment_abnormal",
        reason: "BROWSER_ENV_ABNORMAL",
        source: "page_surface"
      }
    },
    {
      name: "body-text browser environment with captcha wording",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "浏览器环境异常，请完成安全验证"
        }
      },
      expected: {
        risk_class: "browser_environment_abnormal",
        reason: "BROWSER_ENV_ABNORMAL",
        source: "page_surface"
      }
    },
    {
      name: "body-text browser environment page",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "浏览器环境异常，平台拒绝当前请求"
        }
      },
      expected: {
        risk_class: "browser_environment_abnormal",
        reason: "BROWSER_ENV_ABNORMAL",
        source: "page_surface"
      }
    },
    {
      name: "English body-text browser environment page",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "Browser environment abnormal"
        }
      },
      expected: {
        risk_class: "browser_environment_abnormal",
        reason: "BROWSER_ENV_ABNORMAL",
        source: "page_surface"
      }
    },
    {
      name: "canonical account abnormal body text",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "账号异常，平台拒绝当前请求"
        }
      },
      expected: {
        risk_class: "account_abnormal",
        reason: "ACCOUNT_ABNORMAL",
        source: "page_surface"
      }
    },
    {
      name: "short body-only account abnormal page",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "账号异常"
        }
      },
      expected: {
        risk_class: "account_abnormal",
        reason: "ACCOUNT_ABNORMAL",
        source: "page_surface"
      }
    },
    {
      name: "short body-only captcha prompt",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "请完成验证"
        }
      },
      expected: {
        risk_class: "captcha_required",
        reason: "CAPTCHA_REQUIRED",
        source: "page_surface"
      }
    },
    {
      name: "short body-only captcha token",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "验证码"
        }
      },
      expected: {
        risk_class: "captcha_required",
        reason: "CAPTCHA_REQUIRED",
        source: "page_surface"
      }
    },
    {
      name: "short body-only login prompt",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "请登录"
        }
      },
      expected: {
        risk_class: "login_security_page",
        reason: "XHS_LOGIN_REQUIRED",
        source: "page_surface"
      }
    },
    {
      name: "short body-only login-to-view prompt",
      input: {
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "登录后查看"
        }
      },
      expected: {
        risk_class: "login_security_page",
        reason: "XHS_LOGIN_REQUIRED",
        source: "page_surface"
      }
    },
    {
      name: "browser environment abnormal",
      input: {
        responseBody: {
          code: "300015",
          msg: "Browser environment abnormal"
        }
      },
      expected: {
        risk_class: "browser_environment_abnormal",
        reason: "BROWSER_ENV_ABNORMAL",
        source: "api_response"
      }
    },
    {
      name: "Chinese browser environment abnormal",
      input: {
        responseBody: {
          msg: "浏览器环境异常，平台拒绝当前请求"
        }
      },
      expected: {
        risk_class: "browser_environment_abnormal",
        reason: "BROWSER_ENV_ABNORMAL",
        source: "api_response"
      }
    }
  ])("classifies $name as hard stop", ({ input, expected }) => {
    expect(classifyCloseoutHardStopRisk(input)).toMatchObject({
      state: "hard_stop",
      hard_stop: true,
      should_block_route_action: true,
      ...expected
    });
  });

  it("uses specific overlay evidence and ignores body-only ordinary risk text", () => {
    expect(
      classifyCloseoutHardStopRisk({
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText:
            "当前访问存在安全风险、请完成安全验证、验证码、账号异常、浏览器环境异常，这些只是普通笔记正文。"
        }
      })
    ).toMatchObject({
      state: "clear",
      hard_stop: false
    });

    expect(
      classifyCloseoutHardStopRisk({
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "验证码和登录后查看都是这篇文章讨论的普通 UI 文案，这些只是普通笔记正文。"
        }
      })
    ).toMatchObject({
      state: "clear",
      hard_stop: false
    });

    expect(
      classifyCloseoutHardStopRisk({
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          overlay: {
            selector: ".captcha-container",
            text: "请完成验证 拖动滑块"
          }
        }
      })
    ).toMatchObject({
      state: "hard_stop",
      risk_class: "captcha_required",
      reason: "CAPTCHA_REQUIRED",
      source: "page_surface"
    });
  });

  it("keeps body-only captcha keywords clear without blocking-page wording", () => {
    expect(
      classifyCloseoutHardStopRisk({
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "这篇笔记提到了验证码、人机验证和滑块交互体验。"
        }
      })
    ).toMatchObject({
      state: "clear",
      hard_stop: false
    });
  });

  it("keeps ordinary body content clear even when it discusses hard-stop wording", () => {
    expect(
      classifyCloseoutHardStopRisk({
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText:
            "这篇笔记在讨论账号异常、验证码、浏览器环境异常和请完成安全验证这些提示的排查经验。"
        }
      })
    ).toMatchObject({
      state: "clear",
      hard_stop: false
    });
  });

  it("keeps ordinary English body prose clear even when it contains hard-stop wording", () => {
    for (const bodyText of [
      "Captcha required troubleshooting guide",
      "Browser environment abnormal troubleshooting",
      "Login required copy example",
      "Security verification required review",
      "This post discusses account abnormal responses and captcha prompts."
    ]) {
      expect(
        classifyCloseoutHardStopRisk({
          pageSurface: {
            url: "https://www.xiaohongshu.com/search_result",
            bodyText
          }
        })
      ).toMatchObject({
        state: "clear",
        hard_stop: false
      });
    }
  });

  it("does not classify ordinary content slugs as login or security routes", () => {
    for (const url of [
      "https://www.xiaohongshu.com/note/verify-this-idea",
      "https://www.xiaohongshu.com/article/security-camera-review",
      "https://www.xiaohongshu.com/topic/login-tips"
    ]) {
      expect(
        classifyCloseoutHardStopRisk({
          pageSurface: {
            url
          }
        })
      ).toMatchObject({
        state: "clear",
        hard_stop: false
      });
    }
  });

  it("keeps ordinary content titles clear when they mention hard-stop wording", () => {
    for (const title of [
      "账号异常处理经验分享",
      "浏览器环境异常解决教程",
      "Browser environment abnormal troubleshooting",
      "验证码话题讨论",
      "Security camera review"
    ]) {
      expect(
        classifyCloseoutHardStopRisk({
          pageSurface: {
            url: "https://www.xiaohongshu.com/search_result",
            title
          }
        })
      ).toMatchObject({
        state: "clear",
        hard_stop: false
      });
    }
  });

  it("keeps low-confidence login text clear without a login route or login wall controls", () => {
    expect(
      classifyCloseoutHardStopRisk({
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          title: "请登录相关话题"
        }
      })
    ).toMatchObject({
      state: "clear",
      hard_stop: false
    });
  });

  it("prefers specific overlay evidence over broad route prefixes", () => {
    expect(
      classifyCloseoutHardStopRisk({
        pageSurface: {
          url: "https://www.xiaohongshu.com/login",
          overlay: {
            selector: ".captcha-container",
            text: "请完成验证 拖动滑块"
          }
        }
      })
    ).toMatchObject({
      state: "hard_stop",
      risk_class: "captcha_required",
      reason: "CAPTCHA_REQUIRED",
      source: "page_surface"
    });
  });

  it("uses observability failure evidence when details are generic", () => {
    expect(
      classifyCloseoutHardStopRisk({
        reason: "REQUEST_CONTEXT_MISSING",
        observabilitySignals: ["ACCOUNT_ABNORMAL"]
      })
    ).toMatchObject({
      state: "hard_stop",
      risk_class: "account_abnormal",
      reason: "ACCOUNT_ABNORMAL",
      source: "observability"
    });

    expect(
      classifyCloseoutHardStopRisk({
        reason: "REQUEST_CONTEXT_MISSING",
        observabilitySignals: ["请完成验证 拖动滑块"]
      })
    ).toMatchObject({
      state: "hard_stop",
      risk_class: "captcha_required",
      reason: "CAPTCHA_REQUIRED",
      source: "observability",
      evidence: expect.objectContaining({
        message: "请完成验证 拖动滑块"
      })
    });
  });

  it("preserves session expired for English text evidence", () => {
    expect(
      classifyCloseoutHardStopRisk({
        reason: "REQUEST_CONTEXT_MISSING",
        observabilitySignals: ["session expired"]
      })
    ).toMatchObject({
      state: "hard_stop",
      risk_class: "login_security_page",
      reason: "SESSION_EXPIRED",
      source: "observability"
    });
  });

  it("uses the strongest observability failure signal instead of the first signal", () => {
    expect(
      classifyCloseoutHardStopRisk({
        reason: "REQUEST_CONTEXT_MISSING",
        observabilitySignals: ["SESSION_EXPIRED", "ACCOUNT_ABNORMAL"]
      })
    ).toMatchObject({
      state: "hard_stop",
      risk_class: "account_abnormal",
      reason: "ACCOUNT_ABNORMAL",
      source: "observability"
    });

    expect(
      classifyCloseoutHardStopRisk({
        reason: "REQUEST_CONTEXT_MISSING",
        observabilitySignals: ["CAPTCHA_REQUIRED", "ACCOUNT_ABNORMAL", "BROWSER_ENV_ABNORMAL"]
      })
    ).toMatchObject({
      state: "hard_stop",
      risk_class: "account_abnormal",
      reason: "ACCOUNT_ABNORMAL",
      source: "observability"
    });

    expect(
      classifyCloseoutHardStopRisk({
        reason: "REQUEST_CONTEXT_MISSING",
        observabilitySignals: ["BROWSER_ENV_ABNORMAL", "CAPTCHA_REQUIRED"]
      })
    ).toMatchObject({
      state: "hard_stop",
      risk_class: "captcha_required",
      reason: "CAPTCHA_REQUIRED",
      source: "observability"
    });
  });

  it("does not let observability override stronger page or API evidence", () => {
    expect(
      classifyCloseoutHardStopRisk({
        reason: "REQUEST_CONTEXT_MISSING",
        responseBody: {
          msg: "Account abnormal. Switch account and retry."
        },
        observabilitySignals: ["SESSION_EXPIRED"]
      })
    ).toMatchObject({
      state: "hard_stop",
      risk_class: "account_abnormal",
      reason: "ACCOUNT_ABNORMAL",
      source: "api_response"
    });

    expect(
      classifyCloseoutHardStopRisk({
        reason: "REQUEST_CONTEXT_MISSING",
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "Browser environment abnormal"
        },
        observabilitySignals: ["SESSION_EXPIRED"]
      })
    ).toMatchObject({
      state: "hard_stop",
      risk_class: "browser_environment_abnormal",
      reason: "BROWSER_ENV_ABNORMAL",
      source: "page_surface"
    });
  });

  it("lets stronger observability evidence override weaker page or API evidence", () => {
    expect(
      classifyCloseoutHardStopRisk({
        reason: "REQUEST_CONTEXT_MISSING",
        responseBody: {
          msg: "login required"
        },
        observabilitySignals: ["ACCOUNT_ABNORMAL"]
      })
    ).toMatchObject({
      state: "hard_stop",
      risk_class: "account_abnormal",
      reason: "ACCOUNT_ABNORMAL",
      source: "observability"
    });
  });

  it("prefers current hard-stop evidence over stale account safety fallback", () => {
    expect(
      classifyCloseoutHardStopRisk({
        statusCode: 429,
        accountSafety: {
          state: "account_risk_blocked",
          reason: "SESSION_EXPIRED"
        }
      })
    ).toMatchObject({
      state: "hard_stop",
      risk_class: "captcha_required",
      reason: "CAPTCHA_REQUIRED",
      source: "api_response"
    });
  });

  it("keeps fresh account safety in the priority matrix instead of treating it as stale fallback", () => {
    expect(
      classifyCloseoutHardStopRisk({
        reason: "SESSION_EXPIRED",
        accountSafety: {
          state: "account_risk_blocked",
          reason: "ACCOUNT_ABNORMAL"
        },
        accountSafetyFresh: true
      })
    ).toMatchObject({
      state: "hard_stop",
      risk_class: "account_abnormal",
      reason: "ACCOUNT_ABNORMAL",
      source: "account_safety"
    });
  });

  it("does not let weaker route failure override stronger page or API evidence", () => {
    expect(
      classifyCloseoutHardStopRisk({
        reason: "SESSION_EXPIRED",
        responseBody: {
          msg: "Account abnormal. Switch account and retry."
        }
      })
    ).toMatchObject({
      state: "hard_stop",
      risk_class: "account_abnormal",
      reason: "ACCOUNT_ABNORMAL",
      source: "api_response"
    });

    expect(
      classifyCloseoutHardStopRisk({
        reason: "SESSION_EXPIRED",
        pageSurface: {
          url: "https://www.xiaohongshu.com/search_result",
          bodyText: "浏览器环境异常，平台拒绝当前请求"
        }
      })
    ).toMatchObject({
      state: "hard_stop",
      risk_class: "browser_environment_abnormal",
      reason: "BROWSER_ENV_ABNORMAL",
      source: "page_surface"
    });
  });

  it("keeps non-risk request-context misses clear", () => {
    expect(
      classifyCloseoutHardStopRisk({
        reason: "REQUEST_CONTEXT_MISSING"
      })
    ).toMatchObject({
      state: "clear",
      hard_stop: false,
      should_block_route_action: false
    });
  });
});
