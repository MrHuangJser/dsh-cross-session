import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DEFAULT_SETTINGS, normalizeSendMode, resolveSettings } from '../src/shared/settings.ts'

describe('resolveSettings', () => {
  it('returns the documented defaults for no input at all', () => {
    assert.deepEqual(resolveSettings(undefined), DEFAULT_SETTINGS)
    assert.deepEqual(resolveSettings(null), DEFAULT_SETTINGS)
    assert.deepEqual(resolveSettings('nonsense'), DEFAULT_SETTINGS)
    assert.deepEqual(resolveSettings(42), DEFAULT_SETTINGS)
  })

  it('keeps valid overrides', () => {
    const resolved = resolveSettings({
      enabled: false,
      defaultSendMode: 'steer',
      allowResume: false,
      frameMessages: false,
      includeInjectedByDefault: true,
    })
    assert.equal(resolved.enabled, false)
    assert.equal(resolved.defaultSendMode, 'steer')
    assert.equal(resolved.allowResume, false)
    assert.equal(resolved.frameMessages, false)
    assert.equal(resolved.includeInjectedByDefault, true)
  })

  it('replaces wrong-typed values with the default instead of throwing', () => {
    const resolved = resolveSettings({
      enabled: 'yes',
      allowResume: 1,
      maxReadMessages: 'many',
    })
    assert.equal(resolved.enabled, DEFAULT_SETTINGS.enabled)
    assert.equal(resolved.allowResume, DEFAULT_SETTINGS.allowResume)
    assert.equal(resolved.maxReadMessages, DEFAULT_SETTINGS.maxReadMessages)
  })

  it('clamps numeric settings into their supported range', () => {
    assert.equal(resolveSettings({ maxListResults: 0 }).maxListResults, 1)
    assert.equal(resolveSettings({ maxListResults: 99_999 }).maxListResults, 200)
    assert.equal(resolveSettings({ maxReadMessages: -5 }).maxReadMessages, 1)
    assert.equal(resolveSettings({ maxSendChars: 1 }).maxSendChars, 100)
  })

  it('truncates fractional numbers and rejects non-finite ones', () => {
    assert.equal(resolveSettings({ maxReadMessages: 7.9 }).maxReadMessages, 7)
    assert.equal(
      resolveSettings({ maxReadMessages: Number.NaN }).maxReadMessages,
      DEFAULT_SETTINGS.maxReadMessages,
    )
    assert.equal(
      resolveSettings({ maxReadMessages: Number.POSITIVE_INFINITY }).maxReadMessages,
      DEFAULT_SETTINGS.maxReadMessages,
    )
  })
})

describe('normalizeSendMode', () => {
  it('accepts the two documented modes', () => {
    assert.equal(normalizeSendMode('queue'), 'queue')
    assert.equal(normalizeSendMode('steer'), 'steer')
  })

  it('falls back to the default for anything else', () => {
    assert.equal(normalizeSendMode('interrupt'), DEFAULT_SETTINGS.defaultSendMode)
    assert.equal(normalizeSendMode(undefined), DEFAULT_SETTINGS.defaultSendMode)
  })
})
