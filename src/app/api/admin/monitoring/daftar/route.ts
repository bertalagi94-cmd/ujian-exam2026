import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// Batas wajar per daftar — cukup untuk sekolah dengan ratusan siswa,
// tapi tetap mencegah satu request menyedot ribuan baris kalau data
// menumpuk lama tanpa dibersihkan.
const LIMIT = 300

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const jenis = searchParams.get('jenis') ?? 'login'

  const now = new Date()
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0)

  if (jenis === 'login') {
    // Siapa saja yang login HARI INI — digabung dari tabel siswa & users
    // (last_login), bukan dari log_aktivitas, supaya satu orang yang
    // login berkali-kali cuma muncul SEKALI dengan jam login TERAKHIR.
    const [{ data: siswaLogin }, { data: userLogin }] = await Promise.all([
      db.from('siswa')
        .select('nis, nama, kelas, last_login')
        .gte('last_login', startOfDay.toISOString())
        .order('last_login', { ascending: false })
        .limit(LIMIT),
      db.from('users')
        .select('username, nama, role, last_login')
        .gte('last_login', startOfDay.toISOString())
        .order('last_login', { ascending: false })
        .limit(LIMIT),
    ])

    const gabungan = [
      ...(siswaLogin ?? []).map((s: { nis: string; nama: string; kelas: string; last_login: string }) => ({
        id: s.nis, nama: s.nama, sub: `Siswa • Kelas ${s.kelas}`, role: 'SISWA', waktu: s.last_login,
      })),
      ...(userLogin ?? []).map((u: { username: string; nama: string; role: string; last_login: string }) => ({
        id: u.username, nama: u.nama, sub: u.role, role: u.role, waktu: u.last_login,
      })),
    ].sort((a, b) => new Date(b.waktu).getTime() - new Date(a.waktu).getTime())
      .slice(0, LIMIT)

    return NextResponse.json({ jenis, total: gabungan.length, data: gabungan })
  }

  if (jenis === 'aktif') {
    // FIX (siswa AKTIF ditampilkan tanpa cek sesi masih BERJALAN, dan
    // last_heartbeat diambil tapi tidak pernah dipakai): sebelumnya daftar
    // ini murni `siswa_ujian.status = 'AKTIF'` — tidak pernah dihubungkan
    // ke sesi_ujian.status, dan last_heartbeat yang di-select tidak pernah
    // dibaca untuk menentukan apakah siswa itu benar-benar masih terhubung.
    // Akibatnya siswa yang laptopnya mati/internet putus total (tidak
    // sempat submit, jadi status tetap AKTIF) tetap muncul sebagai
    // "Sedang Ujian" tanpa indikasi apa pun bahwa koneksinya sudah lama
    // putus. Sekarang: (1) daftar difilter ke sesi yang sesi_ujian.status
    // masih BERJALAN, dan (2) last_heartbeat dipakai untuk menandai baris
    // yang heartbeat-nya sudah lebih lama dari HEARTBEAT_STALE_MS sebagai
    // "Terputus" — ambang batas disamakan dengan DEVICE_STALE_MS yang
    // sudah dipakai untuk deteksi device stale di validasi/route.ts (2
    // menit), supaya konsisten dengan definisi "stale" yang sudah ada di
    // aplikasi ini, bukan angka baru yang dikarang sendiri.
    const HEARTBEAT_STALE_MS = 2 * 60 * 1000 // 2 menit — sama seperti DEVICE_STALE_MS di validasi/route.ts

    const { data: sesiBerjalan } = await db
      .from('sesi_ujian')
      .select('id')
      .eq('status', 'BERJALAN')
    const sesiIdsBerjalan = (sesiBerjalan ?? []).map((s: { id: string }) => s.id)

    if (!sesiIdsBerjalan.length) return NextResponse.json({ jenis, total: 0, data: [] })

    const { data: rows } = await db
      .from('siswa_ujian')
      .select('nis, sesi_id, waktu_mulai, last_heartbeat')
      .eq('status', 'AKTIF')
      .in('sesi_id', sesiIdsBerjalan)
      .order('waktu_mulai', { ascending: false })
      .limit(LIMIT)

    if (!rows?.length) return NextResponse.json({ jenis, total: 0, data: [] })

    const sesiIds = [...new Set(rows.map(r => r.sesi_id))]
    const nisList = [...new Set(rows.map(r => r.nis))]

    const [{ data: sesiList }, { data: siswaList }] = await Promise.all([
      db.from('sesi_ujian').select('id, mapel_id, kelas').in('id', sesiIds),
      db.from('siswa').select('nis, nama, kelas').in('nis', nisList),
    ])

    const sesiMap = Object.fromEntries((sesiList ?? []).map((s: { id: string; mapel_id: string; kelas: string }) => [s.id, s]))
    const siswaMap = Object.fromEntries((siswaList ?? []).map((s: { nis: string; nama: string; kelas: string }) => [s.nis, s]))

    const mapelIds = [...new Set((sesiList ?? []).map((s: { mapel_id: string }) => s.mapel_id))]
    const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds)
    const mapelMap = Object.fromEntries((mapelList ?? []).map((m: { id: string; nama: string }) => [m.id, m.nama]))

    const nowMs = Date.now()
    const data = rows.map((r: { nis: string; sesi_id: string; waktu_mulai: string; last_heartbeat: string | null }) => {
      const sesi = sesiMap[r.sesi_id]
      const siswa = siswaMap[r.nis]
      const namaMapel = sesi ? (mapelMap[sesi.mapel_id] ?? sesi.mapel_id) : '-'
      const lastHb = r.last_heartbeat ? new Date(r.last_heartbeat).getTime() : 0
      const online = lastHb > 0 && (nowMs - lastHb) < HEARTBEAT_STALE_MS
      const statusKoneksi = lastHb === 0 ? '' : online ? ' • Online' : ' • Terputus'
      return {
        id: r.nis,
        nama: siswa?.nama ?? r.nis,
        sub: `Kelas ${siswa?.kelas ?? sesi?.kelas ?? '-'} • ${namaMapel}${statusKoneksi}`,
        role: 'SISWA',
        waktu: r.waktu_mulai,
        online,
        last_heartbeat: r.last_heartbeat,
      }
    })

    return NextResponse.json({ jenis, total: data.length, data })
  }

  if (jenis === 'submit') {
    // Siswa yang sudah SUBMIT ujian hari ini, lengkap nilai & mapelnya.
    const { data: rows } = await db
      .from('nilai')
      .select('nis, mapel_id, kelas, nilai, grade, lulus, timestamp')
      .gte('timestamp', startOfDay.toISOString())
      .order('timestamp', { ascending: false })
      .limit(LIMIT)

    if (!rows?.length) return NextResponse.json({ jenis, total: 0, data: [] })

    const nisList = [...new Set(rows.map((r: { nis: string }) => r.nis))]
    const mapelIds = [...new Set(rows.map((r: { mapel_id: string }) => r.mapel_id))]
    const [{ data: siswaList }, { data: mapelList }] = await Promise.all([
      db.from('siswa').select('nis, nama').in('nis', nisList),
      db.from('mapel').select('id, nama').in('id', mapelIds),
    ])
    const siswaMap = Object.fromEntries((siswaList ?? []).map((s: { nis: string; nama: string }) => [s.nis, s.nama]))
    const mapelMap = Object.fromEntries((mapelList ?? []).map((m: { id: string; nama: string }) => [m.id, m.nama]))

    const data = rows.map((r: { nis: string; mapel_id: string; kelas: string; nilai: number; grade: string; lulus: boolean; timestamp: string }) => ({
      id: r.nis,
      nama: siswaMap[r.nis] ?? r.nis,
      sub: `Kelas ${r.kelas} • ${mapelMap[r.mapel_id] ?? r.mapel_id} • Nilai ${r.nilai} (${r.lulus ? 'Lulus' : 'Tidak lulus'})`,
      role: 'SISWA',
      waktu: r.timestamp,
    }))

    return NextResponse.json({ jenis, total: data.length, data })
  }

  if (jenis === 'pelanggaran') {
    const { data: rows } = await db
      .from('pelanggaran')
      .select('nis, jenis, created_at')
      .gte('created_at', startOfDay.toISOString())
      .order('created_at', { ascending: false })
      .limit(LIMIT)

    if (!rows?.length) return NextResponse.json({ jenis, total: 0, data: [] })

    const nisList = [...new Set(rows.map((r: { nis: string }) => r.nis))]
    const { data: siswaList } = await db.from('siswa').select('nis, nama, kelas').in('nis', nisList)
    const siswaMap = Object.fromEntries((siswaList ?? []).map((s: { nis: string; nama: string; kelas: string }) => [s.nis, s]))

    const data = rows.map((r: { nis: string; jenis: string; created_at: string }) => ({
      id: r.nis,
      nama: siswaMap[r.nis]?.nama ?? r.nis,
      sub: `Kelas ${siswaMap[r.nis]?.kelas ?? '-'} • ${r.jenis}`,
      role: 'SISWA',
      waktu: r.created_at,
    }))

    return NextResponse.json({ jenis, total: data.length, data })
  }

  return NextResponse.json({ error: 'jenis tidak dikenali' }, { status: 400 })
}
