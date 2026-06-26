// app/api/siswa/ujian/validasi/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// Threshold: kalau last_heartbeat device lama lebih muda dari ini,
// anggap device lama masih aktif → tolak login device baru.
// Kalau lebih tua (device lama sudah lama tidak polling), izinkan takeover.
const DEVICE_STALE_MS = 2 * 60 * 1000 // 2 menit

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { kodeSesi, nis, deviceId } = await req.json()

  if (nis !== user.nis) return NextResponse.json({ valid: false, message: 'NIS tidak sesuai' })

  // Ambil sesi aktif
  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, mapel_id, kelas, durasi, is_darurat, siswa_diizinkan')
    .eq('kode_sesi', kodeSesi.toUpperCase())
    .eq('status', 'BERJALAN')
    .single()

  if (!sesi) return NextResponse.json({ valid: false, message: 'Kode sesi tidak ditemukan atau ujian sudah selesai.' })

  // Validasi kelas
  if (user.kelas && String(user.kelas) !== String(sesi.kelas)) {
    return NextResponse.json({
      valid: false,
      message: `Anda bukan peserta ujian ini. Kelas Anda (${user.kelas}) tidak sesuai dengan kelas sesi (${sesi.kelas}).`,
    })
  }

  // Validasi sesi susulan
  if (sesi.is_darurat && Array.isArray(sesi.siswa_diizinkan) && sesi.siswa_diizinkan.length > 0) {
    if (!sesi.siswa_diizinkan.includes(nis)) {
      return NextResponse.json({ valid: false, message: 'Anda tidak terdaftar dalam sesi ujian susulan ini. Hubungi pengawas.' })
    }
  }

  // FIX kelas_id: sesi.kelas = nama kelas, paket_soal.kelas_id = ID dari tabel kelas
  const { data: kelasRow } = await db
    .from('kelas')
    .select('id')
    .eq('nama', String(sesi.kelas))
    .maybeSingle()
  const kelasId = kelasRow?.id ?? String(sesi.kelas)

  const [
    { data: nilaiAda },
    { data: siswaUjian, error: siswaUjianError },
    { data: paketData },
    { data: mapel },
    { data: pengaturanRows },
  ] = await Promise.all([
    db.from('nilai').select('id').eq('sesi_id', sesi.id).eq('nis', nis).single(),
    db.from('siswa_ujian').select('status, waktu_mulai, waktu_mulai_awal, device_id, last_heartbeat').eq('sesi_id', sesi.id).eq('nis', nis).single(),
    db.from('paket_soal').select('id, acak').eq('mapel_id', sesi.mapel_id).eq('kelas_id', kelasId).eq('status', 'DISETUJUI').limit(1).single(),
    db.from('mapel').select('nama').eq('id', sesi.mapel_id).single(),
    db.from('pengaturan').select('key, value').in('key', ['minSubmitAktif', 'minSubmitMenit']),
  ])

  // FIX: .single() mengembalikan error (PGRST116) kalau baris belum ada
  // sama sekali — itu wajar untuk siswa baru. Tapi error LAIN harus dianggap kegagalan nyata.
  if (siswaUjianError && siswaUjianError.code !== 'PGRST116') {
    return NextResponse.json(
      { valid: false, message: 'Gagal memeriksa status ujian Anda. Coba lagi beberapa saat.' },
      { status: 500 }
    )
  }

  if (nilaiAda) return NextResponse.json({ valid: false, message: 'Anda sudah menyelesaikan ujian ini.' })
  if (siswaUjian?.status === 'TERKUNCI') return NextResponse.json({ valid: false, message: 'Akun Anda dikunci permanen oleh pengawas karena pelanggaran berulang. Nilai Anda 0.' })
  if (siswaUjian?.status === 'RESET') {
    return NextResponse.json({ valid: false, perlu_kode_reset: true, sesiId: sesi.id, message: 'Akun Anda di-reset oleh pengawas karena pelanggaran. Masukkan kode 7 digit dari pengawas untuk melanjutkan ujian.' })
  }

  // ── DETEKSI LOGIN GANDA (multi-device) ───────────────────────────────────
  // Kalau ada device_id berbeda yang masih aktif (heartbeat segar < 2 menit),
  // tolak login ini. Kalau device lama sudah stale (> 2 menit tidak heartbeat),
  // izinkan takeover — artinya siswa pindah perangkat karena laptop rusak dll.
  if (deviceId && siswaUjian?.device_id && siswaUjian.device_id !== deviceId) {
    const lastHb = siswaUjian.last_heartbeat ? new Date(siswaUjian.last_heartbeat).getTime() : 0
    const deviceLamaMasihAktif = lastHb > 0 && (Date.now() - lastHb) < DEVICE_STALE_MS
    if (deviceLamaMasihAktif) {
      return NextResponse.json({
        valid: false,
        message: 'Ujian Anda sedang aktif di perangkat lain. Tutup browser di perangkat lain terlebih dahulu, lalu coba lagi.',
      })
    }
    // Device lama sudah stale — lanjut, device baru akan mengambil alih
  }
  // ─────────────────────────────────────────────────────────────────────────

  const isNewEntry = !siswaUjian

  // Ambil soal TANPA field kunci dan pembahasan (keamanan)
  let soalQuery = db
    .from('soal')
    .select('id, paket_id, mapel_id, teks, opsi_a, opsi_b, opsi_c, opsi_d, opsi_e, jumlah_opsi, gambar_pertanyaan, gambar_opsi_a, gambar_opsi_b, gambar_opsi_c, gambar_opsi_d, gambar_opsi_e, status')
    .eq('mapel_id', sesi.mapel_id)
    .eq('status', 'DISETUJUI')

  if (paketData) soalQuery = soalQuery.eq('paket_id', paketData.id)

  const now = new Date().toISOString()

  const [{ data: soalList }, siswaUjianWriteResult] = await Promise.all([
    soalQuery,
    isNewEntry
      ? db.from('siswa_ujian').upsert({
          sesi_id: sesi.id, nis,
          waktu_daftar: now,
          waktu_mulai: now,
          waktu_mulai_awal: now,
          status: 'AKTIF',
          device_id: deviceId ?? null,
          last_heartbeat: now,
        }, { onConflict: 'sesi_id,nis', ignoreDuplicates: false })
      : db.from('siswa_ujian').update({
          status: 'AKTIF',
          device_id: deviceId ?? siswaUjian?.device_id ?? null,
          last_heartbeat: now,
        }).eq('sesi_id', sesi.id).eq('nis', nis),
  ])

  if (siswaUjianWriteResult.error) {
    return NextResponse.json(
      { valid: false, message: 'Gagal mendaftarkan Anda ke sesi ujian. Coba lagi beberapa saat.' },
      { status: 500 }
    )
  }

  // ── Tutup race condition login bersamaan ──────────────────────────────────
  // Setelah upsert, baca ulang device_id yang sebenarnya tersimpan.
  // Kalau berbeda (device lain "menang" dalam race bersamaan), tolak device ini.
  if (deviceId) {
    const { data: aktualRow } = await db
      .from('siswa_ujian')
      .select('device_id')
      .eq('sesi_id', sesi.id)
      .eq('nis', nis)
      .single()
    if (aktualRow?.device_id && aktualRow.device_id !== deviceId) {
      return NextResponse.json({
        valid: false,
        message: 'Ujian Anda sedang aktif di perangkat lain. Tutup browser di perangkat lain terlebih dahulu, lalu coba lagi.',
      })
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (!soalList?.length) return NextResponse.json({ valid: false, message: 'Tidak ada soal tersedia untuk ujian ini. Pastikan paket soal sudah disetujui.' })

  // Increment jumlah_peserta di background
  if (isNewEntry) {
    db.rpc('increment_jumlah_peserta', { sesi_id_param: sesi.id })
  }

  // Acak soal
  const shouldAcak = paketData?.acak === 'YA'
  let finalSoal
  if (shouldAcak) {
    const arr = [...soalList]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    finalSoal = arr.map((s, i) => ({ ...s, nomor: i + 1 }))
  } else {
    finalSoal = soalList.map((s, i) => ({ ...s, nomor: i + 1 }))
  }

  // Gunakan waktu_mulai_awal sebagai referensi timer
  const waktuMulaiRef = siswaUjian?.waktu_mulai_awal ?? siswaUjian?.waktu_mulai ?? now

  // Hitung batas minimal submit dari pengaturan
  const pgMap = Object.fromEntries(
    (pengaturanRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  )
  const minSubmitAktif = pgMap['minSubmitAktif'] === 'true'
  const minSubmitMenit = minSubmitAktif ? (parseInt(pgMap['minSubmitMenit']) || 45) : 0

  return NextResponse.json({
    valid: true,
    sesiId: sesi.id,
    mapelId: sesi.mapel_id,
    namaMapel: mapel?.nama ?? sesi.mapel_id,
    kelas: sesi.kelas,
    durasi: sesi.durasi,
    waktu_mulai: waktuMulaiRef,
    soalList: finalSoal,
    minSubmitMenit,
  })
}
