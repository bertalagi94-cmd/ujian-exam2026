'use client'

import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import {
  Upload, CheckCircle, XCircle, AlertCircle,
  FileSpreadsheet, ChevronRight, Loader2, Info
} from 'lucide-react'
import { apiRequest } from '@/lib/utils'

// ─── Konfigurasi sheet yang bisa diimport ───────────────────────────────────
const IMPORT_STEPS = [
  {
    tabel: 'kelas',
    label: 'Kelas',
    sheet: 'KELAS',
    desc: 'Data kelas (KLS_xxx)',
    requiredCols: ['ID', 'Nama'],
  },
  {
    tabel: 'mapel',
    label: 'Mata Pelajaran',
    sheet: 'MAPEL',
    desc: 'Data mata pelajaran (MPL_xxx)',
    requiredCols: ['ID', 'Nama'],
  },
  {
    tabel: 'users',
    label: 'Guru & Staff',
    sheet: 'USERS',
    desc: 'Akun guru, pengawas, kepala sekolah',
    requiredCols: ['Username', 'Password', 'Nama'],
  },
  {
    tabel: 'siswa',
    label: 'Siswa',
    sheet: 'SISWA',
    desc: 'Data siswa beserta password',
    requiredCols: ['NIS', 'Nama', 'Kelas', 'Password'],
  },
  {
    tabel: 'kelas_mapel',
    label: 'Kelas-Mapel',
    sheet: 'KELAS_MAPEL',
    desc: 'Relasi kelas dan mata pelajaran',
    requiredCols: ['ID'],
  },
  {
    tabel: 'jadwal',
    label: 'Jadwal Ujian',
    sheet: 'JADWAL',
    desc: 'Jadwal ujian per kelas dan mapel',
    requiredCols: ['ID'],
  },
  {
    tabel: 'paket_soal',
    label: 'Paket Soal',
    sheet: 'PAKET_SOAL',
    desc: 'Paket soal per mapel dan kelas',
    requiredCols: ['ID'],
  },
  {
    tabel: 'soal',
    label: 'Soal',
    sheet: 'SOAL',
    desc: 'Bank soal (bisa berjumlah banyak, harap bersabar)',
    requiredCols: ['ID', 'Teks'],
  },
]

type StepStatus = 'idle' | 'ready' | 'loading' | 'success' | 'error' | 'skipped'

interface StepResult {
  status: StepStatus
  inserted?: number
  skipped?: number
  errors?: string[]
  rowCount?: number
  message?: string
}

export default function ImportPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [fileName, setFileName] = useState('')
  const [sheetMap, setSheetMap] = useState<Record<string, Record<string, unknown>[]>>({})
  const [results, setResults] = useState<Record<string, StepResult>>({})
  const [importing, setImporting] = useState(false)
  const [globalError, setGlobalError] = useState('')

  // ─── Baca file xlsx ─────────────────────────────────────────────────────
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setResults({})
    setGlobalError('')

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        setWorkbook(wb)

        // Parse semua sheet yang dibutuhkan
        const map: Record<string, Record<string, unknown>[]> = {}
        for (const step of IMPORT_STEPS) {
          if (wb.SheetNames.includes(step.sheet)) {
            const ws = wb.Sheets[step.sheet]
            const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
              defval: null,
              raw: true,
            })
            map[step.tabel] = rows
          }
        }
        setSheetMap(map)

        // Set status awal tiap step
        const init: Record<string, StepResult> = {}
        for (const step of IMPORT_STEPS) {
          const rows = map[step.tabel]
          if (!rows) {
            init[step.tabel] = { status: 'skipped', message: 'Sheet tidak ditemukan di file' }
          } else if (rows.length === 0) {
            init[step.tabel] = { status: 'skipped', message: 'Sheet kosong' }
          } else {
            init[step.tabel] = { status: 'ready', rowCount: rows.length }
          }
        }
        setResults(init)
      } catch {
        setGlobalError('File tidak dapat dibaca. Pastikan file berformat .xlsx dari Google Sheets.')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  // ─── Import semua tabel berurutan ────────────────────────────────────────
  async function handleImportAll() {
    if (!workbook) return
    setImporting(true)
    setGlobalError('')

    for (const step of IMPORT_STEPS) {
      const rows = sheetMap[step.tabel]
      if (!rows || rows.length === 0) continue

      setResults(prev => ({ ...prev, [step.tabel]: { ...prev[step.tabel], status: 'loading' } }))

      // Import dalam batch 200 baris agar tidak timeout
      const BATCH = 200
      let totalInserted = 0
      let totalSkipped = 0
      const allErrors: string[] = []

      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH)
        try {
          const res = await apiRequest<{
            inserted: number; skipped: number; errors: string[]
          }>('/api/admin/import', {
            method: 'POST',
            body: JSON.stringify({ tabel: step.tabel, rows: batch }),
          })
          totalInserted += res.inserted
          totalSkipped += res.skipped
          allErrors.push(...(res.errors ?? []))
        } catch (err) {
          allErrors.push(err instanceof Error ? err.message : 'Error tidak diketahui')
          break
        }
      }

      setResults(prev => ({
        ...prev,
        [step.tabel]: {
          status: allErrors.length > 0 && totalInserted === 0 ? 'error' : 'success',
          inserted: totalInserted,
          skipped: totalSkipped,
          errors: allErrors,
          rowCount: rows.length,
        },
      }))
    }

    setImporting(false)
  }

  // ─── Import satu tabel saja ───────────────────────────────────────────────
  async function handleImportOne(tabel: string) {
    const rows = sheetMap[tabel]
    if (!rows || rows.length === 0) return
    setImporting(true)

    setResults(prev => ({ ...prev, [tabel]: { ...prev[tabel], status: 'loading' } }))

    const BATCH = 200
    let totalInserted = 0
    let totalSkipped = 0
    const allErrors: string[] = []

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      try {
        const res = await apiRequest<{
          inserted: number; skipped: number; errors: string[]
        }>('/api/admin/import', {
          method: 'POST',
          body: JSON.stringify({ tabel, rows: batch }),
        })
        totalInserted += res.inserted
        totalSkipped += res.skipped
        allErrors.push(...(res.errors ?? []))
      } catch (err) {
        allErrors.push(err instanceof Error ? err.message : 'Error tidak diketahui')
        break
      }
    }

    setResults(prev => ({
      ...prev,
      [tabel]: {
        status: allErrors.length > 0 && totalInserted === 0 ? 'error' : 'success',
        inserted: totalInserted,
        skipped: totalSkipped,
        errors: allErrors,
        rowCount: rows.length,
      },
    }))
    setImporting(false)
  }

  const hasFile = !!workbook
  const readyCount = Object.values(results).filter(r => r.status === 'ready').length
  const doneCount = Object.values(results).filter(r => r.status === 'success').length

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Import Data dari Google Sheets</h1>
        <p className="text-slate-500 text-sm mt-1">
          Upload file export (.xlsx) dari aplikasi GAS lama. Data akan dimasukkan ke database baru.
        </p>
      </div>

      {/* Instruksi */}
      <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 flex gap-3">
        <Info className="w-5 h-5 text-brand-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-brand-800 space-y-1">
          <p className="font-semibold">Cara mendapatkan file export:</p>
          <ol className="list-decimal list-inside space-y-0.5 text-brand-700">
            <li>Buka Google Spreadsheet aplikasi GAS lama</li>
            <li>Klik <strong>File → Download → Microsoft Excel (.xlsx)</strong></li>
            <li>Upload file tersebut di sini</li>
          </ol>
          <p className="text-brand-600 mt-2">
            ⚠️ Import harus dilakukan berurutan: Kelas → Mapel → Guru → Siswa → dst.
            Gunakan tombol <strong>Import Semua</strong> untuk otomatis.
          </p>
        </div>
      </div>

      {/* Upload area */}
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
          ${hasFile ? 'border-brand-400 bg-brand-50' : 'border-slate-300 hover:border-brand-400 hover:bg-slate-50'}`}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={handleFile}
        />
        <FileSpreadsheet className={`w-10 h-10 mx-auto mb-3 ${hasFile ? 'text-brand-500' : 'text-slate-400'}`} />
        {hasFile ? (
          <div>
            <p className="font-semibold text-brand-700">{fileName}</p>
            <p className="text-sm text-brand-500 mt-1">
              {readyCount} sheet siap diimport · Klik untuk ganti file
            </p>
          </div>
        ) : (
          <div>
            <p className="font-semibold text-slate-700">Klik untuk upload file .xlsx</p>
            <p className="text-sm text-slate-400 mt-1">File export dari Google Sheets</p>
          </div>
        )}
      </div>

      {globalError && (
        <div className="flex gap-2 items-start bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{globalError}</span>
        </div>
      )}

      {/* Tabel steps */}
      {hasFile && (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
          {IMPORT_STEPS.map((step, idx) => {
            const result = results[step.tabel]
            const status = result?.status ?? 'idle'

            return (
              <div key={step.tabel} className="p-4 flex items-start gap-4">
                {/* Nomor */}
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5
                  ${status === 'success' ? 'bg-green-100 text-green-700' :
                    status === 'error' ? 'bg-red-100 text-red-700' :
                    status === 'loading' ? 'bg-brand-100 text-brand-700' :
                    status === 'skipped' ? 'bg-slate-100 text-slate-400' :
                    'bg-slate-100 text-slate-500'}`}>
                  {status === 'success' ? <CheckCircle className="w-4 h-4" /> :
                   status === 'error' ? <XCircle className="w-4 h-4" /> :
                   status === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> :
                   idx + 1}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-800">{step.label}</span>
                    <span className="text-xs text-slate-400 font-mono">{step.sheet}</span>
                    {status === 'ready' && result?.rowCount && (
                      <span className="text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full">
                        {result.rowCount.toLocaleString()} baris
                      </span>
                    )}
                    {status === 'skipped' && (
                      <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                        Dilewati
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{step.desc}</p>

                  {/* Hasil */}
                  {status === 'success' && (
                    <div className="mt-1.5 flex gap-3 text-xs">
                      <span className="text-green-600 font-medium">✓ {result.inserted?.toLocaleString()} berhasil</span>
                      {(result.skipped ?? 0) > 0 && (
                        <span className="text-amber-600">{result.skipped?.toLocaleString()} dilewati</span>
                      )}
                    </div>
                  )}
                  {status === 'skipped' && (
                    <p className="text-xs text-slate-400 mt-1">{result?.message}</p>
                  )}
                  {(result?.errors?.length ?? 0) > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs text-red-600 cursor-pointer">
                        {result?.errors?.length} error — klik untuk lihat detail
                      </summary>
                      <ul className="mt-1 text-xs text-red-500 space-y-0.5 max-h-32 overflow-y-auto bg-red-50 rounded p-2">
                        {result?.errors?.map((e, i) => <li key={i}>• {e}</li>)}
                      </ul>
                    </details>
                  )}
                </div>

                {/* Tombol import satu */}
                {(status === 'ready' || status === 'error') && (
                  <button
                    onClick={() => handleImportOne(step.tabel)}
                    disabled={importing}
                    className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800 
                               border border-brand-200 hover:border-brand-400 rounded-lg px-3 py-1.5
                               disabled:opacity-40 flex-shrink-0 transition-colors"
                  >
                    Import
                    <ChevronRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Tombol Import Semua */}
      {hasFile && readyCount > 0 && (
        <div className="flex justify-end gap-3">
          <div className="flex-1 text-sm text-slate-500 flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-amber-500" />
            Pastikan tidak ada ujian yang sedang berjalan saat import.
          </div>
          <button
            onClick={handleImportAll}
            disabled={importing}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white 
                       font-semibold px-5 py-2.5 rounded-xl disabled:opacity-50 transition-colors"
          >
            {importing ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Mengimpor...</>
            ) : (
              <><Upload className="w-4 h-4" /> Import Semua ({readyCount} tabel)</>
            )}
          </button>
        </div>
      )}

      {/* Ringkasan selesai */}
      {doneCount > 0 && !importing && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-green-800">Import selesai!</p>
            <p className="text-sm text-green-700 mt-0.5">
              {doneCount} tabel berhasil diproses. Silakan cek halaman Data Siswa, Guru, dan Jadwal untuk verifikasi.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
