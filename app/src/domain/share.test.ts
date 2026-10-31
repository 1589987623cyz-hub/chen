import { describe, expect, it } from 'vitest'
import { createConfig } from './params'
import { decodeShare, encodeShare } from './share'

describe('share links', () => {
  it('stays short for a new configuration', () => {
    expect(encodeShare(createConfig('')).length).toBeLessThan(10)
  })

  it('carries the design into a new configuration', () => {
    const config = createConfig('我的面具')
    config.mode = 'pro'
    config.look.palette = 'sage'
    config.look.bloom = 70
    config.motion.muted = ['T04-02']
    config.values.pmThreshold = 40
    const copy = decodeShare(encodeShare(config))
    expect(copy).toMatchObject({ name: '我的面具', mode: 'pro' })
    expect(copy.look).toEqual(config.look)
    expect(copy.motion).toEqual(config.motion)
    expect(copy.values.pmThreshold).toBe(40)
    expect(copy.id).not.toBe(config.id)
  })

  it('leaves out body measurements and the confirmation', () => {
    const config = createConfig('a')
    config.values.headCircumference = 601
    config.feedbackConfirmed = true
    const copy = decodeShare(encodeShare(config))
    expect(copy.values.headCircumference).toBe(createConfig('b').values.headCircumference)
    expect(copy.feedbackConfirmed).toBe(false)
  })

  it('refuses a damaged link', () => {
    expect(() => decodeShare('not-a-link')).toThrow()
    expect(() => decodeShare(btoa('[1]'))).toThrow()
    expect(() => decodeShare(btoa(JSON.stringify({ look: { palette: 'nope' } })))).toThrow()
    expect(() => decodeShare(btoa(JSON.stringify({ enabledZones: 'all' })))).toThrow()
  })
})
