// Pratinjau DAMPAK penghapusan sekolah (yayasan), khusus developer.
// Hanya HITUNGAN (head: true) dan ukuran file — tidak ada isi data siswa,
// jawaban, atau nilai yang dibaca, sesuai dinding keamanan Panel Developer.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireDeveloper } from '@/lib/developer-auth'
import { YAYASAN_AWAL_ID } from '@/lib/tenant'
import { pkOf } from '@/lib/backup-restore-shared'
import { buatLingkupYayasan, cekAktivitasUjianYayasan } from '@/lib/reset-yayasan'

export const dynamic = 'force-dynamic'

const TABEL_HITUNG = [
  'siswa', 'users', 'kelas', 'mapel', 'jadwal', 'sesi_ujian',
  'soal', 'soal_essay', 'nilai', 'pelanggaran', 'log_aktivitas',
] as const

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const auth = requireDeveloper(req)
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { data: y, error } = await db.from('yayasan').select('id, kode, nama, status, created_at').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!y) return NextResponse.json({ error: 'Sekolah tidak ditemukan' }, { status: 404 })

  const jumlah: Record<string, number> = {}
  await Promise.all(TABEL_HITUNG.map(async t => {
    const { count, error: e } = await db.from(t)
      .select(pkOf(t)[0], { count: 'exact', head: true }).eq('yayasan_id', id)
    jumlah[t] = e ? 0 : (count ?? 0)
  }))

  const akt = await cekAktivitasUjianYayasan(buatLingkupYayasan(id))

  // Ukuran file Storage milik sekolah ini (folder bernama id yayasan).
  let storage: { jumlahFile: number; ukuranByte: number } | null = null
  try {
    const { data } = await db.rpc('ukuran_storage_per_folder')
    const baris = ((data ?? []) as { folder: string; jumlah_file: number; ukuran_byte: number }[]).filter(b => b.folder === id)
    storage = {
      jumlahFile: baris.reduce((a, b) => a + (Number(b.jumlah_file) || 0), 0),
      ukuranByte: baris.reduce((a, b) => a + (Number(b.ukuran_byte) || 0), 0),
    }
  } catch { /* migrasi 52 belum dijalankan: abaikan */ }

  let blokir: string | null = null
  if (id === YAYASAN_AWAL_ID) blokir = 'Yayasan utama tidak boleh dihapus.'
  else if (y.status !== 'NONAKTIF') blokir = 'Nonaktifkan sekolah ini terlebih dahulu sebelum menghapus.'

  return NextResponse.json({
    data: {
      yayasan: y,
      jumlah,
      aktivitas: { sesiBerjalan: akt.adaSesi, siswaAktif: akt.adaSiswa, error: akt.error ?? null },
      storage,
      blokir,
    },
  })
}
