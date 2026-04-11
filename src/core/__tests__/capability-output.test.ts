import { describe, expect, it } from "vitest";

import { mapCapabilitySummaryForContract } from "../capability-output.js";

describe("mapCapabilitySummaryForContract", () => {
  const abilityId = "xhs.note.search.v1";
  const expectOutputMappingFailure = (callback: () => unknown, reason: string) => {
    try {
      callback();
      throw new Error("expected callback to throw");
    } catch (error) {
      expect(error).toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          ability_id: abilityId,
          stage: "output_mapping",
          reason
        }
      });
    }
  };

  it("keeps valid capability_result and preserves extra summary fields", () => {
    expect(
      mapCapabilitySummaryForContract(abilityId, {
        capability_result: {
          ability_id: abilityId,
          layer: "L3",
          action: "read",
          outcome: "success",
          data_ref: {
            search_id: "search-001"
          }
        },
        consumer_gate_result: {
          gate_decision: "allowed"
        }
      })
    ).toEqual({
      capability_result: {
        ability_id: abilityId,
        layer: "L3",
        action: "read",
        outcome: "success",
        data_ref: {
          search_id: "search-001"
        }
      },
      consumer_gate_result: {
        gate_decision: "allowed"
      }
    });
  });

  it("rejects summaries that omit capability_result", () => {
    expectOutputMappingFailure(() => mapCapabilitySummaryForContract(abilityId, {}), "CAPABILITY_RESULT_MISSING");
  });

  it("rejects non-object capability_result payloads", () => {
    expectOutputMappingFailure(
      () =>
        mapCapabilitySummaryForContract(abilityId, {
          capability_result: "invalid"
        }),
      "CAPABILITY_RESULT_INVALID"
    );
  });

  it("rejects capability_result objects missing required fields", () => {
    expectOutputMappingFailure(
      () =>
        mapCapabilitySummaryForContract(abilityId, {
          capability_result: {
            ability_id: abilityId,
            action: "read",
            outcome: "success"
          }
        }),
      "CAPABILITY_RESULT_LAYER_INVALID"
    );
  });

  it("rejects capability_result objects with invalid outcome", () => {
    expectOutputMappingFailure(
      () =>
        mapCapabilitySummaryForContract(abilityId, {
          capability_result: {
            ability_id: abilityId,
            layer: "L3",
            action: "read",
            outcome: "blocked"
          }
        }),
      "CAPABILITY_RESULT_OUTCOME_INVALID"
    );
  });
});
