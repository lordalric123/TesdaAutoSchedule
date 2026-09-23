from __future__ import annotations

from pathlib import Path

from excel_loader import export_registry_to_json

BASE = Path(__file__).resolve().parent
DATA_DIR = BASE / "data" / "excel"
JSON_DIR = BASE / "data"

if __name__ == "__main__":
    exported = export_registry_to_json(DATA_DIR, JSON_DIR)
    print("Converted Excel registries to JSON:")
    for label, path in exported.items():
        print(f"- {label}: {path}")
