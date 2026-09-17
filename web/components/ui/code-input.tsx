'use client'

import { useId, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

export interface CodeInputProps {
  value: string
  onChange: (value: string) => void
  length?: number
  label?: string
  invalid?: boolean
  autoFocus?: boolean
  name?: string
  className?: string
}

/**
 * A one-time code, one box per digit.
 *
 * One real input behind the boxes, not one input per box. Six inputs is the
 * obvious build and the wrong one: `autocomplete="one-time-code"` fills a
 * single field, so splitting it throws away the autofill that makes a code
 * bearable on a phone, and it leaves a screen reader announcing six unlabelled
 * fields where there is one thing to enter. The boxes here are decoration over
 * a normal text field, which also means paste, undo and selection work without
 * anything being reimplemented.
 */
export function CodeInput({
  value,
  onChange,
  length = 6,
  label = 'One-time code',
  invalid = false,
  autoFocus = false,
  name,
  className,
}: CodeInputProps) {
  const ref = useRef<HTMLInputElement>(null)
  const id = useId()
  const [focused, setFocused] = useState(false)

  const digits = Array.from({ length }, (_, i) => value[i] ?? '')
  // The caret sits on the first empty box, or on the last once it is full.
  const active = Math.min(value.length, length - 1)

  return (
    <div className={cn('relative', className)}>
      <input
        ref={ref}
        id={id}
        name={name}
        value={value}
        // Digits only, and never longer than the code. Stripping here rather
        // than validating on submit means a pasted "Code: 123456" still works.
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label={label}
        aria-invalid={invalid || undefined}
        autoFocus={autoFocus}
        maxLength={length}
        required
        // Covers the boxes so a tap anywhere focuses it, and invisible rather
        // than off-screen so the browser still scrolls to it and can attach
        // its own autofill affordance.
        className="absolute inset-0 z-10 w-full cursor-text text-transparent caret-transparent opacity-0"
      />
      <div aria-hidden className="flex justify-between gap-2">
        {digits.map((digit, i) => (
          <span
            key={i}
            className={cn(
              'flex h-12 flex-1 items-center justify-center rounded-[10px] border',
              'bg-[var(--ot-surface-2)] font-mono text-[18px] font-semibold tabular-nums',
              'transition-colors duration-[var(--ot-dur-fast)]',
              invalid
                ? 'border-[var(--ot-block-border)]'
                : focused && i === active
                  ? 'border-[var(--ot-plan)] ring-2 ring-[var(--ot-plan-bg)]'
                  : 'border-[var(--ot-border-strong)]',
            )}
          >
            {digit || (
              <span className="h-[3px] w-[10px] rounded-full bg-[var(--ot-text-4)]" />
            )}
          </span>
        ))}
      </div>
    </div>
  )
}
