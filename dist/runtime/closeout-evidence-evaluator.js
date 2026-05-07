const normalizeString = (value) => {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};
const matchesExpectedString = (expected, observed) => {
    const normalizedExpected = normalizeString(expected);
    const normalizedObserved = normalizeString(observed);
    return normalizedExpected !== null && normalizedObserved !== null && normalizedExpected === normalizedObserved;
};
const matchesExpectedInteger = (expected, observed) => Number.isInteger(expected) && Number.isInteger(observed) && expected === observed;
const blocker = (blocker_code, blocker_layer, message) => ({
    blocker_code,
    blocker_layer,
    message
});
const isAdmittedEvidenceClass = (evidenceClass) => evidenceClass === "passive_api_capture";
const isRecognizedEvidenceClass = (evidenceClass) => evidenceClass === "passive_api_capture" ||
    evidenceClass === "dom_state_extraction" ||
    evidenceClass === "active_api_fetch_fallback";
export const evaluateCloseoutEvidence = (input) => {
    const expectedLatestHeadSha = normalizeString(input.expected.latest_head_sha);
    const observedHeadSha = normalizeString(input.evidence.head_sha);
    const expectedRunId = normalizeString(input.expected.run_id);
    const observedRunId = normalizeString(input.evidence.run_id);
    const expectedArtifactIdentity = normalizeString(input.expected.artifact_identity);
    const observedArtifactIdentity = normalizeString(input.evidence.artifact_identity);
    const expectedProfileRef = normalizeString(input.expected.profile_ref);
    const observedProfileRef = normalizeString(input.evidence.profile_ref);
    const expectedPageUrl = normalizeString(input.expected.page_url);
    const observedPageUrl = normalizeString(input.evidence.page_url);
    const expectedActionRef = normalizeString(input.expected.action_ref);
    const observedActionRef = normalizeString(input.evidence.action_ref);
    const routeRole = normalizeString(input.evidence.route_role);
    const pathKind = normalizeString(input.evidence.path_kind);
    const evidenceStatus = normalizeString(input.evidence.evidence_status);
    const evidenceClass = normalizeString(input.evidence.evidence_class);
    const latestHeadAvailable = expectedLatestHeadSha !== null && observedHeadSha !== null;
    const latestHeadMatches = latestHeadAvailable && expectedLatestHeadSha === observedHeadSha;
    const runMatches = matchesExpectedString(expectedRunId, observedRunId);
    const artifactMatches = matchesExpectedString(expectedArtifactIdentity, observedArtifactIdentity);
    const profileBound = matchesExpectedString(expectedProfileRef, observedProfileRef);
    const tabBound = matchesExpectedInteger(input.expected.target_tab_id, input.evidence.target_tab_id);
    const pageBound = matchesExpectedString(expectedPageUrl, observedPageUrl);
    const actionBound = matchesExpectedString(expectedActionRef, observedActionRef);
    const blockers = [];
    if (routeRole !== "primary") {
        blockers.push(blocker("non_primary_route", "route", "closeout evidence must come from the primary route"));
    }
    if (pathKind !== "api") {
        blockers.push(blocker("non_api_path", "route", "closeout evidence must come from an API path"));
    }
    if (evidenceStatus !== "success") {
        blockers.push(blocker("evidence_not_success", "route", "closeout evidence must report a success status"));
    }
    if (evidenceClass === "dom_state_extraction") {
        blockers.push(blocker("dom_state_not_full_closeout", "route", "DOM or page-state extraction cannot satisfy the full closeout bar"));
    }
    if (evidenceClass === "active_api_fetch_fallback") {
        blockers.push(blocker("active_fetch_not_admitted", "route", "active API fetch fallback is not admitted as primary closeout evidence"));
    }
    else if (evidenceClass !== null && !isRecognizedEvidenceClass(evidenceClass)) {
        blockers.push(blocker("unsupported_evidence_class", "route", "closeout evidence must use an admitted evidence_class"));
    }
    if (!input.evidence.reproduced_multi_round) {
        blockers.push(blocker("missing_multi_round_evidence", "route", "closeout evidence must be reproduced across multiple rounds"));
    }
    if (!latestHeadAvailable) {
        blockers.push(blocker("missing_latest_head", "freshness", "latest-head closeout evidence requires both the expected and observed head sha"));
    }
    else if (!latestHeadMatches) {
        blockers.push(blocker("stale_head", "freshness", "closeout evidence must be bound to the current latest head"));
    }
    if (!runMatches) {
        blockers.push(blocker("stale_run", "freshness", "closeout evidence must be bound to the current run"));
    }
    if (!artifactMatches) {
        blockers.push(blocker("stale_artifact", "freshness", "closeout evidence must be bound to the current artifact identity"));
    }
    if (!profileBound) {
        blockers.push(blocker("missing_profile_binding", "binding", "closeout evidence must be bound to the expected profile"));
    }
    if (!tabBound) {
        blockers.push(blocker("missing_tab_binding", "binding", "closeout evidence must be bound to the expected tab"));
    }
    if (!pageBound) {
        blockers.push(blocker("missing_page_binding", "binding", "closeout evidence must be bound to the expected page URL"));
    }
    if (!actionBound) {
        blockers.push(blocker("missing_action_binding", "binding", "closeout evidence must be bound to the expected action reference"));
    }
    const passed = blockers.length === 0;
    return {
        decision: passed ? "PASS" : "FAIL",
        passed,
        blockers,
        evaluated_route: [
            routeRole ?? "unknown_route",
            pathKind ?? "unknown_path",
            evidenceClass ?? "unknown_class",
            evidenceStatus ?? "unknown_status"
        ].join(":"),
        route_role: routeRole,
        path_kind: pathKind,
        evidence_status: evidenceStatus,
        evidence_class: evidenceClass,
        reproduced_multi_round: input.evidence.reproduced_multi_round,
        freshness: {
            latest_head_available: latestHeadAvailable,
            latest_head_matches: latestHeadMatches,
            run_matches: runMatches,
            artifact_matches: artifactMatches,
            expected_latest_head_sha: expectedLatestHeadSha,
            observed_head_sha: observedHeadSha,
            expected_run_id: expectedRunId,
            observed_run_id: observedRunId,
            expected_artifact_identity: expectedArtifactIdentity,
            observed_artifact_identity: observedArtifactIdentity
        },
        bindings: {
            profile_bound: profileBound,
            tab_bound: tabBound,
            page_bound: pageBound,
            action_bound: actionBound,
            expected_profile_ref: expectedProfileRef,
            observed_profile_ref: observedProfileRef,
            expected_target_tab_id: input.expected.target_tab_id,
            observed_target_tab_id: input.evidence.target_tab_id,
            expected_page_url: expectedPageUrl,
            observed_page_url: observedPageUrl,
            expected_action_ref: expectedActionRef,
            observed_action_ref: observedActionRef
        }
    };
};
