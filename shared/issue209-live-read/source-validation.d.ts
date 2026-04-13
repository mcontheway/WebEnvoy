import type {
  Issue209CurrentRequestSource,
  Issue209ProvidedApprovalSource,
  Issue209ProvidedAuditSource,
  Issue209ApprovalChecks
} from "./source.js";

export interface Issue209ValidatedApprovalRecord {
  approval_id: string | null;
  decision_id: string | null;
  approved: boolean;
  approver: string | null;
  approved_at: string | null;
  checks: Issue209ApprovalChecks;
}

export interface Issue209ValidatedAuditRecord {
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

export interface ValidateIssue209ApprovalSourceAgainstCurrentLinkageInput {
  current: Pick<Issue209CurrentRequestSource, "decisionId" | "approvalId">;
  approvalSource?: unknown;
  approvalRecord?: unknown;
}

export interface ValidateIssue209AuditSourceAgainstCurrentLinkageInput {
  current: Pick<
    Issue209CurrentRequestSource,
    | "commandRequestId"
    | "runId"
    | "issueScope"
    | "targetDomain"
    | "targetTabId"
    | "targetPage"
    | "actionType"
    | "requestedExecutionMode"
    | "riskState"
    | "decisionId"
    | "approvalId"
  >;
  auditSource?: unknown;
  auditRecord?: unknown;
  requestIdWasExplicit?: boolean;
}

export interface ValidateIssue209ApprovalSourceAgainstCurrentLinkageResult {
  approvalSource: Issue209ProvidedApprovalSource;
  approvalRecord: Issue209ValidatedApprovalRecord;
  approvalRequirementGaps: string[];
  isValid: boolean;
}

export interface ValidateIssue209AuditSourceAgainstCurrentLinkageResult {
  auditSource: Issue209ProvidedAuditSource;
  auditRecord: Issue209ValidatedAuditRecord;
  auditRequirementGaps: string[];
  isValid: boolean;
}

export declare const validateIssue209ApprovalSourceAgainstCurrentLinkage: (
  input: ValidateIssue209ApprovalSourceAgainstCurrentLinkageInput
) => ValidateIssue209ApprovalSourceAgainstCurrentLinkageResult;

export declare const validateIssue209AuditSourceAgainstCurrentLinkage: (
  input: ValidateIssue209AuditSourceAgainstCurrentLinkageInput
) => ValidateIssue209AuditSourceAgainstCurrentLinkageResult;
