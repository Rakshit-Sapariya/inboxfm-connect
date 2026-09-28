import { describe, expect, it } from 'vitest'
import jwtLibrary from 'jsonwebtoken'
import {
    createWorkerToken,
    generateWorkerTokenCommand,
    KEY_ID,
    ISSUER,
    ALGORITHM,
} from '../../src/lib/commands/generate-worker-token'

describe('CLI generate-worker-token Command', () => {
    it('generates a valid WORKER JWT signed with the given secret', () => {
        const secret = 'test-jwt-secret-very-secure-12345'
        const token = createWorkerToken(secret)

        expect(token).toBeDefined()
        expect(typeof token).toBe('string')
        expect(token.split('.').length).toBe(3)

        // Verify the JWT with the secret
        const decoded = jwtLibrary.verify(token, secret, {
            issuer: ISSUER,
            algorithms: [ALGORITHM],
        }) as Record<string, unknown>

        expect(decoded).toBeDefined()
        expect(decoded.type).toBe('WORKER')
        expect(decoded.id).toBeDefined()
        expect(typeof decoded.id).toBe('string')

        // Verify key id in header
        const header = jwtLibrary.decode(token, { complete: true })?.header
        expect(header?.kid).toBe(KEY_ID)
        expect(header?.alg).toBe(ALGORITHM)
    })

    it('generates unique worker tokens on successive calls', () => {
        const secret = 'test-jwt-secret-very-secure-12345'
        const token1 = createWorkerToken(secret)
        const token2 = createWorkerToken(secret)

        expect(token1).not.toBe(token2)

        const decoded1 = jwtLibrary.decode(token1) as Record<string, unknown>
        const decoded2 = jwtLibrary.decode(token2) as Record<string, unknown>

        expect(decoded1.id).not.toBe(decoded2.id)
    })

    it('command definition has correct name and description', () => {
        expect(generateWorkerTokenCommand.name()).toBe('token')
        expect(generateWorkerTokenCommand.description()).toBe('Generate a JWT token for worker authentication')
    })
})
