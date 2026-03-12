import os
import re
import json
import subprocess

FR_FILE_PATH = "docs/FR.md"

MODULE_LABELS = {
    "ENV": "模块: 核心环境",
    "COM": "模块: CLI通信",
    "NAV": "模块: 页面导航与观察",
    "ACT": "模块: 页面交互操作",
    "DAT": "模块: 数据采集与拦截",
    "MED": "模块: 媒体文件采集",
    "QRY": "模块: 数据查询与管理",
    "DSC": "模块: 信息披露控制",
    "ERR": "模块: 异常处理与容错",
    "XHS": "平台: 小红书专有",
    "STL": "模块: 反检测措施",
    "EDG": "模块: 边界情况处理",
    "EMP": "模块: 空状态处理",
    "CON": "模块: 数据一致性保障",
    "RCV": "模块: 故障恢复",
    "SCC": "模块: 状态控制",
    "PER": "模块: 性能约束",
    "SEC": "模块: 安全保护",
    "RulE": "模块: 规则引擎"
}

def run_gh_command(cmd, ignore_error=False):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0 and not ignore_error:
        print(f"执行命令失败: {cmd}\n错误信息: {result.stderr}")
        return None
    return result.stdout.strip()

def get_existing_issues():
    print("获取远端已有 Issues...")
    stdout = run_gh_command('gh issue list --state all --limit 1000 --json title,number,state')
    if stdout is None:
        return {}
    issues = json.loads(stdout)
    return {issue['title']: issue for issue in issues}

def ensure_label_exists(label_name, color="ededed"):
    # 尝试创建标签，如果已存在会报错，但我们忽略错误
    run_gh_command(f'gh label create "{label_name}" -c "{color}"', ignore_error=True)

def ensure_milestone_exists(repo_path, milestone_title):
    # gh 命令不支持原生创建 milestone，需调用 api
    # 先查询
    stdout = run_gh_command(f'gh api repos/{repo_path}/milestones')
    if stdout:
        milestones = json.loads(stdout)
        for m in milestones:
            if m['title'] == milestone_title:
                return
    # 不存在则创建
    run_gh_command(f'gh api repos/{repo_path}/milestones -f title="{milestone_title}"')

def parse_fr_md():
    print(f"解析 {FR_FILE_PATH}...")
    if not os.path.exists(FR_FILE_PATH):
        print(f"未找到 {FR_FILE_PATH}，略过同步。")
        return []
    
    with open(FR_FILE_PATH, "r", encoding="utf-8") as f:
        content = f.read()
    
    pattern = re.compile(r'\|\s*([A-Za-z]+-\d+)\s*\|\s*(.*?)\s*\|\s*(P\d+)\s*\|\s*(.*?)\s*\|')
    matches = pattern.findall(content)
    
    items = []
    for match in matches:
        item_id, title, priority, desc = [m.strip() for m in match]
        if item_id == 'ID' or '---' in item_id:
            continue
            
        # 提取模块前缀 (例如 ENV-01 提取为 ENV)
        prefix = item_id.split('-')[0]
        module_label = MODULE_LABELS.get(prefix)
        
        # 尝试从描述中提取如 [Sprint-1] 或 [v0.1] 的里程碑标记
        milestone = None
        ms_match = re.search(r'\[(Sprint-\d+|v\d+\.\d+.*?)\]', desc)
        if ms_match:
            milestone = ms_match.group(1)
            desc = desc.replace(ms_match.group(0), '').strip()
            
        items.append({
            'id': item_id,
            'title': title,
            'priority': priority,
            'desc': desc,
            'module_label': module_label,
            'milestone': milestone
        })
    print(f"共解析出 {len(items)} 条需求。")
    return items

def main():
    repo_path = run_gh_command('gh repo view --json nameWithOwner -q .nameWithOwner')
    if not repo_path:
        print("无法获取仓库信息")
        return
        
    existing_issues = get_existing_issues()
    fr_items = parse_fr_md()
    
    for item in fr_items:
        issue_title = f"[{item['id']}] {item['title']}"
        issue_body = f"**需求编号**: {item['id']}\n**优先级**: {item['priority']}\n\n**说明**:\n{item['desc']}\n\n---\n*这是由文档自动化同步生成的 Issue。如需修改需求内容，请直接在代码库修改 `docs/FR.md`。*"
        
        labels = [item['priority']]
        if item['module_label']:
            ensure_label_exists(item['module_label'])
            labels.append(item['module_label'])
            
        milestone_arg = ""
        if item['milestone']:
            ensure_milestone_exists(repo_path, item['milestone'])
            milestone_arg = f'--milestone "{item["milestone"]}"'
            
        with open("tmp_issue_body.md", "w", encoding="utf-8") as f:
            f.write(issue_body)
            
        labels_str = ",".join(f'"{lbl}"' for lbl in labels)
            
        if issue_title in existing_issues:
            issue = existing_issues[issue_title]
            if issue['state'] == 'OPEN':
                print(f"更新已有 Issue: {issue_title}")
                # GH Action 更新时不覆写用户的自定义 label 和 milestone，只更新基础描述，或全覆写取决于策略。
                # 稳妥起见，我们重新赋予解析出的属性。
                run_gh_command(f'gh issue edit {issue["number"]} --body-file tmp_issue_body.md --add-label {labels_str} {milestone_arg}')
            else:
                print(f"跳过已关闭的 Issue: {issue_title}")
        else:
            print(f"创建全新 Issue: {issue_title}")
            run_gh_command(f'gh issue create --title "{issue_title}" --body-file tmp_issue_body.md --label {labels_str} {milestone_arg}')
            
    if os.path.exists("tmp_issue_body.md"):
        os.remove("tmp_issue_body.md")

    print("同步完成！")

if __name__ == "__main__":
    main()
