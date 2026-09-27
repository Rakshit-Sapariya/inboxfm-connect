import { FastifyPluginAsync } from 'fastify'
import { triggerBindingController } from './trigger-binding.controller'
import { triggerBindingService } from './trigger-binding.service'

export const triggerBindingModule: FastifyPluginAsync = async (app) => {
    // Same restart-restore as scheduled tasks (scheduler entries only — engine
    // ON_ENABLE hooks are not re-fired on boot).
    const { registered, skipped, total } = await triggerBindingService.reRegisterEnabledSchedules({ log: app.log })
    app.log.info({ registered, skipped, total }, '[triggerBindingModule] Re-registered schedules on boot')
    await app.register(triggerBindingController, { prefix: '/v1/trigger-bindings' })
}
