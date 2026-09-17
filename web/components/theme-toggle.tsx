'use client'

import { useId, useSyncExternalStore } from 'react'
import { cn } from '@/lib/cn'

type Choice = 'light' | 'dark' | 'system'
const STORAGE_KEY = 'ot-theme'
const CHOICES: Choice[] = ['light', 'system', 'dark']

/**
 * Three states, not two. "System" is a real choice and the default — a two-way
 * toggle silently opts everyone out of their OS setting the first time they
 * touch it.
 *
 * The attribute is what the tokens key off: [data-theme] wins, and its absence
 * means follow prefers-color-scheme.
 */
function apply(choice: Choice): void {
  const root = document.documentElement
  if (choice === 'system') delete root.dataset.theme
  else root.dataset.theme = choice
}

function readChoice(): Choice {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

/**
 * localStorage is the source of truth rather than mirrored into React state,
 * which avoids a setState-in-effect cascade.
 */
let listeners: (() => void)[] = []

function subscribe(onChange: () => void): () => void {
  // A storage event means another tab changed the choice. Apply it to the DOM
  // here — telling React to rerender only updates the control, and the page
  // would keep the old theme while the buttons claimed otherwise.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== STORAGE_KEY) return
    apply(readChoice())
    onChange()
  }
  listeners.push(onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    listeners = listeners.filter((l) => l !== onChange)
    window.removeEventListener('storage', onStorage)
  }
}

/** The server cannot know the stored choice, and guessing would flash. */
const serverChoice = (): Choice => 'system'

function pick(next: Choice): void {
  apply(next)
  try {
    if (next === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Private browsing can refuse storage; the choice still applies for now.
  }
  listeners.forEach((l) => l())
}

/**
 * Native radios rather than role="radio" on buttons. A hand-rolled radiogroup
 * has to implement roving focus and arrow keys to match what the role promises;
 * real inputs give that, plus form semantics, for free. The inputs are visually
 * hidden, and the label is the control.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const choice = useSyncExternalStore(subscribe, readChoice, serverChoice)
  const name = useId()

  return (
    <fieldset
      className={cn(
        'inline-flex gap-1 rounded-[var(--ot-radius-pill)] border border-[var(--ot-border)]',
        'bg-[var(--ot-card)] p-1',
        className,
      )}
    >
      <legend className="sr-only">Colour theme</legend>
      {CHOICES.map((c) => (
        <label
          key={c}
          className={cn(
            'cursor-pointer rounded-[var(--ot-radius-pill)] px-3 py-1 text-[12px] font-medium capitalize',
            'transition-colors duration-[var(--ot-dur-fast)]',
            'has-[:focus-visible]:outline has-[:focus-visible]:outline-2',
            'has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--ot-plan)]',
            choice === c
              ? 'bg-[var(--ot-coral)] text-[var(--ot-on-state)]'
              : 'text-[var(--ot-text-2)] hover:text-[var(--ot-text)]',
          )}
        >
          <input
            type="radio"
            name={name}
            value={c}
            checked={choice === c}
            onChange={() => pick(c)}
            className="sr-only"
          />
          {c}
        </label>
      ))}
    </fieldset>
  )
}

/**
 * Runs before first paint, so a stored dark choice does not flash light first.
 * Inline and synchronous on purpose — anything deferred is too late.
 */
export const themeScript = `try{var t=localStorage.getItem('${STORAGE_KEY}');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}`
