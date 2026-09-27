import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { scheduledTaskController } from './scheduled-task.controller'
import { scheduledTaskService } from './scheduled-task.service'

export const scheduledTaskModule: FastifyPluginAsyncZod = async (app) => {
    // The in-process scheduler loses all registrations on restart — restore
    // ENABLED tasks from the DB before serving traffic.
    const { registered, skipped, total } = await scheduledTaskService.reRegisterEnabledSchedules({ log: app.log })
    app.log.info({ registered, skipped, total }, '[scheduledTaskModule] Re-registered schedules on boot')
    await app.register(scheduledTaskController, { prefix: '/v1/scheduled-tasks' })
}
