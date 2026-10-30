import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { finalisasiNilaiPaksa } from '@/lib/finalisasi-nilai'
import { ambilSemuaBaris } from '@/lib/ambil-semua'
import { catatAktivitas } from '@/lib/aktivitas'

interface Ctx { params: Promise<{ id: string }> }

type DbTenant = ReturnType<typeof tenantDb>

// ── FINALISASI ULANG ─────────────────────────────────────────────────────────
// MASALAH: kalau finalisasi nilai gagal saat sesi ditutup (mis. gangguan
// database persis saat "Tutup Paksa"), siswa sudah berstatus SELESAI tetapi
// tidak punya baris `nilai`. Kedua route penutupan menolak dijalankan ulang
// (sesi sudah bukan BERJALAN), sehingga satu-satunya jalan dulu adalah input
// nilai manual untuk tiap siswa.
//
// Endpoint ini menghitung ULANG nilai hanya untuk siswa berstatus SELESAI
// yang belum punya baris nilai, dengan logika penilaian yang sama persis
// dengan penutupan paksa (src/lib/finalisasi-nilai.ts).
//
//   GET  → pratinjau: berapa siswa yang terdampak (tidak menulis apa pun).
//   POST → eksekusi.
//
// AMAN DIJALANKAN BERULANG: siswa yang sudah punya nilai tidak disentuh
// (cek di sini, dan sekali lagi di dalam finalisasiNilaiPaksa lewat
// upsert ignoreDuplicates). Hanya sesi berstatus SELESAI yang diproses —
// sesi yang masih BERJALAN ditolak supaya siswa yang sedang mengerjakan
// tidak dinilai sebelum waktunya.
//
// Siswa TERKUNCI tidak ikut: mereka punya nilai 0 placeholder sendiri.

async function muatKonteks(db: DbTenant, sesiId: string) {
  const { data: sesi, error } = await db
    .from('sesi_ujian')
    .select('id, status')
    .eq('id', sesiId)
    .maybeSingle()
  if (error) return { galat: NextResponse.json({ error: `Gagal membaca sesi: ${error.message}` }, { status: 500 }) }
  if (!sesi) return { galat: NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 }) }
  if (sesi.status !== 'SELESAI') {
    return {
      galat: NextResponse.json(
        { error: 'Finalisasi ulang hanya untuk sesi yang sudah SELESAI. Tutup sesi lebih dulu.' },
        { status: 400 }
      ),
    }
  }
  return { sesi }
}

// Siswa SELESAI di sesi ini yang tidak punya baris nilai. Kedua daftar diambil
// halaman demi halaman (batas 1000 baris PostgREST) dengan urutan stabil.
async function cariSiswaTanpaNilai(db: DbTenant, sesiId: string) {
  const selesai = await ambilSemuaBaris<{ nis: string }>((dari, sampai) =>
    db.from('siswa_ujian').select('nis').eq('sesi_id', sesiId).eq('status', 'SELESAI')
      .order('nis', { ascending: true }).range(dari, sampai)
  )
  if (selesai.error) return { error: `Gagal membaca daftar siswa SELESAI: ${selesai.error.message}` }

  const punyaNilai = await ambilSemuaBaris<{ nis: string }>((dari, sampai) =>
    db.from('nilai').select('nis').eq('sesi_id', sesiId)
      .order('nis', { ascending: true }).range(dari, sampai)
  )
  if (punyaNilai.error) return { error: `Gagal membaca daftar nilai: ${punyaNilai.error.message}` }

  const adaNilai = new Set(punyaNilai.data.map(r => r.nis))
  return {
    jumlahSelesai: selesai.data.length,
    tanpaNilai: selesai.data.map(r => r.nis).filter(nis => !adaNilai.has(nis)),
  }
}

export async function GET(req: NextRequest, props: Ctx) {
  const params = await props.params
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = tenantDb(yayasanIdDari(auth.user))
  const konteks = await muatKonteks(db, params.id)
  if ('galat' in konteks) return konteks.galat

  const hasil = await cariSiswaTanpaNilai(db, params.id)
  if ('error' in hasil) return NextResponse.json({ error: hasil.error }, { status: 500 })

  return NextResponse.json({
    jumlahSiswaSelesai: hasil.jumlahSelesai,
    jumlahTanpaNilai: hasil.tanpaNilai.length,
    // Dibatasi supaya respons tetap kecil; jumlah sebenarnya ada di atas.
    contohNis: hasil.tanpaNilai.slice(0, 50),
  })
}

export async function POST(req: NextRequest, props: Ctx) {
  const params = await props.params
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = tenantDb(yayasanIdDari(auth.user))
  const sesiId = params.id
  const konteks = await muatKonteks(db, sesiId)
  if ('galat' in konteks) return konteks.galat

  const hasil = await cariSiswaTanpaNilai(db, sesiId)
  if ('error' in hasil) return NextResponse.json({ error: hasil.error }, { status: 500 })

  if (hasil.tanpaNilai.length === 0) {
    return NextResponse.json({
      message: 'Semua siswa yang SELESAI di sesi ini sudah punya nilai. Tidak ada yang perlu difinalisasi ulang.',
      jumlahTanpaNilai: 0,
      jumlahDinilai: 0,
    })
  }

  const final = await finalisasiNilaiPaksa(db, sesiId, hasil.tanpaNilai, { jenis: 'ULANG' })

  if (!final.ok) {
    // Tidak ada nilai yang ditulis (finalisasiNilaiPaksa berhenti sebelum
    // menulis bila ada error) -> aman dicoba lagi.
    return NextResponse.json({
      message: `Finalisasi ulang GAGAL untuk ${hasil.tanpaNilai.length} siswa. Tidak ada nilai yang ditulis; Anda bisa mencoba lagi.`,
      error: final.error,
      jumlahTanpaNilai: hasil.tanpaNilai.length,
      jumlahDinilai: 0,
    }, { status: 207 })
  }

  catatAktivitas(
    db,
    auth.user.username,
    'FINALISASI_ULANG',
    `sesi=${sesiId}; tanpa_nilai=${hasil.tanpaNilai.length}; dinilai=${final.jumlahDinilai}`
  )

  return NextResponse.json({
    message: final.jumlahDinilai > 0
      ? `${final.jumlahDinilai} siswa dinilai ulang dari jawaban yang tersinkron. Nilai ditandai di catatan guru untuk ditinjau.`
      : 'Tidak ada nilai yang perlu dibuat (sesi ini tidak punya soal pilihan ganda).',
    jumlahTanpaNilai: hasil.tanpaNilai.length,
    jumlahDinilai: final.jumlahDinilai,
  })
}
