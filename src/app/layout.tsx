import type { Metadata, Viewport } from 'next'
import '../styles/globals.css'
import { createAdminClient } from '@/lib/supabase'
import { cachedFetch } from '@/lib/cache'

// FIX (judul tab tidak generik): sebelumnya title/description di-hardcode ke
// nama satu sekolah ("MTS Alkhairaat Tatakalai"), padahal aplikasi ini dipakai
// lintas sekolah — setiap sekolah mengatur namanya sendiri lewat menu
// Admin > Pengaturan > Sekolah (tabel `pengaturan`, key `namaSekolah`).
// Sekarang metadata dibuat dinamis lewat generateMetadata: judul tab mengikuti
// nama sekolah yang benar-benar dikonfigurasi, dengan fallback generik
// "SmartExam - Sistem Ujian Digital (CBT)" kalau belum diisi sama sekali.
export async function generateMetadata(): Promise<Metadata> {
  let namaSekolah = ''
  try {
    const result = await cachedFetch<Record<string, string>>('pengaturan:public', 60, async () => {
      const db = createAdminClient()
      const { data, error } = await db.from('pengaturan').select('key, value').in('key', ['namaSekolah'])
      if (error) return {}
      const map: Record<string, string> = {}
      data?.forEach(({ key, value }: { key: string; value: string }) => { map[key] = value ?? '' })
      return map
    })
    namaSekolah = result?.namaSekolah?.trim() ?? ''
  } catch {
    // Biarkan namaSekolah kosong — fallback ke judul generik di bawah.
  }

  const title = namaSekolah ? `SmartExam | ${namaSekolah}` : 'SmartExam - Sistem Ujian Digital (CBT)'
  const description = namaSekolah
    ? `Sistem Computer Based Test (CBT) ${namaSekolah}`
    : 'Sistem Computer Based Test (CBT) untuk sekolah — ujian online dengan pengawasan real-time.'

  return {
    title,
    description,
    icons: { icon: '/favicon.ico' },
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  )
}
