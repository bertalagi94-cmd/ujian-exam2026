import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { cekSesiMapelKelasSudahMulai, pesanBankSoalTerkunci } from '@/lib/sesi-kelas'
import { bacaBatasDurasiEssay } from '@/lib/durasi-ujian'

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error

  const { user } = auth
  const db = createAdminClient()
  const paketId = params.id

  const { data: paket, error: fetchError } = await db
    .from('paket_essay')
    .select('guru_id, status, mapel_id, kelas_id')
    .eq('id', paketId)
    .single()

  if (fetchError || !paket) {
    return NextResponse.json({ error: 'Paket tidak ditemukan' }, { status: 404 })
  }

  if (paket.guru_id !== user.username) {
    return NextResponse.json({ error: 'Tidak memiliki izin' }, { status: 403 })
  }

  if (!['DRAFT', 'DITOLAK'].includes(paket.status)) {
    return NextResponse.json(
      { error: 'Paket hanya bisa dihapus jika berstatus DRAFT atau DITOLAK' },
      { status: 400 }
    )
  }

  // Cegah menghapus paket essay untuk mapel+kelas yang sesi ujiannya sudah
  // pernah dibuka (sedang berjalan atau sudah selesai) — lihat sesi-kelas.ts
  const sesiSudahMulai = await cekSesiMapelKelasSudahMulai(db, paket.mapel_id, paket.kelas_id)
  if (sesiSudahMulai) {
    return NextResponse.json({ error: pesanBankSoalTerkunci('Essay', sesiSudahMulai, 'menghapus') }, { status: 409 })
  }

  const { error: deleteSoalError } = await db
    .from('soal_essay')
    .delete()
    .eq('paket_essay_id', paketId)

  if (deleteSoalError) {
    return NextResponse.json({ error: deleteSoalError.message }, { status: 500 })
  }

  const { error: deletePaketError } = await db
    .from('paket_essay')
    .delete()
    .eq('id', paketId)

  if (deletePaketError) {
    return NextResponse.json({ error: deletePaketError.message }, { status: 500 })
  }

  return NextResponse.json({ message: 'Paket berhasil dihapus' })
}

// FITUR BARU: guru bisa mengubah `mode_jawaban` (DIGITAL/KERTAS) dan/atau
// `durasi_menit` (USULAN durasi essay) paket Essay setelah dibuat. Body boleh
// berisi salah satu atau keduanya. Aturan:
//   - mode_jawaban: status DRAFT / MENUNGGU / DITOLAK boleh diubah (mengubah
//     mode tidak mengubah isi soal, jadi tak perlu menarik paket dulu).
//   - durasi_menit (usulan): HANYA status DRAFT / DITOLAK. Saat MENUNGGU,
//     admin sedang meninjau dan melihat angka usulan itu di popup validasi,
//     jadi angkanya tidak boleh berubah di bawah mata admin — guru cukup
//     menarik paket dulu. Durasi final tetap ditetapkan admin di jadwal.
//   - Status DISETUJUI -> tidak ada yang boleh diubah langsung. Admin harus
//     membatalkan persetujuan dulu (BATAL_SETUJUI, status kembali DRAFT).
//   - Kapan pun, kalau sesi ujian mapel+kelas ini sudah pernah dibuka
//     (BERJALAN/SELESAI), tidak ada yang bisa diubah (lihat sesi-kelas.ts).
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error

  const { user } = auth
  const db = createAdminClient()
  const paketId = params.id
  const body = await req.json()

  const ubahMode = body.mode_jawaban !== undefined
  const ubahDurasi = body.durasi_menit !== undefined

  if (!ubahMode && !ubahDurasi) {
    return NextResponse.json({ error: 'Tidak ada data yang diubah' }, { status: 400 })
  }
  if (ubahMode && body.mode_jawaban !== 'DIGITAL' && body.mode_jawaban !== 'KERTAS') {
    return NextResponse.json({ error: "mode_jawaban harus 'DIGITAL' atau 'KERTAS'" }, { status: 400 })
  }

  let durasiBaru = 0
  if (ubahDurasi) {
    durasiBaru = Number(body.durasi_menit)
    if (!Number.isFinite(durasiBaru) || !Number.isInteger(durasiBaru) || durasiBaru <= 0) {
      return NextResponse.json({ error: 'Usulan durasi essay harus berupa bilangan bulat (menit).' }, { status: 400 })
    }
  }

  const { data: paket, error: fetchError } = await db
    .from('paket_essay')
    .select('guru_id, status, mapel_id, kelas_id, mode_jawaban, durasi_menit')
    .eq('id', paketId)
    .single()

  if (fetchError || !paket) {
    return NextResponse.json({ error: 'Paket tidak ditemukan' }, { status: 404 })
  }

  if (paket.guru_id !== user.username) {
    return NextResponse.json({ error: 'Tidak memiliki izin' }, { status: 403 })
  }

  if (paket.status === 'DISETUJUI') {
    return NextResponse.json(
      {
        error: 'Paket ini sudah disetujui admin, jadi tidak bisa diubah langsung. ' +
          'Minta admin membatalkan persetujuan (kembalikan ke draft) terlebih dahulu.',
      },
      { status: 409 }
    )
  }

  if (!['DRAFT', 'MENUNGGU', 'DITOLAK'].includes(paket.status)) {
    return NextResponse.json({ error: 'Paket tidak bisa diubah untuk status ini' }, { status: 400 })
  }

  if (ubahDurasi && !['DRAFT', 'DITOLAK'].includes(paket.status)) {
    return NextResponse.json(
      { error: 'Usulan durasi hanya bisa diubah saat paket berstatus Draf atau Ditolak. Tarik paket dulu kalau ingin mengubahnya.' },
      { status: 409 }
    )
  }

  // Cegah mengubah untuk mapel+kelas yang sesi ujiannya sudah pernah dibuka
  // (sedang berjalan atau sudah selesai) — lihat sesi-kelas.ts
  const sesiSudahMulai = await cekSesiMapelKelasSudahMulai(db, paket.mapel_id, paket.kelas_id)
  if (sesiSudahMulai) {
    return NextResponse.json({ error: pesanBankSoalTerkunci('Essay', sesiSudahMulai, 'mengubah') }, { status: 409 })
  }

  // Batas durasi essay (Pengaturan > Ujian) — aturan yang sama dengan saat
  // paket dibuat (POST /api/guru/paket-essay).
  if (ubahDurasi) {
    const { data: batasRows } = await db
      .from('pengaturan')
      .select('key, value')
      .in('key', ['batas_durasi_essay_min_menit', 'batas_durasi_essay_max_menit'])
    const batas = bacaBatasDurasiEssay(batasRows as Array<{ key: string; value: string | null }> | null)
    if (durasiBaru < batas.min || durasiBaru > batas.max) {
      return NextResponse.json(
        { error: `Usulan durasi essay harus antara ${batas.min} dan ${batas.max} menit. Durasi final ditetapkan admin di jadwal ujian.` },
        { status: 400 }
      )
    }
  }

  const update: Record<string, unknown> = {}
  const pesan: string[] = []
  if (ubahMode && paket.mode_jawaban !== body.mode_jawaban) {
    update.mode_jawaban = body.mode_jawaban
    pesan.push(`Mode jawaban diubah menjadi ${body.mode_jawaban === 'KERTAS' ? 'Kertas' : 'Digital'}`)
  }
  if (ubahDurasi && paket.durasi_menit !== durasiBaru) {
    update.durasi_menit = durasiBaru
    pesan.push(`Usulan durasi diubah menjadi ${durasiBaru} menit`)
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ message: 'Tidak ada perubahan' })
  }

  const { error } = await db.from('paket_essay').update(update).eq('id', paketId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ message: pesan.join('. ') + '.' })
}
