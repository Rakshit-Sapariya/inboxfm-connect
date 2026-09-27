import { ActivepiecesError, apId, ErrorCode, isNil, SeekPage } from '@inboxfm-connect/core-utils'
import { cronParser, scheduler } from '@inboxfm-connect/scheduler'
import {
    CreateScheduledTaskRequest,
    Execution,
    PlatformId,
    ProjectId,
    ScheduledTask,
    ScheduledTaskStatus,
    UpdateScheduledTaskRequest,
} from '@inboxfm-connect/shared'
import { FastifyBaseLogger } from 'fastify'
import { repoFactory } from '../../core/db/repo-factory'
import { executionService } from '../execution.service'
import { ScheduledTaskEntity, ScheduledTaskSchema } from './scheduled-task-entity'

/**
 * Lazy getter: resolving the repository at module scope binds it to whichever
 * DataSource existed when `app.ts` was first imported, which is not necessarily
 * the initialized one.
 */
const scheduledTaskRepo = repoFactory<ScheduledTaskSchema>(ScheduledTaskEntity)

export const scheduledTaskService = {
    async create({ request, projectId, platformId }: CreateParams): Promise<ScheduledTask> {
        const id = apId()
        const newTask: ScheduledTask = {
            id,
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            projectId,
            platformId,
            prompt: request.prompt,
            cronExpression: request.cronExpression,
            timezone: request.timezone ?? 'UTC',
            status: request.status ?? ScheduledTaskStatus.ENABLED,
            lastRunAt: null,
            nextRunAt: (request.status ?? ScheduledTaskStatus.ENABLED) === ScheduledTaskStatus.ENABLED
                ? computeNextRunAt({ cronExpression: request.cronExpression, timezone: request.timezone ?? 'UTC' })
                : null,
        }

        const saved = await scheduledTaskRepo().save(newTask)

        if (saved.status === ScheduledTaskStatus.ENABLED) {
            await syncSchedule(saved)
        }

        return saved
    },

    async getOneOrThrow({ id, projectId, platformId }: GetOneParams): Promise<ScheduledTask> {
        const task = await scheduledTaskRepo().findOneBy({ id, projectId, platformId })
        if (isNil(task)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: { message: `ScheduledTask ${id} not found` },
            })
        }
        return task
    },

    async list({ projectId, platformId }: ListParams): Promise<SeekPage<ScheduledTask>> {
        const tasks = await scheduledTaskRepo().findBy({ projectId, platformId })
        return {
            data: tasks,
            next: null,
            previous: null,
        }
    },

    async update({ id, projectId, platformId, request }: UpdateParams): Promise<ScheduledTask> {
        const existing = await scheduledTaskService.getOneOrThrow({ id, projectId, platformId })

        const mergedStatus = request.status ?? existing.status
        const updatedTask: ScheduledTask = {
            ...existing,
            ...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
            ...(request.cronExpression !== undefined ? { cronExpression: request.cronExpression } : {}),
            ...(request.timezone !== undefined ? { timezone: request.timezone } : {}),
            ...(request.status !== undefined ? { status: request.status } : {}),
            nextRunAt: mergedStatus === ScheduledTaskStatus.ENABLED
                ? computeNextRunAt({
                    cronExpression: request.cronExpression ?? existing.cronExpression,
                    timezone: request.timezone ?? existing.timezone,
                })
                : null,
            updated: new Date().toISOString(),
        }

        const saved = await scheduledTaskRepo().save(updatedTask)

        if (saved.status === ScheduledTaskStatus.ENABLED) {
            await syncSchedule(saved)
        }
        else {
            await scheduler.cancel(getJobName(saved.id))
        }

        return saved
    },

    async delete({ id, projectId, platformId }: GetOneParams): Promise<void> {
        await scheduledTaskService.getOneOrThrow({ id, projectId, platformId })
        await scheduler.cancel(getJobName(id))
        await scheduledTaskRepo().delete({ id, projectId, platformId })
    },

    async triggerNow({ id, projectId, platformId }: GetOneParams): Promise<Execution> {
        const task = await scheduledTaskService.getOneOrThrow({ id, projectId, platformId })
        return dispatchExecution(task)
    },

    /**
     * Boot path: the in-process scheduler loses all registrations on restart,
     * so re-register every ENABLED task from the DB and refresh its nextRunAt.
     * One bad item must not abort the boot — not a bad row, and not even a
     * transient DB failure listing the rows.
     */
    async reRegisterEnabledSchedules({ log }: { log: FastifyBaseLogger }): Promise<{ registered: number, skipped: number, total: number }> {
        let tasks: ScheduledTask[] = []
        try {
            tasks = await scheduledTaskRepo().findBy({ status: ScheduledTaskStatus.ENABLED })
        }
        catch (error) {
            log.error({ error }, '[scheduledTaskService#reRegisterEnabledSchedules] Listing enabled tasks failed, skipping schedule restore')
            return { registered: 0, skipped: 0, total: 0 }
        }
        let registered = 0
        let skipped = 0
        for (const task of tasks) {
            try {
                // Compute first: a corrupt cron skips before anything is
                // registered, so the log line below always tells the truth.
                const nextRunAt = computeNextRunAt({ cronExpression: task.cronExpression, timezone: task.timezone })
                await syncSchedule(task)
                await scheduledTaskRepo().update({ id: task.id }, { nextRunAt })
                registered += 1
            }
            catch (error) {
                log.warn({ error, task: { id: task.id } }, '[scheduledTaskService#reRegisterEnabledSchedules] Skipping schedule that failed to register')
                skipped += 1
            }
        }
        return { registered, skipped, total: tasks.length }
    },
}

function getJobName(taskId: string): string {
    return `user-task-${taskId}`
}

function computeNextRunAt({ cronExpression, timezone }: { cronExpression: string, timezone: string }): string {
    try {
        return cronParser.computeNextTick({ cronExpression, timezone }).toISOString()
    }
    catch {
        // Surfaced as 4xx (not a raw 500): callers either fail the write
        // before persisting, or fall back to the best-effort variant below.
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: { message: `Invalid cron expression: ${cronExpression}` },
        })
    }
}

function computeNextRunAtOrNull({ cronExpression, timezone }: { cronExpression: string, timezone: string }): string | null {
    try {
        return computeNextRunAt({ cronExpression, timezone })
    }
    catch {
        return null
    }
}

async function syncSchedule(task: ScheduledTask): Promise<void> {
    const jobName = getJobName(task.id)
    await scheduler.cron({
        name: jobName,
        cronExpression: task.cronExpression,
        // Must match computeNextRunAt's timezone, or the displayed next run
        // disagrees with the actual fire time for non-UTC tasks.
        timezone: task.timezone,
        fn: async () => {
            await dispatchExecution(task)
        },
    })
}

async function dispatchExecution(task: ScheduledTask): Promise<Execution> {
    const execution = await executionService.create({
        prompt: task.prompt,
        metadata: {
            scheduledTaskId: task.id,
            cronExpression: task.cronExpression,
            timezone: task.timezone,
        },
        projectId: task.projectId,
        platformId: task.platformId,
    })

    // Re-read: the registration snapshot may be stale (an update or disable
    // can land mid-flight). A corrupt stored cron must not turn an
    // already-created execution into a 500 either.
    const fresh = await scheduledTaskRepo().findOneBy({ id: task.id })
    const nextRunAt = !isNil(fresh) && fresh.status === ScheduledTaskStatus.ENABLED
        ? computeNextRunAtOrNull({ cronExpression: fresh.cronExpression, timezone: fresh.timezone })
        : null
    await scheduledTaskRepo().update({ id: task.id }, {
        lastRunAt: new Date().toISOString(),
        nextRunAt,
    })
    return execution
}

type CreateParams = {
    request: CreateScheduledTaskRequest
    projectId: ProjectId
    platformId: PlatformId
}

type GetOneParams = {
    id: string
    projectId: ProjectId
    platformId: PlatformId
}

type ListParams = {
    projectId: ProjectId
    platformId: PlatformId
}

type UpdateParams = {
    id: string
    projectId: ProjectId
    platformId: PlatformId
    request: UpdateScheduledTaskRequest
}
