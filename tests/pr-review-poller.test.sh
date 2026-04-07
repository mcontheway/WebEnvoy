#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
POLLER_SCRIPT="${REPO_ROOT}/scripts/pr-review-poller.sh"
TEST_REPO_ROOT="${REPO_ROOT}"

TEST_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pr-review-poller.test.XXXXXX")"
cleanup_test_tmp() {
  rm -rf "${TEST_TMP_DIR}"
}
trap cleanup_test_tmp EXIT

load_poller_without_main() {
  local bootstrap_file="${TEST_TMP_DIR}/pr-review-poller-lib.sh"
  awk '
    $0 == "main \"$@\"" { exit }
    { print }
  ' "${POLLER_SCRIPT}" > "${bootstrap_file}"
  # shellcheck source=/dev/null
  source "${bootstrap_file}"
  REPO_ROOT="${TEST_REPO_ROOT}"
}

assert_pass() {
  if ! ( "$@" ); then
    echo "expected command to pass: $*" >&2
    exit 1
  fi
}

assert_file_contains() {
  local file="$1"
  local expected="$2"
  if ! grep -Fq -- "${expected}" "${file}"; then
    echo "expected '${expected}' in ${file}" >&2
    exit 1
  fi
}

assert_file_not_contains() {
  local file="$1"
  local unexpected="$2"
  if grep -Fq -- "${unexpected}" "${file}"; then
    echo "did not expect '${unexpected}' in ${file}" >&2
    exit 1
  fi
}

assert_equal() {
  local actual="$1"
  local expected="$2"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "expected '${expected}', got '${actual}'" >&2
    exit 1
  fi
}

setup_case_dir() {
  local case_name="$1"
  local case_dir="${TEST_TMP_DIR}/${case_name}"
  local mock_bin="${case_dir}/bin"

  mkdir -p "${case_dir}" "${case_dir}/guardian-status" "${mock_bin}"

  MOCK_GH_CALLS_LOG="${case_dir}/gh.calls.log"
  MOCK_GUARDIAN_LOG="${case_dir}/guardian.calls.log"
  MOCK_GH_OPEN_PRS_JSON="${case_dir}/open-prs.json"
  MOCK_GUARDIAN_STATUS_DIR="${case_dir}/guardian-status"
  MOCK_GUARDIAN_SCRIPT="${case_dir}/mock-pr-guardian.sh"
  STATE_FILE="${case_dir}/state.json"
  : > "${MOCK_GH_CALLS_LOG}"
  : > "${MOCK_GUARDIAN_LOG}"
  printf '{\n  "prs": {}\n}\n' > "${STATE_FILE}"
  export MOCK_GH_CALLS_LOG MOCK_GUARDIAN_LOG MOCK_GH_OPEN_PRS_JSON MOCK_GUARDIAN_STATUS_DIR STATE_FILE

  cat > "${mock_bin}/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

echo "$*" >> "${MOCK_GH_CALLS_LOG:?missing MOCK_GH_CALLS_LOG}"

if [[ "${1:-}" == "auth" && "${2:-}" == "status" ]]; then
  exit 0
fi

if [[ "${1:-}" == "repo" && "${2:-}" == "view" ]]; then
  printf '%s\n' "${MOCK_REPO_SLUG:-mcontheway/WebEnvoy}"
  exit 0
fi

if [[ "${1:-}" == "pr" && "${2:-}" == "list" ]]; then
  cat "${MOCK_GH_OPEN_PRS_JSON:?missing MOCK_GH_OPEN_PRS_JSON}"
  exit 0
fi

echo "unexpected gh call: $*" >&2
exit 64
EOF

  cat > "${mock_bin}/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "ls-remote" ]]; then
  exit 0
fi

echo "unexpected git call: $*" >&2
exit 64
EOF

  cat > "${MOCK_GUARDIAN_SCRIPT}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

echo "$*" >> "${MOCK_GUARDIAN_LOG:?missing MOCK_GUARDIAN_LOG}"

case "${1:-}" in
  review-status)
    if [[ "${MOCK_GUARDIAN_FAIL_REVIEW_STATUS_PR:-}" == "${2:-}" ]]; then
      echo "mock review-status failure for PR ${2}" >&2
      exit 42
    fi
    cat "${MOCK_GUARDIAN_STATUS_DIR:?missing MOCK_GUARDIAN_STATUS_DIR}/${2}.json"
    ;;
  review)
    ;;
  *)
    echo "unexpected guardian invocation: $*" >&2
    exit 64
    ;;
esac
EOF

  chmod +x "${mock_bin}/gh" "${mock_bin}/git" "${MOCK_GUARDIAN_SCRIPT}"
  export PATH="${mock_bin}:${PATH}"
}

test_poller_skips_pr_with_fresh_guardian_review() {
  setup_case_dir "skip-fresh-guardian-review"
  GUARDIAN_SCRIPT="${MOCK_GUARDIAN_SCRIPT}"
  export GUARDIAN_SCRIPT

  printf '%s\n' '[{"number":274,"title":"Fresh review","headRefOid":"head-sha-123","headRefName":"feat/fresh","author":{"login":"author"},"isDraft":false,"url":"https://example.test/pr/274","baseRefName":"main","milestone":{"title":"Sprint A"}}]' > "${MOCK_GH_OPEN_PRS_JSON}"
  printf '%s\n' '{"reusable":true,"reason":"matching_metadata","head_sha":"head-sha-123","review_profile":"high_risk_impl_profile","prompt_digest":"prompt-digest-123","verdict":"APPROVE","safe_to_merge":true}' > "${MOCK_GUARDIAN_STATUS_DIR}/274.json"

  assert_pass main --state-file "${STATE_FILE}"
  assert_file_contains "${MOCK_GUARDIAN_LOG}" "review-status 274"
  assert_file_not_contains "${MOCK_GUARDIAN_LOG}" "review 274"
  assert_equal "$(jq -r '.prs["274"].head_sha' "${STATE_FILE}")" "head-sha-123"
}

test_poller_reviews_pr_when_metadata_is_missing() {
  setup_case_dir "review-missing-metadata"
  GUARDIAN_SCRIPT="${MOCK_GUARDIAN_SCRIPT}"
  export GUARDIAN_SCRIPT

  printf '%s\n' '[{"number":275,"title":"Missing metadata","headRefOid":"head-sha-275","headRefName":"feat/missing","author":{"login":"author"},"isDraft":false,"url":"https://example.test/pr/275","baseRefName":"main","milestone":{"title":"Sprint A"}}]' > "${MOCK_GH_OPEN_PRS_JSON}"
  printf '%s\n' '{"reusable":false,"reason":"missing_metadata","head_sha":"head-sha-275","review_profile":"high_risk_impl_profile","prompt_digest":"prompt-digest-123","verdict":null,"safe_to_merge":null}' > "${MOCK_GUARDIAN_STATUS_DIR}/275.json"

  assert_pass main --state-file "${STATE_FILE}"
  assert_file_contains "${MOCK_GUARDIAN_LOG}" "review-status 275"
  assert_file_contains "${MOCK_GUARDIAN_LOG}" "review 275"
  assert_equal "$(jq -r '.prs["275"].head_sha' "${STATE_FILE}")" "head-sha-275"
}

test_poller_reviews_pr_when_metadata_is_stale() {
  setup_case_dir "review-stale-metadata"
  GUARDIAN_SCRIPT="${MOCK_GUARDIAN_SCRIPT}"
  export GUARDIAN_SCRIPT

  printf '%s\n' '[{"number":276,"title":"Stale metadata","headRefOid":"head-sha-276","headRefName":"feat/stale","author":{"login":"author"},"isDraft":false,"url":"https://example.test/pr/276","baseRefName":"main","milestone":{"title":"Sprint A"}}]' > "${MOCK_GH_OPEN_PRS_JSON}"
  printf '%s\n' '{"reusable":false,"reason":"prompt_digest_mismatch","head_sha":"head-sha-276","review_profile":"high_risk_impl_profile","prompt_digest":"prompt-digest-new","verdict":"APPROVE","safe_to_merge":true}' > "${MOCK_GUARDIAN_STATUS_DIR}/276.json"

  assert_pass main --state-file "${STATE_FILE}"
  assert_file_contains "${MOCK_GUARDIAN_LOG}" "review-status 276"
  assert_file_contains "${MOCK_GUARDIAN_LOG}" "review 276"
}

test_poller_no_post_review_uses_state_as_same_head_throttle() {
  setup_case_dir "no-post-review-same-head-throttle"
  GUARDIAN_SCRIPT="${MOCK_GUARDIAN_SCRIPT}"
  export GUARDIAN_SCRIPT

  printf '%s\n' '[{"number":277,"title":"No post review","headRefOid":"head-sha-277","headRefName":"feat/no-post","author":{"login":"author"},"isDraft":false,"url":"https://example.test/pr/277","baseRefName":"main","milestone":{"title":"Sprint A"}}]' > "${MOCK_GH_OPEN_PRS_JSON}"
  printf '%s\n' '{"reusable":false,"reason":"missing_metadata","head_sha":"head-sha-277","review_profile":"high_risk_impl_profile","prompt_digest":"prompt-digest-123","verdict":null,"safe_to_merge":null}' > "${MOCK_GUARDIAN_STATUS_DIR}/277.json"
  printf '%s\n' '{"prs":{"277":{"head_sha":"head-sha-277","reviewed_at":"2026-04-08T01:23:45Z"}}}' > "${STATE_FILE}"

  assert_pass main --state-file "${STATE_FILE}" --no-post-review
  assert_file_contains "${MOCK_GUARDIAN_LOG}" "review-status 277"
  assert_file_not_contains "${MOCK_GUARDIAN_LOG}" "review 277"
  assert_equal "$(jq -r '.prs["277"].head_sha' "${STATE_FILE}")" "head-sha-277"
}

test_poller_post_review_mode_does_not_use_state_as_truth() {
  setup_case_dir "post-review-ignores-local-state"
  GUARDIAN_SCRIPT="${MOCK_GUARDIAN_SCRIPT}"
  export GUARDIAN_SCRIPT

  printf '%s\n' '[{"number":278,"title":"Post review still runs","headRefOid":"head-sha-278","headRefName":"feat/post-review","author":{"login":"author"},"isDraft":false,"url":"https://example.test/pr/278","baseRefName":"main","milestone":{"title":"Sprint A"}}]' > "${MOCK_GH_OPEN_PRS_JSON}"
  printf '%s\n' '{"reusable":false,"reason":"missing_metadata","head_sha":"head-sha-278","review_profile":"high_risk_impl_profile","prompt_digest":"prompt-digest-123","verdict":null,"safe_to_merge":null}' > "${MOCK_GUARDIAN_STATUS_DIR}/278.json"
  printf '%s\n' '{"prs":{"278":{"head_sha":"head-sha-278","reviewed_at":"2026-04-08T01:23:45Z"}}}' > "${STATE_FILE}"

  assert_pass main --state-file "${STATE_FILE}"
  assert_file_contains "${MOCK_GUARDIAN_LOG}" "review-status 278"
  assert_file_contains "${MOCK_GUARDIAN_LOG}" "review 278"
}

test_poller_continues_when_review_status_query_fails() {
  setup_case_dir "degrade-to-review-after-review-status-failure"
  GUARDIAN_SCRIPT="${MOCK_GUARDIAN_SCRIPT}"
  export GUARDIAN_SCRIPT
  MOCK_GUARDIAN_FAIL_REVIEW_STATUS_PR="279"
  export MOCK_GUARDIAN_FAIL_REVIEW_STATUS_PR

  cat > "${MOCK_GH_OPEN_PRS_JSON}" <<'EOF'
[
  {"number":279,"title":"Status failure","headRefOid":"head-sha-279","headRefName":"feat/status-fail","author":{"login":"author"},"isDraft":false,"url":"https://example.test/pr/279","baseRefName":"main","milestone":{"title":"Sprint A"}},
  {"number":284,"title":"Next PR still reviews","headRefOid":"head-sha-284","headRefName":"feat/next","author":{"login":"author"},"isDraft":false,"url":"https://example.test/pr/284","baseRefName":"main","milestone":{"title":"Sprint A"}}
]
EOF
  printf '%s\n' '{"reusable":false,"reason":"missing_metadata","head_sha":"head-sha-284","review_profile":"high_risk_impl_profile","prompt_digest":"prompt-digest-123","verdict":null,"safe_to_merge":null}' > "${MOCK_GUARDIAN_STATUS_DIR}/284.json"

  assert_pass main --state-file "${STATE_FILE}"
  assert_file_contains "${MOCK_GUARDIAN_LOG}" "review-status 279"
  assert_file_contains "${MOCK_GUARDIAN_LOG}" "review 279"
  assert_file_contains "${MOCK_GUARDIAN_LOG}" "review-status 284"
  assert_file_contains "${MOCK_GUARDIAN_LOG}" "review 284"
  assert_equal "$(jq -r '.prs["279"].head_sha' "${STATE_FILE}")" "head-sha-279"
  assert_equal "$(jq -r '.prs["284"].head_sha' "${STATE_FILE}")" "head-sha-284"
}

test_poller_preserves_draft_base_branch_and_milestone_filters() {
  setup_case_dir "preserve-poller-filters"
  GUARDIAN_SCRIPT="${MOCK_GUARDIAN_SCRIPT}"
  export GUARDIAN_SCRIPT

  cat > "${MOCK_GH_OPEN_PRS_JSON}" <<'EOF'
[
  {"number":280,"title":"Draft PR","headRefOid":"head-draft","headRefName":"feat/draft","author":{"login":"author"},"isDraft":true,"url":"https://example.test/pr/280","baseRefName":"main","milestone":{"title":"Sprint A"}},
  {"number":281,"title":"Wrong base","headRefOid":"head-base","headRefName":"feat/base","author":{"login":"author"},"isDraft":false,"url":"https://example.test/pr/281","baseRefName":"release","milestone":{"title":"Sprint A"}},
  {"number":282,"title":"Wrong milestone","headRefOid":"head-mile","headRefName":"feat/mile","author":{"login":"author"},"isDraft":false,"url":"https://example.test/pr/282","baseRefName":"main","milestone":{"title":"Sprint B"}},
  {"number":283,"title":"Wrong branch","headRefOid":"head-branch","headRefName":"docs/branch","author":{"login":"author"},"isDraft":false,"url":"https://example.test/pr/283","baseRefName":"main","milestone":{"title":"Sprint A"}}
]
EOF

  assert_pass main --state-file "${STATE_FILE}" --branch-prefix "feat/" --milestone "Sprint A"
  assert_file_not_contains "${MOCK_GUARDIAN_LOG}" "review-status 280"
  assert_file_not_contains "${MOCK_GUARDIAN_LOG}" "review-status 281"
  assert_file_not_contains "${MOCK_GUARDIAN_LOG}" "review-status 282"
  assert_file_not_contains "${MOCK_GUARDIAN_LOG}" "review-status 283"
  assert_equal "$(jq -r '.prs | length' "${STATE_FILE}")" "0"
}

main() {
  load_poller_without_main
  test_poller_skips_pr_with_fresh_guardian_review
  test_poller_reviews_pr_when_metadata_is_missing
  test_poller_reviews_pr_when_metadata_is_stale
  test_poller_no_post_review_uses_state_as_same_head_throttle
  test_poller_post_review_mode_does_not_use_state_as_truth
  test_poller_continues_when_review_status_query_fails
  test_poller_preserves_draft_base_branch_and_milestone_filters
  echo "pr-review-poller test passed."
}

main "$@"
