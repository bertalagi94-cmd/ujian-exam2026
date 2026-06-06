import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN', 'GURU', 'PENGAWAS', 'KEPSEK', 'SISWA'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const kelas = searchParams.get('kelas')

  let query = (db as any).from('jadwal').select('*').order('tanggal', { ascending: false }).order('sesi')
  if (status) query = query.eq('status', status)
  if (kelas) query = query.eq('kelas', kelas)

  const { data: rawData, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!rawData?.length) return NextResponse.json({ data: [] })

  const data = rawData as any[]

  // Enrich nama_mapel
  const mapelIds = [...new Set(data.map(r => r.mapel_id).filter(Boolean))]
  const { data: mapelListRaw } = mapelIds.length > 0 ? await (db as any).from('mapel').select('id, nama').in('id', mapelIds) : { data: [] }
  const mapelList = (mapelListRaw ?? []) as { id: string; nama: string }[]
  const mapelMap = Object.fromEntries(mapelList.map(m => [m.id, m.nama]))

  // Enrich nama_pengawas
  const pengawasIds = [...new Set(data.map(r => r.pengawas).filter(Boolean))]
  const guruMap: Record<string, string> = {}
  if (pengawasIds.length > 0) {
    const { data: guruListRaw } = await (db as any).from('users').select('username, nama').in('username', pengawasIds)
    const guruList = (guruListRaw ?? []) as { username: string; nama: string }[]
    for (const g of guruList) guruMap[g.username] = g.nama
  }

  // Enrich status_soal: ambil paket_soal terbaru per (mapel_id, kelas_id)
  // kelas di jadwal = nama kelas (string), kelas_id di paket_soal = id kelas
  // Kita perlu mapping nama kelas -> id kelas
  const kelasNamaList = [...new Set(data.map(r => r.kelas).filter(Boolean))]
  const { data: kelasListRaw } = kelasNamaList.length > 0 ? await (db as any).from('kelas').select('id, nama').in('nama', kelasNamaList) : { data: [] }
  const kelasList = (kelasListRaw ?? []) as { id: string; nama: string }[]
  const kelasNamaToId = Object.fromEntries(kelasList.map(k => [String(k.nama), k.id]))

  // Ambil semua paket_soal yang relevan
  const kelasIds = kelasList.map(k => k.id)
  let paketStatusMap: Record<string, string> = {}
  if (mapelIds.length > 0 && kelasIds.length > 0) {
    const { data: paketList } = await db
      .from('paket_soal')
      .select('mapel_id, kelas_id, status')
      .in('mapel_id', mapelIds)
      .in('kelas_id', kelasIds)
      .order('tanggal', { ascending: false })

    // Untuk setiap kombinasi mapel+kelas, ambil status paket terbaru
    // Priority: DISETUJUI > MENUNGGU > DITOLAK > DRAFT
    const statusPriority: Record<string, number> = { DISETUJUI: 4, MENUNGGU: 3, DITOLAK: 2, DRAFT: 1 }
    const typedPaketList = (paketList ?? []) as { mapel_id: string; kelas_id: string; status: string }[]
    for (const p of typedPaketList) {
      const key = `${p.mapel_id}__${p.kelas_id}`
      const existing = paketStatusMap[key]
      if (!existing || (statusPriority[p.status] ?? 0) > (statusPriority[existing] ?? 0)) {
        paketStatusMap[key] = p.status
      }
    }
  }

  const enriched = data.map(r => {
    const kelasId = kelasNamaToId[String(r.kelas)]
    const soalKey = `${r.mapel_id}__${kelasId}`
    return {
      ...r,
      nama_mapel: mapelMap[r.mapel_id] ?? r.mapel_id,
      nama_pengawas: r.pengawas ? (guruMap[r.pengawas] ?? r.pengawas) : null,
      status_soal: paketStatusMap[soalKey] ?? 'BELUM_ADA',
    }
  })

  return NextResponse.json({ data: enriched })
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const body = await req.json()

  // Cegah duplikat: cek apakah sudah ada jadwal dengan mapel + kelas yang sama
  const { data: existing } = await db
    .from('jadwal')
    .select('id')
    .eq('mapel_id', body.mapel_id)
    .eq('kelas', String(body.kelas))
    .limit(1)
    .single()

  if (existing) {
    return NextResponse.json(
      { error: 'Jadwal untuk mata pelajaran dan kelas yang sama sudah ada.' },
      { status: 409 }
    )
  }

  // Cegah bentrok pengawas: pengawas yang sama di hari yang sama dengan jam yang bertabrakan
  if (body.pengawas && body.tanggal && body.jam_mulai && body.jam_selesai) {
    const { data: jadwalPengawas } = await db
      .from('jadwal')
      .select('id, jam_mulai, jam_selesai')
      .eq('pengawas', body.pengawas)
      .eq('tanggal', body.tanggal)

    const typedJadwalPengawas = (jadwalPengawas ?? []) as { id: string; jam_mulai: string; jam_selesai: string }[]
    const bentrok = typedJadwalPengawas.find(j => {
      // Overlap jika: mulai baru < selesai lama DAN selesai baru > mulai lama
      return body.jam_mulai < j.jam_selesai && body.jam_selesai > j.jam_mulai
    })

    if (bentrok) {
      return NextResponse.json(
        { error: `Pengawas ini sudah bertugas di hari yang sama pada jam ${bentrok.jam_mulai}–${bentrok.jam_selesai}. Pilih pengawas lain atau atur jam yang tidak bertabrakan.` },
        { status: 409 }
      )
    }
  }

  const { error } = await (db as any).from('jadwal').insert({
    id: generateId('JDW'),
    tanggal: body.tanggal,
    sesi: body.sesi || 1,
    jam_mulai: body.jam_mulai,
    jam_selesai: body.jam_selesai,
    mapel_id: body.mapel_id,
    kelas: String(body.kelas),
    pengawas: body.pengawas || null,
    durasi: body.durasi || 90,
    status: 'AKTIF',
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Jadwal berhasil ditambahkan' }, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { id, ...update } = await req.json()

  // Cegah duplikat saat edit: cek jadwal lain dengan mapel + kelas yang sama (kecuali dirinya sendiri)
  if (update.mapel_id && update.kelas) {
    const { data: existing } = await db
      .from('jadwal')
      .select('id')
      .eq('mapel_id', update.mapel_id)
      .eq('kelas', String(update.kelas))
      .neq('id', id)
      .limit(1)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: 'Jadwal untuk mata pelajaran dan kelas yang sama sudah ada.' },
        { status: 409 }
      )
    }
  }

  // Cegah bentrok pengawas saat edit
  if (update.pengawas && update.tanggal && update.jam_mulai && update.jam_selesai) {
    const { data: jadwalPengawas } = await db
      .from('jadwal')
      .select('id, jam_mulai, jam_selesai')
      .eq('pengawas', update.pengawas)
      .eq('tanggal', update.tanggal)
      .neq('id', id)

    const typedJadwalPengawas2 = (jadwalPengawas ?? []) as { id: string; jam_mulai: string; jam_selesai: string }[]
    const bentrok = typedJadwalPengawas2.find(j => {
      return update.jam_mulai < j.jam_selesai && update.jam_selesai > j.jam_mulai
    })

    if (bentrok) {
      return NextResponse.json(
        { error: `Pengawas ini sudah bertugas di hari yang sama pada jam ${bentrok.jam_mulai}–${bentrok.jam_selesai}. Pilih pengawas lain atau atur jam yang tidak bertabrakan.` },
        { status: 409 }
      )
    }
  }

  const { error } = await (db as any).from('jadwal').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Jadwal berhasil diperbarui' })
}

export async function DELETE(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { id } = await req.json()

  // Ambil data jadwal
  const { data: jadwal } = await db
    .from('jadwal')
    .select('id, mapel_id, kelas, status')
    .eq('id', id)
    .single()

  if (!jadwal) return NextResponse.json({ error: 'Jadwal tidak ditemukan.' }, { status: 404 })

  // Hanya jadwal SELESAI yang dicek kelengkapan ujian siswa
  if (jadwal.status === 'SELESAI') {

    // Ambil semua siswa aktif di kelas ini
    const { data: semuaSiswa } = await db
      .from('siswa')
      .select('nis, nama')
      .eq('kelas', jadwal.kelas)
      .eq('status', 'AKTIF')
      .order('nama')

    // Ambil sesi ujian untuk jadwal ini
    const { data: sesiList } = await db
      .from('sesi_ujian')
      .select('id')
      .eq('mapel_id', jadwal.mapel_id)
      .eq('kelas', jadwal.kelas)

    const sesiIds = (sesiList ?? []).map((s: any) => s.id)

    // Ambil NIS yang sudah punya nilai
    let sudahUjianNis: string[] = []
    if (sesiIds.length > 0) {
      const { data: nilaiList } = await db
        .from('nilai')
        .select('nis')
        .in('sesi_id', sesiIds)
      sudahUjianNis = [...new Set((nilaiList ?? []).map((n: any) => n.nis))]
    }

    // Cari siswa yang belum ujian
    const belumUjian = (semuaSiswa ?? []).filter((s: any) => !sudahUjianNis.includes(s.nis))

    if (belumUjian.length > 0) {
      return NextResponse.json({
        error: 'Hapus ditolak. Masih ada siswa yang belum mengikuti ujian.',
        belum_ujian: belumUjian,
      }, { status: 400 })
    }
  }

  // Lakukan hapus
  const { error } = await (db as any).from('jadwal').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Jadwal berhasil dihapus' })
}
// Hapus semua jadwal SELESAI — dengan cek siswa dulu
export async function PATCH(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()

  // Ambil semua jadwal SELESAI
  const { data: jadwalSelesai } = await db
    .from('jadwal')
    .select('id, mapel_id, kelas')
    .eq('status', 'SELESAI')

  if (!jadwalSelesai?.length) {
    return NextResponse.json({ error: 'Tidak ada jadwal dengan status Selesai.' }, { status: 400 })
  }

  // Cek setiap jadwal apakah semua siswanya sudah ujian
  const semuaBelumUjian: { jadwal: string; kelas: string; siswa: { nama: string }[] }[] = []

  for (const jadwal of jadwalSelesai) {
    const { data: semuaSiswa } = await db
      .from('siswa')
      .select('nis, nama')
      .eq('kelas', jadwal.kelas)
      .eq('status', 'AKTIF')
      .order('nama')

    if (!semuaSiswa?.length) continue

    const { data: sesiList } = await db
      .from('sesi_ujian')
      .select('id')
      .eq('mapel_id', jadwal.mapel_id)
      .eq('kelas', jadwal.kelas)

    const sesiIds = (sesiList ?? []).map((s: any) => s.id)
    let sudahUjianNis: string[] = []

    if (sesiIds.length > 0) {
      const { data: nilaiList } = await db
        .from('nilai')
        .select('nis')
        .in('sesi_id', sesiIds)
      sudahUjianNis = [...new Set((nilaiList ?? []).map((n: any) => n.nis))]
    }

    const belumUjian = semuaSiswa.filter((s: any) => !sudahUjianNis.includes(s.nis))
    if (belumUjian.length > 0) {
      semuaBelumUjian.push({
        jadwal: jadwal.id,
        kelas: jadwal.kelas,
        siswa: belumUjian,
      })
    }
  }

  // Jika ada jadwal yang siswanya belum semua ujian, tolak
  if (semuaBelumUjian.length > 0) {
    return NextResponse.json({
      error: 'Hapus dibatalkan. Masih ada siswa yang belum mengikuti ujian.',
      detail: semuaBelumUjian,
    }, { status: 400 })
  }

  // Semua bersih — hapus semua jadwal SELESAI
  const idList = jadwalSelesai.map((j: any) => j.id)
  const { error } = await db.from('jadwal').delete().in('id', idList)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ message: `${idList.length} jadwal berhasil dihapus.`, jumlah: idList.length })
}
