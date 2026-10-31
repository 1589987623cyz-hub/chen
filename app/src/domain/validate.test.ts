import { describe, expect, it } from 'vitest'
import { createConfig } from './params'
import { hiddenProSettings } from './validate'

describe('hiddenProSettings', () => {
  it('finds nothing on a new configuration', () => {
    expect(hiddenProSettings(createConfig('a'))).toBe(0)
  })

  it('counts each setting that simple mode cannot show', () => {
    const config = createConfig('a')
    config.motion.zoneTravel = { forehead: 1 }
    config.motion.pattern = 'cascade'
    config.look.zonePalette = { chin: config.look.palette }
    config.hapticByZone = { chin: 2 }
    config.values.distanceFar = 2.5
    expect(hiddenProSettings(config)).toBe(5)
  })

  it('leaves out muted petals, which simple mode still lists', () => {
    const config = createConfig('a')
    config.motion.muted = ['T04-02']
    expect(hiddenProSettings(config)).toBe(0)
  })
})
