import { apId, isNil, sanitizeObjectForPostgresql } from '@inboxfm-connect/core-utils'
import { CRITICAL_EXECUTION_EVENT_TYPES, ExecutionEvent, ExecutionEventType } from '@inboxfm-connect/shared'
import { Mutex } from 'async-mutex'
import { redisConnections } from '../database/redis-connections'
import { pubsub } from '../helper/pubsub'

const instanceId = apId()
const memorySequences = new Map<string, number>()
const memoryHistory = new Map<string, ExecutionEvent[]>()
const memoryListeners = new Map<string, Set<(event: ExecutionEvent) => void>>()
const executionSubscriptionMutexes = new Map<string, Mutex>()

function getExecutionSubscriptionMutex(executionId: string): Mutex {
    let mutex = executionSubscriptionMutexes.get(executionId)
    if (isNil(mutex)) {
        mutex = new Mutex()
        executionSubscriptionMutexes.set(executionId, mutex)
    }
    return mutex
}

const MAX_HISTORY_EVENTS = 1000
const EVENT_TTL_SECONDS = 3600

const executionEventService = {
    async emit({
        executionId,
        type,
        payload,
    }: {
        executionId: string
        type: ExecutionEventType
        payload: Record<string, unknown>
    }): Promise<ExecutionEvent> {
        const sanitizedPayload = sanitizeObjectForPostgresql(payload)
        const timestamp = new Date().toISOString()

        const seq = await this.nextSequence({ executionId })
        const eventId = `${executionId}:${seq}`

        const event: ExecutionEvent = {
            id: eventId,
            executionId,
            type,
            timestamp,
            payload: sanitizedPayload,
        }

        await this.storeEventHistory({ event })

        // Notify in-memory listeners
        const localListeners = memoryListeners.get(executionId)
        if (!isNil(localListeners)) {
            for (const listener of localListeners) {
                try {
                    listener(event)
                }
                catch (err) {
                    // Ignore listener errors
                }
            }
        }

        // Publish via Redis pubsub if available
        try {
            await pubsub.publish(`execution:${executionId}:events`, JSON.stringify({
                publisherId: instanceId,
                event,
            }))
        }
        catch (err) {
            // Ignore pubsub failures when Redis is offline/unconfigured (e.g. unit test mode)
        }

        return event
    },

    async getEventsSince({
        executionId,
        lastEventId,
    }: {
        executionId: string
        lastEventId?: string | null
    }): Promise<ExecutionEvent[]> {
        const lastSeq = this.parseSequenceFromId({ eventId: lastEventId })
        const events = await this.readEventHistory({ executionId })

        if (isNil(lastSeq)) {
            return events
        }

        return events.filter((e) => {
            const seq = this.parseSequenceFromId({ eventId: e.id })
            return !isNil(seq) && seq > lastSeq
        })
    },

    async subscribe({
        executionId,
        listener,
    }: {
        executionId: string
        listener: (event: ExecutionEvent) => void
    }): Promise<void> {
        const mutex = getExecutionSubscriptionMutex(executionId)
        await mutex.runExclusive(async () => {
            let listeners = memoryListeners.get(executionId)
            if (isNil(listeners)) {
                listeners = new Set()
                memoryListeners.set(executionId, listeners)
            }
            const isFirstListener = listeners.size === 0
            listeners.add(listener)

            if (isFirstListener) {
                try {
                    await pubsub.subscribe(`execution:${executionId}:events`, (message) => {
                        try {
                            const parsed = JSON.parse(message)
                            const isEnvelope = parsed && typeof parsed === 'object' && 'event' in parsed
                            const publisherId = isEnvelope ? parsed.publisherId : null
                            const candidate = isEnvelope ? parsed.event : parsed
                            const validation = ExecutionEvent.safeParse(candidate)
                            if (!validation.success) {
                                return
                            }
                            const event = validation.data

                            if (publisherId === instanceId) {
                                return
                            }

                            const activeListeners = memoryListeners.get(executionId)
                            if (!isNil(activeListeners)) {
                                for (const activeListener of activeListeners) {
                                    try {
                                        activeListener(event)
                                    }
                                    catch (err) {
                                        // Ignore listener errors
                                    }
                                }
                            }
                        }
                        catch (err) {
                            // Ignore malformed messages
                        }
                    })
                }
                catch (err) {
                    // Pubsub unavailable in offline unit tests
                }
            }
        })
    },

    async unsubscribe({
        executionId,
        listener,
    }: {
        executionId: string
        listener?: (event: ExecutionEvent) => void
    }): Promise<void> {
        const mutex = getExecutionSubscriptionMutex(executionId)
        await mutex.runExclusive(async () => {
            if (!isNil(listener)) {
                const listeners = memoryListeners.get(executionId)
                if (!isNil(listeners)) {
                    listeners.delete(listener)
                    if (listeners.size === 0) {
                        memoryListeners.delete(executionId)
                        try {
                            await pubsub.unsubscribe(`execution:${executionId}:events`)
                        }
                        catch (err) {
                            // Ignore pubsub failures
                        }
                    }
                }
            }
            else {
                memoryListeners.delete(executionId)
                try {
                    await pubsub.unsubscribe(`execution:${executionId}:events`)
                }
                catch (err) {
                    // Ignore pubsub failures
                }
            }
        })
    },

    async nextSequence({ executionId }: { executionId: string }): Promise<number> {
        try {
            const redis = await redisConnections.useExisting()
            if (!isNil(redis)) {
                const seqKey = `execution:${executionId}:seq`
                const seq = await redis.incr(seqKey)
                await redis.expire(seqKey, EVENT_TTL_SECONDS)
                return seq
            }
        }
        catch (err) {
            // Fallback to memory
        }

        const current = memorySequences.get(executionId) ?? 0
        const next = current + 1
        memorySequences.set(executionId, next)
        return next
    },

    async storeEventHistory({ event }: { event: ExecutionEvent }): Promise<void> {
        const key = `execution:${event.executionId}:events`
        const isCritical = CRITICAL_EXECUTION_EVENT_TYPES.includes(event.type)

        try {
            const redis = await redisConnections.useExisting()
            if (!isNil(redis)) {
                const len = await redis.llen(key)
                if (len >= MAX_HISTORY_EVENTS && !isCritical) {
                    return
                }
                await redis.rpush(key, JSON.stringify(event))
                await redis.expire(key, EVENT_TTL_SECONDS)
                return
            }
        }
        catch (err) {
            // Fallback to memory
        }

        const list = memoryHistory.get(event.executionId) ?? []
        if (list.length >= MAX_HISTORY_EVENTS && !isCritical) {
            return
        }
        list.push(event)
        memoryHistory.set(event.executionId, list)
    },

    async readEventHistory({ executionId }: { executionId: string }): Promise<ExecutionEvent[]> {
        const key = `execution:${executionId}:events`
        try {
            const redis = await redisConnections.useExisting()
            if (!isNil(redis)) {
                const rawItems = await redis.lrange(key, 0, -1)
                return rawItems.map((raw) => JSON.parse(raw) as ExecutionEvent)
            }
        }
        catch (err) {
            // Fallback to memory
        }

        return memoryHistory.get(executionId) ?? []
    },

    parseSequenceFromId({ eventId }: { eventId?: string | null }): number | null {
        if (isNil(eventId)) return null
        const parts = eventId.split(':')
        if (parts.length < 2) return null
        const seq = parseInt(parts[parts.length - 1], 10)
        return isNaN(seq) ? null : seq
    },
}

export { executionEventService }
