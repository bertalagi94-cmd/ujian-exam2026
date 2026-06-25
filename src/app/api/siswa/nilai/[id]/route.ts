import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// Rincian hasil ujian per nomor soal.
//
// PENTING (privasi antar siswa saat ujian masih berjalan):
// Endpoint ini HANYA mengembalikan status benar/salah per soal — TIDAK PERNAH
// mengirim kunci jawaban maupun jawaban yang dipilih siswa ke client. Tujuannya
// supaya siswa yang sudah selesai ujian tidak bisa membocorkan ke siswa lain
// (yang masih ujian) opsi mana yang benar untuk soal tertentu.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()

  const { id } = params

  // Ambil baris nilai — sekaligus pastikan baris ini benar milik siswa yang
  // login (bukan NIS siswa lain), supaya siswa A tidak bisa intip rincian
  // siswa B hanya dengan menebak/mengganti id di URL.
  const { data: nilai, error: nilaiError } = await db
    .from('nilai')
    .select('id, sesi_id, nis, mapel_id, kelas, benar, total, nilai, grade, lulus, kkm, timestamp')
    .eq('id', id)
    .eq('nis', user.nis!)
    .single()

  if (nilaiError || !nilai) {
    return NextResponse.json({ error: 'Data nilai tidak ditemukan' }, { status: 404 })
  }

  const { data: mapel } = await db.from('mapel').select('nama').eq('id', nilai.mapel_id).single()

  // Jawaban siswa untuk sesi ini — soal_id + jawaban dipakai SERVER-SIDE saja
  // untuk menghitung benar/salah, tidak diteruskan ke response.
  const { data: jawabanSiswa } = await db
    .from('jawaban')
    .select('soal_id, jawaban')
    .eq('sesi_id', nilai.sesi_id)
    .eq('nis', nilai.nis)

  const soalIds = (jawabanSiswa ?? []).map(j => j.soal_id)
  const jawabanMap = Object.fromEntries((jawabanSiswa ?? []).map(j => [j.soal_id, j.jawaban]))

  const { data: soalList } = await db
    .from('soal')
    .select('id, teks, opsi_a, opsi_b, opsi_c, opsi_d, opsi_e, jumlah_opsi, kunci, gambar_pertanyaan, gambar_opsi_a, gambar_opsi_b, gambar_opsi_c, gambar_opsi_d, gambar_opsi_e')
    .in('id', soalIds.length ? soalIds : ['__'])

  const rincian = (soalList ?? [])
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((s, i) => ({
      no: i + 1,
      teks: s.teks,
      jumlah_opsi: s.jumlah_opsi,
      opsi_a: s.opsi_a,
      opsi_b: s.opsi_b,
      opsi_c: s.opsi_c,
      opsi_d: s.opsi_d,
      opsi_e: s.opsi_e,
      gambar_pertanyaan: (s as any).gambar_pertanyaan ?? null,
      gambar_opsi_a: (s as any).gambar_opsi_a ?? null,
      gambar_opsi_b: (s as any).gambar_opsi_b ?? null,
      gambar_opsi_c: (s as any).gambar_opsi_c ?? null,
      gambar_opsi_d: (s as any).gambar_opsi_d ?? null,
      gambar_opsi_e: (s as any).gambar_opsi_e ?? null,
      // Hanya status benar/salah. TIDAK ADA field kunci atau jawaban siswa
      // di sini — sengaja tidak pernah dikirim ke client.
      benar: Boolean(jawabanMap[s.id]) && jawabanMap[s.id] === s.kunci,
    }))

  return NextResponse.json({
    nilai: {
      ...nilai,
      nama_mapel: mapel?.nama ?? nilai.mapel_id,
    },
    rincian,
  })
}
