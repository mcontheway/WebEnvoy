# FR-0030 契约：XHS Closeout Route Evidence

## Route Evidence Class

```ts
type XhsCloseoutRouteEvidenceClassV1 =
  | "humanized_action"
  | "passive_api_capture"
  | "dom_state_extraction"
  | "active_api_fetch_fallback";
```

约束：

- `passive_api_capture` 只表示当前页面自然请求/响应，不包含 WebEnvoy 主动 fetch replay。
- `dom_state_extraction` 只表示从当前页面可见或已加载状态中读到的数据。
- `active_api_fetch_fallback` 必须由独立 gate 放行，不能被 `passive_api_capture` 或 `dom_state_extraction` 代替。

## DOM/state extraction

```ts
type XhsDomStateExtractionLayerV1 =
  | "hydration_state"
  | "script_json"
  | "dom_selector";

type XhsRiskSurfaceClassificationV1 =
  | "none"
  | "XHS_LOGIN_REQUIRED"
  | "CAPTCHA_REQUIRED"
  | "XHS_ACCOUNT_RISK_PAGE"
  | "ACCOUNT_ABNORMAL"
  | "BROWSER_ENV_ABNORMAL"
  | "SECURITY_REDIRECT";

type XhsTargetContinuityV1 = {
  target_url: string | null;
  detail_url?: string | null;
  user_home_url?: string | null;
  xsec_token: string | null;
  xsec_source: string | null;
  token_presence: "present" | "missing" | "empty" | "not_applicable";
  source_route:
    | "xhs.search"
    | "xhs.detail"
    | "xhs.user_home"
    | "unknown";
};

type XhsDomStateExtractionEvidenceV1 = {
  evidence_class: "dom_state_extraction";
  profile_ref: string;
  target_tab_id: number;
  page_url: string;
  run_id: string;
  action_ref: string;
  extraction_layer: XhsDomStateExtractionLayerV1;
  extraction_locator: string;
  extracted_at: string;
  target_continuity: XhsTargetContinuityV1[];
  risk_surface_classification: XhsRiskSurfaceClassificationV1;
};
```

约束：

- `extracted_at` 必须是 ISO-8601 字符串。
- `target_continuity` 可以为空数组，但不得省略。
- `risk_surface_classification !== "none"` 时，该 evidence 不得作为成功 extraction evidence 使用。
- `token_presence="present"` 时，`xsec_token` 必须为 trim 后非空字符串。
- `token_presence="missing" | "empty"` 时，后续 detail/user_home route 不得把裸 id 静默升级为 live fetch target。

## Search card evidence

```ts
type XhsSearchCardDomEvidenceV1 = XhsDomStateExtractionEvidenceV1 & {
  item_kind: "search_card";
  cards: Array<{
    title: string | null;
    detail_url: string | null;
    user_home_url: string | null;
    xsec_token: string | null;
    xsec_source: string | null;
  }>;
};
```

约束：

- `cards` 为空时不得申报 route evidence success。
- 若页面提供 signed URL 或 token，必须保留到 `detail_url` / `user_home_url` / `xsec_token` / `xsec_source`。
- 搜索卡片 evidence 只能证明 search route 的 passive/DOM fallback 成功，不能证明 detail/user_home continuity 已满足。

## Failure separation

```ts
type XhsRouteEvidenceFailureReasonV1 =
  | "ROUTE_EVIDENCE_MISSING"
  | "DOM_EXTRACTION_MISSING"
  | "PASSIVE_CAPTURE_MISSING"
  | "XHS_LOGIN_REQUIRED"
  | "CAPTCHA_REQUIRED"
  | "XHS_ACCOUNT_RISK_PAGE"
  | "ACCOUNT_ABNORMAL"
  | "BROWSER_ENV_ABNORMAL"
  | "SECURITY_REDIRECT";
```

约束：

- risk/safety reasons 不得降级为 missing evidence。
- `ACCOUNT_ABNORMAL`、`XHS_ACCOUNT_RISK_PAGE`、`CAPTCHA_REQUIRED`、`BROWSER_ENV_ABNORMAL` 必须阻断后续 live probe。
