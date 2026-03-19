import { useMutation } from '@tanstack/react-query';
import { type MlFailureModeResponse } from '@/types/facility';
import { buildBackendUrl } from '@/lib/backend';

const fetchMlFailureMode = async (nodeId: string): Promise<MlFailureModeResponse> => {
  const response = await fetch(buildBackendUrl('/api/ml/failure-mode'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ML failure mode: ${response.status}`);
  }

  return response.json();
};

export const useMlFailureMode = () => {
  return useMutation<MlFailureModeResponse, Error, string>({
    mutationFn: fetchMlFailureMode,
  });
};
