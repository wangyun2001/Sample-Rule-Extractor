#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import importlib.util
import re
import sys
import traceback
from pathlib import Path


def log(message: str) -> None:
    print(message, flush=True)


def safe_print_stderr(message: str) -> None:
    try:
        print(message, file=sys.stderr, flush=True)
    except Exception:
        try:
            sys.stderr.buffer.write((message + "\n").encode("utf-8", errors="replace"))
            sys.stderr.flush()
        except Exception:
            pass


def normalize_cli_path(raw: str, *, expect_dir: bool) -> str:
    value = (raw or "").strip().strip('"').strip("'")
    if re.match(r"^[a-zA-Z]:$", value):
        value = value + "\\"
    if expect_dir and value.endswith(("/", "\\")):
        return value.rstrip("/\\") + "\\"
    return value


def load_module(script_path: Path):
    spec = importlib.util.spec_from_file_location("generated_extract_module", str(script_path))
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load script: {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Run generated extraction script")
    parser.add_argument("--script", required=True, help="Path to generated extract.py")
    parser.add_argument("--config", required=True, help="Path to config.json")
    parser.add_argument("--input", required=True, help="Input file or directory")
    parser.add_argument("--output-dir", required=True, help="Output directory")
    parser.add_argument("--format", required=True, choices=["xlsx", "csv", "json", "md"], help="Output format")
    args = parser.parse_args()

    script_path = Path(normalize_cli_path(args.script, expect_dir=False)).resolve()
    config_path = Path(normalize_cli_path(args.config, expect_dir=False)).resolve()
    input_path = normalize_cli_path(args.input, expect_dir=False)
    output_dir = normalize_cli_path(args.output_dir, expect_dir=True)

    if not script_path.exists():
        raise FileNotFoundError(f"script not found: {script_path}")
    if not config_path.exists():
        raise FileNotFoundError(f"config not found: {config_path}")

    log(f"[runner] script={script_path}")
    log(f"[runner] config={config_path}")
    log(f"[runner] input={input_path}")
    log(f"[runner] output_dir={output_dir}")
    log(f"[runner] format={args.format}")

    module = load_module(script_path)
    if not hasattr(module, "run_extraction"):
        raise RuntimeError("extract.py missing run_extraction(input_path, output_dir, output_format, config_path)")

    output_file = module.run_extraction(input_path, output_dir, args.format, str(config_path))
    print(f"OUTPUT_FILE::{output_file}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        safe_print_stderr(f"[runner-error] {exc}")
        safe_print_stderr("[runner-traceback]")
        safe_print_stderr(traceback.format_exc())
        sys.exit(1)

