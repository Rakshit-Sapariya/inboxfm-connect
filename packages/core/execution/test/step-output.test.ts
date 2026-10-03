import { FlowActionType } from '../src/lib/flows/actions/action'
import { FlowTriggerType } from '../src/lib/flows/triggers/trigger'
import {
    GenericStepOutput,
    LoopStepOutput,
    RouterStepOutput,
    StepOutputStatus,
} from '../src/lib/flow-run/execution/step-output'

/**
 * Unit tests for step output builder classes (Refs #141).
 *
 * Verifies the immutability contract across GenericStepOutput,
 * RouterStepOutput, and LoopStepOutput where all setter methods
 * return fresh instances without mutating intermediate state.
 */

describe('GenericStepOutput', () => {
    const createBaseOutput = (): GenericStepOutput<FlowActionType.CODE, { value: number }> =>
        new GenericStepOutput({
            type: FlowActionType.CODE,
            status: StepOutputStatus.RUNNING,
            input: { key: 'test' },
            output: { value: 10 },
            duration: 15,
            errorMessage: undefined,
        })

    it('initializes with constructor parameters', () => {
        const step = createBaseOutput()
        expect(step.type).toBe(FlowActionType.CODE)
        expect(step.status).toBe(StepOutputStatus.RUNNING)
        expect(step.input).toEqual({ key: 'test' })
        expect(step.output).toEqual({ value: 10 })
        expect(step.duration).toBe(15)
        expect(step.errorMessage).toBeUndefined()
    })

    it('returns a new instance from setStatus without mutating original', () => {
        const original = createBaseOutput()
        const updated = original.setStatus(StepOutputStatus.SUCCEEDED)

        expect(updated).not.toBe(original)
        expect(original.status).toBe(StepOutputStatus.RUNNING)
        expect(updated.status).toBe(StepOutputStatus.SUCCEEDED)
    })

    it('returns a new instance from setOutput without mutating original', () => {
        const original = createBaseOutput()
        const updated = original.setOutput({ value: 99 })

        expect(updated).not.toBe(original)
        expect(original.output).toEqual({ value: 10 })
        expect(updated.output).toEqual({ value: 99 })
    })

    it('returns a new instance from setErrorMessage without mutating original', () => {
        const original = createBaseOutput()
        const updated = original.setErrorMessage('failed to execute')

        expect(updated).not.toBe(original)
        expect(original.errorMessage).toBeUndefined()
        expect(updated.errorMessage).toBe('failed to execute')
    })

    it('returns a new instance from setDuration without mutating original', () => {
        const original = createBaseOutput()
        const updated = original.setDuration(120)

        expect(updated).not.toBe(original)
        expect(original.duration).toBe(15)
        expect(updated.duration).toBe(120)
    })

    it('chains multiple setters while preserving prior writes', () => {
        const step = createBaseOutput()
            .setStatus(StepOutputStatus.FAILED)
            .setErrorMessage('execution error')
            .setDuration(45)
            .setOutput({ value: 0 })

        expect(step.status).toBe(StepOutputStatus.FAILED)
        expect(step.errorMessage).toBe('execution error')
        expect(step.duration).toBe(45)
        expect(step.output).toEqual({ value: 0 })
        expect(step.input).toEqual({ key: 'test' })
    })

    it('preserves falsy output values without dropping them', () => {
        const base = new GenericStepOutput<FlowActionType.CODE, unknown>({
            type: FlowActionType.CODE,
            status: StepOutputStatus.SUCCEEDED,
            input: null,
        })

        expect(base.setOutput(0).output).toBe(0)
        expect(base.setOutput('').output).toBe('')
        expect(base.setOutput(false).output).toBe(false)
        expect(base.setOutput(null).output).toBeNull()
        expect(base.setOutput(undefined).output).toBeUndefined()
    })

    it('creates instance via static create factory', () => {
        const created = GenericStepOutput.create({
            type: FlowTriggerType.PIECE,
            status: StepOutputStatus.SUCCEEDED,
            input: { trigger: 'event' },
            output: { id: 1 },
        })

        expect(created.type).toBe(FlowTriggerType.PIECE)
        expect(created.status).toBe(StepOutputStatus.SUCCEEDED)
        expect(created.input).toEqual({ trigger: 'event' })
        expect(created.output).toEqual({ id: 1 })
    })

    it('supports all StepOutputStatus values', () => {
        const step = createBaseOutput()
        for (const status of Object.values(StepOutputStatus)) {
            expect(step.setStatus(status).status).toBe(status)
        }
    })
})

describe('RouterStepOutput', () => {
    it('initializes via RouterStepOutput.init with SUCCEEDED status and ROUTER type', () => {
        const routerOutput = RouterStepOutput.init({
            input: { condition: true },
        })

        expect(routerOutput.type).toBe(FlowActionType.ROUTER)
        expect(routerOutput.status).toBe(StepOutputStatus.SUCCEEDED)
        expect(routerOutput.input).toEqual({ condition: true })
        expect(routerOutput.output).toBeUndefined()
    })

    it('preserves input and fields when status is updated', () => {
        const routerOutput = RouterStepOutput.init({
            input: { condition: false },
        })
        const updated = routerOutput.setStatus(StepOutputStatus.FAILED)

        expect(updated.status).toBe(StepOutputStatus.FAILED)
        expect(updated.type).toBe(FlowActionType.ROUTER)
        expect(updated.input).toEqual({ condition: false })
    })
})

describe('LoopStepOutput', () => {
    it('initializes via LoopStepOutput.init with default loop output shape', () => {
        const loop = LoopStepOutput.init({
            input: ['item1', 'item2'],
        })

        expect(loop.type).toBe(FlowActionType.LOOP_ON_ITEMS)
        expect(loop.status).toBe(StepOutputStatus.SUCCEEDED)
        expect(loop.input).toEqual(['item1', 'item2'])
        expect(loop.output).toEqual({
            item: undefined,
            index: 0,
            iterations: [],
        })
    })

    it('returns a new instance from setIterations without mutating original', () => {
        const loop = LoopStepOutput.init({ input: [] })
        const iterationData = [{ stepA: LoopStepOutput.init({ input: null }) }]
        const updated = loop.setIterations(iterationData)

        expect(updated).not.toBe(loop)
        expect(loop.output?.iterations).toEqual([])
        expect(updated.output?.iterations).toHaveLength(1)
    })

    it('preserves existing iterations when setItemAndIndex is called', () => {
        const loop = LoopStepOutput.init({ input: [] })
            .addIteration()
            .setItemAndIndex({ item: 'first', index: 0 })

        expect(loop.output?.item).toBe('first')
        expect(loop.output?.index).toBe(0)
        expect(loop.output?.iterations).toHaveLength(1)
    })

    it('appends an empty iteration with addIteration', () => {
        const loop = LoopStepOutput.init({ input: [] })
            .setItemAndIndex({ item: 'active', index: 1 })
            .addIteration()

        expect(loop.output?.iterations).toHaveLength(1)
        expect(loop.output?.iterations[0]).toEqual({})
        expect(loop.output?.item).toBe('active')
        expect(loop.output?.index).toBe(1)
    })

    it('correctly checks hasIteration for valid and invalid indices', () => {
        const loop = LoopStepOutput.init({ input: [] }).addIteration()

        expect(loop.hasIteration(0)).toBe(true)
        expect(loop.hasIteration(1)).toBe(false)
        expect(loop.hasIteration(-1)).toBe(false)
    })

    it('preserves falsy item values and zero index', () => {
        const loop = LoopStepOutput.init({ input: [] }).setItemAndIndex({
            item: 0,
            index: 0,
        })

        expect(loop.output?.item).toBe(0)
        expect(loop.output?.index).toBe(0)
    })
})
