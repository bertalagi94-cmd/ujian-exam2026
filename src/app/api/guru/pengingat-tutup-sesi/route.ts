import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { muatPengingatSesi } from '@/lib/sesi-belum-ditutup'

// GET /api/guru/pengingat-tutup-sesi
//
// Pengingat untuk pengawas: sesi miliknya yang masih BERJALAN dan sebaiknya
// ditutup — (a) sesi dari hari kemarin yang belum ditutup, (b) waktu ujian
// sudah lewat, atau (c) semua peserta sudah selesai.
//
// HANYA MEMBACA. Tidak menutup sesi dan tidak mengubah data apa pun. Melengkapi
// (bukan menggantikan) GET /api/guru/sesi-terlupa yang dipakai popup lama:
// endpoint itu sengaja TIDAK dipakai/diubah. Beda utamanya: sesi kemarin yang
// masih punya siswa berstatus AKTIF (mis. siswa menutup aplikasi di tengah
// ujian) tetap diingatkan di sini.
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error

  try {
    const data = await muatPengingatSesi(createAdminClient(), {
      hanyaPengawas: auth.user.username,
    })
    return NextResponse.json({ data })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Gagal memuat pengingat sesi' },
      { status: 500 }
    )
  }
}
