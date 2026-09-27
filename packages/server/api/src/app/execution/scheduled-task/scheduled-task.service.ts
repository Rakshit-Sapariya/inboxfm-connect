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
     * One bad cron must not abort the boot — failures are logged per task.
     */
    async reRegisterEnabledSchedules({ log }: { log: FastifyBaseLogger }): Promise<{ tasks: number }> {
        const tasks = await scheduledTaskRepo().findBy({ status: ScheduledTaskStatus.ENABLED })
        let registered = 0
        for (const task of tasks) {
            try {
                await syncSchedule(task)
                await scheduledTaskRepo().update({ id: task.id }, {
                    nextRunAt: computeNextRunAt({ cronExpression: task.cronExpression, timezone: task.timezone }),
                })
                registered += 1
            }
            catch (error) {
                log.warn({ error, task: { id: task.id } }, '[scheduledTaskService#reRegisterEnabledSchedules] Skipping schedule that failed to register')
            }
        }
        return { tasks: registered }
    },
}

function getJobName(taskId: string): string {
    return `user-task-${taskId}`
}

function computeNextRunAt({ cronExpression, timezone }: { cronExpression: string, timezone: string }): string {
    return cronParser.computeNextTick({ cronExpression, timezone }).toISOString()
}

async function syncSchedule(task: ScheduledTask): Promise<void> {
    const jobName = getJobName(task.id)
    await scheduler.cron({
        name: jobName,
        cronExpression: task.cronExpression,
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

    // Best-effort: a corrupt stored cron (written before create/update
    // validation existed) must not turn an already-created execution into a 500.
    let nextRunAt: string | null = null
    try {
        nextRunAt = computeNextRunAt({ cronExpression: task.cronExpression, timezone: task.timezone })
    }
    catch {
        nextRunAt = null
    }
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
