import { inspect } from 'util'
import { formatPieceError, tryCatch } from '@inboxfm-connect/core-utils'
import { EngineOperation, EngineOperationType, EngineResponse, EngineResponseStatus, ExecuteExtractPieceMetadataOperation, ExecutePropsOptions, ExecuteRefreshTokenAuthOperation, ExecuteToolOperation, ExecuteTriggerOperation, ExecuteValidateAuthOperation, ExecutionError, ExecutionErrorType, TriggerHookType } from '@inboxfm-connect/shared'
import { EngineConstants } from '../handler/context/engine-constants'
import { pieceHelper } from '../helper/piece-helper'
import { authRefreshOperation } from './auth-refresh.operation'
import { authValidationOperation } from './auth-validation.operation'
import { pieceMetadataOperation } from './piece-metadata.operation'
import { propertyOperation } from './property.operation'
import { triggerHookOperation } from './trigger-hook.operation'


function isExecuteExtractPieceMetadataOperation(operation: unknown): operation is ExecuteExtractPieceMetadataOperation {
    return typeof operation === 'object' && operation !== null && 'pieceName' in operation && 'pieceVersion' in operation
}

function isExecutePropsOptions(operation: unknown): operation is ExecutePropsOptions {
    return typeof operation === 'object' && operation !== null && 'propertyName' in operation && 'actionOrTriggerName' in operation
}

function isExecuteTriggerOperation(operation: unknown): operation is ExecuteTriggerOperation<TriggerHookType> {
    return typeof operation === 'object' && operation !== null && 'hookType' in operation
}

function isExecuteValidateAuthOperation(operation: unknown): operation is ExecuteValidateAuthOperation {
    return typeof operation === 'object' && operation !== null && 'piece' in operation && 'auth' in operation
}

function isExecuteRefreshTokenAuthOperation(operation: unknown): operation is ExecuteRefreshTokenAuthOperation {
    return typeof operation === 'object' && operation !== null && 'piece' in operation && 'auth' in operation
}

function isExecuteToolOperation(operation: unknown): operation is ExecuteToolOperation {
    return typeof operation === 'object' && operation !== null && 'actionName' in operation
}

export async function execute(operationType: EngineOperationType, operation: EngineOperation): Promise<EngineResponse<unknown>> {
    const result = await tryCatch(async () => {
        switch (operationType) {
            case EngineOperationType.EXTRACT_PIECE_METADATA: {
                if (!isExecuteExtractPieceMetadataOperation(operation)) {
                    throw new ExecutionError('Invalid operation payload', 'Invalid payload for EXTRACT_PIECE_METADATA', ExecutionErrorType.ENGINE)
                }
                return pieceMetadataOperation.extract(operation)
            }
            case EngineOperationType.EXECUTE_PROPERTY: {
                if (!isExecutePropsOptions(operation)) {
                    throw new ExecutionError('Invalid operation payload', 'Invalid payload for EXECUTE_PROPERTY', ExecutionErrorType.ENGINE)
                }
                return propertyOperation.execute(operation)
            }
            case EngineOperationType.EXECUTE_TRIGGER_HOOK: {
                if (!isExecuteTriggerOperation(operation)) {
                    throw new ExecutionError('Invalid operation payload', 'Invalid payload for EXECUTE_TRIGGER_HOOK', ExecutionErrorType.ENGINE)
                }
                return triggerHookOperation.execute(operation)
            }
            case EngineOperationType.EXECUTE_VALIDATE_AUTH: {
                if (!isExecuteValidateAuthOperation(operation)) {
                    throw new ExecutionError('Invalid operation payload', 'Invalid payload for EXECUTE_VALIDATE_AUTH', ExecutionErrorType.ENGINE)
                }
                return authValidationOperation.execute(operation)
            }
            case EngineOperationType.EXECUTE_REFRESH_TOKEN_AUTH: {
                if (!isExecuteRefreshTokenAuthOperation(operation)) {
                    throw new ExecutionError('Invalid operation payload', 'Invalid payload for EXECUTE_REFRESH_TOKEN_AUTH', ExecutionErrorType.ENGINE)
                }
                return authRefreshOperation.execute(operation)
            }
            case EngineOperationType.EXECUTE_TOOL: {
                if (!isExecuteToolOperation(operation)) {
                    throw new ExecutionError('Invalid operation payload', 'Invalid payload for EXECUTE_TOOL', ExecutionErrorType.ENGINE)
                }
                return pieceHelper.executeTool({
                    params: operation,
                    devPieces: EngineConstants.DEV_PIECES,
                })
            }
            default: {
                throw new ExecutionError('Unsupported operation type', `Unsupported operation type: ${operationType}`, ExecutionErrorType.ENGINE)
            }
        }
    })
    if (result.error) {
        console.error(result.error)
        return {
            response: undefined,
            status: EngineResponseStatus.INTERNAL_ERROR,
            error: JSON.stringify(formatPieceError(result.error, { raw: inspect(result.error) })),
        }
    }
    return result.data
}