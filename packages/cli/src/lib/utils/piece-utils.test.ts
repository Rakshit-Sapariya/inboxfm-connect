import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { piecesPath, customPiecePath } from './piece-utils';

describe('piece-utils', () => {
  it('piecesPath points to packages/integrations under cwd', () => {
    const expected = path.join(process.cwd(), 'packages', 'integrations');
    expect(piecesPath()).toBe(expected);
  });

  it('customPiecePath points to packages/integrations/custom under cwd', () => {
    const expected = path.join(process.cwd(), 'packages', 'integrations', 'custom');
    expect(customPiecePath()).toBe(expected);
  });
});
