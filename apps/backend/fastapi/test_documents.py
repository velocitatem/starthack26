from __future__ import annotations

import sys
import types
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[3]
FASTAPI_DIR = ROOT / "apps" / "backend" / "fastapi"

for path in (str(ROOT), str(FASTAPI_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)

import server  # noqa: E402


def test_upload_document_extracts_text_and_returns_metadata(monkeypatch):
    captured: dict[str, object] = {}

    def _fake_insert(
        doc_id: str,
        filename: str,
        content_text: str,
        status: str = "ready",
        error_message: str | None = None,
    ):
        captured["doc_id"] = doc_id
        captured["filename"] = filename
        captured["content_text"] = content_text
        captured["status"] = status
        captured["error_message"] = error_message
        return {
            "id": doc_id,
            "filename": filename,
            "status": status,
            "error_message": "",
            "uploaded_at": "2026-03-19T12:00:00Z",
        }

    monkeypatch.setattr(server, "insert_building_document", _fake_insert)
    monkeypatch.setattr(
        server,
        "_start_document_processing",
        lambda doc_id, filename, data: captured.update(
            {"started": True, "started_doc_id": doc_id, "started_filename": filename}
        ),
    )

    with TestClient(server.app) as client:
        response = client.post(
            "/api/documents/upload",
            files={"file": ("building-notes.txt", b"Boiler plant in basement", "text/plain")},
        )

    assert response.status_code == 202
    payload = response.json()

    assert payload == {
        "id": payload["id"],
        "filename": "building-notes.txt",
        "status": "processing",
        "errorMessage": None,
        "uploadedAt": "2026-03-19T12:00:00Z",
    }
    assert captured["filename"] == "building-notes.txt"
    assert captured["content_text"] == ""
    assert captured["started"] is True
    assert captured["started_filename"] == "building-notes.txt"


def test_upload_document_rejects_unsupported_extension():
    with TestClient(server.app) as client:
        response = client.post(
            "/api/documents/upload",
            files={"file": ("diagram.docx", b"not-supported", "application/octet-stream")},
        )

    assert response.status_code == 400
    assert "unsupported file type" in response.json()["detail"]


def test_list_and_delete_document_endpoints(monkeypatch):
    monkeypatch.setattr(
        server,
        "list_building_documents",
        lambda: [
            {
                "id": "doc-123",
                "filename": "layout.pdf",
                "status": "ready",
                "error_message": "",
                "uploaded_at": "2026-03-19T12:00:00Z",
            }
        ],
    )

    with TestClient(server.app) as client:
        list_response = client.get("/api/documents")

    assert list_response.status_code == 200
    assert list_response.json() == [
        {
            "id": "doc-123",
            "filename": "layout.pdf",
            "status": "ready",
            "errorMessage": None,
            "uploadedAt": "2026-03-19T12:00:00Z",
        }
    ]

    monkeypatch.setattr(server, "delete_building_document", lambda _doc_id: True)

    with TestClient(server.app) as client:
        delete_response = client.delete("/api/documents/doc-123")

    assert delete_response.status_code == 200
    assert delete_response.json() == {"ok": True}


def test_delete_document_returns_404_when_missing(monkeypatch):
    monkeypatch.setattr(server, "delete_building_document", lambda _doc_id: False)

    with TestClient(server.app) as client:
        response = client.delete("/api/documents/missing")

    assert response.status_code == 404


def test_extract_text_reads_full_pdf_content(monkeypatch):
    class _FakePage:
        def __init__(self, text: str):
            self._text = text

        def get_text(self, _mode="text"):
            return self._text

    class _FakeDocument:
        def __init__(self, pages):
            self._pages = pages

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def __iter__(self):
            return iter(self._pages)

    fake_module = types.SimpleNamespace(
        open=lambda **_kwargs: _FakeDocument(
            [_FakePage("A" * 30_000), _FakePage("B" * 30_000), _FakePage("C" * 30_000)]
        )
    )
    monkeypatch.setitem(sys.modules, "pymupdf", fake_module)

    extracted = server.extract_text("large.pdf", b"%PDF-1.4")

    assert "A" * 30_000 in extracted
    assert "B" * 30_000 in extracted
    assert "C" * 30_000 in extracted
