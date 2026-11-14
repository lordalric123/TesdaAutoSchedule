"""JSON persistence for assessments, TESDA representatives, and settings.

If the DATABASE_URL environment variable is set (e.g. a free Neon Postgres on Render),
data is stored in a Postgres table so it survives Render's temporary disk being wiped.
Without it, the original JSON-file behaviour is used (local development).
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from threading import Lock
from typing import Any

def _load_dotenv() -> None:
    """Read KEY=VALUE lines from a .env file next to the app (never overrides real env vars)."""
    env_file = Path(__file__).resolve().parent / ".env"
    if not env_file.is_file():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith(("postgres://", "postgresql://")):  # bare URL without DATABASE_URL=
            os.environ.setdefault("DATABASE_URL", line)
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()
DATABASE_URL = (os.environ.get("DATABASE_URL") or "").strip()
if DATABASE_URL.startswith("postgres://"):  # psycopg2 wants the postgresql:// scheme
    DATABASE_URL = "postgresql://" + DATABASE_URL[len("postgres://"):]


CACHE_SECONDS = float(os.environ.get("DB_CACHE_SECONDS", "5"))
_conn = None
_conn_lock = Lock()


def _db_run(fn):
    """Run fn(cursor) on one shared, reused connection (reconnecting once if Neon dropped it)."""
    global _conn
    import psycopg2

    with _conn_lock:
        for attempt in (1, 2):
            try:
                if _conn is None or _conn.closed:
                    _conn = psycopg2.connect(DATABASE_URL, connect_timeout=15)
                    _conn.autocommit = True
                with _conn.cursor() as cur:
                    return fn(cur)
            except (psycopg2.OperationalError, psycopg2.InterfaceError):
                try:
                    if _conn is not None:
                        _conn.close()
                except Exception:
                    pass
                _conn = None
                if attempt == 2:
                    raise


def storage_mode() -> dict:
    """Which backend is in use (for the /api/storage-status check). Never exposes the password."""
    if not DATABASE_URL:
        return {"mode": "files", "database": False}
    host = DATABASE_URL.split("@")[-1].split("/")[0]
    return {"mode": "postgres", "database": True, "host": host}


print("Storage:", "Postgres (" + storage_mode()["host"] + ")" if DATABASE_URL else "local JSON files (DATABASE_URL not set)")


class JsonStore:
    def __init__(self, path: Path, default: Any) -> None:
        self.path = path
        self.default = default
        self.lock = Lock()
        self.key = path.name
        self.use_db = bool(DATABASE_URL)
        self._cache: str | None = None
        self._cache_at = 0.0
        if self.use_db:
            self._init_db()
        else:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            if not self.path.exists():
                self.write(default)

    # ---- Postgres backend -------------------------------------------------
    def _init_db(self) -> None:
        initial = self.default
        if self.path.exists():  # keep existing data: seed the database from the old JSON file
            try:
                initial = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                initial = self.default

        def op(cur):
            cur.execute("CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            cur.execute(
                "INSERT INTO kv_store (key, value) VALUES (%s, %s) ON CONFLICT (key) DO NOTHING",
                (self.key, json.dumps(initial, ensure_ascii=False)),
            )

        with self.lock:
            _db_run(op)

    def _db_read(self) -> Any:
        # Served from memory when fresh: one Neon round trip every few seconds instead of
        # one per call (a single page load reads the stores many times).
        now = time.monotonic()
        if self._cache is not None and now - self._cache_at < CACHE_SECONDS:
            return json.loads(self._cache)

        def op(cur):
            cur.execute("SELECT value FROM kv_store WHERE key = %s", (self.key,))
            return cur.fetchone()

        row = _db_run(op)
        text = row[0] if row else json.dumps(self.default, ensure_ascii=False)
        self._cache, self._cache_at = text, now
        return json.loads(text)

    def _db_write(self, data: Any) -> None:
        text = json.dumps(data, ensure_ascii=False)
        if text == self._cache:  # unchanged (the app re-saves settings often): skip the round trip
            self._cache_at = time.monotonic()
            return

        def op(cur):
            cur.execute(
                "INSERT INTO kv_store (key, value) VALUES (%s, %s) "
                "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                (self.key, text),
            )

        _db_run(op)
        self._cache, self._cache_at = text, time.monotonic()

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

_known_hashes: dict = {}
_last_check = 0.0


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
                _known_hashes[rel] = hashlib.md5(bytes(data)).hexdigest()
            folder = base_dir / sub
            if folder.exists():
                for f in folder.iterdir():
                    rel = f"{sub}/{f.name}"
                    if f.is_file() and rel not in in_db:
                        blob = f.read_bytes()
                        _known_hashes[rel] = hashlib.md5(blob).hexdigest()
                        cur.execute(
                            "INSERT INTO file_store (path, data) VALUES (%s, %s) "
                            "ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data",
                            (rel, psycopg2.Binary(blob)),
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
            blob = f.read_bytes()
            _known_hashes[rel] = hashlib.md5(blob).hexdigest()
            cur.execute(
                "INSERT INTO file_store (path, data) VALUES (%s, %s) "
                "ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data",
                (rel, psycopg2.Binary(blob)),
            )
        cur.execute("DELETE FROM file_store WHERE path LIKE %s AND NOT (path = ANY(%s))", (sub + "/%", keep))


def refresh_files_if_changed(base_dir: Path, subdirs: list[str], every: float = 10.0) -> bool:
    """Pull files changed in the database by another device (e.g. an upload made locally).

    Checked at most once every `every` seconds. Returns True when something on disk changed,
    so the caller can reload the Excel registry.
    """
    global _last_check
    if not DATABASE_URL:
        return False
    now = time.monotonic()
    if now - _last_check < every:
        return False
    _last_check = now
    changed = False
    for sub in subdirs:
        def listing(cur, sub=sub):
            cur.execute("SELECT path, md5(data) FROM file_store WHERE path LIKE %s", (sub + "/%",))
            return cur.fetchall()

        rows = _db_run(listing)
        remote = {rel: digest for rel, digest in rows}
        for rel, digest in remote.items():
            if _known_hashes.get(rel) == digest:
                continue

            def fetch(cur, rel=rel):
                cur.execute("SELECT data FROM file_store WHERE path = %s", (rel,))
                return cur.fetchone()

            row = _db_run(fetch)
            if row:
                dest = base_dir / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(bytes(row[0]))
                _known_hashes[rel] = digest
                changed = True
        for rel in [r for r in list(_known_hashes) if r.startswith(sub + "/") and r not in remote]:
            (base_dir / rel).unlink(missing_ok=True)  # removed elsewhere (e.g. logo reset)
            _known_hashes.pop(rel, None)
            changed = True
    return changed
