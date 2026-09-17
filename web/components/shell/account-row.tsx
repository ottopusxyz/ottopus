/**
 * Who is signed in.
 *
 * A slot: #5 fills the avatar and the identity from the Privy session without
 * touching the shell. The placeholder is deliberately not a fake email — a
 * plausible-looking address here would be indistinguishable from a real one in
 * a screenshot, and this is a product about not misreading identity.
 */
export function AccountRow({ identity }: { identity?: string }) {
  return (
    <div className="flex items-center gap-[9px] rounded-[10px] bg-[var(--ot-surface-2)] p-2">
      <span
        aria-hidden
        className="h-6 w-6 flex-none rounded-full bg-[var(--ot-plan)]"
      />
      <span className="truncate font-mono text-[12px] text-[var(--ot-text-2)]">
        {identity ?? 'Not signed in'}
      </span>
    </div>
  )
}
