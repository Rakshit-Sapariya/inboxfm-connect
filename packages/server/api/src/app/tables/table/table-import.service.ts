import { ActivepiecesError, apId, chunk, ErrorCode, isNil, ProjectId, sanitizeObjectForPostgresql } from '@inboxfm-connect/core-utils'
import { Field, FieldType, ImportTableRequest, ImportTableResponse, TableImportFormat } from '@inboxfm-connect/shared'
import { parse } from 'csv-parse/sync'
import { FastifyBaseLogger } from 'fastify'
import { EntityManager } from 'typeorm'
import { transaction } from '../../core/db/transaction'
import { system } from '../../helper/system/system'
import { AppSystemProp } from '../../helper/system/system-props'
import { fieldService } from '../field/field.service'
import { CellEntity } from '../record/cell.entity'
import { RecordEntity } from '../record/record.entity'
import { TableEntity } from './table.entity'
import { tableService } from './table.service'

const MAX_IMPORT_ROWS = 500
const MAX_BATCH_SIZE = 50

const NUMERIC_REGEX = /^-?\d+(\.\d+)?$/
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)?)?$/

function isRecord(value: unknown): value is Record<string, unknown> {
    return !isNil(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseCsvContent(csvData: string): Record<string, string>[] {
    try {
        const parsed: unknown = parse(csvData, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            relax_quotes: true,
            relax_column_count: true,
        })
        if (!Array.isArray(parsed)) {
            return []
        }
        const stringRows: Record<string, string>[] = []
        for (const row of parsed) {
            if (isRecord(row)) {
                const strRow: Record<string, string> = {}
                for (const [k, v] of Object.entries(row)) {
                    strRow[k] = isNil(v) ? '' : String(v)
                }
                stringRows.push(strRow)
            }
        }
        return stringRows
    }
    catch (error) {
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: {
                message: `Failed to parse CSV: ${error instanceof Error ? error.message : 'Invalid CSV syntax'}`,
            },
        })
    }
}

function normalizeJsonRows(jsonData: unknown): Record<string, unknown>[] {
    if (!Array.isArray(jsonData)) {
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: {
                message: 'jsonData must be an array of objects',
            },
        })
    }
    const validatedRows: Record<string, unknown>[] = []
    for (let i = 0; i < jsonData.length; i++) {
        const item: unknown = jsonData[i]
        if (!isRecord(item)) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: {
                    message: `Row ${i + 1} in jsonData is not a valid object`,
                },
            })
        }
        validatedRows.push(item)
    }
    return validatedRows
}

function inferFieldType(values: unknown[]): FieldType {
    const nonNilValues = values
        .map((v) => (isNil(v) ? '' : String(v).trim()))
        .filter((v) => v.length > 0)

    if (nonNilValues.length === 0) {
        return FieldType.TEXT
    }

    const allNumeric = nonNilValues.every((v) => NUMERIC_REGEX.test(v) && !isNaN(Number(v)))
    if (allNumeric) {
        return FieldType.NUMBER
    }

    const allDate = nonNilValues.every((v) => ISO_DATE_REGEX.test(v) && !isNaN(new Date(v).getTime()))
    if (allDate) {
        return FieldType.DATE
    }

    return FieldType.TEXT
}

function findMatchingField(header: string, fields: Field[]): Field | undefined {
    const exactMatch = fields.find((f) => f.name === header)
    if (exactMatch) {
        return exactMatch
    }
    const lowerHeader = header.toLowerCase()
    const caseInsensitiveMatch = fields.find((f) => f.name.toLowerCase() === lowerHeader)
    if (caseInsensitiveMatch) {
        return caseInsensitiveMatch
    }
    return fields.find((f) => f.externalId === header)
}

export const tableImportService = {
    async importData({
        projectId,
        tableId,
        request,
        logger,
    }: ImportDataParams): Promise<ImportTableResponse> {
        const table = await tableService.getOneOrThrow({ projectId, id: tableId })

        let rawRows: Record<string, unknown>[] = []
        if (request.format === TableImportFormat.CSV) {
            if (isNil(request.csvData) || request.csvData.trim().length === 0) {
                throw new ActivepiecesError({
                    code: ErrorCode.VALIDATION,
                    params: { message: 'csvData is required for CSV format' },
                })
            }
            rawRows = parseCsvContent(request.csvData)
        }
        else if (request.format === TableImportFormat.JSON) {
            if (isNil(request.jsonData)) {
                throw new ActivepiecesError({
                    code: ErrorCode.VALIDATION,
                    params: { message: 'jsonData is required for JSON format' },
                })
            }
            rawRows = normalizeJsonRows(request.jsonData)
        }
        else {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: { message: `Unsupported format: ${request.format}` },
            })
        }

        if (rawRows.length === 0) {
            return {
                tableId: table.id,
                totalRows: 0,
                importedRecords: 0,
                createdFields: [],
            }
        }

        if (rawRows.length > MAX_IMPORT_ROWS) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: {
                    message: `Import exceeds maximum allowed rows of ${MAX_IMPORT_ROWS} (received ${rawRows.length})`,
                },
            })
        }

        const existingFields = await fieldService.getAll({ tableId: table.id, projectId })
        const headersSet = new Set<string>()
        for (const row of rawRows) {
            for (const key of Object.keys(row)) {
                headersSet.add(key)
            }
        }
        const incomingHeaders = Array.from(headersSet)

        const resolvedFieldsMap = new Map<string, Field>()
        const unmappedHeaders: string[] = []

        for (const header of incomingHeaders) {
            const matchedField = findMatchingField(header, existingFields)
            if (matchedField) {
                resolvedFieldsMap.set(header, matchedField)
            }
            else {
                unmappedHeaders.push(header)
            }
        }

        const autoCreate = request.autoCreateFields ?? false
        if (unmappedHeaders.length > 0 && !autoCreate) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: {
                    message: `Unknown column header(s): ${unmappedHeaders.map((h) => `"${h}"`).join(', ')}. Set autoCreateFields to true to create them automatically.`,
                },
            })
        }

        const createdFields: { id: string, name: string, type: FieldType }[] = []

        try {
            if (unmappedHeaders.length > 0 && autoCreate) {
                const newFields = await Promise.all(
                    unmappedHeaders.map(async (header) => {
                        const columnValues = rawRows.map((r) => r[header])
                        const inferredType = inferFieldType(columnValues)
                        return fieldService.createFromState({
                            projectId,
                            tableId: table.id,
                            field: {
                                name: header,
                                type: inferredType,
                                externalId: apId(),
                            },
                        })
                    }),
                )
                for (let i = 0; i < unmappedHeaders.length; i++) {
                    const header = unmappedHeaders[i]
                    const newField = newFields[i]
                    resolvedFieldsMap.set(header, newField)
                    createdFields.push({
                        id: newField.id,
                        name: newField.name,
                        type: newField.type,
                    })
                    logger.info({ field: { id: newField.id, name: newField.name, type: newField.type } }, '[tableImportService] Auto-created table field')
                }
            }

            const structuredRecords = rawRows.map((row) => {
                const cells: { fieldId: string, value: string }[] = []
                const seenFieldIds = new Set<string>()
                for (const [key, rawVal] of Object.entries(row)) {
                    const targetField = resolvedFieldsMap.get(key)
                    if (!targetField || seenFieldIds.has(targetField.id)) {
                        continue
                    }
                    seenFieldIds.add(targetField.id)
                    const sanitized = sanitizeObjectForPostgresql(rawVal)
                    const strValue = isNil(sanitized)
                        ? ''
                        : typeof sanitized === 'object'
                            ? JSON.stringify(sanitized)
                            : String(sanitized)
                    cells.push({
                        fieldId: targetField.id,
                        value: strValue,
                    })
                }
                return cells
            })

            await transaction(async (entityManager: EntityManager) => {
                await entityManager.getRepository(TableEntity).findOne({
                    where: { id: table.id, projectId },
                    lock: { mode: 'pessimistic_write' },
                })

                const currentCount = await entityManager.getRepository(RecordEntity).countBy({
                    tableId: table.id,
                    projectId,
                })

                const maxRecordsPerTable = system.getNumber(AppSystemProp.MAX_RECORDS_PER_TABLE) ?? 10000
                if (currentCount + rawRows.length > maxRecordsPerTable) {
                    throw new ActivepiecesError({
                        code: ErrorCode.VALIDATION,
                        params: {
                            message: `Importing ${rawRows.length} records would exceed table capacity of ${maxRecordsPerTable} (current: ${currentCount})`,
                        },
                    })
                }

                const batches = chunk(structuredRecords, MAX_BATCH_SIZE)
                const baseDate = new Date()

                for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                    const batch = batches[batchIndex]
                    const batchOffset = batchIndex * MAX_BATCH_SIZE
                    const recordInsertions = batch.map((_, index) => {
                        const created = new Date(baseDate.getTime() + batchOffset + index).toISOString()
                        return {
                            id: apId(),
                            tableId: table.id,
                            projectId,
                            created,
                            updated: created,
                        }
                    })

                    await entityManager.getRepository(RecordEntity).insert(recordInsertions)

                    const cellInsertions = batch.flatMap((cells, index) =>
                        cells.map((cell) => ({
                            id: apId(),
                            recordId: recordInsertions[index].id,
                            fieldId: cell.fieldId,
                            projectId,
                            value: cell.value,
                            created: recordInsertions[index].created,
                            updated: recordInsertions[index].updated,
                        })),
                    )

                    if (cellInsertions.length > 0) {
                        await entityManager.getRepository(CellEntity).insert(cellInsertions)
                    }
                }
            })
        }
        catch (error) {
            if (createdFields.length > 0) {
                for (const cf of createdFields) {
                    await fieldService.delete({ id: cf.id, projectId }).catch(() => {})
                }
            }
            throw error
        }

        return {
            tableId: table.id,
            totalRows: rawRows.length,
            importedRecords: rawRows.length,
            createdFields,
        }
    },
}

type ImportDataParams = {
    projectId: ProjectId
    tableId: string
    request: ImportTableRequest
    logger: FastifyBaseLogger
}
