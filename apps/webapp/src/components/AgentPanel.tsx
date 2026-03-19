import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, Clock3, FileText, Loader2, Plus, Send, ShieldAlert, Thermometer, Trash2, X, Zap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type AgentChatMessage, type AgentPendingAction, type AgentToolEvent, type Device, type TelemetryPoint } from '@/types/facility';
import { useAgentChat } from '@/hooks/useAgentChat';
import { useDeleteDocument, useDocumentsList, useUploadDocument } from '@/hooks/useBuildingDocuments';
import { useResolveFault } from '@/hooks/useFacilityData';

interface AgentPanelProps {
  devices: Device[];
  historyByNodeId?: Record<string, Record<string, TelemetryPoint[]>>;
}

interface ConversationMessage {
  id: string;
  role: AgentChatMessage['role'];
  content: string;
}

interface MentionContext {
  start: number;
  end: number;
  query: string;
}

interface ChatActionButton {
  key: string;
  label: string;
  prompt?: string;
  nodeId?: string;
  style?: 'neutral' | 'primary' | 'danger';
}

interface AlertItem {
  device: Device;
  fault: Device['faults'][number];
}

const severityWeight: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const severityBadge: Record<string, string> = {
  critical: 'bg-status-fault/15 text-status-fault border-status-fault/30',
  high: 'bg-status-warning/15 text-status-warning border-status-warning/30',
  medium: 'bg-status-warning/15 text-status-warning border-status-warning/30',
  low: 'bg-muted text-muted-foreground border-border',
};

const toPayloadMessages = (messages: ConversationMessage[]): AgentChatMessage[] =>
  messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

const nowId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const NODE_ID_PATTERN = /\b[A-Z]{3}-[A-Z]{3}-\d{3}\b/g;
const FAULT_ID_PATTERN = /\bfault-[a-z0-9-]+\b/gi;

const titleCase = (value: string) => value
  .split('_')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const formatTimestamp = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const MessageMarkdown = ({ content }: { content: string }) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
      ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>,
      ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>,
      li: ({ children }) => <li className="leading-relaxed">{children}</li>,
      code: ({ children }) => (
        <code className="rounded-sm bg-background/70 px-1 py-0.5 font-mono text-[12px]">{children}</code>
      ),
      pre: ({ children }) => (
        <pre className="mb-2 overflow-x-auto rounded-md border border-border bg-background/60 p-2 text-[12px] last:mb-0">
          {children}
        </pre>
      ),
      strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
    }}
  >
    {content}
  </ReactMarkdown>
);

const extractMentionContext = (value: string, caretPosition: number): MentionContext | null => {
  const beforeCaret = value.slice(0, caretPosition);
  const mentionStart = beforeCaret.lastIndexOf('@');
  if (mentionStart < 0) {
    return null;
  }

  const previousChar = mentionStart > 0 ? beforeCaret[mentionStart - 1] : ' ';
  if (previousChar.trim()) {
    return null;
  }

  const query = beforeCaret.slice(mentionStart + 1);
  if (/\s/.test(query)) {
    return null;
  }

  return {
    start: mentionStart,
    end: caretPosition,
    query,
  };
};

/* ------------------------------------------------------------------ */
/*  Faults Tab                                                         */
/* ------------------------------------------------------------------ */

function FaultsTabContent({ devices, selectedNodeId }: { devices: Device[]; selectedNodeId: string | null }) {
  const { mutate: resolve, pendingFaultId } = useResolveFault();

  const alerts: AlertItem[] = useMemo(
    () =>
      devices
        .filter((d) => !selectedNodeId || d.id === selectedNodeId)
        .flatMap((device) => device.faults.map((fault) => ({ device, fault })))
        .sort((a, b) => severityWeight[a.fault.severity] - severityWeight[b.fault.severity]),
    [devices, selectedNodeId],
  );

  if (alerts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center py-6">
        <div className="text-center">
          <div className="text-[13px] text-muted-foreground">No active faults detected.</div>
          <div className="text-[11px] text-muted-foreground mt-1">All monitored nodes are operating within normal parameters.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {alerts.map((alert) => {
        const isPending = pendingFaultId === alert.fault.id;
        return (
          <div
            key={alert.fault.id}
            className={`border border-border bg-card p-3 fault-card-accent ${isPending ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[13px] font-medium text-foreground truncate">{alert.fault.type}</span>
                  <span
                    className={`inline-block px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-medium border ${severityBadge[alert.fault.severity]}`}
                  >
                    {alert.fault.severity}
                  </span>
                </div>
                <div className="text-[12px] font-display text-muted-foreground">{alert.device.id} - {alert.device.name}</div>
                <div className="text-[11px] text-muted-foreground mt-1">{alert.fault.diagnosis}</div>
                <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Zap size={10} />
                    {alert.fault.energyWaste}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock3 size={10} />
                    {formatTimestamp(alert.fault.detectedAt)}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                <button
                  disabled={isPending}
                  onClick={() => resolve(alert.fault.id)}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50"
                >
                  {isPending ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                  {isPending ? 'Resolving' : 'Resolve'}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Telemetry Tab                                                      */
/* ------------------------------------------------------------------ */

const CHANNEL_COLORS: Record<string, string> = {
  torque: 'hsl(var(--brand))',
  position: 'hsl(var(--status-warning))',
  temperature: 'hsl(var(--status-healthy))',
};

const formatAxisTime = (time: string) => {
  const d = new Date(time);
  return Number.isNaN(d.getTime()) ? time : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

function TelemetryChart({ channel }: { channel: { key: string; label: string; data: TelemetryPoint[]; color: string } }) {
  const chartConfig: ChartConfig = { [channel.key]: { label: channel.label, color: channel.color } };
  const chartData = channel.data.map((p) => ({ time: p.time, [channel.key]: p.value }));
  const values = channel.data.map((p) => p.value);
  const [min, max] = values.length ? [Math.min(...values), Math.max(...values)] : [0, 1];
  const pad = (max - min) * 0.1 || 1;

  return (
    <ChartContainer config={chartConfig} className="!aspect-auto h-[250px] w-full">
      <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id={`fill-${channel.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={channel.color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={channel.color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="time" tickFormatter={formatAxisTime} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} />
        <YAxis domain={[min - pad, max + pad]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => v.toFixed(1)} />
        <ChartTooltip
          content={<ChartTooltipContent labelFormatter={(v) => formatAxisTime(v as string)} indicator="line" />}
        />
        <Area
          type="monotone"
          dataKey={channel.key}
          stroke={channel.color}
          strokeWidth={1.5}
          fill={`url(#fill-${channel.key})`}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 1 }}
        />
      </AreaChart>
    </ChartContainer>
  );
}

function TelemetryTabContent({
  devices,
  historyByNodeId,
  selectedNodeId,
}: {
  devices: Device[];
  historyByNodeId: Record<string, Record<string, TelemetryPoint[]>>;
  selectedNodeId: string | null;
}) {
  const selectedDevice = devices.find((d) => d.id === selectedNodeId);
  const nodeHistory = selectedNodeId ? historyByNodeId[selectedNodeId] : undefined;

  const telemetryChannels = useMemo(() => {
    if (nodeHistory) {
      return Object.entries(nodeHistory).map(([key, data]) => ({
        key,
        label: titleCase(key),
        data,
        color: CHANNEL_COLORS[key] ?? 'hsl(var(--brand))',
      }));
    }
    if (!selectedDevice) return [];
    return (['torque', 'position', 'temperature'] as const)
      .filter((k) => selectedDevice[k].length > 0)
      .map((k) => ({
        key: k,
        label: titleCase(k),
        data: selectedDevice[k],
        color: CHANNEL_COLORS[k],
      }));
  }, [nodeHistory, selectedDevice]);

  const latestValue = (data: TelemetryPoint[]) => data.length ? data[data.length - 1].value.toFixed(1) : '-';

  return (
    <div className="space-y-4">
      {selectedDevice && (
        <div className="border border-border bg-card p-3">
          <div className="flex items-center gap-3">
            <div className="text-[13px] font-medium text-foreground">{selectedDevice.name}</div>
            <span className={`px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-medium ${
              selectedDevice.status === 'fault' ? 'bg-status-fault/15 text-status-fault'
                : selectedDevice.status === 'warning' ? 'bg-status-warning/15 text-status-warning'
                : 'bg-status-healthy/15 text-status-healthy'
            }`}>
              {selectedDevice.status}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {selectedDevice.type} - {selectedDevice.zone} - Anomaly score: {(selectedDevice.anomalyScore * 100).toFixed(0)}%
          </div>
        </div>
      )}

      {telemetryChannels.length === 0 ? (
        <div className="text-[12px] text-muted-foreground">No telemetry data available for this node.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {telemetryChannels.map((channel) => (
            <div key={channel.key} className="border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Thermometer size={12} className="text-muted-foreground" />
                  <span className="label-caps">{channel.label}</span>
                </div>
                <span className="font-display text-sm text-foreground">{latestValue(channel.data)}</span>
              </div>
              <TelemetryChart channel={channel} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main AgentPanel                                                    */
/* ------------------------------------------------------------------ */

export default function AgentPanel({ devices, historyByNodeId = {} }: AgentPanelProps) {
  const agentChat = useAgentChat();
  const inputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const documentsQuery = useDocumentsList();
  const uploadDocumentMutation = useUploadDocument();
  const deleteDocumentMutation = useDeleteDocument();

  const [activeTab, setActiveTab] = useState('chat');
  const [messages, setMessages] = useState<ConversationMessage[]>([
    {
      id: nowId(),
      role: 'assistant',
      content:
        'I can investigate faults, explain likely root cause, and execute platform actions after your approval.',
    },
  ]);
  const [input, setInput] = useState('');
  const [caretPosition, setCaretPosition] = useState(0);
  const [mentionCursor, setMentionCursor] = useState(0);
  const [historyNodeId, setHistoryNodeId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<AgentPendingAction | null>(null);
  const [latestToolEvents, setLatestToolEvents] = useState<AgentToolEvent[]>([]);

  const topFault = useMemo(() => {
    const faultEntries = devices
      .flatMap((device) =>
        device.faults.map((fault) => ({
          device,
          fault,
        })),
      )
      .sort((a, b) => severityWeight[a.fault.severity] - severityWeight[b.fault.severity]);
    return faultEntries[0] ?? null;
  }, [devices]);

  const activeFaultCount = useMemo(
    () => devices.reduce((sum, d) => sum + d.faults.length, 0),
    [devices],
  );

  const nodeSuggestions = useMemo(() => {
    const unique = new Map<string, { id: string; name: string; status: Device['status'] }>();
    for (const device of devices) {
      unique.set(device.id, {
        id: device.id,
        name: device.name,
        status: device.status,
      });
    }
    return Array.from(unique.values()).sort((a, b) => a.id.localeCompare(b.id));
  }, [devices]);

  useEffect(() => {
    if (historyNodeId) {
      return;
    }

    if (topFault?.device.id) {
      setHistoryNodeId(topFault.device.id);
      return;
    }

    if (nodeSuggestions[0]?.id) {
      setHistoryNodeId(nodeSuggestions[0].id);
    }
  }, [historyNodeId, nodeSuggestions, topFault]);

  const quickPrompts = useMemo(() => {
    const prompts = ['Give me a live system overview and top active faults.'];

    if (topFault) {
      prompts.push(`Why is node ${topFault.device.id} reporting ${topFault.fault.type}?`);
      prompts.push(`Show fault history for node ${topFault.device.id}.`);
      prompts.push(`Run node diagnosis for ${topFault.device.id} now.`);
      prompts.push(`Resolve fault ${topFault.fault.id} with note "validated during demo".`);
    }

    return prompts;
  }, [topFault]);

  const mentionContext = useMemo(
    () => extractMentionContext(input, caretPosition),
    [input, caretPosition],
  );

  const mentionSuggestions = useMemo(() => {
    if (!mentionContext) {
      return [];
    }

    const query = mentionContext.query.trim().toUpperCase();
    const scored = nodeSuggestions
      .filter((node) => {
        if (!query) {
          return true;
        }
        const id = node.id.toUpperCase();
        const name = node.name.toUpperCase();
        return id.includes(query) || name.includes(query);
      })
      .sort((a, b) => {
        const aStarts = a.id.toUpperCase().startsWith(query);
        const bStarts = b.id.toUpperCase().startsWith(query);
        if (aStarts !== bStarts) {
          return aStarts ? -1 : 1;
        }
        return a.id.localeCompare(b.id);
      });

    return scored.slice(0, 6);
  }, [mentionContext, nodeSuggestions]);

  useEffect(() => {
    setMentionCursor(0);
  }, [mentionContext?.start, mentionContext?.query]);

  useEffect(() => {
    if (!chatScrollRef.current) {
      return;
    }

    const container = chatScrollRef.current;
    requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      });
    });
  }, [messages, agentChat.isPending, pendingAction?.id]);

  const knownNodeIds = useMemo(
    () => new Set(nodeSuggestions.map((node) => node.id)),
    [nodeSuggestions],
  );

  const buildMessageActions = (content: string): ChatActionButton[] => {
    const nodeMatches = Array.from(new Set((content.match(NODE_ID_PATTERN) ?? []).filter((id) => knownNodeIds.has(id))));
    const faultMatches = Array.from(new Set((content.match(FAULT_ID_PATTERN) ?? []).map((id) => id.toLowerCase())));

    const actions: ChatActionButton[] = [];

    for (const nodeId of nodeMatches.slice(0, 1)) {
      actions.push({
        key: `focus-${nodeId}`,
        label: `View ${nodeId} timeline`,
        nodeId,
        style: 'neutral',
      });
      actions.push({
        key: `diagnose-${nodeId}`,
        label: `Run diagnosis ${nodeId}`,
        prompt: `Run node diagnosis for ${nodeId} now and summarize likely root cause.`,
        nodeId,
        style: 'primary',
      });
      actions.push({
        key: `history-${nodeId}`,
        label: `History ${nodeId}`,
        prompt: `Show fault history for node ${nodeId}.`,
        nodeId,
        style: 'neutral',
      });
    }

    for (const faultId of faultMatches.slice(0, 1)) {
      actions.push({
        key: `resolve-${faultId}`,
        label: `Resolve ${faultId}`,
        prompt: `Resolve fault ${faultId} with note "resolved from inline chat action".`,
        style: 'danger',
      });
    }

    return actions;
  };

  const runMessageAction = (action: ChatActionButton) => {
    if (action.nodeId) {
      setHistoryNodeId(action.nodeId);
      if (!action.prompt) {
        setActiveTab('telemetry');
      }
    }

    if (action.prompt) {
      sendPrompt(action.prompt);
    }
  };

  const applyMention = (nodeId: string) => {
    if (!mentionContext) {
      return;
    }

    const trailing = input.slice(mentionContext.end);
    const needsTrailingSpace = trailing.length === 0 || !trailing.startsWith(' ');
    const inserted = `${input.slice(0, mentionContext.start + 1)}${nodeId}${needsTrailingSpace ? ' ' : ''}${trailing}`;
    const nextCaret = mentionContext.start + 1 + nodeId.length + (needsTrailingSpace ? 1 : 0);

    setInput(inserted);
    setCaretPosition(nextCaret);

    requestAnimationFrame(() => {
      if (!inputRef.current) {
        return;
      }
      inputRef.current.focus();
      inputRef.current.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const sendPrompt = (text: string) => {
    const prompt = text.trim();
    if (!prompt || agentChat.isPending) {
      return;
    }

    // Switch to chat tab when sending a message
    setActiveTab('chat');

    const userMessage: ConversationMessage = {
      id: nowId(),
      role: 'user',
      content: prompt,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setCaretPosition(0);
    setPendingAction(null);

    agentChat.mutate(
      {
        messages: toPayloadMessages(nextMessages),
        actor: 'facility-manager',
      },
      {
        onSuccess: (response) => {
          setMessages((current) => [
            ...current,
            {
              id: nowId(),
              role: 'assistant',
              content: response.reply,
            },
          ]);
          setPendingAction(response.pendingAction);
          setLatestToolEvents(response.toolEvents);
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : 'Unknown error';
          setMessages((current) => [
            ...current,
            {
              id: nowId(),
              role: 'assistant',
              content: `I could not reach the backend agent (${message}).`,
            },
          ]);
          setPendingAction(null);
          setLatestToolEvents([]);
        },
      },
    );
  };

  const decidePendingAction = (decision: 'approve' | 'reject') => {
    if (!pendingAction || agentChat.isPending) {
      return;
    }

    agentChat.mutate(
      {
        messages: toPayloadMessages(messages),
        actor: 'facility-manager',
        pendingActionId: pendingAction.id,
        pendingActionDecision: decision,
      },
      {
        onSuccess: (response) => {
          setMessages((current) => [
            ...current,
            {
              id: nowId(),
              role: 'assistant',
              content: response.reply,
            },
          ]);
          setPendingAction(response.pendingAction);
          setLatestToolEvents(response.toolEvents);
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : 'Unknown error';
          setMessages((current) => [
            ...current,
            {
              id: nowId(),
              role: 'assistant',
              content: `Action decision failed (${message}).`,
            },
          ]);
        },
      },
    );
  };

  const handleDocumentSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.currentTarget.value = '';

    if (!file || uploadDocumentMutation.isPending) {
      return;
    }

    uploadDocumentMutation.mutate(file);
  };

  const documents = documentsQuery.data ?? [];
  const pendingUploadName = uploadDocumentMutation.isPending
    ? uploadDocumentMutation.variables?.name ?? 'Uploading document'
    : null;

  return (
    <div className="flex-1 relative flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center justify-between gap-4 px-6 py-4">
          <div>
            <h1 className="font-display text-sm tracking-tight">Operations Agent</h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {topFault ? `${topFault.device.id} - ${topFault.device.name}` : 'Diagnosis, fault history, and approved actions.'}
            </p>
          </div>
          <select
            value={historyNodeId ?? ''}
            onChange={(e) => setHistoryNodeId(e.target.value || null)}
            className="h-8 min-w-[200px] border border-border bg-background px-2 text-[12px] outline-none shrink-0"
          >
            {nodeSuggestions.map((node) => (
              <option key={node.id} value={node.id}>{node.id} - {node.name}</option>
            ))}
          </select>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="px-6">
            <TabsList>
              <TabsTrigger value="chat">Chat</TabsTrigger>
              <TabsTrigger value="faults" className="inline-flex items-center gap-1.5">
                Faults
                {activeFaultCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-medium bg-status-fault/15 text-status-fault rounded-sm">
                    {activeFaultCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="telemetry">Telemetry</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="chat" className="mt-4">
            <div className="container max-w-3xl space-y-4 pb-24">
              <div className="flex flex-wrap gap-2">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendPrompt(prompt)}
                    disabled={agentChat.isPending}
                    className="border border-border bg-card px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              <div ref={chatScrollRef} className="space-y-3">
                {messages.map((message) => (
                  <div key={message.id} className={`flex w-full ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`w-fit max-w-[78%] rounded-md px-3 py-2 text-[13px] ${
                        message.role === 'user'
                          ? 'bg-secondary text-secondary-foreground'
                          : 'bg-muted text-foreground'
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {message.role === 'assistant' ? <Bot size={11} /> : <Send size={11} />}
                        {message.role}
                      </div>
                      <MessageMarkdown content={message.content} />

                      {message.role === 'assistant' && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {buildMessageActions(message.content).map((action) => (
                            <button
                              key={`${message.id}-${action.key}`}
                              type="button"
                              disabled={agentChat.isPending}
                              onClick={() => runMessageAction(action)}
                              className={`border px-2 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                                action.style === 'primary'
                                  ? 'border-foreground/30 bg-foreground/5 text-foreground hover:border-foreground/60'
                                  : action.style === 'danger'
                                    ? 'border-status-fault/40 bg-status-fault/10 text-status-fault hover:border-status-fault/70'
                                    : 'border-border bg-card text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {agentChat.isPending && (
                  <div className="inline-flex items-center gap-2 px-3 py-2 text-[12px] bg-muted text-muted-foreground">
                    <Loader2 size={13} className="animate-spin" />
                    Agent working...
                  </div>
                )}
              </div>

              {latestToolEvents.length > 0 && (
                <div className="border border-border bg-card p-3">
                  <div className="label-caps mb-2">Latest tool activity</div>
                  <div className="space-y-1.5">
                    {latestToolEvents.map((event, index) => (
                      <div key={`${event.name}-${index}`} className="text-[12px] text-muted-foreground">
                        <span className="font-medium text-foreground">{event.name}</span>
                        <span className="mx-1">-</span>
                        <span className="capitalize">{event.outcome.replace('_', ' ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {pendingAction && (
                <div className="border border-status-warning/40 bg-status-warning/10 p-3">
                  <div className="flex items-center gap-2 text-status-warning text-[12px] uppercase tracking-wider font-medium">
                    <ShieldAlert size={14} />
                    Approval required
                  </div>
                  <div className="mt-1 text-[13px] text-foreground">{pendingAction.summary}</div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => decidePendingAction('approve')}
                      disabled={agentChat.isPending}
                      className="inline-flex items-center gap-1.5 border border-status-healthy/40 bg-status-healthy/15 px-3 py-1.5 text-[12px] text-status-healthy disabled:opacity-50"
                    >
                      <Check size={12} />
                      Approve
                    </button>
                    <button
                      onClick={() => decidePendingAction('reject')}
                      disabled={agentChat.isPending}
                      className="inline-flex items-center gap-1.5 border border-status-fault/40 bg-status-fault/15 px-3 py-1.5 text-[12px] text-status-fault disabled:opacity-50"
                    >
                      <X size={12} />
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="faults" className="mt-4 px-6">
            <FaultsTabContent devices={devices} selectedNodeId={historyNodeId} />
          </TabsContent>

          <TabsContent value="telemetry" className="mt-4 px-6">
            <TelemetryTabContent
              devices={devices}
              historyByNodeId={historyByNodeId}
              selectedNodeId={historyNodeId}
            />
          </TabsContent>
        </Tabs>
      </div>

      {activeTab === 'chat' && (
        <div className="shrink-0 bg-background pb-4 pt-2 px-6">
          <div className="container max-w-3xl">
            <input
              ref={documentInputRef}
              type="file"
              accept=".pdf,.txt,.md"
              onChange={handleDocumentSelect}
              className="hidden"
            />

            {(documentsQuery.error instanceof Error
              || uploadDocumentMutation.error instanceof Error
              || documents.length > 0
              || Boolean(pendingUploadName)
              || documentsQuery.isLoading) && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {documentsQuery.isLoading && documents.length === 0 && (
                  <div className="text-[11px] text-muted-foreground">Loading documents...</div>
                )}

                {pendingUploadName && (
                  <div className="inline-flex max-w-full items-center gap-1.5 border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground">
                    <Loader2 size={11} className="animate-spin" />
                    <span className="truncate">Uploading {pendingUploadName}</span>
                  </div>
                )}

                {documents.map((document) => (
                  <div
                    key={document.id}
                    className="inline-flex max-w-full items-center gap-2 border border-border bg-card px-2.5 py-1 text-[11px]"
                  >
                    {document.status === 'processing' ? (
                      <Loader2 size={11} className="animate-spin text-muted-foreground" />
                    ) : (
                      <FileText size={11} className="text-muted-foreground" />
                    )}
                    <span className="max-w-[180px] truncate text-foreground">{document.filename}</span>
                    {document.status === 'processing' && (
                      <span className="uppercase tracking-wider text-muted-foreground">
                        processing
                      </span>
                    )}
                    {document.status === 'error' && (
                      <span className="text-status-fault">
                        {document.errorMessage ?? 'processing failed'}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteDocumentMutation.mutate(document.id)}
                      disabled={deleteDocumentMutation.isPending}
                      className="text-status-fault disabled:opacity-50"
                      aria-label={`Delete ${document.filename}`}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}

                {uploadDocumentMutation.error instanceof Error && (
                  <div className="text-[11px] text-status-fault">
                    Upload failed ({uploadDocumentMutation.error.message})
                  </div>
                )}

                {documentsQuery.error instanceof Error && (
                  <div className="text-[11px] text-status-fault">
                    Could not load documents ({documentsQuery.error.message})
                  </div>
                )}
              </div>
            )}

            <div className="border border-border bg-card px-4 py-3">
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  sendPrompt(input);
                }}
              >
                <button
                  type="button"
                  onClick={() => documentInputRef.current?.click()}
                  disabled={uploadDocumentMutation.isPending}
                  className="inline-flex h-8 items-center justify-center border border-border px-3 text-[12px] hover:border-foreground transition-colors disabled:opacity-50"
                  aria-label="Upload building document"
                  title="Upload building document"
                >
                  <Plus size={12} />
                </button>
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(event) => {
                    setInput(event.target.value);
                    setCaretPosition(event.target.selectionStart ?? event.target.value.length);
                  }}
                  onClick={(event) => {
                    setCaretPosition(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
                  }}
                  onKeyUp={(event) => {
                    setCaretPosition(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
                  }}
                  onKeyDown={(event) => {
                    if (!mentionSuggestions.length) return;
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      setMentionCursor((current) => (current + 1) % mentionSuggestions.length);
                      return;
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      setMentionCursor((current) =>
                        current === 0 ? mentionSuggestions.length - 1 : current - 1,
                      );
                      return;
                    }
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      const selected = mentionSuggestions[mentionCursor] ?? mentionSuggestions[0];
                      if (selected) {
                        applyMention(selected.id);
                      }
                    }
                  }}
                  className="flex-1 bg-transparent text-[13px] outline-none"
                  placeholder="Ask why a fault happened, request history, or ask to run an action"
                />
                <button
                  type="submit"
                  disabled={agentChat.isPending || !input.trim()}
                  className="inline-flex h-8 items-center gap-1.5 border border-border px-3 text-[12px] hover:border-foreground transition-colors disabled:opacity-50"
                >
                  <Send size={12} />
                  Send
                </button>
              </form>

              {mentionSuggestions.length > 0 && (
                <div className="mt-2 border border-border bg-background p-2">
                  <div className="label-caps mb-1">Node mentions</div>
                  <div className="space-y-1">
                    {mentionSuggestions.map((node, index) => (
                      <button
                        key={node.id}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          applyMention(node.id);
                        }}
                        className={`w-full text-left px-2 py-1 text-[12px] transition-colors ${
                          mentionCursor === index ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        <span className="font-medium text-foreground">@{node.id}</span>
                        <span className="mx-2">-</span>
                        <span>{node.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
