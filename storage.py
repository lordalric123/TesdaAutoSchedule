"""JSON persistence for assessments, TESDA representatives, and settings.

If the DATABASE_URL environment variable is set (e.g. a free Neon Postgres on Render),
data is stored in a Postgres table so it survives Render's temporary disk being wiped.
Without it, the original JSON-file behaviour is used (local development).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from threading import Lock
from typing import Any

DATABASE_URL = (os.environ.get("DATABASE_URL") or "").strip()
if DATABASE_URL.startswith("postgres://"):  # psycopg2 wants the postgresql:// scheme
    DATABASE_URL = "postgresql://" + DATABASE_URL[len("postgres://"):]


class JsonStore:
    def __init__(self, path: Path, default: Any) -> None:
        self.path = path
        self.default = default
        self.lock = Lock()
        self.key = path.name
        self.use_db = bool(DATABASE_URL)
        if self.use_db:
            self._init_db()
        else:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            if not self.path.exists():
                self.write(default)

    # ---- Postgres backend -------------------------------------------------
    def _connect(self):
        import psycopg2

        return psycopg2.connect(DATABASE_URL, connect_timeout=15)

    def _init_db(self) -> None:
        with self.lock, self._connect() as conn, conn.cursor() as cur:
            cur.execute("CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            initial = self.default
            if self.path.exists():  # keep existing data: seed the database from the old JSON file
                try:
                    initial = json.loads(self.path.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    initial = self.default
            cur.execute(
                "INSERT INTO kv_store (key, value) VALUES (%s, %s) ON CONFLICT (key) DO NOTHING",
                (self.key, json.dumps(initial, ensure_ascii=False)),
            )

    def _db_read(self) -> Any:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT value FROM kv_store WHERE key = %s", (self.key,))
            row = cur.fetchone()
        return json.loads(row[0]) if row else self.default

    def _db_write(self, data: Any) -> None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO kv_store (key, value) VALUES (%s, %s) "
                "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                (self.key, json.dumps(data, ensure_ascii=False)),
            )

    # ---- Public API (unchanged) ------------------------------------------
    def read(self) -> Any:
        with self.lock:
            if self.use_db:
                return self._db_read()
            with self.path.open("r", encoding="utf-8") as handle:
                return json.load(handle)

    def write(self, data: Any) -> None:
        with self.lock:
            if self.use_db:
                self._db_write(data)
                return
            tmp = self.path.with_suffix(".tmp")
            with tmp.open("w", encoding="utf-8") as handle:
                json.dump(data, handle, indent=2, ensure_ascii=False)
            tmp.replace(self.path)


# ---- Uploaded files (Excel sheets, logo) ---------------------------------------
# On Render the disk is wiped on restart, so uploaded files are mirrored into the
# database. At startup the database copy is restored to disk (database wins); files
# that exist only on disk (e.g. committed in GitHub) are pushed to the database once.

def _ensure_files_table(cur) -> None:
    cur.execute("CREATE TABLE IF NOT EXISTS file_store (path TEXT PRIMARY KEY, data BYTEA NOT NULL)")


def sync_on_startup(base_dir: Path, subdirs: list[str]) -> None:
    if not DATABASE_URL:
        return
    import psycopg2

    with psycopg2.connect(DATABASE_URL, connect_timeout=15) as conn, conn.cursor() as cur:
        _ensure_files_table(cur)
        for sub in subdirs:
            cur.execute("SELECT path, data FROM file_store WHERE path LIKE %s", (sub + "/%",))
            in_db = set()
            for rel, data in cur.fetchall():
                in_db.add(rel)
                dest = base_dir / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(bytes(data))
            folder = base_dir / sub
            if folder.exists():
                for f in folder.iterdir():
                    rel = f"{sub}/{f.name}"
                    if f.is_file() and rel not in in_db:
                        cur.execute(
                            "INSERT INTO file_store (path, data) VALUES (%s, %s) "
                            "ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data",
                            (rel, psycopg2.Binary(f.read_bytes())),
                        )


def push_dir(base_dir: Path, sub: str) -> None:
    """Mirror a folder to the database exactly (adds/updates files, drops removed ones)."""
    if not DATABASE_URL:
        return
    import psycopg2

    folder = base_dir / sub
    names = [f for f in folder.iterdir() if f.is_file()] if folder.exists() else []
    with psycopg2.connect(DATABASE_URL, connect_timeout=15) as conn, conn.cursor() as cur:
        _ensure_files_table(cur)
        keep = []
        for f in names:
            rel = f"{sub}/{f.name}"
            keep.append(rel)
            cur.execute(
                "INSERT INTO file_store (path, data) VALUES (%s, %s) "
                "ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data",
                (rel, psycopg2.Binary(f.read_bytes())),
            )
        cur.execute("DELETE FROM file_store WHERE path LIKE %s AND NOT (path = ANY(%s))", (sub + "/%", keep))
