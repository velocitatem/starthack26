import { type AgentRouteState, type IssueAlertSelection } from '@/types/facility';

export const buildIssueResultPrompt = ({ device, fault }: IssueAlertSelection) => [
  `Please investigate this issue for ${device.name} (${device.id}) and propose a concrete solution.`,
  `Zone: ${device.zone}`,
  `Fault ID: ${fault.id}`,
  `Fault type: ${fault.type}`,
  `Severity: ${fault.severity}`,
  `Detected at: ${fault.detectedAt}`,
  `Diagnosis: ${fault.diagnosis}`,
  `Recommendation: ${fault.recommendation}`,
  `Estimated impact: ${fault.estimatedImpact}`,
  `Energy waste: ${fault.energyWaste}`,
  'Explain the likely next operational steps, and if on-site intervention or phone escalation is necessary, call the voice escalation tool.',
].join('\n');

export const buildAgentRouteStateForIssue = (selection: IssueAlertSelection): AgentRouteState => ({
  seedPrompt: buildIssueResultPrompt(selection),
  seedSource: 'issues-table',
  seedId: selection.fault.id,
  focusInput: true,
  autoSubmit: true,
});

export const isAgentRouteState = (value: unknown): value is AgentRouteState => {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<AgentRouteState>;
  return (
    typeof candidate.seedPrompt === 'string'
    && candidate.seedSource === 'issues-table'
    && typeof candidate.seedId === 'string'
    && typeof candidate.focusInput === 'boolean'
    && typeof candidate.autoSubmit === 'boolean'
  );
};
