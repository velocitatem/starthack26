import { useQuery } from '@tanstack/react-query';
import { type NodeFaultHistoryResponse } from '@/types/facility';
import { buildBackendUrl } from '@/lib/backend';

const fetchNodeFaultHistory = async (
  nodeId: string,
  limit: number,
): Promise<NodeFaultHistoryResponse> => {
  const response = await fetch(
    buildBackendUrl(`/api/nodes/${encodeURIComponent(nodeId)}/fault-history?limit=${limit}`),
    {
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch node fault history: ${response.status}`);
  }

  return response.json();
};

export const useNodeFaultHistory = (nodeId: string | null, limit = 25) => {
  return useQuery<NodeFaultHistoryResponse>({
    queryKey: ['node-fault-history', nodeId, limit],
    queryFn: () => fetchNodeFaultHistory(nodeId as string, limit),
    enabled: Boolean(nodeId),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
  });
};
