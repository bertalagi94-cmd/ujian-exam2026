import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

function generateKodeReset(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 7; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

// GET /api/admin/pelanggaran
// Query: page, per_page, search, status, jenis, sesiId, tanggal
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = parseInt(searchParams.get('per_page') ?? '20')
  const search = searchParams.get('search') ?? ''
  const status = searchParams.get('status') ?? ''
  const jenis = searchParams.get('jenis') ?? ''
  const sesiId = searchParams.get('sesiId') ?? ''
  const tanggal = searchParams.get('tanggal') ?? ''

  const from = (page - 1) * perPage
  const to = from + perPage - 1

  let query = db
    .from('pelanggaran')
    .select('id, sesi_id, nis, jenis, level, detail, status, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (status) query = query.eq('status', status)
  if (jenis) query = query.eq('jenis', jenis)
  if (sesiId) query = query.eq('sesi_id', sesiId)
  if (tanggal) {
    const start = new Date(tanggal); start.setHours(0, 0, 0, 0)
    const end = new Date(tanggal); end.setHours(23, 59, 59, 999)
    query = query.gte('created_at', start.toISOString()).lte('created_at', end.toISOString())
  }

  const { data: pelanggaran, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!pelanggaran?.length) return NextResponse.json({ data: [], total: 0 })

  // Ambil nama siswa & sesi info paralel
  const nisList = [...new Set(pelanggaran.map(p => p.nis).filter(Boolean))]
  const sesiIds = [...new Set(pelanggaran.map(p => p.sesi_id).filter(Boolean))]

  const [{ data: siswaList }, { data: sesiList }] = await Promise.all([
    db.from('siswa').select('nis, nama, kelas').in('nis', nisList),
    db.from('sesi_ujian')
      .select('id, kelas, mapel_id')
      .in('id', sesiIds),
  ])

  const mapelIds = [...new Set((sesiList ?? []).map(s => s.mapel_id).filter(Boolean))]
  const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds)

  const siswaMap = Object.fromEntries((siswaList ?? []).map(s => [s.nis, s]))
  const sesiMap = Object.fromEntries((sesiList ?? []).map(s => [s.id, s]))
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))

  let data = pelanggaran.map(p => {
    const siswa = siswaMap[p.nis]
    const sesi = sesiMap[p.sesi_id]
    return {
      ...p,
      nama_siswa: siswa?.nama ?? p.nis,
      kelas: siswa?.kelas ?? sesi?.kelas ?? '-',
      nama_mapel: sesi ? (mapelMap[sesi.mapel_id] ?? '-') : '-',
    }
  })

  // filter search by nama/nis
  if (search) {
    const q = search.toLowerCase()
    data = data.filter(p =>
      p.nama_siswa.toLowerCase().includes(q) ||
      p.nis.toLowerCase().includes(q) ||
      p.jenis?.toLowerCase().includes(q)
    )
  }

  // Statistik ringkas
  const { data: stats } = await db
    .from('pelanggaran')
    .select('status, jenis')

  const statsBelum = stats?.filter(s => s.status === 'BELUM_DITINDAKLANJUTI').length ?? 0
  const statsSudah = stats?.filter(s => s.status === 'SUDAH_DITINDAKLANJUTI').length ?? 0
  const statsDiabaikan = stats?.filter(s => s.status === 'DIABAIKAN').length ?? 0

  return NextResponse.json({
    data,
    total: count ?? data.length,
    stats: { belum: statsBelum, sudah: statsSudah, diabaikan: statsDiabaikan, total: stats?.length ?? 0 }
  })
}

// PATCH /api/admin/pelanggaran
// Body: { id, action, nis, sesiId }
// action: 'update_status' | 'bypass_reset' | 'kunci_permanen' | 'hapus' | 'reset_semua'
export async function PATCH(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const body = await req.json()
  const { action, id, nis, sesiId, status: newStatus, catatan } = body

  // --- Update status pelanggaran ---
  if (action === 'update_status') {
    if (!id || !newStatus) return NextResponse.json({ error: 'id dan status diperlukan' }, { status: 400 })
    const validStatus = ['BELUM_DITINDAKLANJUTI', 'SUDAH_DITINDAKLANJUTI', 'DIABAIKAN']
    if (!validStatus.includes(newStatus)) return NextResponse.json({ error: 'Status tidak valid' }, { status: 400 })
    const { error } = await db.from('pelanggaran').update({ status: newStatus }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, message: `Status pelanggaran diubah ke ${newStatus}` })
  }

  // --- Bypass reset: admin generate kode langsung tanpa pengawas ---
  if (action === 'bypass_reset') {
    if (!nis || !sesiId) return NextResponse.json({ error: 'nis dan sesiId diperlukan' }, { status: 400 })

    const { data: siswa } = await db.from('siswa').select('nama').eq('nis', nis).single()
    if (!siswa) return NextResponse.json({ error: 'Siswa tidak ditemukan' }, { status: 404 })

    const kodeReset = generateKodeReset()

    await Promise.all([
      // Hapus kode lama yang belum digunakan
      db.from('log_reset').delete().eq('nis', nis).eq('digunakan', false),
    ])

    await db.from('log_reset').insert({
      nis,
      reset_oleh: auth.user?.username ?? 'admin',
      alasan: `sesi:${sesiId} — Bypass reset oleh ADMIN${catatan ? ': ' + catatan : ''}`,
      password_baru: kodeReset,
      digunakan: false,
    })

    // Set status siswa ke RESET agar harus masukkan kode
    await db.from('siswa_ujian')
      .update({ status: 'RESET' })
      .eq('sesi_id', sesiId)
      .eq('nis', nis)

    // Update semua pelanggaran siswa di sesi ini jadi sudah ditindaklanjuti
    await db.from('pelanggaran')
      .update({ status: 'SUDAH_DITINDAKLANJUTI' })
      .eq('sesi_id', sesiId)
      .eq('nis', nis)
      .eq('status', 'BELUM_DITINDAKLANJUTI')

    return NextResponse.json({
      success: true,
      kode_reset: kodeReset,
      nama_siswa: siswa.nama,
      message: `Kode bypass untuk ${siswa.nama}: ${kodeReset}`,
    })
  }

  // --- Kunci permanen: paksa nilai 0, status TERKUNCI ---
  if (action === 'kunci_permanen') {
    if (!nis || !sesiId) return NextResponse.json({ error: 'nis dan sesiId diperlukan' }, { status: 400 })

    const { data: siswa } = await db.from('siswa').select('nama').eq('nis', nis).single()
    if (!siswa) return NextResponse.json({ error: 'Siswa tidak ditemukan' }, { status: 404 })

    // Set TERKUNCI
    await db.from('siswa_ujian')
      .update({ status: 'TERKUNCI' })
      .eq('sesi_id', sesiId)
      .eq('nis', nis)

    // Cek nilai sudah ada?
    const { data: nilaiExist } = await db.from('nilai').select('id').eq('sesi_id', sesiId).eq('nis', nis).single()
    if (!nilaiExist) {
      const { data: sesi } = await db.from('sesi_ujian').select('mapel_id, kelas').eq('id', sesiId).single()
      if (sesi) {
        const { data: mapel } = await db.from('mapel').select('kkm').eq('id', sesi.mapel_id).single()
        await db.from('nilai').insert({
          id: generateId('NIL'),
          sesi_id: sesiId,
          nis,
          mapel_id: sesi.mapel_id,
          kelas: sesi.kelas,
          benar: 0,
          total: 0,
          nilai: 0,
          grade: 'E',
          lulus: false,
          kkm: mapel?.kkm ?? 75,
          timestamp: new Date().toISOString(),
        })
        await db.from('siswa_ujian')
          .update({ status: 'SELESAI', waktu_selesai: new Date().toISOString() })
          .eq('sesi_id', sesiId)
          .eq('nis', nis)
      }
    }

    // Tandai semua pelanggaran siswa ini sudah ditindaklanjuti
    await db.from('pelanggaran')
      .update({ status: 'SUDAH_DITINDAKLANJUTI' })
      .eq('sesi_id', sesiId)
      .eq('nis', nis)

    // Log
    await db.from('log_reset').insert({
      nis,
      reset_oleh: auth.user?.username ?? 'admin',
      alasan: `sesi:${sesiId} — Dikunci permanen oleh ADMIN${catatan ? ': ' + catatan : ''}`,
      password_baru: '-',
      digunakan: true,
    })

    return NextResponse.json({
      success: true,
      message: `${siswa.nama} telah dikunci permanen dan nilai diset 0.`,
    })
  }

  // --- Hapus 1 pelanggaran ---
  if (action === 'hapus') {
    if (!id) return NextResponse.json({ error: 'id diperlukan' }, { status: 400 })
    const { error } = await db.from('pelanggaran').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, message: 'Pelanggaran dihapus' })
  }

  // --- Reset semua pelanggaran siswa di sesi (hapus riwayat, buka kembali) ---
  if (action === 'reset_semua') {
    if (!nis || !sesiId) return NextResponse.json({ error: 'nis dan sesiId diperlukan' }, { status: 400 })

    await Promise.all([
      db.from('pelanggaran').delete().eq('sesi_id', sesiId).eq('nis', nis),
      db.from('siswa_ujian').update({ status: 'AKTIF' }).eq('sesi_id', sesiId).eq('nis', nis),
      db.from('log_reset').delete().eq('nis', nis).eq('digunakan', false),
    ])

    await db.from('log_reset').insert({
      nis,
      reset_oleh: auth.user?.username ?? 'admin',
      alasan: `sesi:${sesiId} — Semua pelanggaran dihapus oleh ADMIN${catatan ? ': ' + catatan : ''}`,
      password_baru: '-',
      digunakan: true,
    })

    return NextResponse.json({ success: true, message: 'Semua pelanggaran siswa di sesi ini dihapus dan akses dikembalikan.' })
  }

  return NextResponse.json({ error: 'Action tidak dikenali' }, { status: 400 })
}
