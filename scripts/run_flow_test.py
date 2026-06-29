#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parent.parent
SCENE_DIR = ROOT / "src" / "config" / "scene-templates"
RUNTIME_DIR = ROOT / "python_runtime"
GENERATED_DIR = RUNTIME_DIR / "generated"
SCAFFOLD_PATH = RUNTIME_DIR / "scaffold" / "extract_scaffold.py"
RUNNER_PATH = RUNTIME_DIR / "runner.py"
TEST_BATCH_DIR = ROOT / "examples" / "test_batch"


@dataclass
class FlowArtifacts:
    extract_path: Path
    config_path: Path
    output_files: List[Path]


def ensure_dirs() -> None:
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    TEST_BATCH_DIR.mkdir(parents=True, exist_ok=True)


def create_test_data() -> None:
    txt_content = (
        "系统：发动机控制\n"
        "症状|可能原因|处理措施\n"
        "发动机抖动|点火线圈老化|更换点火线圈\n"
        "冷启动困难|喷油器积碳|清洗喷油器并复位学习值\n"
    )
    md_content = (
        "| 症状 | 可能原因 | 处理措施 |\n"
        "| --- | --- | --- |\n"
        "| 加速无力 | 节气门开度异常 | 检查节气门位置传感器并标定 |\n"
    )
    csv_content = (
        "症状,可能原因,处理措施\n"
        "怠速不稳,进气泄漏,检查进气管并更换密封件\n"
    )
    json_content = [
        {
            "症状": "油耗升高",
            "可能原因": "氧传感器老化",
            "处理措施": "更换氧传感器并清除故障码",
        }
    ]

    (TEST_BATCH_DIR / "symptom_1.txt").write_text(txt_content, encoding="utf-8")
    (TEST_BATCH_DIR / "symptom_2.md").write_text(md_content, encoding="utf-8")
    (TEST_BATCH_DIR / "symptom_3.csv").write_text(csv_content, encoding="utf-8")
    (TEST_BATCH_DIR / "symptom_4.json").write_text(
        json.dumps(json_content, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def load_template(scene_id: str) -> Dict[str, Any]:
    path = SCENE_DIR / f"{scene_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"scene template not found: {path}")
    return json.loads(path.read_text(encoding="utf-8-sig"))


def build_mock_analysis(template: Dict[str, Any]) -> Dict[str, Any]:
    fields = [item["field"] for item in template["output_schema"]]
    alias_map = {field: template.get("header_alias", {}).get(field, [field]) for field in fields}
    return {
        "scene_id": template["scene_id"],
        "fields": fields,
        "field_alias_map": alias_map,
        "extraction_hints": template.get("required_semantic_roles", [])
        + template.get("content_features", []),
        "structure_guess": "table_like",
        "constraints": template.get("validation_rules", []),
        "validation_rules": template.get("validation_rules", []),
        "fallback_policy": template.get("fallback_strategy", {}).get(
            "low_confidence", "ask_user_confirm_mapping"
        ),
        "confidence": 0.86,
        "notes": ["flow test mock analysis"],
        "llm_provider": "local-mock",
    }


def build_adaptation(analysis: Dict[str, Any]) -> Dict[str, Any]:
    field_patterns: Dict[str, List[str]] = {}
    for field, aliases in analysis["field_alias_map"].items():
        patterns = [rf"{alias}\s*[:：]\s*(?P<value>.+)" for alias in aliases]
        field_patterns[field] = patterns
    return {
        "scene_id": analysis["scene_id"],
        "structure_guess": analysis["structure_guess"],
        "confidence": analysis["confidence"],
        "field_patterns": field_patterns,
        "hints": analysis["extraction_hints"],
        "constraints": analysis["constraints"],
        "validation_rules": analysis["validation_rules"],
        "fallback_policy": analysis["fallback_policy"],
    }


def generate_script_and_config(scene_id: str) -> tuple[Path, Path]:
    template = load_template(scene_id)
    analysis = build_mock_analysis(template)
    adaptation = build_adaptation(analysis)

    scaffold = SCAFFOLD_PATH.read_text(encoding="utf-8")
    adaptation_json_literal = json.dumps(
        json.dumps(adaptation, ensure_ascii=False),
        ensure_ascii=False,
    )
    extract_code = scaffold.replace(
        "__SCENE_ADAPTATION_JSON__",
        adaptation_json_literal,
    )
    config_json = {
        "scene_id": scene_id,
        "fields": template["output_schema"],
        "analysis": analysis,
        "adaptation": adaptation,
    }

    extract_path = GENERATED_DIR / "flow_test_extract.py"
    config_path = GENERATED_DIR / "flow_test_config.json"
    extract_path.write_text(extract_code, encoding="utf-8")
    config_path.write_text(
        json.dumps(config_json, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return extract_path, config_path


def run_runner(extract_path: Path, config_path: Path, output_format: str) -> Path:
    cmd = [
        sys.executable,
        str(RUNNER_PATH),
        "--script",
        str(extract_path),
        "--config",
        str(config_path),
        "--input",
        str(TEST_BATCH_DIR),
        "--output-dir",
        str(GENERATED_DIR),
        "--format",
        output_format,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if proc.returncode != 0:
        raise RuntimeError(
            f"runner failed with code={proc.returncode}\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
        )

    output_file = None
    for line in proc.stdout.splitlines():
        if line.startswith("OUTPUT_FILE::"):
            output_file = line.split("OUTPUT_FILE::", 1)[1].strip()
    if not output_file:
        raise RuntimeError(f"runner output missing OUTPUT_FILE marker.\nstdout:\n{proc.stdout}")
    return Path(output_file)


def main() -> int:
    scene_id = "symptom_table"
    ensure_dirs()
    create_test_data()
    extract_path, config_path = generate_script_and_config(scene_id=scene_id)
    output_files: List[Path] = []
    for output_format in ["json", "csv", "md", "xlsx"]:
        output_file = run_runner(extract_path, config_path, output_format=output_format)
        output_files.append(output_file)

    artifacts = FlowArtifacts(
        extract_path=extract_path,
        config_path=config_path,
        output_files=output_files,
    )

    print("[flow-test] done")
    print(f"[flow-test] extract.py: {artifacts.extract_path}")
    print(f"[flow-test] config.json: {artifacts.config_path}")
    for output_file in artifacts.output_files:
        print(f"[flow-test] output: {output_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
