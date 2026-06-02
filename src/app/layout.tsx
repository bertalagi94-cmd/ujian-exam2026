import type { Metadata } from 'next'
import '../styles/globals.css'

export const metadata: Metadata = {
  title: 'SmartExam | MTS Alkhairaat Tatakalai',
  description: 'Sistem Computer Based Test (CBT) MTS Alkhairaat Tatakalai',
  icons: { icon: '/favicon.ico' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  )
}
