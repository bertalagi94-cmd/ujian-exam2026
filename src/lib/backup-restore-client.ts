// Orkestrasi backup & restore dari sisi BROWSER.
//
// Kenapa di browser: server berjalan di Vercel dengan batas body request/
// response ±4,5 MB dan batas waktu per request. Backup nyata (puluhan ribu baris
// jawaban + gambar) jauh lebih besar dari itu, jadi pekerjaan dipecah menjadi
// banyak request kecil yang dikoordinasi di sini. Sisi server:
//   src/app/api/admin/backup/route.ts   (GET: plan / halaman tabel / satu file)
//   src/app/api/admin/restore/route.ts  (POST: start / clear / insert / storage-* / finish)

// ── Tipe ─────────────────────────────────────────────────────────────────────
export interface AssetRec {
  path: string
  contentType?: string
  base64: string
}

export interface ParsedBackup {
  version?: string
  app?: string
  exported_at?: string
  errors?: string[]
  row_counts?: Record<string, number>
  tables: Record<string, unknown[]>
  storage?: {
    // Format 1.1 (lama): hanya bucket `assets`
    assets?: AssetRec[]
    // Format 2.0: semua bucket
    buckets?: Record<string, AssetRec[]>
  }
  // Diisi parseBackupText — jumlah baris sebenarnya per tabel
  actualCounts: Record<string, number>
}

export type ProgressFn = (pct: number, detail: string) => void

export class ApiError extends Error {
  status: number
  data: Record<string, unknown>
  constructor(message: string, status: number, data: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

// Ada sesi ujian/siswa aktif (HTTP 409) — UI menawarkan opsi "paksa".
export class AktivitasAktifError extends ApiError {
  adaSesi: boolean
  adaSiswa: boolean
  constructor(message: string, data: Record<string, unknown>) {
    super(message, 409, data)
    this.name = 'AktivitasAktifError'
    this.adaSesi = !!data.ada_sesi
    this.adaSiswa = !!data.ada_siswa
  }
}

// Kegagalan di tengah restore, SETELAH data lama mulai dihapus.
export class RestoreFatalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RestoreFatalError'
  }
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
function getToken(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem('token') : null
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// fetch + timeout + retry untuk gangguan sementara (jaringan putus, 502/503/504).
// Aman untuk di-retry karena semua action restore idempoten (clear, upsert,
// upload upsert, prune, finish) dan semua GET backup hanya membaca.
async function callApi<T = Record<string, unknown>>(
  url: string,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
  opts: { retries?: number; timeoutMs?: number } = {}
): Promise<T> {
  const retries = opts.retries ?? 2
  const timeoutMs = opts.timeoutMs ?? 90_000
  const token = getToken()

  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        method: init.method ?? 'GET',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
        cache: 'no-store',
      })

      let data: Record<string, unknown> = {}
      try {
        data = (await res.json()) as Record<string, unknown>
      } catch {
        // Respons bukan JSON (mis. halaman error HTML dari platform)
      }

      if (res.ok) return data as T

      if (res.status === 409 && data.ada_aktivitas) {
        throw new AktivitasAktifError(String(data.error ?? 'Ada sesi ujian aktif'), data)
      }
      const message =
        typeof data.error === 'string' && data.error
          ? data.error
          : res.status === 413
            ? 'Data terlalu besar untuk satu request (413)'
            : `Server mengembalikan HTTP ${res.status}`

      // Retry hanya untuk error sementara di sisi server/platform
      if ([502, 503, 504].includes(res.status) && attempt < retries) {
        lastErr = new ApiError(message, res.status, data)
        await sleep(800 * (attempt + 1))
        continue
      }
      throw new ApiError(message, res.status, data)
    } catch (e) {
      if (e instanceof ApiError) throw e
      // Gangguan jaringan / timeout (abort)
      lastErr = e
      if (attempt < retries) {
        await sleep(800 * (attempt + 1))
        continue
      }
      const reason =
        e instanceof DOMException && e.name === 'AbortError'
          ? 'permintaan melebihi batas waktu'
          : e instanceof Error
            ? e.message
            : 'gangguan jaringan'
      throw new ApiError(`Koneksi ke server gagal (${reason})`, 0)
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Permintaan gagal')
}

// Jalankan fn untuk tiap item dengan paralelisme terbatas
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      await fn(items[i])
    }
  })
  await Promise.all(workers)
}

// ── BACKUP ───────────────────────────────────────────────────────────────────
interface PlanResponse {
  exported_at: string
  page_size: number
  tables: { name: string; count: number }[]
  storage: { buckets: Record<string, { path: string }[]>; errors: string[] }
  warnings: string[]
}

interface FileResponse {
  skipped?: boolean
  reason?: string
  path: string
  contentType?: string
  base64?: string
}

export interface BackupResult {
  blob: Blob
  sizeBytes: number
  rowCounts: Record<string, number>
  assetCount: number
  // Info saja (mis. tabel yang tidak ada di database)
  warnings: string[]
  // Bagian yang gagal/terlewat → backup TIDAK lengkap. Ikut ditulis ke field
  // `errors` di file supaya restore menolaknya kecuali dikonfirmasi eksplisit.
  errors: string[]
}

export async function runBackup(opts: { force?: boolean; onProgress?: ProgressFn } = {}): Promise<BackupResult> {
  const report: ProgressFn = opts.onProgress ?? (() => undefined)

  report(1, 'Memeriksa sesi ujian aktif…')
  const plan = await callApi<PlanResponse>(`/api/admin/backup?mode=plan${opts.force ? '&force=1' : ''}`)

  const totalRows = plan.tables.reduce((s, t) => s + t.count, 0)
  const totalAssets = Object.values(plan.storage.buckets).reduce((s, l) => s + l.length, 0)
  const totalUnits = Math.max(1, totalRows + totalAssets * 5) // 1 file ≈ 5 baris (lebih lambat)
  let doneUnits = 0
  const tick = (units: number, detail: string) => {
    doneUnits += units
    report(Math.min(95, 2 + Math.round((doneUnits / totalUnits) * 93)), detail)
  }

  const errors: string[] = [...plan.storage.errors]
  const warnings: string[] = [...plan.warnings]
  const rowCounts: Record<string, number> = {}
  const tableChunks: Record<string, string[]> = {}

  // 1. Tabel database — halaman demi halaman
  for (const t of plan.tables) {
    const chunks: string[] = []
    let from = 0
    let got = 0
    if (t.count > 0) {
      for (;;) {
        const page = await callApi<{ rows: unknown[] }>(
          `/api/admin/backup?table=${encodeURIComponent(t.name)}&from=${from}&limit=${plan.page_size}`
        )
        if (!page.rows || page.rows.length === 0) break
        // "[{...},{...}]" → "{...},{...}" supaya bisa digabung tanpa parse ulang
        chunks.push(JSON.stringify(page.rows).slice(1, -1))
        got += page.rows.length
        from += page.rows.length
        tick(page.rows.length, `Tabel ${t.name} (${got.toLocaleString('id-ID')}/${t.count.toLocaleString('id-ID')})`)
      }
    }
    // Jumlah harus sama dengan hasil hitung di awal. Kalau tidak, data berubah
    // saat backup berjalan (atau ada halaman yang hilang) → hasilnya tidak
    // konsisten, jangan diam-diam disimpan.
    if (got !== t.count) {
      throw new Error(
        `Tabel ${t.name}: jumlah baris yang terbaca (${got}) berbeda dari yang dihitung di awal (${t.count}). ` +
          `Kemungkinan ada perubahan data selama backup berjalan. Ulangi backup.`
      )
    }
    rowCounts[t.name] = got
    tableChunks[t.name] = chunks
  }

  // 2. File storage — satu per satu (paralel terbatas)
  const bucketChunks: Record<string, string[]> = {}
  let assetCount = 0
  for (const [bucket, files] of Object.entries(plan.storage.buckets)) {
    const out: (string | null)[] = new Array(files.length).fill(null)
    await mapLimit(
      files.map((f, i) => ({ path: f.path, i })),
      4,
      async ({ path, i }) => {
        try {
          const r = await callApi<FileResponse>(
            `/api/admin/backup?bucket=${encodeURIComponent(bucket)}&file=${encodeURIComponent(path)}`
          )
          if (r.skipped || !r.base64) {
            errors.push(r.reason ?? `storage/${bucket}/${path}: dilewati`)
          } else {
            out[i] = JSON.stringify({ path: r.path, contentType: r.contentType, base64: r.base64 })
            assetCount++
          }
        } catch (e) {
          errors.push(`storage/${bucket}/${path}: ${e instanceof Error ? e.message : 'gagal diunduh'}`)
        }
        tick(5, `File ${bucket}/${path}`)
      }
    )
    bucketChunks[bucket] = out.filter((x): x is string => x !== null)
  }

  // 3. Rakit file JSON tanpa membuat satu string raksasa (pakai Blob parts)
  report(96, 'Menyusun file backup…')
  const header = {
    version: '2.0',
    app: 'SmartExam',
    exported_at: plan.exported_at,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    row_counts: { ...rowCounts, _storage_assets: assetCount },
  }
  const parts: BlobPart[] = ['{', JSON.stringify(header).slice(1, -1), ',"tables":{']
  plan.tables.forEach((t, i) => {
    if (i > 0) parts.push(',')
    parts.push(`${JSON.stringify(t.name)}:[`, tableChunks[t.name].join(','), ']')
  })
  parts.push('},"storage":{"buckets":{')
  Object.keys(bucketChunks).forEach((b, i) => {
    if (i > 0) parts.push(',')
    parts.push(`${JSON.stringify(b)}:[`, bucketChunks[b].join(','), ']')
  })
  parts.push('}}}')

  const blob = new Blob(parts, { type: 'application/json' })
  report(99, 'Backup siap diunduh')
  return { blob, sizeBytes: blob.size, rowCounts, assetCount, warnings, errors }
}

// ── PARSE FILE BACKUP ────────────────────────────────────────────────────────
export function parseBackupText(text: string): ParsedBackup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('File tidak bisa dibaca atau bukan JSON yang valid (mungkin terpotong saat diunduh)')
  }
  const obj = raw as Partial<ParsedBackup> | null
  if (!obj || typeof obj !== 'object' || !obj.tables || typeof obj.tables !== 'object') {
    throw new Error('File bukan backup SmartExam yang valid')
  }
  if (obj.app && obj.app !== 'SmartExam') {
    throw new Error('File backup bukan dari aplikasi SmartExam')
  }

  const actualCounts: Record<string, number> = {}
  for (const [name, rows] of Object.entries(obj.tables)) {
    if (!Array.isArray(rows)) {
      throw new Error(`Isi tabel "${name}" di file backup tidak valid (bukan daftar baris)`)
    }
    actualCounts[name] = rows.length
  }

  return { ...(obj as ParsedBackup), actualCounts }
}

// ── RESTORE ──────────────────────────────────────────────────────────────────
export interface RestoreResult {
  stats: Record<string, number>
  storageRestored: number
  errors: string[]
  warnings: string[]
}

function assetsOf(parsed: ParsedBackup): Record<string, AssetRec[]> {
  const out: Record<string, AssetRec[]> = {}
  if (parsed.storage?.assets && Array.isArray(parsed.storage.assets)) {
    out['assets'] = parsed.storage.assets
  }
  if (parsed.storage?.buckets && typeof parsed.storage.buckets === 'object') {
    for (const [b, list] of Object.entries(parsed.storage.buckets)) {
      if (Array.isArray(list)) out[b] = list
    }
  }
  return out
}

// Pecah baris menjadi batch: maks 500 baris DAN maks ~2,5 MB per request
// (batas body Vercel ±4,5 MB).
function* batches(rows: unknown[], maxRows = 500, maxBytes = 2_500_000): Generator<unknown[]> {
  let cur: unknown[] = []
  let bytes = 0
  for (const row of rows) {
    const size = JSON.stringify(row).length + 1
    if (cur.length > 0 && (cur.length >= maxRows || bytes + size > maxBytes)) {
      yield cur
      cur = []
      bytes = 0
    }
    cur.push(row)
    bytes += size
  }
  if (cur.length > 0) yield cur
}

export async function runRestore(
  parsed: ParsedBackup,
  opts: { force?: boolean; allowIncomplete?: boolean; onProgress?: ProgressFn } = {}
): Promise<RestoreResult> {
  const report: ProgressFn = opts.onProgress ?? (() => undefined)
  const buckets = assetsOf(parsed)

  // ── 1. START — validasi menyeluruh SEBELUM ada data yang dihapus ───────────
  report(1, 'Memverifikasi file backup…')
  const plan = await callApi<{ delete_order: string[]; insert_order: string[] }>(
    '/api/admin/restore',
    {
      method: 'POST',
      body: {
        action: 'start',
        force: !!opts.force,
        allow_incomplete: !!opts.allowIncomplete,
        meta: {
          app: parsed.app,
          version: parsed.version,
          backup_errors: parsed.errors ?? [],
          row_counts: parsed.row_counts,
          actual_counts: parsed.actualCounts,
        },
      },
    },
    { retries: 1 }
  )

  const totalRows = plan.insert_order.reduce((s, t) => s + (parsed.actualCounts[t] ?? 0), 0)
  const totalAssets = Object.values(buckets).reduce((s, l) => s + l.length, 0)
  const errors: string[] = []
  const warnings: string[] = []
  const stats: Record<string, number> = {}

  // Setelah titik ini data lama mulai dihapus. Kegagalan apa pun = fatal & harus
  // dilaporkan sebagai itu, supaya admin tahu harus memakai backup pengaman.
  const fatal = (where: string, e: unknown): never => {
    const msg = e instanceof Error ? e.message : 'error'
    throw new RestoreFatalError(
      `${where}: ${msg}. Restore DIHENTIKAN di tengah jalan — data di database sekarang campuran/tidak lengkap. ` +
        `Pulihkan dari file backup pengaman yang diunduh otomatis sebelum restore ini, atau coba ulangi restore.`
    )
  }

  // ── 2. CLEAR ───────────────────────────────────────────────────────────────
  for (let i = 0; i < plan.delete_order.length; i++) {
    const t = plan.delete_order[i]
    report(3 + Math.round(((i + 1) / plan.delete_order.length) * 12), `Mengosongkan tabel ${t}…`)
    try {
      await callApi('/api/admin/restore', { method: 'POST', body: { action: 'clear', table: t } })
    } catch (e) {
      fatal(`Gagal mengosongkan tabel ${t}`, e)
    }
  }

  // ── 3. INSERT ──────────────────────────────────────────────────────────────
  let insertedRows = 0
  for (const t of plan.insert_order) {
    const rows = (parsed.tables[t] ?? []) as unknown[]
    let inserted = 0
    for (const batch of batches(rows)) {
      try {
        const r = await callApi<{ inserted: number }>('/api/admin/restore', {
          method: 'POST',
          body: { action: 'insert', table: t, rows: batch },
        })
        inserted += r.inserted ?? batch.length
      } catch (e) {
        fatal(`Gagal memulihkan tabel ${t} (setelah ${inserted.toLocaleString('id-ID')} baris)`, e)
      }
      insertedRows += batch.length
      report(
        15 + Math.round((insertedRows / Math.max(1, totalRows)) * 70),
        `Tabel ${t} (${inserted.toLocaleString('id-ID')}/${rows.length.toLocaleString('id-ID')})`
      )
    }
    stats[t] = inserted
  }

  // ── 4. STORAGE — upload dulu, hapus sisa lama hanya kalau semua sukses ─────
  let storageRestored = 0
  let doneAssets = 0
  for (const [bucket, list] of Object.entries(buckets)) {
    // Bucket yang kosong di backup TIDAK disentuh (tidak dikosongkan).
    if (list.length === 0) continue

    try {
      await callApi('/api/admin/restore', { method: 'POST', body: { action: 'storage-init', bucket } })
    } catch (e) {
      errors.push(`storage/${bucket}: ${e instanceof Error ? e.message : 'gagal menyiapkan bucket'}`)
      doneAssets += list.length
      continue
    }

    let bucketFailed = false
    await mapLimit(list, 3, async asset => {
      try {
        if (!asset?.path || typeof asset.base64 !== 'string') throw new Error('data file tidak valid')
        await callApi('/api/admin/restore', {
          method: 'POST',
          body: { action: 'storage-put', bucket, path: asset.path, contentType: asset.contentType, base64: asset.base64 },
        })
        storageRestored++
      } catch (e) {
        bucketFailed = true
        errors.push(`storage/${bucket}/${asset?.path ?? '?'}: ${e instanceof Error ? e.message : 'gagal diunggah'}`)
      }
      doneAssets++
      report(85 + Math.round((doneAssets / Math.max(1, totalAssets)) * 12), `File ${bucket}/${asset?.path ?? ''}`)
    })

    if (bucketFailed) {
      warnings.push(`Bucket "${bucket}": ada file yang gagal diunggah, jadi file lama yang tidak ada di backup TIDAK dibersihkan.`)
    } else {
      try {
        await callApi('/api/admin/restore', {
          method: 'POST',
          body: { action: 'storage-prune', bucket, keep: list.map(a => a.path) },
        })
      } catch (e) {
        warnings.push(`Bucket "${bucket}": gagal membersihkan file lama (${e instanceof Error ? e.message : 'error'}).`)
      }
    }
  }
  stats._storage_assets = storageRestored

  // ── 5. FINISH — sinkron sequence + bersihkan cache ─────────────────────────
  report(98, 'Sinkronisasi akhir…')
  try {
    const fin = await callApi<{ warnings?: string[] }>('/api/admin/restore', {
      method: 'POST',
      body: { action: 'finish' },
    })
    warnings.push(...(fin.warnings ?? []))
  } catch (e) {
    warnings.push(
      `Sinkronisasi akhir gagal (${e instanceof Error ? e.message : 'error'}). Jalankan SELECT sinkron_sequence_setelah_restore(); di Supabase SQL Editor sebelum ujian berikutnya.`
    )
  }

  report(99, 'Selesai')
  return { stats, storageRestored, errors, warnings }
}
