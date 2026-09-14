import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// POST /api/siswa/ujian/sync
// PENTING: setelah upsert, kita selalu hitung ulang jumlah baris jawaban yang
// BENAR-BENAR ada di database (ground truth), bukan sekadar asumsi "request sukses
// berarti semua tersimpan". Nilai totalSynced ini dipakai client untuk verifikasi
// sebelum mengizinkan siswa menyelesaikan ujian — supaya kasus "sebagian jawaban
// tidak sampai ke server karena koneksi lambat tapi tetap dianggap selesai" tidak
// terulang.
export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { sesiId, jawaban, deviceId } = await req.json()

  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  // FIX: sebelumnya endpoint ini menerima & menyimpan jawaban TANPA pernah
  // mengecek status sesi — siswa tetap bisa sync jawaban walau sesi sudah
  // ditutup pengawas (status SELESAI). Ditemukan otomatis oleh load test
  // (skenario "sync setelah sesi ditutup seharusnya ditolak").
  const { data: sesi } = await db.from('sesi_ujian').select('status').eq('id', sesiId).single()
  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })
  if (sesi.status !== 'BERJALAN') {
    return NextResponse.json({ error: 'Sesi ujian sudah ditutup, jawaban tidak bisa disimpan lagi.' }, { status: 409 })
  }

  // FIX BUG #1b: sebelumnya endpoint ini hanya mengecek status SESI, tidak pernah
  // mengecek status SISWA itu sendiri. Akibatnya siswa yang sudah dikunci/diblokir
  // Admin (status TERKUNCI) atau sedang menunggu kode reset (status RESET) tetap
  // bisa terus mengirim & menyimpan jawaban sampai ujian selesai.
  const { data: siswaUjian } = await db
    .from('siswa_ujian')
    .select('status, device_id')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)
    .single()

  if (siswaUjian && (siswaUjian.status === 'TERKUNCI' || siswaUjian.status === 'RESET')) {
    return NextResponse.json(
      { error: 'Akses ujian Anda sedang dikunci/menunggu reset. Jawaban tidak bisa disimpan.' },
      { status: 403 }
    )
  }

  // ── Tolak sync dari device yang sudah diambil alih ───────────────────────
  // Kalau device lain sudah login (device_id di DB berbeda), device ini tidak
  // boleh lagi menulis jawaban — hanya device aktif yang berhak sync.
  //
  // FIX BUG (anti-device bisa dilewati dengan tidak mengirim deviceId):
  // sebelumnya kondisi ini diawali `if (deviceId && ...)`, jadi pemeriksaan
  // HANYA berjalan kalau request memang menyertakan deviceId. Request yang
  // sengaja/tidak sengaja tidak mengirim deviceId sama sekali membuat kondisi
  // ini otomatis `false` dan lolos begitu saja — padahal siswa_ujian.device_id
  // di DB sudah terisi (device yang sah sudah pernah login). Sekarang: begitu
  // ada device_id terdaftar di DB, request WAJIB mengirim deviceId yang sama
  // persis; request tanpa deviceId (atau dengan deviceId lain) ditolak sama
  // seperti device lain yang mencoba mengambil alih.
  if (siswaUjian?.device_id && siswaUjian.device_id !== deviceId) {
    return NextResponse.json(
      { error: 'Sesi ujian Anda sedang aktif di perangkat lain. Jawaban tidak bisa disimpan dari perangkat ini.' },
      { status: 409 }
    )
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (Array.isArray(jawaban) && jawaban.length > 0) {
    const records = jawaban.map((j: { soal_id: string; jawaban: string }) => ({
      sesi_id: sesiId,
      nis: user.nis!,
      soal_id: j.soal_id,
      jawaban: j.jawaban,
      updated_at: new Date().toISOString(),
      sync_status: 'SYNCED',
      local_timestamp: Date.now(),
    }))

    const { error } = await db
      .from('jawaban')
      .upsert(records, { onConflict: 'sesi_id,nis,soal_id' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Hitung ground-truth: berapa baris jawaban yang benar-benar tersimpan di DB
  // untuk sesi+siswa ini saat ini (bukan jumlah yang dikirim di request ini saja).
  const { count, error: countError } = await db
    .from('jawaban')
    .select('*', { count: 'exact', head: true })
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)

  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 })

  return NextResponse.json({
    message: `${Array.isArray(jawaban) ? jawaban.length : 0} jawaban diproses`,
    totalSynced: count ?? 0,
  })
}

// GET /api/siswa/ujian/sync?sesiId=xxx
// Mengambil jawaban yang sudah tersimpan di server untuk sesi ini.
// Dipakai untuk: (1) memulihkan progres siswa jika halaman ter-reload/koneksi putus,
// (2) referensi totalSynced awal saat masuk ulang ke ujian.
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const sesiId = searchParams.get('sesiId')
  const deviceId = searchParams.get('deviceId')
  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  // FIX BUG #9 (GET jawaban PG tidak validasi status sesi/device): sebelumnya
  // endpoint ini mengambil jawaban langsung dari sesi_id+nis tanpa mengecek
  // apakah sesi masih BERJALAN atau apakah device yang meminta masih device
  // yang sah — padahal POST di atas (sync jawaban) sudah menegakkan keduanya.
  // Dampaknya memang rendah (read-only, data selalu milik NIS sendiri lewat
  // requireRole), tapi tetap ada celah kecil: device yang SUDAH diambil alih
  // (mis. HP lama yang ditinggal siswa) masih bisa terus membaca progres
  // jawaban dari sesi yang sudah ditutup. Disamakan dengan pola guard di POST
  // supaya konsisten.
  const { data: sesi } = await db.from('sesi_ujian').select('status').eq('id', sesiId).single()
  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })
  if (sesi.status !== 'BERJALAN') {
    return NextResponse.json({ error: 'Sesi ujian sudah ditutup.' }, { status: 409 })
  }

  const { data: siswaUjian } = await db
    .from('siswa_ujian')
    .select('status, device_id')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)
    .single()

  if (siswaUjian && (siswaUjian.status === 'TERKUNCI' || siswaUjian.status === 'RESET')) {
    return NextResponse.json(
      { error: 'Akses ujian Anda sedang dikunci/menunggu reset.' },
      { status: 403 }
    )
  }
  if (siswaUjian?.device_id && siswaUjian.device_id !== deviceId) {
    return NextResponse.json(
      { error: 'Sesi ujian Anda sedang aktif di perangkat lain.' },
      { status: 409 }
    )
  }

  const { data, error } = await db
    .from('jawaban')
    .select('soal_id, jawaban')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jawaban: data ?? [], totalSynced: data?.length ?? 0 })
}
