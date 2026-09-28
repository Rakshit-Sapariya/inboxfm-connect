import type { CreateConnectSessionRequestContract, CreateConnectSessionResponseContract } from './generated/connect-session'
import type { ConnectionContract, ConnectionsPageContract, ListConnectionsQueryContract } from './generated/connections'
import type { ServerErrorCodeContract } from './generated/error-code'
import type { ExecuteRequestContract } from './generated/execute'
import type { ToolContract, ToolInputContract } from './generated/tools'

export type { CreateConnectSessionRequestContract, CreateConnectSessionResponseContract, ConnectionsPageContract, ExecuteRequestContract, ListConnectionsQueryContract, ServerErrorCodeContract, ToolContract, ToolInputContract }

export type Connection = Omit<ConnectionContract, 'platformId' | 'ownerId' | 'owner'>

export type ConnectionsPage = Omit<ConnectionsPageContract, 'data'> & {
    data: Connection[]
}

export type ToolInput = ToolInputContract & {
    name: string
}

export type Tool = ToolContract & {
    inputs: ToolInput[]
}

/**
 * The subset of `GET /v1/integrations/:name` the SDK reads. The endpoint returns the
 * integration's full metadata (triggers, auth definition, builder-only property
 * details); everything outside `actions` is ignored.
 */
export type IntegrationToolsResponse = {
    actions: Record<string, ToolContract & { props: Record<string, ToolInputContract> }>
}

export type CreateMcpTokenRequestContract = {
    projectId: string
    externalUserId: string
    allowedPieceNames?: string[]
    expiresInSeconds?: number
}

export type CreateMcpTokenResponseContract = {
    token: string
    mcpServerUrl: string
    expiresAt: string
    projectId: string
    externalUserId: string
    allowedPieceNames: string[] | null
}
