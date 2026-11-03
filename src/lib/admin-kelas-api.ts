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
//   - Pantauan ujian (siswa terkunci & sesi bermasalah): hanya BACA. Membuka
//     kunci dan menutup sesi tetap hak Super Admin / pengawas.
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
import {
  hitungPeserta, labelJamZona, labelTanggalZona, linkWhatsApp, pesanWhatsAppPengawas, tentukanKondisiSesi,
} from '@/lib/pengingat-tutup-sesi'
import { getZonaWaktuSekolah } from '@/lib/pengaturan-waktu'
import { durasiTotalSesi } from '@/lib/durasi-ujian'
import { terjemahJenisPelanggaran } from '@/lib/pelanggaran-shared'
import type { StatusSoal } from '@/lib/soal-status-shared'
import type {
  BarisKesiapanKelas, ResponKesiapanKelas, ResponPantauanKelas, ResponSiswaAdminKelas,
  SesiPantauan, SiswaAdminKelas, SiswaTerkunciPantauan,
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


// ── PANTAUAN UJIAN: SISWA TERKUNCI & SESI BERMASALAH ────────────────────────
// Hanya baca. Tidak ada aksi ubah data di sini: membuka kunci siswa dan menutup
// sesi tetap lewat Super Admin / pengawas. Definisi "sesi bermasalah" memakai
// aturan yang sama dengan pengingat tutup sesi (tentukanKondisiSesi).

const HARI_RIWAYAT_TERKUNCI = 7
const UKURAN_CHUNK = 200

function potong<T>(arr: T[], ukuran = UKURAN_CHUNK): T[][] {
  const hasil: T[][] = []
  for (let i = 0; i < arr.length; i += ukuran) hasil.push(arr.slice(i, i + ukuran))
  return hasil
}

/** GET: sesi berjalan + siswa terkunci (7 hari terakhir) untuk kelas wilayah. */
export async function pantauanAdminKelas(req: NextRequest) {
  const s = await siapkan(req)
  if ('error' in s) return s.error
  const { db, wilayah, yayasanId } = s.ctx

  try {
    const kunciNama = new Set(wilayah.map(k => rapikanNamaKelas(k.nama)))
    const idWilayah = new Set(wilayah.map(k => k.id))
    const dalamWilayah = (kelasSesi: unknown) =>
      kunciNama.has(rapikanNamaKelas(kelasSesi)) || idWilayah.has(String(kelasSesi ?? ''))

    const zona = await getZonaWaktuSekolah(yayasanId)
    const sekarang = new Date()
    const batasRiwayat = new Date(sekarang.getTime() - HARI_RIWAYAT_TERKUNCI * 86_400_000).toISOString()

    // 1) Sesi: yang masih BERJALAN + semua sesi 7 hari terakhir (untuk riwayat terkunci).
    type BarisSesi = {
      id: string; jadwal_id: string | null; mapel_id: string; kelas: string; waktu_mulai: string
      durasi: number | null; status: string; is_darurat: boolean | null; info_json: any
    }
    const kolomSesi = 'id, jadwal_id, mapel_id, kelas, waktu_mulai, durasi, status, is_darurat, info_json'
    const [berjalan, terbaru] = await Promise.all([
      ambilSemuaBaris<BarisSesi>((dari, sampai) =>
        db.from('sesi_ujian').select(kolomSesi).eq('status', 'BERJALAN').order('id', { ascending: true }).range(dari, sampai)),
      ambilSemuaBaris<BarisSesi>((dari, sampai) =>
        db.from('sesi_ujian').select(kolomSesi).gte('waktu_mulai', batasRiwayat).order('id', { ascending: true }).range(dari, sampai)),
    ])
    if (berjalan.error) throw new Error(`Gagal membaca sesi ujian: ${berjalan.error.message}`)
    if (terbaru.error) throw new Error(`Gagal membaca sesi ujian: ${terbaru.error.message}`)

    const sesiPeta = new Map<string, BarisSesi>()
    for (const r of [...berjalan.data, ...terbaru.data]) {
      if (dalamWilayah(r.kelas)) sesiPeta.set(String(r.id), r)
    }
    const semuaSesi = [...sesiPeta.values()]

    // 2) Peserta tiap sesi.
    type BarisPeserta = { sesi_id: string; nis: string; status: string | null; waktu_selesai: string | null }
    const pesertaPerSesi = new Map<string, BarisPeserta[]>()
    for (const grup of potong(semuaSesi.map(x => String(x.id)))) {
      const { data, error } = await ambilSemuaBaris<BarisPeserta>((dari, sampai) =>
        db.from('siswa_ujian').select('sesi_id, nis, status, waktu_selesai')
          .in('sesi_id', grup).order('id', { ascending: true }).range(dari, sampai))
      if (error) throw new Error(`Gagal membaca peserta ujian: ${error.message}`)
      for (const b of data) {
        const arr = pesertaPerSesi.get(String(b.sesi_id)) ?? []
        arr.push(b)
        pesertaPerSesi.set(String(b.sesi_id), arr)
      }
    }

    // 3) Nama mapel, pengawas (hanya untuk sesi BERJALAN).
    const sesiBerjalan = semuaSesi.filter(x => x.status === 'BERJALAN')
    const mapelIds = [...new Set(semuaSesi.map(x => x.mapel_id).filter(Boolean))]
    const jadwalIds = [...new Set(sesiBerjalan.map(x => x.jadwal_id).filter(Boolean))] as string[]
    const [mapelRes, jadwalRes] = await Promise.all([
      mapelIds.length ? db.from('mapel').select('id, nama').in('id', mapelIds) : Promise.resolve({ data: [], error: null }),
      jadwalIds.length ? db.from('jadwal').select('id, pengawas').in('id', jadwalIds) : Promise.resolve({ data: [], error: null }),
    ])
    if (mapelRes.error) throw new Error(`Gagal membaca mata pelajaran: ${mapelRes.error.message}`)
    if (jadwalRes.error) throw new Error(`Gagal membaca jadwal: ${jadwalRes.error.message}`)
    const namaMapel = new Map<string, string>(((mapelRes.data ?? []) as any[]).map(m => [String(m.id), String(m.nama)]))
    const pengawasJadwal = new Map<string, string | null>(((jadwalRes.data ?? []) as any[]).map(j => [String(j.id), j.pengawas ?? null]))

    // 4) Sesi berjalan: tentukan kondisi bermasalah.
    const pengawasSesi = new Map<string, string>()
    const baris: { sesi: BarisSesi; peserta: ReturnType<typeof hitungPeserta>; jenis: SesiPantauan['jenis_masalah'] }[] = []
    for (const sesi of sesiBerjalan) {
      const peserta = hitungPeserta(pesertaPerSesi.get(String(sesi.id)) ?? [])
      const kondisi = tentukanKondisiSesi({
        sekarang, utcOffsetJam: zona.utcOffsetJam, waktuMulai: sesi.waktu_mulai,
        durasiMenit: durasiTotalSesi(sesi.durasi, sesi.info_json), peserta, belumMasuk: null,
      })
      const susulanAdmin = !!sesi.info_json?.dibuka_oleh_admin && !!sesi.info_json?.pengawas_susulan
      const username = susulanAdmin ? sesi.info_json.pengawas_susulan : (sesi.jadwal_id ? pengawasJadwal.get(sesi.jadwal_id) : null)
      if (username) pengawasSesi.set(String(sesi.id), String(username))
      baris.push({ sesi, peserta, jenis: kondisi.jenis })
    }

    const usernamePengawas = [...new Set(baris.filter(b => b.jenis).map(b => pengawasSesi.get(String(b.sesi.id))).filter(Boolean))] as string[]
    const pengawasData = new Map<string, { nama: string; no_hp: string | null }>()
    if (usernamePengawas.length > 0) {
      const { data, error } = await db.from('users').select('username, nama, no_hp').in('username', usernamePengawas)
      if (error) throw new Error(`Gagal membaca data pengawas: ${error.message}`)
      for (const u of (data ?? []) as any[]) pengawasData.set(String(u.username), { nama: String(u.nama), no_hp: u.no_hp ?? null })
    }

    const URUTAN_MASALAH = { KEMARIN: 0, LEWAT_WAKTU: 1, SEMUA_SELESAI: 2 } as const
    const sesiOut: SesiPantauan[] = baris
      .map(({ sesi, peserta, jenis }): SesiPantauan => {
        const username = pengawasSesi.get(String(sesi.id))
        const pg = username ? pengawasData.get(username) : undefined
        const mapel = namaMapel.get(String(sesi.mapel_id)) ?? String(sesi.mapel_id ?? '-')
        const labelTanggal = labelTanggalZona(sesi.waktu_mulai, zona.utcOffsetJam)
        return {
          sesi_id: String(sesi.id),
          nama_mapel: mapel,
          kelas: String(sesi.kelas),
          label_tanggal: labelTanggal,
          label_jam_mulai: labelJamZona(sesi.waktu_mulai, zona.utcOffsetJam),
          durasi_menit: durasiTotalSesi(sesi.durasi, sesi.info_json) || 90,
          is_susulan: !!sesi.info_json?.dibuka_oleh_admin || !!sesi.is_darurat,
          jenis_masalah: jenis,
          peserta: {
            aktif: peserta.aktif, reset: peserta.reset, selesai: peserta.selesai,
            terkunci: peserta.terkunci, total_masuk: peserta.totalMasuk,
          },
          pengawas_nama: pg?.nama ?? username ?? null,
          link_ingatkan: jenis && pg
            ? linkWhatsApp(pg.no_hp, pesanWhatsAppPengawas({ namaPengawas: pg.nama, namaMapel: mapel, namaKelas: String(sesi.kelas), labelTanggal }))
            : null,
        }
      })
      .sort((a, b) =>
        (a.jenis_masalah ? URUTAN_MASALAH[a.jenis_masalah] : 9) - (b.jenis_masalah ? URUTAN_MASALAH[b.jenis_masalah] : 9) ||
        a.kelas.localeCompare(b.kelas, 'id', { numeric: true }) || a.nama_mapel.localeCompare(b.nama_mapel, 'id')
      )

    // 5) Siswa terkunci (semua sesi dalam rentang riwayat).
    const terkunciBaris: { sesi: BarisSesi; nis: string }[] = []
    for (const sesi of semuaSesi) {
      for (const p of pesertaPerSesi.get(String(sesi.id)) ?? []) {
        if (p.status === 'TERKUNCI') terkunciBaris.push({ sesi, nis: String(p.nis) })
      }
    }

    const namaSiswa = new Map<string, { nama: string; kelas: string }>()
    const jumlahPelanggaran = new Map<string, Map<string, number>>() // `${sesi}__${nis}` -> jenis -> jumlah
    if (terkunciBaris.length > 0) {
      for (const grup of potong([...new Set(terkunciBaris.map(t => t.nis))])) {
        const { data, error } = await db.from('siswa').select('nis, nama, kelas').in('nis', grup)
        if (error) throw new Error(`Gagal membaca data siswa: ${error.message}`)
        for (const x of (data ?? []) as any[]) namaSiswa.set(String(x.nis), { nama: String(x.nama), kelas: String(x.kelas) })
      }
      const kunciTerkunci = new Set(terkunciBaris.map(t => `${t.sesi.id}__${t.nis}`))
      for (const grup of potong([...new Set(terkunciBaris.map(t => String(t.sesi.id)))])) {
        const { data, error } = await ambilSemuaBaris<{ sesi_id: string; nis: string; jenis: string | null }>((dari, sampai) =>
          db.from('pelanggaran').select('sesi_id, nis, jenis').in('sesi_id', grup)
            .order('id', { ascending: true }).range(dari, sampai))
        if (error) throw new Error(`Gagal membaca data pelanggaran: ${error.message}`)
        for (const pl of data) {
          const k = `${pl.sesi_id}__${pl.nis}`
          if (!kunciTerkunci.has(k)) continue
          const m = jumlahPelanggaran.get(k) ?? new Map<string, number>()
          const jenis = terjemahJenisPelanggaran(String(pl.jenis ?? 'LAINNYA'))
          m.set(jenis, (m.get(jenis) ?? 0) + 1)
          jumlahPelanggaran.set(k, m)
        }
      }
    }

    const terkunciOut = terkunciBaris
      .map(({ sesi, nis }) => {
        const sw = namaSiswa.get(nis)
        const rincian = jumlahPelanggaran.get(`${sesi.id}__${nis}`)
        const urut = rincian ? [...rincian.entries()].sort((a, b) => b[1] - a[1]) : []
        const item: SiswaTerkunciPantauan = {
          sesi_id: String(sesi.id),
          nis,
          nama: sw?.nama ?? nis,
          kelas: sw?.kelas ?? String(sesi.kelas),
          nama_mapel: namaMapel.get(String(sesi.mapel_id)) ?? String(sesi.mapel_id ?? '-'),
          label_tanggal: labelTanggalZona(sesi.waktu_mulai, zona.utcOffsetJam),
          sesi_berjalan: sesi.status === 'BERJALAN',
          jumlah_pelanggaran: urut.reduce((n, [, c]) => n + c, 0),
          jenis_pelanggaran: urut.slice(0, 3).map(([j]) => j),
        }
        return { item, waktu: sesi.waktu_mulai }
      })
      .sort((a, b) =>
        Number(b.item.sesi_berjalan) - Number(a.item.sesi_berjalan) ||
        b.waktu.localeCompare(a.waktu) ||
        a.item.kelas.localeCompare(b.item.kelas, 'id', { numeric: true }) ||
        a.item.nama.localeCompare(b.item.nama, 'id')
      )
      .map(x => x.item)

    const respons: ResponPantauanKelas = {
      kelas: wilayah,
      sesi: sesiOut,
      terkunci: terkunciOut,
      hari_riwayat: HARI_RIWAYAT_TERKUNCI,
      ringkasan: {
        sesi_berjalan: sesiOut.length,
        sesi_bermasalah: sesiOut.filter(x => x.jenis_masalah).length,
        siswa_terkunci: terkunciOut.length,
        terkunci_di_sesi_berjalan: terkunciOut.filter(x => x.sesi_berjalan).length,
      },
    }
    return NextResponse.json(respons)
  } catch (e) {
    // Fail-closed: gagal membaca tidak boleh tampil sebagai "tidak ada masalah".
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gagal memuat pantauan ujian' }, { status: 500 })
  }
}
