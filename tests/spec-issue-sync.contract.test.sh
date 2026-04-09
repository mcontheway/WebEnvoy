#!/usr/bin/env bash

set -euo pipefail

SPEC_SYNC_CONTRACT_TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SPEC_SYNC_CONTRACT_TEST_DIR}/spec-issue-sync.contract/lib.sh"
source "${SPEC_SYNC_CONTRACT_TEST_DIR}/spec-issue-sync.contract/cases.sh"

main() {
  setup_mock_gh

  test_suite_changed_and_already_anchored
  test_suite_changed_and_first_bootstrap
  test_map_only_initial_mapping
  test_map_only_remap_to_anchored_issue
  test_map_only_remap_to_unanchored_issue_hard_fails
  test_suite_and_remap_to_unanchored_issue_with_explicit_canonical_issue
  test_future_mapping_unlanded_spec_is_skipped
  test_first_full_map_migration_bootstraps_only_base_existing_specs
  test_remap_retry_safe_after_second_issue_edit_failure
  test_non_markdown_suite_file_changes_route_to_owning_spec
  test_target_scoped_validation_ignores_unrelated_unanchored_issue
  test_test_gate_wires_spec_sync_contract_tests

  echo "spec-issue-sync contract test passed."
}

main "$@"
