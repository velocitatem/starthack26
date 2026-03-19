import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useDeleteDocument, useDocumentsList, useUploadDocument } from '@/hooks/useBuildingDocuments';

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

describe('useBuildingDocuments', () => {
  it('loads the documents list from the backend', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{
        id: 'doc-1',
        filename: 'layout.pdf',
        status: 'ready',
        errorMessage: null,
        uploadedAt: '2026-03-19T12:00:00Z',
      }],
    } as Response);

    const { result } = renderHook(() => useDocumentsList(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(String(fetchSpy.mock.calls[0]?.[0])).toMatch(/\/api\/documents$/);
    expect(fetchSpy.mock.calls[0]?.[1]).toEqual({
      cache: 'no-store',
    });
    expect(result.current.data?.[0]?.filename).toBe('layout.pdf');
  });

  it('uploads and deletes documents through their backend endpoints', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'doc-2',
          filename: 'notes.txt',
          status: 'processing',
          errorMessage: null,
          uploadedAt: '2026-03-19T12:00:00Z',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      } as Response);

    const wrapper = createWrapper();
    const upload = renderHook(() => useUploadDocument(), { wrapper });
    const remove = renderHook(() => useDeleteDocument(), { wrapper });
    const file = new File(['line one'], 'notes.txt', { type: 'text/plain' });

    await act(async () => {
      await upload.result.current.mutateAsync(file);
    });

    await waitFor(() => expect(upload.result.current.isSuccess).toBe(true));
    expect(String(fetchSpy.mock.calls[0]?.[0])).toMatch(/\/api\/documents\/upload$/);
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
    });
    expect(fetchSpy.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData);

    await act(async () => {
      await remove.result.current.mutateAsync('doc-2');
    });

    await waitFor(() => expect(remove.result.current.isSuccess).toBe(true));
    expect(String(fetchSpy.mock.calls[1]?.[0])).toMatch(/\/api\/documents\/doc-2$/);
    expect(fetchSpy.mock.calls[1]?.[1]).toEqual({ method: 'DELETE' });
  });
});
