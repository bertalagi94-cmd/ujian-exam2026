import type { Metadata, Viewport } from 'next'
import '../styles/globals.css'
import { tenantDb, multiYayasanAktif, YAYASAN_AWAL_ID } from '@/lib/tenant'
import { cachedFetch } from '@/lib/cache'
import { ServiceWorkerRegister } from '@/components/shared/ServiceWorkerRegister'
import { StatusModeOffline } from '@/components/shared/StatusModeOffline'
import LampIntro from '@/components/login/LampIntro'
import { LAMP_GATE_SCRIPT } from '@/components/login/lamp-intro-gate'

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
    // Multi-yayasan: layout dirender di server tanpa tahu yayasan pengunjung
    // (belum login), jadi judul tab dibuat generik. Selama saklar mati, tetap
    // memakai nama sekolah milik yayasan awal seperti sebelumnya.
    if (multiYayasanAktif()) throw new Error('judul generik')
    // Kunci cache sendiri: sebelumnya memakai 'pengaturan:public' yang sama
    // dengan /api/public/pengaturan padahal isinya berbeda (hanya namaSekolah).
    const result = await cachedFetch<Record<string, string>>(`pengaturan:layout:${YAYASAN_AWAL_ID}`, 60, async () => {
      const db = tenantDb(YAYASAN_AWAL_ID)
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
    // suppressHydrationWarning: script gate lampu di bawah memasang atribut
    // data-lamp pada <html> sebelum React hidrasi.
    <html lang="id" suppressHydrationWarning>
      <body>
        {/* Lamp intro (sekali sehari, hanya di "/" dan "/login"). Script ini jalan
            sebelum halaman digambar supaya layar gelap langsung menutup login
            tanpa kilatan; lihat src/components/login/lamp-intro-gate.ts. */}
        <script dangerouslySetInnerHTML={{ __html: LAMP_GATE_SCRIPT }} />
        <LampIntro />
        <ServiceWorkerRegister />
        {/* Penanda "Mode Offline" / "Online" di atas semua halaman (fixed, tidak menggeser layout). */}
        <StatusModeOffline />
        {children}
      </body>
    </html>
  )
}
