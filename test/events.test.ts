import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  clip,
  isInjectedText,
  isReadableEventType,
  messageOf,
  roleOf,
  sourceLabelOf,
  textOf,
} from '../src/shared/events.ts'

/**
 * The session log stores two shapes through one API. These tests pin both,
 * because getting them wrong fails silently with an empty string rather than an
 * error — the single most expensive mistake this plugin made during
 * development.
 */
describe('messageOf', () => {
  it('reads a user/message, whose data is the message itself', () => {
    const data = {
      id: 'm1',
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    }
    const message = messageOf(data)
    assert.equal(message?.role, 'user')
    assert.equal(message?.content.length, 1)
  })

  it('reads an assistant/message, whose data wraps the message', () => {
    const data = {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'model', provider: 'p', model: 'm' },
      },
      usage: { inputTokens: 1, outputTokens: 1 },
      stream: [],
    }
    assert.equal(messageOf(data)?.role, 'assistant')
  })

  it('rejects anything that is not a message', () => {
    assert.equal(messageOf(undefined), undefined)
    assert.equal(messageOf(null), undefined)
    assert.equal(messageOf('text'), undefined)
    assert.equal(messageOf({ turn: 1 }), undefined)
    assert.equal(messageOf({ role: 'user' }), undefined)
  })
})

describe('textOf', () => {
  it('concatenates text blocks and drops reasoning', () => {
    const data = {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'internal scratchpad' },
          { type: 'text', text: 'answer' },
        ],
        source: { kind: 'model', provider: 'p', model: 'm' },
      },
    }
    assert.equal(textOf(data), 'answer')
  })

  it('returns an empty string for a message with no text blocks', () => {
    const data = {
      role: 'user',
      content: [{ type: 'image' }],
      source: { kind: 'user' },
    }
    assert.equal(textOf(data), '')
  })
})

describe('sourceLabelOf', () => {
  it('labels each source kind', () => {
    assert.equal(sourceLabelOf({ role: 'user', content: [], source: { kind: 'user' } }), 'user')
    assert.equal(
      sourceLabelOf({
        role: 'assistant',
        content: [],
        source: { kind: 'model', provider: 'deepseek', model: 'flash' },
      }),
      'model:deepseek/flash',
    )
    assert.equal(
      sourceLabelOf({
        role: 'user',
        content: [],
        source: { kind: 'plugin', plugin: 'dsh-mnemon', form: 'recall' },
      }),
      'plugin:dsh-mnemon/recall',
    )
    assert.equal(
      sourceLabelOf({ role: 'user', content: [], source: { kind: 'plugin', plugin: 'x' } }),
      'plugin:x',
    )
  })

  it('answers "unknown" when there is no message', () => {
    assert.equal(sourceLabelOf({ turn: 1 }), 'unknown')
  })
})

describe('isInjectedText', () => {
  it('detects harness-injected prefixes', () => {
    assert.equal(isInjectedText('<system-reminder>\nA skill'), true)
    assert.equal(isInjectedText('Current runtime context. This snapshot'), true)
    assert.equal(isInjectedText('[MNEMON] Search Documents'), true)
    assert.equal(isInjectedText('MNEMON RUNTIME MEMORY SNAPSHOT'), true)
  })

  it('does not flag ordinary user text that merely mentions a marker later', () => {
    assert.equal(isInjectedText('please check the <system-reminder> handling'), false)
    assert.equal(isInjectedText('what does MNEMON RUNTIME MEMORY SNAPSHOT mean?'), false)
  })
})

describe('isReadableEventType and roleOf', () => {
  it('accepts exactly the three conversational types', () => {
    assert.equal(isReadableEventType('user/message'), true)
    assert.equal(isReadableEventType('assistant/message'), true)
    assert.equal(isReadableEventType('system/message'), true)
    assert.equal(isReadableEventType('tool/result'), false)
    assert.equal(isReadableEventType('turn/start'), false)
  })

  it('maps each accepted type to its role', () => {
    assert.equal(roleOf('user/message'), 'user')
    assert.equal(roleOf('assistant/message'), 'assistant')
    assert.equal(roleOf('system/message'), 'system')
  })
})

describe('clip', () => {
  it('leaves short text untouched and marks truncation', () => {
    assert.equal(clip('abc', 10), 'abc')
    assert.equal(clip('abcdef', 3), 'abc…[truncated 3 chars]')
  })
})
