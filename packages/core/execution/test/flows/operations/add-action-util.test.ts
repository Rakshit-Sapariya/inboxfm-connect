import { describe, expect, it } from 'vitest'
import { addActionUtils } from '../../../src/lib/flows/operations/add-action-util'
import { FlowAction, FlowActionType } from '../../../src/lib/flows/actions/action'

describe('addActionUtils Step Renaming (#167)', () => {
  it('correctly renames simple mustache mentions', () => {
    const input = 'Hello {{ step_1.output.name }} world'
    const result = addActionUtils.replaceOldStepNameWithNewOne({
      input,
      oldStepName: 'step_1',
      newStepName: 'step_2',
    })
    expect(result).toBe('Hello {{ step_2.output.name }} world')
  })

  it('correctly renames mentions containing "}}" inside string literals without truncating', () => {
    const input = 'Value: {{ "}}" + step_1.data }} and {{ step_1.other }}'
    const result = addActionUtils.replaceOldStepNameWithNewOne({
      input,
      oldStepName: 'step_1',
      newStepName: 'step_99',
    })
    expect(result).toBe('Value: {{ "}}" + step_99.data }} and {{ step_99.other }}')
  })

  it('correctly handles nested object braces inside mentions', () => {
    const input = 'Config: {{ { key: step_1.val } }}'
    const result = addActionUtils.replaceOldStepNameWithNewOne({
      input,
      oldStepName: 'step_1',
      newStepName: 'step_renamed',
    })
    expect(result).toBe('Config: {{ { key: step_renamed.val } }}')
  })

  it('preserves text outside tokens and handles inputs with no tokens', () => {
    expect(
      addActionUtils.replaceOldStepNameWithNewOne({
        input: 'Plain string without tokens step_1',
        oldStepName: 'step_1',
        newStepName: 'step_2',
      })
    ).toBe('Plain string without tokens step_1')
  })

  it('clones action and updates step references across complex nested input settings', () => {
    const action: FlowAction = {
      name: 'step_1',
      displayName: 'Send Message',
      type: FlowActionType.PIECE,
      valid: true,
      settings: {
        pieceName: '@inboxfm-connect/piece-slack',
        pieceVersion: '0.1.0',
        actionName: 'send_message',
        input: {
          text: 'From {{ step_1.author }} with {{ "}}" + step_1.signature }}',
          nested: {
            deep: '{{ step_1.id }}',
          },
        },
      },
    }

    const cloned = addActionUtils.clone(action, { step_1: 'step_copy_1' })

    expect(cloned.name).toBe('step_copy_1')
    expect(cloned.displayName).toBe('Send Message Copy')
    const settings = cloned.settings as { input: { text: string; nested: { deep: string } } }
    expect(settings.input.text).toBe('From {{ step_copy_1.author }} with {{ "}}" + step_copy_1.signature }}')
    expect(settings.input.nested.deep).toBe('{{ step_copy_1.id }}')
  })
})
