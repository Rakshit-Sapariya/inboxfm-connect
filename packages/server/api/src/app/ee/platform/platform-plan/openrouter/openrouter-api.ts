import { safeHttp } from '@inboxfm-connect/server-utils'
import { isAxiosError } from 'axios'
import { system } from '../../../../helper/system/system'
import { AppSystemProp } from '../../../../helper/system/system-props'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export const openRouterApi = {
    async createKey(request: CreateKeyRequest): Promise<CreateKeyResponse> {
        const apiKey = system.getOrThrow(AppSystemProp.OPENROUTER_PROVISION_KEY)

        try {
            const { data } = await safeHttp.axios.post<CreateKeyResponse>(`${OPENROUTER_BASE_URL}/keys`, request, {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
            })
            return data
        }
        catch (err) {
            const status = isAxiosError(err) ? err.response?.status : 'unknown'
            const text = isAxiosError(err) && err.response?.data ? JSON.stringify(err.response.data) : (err instanceof Error ? err.message : String(err))
            throw new Error(`[OpenRouter] createKey error: ${status} ${text}`)
        }
    },

    async updateKey(request: UpdateKeyRequest): Promise<UpdateKeyResponse> {
        const apiKey = system.getOrThrow(AppSystemProp.OPENROUTER_PROVISION_KEY)
        const { hash, ...rest } = request

        try {
            const { data } = await safeHttp.axios.patch<UpdateKeyResponse>(`${OPENROUTER_BASE_URL}/keys/${hash}`, rest, {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
            })
            return data
        }
        catch (err) {
            const status = isAxiosError(err) ? err.response?.status : 'unknown'
            const text = isAxiosError(err) && err.response?.data ? JSON.stringify(err.response.data) : (err instanceof Error ? err.message : String(err))
            throw new Error(`[OpenRouter] updateKey error: ${status} ${text}`)
        }
    },

    async getKey(request: GetKeyRequest): Promise<GetKeyResponse> {
        const apiKey = system.getOrThrow(AppSystemProp.OPENROUTER_PROVISION_KEY)

        try {
            const { data } = await safeHttp.axios.get<GetKeyResponse>(`${OPENROUTER_BASE_URL}/keys/${request.hash}`, {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
            })
            return data
        }
        catch (err) {
            const status = isAxiosError(err) ? err.response?.status : 'unknown'
            const text = isAxiosError(err) && err.response?.data ? JSON.stringify(err.response.data) : (err instanceof Error ? err.message : String(err))
            throw new Error(`[OpenRouter] getKey error: ${status} ${text}`)
        }
    },

    async listKeys(request: ListKeysRequest): Promise<ListKeysResponse> {
        const apiKey = system.getOrThrow(AppSystemProp.OPENROUTER_PROVISION_KEY)

        const params = new URLSearchParams()
        if (request.offset !== undefined) {
            params.set('offset', request.offset.toString())
        }
        if (request.include_disabled !== undefined) {
            params.set('include_disabled', String(request.include_disabled))
        }
        const url = `${OPENROUTER_BASE_URL}/keys?${params.toString()}`

        try {
            const { data } = await safeHttp.axios.get<ListKeysResponse>(url, {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                },
            })
            return data
        }
        catch (err) {
            const status = isAxiosError(err) ? err.response?.status : 'unknown'
            const text = isAxiosError(err) && err.response?.data ? JSON.stringify(err.response.data) : (err instanceof Error ? err.message : String(err))
            throw new Error(`[OpenRouter] listKeys error: ${status} ${text}`)
        }
    },
}

type CreateKeyRequest = {
    name: string
    limit?: number
    limit_reset?: LimitReset
    include_byok_in_limit?: boolean
    expires_at?: Date
}
type CreateKeyResponse = {
    key: string
    data: OpenRouterApikey
}

type UpdateKeyRequest = {
    hash: string
    name?: string
    limit?: number
    limit_reset?: LimitReset | null
    include_byok_in_limit?: boolean
    expires_at?: Date
}
type UpdateKeyResponse = {
    data: OpenRouterApikey
}

type GetKeyRequest = {
    hash: string
}
type GetKeyResponse = {
    data: OpenRouterApikey
}

type ListKeysRequest = {
    offset?: number
    include_disabled?: 'true' | 'false' // default false
}
type ListKeysResponse = {
    data: OpenRouterApikey[]
}

type LimitReset = 'daily' | 'weekly' | 'monthly'

export type OpenRouterApikey = {
    hash: string
    name: string
    label: string
    disabled: boolean

    limit: number | null
    limit_remaining: number | null
    limit_reset: LimitReset | null

    include_byok_in_limit: boolean

    usage: number
    usage_daily: number
    usage_weekly: number
    usage_monthly: number

    byok_usage: number
    byok_usage_daily: number
    byok_usage_weekly: number
    byok_usage_monthly: number

    created_at: string
    updated_at: string | null
    expires_at: string | null
}
