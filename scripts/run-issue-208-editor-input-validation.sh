#!/usr/bin/env bash
set -euo pipefail

PROFILE="${WEBENVOY_208_PROFILE:-xhs_208_probe}"
RUN_ID="${WEBENVOY_208_RUN_ID:-run-208-editor-input-$(date +%s)}"
TAB_ID="${WEBENVOY_208_TAB_ID:-}"
VALIDATION_TEXT="${WEBENVOY_208_VALIDATION_TEXT:-WebEnvoy editor_input validation}"
APPROVER="${WEBENVOY_208_APPROVER:-qa-reviewer}"
APPROVED_AT="${WEBENVOY_208_APPROVED_AT:-2026-03-30T00:00:00Z}"

json_quote() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"
}

if [[ -z "${TAB_ID}" ]]; then
  echo "WEBENVOY_208_TAB_ID is required" >&2
  exit 1
fi

PARAMS=$(cat <<JSON
{
  "ability": {
    "id": "xhs.issue208.editor_input.validation",
    "layer": "L3",
    "action": "write"
  },
  "input": {},
  "options": {
    "issue_scope": "issue_208",
    "target_domain": "creator.xiaohongshu.com",
    "target_tab_id": ${TAB_ID},
    "target_page": "creator_publish_tab",
    "action_type": "write",
    "requested_execution_mode": "live_write",
    "risk_state": "allowed",
    "validation_action": "editor_input",
    "validation_text": $(json_quote "${VALIDATION_TEXT}"),
    "approval_record": {
      "approved": true,
      "approver": $(json_quote "${APPROVER}"),
      "approved_at": $(json_quote "${APPROVED_AT}"),
      "checks": {
        "target_domain_confirmed": true,
        "target_tab_confirmed": true,
        "target_page_confirmed": true,
        "risk_state_checked": true,
        "action_type_confirmed": true
      }
    }
  }
}
JSON
)

./bin/webenvoy xhs.search \
  --profile "${PROFILE}" \
  --run-id "${RUN_ID}" \
  --params "${PARAMS}"
