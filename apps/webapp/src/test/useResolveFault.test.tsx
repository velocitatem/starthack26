import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useResolveFault } from '@/hooks/useFacilityData';
import { buildBackendUrl } from '@/lib/backend';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useResolveFault', () => {
  it('posts fault resolution to the backend endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, faultId: 'fault/123', state: 'resolved' }),
    } as Response);

    const { result } = renderHook(() => useResolveFault(), {
      wrapper: createWrapper(),
    });

    result.current.mutate('fault/123');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchSpy).toHaveBeenCalledWith(buildBackendUrl('/api/faults/fault%2F123/resolve'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolvedBy: 'operator' }),
    });
  });

  it('exposes pendingFaultId while the mutation is in flight', async () => {
    let resolveFetch!: (value: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise<Response>(resolve => { resolveFetch = resolve; }),
    );

    const { result } = renderHook(() => useResolveFault(), {
      wrapper: createWrapper(),
    });

    expect(result.current.pendingFaultId).toBeNull();

    act(() => { result.current.mutate('fault-003'); });

    await waitFor(() => expect(result.current.pendingFaultId).toBe('fault-003'));
    expect(result.current.isPending).toBe(true);

    await act(async () => {
      resolveFetch({
        ok: true,
        json: async () => ({ ok: true, faultId: 'fault-003', state: 'resolved' }),
      } as Response);
    });

    await waitFor(() => expect(result.current.pendingFaultId).toBeNull());
    expect(result.current.isSuccess).toBe(true);
  });
});
