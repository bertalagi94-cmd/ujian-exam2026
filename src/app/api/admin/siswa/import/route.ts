import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { pastikanKelasAda, pesanKelasTanpaSekolah, rapikanNamaKelas } from '@/lib/kelas-sync'

interface ImportRow {
  nis: string
  nama: string
  kelas: string
  password?: string
  jenis_kelamin?: string
  tempat_lahir?: string
  tanggal_lahir?: string
  status?: string
}

// Pertahanan kedua di server: kalau tanggal_lahir yang dikirim ternyata masih
// berupa angka serial Excel mentah (misal "39943" — terjadi kalau sel di file
// sumber diformat sebagai Number bukan Date), konversi ke YYYY-MM-DD di sini
// juga. Frontend (admin/siswa/page.tsx) sudah melakukan konversi yang sama,
// tapi endpoint ini tetap divalidasi ulang supaya aman dari jalur pemanggilan
// lain di masa depan (misal import lewat API langsung, bukan lewat UI).
function normalizeTanggalLahir(value: string | undefined | null): string | null {
  if (!value) return null
  const str = String(value).trim()
  if (!str) return null

  // Serial number Excel murni (mis. "39943") tanpa tanda "-" — bukan format
  // tanggal yang valid untuk Postgres. Konversi pakai epoch Excel standar
  // (1899-12-30), termasuk koreksi bug leap-year 1900 yang berlaku utk serial > 60.
  if (/^\d+$/.test(str)) {
    const serial = Number(str)
    const epoch = Date.UTC(1899, 11, 30)
    const ms = epoch + serial * 24 * 60 * 60 * 1000
    const d = new Date(ms)
    if (isNaN(d.getTime())) return null
    return d.toISOString().slice(0, 10)
  }

  return str
}

// ──────────────────────────────────────────────────────────────────────────────
// POST → langsung mengembalikan stream progres (Server-Sent Events)
//
// FIX: sebelumnya alur 2 langkah (POST simpan job di Map memori → GET ambil job).
// Di Vercel kedua request bisa mendarat di instance berbeda, sehingga job
// "tidak ditemukan" secara acak. Sekarang data dikirim dan diproses dalam
// SATU request yang sama, jadi tidak ada state yang harus dibagi antar instance.
// ──────────────────────────────────────────────────────────────────────────────

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  let body: { data?: ImportRow[] }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Body tidak valid' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const rows: ImportRow[] = body.data as ImportRow[]

  if (!Array.isArray(rows) || rows.length === 0) {
    return new Response(JSON.stringify({ error: 'Data kosong' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const yayasanId = yayasanIdDari(auth.user)
  const db = tenantDb(yayasanId)

  // PRIMARY KEY siswa(nis) masih global (lihat Fase 2 di docs/MULTI_YAYASAN.md).
  // Upsert onConflict 'nis' terhadap NIS milik yayasan LAIN akan MENGAMBIL
  // ALIH baris itu. Jadi NIS yang sudah dimiliki yayasan lain dikecualikan
  // dan dilaporkan sebagai "NIS sudah terdaftar" (tanpa membocorkan pemiliknya).
  // Hapus pemeriksaan ini hanya setelah PK diganti jadi (yayasan_id, nis).
  const nisYayasanLain = new Set<string>()
  {
    const adminRaw = createAdminClient()
    const semuaNis = [...new Set(rows.map((r) => String(r.nis ?? '').trim()).filter(Boolean))]
    for (let i = 0; i < semuaNis.length; i += 200) {
      const { data, error } = await adminRaw
        .from('siswa')
        .select('nis')
        .in('nis', semuaNis.slice(i, i + 200))
        .neq('yayasan_id', yayasanId)
      if (error) {
        return new Response(JSON.stringify({ error: `Gagal memeriksa NISN: ${error.message}` }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      for (const r of data ?? []) nisYayasanLain.add(String(r.nis))
    }
  }

  // Pastikan setiap kelas di file ini punya baris di tabel `kelas`. Tanpa ini,
  // siswa hasil import tidak cocok dengan kelas mana pun dan tidak terlihat
  // oleh Kepsek/Guru (scope mereka dibangun dari tabel `kelas`).
  let petaKelas: Map<string, string>
  let kelasTanpaSekolah: string[]
  try {
    const hasilKelas = await pastikanKelasAda(
      db,
      rows
        .filter((r) => String(r.nis ?? '').trim() && String(r.nama ?? '').trim() && !nisYayasanLain.has(String(r.nis ?? '').trim()))
        .map((r) => r.kelas)
    )
    petaKelas = hasilKelas.peta
    kelasTanpaSekolah = hasilKelas.tanpaSekolah
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Gagal memproses kelas' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // BCRYPT cost 6: ~15ms per hash (vs cost 10: ~100ms) — masih aman untuk import
  const BCRYPT_COST = 6
  // Batch upsert size
  const UPSERT_BATCH = 50

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      let inserted = 0
      let skipped = 0
      const errors: string[] = []
      const total = rows.length

      // Deteksi NIS yang muncul lebih dari sekali DI DALAM FILE YANG SAMA.
      // Upsert berdasarkan NIS berarti baris belakangan akan MENIMPA baris
      // sebelumnya secara diam-diam (nama, kelas, dll tertukar ke siswa yang
      // salah) tanpa error apa pun — ini bukan bug kode, tapi sering luput
      // diperhatikan saat menyusun file Excel (misal copy-paste baris lama
      // lalu lupa mengganti NIS-nya). Dilaporkan di awal supaya admin sadar
      // dan bisa mengecek ulang file sumbernya.
      const nisCount = new Map<string, number>()
      for (const row of rows) {
        const nis = String(row.nis ?? '').trim()
        if (!nis) continue
        nisCount.set(nis, (nisCount.get(nis) ?? 0) + 1)
      }
      const duplicateNis = [...nisCount.entries()].filter(([, count]) => count > 1).map(([nis]) => nis)
      // UI hanya punya satu slot untuk event 'warning', jadi semua peringatan
      // digabung jadi satu pesan.
      const pesanPeringatan: string[] = []
      if (duplicateNis.length > 0) {
        pesanPeringatan.push(
          `${duplicateNis.length} NISN muncul lebih dari sekali di file ini. Baris dengan NISN yang sama akan saling menimpa (baris terakhir yang dipakai) — hanya 1 siswa per NISN yang tersimpan.`
        )
      }
      if (kelasTanpaSekolah.length > 0) {
        pesanPeringatan.push(pesanKelasTanpaSekolah(kelasTanpaSekolah))
      }
      if (pesanPeringatan.length > 0) {
        send({
          type: 'warning',
          message: pesanPeringatan.join(' '),
          duplicateNis: duplicateNis.slice(0, 50),
        })
      }

      send({ type: 'start', total })

      // Proses dalam batch: hash paralel per grup, upsert bulk
      const HASH_PARALLEL = 20 // hash 20 sekaligus
      let processed = 0

      for (let batchStart = 0; batchStart < rows.length; batchStart += HASH_PARALLEL) {
        const group = rows.slice(batchStart, batchStart + HASH_PARALLEL)

        // Hash paralel dalam grup
        const prepared = await Promise.all(
          group.map(async (row) => {
            const nis = String(row.nis ?? '').trim()
            const nama = String(row.nama ?? '').trim().toUpperCase()
            if (!nis || !nama) return null
            if (nisYayasanLain.has(nis)) {
              errors.push(`NISN ${nis} (${nama}): NISN sudah terdaftar`)
              return null
            }

            const password = String(row.password ?? nis).trim() || nis
            const password_hash = await bcrypt.hash(password, BCRYPT_COST)

            return {
              nis,
              nama,
              kelas: petaKelas.get(rapikanNamaKelas(row.kelas)) ?? rapikanNamaKelas(row.kelas),
              password_hash,
              jenis_kelamin: row.jenis_kelamin || null,
              tempat_lahir: row.tempat_lahir || null,
              tanggal_lahir: normalizeTanggalLahir(row.tanggal_lahir),
              status: row.status ?? 'AKTIF',
            }
          })
        )

        const valid = prepared.filter(Boolean) as NonNullable<(typeof prepared)[0]>[]
        skipped += group.length - valid.length

        // Kirim progress untuk tiap siswa di grup ini
        for (let i = 0; i < group.length; i++) {
          processed++
          const row = group[i]
          const isValid = prepared[i] !== null
          send({
            type: 'progress',
            current: processed,
            total,
            nis: String(row.nis ?? '').trim(),
            nama: String(row.nama ?? '').trim(),
            ok: isValid,
          })
        }

        // Upsert valid records dalam sub-batch.
        //
        // PENTING: kalau upsert satu batch gagal (misal karena 1 baris punya
        // data tidak valid — tanggal salah format, dll), JANGAN langsung
        // menggugurkan seluruh batch. Sebelumnya itu yang terjadi: 1 baris
        // rusak di antara 20 baris bikin SEMUA 20 baris di grup itu gagal,
        // termasuk baris-baris lain yang sebenarnya valid. Sekarang: kalau
        // batch gagal, retry satu-per-satu supaya hanya baris yang benar-benar
        // rusak yang digugurkan, baris valid lainnya tetap masuk.
        for (let j = 0; j < valid.length; j += UPSERT_BATCH) {
          const upsertBatch = valid.slice(j, j + UPSERT_BATCH)
          const { error } = await db.from('siswa').upsert(upsertBatch, { onConflict: 'nis' })

          if (!error) {
            inserted += upsertBatch.length
            continue
          }

          // Batch gagal — retry satu-per-satu untuk isolasi baris yang bermasalah
          for (const record of upsertBatch) {
            const { error: rowError } = await db.from('siswa').upsert([record], { onConflict: 'nis' })
            if (rowError) {
              errors.push(`NISN ${record.nis} (${record.nama}): ${rowError.message}`)
              skipped++
            } else {
              inserted++
            }
          }
        }
      }

      send({ type: 'done', inserted, skipped, errors: errors.slice(0, 20) })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
