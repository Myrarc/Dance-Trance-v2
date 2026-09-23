import assert from 'node:assert/strict'
import test from 'node:test'
import { drawArcadeHitLabel } from '../src/pose/arcade.ts'

test('Perfect, Good, and Miss labels stay centered inside their hit circles', () => {
  for (const grade of ['perfect', 'good', 'miss'] as const) {
    const painted: unknown[][] = []
    const ctx = {
      save() {},
      restore() {},
      strokeText(...args: unknown[]) { painted.push(args) },
      fillText(...args: unknown[]) { painted.push(args) },
    } as unknown as CanvasRenderingContext2D
    drawArcadeHitLabel(ctx, 120, 240, 50, grade)
    assert.deepEqual(painted, [
      [grade.toUpperCase(), 120, 240, 82.5],
      [grade.toUpperCase(), 120, 240, 82.5],
    ])
  }
})
