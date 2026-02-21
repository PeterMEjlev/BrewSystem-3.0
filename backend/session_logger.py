import csv
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
        timestamp = datetime.now().strftime("%d-%m-%Y")
        self._log_path = LOG_DIR / f"session_{timestamp}.csv"
        self._history = []
        with open(self._log_path, "w", newline="") as f:
            csv.writer(f).writerow(["timestamp", "bk", "mlt", "hlt"])

    def log_reading(self, bk: float, mlt: float, hlt: float) -> None:
        """Append one timestamped reading to the CSV and in-memory history."""
        if self._log_path is None:
            return
        ts = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        row = {"timestamp": ts, "bk": bk, "mlt": mlt, "hlt": hlt}
        self._history.append(row)
        with open(self._log_path, "a", newline="") as f:
            csv.writer(f).writerow([ts, bk, mlt, hlt])

    def get_history(self) -> list[dict]:
        """Return a copy of all readings logged in the current session."""
        return list(self._history)


# Module-level singleton imported by main.py
session_logger = SessionLogger()
