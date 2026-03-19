import { useOutletContext } from 'react-router-dom';
import AgentPanel from '@/components/AgentPanel';
import { type FacilityContext } from '@/types/facility';

export default function AgentPage() {
  const { devices } = useOutletContext<FacilityContext>();
  return <AgentPanel devices={devices} />;
}
