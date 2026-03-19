// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';
import AgentPage from '@/pages/AgentPage';
import DeviceDetailPanel from '@/components/DeviceDetailPanel';
import DeviceDashboardPage from '@/pages/DeviceDashboardPage';
import IssuesPage from '@/pages/IssuesPage';
import { buildAgentRouteStateForIssue, buildIssueResultPrompt } from '@/lib/agentNavigation';
import { type Device, type FacilityContext } from '@/types/facility';

const agentMutateMock = vi.fn();
const uploadMutateMock = vi.fn();
const deleteMutateMock = vi.fn();

vi.mock('@/hooks/useAgentChat', () => ({
  useAgentChat: () => ({
    mutate: agentMutateMock,
    isPending: false,
  }),
}));

vi.mock('@/hooks/useBuildingDocuments', () => ({
  useDocumentsList: () => ({
    data: [],
    isLoading: false,
    error: null,
  }),
  useUploadDocument: () => ({
    isPending: false,
    error: null,
    variables: undefined,
    mutate: uploadMutateMock,
  }),
  useDeleteDocument: () => ({
    isPending: false,
    mutate: deleteMutateMock,
  }),
}));

vi.mock('@/hooks/useNodeFaultHistory', () => ({
  useNodeFaultHistory: () => ({
    data: {
      nodeId: 'BEL-VNT-003',
      nodeLabel: 'Supply Damper 03',
      totalFaults: 1,
      openFaults: 1,
      faultHistory: [],
    },
    isLoading: false,
    error: null,
  }),
}));

const device: Device = {
  id: 'BEL-VNT-003',
  name: 'Supply Damper 03',
  model: 'B230',
  serial: 'SN-003',
  type: 'dampener',
  zone: 'North Wing',
  zoneId: 'zone-north',
  status: 'fault',
  x: 0,
  y: 0,
  installedDate: '2026-01-10T09:30:00Z',
  anomalyScore: 0.92,
  airflowDirection: 'supply',
  torque: [],
  position: [],
  temperature: [],
  faults: [
    {
      id: 'fault-003',
      type: 'Actuator stall',
      severity: 'high',
      diagnosis: 'The actuator is drawing current without changing blade position.',
      recommendation: 'Inspect the linkage assembly and re-home the actuator.',
      detectedAt: '2026-03-19T08:14:00Z',
      estimatedImpact: 'Reduced ventilation in the north wing.',
      energyWaste: '145 kWh/day',
    },
  ],
};

const facilityContext: FacilityContext = {
  ahuUnits: [],
  buildingStats: {
    totalDevices: 1,
    healthyDevices: 0,
    warningDevices: 0,
    faultDevices: 1,
    overallHealth: 62,
    energyWaste: '145 kWh/day',
    estimatedCost: 'CHF 320/day',
    activeFaults: 1,
  },
  devices: [device],
  historyByNodeId: {},
  nodePositions: {},
};

const withOutletContext = () => <Outlet context={facilityContext} />;

const AgentStateProbe = () => {
  const location = useLocation();
  return <pre data-testid="agent-state">{JSON.stringify(location.state)}</pre>;
};

const DeviceProbe = () => {
  const { deviceId } = useParams();
  return <div data-testid="device-page">{deviceId}</div>;
};

const AgentPageWithStateProbe = () => {
  const location = useLocation();
  return (
    <>
      <AgentPage />
      <pre data-testid="location-state">{JSON.stringify(location.state)}</pre>
    </>
  );
};

beforeEach(() => {
  vi.restoreAllMocks();
  agentMutateMock.mockReset();
  uploadMutateMock.mockReset();
  deleteMutateMock.mockReset();
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('issues to agent handoff', () => {
  it('navigates to /agent with the seeded route state when Resolve is clicked', async () => {
    render(
      <MemoryRouter initialEntries={['/issues']}>
        <Routes>
          <Route element={withOutletContext()}>
            <Route path="/issues" element={<IssuesPage />} />
            <Route path="/agent" element={<AgentStateProbe />} />
            <Route path="/issues/:deviceId" element={<DeviceProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    const stateNode = await screen.findByTestId('agent-state');
    expect(stateNode.textContent).toBe(JSON.stringify(buildAgentRouteStateForIssue({
      device,
      fault: device.faults[0],
    })));
  });

  it('builds a deterministic seeded prompt with issue details and escalation instruction', () => {
    const prompt = buildIssueResultPrompt({ device, fault: device.faults[0] });

    expect(prompt).toContain(device.name);
    expect(prompt).toContain(device.id);
    expect(prompt).toContain(device.zone);
    expect(prompt).toContain(device.faults[0].id);
    expect(prompt).toContain(device.faults[0].severity);
    expect(prompt).toContain(device.faults[0].diagnosis);
    expect(prompt).toContain(device.faults[0].recommendation);
    expect(prompt).toContain(device.faults[0].estimatedImpact);
    expect(prompt).toContain(device.faults[0].energyWaste);
    expect(prompt).toContain('call the voice escalation tool');
  });

  it('keeps row click navigation to the device detail page', async () => {
    render(
      <MemoryRouter initialEntries={['/issues']}>
        <Routes>
          <Route element={withOutletContext()}>
            <Route path="/issues" element={<IssuesPage />} />
            <Route path="/agent" element={<AgentStateProbe />} />
            <Route path="/issues/:deviceId" element={<DeviceProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText('Actuator stall'));

    expect(await screen.findByTestId('device-page')).toHaveTextContent(device.id);
  });

  it('uses the same agent handoff when Resolve is clicked from the device overview', async () => {
    render(
      <MemoryRouter initialEntries={[`/devices/${device.id}`]}>
        <Routes>
          <Route element={withOutletContext()}>
            <Route path="/devices/:deviceId" element={<DeviceDashboardPage />} />
            <Route path="/agent" element={<AgentStateProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    const stateNode = await screen.findByTestId('agent-state');
    expect(stateNode.textContent).toBe(JSON.stringify(buildAgentRouteStateForIssue({
      device,
      fault: device.faults[0],
    })));
  });

  it('uses the same agent handoff when Resolve is clicked from the map sidebar', async () => {
    render(
      <MemoryRouter initialEntries={['/map']}>
        <Routes>
          <Route
            path="/map"
            element={<DeviceDetailPanel device={device} mode="pinned" onClose={() => undefined} />}
          />
          <Route path="/agent" element={<AgentStateProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    const stateNode = await screen.findByTestId('agent-state');
    expect(stateNode.textContent).toBe(JSON.stringify(buildAgentRouteStateForIssue({
      device,
      fault: device.faults[0],
    })));
  });

  it('auto-submits the agent message from route state and clears the route state', async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/agent', state: buildAgentRouteStateForIssue({ device, fault: device.faults[0] }) }]}>
        <Routes>
          <Route element={withOutletContext()}>
            <Route path="/agent" element={<AgentPageWithStateProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const input = screen.getByPlaceholderText('Ask why a fault happened, request history, or ask to run an action');
    const expectedPrompt = buildIssueResultPrompt({ device, fault: device.faults[0] });

    await waitFor(() => expect(agentMutateMock).toHaveBeenCalledTimes(1));
    expect(agentMutateMock).toHaveBeenCalledWith(
      {
        messages: [
          {
            role: 'assistant',
            content: 'I can investigate faults, explain likely root cause, and execute platform actions after your approval.',
          },
          {
            role: 'user',
            content: expectedPrompt,
          },
        ],
        actor: 'facility-manager',
      },
      expect.any(Object),
    );
    await waitFor(() => expect(input).toHaveValue(''));
    await waitFor(() => expect(screen.getByTestId('location-state')).toHaveTextContent('null'));
  });

  it('keeps the agent input empty on direct navigation without route state', () => {
    render(
      <MemoryRouter initialEntries={['/agent']}>
        <Routes>
          <Route element={withOutletContext()}>
            <Route path="/agent" element={<AgentPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.getByPlaceholderText('Ask why a fault happened, request history, or ask to run an action'),
    ).toHaveValue('');
    expect(agentMutateMock).not.toHaveBeenCalled();
  });
});
