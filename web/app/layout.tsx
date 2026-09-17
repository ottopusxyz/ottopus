import type { Metadata } from 'next'
import { Figtree, JetBrains_Mono, Quicksand } from 'next/font/google'
import './globals.css'

const quicksand = Quicksand({
  variable: '--font-quicksand',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
})

const figtree = Figtree({
  variable: '--font-figtree',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
})

export const metadata: Metadata = {
  title: 'Ottopus',
  description: 'Stop juggling wallets to get one thing done.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${quicksand.variable} ${figtree.variable} ${jetbrainsMono.variable}`}>
        {children}
      </body>
    </html>
  )
}
