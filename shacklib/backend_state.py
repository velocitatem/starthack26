from __future__ import annotations

import os
import time
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, TypeVar

try:
    import psycopg
    from psycopg.types.json import Json
except ModuleNotFoundError:  # pragma: no cover - exercised in no-DB local runs
    psycopg = None
    Json = None

State = dict[str, Any]
T = TypeVar("T")
_SCHEMA_READY = False
_MEMORY_STATE: State | None = None

_SINGLETON_ID = 1
_PG_ADVISORY_LOCK_KEY = 461923007
_MEMORY_DOCUMENTS_KEY = "building_documents"

_ROOT_KEYS = {"nodes", "faults", "catalog", "meta", "agent"}
_META_KEYS = {
    "lastIngestAt",
    "lastClassificationAt",
    "lastFaultResolutionAt",
    "seedSource",
    "seededAt",
}
_CATALOG_KEYS = {"deviceTemplates", "zones", "ahuUnits", "faultMetaByDeviceId"}
_AGENT_KEYS = {"pendingActions", "auditLog"}
_NODE_KEYS = {
    "id",
    "label",
    "type",
    "status",
    "position",
    "parentIds",
    "updatedAt",
    "latestFaultId",
    "latestTelemetry",
    "historyByVariable",
    "latestTelemetryAt",
}
_FAULT_KEYS = {
    "id",
    "nodeId",
    "state",
    "kind",
    "probability",
    "summary",
    "recommendedAction",
    "openedAt",
    "updatedAt",
    "resolvedBy",
    "note",
}
_ZONE_KEYS = {"id", "name", "label", "x", "y", "width", "height", "healthScore"}
_AHU_KEYS = {"id", "label", "x", "y", "description"}
_TEMPLATE_SCALAR_KEYS = {
    "id",
    "name",
    "model",
    "serial",
    "type",
    "zone",
    "zoneId",
    "x",
    "y",
    "installedDate",
    "baseAnomalyScore",
    "airflowDirection",
}
_FAULT_META_KEYS = {"estimatedImpact", "energyWaste"}
_POINT_KEYS = {"time", "value"}


def _empty_state() -> State:
    return {
        "nodes": {},
        "faults": {},
        "catalog": {
            "deviceTemplates": [],
            "zones": [],
            "ahuUnits": [],
            "faultMetaByDeviceId": {},
        },
        "meta": {
            "lastIngestAt": None,
            "lastClassificationAt": None,
            "lastFaultResolutionAt": None,
            "seedSource": None,
            "seededAt": None,
        },
        "agent": {
            "pendingActions": {},
            "auditLog": [],
        },
    }


def _normalize_state(state: Any) -> State:
    if not isinstance(state, dict):
        return _empty_state()

    state.setdefault("nodes", {})
    state.setdefault("faults", {})
    state.setdefault("catalog", {})
    state.setdefault("meta", {})
    state.setdefault("agent", {})

    if not isinstance(state["nodes"], dict):
        state["nodes"] = {}
    if not isinstance(state["faults"], dict):
        state["faults"] = {}
    if not isinstance(state["catalog"], dict):
        state["catalog"] = {}
    if not isinstance(state["meta"], dict):
        state["meta"] = {}
    if not isinstance(state["agent"], dict):
        state["agent"] = {}

    state["catalog"].setdefault("deviceTemplates", [])
    state["catalog"].setdefault("zones", [])
    state["catalog"].setdefault("ahuUnits", [])
    state["catalog"].setdefault("faultMetaByDeviceId", {})
    if not isinstance(state["catalog"]["deviceTemplates"], list):
        state["catalog"]["deviceTemplates"] = []
    if not isinstance(state["catalog"]["zones"], list):
        state["catalog"]["zones"] = []
    if not isinstance(state["catalog"]["ahuUnits"], list):
        state["catalog"]["ahuUnits"] = []
    if not isinstance(state["catalog"]["faultMetaByDeviceId"], dict):
        state["catalog"]["faultMetaByDeviceId"] = {}

    state["meta"].setdefault("lastIngestAt", None)
    state["meta"].setdefault("lastClassificationAt", None)
    state["meta"].setdefault("lastFaultResolutionAt", None)
    state["meta"].setdefault("seedSource", None)
    state["meta"].setdefault("seededAt", None)

    state["agent"].setdefault("pendingActions", {})
    state["agent"].setdefault("auditLog", [])
    if not isinstance(state["agent"]["pendingActions"], dict):
        state["agent"]["pendingActions"] = {}
    if not isinstance(state["agent"]["auditLog"], list):
        state["agent"]["auditLog"] = []

    for node in state["nodes"].values():
        if not isinstance(node, dict):
            continue
        node.setdefault("position", 0.0)
        node.setdefault("parentIds", [])
        node.setdefault("latestTelemetry", {})
        node.setdefault("historyByVariable", {})
        node.setdefault("latestTelemetryAt", None)
        node.setdefault("updatedAt", None)
        node.setdefault("latestFaultId", None)
        if not isinstance(node["parentIds"], list):
            node["parentIds"] = []
        if not isinstance(node["latestTelemetry"], dict):
            node["latestTelemetry"] = {}
        if not isinstance(node["historyByVariable"], dict):
            node["historyByVariable"] = {}

    return state


def _optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def _required_text(value: Any, fallback: str) -> str:
    text = _optional_text(value)
    return text if text is not None else fallback


def _coerce_float(value: Any, fallback: float = 0.0) -> float:
    if isinstance(value, bool) or value is None:
        return fallback
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return fallback
    return fallback


def _coerce_int(value: Any, fallback: int = 0) -> int:
    if isinstance(value, bool) or value is None:
        return fallback
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(float(value))
        except ValueError:
            return fallback
    return fallback


def _extract_extras(payload: dict[str, Any], known_keys: set[str]) -> dict[str, Any]:
    return {
        key: deepcopy(value) for key, value in payload.items() if key not in known_keys
    }


def _merge_payload(base: dict[str, Any], extras: Any) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    if isinstance(extras, dict):
        merged.update(extras)
    merged.update(base)
    return merged


def _json_param(value: Any) -> Any:
    return Json(value) if Json is not None else value


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _timestamp_text(value: Any) -> str:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat().replace("+00:00", "Z")
    return _required_text(value, _utc_now_iso())


def _memory_documents() -> dict[str, dict[str, str]]:
    global _MEMORY_STATE
    _MEMORY_STATE = _normalize_state(_MEMORY_STATE)
    documents = _MEMORY_STATE.setdefault(_MEMORY_DOCUMENTS_KEY, {})
    if not isinstance(documents, dict):
        documents = {}
        _MEMORY_STATE[_MEMORY_DOCUMENTS_KEY] = documents
    return documents


def _is_point_series(value: Any) -> bool:
    if not isinstance(value, list) or not value:
        return False
    first = value[0]
    return isinstance(first, dict) and ("time" in first or "value" in first)


def _execute_many(cur: Any, query: str, rows: Iterable[tuple[Any, ...]]) -> None:
    rows_list = list(rows)
    if rows_list:
        cur.executemany(query, rows_list)


def _acquire_state_advisory_lock(cur: Any) -> None:
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (_PG_ADVISORY_LOCK_KEY,))


def _postgres_dsn() -> str:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required for backend state storage")
    return database_url


def _use_memory_storage() -> bool:
    return not os.getenv("DATABASE_URL")


def _connect_retry_attempts() -> int:
    return max(1, _coerce_int(os.getenv("STATE_DB_CONNECT_MAX_ATTEMPTS"), 20))


def _connect_retry_delay_seconds() -> float:
    return max(0.1, _coerce_float(os.getenv("STATE_DB_CONNECT_RETRY_SECONDS"), 0.5))


def _connect_retry_max_delay_seconds() -> float:
    default_max = max(1.0, _connect_retry_delay_seconds())
    return max(
        _connect_retry_delay_seconds(),
        _coerce_float(os.getenv("STATE_DB_CONNECT_MAX_RETRY_SECONDS"), default_max),
    )


def _connect_postgres() -> Any:
    if psycopg is None:
        raise RuntimeError("psycopg is required when DATABASE_URL is set")

    dsn = _postgres_dsn()
    max_attempts = _connect_retry_attempts()
    retry_delay = _connect_retry_delay_seconds()
    max_retry_delay = _connect_retry_max_delay_seconds()

    for attempt in range(1, max_attempts + 1):
        try:
            return psycopg.connect(dsn, autocommit=False)
        except psycopg.OperationalError:
            if attempt >= max_attempts:
                raise
            backoff_seconds = min(max_retry_delay, retry_delay * attempt)
            time.sleep(backoff_seconds)


def _create_relational_schema(cur: Any) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backend_state (
            id SMALLINT PRIMARY KEY,
            state JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CHECK (id = 1)
        )
        """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backend_storage_meta (
            id SMALLINT PRIMARY KEY,
            bootstrapped BOOLEAN NOT NULL DEFAULT FALSE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CHECK (id = 1)
        )
        """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backend_state_top_level (
            id SMALLINT PRIMARY KEY,
            payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            CHECK (id = 1)
        )
        """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backend_state_meta (
            id SMALLINT PRIMARY KEY,
            last_ingest_at TEXT NULL,
            last_classification_at TEXT NULL,
            last_fault_resolution_at TEXT NULL,
            seed_source TEXT NULL,
            seeded_at TEXT NULL,
            extras JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CHECK (id = 1)
        )
        """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backend_catalog_meta (
            id SMALLINT PRIMARY KEY,
            extras JSONB NOT NULL DEFAULT '{}'::jsonb,
            CHECK (id = 1)
        )
        """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backend_agent_meta (
            id SMALLINT PRIMARY KEY,
            extras JSONB NOT NULL DEFAULT '{}'::jsonb,
            CHECK (id = 1)
        )
        """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backend_nodes (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            type TEXT NOT NULL,
            status TEXT NOT NULL,
            position DOUBLE PRECISION NOT NULL DEFAULT 0,
            updated_at TEXT NULL,
            latest_fault_id TEXT NULL,
            latest_telemetry_at TEXT NULL,
            extras JSONB NOT NULL DEFAULT '{}'::jsonb
        )
        """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backend_node_parents (
            node_id TEXT NOT NULL REFERENCES backend_nodes(id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL,
            parent_id TEXT NOT NULL,
            PRIMARY KEY (node_id, ordinal)
        )
        """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backend_node_latest_telemetry (
            node_id TEXT NOT NULL REFERENCES backend_nodes(id) ON DELETE CASCADE,
            metric TEXT NOT NULL,
            value JSONB NOT NULL,
            PRIMARY KEY (node_id, metric)
        )
        """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backend_node_history (
            node_id TEXT NOT NULL REFERENCES backend_nodes(id) ON DELETE CASCADE,
            metric TEXT NOT NULL,
            ordinal INTEGER NOT NULL,
            point_time TEXT NOT NULL,
            value JSONB NOT NULL,
            extras JSONB NOT NULL DEFAULT '{}'::jsonb,
            PRIMARY KEY (node_id, metric, ordinal)
        )
        """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_backend_node_history_lookup
        ON backend_node_history (node_id, metric, point_time)
        """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backend_faults (
            id TEXT PRIMARY KEY,
            node_id TEXT NOT NULL,
            state TEXT NOT NULL,
            kind TEXT NOT NULL,
            probability DOUBLE PRECISION NOT NULL,
            summary TEXT NOT NULL,
            recommended_action TEXT NOT NULL,
            opened_at TEXT NULL,
            updated_at TEXT NULL,
            resolved_by TEXT NULL,
            note TEXT NULL,
            extras JSONB NOT NULL DEFAULT '{}'::jsonb
        )
        """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_backend_faults_node_time
        ON backend_faults (node_id, updated_at)
        """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backend_catalog_zones (
            id TEXT PRIMARY KEY,
            ordinal INTEGER NOT NULL UNIQUE,
            name TEXT NOT NULL,
            label TEXT NOT NULL,
            x INTEGER NOT NULL,
            y INTEGER NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            health_score INTEGER NOT NULL,
            extras JSONB NOT NULL DEFAULT '{}'::jsonb
        )
        """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backend_catalog_ahu_units (
            id TEXT PRIMARY KEY,
            ordinal INTEGER NOT NULL UNIQUE,
            label TEXT NOT NULL,
            x INTEGER NOT NULL,
            y INTEGER NOT NULL,
            description TEXT NOT NULL,
            extras JSONB NOT NULL DEFAULT '{}'::jsonb
        )
        """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backend_catalog_device_templates (
            id TEXT PRIMARY KEY,
            ordinal INTEGER NOT NULL UNIQUE,
            name TEXT NOT NULL,
            model TEXT NOT NULL,
            serial TEXT NOT NULL,
            type TEXT NOT NULL,
            zone TEXT NOT NULL,
            zone_id TEXT NOT NULL,
            x INTEGER NOT NULL,
            y INTEGER NOT NULL,
            installed_date TEXT NOT NULL,
            base_anomaly_score DOUBLE PRECISION NOT NULL,
            airflow_direction TEXT NULL,
            extras JSONB NOT NULL DEFAULT '{}'::jsonb
        )
        """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backend_catalog_template_history (
            template_id TEXT NOT NULL
                REFERENCES backend_catalog_device_templates(id) ON DELETE CASCADE,
            metric TEXT NOT NULL,
            ordinal INTEGER NOT NULL,
            point_time TEXT NOT NULL,
            value JSONB NOT NULL,
            extras JSONB NOT NULL DEFAULT '{}'::jsonb,
            PRIMARY KEY (template_id, metric, ordinal)
        )
        """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backend_catalog_fault_meta (
            device_id TEXT PRIMARY KEY,
            estimated_impact TEXT NOT NULL,
            energy_waste TEXT NOT NULL,
            extras JSONB NOT NULL DEFAULT '{}'::jsonb
        )
        """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backend_agent_pending_actions (
            action_id TEXT PRIMARY KEY,
            payload JSONB NOT NULL
        )
        """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backend_agent_audit_log (
            ordinal BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            payload JSONB NOT NULL
        )
        """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS building_documents (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            content_text TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'ready',
            error_message TEXT NULL,
            uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """)
    cur.execute("""
        ALTER TABLE building_documents
        ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready'
        """)
    cur.execute("""
        ALTER TABLE building_documents
        ADD COLUMN IF NOT EXISTS error_message TEXT NULL
        """)


def _ensure_singleton_rows(cur: Any) -> None:
    cur.execute(
        """
        INSERT INTO backend_state (id, state)
        VALUES (%s, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        (_SINGLETON_ID, _json_param(_empty_state())),
    )
    cur.execute(
        """
        INSERT INTO backend_storage_meta (id, bootstrapped)
        VALUES (%s, FALSE)
        ON CONFLICT (id) DO NOTHING
        """,
        (_SINGLETON_ID,),
    )
    cur.execute(
        """
        INSERT INTO backend_state_top_level (id, payload)
        VALUES (%s, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        (_SINGLETON_ID, _json_param({})),
    )
    cur.execute(
        """
        INSERT INTO backend_state_meta (
            id,
            last_ingest_at,
            last_classification_at,
            last_fault_resolution_at,
            seed_source,
            seeded_at,
            extras
        )
        VALUES (%s, NULL, NULL, NULL, NULL, NULL, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        (_SINGLETON_ID, _json_param({})),
    )
    cur.execute(
        """
        INSERT INTO backend_catalog_meta (id, extras)
        VALUES (%s, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        (_SINGLETON_ID, _json_param({})),
    )
    cur.execute(
        """
        INSERT INTO backend_agent_meta (id, extras)
        VALUES (%s, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        (_SINGLETON_ID, _json_param({})),
    )


def _read_legacy_state_row(cur: Any) -> State:
    cur.execute("SELECT state FROM backend_state WHERE id = %s", (_SINGLETON_ID,))
    row = cur.fetchone()
    if row is None:
        return _empty_state()
    return _normalize_state(row[0])


def _sync_legacy_row(cur: Any, state: State) -> None:
    cur.execute(
        """
        INSERT INTO backend_state (id, state)
        VALUES (%s, %s)
        ON CONFLICT (id) DO UPDATE
        SET state = EXCLUDED.state, updated_at = NOW()
        """,
        (_SINGLETON_ID, _json_param(state)),
    )


def _read_relational_state(cur: Any) -> State:
    state = _empty_state()

    cur.execute(
        "SELECT payload FROM backend_state_top_level WHERE id = %s", (_SINGLETON_ID,)
    )
    top_level_row = cur.fetchone()
    if top_level_row and isinstance(top_level_row[0], dict):
        for key, value in top_level_row[0].items():
            if key in _ROOT_KEYS:
                continue
            state[key] = deepcopy(value)

    cur.execute(
        """
        SELECT
            last_ingest_at,
            last_classification_at,
            last_fault_resolution_at,
            seed_source,
            seeded_at,
            extras
        FROM backend_state_meta
        WHERE id = %s
        """,
        (_SINGLETON_ID,),
    )
    meta_row = cur.fetchone()
    if meta_row:
        state["meta"] = _merge_payload(
            {
                "lastIngestAt": meta_row[0],
                "lastClassificationAt": meta_row[1],
                "lastFaultResolutionAt": meta_row[2],
                "seedSource": meta_row[3],
                "seededAt": meta_row[4],
            },
            meta_row[5],
        )

    cur.execute(
        "SELECT extras FROM backend_catalog_meta WHERE id = %s", (_SINGLETON_ID,)
    )
    catalog_meta_row = cur.fetchone()
    catalog = _merge_payload(
        {
            "deviceTemplates": [],
            "zones": [],
            "ahuUnits": [],
            "faultMetaByDeviceId": {},
        },
        catalog_meta_row[0] if catalog_meta_row else {},
    )
    state["catalog"] = catalog

    cur.execute("""
        SELECT id, name, label, x, y, width, height, health_score, extras
        FROM backend_catalog_zones
        ORDER BY ordinal ASC, id ASC
        """)
    for row in cur.fetchall():
        catalog["zones"].append(
            _merge_payload(
                {
                    "id": row[0],
                    "name": row[1],
                    "label": row[2],
                    "x": row[3],
                    "y": row[4],
                    "width": row[5],
                    "height": row[6],
                    "healthScore": row[7],
                },
                row[8],
            )
        )

    cur.execute("""
        SELECT id, label, x, y, description, extras
        FROM backend_catalog_ahu_units
        ORDER BY ordinal ASC, id ASC
        """)
    for row in cur.fetchall():
        catalog["ahuUnits"].append(
            _merge_payload(
                {
                    "id": row[0],
                    "label": row[1],
                    "x": row[2],
                    "y": row[3],
                    "description": row[4],
                },
                row[5],
            )
        )

    cur.execute("""
        SELECT
            id,
            name,
            model,
            serial,
            type,
            zone,
            zone_id,
            x,
            y,
            installed_date,
            base_anomaly_score,
            airflow_direction,
            extras
        FROM backend_catalog_device_templates
        ORDER BY ordinal ASC, id ASC
        """)
    templates_by_id: dict[str, dict[str, Any]] = {}
    for row in cur.fetchall():
        template = _merge_payload(
            {
                "id": row[0],
                "name": row[1],
                "model": row[2],
                "serial": row[3],
                "type": row[4],
                "zone": row[5],
                "zoneId": row[6],
                "x": row[7],
                "y": row[8],
                "installedDate": row[9],
                "baseAnomalyScore": row[10],
                "airflowDirection": row[11],
            },
            row[12],
        )
        templates_by_id[template["id"]] = template
        catalog["deviceTemplates"].append(template)

    cur.execute("""
        SELECT template_id, metric, point_time, value, extras
        FROM backend_catalog_template_history
        ORDER BY template_id ASC, metric ASC, ordinal ASC
        """)
    for row in cur.fetchall():
        template = templates_by_id.get(row[0])
        if not isinstance(template, dict):
            continue
        metric = _required_text(row[1], "unknown")
        series = template.setdefault(metric, [])
        if not isinstance(series, list):
            series = []
            template[metric] = series
        series.append(
            _merge_payload(
                {
                    "time": _required_text(row[2], ""),
                    "value": deepcopy(row[3]),
                },
                row[4],
            )
        )

    cur.execute("""
        SELECT device_id, estimated_impact, energy_waste, extras
        FROM backend_catalog_fault_meta
        ORDER BY device_id ASC
        """)
    fault_meta_by_device_id: dict[str, dict[str, Any]] = {}
    for row in cur.fetchall():
        device_id = _required_text(row[0], "")
        if not device_id:
            continue
        fault_meta_by_device_id[device_id] = _merge_payload(
            {
                "estimatedImpact": row[1],
                "energyWaste": row[2],
            },
            row[3],
        )
    catalog["faultMetaByDeviceId"] = fault_meta_by_device_id

    cur.execute("""
        SELECT
            id,
            label,
            type,
            status,
            position,
            updated_at,
            latest_fault_id,
            latest_telemetry_at,
            extras
        FROM backend_nodes
        ORDER BY id ASC
        """)
    nodes: dict[str, dict[str, Any]] = {}
    for row in cur.fetchall():
        node_id = _required_text(row[0], "")
        if not node_id:
            continue
        nodes[node_id] = _merge_payload(
            {
                "id": node_id,
                "label": row[1],
                "type": row[2],
                "status": row[3],
                "position": _coerce_float(row[4], 0.0),
                "parentIds": [],
                "updatedAt": row[5],
                "latestFaultId": row[6],
                "latestTelemetry": {},
                "historyByVariable": {},
                "latestTelemetryAt": row[7],
            },
            row[8],
        )
    state["nodes"] = nodes

    cur.execute("""
        SELECT node_id, parent_id
        FROM backend_node_parents
        ORDER BY node_id ASC, ordinal ASC
        """)
    for row in cur.fetchall():
        node = nodes.get(_required_text(row[0], ""))
        if not isinstance(node, dict):
            continue
        parent_ids = node.setdefault("parentIds", [])
        if isinstance(parent_ids, list):
            parent_ids.append(_required_text(row[1], ""))

    cur.execute("""
        SELECT node_id, metric, value
        FROM backend_node_latest_telemetry
        ORDER BY node_id ASC, metric ASC
        """)
    for row in cur.fetchall():
        node = nodes.get(_required_text(row[0], ""))
        if not isinstance(node, dict):
            continue
        latest_telemetry = node.setdefault("latestTelemetry", {})
        if isinstance(latest_telemetry, dict):
            latest_telemetry[_required_text(row[1], "unknown")] = deepcopy(row[2])

    cur.execute("""
        SELECT node_id, metric, point_time, value, extras
        FROM backend_node_history
        ORDER BY node_id ASC, metric ASC, ordinal ASC
        """)
    for row in cur.fetchall():
        node = nodes.get(_required_text(row[0], ""))
        if not isinstance(node, dict):
            continue
        history_by_variable = node.setdefault("historyByVariable", {})
        if not isinstance(history_by_variable, dict):
            history_by_variable = {}
            node["historyByVariable"] = history_by_variable

        metric = _required_text(row[1], "unknown")
        series = history_by_variable.setdefault(metric, [])
        if not isinstance(series, list):
            series = []
            history_by_variable[metric] = series

        series.append(
            _merge_payload(
                {
                    "time": _required_text(row[2], ""),
                    "value": deepcopy(row[3]),
                },
                row[4],
            )
        )

    cur.execute("""
        SELECT
            id,
            node_id,
            state,
            kind,
            probability,
            summary,
            recommended_action,
            opened_at,
            updated_at,
            resolved_by,
            note,
            extras
        FROM backend_faults
        ORDER BY id ASC
        """)
    faults: dict[str, dict[str, Any]] = {}
    for row in cur.fetchall():
        fault_id = _required_text(row[0], "")
        if not fault_id:
            continue
        faults[fault_id] = _merge_payload(
            {
                "id": fault_id,
                "nodeId": row[1],
                "state": row[2],
                "kind": row[3],
                "probability": _coerce_float(row[4], 0.0),
                "summary": row[5],
                "recommendedAction": row[6],
                "openedAt": row[7],
                "updatedAt": row[8],
                "resolvedBy": row[9],
                "note": row[10],
            },
            row[11],
        )
    state["faults"] = faults

    cur.execute("SELECT extras FROM backend_agent_meta WHERE id = %s", (_SINGLETON_ID,))
    agent_meta_row = cur.fetchone()
    state["agent"] = _merge_payload(
        {
            "pendingActions": {},
            "auditLog": [],
        },
        agent_meta_row[0] if agent_meta_row else {},
    )

    cur.execute("""
        SELECT action_id, payload
        FROM backend_agent_pending_actions
        ORDER BY action_id ASC
        """)
    pending_actions: dict[str, Any] = {}
    for row in cur.fetchall():
        action_id = _required_text(row[0], "")
        if not action_id:
            continue
        payload = row[1]
        if isinstance(payload, dict):
            pending_actions[action_id] = payload
        else:
            pending_actions[action_id] = {"id": action_id}
    state["agent"]["pendingActions"] = pending_actions

    cur.execute("""
        SELECT payload
        FROM backend_agent_audit_log
        ORDER BY ordinal ASC
        """)
    audit_log: list[Any] = []
    for row in cur.fetchall():
        payload = row[0]
        audit_log.append(payload if isinstance(payload, dict) else {"value": payload})
    state["agent"]["auditLog"] = audit_log

    return _normalize_state(state)


def _write_relational_state(cur: Any, state: State) -> None:
    normalized_state = _normalize_state(deepcopy(state))

    top_level_extras = _extract_extras(normalized_state, _ROOT_KEYS)
    meta = (
        normalized_state.get("meta")
        if isinstance(normalized_state.get("meta"), dict)
        else {}
    )
    meta_extras = _extract_extras(meta, _META_KEYS)
    catalog = (
        normalized_state.get("catalog")
        if isinstance(normalized_state.get("catalog"), dict)
        else {}
    )
    catalog_extras = _extract_extras(catalog, _CATALOG_KEYS)
    agent = (
        normalized_state.get("agent")
        if isinstance(normalized_state.get("agent"), dict)
        else {}
    )
    agent_extras = _extract_extras(agent, _AGENT_KEYS)

    cur.execute(
        """
        INSERT INTO backend_state_top_level (id, payload)
        VALUES (%s, %s)
        ON CONFLICT (id) DO UPDATE
        SET payload = EXCLUDED.payload
        """,
        (_SINGLETON_ID, _json_param(top_level_extras)),
    )
    cur.execute(
        """
        INSERT INTO backend_state_meta (
            id,
            last_ingest_at,
            last_classification_at,
            last_fault_resolution_at,
            seed_source,
            seeded_at,
            extras,
            updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (id) DO UPDATE
        SET
            last_ingest_at = EXCLUDED.last_ingest_at,
            last_classification_at = EXCLUDED.last_classification_at,
            last_fault_resolution_at = EXCLUDED.last_fault_resolution_at,
            seed_source = EXCLUDED.seed_source,
            seeded_at = EXCLUDED.seeded_at,
            extras = EXCLUDED.extras,
            updated_at = NOW()
        """,
        (
            _SINGLETON_ID,
            _optional_text(meta.get("lastIngestAt")),
            _optional_text(meta.get("lastClassificationAt")),
            _optional_text(meta.get("lastFaultResolutionAt")),
            _optional_text(meta.get("seedSource")),
            _optional_text(meta.get("seededAt")),
            _json_param(meta_extras),
        ),
    )
    cur.execute(
        """
        INSERT INTO backend_catalog_meta (id, extras)
        VALUES (%s, %s)
        ON CONFLICT (id) DO UPDATE
        SET extras = EXCLUDED.extras
        """,
        (_SINGLETON_ID, _json_param(catalog_extras)),
    )
    cur.execute(
        """
        INSERT INTO backend_agent_meta (id, extras)
        VALUES (%s, %s)
        ON CONFLICT (id) DO UPDATE
        SET extras = EXCLUDED.extras
        """,
        (_SINGLETON_ID, _json_param(agent_extras)),
    )

    nodes = (
        normalized_state.get("nodes")
        if isinstance(normalized_state.get("nodes"), dict)
        else {}
    )
    node_rows: list[tuple[Any, ...]] = []
    parent_rows: list[tuple[Any, ...]] = []
    latest_telemetry_rows: list[tuple[Any, ...]] = []
    history_rows: list[tuple[Any, ...]] = []

    for node_key, raw_node in nodes.items():
        if not isinstance(raw_node, dict):
            continue
        node_id = _required_text(node_key, "")
        if not node_id:
            continue

        node_extras = _extract_extras(raw_node, _NODE_KEYS)
        node_rows.append(
            (
                node_id,
                _required_text(raw_node.get("label"), node_id),
                _required_text(raw_node.get("type"), "device"),
                _required_text(raw_node.get("status"), "healthy"),
                _coerce_float(raw_node.get("position"), 0.0),
                _optional_text(raw_node.get("updatedAt")),
                _optional_text(raw_node.get("latestFaultId")),
                _optional_text(raw_node.get("latestTelemetryAt")),
                _json_param(node_extras),
            )
        )

        parent_ids = (
            raw_node.get("parentIds")
            if isinstance(raw_node.get("parentIds"), list)
            else []
        )
        for index, parent_id in enumerate(parent_ids):
            parent_text = _required_text(parent_id, "")
            if not parent_text:
                continue
            parent_rows.append((node_id, index, parent_text))

        latest_telemetry = (
            raw_node.get("latestTelemetry")
            if isinstance(raw_node.get("latestTelemetry"), dict)
            else {}
        )
        for metric, value in latest_telemetry.items():
            metric_name = _required_text(metric, "")
            if not metric_name:
                continue
            latest_telemetry_rows.append(
                (node_id, metric_name, _json_param(deepcopy(value)))
            )

        history_by_variable = (
            raw_node.get("historyByVariable")
            if isinstance(raw_node.get("historyByVariable"), dict)
            else {}
        )
        for metric, raw_series in history_by_variable.items():
            metric_name = _required_text(metric, "")
            if not metric_name or not isinstance(raw_series, list):
                continue
            for index, raw_point in enumerate(raw_series):
                if isinstance(raw_point, dict):
                    point_time = _required_text(raw_point.get("time"), "")
                    point_value = deepcopy(raw_point.get("value"))
                    point_extras = _extract_extras(raw_point, _POINT_KEYS)
                else:
                    point_time = ""
                    point_value = deepcopy(raw_point)
                    point_extras = {}
                history_rows.append(
                    (
                        node_id,
                        metric_name,
                        index,
                        point_time,
                        _json_param(point_value),
                        _json_param(point_extras),
                    )
                )

    cur.execute("DELETE FROM backend_nodes")
    _execute_many(
        cur,
        """
        INSERT INTO backend_nodes (
            id,
            label,
            type,
            status,
            position,
            updated_at,
            latest_fault_id,
            latest_telemetry_at,
            extras
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        node_rows,
    )
    _execute_many(
        cur,
        """
        INSERT INTO backend_node_parents (node_id, ordinal, parent_id)
        VALUES (%s, %s, %s)
        """,
        parent_rows,
    )
    _execute_many(
        cur,
        """
        INSERT INTO backend_node_latest_telemetry (node_id, metric, value)
        VALUES (%s, %s, %s)
        """,
        latest_telemetry_rows,
    )
    _execute_many(
        cur,
        """
        INSERT INTO backend_node_history (
            node_id,
            metric,
            ordinal,
            point_time,
            value,
            extras
        )
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        history_rows,
    )

    faults = (
        normalized_state.get("faults")
        if isinstance(normalized_state.get("faults"), dict)
        else {}
    )
    fault_rows: list[tuple[Any, ...]] = []
    for fault_key, raw_fault in faults.items():
        if not isinstance(raw_fault, dict):
            continue
        fault_id = _required_text(fault_key, "")
        if not fault_id:
            continue
        fault_extras = _extract_extras(raw_fault, _FAULT_KEYS)
        fault_rows.append(
            (
                fault_id,
                _required_text(raw_fault.get("nodeId"), ""),
                _required_text(raw_fault.get("state"), "resolved"),
                _required_text(raw_fault.get("kind"), "unknown"),
                _coerce_float(raw_fault.get("probability"), 0.0),
                _required_text(raw_fault.get("summary"), ""),
                _required_text(raw_fault.get("recommendedAction"), ""),
                _optional_text(raw_fault.get("openedAt")),
                _optional_text(raw_fault.get("updatedAt")),
                _optional_text(raw_fault.get("resolvedBy")),
                _optional_text(raw_fault.get("note")),
                _json_param(fault_extras),
            )
        )

    cur.execute("DELETE FROM backend_faults")
    _execute_many(
        cur,
        """
        INSERT INTO backend_faults (
            id,
            node_id,
            state,
            kind,
            probability,
            summary,
            recommended_action,
            opened_at,
            updated_at,
            resolved_by,
            note,
            extras
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        fault_rows,
    )

    zones = catalog.get("zones") if isinstance(catalog.get("zones"), list) else []
    zone_rows: list[tuple[Any, ...]] = []
    for index, raw_zone in enumerate(zones):
        if not isinstance(raw_zone, dict):
            continue
        zone_id = _required_text(raw_zone.get("id"), f"zone-{index}")
        zone_extras = _extract_extras(raw_zone, _ZONE_KEYS)
        zone_rows.append(
            (
                zone_id,
                index,
                _required_text(raw_zone.get("name"), zone_id),
                _required_text(raw_zone.get("label"), ""),
                _coerce_int(raw_zone.get("x"), 0),
                _coerce_int(raw_zone.get("y"), 0),
                _coerce_int(raw_zone.get("width"), 0),
                _coerce_int(raw_zone.get("height"), 0),
                _coerce_int(raw_zone.get("healthScore"), 0),
                _json_param(zone_extras),
            )
        )

    ahu_units = (
        catalog.get("ahuUnits") if isinstance(catalog.get("ahuUnits"), list) else []
    )
    ahu_rows: list[tuple[Any, ...]] = []
    for index, raw_ahu in enumerate(ahu_units):
        if not isinstance(raw_ahu, dict):
            continue
        ahu_id = _required_text(raw_ahu.get("id"), f"ahu-{index}")
        ahu_extras = _extract_extras(raw_ahu, _AHU_KEYS)
        ahu_rows.append(
            (
                ahu_id,
                index,
                _required_text(raw_ahu.get("label"), ahu_id),
                _coerce_int(raw_ahu.get("x"), 0),
                _coerce_int(raw_ahu.get("y"), 0),
                _required_text(raw_ahu.get("description"), ""),
                _json_param(ahu_extras),
            )
        )

    device_templates = (
        catalog.get("deviceTemplates")
        if isinstance(catalog.get("deviceTemplates"), list)
        else []
    )
    template_rows: list[tuple[Any, ...]] = []
    template_history_rows: list[tuple[Any, ...]] = []
    for template_index, raw_template in enumerate(device_templates):
        if not isinstance(raw_template, dict):
            continue

        template_id = _required_text(
            raw_template.get("id"), f"template-{template_index}"
        )
        template_extras: dict[str, Any] = {}
        telemetry_by_metric: dict[str, list[Any]] = {}

        for key, value in raw_template.items():
            if key in _TEMPLATE_SCALAR_KEYS:
                continue
            if _is_point_series(value):
                telemetry_by_metric[_required_text(key, "unknown")] = list(value)
                continue
            template_extras[key] = deepcopy(value)

        template_rows.append(
            (
                template_id,
                template_index,
                _required_text(raw_template.get("name"), template_id),
                _required_text(raw_template.get("model"), ""),
                _required_text(raw_template.get("serial"), ""),
                _required_text(raw_template.get("type"), "device"),
                _required_text(raw_template.get("zone"), ""),
                _required_text(raw_template.get("zoneId"), ""),
                _coerce_int(raw_template.get("x"), 0),
                _coerce_int(raw_template.get("y"), 0),
                _required_text(raw_template.get("installedDate"), ""),
                _coerce_float(raw_template.get("baseAnomalyScore"), 0.0),
                _optional_text(raw_template.get("airflowDirection")),
                _json_param(template_extras),
            )
        )

        for metric, raw_series in telemetry_by_metric.items():
            metric_name = _required_text(metric, "unknown")
            for point_index, raw_point in enumerate(raw_series):
                if isinstance(raw_point, dict):
                    point_time = _required_text(raw_point.get("time"), "")
                    point_value = deepcopy(raw_point.get("value"))
                    point_extras = _extract_extras(raw_point, _POINT_KEYS)
                else:
                    point_time = ""
                    point_value = deepcopy(raw_point)
                    point_extras = {}

                template_history_rows.append(
                    (
                        template_id,
                        metric_name,
                        point_index,
                        point_time,
                        _json_param(point_value),
                        _json_param(point_extras),
                    )
                )

    fault_meta_by_device_id = (
        catalog.get("faultMetaByDeviceId")
        if isinstance(catalog.get("faultMetaByDeviceId"), dict)
        else {}
    )
    fault_meta_rows: list[tuple[Any, ...]] = []
    for device_id, raw_fault_meta in fault_meta_by_device_id.items():
        if not isinstance(raw_fault_meta, dict):
            continue
        device_key = _required_text(device_id, "")
        if not device_key:
            continue
        fault_meta_rows.append(
            (
                device_key,
                _required_text(
                    raw_fault_meta.get("estimatedImpact"),
                    "$0/day impact estimate pending",
                ),
                _required_text(raw_fault_meta.get("energyWaste"), "0 kWh/day"),
                _json_param(_extract_extras(raw_fault_meta, _FAULT_META_KEYS)),
            )
        )

    cur.execute("DELETE FROM backend_catalog_device_templates")
    cur.execute("DELETE FROM backend_catalog_zones")
    cur.execute("DELETE FROM backend_catalog_ahu_units")
    cur.execute("DELETE FROM backend_catalog_fault_meta")
    _execute_many(
        cur,
        """
        INSERT INTO backend_catalog_zones (
            id,
            ordinal,
            name,
            label,
            x,
            y,
            width,
            height,
            health_score,
            extras
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        zone_rows,
    )
    _execute_many(
        cur,
        """
        INSERT INTO backend_catalog_ahu_units (
            id,
            ordinal,
            label,
            x,
            y,
            description,
            extras
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        ahu_rows,
    )
    _execute_many(
        cur,
        """
        INSERT INTO backend_catalog_device_templates (
            id,
            ordinal,
            name,
            model,
            serial,
            type,
            zone,
            zone_id,
            x,
            y,
            installed_date,
            base_anomaly_score,
            airflow_direction,
            extras
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        template_rows,
    )
    _execute_many(
        cur,
        """
        INSERT INTO backend_catalog_template_history (
            template_id,
            metric,
            ordinal,
            point_time,
            value,
            extras
        )
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        template_history_rows,
    )
    _execute_many(
        cur,
        """
        INSERT INTO backend_catalog_fault_meta (
            device_id,
            estimated_impact,
            energy_waste,
            extras
        )
        VALUES (%s, %s, %s, %s)
        """,
        fault_meta_rows,
    )

    pending_actions = (
        agent.get("pendingActions")
        if isinstance(agent.get("pendingActions"), dict)
        else {}
    )
    pending_action_rows: list[tuple[Any, ...]] = []
    for action_id, payload in pending_actions.items():
        action_key = _required_text(action_id, "")
        if not action_key:
            continue
        action_payload = (
            deepcopy(payload) if isinstance(payload, dict) else {"id": action_key}
        )
        action_payload.setdefault("id", action_key)
        pending_action_rows.append((action_key, _json_param(action_payload)))

    audit_log = agent.get("auditLog") if isinstance(agent.get("auditLog"), list) else []
    audit_rows: list[tuple[Any, ...]] = []
    for payload in audit_log:
        event_payload = (
            deepcopy(payload) if isinstance(payload, dict) else {"value": payload}
        )
        audit_rows.append((_json_param(event_payload),))

    cur.execute("DELETE FROM backend_agent_pending_actions")
    cur.execute("DELETE FROM backend_agent_audit_log")
    _execute_many(
        cur,
        """
        INSERT INTO backend_agent_pending_actions (action_id, payload)
        VALUES (%s, %s)
        """,
        pending_action_rows,
    )
    _execute_many(
        cur,
        """
        INSERT INTO backend_agent_audit_log (payload)
        VALUES (%s)
        """,
        audit_rows,
    )

    _sync_legacy_row(cur, normalized_state)


def _bootstrap_relational_state_if_needed(cur: Any) -> None:
    cur.execute(
        "SELECT bootstrapped FROM backend_storage_meta WHERE id = %s FOR UPDATE",
        (_SINGLETON_ID,),
    )
    row = cur.fetchone()
    bootstrapped = bool(row[0]) if row else False
    if bootstrapped:
        return

    legacy_state = _read_legacy_state_row(cur)
    _write_relational_state(cur, legacy_state)
    cur.execute(
        """
        UPDATE backend_storage_meta
        SET bootstrapped = TRUE, updated_at = NOW()
        WHERE id = %s
        """,
        (_SINGLETON_ID,),
    )


def insert_building_document(
    doc_id: str,
    filename: str,
    content_text: str,
    status: str = "ready",
    error_message: str | None = None,
) -> dict[str, str]:
    ensure_storage_ready()

    document = {
        "id": _required_text(doc_id, ""),
        "filename": _required_text(filename, "document.txt"),
        "content_text": str(content_text),
        "status": _required_text(status, "ready"),
        "error_message": _optional_text(error_message),
    }
    if not document["id"]:
        raise ValueError("doc_id is required")

    if _use_memory_storage():
        documents = _memory_documents()
        uploaded_at = _utc_now_iso()
        documents[document["id"]] = {
            "id": document["id"],
            "filename": document["filename"],
            "content_text": document["content_text"],
            "status": document["status"],
            "error_message": document["error_message"],
            "uploaded_at": uploaded_at,
        }
        return {
            "id": document["id"],
            "filename": document["filename"],
            "status": document["status"],
            "error_message": document["error_message"] or "",
            "uploaded_at": uploaded_at,
        }

    with _connect_postgres() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO building_documents (
                    id,
                    filename,
                    content_text,
                    status,
                    error_message
                )
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, filename, status, error_message, uploaded_at
                """,
                (
                    document["id"],
                    document["filename"],
                    document["content_text"],
                    document["status"],
                    document["error_message"],
                ),
            )
            row = cur.fetchone()
        conn.commit()

    if row is None:
        raise RuntimeError("failed to insert building document")

    return {
        "id": _required_text(row[0], document["id"]),
        "filename": _required_text(row[1], document["filename"]),
        "status": _required_text(row[2], document["status"]),
        "error_message": _required_text(row[3], ""),
        "uploaded_at": _timestamp_text(row[4]),
    }


def list_building_documents() -> list[dict[str, str]]:
    ensure_storage_ready()

    if _use_memory_storage():
        documents = _memory_documents()
        items = [
            {
                "id": _required_text(doc_id, ""),
                "filename": _required_text(payload.get("filename"), "document.txt"),
                "status": _required_text(payload.get("status"), "ready"),
                "error_message": _required_text(payload.get("error_message"), ""),
                "uploaded_at": _required_text(payload.get("uploaded_at"), _utc_now_iso()),
            }
            for doc_id, payload in documents.items()
            if isinstance(payload, dict)
        ]
        return sorted(items, key=lambda item: item["uploaded_at"], reverse=True)

    with _connect_postgres() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, filename, status, error_message, uploaded_at
                FROM building_documents
                ORDER BY uploaded_at DESC, id DESC
                """
            )
            rows = cur.fetchall()
        conn.commit()

    return [
        {
            "id": _required_text(row[0], ""),
            "filename": _required_text(row[1], "document.txt"),
            "status": _required_text(row[2], "ready"),
            "error_message": _required_text(row[3], ""),
            "uploaded_at": _timestamp_text(row[4]),
        }
        for row in rows
        if _required_text(row[0], "")
    ]


def delete_building_document(doc_id: str) -> bool:
    ensure_storage_ready()
    document_id = _required_text(doc_id, "")
    if not document_id:
        return False

    if _use_memory_storage():
        documents = _memory_documents()
        return documents.pop(document_id, None) is not None

    with _connect_postgres() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM building_documents WHERE id = %s",
                (document_id,),
            )
            deleted = cur.rowcount > 0
        conn.commit()

    return deleted


def set_building_document_content(doc_id: str, content_text: str) -> bool:
    ensure_storage_ready()
    document_id = _required_text(doc_id, "")
    if not document_id:
        return False

    if _use_memory_storage():
        documents = _memory_documents()
        payload = documents.get(document_id)
        if not isinstance(payload, dict):
            return False
        payload["content_text"] = str(content_text)
        payload["status"] = "ready"
        payload["error_message"] = None
        return True

    with _connect_postgres() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE building_documents
                SET content_text = %s, status = 'ready', error_message = NULL
                WHERE id = %s
                """,
                (str(content_text), document_id),
            )
            updated = cur.rowcount > 0
        conn.commit()

    return updated


def mark_building_document_failed(doc_id: str, error_message: str) -> bool:
    ensure_storage_ready()
    document_id = _required_text(doc_id, "")
    if not document_id:
        return False

    message = _required_text(error_message, "document processing failed")

    if _use_memory_storage():
        documents = _memory_documents()
        payload = documents.get(document_id)
        if not isinstance(payload, dict):
            return False
        payload["status"] = "error"
        payload["error_message"] = message
        return True

    with _connect_postgres() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE building_documents
                SET status = 'error', error_message = %s
                WHERE id = %s
                """,
                (message, document_id),
            )
            updated = cur.rowcount > 0
        conn.commit()

    return updated


def get_all_building_document_texts() -> list[dict[str, str]]:
    ensure_storage_ready()

    if _use_memory_storage():
        documents = _memory_documents()
        items = [
            {
                "filename": _required_text(payload.get("filename"), "document.txt"),
                "content_text": str(payload.get("content_text") or ""),
                "status": _required_text(payload.get("status"), "ready"),
                "uploaded_at": _required_text(payload.get("uploaded_at"), _utc_now_iso()),
            }
            for payload in documents.values()
            if isinstance(payload, dict)
        ]
        items.sort(key=lambda item: item["uploaded_at"], reverse=True)
        return [
            {
                "filename": item["filename"],
                "content_text": item["content_text"],
            }
            for item in items
            if item["status"] == "ready" and item["content_text"]
        ]

    with _connect_postgres() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT filename, content_text, status
                FROM building_documents
                WHERE status = 'ready'
                ORDER BY uploaded_at DESC, id DESC
                """
            )
            rows = cur.fetchall()
        conn.commit()

    return [
        {
            "filename": _required_text(row[0], "document.txt"),
            "content_text": str(row[1] or ""),
        }
        for row in rows
        if _required_text(row[2], "ready") == "ready" and str(row[1] or "")
    ]


def ensure_storage_ready() -> None:
    global _MEMORY_STATE, _SCHEMA_READY
    if _SCHEMA_READY:
        return

    if _use_memory_storage():
        _MEMORY_STATE = _normalize_state(_MEMORY_STATE)
        _SCHEMA_READY = True
        return

    if psycopg is None or Json is None:
        raise RuntimeError("psycopg is required when DATABASE_URL is set")

    with _connect_postgres() as conn:
        with conn.cursor() as cur:
            _acquire_state_advisory_lock(cur)
            _create_relational_schema(cur)
            _ensure_singleton_rows(cur)
            _bootstrap_relational_state_if_needed(cur)
        conn.commit()

    _SCHEMA_READY = True


def read_state() -> State:
    global _MEMORY_STATE
    ensure_storage_ready()

    if _use_memory_storage():
        _MEMORY_STATE = _normalize_state(_MEMORY_STATE)
        return deepcopy(_MEMORY_STATE)

    with _connect_postgres() as conn:
        with conn.cursor() as cur:
            state = _read_relational_state(cur)
        conn.commit()
    return _normalize_state(state)


def update_state(mutator: Callable[[State], T]) -> T:
    global _MEMORY_STATE
    ensure_storage_ready()

    if _use_memory_storage():
        _MEMORY_STATE = _normalize_state(_MEMORY_STATE)
        result = mutator(_MEMORY_STATE)
        _MEMORY_STATE = _normalize_state(_MEMORY_STATE)
        return result

    with _connect_postgres() as conn:
        with conn.cursor() as cur:
            _acquire_state_advisory_lock(cur)
            cur.execute(
                "SELECT id FROM backend_storage_meta WHERE id = %s FOR UPDATE",
                (_SINGLETON_ID,),
            )
            state = _read_relational_state(cur)
            result = mutator(state)
            _write_relational_state(cur, state)
            conn.commit()
    return result
