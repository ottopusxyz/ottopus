type Listener = (x: number, y: number) => void

const listeners = new Set<Listener>()

let x = 0
let y = 0
let moved = false
let frame = 0

function onMove(e: PointerEvent): void {
  x = e.clientX
  y = e.clientY
  moved = true
  // Coalesce to one notification per frame. A pointermove can fire far more
  // often than the screen refreshes, and every extra call here would be work
  // thrown away before anything was painted.
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    for (const listener of listeners) listener(x, y)
  })
}

/**
 * One pointer listener for the whole page, however many things are watching.
 *
 * Several mascots can be on screen at once — the sign-in dialog over a landing
 * page already makes two — and each attaching its own `pointermove` would mean
 * duplicate work on the most frequent event the browser fires.
 */
export function watchPointer(listener: Listener): () => void {
  if (listeners.size === 0) {
    window.addEventListener('pointermove', onMove, { passive: true })
  }
  listeners.add(listener)
  // A late subscriber should not sit at the origin until the next movement.
  if (moved) listener(x, y)

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      window.removeEventListener('pointermove', onMove)
      if (frame) {
        cancelAnimationFrame(frame)
        frame = 0
      }
    }
  }
}

/** True once the pointer has moved at all. False on a touch device at rest. */
export function pointerHasMoved(): boolean {
  return moved
}
