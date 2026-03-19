import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { buildBackendUrl } from '@/lib/backend';
import { type BuildingDocumentListItem } from '@/types/facility';

const DOCUMENTS_QUERY_KEY = ['building-documents'];

const readErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = await response.json();
    if (typeof payload?.detail === 'string' && payload.detail.trim()) {
      return payload.detail;
    }
  } catch {
    // Ignore non-JSON error bodies and fall back to the generic message.
  }
  return fallback;
};

const fetchDocuments = async (): Promise<BuildingDocumentListItem[]> => {
  const response = await fetch(buildBackendUrl('/api/documents'), {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to fetch building documents: ${response.status}`),
    );
  }

  return response.json();
};

const uploadDocument = async (file: File): Promise<BuildingDocumentListItem> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(buildBackendUrl('/api/documents/upload'), {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to upload document: ${response.status}`),
    );
  }

  return response.json();
};

const deleteDocument = async (documentId: string): Promise<{ ok: boolean }> => {
  const response = await fetch(buildBackendUrl(`/api/documents/${encodeURIComponent(documentId)}`), {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to delete document: ${response.status}`),
    );
  }

  return response.json();
};

export const useDocumentsList = () =>
  useQuery<BuildingDocumentListItem[]>({
    queryKey: DOCUMENTS_QUERY_KEY,
    queryFn: fetchDocuments,
    refetchInterval: query =>
      query.state.data?.some((document) => document.status === 'processing') ? 2000 : false,
    refetchIntervalInBackground: true,
  });

export const useUploadDocument = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: uploadDocument,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DOCUMENTS_QUERY_KEY });
    },
  });
};

export const useDeleteDocument = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteDocument,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DOCUMENTS_QUERY_KEY });
    },
  });
};
