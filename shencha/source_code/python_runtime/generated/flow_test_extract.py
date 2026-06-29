#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

SCENE_ADAPTATION = {
  "scene_id": "symptom_table",
  "structure_guess": "table_like",
  "confidence": 0.86,
  "field_patterns": {
    "symptom": [
      "症状\\s*[:：]\\s*(?P<value>.+)",
      "故障现象\\s*[:：]\\s*(?P<value>.+)",
      "异常现象\\s*[:：]\\s*(?P<value>.+)",
      "表现\\s*[:：]\\s*(?P<value>.+)"
    ],
    "possible_cause": [
      "可能原因\\s*[:：]\\s*(?P<value>.+)",
      "原因\\s*[:：]\\s*(?P<value>.+)",
      "故障原因\\s*[:：]\\s*(?P<value>.+)"
    ],
    "repair_action": [
      "维修动作\\s*[:：]\\s*(?P<value>.+)",
      "处理措施\\s*[:：]\\s*(?P<value>.+)",
      "修复方法\\s*[:：]\\s*(?P<value>.+)",
      "建议操作\\s*[:：]\\s*(?P<value>.+)"
    ],
    "system_name": [
      "系统\\s*[:：]\\s*(?P<value>.+)",
      "系统名称\\s*[:：]\\s*(?P<value>.+)",
      "子系统\\s*[:：]\\s*(?P<value>.+)"
    ],
    "source_section": [
      "章节\\s*[:：]\\s*(?P<value>.+)",
      "来源\\s*[:：]\\s*(?P<value>.+)",
      "页码\\s*[:：]\\s*(?P<value>.+)"
    ]
  },
  "hints": [
    "症状",
    "可能原因",
    "维修动作",
    "表格结构常见",
    "行内可能包含症状+原因+措施",
    "症状文本通常较短"
  ],
  "constraints": [
    "symptom 不为空",
    "possible_cause 与 repair_action 至少一项不为空",
    "重复 symptom 可保留多条记录"
  ],
  "validation_rules": [
    "symptom 不为空",
    "possible_cause 与 repair_action 至少一项不为空",
    "重复 symptom 可保留多条记录"
  ],
  "fallback_policy": "ask_user_confirm_mapping"
}
SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".xls", ".csv", ".md", ".json", ".txt"}


def log(message: str) -> None:
    print(message, flush=True)


def safe_import(module_name: str):
    try:
        return __import__(module_name)
    except Exception:
        return None


def read_pdf(path: Path) -> str:
    chunks: List[str] = []
    pypdf = safe_import("pypdf")
    if pypdf is not None:
        try:
            reader = pypdf.PdfReader(str(path))
            for page in reader.pages:
                chunks.append(page.extract_text() or "")
        except Exception as exc:
            log(f"[warn] pypdf failed: {exc}")
    if chunks:
        return "\n".join(chunks)

    pdfplumber = safe_import("pdfplumber")
    if pdfplumber is not None:
        try:
            with pdfplumber.open(str(path)) as pdf:
                for page in pdf.pages:
                    chunks.append(page.extract_text() or "")
        except Exception as exc:
            log(f"[warn] pdfplumber failed: {exc}")
    return "\n".join(chunks)


def read_docx(path: Path) -> str:
    docx = safe_import("docx")
    if docx is None:
        return ""
    try:
        document = docx.Document(str(path))
        return "\n".join(para.text for para in document.paragraphs if para.text)
    except Exception as exc:
        log(f"[warn] python-docx failed: {exc}")
        return ""


def read_table(path: Path) -> str:
    pd = safe_import("pandas")
    if pd is None:
        return path.read_text(encoding="utf-8", errors="ignore")
    try:
        if path.suffix.lower() in {".xlsx", ".xls"}:
            df = pd.read_excel(path)
        else:
            df = pd.read_csv(path)
        return df.fillna("").astype(str).to_csv(index=False)
    except Exception as exc:
        log(f"[warn] table read failed: {exc}")
        return path.read_text(encoding="utf-8", errors="ignore")


def read_json(path: Path) -> str:
    try:
        data = json.loads(path.read_text(encoding="utf-8", errors="ignore"))
        return json.dumps(data, ensure_ascii=False, indent=2)
    except Exception:
        return path.read_text(encoding="utf-8", errors="ignore")


def read_input_text(path: Path) -> str:
    ext = path.suffix.lower()
    if ext == ".pdf":
        return read_pdf(path)
    if ext == ".docx":
        return read_docx(path)
    if ext in {".xlsx", ".xls", ".csv"}:
        return read_table(path)
    if ext == ".json":
        return read_json(path)
    return path.read_text(encoding="utf-8", errors="ignore")


def gather_inputs(input_path: Path) -> List[Path]:
    if input_path.is_file():
        return [input_path]
    if not input_path.exists():
        raise FileNotFoundError(f"input path not found: {input_path}")
    return [
        child
        for child in input_path.rglob("*")
        if child.is_file() and child.suffix.lower() in SUPPORTED_EXTENSIONS
    ]


def normalize_alias_map(alias_map: Dict[str, List[str]], fields: List[str]) -> Dict[str, List[str]]:
    normalized: Dict[str, List[str]] = {}
    for field in fields:
        aliases = alias_map.get(field, [])
        merged = [field]
        merged.extend(aliases)
        normalized[field] = list(dict.fromkeys([item for item in merged if item]))
    return normalized


def map_headers_to_fields(
    headers: List[str], alias_map: Dict[str, List[str]], fields: List[str]
) -> Dict[int, str]:
    mapped: Dict[int, str] = {}
    for idx, header in enumerate(headers):
        norm = header.strip().lower()
        if not norm:
            continue
        for field in fields:
            aliases = alias_map.get(field, [])
            if any(norm == alias.lower() or alias.lower() in norm for alias in aliases):
                mapped[idx] = field
                break
    return mapped


def parse_table_lines(
    lines: List[str], fields: List[str], alias_map: Dict[str, List[str]]
) -> List[Dict[str, str]]:
    rows = [line for line in lines if "|" in line]
    if len(rows) < 2:
        return []

    headers = [cell.strip() for cell in rows[0].split("|") if cell.strip()]
    if len(headers) < 2:
        return []

    field_map = map_headers_to_fields(headers, alias_map, fields)
    records: List[Dict[str, str]] = []
    for row in rows[1:]:
        cells = [cell.strip() for cell in row.split("|") if cell.strip()]
        if not cells:
            continue
        record = {field: "" for field in fields}
        for idx, value in enumerate(cells):
            target = field_map.get(idx)
            if target:
                record[target] = value
            elif idx < len(fields):
                record[fields[idx]] = value
        if any(v.strip() for v in record.values()):
            records.append(record)
    return records


def parse_key_values(
    line: str,
    fields: List[str],
    alias_map: Dict[str, List[str]],
    field_patterns: Dict[str, List[str]],
) -> Dict[str, str]:
    record = {field: "" for field in fields}
    for field in fields:
        for pattern in field_patterns.get(field, []):
            try:
                match = re.search(pattern, line, flags=re.IGNORECASE)
            except re.error:
                continue
            if not match:
                continue
            value = ""
            if "value" in match.groupdict():
                value = match.groupdict()["value"].strip()
            elif match.groups():
                value = match.group(1).strip()
            if value:
                record[field] = value
                break
        if record[field]:
            continue

        for alias in alias_map.get(field, []):
            for sep in [":", "\uFF1A", "|", "-"]:
                token = f"{alias}{sep}"
                if token in line:
                    record[field] = line.split(token, 1)[1].strip()
                    break
            if record[field]:
                break
    return record


def parse_lines(
    lines: List[str], fields: List[str], alias_map: Dict[str, List[str]], adaptation: Dict[str, Any]
) -> List[Dict[str, str]]:
    table_records = parse_table_lines(lines, fields, alias_map)
    if table_records:
        return table_records

    records: List[Dict[str, str]] = []
    field_patterns = adaptation.get("field_patterns", {}) or {}
    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        parsed = parse_key_values(line, fields, alias_map, field_patterns)
        if any(value for value in parsed.values()):
            records.append(parsed)
            continue

        numbered = re.match(r"^\s*(?:step\s*)?(\d+)[.)、]\s*(.+)$", line, flags=re.IGNORECASE)
        if numbered:
            record = {field: "" for field in fields}
            if "step_no" in fields:
                record["step_no"] = numbered.group(1)
            target_field = next((f for f in fields if f not in {"step_no", "source_section"}), fields[0])
            record[target_field] = numbered.group(2)
            records.append(record)

    return records


def ensure_source_section(records: List[Dict[str, str]], source_name: str) -> List[Dict[str, str]]:
    for record in records:
        if "source_section" in record and not record["source_section"]:
            record["source_section"] = source_name
    return records


def extract_from_text(text: str, config: Dict[str, Any], source_name: str) -> List[Dict[str, str]]:
    fields = [field["field"] if isinstance(field, dict) else str(field) for field in config.get("fields", [])]
    if not fields:
        fields = config.get("analysis", {}).get("fields", [])
    if not fields:
        return []

    alias_map = config.get("analysis", {}).get("field_alias_map", {})
    alias_map = normalize_alias_map(alias_map, fields)
    adaptation = config.get("adaptation", {})
    lines = [line.rstrip() for line in text.splitlines()]

    records = parse_lines(lines, fields, alias_map, adaptation)
    if not records and text.strip():
        fallback = {field: "" for field in fields}
        fallback_field = next((f for f in fields if f != "source_section"), fields[0])
        fallback[fallback_field] = text.strip()[:500]
        records = [fallback]

    return ensure_source_section(records, source_name)


def write_output(records: List[Dict[str, str]], output_dir: Path, output_format: str) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    ts_name = f"extract_result_{datetime.now().strftime('%Y%m%d%H%M%S')}"
    output_path = output_dir / f"{ts_name}.{output_format}"

    if output_format == "json":
        output_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
        return output_path

    if output_format == "md":
        if not records:
            output_path.write_text("| empty |\n| --- |\n| no data |\n", encoding="utf-8")
            return output_path
        fields = list(records[0].keys())
        lines = ["| " + " | ".join(fields) + " |", "| " + " | ".join(["---"] * len(fields)) + " |"]
        for record in records:
            lines.append("| " + " | ".join(str(record.get(field, "")) for field in fields) + " |")
        output_path.write_text("\n".join(lines), encoding="utf-8")
        return output_path

    pd = safe_import("pandas")
    if pd is not None:
        df = pd.DataFrame(records)
        if output_format == "xlsx":
            df.to_excel(output_path, index=False)
        else:
            df.to_csv(output_path, index=False, encoding="utf-8-sig")
        return output_path

    if records:
        fields = list(records[0].keys())
        lines = [",".join(fields)]
        for record in records:
            lines.append(",".join(str(record.get(field, "")).replace(",", ";") for field in fields))
        csv_path = output_path.with_suffix(".csv")
        csv_path.write_text("\n".join(lines), encoding="utf-8")
        return csv_path

    output_path.write_text("[]", encoding="utf-8")
    return output_path


def run_extraction(input_path: str, output_dir: str, output_format: str, config_path: str) -> str:
    in_path = Path(input_path)
    out_dir = Path(output_dir)
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))

    files = gather_inputs(in_path)
    if not files:
        raise RuntimeError(f"no supported files found under: {in_path}")

    all_records: List[Dict[str, str]] = []
    for file_path in files:
        log(f"[info] processing file: {file_path}")
        text = read_input_text(file_path)
        records = extract_from_text(text, config, source_name=file_path.name)
        all_records.extend(records)
        log(f"[info] records from file: {len(records)}")

    output_file = write_output(all_records, out_dir, output_format)
    log(f"[info] total records: {len(all_records)}")
    print(f"OUTPUT_FILE::{output_file}", flush=True)
    return str(output_file)


if __name__ == "__main__":
    if len(sys.argv) >= 5:
        run_extraction(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4])
