// /api/guru/ruang-khusus  — menu "Pengawas Ruang Khusus"
//
//   GET                          -> ruang yang ditugaskan kepada saya (ringkas;
//                                    dipakai sidebar untuk menampilkan menu).
//   GET  ?ruang=ID&q=&kelas=     -> detail satu ruang: jadwal, siswa yang sudah
//                                    diproses, dan kandidat siswa (cari/centang).
//   POST { aksi:'proses', ruangId, nis:[] }  -> tempatkan siswa. Yang tidak
//                                    relevan DIABAIKAN dengan alasan singkat.
//   POST { aksi:'mulai',  ruangId }          -> buka sesi tiap jadwal siswa ruang.
//   POST { aksi:'lepas',  ruangId, nis }     -> lepas siswa yang belum pernah masuk.
//   POST { aksi:'essay',  ruangId, buka }    -> buka/tutup "Mulai Essay" untuk SEMUA
//                                    sesi ruang yang punya essay sekaligus.
//
// Kode darurat essay SATU untuk seluruh ruang (lihat seedKodeDarurat di
// src/lib/essay-amplop-server.ts); ikut ditampilkan di detail ruang.
//
// Setelah "Mulai sesi", pemantauan memakai tampilan Mode Pengawas biasa
// (/guru/jadwal-pengawasan?tab=mode): sesi ruang ditugaskan lewat
// info_json.pengawas_susulan, pola yang sama dengan sesi susulan.
import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { cekSiswaBolehMapel, labelAgamaMapel } from '@/lib/agama'
import { hitungKodeDarurat, seedKodeDarurat } from '@/lib/essay-amplop-server'
import {
  STATUS_RUANG_AKTIF, bukaSesiRuang, cekGuruBebas, nisSudahTerlibat,
  type JadwalRuang, type RuangKhusus,
} from '@/lib/ruang-khusus'

export const dynamic = 'force-dynamic'

const bersihkanCari = (v: string) => v.replace(/[,()%*\\]/g, ' ').trim().slice(0, 40)

async function ambilRuangMilikSaya(db: ReturnType<typeof tenantDb>, ruangId: string, username: string) {
  const { data } = await db.from('ruang_khusus').select('*').eq('id', ruangId).eq('pengawas', username).maybeSingle()
  return (data ?? null) as (RuangKhusus & { waktu_mulai?: string | null }) | null
}

export async function GET(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = tenantDb(yayasanIdDari(user))

  const ruangId = req.nextUrl.searchParams.get('ruang')

  // ── Ringkas: daftar ruang saya ───────────────────────────────────────────
  if (!ruangId) {
    const { data } = await db
      .from('ruang_khusus')
      .select('id, nama, status, kode_ruang, jadwal_ids, created_at')
      .eq('pengawas', user.username)
      .in('status', [...STATUS_RUANG_AKTIF])
      .order('created_at', { ascending: false })
    return NextResponse.json({
      adaRuang: (data ?? []).length > 0,
      ruang: (data ?? []).map(r => ({ id: r.id, nama: r.nama, status: r.status, jumlah_jadwal: (r.jadwal_ids ?? []).length })),
    })
  }

  // ── Detail satu ruang ────────────────────────────────────────────────────
  const ruang = await ambilRuangMilikSaya(db, ruangId, user.username)
  if (!ruang) return NextResponse.json({ error: 'Ruang tidak ditemukan atau bukan tugas Anda.' }, { status: 404 })

  const jadwalIds = (ruang.jadwal_ids ?? []) as string[]
  const { data: jadwalRows } = jadwalIds.length
    ? await db.from('jadwal').select('id, tanggal, jam_mulai, jam_selesai, mapel_id, kelas').in('id', jadwalIds).order('jam_mulai', { ascending: true })
    : { data: [] as { id: string; tanggal: string; jam_mulai: string; jam_selesai: string; mapel_id: string; kelas: string }[] }
  const mapelIds = [...new Set((jadwalRows ?? []).map(j => j.mapel_id))]
  const { data: mapelRows } = mapelIds.length
    ? await db.from('mapel').select('id, nama').in('id', mapelIds)
    : { data: [] as { id: string; nama: string }[] }
  const namaMapel = Object.fromEntries((mapelRows ?? []).map(m => [m.id, m.nama]))
  const kelasDiRuang = new Set((jadwalRows ?? []).map(j => String(j.kelas)))

  // Penempatan aktif semua ruang untuk jadwal-jadwal ini (untuk menandai "ruang lain").
  const { data: penempatanSemua } = jadwalIds.length
    ? await db.from('ruang_khusus_siswa').select('nis, ruang_id, jadwal_id, sesi_id').in('jadwal_id', jadwalIds).eq('status', 'DIPROSES')
    : { data: [] as { nis: string; ruang_id: string; jadwal_id: string; sesi_id: string | null }[] }
  const milikRuangIni = (penempatanSemua ?? []).filter(p => p.ruang_id === ruang.id)
  const nisRuangLain = new Set((penempatanSemua ?? []).filter(p => p.ruang_id !== ruang.id).map(p => String(p.nis)))
  const nisRuangIni = new Set(milikRuangIni.map(p => String(p.nis)))

  // Sesi ruang yang sudah dibuat + status siswa di dalamnya.
  const { data: sesiRuang } = await db
    .from('sesi_ujian').select('id, jadwal_id, status, info_json, akses_mulai_essay_dibuka').eq('ruang_khusus_id', ruang.id)
  const sesiIds = (sesiRuang ?? []).map(s => s.id)

  // Ringkasan essay satu ruang: hanya untuk sesi yang masih BERJALAN dan punya essay.
  const sesiEssay = (sesiRuang ?? []).filter(s => s.status === 'BERJALAN' && s.info_json?.essay_aktif)
  let kodeDarurat: string | null = null
  if (sesiEssay.length > 0) {
    try { kodeDarurat = hitungKodeDarurat(seedKodeDarurat({ id: sesiEssay[0].id, ruang_khusus_id: ruang.id })) }
    catch { kodeDarurat = null }
  }
  const essay = {
    jumlahSesi: sesiEssay.length,
    jumlahDibuka: sesiEssay.filter(s => s.akses_mulai_essay_dibuka === true).length,
    kodeDarurat,
  }
  const { data: suRuang } = sesiIds.length
    ? await db.from('siswa_ujian').select('sesi_id, nis, status').in('sesi_id', sesiIds)
    : { data: [] as { sesi_id: string; nis: string; status: string }[] }
  const statusMasuk = new Map((suRuang ?? []).map(r => [`${r.sesi_id}|${r.nis}`, r.status as string]))
  const sesiPerJadwal = new Map((sesiRuang ?? []).map(s => [s.jadwal_id as string, s]))

  const nisPenempatan = [...nisRuangIni]
  const { data: siswaTempat } = nisPenempatan.length
    ? await db.from('siswa').select('nis, nama, kelas').in('nis', nisPenempatan)
    : { data: [] as { nis: string; nama: string; kelas: string }[] }
  const siswaMap = new Map((siswaTempat ?? []).map(s => [s.nis, s]))
  const jadwalMap = new Map((jadwalRows ?? []).map(j => [j.id, j]))

  const diproses = milikRuangIni
    .map(p => {
      const s = siswaMap.get(String(p.nis))
      const j = jadwalMap.get(p.jadwal_id)
      const sesi = sesiPerJadwal.get(p.jadwal_id)
      const st = sesi ? statusMasuk.get(`${sesi.id}|${p.nis}`) : undefined
      return {
        nis: String(p.nis), nama: s?.nama ?? String(p.nis), kelas: s?.kelas ?? '-',
        jadwal_id: p.jadwal_id, mapel: j ? (namaMapel[j.mapel_id] ?? j.mapel_id) : '-',
        status: st ?? 'BELUM_MASUK',
      }
    })
    .sort((a, b) => a.nama.localeCompare(b.nama, 'id'))

  // Kandidat: siswa AKTIF, bisa dicari nama/NIS dan disaring kelas.
  const q = bersihkanCari(req.nextUrl.searchParams.get('q') ?? '')
  const kelasFilter = (req.nextUrl.searchParams.get('kelas') ?? '').trim()
  let kandidatQuery = db.from('siswa').select('nis, nama, kelas').eq('status', 'AKTIF').order('kelas').order('nama').limit(120)
  if (kelasFilter) kandidatQuery = kandidatQuery.eq('kelas', kelasFilter)
  if (q) kandidatQuery = kandidatQuery.or(`nama.ilike.%${q}%,nis.eq.${q}`)
  const [{ data: kandidatRaw }, { data: kelasRows }] = await Promise.all([
    kandidatQuery,
    db.from('kelas').select('nama').order('nama', { ascending: true }),
  ])

  const res = NextResponse.json({
    ruang: {
      id: ruang.id, nama: ruang.nama, status: ruang.status, kode_ruang: ruang.kode_ruang,
    },
    essay,
    jadwal: (jadwalRows ?? []).map(j => ({
      id: j.id, tanggal: String(j.tanggal).slice(0, 10), jam: `${j.jam_mulai}–${j.jam_selesai}`,
      mapel: namaMapel[j.mapel_id] ?? j.mapel_id, kelas: j.kelas,
      sesi_status: sesiPerJadwal.get(j.id)?.status ?? null,
    })),
    diproses,
    kandidat: (kandidatRaw ?? []).map(s => ({
      nis: s.nis, nama: s.nama, kelas: s.kelas,
      ditempatkan: nisRuangIni.has(String(s.nis)),
      ruang_lain: nisRuangLain.has(String(s.nis)) && !nisRuangIni.has(String(s.nis)),
      kelas_ada_jadwal: kelasDiRuang.has(String(s.kelas)),
    })),
    kelas: (kelasRows ?? []).map(k => k.nama),
  })
  res.headers.set('Cache-Control', 'no-store') // memuat kode darurat essay
  return res
}

export async function POST(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const yayasanId = yayasanIdDari(user)
  const db = tenantDb(yayasanId)

  const body = await req.json().catch(() => null) as { aksi?: unknown; ruangId?: unknown; nis?: unknown; buka?: unknown } | null
  const aksi = typeof body?.aksi === 'string' ? body.aksi : ''
  const ruangId = typeof body?.ruangId === 'string' ? body.ruangId : ''
  if (!aksi || !ruangId) return NextResponse.json({ error: 'Permintaan tidak valid.' }, { status: 400 })

  const ruang = await ambilRuangMilikSaya(db, ruangId, user.username)
  if (!ruang) return NextResponse.json({ error: 'Ruang tidak ditemukan atau bukan tugas Anda.' }, { status: 404 })
  if (!(STATUS_RUANG_AKTIF as readonly string[]).includes(ruang.status)) {
    return NextResponse.json({ error: 'Ruang ini sudah selesai atau dibatalkan.' }, { status: 409 })
  }

  const jadwalIds = (ruang.jadwal_ids ?? []) as string[]
  const { data: jadwalRows } = jadwalIds.length
    ? await db.from('jadwal').select('*').in('id', jadwalIds)
    : { data: [] as JadwalRuang[] }
  const jadwalRuang = (jadwalRows ?? []) as JadwalRuang[]

  const { data: guruRow } = await db.from('users').select('nama').eq('username', user.username).maybeSingle()
  const namaPengawas = guruRow?.nama ?? user.username

  // ════════════════════════ PROSES ════════════════════════
  if (aksi === 'proses') {
    const daftarNis = Array.isArray(body?.nis) ? [...new Set((body!.nis as unknown[]).map(String))].slice(0, 300) : []
    if (daftarNis.length === 0) return NextResponse.json({ error: 'Centang minimal satu siswa.' }, { status: 400 })

    const { data: siswaRows } = await db.from('siswa').select('nis, nama, kelas, status').in('nis', daftarNis)
    const siswaMap = new Map((siswaRows ?? []).map(s => [String(s.nis), s]))

    // Siswa yang sudah/sedang ujian pada tiap jadwal (sesi apa pun), dihitung sekali per jadwal.
    const terlibatPerJadwal = new Map<string, Set<string>>()
    for (const j of jadwalRuang) terlibatPerJadwal.set(j.id, await nisSudahTerlibat(db, j.id, daftarNis))
    const { data: sudahDiRuang } = jadwalIds.length
      ? await db.from('ruang_khusus_siswa').select('nis, jadwal_id, ruang_id').in('jadwal_id', jadwalIds).in('nis', daftarNis).eq('status', 'DIPROSES')
      : { data: [] as { nis: string; jadwal_id: string; ruang_id: string }[] }
    const penempatanAda = new Map((sudahDiRuang ?? []).map(p => [`${p.nis}|${p.jadwal_id}`, p.ruang_id as string]))

    type Hasil = { nis: string; nama: string; status: 'DIPROSES' | 'DIABAIKAN'; alasan?: string; mapel?: string[] }
    const hasil: Hasil[] = []
    const barisBaru: { nis: string; jadwal: JadwalRuang }[] = []

    for (const nis of daftarNis) {
      const s = siswaMap.get(nis)
      const nama = s?.nama ?? nis
      if (!s || s.status !== 'AKTIF') { hasil.push({ nis, nama, status: 'DIABAIKAN', alasan: 'Siswa tidak ditemukan atau tidak aktif' }); continue }

      const cocokKelas = jadwalRuang.filter(j => String(j.kelas) === String(s.kelas))
      if (cocokKelas.length === 0) { hasil.push({ nis, nama, status: 'DIABAIKAN', alasan: `Kelas ${s.kelas} tidak punya mapel pada sesi yang dipilih untuk ruang ini` }); continue }

      const alasanTolak: string[] = []
      const jadwalLolos: JadwalRuang[] = []
      for (const j of cocokKelas) {
        const cekAgama = await cekSiswaBolehMapel(db, j.mapel_id, nis)
        if (!cekAgama.boleh) { alasanTolak.push(`bukan peserta mapel agama ${labelAgamaMapel(cekAgama.agamaMapel, ' atau ')}`); continue }
        const ada = penempatanAda.get(`${nis}|${j.id}`)
        if (ada === ruang.id) { alasanTolak.push('sudah diproses di ruang ini'); continue }
        if (ada) { alasanTolak.push('sudah diproses di ruang khusus lain'); continue }
        if (terlibatPerJadwal.get(j.id)?.has(nis)) { alasanTolak.push('sudah atau sedang mengikuti ujian'); continue }
        jadwalLolos.push(j)
      }
      if (jadwalLolos.length === 0) {
        hasil.push({ nis, nama, status: 'DIABAIKAN', alasan: [...new Set(alasanTolak)].join('; ') || 'Tidak relevan' })
        continue
      }
      for (const j of jadwalLolos) barisBaru.push({ nis, jadwal: j })
    }

    // Simpan satu per satu: indeks uq_ruang_khusus_siswa_aktif menolak penempatan
    // ganda bila dua pengawas mencentang siswa yang sama bersamaan.
    const berhasilPerNis = new Map<string, JadwalRuang[]>()
    for (const b of barisBaru) {
      const { error } = await db.from('ruang_khusus_siswa').insert({
        ruang_id: ruang.id, nis: b.nis, jadwal_id: b.jadwal.id, status: 'DIPROSES', diproses_oleh: user.username,
      })
      if (error) {
        if (error.code === '23505') {
          const s = siswaMap.get(b.nis)
          const sudah = hasil.find(h => h.nis === b.nis)
          if (!sudah) hasil.push({ nis: b.nis, nama: s?.nama ?? b.nis, status: 'DIABAIKAN', alasan: 'sudah diproses di ruang khusus lain' })
          continue
        }
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      const arr = berhasilPerNis.get(b.nis) ?? []
      arr.push(b.jadwal)
      berhasilPerNis.set(b.nis, arr)
    }

    // Periksa ulang: siswa bisa saja login ke sesi kelas di antara pengecekan dan simpan.
    for (const [nis, daftarJadwal] of berhasilPerNis) {
      const dilepas: JadwalRuang[] = []
      for (const j of daftarJadwal) {
        const terlibat = await nisSudahTerlibat(db, j.id, [nis])
        if (terlibat.has(nis)) {
          dilepas.push(j)
          await db.from('ruang_khusus_siswa')
            .update({ status: 'DILEPAS', dilepas_oleh: 'sistem (siswa sudah masuk sesi kelas)', dilepas_pada: new Date().toISOString() })
            .eq('ruang_id', ruang.id).eq('nis', nis).eq('jadwal_id', j.id).eq('status', 'DIPROSES')
        }
      }
      const tersisa = daftarJadwal.filter(j => !dilepas.includes(j))
      const s = siswaMap.get(nis)
      if (tersisa.length === 0) {
        hasil.push({ nis, nama: s?.nama ?? nis, status: 'DIABAIKAN', alasan: 'siswa baru saja masuk ujian di kelasnya' })
      } else {
        hasil.push({ nis, nama: s?.nama ?? nis, status: 'DIPROSES', mapel: [...new Set(tersisa.map(j => j.mapel_id))] })
      }
    }

    // Ruang sudah BERJALAN: siswa yang baru diproses langsung dapat sesinya.
    let peringatanSesi: string[] = []
    if (ruang.status === 'BERJALAN') {
      const jadwalBaru = new Map<string, JadwalRuang>()
      for (const [, daftarJadwal] of berhasilPerNis) for (const j of daftarJadwal) jadwalBaru.set(j.id, j)
      for (const j of jadwalBaru.values()) {
        const r = await bukaSesiRuang(db, { yayasanId, ruang, jadwal: j, namaPengawas })
        if (r.ok && r.sesiId) {
          await db.from('ruang_khusus_siswa').update({ sesi_id: r.sesiId })
            .eq('ruang_id', ruang.id).eq('jadwal_id', j.id).eq('status', 'DIPROSES').is('sesi_id', null)
        } else {
          peringatanSesi.push(r.error ?? 'Gagal membuka sesi untuk salah satu jadwal.')
        }
      }
    }

    const diproses = hasil.filter(h => h.status === 'DIPROSES').length
    const mapelIdsTampil = [...new Set(hasil.flatMap(h => h.mapel ?? []))]
    const { data: mapelRows } = mapelIdsTampil.length
      ? await db.from('mapel').select('id, nama').in('id', mapelIdsTampil)
      : { data: [] as { id: string; nama: string }[] }
    const namaMapel = Object.fromEntries((mapelRows ?? []).map(m => [m.id, m.nama]))
    return NextResponse.json({
      message: `${diproses} siswa diproses, ${hasil.length - diproses} diabaikan.`,
      hasil: hasil.map(h => ({ ...h, mapel: (h.mapel ?? []).map(id => namaMapel[id] ?? id) })),
      peringatan: peringatanSesi.length ? peringatanSesi : undefined,
    })
  }

  // ════════════════════════ MULAI SESI ════════════════════════
  if (aksi === 'mulai') {
    const { data: aktif } = await db
      .from('ruang_khusus_siswa').select('jadwal_id').eq('ruang_id', ruang.id).eq('status', 'DIPROSES')
    const idJadwalDipakai = [...new Set((aktif ?? []).map(p => p.jadwal_id as string))]
    if (idJadwalDipakai.length === 0) {
      return NextResponse.json({ error: 'Belum ada siswa yang diproses. Centang siswa lalu tekan Proses dulu.' }, { status: 400 })
    }
    const jadwalDipakai = jadwalRuang.filter(j => idJadwalDipakai.includes(j.id))

    // Cek ulang guru bebas: jadwal bisa berubah setelah penugasan.
    const bebas = await cekGuruBebas(db, user.username, jadwalDipakai, ruang.id)
    if (!bebas.bebas) return NextResponse.json({ error: bebas.alasan }, { status: 409 })

    const berhasil: string[] = []
    const gagal: { jadwal: string; alasan: string }[] = []
    for (const j of jadwalDipakai) {
      const r = await bukaSesiRuang(db, { yayasanId, ruang, jadwal: j, namaPengawas })
      if (r.ok && r.sesiId) {
        berhasil.push(j.id)
        await db.from('ruang_khusus_siswa').update({ sesi_id: r.sesiId })
          .eq('ruang_id', ruang.id).eq('jadwal_id', j.id).eq('status', 'DIPROSES')
      } else {
        gagal.push({ jadwal: j.id, alasan: r.error ?? 'Gagal membuka sesi' })
      }
    }
    if (berhasil.length === 0) {
      return NextResponse.json({ error: gagal[0]?.alasan ?? 'Sesi gagal dibuka.', gagal }, { status: 409 })
    }
    await db.from('ruang_khusus')
      .update({ status: 'BERJALAN', waktu_mulai: ruang.waktu_mulai ?? new Date().toISOString() })
      .eq('id', ruang.id).in('status', [...STATUS_RUANG_AKTIF])

    return NextResponse.json({
      message: gagal.length ? `Sesi dibuka untuk ${berhasil.length} jadwal, ${gagal.length} gagal.` : `Sesi dibuka untuk ${berhasil.length} jadwal.`,
      kodeRuang: ruang.kode_ruang,
      gagal: gagal.length ? gagal : undefined,
    })
  }

  // ════════════════════════ LEPAS ════════════════════════
  if (aksi === 'lepas') {
    const nis = typeof body?.nis === 'string' ? body.nis : ''
    if (!nis) return NextResponse.json({ error: 'NIS diperlukan.' }, { status: 400 })
    const { data: baris } = await db
      .from('ruang_khusus_siswa').select('id, jadwal_id').eq('ruang_id', ruang.id).eq('nis', nis).eq('status', 'DIPROSES')
    if (!baris?.length) return NextResponse.json({ error: 'Siswa ini tidak sedang diproses di ruang Anda.' }, { status: 404 })

    const { data: sesiRuang } = await db.from('sesi_ujian').select('id').eq('ruang_khusus_id', ruang.id)
    const sesiIds = (sesiRuang ?? []).map(s => s.id)
    const { data: sudahMasuk } = sesiIds.length
      ? await db.from('siswa_ujian').select('nis').in('sesi_id', sesiIds).eq('nis', nis)
      : { data: [] as { nis: string }[] }
    if ((sudahMasuk ?? []).length > 0) {
      return NextResponse.json({ error: 'Siswa ini sudah pernah masuk ujian di ruang khusus, tidak bisa dilepas lagi.' }, { status: 409 })
    }
    await db.from('ruang_khusus_siswa')
      .update({ status: 'DILEPAS', dilepas_oleh: user.username, dilepas_pada: new Date().toISOString() })
      .in('id', baris.map(b => b.id))
    return NextResponse.json({ message: 'Siswa dilepas dari ruang khusus dan kembali ke sesi kelasnya.' })
  }

  // ════════════════════════ ESSAY (satu tombol untuk seluruh ruang) ════════════════════════
  if (aksi === 'essay') {
    if (typeof body?.buka !== 'boolean') return NextResponse.json({ error: 'buka (true/false) diperlukan.' }, { status: 400 })
    const buka = body.buka
    const { data: sesiList } = await db
      .from('sesi_ujian')
      .select('id, jadwal_id, mapel_id, kelas, info_json, akses_mulai_essay_dibuka')
      .eq('ruang_khusus_id', ruang.id).eq('status', 'BERJALAN')
    if (!sesiList?.length) return NextResponse.json({ error: 'Belum ada sesi berjalan di ruang ini. Tekan Mulai sesi dulu.' }, { status: 409 })

    const mapelIds = [...new Set(sesiList.map(s => s.mapel_id as string))]
    const { data: mapelRows } = await db.from('mapel').select('id, nama').in('id', mapelIds)
    const namaMapel = Object.fromEntries((mapelRows ?? []).map(m => [m.id, m.nama]))
    const kelasIdCache = new Map<string, string>()

    const diubah: string[] = []
    const dilewati: { label: string; alasan: string }[] = []
    for (const s of sesiList) {
      const label = `${namaMapel[s.mapel_id as string] ?? s.mapel_id} (Kelas ${s.kelas})`
      if (!s.info_json?.essay_aktif) { dilewati.push({ label, alasan: 'tidak punya essay' }); continue }
      if (buka) {
        const namaKelas = String(s.kelas)
        if (!kelasIdCache.has(namaKelas)) {
          const { data: k } = await db.from('kelas').select('id').eq('nama', namaKelas).maybeSingle()
          kelasIdCache.set(namaKelas, k?.id ?? namaKelas)
        }
        const { count } = await db.from('soal_essay').select('id', { count: 'exact', head: true })
          .eq('mapel_id', s.mapel_id).eq('kelas_id', kelasIdCache.get(namaKelas)!).eq('status', 'DISETUJUI')
        if (!count) { dilewati.push({ label, alasan: 'belum ada soal essay yang disetujui' }); continue }
      }
      const { error } = await db.from('sesi_ujian').update({ akses_mulai_essay_dibuka: buka }).eq('id', s.id)
      if (error) { dilewati.push({ label, alasan: error.message }); continue }
      diubah.push(label)
    }
    if (diubah.length === 0 && dilewati.length > 0 && !dilewati.some(d => d.alasan !== 'tidak punya essay')) {
      return NextResponse.json({ error: 'Tidak ada sesi di ruang ini yang punya essay.', dilewati }, { status: 400 })
    }
    return NextResponse.json({
      message: diubah.length === 0
        ? 'Tidak ada sesi yang berubah.'
        : `Mulai Essay ${buka ? 'dibuka' : 'ditutup'} untuk ${diubah.length} sesi.`,
      diubah, dilewati: dilewati.length ? dilewati : undefined,
    })
  }

  return NextResponse.json({ error: 'Aksi tidak dikenal.' }, { status: 400 })
}
