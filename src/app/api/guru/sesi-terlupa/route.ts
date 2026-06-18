// GET /api/guru/sesi-terlupa
//
// Dipanggil sekali saat guru masuk ke area Guru (lihat src/app/guru/layout.tsx),
// untuk mendeteksi sesi ujian yang KEMUNGKINAN lupa ditutup oleh guru tersebut:
// status sesi masih BERJALAN, TAPI sudah tidak ada siswa yang sedang aktif
// mengerjakan (semua sudah SELESAI/TERKUNCI, atau tidak ada peserta sama sekali).
//
// PENTING — tidak menganggu fitur lain:
// - Hanya mengecek, TIDAK menutup sesi apa pun secara otomatis. Keputusan
//   menutup tetap di tangan guru lewat popup di frontend.
// - Sesi yang dihitung HANYA sesi di mana guru ini adalah pengawas yang
//   AKTIF BERTUGAS sekarang — baik sebagai pengawas asli (jadwal.pengawas)
//   ATAU sebagai pengawas susulan yang ditugaskan ADMIN (info_json.pengawas_susulan).
//   Jika sesi susulan jadwal ini sudah diambil-alih guru LAIN, jadwal itu
//   TIDAK dihitung di sini untuk pengawas asli (konsisten dengan fitur
//   "diambil_alih_pengawas" di /api/guru/mode-pengawas).
// - Siswa berstatus RESET (menunggu kode reset dari pengawas setelah
//   pelanggaran) dianggap MASIH dalam proses ujian — bukan indikasi sesi
//   terlupa, karena siswa tersebut sebenarnya masih butuh tindakan pengawas.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()

  // ── 1. Jadwal yang pengawas aslinya adalah guru ini ──────────────────────
  const { data: jadwalSendiri } = await db
    .from('jadwal')
    .select('id, pengawas')
    .eq('pengawas', user.username)

  // ── 2. Sesi BERJALAN yang sedang ditugaskan ke guru ini sebagai pengawas
  // susulan (lewat fitur Admin > Ujian Susulan) ───────────────────────────
  const { data: sesiSusulanSaya } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id, info_json')
    .eq('status', 'BERJALAN')
    .contains('info_json', { pengawas_susulan: user.username })

  const jadwalIdSusulanSaya = [...new Set((sesiSusulanSaya ?? []).map(s => s.jadwal_id).filter(Boolean))]
  const jadwalIdSendiri = (jadwalSendiri ?? []).map(j => j.id)
  const semuaJadwalId = [...new Set([...jadwalIdSendiri, ...jadwalIdSusulanSaya])]

  if (semuaJadwalId.length === 0) {
    return NextResponse.json({ data: [] })
  }

  // ── 3. Ambil semua sesi BERJALAN untuk jadwal-jadwal tersebut ────────────
  const { data: sesiBerjalan } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id, mapel_id, kelas, kode_sesi, waktu_mulai, info_json')
    .in('jadwal_id', semuaJadwalId)
    .eq('status', 'BERJALAN')

  if (!sesiBerjalan?.length) {
    return NextResponse.json({ data: [] })
  }

  // Saring: untuk jadwal yang BUKAN milik guru ini sebagai pengawas asli,
  // sesi BERJALAN-nya hanya relevan jika info_json.pengawas_susulan = guru ini
  // (mis. jadwal milik guru lain, tapi ADMIN menugaskan guru ini sbg susulan).
  // Untuk jadwal milik guru ini sebagai pengawas asli, sesi relevan KECUALI
  // sesi itu sudah diambil-alih ADMIN untuk guru LAIN (maka bukan tanggung
  // jawab guru ini untuk menutupnya).
  const jadwalSendiriSet = new Set(jadwalIdSendiri)
  const sesiRelevan = sesiBerjalan.filter(s => {
    const dibukaOlehAdmin = !!s.info_json?.dibuka_oleh_admin
    const pengawasSusulan = dibukaOlehAdmin ? s.info_json?.pengawas_susulan : undefined

    if (dibukaOlehAdmin && pengawasSusulan) {
      // Sesi susulan: relevan hanya jika GURU INI adalah pengawas susulannya
      return pengawasSusulan === user.username
    }
    // Sesi normal (bukan susulan admin): relevan jika jadwal ini milik guru ini
    return jadwalSendiriSet.has(s.jadwal_id)
  })

  if (!sesiRelevan.length) {
    return NextResponse.json({ data: [] })
  }

  // ── 4. Cek siswa AKTIF/RESET (masih dalam proses) per sesi ───────────────
  const sesiIds = sesiRelevan.map(s => s.id)
  const { data: siswaUjianList } = await db
    .from('siswa_ujian')
    .select('sesi_id, status')
    .in('sesi_id', sesiIds)

  const adaAktivitasMap: Record<string, boolean> = {}
  for (const su of siswaUjianList ?? []) {
    if (su.status === 'AKTIF' || su.status === 'RESET') {
      adaAktivitasMap[su.sesi_id] = true
    }
  }

  const sesiTerlupa = sesiRelevan.filter(s => !adaAktivitasMap[s.id])
  if (!sesiTerlupa.length) {
    return NextResponse.json({ data: [] })
  }

  // ── 5. Enrich nama mapel & kelas untuk ditampilkan di popup ──────────────
  const mapelIds = [...new Set(sesiTerlupa.map(s => s.mapel_id).filter(Boolean))]
  const kelasIds = [...new Set(sesiTerlupa.map(s => s.kelas).filter(Boolean))]
  const [{ data: mapelList }, { data: kelasList }] = await Promise.all([
    mapelIds.length > 0 ? db.from('mapel').select('id, nama').in('id', mapelIds) : Promise.resolve({ data: [] as { id: string; nama: string }[] }),
    kelasIds.length > 0 ? db.from('kelas').select('id, nama').in('id', kelasIds) : Promise.resolve({ data: [] as { id: string; nama: string }[] }),
  ])
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const kelasMap = Object.fromEntries((kelasList ?? []).map(k => [k.id, k.nama]))

  // Hitung jumlah siswa yang sudah SELESAI/TERKUNCI per sesi, sekadar info tambahan
  const selesaiCountMap: Record<string, number> = {}
  for (const su of siswaUjianList ?? []) {
    if (su.status === 'SELESAI' || su.status === 'TERKUNCI') {
      selesaiCountMap[su.sesi_id] = (selesaiCountMap[su.sesi_id] ?? 0) + 1
    }
  }

  const data = sesiTerlupa.map(s => ({
    sesiId: s.id,
    jadwalId: s.jadwal_id,
    kodeSesi: s.kode_sesi,
    waktuMulai: s.waktu_mulai,
    namaMapel: mapelMap[s.mapel_id] ?? s.mapel_id,
    namaKelas: kelasMap[s.kelas] ?? s.kelas,
    isSusulan: !!s.info_json?.dibuka_oleh_admin,
    jumlahSudahSelesai: selesaiCountMap[s.id] ?? 0,
  }))

  return NextResponse.json({ data })
}
