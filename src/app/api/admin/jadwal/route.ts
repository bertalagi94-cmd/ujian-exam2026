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
  // Catatan: kelas di jadwal = nama kelas (string, misal "10").
  // kelas_id di paket_soal SELALU berupa id asli dari tabel kelas (misal "KLS_xxx")
  // karena dropdown guru menggunakan k.id sebagai value.
  // Kita perlu:
  //   1. Ambil semua baris kelas (tanpa filter nama) agar punya map id→nama yang lengkap
  //   2. Query paket_soal hanya filter by mapel_id (tanpa filter kelas_id) agar tidak miss
  //   3. Resolve nama kelas dari kelas_id paket via map id→nama
  //   4. Cocokkan dengan nama kelas di jadwal (r.kelas)
  const kelasNamaList = [...new Set(data.map((r: any) => r.kelas).filter(Boolean))] as string[]

  // Ambil SEMUA kelas (tanpa filter nama) untuk map id→nama yang lengkap
  const { data: kelasListRaw } = await (db as any).from('kelas').select('id, nama')
  const kelasList = (kelasListRaw ?? []) as { id: string; nama: string }[]

  // Map dua arah
  const idToNamaKelas = Object.fromEntries(kelasList.map(k => [k.id, String(k.nama)]))
  // Map nama → id (untuk keperluan lain, misalnya rangkuman)
  const kelasNamaToId = Object.fromEntries(kelasList.map(k => [String(k.nama), k.id]))

  // Ambil semua paket_soal yang relevan berdasarkan mapel saja (filter kelas di memori)
  // Ini menghindari miss ketika kelas_id di paket tidak ada di allPossibleKelasIds
  let paketStatusMap: Record<string, string> = {}
  if (mapelIds.length > 0) {
    const { data: paketList } = await db
      .from('paket_soal')
      .select('mapel_id, kelas_id, status')
      .in('mapel_id', mapelIds)
      .order('tanggal', { ascending: false })

    // Priority: DISETUJUI > MENUNGGU > DITOLAK > DRAFT
    const statusPriority: Record<string, number> = { DISETUJUI: 4, MENUNGGU: 3, DITOLAK: 2, DRAFT: 1 }
    const typedPaketList = (paketList ?? []) as { mapel_id: string; kelas_id: string; status: string }[]

    for (const p of typedPaketList) {
      // Resolve nama kelas dari kelas_id (selalu berupa id asli "KLS_xxx")
      // Fallback ke kelas_id langsung jika tidak ketemu di map (data lama / edge case)
      const kelasNamaForPaket = idToNamaKelas[p.kelas_id] ?? p.kelas_id
      const key = `${p.mapel_id}__${kelasNamaForPaket}`
      const existing = paketStatusMap[key]
      if (!existing || (statusPriority[p.status] ?? 0) > (statusPriority[existing] ?? 0)) {
        paketStatusMap[key] = p.status
      }
    }
  }

  // Enrich pengawas yang BENAR-BENAR aktif sekarang untuk jadwal berstatus
  // BERJALAN. Pengawas bisa jadi: (a) pengawas asli (jadwal.pengawas) yang
  // membuka sesi sendiri, atau (b) pengawas susulan yang ditugaskan ADMIN
  // saat membuka ujian susulan (info_json.pengawas_susulan di sesi_ujian),
  // yang BISA BEDA dari pengawas asli. nama_pengawas di atas tetap merujuk
  // pengawas asli (sesuai input menu jadwal) — TIDAK diubah, agar histori
  // penugasan awal tetap utuh; field baru di bawah ini khusus menjelaskan
  // siapa yang aktif bertugas SEKARANG.
  const jadwalIdsBerjalan = data.filter(r => r.status === 'BERJALAN').map(r => r.id)
  let sesiAktifMap: Record<string, { dibukaOlehAdmin: boolean; pengawasUsername?: string }> = {}
  if (jadwalIdsBerjalan.length > 0) {
    const { data: sesiAktifList } = await (db as any)
      .from('sesi_ujian')
      .select('jadwal_id, info_json')
      .in('jadwal_id', jadwalIdsBerjalan)
      .eq('status', 'BERJALAN')
    for (const s of (sesiAktifList ?? []) as { jadwal_id: string; info_json?: any }[]) {
      if (!s.jadwal_id) continue
      sesiAktifMap[s.jadwal_id] = {
        dibukaOlehAdmin: !!s.info_json?.dibuka_oleh_admin,
        pengawasUsername: s.info_json?.dibuka_oleh_admin ? s.info_json?.pengawas_susulan : undefined,
      }
    }
  }

  // Lengkapi nama untuk pengawas susulan (mungkin belum ada di guruMap di atas
  // karena guruMap hanya diisi dari jadwal.pengawas, bukan dari info_json)
  const usernameSusulanLain = [...new Set(
    Object.values(sesiAktifMap)
      .map(v => v.pengawasUsername)
      .filter((u): u is string => !!u && !guruMap[u])
  )]
  if (usernameSusulanLain.length > 0) {
    const { data: guruSusulanRaw } = await (db as any).from('users').select('username, nama').in('username', usernameSusulanLain)
    for (const g of (guruSusulanRaw ?? []) as { username: string; nama: string }[]) guruMap[g.username] = g.nama
  }

  const enriched = data.map(r => {
    // Gunakan nama kelas langsung sebagai key (sudah konsisten dengan paketStatusMap yang baru)
    const kelasNama = String(r.kelas ?? '')
    const soalKey = `${r.mapel_id}__${kelasNama}`

    const sesiAktif = sesiAktifMap[r.id]
    // Default: pengawas aktif = pengawas asli jadwal ini
    let pengawasAktifUsername: string | null = r.pengawas ?? null
    let isPengawasSusulan = false
    if (sesiAktif?.dibukaOlehAdmin && sesiAktif.pengawasUsername) {
      pengawasAktifUsername = sesiAktif.pengawasUsername
      isPengawasSusulan = sesiAktif.pengawasUsername !== r.pengawas
    }

    return {
      ...r,
      nama_mapel: mapelMap[r.mapel_id] ?? r.mapel_id,
      nama_pengawas: r.pengawas ? (guruMap[r.pengawas] ?? r.pengawas) : null,
      status_soal: paketStatusMap[soalKey] ?? 'BELUM_ADA',
      pengawas_aktif: pengawasAktifUsername ? (guruMap[pengawasAktifUsername] ?? pengawasAktifUsername) : null,
      is_pengawas_susulan: isPengawasSusulan,
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

  // Cegah duplikat saat edit
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

  const { data: jadwal } = await db
    .from('jadwal')
    .select('id, mapel_id, kelas, status')
    .eq('id', id)
    .single()

  if (!jadwal) return NextResponse.json({ error: 'Jadwal tidak ditemukan.' }, { status: 404 })

  if (jadwal.status === 'SELESAI') {
    const { data: semuaSiswa } = await db
      .from('siswa')
      .select('nis, nama')
      .eq('kelas', jadwal.kelas)
      .eq('status', 'AKTIF')
      .order('nama')

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

    const belumUjian = (semuaSiswa ?? []).filter((s: any) => !sudahUjianNis.includes(s.nis))
    if (belumUjian.length > 0) {
      return NextResponse.json({
        error: 'Hapus ditolak. Masih ada siswa yang belum mengikuti ujian.',
        belum_ujian: belumUjian,
      }, { status: 400 })
    }
  }

  const { error } = await (db as any).from('jadwal').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Jadwal berhasil dihapus' })
}

export async function PATCH(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()

  const { data: jadwalSelesai } = await db
    .from('jadwal')
    .select('id, mapel_id, kelas')
    .eq('status', 'SELESAI')

  if (!jadwalSelesai?.length) {
    return NextResponse.json({ error: 'Tidak ada jadwal dengan status Selesai.' }, { status: 400 })
  }

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
      semuaBelumUjian.push({ jadwal: jadwal.id, kelas: jadwal.kelas, siswa: belumUjian })
    }
  }

  if (semuaBelumUjian.length > 0) {
    return NextResponse.json({
      error: 'Hapus dibatalkan. Masih ada siswa yang belum mengikuti ujian.',
      detail: semuaBelumUjian,
    }, { status: 400 })
  }

  const idList = jadwalSelesai.map((j: any) => j.id)
  const { error } = await db.from('jadwal').delete().in('id', idList)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ message: `${idList.length} jadwal berhasil dihapus.`, jumlah: idList.length })
}
