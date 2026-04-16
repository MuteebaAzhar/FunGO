import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const plus = Plus_Jakarta_Sans({
  subsets: ['latin'], variable: '--font-plus',
  weight: ['300','400','500','600','700'],
})
const jb = JetBrains_Mono({
  subsets: ['latin'], variable: '--font-jb',
  weight: ['400','500'],
})

export const metadata: Metadata = {
  title: 'FunGO — Protein Function Prediction',
  description: 'Beyond Prediction — Understanding Function. Predict Gene Ontology terms using ESM2-t36-3B and XGBoost.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plus.variable} ${jb.variable}`}>
      <body>{children}</body>
    </html>
  )
}
