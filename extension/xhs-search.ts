import {
  executeXhsSearch as executeXhsSearchImpl
} from "./xhs-search-execution.js";

export type {
  ActionType,
  ConsumerGateResult,
  EffectiveExecutionMode,
  FetchResult,
  GateInputRecord,
  GateOutcomeRecord,
  JsonRecord,
  RequestExecutionAudit,
  RequestedExecutionMode,
  ScopeContextRecord,
  SearchExecutionFailure,
  SearchExecutionResult,
  SearchExecutionSuccess,
  SignatureResult,
  XhsAccountSafetyOverlay,
  XhsExecutionAuditRecord,
  XhsExecutionContext,
  XhsSearchEnvironment,
  XhsSearchGate,
  XhsSearchOptions,
  XhsSearchParams
} from "./xhs-search-types.js";

export function executeXhsSearch(...args: Parameters<typeof executeXhsSearchImpl>) {
  return executeXhsSearchImpl(...args);
}
