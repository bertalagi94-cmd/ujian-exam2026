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
// FIX P0 #1 (antrean pelanggaran offline — README "Belum ada"): penjaga
// pelanggaran dipasang di SINI juga, dengan alasan yang sama seperti penjaga
// outbox di atas — event pelanggaran yang sempat gagal terkirim (offline)
// harus tetap dicoba ulang selama siswa berada di area /siswa manapun, bukan
// cuma persis saat berada di halaman ujian. Lihat src/lib/pelanggaran-outbox.ts.
import { mulaiPenjagaPelanggaran } from '@/lib/pelanggaran-outbox'
// P0 (audit reset offline R1/R2/R3): penjaga rekonsiliasi reset yang sempat
// diverifikasi OFFLINE (lihat src/lib/reset-offline-client.ts), alasan sama
// dengan dua penjaga di atas — harus tetap jalan selama siswa di area /siswa.
import { mulaiPenjagaResetOffline } from '@/lib/reset-offline-client'
import { kunciIdentitasTab, identitasTabBerubah } from '@/lib/identitas-tab'
import { AlertTriangle } from 'lucide-react'
import { mulaiPemantauJaringan } from '@/lib/status-jaringan'
import { StatusJaringanBar } from '@/components/shared/StatusJaringanBar'
import { DashboardPhotoBackground } from '@/components/shared/DashboardPhotoBackground'

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
    const stopPelanggaran = mulaiPenjagaPelanggaran(nis)
    const stopResetOffline = mulaiPenjagaResetOffline()

    return () => {
      window.removeEventListener('storage', cek)
      clearInterval(idCek)
      kunciIdentitasTab(null)
      stopOutbox()
      stopPelanggaran()
      stopResetOffline()
    }
  }, [])

  // Denyut ke server hanya selama siswa berada di halaman ujian.
  useEffect(() => {
    if (!isUjian) return
    return mulaiPemantauJaringan()
  }, [isUjian])

  return (
    <div className="flex min-h-screen bg-surface-50">
      {/* Latar kaca transparan (opsional, lihat saklar di Beranda) — non-aktif
          otomatis saat sedang mengerjakan ujian supaya tidak mengganggu
          konsentrasi siswa. */}
      <DashboardPhotoBackground tint="#0891b2" active={!isUjian} />
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
      {/* Pembungkus ini WAJIB ada (sama seperti di layout admin/guru/kepsek):
          DashboardPhotoBackground di atas pakai position:fixed dengan
          z-index:0. Tanpa div ber-z-index eksplisit di sini, sidebar & main
          (yang statis, tanpa z-index) justru dilukis SEBELUM layer foto
          dalam urutan stacking CSS, sehingga foto blur malah menutupi
          seluruh konten dashboard. */}
      <div className="relative z-10 flex w-full">
        {!isUjian && <SiswaSidebar />}
        <main className={`flex-1 min-w-0 ${isUjian ? 'p-0' : 'p-6 lg:p-8 pt-16 lg:pt-8'}`}>
          {children}
          {/* Ruang kosong setinggi bar jaringan (fixed di bawah) supaya tombol paling bawah tidak tertutup. */}
          {isUjian && <div className="h-7" aria-hidden="true" />}
        </main>
      </div>
      {isUjian && <StatusJaringanBar />}
    </div>
  )
}
