export type DeviceStatus = 'healthy' | 'warning' | 'fault' | 'offline';
export type LiveNodeStatus = 'healthy' | 'warning' | 'critical' | 'offline';
export type DeviceType = 'actuator' | 'damper' | 'valve';
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
  position: number; // 0-1 decimal, valve/damper open percentage driving airflow speed
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

export interface BuildingDocumentListItem {
  id: string;
  filename: string;
  status: 'processing' | 'ready' | 'error';
  errorMessage: string | null;
  uploadedAt: string;
}

const generateTelemetry = (base: number, variance: number, anomaly = false): TelemetryPoint[] => {
  return Array.from({ length: 24 }, (_, i) => ({
    time: `${String(i).padStart(2, '0')}:00`,
    value: base + (Math.random() - 0.5) * variance + (anomaly && i > 18 ? variance * 2 : 0),
  }));
};

const titleCase = (value: string) => value
  .split('_')
  .map(part => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const parseDailyAmount = (value: string) => {
  const match = value.match(/([\d,.]+)/);
  return match ? Number(match[1].replace(/,/g, '')) : 0;
};

const formatCurrencyPerDay = (value: number) => `$${Math.round(value).toLocaleString()}/day`;
const formatEnergyWastePerDay = (value: number) => `${Math.round(value)} kWh/day`;

const getFaultSeverity = (node: LiveNode): Fault['severity'] => {
  if (node.status === 'critical') {
    return 'critical';
  }

  const probability = node.fault?.probability ?? 0;
  if (probability >= 0.6) {
    return 'high';
  }
  if (probability >= 0.4) {
    return 'medium';
  }
  return 'low';
};

const toDeviceStatus = (status: LiveNodeStatus): DeviceStatus => {
  if (status === 'critical') {
    return 'fault';
  }

  return status;
};

export const defaultFaultMetaByDeviceId: Record<string, FaultImpactMeta> = {
  'BEL-VLV-003': { estimatedImpact: '$1,200/day cooling inefficiency', energyWaste: '340 kWh/day' },
  'BEL-ACT-004': { estimatedImpact: '$400/day energy waste', energyWaste: '120 kWh/day' },
  'BEL-VLV-005': { estimatedImpact: '$180/day energy waste', energyWaste: '80 kWh/day' },
};

export const deviceTemplates: DeviceTemplate[] = [
  {
    id: 'BEL-ACT-001', name: 'Kitchen Supply Actuator', model: 'LMV-D3', serial: 'SN-88421',
    type: 'actuator', zone: 'Kitchen', zoneId: 'zone-kitchen',
    x: 160, y: 210, installedDate: '2024-06-15', baseAnomalyScore: 0.12, airflowDirection: 'supply',
    torque: generateTelemetry(4.2, 0.8), position: generateTelemetry(72, 15), temperature: generateTelemetry(23, 2),
  },
  {
    id: 'BEL-DMP-002', name: 'Kitchen Exhaust Damper', model: 'NMV-D2M', serial: 'SN-88422',
    type: 'damper', zone: 'Kitchen', zoneId: 'zone-kitchen',
    x: 80, y: 100, installedDate: '2024-06-15', baseAnomalyScore: 0.08, airflowDirection: 'return',
    torque: generateTelemetry(3.8, 0.5), position: generateTelemetry(65, 10), temperature: generateTelemetry(22, 1.5),
  },
  {
    id: 'BEL-VLV-003', name: 'Living Room Chiller Valve', model: 'R2025-S2', serial: 'SN-71004',
    type: 'valve', zone: 'Living Room', zoneId: 'zone-living',
    x: 550, y: 100, installedDate: '2023-11-20', baseAnomalyScore: 0.91, airflowDirection: null,
    torque: generateTelemetry(6.8, 2.5, true), position: generateTelemetry(45, 30, true), temperature: generateTelemetry(28, 5, true),
  },
  {
    id: 'BEL-ACT-004', name: 'Living Room Damper Actuator', model: 'LMV-D3', serial: 'SN-71005',
    type: 'actuator', zone: 'Living Room', zoneId: 'zone-living',
    x: 700, y: 200, installedDate: '2024-01-10', baseAnomalyScore: 0.64, airflowDirection: 'supply',
    torque: generateTelemetry(5.1, 1.8, true), position: generateTelemetry(80, 20), temperature: generateTelemetry(26, 3),
  },
  {
    id: 'BEL-VLV-005', name: 'Bathroom Water Valve', model: 'AF24-MFT', serial: 'SN-55301',
    type: 'valve', zone: 'Bathroom', zoneId: 'zone-bath',
    x: 100, y: 380, installedDate: '2024-03-22', baseAnomalyScore: 0.52, airflowDirection: null,
    torque: generateTelemetry(3.2, 1.2), position: generateTelemetry(55, 18), temperature: generateTelemetry(21, 2),
  },
  {
    id: 'BEL-DMP-006', name: 'Bedroom 1 Supply Damper', model: 'R2015-S1', serial: 'SN-55302',
    type: 'damper', zone: 'Bedroom 1', zoneId: 'zone-bed1',
    x: 700, y: 450, installedDate: '2025-01-08', baseAnomalyScore: 0.05, airflowDirection: 'supply',
    torque: generateTelemetry(2.8, 0.4), position: generateTelemetry(60, 8), temperature: generateTelemetry(42, 3),
  },
  {
    id: 'BEL-ACT-007', name: 'Bedroom 1 Return Actuator', model: 'LMV-D3', serial: 'SN-99100',
    type: 'actuator', zone: 'Bedroom 1', zoneId: 'zone-bed1',
    x: 750, y: 550, installedDate: '2025-02-14', baseAnomalyScore: 0.03, airflowDirection: 'return',
    torque: generateTelemetry(3.5, 0.3), position: generateTelemetry(70, 5), temperature: generateTelemetry(22, 1),
  },
  {
    id: 'BEL-DMP-008', name: 'Bedroom 2 Fresh Air Damper', model: 'NMV-D2M', serial: 'SN-99101',
    type: 'damper', zone: 'Bedroom 2', zoneId: 'zone-bed2',
    x: 350, y: 520, installedDate: '2025-02-14', baseAnomalyScore: 0.07, airflowDirection: 'supply',
    torque: generateTelemetry(2.9, 0.5), position: generateTelemetry(50, 10), temperature: generateTelemetry(20, 1.5),
  },
];

export const zones: Zone[] = [
  { id: 'zone-kitchen', name: 'Kitchen', label: 'K', x: 25, y: 25, width: 280, height: 255, healthScore: 94 },
  { id: 'zone-living', name: 'Living Room', label: 'L', x: 308, y: 25, width: 487, height: 295, healthScore: 67 },
  { id: 'zone-bath', name: 'Bathroom', label: 'B', x: 25, y: 288, width: 153, height: 182, healthScore: 88 },
  { id: 'zone-bed1', name: 'Bedroom 1', label: '1', x: 588, y: 328, width: 207, height: 267, healthScore: 98 },
  { id: 'zone-bed2', name: 'Bedroom 2', label: '2', x: 186, y: 408, width: 244, height: 187, healthScore: 91 },
];

export const ahuUnits: AHUUnit[] = [
  { id: 'ahu-01', label: 'AHU-01', x: 310, y: 240, description: 'Kitchen & Living' },
  { id: 'ahu-02', label: 'AHU-02', x: 460, y: 370, description: 'Bedrooms & Bath' },
];

export const initialFacilityNodesResponse: FacilityNodesResponse = {
  generatedAt: '2026-03-18T14:05:05Z',
  nodes: [
    {
      id: 'ahu-01',
      label: 'AHU 01',
      type: 'ahu',
      status: 'warning',
      position: 0.92,
      parentIds: [],
      fault: null,
    },
    {
      id: 'ahu-02',
      label: 'AHU 02',
      type: 'ahu',
      status: 'warning',
      position: 0.55,
      parentIds: [],
      fault: null,
    },
    {
      id: 'BEL-ACT-001',
      label: 'Kitchen Supply Actuator',
      type: 'actuator',
      status: 'healthy',
      position: 0.95,
      parentIds: ['ahu-01'],
      fault: null,
    },
    {
      id: 'BEL-DMP-002',
      label: 'Kitchen Exhaust Damper',
      type: 'damper',
      status: 'healthy',
      position: 0,
      parentIds: ['ahu-01'],
      fault: null,
    },
    {
      id: 'BEL-VLV-003',
      label: 'Living Room Chiller Valve',
      type: 'valve',
      status: 'critical',
      position: 0.12,
      parentIds: ['ahu-01'],
      fault: {
        id: 'fault-003',
        state: 'open',
        kind: 'stiction_suspected',
        probability: 0.91,
        summary: 'Torque signature shows mechanical binding at 45 degree position and the valve is lagging the setpoint.',
        recommendedAction: 'Inspect actuator assembly for debris or gear wear and replace the assembly if needed.',
      },
    },
    {
      id: 'BEL-ACT-004',
      label: 'Living Room Damper Actuator',
      type: 'actuator',
      status: 'warning',
      position: 0.88,
      parentIds: ['ahu-01'],
      fault: {
        id: 'fault-004',
        state: 'open',
        kind: 'control_signal_drift',
        probability: 0.64,
        summary: 'Position feedback is drifting away from the control signal over the last 72 hours.',
        recommendedAction: 'Recalibrate the position sensor and replace the feedback potentiometer if the drift remains.',
      },
    },
    {
      id: 'BEL-VLV-005',
      label: 'Bathroom Water Valve',
      type: 'valve',
      status: 'warning',
      position: 0,
      parentIds: ['ahu-02'],
      fault: {
        id: 'fault-005',
        state: 'open',
        kind: 'oversized_valve',
        probability: 0.52,
        summary: 'The valve is consistently operating below 30 percent open, indicating oversizing for the current load.',
        recommendedAction: 'Review valve sizing and consider a smaller valve to reduce hunting behavior.',
      },
    },
    {
      id: 'BEL-DMP-006',
      label: 'Bedroom 1 Supply Damper',
      type: 'damper',
      status: 'healthy',
      position: 1.0,
      parentIds: ['ahu-02'],
      fault: null,
    },
    {
      id: 'BEL-ACT-007',
      label: 'Bedroom 1 Return Actuator',
      type: 'actuator',
      status: 'healthy',
      position: 0.08,
      parentIds: ['ahu-02'],
      fault: null,
    },
    {
      id: 'BEL-DMP-008',
      label: 'Bedroom 2 Fresh Air Damper',
      type: 'damper',
      status: 'healthy',
      position: 0.42,
      parentIds: ['ahu-02'],
      fault: null,
    },
  ],
};

const buildFault = (node: LiveNode, generatedAt: string): Fault[] => {
  if (!node.fault || node.fault.state !== 'open') {
    return [];
  }

  const defaultFaultMeta = defaultFaultMetaByDeviceId[node.id] ?? {
    estimatedImpact: '$0/day impact estimate pending',
    energyWaste: '0 kWh/day',
  };

  return [
    {
      id: node.fault.id,
      type: titleCase(node.fault.kind),
      severity: getFaultSeverity(node),
      diagnosis: node.fault.summary,
      recommendation: node.fault.recommendedAction,
      detectedAt: generatedAt,
      estimatedImpact: defaultFaultMeta.estimatedImpact,
      energyWaste: defaultFaultMeta.energyWaste,
    },
  ];
};

const buildDevice = (template: DeviceTemplate, liveNode: LiveNode | undefined, generatedAt: string): Device => {
  const faults = liveNode ? buildFault(liveNode, generatedAt) : [];
  const status = liveNode ? toDeviceStatus(liveNode.status) : 'healthy';
  const anomalyScore = liveNode?.fault?.probability ?? template.baseAnomalyScore;

  return {
    id: template.id,
    name: template.name,
    model: template.model,
    serial: template.serial,
    type: template.type,
    zone: template.zone,
    zoneId: template.zoneId,
    status,
    x: template.x,
    y: template.y,
    installedDate: template.installedDate,
    anomalyScore,
    airflowDirection: template.airflowDirection,
    torque: template.torque,
    position: template.position,
    temperature: template.temperature,
    faults,
  };
};

export const buildBuildingStats = (devices: Device[]): BuildingStats => {
  const totalDevices = devices.length;
  const healthyDevices = devices.filter(device => device.status === 'healthy').length;
  const warningDevices = devices.filter(device => device.status === 'warning').length;
  const faultDevices = devices.filter(device => device.status === 'fault').length;
  const activeFaults = devices.reduce((sum, device) => sum + device.faults.length, 0);

  const totalEnergyWaste = devices
    .flatMap(device => device.faults)
    .reduce((sum, fault) => sum + parseDailyAmount(fault.energyWaste), 0);

  const totalEstimatedCost = devices
    .flatMap(device => device.faults)
    .reduce((sum, fault) => sum + parseDailyAmount(fault.estimatedImpact), 0);

  const statusScore = {
    healthy: 100,
    warning: 78,
    fault: 42,
    offline: 20,
  } as const;

  const overallHealth = totalDevices === 0
    ? 0
    : Number((devices.reduce((sum, device) => sum + statusScore[device.status], 0) / totalDevices).toFixed(1));

  return {
    totalDevices,
    healthyDevices,
    warningDevices,
    faultDevices,
    overallHealth,
    energyWaste: formatEnergyWastePerDay(totalEnergyWaste),
    estimatedCost: formatCurrencyPerDay(totalEstimatedCost),
    activeFaults,
  };
};

export const buildDevicesFromNodes = (response: FacilityNodesResponse): Device[] => {
  const nodeLookup = new Map(response.nodes.map(node => [node.id, node]));
  return deviceTemplates.map(template => buildDevice(template, nodeLookup.get(template.id), response.generatedAt));
};

export const devices = buildDevicesFromNodes(initialFacilityNodesResponse);
export const buildingStats = buildBuildingStats(devices);

export const buildMockFacilityStatusResponse = (): FacilityStatusResponse => ({
  generatedAt: initialFacilityNodesResponse.generatedAt,
  nodes: initialFacilityNodesResponse.nodes,
  catalog: {
    deviceTemplates,
    zones,
    ahuUnits,
    faultMetaByDeviceId: defaultFaultMetaByDeviceId,
  },
  historyByNodeId: Object.fromEntries(
    deviceTemplates.map((template) => [
      template.id,
      {
        torque: template.torque,
        position_percent: template.position,
        temperature: template.temperature,
      },
    ]),
  ),
  derived: {
    devices,
    buildingStats,
    nodePositions: Object.fromEntries(initialFacilityNodesResponse.nodes.map((node) => [node.id, node.position])),
  },
  meta: {
    lastIngestAt: null,
    lastClassificationAt: null,
    lastFaultResolutionAt: null,
    seedSource: 'mock',
    seededAt: initialFacilityNodesResponse.generatedAt,
  },
});
