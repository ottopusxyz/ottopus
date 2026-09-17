import type { ReactNode } from 'react'
import { AppShell } from '@/components/shell'

/**
 * Everything in this group is inside the app frame. Taking a page out means
 * moving it to (public) and writing down why in PUBLIC_ROUTES — routes.test.ts
 * fails otherwise, which is what makes opting out deliberate rather than a
 * side effect of where someone happened to create a folder.
 */
export default function ShellLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>
}
