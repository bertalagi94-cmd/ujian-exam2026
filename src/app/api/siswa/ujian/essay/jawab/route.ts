// Taruh di: src/app/api/siswa/ujian/essay/jawab/route.ts
// Autosave jawaban essay MODE DIGITAL SAJA. Pola sama seperti
// src/app/api/siswa/ujian/sync/route.ts (untuk PG).
import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { essayTerlambatDitolak } from '@/lib/essay-waktu'
import { hitungBatasWaktuPg, sudahKedaluwarsa, saringJawabanTerlambat } from '@/lib/deadline-pg'
import { catatAktivitas } from '@/lib/aktivitas'
import { normalisasiJawabanEssayMasuk, MAKS_JAWABAN_ESSAY_PER_REQUEST } from '@/lib/sync-essay-input'

// POST { sesiId, jawaban: [{ soal_essay_id, jawaban_teks, revisi?, waktuJawabMs? }] }
export async function POST(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = tenantDb(yayasanIdDari(auth.user))
  let body: { sesiId?: string; jawaban?: unknown; deviceId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body tidak valid' }, { status: 400 })
  }
  // FIX (audit essay/jawab): JSON `null` lolos try/catch di atas lalu membuat
  // destrukturisasi melempar TypeError (500). Isi `jawaban` juga dinormalisasi
  // seperti jalur PG (lihat src/lib/sync-essay-input.ts): elemen null/format
  // salah dibuang, soal_essay_id kembar digabung, revisi dipastikan integer
  // aman, dan batas 20.000 karakter kini berlaku untuk semua tipe nilai.
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Body tidak valid' }, { status: 400 })
  }
  const { sesiId, deviceId } = body
  if (Array.isArray(body.jawaban) && body.jawaban.length > MAKS_JAWABAN_ESSAY_PER_REQUEST) {
    return NextResponse.json({ error: 'Terlalu banyak jawaban dalam satu permintaan' }, { status: 400 })
  }
  const norm = normalisasiJawabanEssayMasuk(body.jawaban)
  if (norm.terlaluPanjang > 0) {
    return NextResponse.json({ error: 'Jawaban terlalu panjang (maks 20.000 karakter per soal)' }, { status: 400 })
  }
  if (norm.dibuangFormat > 0 || norm.digabungKembar > 0) {
    console.warn(`[essay/jawab] payload dinormalisasi untuk sesi ${sesiId}, nis ${user.nis}: ${norm.dibuangFormat} elemen dibuang (format tidak valid), ${norm.digabungKembar} digabung (soal_essay_id kembar).`)
  }
  const jawaban = norm.records
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
    .select('status, status_essay, waktu_mulai_essay, device_id, last_heartbeat')
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
  if (essayTerlambatDitolak(siswaUjian.waktu_mulai_essay, sesi.info_json?.essay_durasi_menit, siswaUjian.last_heartbeat)) {
    return NextResponse.json({ error: 'Waktu pengerjaan essay Anda sudah habis.' }, { status: 409 })
  }

  // FIX (audit temuan 1 — batas waktu essay bisa dilewati): lolos dari cek di
  // atas hanya berarti heartbeat terakhir yang dicatat server masih SEBELUM
  // deadline. Heartbeat itu hanya berhenti kalau browser siswa berhenti
  // memanggil cek-sesi — dan siswa bisa sengaja memblokir request itu supaya
  // server "mengira" ia offline. Karena itu heartbeat saja TIDAK CUKUP: setelah
  // batas waktu lewat, jawaban hanya diterima kalau klaim waktu pembuatannya
  // (waktuJawabMs, dari jam tepercaya client) jatuh sebelum batas — kebijakan
  // yang SAMA dengan PG (lihat src/lib/deadline-pg.ts). Sebelum batas lewat,
  // jalur ini tidak dijalankan sama sekali (perilaku normal tidak berubah).
  const sekarangMs = Date.now()
  const batasEssay = hitungBatasWaktuPg(siswaUjian.waktu_mulai_essay, sesi.info_json?.essay_durasi_menit)
  const essayKedaluwarsa = sudahKedaluwarsa(batasEssay, sekarangMs)

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

    let jawabanValid: { soal_essay_id: string; jawaban_teks: string; revisi?: number; waktuJawabMs?: number }[] = jawaban.filter(
      (j) => idSoalSah.has(j.soal_essay_id)
    )

    let acked: { soal_essay_id: string; jawaban_teks: string; revisi: number; accepted: boolean }[] | undefined
    let ackDitolakTerlambat: { soal_essay_id: string; jawaban_teks: string; revisi: number; accepted: boolean }[] = []
    let jumlahDitolakTerlambat = 0

    if (essayKedaluwarsa && batasEssay && jawabanValid.length > 0) {
      // Jawaban yang revisinya tidak lebih baru dari yang sudah tersimpan
      // bukan "perubahan baru" (client mengirim ulang seluruh isi tiap
      // autosave): dibiarkan lewat — RPC tidak akan menimpanya — dan TIDAK
      // dihitung ditolak, supaya log audit hanya berisi perubahan yang
      // benar-benar dipersoalkan. Sama persis dengan sync PG.
      const idSemua = jawabanValid.map(j => j.soal_essay_id)
      const { data: barisAda } = await db
        .from('jawaban_essay').select('soal_essay_id, jawaban_teks, revisi')
        .eq('sesi_id', sesiId).eq('nis', user.nis!).in('soal_essay_id', idSemua)
      const adaMap = new Map(
        (barisAda ?? []).map(r => [r.soal_essay_id as string, { teks: (r.jawaban_teks as string) ?? '', revisi: (r.revisi as number | null) ?? 0 }])
      )
      const tidakBerubah = jawabanValid.filter(j => {
        const ada = adaMap.get(j.soal_essay_id)
        return !!ada && (typeof j.revisi === 'number' ? j.revisi : 0) <= ada.revisi
      })
      const kandidat = jawabanValid
        .filter(j => !tidakBerubah.includes(j))
        .map(j => ({
          soal_id: j.soal_essay_id,
          jawaban: j.jawaban_teks ?? '',
          revisi: typeof j.revisi === 'number' ? j.revisi : 0,
          waktuJawabMs: typeof j.waktuJawabMs === 'number' && Number.isFinite(j.waktuJawabMs) ? j.waktuJawabMs : undefined,
        }))

      const checkpointMs = siswaUjian.last_heartbeat ? new Date(siswaUjian.last_heartbeat).getTime() : null
      const { diterima, ditolak } = saringJawabanTerlambat(kandidat, batasEssay, sekarangMs, checkpointMs)
      const idDiterima = new Set(diterima.map(d => d.soal_id))
      jawabanValid = jawabanValid.filter(j => tidakBerubah.includes(j) || idDiterima.has(j.soal_essay_id))
      jumlahDitolakTerlambat = ditolak.length

      if (ditolak.length > 0) {
        // ACK memakai revisi KLIEN + accepted:false (teks yang tersimpan di
        // server dikembalikan apa adanya) supaya client menganggap soal itu
        // "sudah ditangani" dan tidak menunggu revisi yang tidak akan pernah
        // diterima; nilai yang tersimpan tetap yang lama.
        ackDitolakTerlambat = ditolak.map(({ jawaban: j }) => ({
          soal_essay_id: j.soal_id,
          jawaban_teks: adaMap.get(j.soal_id)?.teks ?? j.jawaban,
          revisi: j.revisi ?? 1,
          accepted: false,
        }))
        const ringkasAlasan = ditolak.reduce<Record<string, number>>((acc, d) => { acc[d.alasan] = (acc[d.alasan] ?? 0) + 1; return acc }, {})
        catatAktivitas(
          db, user.nis!, 'ESSAY_TERLAMBAT',
          `Autosave essay setelah batas waktu (sesi ${sesiId}, ${Math.round((sekarangMs - batasEssay.deadlineMs) / 1000)} dtk sesudah deadline): ${diterima.length} perubahan diterima (dibuat sebelum batas), ${ditolak.length} ditolak ${JSON.stringify(ringkasAlasan)}.`
        )
      } else if (diterima.length > 0) {
        catatAktivitas(
          db, user.nis!, 'ESSAY_TERLAMBAT',
          `Autosave essay setelah batas waktu (sesi ${sesiId}, ${Math.round((sekarangMs - batasEssay.deadlineMs) / 1000)} dtk sesudah deadline): ${diterima.length} perubahan diterima karena dibuat sebelum batas (kerja offline).`
        )
      }
    }

    if (jawabanValid.length > 0) {
      // FIX #5 (essay pakai sistem revisi, padanan PG — lihat migrasi
      // 35_revisi_essay_dan_jeda_offline_nyata.sql): sebelumnya baris ini
      // langsung di-upsert mentah-mentah ("siapa datang terakhir ke server
      // yang menang"), yang secara teori bisa salah kalau ada dua autosave
      // yang balapan (request lama tiba belakangan menimpa request baru yang
      // tiba lebih dulu). Sekarang setiap jawaban essay punya nomor revisi
      // yang dibuat CLIENT (naik monoton, lihat tulisJawabanEssay() di
      // page.tsx), dan RPC sync_jawaban_essay_revisi() menolak revisi yang
      // lebih kecil dari yang sudah tersimpan — tidak peduli urutan
      // kedatangan request.
      const records = jawabanValid.map((j: { soal_essay_id: string; jawaban_teks: string; revisi?: number }) => ({
        sesi_id: sesiId,
        nis: user.nis!,
        soal_essay_id: j.soal_essay_id,
        jawaban_teks: j.jawaban_teks ?? '',
        revisi: typeof j.revisi === 'number' ? j.revisi : 0,
      }))

      const { data: rpcHasil, error: rpcError } = await db.rpc('sync_jawaban_essay_revisi', {
        p_records: records,
      })

      if (rpcError) {
        // FAIL CLOSED (sama seperti sync_jawaban_atomik untuk PG): tidak ada
        // fallback ke upsert lama tanpa proteksi revisi. Client tetap
        // menyimpan jawaban di backup lokal dan akan mencoba lagi.
        console.error('[essay/jawab] sync_jawaban_essay_revisi gagal:', rpcError.code, rpcError.message)
        return NextResponse.json(
          { error: 'Server gagal menyimpan jawaban essay. Jawaban tetap aman di perangkat dan akan dicoba lagi otomatis.' },
          { status: 503 }
        )
      }

      acked = ((rpcHasil ?? []) as { out_soal_essay_id: string; out_jawaban_teks: string; out_revisi: number; out_accepted: boolean }[])
        .map(r => ({
          soal_essay_id: r.out_soal_essay_id,
          jawaban_teks: r.out_jawaban_teks,
          revisi: r.out_revisi,
          accepted: r.out_accepted,
        }))
    }

    if (ackDitolakTerlambat.length > 0) acked = [...(acked ?? []), ...ackDitolakTerlambat]

    const { count } = await db
      .from('jawaban_essay')
      .select('*', { count: 'exact', head: true })
      .eq('sesi_id', sesiId)
      .eq('nis', user.nis!)

    return NextResponse.json({
      totalTersimpan: count ?? 0,
      acked,
      ...(jumlahDitolakTerlambat > 0 ? { ditolakTerlambat: jumlahDitolakTerlambat } : {}),
    })
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
  const auth = await requireRoleAktif(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = tenantDb(yayasanIdDari(auth.user))
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
  // FIX #5: sertakan juga `revisi` — client sekarang memakai
  // mergeJawabanRevisi() (bandingkan revisi, bukan jam) untuk essay, sama
  // seperti PG, dan hanya jatuh ke jam sebagai pemutus kalau kedua revisi
  // sama persis (data lama sebelum migrasi 35).
  const { data, error } = await db
    .from('jawaban_essay')
    .select('soal_essay_id, jawaban_teks, updated_at, revisi')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jawaban: data ?? [] })
}
