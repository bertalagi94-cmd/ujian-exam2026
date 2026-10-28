#!/usr/bin/env node
/**
 * Membuat (atau mengganti password) akun developer.
 *
 *   node scripts/buat-developer.js <username> ["Nama Tampilan"]
 *
 * Skrip meminta password (tidak ditampilkan di layar), lalu MENCETAK SQL
 * berisi hash bcrypt. Salin SQL itu ke SQL Editor Supabase.
 * Password tidak pernah disimpan di file/riwayat perintah. Butuh migrasi 47.
 */
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const readline = require('readline')

const username = (process.argv[2] || '').trim().toLowerCase()
const nama = (process.argv[3] || 'Developer').trim()
if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
  console.error('Pemakaian: node scripts/buat-developer.js <username> ["Nama"]\nUsername 3-40 karakter: huruf kecil, angka, titik, strip, garis bawah.')
  process.exit(1)
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY })
let tampilkan = true
const tulisAsli = rl._writeToOutput
rl._writeToOutput = function (str) { if (tampilkan) tulisAsli.call(rl, str) }
const antrean = []
let menunggu = null
rl.on('line', baris => { if (menunggu) { const r = menunggu; menunggu = null; r(baris) } else antrean.push(baris) })

function tanya(prompt) {
  process.stdout.write(prompt)
  tampilkan = false
  return new Promise(resolve => {
    const selesai = v => { tampilkan = true; process.stdout.write('\n'); resolve(v) }
    if (antrean.length) selesai(antrean.shift()); else menunggu = selesai
  })
}

;(async () => {
  const pw = await tanya('Password developer (min 12 karakter): ')
  const ulang = await tanya('Ulangi password: ')
  if (pw !== ulang) { console.error('Password tidak sama.'); process.exit(1) }
  if (pw.length < 12) { console.error('Password minimal 12 karakter.'); process.exit(1) }

  const hash = bcrypt.hashSync(pw, 12)
  const id = 'DEV_' + crypto.randomBytes(6).toString('hex').toUpperCase()
  const esc = v => v.replace(/'/g, "''")
  rl.close()
  console.log('\n-- Jalankan di SQL Editor Supabase:\n')
  console.log(
`INSERT INTO developer_akun (id, username, password_hash, nama)
VALUES ('${id}', '${esc(username)}', '${hash}', '${esc(nama)}')
ON CONFLICT (lower(username)) DO UPDATE
  SET password_hash = EXCLUDED.password_hash, nama = EXCLUDED.nama, status = 'AKTIF';`)
})()
