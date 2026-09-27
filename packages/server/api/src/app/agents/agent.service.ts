import { apId, isNil } from '@inboxfm-connect/core-utils'
import { Agent, AgentOutputField, AgentTool } from '@inboxfm-connect/shared'
import { repoFactory } from '../core/db/repo-factory'
import { AgentEntity, AgentSchema } from './agent.entity'

const agentRepo = repoFactory<AgentSchema>(AgentEntity)

export const agentService = {
    async create(params: {
        id?: string
        projectId: string
        platformId: string
        externalId: string
        displayName: string
        description?: string | null
        prompt: string
        maxSteps?: number
        model: { provider: string, model: string }
        tools?: AgentTool[]
        structuredOutput?: AgentOutputField[] | null
        status?: 'ENABLED' | 'DISABLED'
    }): Promise<Agent> {
        const id = params.id ?? apId()
        const newAgent: Agent = {
            id,
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            projectId: params.projectId,
            platformId: params.platformId,
            externalId: params.externalId,
            displayName: params.displayName,
            description: params.description ?? null,
            prompt: params.prompt,
            maxSteps: params.maxSteps ?? 10,
            model: params.model,
            tools: params.tools ?? [],
            structuredOutput: params.structuredOutput ?? null,
            status: params.status ?? 'ENABLED',
        }

        return agentRepo().save(newAgent)
    },

    async update(params: {
        id: string
        projectId: string
        platformId: string
        externalId?: string
        displayName?: string
        description?: string | null
        prompt?: string
        maxSteps?: number
        model?: { provider: string, model: string }
        tools?: AgentTool[]
        structuredOutput?: AgentOutputField[] | null
        status?: 'ENABLED' | 'DISABLED'
    }): Promise<Agent> {
        const existing = await agentRepo().findOneBy({ id: params.id, projectId: params.projectId, platformId: params.platformId })
        if (isNil(existing)) {
            throw new Error(`Agent not found: id=${params.id}`)
        }

        const updated: AgentSchema = {
            ...existing,
            updated: new Date().toISOString(),
            ...(params.externalId !== undefined && { externalId: params.externalId }),
            ...(params.displayName !== undefined && { displayName: params.displayName }),
            ...(params.description !== undefined && { description: params.description }),
            ...(params.prompt !== undefined && { prompt: params.prompt }),
            ...(params.maxSteps !== undefined && { maxSteps: params.maxSteps }),
            ...(params.model !== undefined && { model: params.model }),
            ...(params.tools !== undefined && { tools: params.tools }),
            ...(params.structuredOutput !== undefined && { structuredOutput: params.structuredOutput }),
            ...(params.status !== undefined && { status: params.status }),
        }

        return agentRepo().save(updated)
    },

    async delete(params: { id: string, projectId: string, platformId: string }): Promise<void> {
        await agentRepo().delete({ id: params.id, projectId: params.projectId, platformId: params.platformId })
    },

    async getOne(params: { id: string, projectId?: string, platformId?: string }): Promise<Agent | null> {
        return agentRepo().findOneBy({
            id: params.id,
            ...(params.projectId && { projectId: params.projectId }),
            ...(params.platformId && { platformId: params.platformId }),
        })
    },

    async getByExternalId(params: { externalId: string, projectId: string, platformId?: string }): Promise<Agent | null> {
        return agentRepo().findOneBy({
            externalId: params.externalId,
            projectId: params.projectId,
            ...(params.platformId && { platformId: params.platformId }),
        })
    },

    async listByProjectId(params: { projectId: string, platformId?: string }): Promise<Agent[]> {
        return agentRepo().findBy({
            projectId: params.projectId,
            ...(params.platformId && { platformId: params.platformId }),
        })
    },
}
