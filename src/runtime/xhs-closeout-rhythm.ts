import type { JsonObject } from "../core/types.js";
import {
  normalizeAccountSafetyRecord,
  type AccountSafetyRecord
} from "./account-safety.js";

export type XhsCloseoutRhythmState =
  | "not_required"
  | "cooldown"
  | "operator_confirmation_required"
  | "single_probe_required"
  | "single_probe_passed";

export interface XhsCloseoutRhythmRecord {
  state: XhsCloseoutRhythmState;
  cooldownUntil: string | null;
  operatorConfirmedAt: string | null;
  singleProbeRequired: boolean;
  singleProbePassedAt: string | null;
  probeRunId: string | null;
  fullBundleBlocked: boolean;
  reasonCodes: string[];
}

const STATES: readonly XhsCloseoutRhythmState[] = [
  "not_required",
  "cooldown",
  "operator_confirmation_required",
  "single_probe_required",
  "single_probe_passed"
];

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isIsoTimestampOrNull = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value)));

const isStringOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const isState = (value: unknown): value is XhsCloseoutRhythmState =>
  typeof value === "string" && STATES.includes(value as XhsCloseoutRhythmState);

const uniqueReasons = (reasons: readonly string[]): string[] =>
  [...new Set(reasons.filter((reason) => reason.trim().length > 0))];

export const buildDefaultXhsCloseoutRhythmRecord = (): XhsCloseoutRhythmRecord => ({
  state: "not_required",
  cooldownUntil: null,
  operatorConfirmedAt: null,
  singleProbeRequired: false,
  singleProbePassedAt: null,
  probeRunId: null,
  fullBundleBlocked: false,
  reasonCodes: []
});

export const buildBlockedXhsCloseoutRhythmRecord = (input: {
  cooldownUntil: string | null;
  reasonCode?: string | null;
}): XhsCloseoutRhythmRecord => ({
  state: "cooldown",
  cooldownUntil: input.cooldownUntil,
  operatorConfirmedAt: null,
  singleProbeRequired: true,
  singleProbePassedAt: null,
  probeRunId: null,
  fullBundleBlocked: true,
  reasonCodes: uniqueReasons([
    "ACCOUNT_RISK_RECOVERY_REQUIRED",
    "XHS_CLOSEOUT_COOLDOWN_ACTIVE",
    input.reasonCode ?? ""
  ])
});

export const markXhsCloseoutOperatorConfirmed = (input: {
  current: XhsCloseoutRhythmRecord | undefined;
  confirmedAt: string;
}): XhsCloseoutRhythmRecord => ({
  ...normalizeXhsCloseoutRhythmRecord(input.current),
  state: "single_probe_required",
  operatorConfirmedAt: input.confirmedAt,
  singleProbeRequired: true,
  singleProbePassedAt: null,
  probeRunId: null,
  fullBundleBlocked: true,
  reasonCodes: uniqueReasons([
    ...normalizeXhsCloseoutRhythmRecord(input.current).reasonCodes,
    "XHS_RECOVERY_OPERATOR_CONFIRMED",
    "XHS_RECOVERY_SINGLE_PROBE_REQUIRED"
  ])
});

export const markXhsCloseoutSingleProbePassed = (input: {
  current: XhsCloseoutRhythmRecord | undefined;
  passedAt: string;
  probeRunId: string;
}): XhsCloseoutRhythmRecord => ({
  ...normalizeXhsCloseoutRhythmRecord(input.current),
  state: "single_probe_passed",
  singleProbeRequired: false,
  singleProbePassedAt: input.passedAt,
  probeRunId: input.probeRunId,
  fullBundleBlocked: true,
  reasonCodes: uniqueReasons(["XHS_RECOVERY_SINGLE_PROBE_PASSED", "ANTI_DETECTION_BASELINE_REQUIRED"])
});

export const claimXhsCloseoutSingleProbe = (input: {
  current: XhsCloseoutRhythmRecord | undefined;
  probeRunId: string;
}): XhsCloseoutRhythmRecord => ({
  ...normalizeXhsCloseoutRhythmRecord(input.current),
  state: "single_probe_required",
  singleProbeRequired: true,
  singleProbePassedAt: null,
  probeRunId: input.probeRunId,
  fullBundleBlocked: true,
  reasonCodes: uniqueReasons([
    ...normalizeXhsCloseoutRhythmRecord(input.current).reasonCodes,
    "XHS_RECOVERY_SINGLE_PROBE_CLAIMED"
  ])
});

export function assertXhsCloseoutRhythmRecordShape(value: unknown): asserts value is XhsCloseoutRhythmRecord {
  const record = isObjectRecord(value) ? value : null;
  if (!record) {
    throw new Error("Invalid profile meta structure: xhsCloseoutRhythm");
  }
  if (!isState(record.state)) {
    throw new Error("Invalid profile meta structure: xhsCloseoutRhythm.state");
  }
  if (
    !isIsoTimestampOrNull(record.cooldownUntil) ||
    !isIsoTimestampOrNull(record.operatorConfirmedAt) ||
    !isIsoTimestampOrNull(record.singleProbePassedAt)
  ) {
    throw new Error("Invalid profile meta structure: xhsCloseoutRhythm timestamps");
  }
  if (!isStringOrNull(record.probeRunId)) {
    throw new Error("Invalid profile meta structure: xhsCloseoutRhythm.probeRunId");
  }
  if (
    typeof record.singleProbeRequired !== "boolean" ||
    typeof record.fullBundleBlocked !== "boolean"
  ) {
    throw new Error("Invalid profile meta structure: xhsCloseoutRhythm booleans");
  }
  if (!Array.isArray(record.reasonCodes) || record.reasonCodes.some((item) => typeof item !== "string")) {
    throw new Error("Invalid profile meta structure: xhsCloseoutRhythm.reasonCodes");
  }
}

export const normalizeXhsCloseoutRhythmRecord = (value: unknown): XhsCloseoutRhythmRecord => {
  if (value === undefined || value === null) {
    return buildDefaultXhsCloseoutRhythmRecord();
  }
  assertXhsCloseoutRhythmRecordShape(value);
  return {
    ...(value as XhsCloseoutRhythmRecord),
    reasonCodes: uniqueReasons((value as XhsCloseoutRhythmRecord).reasonCodes)
  };
};

export const resolveXhsCloseoutRhythmRecord = (input: {
  rhythm?: XhsCloseoutRhythmRecord;
  accountSafety?: AccountSafetyRecord;
  now?: Date;
}): XhsCloseoutRhythmRecord => {
  const rhythm = normalizeXhsCloseoutRhythmRecord(input.rhythm);
  const accountSafety = normalizeAccountSafetyRecord(input.accountSafety);
  const nowMs = (input.now ?? new Date()).getTime();

  if (accountSafety.state === "account_risk_blocked") {
    const cooldownUntil = accountSafety.cooldownUntil ?? rhythm.cooldownUntil;
    const cooldownActive = cooldownUntil !== null && Date.parse(cooldownUntil) > nowMs;
    if (cooldownActive) {
      return {
        ...rhythm,
        state: "cooldown",
        cooldownUntil,
        singleProbeRequired: true,
        fullBundleBlocked: true,
        reasonCodes: uniqueReasons([
          ...rhythm.reasonCodes,
          "ACCOUNT_RISK_BLOCKED",
          "XHS_CLOSEOUT_COOLDOWN_ACTIVE"
        ])
      };
    }
    if (!rhythm.operatorConfirmedAt) {
      return {
        ...rhythm,
        state: "operator_confirmation_required",
        cooldownUntil,
        singleProbeRequired: true,
        fullBundleBlocked: true,
        reasonCodes: uniqueReasons([
          ...rhythm.reasonCodes,
          "ACCOUNT_RISK_BLOCKED",
          "XHS_RECOVERY_OPERATOR_CONFIRMATION_REQUIRED"
        ])
      };
    }
  }

  if (
    rhythm.state !== "not_required" &&
    rhythm.cooldownUntil !== null &&
    Date.parse(rhythm.cooldownUntil) > nowMs
  ) {
    return {
      ...rhythm,
      state: "cooldown",
      singleProbeRequired: true,
      fullBundleBlocked: true,
      reasonCodes: uniqueReasons([...rhythm.reasonCodes, "XHS_CLOSEOUT_COOLDOWN_ACTIVE"])
    };
  }

  if (rhythm.state === "cooldown") {
    const cooldownActive = rhythm.cooldownUntil !== null && Date.parse(rhythm.cooldownUntil) > nowMs;
    if (cooldownActive) {
      return {
        ...rhythm,
        singleProbeRequired: true,
        fullBundleBlocked: true,
        reasonCodes: uniqueReasons([...rhythm.reasonCodes, "XHS_CLOSEOUT_COOLDOWN_ACTIVE"])
      };
    }
    if (!rhythm.operatorConfirmedAt) {
      return {
        ...rhythm,
        state: "operator_confirmation_required",
        singleProbeRequired: true,
        fullBundleBlocked: true,
        reasonCodes: uniqueReasons([
          ...rhythm.reasonCodes,
          "XHS_RECOVERY_OPERATOR_CONFIRMATION_REQUIRED"
        ])
      };
    }
  }

  if (rhythm.operatorConfirmedAt && !rhythm.singleProbePassedAt) {
    return {
      ...rhythm,
      state: "single_probe_required",
      singleProbeRequired: true,
      fullBundleBlocked: true,
      reasonCodes: uniqueReasons([...rhythm.reasonCodes, "XHS_RECOVERY_SINGLE_PROBE_REQUIRED"])
    };
  }

  if (rhythm.singleProbePassedAt) {
    return {
      ...rhythm,
      state: "single_probe_passed",
      singleProbeRequired: false,
      fullBundleBlocked: true,
      reasonCodes: uniqueReasons([...rhythm.reasonCodes, "ANTI_DETECTION_BASELINE_REQUIRED"])
    };
  }

  return rhythm;
};

export const toXhsCloseoutRhythmStatus = (input: {
  rhythm?: XhsCloseoutRhythmRecord;
  accountSafety?: AccountSafetyRecord;
  now?: Date;
}): JsonObject => {
  const record = resolveXhsCloseoutRhythmRecord(input);
  return {
    state: record.state,
    cooldown_until: record.cooldownUntil,
    operator_confirmed_at: record.operatorConfirmedAt,
    single_probe_required: record.singleProbeRequired,
    single_probe_passed_at: record.singleProbePassedAt,
    probe_run_id: record.probeRunId,
    full_bundle_blocked: record.fullBundleBlocked,
    reason_codes: record.reasonCodes
  };
};

export const toSessionRhythmStatusView = (input: {
  rhythm?: XhsCloseoutRhythmRecord;
  accountSafety?: AccountSafetyRecord;
  now?: Date;
}): JsonObject => {
  const status = toXhsCloseoutRhythmStatus(input);
  return {
    source: "profile_meta",
    platform: "xhs",
    state: status.state,
    cooldown_until: status.cooldown_until,
    recovery: {
      operator_confirmed_at: status.operator_confirmed_at,
      single_probe_required: status.single_probe_required,
      single_probe_passed_at: status.single_probe_passed_at,
      probe_run_id: status.probe_run_id
    },
    full_bundle_blocked: status.full_bundle_blocked,
    reason_codes: status.reason_codes
  };
};
