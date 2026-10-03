import { test, expect } from 'claude-code/testing'
import { ROLES } from '../hooks/rules'

test('the sibling module imports', () => {
  expect(ROLES).toEqual(['implementer', 'verifier', 'reviewer'])
})
