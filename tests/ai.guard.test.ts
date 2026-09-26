import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LIMITS, DEFAULT_MODEL, isAllowedRequest, limitsFrom, pickModel, recordUsage, usageFor, withinLimits,
} from '../src/ai/guard'

const hosts = ['localhost:5173', '127.0.0.1:5173']

describe('pickModel', () => {
  it('keeps an allowed model and replaces anything else with the default', () => {
    expect(pickModel('gpt-4.1-mini')).toBe('gpt-4.1-mini')
    expect(pickModel('o1-pro')).toBe(DEFAULT_MODEL)
    expect(pickModel('gpt-4o')).toBe(DEFAULT_MODEL)
    expect(pickModel(undefined)).toBe(DEFAULT_MODEL)
  })
})

describe('isAllowedRequest', () => {
  const json = 'application/json'
  it('accepts the game page', () => {
    expect(isAllowedRequest({ 'content-type': json, origin: 'http://localhost:5173' }, hosts)).toBe(true)
  })
  it('rejects another website posting to the dev server', () => {
    expect(isAllowedRequest({ 'content-type': json, origin: 'https://evil.example' }, hosts)).toBe(false)
  })
  it('rejects a simple (no-preflight) content type', () => {
    expect(isAllowedRequest({ 'content-type': 'text/plain', origin: 'http://localhost:5173' }, hosts)).toBe(false)
  })
  it('rejects requests with no Origin header', () => {
    expect(isAllowedRequest({ 'content-type': json }, hosts)).toBe(false)
  })
})

describe('daily spend limits', () => {
  it('rolls usage over at the date boundary', () => {
    const y = { date: '2026-09-24', requests: 199, inputTokens: 9, outputTokens: 9 }
    expect(usageFor('2026-09-24', y)).toBe(y)
    expect(usageFor('2026-09-25', y).requests).toBe(0)
  })
  it('stops at the request cap and at the token cap', () => {
    const lim = { maxRequestsPerDay: 2, maxTokensPerDay: 1000 }
    let u = usageFor('d', null)
    u = recordUsage(u, 100, 50); expect(withinLimits(u, lim)).toBe(true)
    u = recordUsage(u, 100, 50); expect(withinLimits(u, lim)).toBe(false)
    expect(withinLimits(recordUsage(usageFor('d', null), 900, 200), lim)).toBe(false)
  })
  it('env overrides must be positive integers', () => {
    expect(limitsFrom({ OPENAI_DAILY_REQUEST_CAP: '50' }).maxRequestsPerDay).toBe(50)
    expect(limitsFrom({ OPENAI_DAILY_REQUEST_CAP: '-1' }).maxRequestsPerDay).toBe(DEFAULT_LIMITS.maxRequestsPerDay)
    expect(limitsFrom({ OPENAI_DAILY_REQUEST_CAP: 'lots' }).maxRequestsPerDay).toBe(DEFAULT_LIMITS.maxRequestsPerDay)
  })
})
