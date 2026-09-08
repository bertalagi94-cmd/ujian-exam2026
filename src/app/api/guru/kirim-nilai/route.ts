import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// GET /api/guru/kirim-nilai
// Mengembalikan semua nilai (per mapel yang diajar guru ini) lengkap dengan
// status pengiriman, nilai edit, dan info deadline dari pengaturan admin.
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()

  // Ambil mapel yang diajar guru ini
  const { data: guruMapel } = await db
    .from('mapel')
    .select('id, nama, kkm')
    .eq('guru_id', user.username)

  const mapelIds = (guruMapel ?? []).map((m: { id: string }) => m.id)
  if (!mapelIds.length) {
    return NextResponse.json({ data: [], mapelList: [], deadline: null, reminderJam: 24 })
  }

  // Ambil nilai
  const { data: nilaiData, error } = await db
    .from('nilai')
    .select('id, nis, mapel_id, kelas, nilai, grade, lulus, kkm, timestamp, nilai_edit, grade_edit, lulus_edit, dikirim_ke_wali, dikirim_at, dikembalikan, catatan_guru, sesi_id, nilai_essay, nilai_total, dirilis, dirilis_pada')
    .in('mapel_id', mapelIds)
    .order('kelas', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Enrich dengan nama siswa
  const nisSet = [...new Set((nilaiData ?? []).map((r: { nis: string }) => r.nis))]
  const { data: siswaList } = await db.from('siswa').select('nis, nama').in('nis', nisSet)
  const siswaMap = Object.fromEntries((siswaList ?? []).map((s: { nis: string; nama: string }) => [s.nis, s.nama]))
  const mapelMap = Object.fromEntries((guruMapel ?? []).map((m: { id: string; nama: string }) => [m.id, m.nama]))

  // FIX (kirim ke wali vs essay belum dirilis): supaya frontend BISA menandai
  // baris siswa yang nilainya belum boleh dikirim ke wali (karena sesinya
  // essay_aktif tapi belum dirilis guru), enrich tiap baris dengan flag
  // `essay_belum_dirilis`. Logika penentuannya SAMA dengan yang dipakai di
  // aksi 'kirim_ke_wali'/'kirim_semua' di bawah — lihat helper
  // `petakanEssayAktifPerSesi` supaya tidak dobel logika.
  const essayAktifMap = await petakanEssayAktifPerSesi(db, (nilaiData ?? []).map((r: { sesi_id: string | null }) => r.sesi_id))

  const enriched = (nilaiData ?? []).map((r: Record<string, unknown>) => {
    const essayAktif = essayAktifMap.get(r.sesi_id as string) ?? false
    return {
      ...r,
      nama_siswa: siswaMap[r.nis as string] ?? r.nis,
      nama_mapel: mapelMap[r.mapel_id as string] ?? r.mapel_id,
      // true kalau sesi ini pakai essay TAPI guru belum menekan rilis untuk
      // siswa ini — baris begini akan DILEWATI oleh kirim_ke_wali/kirim_semua.
      essay_belum_dirilis: essayAktif && r.dirilis !== true,
    }
  })

  // ── Roster siswa yang BELUM ujian ───────────────────────────────────────
  // BUG SEBELUMNYA: endpoint ini hanya query tabel `nilai`, jadi siswa yang
  // sama sekali belum mengerjakan ujian mapel ini tidak pernah muncul di
  // menu Kirim Nilai — seolah-olah tidak ada yang perlu ditunggu.
  //
  // FIX: pakai tabel `jadwal` (mapel_id + kelas) sebagai sumber "kelas mana
  // saja yang seharusnya ujian mapel ini" (sama seperti pola di
  // /api/guru/wali-kelas), lalu selisihkan dengan siswa yang sudah py nilai.
  // Ditandai `belum_ujian: true` supaya frontend menampilkannya terpisah
  // dari tabel nilai yang bisa diedit/dikirim (tidak ada nilai untuk siswa
  // ini, jadi tidak ada yang bisa dikirim).
  const { data: jadwalList } = mapelIds.length
    ? await db.from('jadwal').select('mapel_id, kelas').in('mapel_id', mapelIds)
    : { data: [] as { mapel_id: string; kelas: string }[] }

  const pasanganMap = new Map<string, { mapel_id: string; kelas: string }>()
  for (const j of jadwalList ?? []) {
    if (!j.mapel_id || !j.kelas) continue
    pasanganMap.set(`${j.mapel_id}__${j.kelas}`, { mapel_id: j.mapel_id, kelas: j.kelas })
  }
  const pasangan = Array.from(pasanganMap.values())
  const kelasSet = [...new Set(pasangan.map(p => p.kelas))]

  const { data: siswaRoster } = kelasSet.length
    ? await db.from('siswa').select('nis, nama, kelas').in('kelas', kelasSet).eq('status', 'AKTIF').neq('is_tester', 'YES')
    : { data: [] as { nis: string; nama: string; kelas: string }[] }

  const kkmMap = Object.fromEntries((guruMapel ?? []).map((m: { id: string; kkm: number }) => [m.id, m.kkm]))
  const sudahAdaSet = new Set((nilaiData ?? []).map((n: { mapel_id: string; nis: string }) => `${n.mapel_id}__${n.nis}`))

  const belumUjianRows: Record<string, unknown>[] = []
  for (const p of pasangan) {
    const siswaKelasIni = (siswaRoster ?? []).filter(s => s.kelas === p.kelas)
    for (const s of siswaKelasIni) {
      const kunci = `${p.mapel_id}__${s.nis}`
      if (sudahAdaSet.has(kunci)) continue
      sudahAdaSet.add(kunci) // hindari duplikat kalau ada >1 jadwal mapel+kelas yang sama
      belumUjianRows.push({
        id: `BELUM__${p.mapel_id}__${s.nis}`,
        nis: s.nis,
        nama_siswa: s.nama,
        kelas: p.kelas,
        mapel_id: p.mapel_id,
        nama_mapel: mapelMap[p.mapel_id] ?? p.mapel_id,
        nilai: 0,
        grade: '-',
        lulus: false,
        kkm: kkmMap[p.mapel_id] ?? 75,
        timestamp: '',
        nilai_edit: null,
        grade_edit: null,
        lulus_edit: null,
        dikirim_ke_wali: false,
        dikirim_at: null,
        dikembalikan: false,
        catatan_guru: null,
        belum_ujian: true,
      })
    }
  }


  // Ambil deadline & reminder dari pengaturan
  const { data: pengaturanData } = await db
    .from('pengaturan')
    .select('key, value')
    .in('key', ['deadline_kirim_nilai', 'reminder_nilai_jam'])

  const pengaturanMap = Object.fromEntries((pengaturanData ?? []).map((p: { key: string; value: string }) => [p.key, p.value]))
  const deadline = pengaturanMap['deadline_kirim_nilai'] || null
  const reminderJam = parseInt(pengaturanMap['reminder_nilai_jam'] ?? '24', 10)

  return NextResponse.json({
    data: [...enriched, ...belumUjianRows],
    mapelList: guruMapel ?? [],
    deadline,
    reminderJam,
  })
}

// PATCH /api/guru/kirim-nilai
// Body dapat berisi salah satu dari:
//   { aksi: 'simpan_edit', id: string, nilai_edit: number|null, catatan_guru?: string }
//   { aksi: 'kirim_ke_wali', mapel_id: string, kelas: string }   ← kirim semua siswa di mapel+kelas itu
//   { aksi: 'kirim_semua' }                                        ← kirim semua yang belum dikirim
export async function PATCH(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const body = await req.json()
  const { aksi } = body

  // Verifikasi guru memiliki mapel ini
  const { data: guruMapel } = await db
    .from('mapel')
    .select('id, nama, kkm')
    .eq('guru_id', user.username)

  const mapelIds = (guruMapel ?? []).map((m: { id: string }) => m.id)

  // ── Simpan nilai edit per siswa ──
  if (aksi === 'simpan_edit') {
    const { id, nilai_edit, catatan_guru } = body as {
      id: string
      nilai_edit: number | null
      catatan_guru?: string
    }

    // Verifikasi nilai ini milik mapel guru
    const { data: nilaiRow } = await db
      .from('nilai')
      .select('id, mapel_id, total, kkm')
      .eq('id', id)
      .single()

    if (!nilaiRow || !mapelIds.includes(nilaiRow.mapel_id)) {
      return NextResponse.json({ error: 'Tidak diizinkan' }, { status: 403 })
    }

    const updateData: Record<string, unknown> = { catatan_guru: catatan_guru ?? null }

    if (nilai_edit === null || nilai_edit === undefined) {
      // Hapus nilai edit — kembali ke nilai asli
      updateData.nilai_edit = null
      updateData.grade_edit = null
      updateData.lulus_edit = null
    } else {
      const kkm = nilaiRow.kkm ?? 75
      updateData.nilai_edit = nilai_edit
      updateData.grade_edit = hitungGrade(nilai_edit)
      updateData.lulus_edit = nilai_edit >= kkm
    }

    const { error } = await db.from('nilai').update(updateData).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ message: 'Nilai edit berhasil disimpan' })
  }

  // ── Kirim nilai ke wali kelas (per mapel+kelas) ──
  //
  // FIX (kelas campuran PG-only vs PG+Essay): SEBELUM ini, aksi ini mengirim
  // SEMUA baris `nilai` di mapel+kelas tsb tanpa peduli apakah essay-nya
  // (kalau sesi itu pakai essay) sudah dinilai & DIRILIS guru. Akibatnya wali
  // kelas bisa menerima nilai_total yang masih kosong (null) untuk siswa yang
  // essay-nya belum dikoreksi, sementara siswa lain di kelas yang sama (mis.
  // PG-only, atau essay-nya sudah dirilis) sudah punya nilai lengkap.
  //
  // FIX-nya: pisahkan dulu mana baris yang SIAP dikirim (tidak butuh essay,
  // ATAU essay-nya sudah dirilis) dari yang TERTUNDA (essay_aktif tapi belum
  // dirilis). Yang siap tetap langsung terkirim (tidak perlu tunggu SEMUA
  // siswa selesai — beda dengan 'rilis_essay_sekaligus' yang memang sengaja
  // all-or-nothing). Yang tertunda TIDAK dikirim, dan namanya dikembalikan
  // di response supaya guru tahu siapa saja yang masih harus dikoreksi/
  // dirilis essay-nya dulu.
  if (aksi === 'kirim_ke_wali') {
    const { mapel_id, kelas } = body as { mapel_id: string; kelas: string }

    if (!mapelIds.includes(mapel_id)) {
      return NextResponse.json({ error: 'Tidak diizinkan' }, { status: 403 })
    }

    const { data: kandidat } = await db
      .from('nilai')
      .select('id, nis, sesi_id, dirilis')
      .eq('mapel_id', mapel_id)
      .eq('kelas', kelas)
      .eq('dikirim_ke_wali', false)

    const { siapIds, tertunda } = await pisahkanSiapKirim(db, kandidat ?? [])

    const now = new Date().toISOString()
    let jumlahTerkirim = 0
    if (siapIds.length > 0) {
      const { error, count } = await db
        .from('nilai')
        .update({ dikirim_ke_wali: true, dikirim_at: now, dikembalikan: false })
        .in('id', siapIds)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      jumlahTerkirim = count ?? siapIds.length
    }

    const namaTertunda = await ambilNamaSiswa(db, tertunda.map(t => t.nis))
    const pesanTertunda = tertunda.length > 0
      ? ` ${tertunda.length} siswa belum dikirim karena nilai essay-nya belum dirilis: ${tertunda.map(t => namaTertunda[t.nis] ?? t.nis).join(', ')}.`
      : ''

    return NextResponse.json({
      message: `Nilai berhasil dikirim ke wali kelas untuk ${jumlahTerkirim} siswa.${pesanTertunda}`,
      jumlah: jumlahTerkirim,
      tertunda: tertunda.map(t => ({ nis: t.nis, nama: namaTertunda[t.nis] ?? t.nis })),
    })
  }

  // ── Kirim semua nilai yang belum dikirim (dari semua mapel guru ini) ──
  if (aksi === 'kirim_semua') {
    if (!mapelIds.length) return NextResponse.json({ message: 'Tidak ada mapel', jumlah: 0, tertunda: [] })

    const { data: kandidat } = await db
      .from('nilai')
      .select('id, nis, sesi_id, dirilis')
      .in('mapel_id', mapelIds)
      .eq('dikirim_ke_wali', false)

    const { siapIds, tertunda } = await pisahkanSiapKirim(db, kandidat ?? [])

    const now = new Date().toISOString()
    let jumlahTerkirim = 0
    if (siapIds.length > 0) {
      const { error, count } = await db
        .from('nilai')
        .update({ dikirim_ke_wali: true, dikirim_at: now, dikembalikan: false })
        .in('id', siapIds)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      jumlahTerkirim = count ?? siapIds.length
    }

    const namaTertunda = await ambilNamaSiswa(db, tertunda.map(t => t.nis))
    const pesanTertunda = tertunda.length > 0
      ? ` ${tertunda.length} siswa belum dikirim karena nilai essay-nya belum dirilis: ${tertunda.map(t => namaTertunda[t.nis] ?? t.nis).join(', ')}.`
      : ''

    return NextResponse.json({
      message: `Semua nilai yang siap berhasil dikirim ke wali kelas (${jumlahTerkirim} siswa).${pesanTertunda}`,
      jumlah: jumlahTerkirim,
      tertunda: tertunda.map(t => ({ nis: t.nis, nama: namaTertunda[t.nis] ?? t.nis })),
    })
  }

  // ── FIX (fitur essay): rilis nilai essay/total ke SISWA ──────────────────
  // PENTING: ini BEDA dengan aksi 'kirim_ke_wali' di atas (itu guru → wali
  // kelas). Ini guru → siswa langsung, sesuai desain yang disepakati: nilai
  // essay/total baru boleh dilihat siswa setelah guru menekan tombol ini,
  // per-individu ATAU sekaligus (sekaligus hanya aktif kalau SEMUA peserta
  // sesi sudah dinilai/ditandai tidak mengerjakan).
  if (aksi === 'rilis_essay_individu') {
    const { sesiId, nis } = body as { sesiId: string; nis: string }
    if (!sesiId || !nis) return NextResponse.json({ error: 'sesiId dan nis diperlukan' }, { status: 400 })

    const { data: nilaiRow } = await db
      .from('nilai')
      .select('id, mapel_id, nilai_essay')
      .eq('sesi_id', sesiId)
      .eq('nis', nis)
      .single()

    if (!nilaiRow || !mapelIds.includes(nilaiRow.mapel_id)) {
      return NextResponse.json({ error: 'Tidak diizinkan' }, { status: 403 })
    }
    if (nilaiRow.nilai_essay === null || nilaiRow.nilai_essay === undefined) {
      return NextResponse.json({ error: 'Siswa ini belum dinilai essay-nya' }, { status: 409 })
    }

    const { error } = await db
      .from('nilai')
      .update({ dirilis: true, dirilis_pada: new Date().toISOString() })
      .eq('id', nilaiRow.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ message: `Nilai untuk siswa ${nis} berhasil dirilis` })
  }

  if (aksi === 'rilis_essay_sekaligus') {
    const { sesiId } = body as { sesiId: string }
    if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

    const { data: sesi } = await db.from('sesi_ujian').select('mapel_id').eq('id', sesiId).single()
    if (!sesi || !mapelIds.includes(sesi.mapel_id)) {
      return NextResponse.json({ error: 'Tidak diizinkan' }, { status: 403 })
    }

    // Semua siswa yang SUDAH_KIRIM/TIDAK_MENGERJAKAN essay harus sudah
    // punya nilai_essay sebelum rilis massal diizinkan.
    const { data: pesertaEssay } = await db
      .from('siswa_ujian')
      .select('nis, status_essay')
      .eq('sesi_id', sesiId)
      .in('status_essay', ['SUDAH_KIRIM', 'TIDAK_MENGERJAKAN'])

    const nisWajibDinilai = (pesertaEssay ?? []).map(p => p.nis)
    if (nisWajibDinilai.length === 0) {
      return NextResponse.json({ error: 'Belum ada siswa yang menyelesaikan essay di sesi ini' }, { status: 409 })
    }

    const { data: nilaiBelumDinilai } = await db
      .from('nilai')
      .select('nis')
      .eq('sesi_id', sesiId)
      .in('nis', nisWajibDinilai)
      .is('nilai_essay', null)

    if (nilaiBelumDinilai && nilaiBelumDinilai.length > 0) {
      return NextResponse.json({
        error: `Masih ada ${nilaiBelumDinilai.length} siswa yang belum dinilai essay-nya. Rilis sekaligus hanya bisa dilakukan setelah SEMUA siswa dinilai.`,
        belumDinilai: nilaiBelumDinilai.map(n => n.nis),
      }, { status: 409 })
    }

    const now = new Date().toISOString()
    const { error, count } = await db
      .from('nilai')
      .update({ dirilis: true, dirilis_pada: now })
      .eq('sesi_id', sesiId)
      .in('nis', nisWajibDinilai)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ message: 'Nilai berhasil dirilis ke semua siswa', jumlah: count ?? 0 })
  }

  return NextResponse.json({ error: 'Aksi tidak dikenali' }, { status: 400 })
}

function hitungGrade(nilai: number): string {
  if (nilai >= 90) return 'A'
  if (nilai >= 80) return 'B'
  if (nilai >= 70) return 'C'
  if (nilai >= 60) return 'D'
  return 'E'
}

// FIX (kelas campuran PG-only vs PG+Essay): ambil info_json.essay_aktif dari
// sesi_ujian untuk sekumpulan sesi_id, dikembalikan sebagai Map<sesiId, bool>.
// sesi_id null/kosong (mis. data lama sebelum fitur essay ada) TIDAK masuk
// map, sehingga default-nya dianggap "tidak pakai essay" oleh pemanggil.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function petakanEssayAktifPerSesi(db: any, sesiIds: (string | null | undefined)[]): Promise<Map<string, boolean>> {
  const idUnik = [...new Set(sesiIds.filter((id): id is string => !!id))]
  const map = new Map<string, boolean>()
  if (idUnik.length === 0) return map

  const { data: sesiList } = await db
    .from('sesi_ujian')
    .select('id, info_json')
    .in('id', idUnik)

  for (const s of sesiList ?? []) {
    map.set(s.id, !!s.info_json?.essay_aktif)
  }
  return map
}

// FIX (kelas campuran PG-only vs PG+Essay): dari sekumpulan baris `nilai`
// kandidat kirim-ke-wali, pisahkan mana yang SIAP dikirim (tidak pakai essay,
// atau essay-nya sudah dirilis guru lewat rilis_essay_individu/sekaligus) dan
// mana yang TERTUNDA (sesinya essay_aktif tapi kolom `dirilis` masih false).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pisahkanSiapKirim(db: any, kandidat: { id: string; nis: string; sesi_id: string | null; dirilis: boolean | null }[]) {
  const essayAktifMap = await petakanEssayAktifPerSesi(db, kandidat.map(k => k.sesi_id))

  const siapIds: string[] = []
  const tertunda: { id: string; nis: string }[] = []

  for (const k of kandidat) {
    const essayAktif = k.sesi_id ? (essayAktifMap.get(k.sesi_id) ?? false) : false
    const siap = !essayAktif || k.dirilis === true
    if (siap) {
      siapIds.push(k.id)
    } else {
      tertunda.push({ id: k.id, nis: k.nis })
    }
  }

  return { siapIds, tertunda }
}

// Ambil nama siswa untuk sekumpulan NIS, dipakai untuk pesan "tertunda" yang
// ramah dibaca guru (menampilkan nama, bukan cuma NIS).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ambilNamaSiswa(db: any, nisList: string[]): Promise<Record<string, string>> {
  const nisUnik = [...new Set(nisList)]
  if (nisUnik.length === 0) return {}

  const { data } = await db.from('siswa').select('nis, nama').in('nis', nisUnik)
  return Object.fromEntries((data ?? []).map((s: { nis: string; nama: string }) => [s.nis, s.nama]))
}
