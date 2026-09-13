import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { kirimPasanganPaket, cekPasanganPaket } from '@/lib/gabungKirim'
import { cekSesiMapelKelasSudahMulai, pesanBankSoalTerkunci } from '@/lib/sesi-kelas'

// GET dipakai FE untuk menanyakan (tanpa mengubah apa pun) apakah ada paket
// PG pasangan (mapel+kelas sama, masih DRAFT/DITOLAK, minimal 1 soal)
// SEBELUM guru benar-benar menekan "Kirim" — supaya bisa ditampilkan popup
// konfirmasi "kirim sekaligus atau Essay saja?" hanya kalau memang relevan.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; action: string } }
) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()

  if (params.action !== 'kirim') {
    return NextResponse.json({ error: 'Action tidak valid' }, { status: 400 })
  }

  const { data: paket } = await db
    .from('paket_essay')
    .select('guru_id, mapel_id, kelas_id')
    .eq('id', params.id)
    .single()

  if (!paket || paket.guru_id !== user.username) {
    return NextResponse.json({ error: 'Tidak memiliki izin' }, { status: 403 })
  }

  const pasangan = await cekPasanganPaket(db, {
    mapelId: paket.mapel_id,
    kelasId: paket.kelas_id,
    guruId: user.username,
    jenisPasangan: 'PG',
  })

  return NextResponse.json({ adaPasangan: pasangan.ada, jumlahSoal: pasangan.jumlahSoal })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; action: string } }
) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()
  const paketId = params.id
  const action = params.action

  const { data: paket } = await db
    .from('paket_essay')
    .select('guru_id, status, jumlah_soal, mapel_id, kelas_id')
    .eq('id', paketId)
    .single()

  if (!paket || paket.guru_id !== user.username) {
    return NextResponse.json({ error: 'Tidak memiliki izin' }, { status: 403 })
  }

  if (action === 'kirim') {
    if (!['DRAFT', 'DITOLAK'].includes(paket.status)) {
      return NextResponse.json({ error: 'Paket tidak bisa dikirim' }, { status: 400 })
    }

    // Cegah mengajukan paket essay untuk mapel+kelas yang sesi ujiannya
    // sudah pernah dibuka (sedang berjalan atau sudah selesai) — lihat
    // sesi-kelas.ts
    const sesiSudahMulai = await cekSesiMapelKelasSudahMulai(db, paket.mapel_id, paket.kelas_id)
    if (sesiSudahMulai) {
      return NextResponse.json({ error: pesanBankSoalTerkunci('Essay', sesiSudahMulai, 'mengajukan') }, { status: 409 })
    }

    const { count } = await db
      .from('soal_essay')
      .select('*', { count: 'exact', head: true })
      .eq('paket_essay_id', paketId)

    if (!count || count < 1) {
      return NextResponse.json({ error: 'Paket harus memiliki minimal 1 soal' }, { status: 400 })
    }

    const { error } = await db
      .from('paket_essay')
      .update({ status: 'MENUNGGU', jumlah_soal: count, catatan: null, notif_dibaca: true, tanggal: new Date().toISOString() })
      .eq('id', paketId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await db.from('soal_essay').update({ status: 'MENUNGGU' }).eq('paket_essay_id', paketId).eq('status', 'DRAFT')

    // FE menanyakan dulu ke guru lewat popup (lihat GET di atas) apakah mau
    // ikut mengirim paket PG pasangan sekaligus. Defaultnya true supaya
    // pemanggil lama (kalau ada) tetap berperilaku seperti sebelumnya.
    const body = await req.json().catch(() => ({} as { gabungPasangan?: boolean }))
    const gabungPasangan = body?.gabungPasangan !== false

    const pasangan = gabungPasangan
      ? await kirimPasanganPaket(db, {
        mapelId: paket.mapel_id,
        kelasId: paket.kelas_id,
        guruId: user.username,
        jenisPasangan: 'PG',
      })
      : { submitted: false }

    return NextResponse.json({
      message: pasangan.submitted
        ? 'Paket Essay dan PG untuk mapel & kelas ini berhasil dikirim sekaligus untuk validasi'
        : 'Paket berhasil dikirim untuk validasi',
      gabungPg: pasangan.submitted,
    })
  }

  if (action === 'tarik') {
    if (paket.status !== 'MENUNGGU') {
      return NextResponse.json({ error: 'Hanya paket berstatus MENUNGGU yang bisa ditarik' }, { status: 400 })
    }
    const { error } = await db
      .from('paket_essay')
      .update({ status: 'DRAFT', notif_dibaca: true })
      .eq('id', paketId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await db.from('soal_essay').update({ status: 'DRAFT' }).eq('paket_essay_id', paketId).eq('status', 'MENUNGGU')
    return NextResponse.json({ message: 'Paket berhasil ditarik' })
  }

  return NextResponse.json({ error: 'Action tidak valid' }, { status: 400 })
}
