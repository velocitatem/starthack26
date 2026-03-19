import { useNavigate, useOutletContext } from 'react-router-dom';
import AlertDashboard from '@/components/AlertDashboard';
import { buildAgentRouteStateForIssue } from '@/lib/agentNavigation';
import { type FacilityContext } from '@/types/facility';

export default function IssuesPage() {
  const { devices } = useOutletContext<FacilityContext>();
  const navigate = useNavigate();

  return (
    <AlertDashboard
      devices={devices}
      onNavigateToDevice={(device) => navigate(`/issues/${device.id}`)}
      onOpenIssueResult={(selection) => navigate('/agent', { state: buildAgentRouteStateForIssue(selection) })}
    />
  );
}
