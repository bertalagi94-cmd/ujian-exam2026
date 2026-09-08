// Taruh di: src/app/api/guru/koreksi-essay/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// GET ?sesiId=... — daftar siswa yang SUDAH_KIRIM essay di sesi ini,
// beserta jawaban (teks untuk DIGITAL, url foto untuk KERTAS) dan nilai_pg.
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const sesiId = searchParams.get('sesiId')
  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id, mapel_id, kelas, info_json')
    .eq('id', sesiId)
    .single()
  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  const { data: jadwal } = await db
    .from('jadwal')
    .select('id, pengawas')
    .eq('id', sesi.jadwal_id)
    .eq('pengawas', user.username)
    .single()
  if (!jadwal) return NextResponse.json({ error: 'Anda bukan pengawas sesi ini' }, { status: 403 })

  const modeJawaban = sesi.info_json?.essay_mode_jawaban

  // Soal essay sekarang berupa bank per mapel+kelas (paket_essay), sama
  // seperti soal PG — bukan lagi melekat ke jadwal_id. Lihat 08_paket_essay.sql.
  const { data: kelasRow } = await db
    .from('kelas')
    .select('id')
    .eq('nama', String(sesi.kelas))
    .maybeSingle()
  const kelasId = kelasRow?.id ?? String(sesi.kelas)

  // FIX BUG (fitur essay): filter status = 'DISETUJUI' — sebelumnya soal
  // DRAFT ikut dihitung di totalBobotMaks, padahal soal DRAFT itu TIDAK
  // pernah benar-benar dikerjakan siswa (lihat FIX di essay/soal/route.ts),
  // sehingga skala nilai essay (0-100) yang dihitung guru bisa salah kalau
  // masih ada draft soal essay yang belum dihapus/difinalisasi.
  const { data: soalEssayList } = await db
    .from('soal_essay')
    .select('id, teks, bobot_maks, urutan')
    .eq('mapel_id', sesi.mapel_id)
    .eq('kelas_id', kelasId)
    .eq('status', 'DISETUJUI')
    .order('urutan', { ascending: true })

  const totalBobotMaks = (soalEssayList ?? []).reduce((sum, s) => sum + Number(s.bobot_maks), 0)

  const { data: pesertaList } = await db
    .from('siswa_ujian')
    .select('nis, status_essay, waktu_kirim_essay')
    .eq('sesi_id', sesiId)
    .in('status_essay', ['SUDAH_KIRIM', 'TIDAK_MENGERJAKAN'])

  const nisList = (pesertaList ?? []).map(p => p.nis)
  if (nisList.length === 0) {
    return NextResponse.json({ soalEssay: soalEssayList ?? [], totalBobotMaks, peserta: [], modeJawaban })
  }

  const [{ data: siswaList }, { data: nilaiList }] = await Promise.all([
    db.from('siswa').select('nis, nama').in('nis', nisList),
    db.from('nilai').select('nis, benar, total, kkm, nilai_essay, nilai_total, dinilai_pada, dirilis').eq('sesi_id', sesiId).in('nis', nisList),
  ])
  const namaMap = Object.fromEntries((siswaList ?? []).map(s => [s.nis, s.nama]))
  const nilaiMap = Object.fromEntries((nilaiList ?? []).map(n => [n.nis, n]))

  let jawabanMap: Record<string, { soal_essay_id: string; jawaban_teks: string }[]> = {}
  let fotoMap: Record<string, string> = {}

  if (modeJawaban === 'DIGITAL') {
    const { data: jawabanList } = await db
      .from('jawaban_essay')
      .select('nis, soal_essay_id, jawaban_teks')
      .eq('sesi_id', sesiId)
      .in('nis', nisList)
    for (const j of jawabanList ?? []) {
      if (!jawabanMap[j.nis]) jawabanMap[j.nis] = []
      jawabanMap[j.nis].push({ soal_essay_id: j.soal_essay_id, jawaban_teks: j.jawaban_teks })
    }
  } else {
    const { data: fotoList } = await db
      .from('jawaban_essay_foto')
      .select('nis, foto_url')
      .eq('sesi_id', sesiId)
      .in('nis', nisList)
    fotoMap = Object.fromEntries((fotoList ?? []).map(f => [f.nis, f.foto_url]))
  }

  const peserta = (pesertaList ?? []).map(p => ({
    nis: p.nis,
    nama: namaMap[p.nis] ?? p.nis,
    statusEssay: p.status_essay,
    waktuKirimEssay: p.waktu_kirim_essay,
    jawabanTeks: modeJawaban === 'DIGITAL' ? (jawabanMap[p.nis] ?? []) : undefined,
    fotoUrl: modeJawaban === 'KERTAS' ? (fotoMap[p.nis] ?? null) : undefined,
    nilaiPg: nilaiMap[p.nis] ? { benar: nilaiMap[p.nis].benar, total: nilaiMap[p.nis].total, kkm: nilaiMap[p.nis].kkm } : null,
    nilaiEssay: nilaiMap[p.nis]?.nilai_essay ?? null,
    nilaiTotal: nilaiMap[p.nis]?.nilai_total ?? null,
    sudahDinilai: nilaiMap[p.nis]?.dinilai_pada != null || p.status_essay === 'TIDAK_MENGERJAKAN',
    dirilis: nilaiMap[p.nis]?.dirilis ?? false,
  }))

  return NextResponse.json({ soalEssay: soalEssayList ?? [], totalBobotMaks, peserta, modeJawaban })
}

// PUT { sesiId, nis, nilaiEssay } — input/ubah nilai essay 1 siswa & hitung nilai_total.
// Kalau ingin menandai "Tidak Mengerjakan", kirim { sesiId, nis, tidakMengerjakan: true } sebagai ganti nilaiEssay.
export async function PUT(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { sesiId, nis, nilaiEssay, tidakMengerjakan } = await req.json()
  if (!sesiId || !nis) return NextResponse.json({ error: 'sesiId dan nis diperlukan' }, { status: 400 })

  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id, mapel_id, kelas, info_json')
    .eq('id', sesiId)
    .single()
  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  const { data: jadwal } = await db
    .from('jadwal')
    .select('id, pengawas, essay_bobot_pg_persen, essay_bobot_essay_persen')
    .eq('id', sesi.jadwal_id)
    .eq('pengawas', user.username)
    .single()
  if (!jadwal) return NextResponse.json({ error: 'Anda bukan pengawas sesi ini' }, { status: 403 })

  const bobotPg = sesi.info_json?.essay_bobot_pg_persen ?? jadwal.essay_bobot_pg_persen ?? 50
  const bobotEssay = sesi.info_json?.essay_bobot_essay_persen ?? jadwal.essay_bobot_essay_persen ?? 50

  const { data: nilaiRow } = await db
    .from('nilai')
    .select('id, nilai')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .single()

  if (!nilaiRow) {
    return NextResponse.json({ error: 'Nilai PG siswa ini belum ada — siswa belum submit ujian PG.' }, { status: 404 })
  }

  let finalNilaiEssay = 0
  let statusEssayUpdate: string | undefined

  if (tidakMengerjakan) {
    finalNilaiEssay = 0
    statusEssayUpdate = 'TIDAK_MENGERJAKAN'
  } else {
    // Soal essay sekarang berupa bank per mapel+kelas (paket_essay), sama
    // seperti soal PG — bukan lagi melekat ke jadwal_id. Lihat 08_paket_essay.sql.
    const { data: kelasRow } = await db
      .from('kelas')
      .select('id')
      .eq('nama', String(sesi.kelas))
      .maybeSingle()
    const kelasId = kelasRow?.id ?? String(sesi.kelas)

    // FIX BUG (fitur essay): sama seperti di GET — filter status = 'DISETUJUI'
    // supaya totalBobotMaks yang dipakai untuk konversi nilai essay ke skala
    // 0-100 SELALU konsisten dengan soal yang benar-benar dikerjakan siswa.
    const { data: soalEssayList } = await db
      .from('soal_essay')
      .select('bobot_maks')
      .eq('mapel_id', sesi.mapel_id)
      .eq('kelas_id', kelasId)
      .eq('status', 'DISETUJUI')
    const totalBobotMaks = (soalEssayList ?? []).reduce((sum, s) => sum + Number(s.bobot_maks), 0) || 100

    const nilaiEssayAngka = Number(nilaiEssay)
    if (isNaN(nilaiEssayAngka) || nilaiEssayAngka < 0 || nilaiEssayAngka > totalBobotMaks) {
      return NextResponse.json({ error: `Nilai essay harus antara 0 dan ${totalBobotMaks}` }, { status: 400 })
    }
    finalNilaiEssay = Math.round((nilaiEssayAngka / totalBobotMaks) * 100) // simpan dalam skala 0-100
  }

  const nilaiPg = nilaiRow.nilai ?? 0
  const nilaiTotal = Math.round(nilaiPg * (bobotPg / 100) + finalNilaiEssay * (bobotEssay / 100))

  const { error: nilaiError } = await db
    .from('nilai')
    .update({
      nilai_essay: finalNilaiEssay,
      nilai_total: nilaiTotal,
      dinilai_pada: new Date().toISOString(),
      dinilai_oleh: user.username,
    })
    .eq('id', nilaiRow.id)

  if (nilaiError) return NextResponse.json({ error: nilaiError.message }, { status: 500 })

  if (statusEssayUpdate) {
    await db.from('siswa_ujian').update({ status_essay: statusEssayUpdate }).eq('sesi_id', sesiId).eq('nis', nis)
  }

  return NextResponse.json({ message: 'Nilai essay berhasil disimpan', nilaiEssay: finalNilaiEssay, nilaiTotal })
}
