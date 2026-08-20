// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { act, cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { CommunityBrandMark, CommunityBrandName } from '../src/client/CommunityBrand.tsx'
import { apply, inject } from '../src/client/index.ts'

afterEach(cleanup)

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
  'settings.onboarding',
] as const

const HOLE_DECLARATIONS = {
  'sidebar.brand.mark': { kind: 'single', scope: 'root' },
  'sidebar.brand.name': { kind: 'single', scope: 'root' },
  'conversation.hero.brand.mark': { kind: 'single', scope: 'root' },
  'settings.onboarding': { kind: 'list', scope: 'root' },
} as const

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declareHoles = () => slots.register({
    name: 'root',
    children: HOLE_DECLARATIONS,
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, declareHoles, disposeHoles }
}

describe('community desktop-brand plugin', () => {
  it('declares only the slot service it uses', () => {
    expect(inject).toEqual(['slots'])
  })

  it('fills declarations before or after apply and removes every occupant on teardown', async () => {
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    before.disposeHoles?.()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    const after = await bench(false)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('shadows and completes the upstream welcome-notice cell only while mounted', async () => {
    const b = await bench()
    const upstream = () => null
    const disposeUpstream = b.slots.register({
      name: 'settings.onboarding',
      id: 'welcome-notice',
      order: -100,
    }, upstream)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const winner = b.slots.entriesOfSlot('settings.onboarding')[0]
    expect(winner?.component).not.toBe(upstream)
    expect(winner?.options).toMatchObject({ id: 'welcome-notice', priority: -100 })
    const Policy = winner?.component as (props: {
      stepId: string
      complete: () => void
      openSection: (id: string) => void
    }) => ReactNode
    const complete = vi.fn()
    await act(async () => {
      render(<Policy stepId="welcome-notice" complete={complete} openSection={vi.fn()} />)
    })
    expect(complete).toHaveBeenCalledOnce()

    await fiber.dispose()
    expect(b.slots.entriesOfSlot('settings.onboarding')[0]?.component).toBe(upstream)
    disposeUpstream()
  })

  it('renders original community artwork at both requested mark sizes', () => {
    const name = render(<CommunityBrandName />)
    const nameSvg = name.container.querySelector('[data-community-brand-name]')
    expect(nameSvg?.getAttribute('aria-label')).toBe('DSH Desktop Community')
    expect(nameSvg?.textContent).toContain('DESKTOP')
    expect(nameSvg?.textContent).toContain('COMMUNITY')
    name.unmount()

    const mark = render(<CommunityBrandMark size={34} className="hero-mark" />)
    const markSvg = mark.container.querySelector('[data-community-brand-mark]')
    expect(markSvg?.getAttribute('width')).toBe('34')
    expect(markSvg?.getAttribute('class')).toBe('hero-mark')
    expect(mark.container.querySelector('[data-terminal-prompt]')).not.toBeNull()
    mark.rerender(<CommunityBrandMark size={24} />)
    expect(mark.container.querySelector('[data-community-brand-mark]')?.getAttribute('width')).toBe('24')
  })
})
