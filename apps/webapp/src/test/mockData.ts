/**
 * Mock data and builders used exclusively by tests.
 * Production code fetches all data from the backend via /api/status.
 */
import type {
  AHUUnit,
  BuildingDocumentListItem,
  BuildingStats,
  Device,
  DeviceTemplate,
  Fault,
  FacilityNodesResponse,
  FacilityStatusResponse,
  FaultImpactMeta,
  LiveNode,
  TelemetryPoint,
  Zone,
} from '@/types/facility';

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

const toDeviceStatus = (status: LiveNode['status']): Device['status'] => {
  if (status === 'critical') {
    return 'fault';
  }

  return status;
};

const defaultFaultMetaByDeviceId: Record<string, FaultImpactMeta> = {
  'BEL-VLV-003': { estimatedImpact: '$1,200/day cooling inefficiency', energyWaste: '340 kWh/day' },
  'BEL-ACT-004': { estimatedImpact: '$400/day energy waste', energyWaste: '120 kWh/day' },
  'BEL-VLV-005': { estimatedImpact: '$180/day energy waste', energyWaste: '80 kWh/day' },
};

const deviceTemplates: DeviceTemplate[] = [
  {
    id: 'BEL-ACT-001', name: 'South Intake Actuator', model: 'LMV-D3', serial: 'SN-88421',
    type: 'actuator', zone: 'Intake Corridor', zoneId: 'zone-kitchen',
    x: 70, y: 567.5, installedDate: '2024-06-15', baseAnomalyScore: 0.12, airflowDirection: 'supply',
    torque: generateTelemetry(4.2, 0.8), position: generateTelemetry(72, 15), temperature: generateTelemetry(23, 2),
  },
  {
    id: 'BEL-DMP-002', name: 'Valve Row B', model: 'NMV-D2M', serial: 'SN-88422',
    type: 'damper', zone: 'Hot Row B', zoneId: 'zone-row-b',
    x: 350, y: 155, installedDate: '2024-06-15', baseAnomalyScore: 0.08, airflowDirection: 'return',
    torque: generateTelemetry(3.8, 0.5), position: generateTelemetry(65, 10), temperature: generateTelemetry(22, 1.5),
  },
  {
    id: 'BEL-VLV-003', name: 'Valve Row A', model: 'R2025-S2', serial: 'SN-71004',
    type: 'valve', zone: 'Cold Row A', zoneId: 'zone-row-a',
    x: 200, y: 520, installedDate: '2023-11-20', baseAnomalyScore: 0.91, airflowDirection: 'supply',
    torque: generateTelemetry(6.8, 2.5, true), position: generateTelemetry(45, 30, true), temperature: generateTelemetry(28, 5, true),
  },
  {
    id: 'BEL-ACT-004', name: 'Valve Row D', model: 'LMV-D3', serial: 'SN-71005',
    type: 'actuator', zone: 'Hot Row D', zoneId: 'zone-row-d',
    x: 650, y: 155, installedDate: '2024-01-10', baseAnomalyScore: 0.64, airflowDirection: 'return',
    torque: generateTelemetry(5.1, 1.8, true), position: generateTelemetry(80, 20), temperature: generateTelemetry(26, 3),
  },
  {
    id: 'BEL-VLV-005', name: 'Valve Row C', model: 'AF24-MFT', serial: 'SN-55301',
    type: 'valve', zone: 'Cold Row C', zoneId: 'zone-row-c',
    x: 500, y: 520, installedDate: '2024-03-22', baseAnomalyScore: 0.52, airflowDirection: 'supply',
    torque: generateTelemetry(3.2, 1.2), position: generateTelemetry(55, 18), temperature: generateTelemetry(21, 2),
  },
  {
    id: 'BEL-DMP-006', name: 'Valve Row F', model: 'R2015-S1', serial: 'SN-55302',
    type: 'damper', zone: 'Hot Row F', zoneId: 'zone-row-f',
    x: 950, y: 155, installedDate: '2025-01-08', baseAnomalyScore: 0.05, airflowDirection: 'return',
    torque: generateTelemetry(2.8, 0.4), position: generateTelemetry(60, 8), temperature: generateTelemetry(42, 3),
  },
  {
    id: 'BEL-ACT-007', name: 'Valve Row E', model: 'LMV-D3', serial: 'SN-99100',
    type: 'actuator', zone: 'Cold Row E', zoneId: 'zone-row-e',
    x: 800, y: 520, installedDate: '2025-02-14', baseAnomalyScore: 0.03, airflowDirection: 'supply',
    torque: generateTelemetry(3.5, 0.3), position: generateTelemetry(70, 5), temperature: generateTelemetry(22, 1),
  },
  {
    id: 'BEL-DMP-008', name: 'North Exhaust Damper', model: 'NMV-D2M', serial: 'SN-99101',
    type: 'damper', zone: 'Exhaust Plenum', zoneId: 'zone-bed2',
    x: 1090, y: 107.5, installedDate: '2025-02-14', baseAnomalyScore: 0.07, airflowDirection: 'return',
    torque: generateTelemetry(2.9, 0.5), position: generateTelemetry(50, 10), temperature: generateTelemetry(20, 1.5),
  },
];

export const zones: Zone[] = [
  { id: 'zone-kitchen', name: 'Intake Corridor', label: 'IN', x: 20, y: 520, width: 120, height: 80, healthScore: 94 },
  { id: 'zone-row-a', name: 'Cold Row A', label: 'A', x: 120, y: 190, width: 130, height: 320, healthScore: 67 },
  { id: 'zone-row-b', name: 'Hot Row B', label: 'B', x: 270, y: 190, width: 130, height: 320, healthScore: 88 },
  { id: 'zone-row-c', name: 'Cold Row C', label: 'C', x: 420, y: 190, width: 130, height: 320, healthScore: 95 },
  { id: 'zone-row-d', name: 'Hot Row D', label: 'D', x: 570, y: 190, width: 130, height: 320, healthScore: 84 },
  { id: 'zone-row-e', name: 'Cold Row E', label: 'E', x: 720, y: 190, width: 130, height: 320, healthScore: 98 },
  { id: 'zone-row-f', name: 'Hot Row F', label: 'F', x: 870, y: 190, width: 130, height: 320, healthScore: 91 },
  { id: 'zone-bed2', name: 'Exhaust Plenum', label: 'EX', x: 980, y: 70, width: 150, height: 90, healthScore: 91 },
];

export const ahuUnits: AHUUnit[] = [
  { id: 'ahu-01', label: 'SFA-01', x: 168, y: 625, description: 'South supply fan array' },
  { id: 'ahu-02', label: 'EFA-01', x: 1010, y: 55, description: 'North exhaust fan array' },
];

const initialFacilityNodesResponse: FacilityNodesResponse = {
  generatedAt: '2026-03-18T14:05:05Z',
  nodes: [
    {
      id: 'ahu-01',
      label: 'Supply Fan Array',
      type: 'ahu',
      status: 'warning',
      position: 0.92,
      parentIds: [],
      fault: null,
    },
    {
      id: 'ahu-02',
      label: 'Exhaust Fan Array',
      type: 'ahu',
      status: 'warning',
      position: 0.55,
      parentIds: [],
      fault: null,
    },
    {
      id: 'BEL-ACT-001',
      label: 'South Intake Actuator',
      type: 'actuator',
      status: 'healthy',
      position: 0.95,
      parentIds: ['ahu-01'],
      fault: null,
    },
    {
      id: 'BEL-DMP-002',
      label: 'Valve Row B',
      type: 'damper',
      status: 'healthy',
      position: 0.58,
      parentIds: ['ahu-01'],
      fault: null,
    },
    {
      id: 'BEL-VLV-003',
      label: 'Valve Row A',
      type: 'valve',
      status: 'critical',
      position: 0.12,
      parentIds: ['ahu-01'],
      fault: {
        id: 'fault-003', state: 'open', kind: 'stiction_suspected', probability: 0.91,
        summary: 'Torque signature shows mechanical binding at 45 degree position and the valve is lagging the setpoint.',
        recommendedAction: 'Inspect actuator assembly for debris or gear wear and replace the assembly if needed.',
      },
    },
    {
      id: 'BEL-ACT-004',
      label: 'Valve Row D',
      type: 'actuator',
      status: 'warning',
      position: 0.88,
      parentIds: ['ahu-01'],
      fault: {
        id: 'fault-004', state: 'open', kind: 'control_signal_drift', probability: 0.64,
        summary: 'Position feedback is drifting away from the control signal over the last 72 hours.',
        recommendedAction: 'Recalibrate the position sensor and replace the feedback potentiometer if the drift remains.',
      },
    },
    {
      id: 'BEL-VLV-005',
      label: 'Valve Row C',
      type: 'valve',
      status: 'warning',
      position: 0.76,
      parentIds: ['ahu-02'],
      fault: {
        id: 'fault-005', state: 'open', kind: 'oversized_valve', probability: 0.52,
        summary: 'The valve is consistently operating below 30 percent open, indicating oversizing for the current load.',
        recommendedAction: 'Review valve sizing and consider a smaller valve to reduce hunting behavior.',
      },
    },
    {
      id: 'BEL-DMP-006',
      label: 'Valve Row F',
      type: 'damper',
      status: 'healthy',
      position: 1.0,
      parentIds: ['ahu-02'],
      fault: null,
    },
    {
      id: 'BEL-ACT-007',
      label: 'Valve Row E',
      type: 'actuator',
      status: 'healthy',
      position: 0.08,
      parentIds: ['ahu-02'],
      fault: null,
    },
    {
      id: 'BEL-DMP-008',
      label: 'North Exhaust Damper',
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

const buildBuildingStats = (devices: Device[]): BuildingStats => {
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

const buildDevicesFromNodes = (response: FacilityNodesResponse): Device[] => {
  const nodeLookup = new Map(response.nodes.map(node => [node.id, node]));
  return deviceTemplates.map(template => buildDevice(template, nodeLookup.get(template.id), response.generatedAt));
};

const devices = buildDevicesFromNodes(initialFacilityNodesResponse);
const buildingStats = buildBuildingStats(devices);

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
