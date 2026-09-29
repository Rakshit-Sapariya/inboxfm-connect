import { randomBytes } from 'crypto'
import { apId, isNil } from '@inboxfm-connect/core-utils'
import { cryptoUtils } from '@inboxfm-connect/server-utils'
import { McpOAuthToken } from '@inboxfm-connect/shared'
import { FastifyBaseLogger } from 'fastify'
import { repoFactory } from '../../../core/db/repo-factory'
import { JwtAudience, jwtUtils } from '../../../helper/jwt-utils'
import { mcpOAuthPkce } from '../mcp-oauth.pkce'
import { McpOAuthTokenEntity } from './mcp-oauth-token.entity'

const repo = repoFactory(McpOAuthTokenEntity)

const ACCESS_TOKEN_TTL_15_MINUTES_SECONDS = 15 * 60
const REFRESH_TOKEN_TTL_30_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const INTERNAL_CHAT_CLIENT_ID = 'internal-chat'

function generateRefreshToken(): string {
    return randomBytes(48).toString('base64url')
}

function hashRefreshToken(token: string): string {
    return cryptoUtils.hashSHA256(token)
}

async function issueAccessToken(params: IssueAccessTokenParams): Promise<string> {
    const key = await jwtUtils.getJwtSecret()
    return jwtUtils.sign({
        payload: {
            sub: params.userId,
            projectId: params.projectId,
            platformId: params.platformId,
            clientId: params.clientId,
            scopes: params.scopes,
            type: 'mcp_oauth',
        },
        key,
        expiresInSeconds: ACCESS_TOKEN_TTL_15_MINUTES_SECONDS,
        audience: JwtAudience.MCP_OAUTH_ACCESS,
    })
}

export const mcpOAuthTokenService = {
    async exchangeCode(params: ExchangeCodeParams): Promise<TokenResponse> {
        const valid = mcpOAuthPkce.verify(params.codeVerifier, params.codeChallenge, params.codeChallengeMethod)
        if (!valid) {
            throw new OAuthTokenError('invalid_grant', 'PKCE verification failed')
        }

        const rawRefreshToken = generateRefreshToken()
        const hashedRefreshToken = hashRefreshToken(rawRefreshToken)

        const tokenRecord: McpOAuthToken = {
            id: apId(),
            refreshToken: hashedRefreshToken,
            clientId: params.clientId,
            userId: params.userId,
            projectId: params.projectId,
            platformId: params.platformId,
            scopes: params.scopes,
            expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_30_DAYS_MS).toISOString(),
            revoked: false,
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
        }
        await repo().save(tokenRecord)

        const accessToken = await issueAccessToken({
            userId: params.userId,
            projectId: params.projectId,
            platformId: params.platformId,
            clientId: params.clientId,
            scopes: params.scopes,
        })

        return {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: ACCESS_TOKEN_TTL_15_MINUTES_SECONDS,
            refresh_token: rawRefreshToken,
        }
    },

    async refreshAccessToken(params: RefreshParams): Promise<TokenResponse> {
        const hashed = hashRefreshToken(params.refreshToken)

        // RFC 6819 s5.2.2.3 / OAuth 2.1: rotate the refresh token on every use.
        // The claim is a single conditional UPDATE so two concurrent refresh calls
        // with the same token cannot both win - the loser sees no returned row and
        // gets invalid_grant. Reuse of a rotated token must be rejected, which
        // limits an attacker's window to a single refresh cycle.
        const rawNewRefreshToken = generateRefreshToken()
        const now = new Date().toISOString()
        const claim = await repo().createQueryBuilder()
            .update()
            .set({ refreshToken: hashRefreshToken(rawNewRefreshToken), updated: now })
            .where('"refreshToken" = :hashed AND "revoked" = false AND "expiresAt" > :now', { hashed, now })
            .returning('*')
            .execute()

        const claimedRows = claim.raw as McpOAuthToken[]
        const record = Array.isArray(claimedRows) && claimedRows.length > 0 ? claimedRows[0] : null
        if (isNil(record)) {
            // Either unknown/revoked/expired, or lost a race to a concurrent refresh
            // with the same token - indistinguishable by design (RFC 6749 s5.2).
            // Reuse of a rotated token lands here too, which limits an attacker's
            // window to a single refresh cycle; log a hash of the presented token so
            // operators can correlate replay attempts without logging the secret.
            params.log?.warn({ clientId: params.clientId, tokenHash: hashed }, '[mcpOAuth] Refresh token rejected: unknown, revoked, expired, or lost a concurrent race')
            throw new OAuthTokenError('invalid_grant', 'Invalid or expired refresh token')
        }
        if (record.clientId !== params.clientId) {
            // The token was claimed but presented by the wrong client - revoke the
            // rotated token so the legitimate owner is not stranded with a token the
            // attacker now shares, and reject (RFC 6819 s5.2.2.3).
            await repo().update({ id: record.id }, { revoked: true, updated: now })
            params.log?.warn({ clientId: params.clientId, tokenHash: hashed }, '[mcpOAuth] Refresh token presented by the wrong client - rotated token revoked')
            throw new OAuthTokenError('invalid_grant', 'Client mismatch')
        }

        // If signing below throws, the token is already consumed with no replacement
        // delivered - fail-closed, so the client must re-auth. Acceptable trade-off:
        // delivering a successor AFTER persisting it would risk double-issuance.
        const accessToken = await issueAccessToken({
            userId: record.userId,
            projectId: record.projectId,
            platformId: record.platformId,
            clientId: record.clientId,
            scopes: record.scopes ?? [],
        })

        return {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: ACCESS_TOKEN_TTL_15_MINUTES_SECONDS,
            refresh_token: rawNewRefreshToken,
        }
    },

    async verifyAccessToken(token: string): Promise<McpOAuthAccessTokenPayload> {
        const key = await jwtUtils.getJwtSecret()
        const payload = await jwtUtils.decodeAndVerify<McpOAuthAccessTokenPayload>({
            jwt: token,
            key,
            audience: JwtAudience.MCP_OAUTH_ACCESS,
        })
        if (payload.type !== 'mcp_oauth') {
            throw new OAuthTokenError('invalid_token', 'Not an MCP OAuth token')
        }
        return payload
    },

    async revokeRefreshToken(refreshToken: string, clientId: string | undefined): Promise<void> {
        const hashed = hashRefreshToken(refreshToken)
        const criteria = clientId
            ? { refreshToken: hashed, clientId }
            : { refreshToken: hashed }
        await repo().update(criteria, { revoked: true })
    },

    async issueInternalAccessToken({ userId, platformId, projectId }: { userId: string, platformId: string, projectId: string | null }): Promise<string> {
        return issueAccessToken({ userId, platformId, projectId, clientId: INTERNAL_CHAT_CLIENT_ID, scopes: ['mcp'] })
    },
}

export class OAuthTokenError extends Error {
    constructor(
        public readonly errorCode: string,
        public readonly errorDescription: string,
    ) {
        super(errorDescription)
    }
}

type IssueAccessTokenParams = {
    userId: string
    projectId: string | null
    platformId: string
    clientId: string
    scopes: string[]
}

type ExchangeCodeParams = {
    codeVerifier: string
    codeChallenge: string
    codeChallengeMethod: string
    clientId: string
    userId: string
    projectId: string | null
    platformId: string
    scopes: string[]
}

type RefreshParams = {
    refreshToken: string
    clientId: string
    log?: FastifyBaseLogger
}

type TokenResponse = {
    access_token: string
    token_type: string
    expires_in: number
    refresh_token?: string
}

export type McpOAuthAccessTokenPayload = {
    sub: string
    projectId: string | null
    platformId: string
    clientId: string
    scopes: string[]
    type: 'mcp_oauth'
    iat: number
    exp: number
}