import { apId } from '@inboxfm-connect/core-utils'
import { AppConnectionScope, AppConnectionStatus, AppConnectionType } from '@inboxfm-connect/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { appConnectionService } from '../../../../src/app/app-connection/app-connection-service/app-connection-service'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment({ fresh: true })
})

afterAll(async () => {
    await teardownTestEnvironment()
})

afterEach(async () => {
    vi.restoreAllMocks()
})

async function upsertConnection(params: { ctx: TestContext, externalId: string, status?: AppConnectionStatus }): Promise<{ id: string }> {
    const connection = await appConnectionService(app!.log).upsert({
        projectIds: [params.ctx.project.id],
        platformId: params.ctx.platform.id,
        externalId: params.externalId,
        displayName: params.externalId,
        pieceName: '@inboxfm-connect/piece-slack',
        pieceVersion: '1.0.0',
        type: AppConnectionType.SECRET_TEXT,
        value: {
            type: AppConnectionType.SECRET_TEXT,
            secret_text: 'xoxb-test-token',
        },
        scope: AppConnectionScope.PROJECT,
        status: params.status,
        ownerId: null,
    })
    return { id: connection.id }
}

describe('POST /v1/app-connections/:id/test (Issue #188)', () => {
    let ctx: TestContext

    beforeEach(async () => {
        ctx = await createTestContext(app!)
    })

    it('returns pass and ACTIVE for a healthy secret-text connection', async () => {
        const { id } = await upsertConnection({ ctx, externalId: 'conn-healthy' })

        const response = await app!.inject({
            method: 'POST',
            url: `/api/v1/connections/${id}/test`,
            headers: { authorization: `Bearer ${ctx.token}` },
        })

        expect(response.statusCode).toBe(StatusCodes.OK)
        const body = response.json()
        expect(body.ok).toBe(true)
        expect(body.status).toBe(AppConnectionStatus.ACTIVE)
        expect(typeof body.testedAt).toBe('string')
    })

    it('flips an ERROR connection back to ACTIVE on a passing test', async () => {
        const { id } = await upsertConnection({ ctx, externalId: 'conn-recovered', status: AppConnectionStatus.ERROR })

        const response = await app!.inject({
            method: 'POST',
            url: `/api/v1/connections/${id}/test`,
            headers: { authorization: `Bearer ${ctx.token}` },
        })

        expect(response.statusCode).toBe(StatusCodes.OK)
        expect(response.json().ok).toBe(true)
        expect(response.json().status).toBe(AppConnectionStatus.ACTIVE)
    })

    it('returns 404 for an unknown connection id', async () => {
        const response = await app!.inject({
            method: 'POST',
            url: `/api/v1/connections/${apId()}/test`,
            headers: { authorization: `Bearer ${ctx.token}` },
        })

        expect(response.statusCode).toBe(StatusCodes.NOT_FOUND)
    })

    it('rejects a foreign-platform caller with 403', async () => {
        const { id } = await upsertConnection({ ctx, externalId: 'conn-private' })
        const foreignCtx = await createTestContext(app!)

        const response = await app!.inject({
            method: 'POST',
            url: `/api/v1/connections/${id}/test`,
            headers: { authorization: `Bearer ${foreignCtx.token}` },
        })

        expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
    })
})
