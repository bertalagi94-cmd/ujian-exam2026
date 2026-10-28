import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

// Impor massal Mata Pelajaran dari file Excel.
//
// Aturannya SAMA dengan tambah mapel manual (POST /api/admin/mapel):
//   - Nama mapel disimpan HURUF BESAR.
//   - Guru pengampu opsional, tetapi kalau diisi harus akun GURU milik yayasan ini.
//   - Mapel dengan nama + guru yang sama tidak boleh ada dua kali (kelas
//     digabung dalam satu baris, dipisah koma).
//   - Mapel bernama sama tidak boleh diampu guru berbeda pada kelas yang sama
//     (mis. KIMIA kelas 12 tidak boleh dipegang Guru A dan Guru B sekaligus).
//   - KKM bilangan bulat 0-100 (kosong = 75).
//   - Jumlah opsi jawaban TIDAK diimpor: diatur di Pengaturan > Pengaturan
//     Ujian, jadi dipakai nilai bawaan 4 seperti tambah manual.
//
// Aturan tambahan khusus impor:
//   - Kelas harus sudah ada (kelas yang punya siswa, sama dengan pilihan kelas
//     di form Tambah Mapel). Nama kelas dicocokkan tanpa membedakan huruf besar/kecil.
//   - Impor hanya MEMBUAT mapel baru. Baris yang bentrok dilewati (tidak
//     menimpa data lama), supaya impor tidak diam-diam mengubah mapel yang sudah ada.

interface ImportRow {
  nama?: unknown
  guru?: unknown
  kelas?: unknown
  kkm?: unknown
}

interface MapelRow {
  nama: string
  guru_id: string | null
  kelas: Set<string>
  dariFile: boolean
}

const MAX_ROWS = 200
const MAX_NAMA = 100
const KKM_DEFAULT = 75
const JUMLAH_OPSI_DEFAULT = 4 // sama dengan POST /api/admin/mapel
const PAGE = 1000

// Ringkas daftar pesan: tampilkan 50 pertama + jumlah sisanya.
function ringkas(pesan: string[]): string[] {
  if (pesan.length <= 50) return pesan
  return [...pesan.slice(0, 50), `…dan ${pesan.length - 50} pesan lainnya`]
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => null)
  const rows: ImportRow[] = body?.data
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'Data kosong' }, { status: 400 })
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Maksimal ${MAX_ROWS} baris per impor. Pecah file Anda menjadi beberapa bagian.` },
      { status: 400 }
    )
  }

  const db = tenantDb(yayasanIdDari(auth.user))

  // ── Data acuan (semuanya otomatis terbatas pada yayasan ini) ─────────────
  const { data: userRows, error: userError } = await db
    .from('users')
    .select('username, nama, role')
  if (userError) return NextResponse.json({ error: userError.message }, { status: 500 })

  const namaPengguna = new Map<string, string>() // username -> nama (untuk pesan tabrakan)
  const guruByUsername = new Map<string, string>() // username huruf kecil -> username asli
  const guruByNama = new Map<string, string[]>() // nama huruf kecil -> daftar username
  for (const u of userRows ?? []) {
    namaPengguna.set(u.username, u.nama)
    if (u.role !== 'GURU') continue
    guruByUsername.set(String(u.username).toLowerCase(), u.username)
    const k = String(u.nama ?? '').trim().toLowerCase()
    if (k) guruByNama.set(k, [...(guruByNama.get(k) ?? []), u.username])
  }

  // Kelas yang valid = kelas yang punya siswa (sama dengan daftar centang di
  // form Tambah Mapel / GET /api/admin/kelas?all=true). Dibaca per halaman
  // karena batas bawaan 1000 baris per query.
  const kelasByLower = new Map<string, string>() // huruf kecil -> nama kelas asli
  for (let from = 0; ; from += PAGE) {
    const { data: siswaRows, error: siswaError } = await db
      .from('siswa')
      .select('kelas')
      .range(from, from + PAGE - 1)
    if (siswaError) return NextResponse.json({ error: siswaError.message }, { status: 500 })
    for (const s of siswaRows ?? []) {
      const k = String(s.kelas ?? '').trim()
      if (k && !kelasByLower.has(k.toLowerCase())) kelasByLower.set(k.toLowerCase(), k)
    }
    if ((siswaRows?.length ?? 0) < PAGE) break
  }

  const { data: mapelRows, error: mapelError } = await db
    .from('mapel')
    .select('nama, guru_id, kelas_list')
  if (mapelError) return NextResponse.json({ error: mapelError.message }, { status: 500 })

  // Keadaan mapel yang dipakai untuk cek duplikat & tabrakan. Diperbarui setiap
  // ada baris yang lolos, jadi baris-baris di file yang sama saling dicek juga.
  const ada: MapelRow[] = (mapelRows ?? []).map(m => ({
    nama: String(m.nama ?? ''),
    guru_id: m.guru_id || null,
    kelas: new Set(String(m.kelas_list ?? '').split(',').map((s: string) => s.trim()).filter(Boolean)),
    dariFile: false,
  }))

  const errors: string[] = []
  const warnings: string[] = []
  const baru: { id: string; nama: string; guru_id: string | null; kelas_list: string; jumlah_opsi: number; kkm: number }[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? {}
    const barisKe = i + 2 // baris 1 = header di Excel
    const nama = String(row.nama ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
    const label = nama ? `Baris ${barisKe} (${nama})` : `Baris ${barisKe}`

    // 1. Nama
    if (!nama) {
      errors.push(`${label}: nama mata pelajaran wajib diisi`)
      continue
    }
    if (nama.length > MAX_NAMA) {
      errors.push(`${label}: nama mata pelajaran maksimal ${MAX_NAMA} karakter`)
      continue
    }

    // 2. Guru pengampu (opsional). Dicocokkan lewat username; kalau yang
    //    diisi nama lengkap, dipakai hanya bila namanya unik.
    const guruToken = String(row.guru ?? '').trim()
    let guruId: string | null = null
    if (guruToken) {
      const lower = guruToken.toLowerCase()
      guruId = guruByUsername.get(lower) ?? null
      if (!guruId) {
        const kandidat = guruByNama.get(lower) ?? []
        if (kandidat.length === 1) {
          guruId = kandidat[0]
        } else if (kandidat.length > 1) {
          errors.push(`${label}: ada ${kandidat.length} guru bernama "${guruToken}", isi kolom Username Guru dengan username`)
          continue
        }
      }
      if (!guruId) {
        errors.push(`${label}: guru "${guruToken}" tidak ditemukan sebagai akun GURU (cek sheet "Daftar Guru")`)
        continue
      }
    }

    // 3. Kelas (opsional): dipisah koma / titik koma, harus kelas yang sudah ada.
    const kelasTokens = String(row.kelas ?? '')
      .split(/[,;]/)
      .map(s => s.trim())
      .filter(Boolean)
    const kelasFinal: string[] = []
    const kelasTidakDikenal: string[] = []
    for (const t of kelasTokens) {
      const asli = kelasByLower.get(t.toLowerCase())
      if (!asli) { kelasTidakDikenal.push(t); continue }
      if (!kelasFinal.includes(asli)) kelasFinal.push(asli)
    }
    if (kelasTidakDikenal.length > 0) {
      errors.push(`${label}: kelas ${kelasTidakDikenal.map(k => `"${k}"`).join(', ')} tidak ditemukan (cek sheet "Daftar Kelas")`)
      continue
    }

    // 4. KKM: bilangan bulat 0-100, kosong = 75.
    const kkmRaw = String(row.kkm ?? '').trim().replace(',', '.')
    let kkm = KKM_DEFAULT
    if (kkmRaw) {
      const n = Number(kkmRaw)
      if (!Number.isInteger(n) || n < 0 || n > 100) {
        errors.push(`${label}: KKM harus bilangan bulat 0 sampai 100 (kosongkan untuk ${KKM_DEFAULT})`)
        continue
      }
      kkm = n
    }

    // 5. Duplikat: nama + guru yang sama sudah ada.
    const kembar = ada.find(m => m.nama === nama && m.guru_id === guruId)
    if (kembar) {
      errors.push(
        kembar.dariFile
          ? `${label}: mapel dengan guru yang sama muncul lebih dari sekali di file ini (gabungkan kelasnya dalam satu baris, pisahkan dengan koma)`
          : `${label}: mata pelajaran dengan guru yang sama sudah ada dalam daftar`
      )
      continue
    }

    // 6. Tabrakan kelas: nama mapel sama, guru lain, kelas yang sama.
    if (guruId && kelasFinal.length > 0) {
      const tabrakan: string[] = []
      for (const m of ada) {
        if (m.nama !== nama || !m.guru_id || m.guru_id === guruId) continue
        for (const k of kelasFinal) {
          if (m.kelas.has(k)) {
            tabrakan.push(`Kelas ${k} (sudah diampu ${namaPengguna.get(m.guru_id) ?? m.guru_id})`)
          }
        }
      }
      if (tabrakan.length > 0) {
        errors.push(`${label}: ada tabrakan kelas pada mapel "${nama}": ${[...new Set(tabrakan)].join(', ')}`)
        continue
      }
    }

    // Lolos semua aturan.
    ada.push({ nama, guru_id: guruId, kelas: new Set(kelasFinal), dariFile: true })
    baru.push({
      id: generateId('MPL'),
      nama,
      guru_id: guruId,
      kelas_list: kelasFinal.join(','),
      jumlah_opsi: JUMLAH_OPSI_DEFAULT,
      kkm,
    })

    const kurang: string[] = []
    if (!guruId) kurang.push('guru pengampu')
    if (kelasFinal.length === 0) kurang.push('kelas')
    if (kurang.length > 0) {
      warnings.push(`${label}: dibuat tanpa ${kurang.join(' dan ')}, lengkapi lewat tombol Edit`)
    }
  }

  // Semua baris yang lolos disimpan dalam satu perintah (semua atau tidak sama sekali).
  if (baru.length > 0) {
    const { error } = await db.from('mapel').insert(baru)
    if (error) {
      return NextResponse.json({ error: `Gagal menyimpan: ${error.message}` }, { status: 500 })
    }
  }

  return NextResponse.json({
    inserted: baru.length,
    skipped: rows.length - baru.length,
    errors: ringkas(errors),
    warnings: ringkas(warnings),
  })
}
