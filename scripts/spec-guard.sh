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

warn() {
  echo "[spec-guard] 提示: $*" >&2
}

SPEC_SUITE_FILE_REGEX='^docs/dev/specs/FR-[0-9][0-9][0-9][0-9]-[^/]+/'
GOVERNANCE_FILE_REGEX='^(docs/dev/roadmap\.md|docs/dev/architecture/|docs/dev/templates/|docs/dev/AGENTS\.md|docs/dev/review/guardian-review-addendum\.md|docs/AGENTS\.md|docs/research/ref/AGENTS\.md|AGENTS\.md|vision\.md|code_review\.md|spec_review\.md|scripts/spec-guard\.sh|scripts/spec-issue-sync-map\.sh|scripts/spec-issue-sync\.sh|\.github/workflows/spec-guard\.yml|\.github/workflows/spec-issue-sync\.yml|\.github/spec-issue-sync-map\.yml|\.github/PULL_REQUEST_TEMPLATE\.md|\.githooks/)'

resolve_base_ref() {
  if [[ -n "${SPEC_GUARD_BASE_REF:-}" ]]; then
    printf '%s\n' "${SPEC_GUARD_BASE_REF}"
    return
  fi

  if [[ -n "${GITHUB_BASE_REF:-}" ]]; then
    printf '%s\n' "${GITHUB_BASE_REF}"
    return
  fi

  printf '%s\n' "origin/main"
}

ensure_ref_available() {
  local ref="$1"

  if git rev-parse --verify "${ref}" >/dev/null 2>&1; then
    return 0
  fi

  if [[ "${ref}" == origin/* ]]; then
    git fetch origin "${ref#origin/}" >/dev/null 2>&1 || true
  fi

  git rev-parse --verify "${ref}" >/dev/null 2>&1 || die "无法解析基线引用: ${ref}"
}

changed_files() {
  local base_ref="$1"
  git -C "${REPO_ROOT}" diff --name-only "${base_ref}...HEAD"
}

require_section() {
  local file="$1"
  local pattern="$2"
  local label="$3"

  grep -Eq "${pattern}" "${file}" || die "${file} 缺少 ${label}"
}

require_nonempty_file() {
  local file="$1"
  [[ -f "${file}" ]] || die "缺少文件: ${file}"
  [[ -s "${file}" ]] || die "${file} 为空"
}

validate_spec_file() {
  local spec_file="$1"

  require_section "${spec_file}" '^##[[:space:]]+GWT[[:space:]]+验收场景([[:space:]]|$)' '`## GWT 验收场景`'
  require_section "${spec_file}" '^##[[:space:]]+异常与边界场景([[:space:]]|$)' '`## 异常与边界场景`'
  require_section "${spec_file}" '^##[[:space:]]+验收标准([[:space:]]|$)' '`## 验收标准`'
  grep -Eq '(^|[[:space:]])Given[[:space:]]' "${spec_file}" || die "${spec_file} 未看到 Given 场景"
  grep -Eq '(^|[[:space:]])When[[:space:]]' "${spec_file}" || die "${spec_file} 未看到 When 场景"
  grep -Eq '(^|[[:space:]])Then[[:space:]]' "${spec_file}" || die "${spec_file} 未看到 Then 场景"
}

validate_fr_suite() {
  local fr_dir="$1"
  local spec_file="${fr_dir}/spec.md"
  local plan_file="${fr_dir}/plan.md"
  local contracts_dir="${fr_dir}/contracts"
  local data_model_file="${fr_dir}/data-model.md"
  local research_file="${fr_dir}/research.md"
  local risks_file="${fr_dir}/risks.md"
  local suite_text

  require_nonempty_file "${spec_file}"
  require_nonempty_file "${plan_file}"
  require_nonempty_file "${fr_dir}/TODO.md"
  validate_spec_file "${spec_file}"

  require_section "${plan_file}" '^##[[:space:]]+实施目标([[:space:]]|$)' '`## 实施目标`'
  require_section "${plan_file}" '^##[[:space:]]+分阶段拆分([[:space:]]|$)' '`## 分阶段拆分`'
  require_section "${plan_file}" '^##[[:space:]]+实现约束([[:space:]]|$)' '`## 实现约束`'
  require_section "${plan_file}" '^##[[:space:]]+测试与验证策略([[:space:]]|$)' '`## 测试与验证策略`'
  require_section "${plan_file}" '^##[[:space:]]+TDD[[:space:]]+范围([[:space:]]|$)' '`## TDD 范围`'
  require_section "${plan_file}" '^##[[:space:]]+并行[[:space:]]*/[[:space:]]*串行关系([[:space:]]|$)' '`## 并行 / 串行关系`'
  require_section "${plan_file}" '^##[[:space:]]+进入实现前条件([[:space:]]|$)' '`## 进入实现前条件`'

  grep -Eqi '(spec review|评审通过|审查通过)' "${plan_file}" || die "${plan_file} 未看到 spec review 通过后动作说明"
  grep -Eq '(并行|串行|阻塞|依赖|#?[0-9]{2,})' "${plan_file}" || die "${plan_file} 未看到并行 / 串行或阻塞关系描述"

  suite_text="$(cat "${spec_file}" "${plan_file}")"

  if [[ -d "${contracts_dir}" ]]; then
    find "${contracts_dir}" -type f | grep -q . || die "${contracts_dir} 存在但没有任何契约文档"
    while IFS= read -r contract_file; do
      [[ -n "${contract_file}" ]] || continue
      [[ -s "${contract_file}" ]] || die "${contract_file} 为空"
    done < <(find "${contracts_dir}" -type f)
  fi

  if grep -Eqi '(CLI|contract|contracts|protocol|Native Messaging|extension|payload|stdout|stderr|exit code|适配器接口|结构化返回|协议|契约|退出码|通信)' <<< "${suite_text}"; then
    [[ -d "${contracts_dir}" ]] || die "${fr_dir} 涉及稳定接口或协议，缺少 `contracts/`"
  fi

  if grep -Eqi '(SQLite|schema|table|migration|索引|表结构|迁移)' <<< "${suite_text}"; then
    require_nonempty_file "${data_model_file}"
  fi

  if [[ -f "${data_model_file}" ]]; then
    [[ -s "${data_model_file}" ]] || die "${data_model_file} 存在但为空"
  fi

  if [[ -f "${research_file}" ]] && [[ ! -s "${research_file}" ]]; then
    warn "${research_file} 存在但为空；按需文档不应作为占位符提交。"
  fi

  if [[ ! -f "${research_file}" ]] && grep -Eqi '(research|unknown|unknowns|third-party|signature|anti-detection|experiment|spike|验证|研究|未知|第三方|签名|反检测|实验|取舍)' <<< "${suite_text}"; then
    warn "${fr_dir} 似乎存在关键未知项或外部验证，检查是否需要补 `research.md`。"
  fi

  if grep -Eqi '(risk|rollback|security|account|write path|delete|migration|concurr|风控|风险|回滚|安全|账号|写入|删除|迁移|并发|不可逆)' <<< "${suite_text}"; then
    require_nonempty_file "${risks_file}"
  fi

  if [[ -f "${risks_file}" ]]; then
    [[ -s "${risks_file}" ]] || die "${risks_file} 存在但为空"
  fi
}

validate_governance_changes() {
  local changed="$1"
  local disallowed

  disallowed="$(grep -Ev "${GOVERNANCE_FILE_REGEX}" <<< "${changed}" || true)"
  if [[ -n "${disallowed}" ]]; then
    echo "[spec-guard] 以下变更将治理/架构规则文件与实现/非治理文件混在同一 PR 中：" >&2
    echo "${disallowed}" >&2
    die "治理/架构规则变更必须与实现代码分离。"
  fi

  while IFS= read -r file; do
    [[ -n "${file}" ]] || continue
    local abs_path="${REPO_ROOT}/${file}"

    [[ -e "${abs_path}" ]] || die "治理/架构基线文件不应在该模式下被删除: ${file}"
    [[ -s "${abs_path}" ]] || die "${file} 为空"

    case "${file}" in
      scripts/*.sh|.githooks/*)
        bash -n "${abs_path}" >/dev/null 2>&1 || die "${file} shell 语法校验失败"
        ;;
      .github/workflows/spec-guard.yml)
        grep -q 'bash scripts/spec-guard.sh' "${abs_path}" || die "${file} 未调用 scripts/spec-guard.sh"
        grep -q "docs/dev/roadmap.md" "${abs_path}" || die "${file} 未覆盖 docs/dev/roadmap.md 触发路径"
        grep -q "docs/dev/architecture/" "${abs_path}" || die "${file} 未覆盖 docs/dev/architecture/** 触发路径"
        grep -q "spec_review.md" "${abs_path}" || die "${file} 未覆盖 spec_review.md 触发路径"
        ;;
      .github/workflows/spec-issue-sync.yml)
        grep -q 'bash scripts/spec-issue-sync-map.sh validate' "${abs_path}" || die "${file} 未校验同步映射"
        grep -q 'bash scripts/spec-issue-sync.sh sync' "${abs_path}" || die "${file} 未调用 canonical FR 同步脚本"
        ;;
      .github/spec-issue-sync-map.yml)
        bash "${REPO_ROOT}/scripts/spec-issue-sync-map.sh" validate >/dev/null
        ;;
    esac
  done <<< "${changed}"
}

main() {
  local base_ref
  local changed
  local spec_files
  local governance_files
  local fr_dirs

  require_cmd git
  require_cmd grep
  require_cmd sed
  require_cmd sort
  require_cmd find

  base_ref="$(resolve_base_ref)"
  ensure_ref_available "${base_ref}"

  changed="$(changed_files "${base_ref}")"
  if [[ -z "${changed}" ]]; then
    echo "[spec-guard] 未检测到相对 ${base_ref} 的变更，跳过。"
    exit 0
  fi

  spec_files="$(grep -E "${SPEC_SUITE_FILE_REGEX}" <<< "${changed}" || true)"
  governance_files="$(grep -E "${GOVERNANCE_FILE_REGEX}" <<< "${changed}" || true)"

  if [[ -n "${spec_files}" ]] && [[ -n "${governance_files}" ]]; then
    die "正式 FR 套件与治理/架构规则文件不得混在同一 PR 中。"
  fi

  if [[ -n "${spec_files}" ]]; then
    local disallowed

    echo "[spec-guard] 检测到正式 FR 规约变更"

    fr_dirs="$(
      sed -n 's#^\(docs/dev/specs/FR-[^/]\+\)/.*#\1#p' <<< "${spec_files}" | sort -u
    )"

    while IFS= read -r dir; do
      [[ -n "${dir}" ]] || continue
      validate_fr_suite "${REPO_ROOT}/${dir}"
    done <<< "${fr_dirs}"

    while IFS= read -r spec_file; do
      [[ -n "${spec_file}" ]] || continue
      bash "${REPO_ROOT}/scripts/spec-issue-sync-map.sh" assert-mapped "${spec_file}"
    done < <(grep -E '^docs/dev/specs/FR-[^/]+/spec\.md$' <<< "${spec_files}" | sort -u)

    disallowed="$(grep -Ev "${SPEC_SUITE_FILE_REGEX}" <<< "${changed}" || true)"
    if [[ -n "${disallowed}" ]]; then
      echo "[spec-guard] 以下变更将正式 spec 与实现/非规约文件混在同一 PR 中：" >&2
      echo "${disallowed}" >&2
      die "正式 spec 变更必须先完成 spec review，再通过独立 PR 进入实现。"
    fi

    echo "[spec-guard] 通过"
    exit 0
  fi

  if [[ -n "${governance_files}" ]]; then
    echo "[spec-guard] 检测到治理/架构规则变更"
    validate_governance_changes "${changed}"
    echo "[spec-guard] 通过"
    exit 0
  fi

  echo "[spec-guard] 未检测到正式 FR 或治理/架构规则变更，跳过。"
}

main "$@"
