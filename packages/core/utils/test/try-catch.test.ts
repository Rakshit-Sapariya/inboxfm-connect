import { tryCatch, tryCatchSync } from '../src/lib/try-catch'

/**
 * Contract tests for tryCatch and tryCatchSync error-handling primitives (Refs #141).
 *
 * All callers across server, engine, and CLI branch on `error !== null`
 * rather than throwing exceptions. The critical contracts to verify are:
 * 1. Discriminated result shape: { data, error: null } on success, { data: null, error } on failure.
 * 2. Falsy returned/resolved values (0, false, empty string, null, undefined) must be treated
 *    as successful data, not misinterpreted as errors or failures.
 * 3. Non-Error thrown/rejected values (strings, numbers, objects) are preserved intact.
 */

describe('tryCatch', () => {
    it('returns resolved data with null error on success', async () => {
        const result = await tryCatch(async () => 'hello world')
        expect(result).toEqual({ data: 'hello world', error: null })
    })

    it('captures an Error rejection as error with null data', async () => {
        const failure = new Error('network timeout')
        const result = await tryCatch(async () => {
            throw failure
        })
        expect(result.data).toBeNull()
        expect(result.error).toBe(failure)
    })

    it('preserves falsy resolved values as successful data', async () => {
        expect(await tryCatch(async () => 0)).toEqual({ data: 0, error: null })
        expect(await tryCatch(async () => '')).toEqual({ data: '', error: null })
        expect(await tryCatch(async () => false)).toEqual({ data: false, error: null })
        expect(await tryCatch(async () => null)).toEqual({ data: null, error: null })
        expect(await tryCatch(async () => undefined)).toEqual({ data: undefined, error: null })
    })

    it('preserves thrown non-Error values as error', async () => {
        const result = await tryCatch(async () => {
            throw 'string error message'
        })
        expect(result.data).toBeNull()
        expect(result.error).toBe('string error message')
    })

    it('waits for delayed promises before resolving', async () => {
        const result = await tryCatch(async () => {
            await new Promise((resolve) => setTimeout(resolve, 5))
            return 42
        })
        expect(result).toEqual({ data: 42, error: null })
    })

    it('captures synchronous throws inside the callback', async () => {
        const result = await tryCatch(() => {
            throw new Error('sync throw inside callback')
        })
        expect(result.data).toBeNull()
        expect(result.error).toBeInstanceOf(Error)
        if (result.error instanceof Error) {
            expect(result.error.message).toBe('sync throw inside callback')
        }
    })
})

describe('tryCatchSync', () => {
    it('returns value with null error on success', () => {
        const result = tryCatchSync(() => ({ success: true }))
        expect(result).toEqual({ data: { success: true }, error: null })
    })

    it('captures a throw as error with null data', () => {
        const err = new Error('computation failure')
        const result = tryCatchSync(() => {
            throw err
        })
        expect(result.data).toBeNull()
        expect(result.error).toBe(err)
    })

    it('preserves falsy returned values as successful data', () => {
        expect(tryCatchSync(() => 0)).toEqual({ data: 0, error: null })
        expect(tryCatchSync(() => '')).toEqual({ data: '', error: null })
        expect(tryCatchSync(() => false)).toEqual({ data: false, error: null })
        expect(tryCatchSync(() => null)).toEqual({ data: null, error: null })
        expect(tryCatchSync(() => undefined)).toEqual({ data: undefined, error: null })
    })

    it('preserves thrown non-Error values as error', () => {
        const result = tryCatchSync(() => {
            throw { code: 'CUSTOM_ERR', status: 500 }
        })
        expect(result.data).toBeNull()
        expect(result.error).toEqual({ code: 'CUSTOM_ERR', status: 500 })
    })

    it('discriminates cleanly on error alone regardless of data value', () => {
        const fail = tryCatchSync(() => {
            throw new Error('boom')
        })
        expect(fail.error).not.toBeNull()
        expect(fail.data).toBeNull()

        const succeedWithNull = tryCatchSync(() => null)
        expect(succeedWithNull.error).toBeNull()
        expect(succeedWithNull.data).toBeNull()
    })
})
