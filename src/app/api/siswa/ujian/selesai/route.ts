import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { sesiId, nis } = await req.json()

  if (nis !== user.nis) return NextResponse.json({ error: 'NIS tidak sesuai' }, { status: 403 })

  // FIX BUG #1b: cek status siswa SEBELUM cek nilai. Sebelumnya endpoint ini
  // hanya peduli "apakah nilai sudah ada?" sehingga siswa yang sudah dikunci
  // Admin (TERKUNCI) atau sedang menunggu kode reset (RESET) tetap bisa submit
  // dan jawabannya tetap dihitung. Sekarang ditolak — kecuali nilai SUDAH ada
  // (misal hasil kunci_permanen) sehingga early-return di bawah tetap berfungsi
  // untuk menampilkan hasil yang sudah final.
  const { data: siswaUjianCheck } = await db
    .from('siswa_ujian')
    .select('status')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .single()

  if (siswaUjianCheck && (siswaUjianCheck.status === 'TERKUNCI' || siswaUjianCheck.status === 'RESET')) {
    const { data: nilaiSudahAda } = await db
      .from('nilai')
      .select('id, nilai, grade, benar, total, lulus')
      .eq('sesi_id', sesiId)
      .eq('nis', nis)
      .single()

    if (nilaiSudahAda) {
      return NextResponse.json({
        nilai: nilaiSudahAda.nilai,
        grade: nilaiSudahAda.grade,
        benar: nilaiSudahAda.benar,
        total: nilaiSudahAda.total,
        lulus: nilaiSudahAda.lulus,
      })
    }

    return NextResponse.json(
      { error: 'Akses ujian Anda sedang dikunci/menunggu reset. Ujian tidak bisa diselesaikan sekarang.' },
      { status: 403 }
    )
  }

  // Cek dulu apakah sudah pernah submit — early return
  const { data: nilaiExist } = await db
    .from('nilai')
    .select('id, nilai, grade, benar, total, lulus')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .single()

  if (nilaiExist) {
    return NextResponse.json({
      nilai: nilaiExist.nilai,
      grade: nilaiExist.grade,
      benar: nilaiExist.benar,
      total: nilaiExist.total,
      lulus: nilaiExist.lulus,
    })
  }

  // Ambil sesi dulu (butuh mapel_id, kelas, dan durasi untuk validasi waktu)
  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('mapel_id, kelas, durasi')
    .eq('id', sesiId)
    .single()

  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  // ── VALIDASI WAKTU SERVER ─────────────────────────────────────────────────
  // Cek apakah submit masih dalam jendela waktu yang sah.
  // waktu_mulai_awal adalah referensi tunggal yang tidak pernah berubah
  // (bahkan setelah reset pelanggaran). Toleransi 60 detik untuk mengakomodasi
  // jeda jaringan wajar saat auto-submit timeout.
  const { data: siswaUjianWaktu } = await db
    .from('siswa_ujian')
    .select('waktu_mulai_awal')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .single()

  if (siswaUjianWaktu?.waktu_mulai_awal && sesi.durasi) {
    const batasWaktu = new Date(siswaUjianWaktu.waktu_mulai_awal).getTime() + sesi.durasi * 60 * 1000
    const toleransiMs = 60 * 1000 // 60 detik grace period untuk jeda jaringan
    if (Date.now() > batasWaktu + toleransiMs) {
      return NextResponse.json(
        { error: 'Waktu ujian Anda sudah habis. Jawaban yang sudah tersimpan akan dinilai secara otomatis oleh sistem.' },
        { status: 409 }
      )
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // FIX: sesi.kelas = nama kelas, tapi paket_soal.kelas_id = ID dari tabel kelas
  // Lookup ID kelas terlebih dahulu
  const { data: kelasRow } = await db
    .from('kelas')
    .select('id')
    .eq('nama', String(sesi.kelas))
    .maybeSingle()
  const kelasId = kelasRow?.id ?? String(sesi.kelas)

  // Query mapel, paket, jawaban siswa — semua PARALEL (tidak saling bergantung)
  const [
    { data: mapel },
    { data: paketData },
    { data: jawabanSiswa },
  ] = await Promise.all([
    db.from('mapel').select('kkm').eq('id', sesi.mapel_id).single(),
    db.from('paket_soal')
      .select('id, jumlah_soal')
      .eq('mapel_id', sesi.mapel_id)
      .eq('kelas_id', kelasId)   // ← FIX: pakai kelasId bukan sesi.kelas
      .eq('status', 'DISETUJUI')
      .limit(1)
      .single(),
    db.from('jawaban').select('soal_id, jawaban').eq('sesi_id', sesiId).eq('nis', nis),
  ])

  const kkm = mapel?.kkm ?? 75

  // Hitung jumlah soal & ambil kunci — PARALEL
  const [{ count: totalSoalCount }, { data: soalKunci }] = await Promise.all([
    db.from('soal')
      .select('*', { count: 'exact', head: true })
      .eq('mapel_id', sesi.mapel_id)
      .eq('status', 'DISETUJUI')
      .eq('paket_id', paketData?.id ?? ''),
    jawabanSiswa?.length
      ? db.from('soal').select('id, kunci').in('id', jawabanSiswa.map(j => j.soal_id))
      : Promise.resolve({ data: [] }),
  ])

  const totalSoal = totalSoalCount ?? paketData?.jumlah_soal ?? 0

  // Hitung nilai
  const kunciMap: Record<string, string> = Object.fromEntries(
    (soalKunci ?? []).map(s => [s.id, s.kunci])
  )
  let benar = 0
  const total = totalSoal > 0 ? totalSoal : (jawabanSiswa?.length ?? 0)

  if (jawabanSiswa?.length) {
    for (const j of jawabanSiswa) {
      if (j.jawaban && kunciMap[j.soal_id] === j.jawaban) benar++
    }
  }

  const nilaiAngka = total > 0 ? Math.round((benar / total) * 100) : 0
  const grade = nilaiAngka >= 90 ? 'A' : nilaiAngka >= 80 ? 'B' : nilaiAngka >= 70 ? 'C' : nilaiAngka >= 60 ? 'D' : 'E'
  const lulus = nilaiAngka >= kkm

  const nilaiData = {
    id: generateId('NIL'),
    sesi_id: sesiId,
    nis,
    mapel_id: sesi.mapel_id,
    kelas: sesi.kelas,
    benar,
    total,
    nilai: nilaiAngka,
    grade,
    lulus,
    kkm,
    timestamp: new Date().toISOString(),
  }

  // Simpan nilai + update status — PARALEL
  // FIX: pakai upsert+ignoreDuplicates (bukan insert biasa) supaya kalau ada
  // race condition (misal klik 2x atau retry jaringan) tidak menghasilkan
  // error/duplikat baris nilai — konsisten dengan UNIQUE(sesi_id, nis) di skema.
  await Promise.all([
    db.from('nilai').upsert(nilaiData, { onConflict: 'sesi_id,nis', ignoreDuplicates: true }),
    db.from('siswa_ujian')
      .update({ status: 'SELESAI', waktu_selesai: new Date().toISOString() })
      .eq('sesi_id', sesiId)
      .eq('nis', nis),
  ])

  return NextResponse.json({ nilai: nilaiAngka, grade, benar, total, lulus })
}
