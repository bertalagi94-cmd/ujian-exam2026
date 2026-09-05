import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { verifySesiOwnershipCached } from '@/lib/sesi-ownership'

// GET /api/pengawas/sesi/[id]/siswa
// Mengembalikan daftar SEMUA siswa target sesi ini — termasuk yang BELUM
// login — supaya guru/pengawas tahu persis siapa saja yang belum masuk
// ujian, bukan hanya siswa yang kebetulan sudah tercatat di `siswa_ujian`.
//
// FIX: sebelumnya endpoint ini HANYA membaca tabel `siswa_ujian` (baris di
// tabel ini baru dibuat SAAT siswa berhasil login ke ruang ujian). Akibatnya
// siswa yang belum login tidak pernah tampil sama sekali di halaman Mode
// Pengawas — padahal itu justru informasi yang paling dibutuhkan pengawas
// (siapa yang belum masuk, supaya bisa dicari/diingatkan).
//
// FIX: sekarang endpoint ini juga menghitung "target peserta" sesi —
// - sesi susulan (is_darurat = true): target = sesi_ujian.siswa_diizinkan
//   (daftar NIS yang memang berhak ikut susulan ini — lihat
//   /api/guru/susulan dan /api/admin/susulan, keduanya selalu mengisi
//   kolom ini dengan daftar non-kosong saat membuka sesi susulan)
// - sesi reguler: target = semua siswa dengan status AKTIF di kelas yang
//   sama dengan sesi_ujian.kelas
// Siswa yang ada di target tapi BELUM ada baris di siswa_ujian diberi
// status semu "BELUM_LOGIN".
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireRole(req, ['GURU', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const sesiId = params.id

  // FIX: sebelumnya endpoint ini hanya mengecek role (GURU/ADMIN), tidak
  // mengecek apakah guru pemanggil memang pengawas sesi ini — sehingga guru
  // mana pun bisa melihat daftar siswa sesi ujian guru lain kalau memanggil
  // API ini langsung. ADMIN tetap tidak dibatasi.
  if (auth.user.role === 'GURU') {
    const sah = await verifySesiOwnershipCached(db, sesiId, auth.user.username)
    if (!sah) {
      return NextResponse.json({ error: 'Anda bukan pengawas sesi ini' }, { status: 403 })
    }
  }

  // Ambil info sesi untuk menentukan target peserta.
  const { data: sesi, error: sesiError } = await db
    .from('sesi_ujian')
    .select('kelas, is_darurat, siswa_diizinkan')
    .eq('id', sesiId)
    .maybeSingle()

  if (sesiError) return NextResponse.json({ error: sesiError.message }, { status: 500 })
  if (!sesi) return NextResponse.json({ error: 'Sesi ujian tidak ditemukan' }, { status: 404 })

  // Ambil semua siswa yang SUDAH login (baris di siswa_ujian) untuk sesi ini
  const { data: siswaUjian, error } = await db
    .from('siswa_ujian')
    .select('nis, status, waktu_daftar, waktu_mulai, waktu_selesai')
    .eq('sesi_id', sesiId)
    .order('waktu_daftar', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const siswaUjianMap = new Map((siswaUjian ?? []).map(s => [s.nis, s]))

  // Tentukan target peserta sesi ini.
  let targetSiswa: { nis: string; nama: string; kelas: string }[] = []
  if (sesi.is_darurat && Array.isArray(sesi.siswa_diizinkan) && sesi.siswa_diizinkan.length > 0) {
    const { data } = await db
      .from('siswa')
      .select('nis, nama, kelas')
      .in('nis', sesi.siswa_diizinkan)
    targetSiswa = data ?? []
  } else if (sesi.kelas) {
    const { data } = await db
      .from('siswa')
      .select('nis, nama, kelas')
      .eq('kelas', sesi.kelas)
      .eq('status', 'AKTIF')
    targetSiswa = data ?? []
  }

  // Jaga-jaga: kalau ada baris siswa_ujian yang NIS-nya di luar target
  // (mis. siswa pindah kelas setelah sesi dibuka), tetap sertakan supaya
  // pengawas tidak kehilangan pantauan terhadap siswa yang sudah terlanjur
  // login.
  const targetNisSet = new Set(targetSiswa.map(s => s.nis))
  const extraNis = [...siswaUjianMap.keys()].filter(nis => !targetNisSet.has(nis))
  if (extraNis.length > 0) {
    const { data: extraSiswa } = await db
      .from('siswa')
      .select('nis, nama, kelas')
      .in('nis', extraNis)
    targetSiswa = targetSiswa.concat(extraSiswa ?? [])
  }

  if (!targetSiswa.length) return NextResponse.json({ data: [] })

  const nisList = targetSiswa.map(s => s.nis)
  const siswaMap = Object.fromEntries(targetSiswa.map(s => [s.nis, { nama: s.nama, kelas: s.kelas }]))

  // Ambil jumlah pelanggaran tiap siswa
  const { data: pelanggaranList } = await db
    .from('pelanggaran')
    .select('nis, level')
    .eq('sesi_id', sesiId)
    .in('nis', nisList)

  // Hitung jumlah pelanggaran per siswa (count seluruh entri)
  const pelanggaranMap: Record<string, number> = {}
  for (const p of pelanggaranList ?? []) {
    pelanggaranMap[p.nis] = (pelanggaranMap[p.nis] ?? 0) + 1
  }

  // Ambil kode reset aktif (kode 7 digit untuk siswa yang di-reset)
  const { data: resetList } = await db
    .from('log_reset')
    .select('nis, password_baru, digunakan, created_at')
    .in('nis', nisList)
    .eq('digunakan', false)
    .order('created_at', { ascending: false })

  // Kode reset aktif per siswa (yang belum digunakan)
  const resetMap: Record<string, string> = {}
  for (const r of resetList ?? []) {
    if (!resetMap[r.nis]) resetMap[r.nis] = r.password_baru
  }

  // Siswa yang sudah login — urutan sesuai waktu login (seperti sebelumnya)
  const sudahLogin = (siswaUjian ?? []).map(s => ({
    nis: s.nis,
    nama: siswaMap[s.nis]?.nama ?? s.nis,
    kelas: siswaMap[s.nis]?.kelas ?? '-',
    status: s.status,
    waktu_daftar: s.waktu_daftar,
    waktu_selesai: s.waktu_selesai,
    jumlah_pelanggaran: pelanggaranMap[s.nis] ?? 0,
    kode_reset: resetMap[s.nis] ?? null,
  }))

  // Siswa target yang BELUM punya baris di siswa_ujian sama sekali —
  // diurutkan berdasarkan nama supaya mudah disisir pengawas.
  const belumLogin = targetSiswa
    .filter(s => !siswaUjianMap.has(s.nis))
    .sort((a, b) => a.nama.localeCompare(b.nama, 'id'))
    .map(s => ({
      nis: s.nis,
      nama: s.nama,
      kelas: s.kelas,
      status: 'BELUM_LOGIN' as const,
      waktu_daftar: null,
      waktu_selesai: null,
      jumlah_pelanggaran: 0,
      kode_reset: null,
    }))

  return NextResponse.json({ data: [...sudahLogin, ...belumLogin] })
}
