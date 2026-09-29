import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CONNECT_CLIENTS } from '@/components/agents/connect-clients'
import { TRIGGER_MARKS } from './agent-marks'

describe('trigger marks', () => {
  it('shows each connectable client once, without the generic bot', () => {
    const icons = TRIGGER_MARKS.map((m) => m.icon)
    expect(new Set(icons).size).toBe(icons.length)
    expect(icons).not.toContain('other')
    const named = new Set(CONNECT_CLIENTS.filter((c) => c.icon !== 'other').map((c) => c.icon))
    expect(new Set(icons)).toEqual(named)
  })

  it('leads with the mark the panel opens on', () => {
    expect(TRIGGER_MARKS[0]?.icon).toBe(CONNECT_CLIENTS[0]?.icon)
  })

  it('has a file on disk for every mark it turns through', () => {
    for (const { icon } of TRIGGER_MARKS) {
      expect(existsSync(new URL(`../../public/agents/${icon}.svg`, import.meta.url)), icon).toBe(true)
    }
  })
})
