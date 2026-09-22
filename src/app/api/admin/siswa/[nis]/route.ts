import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { hapusFotoEssayFisik } from '@/lib/backup-restore-shared'

interface RouteContext {
  params: { nis: string }
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const body = await req.json()
  const { nama, kelas, jenis_kelamin, tempat_lahir, tanggal_lahir, status, is_tester } = body

  // is_tester dipakai untuk menandai siswa yang boleh login walau maintenance
  // mode aktif (lihat src/app/api/auth/login/route.ts). Divalidasi di server
  // supaya tidak bisa diisi nilai sembarangan lewat panggilan API langsung.
  if (is_tester !== undefined && !['YES', 'NO'].includes(is_tester)) {
    return NextResponse.json({ error: "is_tester harus 'YES' atau 'NO'" }, { status: 400 })
  }

  const { error } = await db
    .from('siswa')
    .update({
      nama: nama ? String(nama).toUpperCase() : undefined,
      kelas: kelas || undefined,
      jenis_kelamin: jenis_kelamin || null,
      tempat_lahir: tempat_lahir || null,
      tanggal_lahir: tanggal_lahir || null,
      status: status || undefined,
      is_tester: is_tester || undefined,
    })
    .eq('nis', params.nis)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Data berhasil diperbarui' })
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { nis } = params

  // FIX (audit lanjutan — Batch 3, "Delete siswa"): versi lama hanya
  // menghapus pelanggaran, nilai, jawaban, siswa_ujian lewat beberapa DELETE
  // TERPISAH (bukan transaksi) — TIDAK PERNAH menyentuh data essay
  // (jawaban_essay, jawaban_essay_foto, skor_essay_siswa,
  // essay_amplop_offline) maupun log_reset, dan tidak ada file fisik foto
  // essay yang dibersihkan dari Storage. Kalau salah satu DELETE gagal di
  // tengah jalan, data jadi campuran separuh-terhapus tanpa jejak.
  //
  // Sekarang, urutannya:
  //  1) Baca foto_url essay siswa ini (kalau ada), hapus fisiknya dari
  //     Storage LEBIH DULU — sebelum baris DB yang menyimpan path/URL-nya
  //     ikut hilang. FAIL-CLOSED: kalau langkah Storage ini gagal, seluruh
  //     operasi DIBATALKAN di sini juga — tidak lanjut ke penghapusan DB.
  //  2) Semua tabel turunan + baris siswa dihapus dalam SATU transaksi
  //     Postgres lewat RPC hapus_siswa_atomik (lihat
  //     supabase/27_hapus_siswa_kelas_atomik.sql) — commit bersama atau
  //     batal bersama, tidak ada lagi kondisi campuran.
  const { data: fotoRows, error: fotoFetchError } = await db
    .from('jawaban_essay_foto')
    .select('foto_url')
    .eq('nis', nis)

  if (fotoFetchError) {
    return NextResponse.json(
      { error: `Gagal memeriksa foto jawaban essay: ${fotoFetchError.message}` },
      { status: 500 }
    )
  }

  const storageErr = await hapusFotoEssayFisik(db, (fotoRows ?? []).map((r) => r.foto_url))
  if (storageErr) {
    return NextResponse.json(
      {
        error: `Gagal menghapus file foto jawaban essay dari Storage, penghapusan siswa dibatalkan: ${storageErr}`,
      },
      { status: 500 }
    )
  }

  // FAIL CLOSED: tidak ada jalur fallback ke penghapusan manual per-tabel
  // kalau RPC gagal (mis. migrasi 27 belum dijalankan) — pola & alasan sama
  // persis dengan simpan_koreksi_essay_atomik (koreksi-essay/route.ts) dan
  // kunci_permanen_atomik (admin/pelanggaran/route.ts).
  const { data: rpcHasil, error: rpcError } = await db.rpc('hapus_siswa_atomik', { p_nis: nis })

  if (rpcError) {
    console.error('[admin/siswa DELETE] hapus_siswa_atomik gagal:', rpcError.message)
    return NextResponse.json(
      {
        error: `Gagal menghapus siswa: ${rpcError.message}. Pastikan migrasi supabase/27_hapus_siswa_kelas_atomik.sql sudah dijalankan.`,
      },
      { status: 500 }
    )
  }

  if (rpcHasil?.hasil === 'SISWA_TIDAK_ADA') {
    return NextResponse.json({ error: 'Siswa tidak ditemukan' }, { status: 404 })
  }

  return NextResponse.json({
    message: 'Siswa beserta seluruh data terkait (nilai, jawaban PG & essay, foto, pelanggaran, log) berhasil dihapus',
  })
}
