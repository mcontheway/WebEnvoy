#!/usr/bin/env bash

set -euo pipefail

SPEC_SYNC_CONTRACT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_REPO_ROOT="${WEBENVOY_SPEC_SYNC_TEST_REPO_ROOT:-$(cd "${SPEC_SYNC_CONTRACT_LIB_DIR}/../.." && pwd)}"
MOCK_GITHUB_REPOSITORY="MC-and-his-Agents/WebEnvoy"

TEST_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/spec-issue-sync.contract.test.XXXXXX")"
CURRENT_CASE_DIR=""
CURRENT_REPO_DIR=""

cleanup_test_tmp() {
  rm -rf "${TEST_TMP_DIR}"
}
trap cleanup_test_tmp EXIT

assert_pass() {
  if ! "$@"; then
    echo "expected command to pass: $*" >&2
    exit 1
  fi
}

assert_fail() {
  if "$@"; then
    echo "expected command to fail: $*" >&2
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

assert_file_empty() {
  local file="$1"

  if [[ -s "${file}" ]]; then
    echo "expected ${file} to be empty" >&2
    exit 1
  fi
}

assert_line_equals() {
  local file="$1"
  local line_number="$2"
  local expected="$3"
  local actual

  actual="$(sed -n "${line_number}p" "${file}")"
  assert_equal "${actual}" "${expected}"
}

setup_mock_gh() {
  local mock_bin="${TEST_TMP_DIR}/bin"
  mkdir -p "${mock_bin}"

  cat > "${mock_bin}/gh" <<'EOF'
#!/usr/bin/env bash

set -euo pipefail

echo "$*" >> "${MOCK_GH_CALLS_LOG:?missing MOCK_GH_CALLS_LOG}"

json_print_issue() {
  local issue_number="$1"
  local title_file="${MOCK_GH_STATE_DIR:?missing MOCK_GH_STATE_DIR}/issue-${issue_number}.title"
  local body_file="${MOCK_GH_STATE_DIR}/issue-${issue_number}.body"

  [[ -f "${title_file}" ]] || {
    echo "mock issue not found: #${issue_number}" >&2
    exit 1
  }

  perl -MJSON::PP -0e '
    my ($title_file, $body_file) = @ARGV;
    open my $title_fh, "<", $title_file or die $!;
    local $/;
    my $title = <$title_fh>;
    close $title_fh;
    open my $body_fh, "<", $body_file or die $!;
    my $body = <$body_fh>;
    close $body_fh;
    print encode_json({ title => $title, body => $body });
  ' "${title_file}" "${body_file}"
}

consume_issue_edit_failure() {
  local issue_number="$1"
  local failure_file="${MOCK_GH_EDIT_FAILURES_FILE:-}"
  local remaining=0

  [[ -n "${failure_file}" && -f "${failure_file}" ]] || return 0

  remaining="$(awk -F'\t' -v issue="${issue_number}" '$1 == issue { print $2 }' "${failure_file}")"
  [[ -n "${remaining}" ]] || return 0
  [[ "${remaining}" =~ ^[0-9]+$ ]] || return 0

  if [[ "${remaining}" -gt 0 ]]; then
    awk -F'\t' -v issue="${issue_number}" 'BEGIN { OFS = "\t" } {
      if ($1 == issue) {
        $2 = $2 - 1
      }
      print
    }' "${failure_file}" > "${failure_file}.next"
    mv "${failure_file}.next" "${failure_file}"
    echo "mock gh issue edit failure for #${issue_number}" >&2
    exit 1
  fi
}

if [[ "${1:-}" == "auth" && "${2:-}" == "status" ]]; then
  exit 0
fi

if [[ "${1:-}" == "api" ]]; then
  endpoint="${2:-}"
  if [[ "${endpoint}" =~ ^repos/.+/issues/([0-9]+)$ ]]; then
    json_print_issue "${BASH_REMATCH[1]}"
    exit 0
  fi

  echo "unexpected gh api endpoint: ${endpoint}" >&2
  exit 64
fi

if [[ "${1:-}" == "issue" && "${2:-}" == "edit" ]]; then
  issue_number="${3:-}"
  shift 3

  repo=""
  title=""
  body_file=""

  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --repo)
        repo="$2"
        shift 2
        ;;
      --title)
        title="$2"
        shift 2
        ;;
      --body-file)
        body_file="$2"
        shift 2
        ;;
      *)
        echo "unexpected gh issue edit arg: $1" >&2
        exit 64
        ;;
    esac
  done

  [[ -n "${repo}" ]] || {
    echo "missing --repo" >&2
    exit 64
  }
  [[ -n "${title}" ]] || {
    echo "missing --title" >&2
    exit 64
  }
  [[ -n "${body_file}" && -f "${body_file}" ]] || {
    echo "missing --body-file" >&2
    exit 64
  }

  echo "${issue_number}" >> "${MOCK_GH_EDIT_LOG:?missing MOCK_GH_EDIT_LOG}"
  consume_issue_edit_failure "${issue_number}"

  printf '%s' "${title}" > "${MOCK_GH_STATE_DIR}/issue-${issue_number}.title"
  cp "${body_file}" "${MOCK_GH_STATE_DIR}/issue-${issue_number}.body"
  exit 0
fi

echo "unexpected gh call: $*" >&2
exit 64
EOF

  chmod +x "${mock_bin}/gh"
  export PATH="${mock_bin}:${PATH}"
}

setup_case_dir() {
  local case_name="$1"

  CURRENT_CASE_DIR="${TEST_TMP_DIR}/${case_name}"
  CURRENT_REPO_DIR="${CURRENT_CASE_DIR}/repo"

  mkdir -p "${CURRENT_CASE_DIR}" "${CURRENT_REPO_DIR}"
  mkdir -p "${CURRENT_CASE_DIR}/mock-state"

  export MOCK_GH_STATE_DIR="${CURRENT_CASE_DIR}/mock-state"
  export MOCK_GH_CALLS_LOG="${CURRENT_CASE_DIR}/gh.calls.log"
  export MOCK_GH_EDIT_LOG="${CURRENT_CASE_DIR}/gh.edit.log"
  export MOCK_GH_EDIT_FAILURES_FILE="${CURRENT_CASE_DIR}/gh.edit.failures.tsv"
  : > "${MOCK_GH_CALLS_LOG}"
  : > "${MOCK_GH_EDIT_LOG}"
  : > "${MOCK_GH_EDIT_FAILURES_FILE}"

  init_case_repo
}

copy_repo_support_files() {
  mkdir -p "${CURRENT_REPO_DIR}/scripts"
  mkdir -p "${CURRENT_REPO_DIR}/.github/workflows"

  cp "${SOURCE_REPO_ROOT}/scripts/spec-issue-sync.sh" "${CURRENT_REPO_DIR}/scripts/spec-issue-sync.sh"
  cp "${SOURCE_REPO_ROOT}/scripts/spec-issue-sync-map.sh" "${CURRENT_REPO_DIR}/scripts/spec-issue-sync-map.sh"
  cp "${SOURCE_REPO_ROOT}/scripts/spec-guard.sh" "${CURRENT_REPO_DIR}/scripts/spec-guard.sh"
  cp "${SOURCE_REPO_ROOT}/.github/workflows/spec-issue-sync.yml" "${CURRENT_REPO_DIR}/.github/workflows/spec-issue-sync.yml"
  cp "${SOURCE_REPO_ROOT}/.github/workflows/test-gate.yml" "${CURRENT_REPO_DIR}/.github/workflows/test-gate.yml"

  chmod +x "${CURRENT_REPO_DIR}/scripts/spec-issue-sync.sh"
  chmod +x "${CURRENT_REPO_DIR}/scripts/spec-issue-sync-map.sh"
  chmod +x "${CURRENT_REPO_DIR}/scripts/spec-guard.sh"
}

init_case_repo() {
  (
    cd "${CURRENT_REPO_DIR}"
    git init -b main >/dev/null
    git config user.name "Spec Sync Test"
    git config user.email "spec-sync-test@example.com"
  )

  copy_repo_support_files
}

git_commit_all() {
  local message="$1"

  (
    cd "${CURRENT_REPO_DIR}"
    git add -A
    git commit -m "${message}" >/dev/null
  )
}

current_head_sha() {
  (
    cd "${CURRENT_REPO_DIR}"
    git rev-parse HEAD
  )
}

issue_title_path() {
  printf '%s/issue-%s.title\n' "${MOCK_GH_STATE_DIR}" "$1"
}

issue_body_path() {
  printf '%s/issue-%s.body\n' "${MOCK_GH_STATE_DIR}" "$1"
}

issue_title() {
  cat "$(issue_title_path "$1")"
}

issue_body() {
  cat "$(issue_body_path "$1")"
}

anchored_issue_title() {
  local spec_path="$1"
  local title="$2"
  local suite_ref="${spec_path#docs/dev/specs/}"
  suite_ref="${suite_ref%/spec.md}"

  printf '[%s] %s\n' "${suite_ref}" "${title}"
}

seed_issue() {
  local issue_number="$1"
  local title="$2"
  local body="${3:-}"

  printf '%s' "${title}" > "$(issue_title_path "${issue_number}")"
  printf '%s' "${body}" > "$(issue_body_path "${issue_number}")"
}

set_issue_edit_failures() {
  local issue_number="$1"
  local count="$2"

  printf '%s\t%s\n' "${issue_number}" "${count}" >> "${MOCK_GH_EDIT_FAILURES_FILE}"
}

write_map_file() {
  local map_file="${CURRENT_REPO_DIR}/.github/spec-issue-sync-map.yml"
  local entry spec_path issue_number

  mkdir -p "${CURRENT_REPO_DIR}/.github"
  {
    echo "mappings:"
    for entry in "$@"; do
      spec_path="${entry%%:*}"
      issue_number="${entry##*:}"
      echo "  - spec_path: ${spec_path}"
      echo "    canonical_issue_number: ${issue_number}"
    done
  } > "${map_file}"
}

create_formal_suite() {
  local spec_path="$1"
  local title="$2"
  local marker_issue="${3:-}"
  local extra_contract_type="${4:-}"
  local suite_dir="${CURRENT_REPO_DIR}/${spec_path%/spec.md}"

  mkdir -p "${suite_dir}/contracts"

  cat > "${suite_dir}/spec.md" <<EOF
# ${title}
$(if [[ -n "${marker_issue}" ]]; then printf 'Canonical Issue: #%s\n' "${marker_issue}"; fi)

## 背景

- 这是用于 spec issue sync contract 测试的正式 FR 套件。

## GWT 验收场景

Given formal suite 已经落地且 map 指向 canonical issue
When CI 处理 formal suite 或 map 变更
Then 只允许受控同步到 owning canonical issue

## 异常与边界场景

Given canonical issue 缺少 anchor 或 remap 目标冲突
When 守卫脚本执行
Then 必须 fail-closed 或要求显式 bootstrap

## 验收标准

- formal suite 通过 guard
- canonical issue 同步只命中 owning target
EOF

  cat > "${suite_dir}/plan.md" <<EOF
## 实施目标

- 覆盖 spec issue sync contract 场景。

## 分阶段拆分

- 阶段一：冻结 formal suite 与 map。
- 阶段二：在 spec review 通过后执行同步。

## 实现约束

- 只允许 canonical issue 单点同步。

## 测试与验证策略

- 使用 shell contract 测试与 mock gh 验证。

## TDD 范围

- 先写场景测试，再校验同步行为。

## 并行 / 串行关系

- 依赖 spec review 通过后再执行；remap 与 bootstrap 存在阻塞关系。

## 进入实现前条件

- spec review 通过，且相关依赖与阻塞关系已确认。
EOF

  cat > "${suite_dir}/TODO.md" <<EOF
# TODO

- 跟踪当前 formal suite 的实现停点与下一步动作。
EOF

  cat > "${suite_dir}/risks.md" <<EOF
# 风险

- canonical issue 漂移会导致同步阻断。
EOF

  cat > "${suite_dir}/research.md" <<EOF
# Research

- 当前套件仅用于 contract 测试，不扩张正式研究范围。
EOF

  cat > "${suite_dir}/data-model.md" <<EOF
# Data Model

- 本测试套件不引入持久化 schema；仅验证 metadata block 写回。
EOF

  cat > "${suite_dir}/contracts/contract.md" <<EOF
# Contract

- canonical issue 同步只消费显式 map 与 formal suite。
EOF

  case "${extra_contract_type}" in
    yaml)
      cat > "${suite_dir}/contracts/sample.yaml" <<'EOF'
kind: spec-sync-contract
version: 1
EOF
      ;;
    json)
      cat > "${suite_dir}/contracts/sample.json" <<'EOF'
{"kind":"spec-sync-contract","version":1}
EOF
      ;;
    "")
      ;;
    *)
      echo "unknown extra contract type: ${extra_contract_type}" >&2
      exit 1
      ;;
  esac
}

append_line() {
  local relative_path="$1"
  local line="$2"

  printf '\n%s\n' "${line}" >> "${CURRENT_REPO_DIR}/${relative_path}"
}

set_canonical_issue_marker() {
  local spec_path="$1"
  local issue_number="$2"
  local spec_file="${CURRENT_REPO_DIR}/${spec_path}"

  perl -0pi -e 's/\nCanonical Issue:[^\n]*\n/\n/gs' "${spec_file}"
  perl -0pi -e 's/^(# .+\n)/$1Canonical Issue: #'"${issue_number}"'\n/m' "${spec_file}"
}

run_spec_guard() {
  local base_ref="$1"

  (
    cd "${CURRENT_REPO_DIR}"
    SPEC_GUARD_BASE_REF="${base_ref}" \
    SPEC_GUARD_GITHUB_REPOSITORY="${MOCK_GITHUB_REPOSITORY}" \
    bash scripts/spec-guard.sh
  )
}

run_sync_workflow_push() {
  local before_sha="$1"
  local after_sha="$2"
  local changed_spec_file initial_mapped_spec_file remapped_spec_file allow_bootstrap_file
  local old_map_file skip_validation_file target_validation_file changed_files issue_number status file old_issue_number new_issue_number

  (
    set -euo pipefail
    cd "${CURRENT_REPO_DIR}"
    git checkout --quiet "${after_sha}"

    changed_spec_file="$(mktemp)"
    initial_mapped_spec_file="$(mktemp)"
    remapped_spec_file="$(mktemp)"
    allow_bootstrap_file="$(mktemp)"
    old_map_file="$(mktemp)"
    skip_validation_file="$(mktemp)"
    target_validation_file="$(mktemp)"
    trap 'rm -f "${changed_spec_file}" "${initial_mapped_spec_file}" "${remapped_spec_file}" "${allow_bootstrap_file}" "${old_map_file}" "${skip_validation_file}" "${target_validation_file}"' RETURN

    if [[ -z "${before_sha}" || "${before_sha}" == "0000000000000000000000000000000000000000" ]]; then
      changed_files="$(git diff-tree --no-commit-id --name-only -r "${after_sha}" || true)"
    else
      changed_files="$(git diff --name-only "${before_sha}" "${after_sha}" || true)"
    fi

    grep -E '^docs/dev/specs/FR-[^/]+/.+$' <<< "${changed_files}" \
      | sed -n 's#^\(docs/dev/specs/FR-[^/][^/]*\)/.*$#\1/spec.md#p' \
      | sort -u > "${changed_spec_file}" || true

    if grep -Fxq '.github/spec-issue-sync-map.yml' <<< "${changed_files}"; then
      if git cat-file -e "${before_sha}:.github/spec-issue-sync-map.yml" 2>/dev/null; then
        git show "${before_sha}:.github/spec-issue-sync-map.yml" > "${old_map_file}"
      else
        : > "${old_map_file}"
      fi

      bash scripts/spec-issue-sync-map.sh diff-specs "${old_map_file}" .github/spec-issue-sync-map.yml \
        | awk -F'\t' 'NF == 3 && $2 == "" && $3 != "" { print $1 }' \
        | sort -u > "${initial_mapped_spec_file}"

      bash scripts/spec-issue-sync-map.sh diff-specs "${old_map_file}" .github/spec-issue-sync-map.yml \
        | awk -F'\t' 'NF == 3 && $2 != "" && $3 != "" { print $0 }' \
        | sort -u > "${remapped_spec_file}"
    fi

    while IFS= read -r file; do
      [[ -n "${file}" ]] || continue
      issue_number="$(SPEC_SYNC_MAP_SKIP_VALIDATE=1 bash scripts/spec-issue-sync-map.sh resolve "${file}")"
      if bash scripts/spec-issue-sync.sh suite-mentions-issue "${file}" "${issue_number}"; then
        printf '%s\n' "${file}" >> "${allow_bootstrap_file}"
      fi
    done < "${changed_spec_file}"

    while IFS= read -r file; do
      [[ -n "${file}" ]] || continue
      issue_number="$(SPEC_SYNC_MAP_SKIP_VALIDATE=1 bash scripts/spec-issue-sync-map.sh resolve "${file}")"
      if bash scripts/spec-issue-sync.sh suite-mentions-issue "${file}" "${issue_number}"; then
        printf '%s\n' "${file}" >> "${allow_bootstrap_file}"
      fi
    done < "${initial_mapped_spec_file}"

    if [[ -n "${before_sha}" ]] && ! git cat-file -e "${before_sha}:.github/spec-issue-sync-map.yml" 2>/dev/null; then
      while IFS= read -r file; do
        [[ -n "${file}" ]] || continue
        if git cat-file -e "${before_sha}:${file}" 2>/dev/null; then
          printf '%s\n' "${file}" >> "${allow_bootstrap_file}"
        fi
      done < "${initial_mapped_spec_file}"
    fi

    sort -u -o "${allow_bootstrap_file}" "${allow_bootstrap_file}"

    bash scripts/spec-issue-sync-map.sh validate

    cut -f1 "${remapped_spec_file}" | sed '/^$/d' | sort -u > "${skip_validation_file}"
    cat "${changed_spec_file}" "${initial_mapped_spec_file}" | sed '/^$/d' | sort -u > "${target_validation_file}"

    bash scripts/spec-issue-sync-map.sh validate-issues "${MOCK_GITHUB_REPOSITORY}" "${allow_bootstrap_file}" "${skip_validation_file}" "${target_validation_file}"

    while IFS= read -r file; do
      [[ -f "${file}" ]] || continue
      if grep -Fxq "${file}" "${skip_validation_file}"; then
        continue
      fi

      issue_number="$(SPEC_SYNC_MAP_SKIP_VALIDATE=1 bash scripts/spec-issue-sync-map.sh resolve "${file}")"
      if bash scripts/spec-issue-sync.sh check-anchor "${MOCK_GITHUB_REPOSITORY}" "${file}" "${issue_number}" >/dev/null 2>&1; then
        bash scripts/spec-issue-sync.sh sync "${MOCK_GITHUB_REPOSITORY}" "${file}" "${issue_number}"
        continue
      else
        status=$?
      fi

      if [[ "${status}" -eq 43 ]]; then
        if ! grep -Fxq "${file}" "${allow_bootstrap_file}"; then
          echo "拒绝首次补锚 ${file}：canonical issue #${issue_number} 尚无 FR 锚定，且 formal suite 未显式绑定该 issue" >&2
          exit 44
        fi

        bash scripts/spec-issue-sync.sh sync-bootstrap "${MOCK_GITHUB_REPOSITORY}" "${file}" "${issue_number}"
        continue
      fi

      exit "${status}"
    done < "${changed_spec_file}"

    while IFS= read -r file; do
      [[ -n "${file}" ]] || continue
      if grep -Fxq "${file}" "${changed_spec_file}"; then
        continue
      fi
      if [[ ! -f "${file}" ]]; then
        echo "跳过 ${file}：对应 spec.md 尚未落地"
        continue
      fi

      issue_number="$(SPEC_SYNC_MAP_SKIP_VALIDATE=1 bash scripts/spec-issue-sync-map.sh resolve "${file}")"
      if bash scripts/spec-issue-sync.sh check-anchor "${MOCK_GITHUB_REPOSITORY}" "${file}" "${issue_number}" >/dev/null 2>&1; then
        bash scripts/spec-issue-sync.sh sync "${MOCK_GITHUB_REPOSITORY}" "${file}" "${issue_number}"
        continue
      else
        status=$?
      fi

      if [[ "${status}" -eq 43 ]] && grep -Fxq "${file}" "${allow_bootstrap_file}"; then
        bash scripts/spec-issue-sync.sh sync-bootstrap "${MOCK_GITHUB_REPOSITORY}" "${file}" "${issue_number}"
        continue
      fi

      exit "${status}"
    done < "${initial_mapped_spec_file}"

    while IFS=$'\t' read -r file old_issue_number new_issue_number; do
      [[ -n "${file}" ]] || continue
      if [[ ! -f "${file}" ]]; then
        echo "跳过 ${file}：对应 spec.md 尚未落地"
        continue
      fi

      if bash scripts/spec-issue-sync.sh can-sync-map-remap "${MOCK_GITHUB_REPOSITORY}" "${file}" "${old_issue_number}" "${new_issue_number}"; then
        bash scripts/spec-issue-sync.sh sync-map-remap "${MOCK_GITHUB_REPOSITORY}" "${file}" "${old_issue_number}" "${new_issue_number}"
        continue
      else
        status=$?
      fi

      if [[ "${status}" -eq 44 ]]; then
        echo "拒绝 remapped ${file} -> #${new_issue_number}：新 canonical issue 尚未满足受控同步前置" >&2
        exit 44
      fi

      exit "${status}"
    done < "${remapped_spec_file}"
  )
}
