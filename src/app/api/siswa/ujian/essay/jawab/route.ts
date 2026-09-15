// Taruh di: src/app/api/siswa/ujian/essay/jawab/route.ts
// Autosave jawaban essay MODE DIGITAL SAJA. Pola sama seperti
// src/app/api/siswa/ujian/sync/route.ts (untuk PG).
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { sudahLewatBatasWaktuEssay } from '@/lib/essay-waktu'

// POST { sesiId, jawaban: [{ soal_essay_id, jawaban_teks }] }
export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { sesiId, jawaban, deviceId } = await req.json()
  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  const { data: sesi } = await db.from('sesi_ujian').select('status, info_json, mapel_id, kelas').eq('id', sesiId).single()
  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })
  if (sesi.status !== 'BERJALAN') {
    return NextResponse.json({ error: 'Sesi ujian sudah ditutup, jawaban tidak bisa disimpan lagi.' }, { status: 409 })
  }
  if (sesi.info_json?.essay_mode_jawaban !== 'DIGITAL') {
    return NextResponse.json({ error: 'Sesi ini tidak menggunakan mode jawaban digital' }, { status: 400 })
  }

  const { data: siswaUjian } = await db
    .from('siswa_ujian')
    .select('status, status_essay, waktu_mulai_essay, device_id')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)
    .single()

  if (!siswaUjian) return NextResponse.json({ error: 'Data ujian Anda tidak ditemukan' }, { status: 404 })
  if (siswaUjian.status === 'TERKUNCI' || siswaUjian.status === 'RESET') {
    return NextResponse.json({ error: 'Akses ujian Anda sedang dikunci/menunggu reset.' }, { status: 403 })
  }
  if (siswaUjian.status_essay !== 'MENGERJAKAN') {
    return NextResponse.json({ error: 'Sesi essay belum dimulai atau sudah selesai.' }, { status: 409 })
  }

  // FIX BUG #10 (anti multi-device tidak berlaku di fase essay): kebijakan
  // "satu siswa satu perangkat" sebelumnya HANYA ditegakkan di endpoint sync
  // PG (lihat FIX BUG #8 di sync/route.ts) — autosave essay sama sekali
  // tidak mengecek device_id, jadi begitu siswa masuk fase essay, device
  // manapun (termasuk device yang sudah "diambil alih"/tidak aktif lagi)
  // bisa terus menimpa jawaban essay-nya. Disamakan persis dengan pola guard
  // di sync/route.ts.
  if (siswaUjian.device_id && siswaUjian.device_id !== deviceId) {
    return NextResponse.json(
      { error: 'Sesi ujian Anda sedang aktif di perangkat lain. Jawaban tidak bisa disimpan dari perangkat ini.' },
      { status: 409 }
    )
  }

  // FIX BUG (tidak ada validasi waktu server-side untuk essay): lihat
  // src/lib/essay-waktu.ts. Tanpa ini, siswa yang mem-bypass countdown di
  // client bisa terus autosave jawaban tanpa batas waktu.
  if (sudahLewatBatasWaktuEssay(siswaUjian.waktu_mulai_essay, sesi.info_json?.essay_durasi_menit)) {
    return NextResponse.json({ error: 'Waktu pengerjaan essay Anda sudah habis.' }, { status: 409 })
  }

  if (Array.isArray(jawaban) && jawaban.length > 0) {
    // FIX BUG (soal_essay_id tidak divalidasi terhadap bank soal sesi ini):
    // sebelumnya endpoint ini langsung meng-upsert `soal_essay_id` apa pun
    // yang dikirim client tanpa memeriksa apakah ID tersebut memang bagian
    // dari bank soal essay (mapel+kelas) untuk sesi ini — `jawaban_essay`
    // di schema (07_essay.sql) memang TIDAK punya FOREIGN KEY ke
    // `soal_essay(id)`, jadi tidak ada apa pun di level database yang
    // mencegahnya. Client seharusnya tidak pernah jadi sumber kebenaran
    // untuk daftar ID yang valid. Sekarang daftar ID yang sah diambil dulu
    // dari bank soal DISETUJUI untuk mapel+kelas sesi ini (pola resolusi
    // kelasId disamakan dengan essay/info & essay/mulai), lalu jawaban yang
    // soal_essay_id-nya TIDAK ada di daftar itu di-drop diam-diam sebelum
    // upsert — TIDAK mengubah perilaku untuk siswa yang sah (ID mereka
    // selalu berasal dari /essay/soal, jadi selalu ada di daftar ini), dan
    // TIDAK mengubah kontrak response (`totalTersimpan` tetap menghitung
    // baris jawaban_essay yang benar-benar tersimpan, sekarang malah lebih
    // akurat karena tidak lagi bisa "digelembungkan" oleh ID palsu).
    const { data: kelasRow } = await db
      .from('kelas')
      .select('id')
      .eq('nama', String(sesi.kelas))
      .maybeSingle()
    const kelasId = kelasRow?.id ?? String(sesi.kelas)

    const { data: soalSahList } = await db
      .from('soal_essay')
      .select('id')
      .eq('mapel_id', sesi.mapel_id)
      .eq('kelas_id', kelasId)
      .eq('status', 'DISETUJUI')
    const idSoalSah = new Set((soalSahList ?? []).map(s => s.id))

    const jawabanValid = jawaban.filter(
      (j: { soal_essay_id: string; jawaban_teks: string }) => idSoalSah.has(j.soal_essay_id)
    )

    if (jawabanValid.length > 0) {
      const records = jawabanValid.map((j: { soal_essay_id: string; jawaban_teks: string }) => ({
        sesi_id: sesiId,
        nis: user.nis!,
        soal_essay_id: j.soal_essay_id,
        jawaban_teks: j.jawaban_teks ?? '',
        updated_at: new Date().toISOString(),
      }))

      const { error } = await db
        .from('jawaban_essay')
        .upsert(records, { onConflict: 'sesi_id,nis,soal_essay_id' })

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  const { count } = await db
    .from('jawaban_essay')
    .select('*', { count: 'exact', head: true })
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)

  return NextResponse.json({ totalTersimpan: count ?? 0 })
}

// GET ?sesiId=... — pulihkan progres jawaban essay digital (refresh halaman)
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const sesiId = searchParams.get('sesiId')
  const deviceId = searchParams.get('deviceId')
  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  // FIX BUG (GET jawaban essay tidak validasi status sesi/ujian): sebelumnya
  // endpoint ini langsung mengambil jawaban_essay berdasarkan sesi_id+nis
  // tanpa mengecek apakah sesi masih berjalan, siswa memang sedang
  // mengerjakan sesi tersebut, atau status_essay-nya masih MENGERJAKAN.
  // Siswa memang tidak bisa melihat jawaban siswa lain (query selalu
  // di-scope ke NIS miliknya sendiri lewat requireRole), tapi siswa yang
  // menyimpan sesiId lama tetap bisa menarik kembali jawaban essay-nya dari
  // sesi yang sudah tidak relevan lagi (sesi ditutup / essay sudah
  // dikirim), padahal endpoint terkait lain (mulai, soal, autosave POST di
  // bawah) semuanya sudah menolak pada kondisi itu. Sekarang disamakan:
  // GET ini hanya boleh dipakai untuk memulihkan draft SELAGI benar-benar
  // sedang mengerjakan (sesi BERJALAN & status_essay MENGERJAKAN).
  const { data: sesi } = await db.from('sesi_ujian').select('status').eq('id', sesiId).single()
  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })
  if (sesi.status !== 'BERJALAN') {
    return NextResponse.json({ error: 'Sesi ujian sudah ditutup.' }, { status: 409 })
  }

  const { data: siswaUjian } = await db
    .from('siswa_ujian')
    .select('status, status_essay, device_id')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)
    .single()

  if (!siswaUjian) return NextResponse.json({ error: 'Data ujian Anda tidak ditemukan' }, { status: 404 })
  if (siswaUjian.status === 'TERKUNCI' || siswaUjian.status === 'RESET') {
    return NextResponse.json({ error: 'Akses ujian Anda sedang dikunci/menunggu reset.' }, { status: 403 })
  }
  if (siswaUjian.status_essay !== 'MENGERJAKAN') {
    return NextResponse.json({ error: 'Sesi essay belum dimulai atau sudah selesai.' }, { status: 409 })
  }
  // FIX BUG #10: samakan guard device dengan POST di atas & pola sync/route.ts.
  if (siswaUjian.device_id && siswaUjian.device_id !== deviceId) {
    return NextResponse.json(
      { error: 'Sesi ujian Anda sedang aktif di perangkat lain.' },
      { status: 409 }
    )
  }

  const { data, error } = await db
    .from('jawaban_essay')
    .select('soal_essay_id, jawaban_teks')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jawaban: data ?? [] })
}
