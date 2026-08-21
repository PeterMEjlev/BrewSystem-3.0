"""Making a deploy actually reach the screen.

Two things used to stop it. index.html was served with no Cache-Control, so
Chromium's heuristic caching served a weeks-old copy without asking; and even
once it did ask, nothing told a kiosk that had been up for days to go and ask.
These cover the backend half of both — the build id it reports, and the header
that lets a reload mean anything.
"""


def test_the_entry_point_is_never_cached(app_module):
    """The one file that names the current bundle, and so the one file that
    must always be fetched rather than assumed."""
    response = app_module._index_response()
    assert response.headers["cache-control"] == "no-store"


def test_the_build_id_tracks_the_bundle(app_module, tmp_path, monkeypatch):
    """A rebuild gives index.html a new bundle to name, so the id must move."""
    monkeypatch.setattr(app_module, "STATIC_DIR", tmp_path)

    (tmp_path / "index.html").write_text('<script src="/assets/index-AAAA.js">')
    first = app_module._ui_build()

    (tmp_path / "index.html").write_text('<script src="/assets/index-BBBB.js">')
    second = app_module._ui_build()

    assert first and second
    assert first != second


def test_the_build_id_is_stable_while_the_bundle_is(app_module, tmp_path, monkeypatch):
    """Otherwise every reconnect would look like a deploy and the kiosk would
    reload itself in a loop — the one failure worse than a stale screen."""
    monkeypatch.setattr(app_module, "STATIC_DIR", tmp_path)
    (tmp_path / "index.html").write_text('<script src="/assets/index-AAAA.js">')
    assert app_module._ui_build() == app_module._ui_build()


def test_a_backend_with_no_build_reports_nothing(app_module, tmp_path, monkeypatch):
    """A dev machine runs vite separately and this backend serves no dist/.
    None tells the client there is nothing to compare, rather than a value it
    would read as a change."""
    monkeypatch.setattr(app_module, "STATIC_DIR", tmp_path / "nowhere")
    assert app_module._ui_build() is None


def test_a_backend_only_change_does_not_move_the_id(app_module, tmp_path, monkeypatch):
    """Restarting for a backend-only deploy must not bounce every screen: the
    bundle they are running is still the one being served."""
    monkeypatch.setattr(app_module, "STATIC_DIR", tmp_path)
    (tmp_path / "index.html").write_text('<script src="/assets/index-AAAA.js">')
    before = app_module._ui_build()

    # Whatever else a deploy changed, index.html did not move.
    (tmp_path / "something-else.txt").write_text("backend only")
    assert app_module._ui_build() == before
