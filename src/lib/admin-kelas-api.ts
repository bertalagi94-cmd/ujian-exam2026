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
import { NextRequest, NextResponse } from 'next/server'
import { requireRoleAktif } from '@/lib/status-akun'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { catatAktivitas } from '@/lib/aktivitas'
import { getKelasAdminKelas, paketDalamWilayah, type KelasAdminKelas } from '@/lib/admin-kelas'
import {
  aksiValid, pesanSukses, perkayaPaket, ubahStatusPaket,
  type JenisPaket,
} from '@/lib/persetujuan-paket'

type Konteks = {
  user: { username: string }
  db: ReturnType<typeof tenantDb>
  wilayah: KelasAdminKelas[]
}

async function siapkan(req: NextRequest): Promise<{ ctx: Konteks } | { error: Response }> {
  const auth = await requireRoleAktif(req, ['GURU'])
  if ('error' in auth) return { error: auth.error }
  const db = tenantDb(yayasanIdDari(auth.user))
  const wilayah = await getKelasAdminKelas(db, auth.user.username)
  if (wilayah.length === 0) {
    return {
      error: NextResponse.json(
        { error: 'Akun Anda belum ditunjuk sebagai Admin Kelas oleh administrator.' },
        { status: 403 }
      ),
    }
  }
  return { ctx: { user: auth.user, db, wilayah } }
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
