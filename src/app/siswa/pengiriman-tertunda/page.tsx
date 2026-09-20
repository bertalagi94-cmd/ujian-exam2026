'use client'

// FIX (belum ada antrean "ujian belum terkirim" yang permanen — temuan #2):
// halaman ini membaca LANGSUNG dari outbox lokal (src/lib/ujian-outbox.ts,
// disimpan di localStorage) — SENGAJA bukan dari React state global — supaya
// daftar ini tetap ada & akurat walau browser di-refresh atau siswa baru
// membuka lagi aplikasinya nanti. Penjaga latar belakang yang sesungguhnya
// mengirim ulang paket ini berjalan di src/app/siswa/layout.tsx
// (mulaiPenjagaOutbox), sehingga tetap mencoba walau siswa tidak sedang
// membuka halaman ini sekalipun. Tombol "Kirim Sekarang" di sini murni
// memicu satu percobaan manual, untuk siswa yang tidak mau menunggu 20 detik
// interval berikutnya.

import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, Send, CheckCircle2, AlertTriangle, Inbox, Trash2 } from 'lucide-react'
import { EmptyState } from '@/components/ui'
import {
  ambilSemuaPaketTertunda, cobaKirimPaketTertunda, hapusPaketTertunda,
  paketMengirimMacet, statusSedangBerjalan,
  type PaketUjianTertunda, type StatusPaketTertunda,
} from '@/lib/ujian-outbox'

function labelStatus(status: StatusPaketTertunda): { teks: string; kelas: string } {
  switch (status) {
    case 'MENGIRIM': return { teks: 'Mengirim…', kelas: 'bg-brand-50 text-brand-700 border-brand-100' }
    case 'MENYINKRONKAN': return { teks: 'Menyinkronkan jawaban…', kelas: 'bg-brand-50 text-brand-700 border-brand-100' }
    case 'MENUNGGU_JARINGAN': return { teks: 'Menunggu koneksi', kelas: 'bg-amber-50 text-amber-700 border-amber-100' }
    case 'GAGAL': return { teks: 'Ditolak server — hubungi pengawas', kelas: 'bg-red-50 text-red-700 border-red-100' }
    case 'TERKIRIM': return { teks: 'Terkirim', kelas: 'bg-emerald-50 text-emerald-700 border-emerald-100' }
    default: return { teks: 'Siap dikirim', kelas: 'bg-slate-50 text-slate-600 border-slate-200' }
  }
}

export default function PengirimanTertundaPage() {
  const [daftar, setDaftar] = useState<PaketUjianTertunda[]>([])
  const [mengirimId, setMengirimId] = useState<string | null>(null)
  const [nis, setNis] = useState<string | null>(null)

  // FIX AUDIT P0 #7: ambilSemuaPaketTertunda sekarang async (IndexedDB) —
  // lihat src/lib/ujian-outbox.ts.
  const muatUlang = useCallback((nisAktif: string) => {
    ambilSemuaPaketTertunda(nisAktif).then(setDaftar)
  }, [])

  useEffect(() => {
    let nisAktif: string | undefined
    try { nisAktif = JSON.parse(localStorage.getItem('user') ?? '{}').nis } catch { /* abaikan */ }
    if (!nisAktif) return
    setNis(nisAktif)
    muatUlang(nisAktif)
    // Poll ringan tiap 5 detik — cukup untuk menangkap perubahan status yang
    // dibuat oleh penjaga latar belakang (mulaiPenjagaOutbox) di layout,
    // tanpa perlu event-bus/context tambahan hanya untuk halaman ini.
    const interval = setInterval(() => muatUlang(nisAktif!), 5000)
    return () => clearInterval(interval)
  }, [muatUlang])

  async function kirimSekarang(paket: PaketUjianTertunda) {
    setMengirimId(paket.sesiId)
    await cobaKirimPaketTertunda(paket)
    if (nis) muatUlang(nis)
    setMengirimId(null)
  }

  // Hapus paket yang tidak akan pernah berhasil (ditolak server / macet).
  // Yang dihapus HANYA antrean pengiriman di perangkat ini -- jawaban yang
  // sudah tersimpan di server tidak tersentuh.
  async function hapusPaket(paket: PaketUjianTertunda) {
    const yakin = window.confirm(
      `Hapus "${paket.namaMapel}" dari daftar pengiriman tertunda?\n\n` +
      'Ini hanya menghapus antrean di perangkat ini. Jawaban yang sudah tersimpan di server tidak terhapus.'
    )
    if (!yakin) return
    await hapusPaketTertunda(paket.sesiId, paket.nis)
    if (nis) muatUlang(nis)
  }

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Pengiriman Ujian Tertunda</h1>
        <p className="text-sm text-slate-500 mt-1">
          Ujian yang jawabannya sudah aman tersimpan tetapi belum berhasil dikonfirmasi ke server
          karena masalah koneksi. Halaman ini tetap menampilkan daftar ini walau Anda menutup dan
          membuka kembali aplikasi — sistem juga otomatis mencoba mengirim ulang di latar belakang.
        </p>
      </div>

      {daftar.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Tidak ada pengiriman tertunda"
          description="Semua ujian Anda sudah terkonfirmasi diterima server."
        />
      ) : (
        <div className="space-y-3">
          {daftar.map((p) => {
            const macet = paketMengirimMacet(p)
            const status = macet
              ? { teks: 'Macet — coba kirim ulang atau hapus', kelas: 'bg-amber-50 text-amber-700 border-amber-100' }
              : labelStatus(p.status)
            // Tombol manual mati hanya selama percobaan MASIH berjalan sungguhan.
            const bisaKirimManual = !statusSedangBerjalan(p.status) || macet
            const bisaHapus = p.status === 'GAGAL' || macet
            return (
              <div key={p.sesiId} className="card flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800 text-sm truncate">{p.namaMapel}</div>
                  <div className={`inline-flex items-center gap-1.5 mt-1.5 text-xs font-medium border rounded-full px-2.5 py-1 ${status.kelas}`}>
                    {p.status === 'TERKIRIM' && <CheckCircle2 className="w-3.5 h-3.5" />}
                    {p.status === 'GAGAL' && <AlertTriangle className="w-3.5 h-3.5" />}
                    {status.teks}
                  </div>
                  {p.pesanTerakhir && p.status !== 'TERKIRIM' && (
                    <p className="text-xs text-slate-400 mt-1">{p.pesanTerakhir}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {bisaHapus && (
                    <button
                      onClick={() => hapusPaket(p)}
                      className="btn-secondary !py-2 !px-3 text-sm"
                      title="Hapus dari daftar"
                    >
                      <Trash2 className="w-4 h-4" />
                      Hapus
                    </button>
                  )}
                  <button
                    onClick={() => kirimSekarang(p)}
                    disabled={!bisaKirimManual || mengirimId === p.sesiId}
                    className="btn-primary !py-2 !px-3 text-sm"
                  >
                    {mengirimId === p.sesiId ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    Kirim Sekarang
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
