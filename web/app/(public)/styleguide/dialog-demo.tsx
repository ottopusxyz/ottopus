'use client'

import { useState } from 'react'
import { AddressChip, Button, Dialog } from '@/components/ui'

/**
 * The shell, both tones. Open one on a narrow viewport to get the sheet: the
 * shape changes at 640px, and the grab handle appears with it.
 */
export function DialogDemo() {
  const [open, setOpen] = useState<'plain' | 'destructive' | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setOpen('plain')}>
          Open a dialog
        </Button>
        <Button variant="danger-outline" onClick={() => setOpen('destructive')}>
          Open a destructive confirm
        </Button>
      </div>

      <Dialog
        open={open === 'plain'}
        onClose={() => setOpen(null)}
        title="Connect your agent"
        description="Point any MCP-capable agent at this URL. Nothing to install."
        actions={
          <Button variant="primary" shape="block" onClick={() => setOpen(null)}>
            Done
          </Button>
        }
      >
        <AddressChip address="eip155:8453:0xd8da6bf26964af9d7eed9e03e53415d37aa96045" />
      </Dialog>

      <Dialog
        open={open === 'destructive'}
        onClose={() => setOpen(null)}
        tone="destructive"
        title="Unlink Hot · Rabby?"
        description="Otto stops requesting with this wallet. Your funds stay exactly where they are — unlinking moves nothing."
        actions={
          <>
            <Button variant="destructive" shape="block" onClick={() => setOpen(null)}>
              Unlink this wallet
            </Button>
            <Button variant="secondary" shape="block" onClick={() => setOpen(null)}>
              Cancel
            </Button>
          </>
        }
      />
    </div>
  )
}
