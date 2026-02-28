import { Inter, Playfair_Display, JetBrains_Mono, Space_Grotesk } from 'next/font/google'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--font-playfair' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' })
const space = Space_Grotesk({ subsets: ['latin'], variable: '--font-space' })

export default function MockupsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${inter.variable} ${playfair.variable} ${jetbrains.variable} ${space.variable}`}>
      {children}
    </div>
  )
}
