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

  // FIX BUG P0: sertakan paket_essay_id — sama seperti essay/soal/route.ts &
  // essay/mulai/route.ts. Autosave HARUS memvalidasi jawaban terhadap paket
  // yang sudah di-snapshot ke sesi ini, bukan mapel+kelas+DISETUJUI secara
  // umum, atau jawaban siswa bisa tersimpan untuk soal yang berasal dari
  // paket yang berbeda dari yang dinilai guru saat koreksi.
  const { data: sesi } = await db.from('sesi_ujian').select('status, info_json, mapel_id, kelas, paket_essay_id').eq('id', sesiId).single()
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
  // BUG P0 (audit outbox — sama seperti temuan di /selesai dan
  // /essay/kirim): RESET sementara (bisa pulih sendiri setelah R1
  // tersinkron) harus ditandai `sementara: true` supaya panggilan dari
  // ujian-outbox.ts (siapkanEssayUntukKirim) tidak dianggap penolakan
  // permanen. TERKUNCI tetap tanpa flag itu (memang final).
  if (siswaUjian.status === 'RESET') {
    return NextResponse.json({ error: 'Akses ujian Anda sedang menunggu kode reset.', sementara: true }, { status: 403 })
  }
  if (siswaUjian.status === 'TERKUNCI') {
    return NextResponse.json({ error: 'Akses ujian Anda dikunci.' }, { status: 403 })
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
    // dari bank soal essay untuk sesi ini — `jawaban_essay` di schema
    // (07_essay.sql) memang TIDAK punya FOREIGN KEY ke `soal_essay(id)`,
    // jadi tidak ada apa pun di level database yang mencegahnya.
    //
    // FIX BUG P0 (lanjutan, ini bagian yang paling penting): daftar ID yang
    // sah SEKARANG diambil dari paket_essay_id yang sudah di-snapshot ke
    // sesi ini kalau tersedia — SAMA PERSIS dengan query yang dipakai
    // essay/soal/route.ts dan guru/koreksi-essay/route.ts. Sebelumnya di
    // sini selalu memakai mapel+kelas+DISETUJUI walau sesi sudah punya
    // paket_essay_id, sehingga (kalau ada >1 paket DISETUJUI untuk mapel+
    // kelas yang sama) jawaban untuk soal DI LUAR paket yang dinilai guru
    // tetap bisa lolos tersimpan alih-alih di-drop. Fallback ke mapel+kelas
    // hanya untuk sesi lama yang paket_essay_id-nya masih NULL.
    const { data: kelasRow } = sesi.paket_essay_id
      ? { data: null }
      : await db.from('kelas').select('id').eq('nama', String(sesi.kelas)).maybeSingle()
    const kelasId = kelasRow?.id ?? String(sesi.kelas)

    const soalSahQuery = sesi.paket_essay_id
      ? db.from('soal_essay').select('id').eq('paket_essay_id', sesi.paket_essay_id).eq('status', 'DISETUJUI')
      : db.from('soal_essay').select('id').eq('mapel_id', sesi.mapel_id).eq('kelas_id', kelasId).eq('status', 'DISETUJUI')

    const { data: soalSahList } = await soalSahQuery
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
  // atas) semuanya sudah menolak pada kondisi itu. Sekarang disamakan:
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
  // BUG P0 (audit outbox): sama seperti guard POST di atas — bedakan RESET
  // (sementara) dari TERKUNCI (permanen).
  if (siswaUjian.status === 'RESET') {
    return NextResponse.json({ error: 'Akses ujian Anda sedang menunggu kode reset.', sementara: true }, { status: 403 })
  }
  if (siswaUjian.status === 'TERKUNCI') {
    return NextResponse.json({ error: 'Akses ujian Anda dikunci.' }, { status: 403 })
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

  // FIX BUG (P1-01, padanan essay): sertakan `updated_at` — lihat catatan
  // yang sama di src/app/api/siswa/ujian/sync/route.ts GET.
  const { data, error } = await db
    .from('jawaban_essay')
    .select('soal_essay_id, jawaban_teks, updated_at')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jawaban: data ?? [] })
}
