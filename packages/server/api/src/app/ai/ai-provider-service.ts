import { ActivepiecesError, AIProviderName, apId, ErrorCode, isNil, PlatformId, spreadIfDefined } from '@inboxfm-connect/core-utils'
import { ActivePiecesProviderAuthConfig, AIProviderAuthConfig, AIProviderConfig, AIProviderModel, AIProviderWithoutSensitiveData, BaseAIProviderAuthConfig, BedrockProviderAuthConfig, BedrockProviderConfig, CreateAIProviderRequest, GetProviderConfigResponse, UpdateAIProviderRequest } from '@inboxfm-connect/shared'
import { FastifyBaseLogger } from 'fastify'
import cron from 'node-cron'
import { repoFactory } from '../core/db/repo-factory'
import { flagService } from '../flags/flag.service'
import { encryptUtils } from '../helper/encryption'
import { AIProviderEntity, AIProviderSchema } from './ai-provider-entity'
import { aiProviders } from './providers'

const aiProviderRepo = repoFactory<AIProviderSchema>(AIProviderEntity)

const modelsCache = new Map<string, AIProviderModel[]>()

export const aiProviderService = (log: FastifyBaseLogger) => ({
    async setup(): Promise<void> {
        cron.schedule('0 0 * * *', () => {
            log.info('Clearing AI provider models cache')
            modelsCache.clear()
        })
    },

    async listProviders(platformId: PlatformId): Promise<AIProviderWithoutSensitiveData[]> {
        const activepiecesExists = await aiProviderRepo().existsBy({
            platformId,
            provider: AIProviderName.ACTIVEPIECES,
        })

        if (flagService(log).aiCreditsEnabled() && !activepiecesExists) {
            // Managed AI is the default chat provider so the chat page skips the "set up a
            // provider" wall — but only when nothing else is already enabled for chat, so we never
            // create a second chat provider or override an existing BYO choice (see update()).
            const hasChatProvider = await aiProviderRepo().existsBy({ platformId, enabledForChat: true })
            await aiProviderRepo().save({
                id: apId(),
                auth: await encryptUtils.encryptObject({}),
                config: {},
                provider: AIProviderName.ACTIVEPIECES,
                displayName: 'Inboxfm Connect',
                platformId,
                enabledForChat: !hasChatProvider,
            })
        }
        const configuredProviders = await aiProviderRepo().findBy({ platformId })

        return configuredProviders.map((p): AIProviderWithoutSensitiveData => ({
            id: p.id,
            name: p.displayName,
            provider: p.provider,
            config: p.config,
            enabledForChat: p.enabledForChat ?? false,
        }))
    },

    async listModels(platformId: PlatformId, provider: AIProviderName): Promise<AIProviderModel[]> {
        const { config, auth } = await this.getConfigOrThrow({ platformId, provider })

        const cacheKey = `${provider}-${getAuthCacheFingerprint({ provider, auth, config })}`
        if (modelsCache.has(cacheKey) && !('models' in config)) {
            return modelsCache.get(cacheKey)!
        }

        const data = await aiProviders[provider].listModels(auth, config)

        modelsCache.set(cacheKey, data.map(model => ({
            id: model.id,
            name: model.name,
            type: model.type,
        })))

        return modelsCache.get(cacheKey)!
    },

    async create(platformId: PlatformId, request: CreateAIProviderRequest): Promise<void> {
        await this.validateProviderCredentials(request.provider, request.auth, request.config)
        await aiProviderRepo().save({
            id: apId(),
            auth: await encryptUtils.encryptObject(request.auth),
            config: request.config,
            provider: request.provider,
            displayName: request.displayName,
            platformId,
        })
    },
    async update(platformId: PlatformId, providerId: string, request: UpdateAIProviderRequest): Promise<void> {
        const aiProvider = await aiProviderRepo().findOneBy({
            platformId,
            id: providerId,
        })
        if (isNil(aiProvider)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: { entityId: providerId, entityType: 'AIProvider' },
            })
        }

        if (aiProvider.provider === AIProviderName.ACTIVEPIECES) {
            if (request.enabledForChat === true) {
                await aiProviderRepo().manager.transaction(async (manager) => {
                    await manager.update(AIProviderEntity, { platformId }, { enabledForChat: false })
                    await manager.update(AIProviderEntity, providerId, { enabledForChat: true })
                })
            }
            return
        }

        const config = request.config ?? aiProvider.config
        if (!isNil(request.auth)) {
            await this.validateProviderCredentials(aiProvider.provider, request.auth, config)
        }
        else {
            const { auth } = await this.getConfigOrThrow({ platformId, provider: aiProvider.provider })
            await this.validateProviderCredentials(aiProvider.provider, auth, config)
        }

        const encryptedAuth = !isNil(request.auth) ? await encryptUtils.encryptObject(request.auth) : undefined
        const updates = {
            ...spreadIfDefined('auth', encryptedAuth),
            ...spreadIfDefined('config', request.config),
            ...spreadIfDefined('enabledForChat', request.enabledForChat),
            displayName: request.displayName,
        }

        if (request.enabledForChat === true) {
            await aiProviderRepo().manager.transaction(async (manager) => {
                await manager.update(AIProviderEntity, { platformId }, { enabledForChat: false })
                await manager.update(AIProviderEntity, providerId, updates)
            })
        }
        else {
            await aiProviderRepo().update(providerId, updates)
        }
    },

    async delete(platformId: PlatformId, providerId: string): Promise<void> {
        await aiProviderRepo().delete({
            platformId,
            id: providerId,
        })
    },
    async validateProviderCredentials(provider: AIProviderName, auth: AIProviderAuthConfig, config: AIProviderConfig): Promise<void> {
        const providerStrategy = aiProviders[provider]
        try {
            await providerStrategy.validateConnection(auth, config, log)
        }
        catch (error: unknown) {
            log.error({ error }, '[aiProviderService#validateProviderCredentials] Failed to validate provider credentials')
            throw new ActivepiecesError({
                code: ErrorCode.INVALID_AI_PROVIDER_CREDENTIALS,
                params: {
                    provider,
                    message: `Failed to validate credentials for ${providerStrategy.name}`,
                },
            })
        }
    },
    async getConfigOrThrow({ platformId, provider }: GetOrCreateActivepiecesConfigResponse): Promise<GetProviderConfigResponse> {
        const aiProvider = await aiProviderRepo().findOneBy({
            platformId,
            provider,
        })
        if (isNil(aiProvider)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityId: provider,
                    entityType: 'AIProvider',
                },
            })
        }

        const auth = await encryptUtils.decryptObject<AIProviderAuthConfig>(aiProvider.auth)

        return { provider: aiProvider.provider, auth, config: aiProvider.config, platformId }
    },
    async getActivepiecesProviderIfEnriched(platformId: PlatformId): Promise<ActivePiecesProviderAuthConfig | null> {
        const aiProvider = await aiProviderRepo().findOneBy({
            platformId,
            provider: AIProviderName.ACTIVEPIECES,
        })
        if (isNil(aiProvider)) {
            return null
        }
        const doesHaveKeys = await doesActivepiecesProviderHasKeys(aiProvider)
        if (!doesHaveKeys) {
            return null
        }
        const { auth } = await this.getConfigOrThrow({ platformId, provider: aiProvider.provider })

        return auth as ActivePiecesProviderAuthConfig
    },

})

type GetOrCreateActivepiecesConfigResponse = {
    platformId: PlatformId
    provider: AIProviderName
}

async function doesActivepiecesProviderHasKeys(aiProvider: AIProviderSchema): Promise<boolean> {
    if (isNil(aiProvider) || isNil(aiProvider.auth)) {
        return false
    }
    const decryptedAuth = await encryptUtils.decryptObject<ActivePiecesProviderAuthConfig>(aiProvider.auth)
    return !isNil(decryptedAuth) && !isNil(decryptedAuth.apiKey) && decryptedAuth.apiKey !== ''
}

function getAuthCacheFingerprint({ provider, auth, config }: { provider: AIProviderName, auth: AIProviderAuthConfig, config: AIProviderConfig }): string {
    switch (provider) {
        case AIProviderName.BEDROCK: {
            const { accessKeyId, secretAccessKey } = auth as BedrockProviderAuthConfig
            const { region } = config as BedrockProviderConfig
            return `${accessKeyId}-${secretAccessKey}-${region}`
        }
        default: {
            const { apiKey } = auth as BaseAIProviderAuthConfig
            return apiKey
        }
    }
}