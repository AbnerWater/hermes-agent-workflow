import { describe, expect, it } from 'vitest'

import { APP_COPY } from './index'

function keyShape(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return typeof value
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, keyShape(child)])
  )
}

describe('desktop app i18n copy', () => {
  it('keeps English and Chinese key coverage aligned', () => {
    expect(keyShape(APP_COPY.zh)).toEqual(keyShape(APP_COPY.en))
  })
})
