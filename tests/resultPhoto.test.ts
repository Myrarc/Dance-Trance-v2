import assert from 'node:assert/strict'
import test from 'node:test'
import { photoStage, photoPrompt } from '../src/game/resultPhoto.ts'

test('results wait three seconds, then give a full three-beat photo countdown', () => {
  assert.deepEqual(photoStage(0), { phase: 'waiting', digit: null })
  assert.deepEqual(photoStage(2999), { phase: 'waiting', digit: null })
  assert.deepEqual(photoStage(3000), { phase: 'posing', digit: 3 })
  assert.deepEqual(photoStage(4000), { phase: 'posing', digit: 2 })
  assert.deepEqual(photoStage(5000), { phase: 'posing', digit: 1 })
  assert.deepEqual(photoStage(6000), { phase: 'capture', digit: null })
})

test('the five prompts change with each completed round', () => {
  const phrases = Array.from({ length: 5 }, (_, round) => photoPrompt(round))
  assert.equal(new Set(phrases).size, 5)
  assert.equal(photoPrompt(5), phrases[0])
})
