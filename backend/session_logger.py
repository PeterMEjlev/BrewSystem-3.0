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

    def start_new_session(self) -> None:
        """Create a new session log file and reset in-memory history."""
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        # Date AND time so a same-day restart never truncates an earlier
        # session; the format also sorts chronologically.
        timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        self._log_path = LOG_DIR / f"session_{timestamp}.csv"
        self._history = []
        with open(self._log_path, "w", newline="") as f:
            csv.writer(f).writerow(["timestamp", "epoch_ms", "bk", "mlt", "hlt"])

    def log_reading(self, bk: Optional[float], mlt: Optional[float], hlt: Optional[float]) -> None:
        """Append one timestamped reading to the CSV and in-memory history.

        Each row carries both the human-readable ISO timestamp and an epoch
        timestamp in ms ("ts") so consumers can filter/compare without
        re-parsing ISO strings (incremental history fetch, averages).

        None means the sensor read failed — kept as None in history (JSON null)
        and written as an empty CSV cell, so charts/averages skip it."""
        if self._log_path is None:
            return
        epoch_ms = int(time.time() * 1000)
        ts = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        row = {"timestamp": ts, "ts": epoch_ms, "bk": bk, "mlt": mlt, "hlt": hlt}
        self._history.append(row)
        with open(self._log_path, "a", newline="") as f:
            csv.writer(f).writerow([ts, epoch_ms, bk, mlt, hlt])

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
