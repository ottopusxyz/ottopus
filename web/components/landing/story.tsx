'use client'

import { AnimatePresence, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { useMediaQuery } from '@/lib/use-media-query'
import { Stage } from './stage'
import { BEATS, beatAt, type Beat } from './story-script'

/**
 * How it works, told by scroll. On a wide screen one section pins under the
 * brand bar: the copy on the left changes beat by beat and the stage on the
 * right is scrubbed by the same progress, so the tabs fly into Otto, the
 * link grows into the review and the review splits into its checks exactly
 * as fast as the reader scrolls.
 *
 * On a phone, or with reduced motion, the same beats stand one under the
 * other as stills — the stage drawn at each beat's end. The server renders
 * the stills too, so the words are there before any script runs.
 */
export function Story() {
  const reduce = useReducedMotion()
  const wide = useMediaQuery('(min-width: 64rem)')
  return (
    <section id="how" aria-labelledby="how-title" className="relative border-t border-[var(--ot-border)] bg-[var(--ot-surface)]">
      <h2 id="how-title" className="sr-only">
        How it works
      </h2>
      {wide && !reduce ? <Pinned /> : <Stills />}
    </section>
  )
}

function Pinned() {
  const track = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: track, offset: ['start start', 'end end'] })
  // Passed through a JS function on purpose. Motion hands a raw scroll value
  // bound to opacity or transform to the browser's scroll timeline, which maps
  // this pinned, offset range wrongly and leaves layers half-faded; a function
  // transform keeps every scene on one clock that Motion computes itself.
  const progress = useTransform(scrollYProgress, (v) => v)
  const [beat, setBeat] = useState(0)
  useMotionValueEvent(scrollYProgress, 'change', (v) => setBeat(beatAt(v)))

  return (
    <div ref={track} className="relative" style={{ height: '640vh' }}>
      {/* Every beat's words, once, for anyone not watching the stage. */}
      <ol className="sr-only">
        {BEATS.map((b) => (
          <li key={b.id}>
            {b.title} {b.body}
          </li>
        ))}
      </ol>

      <div className="sticky top-16 flex h-[calc(100dvh-4rem)] items-center px-10">
        <div className="mx-auto grid w-full max-w-[1240px] grid-cols-[minmax(0,400px)_minmax(0,1fr)] items-center gap-16">
          <div aria-hidden className="flex gap-6">
            <Rail beat={beat} />
            <div className="relative min-h-[260px] flex-1">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={BEATS[beat]!.id}
                  initial={{ opacity: 0, y: 28, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: -28, filter: 'blur(6px)' }}
                  transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  <Copy b={BEATS[beat]!} />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
          <div className="mx-auto w-full" style={{ maxWidth: 'calc((100dvh - 8rem) * 760 / 640)' }}>
            <Stage progress={progress} beat={beat} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Five scenes, six beats: the first scene has a before and an after. */
function Rail({ beat }: { beat: number }) {
  const scene = (i: number) => Number(BEATS[i]!.n.slice(0, 2))
  const current = scene(beat)
  return (
    <ol className="m-0 flex list-none flex-col gap-2.5 p-0 pt-2">
      {[1, 2, 3, 4, 5].map((n) => (
        <li
          key={n}
          className={cn(
            'w-1.5 rounded-full transition-all duration-[var(--ot-dur-base)]',
            n === current ? 'h-8 bg-[var(--ot-coral)]' : 'h-1.5 bg-[var(--ot-border-strong)]',
          )}
        />
      ))}
    </ol>
  )
}

function Copy({ b }: { b: Beat }) {
  return (
    <div className="flex flex-col gap-4">
      <span className="font-mono text-[14px] font-semibold text-[var(--ot-coral-text)]">{b.n}</span>
      <h3 className="font-display m-0 text-[36px] leading-[1.04] font-bold tracking-[-0.03em] text-balance sm:text-[48px]">
        {b.title}
      </h3>
      <p className="m-0 text-[18px] leading-[1.5] text-pretty text-[var(--ot-text-2)]">{b.body}</p>
    </div>
  )
}

function Stills() {
  return (
    <div className="mx-auto flex w-full max-w-[1140px] flex-col gap-16 px-5 py-16 sm:px-10 sm:py-20">
      {BEATS.map((b, i) => (
        <Still key={b.id} beat={i} />
      ))}
    </div>
  )
}

function Still({ beat }: { beat: number }) {
  const b = BEATS[beat]!
  const progress = useMotionValue(b.still)
  return (
    <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:gap-12">
      <Copy b={b} />
      <Stage progress={progress} beat={beat} />
    </div>
  )
}
