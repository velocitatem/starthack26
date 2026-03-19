import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FacilityStatusResponse } from '@/types/facility';
import { buildBackendUrl } from '@/lib/backend';

const fetchFacilityStatus = async (): Promise<FacilityStatusResponse> => {
  const response = await fetch(buildBackendUrl('/api/status'), {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch facility status: ${response.status}`);
  }

  return response.json();
};

export const useFacilityData = () => {
  const query = useQuery<FacilityStatusResponse>({
    queryKey: ['facility-status'],
    queryFn: fetchFacilityStatus,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  const data = query.data;

  return {
    ...query,
    ahuUnits: data?.catalog.ahuUnits ?? [],
    buildingStats: data?.derived.buildingStats ?? null,
    devices: data?.derived.devices ?? [],
    nodePositions: data?.derived.nodePositions ?? {},
    generatedAt: data?.generatedAt ?? null,
    catalog: data?.catalog ?? null,
    historyByNodeId: data?.historyByNodeId ?? {},
    meta: data?.meta ?? null,
  };
};

export const useResolveFault = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (faultId: string) =>
      fetch(buildBackendUrl(`/api/faults/${encodeURIComponent(faultId)}/resolve`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolvedBy: 'operator' }),
      }).then(r => {
        if (!r.ok) {
          throw new Error(`Failed to resolve fault: ${r.status}`);
        }

        return r.json();
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['facility-status'] }),
        queryClient.invalidateQueries({ queryKey: ['node-fault-history'] }),
      ]);
    },
  });

  return {
    ...mutation,
    /** The fault id currently being resolved, or null when idle. */
    pendingFaultId: mutation.isPending ? (mutation.variables ?? null) : null,
  };
};
