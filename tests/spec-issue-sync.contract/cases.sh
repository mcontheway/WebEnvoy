#!/usr/bin/env bash

set -euo pipefail

test_suite_changed_and_already_anchored() {
  local spec_path="docs/dev/specs/FR-0008-demo/spec.md"
  local title="FR-0008 Demo"
  local base_sha

  setup_case_dir "suite-changed-anchored"
  create_formal_suite "${spec_path}" "${title}"
  write_map_file "${spec_path}:239"
  seed_issue 239 "$(anchored_issue_title "${spec_path}" "${title}")" "legacy body"
  git_commit_all "base"
  base_sha="$(current_head_sha)"

  append_line "${spec_path}" "- suite changed on head"
  git_commit_all "head"

  assert_pass run_spec_guard "${base_sha}"
  assert_pass run_sync_workflow_push "${base_sha}" "$(current_head_sha)"

  assert_file_contains "$(issue_body_path 239)" "Spec Path: ${spec_path}"
  assert_file_contains "$(issue_body_path 239)" "此 Issue 为 canonical FR 容器"
  assert_equal "$(wc -l < "${MOCK_GH_EDIT_LOG}" | tr -d ' ')" "1"
  assert_line_equals "${MOCK_GH_EDIT_LOG}" 1 "239"
}

test_suite_changed_and_first_bootstrap() {
  local spec_path="docs/dev/specs/FR-0008-demo/spec.md"
  local title="FR-0008 Demo"
  local base_sha

  setup_case_dir "suite-changed-bootstrap"
  create_formal_suite "${spec_path}" "${title}" "239"
  write_map_file "${spec_path}:239"
  seed_issue 239 "plain issue title" "legacy body"
  git_commit_all "base"
  base_sha="$(current_head_sha)"

  append_line "${spec_path}" "- suite changed and should bootstrap"
  git_commit_all "head"

  assert_pass run_spec_guard "${base_sha}"
  assert_pass run_sync_workflow_push "${base_sha}" "$(current_head_sha)"

  assert_equal "$(issue_title 239)" "$(anchored_issue_title "${spec_path}" "${title}")"
  assert_file_contains "$(issue_body_path 239)" "Spec Path: ${spec_path}"
  assert_file_contains "$(issue_body_path 239)" "canonical FR 容器"
}

test_map_only_initial_mapping() {
  local spec_path="docs/dev/specs/FR-0008-demo/spec.md"
  local title="FR-0008 Demo"
  local base_sha

  setup_case_dir "map-only-initial-mapping"
  create_formal_suite "${spec_path}" "${title}"
  seed_issue 239 "plain issue title" "legacy body"
  git_commit_all "base"
  base_sha="$(current_head_sha)"

  write_map_file "${spec_path}:239"
  git_commit_all "head"

  assert_pass run_spec_guard "${base_sha}"
  assert_pass run_sync_workflow_push "${base_sha}" "$(current_head_sha)"

  assert_equal "$(issue_title 239)" "$(anchored_issue_title "${spec_path}" "${title}")"
  assert_file_contains "$(issue_body_path 239)" "Spec Path: ${spec_path}"
}

test_map_only_remap_to_anchored_issue() {
  local spec_path="docs/dev/specs/FR-0008-demo/spec.md"
  local title="FR-0008 Demo"
  local base_sha

  setup_case_dir "map-only-remap-anchored"
  create_formal_suite "${spec_path}" "${title}"
  write_map_file "${spec_path}:239"
  seed_issue 239 "$(anchored_issue_title "${spec_path}" "${title}")" "old canonical body"
  seed_issue 240 "$(anchored_issue_title "${spec_path}" "${title}")" "new canonical body"
  git_commit_all "base"
  base_sha="$(current_head_sha)"

  write_map_file "${spec_path}:240"
  git_commit_all "head"

  assert_pass run_spec_guard "${base_sha}"
  : > "${MOCK_GH_EDIT_LOG}"
  assert_pass run_sync_workflow_push "${base_sha}" "$(current_head_sha)"

  assert_line_equals "${MOCK_GH_EDIT_LOG}" 1 "240"
  assert_line_equals "${MOCK_GH_EDIT_LOG}" 2 "239"
  assert_equal "$(issue_title 239)" "${title}"
  assert_equal "$(issue_title 240)" "$(anchored_issue_title "${spec_path}" "${title}")"
  assert_file_contains "$(issue_body_path 239)" "canonical FR 已迁移到 #240"
}

test_map_only_remap_to_unanchored_issue_hard_fails() {
  local spec_path="docs/dev/specs/FR-0008-demo/spec.md"
  local title="FR-0008 Demo"
  local base_sha
  local guard_output="${TEST_TMP_DIR}/map-only-remap-unanchored.guard.out"
  local workflow_output="${TEST_TMP_DIR}/map-only-remap-unanchored.workflow.out"
  local status

  setup_case_dir "map-only-remap-unanchored"
  create_formal_suite "${spec_path}" "${title}"
  write_map_file "${spec_path}:239"
  seed_issue 239 "$(anchored_issue_title "${spec_path}" "${title}")" "old canonical body"
  seed_issue 240 "plain issue title" "new issue without anchor"
  git_commit_all "base"
  base_sha="$(current_head_sha)"

  write_map_file "${spec_path}:240"
  git_commit_all "head"

  if run_spec_guard "${base_sha}" > "${guard_output}" 2>&1; then
    echo "expected spec-guard to fail for remap to unanchored issue" >&2
    exit 1
  fi
  assert_file_contains "${guard_output}" "尚未满足受控同步前置"

  : > "${MOCK_GH_EDIT_LOG}"
  set +e
  run_sync_workflow_push "${base_sha}" "$(current_head_sha)" > "${workflow_output}" 2>&1
  status=$?
  set -e
  if [[ "${status}" -eq 0 ]]; then
    echo "expected workflow to fail for remap to unanchored issue" >&2
    exit 1
  fi
  assert_equal "${status}" "44"
  assert_file_contains "${workflow_output}" "拒绝 remapped ${spec_path} -> #240"
  assert_file_empty "${MOCK_GH_EDIT_LOG}"
}

test_suite_and_remap_to_unanchored_issue_with_explicit_canonical_issue() {
  local spec_path="docs/dev/specs/FR-0008-demo/spec.md"
  local title="FR-0008 Demo"
  local base_sha

  setup_case_dir "suite-remap-bootstrap"
  create_formal_suite "${spec_path}" "${title}"
  write_map_file "${spec_path}:239"
  seed_issue 239 "$(anchored_issue_title "${spec_path}" "${title}")" "old canonical body"
  seed_issue 240 "plain issue title" "new issue without anchor"
  git_commit_all "base"
  base_sha="$(current_head_sha)"

  set_canonical_issue_marker "${spec_path}" "240"
  append_line "${spec_path}" "- remap with explicit canonical issue"
  write_map_file "${spec_path}:240"
  git_commit_all "head"

  assert_pass run_spec_guard "${base_sha}"
  : > "${MOCK_GH_EDIT_LOG}"
  assert_pass run_sync_workflow_push "${base_sha}" "$(current_head_sha)"

  assert_line_equals "${MOCK_GH_EDIT_LOG}" 1 "240"
  assert_line_equals "${MOCK_GH_EDIT_LOG}" 2 "239"
  assert_equal "$(issue_title 240)" "$(anchored_issue_title "${spec_path}" "${title}")"
  assert_equal "$(issue_title 239)" "${title}"
  assert_file_contains "$(issue_body_path 240)" "Spec Path: ${spec_path}"
  assert_file_contains "$(issue_body_path 239)" "canonical FR 已迁移到 #240"
}

test_future_mapping_unlanded_spec_is_skipped() {
  local spec_path="docs/dev/specs/FR-0008-demo/spec.md"
  local future_spec_path="docs/dev/specs/FR-0099-future/spec.md"
  local title="FR-0008 Demo"
  local base_sha
  local workflow_output="${TEST_TMP_DIR}/future-mapping.workflow.out"

  setup_case_dir "future-mapping"
  create_formal_suite "${spec_path}" "${title}"
  write_map_file "${spec_path}:239"
  seed_issue 239 "$(anchored_issue_title "${spec_path}" "${title}")" "anchored body"
  seed_issue 240 "future issue" "future body"
  git_commit_all "base"
  base_sha="$(current_head_sha)"

  write_map_file "${spec_path}:239" "${future_spec_path}:240"
  git_commit_all "head"

  assert_pass run_spec_guard "${base_sha}"
  : > "${MOCK_GH_EDIT_LOG}"
  assert_pass run_sync_workflow_push "${base_sha}" "$(current_head_sha)" > "${workflow_output}" 2>&1

  assert_file_contains "${workflow_output}" "跳过 ${future_spec_path}：对应 spec.md 尚未落地"
  assert_file_empty "${MOCK_GH_EDIT_LOG}"
  assert_equal "$(issue_title 240)" "future issue"
}

test_first_full_map_migration_bootstraps_only_base_existing_specs() {
  local spec_a="docs/dev/specs/FR-0008-demo/spec.md"
  local spec_b="docs/dev/specs/FR-0009-demo/spec.md"
  local future_spec="docs/dev/specs/FR-0099-future/spec.md"
  local base_sha

  setup_case_dir "first-full-map-migration"
  create_formal_suite "${spec_a}" "FR-0008 Demo"
  create_formal_suite "${spec_b}" "FR-0009 Demo"
  seed_issue 239 "plain issue 239" "legacy body"
  seed_issue 240 "plain issue 240" "legacy body"
  seed_issue 241 "future issue 241" "future body"
  git_commit_all "base"
  base_sha="$(current_head_sha)"

  write_map_file "${spec_a}:239" "${spec_b}:240" "${future_spec}:241"
  git_commit_all "head"

  assert_pass run_spec_guard "${base_sha}"
  : > "${MOCK_GH_EDIT_LOG}"
  assert_pass run_sync_workflow_push "${base_sha}" "$(current_head_sha)"

  assert_equal "$(wc -l < "${MOCK_GH_EDIT_LOG}" | tr -d ' ')" "2"
  assert_file_contains "$(issue_body_path 239)" "Spec Path: ${spec_a}"
  assert_file_contains "$(issue_body_path 240)" "Spec Path: ${spec_b}"
  assert_equal "$(issue_title 241)" "future issue 241"
}

test_remap_retry_safe_after_second_issue_edit_failure() {
  local spec_path="docs/dev/specs/FR-0008-demo/spec.md"
  local title="FR-0008 Demo"
  local base_sha
  local first_run_output="${TEST_TMP_DIR}/remap-retry.first.out"
  local status

  setup_case_dir "remap-retry-safe"
  create_formal_suite "${spec_path}" "${title}"
  write_map_file "${spec_path}:239"
  seed_issue 239 "$(anchored_issue_title "${spec_path}" "${title}")" "old canonical body"
  seed_issue 240 "plain issue title" "new issue without anchor"
  git_commit_all "base"
  base_sha="$(current_head_sha)"

  set_canonical_issue_marker "${spec_path}" "240"
  append_line "${spec_path}" "- remap with retry-safe rerun"
  write_map_file "${spec_path}:240"
  git_commit_all "head"

  assert_pass run_spec_guard "${base_sha}"
  set_issue_edit_failures 239 1

  set +e
  run_sync_workflow_push "${base_sha}" "$(current_head_sha)" > "${first_run_output}" 2>&1
  status=$?
  set -e
  if [[ "${status}" -eq 0 ]]; then
    echo "expected first remap run to fail on old issue demotion" >&2
    exit 1
  fi
  assert_equal "${status}" "1"
  assert_line_equals "${MOCK_GH_EDIT_LOG}" 1 "240"
  assert_line_equals "${MOCK_GH_EDIT_LOG}" 2 "239"
  assert_equal "$(issue_title 240)" "$(anchored_issue_title "${spec_path}" "${title}")"
  assert_equal "$(issue_title 239)" "$(anchored_issue_title "${spec_path}" "${title}")"
  assert_file_contains "$(issue_body_path 240)" "Spec Path: ${spec_path}"
  assert_file_not_contains "$(issue_body_path 239)" "canonical FR 已迁移到 #240"

  : > "${MOCK_GH_EDIT_LOG}"
  assert_pass run_sync_workflow_push "${base_sha}" "$(current_head_sha)"
  assert_line_equals "${MOCK_GH_EDIT_LOG}" 1 "240"
  assert_line_equals "${MOCK_GH_EDIT_LOG}" 2 "239"
  assert_equal "$(issue_title 239)" "${title}"
  assert_file_contains "$(issue_body_path 239)" "canonical FR 已迁移到 #240"
}

test_non_markdown_suite_file_changes_route_to_owning_spec() {
  local spec_path="docs/dev/specs/FR-0008-demo/spec.md"
  local title="FR-0008 Demo"
  local suite_dir="docs/dev/specs/FR-0008-demo"
  local base_sha

  setup_case_dir "non-markdown-suite-change"
  create_formal_suite "${spec_path}" "${title}" "" "yaml"
  cat > "${CURRENT_REPO_DIR}/${suite_dir}/contracts/sample.json" <<'EOF'
{"kind":"spec-sync-contract","version":1}
EOF
  write_map_file "${spec_path}:239"
  seed_issue 239 "$(anchored_issue_title "${spec_path}" "${title}")" "legacy body"
  git_commit_all "base"
  base_sha="$(current_head_sha)"

  append_line "${suite_dir}/contracts/sample.yaml" "channel: yaml-update"
  append_line "${suite_dir}/contracts/sample.json" "\"updated\": true"
  git_commit_all "head"

  assert_pass run_spec_guard "${base_sha}"
  : > "${MOCK_GH_EDIT_LOG}"
  assert_pass run_sync_workflow_push "${base_sha}" "$(current_head_sha)"

  assert_equal "$(wc -l < "${MOCK_GH_EDIT_LOG}" | tr -d ' ')" "1"
  assert_line_equals "${MOCK_GH_EDIT_LOG}" 1 "239"
  assert_file_contains "$(issue_body_path 239)" "Spec Path: ${spec_path}"
}

test_target_scoped_validation_ignores_unrelated_unanchored_issue() {
  local spec_a="docs/dev/specs/FR-0008-demo/spec.md"
  local spec_b="docs/dev/specs/FR-0009-demo/spec.md"
  local base_sha

  setup_case_dir "target-scoped-validation"
  create_formal_suite "${spec_a}" "FR-0008 Demo"
  create_formal_suite "${spec_b}" "FR-0009 Demo"
  write_map_file "${spec_a}:239" "${spec_b}:240"
  seed_issue 239 "$(anchored_issue_title "${spec_a}" "FR-0008 Demo")" "legacy body"
  seed_issue 240 "plain issue title" "unrelated issue without anchor"
  git_commit_all "base"
  base_sha="$(current_head_sha)"

  append_line "${spec_a}" "- changed spec A only"
  git_commit_all "head"

  assert_pass run_spec_guard "${base_sha}"
  : > "${MOCK_GH_EDIT_LOG}"
  assert_pass run_sync_workflow_push "${base_sha}" "$(current_head_sha)"

  assert_equal "$(wc -l < "${MOCK_GH_EDIT_LOG}" | tr -d ' ')" "1"
  assert_line_equals "${MOCK_GH_EDIT_LOG}" 1 "239"
  assert_equal "$(issue_title 240)" "plain issue title"
}

test_test_gate_wires_spec_sync_contract_tests() {
  setup_case_dir "test-gate-wiring"

  assert_file_contains "${CURRENT_REPO_DIR}/.github/workflows/test-gate.yml" "bash tests/spec-issue-sync.contract.test.sh"
  assert_file_contains "${CURRENT_REPO_DIR}/.github/workflows/test-gate.yml" "scripts/spec-issue-sync.sh"
  assert_file_contains "${CURRENT_REPO_DIR}/.github/workflows/test-gate.yml" "scripts/spec-issue-sync-map.sh"
  assert_file_contains "${CURRENT_REPO_DIR}/.github/workflows/test-gate.yml" "scripts/spec-guard.sh"
  assert_file_contains "${CURRENT_REPO_DIR}/.github/workflows/test-gate.yml" "tests/spec-issue-sync.contract"
}
