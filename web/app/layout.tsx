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
    // The font variables go on <html>, not <body>. tokens.css declares
    // --ot-font-* on :root as var(--font-quicksand), and a var() with no
    // fallback that references an undefined variable makes the whole property
    // invalid at computed-value time — which then inherits. On <body> the
    // fonts silently fell through to the browser default stack.
    <html
      lang="en"
      className={`${quicksand.variable} ${figtree.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  )
}
