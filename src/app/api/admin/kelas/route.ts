import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'
import { hapusFotoEssayFisik } from '@/lib/backup-restore-shared'

/**
 * GET — daftar kelas diambil otomatis dari tabel siswa.
 * Info tambahan (wali_kelas, jurusan) digabung dari tabel kelas jika ada.
 */
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN', 'GURU', 'KEPSEK'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const tester = searchParams.get('tester') === 'true'
  const semua = searchParams.get('all') === 'true'

  // 1. Hitung jumlah siswa per kelas. ?all=true -> hitung dari SEMUA siswa
  // (reguler + tester), dipakai oleh halaman yang butuh daftar kelas lengkap
  // untuk keperluan penugasan/simulasi (mis. dropdown kelas di Mapel, Jadwal,
  // Nilai, Paket Soal Guru) — supaya kelas yang seluruh siswanya berstatus
  // tester tetap muncul dan tidak "hilang" begitu saja.
  // ?tester=true -> hitung dari siswa tester saja (dipakai kartu kelas di tab
  // "Akun Tester"). Default (tanpa parameter) -> siswa reguler saja, seperti
  // sebelumnya.
  let siswaQuery = db.from('siswa').select('kelas')
  if (!semua) {
    siswaQuery = tester ? siswaQuery.eq('is_tester', 'YES') : siswaQuery.neq('is_tester', 'YES')
  }
  const { data: siswaData, error: siswaError } = await siswaQuery

  if (siswaError) return NextResponse.json({ error: siswaError.message }, { status: 500 })

  const kelasCount: Record<string, number> = {}
  for (const s of siswaData ?? []) {
    if (s.kelas) kelasCount[s.kelas] = (kelasCount[s.kelas] ?? 0) + 1
  }

  if (Object.keys(kelasCount).length === 0) {
    return NextResponse.json({ data: [] })
  }

  // 2. Ambil info wali_kelas, jurusan, sekolah_id dari tabel kelas (opsional)
  const { data: kelasInfo } = await db.from('kelas').select('*, sekolah:sekolah_id(id, label, nama_sekolah)')
  const infoMap: Record<string, { id: string; wali_kelas?: string; jurusan?: string; sekolah_id?: string; sekolah?: { id: string; label: string; nama_sekolah: string } | null }> =
    Object.fromEntries((kelasInfo ?? []).map((k) => [k.nama, k]))

  // 3. Gabungkan
  const result = Object.entries(kelasCount)
    .map(([nama, jumlah]) => ({
      id: infoMap[nama]?.id ?? nama,
      nama,
      jumlah,
      wali_kelas: infoMap[nama]?.wali_kelas ?? null,
      jurusan: infoMap[nama]?.jurusan ?? null,
      sekolah_id: infoMap[nama]?.sekolah_id ?? null,
      sekolah: infoMap[nama]?.sekolah ?? null,
    }))
    .sort((a, b) => a.nama.localeCompare(b.nama, 'id', { numeric: true }))

  return NextResponse.json({ data: result })
}

/**
 * PUT — simpan/update wali kelas & jurusan ke tabel kelas (upsert by nama).
 */
export async function PUT(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const body = await req.json()
  const { nama, wali_kelas, jurusan, sekolah_id } = body

  if (!nama) return NextResponse.json({ error: 'Nama kelas diperlukan' }, { status: 400 })

  const { data: existing } = await db.from('kelas').select('id').eq('nama', nama).maybeSingle()

  if (existing) {
    const { error } = await db
      .from('kelas')
      .update({
        wali_kelas: wali_kelas || null,
        jurusan: jurusan || '-',
        sekolah_id: sekolah_id || null,
      })
      .eq('nama', nama)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    // Insert baru — gunakan id unik KLS_xxx, bukan nama, agar id tidak ambigu
    const { error } = await db.from('kelas').insert({
      id: generateId('KLS'),
      nama,
      wali_kelas: wali_kelas || null,
      jurusan: jurusan || '-',
      sekolah_id: sekolah_id || null,
      jumlah: 0,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ message: 'Data kelas berhasil disimpan' })
}

/**
 * DELETE — hapus kelas beserta SEMUA siswa yang ada di kelas tersebut,
 * termasuk semua data turunan milik siswa-siswa itu.
 *
 * FIX (audit lanjutan — Batch 3, "Delete kelas"): versi lama punya 3
 * kekurangan yang sama seperti DELETE siswa individual (lihat
 * api/admin/siswa/[nis]/route.ts) DITAMBAH satu lagi khusus kelas:
 *   1) Tidak menghapus data essay (jawaban_essay, jawaban_essay_foto,
 *      skor_essay_siswa, essay_amplop_offline) maupun log_reset.
 *   2) Beberapa DELETE terpisah TANPA transaksi — bisa gagal sebagian.
 *   3) Tidak ada pembersihan file fisik foto essay di Storage.
 *   4) Identitas kelas HANYA `nama` (bukan kolom unik di tabel `kelas`,
 *      lihat 01_schema.sql) — kalau kelas pernah di-rename, client dengan
 *      nama lama (tab lain yang belum refresh) bisa salah sasaran.
 *
 * Sekarang: `kelasId` (id stabil dari tabel `kelas`, sama seperti yang
 * dikembalikan GET di atas sebagai field `id`) jadi identitas yang
 * DIUTAMAKAN — kalau dikirim, `nama` diresolusi ULANG dari database
 * berdasarkan id, bukan dipercaya mentah-mentah dari body request. `nama`
 * saja tanpa `kelasId` tetap didukung untuk kompatibilitas mundur (kelas
 * yang belum pernah punya baris di tabel `kelas` sama sekali — hanya
 * "murni" dari nilai `siswa.kelas`).
 *
 * CATATAN keterbatasan yang TIDAK diperbaiki di sini (butuh migrasi skema
 * lebih besar, di luar cakupan perbaikan ini): keanggotaan siswa tetap
 * dicocokkan lewat `siswa.kelas` (kolom TEKS nama), BUKAN `kelas_id` — jadi
 * walau identitas kelas yang dihapus sekarang pasti benar, siswa dengan
 * `siswa.kelas` yang tidak sinkron ejaan/spasi dengan `kelas.nama` (data
 * kotor) tetap tidak akan ikut ketemu. Perbaikan penuh butuh kolom
 * `siswa.kelas_id` (FK ke `kelas.id`) di seluruh aplikasi.
 *
 * Semua penghapusan DB (semua siswa di kelas + baris kelas itu sendiri)
 * sekarang jadi SATU transaksi lewat RPC hapus_kelas_atomik (lihat
 * supabase/27_hapus_siswa_kelas_atomik.sql).
 *
 * Body: { nama?: string, kelasId?: string }  (minimal salah satu)
 */
export async function DELETE(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const body = await req.json()
  const namaInput: string | undefined = body?.nama
  const kelasId: string | undefined = body?.kelasId

  if (!namaInput && !kelasId) {
    return NextResponse.json({ error: 'Nama kelas atau kelasId diperlukan' }, { status: 400 })
  }

  let kelasRow: { id: string; nama: string } | null = null
  if (kelasId) {
    const { data, error } = await db.from('kelas').select('id, nama').eq('id', kelasId).maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Kelas tidak ditemukan' }, { status: 404 })
    kelasRow = data
  }
  const nama = kelasRow?.nama ?? namaInput
  if (!nama) return NextResponse.json({ error: 'Nama kelas diperlukan' }, { status: 400 })

  // 1. Ambil semua NIS siswa di kelas ini — dipakai untuk membersihkan foto
  //    essay di Storage sebelum baris DB-nya (termasuk foto_url-nya) hilang.
  const { data: siswaList, error: fetchError } = await db
    .from('siswa')
    .select('nis')
    .eq('kelas', nama)

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })

  const nisList = (siswaList ?? []).map((s) => s.nis)

  if (nisList.length > 0) {
    const { data: fotoRows, error: fotoFetchError } = await db
      .from('jawaban_essay_foto')
      .select('foto_url')
      .in('nis', nisList)

    if (fotoFetchError) {
      return NextResponse.json(
        { error: `Gagal memeriksa foto jawaban essay: ${fotoFetchError.message}` },
        { status: 500 }
      )
    }

    // FAIL-CLOSED: kalau penghapusan Storage gagal, penghapusan DB (RPC di
    // bawah) TIDAK dijalankan sama sekali — supaya foto_url-nya tidak
    // hilang duluan sebelum sempat dihapus fisiknya.
    const storageErr = await hapusFotoEssayFisik(db, (fotoRows ?? []).map((r) => r.foto_url))
    if (storageErr) {
      return NextResponse.json(
        {
          error: `Gagal menghapus file foto jawaban essay dari Storage, penghapusan kelas dibatalkan: ${storageErr}`,
        },
        { status: 500 }
      )
    }
  }

  // 2. Hapus semua siswa di kelas ini + baris kelas itu sendiri dalam SATU
  //    transaksi. FAIL CLOSED: tidak ada fallback ke penghapusan manual
  //    per-tabel kalau RPC gagal (mis. migrasi 27 belum dijalankan).
  const { data: rpcHasil, error: rpcError } = await db.rpc('hapus_kelas_atomik', {
    p_nama: nama,
    p_kelas_id: kelasRow?.id ?? null,
  })

  if (rpcError) {
    console.error('[admin/kelas DELETE] hapus_kelas_atomik gagal:', rpcError.message)
    return NextResponse.json(
      {
        error: `Gagal menghapus kelas: ${rpcError.message}. Pastikan migrasi supabase/27_hapus_siswa_kelas_atomik.sql sudah dijalankan.`,
      },
      { status: 500 }
    )
  }

  const jumlahSiswa = rpcHasil?.jumlah_siswa ?? nisList.length

  return NextResponse.json({
    message: `Kelas ${nama} beserta ${jumlahSiswa} siswa dan seluruh data terkait (nilai, jawaban PG & essay, foto, pelanggaran, log) berhasil dihapus`,
  })
}
