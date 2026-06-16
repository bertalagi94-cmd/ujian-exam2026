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
  const { sesiId, jawaban } = await req.json()

  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

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
  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  const { data, error } = await db
    .from('jawaban')
    .select('soal_id, jawaban')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jawaban: data ?? [], totalSynced: data?.length ?? 0 })
}
