"""Minha Rotina: rotinas-modelo, ocorrências por data, sessões e histórico.

Contrato e decisões em docs/minha-rotina.md. Resumo do modelo:

- **Rotina** (`routines` + `routine_activities`): o que a pessoa quer repetir.
- **Programação** (`routine_schedules`): em quais dias da semana a rotina entra.
- **Aplicação** (`routine_days`): uma linha por rotina e data em que ela foi
  aplicada, pela programação ou à mão. É a chave de idempotência: com a linha,
  a data nunca é gerada de novo, mesmo que a pessoa remova atividades.
- **Ocorrência** (`activity_occurrences`): o que foi planejado para uma data.
  Guarda uma cópia (snapshot) dos campos da atividade, então mudar a rotina não
  altera o significado de dias passados.
- **Tempo**: vem do cronômetro do Foco. A sessão do Foco iniciada a partir de
  uma atividade guarda `focus_sessions.activity_id`; o tempo de foco dessas
  sessões é o tempo investido na atividade (mesmos dados das estatísticas do Foco).
- **Log** (`activity_logs`): eventos relevantes de cada ocorrência.

Todo método recebe o id do usuário vindo da sessão de login e filtra por ele.
"""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Callable

from ..courses import CourseNotFound
from ..courses.catalog import Course, CourseNode
from ..errors import AppError
from ..focus import FocusService
from ..learning.db import Database, utcnow
from ..libraries import Libraries
from ..study.days import load_timezone, local_day
from ..study.preferences import PreferencesStore
from . import rules
from .rules import LinkType, Mode, RoutineStatus, Status


# --- erros ------------------------------------------------------------------------------


class RoutineNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "routine_not_found", "Rotina não encontrada.")


class OccurrenceNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "occurrence_not_found", "Atividade não encontrada.")


class InvalidTransition(AppError):
    def __init__(self, message: str) -> None:
        super().__init__(409, "invalid_transition", message)


class InvalidLink(AppError):
    def __init__(self, message: str = "Curso, módulo ou aula não encontrados na sua biblioteca.") -> None:
        super().__init__(422, "invalid_content_link", message, field="link")


class NotToday(AppError):
    def __init__(self, message: str) -> None:
        super().__init__(409, "activity_not_today", message)


class RoutineArchived(AppError):
    def __init__(self) -> None:
        super().__init__(409, "routine_archived", "Restaure a rotina antes de aplicá-la a um dia.")


# --- campos de atividade -------------------------------------------------------------


@dataclass(slots=True)
class Link:
    type: LinkType
    course_id: str
    section_id: str | None = None
    lesson_key: str | None = None


@dataclass(slots=True)
class ActivityInput:
    """Campos de uma atividade (da rotina ou avulsa). Já validados pela API."""

    title: str
    description: str = ""
    icon_key: str | None = None
    color: str | None = None
    duration_minutes: int | None = None
    start_time: str | None = None
    period: str | None = None
    priority: str = "normal"
    is_optional: bool = False
    notes: str = ""
    link: Link | None = None
    id: str | None = None  # atividades de rotina já existentes


@dataclass(slots=True)
class RoutineInput:
    name: str
    description: str = ""
    icon_key: str | None = None
    color: str | None = None
    mode: Mode = Mode.SCHEDULED
    preferred_start_time: str | None = None
    weekdays: list[int] = field(default_factory=list)
    activities: list[ActivityInput] = field(default_factory=list)


# Colunas copiadas da atividade da rotina para a ocorrência (rotina -> ocorrência).
COPIED = [
    ("title", "title"), ("description", "description"), ("icon_key", "icon_key"), ("color", "color"),
    ("duration_minutes", "duration_minutes"), ("preferred_time", "start_time"), ("period", "period"),
    ("priority", "priority"), ("is_optional", "is_optional"), ("notes", "notes"), ("link_type", "link_type"),
    ("course_id", "course_id"), ("section_id", "section_id"), ("lesson_key", "lesson_key"),
]
OCCURRENCE_FIELDS = [occ for _, occ in COPIED]

# Ocorrência "intocada": pendente, sem ajustes locais, sem tempo registrado. Só
# essas podem ser recriadas ou apagadas pelo sistema quando o modelo muda.
UNTOUCHED = (
    "o.status = 'pending' AND o.customized = 0 AND o.rescheduled_from IS NULL AND o.manual_seconds IS NULL "
    "AND NOT EXISTS (SELECT 1 FROM focus_sessions f WHERE f.activity_id = o.id)"
)


def _new_id() -> str:
    return uuid.uuid4().hex


def _activity_columns(a: ActivityInput) -> dict[str, Any]:
    return {
        "title": a.title,
        "description": a.description,
        "icon_key": a.icon_key,
        "color": a.color,
        "duration_minutes": a.duration_minutes,
        "start_time": a.start_time,
        "period": a.period,
        "priority": a.priority,
        "is_optional": int(a.is_optional),
        "notes": a.notes,
        "link_type": a.link.type.value if a.link else None,
        "course_id": a.link.course_id if a.link else None,
        "section_id": a.link.section_id if a.link else None,
        "lesson_key": a.link.lesson_key if a.link else None,
    }


def _find_section(nodes: list[CourseNode], section_id: str) -> CourseNode | None:
    for node in nodes:
        if node.id == section_id:
            return node
        found = _find_section(node.children, section_id)
        if found:
            return found
    return None


class RoutineStore:
    def __init__(self, db: Database, preferences: PreferencesStore, libraries: Libraries, focus: FocusService) -> None:
        self.db = db
        self.preferences = preferences
        self.libraries = libraries
        self.focus = focus
        self.clock: Callable[[], float] = time.time

    # --- calendário --------------------------------------------------------------------

    def timezone(self, user_id: str) -> str:
        return self.preferences.effective_timezone(user_id)

    def today(self, user_id: str) -> date:
        return local_day(self.clock(), load_timezone(self.timezone(user_id)))

    # --- vínculos com cursos --------------------------------------------------------------

    def validate_link(self, user_id: str, link: Link | None) -> Link | None:
        """O destino precisa existir na biblioteca do próprio usuário."""
        if link is None:
            return None
        try:
            course = self.libraries.catalog(user_id).get(link.course_id)
        except (CourseNotFound, ValueError) as exc:
            raise InvalidLink() from exc
        if link.type is LinkType.COURSE:
            return Link(LinkType.COURSE, course.id)
        if link.type is LinkType.MODULE:
            if not link.section_id or _find_section(course.sections, link.section_id) is None:
                raise InvalidLink("Módulo não encontrado neste curso.")
            return Link(LinkType.MODULE, course.id, link.section_id)
        lesson = course.lesson(link.lesson_key or "")
        if lesson is None:
            raise InvalidLink("Aula não encontrada neste curso.")
        return Link(LinkType.LESSON, course.id, lesson.section_id, lesson.key)

    def _link_view(self, user_id: str, row: sqlite3.Row, cache: dict[str, Course | None]) -> dict | None:
        """Vínculo com os títulos atuais do catálogo (nunca copiados para a rotina)."""
        if not row["link_type"]:
            return None
        course_id = row["course_id"]
        if course_id not in cache:
            try:
                cache[course_id] = self.libraries.catalog(user_id).get(course_id)
            except (CourseNotFound, ValueError):
                cache[course_id] = None
        course = cache[course_id]
        view = {
            "type": row["link_type"], "course_id": course_id, "section_id": row["section_id"],
            "lesson_key": row["lesson_key"], "available": False,
            "course_title": None, "module_title": None, "lesson_title": None,
        }
        if course is None:
            return view
        view["course_title"] = course.title
        if row["link_type"] == LinkType.COURSE:
            view["available"] = True
        elif row["link_type"] == LinkType.MODULE:
            node = _find_section(course.sections, row["section_id"] or "")
            if node:
                view.update(available=True, module_title=node.title)
        else:
            lesson = course.lesson(row["lesson_key"] or "")
            if lesson:
                node = _find_section(course.sections, lesson.section_id)
                view.update(available=True, lesson_title=lesson.title, module_title=node.title if node else None)
        return view

    # --- rotinas ---------------------------------------------------------------------------

    def _routine_row(self, conn: sqlite3.Connection, user_id: str, routine_id: str) -> sqlite3.Row:
        row = conn.execute(
            "SELECT r.*, s.weekdays, s.starts_on FROM routines r LEFT JOIN routine_schedules s ON s.routine_id = r.id "
            "WHERE r.id = ? AND r.user_id = ? AND r.deleted_at IS NULL",
            (routine_id, user_id),
        ).fetchone()
        if row is None:
            raise RoutineNotFound()
        return row

    def _routine_view(self, conn: sqlite3.Connection, user_id: str, row: sqlite3.Row, cache: dict) -> dict:
        acts = conn.execute(
            "SELECT * FROM routine_activities WHERE routine_id = ? AND deleted_at IS NULL ORDER BY position",
            (row["id"],),
        ).fetchall()
        activities = [
            {
                "id": a["id"], "title": a["title"], "description": a["description"], "icon_key": a["icon_key"],
                "color": a["color"], "duration_minutes": a["duration_minutes"], "start_time": a["preferred_time"],
                "period": a["period"], "priority": a["priority"], "is_optional": bool(a["is_optional"]),
                "notes": a["notes"], "link": self._link_view(user_id, a, cache),
            }
            for a in acts
        ]
        total = sum(a["duration_minutes"] or 0 for a in activities)
        timed = [(rules.minutes(a["start_time"]), a["duration_minutes"] or 0) for a in activities if a["start_time"]]
        window = None
        if row["mode"] == Mode.SCHEDULED and timed:
            start = min(t for t, _ in timed)
            end = max(t + d for t, d in timed)
            window = {"start": rules.hhmm(start), "end": rules.hhmm(end)}
        elif row["preferred_start_time"]:
            start = rules.minutes(row["preferred_start_time"])
            window = {"start": row["preferred_start_time"], "end": rules.hhmm(start + total) if total else None}
        return {
            "id": row["id"], "name": row["name"], "description": row["description"], "icon_key": row["icon_key"],
            "color": row["color"], "mode": row["mode"], "preferred_start_time": row["preferred_start_time"],
            "status": row["status"], "weekdays": rules.weekdays_from_text(row["weekdays"] or ""),
            "activities": activities, "estimated_minutes": total, "window": window,
            "created_at": row["created_at"], "updated_at": row["updated_at"], "archived_at": row["archived_at"],
        }

    def list_routines(self, user_id: str) -> list[dict]:
        cache: dict = {}
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT r.*, s.weekdays, s.starts_on FROM routines r LEFT JOIN routine_schedules s ON s.routine_id = r.id "
                "WHERE r.user_id = ? AND r.deleted_at IS NULL ORDER BY r.created_at",
                (user_id,),
            ).fetchall()
            return [self._routine_view(conn, user_id, row, cache) for row in rows]

    def get_routine(self, user_id: str, routine_id: str) -> dict:
        with self.db.connect() as conn:
            return self._routine_view(conn, user_id, self._routine_row(conn, user_id, routine_id), {})

    def create_routine(self, user_id: str, data: RoutineInput) -> dict:
        for a in data.activities:
            a.link = self.validate_link(user_id, a.link)
        now = utcnow()
        routine_id = _new_id()
        today = self.today(user_id)
        with self.db.transaction() as conn:
            conn.execute(
                "INSERT INTO routines (id, user_id, name, description, icon_key, color, mode, preferred_start_time, "
                "status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)",
                (routine_id, user_id, data.name, data.description, data.icon_key, data.color, data.mode.value,
                 data.preferred_start_time, now, now),
            )
            conn.execute(
                "INSERT INTO routine_schedules (id, routine_id, weekdays, starts_on, timezone, is_enabled, created_at, "
                "updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
                (_new_id(), routine_id, rules.weekdays_to_text(data.weekdays), today.isoformat(),
                 self.timezone(user_id), now, now),
            )
            self._save_activities(conn, user_id, routine_id, data.activities, today)
            return self._routine_view(conn, user_id, self._routine_row(conn, user_id, routine_id), {})

    def save_routine(self, user_id: str, routine_id: str, data: RoutineInput) -> dict:
        """Grava o modelo inteiro (dados, dias e atividades, na ordem recebida).

        Efeito nas datas já planejadas (docs/minha-rotina.md, "Mudanças no modelo"):
        de hoje em diante, ocorrências intocadas acompanham o modelo; atividades
        novas entram nos dias já aplicados; dias que deixam a programação perdem
        as ocorrências intocadas a partir de amanhã. Passado nunca muda.
        """
        for a in data.activities:
            a.link = self.validate_link(user_id, a.link)
        today = self.today(user_id)
        now = utcnow()
        with self.db.transaction() as conn:
            before = self._routine_row(conn, user_id, routine_id)
            conn.execute(
                "UPDATE routines SET name = ?, description = ?, icon_key = ?, color = ?, mode = ?, "
                "preferred_start_time = ?, updated_at = ? WHERE id = ?",
                (data.name, data.description, data.icon_key, data.color, data.mode.value, data.preferred_start_time,
                 now, routine_id),
            )
            old_days = set(rules.weekdays_from_text(before["weekdays"] or ""))
            new_days = set(data.weekdays)
            conn.execute(
                "UPDATE routine_schedules SET weekdays = ?, updated_at = ? WHERE routine_id = ?",
                (rules.weekdays_to_text(new_days), now, routine_id),
            )
            self._save_activities(conn, user_id, routine_id, data.activities, today)
            dropped = old_days - new_days
            if dropped:
                self._drop_scheduled_days(conn, user_id, routine_id, today, keep=lambda d: d.weekday() not in dropped)
            return self._routine_view(conn, user_id, self._routine_row(conn, user_id, routine_id), {})

    def _save_activities(self, conn, user_id: str, routine_id: str, items: list[ActivityInput], today: date) -> None:
        now = utcnow()
        existing = {
            r["id"]: r for r in conn.execute(
                "SELECT * FROM routine_activities WHERE routine_id = ? AND deleted_at IS NULL", (routine_id,)
            )
        }
        kept: set[str] = set()
        for position, item in enumerate(items):
            cols = _activity_columns(item)
            cols["preferred_time"] = cols.pop("start_time")
            if item.id and item.id in existing:
                kept.add(item.id)
                sets = ", ".join(f"{k} = ?" for k in cols)
                conn.execute(
                    f"UPDATE routine_activities SET {sets}, position = ?, updated_at = ? WHERE id = ?",
                    (*cols.values(), position, now, item.id),
                )
                # Ocorrências intocadas de hoje em diante acompanham o modelo.
                occ_sets = ", ".join(f"{occ} = ?" for _, occ in COPIED)
                conn.execute(
                    f"UPDATE activity_occurrences AS o SET {occ_sets}, updated_at = ? "
                    f"WHERE o.routine_activity_id = ? AND o.user_id = ? AND o.scheduled_date >= ? "
                    f"AND o.deleted_at IS NULL AND {UNTOUCHED}",
                    (*(cols[src] for src, _ in COPIED), now, item.id, user_id, today.isoformat()),
                )
            else:
                activity_id = _new_id()
                conn.execute(
                    f"INSERT INTO routine_activities (id, routine_id, user_id, {', '.join(cols)}, position, created_at, "
                    f"updated_at) VALUES (?, ?, ?, {', '.join('?' for _ in cols)}, ?, ?, ?)",
                    (activity_id, routine_id, user_id, *cols.values(), position, now, now),
                )
                # Atividade nova entra nos dias em que a rotina já está aplicada (de hoje em diante).
                days = conn.execute(
                    "SELECT day FROM routine_days WHERE user_id = ? AND routine_id = ? AND status = 'applied' AND day >= ?",
                    (user_id, routine_id, today.isoformat()),
                ).fetchall()
                activity = conn.execute("SELECT * FROM routine_activities WHERE id = ?", (activity_id,)).fetchone()
                for d in days:
                    self._insert_generated(conn, user_id, routine_id, activity, date.fromisoformat(d["day"]), None)
        for activity_id in set(existing) - kept:
            conn.execute("UPDATE routine_activities SET deleted_at = ?, updated_at = ? WHERE id = ?", (now, now, activity_id))
            conn.execute(
                f"DELETE FROM activity_occurrences AS o WHERE o.routine_activity_id = ? AND o.user_id = ? "
                f"AND o.scheduled_date >= ? AND {UNTOUCHED}",
                (activity_id, user_id, today.isoformat()),
            )

    def _drop_scheduled_days(self, conn, user_id: str, routine_id: str, today: date, keep: Callable[[date], bool]) -> None:
        """Tira dias futuros (a partir de amanhã) gerados pela programação, só o que está intocado."""
        rows = conn.execute(
            "SELECT day FROM routine_days WHERE user_id = ? AND routine_id = ? AND origin = 'schedule' AND day > ?",
            (user_id, routine_id, today.isoformat()),
        ).fetchall()
        for r in rows:
            d = date.fromisoformat(r["day"])
            if keep(d):
                continue
            conn.execute(
                f"DELETE FROM activity_occurrences AS o WHERE o.user_id = ? AND o.routine_id = ? AND o.origin_date = ? "
                f"AND {UNTOUCHED}",
                (user_id, routine_id, r["day"]),
            )
            left = conn.execute(
                "SELECT 1 FROM activity_occurrences WHERE user_id = ? AND routine_id = ? AND origin_date = ? LIMIT 1",
                (user_id, routine_id, r["day"]),
            ).fetchone()
            if left is None:
                conn.execute(
                    "DELETE FROM routine_days WHERE user_id = ? AND routine_id = ? AND day = ?", (user_id, routine_id, r["day"])
                )

    def set_routine_status(self, user_id: str, routine_id: str, status: RoutineStatus) -> dict:
        """Ativa, pausa ou arquiva. Pausar ou arquivar tira das datas futuras o que não foi tocado."""
        today = self.today(user_id)
        now = utcnow()
        with self.db.transaction() as conn:
            row = self._routine_row(conn, user_id, routine_id)
            if row["status"] != status:
                archived_at = now if status is RoutineStatus.ARCHIVED else None
                conn.execute(
                    "UPDATE routines SET status = ?, archived_at = ?, updated_at = ? WHERE id = ?",
                    (status.value, archived_at, now, routine_id),
                )
                conn.execute(
                    "UPDATE routine_schedules SET is_enabled = ?, updated_at = ?, starts_on = CASE WHEN ? THEN ? ELSE starts_on END "
                    "WHERE routine_id = ?",
                    (int(status is RoutineStatus.ACTIVE), now, int(status is RoutineStatus.ACTIVE), today.isoformat(), routine_id),
                )
                if status is not RoutineStatus.ACTIVE:
                    self._drop_scheduled_days(conn, user_id, routine_id, today, keep=lambda d: False)
            return self._routine_view(conn, user_id, self._routine_row(conn, user_id, routine_id), {})

    def delete_routine(self, user_id: str, routine_id: str) -> None:
        """Exclusão lógica: o histórico (ocorrências, sessões e logs) continua de pé."""
        today = self.today(user_id)
        now = utcnow()
        with self.db.transaction() as conn:
            self._routine_row(conn, user_id, routine_id)
            self._drop_scheduled_days(conn, user_id, routine_id, today, keep=lambda d: False)
            # Dias futuros aplicados à mão também perdem o que não foi tocado.
            conn.execute(
                f"DELETE FROM activity_occurrences AS o WHERE o.user_id = ? AND o.routine_id = ? AND o.scheduled_date > ? "
                f"AND {UNTOUCHED}",
                (user_id, routine_id, today.isoformat()),
            )
            conn.execute(
                "UPDATE routines SET deleted_at = ?, status = 'archived', archived_at = COALESCE(archived_at, ?), "
                "updated_at = ? WHERE id = ?",
                (now, now, now, routine_id),
            )
            conn.execute("UPDATE routine_schedules SET is_enabled = 0, updated_at = ? WHERE routine_id = ?", (now, routine_id))

    # --- geração de ocorrências ------------------------------------------------------------

    def _next_position(self, conn, user_id: str, day: date) -> float:
        row = conn.execute(
            "SELECT MAX(position) FROM activity_occurrences WHERE user_id = ? AND scheduled_date = ?",
            (user_id, day.isoformat()),
        ).fetchone()
        return (row[0] if row[0] is not None else -1) + 1

    def _insert_generated(self, conn, user_id: str, routine_id: str, activity: sqlite3.Row, day: date,
                          shift: int | None, position: float | None = None) -> str | None:
        """Cria (ou revive, se tinha sido removida pela pessoa) a ocorrência da atividade naquela data."""
        now = utcnow()
        values = {occ: activity[src] for src, occ in COPIED}
        if shift and values["start_time"]:
            values["start_time"] = rules.hhmm(rules.minutes(values["start_time"]) + shift)
        existing = conn.execute(
            "SELECT id, deleted_at FROM activity_occurrences WHERE user_id = ? AND routine_activity_id = ? AND origin_date = ?",
            (user_id, activity["id"], day.isoformat()),
        ).fetchone()
        if position is None:
            position = self._next_position(conn, user_id, day)
        if existing:
            if existing["deleted_at"] is None:
                return None
            sets = ", ".join(f"{k} = ?" for k in values)
            conn.execute(
                f"UPDATE activity_occurrences SET {sets}, scheduled_date = ?, status = 'pending', customized = 0, "
                f"rescheduled_from = NULL, skip_reason = NULL, completed_at = NULL, deleted_at = NULL, position = ?, "
                f"updated_at = ? WHERE id = ?",
                (*values.values(), day.isoformat(), position, now, existing["id"]),
            )
            return existing["id"]
        occurrence_id = _new_id()
        conn.execute(
            f"INSERT INTO activity_occurrences (id, user_id, routine_id, routine_activity_id, origin_date, scheduled_date, "
            f"{', '.join(values)}, position, status, source, created_at, updated_at) "
            f"VALUES (?, ?, ?, ?, ?, ?, {', '.join('?' for _ in values)}, ?, 'pending', 'routine', ?, ?)",
            (occurrence_id, user_id, routine_id, activity["id"], day.isoformat(), day.isoformat(), *values.values(),
             position, now, now),
        )
        return occurrence_id

    def _apply(self, conn, user_id: str, routine: sqlite3.Row, day: date, origin: str, *, shift: int | None = None,
               skip_titles: set[str] | None = None) -> list[str]:
        now = utcnow()
        conn.execute(
            "INSERT INTO routine_days (user_id, routine_id, day, origin, status, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, 'applied', ?, ?) ON CONFLICT (user_id, routine_id, day) "
            "DO UPDATE SET status = 'applied', updated_at = excluded.updated_at",
            (user_id, routine["id"], day.isoformat(), origin, now, now),
        )
        acts = conn.execute(
            "SELECT * FROM routine_activities WHERE routine_id = ? AND deleted_at IS NULL ORDER BY position",
            (routine["id"],),
        ).fetchall()
        base = self._next_position(conn, user_id, day)
        created = []
        for i, activity in enumerate(acts):
            if skip_titles and rules.normalized_title(activity["title"]) in skip_titles:
                continue
            occurrence_id = self._insert_generated(conn, user_id, routine["id"], activity, day, shift, base + i)
            if occurrence_id:
                created.append(occurrence_id)
        return created

    def ensure_generated(self, user_id: str, start: date, end: date) -> None:
        """Gera, de forma idempotente, as ocorrências das rotinas ativas no intervalo.

        Só gera de hoje até `PLANNING_WINDOW_DAYS` à frente e nunca antes do dia
        de ativação. Datas com linha em `routine_days` (aplicadas ou removidas)
        não são geradas de novo.
        """
        today = self.today(user_id)
        first = max(start, today)
        last = min(end, today + timedelta(days=rules.PLANNING_WINDOW_DAYS))
        if first > last:
            return
        with self.db.connect() as conn:
            routines = conn.execute(
                "SELECT r.*, s.weekdays, s.starts_on FROM routines r JOIN routine_schedules s ON s.routine_id = r.id "
                "WHERE r.user_id = ? AND r.deleted_at IS NULL AND r.status = 'active' AND s.is_enabled = 1 AND s.weekdays != ''",
                (user_id,),
            ).fetchall()
            if not routines:
                return
            done = {
                (r["routine_id"], r["day"]) for r in conn.execute(
                    "SELECT routine_id, day FROM routine_days WHERE user_id = ? AND day BETWEEN ? AND ?",
                    (user_id, first.isoformat(), last.isoformat()),
                )
            }
        todo = [
            (routine, d)
            for routine in routines
            for d in rules.daterange(max(first, date.fromisoformat(routine["starts_on"])), last)
            if d.weekday() in rules.weekdays_from_text(routine["weekdays"]) and (routine["id"], d.isoformat()) not in done
        ]
        if not todo:
            return
        with self.db.transaction() as conn:
            for routine, d in todo:
                exists = conn.execute(
                    "SELECT 1 FROM routine_days WHERE user_id = ? AND routine_id = ? AND day = ?",
                    (user_id, routine["id"], d.isoformat()),
                ).fetchone()
                if not exists:  # outro pedido pode ter gerado entre a leitura e a trava
                    self._apply(conn, user_id, routine, d, "schedule")

    # --- aplicar rotina à mão -------------------------------------------------------------

    def _shift(self, conn, routine: sqlite3.Row, start_time: str | None) -> int | None:
        if not start_time:
            return None
        base = routine["preferred_start_time"]
        if not base:
            row = conn.execute(
                "SELECT MIN(preferred_time) FROM routine_activities WHERE routine_id = ? AND deleted_at IS NULL",
                (routine["id"],),
            ).fetchone()
            base = row[0]
        if not base:
            return None
        return rules.minutes(start_time) - rules.minutes(base)

    def preview_apply(self, user_id: str, routine_id: str, day: date, start_time: str | None = None) -> dict:
        """O que entraria no dia, quais já existem (mesmo nome) e quais horários se sobrepõem."""
        self.ensure_generated(user_id, day, day)
        with self.db.connect() as conn:
            routine = self._routine_row(conn, user_id, routine_id)
            applied = conn.execute(
                "SELECT status FROM routine_days WHERE user_id = ? AND routine_id = ? AND day = ?",
                (user_id, routine_id, day.isoformat()),
            ).fetchone()
            shift = self._shift(conn, routine, start_time)
            acts = conn.execute(
                "SELECT * FROM routine_activities WHERE routine_id = ? AND deleted_at IS NULL ORDER BY position",
                (routine_id,),
            ).fetchall()
            existing = conn.execute(
                "SELECT id, title, start_time, duration_minutes, status, routine_id, routine_activity_id "
                "FROM activity_occurrences WHERE user_id = ? AND scheduled_date = ? AND deleted_at IS NULL",
                (user_id, day.isoformat()),
            ).fetchall()
        others = [o for o in existing if o["routine_id"] != routine_id]
        mine = {o["routine_activity_id"] for o in existing if o["routine_id"] == routine_id}
        titles = {rules.normalized_title(o["title"]): o for o in others}
        items = []
        for a in acts:
            start = a["preferred_time"]
            if shift and start:
                start = rules.hhmm(rules.minutes(start) + shift)
            conflicts_with = []
            if start:
                for o in others:
                    if o["start_time"] and o["status"] not in (Status.CANCELLED, Status.SKIPPED) and rules.overlaps(
                        rules.minutes(start), a["duration_minutes"] or 0, rules.minutes(o["start_time"]), o["duration_minutes"] or 0
                    ):
                        conflicts_with.append({"id": o["id"], "title": o["title"], "start_time": o["start_time"]})
            dup = titles.get(rules.normalized_title(a["title"]))
            items.append({
                "activity_id": a["id"], "title": a["title"], "start_time": start, "duration_minutes": a["duration_minutes"],
                "period": a["period"], "already_in_day": a["id"] in mine,
                "duplicate_of": {"id": dup["id"], "title": dup["title"]} if dup else None,
                "conflicts": conflicts_with,
            })
        return {
            "routine_id": routine_id, "date": day.isoformat(),
            "already_applied": bool(applied and applied["status"] == "applied"),
            "items": items,
            "shifted": bool(shift),
        }

    def apply_routine(self, user_id: str, routine_id: str, day: date, *, start_time: str | None = None,
                      skip_duplicates: bool = False) -> dict:
        """Aplica a rotina ao dia. Aplicar de novo não duplica nada."""
        self.ensure_generated(user_id, day, day)
        with self.db.transaction() as conn:
            routine = self._routine_row(conn, user_id, routine_id)
            if routine["status"] == RoutineStatus.ARCHIVED:
                raise RoutineArchived()
            skip: set[str] | None = None
            if skip_duplicates:
                skip = {
                    rules.normalized_title(r["title"]) for r in conn.execute(
                        "SELECT title FROM activity_occurrences WHERE user_id = ? AND scheduled_date = ? "
                        "AND deleted_at IS NULL AND (routine_id IS NULL OR routine_id != ?)",
                        (user_id, day.isoformat(), routine_id),
                    )
                }
            created = self._apply(conn, user_id, routine, day, "manual", shift=self._shift(conn, routine, start_time),
                                  skip_titles=skip)
            for occurrence_id in created:
                self._log(conn, user_id, occurrence_id, "applied", {"routine_id": routine_id})
        return {"created": created}

    def unapply_routine(self, user_id: str, routine_id: str, day: date) -> dict:
        """Tira a rotina do dia sem excluir o modelo. Concluídas e em andamento ficam no histórico."""
        now = utcnow()
        with self.db.transaction() as conn:
            self._routine_row(conn, user_id, routine_id)
            conn.execute(
                f"DELETE FROM activity_occurrences AS o WHERE o.user_id = ? AND o.routine_id = ? AND o.scheduled_date = ? "
                f"AND {UNTOUCHED}",
                (user_id, routine_id, day.isoformat()),
            )
            rows = conn.execute(
                "SELECT id FROM activity_occurrences WHERE user_id = ? AND routine_id = ? AND scheduled_date = ? "
                "AND deleted_at IS NULL AND status IN ('pending', 'skipped', 'cancelled')",
                (user_id, routine_id, day.isoformat()),
            ).fetchall()
            for r in rows:
                conn.execute("UPDATE activity_occurrences SET deleted_at = ?, updated_at = ? WHERE id = ?", (now, now, r["id"]))
                self._log(conn, user_id, r["id"], "removed", {"reason": "routine_removed"})
            conn.execute(
                "INSERT INTO routine_days (user_id, routine_id, day, origin, status, created_at, updated_at) "
                "VALUES (?, ?, ?, 'manual', 'removed', ?, ?) ON CONFLICT (user_id, routine_id, day) "
                "DO UPDATE SET status = 'removed', updated_at = excluded.updated_at",
                (user_id, routine_id, day.isoformat(), now, now),
            )
        return {"removed": len(rows)}

    # --- leitura da agenda -----------------------------------------------------------------

    def _occurrences(self, conn, user_id: str, start: date, end: date) -> list[sqlite3.Row]:
        return conn.execute(
            "SELECT o.*, r.name AS routine_name, r.color AS routine_color, r.icon_key AS routine_icon, r.mode AS routine_mode, "
            "r.deleted_at AS routine_deleted_at "
            "FROM activity_occurrences o LEFT JOIN routines r ON r.id = o.routine_id "
            "WHERE o.user_id = ? AND o.scheduled_date BETWEEN ? AND ? AND o.deleted_at IS NULL",
            (user_id, start.isoformat(), end.isoformat()),
        ).fetchall()

    def _session_totals(self, conn, ids: list[str], now: float) -> dict[str, float]:
        """Segundos de foco por atividade, somando as sessões do Foco ligadas a ela.

        Na sessão ativa, soma também o trecho que está rodando agora (igual ao que o
        temporizador mostra). Pausas e descansos não contam.
        """
        totals: dict[str, float] = {}
        for chunk in range(0, len(ids), 500):
            part = ids[chunk:chunk + 500]
            rows = conn.execute(
                f"SELECT activity_id, status, stage, focus_seconds, run_started_at, paused_at FROM focus_sessions "
                f"WHERE activity_id IN ({', '.join('?' for _ in part)})",
                part,
            ).fetchall()
            for r in rows:
                seconds = r["focus_seconds"]
                if r["status"] == "active" and r["stage"] == "focus" and r["paused_at"] is None and r["run_started_at"]:
                    seconds += max(0.0, now - r["run_started_at"])
                totals[r["activity_id"]] = totals.get(r["activity_id"], 0.0) + seconds
        return totals

    @staticmethod
    def _focus_activity(conn, user_id: str) -> str | None:
        row = conn.execute(
            "SELECT activity_id FROM focus_sessions WHERE user_id = ? AND status = 'active'", (user_id,)
        ).fetchone()
        return row["activity_id"] if row else None

    def _occurrence_view(self, user_id: str, row: sqlite3.Row, timer: float, cache: dict, active: str | None = None) -> dict:
        manual = row["manual_seconds"] or 0
        status = row["status"]
        if active == row["id"] and status == Status.PENDING:
            status = Status.IN_PROGRESS.value  # o cronômetro do Foco está rodando nela
        return {
            "id": row["id"],
            "date": row["scheduled_date"],
            "start_time": row["start_time"],
            "duration_minutes": row["duration_minutes"],
            "period": row["period"],
            "display_period": rules.period_of(row["start_time"], row["period"]),
            "position": row["position"],
            "title": row["title"],
            "description": row["description"],
            "icon_key": row["icon_key"],
            "color": row["color"],
            "priority": row["priority"],
            "is_optional": bool(row["is_optional"]),
            "notes": row["notes"],
            "status": status,
            "source": row["source"],
            "customized": bool(row["customized"]),
            "rescheduled_from": row["rescheduled_from"],
            "skip_reason": row["skip_reason"],
            "completed_at": row["completed_at"],
            "timer_seconds": round(timer),
            "focusing": active == row["id"],
            "manual_seconds": row["manual_seconds"],
            "invested_seconds": round(timer + manual),
            "link": self._link_view(user_id, row, cache),
            "routine": (
                {"id": row["routine_id"], "name": row["routine_name"], "color": row["routine_color"],
                 "icon_key": row["routine_icon"], "mode": row["routine_mode"],
                 "deleted": row["routine_deleted_at"] is not None}
                if row["routine_id"] and row["routine_name"] is not None else None
            ),
            "routine_activity_id": row["routine_activity_id"],
        }

    @staticmethod
    def _sort_key(item: dict):
        return (item["start_time"] is None, item["start_time"] or "", item["position"])

    def agenda(self, user_id: str, start: date, end: date) -> dict:
        self.ensure_generated(user_id, start, end)
        self.focus.sync(user_id)  # aplica o que o Foco já deveria ter encerrado
        now = self.clock()
        cache: dict = {}
        with self.db.connect() as conn:
            rows = self._occurrences(conn, user_id, start, end)
            totals = self._session_totals(conn, [r["id"] for r in rows], now)
            active = self._focus_activity(conn, user_id)
        by_day: dict[str, list[dict]] = {d.isoformat(): [] for d in rules.daterange(start, end)}
        for r in rows:
            by_day[r["scheduled_date"]].append(self._occurrence_view(user_id, r, totals.get(r["id"], 0.0), cache, active))
        days = []
        for d, items in by_day.items():
            items.sort(key=self._sort_key)
            days.append({
                "date": d, "occurrences": items, "summary": rules.summarize(items).to_dict(),
                "conflicts": rules.conflicts(items),
            })
        return {"today": self.today(user_id).isoformat(), "timezone": self.timezone(user_id), "days": days}

    def day(self, user_id: str, day: date) -> dict:
        data = self.agenda(user_id, day, day)
        result = data["days"][0]
        with self.db.connect() as conn:
            applied = conn.execute(
                "SELECT d.routine_id, d.origin, r.name, r.color, r.icon_key, r.status FROM routine_days d "
                "JOIN routines r ON r.id = d.routine_id WHERE d.user_id = ? AND d.day = ? AND d.status = 'applied' "
                "AND r.deleted_at IS NULL ORDER BY r.created_at",
                (user_id, day.isoformat()),
            ).fetchall()
        result["routines"] = [
            {"id": r["routine_id"], "name": r["name"], "color": r["color"], "icon_key": r["icon_key"],
             "origin": r["origin"], "status": r["status"]}
            for r in applied
        ]
        result["streak"] = self.streak(user_id)
        result["today"] = data["today"]
        result["timezone"] = data["timezone"]
        return result

    def _consistency(self, user_id: str, start: date, end: date) -> dict[date, rules.DaySummary]:
        now = self.clock()
        with self.db.connect() as conn:
            rows = self._occurrences(conn, user_id, start, end)
            totals = self._session_totals(conn, [r["id"] for r in rows], now)
            active = self._focus_activity(conn, user_id)
        by_day: dict[date, list[dict]] = {}
        for r in rows:
            by_day.setdefault(date.fromisoformat(r["scheduled_date"]), []).append({
                "status": Status.IN_PROGRESS.value if active == r["id"] and r["status"] == Status.PENDING else r["status"],
                "is_optional": bool(r["is_optional"]), "duration_minutes": r["duration_minutes"],
                "invested_seconds": totals.get(r["id"], 0.0) + (r["manual_seconds"] or 0),
            })
        return {d: rules.summarize(items) for d, items in by_day.items()}

    def streak(self, user_id: str) -> dict:
        today = self.today(user_id)
        summaries = self._consistency(user_id, today - timedelta(days=rules.STREAK_LOOKBACK_DAYS), today)
        result = rules.streak({d: s.consistent for d, s in summaries.items()}, today)
        result["rule"] = {"min_ratio": rules.CONSISTENCY_MIN_RATIO, "min_completed": rules.CONSISTENCY_MIN_COMPLETED}
        return result

    def stats(self, user_id: str, start: date, end: date) -> dict:
        """Evolução: resumo por dia (só do que foi planejado de fato) e totais do período."""
        summaries = self._consistency(user_id, start, end)
        days = []
        for d in rules.daterange(start, end):
            s = summaries.get(d)
            days.append({"date": d.isoformat(), **(s.to_dict() if s else rules.summarize([]).to_dict())})
        planned_days = [s for s in summaries.values() if s.planned]
        totals = {
            "completed": sum(s.completed for s in summaries.values()),
            "planned": sum(s.planned for s in summaries.values()),
            "skipped": sum(s.skipped for s in summaries.values()),
            "invested_seconds": sum(s.invested_seconds for s in summaries.values()),
            "planned_minutes": sum(s.planned_minutes for s in summaries.values()),
            "planned_days": len(planned_days),
            "consistent_days": sum(1 for s in planned_days if s.consistent),
        }
        totals["time_done_seconds"] = sum(s.time_done_seconds for s in summaries.values())
        totals["time_progress"] = (
            min(1.0, totals["time_done_seconds"] / (totals["planned_minutes"] * 60)) if totals["planned_minutes"] else None
        )
        now = self.clock()
        with self.db.connect() as conn:
            rows = [r for r in self._occurrences(conn, user_id, start, end) if r["routine_id"] and r["routine_deleted_at"] is None]
            seconds = self._session_totals(conn, [r["id"] for r in rows], now)
        groups: dict[str, dict] = {}
        for r in rows:
            g = groups.setdefault(r["routine_id"], {
                "id": r["routine_id"], "name": r["routine_name"], "color": r["routine_color"], "icon_key": r["routine_icon"],
                "items": [],
            })
            g["items"].append({
                "status": r["status"], "is_optional": bool(r["is_optional"]), "duration_minutes": r["duration_minutes"],
                "invested_seconds": seconds.get(r["id"], 0.0) + (r["manual_seconds"] or 0),
            })
        per_routine = []
        for g in groups.values():
            summary = rules.summarize(g.pop("items"))
            if summary.planned:
                per_routine.append({**g, "completed": summary.completed, "planned": summary.planned,
                                    "planned_minutes": summary.planned_minutes, "time_done_seconds": summary.time_done_seconds,
                                    "time_progress": summary.time_progress})
        per_routine.sort(key=lambda g: -g["planned"])
        return {
            "from": start.isoformat(), "to": end.isoformat(), "today": self.today(user_id).isoformat(),
            "days": days, "totals": totals, "streak": self.streak(user_id),
            "routines": per_routine,
        }

    # --- ocorrências ----------------------------------------------------------------------

    def _occurrence_row(self, conn, user_id: str, occurrence_id: str) -> sqlite3.Row:
        row = conn.execute(
            "SELECT * FROM activity_occurrences WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
            (occurrence_id, user_id),
        ).fetchone()
        if row is None:
            raise OccurrenceNotFound()
        return row

    def get_occurrence(self, user_id: str, occurrence_id: str) -> dict:
        with self.db.connect() as conn:
            self._occurrence_row(conn, user_id, occurrence_id)
            row = conn.execute(
                "SELECT o.*, r.name AS routine_name, r.color AS routine_color, r.icon_key AS routine_icon, "
                "r.mode AS routine_mode, r.deleted_at AS routine_deleted_at FROM activity_occurrences o "
                "LEFT JOIN routines r ON r.id = o.routine_id WHERE o.id = ?",
                (occurrence_id,),
            ).fetchone()
            totals = self._session_totals(conn, [occurrence_id], self.clock())
            active = self._focus_activity(conn, user_id)
            logs = conn.execute(
                "SELECT event_type, event_data, created_at FROM activity_logs WHERE occurrence_id = ? ORDER BY id",
                (occurrence_id,),
            ).fetchall()
        view = self._occurrence_view(user_id, row, totals.get(occurrence_id, 0.0), {}, active)
        view["history"] = [
            {"type": r["event_type"], "data": json.loads(r["event_data"]) if r["event_data"] else None, "at": r["created_at"]}
            for r in logs
        ]
        return view

    def _log(self, conn, user_id: str, occurrence_id: str, event: str, data: dict | None = None) -> None:
        conn.execute(
            "INSERT INTO activity_logs (user_id, occurrence_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, occurrence_id, event, json.dumps(data, ensure_ascii=False) if data else None, utcnow()),
        )

    def create_occurrence(self, user_id: str, day: date, data: ActivityInput, repeat_weekdays: list[int] | None = None) -> dict:
        """Atividade avulsa. Com `repeat_weekdays`, vira uma rotina de uma atividade só (recorrente)."""
        data.link = self.validate_link(user_id, data.link)
        if repeat_weekdays:
            routine = self.create_routine(user_id, RoutineInput(
                name=data.title, icon_key=data.icon_key, color=data.color,
                mode=Mode.SCHEDULED if data.start_time else (Mode.FLEXIBLE if data.period else Mode.SEQUENCE),
                weekdays=repeat_weekdays, activities=[data],
            ))
            with self.db.transaction() as conn:
                row = self._routine_row(conn, user_id, routine["id"])
                created = self._apply(conn, user_id, row, day, "manual")
                existing = conn.execute(
                    "SELECT id FROM activity_occurrences WHERE user_id = ? AND routine_id = ? AND origin_date = ?",
                    (user_id, routine["id"], day.isoformat()),
                ).fetchone()
                occurrence_id = created[0] if created else existing["id"]
                self._log(conn, user_id, occurrence_id, "created", {"routine_id": routine["id"]})
            return self.get_occurrence(user_id, occurrence_id)
        now = utcnow()
        cols = _activity_columns(data)
        occurrence_id = _new_id()
        with self.db.transaction() as conn:
            position = self._next_position(conn, user_id, day)
            conn.execute(
                f"INSERT INTO activity_occurrences (id, user_id, scheduled_date, {', '.join(cols)}, position, status, source, "
                f"created_at, updated_at) VALUES (?, ?, ?, {', '.join('?' for _ in cols)}, ?, 'pending', 'manual', ?, ?)",
                (occurrence_id, user_id, day.isoformat(), *cols.values(), position, now, now),
            )
            self._log(conn, user_id, occurrence_id, "created")
        return self.get_occurrence(user_id, occurrence_id)

    def update_occurrence(self, user_id: str, occurrence_id: str, changes: dict[str, Any], scope: str = "occurrence") -> dict:
        """Edita a ocorrência. `scope`:

        - "occurrence": só esta data (marca a ocorrência como personalizada);
        - "following": esta, as próximas ocorrências pendentes desta atividade e o modelo;
        - "routine": só o modelo (e, com ele, as próximas datas intocadas). Esta fica como está.
        """
        if "link" in changes:
            changes["link"] = self.validate_link(user_id, changes["link"])
        cols: dict[str, Any] = {}
        for key, value in changes.items():
            if key == "link":
                cols.update({
                    "link_type": value.type.value if value else None, "course_id": value.course_id if value else None,
                    "section_id": value.section_id if value else None, "lesson_key": value.lesson_key if value else None,
                })
            elif key == "is_optional":
                cols[key] = int(value)
            else:
                cols[key] = value
        today = self.today(user_id)
        now = utcnow()
        with self.db.transaction() as conn:
            row = self._occurrence_row(conn, user_id, occurrence_id)
            if scope != "occurrence" and not row["routine_activity_id"]:
                scope = "occurrence"
            if not cols:
                pass
            elif scope in ("occurrence", "following"):
                sets = ", ".join(f"{k} = ?" for k in cols)
                conn.execute(
                    f"UPDATE activity_occurrences SET {sets}, customized = ?, updated_at = ? WHERE id = ?",
                    (*cols.values(), int(scope == "occurrence" and row["source"] == "routine"), now, occurrence_id),
                )
                self._log(conn, user_id, occurrence_id, "edited", {"fields": sorted(changes), "scope": scope})
            if cols and scope in ("following", "routine"):
                template = {("preferred_time" if k == "start_time" else k): v for k, v in cols.items()}
                sets = ", ".join(f"{k} = ?" for k in template)
                conn.execute(
                    f"UPDATE routine_activities SET {sets}, updated_at = ? WHERE id = ? AND user_id = ?",
                    (*template.values(), now, row["routine_activity_id"], user_id),
                )
                sets = ", ".join(f"{k} = ?" for k in cols)
                if scope == "following":
                    # As próximas, a partir desta data, mesmo as personalizadas (só nos campos alterados).
                    conn.execute(
                        f"UPDATE activity_occurrences SET {sets}, updated_at = ? WHERE routine_activity_id = ? AND user_id = ? "
                        f"AND scheduled_date > ? AND status = 'pending' AND deleted_at IS NULL",
                        (*cols.values(), now, row["routine_activity_id"], user_id, row["scheduled_date"]),
                    )
                else:
                    first = max(today + timedelta(days=1), date.fromisoformat(row["scheduled_date"]) + timedelta(days=1))
                    conn.execute(
                        f"UPDATE activity_occurrences AS o SET {sets}, updated_at = ? WHERE o.routine_activity_id = ? "
                        f"AND o.user_id = ? AND o.scheduled_date >= ? AND o.deleted_at IS NULL AND {UNTOUCHED}",
                        (*cols.values(), now, row["routine_activity_id"], user_id, first.isoformat()),
                    )
                conn.execute(
                    "UPDATE routines SET updated_at = ? WHERE id = (SELECT routine_id FROM routine_activities WHERE id = ?)",
                    (now, row["routine_activity_id"]),
                )
        return self.get_occurrence(user_id, occurrence_id)

    def set_status(self, user_id: str, occurrence_id: str, status: Status, *, actual_minutes: int | None = None,
                   reason: str | None = None) -> dict:
        """Concluir, pular, cancelar ou reabrir (voltar a pendente). Repetir o mesmo estado não muda nada."""
        if status is Status.IN_PROGRESS:
            raise InvalidTransition("Use o cronômetro do Foco para iniciar uma atividade.")
        with self.db.connect() as conn:
            current = self._occurrence_row(conn, user_id, occurrence_id)
        self._check_day(user_id, current, status)
        if status is not Status.PENDING:
            self._stop_focus(user_id, occurrence_id)  # o tempo feito até aqui fica guardado no Foco
        now = utcnow()
        with self.db.transaction() as conn:
            row = self._occurrence_row(conn, user_id, occurrence_id)
            if row["status"] != status or actual_minutes is not None:
                self._apply_status(conn, user_id, row, status, actual_minutes, reason, now)
        return self.get_occurrence(user_id, occurrence_id)

    def _apply_status(self, conn, user_id: str, row: sqlite3.Row, status: Status, actual_minutes: int | None,
                      reason: str | None, now: str) -> None:
        occurrence_id = row["id"]
        manual = row["manual_seconds"]
        if status is Status.COMPLETED and actual_minutes is not None:
            manual = actual_minutes * 60
        conn.execute(
            "UPDATE activity_occurrences SET status = ?, completed_at = ?, skip_reason = ?, manual_seconds = ?, "
            "updated_at = ? WHERE id = ?",
            (status.value, now if status is Status.COMPLETED else None,
             reason if status is Status.SKIPPED else None, manual, now, occurrence_id),
        )
        event = {"pending": "reopened"}.get(status.value, status.value)
        data = {"from": row["status"]}
        if actual_minutes is not None:
            data["actual_minutes"] = actual_minutes
        if reason:
            data["reason"] = reason
        self._log(conn, user_id, occurrence_id, event, data)

    def reschedule(self, user_id: str, occurrence_id: str, day: date, start_time: str | None) -> dict:
        """Move a ocorrência para outra data ou horário. A rotina base não muda."""
        now = utcnow()
        with self.db.transaction() as conn:
            row = self._occurrence_row(conn, user_id, occurrence_id)
            if row["status"] == Status.COMPLETED:
                raise InvalidTransition("Atividades concluídas ficam no dia em que foram feitas.")
            moved_day = day.isoformat() != row["scheduled_date"]
            position = self._next_position(conn, user_id, day) if moved_day else row["position"]
            conn.execute(
                "UPDATE activity_occurrences SET scheduled_date = ?, start_time = ?, position = ?, "
                "rescheduled_from = COALESCE(rescheduled_from, ?), customized = CASE WHEN source = 'routine' THEN 1 ELSE 0 END, "
                "status = CASE WHEN status = 'skipped' THEN 'pending' ELSE status END, updated_at = ? WHERE id = ?",
                (day.isoformat(), start_time, position, row["scheduled_date"] if moved_day else None, now, occurrence_id),
            )
            self._log(conn, user_id, occurrence_id, "rescheduled", {
                "from_date": row["scheduled_date"], "from_time": row["start_time"],
                "to_date": day.isoformat(), "to_time": start_time,
            })
        result = self.get_occurrence(user_id, occurrence_id)
        with self.db.connect() as conn:
            items = [dict(r) for r in conn.execute(
                "SELECT id, title, start_time, duration_minutes, status FROM activity_occurrences "
                "WHERE user_id = ? AND scheduled_date = ? AND deleted_at IS NULL",
                (user_id, day.isoformat()),
            )]
        result["conflicts"] = [
            next(i for i in items if i["id"] == (b if a == occurrence_id else a))
            for a, b in rules.conflicts(items) if occurrence_id in (a, b)
        ]
        return result

    def reorder(self, user_id: str, day: date, ids: list[str]) -> None:
        """Nova ordem de exibição do dia. Não muda horários."""
        now = utcnow()
        with self.db.transaction() as conn:
            owned = {
                r["id"] for r in conn.execute(
                    "SELECT id FROM activity_occurrences WHERE user_id = ? AND scheduled_date = ? AND deleted_at IS NULL",
                    (user_id, day.isoformat()),
                )
            }
            if not set(ids) <= owned:
                raise OccurrenceNotFound()
            for position, occurrence_id in enumerate(ids):
                conn.execute(
                    "UPDATE activity_occurrences SET position = ?, updated_at = ? WHERE id = ?", (position, now, occurrence_id)
                )

    def remove_occurrence(self, user_id: str, occurrence_id: str) -> None:
        """Tira a atividade do dia (exclusão lógica). A rotina de origem não muda."""
        self._stop_focus(user_id, occurrence_id)
        now = utcnow()
        with self.db.transaction() as conn:
            row = self._occurrence_row(conn, user_id, occurrence_id)
            conn.execute("UPDATE activity_occurrences SET deleted_at = ?, updated_at = ? WHERE id = ?", (now, now, occurrence_id))
            self._log(conn, user_id, occurrence_id, "removed", {"status": row["status"]})

    # --- dia e cronômetro do Foco ------------------------------------------------------------

    def _check_day(self, user_id: str, row: sqlite3.Row, status: Status) -> None:
        """Concluir só vale para hoje. Dias seguintes só podem ser editados (nem concluir, nem pular)."""
        day = date.fromisoformat(row["scheduled_date"])
        today = self.today(user_id)
        if status is Status.COMPLETED and day != today and row["status"] != Status.COMPLETED:
            if day > today:
                raise NotToday("Esta atividade é de um dia que ainda não chegou. Por enquanto, dá para editá-la.")
            raise NotToday("Só dá para concluir atividades de hoje. Dias que já passaram ficam como estão.")
        if status is Status.SKIPPED and day > today:
            raise NotToday("Esta atividade é de um dia que ainda não chegou. Por enquanto, dá para editá-la.")

    def prepare_focus(self, user_id: str, occurrence_id: str) -> dict:
        """Confere se a atividade pode receber tempo do Foco agora (chamado ao iniciar a sessão do Foco)."""
        with self.db.transaction() as conn:
            row = self._occurrence_row(conn, user_id, occurrence_id)
            day = date.fromisoformat(row["scheduled_date"])
            if day != self.today(user_id):
                raise NotToday("O cronômetro só pode ser usado em atividades de hoje.")
            if row["status"] in (Status.COMPLETED, Status.CANCELLED):
                raise InvalidTransition("Reabra a atividade antes de iniciar o cronômetro.")
            if row["status"] == Status.SKIPPED:
                conn.execute(
                    "UPDATE activity_occurrences SET status = 'pending', skip_reason = NULL, updated_at = ? WHERE id = ?",
                    (utcnow(), occurrence_id),
                )
            self._log(conn, user_id, occurrence_id, "focus_started", None)
            return {"title": row["title"]}

    def _stop_focus(self, user_id: str, occurrence_id: str) -> None:
        """Encerra a sessão do Foco que está alimentando esta atividade, se houver."""
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT id, version, stage FROM focus_sessions WHERE user_id = ? AND status = 'active' AND activity_id = ?",
                (user_id, occurrence_id),
            ).fetchone()
        if row is None:
            return
        try:
            self.focus.act(user_id, row["id"], "stop", str(uuid.uuid4()), row["version"], confirm=True)
        except AppError:
            pass  # a sessão já terminou ou mudou em outro aparelho: o tempo dela já está gravado
