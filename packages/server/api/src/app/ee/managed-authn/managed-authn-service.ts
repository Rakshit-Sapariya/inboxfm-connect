import { createHash } from 'crypto'
import { ActivepiecesError, ErrorCode, isNil } from '@inboxfm-connect/core-utils'
import { cryptoUtils } from '@inboxfm-connect/server-utils'
import { AuthenticationResponse, PiecesFilterType, PlatformRole, PrincipalType, Project, ProjectType, User, UserIdentity, UserIdentityProvider } from '@inboxfm-connect/shared'
import { FastifyBaseLogger } from 'fastify'
import { accessTokenManager } from '../../authentication/lib/access-token-manager'
import { userIdentityService } from '../../authentication/user-identity/user-identity-service'
import { pieceTagService } from '../../pieces/tags/pieces/piece-tag.service'
import { platformService } from '../../platform/platform.service'
import { projectService } from '../../project/project-service'
import { userService } from '../../user/user-service'
import { concurrencyPoolService } from '../platform/concurrency-pool/concurrency-pool.service'
import { projectMemberService } from '../projects/project-members/project-member.service'
import { projectLimitsService } from '../projects/project-plan/project-plan.service'
import { externalTokenExtractor } from './lib/external-token-extractor'

export const managedAuthnService = (log: FastifyBaseLogger) => ({
    async externalToken({
        externalAccessToken,
    }: AuthenticateParams): Promise<AuthenticationResponse> {
        const externalPrincipal = await externalTokenExtractor(log).extract(
            externalAccessToken,
        )

        const { project } = await getOrCreateProject({
            platformId: externalPrincipal.platformId,
            externalProjectId: externalPrincipal.externalProjectId,
        }, log)

        if (!isNil(externalPrincipal.projectDisplayName)) {
            await projectService(log).update(project.id, {
                type: project.type,
                displayName: externalPrincipal.projectDisplayName,
            })
        }

        if (!isNil(externalPrincipal.concurrencyPoolKey) && !isNil(externalPrincipal.concurrencyPoolLimit)) {
            const { poolId } = await concurrencyPoolService(log).upsertPool({
                platformId: externalPrincipal.platformId,
                key: externalPrincipal.concurrencyPoolKey,
                maxConcurrentJobs: externalPrincipal.concurrencyPoolLimit,
            })
            await projectService(log).update(project.id, { type: project.type, poolId })
            await concurrencyPoolService(log).assignProject({ projectId: project.id, poolId })
        }

        await updateProjectLimits({
            platformId: project.platformId,
            projectId: project.id,
            piecesTags: externalPrincipal.pieces.tags,
            piecesFilterType: externalPrincipal.pieces.filterType,
            log,
        })

        const user = await getOrCreateUser(externalPrincipal, log)

        await projectMemberService(log).upsert({
            projectId: project.id,
            userId: user.id,
            projectRoleName: externalPrincipal.projectRole,
        })

        const identity = await userIdentityService(log).getOneOrFail({
            id: user.identityId,
        })

        const token = await accessTokenManager(log).generateToken({
            id: user.id,
            type: PrincipalType.USER,
            platform: {
                id: externalPrincipal.platformId,
            },
            tokenVersion: identity.tokenVersion,
        }, 7 * 24 * 60 * 60)
        return {
            id: user.id,
            platformRole: user.platformRole,
            status: user.status,
            externalId: user.externalId,
            platformId: user.platformId,
            firstName: identity.firstName,
            lastName: identity.lastName,
            email: identity.email,
            trackEvents: identity.trackEvents,
            newsLetter: identity.newsLetter,
            verified: identity.verified,
            token,
            projectId: project.id,
        }
    },
})

type UpdateProjectLimitsParams =
    {
        platformId: string
        projectId: string
        piecesTags: string[]
        piecesFilterType: PiecesFilterType
        log: FastifyBaseLogger
    }

const updateProjectLimits = async ({ platformId, projectId, piecesTags, piecesFilterType, log }: UpdateProjectLimitsParams): Promise<void> => {
    const pieces = await getPiecesList({
        platformId,
        projectId,
        piecesTags,
        piecesFilterType,
    })
    await projectLimitsService(log).upsert({
        nickname: 'default-embeddings-limit',
        pieces,
        piecesFilterType,
    }, projectId)
}

// Race-safe get-or-create for the platform user row.
// The loser of a concurrent first-login race hits idx_user_platform_id_external_id
// (SQLSTATE 23505). Catch it, re-read by natural key, and return the winner's row
// so both callers sign in successfully (issue #469).
const getOrCreateUser = async (
    params: GetOrCreateUserParams,
    log: FastifyBaseLogger,
): Promise<User> => {
    const existingUser = await userService(log).getByPlatformAndExternalId({
        platformId: params.platformId,
        externalId: params.externalUserId,
    })

    if (!isNil(existingUser)) {
        return existingUser
    }
    const identity = await getOrCreateUserIdentity(params, log)
    try {
        return await userService(log).create({
            externalId: params.externalUserId,
            platformId: params.platformId,
            identityId: identity.id,
            platformRole: PlatformRole.MEMBER,
        })
    }
    catch (error) {
        // Two concurrent first logins for the same (platformId, externalUserId)
        // both passed the existence check; the loser hits the unique index.
        if (isUniqueViolationError(error)) {
            log.warn({ platformId: params.platformId, externalId: params.externalUserId }, '[managedAuthn#getOrCreateUser] Lost race on user insert — converging to winner row')
            const winner = await userService(log).getByPlatformAndExternalId({
                platformId: params.platformId,
                externalId: params.externalUserId,
            })
            if (!isNil(winner)) {
                return winner
            }
        }
        throw error
    }
}

// Race-safe get-or-create for the user identity row.
// The loser hits idx_user_identity_email (23505) OR the EXISTING_USER error from
// userIdentityService.create()'s own pre-check. Both signals mean the winner's
// row already exists — re-read by email and return it (issue #469).
const getOrCreateUserIdentity = async (
    params: GetOrCreateUserParams,
    log: FastifyBaseLogger,
): Promise<UserIdentity> => {
    const cleanedEmail = generateEmailHash(params)
    const existingIdentity = await userIdentityService(log).getIdentityByEmail(cleanedEmail)
    if (!isNil(existingIdentity)) {
        return existingIdentity
    }
    try {
        return await userIdentityService(log).create({
            email: cleanedEmail,
            password: await cryptoUtils.generateRandomPassword(),
            firstName: params.externalFirstName,
            lastName: params.externalLastName,
            trackEvents: true,
            newsLetter: false,
            provider: UserIdentityProvider.JWT,
            verified: true,
        })
    }
    catch (error) {
        // 23505 from the DB or EXISTING_USER from the service's own pre-check both
        // mean the race-winner's row already landed.
        const isIdentityRaceLoss = isUniqueViolationError(error) ||
            (error instanceof ActivepiecesError && error.error.code === ErrorCode.EXISTING_USER)
        if (isIdentityRaceLoss) {
            log.warn({ email: cleanedEmail }, '[managedAuthn#getOrCreateUserIdentity] Lost race on identity insert — converging to winner row')
            const winner = await userIdentityService(log).getIdentityByEmail(cleanedEmail)
            if (!isNil(winner)) {
                return winner
            }
        }
        throw error
    }
}

// Race-safe get-or-create for the project row.
// The loser hits idx_project_platform_id_external_id (23505) — re-read by the
// natural key and return the winner's row (issue #469).
const getOrCreateProject = async ({
    platformId,
    externalProjectId,
}: GetOrCreateProjectParams, log: FastifyBaseLogger): Promise<{ project: Project, isNewProject: boolean }> => {
    const existingProject = await projectService(log).getByPlatformIdAndExternalId({
        platformId,
        externalId: externalProjectId,
    })

    if (!isNil(existingProject)) {
        return { project: existingProject, isNewProject: false }
    }

    const platform = await platformService(log).getOneOrThrow(platformId)

    try {
        const project = await projectService(log).create({
            displayName: externalProjectId,
            ownerId: platform.ownerId,
            platformId,
            externalId: externalProjectId,
            type: ProjectType.TEAM,
        })
        return { project, isNewProject: true }
    }
    catch (error) {
        if (isUniqueViolationError(error)) {
            log.warn({ platformId, externalProjectId }, '[managedAuthn#getOrCreateProject] Lost race on project insert — converging to winner row')
            const winner = await projectService(log).getByPlatformIdAndExternalId({
                platformId,
                externalId: externalProjectId,
            })
            if (!isNil(winner)) {
                return { project: winner, isNewProject: false }
            }
        }
        throw error
    }
}

const getPiecesList = async ({
    piecesFilterType,
    piecesTags,
    platformId,
}: UpdateProjectLimits): Promise<string[]> => {
    switch (piecesFilterType) {
        case PiecesFilterType.ALLOWED: {
            return pieceTagService.findByPlatformAndTags(
                platformId,
                piecesTags,
            )
        }
        case PiecesFilterType.NONE: {
            return []
        }
    }
}

// TypeORM wraps Postgres unique-index violations in a QueryFailedError whose
// driver-level code is 23505. @electric-sql/pglite surfaces it on driverError.code.
// Matching on the driver code (not the message) keeps this branch race-loss-only.
function isUniqueViolationError(error: unknown): boolean {
    const candidate = error as { code?: string, driverError?: { code?: string } } | null | undefined
    return candidate?.code === '23505' || candidate?.driverError?.code === '23505'
}

function generateEmailHash(params: { platformId: string, externalUserId: string }): string {
    const inputString = `managed_${params.platformId}_${params.externalUserId}`
    return cleanEmailOtherwiseCompareFails(createHash('sha256').update(inputString).digest('hex'))
}

function cleanEmailOtherwiseCompareFails(email: string): string {
    return email.trim().toLowerCase()
}

type AuthenticateParams = {
    externalAccessToken: string
}

type GetOrCreateUserParams = {
    platformId: string
    externalUserId: string
    externalProjectId: string
    externalFirstName: string
    externalLastName: string
}

type GetOrCreateProjectParams = {
    platformId: string
    externalProjectId: string
}

type UpdateProjectLimits = {
    platformId: string
    projectId: string
    piecesTags: string[]
    piecesFilterType: PiecesFilterType
}
