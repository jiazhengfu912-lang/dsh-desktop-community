/** DSH Desktop Community browser identity and upstream notice policy. */
import { useEffect } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { CommunityBrandMark, CommunityBrandName } from './CommunityBrand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Skip the upstream product-specific welcome notice in the independent
 * community application.
 * @param props - onboarding coordinator ownership.
 * @returns no visible content.
 */
function CommunityWelcomePolicy({ complete }: PropsRuntime<'settings.onboarding'>): null {
  useEffect(() => { complete() }, [complete])
  return null
}

/**
 * Fill every shipped brand slot and suppress the upstream welcome notice.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'welcome-notice',
    order: -100,
    priority: -100,
  }, CommunityWelcomePolicy))
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, CommunityBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, CommunityBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, CommunityBrandMark)
      })))
}
