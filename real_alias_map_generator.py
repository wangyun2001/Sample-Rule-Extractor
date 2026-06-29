import json
import argparse
from openai import OpenAI

# 解析命令行参数
parser = argparse.ArgumentParser(description='字段同义词对照生成器')
parser.add_argument('--api-key', default='sk-iuoyeddqmyklbghpkntbqpcdyqeqenhduuahcxwrllflizjm', help='API Key')
parser.add_argument('--api-base', default='https://api.siliconflow.cn/v1', help='API 基础地址')
parser.add_argument('--model', default='Pro/moonshotai/Kimi-K2.6', help='模型名称')
parser.add_argument('--prompt', default=None, help='自定义提示词')
parser.add_argument('--sample-file', help='包含样本文本的文件路径')
parser.add_argument('--output-file', help='输出结果的文件路径')
args = parser.parse_args()

# 初始化 OpenAI 客户端（使用 SiliconFlow API）
client = OpenAI(
    api_key=args.api_key,
    base_url=args.api_base
)

# 默认提示词
DEFAULT_PROMPT = "你是字段同义词对照生成器。\n任务：根据样本文本、规则文档 Markdown、场景模板和规则分析结果，输出与当前场景直接相关的字段同义词对照。\n要求：\n1) 只允许输出当前字段集合内的 key，不得新增字段；\n2) 每个字段至少保留字段名本身；\n3) 别名必须来自场景上下文，禁止与其他场景混淆；\n4) 结合规则文档术语优先；\n5) 输出 JSON，格式：{\"field_alias_map\":{\"field\":[\"alias1\",\"alias2\"]}}；\n5) 不输出解释文本。"

# 字段列表（症状表场景）
FIELDS = ["symptom", "possible_cause", "measure"]

# 规则文档 Markdown
RULE_MARKDOWN = "# 规则分析文档\n## 4. 规则清单\n- symptom: 症状\n- possible_cause: 可能原因\n- measure: 措施"

# 场景模板信息
TEMPLATE = {
    "scene_name": "症状表场景",
    "output_schema": [
        {"field": "symptom", "type": "string", "required": True},
        {"field": "possible_cause", "type": "string", "required": False},
        {"field": "measure", "type": "string", "required": False}
    ],
    "header_alias": {
        "symptom": ["症状", "故障现象", "现象"],
        "possible_cause": ["可能原因", "原因"],
        "measure": ["措施", "维修方法"]
    }
}

# 分析结果 JSON
ANALYSIS_JSON = {
    "scene_id": "symptom_table",
    "fields": FIELDS,
    "field_alias_map": {
        "symptom": ["symptom", "症状", "故障现象"],
        "possible_cause": ["possible_cause", "可能原因"],
        "measure": ["measure", "措施"]
    },
    "confidence": 0.7481818181818182
}

def get_sample_text():
    """获取样本文本"""
    if args.sample_file:
        with open(args.sample_file, 'r', encoding='utf-8') as f:
            return f.read()
    else:
        # 交互式输入
        print("请输入样本文本（输入完成后按 Ctrl+D 结束，Windows 下按 Ctrl+Z 然后 Enter）：")
        lines = []
        try:
            while True:
                line = input()
                lines.append(line)
        except EOFError:
            pass
        return '\n'.join(lines)

def generate_alias_map(selected_text, prompt_override=None):
    """生成字段同义词对照"""
    # 使用自定义提示词或默认提示词
    prompt = prompt_override if prompt_override and prompt_override.strip() else DEFAULT_PROMPT
    
    # 构建用户消息
    user_message = {
        "primary_scene": "symptom_table",
        "sub_scene": "",
        "fields": FIELDS,
        "sample_excerpt": selected_text[:8000],
        "rule_markdown": RULE_MARKDOWN,
        "template": TEMPLATE,
        "analysis_json": ANALYSIS_JSON,
        "current_field_alias_map": {
            "symptom": ["symptom", "症状", "故障现象"],
            "possible_cause": ["possible_cause", "可能原因"],
            "measure": ["measure", "措施"]
        }
    }
    
    # 调用 OpenAI API
    response = client.chat.completions.create(
        model=args.model,
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": json.dumps(user_message, ensure_ascii=False)}
        ],
        temperature=0.3,
        max_tokens=1000
    )
    
    # 解析响应
    content = response.choices[0].message.content.strip()
    
    # 提取 JSON 部分
    try:
        # 尝试直接解析
        result = json.loads(content)
        return result.get("field_alias_map", {})
    except json.JSONDecodeError:
        # 尝试提取 JSON 部分
        import re
        json_match = re.search(r'\{\s*"field_alias_map"\s*:\s*\{[\s\S]*?\}\s*\}', content)
        if json_match:
            try:
                result = json.loads(json_match.group(0))
                return result.get("field_alias_map", {})
            except json.JSONDecodeError:
                pass
        # 如果解析失败，返回空结果
        return {}

def main():
    """主函数"""
    # 获取样本文本
    selected_text = get_sample_text()
    if not selected_text:
        print("错误：样本文本不能为空")
        return
    
    # 生成别名映射
    print("正在生成字段同义词对照...")
    alias_map = generate_alias_map(selected_text, args.prompt)
    
    # 标准化结果
    normalized = {}
    for field in FIELDS:
        if field in alias_map:
            aliases = alias_map[field]
            # 确保字段名本身在别名列表中
            if field not in aliases:
                aliases.insert(0, field)
            normalized[field] = aliases
        else:
            normalized[field] = [field]
    
    # 输出结果
    result = {"field_alias_map": normalized}
    result_str = json.dumps(result, ensure_ascii=False, indent=2)
    
    if args.output_file:
        with open(args.output_file, 'w', encoding='utf-8') as f:
            f.write(result_str)
        print(f"结果已保存到：{args.output_file}")
    else:
        print("\n=== 字段同义词对照结果 ===")
        print(result_str)

if __name__ == "__main__":
    main()
