from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

NodeStatus = Literal["healthy", "warning", "critical", "offline"]
DeviceStatus = Literal["healthy", "warning", "fault", "offline"]
FaultState = Literal["open", "resolved"]
DeviceType = Literal["actuator", "damper", "valve"]
AirflowDirection = Literal["supply", "return"] | None
FacilityNodeType = Literal["system", "ahu", "actuator", "damper", "valve", "device"]


class IngestPayload(BaseModel):
    nodeId: str = Field(min_length=1)
    timestamp: datetime
    deviceType: str = Field(min_length=1)
    parentIds: list[str] = Field(default_factory=list)
    telemetry: dict[str, Any] = Field(default_factory=dict)


class IngestResponse(BaseModel):
    ok: bool
    nodeId: str
    acceptedAt: str


class TelemetryPoint(BaseModel):
    time: str
    value: float


class FaultImpactMeta(BaseModel):
    estimatedImpact: str
    energyWaste: str


class LiveFaultView(BaseModel):
    id: str
    state: Literal["open"]
    kind: str
    probability: float
    summary: str
    recommendedAction: str


class LiveNodeView(BaseModel):
    id: str
    label: str
    type: FacilityNodeType
    status: NodeStatus
    position: float
    parentIds: list[str]
    fault: LiveFaultView | None = None


class FrontendFaultView(BaseModel):
    id: str
    type: str
    severity: Literal["critical", "high", "medium", "low"]
    diagnosis: str
    recommendation: str
    detectedAt: str
    estimatedImpact: str
    energyWaste: str


class DeviceView(BaseModel):
    id: str
    name: str
    model: str
    serial: str
    type: DeviceType
    zone: str
    zoneId: str
    status: DeviceStatus
    x: int
    y: int
    installedDate: str
    anomalyScore: float
    airflowDirection: AirflowDirection
    torque: list[TelemetryPoint]
    position: list[TelemetryPoint]
    temperature: list[TelemetryPoint]
    faults: list[FrontendFaultView]


class DeviceTemplateView(BaseModel):
    id: str
    name: str
    model: str
    serial: str
    type: DeviceType
    zone: str
    zoneId: str
    x: int
    y: int
    installedDate: str
    baseAnomalyScore: float
    airflowDirection: AirflowDirection
    torque: list[TelemetryPoint]
    position: list[TelemetryPoint]
    temperature: list[TelemetryPoint]


class ZoneView(BaseModel):
    id: str
    name: str
    label: str
    x: int
    y: int
    width: int
    height: int
    healthScore: int


class AHUUnitView(BaseModel):
    id: str
    label: str
    x: int
    y: int
    description: str


class BuildingStatsView(BaseModel):
    totalDevices: int
    healthyDevices: int
    warningDevices: int
    faultDevices: int
    overallHealth: float
    energyWaste: str
    estimatedCost: str
    activeFaults: int


class CatalogView(BaseModel):
    deviceTemplates: list[DeviceTemplateView]
    zones: list[ZoneView]
    ahuUnits: list[AHUUnitView]
    faultMetaByDeviceId: dict[str, FaultImpactMeta]


class DerivedView(BaseModel):
    devices: list[DeviceView]
    buildingStats: BuildingStatsView
    nodePositions: dict[str, float]


class MetaView(BaseModel):
    lastIngestAt: str | None = None
    lastClassificationAt: str | None = None
    lastFaultResolutionAt: str | None = None
    seedSource: Literal["mock"] | None = None
    seededAt: str | None = None


class StatusResponse(BaseModel):
    generatedAt: str
    nodes: list[LiveNodeView]
    catalog: CatalogView
    historyByNodeId: dict[str, dict[str, list[TelemetryPoint]]]
    derived: DerivedView
    meta: MetaView


class ResolveFaultRequest(BaseModel):
    resolvedBy: str = Field(min_length=1)
    note: str | None = None


class ResolveFaultResponse(BaseModel):
    ok: bool
    faultId: str
    state: FaultState


class NodeFaultHistoryEntry(BaseModel):
    id: str
    state: FaultState
    kind: str
    probability: float
    summary: str
    recommendedAction: str
    openedAt: str
    updatedAt: str
    resolvedBy: str | None = None
    note: str | None = None


class NodeFaultHistoryResponse(BaseModel):
    nodeId: str
    nodeLabel: str
    totalFaults: int
    openFaults: int
    faultHistory: list[NodeFaultHistoryEntry]


class MlFailureModeRequest(BaseModel):
    nodeId: str = Field(min_length=1)
    timeoutSeconds: float | None = Field(default=None, ge=0.2, le=30.0)


class MlFailureModeDiagnosis(BaseModel):
    status: NodeStatus
    kind: str
    probability: float
    summary: str
    recommendedAction: str


class MlFailureModeResponse(BaseModel):
    nodeId: str
    generatedAt: str
    mlUrl: str
    modelType: str | None = None
    task: str | None = None
    prediction: int | None = None
    className: str | None = None
    confidence: float | None = None
    diagnosis: MlFailureModeDiagnosis | None = None
    available: bool = True
    error: str | None = None


class DocumentListItem(BaseModel):
    id: str
    filename: str
    status: Literal["processing", "ready", "error"]
    errorMessage: str | None = None
    uploadedAt: str


class DocumentUploadResponse(DocumentListItem):
    pass


class AgentChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class AgentToolEvent(BaseModel):
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    outcome: Literal["executed", "pending_approval", "error"]
    result: dict[str, Any] | None = None


class AgentPendingAction(BaseModel):
    id: str
    name: str
    summary: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class AgentChatRequest(BaseModel):
    messages: list[AgentChatMessage] = Field(default_factory=list)
    actor: str = Field(default="webapp-operator", min_length=1, max_length=64)
    pendingActionId: str | None = None
    pendingActionDecision: Literal["approve", "reject"] | None = None

    @model_validator(mode="after")
    def validate_payload(self) -> "AgentChatRequest":
        has_pending_decision = bool(self.pendingActionId) or bool(
            self.pendingActionDecision
        )
        if has_pending_decision:
            if not self.pendingActionId or not self.pendingActionDecision:
                raise ValueError(
                    "pendingActionId and pendingActionDecision must be provided together"
                )
            return self

        if not self.messages:
            raise ValueError(
                "messages must not be empty when no pending action decision is provided"
            )

        return self


class AgentChatResponse(BaseModel):
    reply: str
    model: str
    generatedAt: str
    usedFallback: bool = False
    toolEvents: list[AgentToolEvent] = Field(default_factory=list)
    pendingAction: AgentPendingAction | None = None
