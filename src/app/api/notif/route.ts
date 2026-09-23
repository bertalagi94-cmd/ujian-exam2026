// GET /api/notif
// Mengembalikan badge counts untuk sidebar sesuai role:
// - ADMIN: jumlah paket soal menunggu persetujuan
// - GURU: jumlah paket soal milik guru yang sudah DISETUJUI atau DITOLAK
//   (belum dilihat), + jumlah kisi-kisi BARU dari guru LAIN (rekan kerja)
//   yang belum dilihat guru ini
// - SISWA: jumlah kisi-kisi TERKIRIM baru untuk kelasnya yang belum dilihat
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { getGuruSekolahScope } from '@/lib/kepsek-scope'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN', 'GURU', 'SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()

  if (user.role === 'ADMIN') {
    // FIX (badge tidak menghitung Essay): sebelumnya badge sidebar "Validasi
    // Soal" hanya menghitung paket_soal (PG) berstatus MENUNGGU — kalau ada
    // paket ESSAY yang menunggu validasi tapi tidak ada satupun paket PG yang
    // menunggu, badge di sidebar akan menunjukkan 0 (tidak muncul sama
    // sekali), padahal ada pekerjaan yang perlu ditinjau admin. Sekarang
    // dijumlahkan dari kedua tabel, sama seperti gabungan kedua tab (PG +
    // Essay) di halaman /admin/soal.
    const [{ count: pgCount }, { count: essayCount }] = await Promise.all([
      db.from('paket_soal').select('*', { count: 'exact', head: true }).eq('status', 'MENUNGGU'),
      db.from('paket_essay').select('*', { count: 'exact', head: true }).eq('status', 'MENUNGGU'),
    ])

    return NextResponse.json({
      validasiSoal: (pgCount ?? 0) + (essayCount ?? 0),
      validasiSoalPg: pgCount ?? 0,
      validasiSoalEssay: essayCount ?? 0,
    })
  }

  if (user.role === 'GURU') {
    // Hitung paket soal milik guru yang baru disetujui atau ditolak
    // (status DISETUJUI atau DITOLAK yang belum di-acknowledge)
    // Pakai kolom notif_dibaca: jika null/false = belum dilihat
    const { count: disetujui } = await db
      .from('paket_soal')
      .select('*', { count: 'exact', head: true })
      .eq('guru_id', user.username)
      .in('status', ['DISETUJUI', 'DITOLAK'])
      .eq('notif_dibaca', false)

    // FITUR (badge "Kisi-kisi baru dari rekan kerja"): sama seperti badge
    // "Validasi Soal" di admin, hitung baris kisi_kisi yang BARU (updated_at
    // > terakhir kali guru ini membuka menu Kisi-kisi — lihat POST di bawah)
    // dan BUKAN kisi-kisi milik guru ini sendiri (guru tidak perlu
    // "notifikasi" untuk draft/kirimannya sendiri).
    //
    // kisi_kisi tidak punya kolom boolean "sudah dibaca" seperti paket_soal,
    // karena satu baris kisi_kisi dilihat banyak guru sekaligus (satu
    // sekolah) — jadi status baca disimpan per-akun sebagai timestamp
    // (users.kisi_kisi_terakhir_dilihat, migrasi 30), bukan per-baris.
    let kisiKisiBaru = 0
    const { data: userRow } = await db
      .from('users')
      .select('kisi_kisi_terakhir_dilihat')
      .eq('username', user.username)
      .maybeSingle()

    const scope = await getGuruSekolahScope(user.username)
    if (!scope.noScope && scope.kelasList.length > 0) {
      const { data: kelasScopeRows } = await db
        .from('kelas')
        .select('id')
        .in('nama', scope.kelasList)
      const kelasIdScope = (kelasScopeRows ?? []).map(k => k.id)

      if (kelasIdScope.length > 0) {
        let q = db
          .from('kisi_kisi')
          .select('*', { count: 'exact', head: true })
          .in('kelas_id', kelasIdScope)
          .neq('guru_id', user.username)
        if (userRow?.kisi_kisi_terakhir_dilihat) {
          q = q.gt('updated_at', userRow.kisi_kisi_terakhir_dilihat)
        }
        const { count } = await q
        kisiKisiBaru = count ?? 0
      }
    }

    return NextResponse.json({
      bankSoal: disetujui ?? 0,
      kisiKisiBaru,
    })
  }

  if (user.role === 'SISWA') {
    // FITUR (badge "Kisi-kisi baru" untuk siswa): sama polanya dengan guru
    // di atas — timestamp per-akun di tabel siswa (migrasi 30), bandingkan
    // dengan kisi-kisi TERKIRIM (siswa tidak boleh lihat DRAFT) untuk
    // kelasnya.
    if (!user.kelas) return NextResponse.json({ kisiKisiBaru: 0 })

    const { data: siswaRow } = await db
      .from('siswa')
      .select('kisi_kisi_terakhir_dilihat')
      .eq('nis', user.nis)
      .maybeSingle()

    // kisi_kisi.kelas_id adalah ID tabel kelas, sedangkan user.kelas dari
    // token berisi NAMA kelas — resolve dulu (pola sama seperti di
    // src/app/api/siswa/kisi-kisi/route.ts).
    const { data: kelasRow } = await db
      .from('kelas')
      .select('id')
      .eq('nama', String(user.kelas))
      .maybeSingle()
    const kelasId = kelasRow?.id ?? String(user.kelas)

    let q = db
      .from('kisi_kisi')
      .select('*', { count: 'exact', head: true })
      .eq('kelas_id', kelasId)
      .eq('status', 'TERKIRIM')
    if (siswaRow?.kisi_kisi_terakhir_dilihat) {
      q = q.gt('updated_at', siswaRow.kisi_kisi_terakhir_dilihat)
    }
    const { count } = await q

    return NextResponse.json({ kisiKisiBaru: count ?? 0 })
  }

  return NextResponse.json({})
}

// POST /api/notif — tandai notifikasi sudah dibaca
// Body opsional: { type: 'kisi_kisi' } untuk menandai badge Kisi-kisi
// sebagai sudah dilihat (guru & siswa). Tanpa body (atau type lain) —
// perilaku lama tetap jalan: guru menandai notifikasi paket soal
// disetujui/ditolak sebagai sudah dibaca.
export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['GURU', 'SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()

  let type: string | undefined
  try {
    const body = await req.json()
    type = body?.type
  } catch {
    // Body kosong (kompatibel dengan pemanggilan lama tanpa body) — abaikan.
  }

  if (type === 'kisi_kisi') {
    if (user.role === 'GURU') {
      await db.from('users').update({ kisi_kisi_terakhir_dilihat: new Date().toISOString() }).eq('username', user.username)
    } else if (user.role === 'SISWA' && user.nis) {
      await db.from('siswa').update({ kisi_kisi_terakhir_dilihat: new Date().toISOString() }).eq('nis', user.nis)
    }
    return NextResponse.json({ message: 'Notifikasi kisi-kisi ditandai sudah dibaca' })
  }

  if (user.role !== 'GURU') {
    // Perilaku lama (notif_dibaca paket_soal) khusus GURU.
    return NextResponse.json({ message: 'Tidak ada notifikasi untuk ditandai' })
  }

  await db
    .from('paket_soal')
    .update({ notif_dibaca: true })
    .eq('guru_id', user.username)
    .in('status', ['DISETUJUI', 'DITOLAK'])
    .eq('notif_dibaca', false)

  return NextResponse.json({ message: 'Notifikasi ditandai sudah dibaca' })
}
