import { useOutletContext } from 'react-router-dom';
import AlertDashboard from '@/components/AlertDashboard';
import { type FacilityContext } from '@/types/facility';

export default function IssuesPage() {
  const { devices } = useOutletContext<FacilityContext>();
  return <AlertDashboard devices={devices} />;
}
