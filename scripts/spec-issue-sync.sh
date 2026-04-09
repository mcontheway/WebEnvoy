#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ANCHOR_CONFLICT_EXIT=42
ANCHOR_MISSING_EXIT=43
SAFE_REMAP_REQUIRED_EXIT=44
ANCHOR_STATUS_MESSAGE=""

die() {
  echo "错误: $*" >&2
  exit 1
}

warn() {
  echo "[spec-issue-sync] 提示: $*" >&2
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少依赖命令: $1"
}

fetch_issue_snapshot() {
  local repo="$1"
  local issue_number="$2"
  local output_file="$3"
  local endpoint status attempt
  local stderr_file

  endpoint="repos/${repo}/issues/${issue_number}"
  stderr_file="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-issue-fetch.XXXXXX")"

  for attempt in 1 2 3; do
    if gh api "${endpoint}" > "${output_file}" 2> "${stderr_file}"; then
      rm -f "${stderr_file}"
      return 0
    fi

    status=$?
    if [[ "${attempt}" -lt 3 ]] && grep -Eq 'HTTP 5[0-9][0-9]|timed out|EOF|connection reset|TLS handshake timeout' "${stderr_file}"; then
      warn "读取 issue #${issue_number} 时遇到瞬时错误，准备重试 (${attempt}/3)"
      sleep $((attempt * 2))
      continue
    fi

    cat "${stderr_file}" >&2
    rm -f "${stderr_file}"
    return "${status}"
  done

  cat "${stderr_file}" >&2
  rm -f "${stderr_file}"
  return 1
}

extract_issue_snapshot_field() {
  local snapshot_file="$1"
  local field="$2"

  perl -MJSON::PP -0ne '
    BEGIN {
      $field = shift @ARGV;
    }
    my $decoded = decode_json($_);
    my $value = $decoded->{$field};
    print $value if defined $value;
  ' -- "${field}" "${snapshot_file}"
}

extract_title() {
  local spec_path="$1"
  sed -n '1s/^# //p' "${REPO_ROOT}/${spec_path}"
}

extract_meta_value() {
  local body_file="$1"
  local key="$2"

  perl -0ne '
    BEGIN {
      $key = shift @ARGV;
    }
    if (/<\!-- webenvoy-spec-meta:start -->\n(.*?)\n<\!-- webenvoy-spec-meta:end -->/s) {
      my $block = $1;
      if ($block =~ /^\Q$key\E:\s*(.+)$/m) {
        print $1;
      }
    }
  ' -- "${key}" "${body_file}"
}

extract_issue_spec_path() {
  local body_file="$1"

  perl -0ne '
    if (/<\!-- webenvoy-spec-meta:start -->\n(.*?)\n<\!-- webenvoy-spec-meta:end -->/s) {
      my $block = $1;
      if ($block =~ /^Spec Path:\s*(.+)$/m) {
        print $1;
      }
    }
  ' "${body_file}"
}

normalize_spec_path() {
  local value="$1"

  if [[ -z "${value}" ]]; then
    return 1
  fi

  if [[ "${value}" =~ ^docs/dev/specs/FR-[0-9]{4}-[^/]+/spec\.md$ ]]; then
    printf '%s\n' "${value}"
    return 0
  fi

  if [[ "${value}" =~ ^FR-[0-9]{4}-[^/]+/spec\.md$ ]]; then
    printf 'docs/dev/specs/%s\n' "${value}"
    return 0
  fi

  if [[ "${value}" =~ ^FR-[0-9]{4}-[^/]+$ ]]; then
    printf 'docs/dev/specs/%s/spec.md\n' "${value}"
    return 0
  fi

  return 1
}

suite_dir_for_spec() {
  local spec_path="$1"
  printf '%s/%s\n' "${REPO_ROOT}" "${spec_path%/spec.md}"
}

suite_mentions_issue() {
  local spec_path="$1"
  local issue_number="$2"
  local marker_lines marker_count
  local spec_file="${REPO_ROOT}/${spec_path}"

  [[ -f "${spec_file}" ]] || return 1

  marker_lines="$(
    awk '
      /^[[:space:]]*(-[[:space:]]*)?Canonical Issue:[[:space:]]*#[0-9]+[[:space:]]*$/ {
        value = $0
        sub(/^[[:space:]]*(-[[:space:]]*)?Canonical Issue:[[:space:]]*#/, "", value)
        sub(/[[:space:]]*$/, "", value)
        print value
      }
    ' "${spec_file}"
  )"
  marker_lines="$(printf '%s\n' "${marker_lines}" | sed '/^$/d')"
  marker_count="$(printf '%s\n' "${marker_lines}" | sed '/^$/d' | wc -l | tr -d ' ')"

  [[ "${marker_count}" == "1" ]] || return 1
  [[ "${marker_lines}" == "${issue_number}" ]]
}

extract_spec_path_from_title() {
  local title="$1"
  local candidate normalized

  candidate="$(sed -n 's/^\[\([^]][^]]*\)\].*/\1/p' <<< "${title}")"
  normalized="$(normalize_spec_path "${candidate}" || true)"
  if [[ -n "${normalized}" ]]; then
    printf '%s\n' "${normalized}"
  fi
}

demoted_issue_title() {
  local title="$1"
  local stripped

  stripped="$(sed 's/^\[[^]]*\][[:space:]]*//' <<< "${title}")"
  if [[ -n "${stripped}" ]]; then
    printf '%s\n' "${stripped}"
    return
  fi

  printf '%s\n' "${title}"
}

default_meta_value() {
  local key="$1"

  case "${key}" in
    Parent) printf 'TBD\n' ;;
    Lifecycle) printf 'TBD\n' ;;
    Track) printf 'TBD\n' ;;
    Layer) printf 'N/A\n' ;;
    Platform) printf 'N/A\n' ;;
    'Risk Lane') printf 'general\n' ;;
    'Close Semantics') printf 'fr-complete\n' ;;
    *) die "未知元数据键: ${key}" ;;
  esac
}

normalized_meta_block() {
  local raw_file="$1"
  local spec_path="$2"
  local parent lifecycle track layer platform risk_lane close_semantics

  parent="$(extract_meta_value "${raw_file}" "Parent" || true)"
  lifecycle="$(extract_meta_value "${raw_file}" "Lifecycle" || true)"
  track="$(extract_meta_value "${raw_file}" "Track" || true)"
  layer="$(extract_meta_value "${raw_file}" "Layer" || true)"
  platform="$(extract_meta_value "${raw_file}" "Platform" || true)"
  risk_lane="$(extract_meta_value "${raw_file}" "Risk Lane" || true)"
  close_semantics="$(extract_meta_value "${raw_file}" "Close Semantics" || true)"

  parent="${parent:-$(default_meta_value "Parent")}"
  lifecycle="${lifecycle:-$(default_meta_value "Lifecycle")}"
  track="${track:-$(default_meta_value "Track")}"
  layer="${layer:-$(default_meta_value "Layer")}"
  platform="${platform:-$(default_meta_value "Platform")}"
  risk_lane="${risk_lane:-$(default_meta_value "Risk Lane")}"
  close_semantics="${close_semantics:-$(default_meta_value "Close Semantics")}"

  cat <<EOF
<!-- webenvoy-spec-meta:start -->
Type: FR
Parent: ${parent}
Spec Path: ${spec_path}
Lifecycle: ${lifecycle}
Track: ${track}
Layer: ${layer}
Platform: ${platform}
Risk Lane: ${risk_lane}
Close Semantics: ${close_semantics}
<!-- webenvoy-spec-meta:end -->
EOF
}

strip_legacy_generated_header() {
  local input_file="$1"

  perl -0pe '
    s/^此 Issue 由 CI 自动同步维护。\n\n(?:## 类型定位\n(?:- .*\n)+\n)?(?:- 规范路径：`[^`]+`\n)?(?:- 对应正式规约：`[^`]+`\n)?(?:- 目录标识：`[^`]+`\n)?\n?(?:如需修订正式契约，请修改对应 `spec\.md` 并通过独立 PR 合入。\n?)?//s;
    s/<\!-- webenvoy-spec-meta:start -->\n.*?\n<\!-- webenvoy-spec-meta:end -->\n?//s;
    s/^\n*(?:此 Issue 为 canonical FR 容器；正式契约由 `spec\.md` 合入主干后受控同步。\n\n)+//s;
  ' "${input_file}"
}

issue_anchor_status() {
  local issue_number="$1"
  local issue_title="$2"
  local issue_body_file="$3"
  local spec_path="$4"
  local meta_spec title_spec

  ANCHOR_STATUS_MESSAGE=""
  meta_spec="$(extract_issue_spec_path "${issue_body_file}" || true)"
  title_spec="$(extract_spec_path_from_title "${issue_title}" || true)"

  if [[ -n "${meta_spec}" ]]; then
    meta_spec="$(normalize_spec_path "${meta_spec}" || true)"
  fi

  if [[ -n "${meta_spec}" ]] && [[ "${meta_spec}" != "${spec_path}" ]]; then
    ANCHOR_STATUS_MESSAGE="Issue #${issue_number} 已绑定 ${meta_spec}，拒绝同步到 ${spec_path}"
    return "${ANCHOR_CONFLICT_EXIT}"
  fi

  if [[ -n "${title_spec}" ]] && [[ "${title_spec}" != "${spec_path}" ]]; then
    ANCHOR_STATUS_MESSAGE="Issue #${issue_number} 标题锚定 ${title_spec}，拒绝同步到 ${spec_path}"
    return "${ANCHOR_CONFLICT_EXIT}"
  fi

  if [[ -z "${meta_spec}" ]] && [[ -z "${title_spec}" ]]; then
    ANCHOR_STATUS_MESSAGE="Issue #${issue_number} 缺少 FR 锚定信息，拒绝同步到 ${spec_path}"
    return "${ANCHOR_MISSING_EXIT}"
  fi

  return 0
}

assert_issue_anchor() {
  local status=0

  if issue_anchor_status "$@"; then
    return 0
  else
    status=$?
  fi

  [[ -n "${ANCHOR_STATUS_MESSAGE}" ]] && printf '%s\n' "${ANCHOR_STATUS_MESSAGE}" >&2
  exit "${status}"
}

assert_syncable_issue_anchor() {
  local status=0
  local issue_number="$1"
  local spec_path="$4"
  local allow_missing_anchor_bootstrap="${5:-false}"

  if issue_anchor_status "$@"; then
    return 0
  else
    status=$?
  fi

  if [[ "${status}" -eq "${ANCHOR_MISSING_EXIT}" ]]; then
    if [[ "${allow_missing_anchor_bootstrap}" == "true" ]]; then
      return 0
    fi
  fi

  [[ -n "${ANCHOR_STATUS_MESSAGE}" ]] && printf '%s\n' "${ANCHOR_STATUS_MESSAGE}" >&2
  exit "${status}"
}

check_issue_anchor() {
  local repo="$1"
  local spec_path="$2"
  local issue_number="$3"
  local tmp_body tmp_snapshot issue_title

  tmp_body="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-issue-body.XXXXXX")"
  tmp_snapshot="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-issue-snapshot.XXXXXX")"
  trap 'rm -f "${tmp_body:-}" "${tmp_snapshot:-}"' RETURN

  fetch_issue_snapshot "${repo}" "${issue_number}" "${tmp_snapshot}"
  extract_issue_snapshot_field "${tmp_snapshot}" body > "${tmp_body}"
  issue_title="$(extract_issue_snapshot_field "${tmp_snapshot}" title)"
  assert_issue_anchor "${issue_number}" "${issue_title}" "${tmp_body}" "${spec_path}"
}

can_sync_map_remap() {
  local repo="$1"
  local spec_path="$2"
  local old_issue_number="$3"
  local issue_number="$4"
  local tmp_body tmp_snapshot issue_title status=0

  tmp_body="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-issue-body.XXXXXX")"
  tmp_snapshot="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-issue-snapshot.XXXXXX")"
  trap 'rm -f "${tmp_body:-}" "${tmp_snapshot:-}"' RETURN

  fetch_issue_snapshot "${repo}" "${old_issue_number}" "${tmp_snapshot}"
  extract_issue_snapshot_field "${tmp_snapshot}" body > "${tmp_body}"
  issue_title="$(extract_issue_snapshot_field "${tmp_snapshot}" title)"

  if issue_anchor_status "${old_issue_number}" "${issue_title}" "${tmp_body}" "${spec_path}"; then
    :
  else
    status=$?
  fi

  if [[ "${status}" -ne 0 ]] && [[ "${status}" -ne "${ANCHOR_MISSING_EXIT}" ]] && [[ "${status}" -ne "${ANCHOR_CONFLICT_EXIT}" ]]; then
    [[ -n "${ANCHOR_STATUS_MESSAGE}" ]] && printf '%s\n' "${ANCHOR_STATUS_MESSAGE}" >&2
    return "${status}"
  fi

  fetch_issue_snapshot "${repo}" "${issue_number}" "${tmp_snapshot}"
  extract_issue_snapshot_field "${tmp_snapshot}" body > "${tmp_body}"
  issue_title="$(extract_issue_snapshot_field "${tmp_snapshot}" title)"

  if issue_anchor_status "${issue_number}" "${issue_title}" "${tmp_body}" "${spec_path}"; then
    return 0
  else
    status=$?
  fi

  if [[ "${status}" -eq "${ANCHOR_MISSING_EXIT}" ]]; then
    if suite_mentions_issue "${spec_path}" "${issue_number}"; then
      return 0
    fi

    printf 'Issue #%s 缺少 FR 锚定信息；remap 仅允许在 formal suite 显式声明 Canonical Issue 时首次补锚到 %s\n' \
      "${issue_number}" "${spec_path}" >&2
    return "${SAFE_REMAP_REQUIRED_EXIT}"
  fi

  [[ -n "${ANCHOR_STATUS_MESSAGE}" ]] && printf '%s\n' "${ANCHOR_STATUS_MESSAGE}" >&2
  return "${status}"
}

sync_map_remap() {
  local repo="$1"
  local spec_path="$2"
  local old_issue_number="$3"
  local new_issue_number="$4"
  local tmp_body tmp_snapshot cleaned_body final_body old_issue_title new_issue_title status=0
  local allow_missing_anchor_bootstrap=false

  tmp_body="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-issue-body.XXXXXX")"
  tmp_snapshot="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-issue-snapshot.XXXXXX")"
  cleaned_body="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-issue-clean.XXXXXX")"
  final_body="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-issue-final.XXXXXX")"
  trap 'rm -f "${tmp_body:-}" "${tmp_snapshot:-}" "${cleaned_body:-}" "${final_body:-}"' RETURN

  fetch_issue_snapshot "${repo}" "${new_issue_number}" "${tmp_snapshot}"
  extract_issue_snapshot_field "${tmp_snapshot}" body > "${tmp_body}"
  new_issue_title="$(extract_issue_snapshot_field "${tmp_snapshot}" title)"

  if issue_anchor_status "${new_issue_number}" "${new_issue_title}" "${tmp_body}" "${spec_path}"; then
    :
  else
    status=$?
  fi

  if [[ "${status}" -eq "${ANCHOR_MISSING_EXIT}" ]] && suite_mentions_issue "${spec_path}" "${new_issue_number}"; then
    allow_missing_anchor_bootstrap=true
  elif [[ "${status}" -ne 0 ]]; then
    [[ -n "${ANCHOR_STATUS_MESSAGE}" ]] && printf '%s\n' "${ANCHOR_STATUS_MESSAGE}" >&2
    return "${status}"
  fi

  sync_issue "${repo}" "${spec_path}" "${new_issue_number}" "${allow_missing_anchor_bootstrap}"

  status=0
  fetch_issue_snapshot "${repo}" "${old_issue_number}" "${tmp_snapshot}"
  extract_issue_snapshot_field "${tmp_snapshot}" body > "${tmp_body}"
  old_issue_title="$(extract_issue_snapshot_field "${tmp_snapshot}" title)"

  if issue_anchor_status "${old_issue_number}" "${old_issue_title}" "${tmp_body}" "${spec_path}"; then
    strip_legacy_generated_header "${tmp_body}" > "${cleaned_body}"
    {
      printf 'canonical FR 已迁移到 #%s；此 issue 不再作为 `%s` 的 canonical anchor。\n' \
        "${new_issue_number}" "${spec_path}"
      if [[ -s "${cleaned_body}" ]]; then
        printf '\n'
        cat "${cleaned_body}"
        printf '\n'
      fi
    } > "${final_body}"

    gh issue edit "${old_issue_number}" \
      --repo "${repo}" \
      --title "$(demoted_issue_title "${old_issue_title}")" \
      --body-file "${final_body}"
  else
    status=$?
    if [[ "${status}" -ne "${ANCHOR_MISSING_EXIT}" ]] && [[ "${status}" -ne "${ANCHOR_CONFLICT_EXIT}" ]]; then
      [[ -n "${ANCHOR_STATUS_MESSAGE}" ]] && printf '%s\n' "${ANCHOR_STATUS_MESSAGE}" >&2
      return "${status}"
    fi
  fi
}

sync_issue() {
  local repo="$1"
  local spec_path="$2"
  local issue_number="$3"
  local allow_missing_anchor_bootstrap="${4:-false}"
  local title issue_title tmp_body tmp_snapshot cleaned_body final_body meta_block issue_title_raw

  title="$(extract_title "${spec_path}")"
  [[ -n "${title}" ]] || die "无法从 ${spec_path} 提取标题"

  issue_title="[${spec_path#docs/dev/specs/}"
  issue_title="${issue_title%%/spec.md}] ${title}"

  tmp_body="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-issue-body.XXXXXX")"
  tmp_snapshot="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-issue-snapshot.XXXXXX")"
  cleaned_body="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-issue-clean.XXXXXX")"
  final_body="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-issue-final.XXXXXX")"
  trap 'rm -f "${tmp_body:-}" "${tmp_snapshot:-}" "${cleaned_body:-}" "${final_body:-}"' RETURN

  fetch_issue_snapshot "${repo}" "${issue_number}" "${tmp_snapshot}"
  extract_issue_snapshot_field "${tmp_snapshot}" body > "${tmp_body}"
  issue_title_raw="$(extract_issue_snapshot_field "${tmp_snapshot}" title)"
  assert_syncable_issue_anchor "${issue_number}" "${issue_title_raw}" "${tmp_body}" "${spec_path}" "${allow_missing_anchor_bootstrap}"
  strip_legacy_generated_header "${tmp_body}" > "${cleaned_body}"
  meta_block="$(normalized_meta_block "${tmp_body}" "${spec_path}")"

  {
    printf '%s\n\n' "${meta_block}"
    printf '此 Issue 为 canonical FR 容器；正式契约由 `spec.md` 合入主干后受控同步。\n\n'
    if [[ -s "${cleaned_body}" ]]; then
      cat "${cleaned_body}"
      printf '\n'
    else
      printf '如需修订正式契约，请修改对应 `spec.md` 并通过独立 PR 合入。\n'
    fi
  } > "${final_body}"

  gh issue edit "${issue_number}" \
    --repo "${repo}" \
    --title "${issue_title}" \
    --body-file "${final_body}"
}

usage() {
  cat <<'EOF'
用法:
  bash scripts/spec-issue-sync.sh sync <repo> <spec_path> <issue_number>
  bash scripts/spec-issue-sync.sh sync-bootstrap <repo> <spec_path> <issue_number>
  bash scripts/spec-issue-sync.sh check-anchor <repo> <spec_path> <issue_number>
  bash scripts/spec-issue-sync.sh can-sync-map-remap <repo> <spec_path> <old_issue_number> <new_issue_number>
  bash scripts/spec-issue-sync.sh sync-map-remap <repo> <spec_path> <old_issue_number> <new_issue_number>
  bash scripts/spec-issue-sync.sh suite-mentions-issue <spec_path> <issue_number>
EOF
}

main() {
  require_cmd gh
  require_cmd grep
  require_cmd mktemp
  require_cmd perl
  require_cmd sed

  case "${1:-}" in
    sync)
      shift
      [[ "$#" -eq 3 ]] || die "sync 需要 <repo> <spec_path> <issue_number>"
      sync_issue "$1" "$2" "$3"
      ;;
    sync-bootstrap)
      shift
      [[ "$#" -eq 3 ]] || die "sync-bootstrap 需要 <repo> <spec_path> <issue_number>"
      sync_issue "$1" "$2" "$3" true
      ;;
    check-anchor)
      shift
      [[ "$#" -eq 3 ]] || die "check-anchor 需要 <repo> <spec_path> <issue_number>"
      check_issue_anchor "$1" "$2" "$3"
      ;;
    can-sync-map-remap)
      shift
      [[ "$#" -eq 4 ]] || die "can-sync-map-remap 需要 <repo> <spec_path> <old_issue_number> <new_issue_number>"
      can_sync_map_remap "$1" "$2" "$3" "$4"
      ;;
    sync-map-remap)
      shift
      [[ "$#" -eq 4 ]] || die "sync-map-remap 需要 <repo> <spec_path> <old_issue_number> <new_issue_number>"
      sync_map_remap "$1" "$2" "$3" "$4"
      ;;
    suite-mentions-issue)
      shift
      [[ "$#" -eq 2 ]] || die "suite-mentions-issue 需要 <spec_path> <issue_number>"
      suite_mentions_issue "$1" "$2"
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
