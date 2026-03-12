import os
import re
import json
import subprocess

FR_FILE_PATH = "docs/FR.md"

def run_gh_command(cmd):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"执行命令失败: {cmd}\n错误信息: {result.stderr}")
        return None
    return result.stdout.strip()

def get_existing_issues():
    print("获取远端已有 Issues...")
    stdout = run_gh_command('gh issue list --state all --limit 1000 --json title,number,state')
    if stdout is None:
        return {}
    issues = json.loads(stdout)
    # 将 Issue 标题映射为: {"[ENV-01] 初始化工作目录": {"number": 1, "state": "OPEN"}}
    return {issue['title']: issue for issue in issues}

def parse_fr_md():
    print(f"解析 {FR_FILE_PATH}...")
    if not os.path.exists(FR_FILE_PATH):
        print(f"未找到 {FR_FILE_PATH}，略过同步。")
        return []
    
    with open(FR_FILE_PATH, "r", encoding="utf-8") as f:
        content = f.read()
    
    # 匹配 Markdown 表格行: | ENV-01 | 初始化... | P0 | 描述... |
    pattern = re.compile(r'\|\s*([A-Za-z]+-\d+)\s*\|\s*(.*?)\s*\|\s*(P\d+)\s*\|\s*(.*?)\s*\|')
    matches = pattern.findall(content)
    
    items = []
    for match in matches:
        item_id, title, priority, desc = [m.strip() for m in match]
        # 跳过表头
        if item_id == 'ID' or '---' in item_id:
            continue
        items.append({
            'id': item_id,
            'title': title,
            'priority': priority,
            'desc': desc
        })
    print(f"共解析出 {len(items)} 条需求。")
    return items

def main():
    existing_issues = get_existing_issues()
    fr_items = parse_fr_md()
    
    for item in fr_items:
        issue_title = f"[{item['id']}] {item['title']}"
        issue_body = f"**需求编号**: {item['id']}\n**优先级**: {item['priority']}\n\n**说明**:\n{item['desc']}\n\n---\n*这是由文档自动化同步生成的 Issue。如需修改需求内容，请直接在代码库修改 `docs/FR.md`。*"
        
        # 为了避免引号导致的 shell 注入，将 body 写入临时文件
        with open("tmp_issue_body.md", "w", encoding="utf-8") as f:
            f.write(issue_body)
            
        if issue_title in existing_issues:
            issue = existing_issues[issue_title]
            if issue['state'] == 'OPEN':
                print(f"更新已有 Issue: {issue_title}")
                run_gh_command(f'gh issue edit {issue["number"]} --body-file tmp_issue_body.md')
            else:
                print(f"跳过已关闭的 Issue: {issue_title}")
        else:
            print(f"创建全新 Issue: {issue_title}")
            # 自动添加优先级 Label
            run_gh_command(f'gh issue create --title "{issue_title}" --body-file tmp_issue_body.md --label "{item["priority"]}"')
            
    if os.path.exists("tmp_issue_body.md"):
        os.remove("tmp_issue_body.md")

    print("同步完成！")

if __name__ == "__main__":
    main()
