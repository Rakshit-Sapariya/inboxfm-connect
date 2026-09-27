import { ActivepiecesError, ErrorCode } from '@inboxfm-connect/core-utils'
import { safeHttp } from '@inboxfm-connect/server-utils'
import { TelemetryEventName } from '@inboxfm-connect/shared'
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios'
import { FastifyBaseLogger } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { system } from '../../../../../src/app/helper/system/system'
import { licenseKeysService } from '../../../../../src/app/ee/license-keys/license-keys-service'

const mockTrackPlatform = vi.fn().mockResolvedValue(undefined)
vi.mock('../../../../../src/app/helper/telemetry.utils', () => ({
    telemetry: () => ({
        trackPlatform: mockTrackPlatform,
    }),
}))

function createAxiosError(status: number, data: unknown = {}): AxiosError {
    const response: AxiosResponse = {
        status,
        statusText: String(status),
        data,
        headers: {},
        config: { headers: new AxiosHeaders() },
    }
    const error = new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', response.config, {}, response)
    error.response = response
    return error
}

describe('licenseKeysService (Issue #143)', () => {
    const mockLogger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    } as unknown as FastifyBaseLogger

    beforeEach(() => {
        vi.clearAllMocks()
        vi.spyOn(system, 'getOrThrow').mockReturnValue('mock-api-key')
    })

    describe('markAsActiviated telemetry gating', () => {
        it('tracks KEY_ACTIVATED telemetry when activate returns 200 OK', async () => {
            vi.spyOn(safeHttp.axios, 'post').mockResolvedValueOnce({
                status: StatusCodes.OK,
                data: {},
            } as any)

            const service = licenseKeysService(mockLogger)
            await service.markAsActiviated({ key: 'lic_valid', platformId: 'platform_123' })

            expect(mockTrackPlatform).toHaveBeenCalledTimes(1)
            expect(mockTrackPlatform).toHaveBeenCalledWith('platform_123', expect.objectContaining({
                name: TelemetryEventName.KEY_ACTIVATED,
                payload: expect.objectContaining({
                    key: 'lic_valid',
                }),
            }))
        })

        it('does NOT track KEY_ACTIVATED telemetry when activate returns 409 CONFLICT', async () => {
            vi.spyOn(safeHttp.axios, 'post').mockResolvedValueOnce({
                status: StatusCodes.CONFLICT,
                data: { message: 'Already activated' },
            } as any)

            const service = licenseKeysService(mockLogger)
            await service.markAsActiviated({ key: 'lic_conflict', platformId: 'platform_123' })

            expect(mockTrackPlatform).not.toHaveBeenCalled()
        })

        it('does NOT track KEY_ACTIVATED telemetry when activate returns 404 NOT_FOUND', async () => {
            vi.spyOn(safeHttp.axios, 'post').mockResolvedValueOnce({
                status: StatusCodes.NOT_FOUND,
                data: { message: 'Key not found' },
            } as any)

            const service = licenseKeysService(mockLogger)
            await service.markAsActiviated({ key: 'lic_missing', platformId: 'platform_123' })

            expect(mockTrackPlatform).not.toHaveBeenCalled()
        })
    })

    describe('requestTrial error mapping', () => {
        it('maps 409 CONFLICT from secret manager to EMAIL_ALREADY_HAS_ACTIVATION_KEY', async () => {
            vi.spyOn(safeHttp.axios, 'post').mockRejectedValueOnce(createAxiosError(StatusCodes.CONFLICT, { message: 'Trial already exists' }))

            const service = licenseKeysService(mockLogger)
            await expect(service.requestTrial({ email: 'duplicate@example.com' } as any)).rejects.toMatchObject({
                error: {
                    code: ErrorCode.EMAIL_ALREADY_HAS_ACTIVATION_KEY,
                },
            })
        })
    })

    describe('getKey', () => {
        it('returns null when secret manager returns 404 NOT_FOUND', async () => {
            vi.spyOn(safeHttp.axios, 'get').mockRejectedValueOnce(createAxiosError(StatusCodes.NOT_FOUND, { message: 'Not found' }))

            const service = licenseKeysService(mockLogger)
            const result = await service.getKey('lic_nonexistent')
            expect(result).toBeNull()
        })

        it('returns null immediately when license key is undefined', async () => {
            const service = licenseKeysService(mockLogger)
            const result = await service.getKey(undefined)
            expect(result).toBeNull()
        })
    })

    describe('extendTrial error mapping', () => {
        it('maps 404 NOT_FOUND from secret manager to ENTITY_NOT_FOUND', async () => {
            vi.spyOn(safeHttp.axios, 'post').mockRejectedValueOnce(createAxiosError(StatusCodes.NOT_FOUND, { message: 'Key not found' }))

            const service = licenseKeysService(mockLogger)
            await expect(service.extendTrial({ email: 'missing@example.com', days: 14 })).rejects.toMatchObject({
                error: {
                    code: ErrorCode.ENTITY_NOT_FOUND,
                },
            })
        })
    })
})
