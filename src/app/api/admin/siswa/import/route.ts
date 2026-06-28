import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

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
// GET → Server-Sent Events (SSE) streaming progress
// Dipanggil setelah POST menyimpan data ke memori sementara via query param
// ──────────────────────────────────────────────────────────────────────────────

// Simpan data antar request (in-memory per instance — cukup untuk 1 admin)
// Key = token sesi sederhana
const pendingJobs = new Map<string, ImportRow[]>()

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const body = await req.json()
  const rows: ImportRow[] = body.data

  if (!Array.isArray(rows) || rows.length === 0) {
    return new Response(JSON.stringify({ error: 'Data kosong' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Simpan job, kembalikan jobId
  const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  pendingJobs.set(jobId, rows)

  // Cleanup otomatis 5 menit
  setTimeout(() => pendingJobs.delete(jobId), 5 * 60 * 1000)

  return new Response(JSON.stringify({ jobId, total: rows.length }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const jobId = req.nextUrl.searchParams.get('jobId')
  if (!jobId) {
    return new Response(JSON.stringify({ error: 'jobId diperlukan' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const rows = pendingJobs.get(jobId)
  if (!rows) {
    return new Response(JSON.stringify({ error: 'Job tidak ditemukan atau sudah kadaluarsa' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  pendingJobs.delete(jobId)
  const db = createAdminClient()

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
      if (duplicateNis.length > 0) {
        send({
          type: 'warning',
          message: `${duplicateNis.length} NIS muncul lebih dari sekali di file ini. Baris dengan NIS yang sama akan saling menimpa (baris terakhir yang dipakai) — hanya 1 siswa per NIS yang tersimpan.`,
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

            const password = String(row.password ?? nis).trim() || nis
            const password_hash = await bcrypt.hash(password, BCRYPT_COST)

            return {
              nis,
              nama,
              kelas: String(row.kelas ?? '').trim(),
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
              errors.push(`NIS ${record.nis} (${record.nama}): ${rowError.message}`)
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
