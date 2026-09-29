'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useRef, useState } from 'react'
import { AgentIcon, CONNECT_CLIENTS, useMcpUrl } from '@/components/agents'
import type { AgentIconKey } from '@/components/agents/agent-brand'
import { Payload } from '@/components/agents/connect-payload'
import { buttonClasses } from '@/components/ui'
import { useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/cn'
import { TRIGGER_MARK_MS, TRIGGER_MARKS } from './agent-marks'

/**
 * "Add to your agent", from the landing page: the same clients, commands and
 * address as the connect dialog in Settings, dropped down under the button.
 *
 * Not the dialog itself. The dialog also watches for the agent's handshake,
 * which polls the signed-in agent list — a visitor here usually has no
 * session, and adding Ottopus to an agent does not need one until the agent
 * asks you to approve its grant.
 *
 * The button wears an agent's mark that turns through the clients while it
 * waits, so "your agent" reads as a list of names rather than a category.
 * Open, it holds the client you picked; under reduced motion it holds the
 * first one, which is also what the server drew, so nothing flashes on load.
 */
export function AddToAgent({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const [clientKey, setClientKey] = useState(CONNECT_CLIENTS[0]!.key)
  const client = CONNECT_CLIENTS.find((c) => c.key === clientKey) ?? CONNECT_CLIENTS[0]!
  const mcp = useMcpUrl()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const still = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [turn, setTurn] = useState(0)

  useEffect(() => {
    if (open || still) return
    const id = window.setInterval(() => setTurn((n) => n + 1), TRIGGER_MARK_MS)
    return () => window.clearInterval(id)
  }, [open, still])

  const mark = open ? { icon: client.icon, label: client.label } : TRIGGER_MARKS[turn % TRIGGER_MARKS.length]!

  // Closes on a click anywhere else and on Escape, handing focus back to the
  // button so a keyboard user is not dropped at the top of the page.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={buttonClasses({ variant: 'secondary', size: 'lg' })}
      >
        <TriggerMark icon={mark.icon} label={mark.label} />
        Add to your agent
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className={cn('h-4 w-4 transition-transform duration-[var(--ot-dur-fast)]', open && 'rotate-180')}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open ? (
        <div
          id={panelId}
          role="region"
          aria-label="Add Ottopus to your agent"
          className={cn(
            'absolute top-[calc(100%+10px)] left-0 z-40 flex w-[min(460px,calc(100vw-2.5rem))] flex-col gap-3.5',
            'rounded-[var(--ot-radius-lg)] border border-[var(--ot-border)] bg-[var(--ot-card)] p-4',
            'shadow-[0_24px_60px_-16px_rgba(22,33,62,.35)] motion-safe:animate-[ot-fade-in_0.18s_ease-out]',
          )}
        >
          <ul className="m-0 grid list-none grid-cols-2 gap-1 p-0 sm:grid-cols-3" aria-label="Agent">
            {CONNECT_CLIENTS.map((entry) => (
              <li key={entry.key}>
                <button
                  type="button"
                  aria-pressed={entry.key === client.key}
                  onClick={() => setClientKey(entry.key)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[13px] transition-colors',
                    entry.key === client.key
                      ? 'bg-[var(--ot-surface-2)] font-semibold text-[var(--ot-text)] ring-1 ring-[var(--ot-border-strong)]'
                      : 'font-medium text-[var(--ot-text-2)] hover:bg-[var(--ot-surface-2)] hover:text-[var(--ot-text)]',
                  )}
                >
                  <AgentIcon name={entry.label} iconKey={entry.icon} size={20} className="rounded-[5px]" />
                  {entry.label}
                </button>
              </li>
            ))}
          </ul>

          <Payload state={mcp} client={client} />

          {client.steps ? (
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {client.steps.map((step, i) => (
                <li key={step} className="flex gap-2.5 text-[13px] leading-[1.5]">
                  <span className="flex-none font-mono text-[var(--ot-text-3)]">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          ) : null}

          <p className="m-0 text-[12.5px] leading-[1.5] text-[var(--ot-text-2)]">{client.note}</p>
        </div>
      ) : null}
    </div>
  )
}

/**
 * One mark at a time on a fixed 20px square. The old one turns out as the
 * new one turns in, keyed on the mark so a repeat of the same client is not
 * an animation at all.
 */
function TriggerMark({ icon, label }: { icon: AgentIconKey; label: string }) {
  return (
    <span aria-hidden className="relative h-5 w-5 flex-none">
      <AnimatePresence initial={false}>
        <motion.span
          key={icon}
          className="absolute inset-0"
          initial={{ opacity: 0, scale: 0.6, rotate: -30 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: 0.6, rotate: 30 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
        >
          <AgentIcon name={label} iconKey={icon} size={20} className="rounded-[5px]" />
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
