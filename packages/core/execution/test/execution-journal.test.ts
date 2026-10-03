import { FlowActionType } from '../src/lib/flows/actions/action'
import { FlowTriggerType } from '../src/lib/flows/triggers/trigger'
import { executionJournal } from '../src/lib/flow-run/execution/execution-journal'
import {
    GenericStepOutput,
    LoopStepOutput,
    StepOutput,
    StepOutputStatus,
} from '../src/lib/flow-run/execution/step-output'

/**
 * Unit tests for executionJournal state management (Refs #141).
 *
 * Covers path traversal, step upsertion, nested loop state resolution,
 * step searching, loop step aggregation, and parent-child relationship checks.
 */

describe('executionJournal', () => {
    const createStep = (
        name: string,
        status: StepOutputStatus = StepOutputStatus.SUCCEEDED,
    ): GenericStepOutput<FlowActionType.CODE, { step: string }> =>
        new GenericStepOutput({
            type: FlowActionType.CODE,
            status,
            input: { name },
            output: { step: name },
        })

    const createTriggerStep = (): GenericStepOutput<FlowTriggerType.PIECE, { payload: string }> =>
        new GenericStepOutput({
            type: FlowTriggerType.PIECE,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { payload: 'event' },
        })

    describe('upsertStep and getStep', () => {
        it('upserts a step at the root path', () => {
            const steps: Record<string, StepOutput> = {}
            const step1 = createStep('step_1')

            executionJournal.upsertStep({
                stepName: 'step_1',
                stepOutput: step1,
                path: [],
                steps,
            })

            expect(steps['step_1']).toBe(step1)
            expect(executionJournal.getStep({ stepName: 'step_1', path: [], steps })).toBe(step1)
        })

        it('updates an existing step at the root path', () => {
            const steps: Record<string, StepOutput> = {
                step_1: createStep('step_1', StepOutputStatus.RUNNING),
            }
            const updated = createStep('step_1', StepOutputStatus.SUCCEEDED)

            executionJournal.upsertStep({
                stepName: 'step_1',
                stepOutput: updated,
                path: [],
                steps,
            })

            expect(steps['step_1']).toBe(updated)
            expect(steps['step_1'].status).toBe(StepOutputStatus.SUCCEEDED)
        })

        it('returns undefined when getting a non-existent step', () => {
            const steps: Record<string, StepOutput> = {}
            expect(executionJournal.getStep({ stepName: 'missing', path: [], steps })).toBeUndefined()
        })

        it('upserts and retrieves a step inside an existing loop iteration', () => {
            const loopStep = LoopStepOutput.init({ input: [] }).addIteration()
            const steps: Record<string, StepOutput> = {
                loop_1: loopStep,
            }
            const innerStep = createStep('inner_step')

            executionJournal.upsertStep({
                stepName: 'inner_step',
                stepOutput: innerStep,
                path: [['loop_1', 0]],
                steps,
                createLoopIterationIfNotExists: false,
            })

            const retrieved = executionJournal.getStep({
                stepName: 'inner_step',
                path: [['loop_1', 0]],
                steps,
            })
            expect(retrieved).toBe(innerStep)
        })

        it('creates loop step and iteration when createLoopIterationIfNotExists is true', () => {
            const steps: Record<string, StepOutput> = {}
            const innerStep = createStep('inner_step')

            executionJournal.upsertStep({
                stepName: 'inner_step',
                stepOutput: innerStep,
                path: [['loop_1', 0]],
                steps,
                createLoopIterationIfNotExists: true,
            })

            expect(steps['loop_1']).toBeDefined()
            expect(steps['loop_1'].type).toBe(FlowActionType.LOOP_ON_ITEMS)
            const retrieved = executionJournal.getStep({
                stepName: 'inner_step',
                path: [['loop_1', 0]],
                steps,
            })
            expect(retrieved).toBe(innerStep)
        })
    })

    describe('getStateAtPath and error boundaries', () => {
        it('returns root steps when path is empty', () => {
            const steps: Record<string, StepOutput> = { step_1: createStep('step_1') }
            expect(executionJournal.getStateAtPath({ path: [], steps })).toBe(steps)
        })

        it('throws error when parent step does not exist in path', () => {
            const steps: Record<string, StepOutput> = {}
            expect(() =>
                executionJournal.getStateAtPath({ path: [['missing_loop', 0]], steps }),
            ).toThrow('Step missing_loop not found')
        })

        it('throws error when parent step is not a loop action', () => {
            const steps: Record<string, StepOutput> = {
                not_a_loop: createStep('not_a_loop'),
            }
            expect(() =>
                executionJournal.getStateAtPath({ path: [['not_a_loop', 0]], steps }),
            ).toThrow('is not a loop on items step')
        })

        it('throws error when iteration does not exist in path', () => {
            const steps: Record<string, StepOutput> = {
                loop_1: LoopStepOutput.init({ input: [] }),
            }
            expect(() =>
                executionJournal.getStateAtPath({ path: [['loop_1', 5]], steps }),
            ).toThrow('Iteration 5 not found')
        })
    })

    describe('getOrCreateStateAtPath', () => {
        it('throws error when step in path exists but is not a loop', () => {
            const steps: Record<string, StepOutput> = {
                code_step: createStep('code_step'),
            }
            expect(() =>
                executionJournal.getOrCreateStateAtPath({ path: [['code_step', 0]], steps }),
            ).toThrow('is not a loop on items step')
        })

        it('creates nested loop structure across multiple path segments', () => {
            const steps: Record<string, StepOutput> = {}
            const targetState = executionJournal.getOrCreateStateAtPath({
                path: [
                    ['outer_loop', 0],
                    ['inner_loop', 1],
                ],
                steps,
            })

            expect(targetState).toBeDefined()
            expect(steps['outer_loop']).toBeDefined()
            expect(steps['outer_loop'].type).toBe(FlowActionType.LOOP_ON_ITEMS)
        })
    })

    describe('findLastStepWithStatus', () => {
        it('returns null when steps record is empty', () => {
            expect(executionJournal.findLastStepWithStatus({}, undefined)).toBeNull()
            expect(executionJournal.findLastStepWithStatus({}, StepOutputStatus.SUCCEEDED)).toBeNull()
        })

        it('returns last step name when status is undefined', () => {
            const steps: Record<string, StepOutput> = {
                step_1: createStep('step_1'),
                step_2: createStep('step_2'),
            }
            expect(executionJournal.findLastStepWithStatus(steps, undefined)).toBe('step_2')
        })

        it('returns last step matching the specified status', () => {
            const steps: Record<string, StepOutput> = {
                step_1: createStep('step_1', StepOutputStatus.SUCCEEDED),
                step_2: createStep('step_2', StepOutputStatus.FAILED),
                step_3: createStep('step_3', StepOutputStatus.SUCCEEDED),
            }
            expect(executionJournal.findLastStepWithStatus(steps, StepOutputStatus.FAILED)).toBe('step_2')
            expect(executionJournal.findLastStepWithStatus(steps, StepOutputStatus.SUCCEEDED)).toBe('step_3')
            expect(executionJournal.findLastStepWithStatus(steps, StepOutputStatus.PAUSED)).toBeNull()
        })

        it('finds matching step inside nested loop iterations', () => {
            const loop = LoopStepOutput.init({ input: [] })
                .setIterations([
                    {
                        inner_succeeded: createStep('inner_succeeded', StepOutputStatus.SUCCEEDED),
                        inner_failed: createStep('inner_failed', StepOutputStatus.FAILED),
                    },
                ])
            const steps: Record<string, StepOutput> = {
                trigger: createTriggerStep(),
                loop_step: loop,
            }

            expect(executionJournal.findLastStepWithStatus(steps, StepOutputStatus.FAILED)).toBe('inner_failed')
        })
    })

    describe('getLoopSteps', () => {
        it('returns empty record when no loop steps exist', () => {
            const steps: Record<string, StepOutput> = {
                step_1: createStep('step_1'),
            }
            expect(executionJournal.getLoopSteps(steps)).toEqual({})
        })

        it('collects loop steps from flat and nested iterations', () => {
            const nestedLoop = LoopStepOutput.init({ input: [] })
            const outerLoop = LoopStepOutput.init({ input: [] }).setIterations([
                { inner_loop: nestedLoop },
            ])
            const steps: Record<string, StepOutput> = {
                outer_loop: outerLoop,
                regular_step: createStep('regular_step'),
            }

            const loopSteps = executionJournal.getLoopSteps(steps)
            expect(loopSteps['outer_loop']).toBe(outerLoop)
            expect(loopSteps['inner_loop']).toBe(nestedLoop)
        })
    })

    describe('isChildOf', () => {
        it('returns false when parent is not a loop step', () => {
            const step = createStep('code')
            expect(executionJournal.isChildOf(step, 'any_child')).toBe(false)
        })

        it('returns false when parent loop has no iterations', () => {
            const loop = LoopStepOutput.init({ input: [] })
            expect(executionJournal.isChildOf(loop, 'any_child')).toBe(false)
        })

        it('returns true when child is directly in loop iteration', () => {
            const loop = LoopStepOutput.init({ input: [] }).setIterations([
                { child_step: createStep('child_step') },
            ])
            expect(executionJournal.isChildOf(loop, 'child_step')).toBe(true)
            expect(executionJournal.isChildOf(loop, 'other_step')).toBe(false)
        })

        it('returns true when child is deeply nested in sub-loop', () => {
            const innerLoop = LoopStepOutput.init({ input: [] }).setIterations([
                { deep_child: createStep('deep_child') },
            ])
            const outerLoop = LoopStepOutput.init({ input: [] }).setIterations([
                { inner_loop: innerLoop },
            ])

            expect(executionJournal.isChildOf(outerLoop, 'deep_child')).toBe(true)
        })
    })

    describe('getPathToStep', () => {
        it('returns empty array when target step is at root level', () => {
            const steps: Record<string, StepOutput> = {
                step_1: createStep('step_1'),
            }
            const path = executionJournal.getPathToStep(steps, 'step_1', {})
            expect(path).toEqual([])
        })

        it('returns nested path when step is inside a loop', () => {
            const loop = LoopStepOutput.init({ input: [] }).setIterations([
                { inner_step: createStep('inner_step') },
            ])
            const steps: Record<string, StepOutput> = {
                my_loop: loop,
            }
            const path = executionJournal.getPathToStep(steps, 'inner_step', { my_loop: 0 })
            expect(path).toEqual([['my_loop', 0]])
        })

        it('returns undefined when step is not found', () => {
            const steps: Record<string, StepOutput> = {
                step_1: createStep('step_1'),
            }
            expect(executionJournal.getPathToStep(steps, 'non_existent', {})).toBeUndefined()
        })
    })
})
