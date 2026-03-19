import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/components/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import Index from '@/pages/Index';
import { useFacilityData } from '@/hooks/useFacilityData';
import { buildMockFacilityStatusResponse } from './mockData';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return ({ children }: { children: ReactNode }) => (
    <ThemeProvider defaultTheme="dark" storageKey="test-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
};

const mockStatusFetch = () => {
  const payload = buildMockFacilityStatusResponse();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => payload,
  } as Response);
  return payload;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useFacilityData', () => {
  it('returns aggregate backend data without remapping component props', async () => {
    const payload = mockStatusFetch();
    const wrapper = createWrapper();

    const { result } = renderHook(() => useFacilityData(), { wrapper });

    await waitFor(() => expect(result.current.devices).toHaveLength(payload.derived.devices.length));

    expect(result.current.devices[0]?.id).toBe(payload.derived.devices[0]?.id);
    expect(result.current.buildingStats.faultDevices).toBe(payload.derived.buildingStats.faultDevices);
    expect(result.current.ahuUnits).toEqual(payload.catalog.ahuUnits);
    expect(result.current.nodePositions['ahu-01']).toBe(payload.derived.nodePositions['ahu-01']);
  });
});

describe('Index page', () => {
  it('shows a backend-required error when /api/status is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);
    const wrapper = createWrapper();

    render(<Index />, { wrapper });

    expect(await screen.findByText('Backend connection required')).toBeInTheDocument();
    expect(screen.getByText(/Failed to fetch facility status: 503/)).toBeInTheDocument();
  });

  it('renders map data, opens alerts, and shows device telemetry from aggregate payload', async () => {
    mockStatusFetch();
    const wrapper = createWrapper();

    render(<Index />, { wrapper });

    expect(await screen.findByRole('heading', { name: 'Datacenter Overview' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Alerts' }));
    expect(await screen.findByRole('heading', { name: 'Alert Dashboard' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Stiction Suspected'));

    await waitFor(() => {
      expect(screen.getByText('Valve Row A')).toBeInTheDocument();
    });

    expect(screen.getByText('Live Telemetry (24h)')).toBeInTheDocument();
    expect(screen.getByText(/Torque \(Nm\)/)).toBeInTheDocument();
  });
});
