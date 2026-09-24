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

test('arm markers extend outward from either shoulder order for a T-pose', () => {
  assert.ok(diagnostic)
  for (const [leftX, rightX] of [[0.6, 0.4], [0.4, 0.6]]) {
    const landmarks = Array.from({ length: 29 }, () => ({ x: 0.5, y: 0.5 }))
    landmarks[11] = { x: leftX, y: 0.3 }
    landmarks[12] = { x: rightX, y: 0.3 }
    landmarks[28] = { x: rightX, y: 0.8 }
    const [leftTarget, rightTarget] = diagnostic.diagnosticTargetPoints(landmarks, 'both-arms')
    assert.ok(Math.abs(leftTarget.x - rightTarget.x) > Math.abs(leftX - rightX))
    assert.ok((leftTarget.x - leftX) * (leftX - rightX) > 0)
    assert.ok((rightTarget.x - rightX) * (rightX - leftX) > 0)
    const [stepTarget] = diagnostic.diagnosticTargetPoints(landmarks, 'side-step')
    assert.ok((stepTarget.x - landmarks[24].x) * (rightX - leftX) > 0)
    landmarks[28].x += 0.1
    assert.equal(diagnostic.diagnosticTargetPoints(landmarks, 'side-step')[0].x, stepTarget.x)
  }
})
