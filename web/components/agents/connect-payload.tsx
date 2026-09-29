'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Skeleton } from '@/components/motion'
import { Button } from '@/components/ui'
import { payloadFor, type ConnectClient } from './connect-clients'
import type { McpUrlState } from './use-mcp-url'

/**
 * The address, once we know it.
 *
 * Nothing copyable is offered until the service has answered. The dialog could
 * fill this in from a guess and correct it a moment later, but the guess is the
 * bug this replaced: a wrong address is pasted, copied and pasted again long
 * before anyone notices it was provisional.
 */
export function Payload({ state, client }: { state: McpUrlState; client: ConnectClient }) {
  if (state.status === 'ready') return <CopyRow value={payloadFor(client, state.url)} />

  if (state.status === 'failed') {
    return (
      <p
        role="alert"
        className="m-0 rounded-[10px] bg-[var(--ot-warn-bg)] px-3 py-2.5 text-[13px] leading-[1.5] text-[var(--ot-warn-text)]"
      >
        Couldn&rsquo;t reach Ottopus for its address. Nothing is wrong with your account or your
        agent &mdash; close this and open it again in a moment.
      </p>
    )
  }

  // The copy row's exact height, so the dialog does not jump under the pointer
  // at the moment someone reaches for the button.
  return (
    <div role="status" aria-busy>
      <span className="sr-only">Loading the server address</span>
      <Skeleton height={43} radius={10} />
    </div>
  )
}

/** The copy row. One control, and it says what it did. */
function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard refused — an insecure origin, or a browser that asks. The
      // text is selectable, which is why it is not hidden behind the button.
    }
  }, [value])

  return (
    <div className="flex items-center gap-2 rounded-[10px] bg-[var(--ot-surface-2)] px-3 py-2.5">
      <code className="ot-scroll flex-1 overflow-x-auto font-mono text-[12.5px] whitespace-nowrap">
        {value}
      </code>
      <Button variant="primary" size="sm" onClick={() => void copy()} className="flex-none">
        {copied ? 'Copied ✓' : 'Copy'}
      </Button>
    </div>
  )
}
