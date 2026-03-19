import os
import threading
from uuid import uuid4

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from schemas import (
    AgentChatRequest,
    AgentChatResponse,
    DocumentListItem,
    DocumentUploadResponse,
    ElevenLabsOutboundCallRequest,
    ElevenLabsOutboundCallResponse,
    ElevenLabsWebhookReceipt,
    BayesianView,
    IngestPayload,
    IngestResponse,
    MlFailureModeRequest,
    MlFailureModeResponse,
    NodeFaultHistoryResponse,
    SimulationRunRequest,
    SimulationRunResponse,
    ResolveFaultRequest,
    ResolveFaultResponse,
    StatusResponse,
)
from shacklib.backend_state import (
    delete_building_document,
    ensure_storage_ready,
    insert_building_document,
    list_building_documents,
    mark_building_document_failed,
    read_state,
    set_building_document_content,
    update_state,
)
from ml.bayesian import (
    build_component_failure_priors,
    run_datacenter_inference,
    serialize_bayesian_result,
)
from shacklib.codex_agent import run_codex_agent_chat
from shacklib.diagnosis_engine import (
    build_status_payload,
    build_node_fault_history_payload,
    ingest_node,
    resolve_fault,
    utc_now_iso,
)
from shacklib.ml_inference_client import (
    MLInferenceError,
    infer_failure_mode_for_node,
    resolve_ml_url,
)
from shacklib.simulation_service import run_simulation_bundle
from shacklib.state_seed import seed_state_on_startup
from shacklib.elevenlabs_agent import (
    ElevenLabsConfigurationError,
    ElevenLabsSignatureError,
    ElevenLabsWebhookPayloadError,
    place_outbound_call,
    record_post_call_webhook_event,
    validate_and_normalize_post_call_webhook,
)

load_dotenv()

ALLOWED_DOCUMENT_EXTENSIONS = {".pdf", ".txt", ".md"}
MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.on_event("startup")
async def startup() -> None:
    ensure_storage_ready()
    seeded = update_state(seed_state_on_startup)
    if seeded:
        print("[backend-fastapi] seeded reproducible startup telemetry state")


def extract_text(filename: str, data: bytes) -> str:
    if filename.lower().endswith(".pdf"):
        import pymupdf

        with pymupdf.open(stream=data, filetype="pdf") as document:
            return "\n".join(page.get_text("text") for page in document)

    return data.decode("utf-8", errors="replace")


def _validate_document_upload(filename: str | None, data: bytes) -> str:
    name = (filename or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="filename is required")

    extension = os.path.splitext(name)[1].lower()
    if extension not in ALLOWED_DOCUMENT_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_DOCUMENT_EXTENSIONS))
        raise HTTPException(
            status_code=400,
            detail=f"unsupported file type; allowed: {allowed}",
        )

    if len(data) > MAX_DOCUMENT_BYTES:
        raise HTTPException(status_code=413, detail="file exceeds 10 MB limit")

    return name


def _process_uploaded_document(doc_id: str, filename: str, data: bytes) -> None:
    try:
        content_text = extract_text(filename, data)
        set_building_document_content(doc_id, content_text)
    except Exception as exc:
        mark_building_document_failed(doc_id, f"failed to extract text: {exc}")


def _start_document_processing(doc_id: str, filename: str, data: bytes) -> None:
    worker = threading.Thread(
        target=_process_uploaded_document,
        args=(doc_id, filename, data),
        daemon=True,
        name=f"document-upload-{doc_id}",
    )
    worker.start()


@app.post("/api/ingest", response_model=IngestResponse)
async def ingest(payload: IngestPayload) -> IngestResponse:
    incoming = payload.model_dump(mode="python")

    def _mutator(state: dict):
        ingest_node(state, incoming)
        return IngestResponse(
            ok=True,
            nodeId=payload.nodeId,
            acceptedAt=utc_now_iso(),
        )

    return update_state(_mutator)


@app.post(
    "/api/documents/upload",
    response_model=DocumentUploadResponse,
    status_code=202,
)
async def upload_document(file: UploadFile = File(...)) -> DocumentUploadResponse:
    data = await file.read()
    filename = _validate_document_upload(file.filename, data)
    doc_id = f"doc-{uuid4().hex[:12]}"

    inserted = insert_building_document(
        doc_id=doc_id,
        filename=filename,
        content_text="",
        status="processing",
    )
    _start_document_processing(doc_id, filename, data)

    return DocumentUploadResponse(
        id=inserted["id"],
        filename=inserted["filename"],
        status=inserted["status"],
        errorMessage=inserted["error_message"] or None,
        uploadedAt=inserted["uploaded_at"],
    )


@app.get("/api/documents", response_model=list[DocumentListItem])
async def documents() -> list[DocumentListItem]:
    return [
        DocumentListItem(
            id=item["id"],
            filename=item["filename"],
            status=item["status"],
            errorMessage=item["error_message"] or None,
            uploadedAt=item["uploaded_at"],
        )
        for item in list_building_documents()
    ]


@app.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: str) -> dict[str, bool]:
    deleted = delete_building_document(doc_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="document not found")
    return {"ok": True}


@app.get("/api/status", response_model=StatusResponse)
async def status() -> StatusResponse:
    payload = update_state(build_status_payload)
    return StatusResponse.model_validate(payload)


@app.post("/api/faults/{fault_id}/resolve", response_model=ResolveFaultResponse)
async def resolve(fault_id: str, payload: ResolveFaultRequest) -> ResolveFaultResponse:
    def _mutator(state: dict):
        result = resolve_fault(
            state=state,
            fault_id=fault_id,
            resolved_by=payload.resolvedBy,
            note=payload.note,
        )
        if result is None:
            raise KeyError(fault_id)
        return ResolveFaultResponse.model_validate(result)

    try:
        return update_state(_mutator)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="fault not found") from exc


@app.get("/api/nodes/{node_id}/fault-history", response_model=NodeFaultHistoryResponse)
async def node_fault_history(
    node_id: str,
    limit: int = Query(default=25, ge=1, le=100),
) -> NodeFaultHistoryResponse:
    state = read_state()
    nodes = state.get("nodes") if isinstance(state.get("nodes"), dict) else {}

    if node_id not in nodes:
        raise HTTPException(status_code=404, detail="node not found")

    payload = build_node_fault_history_payload(state, node_id=node_id, limit=limit)
    return NodeFaultHistoryResponse.model_validate(payload)


@app.post("/api/ml/failure-mode", response_model=MlFailureModeResponse)
async def ml_failure_mode(payload: MlFailureModeRequest) -> MlFailureModeResponse:
    state = read_state()
    nodes = state.get("nodes") if isinstance(state.get("nodes"), dict) else {}
    node = nodes.get(payload.nodeId) if isinstance(nodes, dict) else None

    if not isinstance(node, dict):
        raise HTTPException(status_code=404, detail="node not found")

    timeout_seconds = payload.timeoutSeconds
    try:
        inference = infer_failure_mode_for_node(
            {"id": payload.nodeId, **node},
            timeout_seconds=timeout_seconds,
        )
    except MLInferenceError as exc:
        return MlFailureModeResponse(
            nodeId=payload.nodeId,
            generatedAt=utc_now_iso(),
            mlUrl=resolve_ml_url(),
            available=False,
            error=str(exc),
        )

    return MlFailureModeResponse(
        nodeId=payload.nodeId,
        generatedAt=utc_now_iso(),
        mlUrl=str(inference.get("mlUrl") or resolve_ml_url()),
        modelType=(
            str(inference.get("modelType"))
            if inference.get("modelType") is not None
            else None
        ),
        task=str(inference.get("task")) if inference.get("task") is not None else None,
        prediction=inference.get("prediction"),
        className=(
            str(inference.get("className"))
            if inference.get("className") is not None
            else None
        ),
        confidence=inference.get("confidence"),
        diagnosis=inference.get("diagnosis"),
    )


@app.post("/api/agent/chat", response_model=AgentChatResponse)
async def agent_chat(payload: AgentChatRequest) -> AgentChatResponse:
    response = run_codex_agent_chat(payload.model_dump(mode="python"))
    return AgentChatResponse.model_validate(response)


@app.post(
    "/api/voice/elevenlabs/post-call",
    response_model=ElevenLabsWebhookReceipt,
)
async def elevenlabs_post_call(request: Request) -> ElevenLabsWebhookReceipt:
    payload = await request.body()
    signature = request.headers.get("elevenlabs-signature")

    try:
        normalized = validate_and_normalize_post_call_webhook(
            payload=payload,
            signature=signature,
        )
        receipt = record_post_call_webhook_event(normalized)
    except ElevenLabsSignatureError as exc:
        raise HTTPException(
            status_code=401,
            detail="invalid ElevenLabs webhook signature",
        ) from exc
    except ElevenLabsConfigurationError as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        ) from exc
    except ElevenLabsWebhookPayloadError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    return ElevenLabsWebhookReceipt.model_validate(receipt)


@app.post(
    "/api/voice/elevenlabs/outbound-call",
    response_model=ElevenLabsOutboundCallResponse,
)
async def elevenlabs_outbound_call(
    payload: ElevenLabsOutboundCallRequest,
) -> ElevenLabsOutboundCallResponse:
    try:
        result = place_outbound_call(
            to_number=payload.toNumber,
            building_name=payload.buildingName,
            engineer_name=payload.engineerName,
            product_name=payload.productName,
            situation_summary=payload.situationSummary,
            failure_name=payload.failureName,
            failure_summary=payload.failureSummary,
            likely_cause=payload.likelyCause,
            likely_cause_confidence=payload.likelyCauseConfidence,
            fault_id=payload.faultId,
            device_id=payload.deviceId,
            device_name=payload.deviceName,
            severity=payload.severity,
            recommended_action=payload.recommendedAction,
            detected_at=payload.detectedAt,
            estimated_impact=payload.estimatedImpact,
            energy_waste=payload.energyWaste,
            triggered_by=payload.triggeredBy,
        )
    except ElevenLabsConfigurationError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except ElevenLabsWebhookPayloadError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return ElevenLabsOutboundCallResponse.model_validate(result)


@app.post("/api/simulation/run", response_model=SimulationRunResponse)
async def run_simulation(payload: SimulationRunRequest) -> SimulationRunResponse:
    status_payload = update_state(build_status_payload)
    response = run_simulation_bundle(
        duration_seconds=payload.durationSeconds,
        dt_seconds=payload.dtSeconds,
        failures_payload=[item.model_dump(mode="python") for item in payload.failures],
        status_payload=status_payload,
        generated_at=utc_now_iso(),
    )
    return SimulationRunResponse.model_validate(response)


@app.get("/api/bayesian/current", response_model=BayesianView)
async def bayesian_current() -> BayesianView:
    status_payload = update_state(build_status_payload)
    priors = build_component_failure_priors(
        requested_failures=[],
        status_payload=status_payload,
    )
    bayesian = serialize_bayesian_result(
        run_datacenter_inference(component_failure_priors=priors, simulation_context={})
    )
    return BayesianView.model_validate(bayesian)


if __name__ == "__main__":
    PORT = int(os.getenv("BACKEND_PORT", 5000))
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=PORT,
        reload=True,
        reload_dirs=["apps/backend/fastapi", "shacklib", "ml"],
        reload_excludes=[".venv/*", "node_modules/*", ".git/*", "__pycache__/*"],
    )
