'use client'

// ── POPUP "UJIAN SUDAH DIBUKA" SAAT SISWA LOGIN ─────────────────────────────
// Muncul SEKALI per login bila, begitu siswa masuk, ada sesi ujian yang sudah
// dibuka pengawas tetapi belum ia ikuti. Penanda "sudah ditampilkan" disimpan
// di sessionStorage dengan kunci potongan akhir token, jadi:
//   • refresh / pindah halaman  → tidak muncul lagi,
//   • login ulang (token baru)  → muncul lagi bila masih ada sesi terbuka.
// Tidak muncul saat admin memakai mode "Lihat sebagai".

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PlayCircle } from 'lucide-react'
import { Modal } from '@/components/ui'
import { apiRequest } from '@/lib/utils'

const KUNCI = 'sesi-dibuka-popup-login'

interface Item {
  nama_mapel: string
  lanjutEssay: boolean
}

interface Props {
  /** Jumlah sesi terbuka dari /api/notif; undefined = belum termuat. */
  jumlah: number | undefined
}

export function SesiDibukaPopup({ jumlah }: Props) {
  const router = useRouter()
  const [daftar, setDaftar] = useState<Item[] | null>(null)

  useEffect(() => {
    if (jumlah === undefined) return // data notifikasi belum termuat
    let tanda = ''
    try {
      const user = JSON.parse(localStorage.getItem('user') ?? '{}')
      if (user?.viewAs) return
      tanda = (localStorage.getItem('token') ?? '').slice(-16)
      if (!tanda || sessionStorage.getItem(KUNCI) === tanda) return
      // Tandai SEKARANG: hanya pemeriksaan pertama setelah login yang dihitung.
      sessionStorage.setItem(KUNCI, tanda)
    } catch {
      return
    }
    if (jumlah <= 0) return

    apiRequest<{ data?: { nama_mapel?: string; status: string; sudah_ikut: boolean; essayPending?: boolean }[] }>(
      '/api/siswa/jadwal',
      { timeoutMs: 8_000, cache: 'no-store' }
    )
      .then(json => {
        const d = (json.data ?? [])
          .filter(j => j.status === 'BERJALAN' && !j.sudah_ikut)
          .map(j => ({ nama_mapel: j.nama_mapel ?? 'Ujian', lanjutEssay: !!j.essayPending }))
        if (d.length > 0) setDaftar(d)
      })
      .catch(() => { /* popup hanya pelengkap; badge tetap tampil */ })
  }, [jumlah])

  const tutup = () => setDaftar(null)
  const mulai = () => {
    setDaftar(null)
    router.push('/siswa/ujian')
  }

  return (
    <Modal
      open={!!daftar}
      onClose={tutup}
      title="Ujian Sudah Dibuka"
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={tutup}>Nanti</button>
          <button className="btn-primary" onClick={mulai}>
            <PlayCircle className="w-4 h-4" /> Ke Halaman Ujian
          </button>
        </>
      }
    >
      {daftar && (
        <div className="space-y-3 text-sm text-slate-700">
          <p>
            {daftar.length === 1
              ? 'Pengawas telah membuka sesi ujian berikut dan Anda belum menyelesaikannya:'
              : `Pengawas telah membuka ${daftar.length} sesi ujian berikut dan Anda belum menyelesaikannya:`}
          </p>
          <ul className="space-y-1.5">
            {daftar.map((d, i) => (
              <li key={i} className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2">
                <span className="font-semibold text-slate-900">{d.nama_mapel}</span>
                {d.lanjutEssay && <span className="text-slate-600"> (lanjutkan bagian essay)</span>}
              </li>
            ))}
          </ul>
          <p className="text-slate-600">
            Buka menu <b>Mulai Ujian</b> dan siapkan kode ujian dari pengawas.
          </p>
        </div>
      )}
    </Modal>
  )
}
