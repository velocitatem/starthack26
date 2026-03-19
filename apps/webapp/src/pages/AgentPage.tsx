import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import AgentPanel from '@/components/AgentPanel';
import { isAgentRouteState } from '@/lib/agentNavigation';
import { type FacilityContext } from '@/types/facility';

export default function AgentPage() {
  const { devices } = useOutletContext<FacilityContext>();
  const location = useLocation();
  const navigate = useNavigate();
  const routeSeed = isAgentRouteState(location.state) ? location.state : null;

  return (
    <AgentPanel
      devices={devices}
      routeSeed={routeSeed}
      onRouteSeedConsumed={() => {
        navigate('/agent', { replace: true, state: null });
      }}
    />
  );
}
