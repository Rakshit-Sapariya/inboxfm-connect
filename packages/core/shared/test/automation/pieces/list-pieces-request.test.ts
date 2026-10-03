import {
    ExactVersionType,
    GetPieceRequestParams,
    GetPieceRequestQuery,
    GetPieceRequestWithScopeParams,
    ListPiecesRequestQuery,
    PieceOrderBy,
    PieceSortBy,
    RegistryPiecesRequestQuery,
    SuggestionType,
    VersionType,
} from '../../../src/lib/automation/pieces/dto/piece-requests'
import { PieceCategory } from '../../../src/lib/automation/pieces/piece'
import { ApEdition } from '../../../src/lib/core/flag/flag'

/**
 * Contract suite for GET /v1/integrations query schema and piece request DTOs (Refs #130).
 *
 * Query-string parameters arrive over HTTP as strings or string arrays, so the two
 * most critical failure modes to guard against are:
 * 1. Query-string "false" inadvertently coercing to truthy (Boolean("false") === true),
 *    which would leak hidden or untagged pieces to callers that requested their omission.
 * 2. An out-of-range or malformed limit failing to 400 and triggering an unbounded catalog scan.
 */

type QueryInput = Record<string, unknown>

const parse = (query: QueryInput): ReturnType<typeof ListPiecesRequestQuery.safeParse> =>
    ListPiecesRequestQuery.safeParse(query)

const parsed = (query: QueryInput): ListPiecesRequestQuery => {
    const result = parse(query)
    if (!result.success) {
        throw new Error(`expected query to parse: ${JSON.stringify(query)}, errors: ${JSON.stringify(result.error.issues)}`)
    }
    return result.data
}

describe('ListPiecesRequestQuery — boolean flag coercion', () => {
    it('treats the string "false" as false, not truthy', () => {
        expect(parsed({ includeHidden: 'false' }).includeHidden).toBe(false)
        expect(parsed({ includeTags: 'false' }).includeTags).toBe(false)
    })

    it('treats the string "true" as true', () => {
        expect(parsed({ includeHidden: 'true' }).includeHidden).toBe(true)
        expect(parsed({ includeTags: 'true' }).includeTags).toBe(true)
    })

    it('treats boolean false and boolean true directly', () => {
        expect(parsed({ includeHidden: false }).includeHidden).toBe(false)
        expect(parsed({ includeTags: true }).includeTags).toBe(true)
    })

    it('leaves an omitted flag undefined so the service default applies', () => {
        const result = parsed({})
        expect(result.includeHidden).toBeUndefined()
        expect(result.includeTags).toBeUndefined()
    })

    it('distinguishes omitted from an explicit false for both flags', () => {
        expect(parsed({}).includeHidden).toBeUndefined()
        expect(parsed({ includeHidden: 'false' }).includeHidden).toBe(false)
        expect(parsed({}).includeTags).toBeUndefined()
        expect(parsed({ includeTags: 'false' }).includeTags).toBe(false)
    })

    it('treats an unrecognised flag value as omitted rather than truthy or fatal', () => {
        expect(parsed({ includeHidden: 'yes' }).includeHidden).toBeUndefined()
        expect(parsed({ includeHidden: '0' }).includeHidden).toBeUndefined()
        expect(parsed({ includeHidden: 'no' }).includeHidden).toBeUndefined()
        expect(parsed({ includeTags: 'TRUE' }).includeTags).toBeUndefined()
        expect(parsed({ includeTags: 'FALSE' }).includeTags).toBeUndefined()
    })

    it('keeps the two flags independent', () => {
        const result = parsed({ includeHidden: 'true', includeTags: 'false' })
        expect(result.includeHidden).toBe(true)
        expect(result.includeTags).toBe(false)
    })
})

describe('ListPiecesRequestQuery — limit boundaries', () => {
    it('accepts the documented lower and upper bounds', () => {
        expect(parsed({ limit: '1' }).limit).toBe(1)
        expect(parsed({ limit: 1 }).limit).toBe(1)
        expect(parsed({ limit: '500' }).limit).toBe(500)
        expect(parsed({ limit: 500 }).limit).toBe(500)
    })

    it('coerces a numeric query string to a number', () => {
        const result = parsed({ limit: '25' })
        expect(result.limit).toBe(25)
        expect(typeof result.limit).toBe('number')
    })

    it('rejects a limit below the minimum', () => {
        expect(parse({ limit: '0' }).success).toBe(false)
        expect(parse({ limit: 0 }).success).toBe(false)
        expect(parse({ limit: '-5' }).success).toBe(false)
        expect(parse({ limit: -5 }).success).toBe(false)
    })

    it('rejects a limit above the maximum', () => {
        expect(parse({ limit: '501' }).success).toBe(false)
        expect(parse({ limit: 501 }).success).toBe(false)
        expect(parse({ limit: '1000' }).success).toBe(false)
    })

    it('rejects a non-integer limit', () => {
        expect(parse({ limit: '10.5' }).success).toBe(false)
        expect(parse({ limit: 10.5 }).success).toBe(false)
    })

    it('rejects a non-numeric limit rather than falling back to unbounded', () => {
        expect(parse({ limit: 'many' }).success).toBe(false)
        expect(parse({ limit: '' }).success).toBe(false)
        expect(parse({ limit: 'NaN' }).success).toBe(false)
    })

    it('leaves an omitted limit undefined', () => {
        expect(parsed({}).limit).toBeUndefined()
    })
})

describe('ListPiecesRequestQuery — sort contract', () => {
    it('accepts every declared sort field', () => {
        for (const sortBy of Object.values(PieceSortBy)) {
            expect(parse({ sortBy }).success).toBe(true)
            expect(parsed({ sortBy }).sortBy).toBe(sortBy)
        }
    })

    it('accepts both order directions', () => {
        expect(parse({ orderBy: PieceOrderBy.ASC }).success).toBe(true)
        expect(parsed({ orderBy: PieceOrderBy.ASC }).orderBy).toBe(PieceOrderBy.ASC)
        expect(parse({ orderBy: PieceOrderBy.DESC }).success).toBe(true)
        expect(parsed({ orderBy: PieceOrderBy.DESC }).orderBy).toBe(PieceOrderBy.DESC)
    })

    it('rejects an unknown sort field or order direction', () => {
        expect(parse({ sortBy: 'NOT_A_FIELD' }).success).toBe(false)
        expect(parse({ orderBy: 'sideways' }).success).toBe(false)
    })

    it('is case-sensitive on the enum values, matching the API contract', () => {
        expect(parse({ sortBy: 'name' }).success).toBe(false)
        expect(parse({ sortBy: PieceSortBy.NAME }).success).toBe(true)
        expect(parse({ orderBy: 'asc' }).success).toBe(false)
        expect(parse({ orderBy: PieceOrderBy.ASC }).success).toBe(true)
    })
})

describe('ListPiecesRequestQuery — cursor and filters', () => {
    it('accepts an opaque cursor string', () => {
        expect(parsed({ cursor: 'eyJpZCI6MX0=' }).cursor).toBe('eyJpZCI6MX0=')
    })

    it('accepts numeric-looking and empty string cursors as opaque strings', () => {
        expect(parse({ cursor: '123' }).success).toBe(true)
        expect(parsed({ cursor: '123' }).cursor).toBe('123')
        expect(parse({ cursor: '' }).success).toBe(true)
        expect(parsed({ cursor: '' }).cursor).toBe('')
    })

    it('rejects non-string cursor types', () => {
        expect(parse({ cursor: 123 }).success).toBe(false)
        expect(parse({ cursor: true }).success).toBe(false)
        expect(parse({ cursor: {} }).success).toBe(false)
        expect(parse({ cursor: [] }).success).toBe(false)
    })

    it('accepts a release version and rejects a malformed one', () => {
        expect(parse({ release: '1.2.3' }).success).toBe(true)
        expect(parsed({ release: '1.2.3' }).release).toBe('1.2.3')
        expect(parse({ release: '^1.0.0' }).success).toBe(false)
        expect(parse({ release: '~1.0.0' }).success).toBe(false)
        expect(parse({ release: 'latest' }).success).toBe(false)
        expect(parse({ release: 'v1.2.3' }).success).toBe(false)
    })

    it('accepts a known edition and rejects an unknown one', () => {
        expect(parse({ edition: ApEdition.CLOUD }).success).toBe(true)
        expect(parse({ edition: ApEdition.COMMUNITY }).success).toBe(true)
        expect(parse({ edition: ApEdition.ENTERPRISE }).success).toBe(true)
        expect(parse({ edition: 'ULTIMATE_EDITION' }).success).toBe(false)
    })

    it('normalises a single categories value into an array', () => {
        expect(parsed({ categories: PieceCategory.ARTIFICIAL_INTELLIGENCE }).categories)
            .toEqual([PieceCategory.ARTIFICIAL_INTELLIGENCE])
    })

    it('keeps a repeated categories value as an array', () => {
        expect(parsed({ categories: [PieceCategory.ARTIFICIAL_INTELLIGENCE, PieceCategory.SALES_AND_CRM] }).categories)
            .toEqual([PieceCategory.ARTIFICIAL_INTELLIGENCE, PieceCategory.SALES_AND_CRM])
    })

    it('rejects invalid category enum values', () => {
        expect(parse({ categories: 'NON_EXISTENT_CATEGORY' }).success).toBe(false)
        expect(parse({ categories: [PieceCategory.ARTIFICIAL_INTELLIGENCE, 'INVALID'] }).success).toBe(false)
    })

    it('accepts declared suggestion types and rejects invalid ones', () => {
        for (const suggestionType of Object.values(SuggestionType)) {
            expect(parse({ suggestionType }).success).toBe(true)
            expect(parsed({ suggestionType }).suggestionType).toBe(suggestionType)
        }
        expect(parse({ suggestionType: 'UNKNOWN_SUGGESTION' }).success).toBe(false)
    })

    it('preserves optional search, project, and locale fields', () => {
        const query = {
            searchQuery: 'slack',
            projectId: 'proj_123',
            locale: 'fr',
        }
        const result = parsed(query)
        expect(result.searchQuery).toBe('slack')
        expect(result.projectId).toBe('proj_123')
        expect(result.locale).toBe('fr')
    })
})

describe('Auxiliary Piece Request Schemas', () => {
    describe('ExactVersionType and VersionType regex validation', () => {
        it('validates exact semantic versions', () => {
            expect(ExactVersionType.safeParse('1.0.0').success).toBe(true)
            expect(ExactVersionType.safeParse('0.12.34').success).toBe(true)
            expect(ExactVersionType.safeParse('^1.0.0').success).toBe(false)
            expect(ExactVersionType.safeParse('~1.0.0').success).toBe(false)
            expect(ExactVersionType.safeParse('v1.0.0').success).toBe(false)
            expect(ExactVersionType.safeParse('1.0').success).toBe(false)
        })

        it('validates version ranges with caret and tilde prefixes', () => {
            expect(VersionType.safeParse('1.0.0').success).toBe(true)
            expect(VersionType.safeParse('^1.0.0').success).toBe(true)
            expect(VersionType.safeParse('~0.1.2').success).toBe(true)
            expect(VersionType.safeParse('latest').success).toBe(false)
            expect(VersionType.safeParse('v1.0.0').success).toBe(false)
        })
    })

    describe('RegistryPiecesRequestQuery', () => {
        it('parses valid release and edition', () => {
            const input = {
                release: '0.86.1',
                edition: ApEdition.COMMUNITY,
            }
            expect(RegistryPiecesRequestQuery.safeParse(input).success).toBe(true)
        })

        it('rejects missing or invalid fields', () => {
            expect(RegistryPiecesRequestQuery.safeParse({ release: '0.86.1' }).success).toBe(false)
            expect(RegistryPiecesRequestQuery.safeParse({ edition: ApEdition.COMMUNITY }).success).toBe(false)
            expect(RegistryPiecesRequestQuery.safeParse({ release: '^0.86.1', edition: ApEdition.COMMUNITY }).success).toBe(false)
        })
    })

    describe('GetPieceRequestQuery', () => {
        it('parses optional version, projectId, and locale', () => {
            expect(GetPieceRequestQuery.safeParse({}).success).toBe(true)
            expect(GetPieceRequestQuery.safeParse({ version: '^1.2.0', projectId: 'p1', locale: 'en' }).success).toBe(true)
            expect(GetPieceRequestQuery.safeParse({ version: 'invalid-version' }).success).toBe(false)
        })
    })

    describe('GetPieceRequestWithScopeParams and GetPieceRequestParams', () => {
        it('validates name and scope params', () => {
            expect(GetPieceRequestWithScopeParams.safeParse({ name: 'slack', scope: 'platform' }).success).toBe(true)
            expect(GetPieceRequestWithScopeParams.safeParse({ name: 'slack' }).success).toBe(false)
            expect(GetPieceRequestParams.safeParse({ name: 'slack' }).success).toBe(true)
            expect(GetPieceRequestParams.safeParse({}).success).toBe(false)
        })
    })
})
