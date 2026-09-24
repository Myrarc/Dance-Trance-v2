import assert from 'node:assert/strict'
import test from 'node:test'

const diagnostic = await import('../src/pose/cameraDiagnostic.ts').catch(() => null)

test('the built-in diagnostic uses three separate movements across arms and legs', () => {
  assert.ok(diagnostic)
  assert.deepEqual(diagnostic.DIAGNOSTIC_INTERVALS.map((interval) => interval.keys), [
    ['rUpperArm', 'rForearm'],
    ['lUpperArm', 'lForearm', 'rUpperArm', 'rForearm'],
    ['rThigh', 'rShin'],
  ])
  const result = diagnostic.scoreDiagnostic([diagnostic.DIAGNOSTIC_REFERENCE])[0]
  assert.equal(result.steps.length, 3)
  assert.ok(result.steps.every((step) => step.quality !== null && step.quality >= 0.8))
  assert.equal(diagnostic.diagnosticCoverage(result), 100)
})

test('stationary or missing players do not receive a motion match; two players remain independent', () => {
  assert.ok(diagnostic)
  const rest = diagnostic.DIAGNOSTIC_REFERENCE[0].feature
  const still = diagnostic.DIAGNOSTIC_REFERENCE.map(({ t }) => ({ t, feature: rest }))
  const [active, stationary, unseen] = diagnostic.scoreDiagnostic([
    diagnostic.DIAGNOSTIC_REFERENCE,
    still,
    [],
  ])
  assert.ok(active.round.score > stationary.round.score)
  assert.ok(stationary.steps.every((step) => step.quality !== null && step.quality < 0.45))
  assert.ok(unseen.steps.every((step) => step.quality === null))
  assert.equal(diagnostic.diagnosticCoverage(unseen), 0)
})
