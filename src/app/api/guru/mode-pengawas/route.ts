import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

function generateKodeSesi7(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 7; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()

  // ── 1. Ambil semua jadwal milik guru ini ──────────────────────────────────
  const today = new Date().toISOString().slice(0, 10)
  const todayStart = `${today}T00:00:00`
  const todayEnd   = `${today}T23:59:59`

  const { data: semuaJadwalSendiri, error: errJadwal } = await db
    .from('jadwal')
    .select('*')
    .eq('pengawas', user.username)
    .order('sesi')

  if (errJadwal) return NextResponse.json({ error: errJadwal.message }, { status: 500 })

  // ── 1b. Tambahan: jadwal yang BUKAN milik guru ini sebagai pengawas asli,
  // tapi guru ini ditugaskan ADMIN sebagai pengawas sesi SUSULAN-nya
  // (fitur tambahan: Ujian Susulan dari menu Admin). Pengawas asli & jadwal
  // aslinya tidak diubah — guru susulan hanya "dipinjamkan" akses pantau.
  const { data: sesiSusulanSaya } = await db
    .from('sesi_ujian')
    .select('jadwal_id, info_json')
    .eq('status', 'BERJALAN')
    .contains('info_json', { pengawas_susulan: user.username })

  const jadwalIdSusulanSaya = [...new Set((sesiSusulanSaya ?? []).map(s => s.jadwal_id).filter(Boolean))]

  let jadwalSusulanSaya: typeof semuaJadwalSendiri = []
  if (jadwalIdSusulanSaya.length > 0) {
    const sudahAda = new Set((semuaJadwalSendiri ?? []).map(j => j.id))
    const { data: jadwalTambahan } = await db
      .from('jadwal')
      .select('*')
      .in('id', jadwalIdSusulanSaya.filter(id => !sudahAda.has(id)))
    jadwalSusulanSaya = jadwalTambahan ?? []
  }

  const semuaJadwal = [...(semuaJadwalSendiri ?? []), ...jadwalSusulanSaya]
  if (!semuaJadwal?.length) return NextResponse.json({ data: [], sesiAktif: [] })

  // ── 2. Ambil SEMUA sesi_ujian untuk jadwal guru ini ──────────────────────
  const semuaJadwalIds = semuaJadwal.map(j => j.id)
  const { data: semuaSesi } = await db
    .from('sesi_ujian')
    .select('*')
    .in('jadwal_id', semuaJadwalIds)
    .order('waktu_mulai', { ascending: false })

  // ── 3. Tentukan jadwal mana yang tampil di Mode Pengawas ─────────────────
  // Tampilkan jadwal jika: (a) jadwalnya hari ini, ATAU (b) ada sesi BERJALAN
  const sesiByJadwal: Record<string, typeof semuaSesi> = {}
  for (const s of semuaSesi ?? []) {
    if (!sesiByJadwal[s.jadwal_id]) sesiByJadwal[s.jadwal_id] = []
    const arr = sesiByJadwal[s.jadwal_id]
    if (arr) arr.push(s)
  }

  const jadwalList = semuaJadwal.filter(j => {
    const tanggal = j.tanggal?.slice(0, 10) ?? j.tanggal
    const isHariIni = tanggal === today ||
      (tanggal >= todayStart && tanggal <= todayEnd)
    const adaSesiAktif = (sesiByJadwal[j.id] ?? []).some(s => s.status === 'BERJALAN')
    return isHariIni || adaSesiAktif
  })

  if (!jadwalList.length) return NextResponse.json({ data: [], sesiAktif: [] })

  // ── 4. Enrich nama mapel & kelas ─────────────────────────────────────────
  const mapelIds = [...new Set(jadwalList.map(j => j.mapel_id).filter(Boolean))]
  const kelasIds = [...new Set(jadwalList.map(j => j.kelas).filter(Boolean))]
  const [{ data: mapelList }, { data: kelasList }] = await Promise.all([
    db.from('mapel').select('id, nama').in('id', mapelIds),
    db.from('kelas').select('id, nama').in('id', kelasIds),
  ])
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const kelasMap = Object.fromEntries((kelasList ?? []).map(k => [k.id, k.nama]))

  // ── 5. Ambil jumlah peserta & selesai dari siswa_ujian ───────────────────
  const jadwalIds = jadwalList.map(j => j.id)
  const sesiList = (semuaSesi ?? []).filter(s => jadwalIds.includes(s.jadwal_id))
  const sesiIds = sesiList.map(s => s.id)
  let siswaUjianMap: Record<string, { total: number; selesai: number }> = {}
  if (sesiIds.length > 0) {
    const { data: siswaUjianList } = await db
      .from('siswa_ujian')
      .select('sesi_id, status')
      .in('sesi_id', sesiIds)
    for (const su of siswaUjianList ?? []) {
      if (!siswaUjianMap[su.sesi_id]) siswaUjianMap[su.sesi_id] = { total: 0, selesai: 0 }
      siswaUjianMap[su.sesi_id].total++
      if (su.status === 'SELESAI') siswaUjianMap[su.sesi_id].selesai++
    }
  }

  // ── 5b. Nama guru untuk sesi susulan yang diambil-alih admin ─────────────
  // (dibutuhkan agar pengawas asli melihat NAMA pengawas pengganti, bukan username)
  const usernameSusulanAktif = [...new Set(
    (semuaSesi ?? [])
      .filter(s => s.status === 'BERJALAN' && s.info_json?.dibuka_oleh_admin && s.info_json?.pengawas_susulan)
      .map(s => s.info_json.pengawas_susulan as string)
  )]
  let namaGuruSusulanMap: Record<string, string> = {}
  if (usernameSusulanAktif.length > 0) {
    const { data: guruSusulanList } = await db
      .from('users')
      .select('username, nama')
      .in('username', usernameSusulanAktif)
    namaGuruSusulanMap = Object.fromEntries((guruSusulanList ?? []).map(g => [g.username, g.nama]))
  }

  // ── 6. Enrich tiap jadwal ─────────────────────────────────────────────────
  const enrichedJadwal = jadwalList.map(j => {
    const sesiUntukJadwal = (sesiList).filter(s => s.jadwal_id === j.id)
    const sesiTerkait = sesiUntukJadwal.find(s => s.status === 'BERJALAN') ?? sesiUntukJadwal[0] ?? null
    let status = j.status
    if (sesiTerkait?.status === 'BERJALAN') status = 'BERJALAN'
    if (sesiTerkait?.status === 'SELESAI' && status !== 'BERJALAN') status = 'SELESAI'

    // Apakah sesi BERJALAN ini sesi susulan yang dibuka admin untuk GURU LAIN
    // (bukan guru yang sedang membuka mode-pengawas ini)? Jika ya, guru ini
    // adalah "pengawas asli" yang sesi-nya sudah diambil-alih — dia TIDAK
    // boleh melihat kode sesi / kontrol / data siswa sesi tersebut, cukup
    // pesan informatif siapa yang sedang bertugas.
    const pengawasSusulanUsername: string | undefined = sesiTerkait?.info_json?.dibuka_oleh_admin
      ? sesiTerkait?.info_json?.pengawas_susulan
      : undefined
    const diambilAlih = !!pengawasSusulanUsername && pengawasSusulanUsername !== user.username

    return {
      ...j,
      tanggal: j.tanggal?.slice(0, 10) ?? j.tanggal,
      status,
      nama_mapel: mapelMap[j.mapel_id] ?? j.mapel_id,
      nama_kelas: kelasMap[j.kelas] ?? j.kelas,
      // Jika sesi sudah diambil-alih pengawas lain, jangan kirim detail sesi
      // (kode sesi, dll) ke pengawas asli — cukup info ringkas untuk pesan.
      sesi_ujian: sesiTerkait && !diambilAlih ? {
        ...sesiTerkait,
        jumlah_peserta: siswaUjianMap[sesiTerkait.id]?.total ?? sesiTerkait.jumlah_peserta ?? 0,
        jumlah_selesai: siswaUjianMap[sesiTerkait.id]?.selesai ?? 0,
      } : null,
      diambil_alih_pengawas: diambilAlih
        ? {
            username: pengawasSusulanUsername,
            nama: namaGuruSusulanMap[pengawasSusulanUsername as string] ?? pengawasSusulanUsername,
          }
        : null,
    }
  })

  return NextResponse.json({ data: enrichedJadwal })
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { jadwalId } = await req.json()

  // Verify jadwal belongs to this guru as pengawas
  const { data: jadwal } = await db
    .from('jadwal')
    .select('*')
    .eq('id', jadwalId)
    .eq('pengawas', user.username)
    .single()

  if (!jadwal) return NextResponse.json({ error: 'Jadwal tidak ditemukan atau Anda bukan pengawas' }, { status: 404 })

  // Cek apakah sesi sudah ada & berjalan
  const { data: existingSesi } = await db
    .from('sesi_ujian')
    .select('id, kode_sesi, info_json')
    .eq('jadwal_id', jadwalId)
    .eq('status', 'BERJALAN')
    .single()

  if (existingSesi) {
    // Jika sesi yang berjalan adalah sesi susulan yang diambil-alih ADMIN
    // untuk guru LAIN, jangan beri kode sesi ke pengawas asli — dia bukan
    // pengawas yang bertugas pada sesi ini sekarang.
    const pengawasSusulan = existingSesi.info_json?.dibuka_oleh_admin
      ? existingSesi.info_json?.pengawas_susulan
      : undefined
    if (pengawasSusulan && pengawasSusulan !== user.username) {
      return NextResponse.json({
        error: 'Sesi untuk jadwal ini sedang aktif dengan pengawas lain (ditugaskan admin).',
        diambilAlih: true,
      }, { status: 409 })
    }

    return NextResponse.json({
      message: 'Sesi sudah berjalan',
      sesiId: existingSesi.id,
      kodeSesi: existingSesi.kode_sesi,
      sudahAda: true,
    })
  }

  const sesiId = generateId('SES')
  const kodeSesi = generateKodeSesi7()

  const { error } = await db.from('sesi_ujian').insert({
    id: sesiId,
    jadwal_id: jadwalId,
    mapel_id: jadwal.mapel_id,
    kelas: String(jadwal.kelas),
    durasi: jadwal.durasi,
    kode_sesi: kodeSesi,
    status: 'BERJALAN',
    waktu_mulai: new Date().toISOString(),
    jumlah_peserta: 0,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await db.from('jadwal').update({ status: 'BERJALAN' }).eq('id', jadwalId)

  return NextResponse.json({ message: 'Sesi berhasil dibuka', sesiId, kodeSesi }, { status: 201 })
}
