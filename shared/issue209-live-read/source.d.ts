import type {
  ApprovalCheckKey,
  ExecutionMode,
  RiskState
} from "../risk-state.js";
import type {
  XhsAdmissionContext
} from "../xhs-gate.js";

export type Issue209ApprovalChecks = Record<ApprovalCheckKey, boolean>;

export interface Issue209CurrentRequestSource {
  commandRequestId: string | null;
  gateInvocationId: string | null;
  runId: string | null;
  issueScope: "issue_209";
  targetDomain: string | null;
  targetTabId: number | null;
  targetPage: string | null;
  actionType: string | null;
  requestedExecutionMode: ExecutionMode | null;
  riskState: RiskState | null;
  decisionId: string;
  approvalId: string;
}

export interface Issue209ApprovalAdmissionSource {
  approval_admission_ref: string | null;
  decision_id: string | null;
  approval_id: string | null;
  request_id: string | null;
  run_id: string | null;
  session_id: string | null;
  issue_scope: string | null;
  target_domain: string | null;
  target_tab_id: number | null;
  target_page: string | null;
  action_type: string | null;
  requested_execution_mode: string | null;
  approved: boolean;
  approver: string | null;
  approved_at: string | null;
  checks: Issue209ApprovalChecks;
  recorded_at: string | null;
}

export interface Issue209AuditAdmissionSource {
  audit_admission_ref: string | null;
  decision_id: string | null;
  approval_id: string | null;
  request_id: string | null;
  run_id: string | null;
  session_id: string | null;
  issue_scope: string | null;
  target_domain: string | null;
  target_tab_id: number | null;
  target_page: string | null;
  action_type: string | null;
  requested_execution_mode: string | null;
  risk_state: string | null;
  audited_checks: Issue209ApprovalChecks;
  recorded_at: string | null;
}

export interface Issue209ProvidedApprovalSource {
  decision_id: string | null;
  approval_id: string | null;
  approved: boolean;
  approver: string | null;
  approved_at: string | null;
  checks: Issue209ApprovalChecks;
}

export interface Issue209ProvidedAuditSource {
  event_id: string | null;
  decision_id: string | null;
  approval_id: string | null;
  request_id: string | null;
  issue_scope: string | null;
  target_domain: string | null;
  target_tab_id: number | null;
  target_page: string | null;
  action_type: string | null;
  requested_execution_mode: string | null;
  risk_state: string | null;
  gate_decision: string | null;
  audited_checks: Issue209ApprovalChecks;
  recorded_at: string | null;
}

export interface PrepareIssue209LiveReadSourceInput {
  commandRequestId?: unknown;
  gateInvocationId?: unknown;
  runId?: unknown;
  targetDomain?: unknown;
  targetTabId?: unknown;
  targetPage?: unknown;
  actionType?: unknown;
  requestedExecutionMode?: unknown;
  riskState?: unknown;
  admissionContext?: unknown;
  approvalRecord?: unknown;
  auditRecord?: unknown;
}

export interface Issue209LiveReadSource {
  current: Issue209CurrentRequestSource;
  explicitAdmissionContext: XhsAdmissionContext | null;
  explicitApprovalEvidence: Issue209ApprovalAdmissionSource;
  explicitAuditEvidence: Issue209AuditAdmissionSource;
  approvalSource: Issue209ProvidedApprovalSource;
  auditSource: Issue209ProvidedAuditSource;
}

export declare const APPROVAL_CHECK_KEYS: readonly ApprovalCheckKey[];
export declare const cloneIssue209AdmissionContext: (
  value: unknown
) => XhsAdmissionContext | null;
export declare const normalizeApprovalAdmissionEvidence: (
  value: unknown
) => Issue209ApprovalAdmissionSource;
export declare const normalizeAuditAdmissionEvidence: (
  value: unknown
) => Issue209AuditAdmissionSource;
export declare const normalizeProvidedApprovalSource: (
  value: unknown
) => Issue209ProvidedApprovalSource;
export declare const normalizeProvidedAuditSource: (
  value: unknown
) => Issue209ProvidedAuditSource;
export declare const prepareIssue209LiveReadSource: (
  input: PrepareIssue209LiveReadSourceInput
) => Issue209LiveReadSource;
