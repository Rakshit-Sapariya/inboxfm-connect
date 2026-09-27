import {
  Activity,
  Blocks,
  Bot,
  CalendarClock,
  Code2,
  KeyRound,
  LayoutGrid,
  Radio,
  Settings,
  Zap,
} from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  useConnectionsQuery,
  useExecutionsQuery,
  useIntegrations,
  useScheduledTasksQuery,
  useTriggerBindingsQuery,
} from '@/lib/query/hooks'

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate()

  const { data: connectionsData } = useConnectionsQuery(
    { limit: 100 },
    { enabled: open, showErrorToast: false }
  )
  const { data: triggerBindings } = useTriggerBindingsQuery({
    enabled: open,
    showErrorToast: false,
  })
  const { data: scheduledTasks } = useScheduledTasksQuery({
    enabled: open,
    showErrorToast: false,
  })
  const { data: executionsData } = useExecutionsQuery(
    { limit: 20 },
    { enabled: open, showErrorToast: false }
  )
  const { data: integrationsData } = useIntegrations(
    undefined,
    { enabled: open }
  )

  const connections = connectionsData?.data
  const executions = executionsData?.data
  const integrations = integrationsData?.data

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [open, onOpenChange])

  const runCommand = React.useCallback(
    (command: () => unknown) => {
      onOpenChange(false)
      command()
    },
    [onOpenChange]
  )

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search resources, integrations, routes..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {connections && connections.length > 0 && (
          <CommandGroup heading="Connections">
            {connections.map((c) => (
              <CommandItem
                key={`conn-${c.id}`}
                value={`${c.displayName} ${c.pieceName} ${c.status} ${c.id}`}
                keywords={[c.displayName, c.pieceName, c.status, c.id]}
                onSelect={() => runCommand(() => navigate(`/connections/${c.id}`))}
                className="cursor-pointer"
              >
                <KeyRound className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex flex-1 items-center justify-between overflow-hidden">
                  <span className="truncate font-medium">{c.displayName}</span>
                  <span className="ml-2 truncate text-xs text-muted-foreground">{c.pieceName}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {triggerBindings && triggerBindings.length > 0 && (
          <CommandGroup heading="Trigger Bindings">
            {triggerBindings.map((b) => (
              <CommandItem
                key={`trigger-${b.id}`}
                value={`${b.triggerName} ${b.pieceName} ${b.promptTemplate || ''} ${b.id}`}
                keywords={[b.triggerName, b.pieceName, b.status, b.id, b.promptTemplate || '']}
                onSelect={() => runCommand(() => navigate(`/automations/triggers/${b.id}`))}
                className="cursor-pointer"
              >
                <Radio className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex flex-1 items-center justify-between overflow-hidden">
                  <span className="truncate font-medium">{b.triggerName}</span>
                  <span className="ml-2 truncate text-xs text-muted-foreground">{b.pieceName}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {scheduledTasks && scheduledTasks.length > 0 && (
          <CommandGroup heading="Scheduled Tasks">
            {scheduledTasks.map((s) => (
              <CommandItem
                key={`sched-${s.id}`}
                value={`${s.prompt} ${s.cronExpression} ${s.timezone} ${s.id}`}
                keywords={[s.prompt, s.cronExpression, s.timezone, s.status, s.id]}
                onSelect={() => runCommand(() => navigate(`/automations/schedules/${s.id}`))}
                className="cursor-pointer"
              >
                <CalendarClock className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex flex-1 items-center justify-between overflow-hidden">
                  <span className="truncate font-medium">{s.prompt}</span>
                  <span className="ml-2 shrink-0 font-mono text-xs text-muted-foreground">
                    {s.cronExpression}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {executions && executions.length > 0 && (
          <CommandGroup heading="Recent Executions">
            {executions.map((e) => (
              <CommandItem
                key={`exec-${e.id}`}
                value={`${e.prompt || `Execution ${e.id}`} ${e.status} ${e.id}`}
                keywords={[e.prompt || '', e.status, e.id]}
                onSelect={() => runCommand(() => navigate(`/activity/${e.id}`))}
                className="cursor-pointer"
              >
                <Activity className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex flex-1 items-center justify-between overflow-hidden">
                  <span className="truncate font-medium">
                    {e.prompt || `Execution ${e.id.slice(0, 8)}...`}
                  </span>
                  <span className="ml-2 shrink-0 text-xs capitalize text-muted-foreground">
                    {e.status.toLowerCase()}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {integrations && integrations.length > 0 && (
          <CommandGroup heading="Integrations">
            {integrations.map((p) => (
              <CommandItem
                key={`integ-${p.name}`}
                value={`${p.displayName} ${p.name} ${p.description || ''}`}
                keywords={[p.displayName, p.name, ...(p.categories || [])]}
                onSelect={() =>
                  runCommand(() => navigate(`/integrations/${encodeURIComponent(p.name)}`))
                }
                className="cursor-pointer"
              >
                <Blocks className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex flex-1 items-center justify-between overflow-hidden">
                  <span className="truncate font-medium">{p.displayName}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">v{p.version}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />

        <CommandGroup heading="Navigation">
          <CommandItem
            onSelect={() => runCommand(() => navigate('/'))}
            className="cursor-pointer"
          >
            <LayoutGrid className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Overview Dashboard</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate('/integrations'))}
            className="cursor-pointer"
          >
            <Blocks className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Integrations Catalog</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate('/connections'))}
            className="cursor-pointer"
          >
            <KeyRound className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Connections & Credentials</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate('/actions'))}
            className="cursor-pointer"
          >
            <Zap className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Actions & Tool Discovery</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate('/triggers'))}
            className="cursor-pointer"
          >
            <Radio className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Triggers & Event Capabilities</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate('/automations/triggers'))}
            className="cursor-pointer"
          >
            <Radio className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Trigger Bindings</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate('/automations/schedules'))}
            className="cursor-pointer"
          >
            <CalendarClock className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Scheduled Tasks</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate('/mcp'))}
            className="cursor-pointer"
          >
            <Bot className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>MCP Server & Tools</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Monitoring & Platform">
          <CommandItem
            onSelect={() => runCommand(() => navigate('/activity'))}
            className="cursor-pointer"
          >
            <Activity className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Activity & Execution Logs</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate('/developers'))}
            className="cursor-pointer"
          >
            <Code2 className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Developer SDK & API Reference</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate('/settings'))}
            className="cursor-pointer"
          >
            <Settings className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Project Settings</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
