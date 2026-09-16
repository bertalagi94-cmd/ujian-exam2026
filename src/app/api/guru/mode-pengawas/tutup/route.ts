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

  // FIX (hasil update database tidak pernah diperiksa): sebelumnya endpoint
  // ini sama sekali tidak membaca `error` dari update sesi_ujian, jadwal,
  // maupun siswa_ujian, dan hasil finalisasiNilaiPaksa juga tidak dicek —
  // selalu membalas "Sesi berhasil ditutup" apapun yang sebenarnya terjadi
  // di database. Pola & alasan sama persis dengan perbaikan di
  // admin/sesi/[id]/tutup-paksa/route.ts (lihat komentar di sana) — endpoint
  // ini bahkan lebih sering dipakai (penutupan sesi normal oleh pengawas),
  // jadi risikonya lebih sering terpapar.
  const { error: errUpdateSesi } = await db.from('sesi_ujian').update({
    status: 'SELESAI',
    waktu_selesai: new Date().toISOString(),
  }).eq('id', sesiId)

  if (errUpdateSesi) {
    return NextResponse.json(
      { error: `Gagal menutup sesi: ${errUpdateSesi.message}` },
      { status: 500 }
    )
  }

  let peringatan: string[] = []

  if (sesi.jadwal_id) {
    const { error: errJadwal } = await db.from('jadwal').update({ status: 'SELESAI' }).eq('id', sesi.jadwal_id)
    if (errJadwal) {
      peringatan.push(`Sesi berhasil ditutup, tapi status jadwal gagal diperbarui: ${errJadwal.message}`)
    }
  }

  // FIX: sebelumnya siswa yang statusnya AKTIF/RESET saat sesi ditutup paksa
  // (mis. jaringan mati total sampai waktu habis, tidak pernah sempat
  // memanggil /api/siswa/ujian/selesai sendiri) hanya diubah statusnya jadi
  // SELESAI di bawah ini — TIDAK PERNAH mendapat baris di tabel `nilai`,
  // sehingga hilang dari rekap nilai guru/wali kelas tanpa jejak yang jelas.
  // Sekarang: catat dulu NIS siswa yang masih AKTIF/RESET (sebelum diupdate),
  // baru setelah statusnya diubah, hitung & simpan nilai otomatis mereka dari
  // jawaban yang sempat tersinkron ke server — lihat src/lib/finalisasi-nilai.ts.
  const { data: siswaBelumSelesai, error: errFetchSiswa } = await db
    .from('siswa_ujian')
    .select('nis')
    .eq('sesi_id', sesiId)
    .in('status', ['AKTIF', 'RESET'])

  if (errFetchSiswa) {
    return NextResponse.json({
      message: 'Sesi berhasil ditutup, TAPI gagal mengambil daftar siswa yang belum selesai — finalisasi nilai TIDAK dijalankan. Cek manual di halaman koreksi/nilai untuk sesi ini.',
      error: errFetchSiswa.message,
      peringatan,
    }, { status: 207 })
  }

  // FIX: tambahkan 'RESET' agar siswa yang sedang di-reset juga ikut diselesaikan
  const { error: errUpdateSiswa } = await db.from('siswa_ujian')
    .update({ status: 'SELESAI', waktu_selesai: new Date().toISOString() })
    .eq('sesi_id', sesiId)
    .in('status', ['AKTIF', 'RESET'])   // ← FIX: was .eq('status', 'AKTIF')

  if (errUpdateSiswa) {
    return NextResponse.json({
      message: 'Sesi berhasil ditutup, TAPI gagal mengubah status siswa yang masih AKTIF/RESET — finalisasi nilai TIDAK dijalankan untuk mereka. Cek manual di halaman koreksi/nilai untuk sesi ini.',
      error: errUpdateSiswa.message,
      peringatan,
    }, { status: 207 })
  }

  const nisPerluDinilai = (siswaBelumSelesai ?? []).map(s => s.nis)
  const hasilFinalisasi = await finalisasiNilaiPaksa(db, sesiId, nisPerluDinilai)

  if (!hasilFinalisasi.ok) {
    return NextResponse.json({
      message: `Sesi & status siswa berhasil ditutup, TAPI finalisasi nilai otomatis GAGAL untuk ${nisPerluDinilai.length} siswa. Nilai mereka HARUS diinput/diperiksa manual — jangan anggap sudah selesai.`,
      error: hasilFinalisasi.error,
      jumlahSiswaSeharusnyaDinilai: nisPerluDinilai.length,
      peringatan,
    }, { status: 207 })
  }

  return NextResponse.json({
    message: peringatan.length ? 'Sesi berhasil ditutup, dengan catatan.' : 'Sesi berhasil ditutup',
    jumlahSiswaDinilaiOtomatis: hasilFinalisasi.jumlahDinilai,
    peringatan: peringatan.length ? peringatan : undefined,
  })
}
