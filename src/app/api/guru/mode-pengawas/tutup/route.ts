import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { verifySesiOwnership } from '@/lib/sesi-ownership'
import { finalisasiNilaiPaksa } from '@/lib/finalisasi-nilai'

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { sesiId } = await req.json()

  // FIX: sebelumnya endpoint ini hanya mengecek role GURU, tidak mengecek
  // apakah guru pemanggil memang pengawas sesi ini — sehingga guru mana pun
  // bisa menutup (dan memicu auto-grade) sesi ujian milik guru lain kalau
  // memanggil API ini langsung.
  const sah = await verifySesiOwnership(db, sesiId, auth.user.username)
  if (!sah) {
    return NextResponse.json({ error: 'Anda bukan pengawas sesi ini' }, { status: 403 })
  }

  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('jadwal_id')
    .eq('id', sesiId)
    .single()

  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  await db.from('sesi_ujian').update({
    status: 'SELESAI',
    waktu_selesai: new Date().toISOString(),
  }).eq('id', sesiId)

  if (sesi.jadwal_id) {
    await db.from('jadwal').update({ status: 'SELESAI' }).eq('id', sesi.jadwal_id)
  }

  // FIX: sebelumnya siswa yang statusnya AKTIF/RESET saat sesi ditutup paksa
  // (mis. jaringan mati total sampai waktu habis, tidak pernah sempat
  // memanggil /api/siswa/ujian/selesai sendiri) hanya diubah statusnya jadi
  // SELESAI di bawah ini — TIDAK PERNAH mendapat baris di tabel `nilai`,
  // sehingga hilang dari rekap nilai guru/wali kelas tanpa jejak yang jelas.
  // Sekarang: catat dulu NIS siswa yang masih AKTIF/RESET (sebelum diupdate),
  // baru setelah statusnya diubah, hitung & simpan nilai otomatis mereka dari
  // jawaban yang sempat tersinkron ke server — lihat src/lib/finalisasi-nilai.ts.
  const { data: siswaBelumSelesai } = await db
    .from('siswa_ujian')
    .select('nis')
    .eq('sesi_id', sesiId)
    .in('status', ['AKTIF', 'RESET'])

  // FIX: tambahkan 'RESET' agar siswa yang sedang di-reset juga ikut diselesaikan
  await db.from('siswa_ujian')
    .update({ status: 'SELESAI', waktu_selesai: new Date().toISOString() })
    .eq('sesi_id', sesiId)
    .in('status', ['AKTIF', 'RESET'])   // ← FIX: was .eq('status', 'AKTIF')

  const nisPerluDinilai = (siswaBelumSelesai ?? []).map(s => s.nis)
  await finalisasiNilaiPaksa(db, sesiId, nisPerluDinilai)

  return NextResponse.json({ message: 'Sesi berhasil ditutup' })
}
