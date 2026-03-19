export type DeviceStatus = 'healthy' | 'warning' | 'fault' | 'offline';
export type LiveNodeStatus = 'healthy' | 'warning' | 'critical' | 'offline';
export type DeviceType = 'dampener';
export type AirflowDirection = 'supply' | 'return' | null;
export type FacilityNodeType = 'system' | 'ahu' | DeviceType;

export interface TelemetryPoint {
  time: string;
  value: number;
}

export interface Fault {
  id: string;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  diagnosis: string;
  recommendation: string;
  detectedAt: string;
  estimatedImpact: string;
  energyWaste: string;
}

export interface Device {
  id: string;
  name: string;
  model: string;
  serial: string;
  type: DeviceType;
  zone: string;
  zoneId: string;
  status: DeviceStatus;
  x: number;
  y: number;
  installedDate: string;
  anomalyScore: number;
  airflowDirection: AirflowDirection;
  torque: TelemetryPoint[];
  position: TelemetryPoint[];
  temperature: TelemetryPoint[];
  faults: Fault[];
}

export interface Zone {
  id: string;
  name: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  healthScore: number;
}

export interface AHUUnit {
  id: string;
  label: string;
  x: number;
  y: number;
  description: string;
}

export interface LiveFault {
  id: string;
  state: 'open' | 'closed';
  kind: string;
  probability: number;
  summary: string;
  recommendedAction: string;
}

export interface LiveNode {
  id: string;
  label: string;
  type: FacilityNodeType;
  status: LiveNodeStatus;
  position: number;
  parentIds: string[];
  fault: LiveFault | null;
}

export interface FacilityNodesResponse {
  generatedAt: string;
  nodes: LiveNode[];
}

export interface BuildingStats {
  totalDevices: number;
  healthyDevices: number;
  warningDevices: number;
  faultDevices: number;
  overallHealth: number;
  energyWaste: string;
  estimatedCost: string;
  activeFaults: number;
}

export interface BuildingDocumentListItem {
  id: string;
  filename: string;
  status: 'processing' | 'ready' | 'error';
  errorMessage: string | null;
  uploadedAt: string;
}

export interface DeviceTemplate {
  id: string;
  name: string;
  model: string;
  serial: string;
  type: DeviceType;
  zone: string;
  zoneId: string;
  x: number;
  y: number;
  installedDate: string;
  baseAnomalyScore: number;
  airflowDirection: AirflowDirection;
  torque: TelemetryPoint[];
  position: TelemetryPoint[];
  temperature: TelemetryPoint[];
}

export interface FaultImpactMeta {
  estimatedImpact: string;
  energyWaste: string;
}

export interface FacilityCatalog {
  deviceTemplates: DeviceTemplate[];
  zones: Zone[];
  ahuUnits: AHUUnit[];
  faultMetaByDeviceId: Record<string, FaultImpactMeta>;
}

export interface FacilityDerivedPayload {
  devices: Device[];
  buildingStats: BuildingStats;
  nodePositions: Record<string, number>;
}

export interface FacilityMeta {
  lastIngestAt: string | null;
  lastClassificationAt: string | null;
  lastFaultResolutionAt: string | null;
  seedSource: 'mock' | null;
  seededAt: string | null;
}

export interface FacilityStatusResponse extends FacilityNodesResponse {
  catalog: FacilityCatalog;
  historyByNodeId: Record<string, Record<string, TelemetryPoint[]>>;
  derived: FacilityDerivedPayload;
  meta: FacilityMeta;
}

export interface FacilityContext {
  ahuUnits: AHUUnit[];
  buildingStats: BuildingStats;
  devices: Device[];
  historyByNodeId: Record<string, Record<string, TelemetryPoint[]>>;
  nodePositions: Record<string, number>;
}

export interface AgentChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentToolEvent {
  name: string;
  arguments: Record<string, unknown>;
  outcome: 'executed' | 'pending_approval' | 'error';
  result: Record<string, unknown> | null;
}

export interface AgentPendingAction {
  id: string;
  name: string;
  summary: string;
  arguments: Record<string, unknown>;
}

export interface AgentChatRequest {
  messages: AgentChatMessage[];
  actor?: string;
  pendingActionId?: string;
  pendingActionDecision?: 'approve' | 'reject';
}

export interface AgentChatResponse {
  reply: string;
  model: string;
  generatedAt: string;
  usedFallback: boolean;
  toolEvents: AgentToolEvent[];
  pendingAction: AgentPendingAction | null;
}

export interface IssueAlertSelection {
  device: Device;
  fault: Fault;
}

export interface AgentRouteState {
  seedPrompt: string;
  seedSource: 'issues-table';
  seedId: string;
  focusInput: boolean;
  autoSubmit: boolean;
}

export interface NodeFaultHistoryEntry {
  id: string;
  state: 'open' | 'resolved';
  kind: string;
  probability: number;
  summary: string;
  recommendedAction: string;
  openedAt: string;
  updatedAt: string;
  resolvedBy: string | null;
  note: string | null;
}

export interface NodeFaultHistoryResponse {
  nodeId: string;
  nodeLabel: string;
  totalFaults: number;
  openFaults: number;
  faultHistory: NodeFaultHistoryEntry[];
}

export interface SimulationFailureInput {
  componentId: string;
  mode: string;
  severity?: number;
  startSeconds?: number;
  endSeconds?: number | null;
}

export interface SimulationRunRequest {
  durationSeconds?: number;
  dtSeconds?: number;
  failures?: SimulationFailureInput[];
}

export interface SimulationTimeline {
  timesSeconds: number[];
  zoneTemperatures: Record<string, number[]>;
  rowTemperatures: Record<string, number[]>;
  zoneColdAisleTemperatures?: Record<string, number[]>;
  zoneHotAisleTemperatures?: Record<string, number[]>;
  zoneRecirculation?: Record<string, number[]>;
  zoneSupplyFlows: Record<string, number[]>;
  zoneExhaustFlows: Record<string, number[]>;
  nodePositionsTimeline: Record<string, number>[];
  maxCpuTemperature: number[];
  rackCpuTemperatures?: Record<string, number[]>;
  rackInletTemperatures?: Record<string, number[]>;
  throttledCpuCount: number[];
  shutdownCpuCount: number[];
}

export interface BayesianNode {
  id: string;
  label: string;
  layer: string;
  kind: string;
  probability: number;
}

export interface BayesianEdge {
  source: string;
  target: string;
  weight: number;
}

export interface BayesianRisk {
  id: string;
  label: string;
  probability: number;
}

export interface BayesianSummary {
  cpu_throttling_probability: number;
  service_degradation_probability: number;
  most_at_risk_zone: string;
  baseline_cpu_throttling_probability: number;
  baseline_service_degradation_probability: number;
  cpu_probability_delta: number;
  service_probability_delta: number;
  key_drivers: string[];
}

export interface BayesianContribution {
  sourceId: string;
  sourceLabel: string;
  baselineContribution: number;
  candidateContribution: number;
  deltaContribution: number;
}

export interface BayesianPath {
  path: string;
  score: number;
}

export interface BayesianRiskExplanation {
  targetId: string;
  targetLabel: string;
  baselineProbability: number;
  candidateProbability: number;
  deltaProbability: number;
  topContributors: BayesianContribution[];
  strongestPaths: BayesianPath[];
  interpretation: string;
}

export interface BayesianExplainability {
  method: string;
  simulationEvidence: Record<string, number>;
  cpuRisk: BayesianRiskExplanation;
  serviceRisk: BayesianRiskExplanation;
}

export interface BayesianView {
  nodes: BayesianNode[];
  edges: BayesianEdge[];
  topRisks: BayesianRisk[];
  summary: BayesianSummary;
  explainability?: BayesianExplainability | null;
}

export interface SimulationDiscovery {
  focus_zone_id: string;
  zone_peak_delta_by_zone: Record<string, number>;
  most_impacted_zone_id: string;
  max_zone_peak_delta_c: number;
  baseline_zone_peak_c: number;
  candidate_zone_peak_c: number;
  zone_peak_delta_c: number;
  baseline_cpu_peak_c: number;
  candidate_cpu_peak_c: number;
  cpu_peak_delta_c: number;
  time_to_first_throttle_baseline_s: number | null;
  time_to_first_throttle_candidate_s: number | null;
  time_to_first_shutdown_baseline_s: number | null;
  time_to_first_shutdown_candidate_s: number | null;
  discoveryClaim?: string | null;
  counterintuitiveFinding?: string | null;
  significanceScore?: number | null;
  pValue?: number | null;
  effectSize?: number | null;
  confidenceIntervalC?: number[];
  primaryImpactZone?: string | null;
  nonLocalImpactC?: number | null;
  compoundHotspotZone?: string | null;
  compoundHotspotRate?: number | null;
  evidence?: string[];
}

export interface SimulationRunResponse {
  generatedAt: string;
  durationSeconds: number;
  dtSeconds: number;
  timeline: SimulationTimeline;
  discovery: SimulationDiscovery;
  bayesian: BayesianView;
  events: string[];
}
