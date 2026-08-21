import csv
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

LOG_DIR = Path(__file__).parent / "session_logs"


class SessionLogger:
    def __init__(self):
        self._log_path: Optional[Path] = None
        self._history: list[dict] = []

    @property
    def log_dir(self) -> Path:
        """Where session logs live.

        Read through the instance so that anything choosing to sit beside them
        follows the directory wherever it is pointed — which the tests do.
        """
        return LOG_DIR

    @property
    def current_path(self) -> Optional[Path]:
        """The CSV being appended to, or None before a session is open."""
        return self._log_path

    def start_new_session(self) -> None:
        """Create a new session log file and reset in-memory history."""
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        # Date AND time so a same-day restart never truncates an earlier
        # session; the format also sorts chronologically.
        timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        path = LOG_DIR / f"session_{timestamp}.csv"
        # ...and a counter, because seconds are not fine enough on their own.
        # Two sessions can start inside one second — a brewer answering the
        # resume dialog with "start fresh" moments after the rig came back, or
        # a double tap on Initialize — and the file being opened "w" here is
        # the only copy of the readings the earlier one took.
        attempt = 1
        while path.exists():
            path = LOG_DIR / f"session_{timestamp}_{attempt}.csv"
            attempt += 1
        self._log_path = path
        self._history = []
        with open(self._log_path, "w", newline="") as f:
            csv.writer(f).writerow(["timestamp", "epoch_ms", "bk", "mlt", "hlt"])

    def resume_session(self, path: Path) -> bool:
        """Reopen an existing session log and read its rows back into memory.

        The other half of start_new_session: used when the backend restarts
        during a brew and the brewer keeps the session that was running. The
        history has to come back off disk, because it is the whole curve the
        chart has been drawing all day and the only copy of it that outlived
        the process.

        A row that cannot be read is skipped rather than failing the resume —
        a torn last line is exactly what a power cut leaves behind, and losing
        one reading is not a reason to lose the brew.
        """
        if not path.exists():
            return False

        history: list[dict] = []
        try:
            with open(path, newline="") as f:
                for raw in csv.DictReader(f):
                    row = self._row_from_csv(raw)
                    if row is not None:
                        history.append(row)
        except OSError:
            return False

        self._log_path = path
        self._history = history
        return True

    @staticmethod
    def _row_from_csv(raw: dict) -> Optional[dict]:
        """One CSV line as the in-memory history holds it, or None if unusable.

        The epoch column is what everything downstream sorts and filters on, so
        a row without a readable one is no use; the ISO timestamp beside it is
        the fallback, since it carries the same instant.
        """
        def number(value):
            if value is None or value == "":
                return None
            try:
                return float(value)
            except ValueError:
                return None

        timestamp = raw.get("timestamp") or ""
        epoch_ms = None
        try:
            epoch_ms = int(raw["epoch_ms"])
        except (KeyError, TypeError, ValueError):
            try:
                epoch_ms = int(
                    datetime.strptime(timestamp, "%Y-%m-%dT%H:%M:%S").timestamp() * 1000
                )
            except ValueError:
                return None

        return {
            "timestamp": timestamp,
            "ts": epoch_ms,
            "bk": number(raw.get("bk")),
            "mlt": number(raw.get("mlt")),
            "hlt": number(raw.get("hlt")),
        }

    def log_reading(
        self, bk: Optional[float], mlt: Optional[float], hlt: Optional[float]
    ) -> Optional[dict]:
        """Append one timestamped reading to the CSV and in-memory history.

        Each row carries both the human-readable ISO timestamp and an epoch
        timestamp in ms ("ts") so consumers can filter/compare without
        re-parsing ISO strings (incremental history fetch, averages).

        None means the sensor read failed — kept as None in history (JSON null)
        and written as an empty CSV cell, so charts/averages skip it.

        Returns the row that was written, so the caller can push it to the
        connected charts without reading it back; None if no session is open."""
        if self._log_path is None:
            return None
        epoch_ms = int(time.time() * 1000)
        ts = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        row = {"timestamp": ts, "ts": epoch_ms, "bk": bk, "mlt": mlt, "hlt": hlt}
        self._history.append(row)
        with open(self._log_path, "a", newline="") as f:
            csv.writer(f).writerow([ts, epoch_ms, bk, mlt, hlt])
        return row

    def get_history(self, since_ms: Optional[int] = None) -> list[dict]:
        """Return readings logged in the current session.

        With since_ms, only rows strictly newer than that epoch timestamp are
        returned — the chart uses this to top up instead of re-downloading the
        whole session."""
        if since_ms is None:
            return list(self._history)
        # History is chronological — scan from the end so a top-up of the last
        # few rows doesn't walk the entire session.
        idx = len(self._history)
        while idx > 0 and self._history[idx - 1]["ts"] > since_ms:
            idx -= 1
        return self._history[idx:]


# Module-level singleton imported by main.py
session_logger = SessionLogger()
