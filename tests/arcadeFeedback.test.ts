import assert from 'node:assert/strict'
import test from 'node:test'
import { drawArcadeHitBurst, drawArcadeHitLabel } from '../src/pose/arcade.ts'

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

test('hit feedback adds tiered burst particles and respects reduced effects', () => {
  const rays = (grade: 'perfect' | 'good' | 'miss', reduced = false) => {
    let count = 0
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      arc() {},
      moveTo() {},
      lineTo() { count++ },
      stroke() {},
      fill() {},
    } as unknown as CanvasRenderingContext2D
    drawArcadeHitBurst(ctx, 120, 240, 50, grade, 0.08, reduced)
    return count
  }

  assert.equal(rays('perfect'), 12)
  assert.equal(rays('good'), 8)
  assert.equal(rays('miss'), 0)
  assert.equal(rays('perfect', true), 0)
})
