import os
import sys
import json
import argparse
import pandas as pd
from typing import List, Dict, Any

# Shell & Encoding Requirements:
# 1. Before running this script in PowerShell, execute: [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# 2. All file operations must use UTF-8 encoding without BOM.
# 3. Avoid using GBK, ANSI or other local encodings.

# Ensure standard output uses UTF-8
if sys.platform.startswith('win'):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

class BaseExtractor:
    def __init__(self, config_path: str):
        with open(config_path, 'r', encoding='utf-8') as f:
            self.config = json.load(f)
        self.rules = self.config.get('rules', {})
        self.schema = self.config.get('schema', [])
        self.alias_map = self.rules.get('field_alias_map', {})

    def parse_file(self, file_path: str) -> str:
        ext = os.path.splitext(file_path)[1].lower()
        if ext == '.pdf':
            return self._parse_pdf(file_path)
        elif ext in ['.docx', '.doc']:
            return self._parse_docx(file_path)
        elif ext in ['.xlsx', '.xls', '.csv']:
            return self._parse_table(file_path)
        else:
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()

    def _parse_pdf(self, file_path: str) -> str:
        # Placeholder for PDF parsing logic
        return "PDF Content"

    def _parse_docx(self, file_path: str) -> str:
        # Placeholder for Docx parsing logic
        return "Docx Content"

    def _parse_table(self, file_path: str) -> str:
        # Placeholder for Table parsing logic
        return "Table Content"

    def extract(self, text: str) -> List[Dict[str, Any]]:
        # This is where the AI-generated logic or rule-based logic goes
        # For the scaffold, we provide a basic structure
        results = []
        # Logic to be injected by AI in Step 4
        return results

    def save(self, data: List[Dict[str, Any]], output_path: str, format: str):
        df = pd.DataFrame(data)
        if format == 'xlsx':
            df.to_excel(output_path, index=False)
        elif format == 'csv':
            df.to_csv(output_path, index=False)
        elif format == 'json':
            df.to_json(output_path, orient='records', force_ascii=False, indent=2)
        elif format == 'md':
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(df.to_markdown(index=False))

def main():
    parser = argparse.ArgumentParser(description='ExtractFlow AI Runtime')
    parser.add_argument('--input', required=True, help='Input file or directory')
    parser.add_argument('--output', required=True, help='Output directory')
    parser.add_argument('--format', default='xlsx', help='Output format (xlsx, csv, json, md)')
    parser.add_argument('--config', default='config.json', help='Path to config.json')
    
    args = parser.parse_args()
    
    extractor = BaseExtractor(args.config)
    
    files_to_process = []
    if os.path.isdir(args.input):
        for root, _, files in os.walk(args.input):
            for file in files:
                files_to_process.append(os.path.join(root, file))
    else:
        files_to_process.append(args.input)
    
    all_results = []
    for file_path in files_to_process:
        print(f"[INFO] Processing: {file_path}")
        text = extractor.parse_file(file_path)
        results = extractor.extract(text)
        all_results.extend(results)
    
    output_file = os.path.join(args.output, f"result.{args.format}")
    extractor.save(all_results, output_file, args.format)
    print(f"[SUCCESS] Extraction complete. Results saved to {output_file}")

if __name__ == "__main__":
    main()
