const asRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;

const asString = (value) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const cloneIssue209AdmissionContext = (value) => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const approvalEvidence = asRecord(record.approval_admission_evidence);
  const auditEvidence = asRecord(record.audit_admission_evidence);

  return {
    ...(approvalEvidence ? { approval_admission_evidence: structuredClone(approvalEvidence) } : {}),
    ...(auditEvidence ? { audit_admission_evidence: structuredClone(auditEvidence) } : {})
  };
};

const normalizeIssue209AdmissionDraft = (value) => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const kind = asString(record.kind);
  if (kind === "missing") {
    return { kind };
  }

  if (kind !== "draft" && kind !== "explicit_context" && kind !== "derived_draft") {
    return null;
  }

  const admissionContext = cloneIssue209AdmissionContext(record.admission_context);
  if (!admissionContext) {
    return null;
  }

  return {
    kind: "draft",
    admission_context: admissionContext
  };
};

const createIssue209AdmissionDraft = (input) => {
  const explicitContext = cloneIssue209AdmissionContext(input?.admissionContext);
  if (explicitContext) {
    return {
      kind: "draft",
      admission_context: explicitContext
    };
  }

  return normalizeIssue209AdmissionDraft(input?.admissionDraft) ?? { kind: "missing" };
};

const bindAdmissionEvidenceToSession = (value, sessionId) => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    ...structuredClone(record),
    session_id: sessionId
  };
};

const bindIssue209AdmissionToSession = (input) => {
  const draft = createIssue209AdmissionDraft(input);
  if (draft.kind === "missing") {
    return null;
  }

  const admissionContext = cloneIssue209AdmissionContext(draft.admission_context);
  if (!admissionContext) {
    return null;
  }

  const sessionId = asString(input?.sessionId);
  if (!sessionId) {
    return admissionContext;
  }

  const approvalEvidence = bindAdmissionEvidenceToSession(
    admissionContext.approval_admission_evidence,
    sessionId
  );
  const auditEvidence = bindAdmissionEvidenceToSession(
    admissionContext.audit_admission_evidence,
    sessionId
  );

  return {
    ...(approvalEvidence ? { approval_admission_evidence: approvalEvidence } : {}),
    ...(auditEvidence ? { audit_admission_evidence: auditEvidence } : {})
  };
};

export {
  cloneIssue209AdmissionContext,
  createIssue209AdmissionDraft,
  bindIssue209AdmissionToSession
};
