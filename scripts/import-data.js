/**
 * SMARTEXAM — Script Import Data dari Excel ke Supabase
 * 
 * CARA PAKAI:
 * 1. npm install @supabase/supabase-js xlsx bcryptjs
 * 2. Set environment variables di bawah
 * 3. node scripts/import-data.js
 */

const { createClient } = require('@supabase/supabase-js')
const XLSX = require('xlsx')
const bcrypt = require('bcryptjs')
const path = require('path')

// ==========================================
// KONFIGURASI — ISI INI DULU
// ==========================================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://XXXXX.supabase.co'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGc...'
const EXCEL_PATH = process.env.EXCEL_PATH || path.join(__dirname, '../aplikasi_baru__2_.xlsx')
// ==========================================

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

function readSheet(wb, sheetName) {
  const ws = wb.Sheets[sheetName]
  if (!ws) { console.warn(`  ⚠ Sheet "${sheetName}" tidak ditemukan`); return [] }
  return XLSX.utils.sheet_to_json(ws, { defval: null, raw: false })
}

function safeStr(val) {
  if (val === null || val === undefined) return null
  return String(val).trim() || null
}

function safeInt(val, def = 0) {
  const n = parseInt(val)
  return isNaN(n) ? def : n
}

function safeDate(val) {
  if (!val) return null
  const d = new Date(val)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

async function batchUpsert(table, records, conflictCol, chunkSize = 100) {
  if (!records.length) return 0
  let done = 0
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize)
    const { error } = await db.from(table).upsert(chunk, { onConflict: conflictCol, ignoreDuplicates: true })
    if (error) {
      console.error(`  ✗ Error batch ${i}-${i + chunkSize}:`, error.message)
    } else {
      done += chunk.length
    }
  }
  return done
}

async function importPengaturan(wb) {
  console.log('\n📋 Import PENGATURAN...')
  const rows = readSheet(wb, 'PENGATURAN')
  const records = rows.map(r => ({
    key: safeStr(r.Key),
    value: safeStr(r.Value),
    deskripsi: safeStr(r.Deskripsi),
  })).filter(r => r.key)
  const n = await batchUpsert('pengaturan', records, 'key')
  console.log(`  ✓ ${n} pengaturan`)
}

async function importUsers(wb) {
  console.log('\n👤 Import USERS...')
  const rows = readSheet(wb, 'USERS')
  const records = []
  for (const r of rows) {
    const username = safeStr(r.Username)
    const pw = safeStr(r.Password) || username
    if (!username) continue
    const password_hash = await bcrypt.hash(pw, 10)
    records.push({
      username,
      password_hash,
      nama: safeStr(r.Nama) || username,
      role: safeStr(r.Role) || 'GURU',
      mapel_id: safeStr(r.MapelID),
      status: safeStr(r.Status) || 'AKTIF',
      is_tester: safeStr(r.IS_TESTER) || 'NO',
    })
  }
  const n = await batchUpsert('users', records, 'username')
  console.log(`  ✓ ${n} users`)
}

async function importKelas(wb) {
  console.log('\n🏫 Import KELAS...')
  const rows = readSheet(wb, 'KELAS')
  const records = rows.map(r => ({
    id: safeStr(r.ID),
    nama: safeStr(r.Nama),
    jurusan: safeStr(r.Jurusan) || '-',
    wali_kelas: safeStr(r.WaliKelas),
    jumlah: safeInt(r.Jumlah),
  })).filter(r => r.id && r.nama)
  const n = await batchUpsert('kelas', records, 'id')
  console.log(`  ✓ ${n} kelas`)
}

async function importMapel(wb) {
  console.log('\n📚 Import MAPEL...')
  const rows = readSheet(wb, 'MAPEL')
  const records = rows.map(r => ({
    id: safeStr(r.ID),
    nama: safeStr(r.Nama),
    guru_id: safeStr(r.Guru),
    kelas_list: safeStr(r.Kelas),
    jumlah_opsi: safeInt(r.JumlahOpsi, 4),
    kkm: safeInt(r.KKM, 75),
  })).filter(r => r.id && r.nama)
  const n = await batchUpsert('mapel', records, 'id')
  console.log(`  ✓ ${n} mapel`)
}

async function importKelasMapel(wb) {
  console.log('\n🔗 Import KELAS_MAPEL...')
  const rows = readSheet(wb, 'KELAS_MAPEL')
  const cols = Object.keys(rows[0] || {})
  // Detect column names (might be positional)
  const records = []
  for (const r of rows) {
    const vals = Object.values(r)
    const id = safeStr(vals[0])
    if (!id || !id.startsWith('KM_')) continue
    records.push({
      id,
      kelas_id: safeStr(vals[1]),
      nama_kelas: safeStr(vals[2]),
      mapel_id: safeStr(vals[3]),
      nama_mapel: safeStr(vals[4]),
      status: safeStr(vals[5]) || 'BELUM',
    })
  }
  const n = await batchUpsert('kelas_mapel', records, 'id')
  console.log(`  ✓ ${n} relasi kelas-mapel`)
}

async function importSiswa(wb) {
  console.log('\n🎓 Import SISWA...')
  const rows = readSheet(wb, 'SISWA')
  const records = []
  for (const r of rows) {
    const nis = safeStr(r.NIS)
    if (!nis) continue
    const pw = safeStr(r.Password) || nis
    const password_hash = await bcrypt.hash(pw, 10)
    records.push({
      nis,
      nama: safeStr(r.Nama),
      kelas: safeStr(r.Kelas),
      password_hash,
      status: safeStr(r.Status) || 'AKTIF',
      tempat_lahir: safeStr(r.TempatLahir),
      tanggal_lahir: safeDate(r.TanggalLahir),
      jenis_kelamin: safeStr(r.JenisKelamin),
      is_tester: safeStr(r.IS_TESTER) || 'NO',
    })
  }
  const n = await batchUpsert('siswa', records, 'nis')
  console.log(`  ✓ ${n} siswa`)
}

async function importJadwal(wb) {
  console.log('\n📅 Import JADWAL...')
  const rows = readSheet(wb, 'JADWAL')
  const records = rows.map(r => ({
    id: safeStr(r.ID),
    tanggal: safeDate(r.Tanggal),
    sesi: safeInt(r.Sesi, 1),
    jam_mulai: safeStr(r.JamMulai) || '08:00',
    jam_selesai: safeStr(r.JamSelesai) || '09:30',
    mapel_id: safeStr(r.MapelID),
    kelas: safeStr(r.Kelas),
    pengawas: safeStr(r.Pengawas),
    durasi: safeInt(r.Durasi, 90),
    status: safeStr(r.Status) || 'AKTIF',
  })).filter(r => r.id && r.tanggal)
  const n = await batchUpsert('jadwal', records, 'id')
  console.log(`  ✓ ${n} jadwal`)
}

async function importPaketSoal(wb) {
  console.log('\n📦 Import PAKET_SOAL...')
  const rows = readSheet(wb, 'PAKET_SOAL')
  const records = rows.map(r => ({
    id: safeStr(r.ID),
    mapel_id: safeStr(r.MapelID),
    kelas_id: safeStr(r.KelasID),
    guru_id: safeStr(r.GuruID),
    status: safeStr(r.Status) || 'DRAFT',
    tanggal: r.Tanggal ? new Date(r.Tanggal).toISOString() : new Date().toISOString(),
    catatan: safeStr(r.Catatan),
    jumlah_soal: safeInt(r.JumlahSoal),
  })).filter(r => r.id)
  const n = await batchUpsert('paket_soal', records, 'id')
  console.log(`  ✓ ${n} paket soal`)
}

async function importSoal(wb) {
  console.log('\n❓ Import SOAL (1824 soal)...')
  const rows = readSheet(wb, 'SOAL')
  const records = rows.map(r => ({
    id: safeStr(r.ID),
    mapel_id: safeStr(r.MapelID),
    kelas_id: safeStr(r.KelasID),
    guru_id: safeStr(r.GuruID),
    teks: safeStr(r.Teks) || '(Teks tidak tersedia)',
    opsi_a: safeStr(r.OpsiA),
    opsi_b: safeStr(r.OpsiB),
    opsi_c: safeStr(r.OpsiC),
    opsi_d: safeStr(r.OpsiD),
    opsi_e: safeStr(r.OpsiE),
    kunci: safeStr(r.Kunci) || 'A',
    pembahasan: safeStr(r.Pembahasan),
    tingkat: safeStr(r.Tingkat) || 'Sedang',
    jumlah_opsi: safeInt(r.JumlahOpsi, 4),
    status: safeStr(r.Status) || 'DRAFT',
    tanggal: r.Tanggal ? new Date(r.Tanggal).toISOString() : new Date().toISOString(),
    catatan: safeStr(r.Catatan),
    gambar_url: safeStr(r.GambarUrl),
    paket_id: safeStr(r.PaketID),
    acak: safeStr(r.Acak) || 'YA',
  })).filter(r => r.id && r.teks)
  const n = await batchUpsert('soal', records, 'id')
  console.log(`  ✓ ${n} soal`)
}

async function importNilai(wb) {
  console.log('\n🏆 Import NILAI...')
  const rows = readSheet(wb, 'NILAI')
  const records = rows.map(r => ({
    id: safeStr(r.ID),
    sesi_id: safeStr(r.SesiID),
    nis: safeStr(r.NIS),
    mapel_id: safeStr(r.MapelID),
    kelas: safeStr(r.Kelas),
    benar: safeInt(r.Benar),
    total: safeInt(r.Total),
    nilai: parseFloat(r.Nilai) || 0,
    grade: safeStr(r.Grade) || 'E',
    timestamp: r.Timestamp ? new Date(r.Timestamp).toISOString() : new Date().toISOString(),
    lulus: String(r.Lulus).toUpperCase() === 'TRUE' || String(r.Lulus) === '1',
    kkm: safeInt(r.KKM, 75),
  })).filter(r => r.id && r.nis)
  const n = await batchUpsert('nilai', records, 'id')
  console.log(`  ✓ ${n} nilai`)
}

async function importSiswaUjian(wb) {
  console.log('\n👥 Import SISWA_UJIAN...')
  const rows = readSheet(wb, 'SISWA_UJIAN')
  const records = rows.map(r => ({
    sesi_id: safeStr(r.SesiID),
    nis: safeStr(r.NIS),
    waktu_daftar: r.WaktuDaftar ? new Date(r.WaktuDaftar).toISOString() : new Date().toISOString(),
    waktu_mulai: r.WaktuMulai ? new Date(r.WaktuMulai).toISOString() : null,
    status: safeStr(r.Status) || 'SELESAI',
    waktu_selesai: r.WaktuSelesai ? new Date(r.WaktuSelesai).toISOString() : null,
    device_id: safeStr(r.DeviceID),
  })).filter(r => r.sesi_id && r.nis)
  // Siswa ujian uses SERIAL id so can't use upsert by id, use custom logic
  let done = 0
  for (let i = 0; i < records.length; i += 100) {
    const chunk = records.slice(i, i + 100)
    const { error } = await db.from('siswa_ujian')
      .upsert(chunk, { onConflict: 'sesi_id,nis', ignoreDuplicates: true })
    if (!error) done += chunk.length
    else console.error(`  ⚠ Chunk ${i}:`, error.message)
  }
  console.log(`  ✓ ${done} siswa ujian`)
}

async function importJawaban(wb) {
  console.log('\n📝 Import JAWABAN (33.196 records — ini mungkin memakan beberapa menit)...')
  const rows = readSheet(wb, 'JAWABAN')
  const records = rows.map(r => ({
    sesi_id: safeStr(r.SesiID),
    nis: safeStr(r.NIS),
    soal_id: safeStr(r.SoalID),
    jawaban: safeStr(r.Jawaban),
    updated_at: r.Timestamp ? new Date(r.Timestamp).toISOString() : new Date().toISOString(),
    sync_status: safeStr(r.SyncStatus) || 'FINAL',
  })).filter(r => r.sesi_id && r.nis && r.soal_id)

  let done = 0
  const chunkSize = 500
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize)
    const { error } = await db.from('jawaban')
      .upsert(chunk, { onConflict: 'sesi_id,nis,soal_id', ignoreDuplicates: true })
    if (!error) done += chunk.length
    else console.error(`  ⚠ Chunk ${i}:`, error.message)
    if ((i + chunkSize) % 5000 === 0) {
      console.log(`    → Progress: ${i + chunkSize}/${records.length}`)
    }
  }
  console.log(`  ✓ ${done} jawaban`)
}

async function importLogAktivitas(wb) {
  console.log('\n📜 Import LOG_AKTIVITAS...')
  const rows = readSheet(wb, 'LOG_AKTIVITAS')
  const records = rows.map(r => ({
    id: safeStr(r.ID),
    user_id: safeStr(r.User),
    aksi: safeStr(r.Aksi),
    detail: safeStr(r.Detail),
    created_at: r.Timestamp ? new Date(r.Timestamp).toISOString() : new Date().toISOString(),
  })).filter(r => r.id)
  const n = await batchUpsert('log_aktivitas', records, 'id')
  console.log(`  ✓ ${n} log aktivitas`)
}

async function main() {
  console.log('🚀 SmartExam — Import Data ke Supabase')
  console.log('==========================================')
  console.log(`📁 File: ${EXCEL_PATH}`)
  console.log(`🌐 URL:  ${SUPABASE_URL}`)
  console.log('')

  const wb = XLSX.readFile(EXCEL_PATH)
  console.log('✓ File Excel berhasil dibaca')
  console.log('  Sheets:', wb.SheetNames.join(', '))

  const startTime = Date.now()

  try {
    // Urutan penting: master data dulu, baru transaksi
    await importPengaturan(wb)
    await importUsers(wb)
    await importKelas(wb)
    await importMapel(wb)
    await importKelasMapel(wb)
    await importSiswa(wb)
    await importJadwal(wb)
    await importPaketSoal(wb)
    await importSoal(wb)
    // Transaksi (tidak ada sesi_ujian di sheet, skip)
    await importNilai(wb)
    await importSiswaUjian(wb)
    await importJawaban(wb)
    await importLogAktivitas(wb)

    const elapsed = Math.round((Date.now() - startTime) / 1000)
    console.log(`\n✅ Import selesai! Waktu: ${elapsed} detik`)
    console.log('\nLangkah selanjutnya:')
    console.log('1. Cek data di Supabase dashboard')
    console.log('2. Copy .env.local.example → .env.local dan isi credentials')
    console.log('3. npm run dev')
  } catch (err) {
    console.error('\n❌ Import gagal:', err)
    process.exit(1)
  }
}

main()
