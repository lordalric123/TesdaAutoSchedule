"""JSON persistence for assessments, TESDA representatives, and settings."""

from __future__ import annotations

import json
from pathlib import Path
from threading import Lock
from typing import Any


class JsonStore:
    def __init__(self, path: Path, default: Any) -> None:
        self.path = path
        self.default = default
        self.lock = Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.write(default)

    def read(self) -> Any:
        with self.lock:
            with self.path.open("r", encoding="utf-8") as handle:
                return json.load(handle)

    def write(self, data: Any) -> None:
        with self.lock:
            tmp = self.path.with_suffix(".tmp")
            with tmp.open("w", encoding="utf-8") as handle:
                json.dump(data, handle, indent=2, ensure_ascii=False)
            tmp.replace(self.path)
