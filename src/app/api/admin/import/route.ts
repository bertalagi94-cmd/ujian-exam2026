import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import bcrypt from 'bcryptjs'

// Konversi Excel serial date ke ISO string
function excelDateToISO(serial: number | string | null | undefined): string | null {
  if (!serial || serial === '' || isNaN(Number(serial))) return null
  const n = Number(serial)
  if (n < 1) return null
  // Excel epoch: 1 Jan 1900 = serial 1, tapi Excel salah anggap 1900 sebagai leap year
  const date = new Date((n - 25569) * 86400 * 1000)
  return date.toISOString()
}

// Konversi NIS dari float (8.7486508E7) ke string integer
function toNIS(val: unknown): string {
  if (!val) return ''
  const n = Number(val)
  if (isNaN(n)) return String(val)
  return String(Math.round(n))
}

// Bersihkan string kosong / "EMPTY" jadi null
function clean(val: unknown): string | null {
  if (val === null || val === undefined) return null
  const s = String(val).trim()
  if (s === '' || s === 'EMPTY' || s === 'null') return null
  return s
}

// Konversi kelas dari float (7.0) ke string
function toKelas(val: unknown): string {
  if (!val) return ''
  const n = Number(val)
  if (isNaN(n)) return String(val)
  return String(Math.round(n))
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  try {
    const { tabel, rows } = await req.json() as { tabel: string; rows: Record<string, unknown>[] }

    if (!tabel || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'Data tidak valid' }, { status: 400 })
    }

    const db = createAdminClient()
    let inserted = 0
    let skipped = 0
    const errors: string[] = []

    if (tabel === 'kelas') {
      for (const r of rows) {
        const id = clean(r['ID'])
        const nama = toKelas(r['Nama'])
        if (!id || !nama) { skipped++; continue }
        const { error } = await db.from('kelas').upsert({
          id,
          nama,
          jurusan: clean(r['Jurusan']) ?? '-',
          wali_kelas: clean(r['WaliKelas']),
          jumlah: r['Jumlah'] ? Number(r['Jumlah']) : 0,
        }, { onConflict: 'id' })
        if (error) { errors.push(`kelas ${id}: ${error.message}`); skipped++ } else inserted++
      }
    }

    else if (tabel === 'mapel') {
      for (const r of rows) {
        const id = clean(r['ID'])
        const nama = clean(r['Nama'])
        if (!id || !nama) { skipped++; continue }
        const { error } = await db.from('mapel').upsert({
          id,
          nama,
          guru_id: clean(r['Guru']),
          kelas: clean(r['Kelas']),
          jumlah_opsi: r['JumlahOpsi'] ? Number(r['JumlahOpsi']) : 4,
          kkm: r['KKM'] ? Number(r['KKM']) : 75,
        }, { onConflict: 'id' })
        if (error) { errors.push(`mapel ${id}: ${error.message}`); skipped++ } else inserted++
      }
    }

    else if (tabel === 'users') {
      for (const r of rows) {
        const username = clean(r['Username'])
        const password = clean(r['Password'])
        const nama = clean(r['Nama'])
        if (!username || !password || !nama) { skipped++; continue }
        const password_hash = await bcrypt.hash(password, 10)
        const { error } = await db.from('users').upsert({
          username,
          password_hash,
          nama,
          role: clean(r['Role']) ?? 'GURU',
          mapel_id: clean(r['MapelID']),
          status: clean(r['Status']) ?? 'AKTIF',
          is_tester: clean(r['IS_TESTER']) ?? 'NO',
        }, { onConflict: 'username' })
        if (error) { errors.push(`user ${username}: ${error.message}`); skipped++ } else inserted++
      }
    }

    else if (tabel === 'siswa') {
      for (const r of rows) {
        const nis = toNIS(r['NIS'])
        const password = clean(r['Password'])
        const nama = clean(r['Nama'])
        if (!nis || !password || !nama) { skipped++; continue }
        const password_hash = await bcrypt.hash(password, 10)
        const tanggalLahir = r['TanggalLahir']
          ? excelDateToISO(Number(r['TanggalLahir']))
          : null
        const { error } = await db.from('siswa').upsert({
          nis,
          nama,
          kelas: toKelas(r['Kelas']),
          password_hash,
          status: clean(r['Status']) ?? 'AKTIF',
          tempat_lahir: clean(r['TempatLahir']),
          tanggal_lahir: tanggalLahir ? tanggalLahir.split('T')[0] : null,
          jenis_kelamin: clean(r['JenisKelamin']),
          is_tester: clean(r['IS_TESTER']) ?? 'NO',
        }, { onConflict: 'nis' })
        if (error) { errors.push(`siswa ${nis}: ${error.message}`); skipped++ } else inserted++
      }
    }

    else if (tabel === 'kelas_mapel') {
      for (const r of rows) {
        // Sheet KELAS_MAPEL tidak punya header nama kolom standar — pakai index posisi
        // Kolom: ID, KelasID, Kelas(nama), MapelID, Mapel(nama), Status, CreatedAt
        const id = clean(r['ID'] ?? r[0])
        const kelas_id = clean(r['KelasID'] ?? r[1])
        const mapel_id = clean(r['MapelID'] ?? r[3])
        if (!id || !kelas_id || !mapel_id) { skipped++; continue }
        const { error } = await db.from('kelas_mapel').upsert({
          id,
          kelas_id,
          mapel_id,
          status: clean(r['Status'] ?? r[5]) ?? 'BELUM',
        }, { onConflict: 'id' })
        if (error) { errors.push(`kelas_mapel ${id}: ${error.message}`); skipped++ } else inserted++
      }
    }

    else if (tabel === 'jadwal') {
      for (const r of rows) {
        const id = clean(r['ID'])
        if (!id) { skipped++; continue }
        const tanggal = excelDateToISO(Number(r['Tanggal']))
        // JamMulai/JamSelesai bisa string "07.30" atau decimal (0.3125 = 07:30)
        const parseJam = (v: unknown): string | null => {
          if (!v) return null
          const s = String(v).trim()
          // Sudah format string jam
          if (/^\d{2}[.:]\d{2}$/.test(s)) return s.replace('.', ':')
          // Decimal fraction dari Excel
          const n = Number(s)
          if (!isNaN(n) && n < 1) {
            const totalMin = Math.round(n * 24 * 60)
            const h = Math.floor(totalMin / 60).toString().padStart(2, '0')
            const m = (totalMin % 60).toString().padStart(2, '0')
            return `${h}:${m}`
          }
          return s
        }
        const { error } = await db.from('jadwal').upsert({
          id,
          tanggal: tanggal ? tanggal.split('T')[0] : null,
          sesi: r['Sesi'] ? Number(r['Sesi']) : null,
          jam_mulai: parseJam(r['JamMulai']),
          jam_selesai: parseJam(r['JamSelesai']),
          mapel_id: clean(r['MapelID']),
          kelas: toKelas(r['Kelas']),
          pengawas_id: clean(r['Pengawas']),
          durasi: r['Durasi'] ? Number(r['Durasi']) : 120,
          status: clean(r['Status']) ?? 'AKTIF',
        }, { onConflict: 'id' })
        if (error) { errors.push(`jadwal ${id}: ${error.message}`); skipped++ } else inserted++
      }
    }

    else if (tabel === 'paket_soal') {
      for (const r of rows) {
        const id = clean(r['ID'])
        if (!id) { skipped++; continue }
        const { error } = await db.from('paket_soal').upsert({
          id,
          mapel_id: clean(r['MapelID']),
          kelas_id: clean(r['KelasID']),
          guru_id: clean(r['GuruID']),
          status: clean(r['Status']) ?? 'DRAFT',
          tanggal: excelDateToISO(Number(r['Tanggal'])),
          catatan: clean(r['Catatan']),
          jumlah_soal: r['JumlahSoal'] ? Number(r['JumlahSoal']) : 0,
        }, { onConflict: 'id' })
        if (error) { errors.push(`paket ${id}: ${error.message}`); skipped++ } else inserted++
      }
    }

    else if (tabel === 'soal') {
      for (const r of rows) {
        const id = clean(r['ID'])
        const teks = clean(r['Teks'])
        if (!id || !teks) { skipped++; continue }
        const { error } = await db.from('soal').upsert({
          id,
          mapel_id: clean(r['MapelID']),
          kelas_id: clean(r['KelasID']),
          guru_id: clean(r['GuruID']),
          teks,
          opsi_a: clean(r['OpsiA']),
          opsi_b: clean(r['OpsiB']),
          opsi_c: clean(r['OpsiC']),
          opsi_d: clean(r['OpsiD']),
          opsi_e: clean(r['OpsiE']),
          kunci: clean(r['Kunci']),
          pembahasan: clean(r['Pembahasan']),
          tingkat: clean(r['Tingkat']) ?? 'Sedang',
          jumlah_opsi: r['JumlahOpsi'] ? Number(r['JumlahOpsi']) : 4,
          status: clean(r['Status']) ?? 'DRAFT',
          tanggal: excelDateToISO(Number(r['Tanggal'])),
          catatan: clean(r['Catatan']),
          gambar_url: clean(r['GambarUrl']),
          paket_id: clean(r['PaketID']),
          acak: clean(r['Acak']) ?? 'YA',
        }, { onConflict: 'id' })
        if (error) { errors.push(`soal ${id}: ${error.message}`); skipped++ } else inserted++
      }
    }

    else {
      return NextResponse.json({ error: `Tabel "${tabel}" tidak didukung` }, { status: 400 })
    }

    return NextResponse.json({
      message: `Import selesai`,
      inserted,
      skipped,
      errors: errors.slice(0, 20), // max 20 error ditampilkan
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Import gagal' },
      { status: 500 }
    )
  }
}
