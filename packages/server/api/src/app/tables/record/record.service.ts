import { ActivepiecesError, apId, chunk, Cursor, ErrorCode, isNil, SeekPage } from '@inboxfm-connect/core-utils'
import { CreateRecordsRequest, Field, Filter, FilterOperator, PopulatedRecord, TableWebhookEventType, UpdateRecordRequest } from '@inboxfm-connect/shared'
import { FastifyBaseLogger } from 'fastify'
import { EntityManager, In } from 'typeorm'
import { repoFactory } from '../../core/db/repo-factory'
import { transaction } from '../../core/db/transaction'
import { buildPaginator } from '../../helper/pagination/build-paginator'
import { paginationHelper } from '../../helper/pagination/pagination-utils'
import { system } from '../../helper/system/system'
import { AppSystemProp } from '../../helper/system/system-props'
import { FieldEntity } from '../field/field.entity'
import { fieldService } from '../field/field.service'
import { CellEntity } from './cell.entity'
import { RecordEntity, RecordSchema } from './record.entity'

const MAX_BATCH_SIZE = 50

const recordRepo = repoFactory(RecordEntity)
const cellsRepo = repoFactory(CellEntity)

export const recordService = {
    async create({
        request,
        projectId,
        fields,
    }: CreateParams): Promise<PopulatedRecord[]> {
        await this.validateCount({ projectId, tableId: request.tableId }, request.records.length)
        const existingFields = fields ?? await fieldService.getAll({
            tableId: request.tableId,
            projectId,
        })

        const validRecords = request.records.map((recordData) =>
            recordData.filter((cellData) =>
                existingFields.some((field) => field.id === cellData.fieldId),
            ),
        )

        let insertedRecordIds: string[] = []
        insertedRecordIds = await transaction(async (entityManager: EntityManager) => {
            const batches = chunk(validRecords, MAX_BATCH_SIZE)
            const records: RecordSchema[] = []
            const insertedRecordIds: string[] = []

            for (const batch of batches) {
                const now = new Date(new Date().getTime() + records.length)
                const recordInsertions = prepareRecordInsertions(batch, request.tableId, projectId, now)
                await entityManager.getRepository(RecordEntity).insert(recordInsertions)

                const cellInsertions = prepareCellInsertions(batch, recordInsertions, projectId)
                await entityManager.getRepository(CellEntity).insert(cellInsertions)

                insertedRecordIds.push(...recordInsertions.map((r) => r.id))
            }

            return insertedRecordIds
        })

        const insertedRecords = await recordRepo().find({
            where: { id: In(insertedRecordIds), tableId: request.tableId, projectId },
            relations: ['cells'],
            order: {
                created: 'ASC',
            },
        })
        return formatRecordsAndFetchField({ records: insertedRecords, tableId: request.tableId, projectId, fields: existingFields })
    },

    async list({
        tableId,
        projectId,
        filters,
        limit,
        cursorRequest,
        fields: prefetchedFields,
    }: ListParams): Promise<SeekPage<PopulatedRecord>> {
        const fields = prefetchedFields ?? await fieldService.getAll({
            tableId,
            projectId,
        })

        const decodedCursor = paginationHelper.decodeCursor(cursorRequest)
        const paginator = buildPaginator({
            entity: RecordEntity,
            query: {
                limit,
                order: 'ASC',
                afterCursor: decodedCursor.nextCursor,
                beforeCursor: decodedCursor.previousCursor,
            },
        })

        const queryBuilder = recordRepo()
            .createQueryBuilder('record')
            .where('record.projectId = :projectId', { projectId })
            .andWhere('record.tableId = :tableId', { tableId })

        // Filters are pushed into SQL rather than applied in JS after the fetch.
        // The previous implementation loaded every record in the table, loaded
        // every cell, filtered in memory and only then sliced to `limit`, so a
        // MAX_RECORDS_PER_TABLE-sized table did unbounded work per request and
        // the `cursor` the controller passed was ignored entirely.
        applyFiltersToQuery({ queryBuilder, filters, fields })

        const { data: records, cursor } = await paginator.paginate(queryBuilder)

        // Only the page's records need their cells, so this IN query is bounded
        // by the page size instead of the table size.
        const recordIds = records.map((record) => record.id)
        const cells = recordIds.length === 0 ? [] : await cellsRepo().find({
            where: {
                projectId,
                fieldId: In(fields.map((field) => field.id)),
                recordId: In(recordIds),
            },
        })

        const cellsByRecordId = new Map<string, CellEntity[]>()
        for (const cell of cells) {
            const group = cellsByRecordId.get(cell.recordId)
            if (group) {
                group.push(cell)
            }
            else {
                cellsByRecordId.set(cell.recordId, [cell])
            }
        }
        for (const record of records) {
            record.cells = cellsByRecordId.get(record.id) ?? []
        }

        return paginationHelper.createPage<PopulatedRecord>(
            await formatRecordsAndFetchField({ records, tableId, projectId, fields }),
            cursor,
        )
    },

    async getById({
        id,
        projectId,
    }: GetByIdParams): Promise<PopulatedRecord> {
        const record = await recordRepo().findOne({
            where: { id, projectId },
            relations: ['cells'],
        })

        if (isNil(record)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'Record',
                    entityId: id,
                },
            })
        }

        const result = await formatRecordsAndFetchField({ records: [record], tableId: record.tableId, projectId: record.projectId })
        return result[0]
    },

    async update({
        id,
        projectId,
        request,
    }: UpdateParams): Promise<PopulatedRecord> {
        const { tableId } = request
        return transaction(async (entityManager: EntityManager) => {
            const record = await entityManager.getRepository(RecordEntity).findOne({
                where: { projectId, tableId, id },
            })

            if (isNil(record)) {
                throw new ActivepiecesError({
                    code: ErrorCode.ENTITY_NOT_FOUND,
                    params: {
                        entityType: 'Record',
                        entityId: id,
                    },
                })
            }

            if (request.cells && request.cells.length > 0) {
                const existingFields = await entityManager
                    .getRepository(FieldEntity)
                    .find({
                        where: { projectId, tableId },
                    })

                // Filter out cells with non-existing fields
                const validCells = request.cells.filter((cellData) =>
                    existingFields.some((field) => field.id === cellData.fieldId),
                )

                // Prepare cells for upsert
                const cellsToUpsert = validCells.map((cellData) => {
                    return {
                        recordId: id,
                        fieldId: cellData.fieldId,
                        projectId,
                        value: cellData.value ?? '',
                        id: apId(),
                    }
                })

                // Perform bulk upsert only for valid cells
                if (cellsToUpsert.length > 0) {
                    await entityManager
                        .getRepository(CellEntity)
                        .upsert(cellsToUpsert, ['projectId', 'fieldId', 'recordId'])
                }
            }

            // Fetch and return the updated record with full details
            const updatedRecord = await entityManager
                .getRepository(RecordEntity)
                .findOne({
                    where: { id, projectId, tableId },
                    relations: ['cells'],
                })

            if (isNil(updatedRecord)) {
                throw new ActivepiecesError({
                    code: ErrorCode.ENTITY_NOT_FOUND,
                    params: {
                        entityType: 'Record',
                        entityId: id,
                    },
                })
            }

            const result = await formatRecordsAndFetchField({ records: [updatedRecord], tableId: updatedRecord.tableId, projectId: updatedRecord.projectId })
            return result[0]
        })
    },

    async delete({
        ids,
        projectId,
    }: DeleteParams): Promise<PopulatedRecord[]> {
        const firstRecord = await recordRepo().findOne({
            where: { id: ids[0], projectId },
            select: ['tableId'],
        })
        if (isNil(firstRecord)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: { entityType: 'Record', entityId: ids[0] },
            })
        }

        const records = await recordRepo().find({
            where: { id: In(ids), projectId, tableId: firstRecord.tableId },
            relations: ['cells'],
        })

        await recordRepo().delete({
            id: In(ids),
            projectId,
            tableId: firstRecord.tableId,
        })

        if (records.length === 0) {
            return []
        }

        return formatRecordsAndFetchField({ records, tableId: firstRecord.tableId, projectId })
    },

    async deleteAll({
        tableId,
        projectId,
    }: DeleteAllParams): Promise<PopulatedRecord[]> {
        const deletedRecords = await transaction(async (entityManager: EntityManager) => {
            const records = await entityManager.getRepository(RecordEntity).find({
                where: { projectId, tableId },
                relations: ['cells'],
            })

            const recordIds = records.map((record) => record.id)

            if (recordIds.length > 0) {
                await entityManager.getRepository(RecordEntity).delete({
                    id: In(recordIds),
                    projectId,
                    tableId,
                })
            }

            return records
        })

        if (deletedRecords.length === 0) {
            return []
        }

        return formatRecordsAndFetchField({ records: deletedRecords, tableId, projectId })
    },

    async triggerWebhooks({
        projectId: _projectId,
        tableId: _tableId,
        eventType: _eventType,
        data: _data,
        logger: _logger,
        authorization: _authorization,
    }: TriggerWebhooksParams): Promise<void> {
        // No-op: Flow table webhooks are deprecated in headless platform.
    },

    async count({ projectId, tableId }: CountParams): Promise<number> {
        return recordRepo().count({
            where: { projectId, tableId },
        })
    },
    async validateCount(params: CountParams, insertCount: number): Promise<void> {
        const countRes = await this.count(params)
        if (countRes + insertCount > system.getNumberOrThrow(AppSystemProp.MAX_RECORDS_PER_TABLE)) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: {
                    message: `Max records per table reached: ${system.getNumberOrThrow(AppSystemProp.MAX_RECORDS_PER_TABLE)}`,
                },
            })
        }
    },
}

type CreateParams = {
    request: CreateRecordsRequest
    projectId: string
    logger: FastifyBaseLogger
    fields?: Field[]
}

type ListParams = {
    tableId: string
    projectId: string
    cursorRequest: Cursor | null
    limit: number
    filters: Filter[] | null
    fields?: Field[]
}

type GetByIdParams = {
    id: string
    projectId: string
}

type UpdateParams = {
    id: string
    projectId: string
    request: UpdateRecordRequest
}

type DeleteParams = {
    ids: string[]
    projectId: string
}

type DeleteAllParams = {
    tableId: string
    projectId: string
}

type TriggerWebhooksParams = {
    projectId: string
    tableId: string
    eventType: TableWebhookEventType
    data: Record<string, unknown>
    logger: FastifyBaseLogger
    authorization: string
}
type CountParams = {
    projectId: string
    tableId: string
}

type RecordInsertion = {
    id: string
    tableId: string
    projectId: string
    created: string
}

type CellInsertion = {
    id: string
    recordId: string
    fieldId: string
    projectId: string
    value: string
}

function prepareRecordInsertions(
    records: Array<Array<{ fieldId: string, value: string | null }>>,
    tableId: string,
    projectId: string,
    baseDate: Date,
): RecordInsertion[] {
    return records.map((_, index) => {
        const created = new Date(baseDate.getTime() + index).toISOString()
        return {
            tableId,
            projectId,
            created,
            id: apId(),
        }
    })
}

function prepareCellInsertions(
    records: Array<Array<{ fieldId: string, value: string | null }>>,
    recordInsertions: RecordInsertion[],
    projectId: string,
): CellInsertion[] {
    return records.flatMap((recordData, index) =>
        recordData.map((cellData) => {
            return {
                recordId: recordInsertions[index].id,
                fieldId: cellData.fieldId,
                projectId,
                value: cellData.value ?? '',
                id: apId(),
            }
        }),
    )
}

async function formatRecordsAndFetchField({ records, tableId, projectId, fields: prefetchedFields }: { records: RecordSchema[], tableId: string, projectId: string, fields?: Field[] }): Promise<PopulatedRecord[]> {
    const fields = prefetchedFields ?? await fieldService.getAll({
        tableId,
        projectId,
    })
    return formatRecords(records, fields)
}

function formatRecords(records: RecordSchema[], fields: Field[]): PopulatedRecord[] {
    const fieldsNamesMap: Record<string, string> = fields.reduce((acc, field) => {
        acc[field.id] = field.name
        return acc
    }, {} as Record<string, string>)
    return records.map((record) => {
        const cells = record.cells.reduce<PopulatedRecord['cells']>((acc, cell) => {
            acc[cell.fieldId] = {
                fieldName: fieldsNamesMap[cell.fieldId],
                value: cell.value,
                updated: cell.updated,
                created: cell.created,
            }
            return acc
        }, {})
        for (const field of fields) {
            if (!(field.id in cells)) {
                cells[field.id] = {
                    fieldName: field.name,
                    value: null,
                    updated: record.updated,
                    created: record.created,
                }
            }
        }
        return {
            ...record,
            cells,
        }
    })
}

/**
 * Push record filters down into SQL as correlated EXISTS subqueries against the
 * `cell` table, so the paginator only ever sees matching records and the LIMIT
 * applies to the filtered set.
 *
 * One EXISTS per filter keeps the semantics of the previous in-memory
 * evaluation: filters are ANDed, and a field with no cell row is treated as an
 * empty value (so `exists` is false and `not_exists` is true). Comparison
 * operators are applied to the text column, matching the `parseFloat` behaviour
 * the JS path used for GT/GTE/LT/LTE.
 *
 * Unknown field ids are ignored rather than matched, so a stale filter cannot
 * silently widen the result set.
 */
function applyFiltersToQuery({ queryBuilder, filters, fields }: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryBuilder: any
    filters: Filter[] | null
    fields: Field[]
}): void {
    if (!filters || filters.length === 0) {
        return
    }

    const knownFieldIds = new Set(fields.map((field) => field.id))

    for (const [index, filter] of filters.entries()) {
        if (!knownFieldIds.has(filter.fieldId)) {
            continue
        }

        const alias = `f${index}`
        const cellAlias = `c${index}`

        switch (filter.operator) {
            case FilterOperator.EXISTS:
            case FilterOperator.NOT_EXISTS: {
                const sub = `EXISTS (SELECT 1 FROM ${cellsRepo().metadata.tableName} ${cellAlias}
                    WHERE ${cellAlias}."recordId" = record.id
                      AND ${cellAlias}."fieldId" = :${alias}FieldId
                      AND ${cellAlias}.value IS NOT NULL
                      AND ${cellAlias}.value <> '')`
                queryBuilder.andWhere(filter.operator === FilterOperator.EXISTS ? sub : `NOT ${sub}`, {
                    [`${alias}FieldId`]: filter.fieldId,
                })
                break
            }
            default: {
                const comparison = FILTER_OPERATOR_TO_SQL[filter.operator]
                if (!comparison) {
                    continue
                }
                // CO is a case-insensitive substring match, as before.
                const predicate = filter.operator === FilterOperator.CO
                    ? `lower(${cellAlias}.value) LIKE lower(:${alias}Value)`
                    : `${cellAlias}.value ${comparison} :${alias}Value`
                const sub = `EXISTS (SELECT 1 FROM ${cellsRepo().metadata.tableName} ${cellAlias}
                    WHERE ${cellAlias}."recordId" = record.id
                      AND ${cellAlias}."fieldId" = :${alias}FieldId
                      AND ${predicate})`
                queryBuilder.andWhere(sub, {
                    [`${alias}FieldId`]: filter.fieldId,
                    [`${alias}Value`]: filter.operator === FilterOperator.CO ? `%${filter.value}%` : filter.value,
                })
                break
            }
        }
    }
}

const FILTER_OPERATOR_TO_SQL: Partial<Record<FilterOperator, string>> = {
    [FilterOperator.EQ]: '=',
    [FilterOperator.NEQ]: '<>',
    [FilterOperator.GT]: '>',
    [FilterOperator.GTE]: '>=',
    [FilterOperator.LT]: '<',
    [FilterOperator.LTE]: '<=',
}
