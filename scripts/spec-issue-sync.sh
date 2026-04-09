#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

die() {
  echo "错误: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少依赖命令: $1"
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

extract_spec_path_from_title() {
  local title="$1"
  local candidate normalized

  candidate="$(sed -n 's/^\[\([^]]\+\)\].*/\1/p' <<< "${title}")"
  normalized="$(normalize_spec_path "${candidate}" || true)"
  if [[ -n "${normalized}" ]]; then
    printf '%s\n' "${normalized}"
  fi
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

assert_issue_anchor() {
  local issue_number="$1"
  local issue_title="$2"
  local issue_body_file="$3"
  local spec_path="$4"
  local meta_spec title_spec

  meta_spec="$(extract_issue_spec_path "${issue_body_file}" || true)"
  title_spec="$(extract_spec_path_from_title "${issue_title}" || true)"

  if [[ -n "${meta_spec}" ]]; then
    meta_spec="$(normalize_spec_path "${meta_spec}" || true)"
  fi

  if [[ -n "${meta_spec}" ]] && [[ "${meta_spec}" != "${spec_path}" ]]; then
    die "Issue #${issue_number} 已绑定 ${meta_spec}，拒绝同步到 ${spec_path}"
  fi

  if [[ -n "${title_spec}" ]] && [[ "${title_spec}" != "${spec_path}" ]]; then
    die "Issue #${issue_number} 标题锚定 ${title_spec}，拒绝同步到 ${spec_path}"
  fi

  if [[ -z "${meta_spec}" ]] && [[ -z "${title_spec}" ]]; then
    die "Issue #${issue_number} 缺少 FR 锚定信息，拒绝同步到 ${spec_path}"
  fi
}

check_issue_anchor() {
  local repo="$1"
  local spec_path="$2"
  local issue_number="$3"
  local tmp_body issue_title

  tmp_body="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-issue-body.XXXXXX")"
  trap 'rm -f "${tmp_body:-}"' RETURN

  gh issue view "${issue_number}" --repo "${repo}" --json body --jq .body > "${tmp_body}"
  issue_title="$(gh issue view "${issue_number}" --repo "${repo}" --json title --jq .title)"
  assert_issue_anchor "${issue_number}" "${issue_title}" "${tmp_body}" "${spec_path}"
}

sync_issue() {
  local repo="$1"
  local spec_path="$2"
  local issue_number="$3"
  local title issue_title tmp_body cleaned_body final_body meta_block issue_title_raw

  title="$(extract_title "${spec_path}")"
  [[ -n "${title}" ]] || die "无法从 ${spec_path} 提取标题"

  issue_title="[${spec_path#docs/dev/specs/}"
  issue_title="${issue_title%%/spec.md}] ${title}"

  tmp_body="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-issue-body.XXXXXX")"
  cleaned_body="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-issue-clean.XXXXXX")"
  final_body="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-issue-final.XXXXXX")"
  trap 'rm -f "${tmp_body:-}" "${cleaned_body:-}" "${final_body:-}"' RETURN

  gh issue view "${issue_number}" --repo "${repo}" --json body --jq .body > "${tmp_body}"
  issue_title_raw="$(gh issue view "${issue_number}" --repo "${repo}" --json title --jq .title)"
  assert_issue_anchor "${issue_number}" "${issue_title_raw}" "${tmp_body}" "${spec_path}"
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
  bash scripts/spec-issue-sync.sh check-anchor <repo> <spec_path> <issue_number>
EOF
}

main() {
  require_cmd gh
  require_cmd mktemp
  require_cmd perl
  require_cmd sed

  case "${1:-}" in
    sync)
      shift
      [[ "$#" -eq 3 ]] || die "sync 需要 <repo> <spec_path> <issue_number>"
      sync_issue "$1" "$2" "$3"
      ;;
    check-anchor)
      shift
      [[ "$#" -eq 3 ]] || die "check-anchor 需要 <repo> <spec_path> <issue_number>"
      check_issue_anchor "$1" "$2" "$3"
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
