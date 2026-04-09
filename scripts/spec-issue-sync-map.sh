#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MAP_FILE="${REPO_ROOT}/.github/spec-issue-sync-map.yml"
SPEC_PATH_REGEX='^docs/dev/specs/FR-[0-9][0-9][0-9][0-9]-[^/]+/spec\.md$'
ANCHOR_MISSING_EXIT=43

die() {
  echo "错误: $*" >&2
  exit 1
}

warn() {
  echo "[spec-issue-sync-map] 提示: $*" >&2
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少依赖命令: $1"
}

parse_map_entries_file() {
  local map_file="$1"

  [[ -f "${map_file}" ]] || return 0

  awk '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ || /^[[:space:]]*mappings:[[:space:]]*$/ { next }
    /^[[:space:]]*-[[:space:]]+spec_path:[[:space:]]*/ {
      line = $0
      sub(/^[[:space:]]*-[[:space:]]+spec_path:[[:space:]]*/, "", line)
      spec_path = line
      next
    }
    /^[[:space:]]*canonical_issue_number:[[:space:]]*[0-9]+[[:space:]]*$/ {
      line = $0
      sub(/^[[:space:]]*canonical_issue_number:[[:space:]]*/, "", line)
      if (spec_path == "") {
        exit 21
      }
      print spec_path "\t" line
      spec_path = ""
      next
    }
    {
      exit 22
    }
    END {
      if (spec_path != "") {
        exit 23
      }
    }
  ' "${map_file}"
}

parse_map_entries() {
  parse_map_entries_file "${MAP_FILE}"
}

list_spec_files() {
  local specs_root="${REPO_ROOT}/docs/dev/specs"

  [[ -d "${specs_root}" ]] || die "缺少正式 spec 根目录: ${specs_root}"
  find "${specs_root}" -type f -name 'spec.md' \
    | sed "s#^${REPO_ROOT}/##" \
    | sort -u
}

validate_map() {
  local entries seen_specs seen_issues spec_path issue_number spec_files current_specs missing_specs stale_map_entries spec_abs todo_file anchor_pattern

  [[ -f "${MAP_FILE}" ]] || die "缺少同步映射文件: ${MAP_FILE}"
  [[ -s "${MAP_FILE}" ]] || die "同步映射文件为空: ${MAP_FILE}"

  entries="$(parse_map_entries)" || die "同步映射文件格式无效: ${MAP_FILE}"
  [[ -n "${entries}" ]] || die "同步映射文件没有任何映射项: ${MAP_FILE}"

  seen_specs="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-sync-map-specs.XXXXXX")"
  seen_issues="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-sync-map-issues.XXXXXX")"
  current_specs="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-sync-map-current-specs.XXXXXX")"
  missing_specs="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-sync-map-missing-specs.XXXXXX")"
  future_map_entries="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-sync-map-future-map-entries.XXXXXX")"
  trap 'rm -f "${seen_specs:-}" "${seen_issues:-}" "${current_specs:-}" "${missing_specs:-}" "${future_map_entries:-}"' RETURN

  while IFS=$'\t' read -r spec_path issue_number; do
    [[ "${spec_path}" =~ ${SPEC_PATH_REGEX} ]] || die "映射路径不符合正式 spec 规则: ${spec_path}"
    [[ "${issue_number}" =~ ^[0-9]+$ ]] || die "canonical_issue_number 必须为数字: ${spec_path}"
    if grep -Fxq "${spec_path}" "${seen_specs}"; then
      die "重复的 spec_path 映射: ${spec_path}"
    fi
    if grep -Fxq "${issue_number}" "${seen_issues}"; then
      die "重复的 canonical_issue_number 映射: ${issue_number}"
    fi

    printf '%s\n' "${spec_path}" >> "${seen_specs}"
    printf '%s\n' "${issue_number}" >> "${seen_issues}"

    spec_abs="${REPO_ROOT}/${spec_path}"
    if [[ ! -f "${spec_abs}" ]]; then
      printf '%s\n' "${spec_path}" >> "${future_map_entries}"
      continue
    fi
  done <<< "${entries}"

  spec_files="$(list_spec_files)"
  if [[ -z "${spec_files}" ]]; then
    die "未发现任何 docs/dev/specs/**/spec.md；无法校验映射覆盖面"
  fi
  printf '%s\n' "${spec_files}" > "${current_specs}"

  while IFS= read -r spec_path; do
    [[ -n "${spec_path}" ]] || continue
    if ! grep -Fxq "${spec_path}" "${seen_specs}"; then
      printf '%s\n' "${spec_path}" >> "${missing_specs}"
    fi
  done <<< "${spec_files}"

  if [[ -s "${missing_specs}" ]]; then
    echo "以下 spec.md 缺少 canonical issue 映射:" >&2
    cat "${missing_specs}" >&2
    die "同步映射未覆盖全部现有 spec"
  fi

  if [[ -s "${future_map_entries}" ]]; then
    warn "以下映射项当前未在仓库中落地 spec.md；如为待合入 formal FR 的预挂接可忽略："
    cat "${future_map_entries}" >&2
  fi
}

resolve_issue_number() {
  local target="$1"

  while IFS=$'\t' read -r spec_path issue_number; do
    if [[ "${spec_path}" == "${target}" ]]; then
      printf '%s\n' "${issue_number}"
      return 0
    fi
  done < <(parse_map_entries)

  return 4
}

resolve_without_revalidation_allowed() {
  [[ "${SPEC_SYNC_MAP_SKIP_VALIDATE:-0}" == "1" ]]
}

diff_specs() {
  local old_map_file="$1"
  local new_map_file="$2"
  local old_entries new_entries

  old_entries="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-sync-map-old.XXXXXX")"
  new_entries="$(mktemp "${TMPDIR:-/tmp}/webenvoy-spec-sync-map-new.XXXXXX")"
  trap 'rm -f "${old_entries:-}" "${new_entries:-}"' RETURN

  parse_map_entries_file "${old_map_file}" | sort -k1,1 > "${old_entries}"
  parse_map_entries_file "${new_map_file}" | sort -k1,1 > "${new_entries}"

  awk -F'\t' '
    FILENAME == ARGV[1] {
      old[$1] = $2
      next
    }
    {
      if (!($1 in old) || old[$1] != $2) {
        printf "%s\t%s\t%s\n", $1, (($1 in old) ? old[$1] : ""), $2
      }
    }
  ' "${old_entries}" "${new_entries}"
}

spec_allows_anchor_bootstrap() {
  local allowlist_file="$1"
  local spec_path="$2"

  [[ -n "${allowlist_file}" ]] || return 1
  [[ -f "${allowlist_file}" ]] || return 1

  grep -Fxq "${spec_path}" "${allowlist_file}"
}

spec_skips_target_validation() {
  local skiplist_file="$1"
  local spec_path="$2"

  [[ -n "${skiplist_file}" ]] || return 1
  [[ -f "${skiplist_file}" ]] || return 1

  grep -Fxq "${spec_path}" "${skiplist_file}"
}

validate_single_issue_target() {
  local repo="$1"
  local spec_path="$2"
  local issue_number="$3"
  local allow_bootstrap_file="${4:-}"
  local skip_validation_file="${5:-}"
  local spec_abs output status

  spec_abs="${REPO_ROOT}/${spec_path}"
  if [[ ! -f "${spec_abs}" ]]; then
    warn "跳过未来映射项 ${spec_path} -> #${issue_number} 的锚点预校验；对应 spec.md 尚未落地"
    return 0
  fi

  if spec_skips_target_validation "${skip_validation_file}" "${spec_path}"; then
    return 0
  fi

  if output="$(bash "${REPO_ROOT}/scripts/spec-issue-sync.sh" check-anchor "${repo}" "${spec_path}" "${issue_number}" 2>&1)"; then
    return 0
  else
    status=$?
  fi

  if [[ "${status}" -eq "${ANCHOR_MISSING_EXIT}" ]] && spec_allows_anchor_bootstrap "${allow_bootstrap_file}" "${spec_path}"; then
    warn "跳过 ${spec_path} -> #${issue_number} 的锚点预校验；允许首次受控同步补齐 FR 锚点"
    return 0
  fi

  printf '%s\n' "${output}" >&2
  return "${status}"
}

validate_issue_targets() {
  local repo="$1"
  local allow_bootstrap_file="${2:-}"
  local skip_validation_file="${3:-}"
  local target_validation_file="${4:-}"
  local spec_path issue_number

  require_cmd gh
  validate_map

  if [[ -n "${target_validation_file}" ]]; then
    [[ -f "${target_validation_file}" ]] || die "target_validation_file 不存在: ${target_validation_file}"

    while IFS= read -r spec_path; do
      [[ -n "${spec_path}" ]] || continue

      if ! issue_number="$(resolve_issue_number "${spec_path}")"; then
        die "缺少 spec_path -> canonical_issue_number 映射: ${spec_path}"
      fi

      validate_single_issue_target "${repo}" "${spec_path}" "${issue_number}" "${allow_bootstrap_file}" "${skip_validation_file}" || return $?
    done < <(sort -u "${target_validation_file}")

    return 0
  fi

  while IFS=$'\t' read -r spec_path issue_number; do
    [[ -n "${spec_path}" ]] || continue
    validate_single_issue_target "${repo}" "${spec_path}" "${issue_number}" "${allow_bootstrap_file}" "${skip_validation_file}" || return $?
  done < <(parse_map_entries)
}

assert_mapped() {
  local target issue_number

  validate_map

  for target in "$@"; do
    [[ "${target}" =~ ${SPEC_PATH_REGEX} ]] || die "只允许检查正式 spec.md 路径: ${target}"
    if ! issue_number="$(resolve_issue_number "${target}")"; then
      die "缺少 spec_path -> canonical_issue_number 映射: ${target}"
    fi
    [[ "${issue_number}" =~ ^[0-9]+$ ]] || die "映射结果无效: ${target}"
  done
}

usage() {
  cat <<'EOF'
用法:
  bash scripts/spec-issue-sync-map.sh validate
  bash scripts/spec-issue-sync-map.sh validate-issues <repo> [allow_bootstrap_list_file] [skip_validation_list_file] [target_validation_file]
  bash scripts/spec-issue-sync-map.sh diff-specs <old_map_file> <new_map_file>
  bash scripts/spec-issue-sync-map.sh resolve <spec_path>
  bash scripts/spec-issue-sync-map.sh assert-mapped <spec_path> [spec_path...]
EOF
}

main() {
  require_cmd awk
  require_cmd grep
  require_cmd git
  require_cmd find
  require_cmd mktemp
  require_cmd sed
  require_cmd sort

  case "${1:-}" in
    validate)
      shift
      [[ "$#" -eq 0 ]] || die "validate 不接受额外参数"
      validate_map
      ;;
    validate-issues)
      shift
      [[ "$#" -ge 1 && "$#" -le 4 ]] || die "validate-issues 需要 <repo> [allow_bootstrap_list_file] [skip_validation_list_file] [target_validation_file]"
      validate_issue_targets "$@"
      ;;
    diff-specs)
      shift
      [[ "$#" -eq 2 ]] || die "diff-specs 需要 <old_map_file> <new_map_file>"
      diff_specs "$1" "$2"
      ;;
    resolve)
      shift
      [[ "$#" -eq 1 ]] || die "resolve 需要 1 个 spec_path 参数"
      if ! resolve_without_revalidation_allowed; then
        validate_map
      fi
      resolve_issue_number "$1" || die "缺少 spec_path -> canonical_issue_number 映射: $1"
      ;;
    assert-mapped)
      shift
      [[ "$#" -ge 1 ]] || die "assert-mapped 至少需要 1 个 spec_path"
      assert_mapped "$@"
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
