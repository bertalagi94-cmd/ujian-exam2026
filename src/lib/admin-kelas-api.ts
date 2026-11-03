// src/lib/admin-kelas-api.ts
//
// Handler bersama untuk endpoint Admin Kelas (PG & Essay memakai logika sama,
// hanya beda tabel). Route di /api/guru/admin-kelas/* hanya meneruskan ke sini.
//
// Keamanan:
//   - role akun tetap GURU; hak tambahan dicek dari tabel admin_kelas di SETIAP
//     request (bukan dari klaim token), jadi pencabutan oleh Super Admin langsung
//     berlaku tanpa menunggu token kedaluwarsa.
//   - Daftar & aksi dibatasi ke kelas_id wilayah; paket di luar wilayah → 403.
//   - Admin Kelas TIDAK boleh memvalidasi paket buatannya sendiri (konflik
//     kepentingan) → diteruskan ke Super Admin / Admin Kelas lain.
//   - Durasi essay & pengaturan jadwal tetap hak Super Admin (tidak ada di sini).
//   - Papan kesiapan ujian: hanya BACA, disaring ke kelas wilayah.
//   - Reset password siswa: hanya siswa di kelas wilayah (bukan akun tester),
//     password kembali ke NISN (sama seperti Super Admin), dan SETIAP reset
//     dicatat di log_aktivitas (aksi ADMIN_KELAS_RESET_PASSWORD).
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { requireRoleAktif } from '@/lib/status-akun'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { catatAktivitas } from '@/lib/aktivitas'
import { ambilSemuaBaris } from '@/lib/ambil-semua'
import { getRangkumanJadwal } from '@/lib/rangkuman'
import { rapikanNamaKelas } from '@/lib/kelas-sync'
import { linkWhatsApp } from '@/lib/pengingat-tutup-sesi'
import type { StatusSoal } from '@/lib/soal-status-shared'
import type {
  BarisKesiapanKelas, ResponKesiapanKelas, ResponSiswaAdminKelas, SiswaAdminKelas,
} from '@/lib/admin-kelas-shared'
import { getKelasAdminKelas, paketDalamWilayah, type KelasAdminKelas } from '@/lib/admin-kelas'
import {
  aksiValid, pesanSukses, perkayaPaket, ubahStatusPaket,
  type JenisPaket,
} from '@/lib/persetujuan-paket'

type Konteks = {
  user: { username: string }
  yayasanId: string
  db: ReturnType<typeof tenantDb>
  wilayah: KelasAdminKelas[]
}

async function siapkan(req: NextRequest): Promise<{ ctx: Konteks } | { error: Response }> {
  const auth = await requireRoleAktif(req, ['GURU'])
  if ('error' in auth) return { error: auth.error }
  const yayasanId = yayasanIdDari(auth.user)
  const db = tenantDb(yayasanId)
  const wilayah = await getKelasAdminKelas(db, auth.user.username)
  if (wilayah.length === 0) {
    return {
      error: NextResponse.json(
        { error: 'Akun Anda belum ditunjuk sebagai Admin Kelas oleh administrator.' },
        { status: 403 }
      ),
    }
  }
  return { ctx: { user: auth.user, yayasanId, db, wilayah } }
}

const tabel = (j: JenisPaket) => (j === 'ESSAY' ? 'paket_essay' : 'paket_soal')

/** GET: daftar paket menurut status, hanya untuk kelas wilayah. */
export async function daftarPaketAdminKelas(req: NextRequest, jenis: JenisPaket) {
  const s = await siapkan(req)
  if ('error' in s) return s.error
  const { db, wilayah, user } = s.ctx

  const status = new URL(req.url).searchParams.get('status') ?? 'MENUNGGU'
  let q = db
    .from(tabel(jenis))
    .select('*')
    .eq('status', status)
    .in('kelas_id', wilayah.map(k => k.id))
    .order('tanggal', { ascending: false })
  // Paket buatan sendiri tidak bisa diproses di sini, jadi tidak ikut antrean.
  if (status === 'MENUNGGU') q = q.neq('guru_id', user.username)

  const { data: pakets, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: await perkayaPaket(db, pakets ?? []) })
}

/** POST: setujui / tolak / batal setujui satu paket dalam wilayah. */
export async function aksiPaketAdminKelas(req: NextRequest, jenis: JenisPaket) {
  const s = await siapkan(req)
  if ('error' in s) return s.error
  const { db, wilayah, user } = s.ctx

  const { paket_id, action, catatan } = await req.json()
  if (!aksiValid(action)) return NextResponse.json({ error: 'Action tidak valid' }, { status: 400 })
  if (!paket_id || typeof paket_id !== 'string') {
    return NextResponse.json({ error: 'paket_id wajib diisi' }, { status: 400 })
  }
  if (action === 'TOLAK' && !catatan?.trim()) {
    return NextResponse.json(
      { error: 'Alasan penolakan wajib diisi agar guru bisa memperbaiki soalnya.' },
      { status: 400 }
    )
  }

  const hasil = await ubahStatusPaket(db, jenis, {
    paketId: paket_id,
    aksi: action,
    catatan,
    izinkan: paket => {
      if (!paketDalamWilayah(paket.kelas_id, wilayah)) {
        return 'Paket ini di luar kelas yang menjadi tanggung jawab Anda.'
      }
      if (paket.guru_id === user.username) {
        return 'Anda tidak dapat memvalidasi paket soal buatan sendiri. Minta Super Admin atau Admin Kelas lain.'
      }
      return null
    },
  })
  if (!hasil.ok) return NextResponse.json({ error: hasil.error }, { status: hasil.httpStatus })

  // Jejak: siapa yang memutuskan (fire-and-forget, tidak menggagalkan respons).
  catatAktivitas(
    db, user.username, 'ADMIN_KELAS_VALIDASI',
    `${action} paket ${jenis} ${paket_id} (kelas ${hasil.paket.kelas_id})`
  )

  return NextResponse.json({ message: `Paket berhasil ${pesanSukses(hasil.status)}` })
}

/** GET: isi soal satu paket (untuk pratinjau), hanya kalau paket dalam wilayah. */
export async function soalPaketAdminKelas(req: NextRequest, jenis: JenisPaket, paketId: string) {
  const s = await siapkan(req)
  if ('error' in s) return s.error
  const { db, wilayah } = s.ctx

  const { data: paket, error: pErr } = await db
    .from(tabel(jenis)).select('kelas_id').eq('id', paketId).maybeSingle()
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
  if (!paket) return NextResponse.json({ error: 'Paket tidak ditemukan' }, { status: 404 })
  if (!paketDalamWilayah(paket.kelas_id, wilayah)) {
    return NextResponse.json({ error: 'Paket ini di luar kelas yang menjadi tanggung jawab Anda.' }, { status: 403 })
  }

  const { data, error } = jenis === 'ESSAY'
    ? await db.from('soal_essay').select('*').eq('paket_essay_id', paketId).order('urutan', { ascending: true })
    : await db.from('soal').select('*').eq('paket_id', paketId).order('created_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}


// ── PAPAN KESIAPAN UJIAN PER KELAS ──────────────────────────────────────────
// Hanya baca. Memakai getRangkumanJadwal (sumber yang sama dengan Rangkuman
// Jadwal Super Admin) lalu disaring ke kelas wilayah, jadi angkanya selalu
// sama dengan yang dilihat Super Admin untuk kelas itu.
// Catatan: status soal dihitung dari paket PG (sama seperti Rangkuman Jadwal).

// Urutan tampil: yang butuh tindakan Admin Kelas / guru di atas.
const URUTAN_KESIAPAN: Record<StatusSoal, number> = {
  MENUNGGU: 0, BELUM_ADA: 1, DRAFT: 2, DITOLAK: 3, DISETUJUI: 4,
}

// Status yang menunggu tindakan GURU (bukan Admin Kelas) → layak ditagih.
const STATUS_TAGIH: ReadonlySet<StatusSoal> = new Set<StatusSoal>(['BELUM_ADA', 'DRAFT', 'DITOLAK'])

function pesanTagih(namaGuru: string, mapel: string, kelas: string, status: StatusSoal): string {
  const sapa = `Selamat pagi Bapak/Ibu ${namaGuru}, `
  const isi =
    status === 'BELUM_ADA' ? `paket soal ${mapel} untuk kelas ${kelas} belum dibuat. Mohon segera dibuat dan dikirim agar bisa divalidasi.`
    : status === 'DRAFT' ? `paket soal ${mapel} untuk kelas ${kelas} masih berstatus draft. Mohon segera dikirim agar bisa divalidasi.`
    : `paket soal ${mapel} untuk kelas ${kelas} ditolak saat validasi. Mohon direvisi sesuai catatan lalu dikirim ulang.`
  return `${sapa}${isi} Terima kasih. (Admin Kelas ${kelas})`
}

/** GET: papan kesiapan ujian untuk kelas wilayah. */
export async function kesiapanAdminKelas(req: NextRequest) {
  const s = await siapkan(req)
  if ('error' in s) return s.error
  const { db, wilayah, yayasanId } = s.ctx

  const kunciWilayah = new Set(wilayah.map(k => rapikanNamaKelas(k.nama)))
  const rangkuman = await getRangkumanJadwal(yayasanId)
  const terpilih = rangkuman.kesiapan
    .filter(k => kunciWilayah.has(rapikanNamaKelas(k.kelas)))
    .sort((a, b) =>
      (URUTAN_KESIAPAN[a.status_soal] ?? 9) - (URUTAN_KESIAPAN[b.status_soal] ?? 9) ||
      a.kelas.localeCompare(b.kelas, 'id', { numeric: true }) ||
      a.nama_mapel.localeCompare(b.nama_mapel, 'id')
    )

  // Nomor HP guru hanya dibaca untuk baris yang memang layak ditagih, dan
  // hanya dikembalikan dalam bentuk tautan WhatsApp (bukan kolom terpisah).
  const guruDitagih = [...new Set(
    terpilih.filter(k => STATUS_TAGIH.has(k.status_soal) && k.guru_id).map(k => String(k.guru_id))
  )]
  const kontak = new Map<string, { nama: string; no_hp: string | null }>()
  if (guruDitagih.length > 0) {
    const { data: guru, error } = await db.from('users').select('username, nama, no_hp').in('username', guruDitagih)
    if (error) return NextResponse.json({ error: `Gagal membaca data guru: ${error.message}` }, { status: 500 })
    for (const g of (guru ?? []) as { username: string; nama: string; no_hp: string | null }[]) {
      kontak.set(g.username, { nama: g.nama, no_hp: g.no_hp })
    }
  }

  const data: BarisKesiapanKelas[] = terpilih.map(k => {
    const kt = k.guru_id ? kontak.get(String(k.guru_id)) : undefined
    const linkTagih = STATUS_TAGIH.has(k.status_soal) && kt
      ? linkWhatsApp(kt.no_hp, pesanTagih(kt.nama, k.nama_mapel, k.kelas, k.status_soal))
      : null
    return {
      mapel_id: k.mapel_id,
      nama_mapel: k.nama_mapel,
      kelas: k.kelas,
      nama_guru: k.nama_guru,
      status_soal: k.status_soal,
      sudah_dijadwalkan: k.sudah_dijadwalkan,
      tanggal_jadwal: k.tanggal_jadwal,
      link_tagih: linkTagih,
    }
  })

  const perStatus: Record<StatusSoal, number> = { DISETUJUI: 0, MENUNGGU: 0, DRAFT: 0, DITOLAK: 0, BELUM_ADA: 0 }
  let siapBelumTerjadwal = 0
  let sudahTerjadwal = 0
  let perluDitagih = 0
  for (const d of data) {
    perStatus[d.status_soal] = (perStatus[d.status_soal] ?? 0) + 1
    if (d.sudah_dijadwalkan) sudahTerjadwal++
    else if (d.status_soal === 'DISETUJUI') siapBelumTerjadwal++
    if (STATUS_TAGIH.has(d.status_soal)) perluDitagih++
  }

  const kelasAdaMapel = new Set(data.map(d => rapikanNamaKelas(d.kelas)))
  const respons: ResponKesiapanKelas = {
    kelas: wilayah,
    data,
    ringkasan: {
      total: data.length,
      per_status: perStatus,
      siap_belum_terjadwal: siapBelumTerjadwal,
      sudah_terjadwal: sudahTerjadwal,
      perlu_ditagih: perluDitagih,
    },
    kelas_tanpa_mapel: wilayah.filter(k => !kelasAdaMapel.has(rapikanNamaKelas(k.nama))).map(k => k.nama),
  }
  return NextResponse.json(respons)
}

// ── RESET PASSWORD SISWA DI KELAS WILAYAH ───────────────────────────────────
// siswa.kelas berisi NAMA kelas (teks bebas), bukan id, jadi pencocokan ke
// wilayah memakai nama yang sudah dirapikan (spasi/huruf besar tidak berpengaruh),
// sama seperti kelas-sync.ts.

/** GET: daftar siswa (non-tester) di kelas wilayah. Tidak memuat hash password. */
export async function daftarSiswaAdminKelas(req: NextRequest) {
  const s = await siapkan(req)
  if ('error' in s) return s.error
  const { db, wilayah } = s.ctx

  const kunciWilayah = new Set(wilayah.map(k => rapikanNamaKelas(k.nama)))
  type Baris = SiswaAdminKelas & { is_tester: string | null }
  const { data, error } = await ambilSemuaBaris<Baris>((dari, sampai) =>
    db.from('siswa').select('nis, nama, kelas, status, last_login, is_tester')
      .order('nis', { ascending: true }).range(dari, sampai)
  )
  if (error) return NextResponse.json({ error: `Gagal membaca data siswa: ${error.message}` }, { status: 500 })

  const siswa: SiswaAdminKelas[] = data
    .filter(r => r.is_tester !== 'YES' && kunciWilayah.has(rapikanNamaKelas(r.kelas)))
    .map(r => ({ nis: String(r.nis), nama: String(r.nama), kelas: String(r.kelas), status: r.status ?? null, last_login: r.last_login ?? null }))
    .sort((a, b) =>
      a.kelas.localeCompare(b.kelas, 'id', { numeric: true }) || a.nama.localeCompare(b.nama, 'id')
    )

  const respons: ResponSiswaAdminKelas = { kelas: wilayah, data: siswa }
  return NextResponse.json(respons)
}

/** POST: reset password satu siswa ke NISN, hanya kalau siswa itu di kelas wilayah. */
export async function resetPasswordSiswaAdminKelas(req: NextRequest, nis: string) {
  const s = await siapkan(req)
  if ('error' in s) return s.error
  const { db, wilayah, user } = s.ctx

  const { data: siswa, error: errBaca } = await db
    .from('siswa').select('nis, nama, kelas, is_tester').eq('nis', nis).maybeSingle()
  if (errBaca) return NextResponse.json({ error: errBaca.message }, { status: 500 })
  if (!siswa) return NextResponse.json({ error: 'Siswa tidak ditemukan' }, { status: 404 })

  const kunciWilayah = new Set(wilayah.map(k => rapikanNamaKelas(k.nama)))
  if (siswa.is_tester === 'YES' || !kunciWilayah.has(rapikanNamaKelas(siswa.kelas))) {
    return NextResponse.json(
      { error: 'Siswa ini di luar kelas yang menjadi tanggung jawab Anda.' },
      { status: 403 }
    )
  }

  const password_hash = await bcrypt.hash(String(siswa.nis), 10)
  const { data: terubah, error: errUbah } = await db
    .from('siswa').update({ password_hash }).eq('nis', siswa.nis).select('nis')
  if (errUbah) return NextResponse.json({ error: errUbah.message }, { status: 500 })
  if (!terubah || terubah.length === 0) {
    return NextResponse.json({ error: 'Siswa tidak ditemukan' }, { status: 404 })
  }

  // Jejak: siapa mereset siapa (tanpa password). Fire-and-forget seperti validasi.
  catatAktivitas(
    db, user.username, 'ADMIN_KELAS_RESET_PASSWORD',
    `Reset password siswa ${siswa.nis} - ${siswa.nama} (kelas ${siswa.kelas})`
  )

  return NextResponse.json({ message: `Password ${siswa.nama} berhasil direset ke NISN` })
}
