import { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FilterOperator } from '@inboxfm-connect/shared'
import { recordService } from '../../../../src/app/tables/record/record.service'
import { db } from '../../../helpers/db'
import {
    createMockCell,
    createMockField,
    createMockRecord,
    createMockTable,
} from '../../../helpers/mocks'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

/**
 * Service-level coverage for record listing (Issue #157).
 *
 * These drive `recordService.list` directly rather than over HTTP on purpose:
 * `tablesModule` is commented out in `app.ts`, so `/v1/records` is not mounted
 * and every HTTP-level record spec in this directory is `describe.skip`. Testing
 * the service keeps the pagination/filter contract executable today, and it
 * survives re-enabling the route unchanged.
 */
let app: FastifyInstance | null = null
let ctx: TestContext

beforeAll(async () => {
    app = await setupTestEnvironment({ fresh: true })
})

afterAll(async () => {
    await teardownTestEnvironment()
})

beforeEach(async () => {
    ctx = await createTestContext(app!)
})

async function seedTable(records: Array<{ value?: string | null, noCell?: boolean }>): Promise<{
    tableId: string
    fieldId: string
    recordIds: string[]
}> {
    const table = await db.save('table', createMockTable({ projectId: ctx.project.id }))
    const field = await db.save('field', createMockField({ tableId: table.id, projectId: ctx.project.id }))

    const recordIds: string[] = []
    for (const [index, spec] of records.entries()) {
        // The mocks randomise created/value, so both are overridden here:
        // deterministic, distinct timestamps keep the seek cursor stable.
        const record = await db.save('record', {
            ...createMockRecord({ tableId: table.id, projectId: ctx.project.id }),
            created: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
        })
        recordIds.push(record.id)
        if (!spec.noCell) {
            await db.save('cell', {
                ...createMockCell({ recordId: record.id, fieldId: field.id, projectId: ctx.project.id }),
                value: spec.value ?? '',
            })
        }
    }
    return { tableId: table.id, fieldId: field.id, recordIds }
}

const list = (params: { tableId: string, limit: number, cursorRequest?: string | null, filters?: unknown[] | null }) =>
    recordService(app!.log).list({
        projectId: ctx.project.id,
        filters: (params.filters ?? null) as never,
        limit: params.limit,
        cursorRequest: params.cursorRequest ?? null,
    })

describe('recordService.list pagination (Issue #157)', () => {
    it('returns a bounded page and a next cursor when more records exist', async () => {
        const { tableId } = await seedTable(Array.from({ length: 25 }, (_, i) => ({ value: `row-${i}` })))

        const page = await list({ tableId, limit: 10 })

        expect(page.data).toHaveLength(10)
        expect(page.next).not.toBeNull()
        expect(page.previous).toBeNull()
    })

    it('returns no next cursor on the final page', async () => {
        const { tableId } = await seedTable([{ value: 'a' }, { value: 'b' }, { value: 'c' }])

        const page = await list({ tableId, limit: 10 })

        expect(page.data).toHaveLength(3)
        expect(page.next).toBeNull()
    })

    it('walks the whole table through next cursors without gaps or repeats', async () => {
        const total = 23
        const { tableId } = await seedTable(Array.from({ length: total }, (_, i) => ({ value: `row-${i}` })))

        const seen: string[] = []
        let cursor: string | null = null
        let guard = 0

        do {
            const page: Awaited<ReturnType<typeof list>> = await list({ tableId, limit: 5, cursorRequest: cursor })
            seen.push(...page.data.map((record) => record.id))
            cursor = page.next
            guard += 1
        } while (cursor !== null && guard < 20)

        expect(seen).toHaveLength(total)
        expect(new Set(seen).size).toBe(total)
    })

    it('applies the limit to the filtered set, not the whole table', async () => {
        const { tableId, fieldId } = await seedTable([
            { value: 'keep' },
            { value: 'keep' },
            { value: 'drop' },
            { value: 'drop' },
            { value: 'drop' },
        ])

        const page = await list({
            tableId,
            limit: 10,
            filters: [{ fieldId, operator: FilterOperator.EQ, value: 'keep' }],
        })

        // Two matches exist; the three non-matching rows must not consume page space.
        expect(page.data).toHaveLength(2)
        expect(page.next).toBeNull()
        for (const record of page.data) {
            expect(record.cells[fieldId].value).toBe('keep')
        }
    })

    it('pages correctly within a filtered set', async () => {
        const { tableId, fieldId } = await seedTable(
            Array.from({ length: 12 }, (_, i) => ({ value: i < 7 ? 'keep' : 'drop' }))
        )

        const first = await list({
            tableId,
            limit: 3,
            filters: [{ fieldId, operator: FilterOperator.EQ, value: 'keep' }],
        })
        expect(first.data).toHaveLength(3)
        expect(first.next).not.toBeNull()

        const second = await list({
            tableId,
            limit: 3,
            cursorRequest: first.next,
            filters: [{ fieldId, operator: FilterOperator.EQ, value: 'keep' }],
        })
        expect(second.data).toHaveLength(3)

        const third = await list({
            tableId,
            limit: 3,
            cursorRequest: second.next,
            filters: [{ fieldId, operator: FilterOperator.EQ, value: 'keep' }],
        })
        expect(third.data).toHaveLength(1)
        expect(third.next).toBeNull()

        const ids = [...first.data, ...second.data, ...third.data].map((record) => record.id)
        expect(new Set(ids).size).toBe(7)
    })
})

describe('recordService.list filters pushed to SQL (Issue #157)', () => {
    it('EQ matches only the equal value', async () => {
        const { tableId, fieldId } = await seedTable([{ value: 'a' }, { value: 'b' }, { value: 'a' }])
        const page = await list({ tableId, limit: 10, filters: [{ fieldId, operator: FilterOperator.EQ, value: 'a' }] })
        expect(page.data).toHaveLength(2)
    })

    it('NEQ excludes the equal value and includes records with no cell', async () => {
        const { tableId, fieldId } = await seedTable([
            { value: 'a' },
            { value: 'b' },
            { noCell: true },
        ])
        const page = await list({ tableId, limit: 10, filters: [{ fieldId, operator: FilterOperator.NEQ, value: 'a' }] })
        expect(page.data).toHaveLength(2)
        expect(page.data.some((record) => record.cells[fieldId].value === 'a')).toBe(false)
    })

    it('EXISTS matches a non-empty cell only', async () => {
        const { tableId, fieldId } = await seedTable([
            { value: 'x' },
            { value: '' },
            { noCell: true },
        ])
        const page = await list({ tableId, limit: 10, filters: [{ fieldId, operator: FilterOperator.EXISTS }] })
        expect(page.data).toHaveLength(1)
        expect(page.data[0].cells[fieldId].value).toBe('x')
    })

    it('NOT_EXISTS matches empty and missing cells', async () => {
        const { tableId, fieldId } = await seedTable([
            { value: 'x' },
            { value: '' },
            { noCell: true },
        ])
        const page = await list({ tableId, limit: 10, filters: [{ fieldId, operator: FilterOperator.NOT_EXISTS }] })
        expect(page.data).toHaveLength(2)
    })

    it('CO is a case-insensitive substring match', async () => {
        const { tableId, fieldId } = await seedTable([
            { value: 'Hello World' },
            { value: 'goodbye' },
        ])
        const page = await list({ tableId, limit: 10, filters: [{ fieldId, operator: FilterOperator.CO, value: 'hello' }] })
        expect(page.data).toHaveLength(1)
        expect(page.data[0].cells[fieldId].value).toBe('Hello World')
    })

    it('ANDs multiple filters', async () => {
        const { tableId, fieldId } = await seedTable([
            { value: 'keep' },
            { value: 'drop' },
        ])

        const page = await list({
            tableId,
            limit: 10,
            filters: [
                { fieldId, operator: FilterOperator.EQ, value: 'keep' },
                { fieldId, operator: FilterOperator.CO, value: 'ee' },
            ],
        })
        expect(page.data).toHaveLength(1)
    })

    it('ignores a filter for an unknown field rather than widening the result', async () => {
        const { tableId } = await seedTable([{ value: 'a' }, { value: 'b' }])
        const page = await list({
            tableId,
            limit: 10,
            filters: [{ fieldId: 'field_does_not_exist', operator: FilterOperator.EQ, value: 'a' }],
        })
        // An unknown field must not match everything.
        expect(page.data).toHaveLength(2)
    })

    it('returns every record when no filters are supplied', async () => {
        const { tableId } = await seedTable([{ value: 'a' }, { value: 'b' }, { value: 'c' }])
        const page = await list({ tableId, limit: 10, filters: null })
        expect(page.data).toHaveLength(3)
    })
})

describe('recordService.list scoping', () => {
    it('never returns records from another project', async () => {
        const other = await createTestContext(app!)
        const { tableId } = await seedTable([{ value: 'mine' }])

        const foreignPage = await recordService(app!.log).list({
            tableId,
            projectId: other.project.id,
            filters: null,
            limit: 10,
            cursorRequest: null,
        })
        expect(foreignPage.data).toHaveLength(0)
    })
})
