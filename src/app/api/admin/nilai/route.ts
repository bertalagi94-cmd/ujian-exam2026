import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN', 'KEPSEK'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const mapelId = searchParams.get('mapel_id')
  // Nama mapel bisa diampu oleh lebih dari satu guru (mapel_id berbeda, nama sama —
  // mis. KIMIA kelas 10 oleh Guru A, KIMIA kelas 12 oleh Guru B). Di menu Rekap Nilai,
  // filter mapel ditampilkan & dipilih berdasarkan NAMA (satu opsi per nama, bukan per
  // baris/guru), jadi di sini kita terima `mapel_nama` dan resolve ke seluruh mapel_id
  // yang memiliki nama tersebut supaya nilai dari semua guru pengampu ikut ter-filter.
  const mapelNama = searchParams.get('mapel_nama')
  const kelasId = searchParams.get('kelas')
  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = parseInt(searchParams.get('per_page') ?? '50')

  let query = db
    .from('nilai')
    .select('*', { count: 'exact' })
    .order('timestamp', { ascending: false })

  if (mapelNama) {
    const { data: mapelRows } = await db.from('mapel').select('id').eq('nama', mapelNama)
    const ids = (mapelRows ?? []).map(m => m.id)
    query = query.in('mapel_id', ids.length ? ids : ['__none__'])
  } else if (mapelId) {
    query = query.eq('mapel_id', mapelId)
  }
  if (kelasId) query = query.eq('kelas', kelasId)

  const from = (page - 1) * perPage
  query = query.range(from, from + perPage - 1)

  const { data, count, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!data || data.length === 0) return NextResponse.json({ data: [], total: 0 })

  // Enrich with names
  const nisSet = [...new Set(data.map(r => r.nis))]
  const mapelSet = [...new Set(data.map(r => r.mapel_id).filter(Boolean))]

  const [{ data: siswaList }, { data: mapelList }] = await Promise.all([
    db.from('siswa').select('nis, nama').in('nis', nisSet).neq('is_tester', 'YES'),  // FIX: exclude tester
    db.from('mapel').select('id, nama').in('id', mapelSet),
  ])

  const siswaMap = Object.fromEntries((siswaList ?? []).map(s => [s.nis, s.nama]))
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))

  const enriched = data.map(r => ({
    ...r,
    nama_siswa: siswaMap[r.nis] ?? r.nis,
    nama_mapel: mapelMap[r.mapel_id] ?? r.mapel_id,
  }))

  return NextResponse.json({ data: enriched, total: count ?? 0 })
}

// PATCH /api/admin/nilai
// Body: { action: 'reset_ujian', nis, sesi_id }
// Mereset hasil ujian seorang siswa untuk satu sesi tertentu, agar siswa tersebut
// bisa login dan mengerjakan ujian itu kembali dari awal.
//
// Berbeda dari fitur reset di menu Pelanggaran (yang ditujukan untuk siswa yang
// melakukan kecurangan/pelanggaran), endpoint ini untuk kasus non-pelanggaran —
// misalnya sesi ditutup paksa oleh pengawas sebelum siswa selesai mengirim jawaban,
// sehingga nilainya tidak valid/tidak ada dan siswa perlu diberi kesempatan ujian ulang.
export async function PATCH(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  let body: { action?: string; nis?: string; sesi_id?: string; catatan?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Request tidak valid' }, { status: 400 })
  }

  const { action, nis, sesi_id: sesiId, catatan } = body

  if (action !== 'reset_ujian') {
    return NextResponse.json({ error: 'Action tidak dikenali' }, { status: 400 })
  }
  if (!nis || !sesiId) {
    return NextResponse.json({ error: 'nis dan sesi_id diperlukan' }, { status: 400 })
  }

  const { data: siswa } = await db.from('siswa').select('nama').eq('nis', nis).single()
  if (!siswa) return NextResponse.json({ error: 'Siswa tidak ditemukan' }, { status: 404 })

  // FIX: sertakan jadwal_id — dibutuhkan di bawah untuk mencari apakah ada
  // sesi SUSULAN yang sedang aktif untuk jadwal yang sama (lihat blok
  // "daftarkan otomatis" setelah proses hapus data selesai).
  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id')
    .eq('id', sesiId)
    .single()
  if (!sesi) return NextResponse.json({ error: 'Sesi ujian tidak ditemukan' }, { status: 404 })

  // Hapus seluruh jejak pengerjaan siswa ini di sesi tersebut:
  // - jawaban yang sudah tersimpan
  // - nilai yang sudah dihasilkan (kalau ada)
  // - riwayat pelanggaran di sesi ini
  // - baris pencatatan di siswa_ujian (status AKTIF/SELESAI/TERKUNCI/RESET dsb.)
  // Menghapus baris siswa_ujian (bukan sekadar mengubah status) membuat siswa kembali
  // berstatus "belum pernah masuk sesi" sehingga datanya bersih untuk ujian ulang.
  //
  // CATATAN: endpoint ini HANYA menghapus data — tidak membuka/menutup sesi ujian
  // secara otomatis. Kapan dan bagaimana siswa diberi akses ujian ulang (mis. lewat
  // sesi susulan, sesi baru, atau membuka kembali sesi ini secara manual) ditentukan
  // sendiri oleh admin/pengawas di langkah berikutnya.
  const [delJawaban, delNilai, delPelanggaran, delSiswaUjian] = await Promise.all([
    db.from('jawaban').delete().eq('sesi_id', sesiId).eq('nis', nis),
    db.from('nilai').delete().eq('sesi_id', sesiId).eq('nis', nis),
    db.from('pelanggaran').delete().eq('sesi_id', sesiId).eq('nis', nis),
    db.from('siswa_ujian').delete().eq('sesi_id', sesiId).eq('nis', nis),
  ])

  const errors = [delJawaban, delNilai, delPelanggaran, delSiswaUjian]
    .map(r => r.error?.message)
    .filter(Boolean)

  if (errors.length > 0) {
    return NextResponse.json({ error: 'Reset gagal sebagian', details: errors }, { status: 500 })
  }

  // Bersihkan kode bypass lama yang belum digunakan supaya tidak membingungkan
  await db.from('log_reset').delete().eq('nis', nis).eq('digunakan', false)

  await db.from('log_reset').insert({
    nis,
    reset_oleh: auth.user?.username ?? 'admin',
    alasan: `sesi:${sesiId} — Reset hasil ujian (bukan pelanggaran) oleh ADMIN agar dapat ujian ulang${catatan ? ': ' + catatan : ''}`,
    password_baru: '-',
    digunakan: true,
  })

  // FIX: kalau kebetulan SUDAH ADA sesi susulan yang sedang BERJALAN untuk
  // jadwal yang sama (mis. pengawas sudah lebih dulu membuka susulan untuk
  // siswa lain di kelas ini), daftarkan NIS siswa yang baru direset ini ke
  // `siswa_diizinkan` sesi tersebut SEKARANG JUGA.
  //
  // Sebelum fix ini, `siswa_diizinkan` hanya diisi SEKALI saat sesi susulan
  // pertama kali dibuka (snapshot "siapa yang belum ujian" pada saat itu).
  // Siswa yang baru direset SETELAH sesi susulan itu aktif tidak pernah
  // masuk ke daftar tsb — akibatnya dia hilang dari tampilan Mode Pengawas
  // (tidak muncul di "belum login" maupun "sudah ujian") DAN ditolak kalau
  // mencoba login pakai kode sesi susulan itu ("Anda tidak terdaftar dalam
  // sesi ujian susulan ini" — lihat /api/siswa/ujian/validasi).
  //
  // Ini TIDAK menggantikan alur manual (admin/guru tetap bisa membuka sesi
  // susulan baru kalau belum ada yang aktif) — cuma menghindari siswa
  // "menghilang" kalau susulan-nya kebetulan sudah lebih dulu berjalan.
  let didaftarkanKeSusulanAktif = false
  if (sesi.jadwal_id) {
    const { data: susulanAktif } = await db
      .from('sesi_ujian')
      .select('id, siswa_diizinkan')
      .eq('jadwal_id', sesi.jadwal_id)
      .eq('is_darurat', true)
      .eq('status', 'BERJALAN')
      .maybeSingle()

    if (susulanAktif) {
      const daftarSekarang: string[] = Array.isArray(susulanAktif.siswa_diizinkan) ? susulanAktif.siswa_diizinkan : []
      if (!daftarSekarang.includes(nis)) {
        const { error: errUpdateSusulan } = await db
          .from('sesi_ujian')
          .update({ siswa_diizinkan: [...daftarSekarang, nis] })
          .eq('id', susulanAktif.id)
        if (!errUpdateSusulan) didaftarkanKeSusulanAktif = true
      } else {
        didaftarkanKeSusulanAktif = true // sudah terdaftar sebelumnya
      }
    }
  }

  return NextResponse.json({
    success: true,
    message: didaftarkanKeSusulanAktif
      ? `Hasil ujian ${siswa.nama} pada sesi ini telah direset (nilai, jawaban, dan pelanggaran dihapus). Sesi ujian susulan yang sedang berjalan untuk jadwal ini sudah otomatis mencakup ${siswa.nama} — siswa dapat langsung login memakai kode sesi susulan tersebut.`
      : `Hasil ujian ${siswa.nama} pada sesi ini telah direset (nilai, jawaban, dan pelanggaran dihapus). Sesi ujian TIDAK dibuka otomatis — buka aksesnya secara manual (mis. lewat sesi susulan) saat siswa siap ujian ulang.`,
    didaftarkanKeSusulanAktif,
  })
}
