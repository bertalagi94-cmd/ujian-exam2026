import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const body = await req.json()
  const { kelas_id: kelasTarget } = body

  if (!kelasTarget) {
    return NextResponse.json({ error: 'Kelas tujuan wajib dipilih' }, { status: 400 })
  }

  // Verifikasi kepemilikan paket sumber
  const { data: paketSumber } = await db
    .from('paket_soal')
    .select('*')
    .eq('id', params.id)
    .eq('guru_id', user.username)
    .single()

  if (!paketSumber) {
    return NextResponse.json({ error: 'Paket tidak ditemukan atau bukan milik Anda' }, { status: 404 })
  }

  // FIX BUG: sebelumnya endpoint ini menerima kelas_id APAPUN dari body
  // tanpa verifikasi apakah guru pemilik paket ini benar-benar mengampu
  // mapel tsb di kelas tujuan tersebut. Frontend sudah membatasi pilihan
  // dropdown ke kelas yang diampu guru (lihat getKelasUntukDuplicate di
  // src/app/guru/paket/page.tsx), tapi itu saja tidak cukup — guru yang
  // mengirim request langsung (curl/devtools) tetap bisa menembak kelas_id
  // di luar kelas_list mapel-nya. Di sinilah validasi yang sebenarnya harus
  // ditegakkan: ambil kelas_list dari baris `mapel` milik paket sumber,
  // cocokkan nama kelas tujuan terhadap daftar itu.
  const { data: mapelSumber } = await db
    .from('mapel')
    .select('kelas_list')
    .eq('id', paketSumber.mapel_id)
    .single()
  const { data: kelasTujuanRow } = await db
    .from('kelas')
    .select('nama')
    .eq('id', kelasTarget)
    .single()
  const kelasDiMapel = (mapelSumber?.kelas_list ?? '').split(',').map((s: string) => s.trim()).filter(Boolean)
  if (!kelasTujuanRow || !kelasDiMapel.includes(kelasTujuanRow.nama)) {
    return NextResponse.json(
      { error: 'Anda tidak mengampu mata pelajaran ini di kelas tujuan tersebut.' },
      { status: 403 }
    )
  }

  // Cek apakah sudah ada paket dengan mapel+kelas yang sama milik guru ini
  const { data: existing } = await db
    .from('paket_soal')
    .select('id')
    .eq('guru_id', user.username)
    .eq('mapel_id', paketSumber.mapel_id)
    .eq('kelas_id', kelasTarget)
    .in('status', ['DRAFT', 'MENUNGGU', 'DISETUJUI'])
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'Anda sudah memiliki paket aktif untuk mapel dan kelas tersebut' }, { status: 400 })
  }

  // Buat paket baru
  const newPaketId = generateId('PKT')
  const { error: paketErr } = await db.from('paket_soal').insert({
    id: newPaketId,
    mapel_id: paketSumber.mapel_id,
    kelas_id: kelasTarget,
    guru_id: user.username,
    status: 'DRAFT',
    jumlah_soal: 0,
    acak: paketSumber.acak,
    mode_jawaban: paketSumber.mode_jawaban ?? 'DIGITAL',
  })

  if (paketErr) return NextResponse.json({ error: paketErr.message }, { status: 500 })

  // Ambil semua soal dari paket sumber
  const { data: soalSumber } = await db
    .from('soal')
    .select('*')
    .eq('paket_id', params.id)
    .order('created_at')

  if (soalSumber && soalSumber.length > 0) {
    const soalBaru = soalSumber.map((s: Record<string, unknown>, idx: number) => ({
      id: `SL_${Date.now()}_${idx}`,
      mapel_id: s.mapel_id,
      kelas_id: kelasTarget,
      guru_id: user.username,
      paket_id: newPaketId,
      teks: s.teks,
      gambar_pertanyaan: s.gambar_pertanyaan || null,
      gambar_url: s.gambar_url || null,
      opsi_a: s.opsi_a,
      opsi_b: s.opsi_b,
      opsi_c: s.opsi_c,
      opsi_d: s.opsi_d || null,
      opsi_e: s.opsi_e || null,
      gambar_opsi_a: s.gambar_opsi_a || null,
      gambar_opsi_b: s.gambar_opsi_b || null,
      gambar_opsi_c: s.gambar_opsi_c || null,
      gambar_opsi_d: s.gambar_opsi_d || null,
      gambar_opsi_e: s.gambar_opsi_e || null,
      gambar_a: s.gambar_a || null,
      gambar_b: s.gambar_b || null,
      gambar_c: s.gambar_c || null,
      gambar_d: s.gambar_d || null,
      gambar_e: s.gambar_e || null,
      kunci: s.kunci,
      pembahasan: s.pembahasan || null,
      tingkat: s.tingkat,
      jumlah_opsi: s.jumlah_opsi,
      status: 'DRAFT',
      acak: s.acak ?? 'YA',
    }))

    const { error: soalErr } = await db.from('soal').insert(soalBaru)
    if (soalErr) {
      // Rollback paket
      await db.from('paket_soal').delete().eq('id', newPaketId)
      return NextResponse.json({ error: soalErr.message }, { status: 500 })
    }

    // Update jumlah_soal di paket baru
    await db.from('paket_soal').update({ jumlah_soal: soalBaru.length }).eq('id', newPaketId)
  }

  return NextResponse.json({ message: 'Paket berhasil diduplikasi', id: newPaketId }, { status: 201 })
}
