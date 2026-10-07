import assert from 'node:assert/strict'
import test from 'node:test'
import { menuKeyAction } from '../src/lib/menuNavigation.ts'

test('distance menu shortcuts preserve text entry and fine editor controls', () => {
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape']) {
    assert.equal(menuKeyAction(key, true), null)
  }
  assert.equal(menuKeyAction(' ', false), null, 'native Space button activation stays native')
})

test('keyboard browse and confirm map to the same four held-pose actions', () => {
  assert.equal(menuKeyAction('ArrowLeft', false), 'previous')
  assert.equal(menuKeyAction('ArrowUp', false), 'previous')
  assert.equal(menuKeyAction('ArrowRight', false), 'next')
  assert.equal(menuKeyAction('ArrowDown', false), 'next')
  assert.equal(menuKeyAction('Enter', false), 'confirm')
  assert.equal(menuKeyAction('Escape', false), 'back')
  assert.equal(menuKeyAction('Enter', false, true), null, 'a held Enter must not replay or toggle repeatedly')
  assert.equal(menuKeyAction('Escape', false, true), null)
  assert.equal(menuKeyAction('ArrowRight', false, true), 'next')
})
