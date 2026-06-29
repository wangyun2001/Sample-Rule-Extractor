#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List

SCENE_ADAPTATION = json.loads(__SCENE_ADAPTATION_JSON__)
SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".xls", ".csv", ".md", ".json", ".txt"}

SYMPTOM_POSITIVE_HEADERS = {
    "症状", "故障现象", "故障症状", "异常现象", "现象", "可能原因", "故障原因", "原因", "措施", "维修方法", "处理措施",
}
SYMPTOM_NEGATIVE_HEADERS = {
    "dtc码", "dtc 码", "故障描述", "故障类型与描述", "件号", "零部件件号", "数量", "数量/重量", "型号", "nm", "n.m", "n·m", "扭矩", "序号",
}
SYMPTOM_NEGATIVE_TOKENS = {
    "螺栓", "螺母", "垫片", "总成", "件号", "型号", "数量", "扭矩", "nm", "n.m", "n·m",
}


def log(message: str) -> None:
    print(message, flush=True)


def normalize_path_for_windows(raw: str, *, expect_dir: bool) -> Path:
    value = (raw or "").strip().strip('"').strip("'")
    if re.match(r"^[a-zA-Z]:$", value):
        value = value + "\\"
    if expect_dir and value.endswith(("/", "\\")):
        value = value.rstrip("/\\") + "\\"
    return Path(value)


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


def get_scene_id(config: Dict[str, Any]) -> str:
    return str(config.get("scene_id") or config.get("analysis", {}).get("scene_id") or "")


def is_symptom_scene(scene_id: str) -> bool:
    return scene_id in {"symptom_table", "maintenance_fault_symptom_table"}


def split_pipe_blocks(lines: Iterable[str]) -> List[List[str]]:
    blocks: List[List[str]] = []
    current: List[str] = []
    for raw in lines:
        line = raw.rstrip()
        if "|" in line:
            current.append(line)
            continue
        if current:
            blocks.append(current)
            current = []
    if current:
        blocks.append(current)
    return blocks


def normalize_header_tokens(header_row: str) -> List[str]:
    return [cell.strip().lower() for cell in header_row.split("|") if cell.strip()]


def map_headers_to_fields(headers: List[str], alias_map: Dict[str, List[str]], fields: List[str]) -> Dict[int, str]:
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


def symptom_header_gate(headers: List[str], field_map: Dict[int, str]) -> bool:
    if not headers:
        return False
    header_text = " ".join(headers)
    if any(token in header_text for token in SYMPTOM_NEGATIVE_HEADERS):
        return False

    has_symptom = any(h in {"症状", "故障现象", "故障症状", "异常现象"} for h in headers)
    has_cause_or_measure = any(h in {"可能原因", "故障原因", "原因", "措施", "维修方法", "处理措施"} for h in headers)
    weak_two_col = ("现象" in headers and "原因" in headers) or ("可能原因" in headers and "维修方法" in headers)
    mapped_fields = set(field_map.values())
    has_mapped_core = ("symptom" in mapped_fields) and (("possible_cause" in mapped_fields) or ("measure" in mapped_fields))
    return (has_symptom and has_cause_or_measure) or weak_two_col or has_mapped_core


def is_probably_noise_record_for_symptom(record: Dict[str, str]) -> bool:
    symptom = (record.get("symptom") or "").strip()
    cause = (record.get("possible_cause") or "").strip()
    measure = (record.get("measure") or "").strip()
    text = f"{symptom} {cause} {measure}".lower()

    if not symptom and not cause and not measure:
        return True
    if not cause and not measure:
        return True

    has_fault_semantics = any(x in text for x in ["故障", "异常", "症状", "无法", "不良", "异响", "漏", "抖动", "过热", "无法启动"])
    if any(token in text for token in SYMPTOM_NEGATIVE_TOKENS) and not has_fault_semantics:
        return True

    if re.search(r"\b\d{5,}[-]?\w*\b", text) and any(token in text for token in ["件号", "型号", "数量"]):
        return True

    return False


def is_separator_value(value: str) -> bool:
    v = (value or "").strip().replace("—", "-")
    return bool(v) and all(ch == "-" for ch in v)


def is_separator_record(record: Dict[str, str]) -> bool:
    non_empty = [v for v in record.values() if (v or "").strip()]
    if not non_empty:
        return False
    return all(is_separator_value(v) for v in non_empty)


def parse_table_lines(lines: List[str], fields: List[str], alias_map: Dict[str, List[str]], scene_id: str) -> List[Dict[str, str]]:
    records: List[Dict[str, str]] = []
    for block in split_pipe_blocks(lines):
        if len(block) < 2:
            continue

        headers = [cell.strip() for cell in block[0].split("|") if cell.strip()]
        if len(headers) < 2:
            continue

        field_map = map_headers_to_fields(headers, alias_map, fields)
        normalized_headers = normalize_header_tokens(block[0])

        if is_symptom_scene(scene_id):
            if not symptom_header_gate(normalized_headers, field_map):
                continue

        for row in block[1:]:
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

            if not any(v.strip() for v in record.values()):
                continue
            if is_separator_record(record):
                continue
            if is_symptom_scene(scene_id) and is_probably_noise_record_for_symptom(record):
                continue
            records.append(record)

    return records


def parse_key_values(line: str, fields: List[str], alias_map: Dict[str, List[str]], field_patterns: Dict[str, List[str]]) -> Dict[str, str]:
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
            for sep in [":", "：", "|", "-"]:
                token = f"{alias}{sep}"
                if token in line:
                    record[field] = line.split(token, 1)[1].strip()
                    break
            if record[field]:
                break
    return record


def parse_lines(lines: List[str], fields: List[str], alias_map: Dict[str, List[str]], adaptation: Dict[str, Any], scene_id: str) -> List[Dict[str, str]]:
    table_records = parse_table_lines(lines, fields, alias_map, scene_id)
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
            if is_separator_record(parsed):
                continue
            if not (is_symptom_scene(scene_id) and is_probably_noise_record_for_symptom(parsed)):
                records.append(parsed)
            continue

        if is_symptom_scene(scene_id):
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
    scene_id = get_scene_id(config)
    lines = [line.rstrip() for line in text.splitlines()]

    records = parse_lines(lines, fields, alias_map, adaptation, scene_id)
    if is_symptom_scene(scene_id):
        records = [r for r in records if not is_probably_noise_record_for_symptom(r)]

    # Strict mode for symptom scene: no noisy fallback full-text record.
    if not records and text.strip() and not is_symptom_scene(scene_id):
        fallback = {field: "" for field in fields}
        fallback_field = next((f for f in fields if f != "source_section"), fields[0])
        fallback[fallback_field] = text.strip()[:500]
        records = [fallback]

    return ensure_source_section(records, source_name)


def write_output(records: List[Dict[str, str]], output_dir: Path, output_format: str) -> Path:
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise RuntimeError(f"invalid output directory: {output_dir}, err={exc}") from exc
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
    in_path = normalize_path_for_windows(input_path, expect_dir=False)
    out_dir = normalize_path_for_windows(output_dir, expect_dir=True)
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
