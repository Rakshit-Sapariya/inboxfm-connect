import {
    BaseModelSchema,
    DateOrString,
    Nullable,
    NullableEnum,
    OptionalArrayFromQuery,
    OptionalBooleanFromQuery,
} from '../src/lib/base-model'
import * as z from 'zod/mini'

describe('OptionalBooleanFromQuery', () => {
    const schema = z.object({
        flag: OptionalBooleanFromQuery,
    })

    it('coerces string "true" and boolean true to true', () => {
        expect(schema.parse({ flag: 'true' }).flag).toBe(true)
        expect(schema.parse({ flag: true }).flag).toBe(true)
    })

    it('coerces string "false" and boolean false to false', () => {
        expect(schema.parse({ flag: 'false' }).flag).toBe(false)
        expect(schema.parse({ flag: false }).flag).toBe(false)
    })

    it('leaves undefined when omitted', () => {
        expect(schema.parse({}).flag).toBeUndefined()
        expect(schema.parse({ flag: undefined }).flag).toBeUndefined()
    })

    it('treats unrecognised strings as undefined rather than throwing or truthy', () => {
        expect(schema.parse({ flag: 'yes' }).flag).toBeUndefined()
        expect(schema.parse({ flag: 'no' }).flag).toBeUndefined()
        expect(schema.parse({ flag: '0' }).flag).toBeUndefined()
        expect(schema.parse({ flag: '1' }).flag).toBeUndefined()
        expect(schema.parse({ flag: 'TRUE' }).flag).toBeUndefined()
        expect(schema.parse({ flag: 'FALSE' }).flag).toBeUndefined()
        expect(schema.parse({ flag: '' }).flag).toBeUndefined()
    })
})

describe('OptionalArrayFromQuery', () => {
    const schema = z.object({
        items: OptionalArrayFromQuery(z.string()),
    })

    it('wraps a single scalar value into an array', () => {
        expect(schema.parse({ items: 'single' }).items).toEqual(['single'])
    })

    it('preserves an array of values', () => {
        expect(schema.parse({ items: ['a', 'b', 'c'] }).items).toEqual(['a', 'b', 'c'])
    })

    it('leaves undefined when omitted', () => {
        expect(schema.parse({}).items).toBeUndefined()
        expect(schema.parse({ items: undefined }).items).toBeUndefined()
    })

    it('rejects elements that fail item schema validation', () => {
        const numberSchema = z.object({
            ids: OptionalArrayFromQuery(z.number()),
        })
        expect(numberSchema.safeParse({ ids: 'not-a-number' }).success).toBe(false)
        expect(numberSchema.safeParse({ ids: [1, 'not-a-number'] }).success).toBe(false)
        expect(numberSchema.safeParse({ ids: [1, 2] }).data?.ids).toEqual([1, 2])
    })
})

describe('DateOrString', () => {
    const schema = z.object({
        timestamp: DateOrString,
    })

    it('transforms Date instance to ISO string', () => {
        const now = new Date('2026-10-03T00:00:00.000Z')
        const result = schema.parse({ timestamp: now })
        expect(result.timestamp).toBe('2026-10-03T00:00:00.000Z')
    })

    it('accepts string timestamps directly', () => {
        const iso = '2026-10-03T12:00:00.000Z'
        const result = schema.parse({ timestamp: iso })
        expect(result.timestamp).toBe(iso)
    })

    it('rejects non-date non-string values', () => {
        expect(schema.safeParse({ timestamp: 123456789 }).success).toBe(false)
        expect(schema.safeParse({ timestamp: true }).success).toBe(false)
        expect(schema.safeParse({ timestamp: {} }).success).toBe(false)
    })
})

describe('Nullable and NullableEnum', () => {
    enum TestStatus {
        ACTIVE = 'ACTIVE',
        INACTIVE = 'INACTIVE',
    }

    const testSchema = z.object({
        name: Nullable(z.string()),
        status: NullableEnum(TestStatus),
    })

    it('accepts valid values', () => {
        const result = testSchema.parse({ name: 'test', status: TestStatus.ACTIVE })
        expect(result.name).toBe('test')
        expect(result.status).toBe(TestStatus.ACTIVE)
    })

    it('accepts null values', () => {
        const result = testSchema.parse({ name: null, status: null })
        expect(result.name).toBeNull()
        expect(result.status).toBeNull()
    })

    it('accepts undefined/omitted values', () => {
        const result = testSchema.parse({})
        expect(result.name).toBeUndefined()
        expect(result.status).toBeUndefined()
    })

    it('rejects invalid enum values', () => {
        expect(testSchema.safeParse({ status: 'UNKNOWN' }).success).toBe(false)
    })
})

describe('BaseModelSchema', () => {
    const modelSchema = z.object(BaseModelSchema)

    it('parses valid base model with string dates', () => {
        const input = {
            id: 'id-123',
            created: '2026-01-01T00:00:00.000Z',
            updated: '2026-01-02T00:00:00.000Z',
        }
        expect(modelSchema.parse(input)).toEqual(input)
    })

    it('transforms Date instances in created and updated fields', () => {
        const d1 = new Date('2026-01-01T00:00:00.000Z')
        const d2 = new Date('2026-01-02T00:00:00.000Z')
        const result = modelSchema.parse({
            id: 'id-123',
            created: d1,
            updated: d2,
        })
        expect(result.created).toBe('2026-01-01T00:00:00.000Z')
        expect(result.updated).toBe('2026-01-02T00:00:00.000Z')
    })
})
