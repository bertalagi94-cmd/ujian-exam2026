'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { SiswaSidebar } from '@/components/shared/Sidebar'
import { ViewAsBanner } from '@/components/shared/ViewAsBanner'
import { DipantauBanner } from '@/components/shared/DipantauBanner'
// FIX (belum ada antrean "ujian belum terkirim" yang permanen — temuan #2):
// penjaga outbox dipasang di SINI (bukan di halaman ujian) supaya retry
// pengiriman paket tertunda tetap jalan selama siswa berada di area /siswa
// manapun (beranda, nilai, dst), bukan cuma persis saat berada di halaman
// ujian. Lihat src/lib/ujian-outbox.ts untuk detail siklus statusnya.
import { mulaiPenjagaOutbox } from '@/lib/ujian-outbox'
import { kunciIdentitasTab, identitasTabBerubah } from '@/lib/identitas-tab'
import { AlertTriangle } from 'lucide-react'
import { mulaiPemantauJaringan } from '@/lib/status-jaringan'
import { StatusJaringanBar } from '@/components/shared/StatusJaringanBar'

export default function SiswaLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()

  // Sembunyikan sidebar saat siswa sedang mengerjakan ujian
  const isUjian = pathname?.startsWith('/siswa/ujian')

  useEffect(() => {
    const user = localStorage.getItem('user')
    if (!user) { router.replace('/login'); return }
    const parsed = JSON.parse(user)
    if (parsed.role !== 'SISWA') router.replace('/login')
  }, [router])

  // Identitas siswa tab ini berubah (akun lain login di tab/jendela lain pada
  // profil browser yang sama)? Lihat src/lib/identitas-tab.ts untuk latar
  // belakang. Selama true, apiRequest() menolak mengirim request siswa dari tab
  // ini sehingga data tidak tercampur; jawaban tetap tersimpan di perangkat.
  const [identitasBerubah, setIdentitasBerubah] = useState(false)

  useEffect(() => {
    let nis: string | undefined
    try { nis = JSON.parse(localStorage.getItem('user') ?? '{}').nis } catch { /* abaikan */ }
    if (!nis) return

    // Kunci identitas tab SEBELUM penjaga outbox berjalan, supaya request
    // pertamanya pun sudah terlindungi.
    kunciIdentitasTab(nis)
    const cek = () => setIdentitasBerubah(identitasTabBerubah())
    // 'storage' hanya menyala di tab LAIN saat localStorage berubah -- persis
    // kasusnya. Interval = jaring pengaman (mis. event terlewat saat tab tidur).
    window.addEventListener('storage', cek)
    const idCek = setInterval(cek, 3000)
    const stopOutbox = mulaiPenjagaOutbox(nis)

    return () => {
      window.removeEventListener('storage', cek)
      clearInterval(idCek)
      kunciIdentitasTab(null)
      stopOutbox()
    }
  }, [])

  // Denyut ke server hanya selama siswa berada di halaman ujian.
  useEffect(() => {
    if (!isUjian) return
    return mulaiPemantauJaringan()
  }, [isUjian])

  return (
    <div className="flex min-h-screen bg-surface-50">
      {identitasBerubah && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4">
          <div className="max-w-md rounded-2xl bg-white p-6 shadow-xl text-center">
            <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-500" />
            <h2 className="text-lg font-bold text-gray-900">Akun di browser ini berubah</h2>
            <p className="mt-2 text-sm text-gray-600">
              Ada akun lain yang login di tab atau jendela lain pada browser yang sama, sehingga
              tab ini dihentikan agar jawaban tidak tercampur antar siswa.
            </p>
            <p className="mt-2 text-sm text-gray-600">
              Jawaban yang sudah Anda isi <b>tetap tersimpan di perangkat ini</b> dan bisa
              dilanjutkan setelah login kembali dengan akun Anda. Gunakan satu profil browser
              (atau jendela Incognito) untuk setiap siswa.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="btn-primary mt-4 w-full"
            >
              Muat ulang halaman
            </button>
          </div>
        </div>
      )}
      <ViewAsBanner />
      <DipantauBanner />
      {!isUjian && <SiswaSidebar />}
      <main className={`flex-1 min-w-0 ${isUjian ? 'p-0' : 'p-6 lg:p-8 pt-16 lg:pt-8'}`}>
        {children}
        {/* Ruang kosong setinggi bar jaringan (fixed di bawah) supaya tombol paling bawah tidak tertutup. */}
        {isUjian && <div className="h-7" aria-hidden="true" />}
      </main>
      {isUjian && <StatusJaringanBar />}
    </div>
  )
}
