import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { YAYASAN_AWAL_ID } from '@/lib/tenant'
import { requireDeveloper } from '@/lib/developer-auth'
import { cacheDelPrefix } from '@/lib/cache'
import { hapusYayasanPermanen } from '@/lib/hapus-yayasan'
import { buatLingkupYayasan, cekAktivitasUjianYayasan } from '@/lib/reset-yayasan'

// Penghapusan data besar bisa lama; kalau terpotong, ulangi (proses idempotent).
export const maxDuration = 60

// Aktif/nonaktifkan yayasan. Yayasan awal tidak boleh dinonaktifkan.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = requireDeveloper(req)
  if ('error' in auth) return auth.error

  const { status } = await req.json().catch(() => ({}))
  if (!['AKTIF', 'NONAKTIF'].includes(status)) {
    return NextResponse.json({ error: 'Status harus AKTIF atau NONAKTIF' }, { status: 400 })
  }
  if (params.id === YAYASAN_AWAL_ID && status === 'NONAKTIF') {
    return NextResponse.json({ error: 'Yayasan awal tidak boleh dinonaktifkan' }, { status: 400 })
  }

  const { error } = await createAdminClient().from('yayasan').update({ status }).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  cacheDelPrefix('yayasan:')
  return NextResponse.json({ message: 'Status diperbarui' })
}

// HAPUS PERMANEN sekolah beserta seluruh datanya. TIDAK BISA DIBATALKAN.
// Pengaman berlapis (semua dicek di server, bukan hanya di tampilan):
//   1. Yayasan awal tidak boleh dihapus.
//   2. Sekolah harus sudah NONAKTIF (pengguna sudah tidak bisa login).
//   3. Developer harus mengetik ulang Kode Sekolah persis.
//   4. Ada sesi ujian berjalan / siswa sedang mengerjakan -> ditolak kecuali force=true.
// Body: { konfirmasi: string, force?: boolean }
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = requireDeveloper(req)
  if ('error' in auth) return auth.error

  if (params.id === YAYASAN_AWAL_ID) {
    return NextResponse.json({ error: 'Yayasan utama tidak boleh dihapus' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const db = createAdminClient()
  const { data: y, error: errY } = await db.from('yayasan').select('id, kode, nama, status').eq('id', params.id).maybeSingle()
  if (errY) return NextResponse.json({ error: errY.message }, { status: 500 })
  if (!y) return NextResponse.json({ error: 'Sekolah tidak ditemukan (mungkin sudah terhapus)' }, { status: 404 })

  if (y.status !== 'NONAKTIF') {
    return NextResponse.json({ error: 'Nonaktifkan sekolah ini terlebih dahulu sebelum menghapus.' }, { status: 409 })
  }
  if (String(body?.konfirmasi ?? '').trim().toUpperCase() !== String(y.kode).toUpperCase()) {
    return NextResponse.json({ error: 'Konfirmasi tidak cocok. Ketik Kode Sekolah persis.' }, { status: 400 })
  }

  if (body?.force !== true) {
    const akt = await cekAktivitasUjianYayasan(buatLingkupYayasan(y.id))
    if (akt.error) return NextResponse.json({ error: `Gagal memeriksa ujian aktif: ${akt.error}` }, { status: 500 })
    if (akt.adaSesi || akt.adaSiswa) {
      return NextResponse.json({
        error: 'Masih ada sesi ujian berjalan atau siswa yang sedang mengerjakan. Centang opsi paksa jika tetap ingin menghapus.',
        ada_aktivitas: true,
      }, { status: 409 })
    }
  }

  // Jejak audit (log server). Panel developer tidak punya tabel log sendiri.
  console.warn(`[AUDIT] developer "${auth.user.username}" menghapus permanen sekolah ${y.id} (${y.kode}) "${y.nama}"`)

  const hasil = await hapusYayasanPermanen(y.id)
  cacheDelPrefix('yayasan:')
  cacheDelPrefix('pengaturan:')
  if (!hasil.ok) {
    return NextResponse.json({
      error: 'Penghapusan belum tuntas. Sekolah belum dihapus; data yang sudah terhapus tidak bisa dikembalikan. Ulangi penghapusan sampai berhasil.',
      details: hasil.errors,
      dihapus: hasil.dihapus,
    }, { status: 500 })
  }
  return NextResponse.json({
    message: `Sekolah "${y.nama}" dan seluruh datanya dihapus permanen.`,
    file_dihapus: hasil.fileDihapus,
  })
}
