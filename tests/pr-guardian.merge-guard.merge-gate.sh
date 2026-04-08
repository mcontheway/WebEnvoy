setup_review_status_fixture() {
  local case_name="$1"
  local pr_author="$2"
  local reviewer="$3"
  local review_state="$4"
  local verdict="$5"
  local safe_to_merge="$6"
  local include_metadata="${7:-1}"
  local metadata_mode="${8:-valid}"

  setup_case_dir "${case_name}"

  HEAD_SHA="head-sha-123"
  BASE_REF="main"
  MERGE_BASE_SHA="merge-base-sha-123"
  REVIEW_PROFILE="high_risk_impl_profile"
  REVIEW_BASIS_DIGEST="review-basis-digest-123"
  PROMPT_DIGEST="prompt-digest-123"
  PR_AUTHOR="${pr_author}"
  export HEAD_SHA BASE_REF MERGE_BASE_SHA REVIEW_PROFILE REVIEW_BASIS_DIGEST PROMPT_DIGEST PR_AUTHOR

  RESULT_FILE="${TMP_DIR}/review.json"
  REVIEW_MD_FILE="${TMP_DIR}/review.md"
  printf '{"verdict":"%s","safe_to_merge":%s,"summary":"summary","findings":[],"required_actions":[]}\n' "${verdict}" "${safe_to_merge}" > "${RESULT_FILE}"
  build_markdown_review "${RESULT_FILE}" "${REVIEW_MD_FILE}"

  case "${include_metadata}:${metadata_mode}" in
    1:valid)
      ;;
    1:invalid)
      perl -0pi -e 's/\n<!-- webenvoy-guardian-meta:v1 [A-Za-z0-9+\/=]+ -->\n?/\n<!-- webenvoy-guardian-meta:v1 bm90LWpzb24= -->\n/s' "${REVIEW_MD_FILE}"
      ;;
    0:*)
      perl -0pi -e 's/\n<!-- webenvoy-guardian-meta:v1 [A-Za-z0-9+\/=]+ -->\n?/\n/s' "${REVIEW_MD_FILE}"
      ;;
    *)
      echo "unknown metadata mode: ${metadata_mode}" >&2
      exit 1
      ;;
  esac

  local review_body_json
  review_body_json="$(jq -Rs . < "${REVIEW_MD_FILE}")"

  MOCK_GH_USER_LOGIN="${reviewer}"
  export MOCK_GH_USER_LOGIN

  MOCK_GH_PR_VIEW_JSON="${TEST_TMP_DIR}/${case_name}/mock/pr-view.json"
  printf '%s\n' '{"baseRefName":"main","headRefOid":"head-sha-123","mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","isDraft":false}' > "${MOCK_GH_PR_VIEW_JSON}"
  export MOCK_GH_PR_VIEW_JSON

  MOCK_GH_CHECKS_JSON="${TEST_TMP_DIR}/${case_name}/mock/checks.json"
  printf '%s\n' '[{"name":"Run Tests","bucket":"pass","state":"SUCCESS","link":"https://example.test/tests"}]' > "${MOCK_GH_CHECKS_JSON}"
  export MOCK_GH_CHECKS_JSON

  MOCK_GH_REVIEWS_JSON="${TEST_TMP_DIR}/${case_name}/mock/reviews.json"
  printf '[[{"id":41,"user":{"login":"%s"},"commit_id":"%s","state":"%s","submitted_at":"2026-04-07T10:00:00Z","body":%s}]]\n' "${reviewer}" "${HEAD_SHA}" "${review_state}" "${review_body_json}" > "${MOCK_GH_REVIEWS_JSON}"
  export MOCK_GH_REVIEWS_JSON
}

test_review_status_reports_reusable_review_for_matching_metadata() {
  setup_review_status_fixture \
    "review-status-reusable" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "APPROVE" \
    "true" \
    "1" \
    "valid"

  local status_file="${TMP_DIR}/review-status.json"
  assert_pass write_review_status_json 274 review-bot "${status_file}"
  assert_equal "$(jq -r '.reusable' "${status_file}")" "true"
  assert_equal "$(jq -r '.reason' "${status_file}")" "matching_metadata"
  assert_equal "$(jq -r '.verdict' "${status_file}")" "APPROVE"
  assert_equal "$(jq -r '.safe_to_merge' "${status_file}")" "true"
  assert_equal "$(jq -r '.review_basis_digest' "${status_file}")" "review-basis-digest-123"
  assert_file_not_contains "${MOCK_GH_CALLS_LOG}" "collaborators/"
}

test_review_status_reports_reusable_review_from_other_reviewer() {
  setup_review_status_fixture \
    "review-status-reusable-other-reviewer" \
    "pr-author" \
    "poller[bot]" \
    "APPROVED" \
    "APPROVE" \
    "true" \
    "1" \
    "valid"

  local status_file="${TMP_DIR}/review-status.json"
  assert_pass write_review_status_json 274 human-reviewer "${status_file}"
  assert_equal "$(jq -r '.reusable' "${status_file}")" "true"
  assert_equal "$(jq -r '.reason' "${status_file}")" "matching_metadata"
  assert_equal "$(jq -r '.reviewer_login' "${status_file}")" "poller[bot]"
  assert_file_not_contains "${MOCK_GH_CALLS_LOG}" "collaborators/"
}

test_review_status_rejects_untrusted_bot_reviewer() {
  setup_review_status_fixture \
    "review-status-untrusted-bot-reviewer" \
    "pr-author" \
    "other-bot[bot]" \
    "APPROVED" \
    "APPROVE" \
    "true" \
    "1" \
    "valid"

  local status_file="${TMP_DIR}/review-status.json"
  assert_pass write_review_status_json 274 human-reviewer "${status_file}"
  assert_equal "$(jq -r '.reusable' "${status_file}")" "false"
  assert_equal "$(jq -r '.reason' "${status_file}")" "missing_review"
}

test_review_status_rejects_untrusted_other_reviewer() {
  setup_review_status_fixture \
    "review-status-untrusted-other-reviewer" \
    "pr-author" \
    "other-human" \
    "APPROVED" \
    "APPROVE" \
    "true" \
    "1" \
    "valid"

  local status_file="${TMP_DIR}/review-status.json"
  assert_pass write_review_status_json 274 human-reviewer "${status_file}"
  assert_equal "$(jq -r '.reusable' "${status_file}")" "false"
  assert_equal "$(jq -r '.reason' "${status_file}")" "missing_review"
}

test_review_status_allows_invoking_human_reviewer_in_strict_mode() {
  setup_review_status_fixture \
    "review-status-invoking-human-strict" \
    "pr-author" \
    "human-reviewer" \
    "APPROVED" \
    "APPROVE" \
    "true" \
    "1" \
    "valid"

  local status_file="${TMP_DIR}/review-status.json"
  assert_pass write_review_status_json 274 human-reviewer "${status_file}"
  assert_equal "$(jq -r '.reusable' "${status_file}")" "true"
  assert_equal "$(jq -r '.reason' "${status_file}")" "matching_metadata"
  assert_equal "$(jq -r '.reviewer_login' "${status_file}")" "human-reviewer"
}

test_light_review_status_allows_invoking_human_reviewer() {
  setup_review_status_fixture \
    "review-status-invoking-human-light" \
    "pr-author" \
    "human-reviewer" \
    "APPROVED" \
    "APPROVE" \
    "true" \
    "1" \
    "valid"

  local status_file="${TMP_DIR}/review-status.json"
  assert_pass write_light_review_status_json 274 human-reviewer "${status_file}"
  assert_equal "$(jq -r '.reusable' "${status_file}")" "true"
  assert_equal "$(jq -r '.reason' "${status_file}")" "matching_metadata"
  assert_equal "$(jq -r '.reviewer_login' "${status_file}")" "human-reviewer"
}

test_light_review_status_rejects_other_human_reviewer() {
  setup_review_status_fixture \
    "review-status-other-human-light" \
    "pr-author" \
    "other-human" \
    "APPROVED" \
    "APPROVE" \
    "true" \
    "1" \
    "valid"

  local status_file="${TMP_DIR}/review-status.json"
  assert_pass write_light_review_status_json 274 human-reviewer "${status_file}"
  assert_equal "$(jq -r '.reusable' "${status_file}")" "false"
  assert_equal "$(jq -r '.reason' "${status_file}")" "missing_review"
}

test_review_status_reuses_valid_review_when_newer_trusted_comment_lacks_metadata() {
  setup_review_status_fixture \
    "review-status-reuse-older-valid-review" \
    "pr-author" \
    "poller[bot]" \
    "APPROVED" \
    "APPROVE" \
    "true" \
    "1" \
    "valid"

  local status_file="${TMP_DIR}/review-status.json"
  local review_body_json
  review_body_json="$(jq -Rs . < "${REVIEW_MD_FILE}")"
  printf '[[{"id":41,"user":{"login":"poller[bot]"},"commit_id":"head-sha-123","state":"APPROVED","submitted_at":"2026-04-07T10:00:00Z","body":%s},{"id":42,"user":{"login":"human-reviewer"},"commit_id":"head-sha-123","state":"COMMENTED","submitted_at":"2026-04-07T10:05:00Z","body":"plain follow-up comment"}]]\n' "${review_body_json}" > "${MOCK_GH_REVIEWS_JSON}"

  assert_pass write_review_status_json 274 human-reviewer "${status_file}"
  assert_equal "$(jq -r '.reusable' "${status_file}")" "true"
  assert_equal "$(jq -r '.reason' "${status_file}")" "matching_metadata"
  assert_equal "$(jq -r '.reviewer_login' "${status_file}")" "poller[bot]"
}

test_review_status_rejects_dismissed_latest_review() {
  setup_review_status_fixture \
    "review-status-dismissed-latest-review" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "APPROVE" \
    "true" \
    "1" \
    "valid"

  local status_file="${TMP_DIR}/review-status.json"
  local review_body_json
  review_body_json="$(jq -Rs . < "${REVIEW_MD_FILE}")"
  printf '[[{"id":41,"user":{"login":"review-bot"},"commit_id":"head-sha-123","state":"APPROVED","submitted_at":"2026-04-07T10:00:00Z","body":%s},{"id":42,"user":{"login":"review-bot"},"commit_id":"head-sha-123","state":"DISMISSED","submitted_at":"2026-04-07T10:05:00Z","body":%s}]]\n' "${review_body_json}" "${review_body_json}" > "${MOCK_GH_REVIEWS_JSON}"

  assert_pass write_review_status_json 274 review-bot "${status_file}"
  assert_equal "$(jq -r '.reusable' "${status_file}")" "false"
  assert_equal "$(jq -r '.reason' "${status_file}")" "review_state_mismatch"
}

test_review_status_prefers_latest_trusted_review_over_older_approval() {
  setup_review_status_fixture \
    "review-status-latest-trusted-review-wins" \
    "pr-author" \
    "mcontheway" \
    "APPROVED" \
    "APPROVE" \
    "true" \
    "1" \
    "valid"

  local status_file="${TMP_DIR}/review-status.json"
  local latest_result_file="${TMP_DIR}/latest-review.json"
  local latest_review_file="${TMP_DIR}/latest-review.md"
  local older_review_body_json
  local latest_review_body_json

  printf '%s\n' '{"verdict":"REQUEST_CHANGES","safe_to_merge":false,"summary":"blocked","findings":[],"required_actions":[]}' > "${latest_result_file}"
  RESULT_FILE="${latest_result_file}"
  REVIEW_MD_FILE="${latest_review_file}"
  build_markdown_review "${RESULT_FILE}" "${REVIEW_MD_FILE}"
  latest_review_body_json="$(jq -Rs . < "${REVIEW_MD_FILE}")"

  older_review_body_json="$(jq -Rs . < "${TMP_DIR}/review.md")"
  printf '[[{"id":41,"user":{"login":"mcontheway"},"commit_id":"head-sha-123","state":"APPROVED","submitted_at":"2026-04-07T10:00:00Z","body":%s},{"id":42,"user":{"login":"github-actions[bot]"},"commit_id":"head-sha-123","state":"CHANGES_REQUESTED","submitted_at":"2026-04-07T10:05:00Z","body":%s}]]\n' "${older_review_body_json}" "${latest_review_body_json}" > "${MOCK_GH_REVIEWS_JSON}"

  assert_pass write_review_status_json 274 github-actions[bot] "${status_file}"
  assert_equal "$(jq -r '.reusable' "${status_file}")" "true"
  assert_equal "$(jq -r '.reviewer_login' "${status_file}")" "github-actions[bot]"
  assert_equal "$(jq -r '.verdict' "${status_file}")" "REQUEST_CHANGES"
  assert_equal "$(jq -r '.safe_to_merge' "${status_file}")" "false"
}

test_review_status_rejects_prompt_digest_mismatch() {
  setup_review_status_fixture \
    "review-status-prompt-digest-mismatch" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "APPROVE" \
    "true" \
    "1" \
    "valid"

  PROMPT_DIGEST="prompt-digest-new"
  export PROMPT_DIGEST

  local status_file="${TMP_DIR}/review-status.json"
  assert_pass write_review_status_json 274 review-bot "${status_file}"
  assert_equal "$(jq -r '.reusable' "${status_file}")" "false"
  assert_equal "$(jq -r '.reason' "${status_file}")" "prompt_digest_mismatch"
}

test_light_review_status_ignores_prompt_digest_mismatch() {
  setup_review_status_fixture \
    "review-status-light-prompt-digest-mismatch" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "APPROVE" \
    "true" \
    "1" \
    "valid"

  PROMPT_DIGEST="prompt-digest-new"
  export PROMPT_DIGEST

  local status_file="${TMP_DIR}/review-status.json"
  assert_pass write_light_review_status_json 274 review-bot "${status_file}"
  assert_equal "$(jq -r '.reusable' "${status_file}")" "true"
  assert_equal "$(jq -r '.reason' "${status_file}")" "matching_metadata"
  assert_equal "$(jq -r '.review_basis_digest' "${status_file}")" "review-basis-digest-123"
  assert_equal "$(jq -r '.prompt_digest' "${status_file}")" "prompt-digest-123"
}

test_review_status_rejects_review_basis_digest_mismatch() {
  setup_review_status_fixture \
    "review-status-review-basis-digest-mismatch" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "APPROVE" \
    "true" \
    "1" \
    "valid"

  REVIEW_BASIS_DIGEST="review-basis-digest-new"
  export REVIEW_BASIS_DIGEST

  local status_file="${TMP_DIR}/review-status.json"
  assert_pass write_review_status_json 274 review-bot "${status_file}"
  assert_equal "$(jq -r '.reusable' "${status_file}")" "false"
  assert_equal "$(jq -r '.reason' "${status_file}")" "review_basis_digest_mismatch"
  assert_equal "$(jq -r '.review_basis_digest' "${status_file}")" "review-basis-digest-new"
}

test_review_status_rejects_missing_metadata() {
  setup_review_status_fixture \
    "review-status-missing-metadata" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "APPROVE" \
    "true" \
    "0"

  local status_file="${TMP_DIR}/review-status.json"
  assert_pass write_review_status_json 274 review-bot "${status_file}"
  assert_equal "$(jq -r '.reusable' "${status_file}")" "false"
  assert_equal "$(jq -r '.reason' "${status_file}")" "missing_metadata"
}

test_review_status_rejects_invalid_metadata() {
  setup_review_status_fixture \
    "review-status-invalid-metadata" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "APPROVE" \
    "true" \
    "1" \
    "invalid"

  local status_file="${TMP_DIR}/review-status.json"
  assert_pass write_review_status_json 274 review-bot "${status_file}"
  assert_equal "$(jq -r '.reusable' "${status_file}")" "false"
  assert_equal "$(jq -r '.reason' "${status_file}")" "invalid_metadata"
}

test_review_status_rejects_tampered_review_body() {
  setup_review_status_fixture \
    "review-status-tampered-review-body" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "APPROVE" \
    "true" \
    "1" \
    "valid"

  local status_file="${TMP_DIR}/review-status.json"
  local tampered_review_file="${TMP_DIR}/tampered-review.md"
  local tampered_review_body_json
  sed 's/\*\*摘要\*\*: summary/**摘要**: tampered review body/' "${REVIEW_MD_FILE}" > "${tampered_review_file}"
  tampered_review_body_json="$(jq -Rs . < "${tampered_review_file}")"
  printf '[[{"id":41,"user":{"login":"review-bot"},"commit_id":"%s","state":"APPROVED","submitted_at":"2026-04-07T10:00:00Z","body":%s}]]\n' "${HEAD_SHA}" "${tampered_review_body_json}" > "${MOCK_GH_REVIEWS_JSON}"

  assert_pass write_review_status_json 274 review-bot "${status_file}"
  assert_equal "$(jq -r '.reusable' "${status_file}")" "false"
  assert_equal "$(jq -r '.reason' "${status_file}")" "invalid_metadata"
}

test_reused_request_changes_does_not_become_mergeable() {
  setup_review_status_fixture \
    "review-status-request-changes" \
    "pr-author" \
    "review-bot" \
    "CHANGES_REQUESTED" \
    "REQUEST_CHANGES" \
    "false" \
    "1" \
    "valid"

  local status_file="${TMP_DIR}/review-status.json"
  local err_file="${TMP_DIR}/merge.err"
  assert_pass write_review_status_json 274 review-bot "${status_file}"
  assert_equal "$(jq -r '.reusable' "${status_file}")" "true"
  hydrate_reused_review_result "${status_file}" || {
    echo "expected hydrate_reused_review_result to pass" >&2
    exit 1
  }
  assert_fail merge_if_safe 274 0 2>"${err_file}"
  assert_file_contains "${err_file}" "Codex 审查未批准，拒绝合并。"
  assert_file_empty "${MOCK_GH_MERGE_LOG}"
}

test_merge_if_safe_accepts_reused_review_from_other_reviewer() {
  setup_review_status_fixture \
    "merge-reused-review-other-reviewer" \
    "pr-author" \
    "poller[bot]" \
    "APPROVED" \
    "APPROVE" \
    "true" \
    "1" \
    "valid"

  local status_file="${TMP_DIR}/review-status.json"
  MOCK_GH_USER_LOGIN="human-reviewer"
  export MOCK_GH_USER_LOGIN

  assert_pass write_review_status_json 274 human-reviewer "${status_file}"
  assert_equal "$(jq -r '.reviewer_login' "${status_file}")" "poller[bot]"
  REUSED_REVIEWER_LOGIN="poller[bot]"
  export REUSED_REVIEWER_LOGIN
  assert_pass merge_if_safe 274 0
  assert_file_contains "${MOCK_GH_MERGE_LOG}" "--match-head-commit head-sha-123"
}

test_merge_if_safe_without_post_review_respects_comment_contract() {
  setup_merge_if_safe_fixture \
    "merge-without-post-review-comment-contract" \
    "review-bot" \
    "review-bot" \
    "COMMENTED" \
    "head-sha-123" \
    "0"

  assert_pass merge_if_safe 274 0
  assert_file_contains "${MOCK_GH_MERGE_LOG}" "--match-head-commit head-sha-123"
}

test_merge_if_safe_finds_head_review_across_paginated_reviews() {
  setup_merge_if_safe_fixture \
    "merge-paginated-reviews" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "head-sha-123" \
    "1"

  assert_pass merge_if_safe 274 0
  assert_file_contains "${MOCK_GH_CALLS_LOG}" "repos/:owner/:repo/pulls/274/reviews"
  assert_file_contains "${MOCK_GH_CALLS_LOG}" "--paginate"
}

test_merge_if_safe_rejects_review_from_old_head() {
  setup_merge_if_safe_fixture \
    "merge-review-old-head" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "older-head-sha" \
    "0"

  local err_file="${TMP_DIR}/merge.err"
  assert_fail merge_if_safe 274 0 2>"${err_file}"
  assert_file_contains "${err_file}" "期望状态: APPROVED"
  assert_file_empty "${MOCK_GH_MERGE_LOG}"
}

test_merge_if_safe_blocks_when_required_checks_fail() {
  setup_merge_if_safe_fixture \
    "merge-required-check-failure" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "head-sha-123" \
    "0"

  MOCK_GH_REQUIRED_CHECKS_JSON="${TEST_TMP_DIR}/merge-required-check-failure/mock/required-checks.json"
  printf '%s\n' '[{"name":"review-completed","bucket":"pass","state":"SUCCESS","link":"https://example.test/review"},{"name":"Run Tests","bucket":"fail","state":"FAILURE","link":"https://example.test/tests"}]' > "${MOCK_GH_REQUIRED_CHECKS_JSON}"
  export MOCK_GH_REQUIRED_CHECKS_JSON

  local err_file="${TMP_DIR}/merge.err"
  assert_fail merge_if_safe 274 0 2>"${err_file}"
  assert_file_contains "${err_file}" "GitHub required checks 未全部通过，拒绝合并。"
  assert_file_contains "${MOCK_GH_CALLS_LOG}" "pr checks 274 --required --json name,bucket,state,link"
  assert_file_empty "${MOCK_GH_MERGE_LOG}"
}

test_merge_if_safe_blocks_when_review_completed_check_fails() {
  setup_merge_if_safe_fixture \
    "merge-required-review-completed-failure" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "head-sha-123" \
    "0"

  MOCK_GH_REQUIRED_CHECKS_JSON="${TEST_TMP_DIR}/merge-required-review-completed-failure/mock/required-checks.json"
  printf '%s\n' '[{"name":"review-completed","bucket":"fail","state":"FAILURE","link":"https://example.test/review"},{"name":"Run Tests","bucket":"pass","state":"SUCCESS","link":"https://example.test/tests"}]' > "${MOCK_GH_REQUIRED_CHECKS_JSON}"
  export MOCK_GH_REQUIRED_CHECKS_JSON

  local err_file="${TMP_DIR}/merge.err"
  assert_fail merge_if_safe 274 0 2>"${err_file}"
  assert_file_contains "${err_file}" "GitHub required checks 未全部通过，拒绝合并。"
  assert_file_contains "${MOCK_GH_CALLS_LOG}" "pr checks 274 --required --json name,bucket,state,link"
  assert_file_empty "${MOCK_GH_MERGE_LOG}"
}

test_merge_if_safe_uses_latest_review_state_on_same_head() {
  setup_merge_if_safe_fixture \
    "merge-review-latest-state-same-head" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "head-sha-123" \
    "0"

  printf '%s\n' '[[{"id":22,"user":{"login":"review-bot"},"commit_id":"head-sha-123","state":"APPROVED","submitted_at":"2026-03-26T10:00:00Z"},{"id":11,"user":{"login":"review-bot"},"commit_id":"head-sha-123","state":"CHANGES_REQUESTED","submitted_at":"2026-03-26T09:00:00Z"}]]' > "${MOCK_GH_REVIEWS_JSON}"

  assert_pass merge_if_safe 274 0
  assert_file_contains "${MOCK_GH_MERGE_LOG}" "--match-head-commit head-sha-123"
}

test_post_review_fails_when_head_changes_after_review_snapshot() {
  setup_merge_if_safe_fixture \
    "post-review-head-drift" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "head-sha-123" \
    "0"

  MOCK_GH_PR_VIEW_SEQUENCE_FILE="${TEST_TMP_DIR}/post-review-head-drift/mock/pr-view-seq.jsonl"
  printf '%s\n' '{"headRefOid":"head-sha-999"}' > "${MOCK_GH_PR_VIEW_SEQUENCE_FILE}"
  export MOCK_GH_PR_VIEW_SEQUENCE_FILE

  assert_fail post_review 274
  assert_file_empty "${MOCK_GH_REVIEW_LOG}"
}

test_merge_if_safe_fails_when_head_changes_after_review_snapshot() {
  setup_merge_if_safe_fixture \
    "merge-head-drift" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "head-sha-123" \
    "0"

  MOCK_GH_PR_VIEW_SEQUENCE_FILE="${TEST_TMP_DIR}/merge-head-drift/mock/pr-view-seq.jsonl"
  printf '%s\n' '{"baseRefName":"main","headRefOid":"head-sha-999","mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","isDraft":false}' > "${MOCK_GH_PR_VIEW_SEQUENCE_FILE}"
  export MOCK_GH_PR_VIEW_SEQUENCE_FILE

  assert_fail merge_if_safe 274 0
  assert_file_empty "${MOCK_GH_MERGE_LOG}"
}

test_merge_if_safe_retries_until_merge_state_behind_recovers() {
  setup_merge_if_safe_fixture \
    "merge-state-behind" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "head-sha-123" \
    "0"

  MOCK_GH_PR_VIEW_SEQUENCE_FILE="${TEST_TMP_DIR}/merge-state-behind/mock/pr-view-seq.jsonl"
  {
    printf '%s\n' '{"baseRefName":"main","headRefOid":"head-sha-123","mergeable":"MERGEABLE","mergeStateStatus":"BEHIND","isDraft":false}'
    printf '%s\n' '{"baseRefName":"main","headRefOid":"head-sha-123","mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","isDraft":false}'
  } > "${MOCK_GH_PR_VIEW_SEQUENCE_FILE}"
  export MOCK_GH_PR_VIEW_SEQUENCE_FILE

  PR_GUARDIAN_MERGE_STATE_MAX_ATTEMPTS=2
  PR_GUARDIAN_MERGE_STATE_RETRY_DELAY_SECONDS=0
  export PR_GUARDIAN_MERGE_STATE_MAX_ATTEMPTS
  export PR_GUARDIAN_MERGE_STATE_RETRY_DELAY_SECONDS

  assert_pass merge_if_safe 274 0
  assert_file_contains "${MOCK_GH_MERGE_LOG}" "--match-head-commit head-sha-123"
}

test_merge_if_safe_fails_when_merge_state_unknown_never_recovers() {
  setup_merge_if_safe_fixture \
    "merge-state-unknown" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "head-sha-123" \
    "0"

  MOCK_GH_PR_VIEW_SEQUENCE_FILE="${TEST_TMP_DIR}/merge-state-unknown/mock/pr-view-seq.jsonl"
  {
    printf '%s\n' '{"baseRefName":"main","headRefOid":"head-sha-123","mergeable":"MERGEABLE","mergeStateStatus":"UNKNOWN","isDraft":false}'
    printf '%s\n' '{"baseRefName":"main","headRefOid":"head-sha-123","mergeable":"MERGEABLE","mergeStateStatus":"UNKNOWN","isDraft":false}'
  } > "${MOCK_GH_PR_VIEW_SEQUENCE_FILE}"
  export MOCK_GH_PR_VIEW_SEQUENCE_FILE

  PR_GUARDIAN_MERGE_STATE_MAX_ATTEMPTS=2
  PR_GUARDIAN_MERGE_STATE_RETRY_DELAY_SECONDS=0
  export PR_GUARDIAN_MERGE_STATE_MAX_ATTEMPTS
  export PR_GUARDIAN_MERGE_STATE_RETRY_DELAY_SECONDS

  local err_file="${TMP_DIR}/merge.err"
  assert_fail merge_if_safe 274 0 2>"${err_file}"
  assert_file_contains "${err_file}" "mergeStateStatus=UNKNOWN"
  assert_file_contains "${err_file}" "可重跑/等待后重试"
  assert_file_empty "${MOCK_GH_MERGE_LOG}"
}

test_merge_if_safe_retries_until_review_state_is_visible() {
  setup_merge_if_safe_fixture \
    "merge-review-state-retry" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "head-sha-123" \
    "0"

  MOCK_GH_REVIEWS_SEQUENCE_FILE="${TEST_TMP_DIR}/merge-review-state-retry/mock/reviews-seq.jsonl"
  {
    printf '%s\n' '[[{"user":{"login":"other-reviewer"},"commit_id":"head-sha-123","state":"APPROVED"}]]'
    printf '%s\n' '[[{"user":{"login":"review-bot"},"commit_id":"head-sha-123","state":"APPROVED"}]]'
  } > "${MOCK_GH_REVIEWS_SEQUENCE_FILE}"
  export MOCK_GH_REVIEWS_SEQUENCE_FILE

  PR_GUARDIAN_REVIEW_STATE_MAX_ATTEMPTS=2
  PR_GUARDIAN_REVIEW_STATE_RETRY_DELAY_SECONDS=0
  export PR_GUARDIAN_REVIEW_STATE_MAX_ATTEMPTS
  export PR_GUARDIAN_REVIEW_STATE_RETRY_DELAY_SECONDS

  assert_pass merge_if_safe 274 0
  assert_file_contains "${MOCK_GH_MERGE_LOG}" "--match-head-commit head-sha-123"

  local review_calls
  review_calls="$(grep -c "repos/:owner/:repo/pulls/274/reviews" "${MOCK_GH_CALLS_LOG}")"
  if [[ "${review_calls}" -lt 2 ]]; then
    echo "expected merge_if_safe to retry review-state check at least once" >&2
    exit 1
  fi
}

test_merge_if_safe_rejects_when_latest_review_state_regresses_on_same_head() {
  setup_merge_if_safe_fixture \
    "merge-review-state-regression-same-head" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "head-sha-123" \
    "0"

  printf '%s\n' '[[{"user":{"login":"review-bot"},"commit_id":"head-sha-123","state":"APPROVED"},{"user":{"login":"review-bot"},"commit_id":"head-sha-123","state":"CHANGES_REQUESTED"}]]' > "${MOCK_GH_REVIEWS_JSON}"

  local err_file="${TMP_DIR}/merge.err"
  assert_fail merge_if_safe 274 0 2>"${err_file}"
  assert_file_contains "${err_file}" "期望状态: APPROVED"
  assert_file_empty "${MOCK_GH_MERGE_LOG}"
}

test_post_review_self_review_uses_review_event_and_merge_gate_uses_reviews_api() {
  setup_merge_if_safe_fixture \
    "post-review-self-review-event" \
    "review-bot" \
    "review-bot" \
    "COMMENTED" \
    "head-sha-123" \
    "0"

  REVIEW_MD_FILE="${TMP_DIR}/review.md"
  printf '%s\n' "self review body" > "${REVIEW_MD_FILE}"
  export REVIEW_MD_FILE

  RESULT_FILE="${TMP_DIR}/review.json"
  printf '%s\n' '{"verdict":"APPROVE","safe_to_merge":true,"findings":[]}' > "${RESULT_FILE}"
  export RESULT_FILE

  assert_pass post_review 274
  assert_file_contains "${MOCK_GH_REVIEW_LOG}" "pr review 274 --comment --body-file"
  assert_file_not_contains "${MOCK_GH_REVIEW_LOG}" "pr comment 274"

  assert_pass merge_if_safe 274 0
  assert_file_contains "${MOCK_GH_CALLS_LOG}" "repos/:owner/:repo/pulls/274/reviews"
  assert_file_not_contains "${MOCK_GH_CALLS_LOG}" "repos/:owner/:repo/issues/274/comments"
  assert_file_contains "${MOCK_GH_MERGE_LOG}" "--match-head-commit head-sha-123"
}

test_merge_if_safe_rejects_comment_marker_without_formal_review() {
  setup_merge_if_safe_fixture \
    "merge-review-comment-marker-only" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "head-sha-123" \
    "0"

  printf '%s\n' '[]' > "${MOCK_GH_REVIEWS_JSON}"
  printf '%s\n' '[{"name":"review-completed","bucket":"pass","state":"SUCCESS","link":"https://example.test/review"},{"name":"Run Tests","bucket":"pass","state":"SUCCESS","link":"https://example.test/tests"}]' > "${MOCK_GH_CHECKS_JSON}"

  local err_file="${TMP_DIR}/merge.err"
  assert_fail merge_if_safe 274 0 2>"${err_file}"
  assert_file_contains "${err_file}" "缺少 review-bot 的已完成 GitHub review"
  assert_file_empty "${MOCK_GH_MERGE_LOG}"
}
