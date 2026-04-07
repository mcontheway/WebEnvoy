import type { LoopbackGate } from "./loopback-gate.js";

export type LoopbackObservabilitySource = Pick<
  LoopbackGate,
  "gateInput" | "consumerGateResult"
>;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

export const buildLoopbackGateObservability = (
  gate: LoopbackObservabilitySource
): Record<string, unknown> => {
  const targetPage = asString(gate.gateInput.target_page);
  const targetDomain = asString(gate.gateInput.target_domain);

  return {
    page_state:
      targetPage && targetDomain
        ? {
            page_kind: targetPage === "creator_publish_tab" ? "compose" : targetPage,
            url:
              targetPage === "creator_publish_tab"
                ? `https://${targetDomain}/publish/publish`
                : targetPage === "search_result_tab"
                ? `https://${targetDomain}/search_result`
                : `https://${targetDomain}/`,
            title: targetPage === "creator_publish_tab" ? "Creator Publish" : "Search Result",
            ready_state: "complete",
            observation_status: "complete"
          }
        : null,
    key_requests: [],
    failure_site:
      gate.consumerGateResult.gate_decision === "blocked"
        ? {
            stage: "execution",
            component: "gate",
            target: targetPage ?? targetDomain ?? "issue_208_gate_only",
            summary:
              Array.isArray(gate.consumerGateResult.gate_reasons) &&
              typeof gate.consumerGateResult.gate_reasons[0] === "string"
                ? gate.consumerGateResult.gate_reasons[0]
                : "gate blocked"
          }
        : null
  };
};
