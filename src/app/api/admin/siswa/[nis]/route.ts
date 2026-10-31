import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { hapusFotoEssayFisik } from '@/lib/backup-restore-shared'
import { pastikanKelasAda, pesanKelasTanpaSekolah, rapikanNamaKelas } from '@/lib/kelas-sync'

interface RouteContext {
  params: Promise<{ nis: string }>
}

export async function PUT(req: NextRequest, props: RouteContext) {
  const params = await props.params;
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = tenantDb(yayasanIdDari(auth.user))
  const body = await req.json()
  const { nama, kelas, jenis_kelamin, tempat_lahir, tanggal_lahir, status, is_tester } = body

  // is_tester dipakai untuk menandai siswa yang boleh login walau maintenance
  // mode aktif (lihat src/app/api/auth/login/route.ts). Divalidasi di server
  // supaya tidak bisa diisi nilai sembarangan lewat panggilan API langsung.
  if (is_tester !== undefined && !['YES', 'NO'].includes(is_tester)) {
    return NextResponse.json({ error: "is_tester harus 'YES' atau 'NO'" }, { status: 400 })
  }

  // Kelas dirapikan dan dipastikan ada di tabel `kelas` (lihat src/lib/kelas-sync.ts).
  // Tanpa ini, salah ketik seperti "x a" membuat siswa tidak cocok dengan jadwal/sesi
  // "X A" (perbandingan kelas di aplikasi persis) dan hilang dari scope Kepsek/Guru.
  let kelasFinal: string | undefined
  let peringatan: string | undefined
  if (kelas && rapikanNamaKelas(kelas)) {
    try {
      const hasil = await pastikanKelasAda(db, [kelas])
      kelasFinal = hasil.peta.get(rapikanNamaKelas(kelas)) ?? rapikanNamaKelas(kelas)
      if (hasil.tanpaSekolah.length > 0) peringatan = pesanKelasTanpaSekolah(hasil.tanpaSekolah)
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Gagal memproses kelas' }, { status: 500 })
    }
  }

  const { data, error } = await db
    .from('siswa')
    .update({
      nama: nama ? String(nama).toUpperCase() : undefined,
      kelas: kelasFinal,
      jenis_kelamin: jenis_kelamin || null,
      tempat_lahir: tempat_lahir || null,
      tanggal_lahir: tanggal_lahir || null,
      status: status || undefined,
      is_tester: is_tester || undefined,
    })
    .eq('nis', params.nis)
    .select('nis')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Siswa tidak ditemukan' }, { status: 404 })
  }
  return NextResponse.json({ message: 'Data berhasil diperbarui', ...(peringatan ? { peringatan } : {}) })
}

export async function DELETE(req: NextRequest, props: RouteContext) {
  const params = await props.params;
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = tenantDb(yayasanIdDari(auth.user))
  const { nis } = params

  // Multi-yayasan: jawaban_essay_foto dan RPC hapus_siswa_atomik TIDAK
  // ter-scope otomatis, jadi pastikan dulu siswa ini milik yayasan pemanggil
  // (query siswa ber-scope). Kalau bukan -> 404, tidak ada yang disentuh.
  const { data: siswaAda, error: siswaErr } = await db
    .from('siswa')
    .select('nis')
    .eq('nis', nis)
    .maybeSingle()
  if (siswaErr) return NextResponse.json({ error: siswaErr.message }, { status: 500 })
  if (!siswaAda) return NextResponse.json({ error: 'Siswa tidak ditemukan' }, { status: 404 })

  // FIX (audit lanjutan — Batch 3, "Delete siswa"): versi lama hanya
  // menghapus pelanggaran, nilai, jawaban, siswa_ujian lewat beberapa DELETE
  // TERPISAH (bukan transaksi) — TIDAK PERNAH menyentuh data essay
  // (jawaban_essay, jawaban_essay_foto, skor_essay_siswa,
  // essay_amplop_offline) maupun log_reset, dan tidak ada file fisik foto
  // essay yang dibersihkan dari Storage. Kalau salah satu DELETE gagal di
  // tengah jalan, data jadi campuran separuh-terhapus tanpa jejak.
  //
  // Sekarang, urutannya:
  //  1) Baca foto_url essay siswa ini (kalau ada), hapus fisiknya dari
  //     Storage LEBIH DULU — sebelum baris DB yang menyimpan path/URL-nya
  //     ikut hilang. FAIL-CLOSED: kalau langkah Storage ini gagal, seluruh
  //     operasi DIBATALKAN di sini juga — tidak lanjut ke penghapusan DB.
  //  2) Semua tabel turunan + baris siswa dihapus dalam SATU transaksi
  //     Postgres lewat RPC hapus_siswa_atomik (lihat
  //     supabase/27_hapus_siswa_kelas_atomik.sql) — commit bersama atau
  //     batal bersama, tidak ada lagi kondisi campuran.
  const { data: fotoRows, error: fotoFetchError } = await db
    .from('jawaban_essay_foto')
    .select('foto_url')
    .eq('nis', nis)

  if (fotoFetchError) {
    return NextResponse.json(
      { error: `Gagal memeriksa foto jawaban essay: ${fotoFetchError.message}` },
      { status: 500 }
    )
  }

  const storageErr = await hapusFotoEssayFisik(db, (fotoRows ?? []).map((r) => r.foto_url))
  if (storageErr) {
    return NextResponse.json(
      {
        error: `Gagal menghapus file foto jawaban essay dari Storage, penghapusan siswa dibatalkan: ${storageErr}`,
      },
      { status: 500 }
    )
  }

  // FAIL CLOSED: tidak ada jalur fallback ke penghapusan manual per-tabel
  // kalau RPC gagal (mis. migrasi 27 belum dijalankan) — pola & alasan sama
  // persis dengan simpan_koreksi_essay_atomik (koreksi-essay/route.ts) dan
  // kunci_permanen_atomik (admin/pelanggaran/route.ts).
  const { data: rpcHasil, error: rpcError } = await db.rpc('hapus_siswa_atomik', { p_nis: nis })

  if (rpcError) {
    console.error('[admin/siswa DELETE] hapus_siswa_atomik gagal:', rpcError.message)
    return NextResponse.json(
      {
        error: `Gagal menghapus siswa: ${rpcError.message}. Pastikan migrasi supabase/27_hapus_siswa_kelas_atomik.sql sudah dijalankan.`,
      },
      { status: 500 }
    )
  }

  if (rpcHasil?.hasil === 'SISWA_TIDAK_ADA') {
    return NextResponse.json({ error: 'Siswa tidak ditemukan' }, { status: 404 })
  }

  return NextResponse.json({
    message: 'Siswa beserta seluruh data terkait (nilai, jawaban PG & essay, foto, pelanggaran, log) berhasil dihapus',
  })
}
