import io

import pytest

from app.learning import Database
from app.notebook import NotebookStore
from app.notebook.document import InvalidDocument, parse

from .conftest import register

API = "/api/notebook"
COURSE = "curso_exemplo"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + (640).to_bytes(4, "big") + (480).to_bytes(4, "big") + b"\x08\x02" + b"\x00" * 64


def doc(*paragraphs, extra=None):
    content = [{"type": "paragraph", "content": [{"type": "text", "text": p}]} for p in paragraphs]
    return {"type": "doc", "content": content + (extra or [])}


def ref(lesson="A002", seconds=None, course=COURSE, kind="lesson", section=None):
    return {"type": "courseRef", "attrs": {"courseId": course, "kind": kind, "lessonKey": lesson if kind == "lesson" else None,
                                            "sectionId": section, "seconds": seconds, "label": "Aula"}}


@pytest.fixture
def client(make_app):
    client = make_app()
    register(client)
    return client


@pytest.fixture
def other(make_app):
    other = make_app()
    register(other, "maria")
    return other


def create(client, **body):
    response = client.post(f"{API}/notes", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def quick(client, text="nota", seconds=None, lesson="A001"):
    return create(client, kind="quick", doc=doc(text), link={"course_id": COURSE, "lesson_key": lesson},
                  timestamp_seconds=seconds)


# --- documento --------------------------------------------------------------------


def test_document_rejects_unknown_blocks_and_strips_unsafe_links():
    with pytest.raises(InvalidDocument):
        parse({"type": "doc", "content": [{"type": "script", "content": []}]})
    bad = {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "clique", "marks": [{"type": "link", "attrs": {"href": "javascript:alert(1)"}}]},
        {"type": "text", "text": " aqui", "marks": [{"type": "link", "attrs": {"href": "https://ok.dev", "onclick": "x"}}]},
    ]}]}
    parsed = parse(bad)
    first, second = parsed.doc["content"][0]["content"]
    assert "marks" not in first
    assert second["marks"] == [{"type": "link", "attrs": {"href": "https://ok.dev"}}]
    assert parsed.text == "clique aqui"


def test_document_extracts_text_math_refs_and_files():
    parsed = parse({"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Polimorfismo"}]},
        {"type": "mathBlock", "attrs": {"latex": r"\int_0^1 x^2\,dx"}},
        {"type": "paragraph", "content": [ref("A002", 194)]},
        {"type": "image", "attrs": {"src": "/api/notebook/files/" + "a" * 32, "alt": "diagrama"}},
    ]})
    assert "Polimorfismo" in parsed.text and r"\int_0^1" in parsed.text
    assert parsed.refs[0].lesson_key == "A002" and parsed.refs[0].seconds == 194
    assert parsed.files == {"a" * 32}
    with pytest.raises(InvalidDocument):
        parse({"type": "doc", "content": [{"type": "image", "attrs": {"src": "https://evil.dev/x.png"}}]})
    with pytest.raises(InvalidDocument):  # tabelas só no editor completo
        parse({"type": "doc", "content": [{"type": "table", "content": []}]}, full=False)


def test_legacy_lesson_notes_become_quick_notes(tmp_path):
    db = Database(tmp_path / "t.db")
    db.migrate()
    with db.connect() as conn:
        conn.execute("INSERT INTO users (id, username, password_hash, created_at) VALUES ('u1', 'j', 'x', 'now')")
        conn.execute("INSERT INTO lesson_notes VALUES ('u1', 'c', 'A001', 'linha 1\nlinha 2', 3, '2025-01-01T00:00:00+00:00')")
    store = NotebookStore(db)
    assert store.import_legacy() == 1
    assert store.import_legacy() == 0  # idempotente
    notes = store.for_lesson("u1", "c", "A001")["quick"]
    assert len(notes) == 1 and notes[0]["title"] == "linha 1"
    assert [p["content"][0]["text"] for p in notes[0]["doc"]["content"]] == ["linha 1", "linha 2"]


# --- notas rápidas da aula ---------------------------------------------------------------


def test_quick_notes_with_timestamps(client):
    late = quick(client, "segunda", 300)
    early = quick(client, "primeira", 194)
    untimed = quick(client, "sem tempo")
    data = client.get(f"{API}/lessons/{COURSE}/A001").json()
    assert [n["id"] for n in data["quick"]] == [early["id"], late["id"], untimed["id"]]
    assert data["quick"][0]["timestamp_seconds"] == 194 and data["quick"][0]["doc"]["type"] == "doc"
    # Tempo editado à mão; fora da duração do vídeo (600 s) é recusado.
    assert client.patch(f"{API}/notes/{early['id']}", json={"timestamp_seconds": 10}).json()["timestamp_seconds"] == 10
    bad = client.patch(f"{API}/notes/{early['id']}", json={"timestamp_seconds": 9999})
    assert bad.status_code == 400 and bad.json()["code"] == "timestamp_out_of_range"
    assert client.post(f"{API}/notes", json={"kind": "quick", "link": {"course_id": COURSE, "lesson_key": "A001"},
                                             "timestamp_seconds": 601.5}).status_code == 201  # folga de arredondamento
    assert client.get(f"{API}/lessons/{COURSE}/NAO").status_code == 404


def test_quick_note_rejects_full_editor_blocks(client):
    response = client.post(f"{API}/notes", json={
        "kind": "quick", "link": {"course_id": COURSE, "lesson_key": "A001"},
        "doc": {"type": "doc", "content": [{"type": "mathBlock", "attrs": {"latex": "x"}}]},
    })
    assert response.status_code == 400 and response.json()["code"] == "invalid_document"


def test_convert_quick_note_keeps_same_note(client):
    note = quick(client, "ideia rápida", 42)
    tag = client.post(f"{API}/tags", json={"name": "Revisão"}).json()
    client.patch(f"{API}/notes/{note['id']}", json={"tag_ids": [tag["id"]]})
    converted = client.patch(f"{API}/notes/{note['id']}", json={"kind": "page", "title": "Ideia desenvolvida"}).json()
    assert converted["id"] == note["id"] and converted["kind"] == "page"
    assert converted["timestamp_seconds"] == 42 and converted["lesson_key"] == "A001"
    assert converted["title"] == "Ideia desenvolvida" and converted["tags"][0]["name"] == "Revisão"
    assert converted["doc"] == note["doc"]
    lesson = client.get(f"{API}/lessons/{COURSE}/A001").json()
    assert lesson["quick"] == [] and lesson["pages"][0]["id"] == note["id"]
    assert len(client.get(f"{API}/notes").json()) == 1  # sem duplicar


# --- caderno -------------------------------------------------------------------------------


def test_standalone_note_and_later_link(client):
    note = create(client, title="Java", doc=doc("Classes e objetos"))
    assert note["course_id"] is None and note["context"] is None
    linked = client.patch(f"{API}/notes/{note['id']}", json={"link": {"course_id": COURSE, "lesson_key": "A002"}}).json()
    assert linked["context"]["lesson_title"] == "02 - Variaveis e tipos" and linked["context"]["status"] == "ok"
    module = client.patch(f"{API}/notes/{note['id']}", json={"link": {"course_id": COURSE, "section_id": "2.1"}}).json()
    assert module["context"]["section_title"] == "02.1. Variáveis"
    assert client.patch(f"{API}/notes/{note['id']}", json={"link": {"course_id": "nao-existe"}}).status_code == 404
    unlinked = client.patch(f"{API}/notes/{note['id']}", json={"link": None}).json()
    assert unlinked["course_id"] is None
    by_course = client.get(f"{API}/overview").json()["courses"]
    assert by_course[0]["id"] == COURSE


def test_autosave_conflict_and_history(client):
    note = create(client, title="Rascunho", doc=doc("v1"))
    saved = client.put(f"{API}/notes/{note['id']}/content", json={"title": "Rascunho", "doc": doc("v2"), "base_revision": 1}).json()
    assert saved["revision"] == 2
    # Outro dispositivo, ainda na revisão 1:
    stale = client.put(f"{API}/notes/{note['id']}/content", json={"doc": doc("do celular"), "base_revision": 1})
    assert stale.status_code == 409
    current = stale.json()["current"]
    assert current["revision"] == 2 and current["doc"]["content"][0]["content"][0]["text"] == "v2"
    # A pessoa escolhe a própria versão: a do servidor vai para o histórico.
    kept = client.put(f"{API}/notes/{note['id']}/content",
                      json={"doc": doc("do celular"), "base_revision": 2, "overwrite": True}).json()
    assert kept["revision"] == 3
    history = client.get(f"{API}/notes/{note['id']}/revisions").json()
    assert history[0]["reason"] == "conflict" and history[0]["revision"] == 2
    restored = client.post(f"{API}/notes/{note['id']}/revisions/{history[0]['id']}/restore", json={"base_revision": 3}).json()
    assert restored["doc"]["content"][0]["content"][0]["text"] == "v2" and restored["revision"] == 4
    assert client.get(f"{API}/notes/{note['id']}/revision").json()["revision"] == 4


def test_folders_tree_move_and_delete(client):
    root = client.post(f"{API}/folders", json={"name": "Programação"}).json()
    child = client.post(f"{API}/folders", json={"name": "Java", "parent_id": root["id"]}).json()
    grandchild = client.post(f"{API}/folders", json={"name": "POO", "parent_id": child["id"]}).json()
    cycle = client.patch(f"{API}/folders/{root['id']}", json={"parent_id": grandchild["id"]})
    assert cycle.status_code == 400 and cycle.json()["code"] == "folder_cycle"
    assert client.patch(f"{API}/folders/{child['id']}", json={"name": "Java 21"}).status_code == 204
    assert client.post(f"{API}/folders", json={"name": "  "}).status_code == 400
    note = create(client, title="Herança", doc=doc("extends"), folder_id=grandchild["id"])
    loose = create(client, title="Solta", doc=doc("x"))
    moved = client.patch(f"{API}/notes/{loose['id']}", json={"folder_id": child["id"]}).json()
    assert [p["name"] for p in moved["folder_path"]] == ["Programação", "Java 21"]
    assert client.patch(f"{API}/notes/{loose['id']}", json={"folder_id": None}).json()["folder_id"] is None
    assert client.delete(f"{API}/folders/{root['id']}").json() == {"trashed": 1}
    assert client.get(f"{API}/overview").json()["folders"] == []
    trash = client.get(f"{API}/notes", params={"view": "trash"}).json()
    assert [n["id"] for n in trash] == [note["id"]]
    restored = client.post(f"{API}/notes/{note['id']}/restore").json()
    assert restored["folder_id"] is None and restored["deleted_at"] is None


def test_quick_actions(client):
    note = create(client, title="Importante", doc=doc("conteúdo"))
    client.patch(f"{API}/notes/{note['id']}", json={"favorite": True, "pinned": True})
    overview = client.get(f"{API}/overview").json()["counts"]
    assert overview["favorites"] == 1 and overview["pinned"] == 1
    assert [n["id"] for n in client.get(f"{API}/notes", params={"view": "pinned"}).json()] == [note["id"]]
    copy = client.post(f"{API}/notes/{note['id']}/duplicate").json()
    assert copy["title"] == "Importante (cópia)" and copy["id"] != note["id"]
    archived = client.patch(f"{API}/notes/{note['id']}", json={"archived": True}).json()
    assert archived["archived"] and not archived["pinned"]
    assert note["id"] not in [n["id"] for n in client.get(f"{API}/notes").json()]
    assert client.delete(f"{API}/notes/{copy['id']}?permanent=true").status_code == 400  # só da lixeira
    assert client.delete(f"{API}/notes/{copy['id']}").status_code == 204
    assert client.put(f"{API}/notes/{copy['id']}/content", json={"doc": doc("x"), "base_revision": 1}).status_code == 400
    assert client.delete(f"{API}/notes/{copy['id']}?permanent=true").status_code == 204
    assert client.get(f"{API}/notes/{copy['id']}").status_code == 404


def test_tags(client):
    poo = client.post(f"{API}/tags", json={"name": "POO", "color": "blue"}).json()
    again = client.post(f"{API}/tags", json={"name": "poo"}).json()
    assert again["id"] == poo["id"]  # sem duplicar por maiúsculas
    note = create(client, title="Java", doc=doc("x"), tag_ids=[poo["id"]])
    assert [n["id"] for n in client.get(f"{API}/notes", params={"tag": poo["id"]}).json()] == [note["id"]]
    assert client.patch(f"{API}/tags/{poo['id']}", json={"color": "neon"}).status_code == 400
    client.delete(f"{API}/tags/{poo['id']}")
    assert client.get(f"{API}/notes/{note['id']}").json()["tags"] == []


# --- busca ------------------------------------------------------------------------------------


def test_search_content_title_and_scope(client):
    folder = client.post(f"{API}/folders", json={"name": "Estudos"}).json()
    a = create(client, title="Polimorfismo em Java", doc=doc("Sobrescrita de métodos e herança."), folder_id=folder["id"])
    b = create(client, title="Outra", doc=doc("A herança múltipla não existe em Java."))
    c = quick(client, "herança na aula", 30)
    result = client.get(f"{API}/search", params={"q": "heranca"}).json()  # sem acento também acha
    assert {r["id"] for r in result["results"]} == {a["id"], b["id"], c["id"]}
    hit = next(r for r in result["results"] if r["id"] == a["id"])
    assert "\u0002herança\u0003" in hit["snippet"]
    assert [r["id"] for r in client.get(f"{API}/search", params={"q": "polim"}).json()["results"]] == [a["id"]]
    scoped = client.get(f"{API}/search", params={"q": "herança", "folder": folder["id"]}).json()
    assert [r["id"] for r in scoped["results"]] == [a["id"]]
    by_course = client.get(f"{API}/search", params={"q": "herança", "course": COURSE}).json()
    assert [r["id"] for r in by_course["results"]] == [c["id"]]
    assert client.get(f"{API}/search", params={"q": '"não existe"'}).json()["results"][0]["id"] == b["id"]
    # Conteúdo editado é reindexado; nota na lixeira some da busca.
    client.put(f"{API}/notes/{b['id']}/content", json={"doc": doc("interfaces"), "base_revision": 1})
    client.delete(f"{API}/notes/{a['id']}")
    assert {r["id"] for r in client.get(f"{API}/search", params={"q": "herança"}).json()["results"]} == {c["id"]}
    assert client.get(f"{API}/search", params={"q": "*** ("}).json()["results"] == []


# --- referências --------------------------------------------------------------------------------


def test_references_resolution_and_backlinks(client):
    note = create(client, title="Resumo", doc=doc("Ver", extra=[{"type": "paragraph", "content": [
        ref("A002", 194), ref("A004", 9999), ref("SUMIU"), ref(kind="section", section="2.2"), ref(kind="course", course="outro"),
    ]}]))
    status = {(r["lesson_key"] or r["section_id"] or r["course_id"]): r["status"] for r in note["refs"]}
    assert status == {"A002": "ok", "A004": "out_of_range", "SUMIU": "missing_target", "2.2": "ok", "outro": "missing_course"}
    lesson = client.get(f"{API}/lessons/{COURSE}/A002").json()
    assert lesson["citing"][0]["id"] == note["id"] and lesson["citing"][0]["moments"] == [194]
    by_course = client.get(f"{API}/notes", params={"course": COURSE, "lesson": "A002"}).json()
    assert [n["id"] for n in by_course] == [note["id"]]


def test_targets_for_mentions(client):
    found = client.get(f"{API}/targets", params={"q": "funcoes"}).json()
    assert any(t["kind"] == "lesson" and t["lesson_key"] == "A004" for t in found)
    assert any(t["kind"] == "section" and t["section_id"] == "2.2" for t in found)
    courses = client.get(f"{API}/targets").json()
    assert courses[0]["kind"] == "course" and courses[0]["course_id"] == COURSE
    assert all(t["kind"] != "lesson" or t["lesson_key"] != "A099" for t in courses)  # indisponível fica de fora


# --- arquivos ------------------------------------------------------------------------------------


def upload(client, data, name, kind="file"):
    return client.post(f"{API}/files", files={"file": (name, io.BytesIO(data), "application/octet-stream")}, data={"kind": kind})


def test_uploads_are_validated_and_private(client, other):
    image = upload(client, PNG, "diagrama.png", "image")
    assert image.status_code == 201, image.text
    info = image.json()
    assert info["mime"] == "image/png" and (info["width"], info["height"]) == (640, 480)
    served = client.get(info["url"])
    assert served.status_code == 200 and served.headers["content-type"] == "image/png"
    assert served.headers["x-content-type-options"] == "nosniff" and "sandbox" in served.headers["content-security-policy"]
    assert other.get(info["url"]).status_code == 404
    assert upload(client, b"<svg onload=alert(1)>", "x.svg", "image").json()["code"] == "invalid_image"
    assert upload(client, b"MZ\x90\x00", "virus.exe").json()["code"] == "file_type_not_allowed"
    assert upload(client, b"nao sou png", "falso.png").json()["code"] == "invalid_image"
    assert upload(client, b"nao sou pdf", "falso.pdf").json()["code"] == "invalid_file"
    assert upload(client, b"", "vazio.txt").json()["code"] == "file_empty"
    pdf = upload(client, b"%PDF-1.4 conteudo", "apostila.pdf").json()
    download = client.get(pdf["url"])
    assert download.headers["content-type"] == "application/octet-stream"
    assert download.headers["content-disposition"].startswith("attachment")


def test_files_in_documents_and_cleanup(client, other, tmp_path):
    image = upload(client, PNG, "a.png", "image").json()
    body = doc("figura", extra=[{"type": "image", "attrs": {"src": image["url"]}},
                                {"type": "attachment", "attrs": {"fileId": image["id"], "name": "a.png", "size": 1}}])
    # Maria não pode usar o arquivo de João.
    stolen = other.post(f"{API}/notes", json={"title": "x", "doc": body})
    assert stolen.status_code == 400 and stolen.json()["code"] == "file_not_found"
    note = create(client, title="Com imagem", doc=body)
    assert note["files"][0]["id"] == image["id"]
    copy = client.post(f"{API}/notes/{note['id']}/duplicate").json()
    client.delete(f"{API}/notes/{note['id']}")
    client.delete(f"{API}/notes/{note['id']}?permanent=true")
    assert client.get(image["url"]).status_code == 200  # a cópia ainda usa
    client.delete(f"{API}/notes/{copy['id']}")
    assert client.delete(f"{API}/trash").json() == {"deleted": 1}
    assert client.get(image["url"]).status_code == 404
    user_id = client.get("/api/auth/session").json()["user"]["id"]
    assert not (tmp_path / "notebook" / user_id / image["id"]).exists()


def test_notes_are_isolated_between_users(client, other):
    note = create(client, title="Segredo", doc=doc("minha senha do wifi"))
    folder = client.post(f"{API}/folders", json={"name": "Privada"}).json()
    tag = client.post(f"{API}/tags", json={"name": "Minha"}).json()
    assert other.get(f"{API}/notes/{note['id']}").status_code == 404
    assert other.put(f"{API}/notes/{note['id']}/content", json={"doc": doc("x"), "base_revision": 1}).status_code == 404
    assert other.patch(f"{API}/notes/{note['id']}", json={"favorite": True}).status_code == 404
    assert other.delete(f"{API}/notes/{note['id']}").status_code == 404
    assert other.get(f"{API}/notes/{note['id']}/revisions").status_code == 404
    assert other.post(f"{API}/notes/{note['id']}/duplicate").status_code == 404
    assert other.patch(f"{API}/folders/{folder['id']}", json={"name": "x"}).status_code == 404
    assert other.delete(f"{API}/folders/{folder['id']}").status_code == 404
    assert other.post(f"{API}/notes", json={"title": "x", "folder_id": folder["id"]}).status_code == 404
    assert other.delete(f"{API}/tags/{tag['id']}").status_code == 404
    mine = other.post(f"{API}/notes", json={"title": "x"}).json()
    assert other.patch(f"{API}/notes/{mine['id']}", json={"tag_ids": [tag["id"]]}).status_code == 404
    assert other.get(f"{API}/search", params={"q": "senha"}).json()["results"] == []
    assert other.get(f"{API}/notes").json()[0]["id"] == mine["id"]
    assert client.get(f"{API}/notes/{note['id']}").status_code == 200


def test_notebook_requires_login(make_app):
    anonymous = make_app()
    assert anonymous.get(f"{API}/overview").status_code == 401
    assert anonymous.post(f"{API}/files", files={"file": ("a.png", io.BytesIO(PNG))}).status_code == 401
