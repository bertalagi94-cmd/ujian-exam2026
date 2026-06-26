'use client'
import * as XLSX from 'xlsx'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Upload, Download, Pencil, Trash2, RotateCcw, Search, FileDown } from 'lucide-react'
import { Modal, Confirm, StatusBadge, SearchInput, Pagination, EmptyState, Spinner, Toast } from '@/components/ui'
import { apiRequest, formatDate } from '@/lib/utils'
import { Siswa, Kelas } from '@/types'

const PER_PAGE = 20

export default function AdminSiswaPage() {
  const [siswa, setSiswa] = useState<Siswa[]>([])
  const [kelas, setKelas] = useState<Kelas[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterKelas, setFilterKelas] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [modalOpen, setModalOpen] = useState(false)
  const [editData, setEditData] = useState<Partial<Siswa> | null>(null)
  const [kelasMode, setKelasMode] = useState<'pilih' | 'baru'>('pilih')
  const [kelasBaruInput, setKelasBaruInput] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [resetId, setResetId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importData, setImportData] = useState<Partial<Siswa>[]>([])
  const [importing, setImporting] = useState(false)
  // SSE progress state
  const [importProgress, setImportProgress] = useState<{
    phase: 'idle' | 'running' | 'done'
    current: number
    total: number
    inserted: number
    skipped: number
    errors: string[]
    recentItems: { nis: string; nama: string; ok: boolean }[]
  }>({ phase: 'idle', current: 0, total: 0, inserted: 0, skipped: 0, errors: [], recentItems: [] })
  const importAbortRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(PER_PAGE),
        ...(search && { search }),
        ...(filterKelas && { kelas: filterKelas }),
      })
      const res = await apiRequest<{ data: Siswa[]; total: number }>(`/api/admin/siswa?${params}`)
      setSiswa(res.data)
      setTotal(res.total)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal memuat data', 'error')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [page, search, filterKelas])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    apiRequest<{ data: Kelas[] }>('/api/admin/kelas').then(r => setKelas(r.data))
  }, [])

  function openAdd() { setEditData({}); setKelasMode('pilih'); setKelasBaruInput(''); setModalOpen(true) }
  function openEdit(s: Siswa) { setEditData(s); setKelasMode('pilih'); setKelasBaruInput(''); setModalOpen(true) }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const payload = Object.fromEntries(form.entries())
    setSaving(true)
    try {
      if (editData?.nis) {
        await apiRequest(`/api/admin/siswa/${editData.nis}`, { method: 'PUT', body: JSON.stringify(payload) })
        showToast('Data siswa berhasil diperbarui')
      } else {
        await apiRequest('/api/admin/siswa', { method: 'POST', body: JSON.stringify(payload) })
        showToast('Siswa berhasil ditambahkan')
      }
      setModalOpen(false)
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    setSaving(true)
    try {
      await apiRequest(`/api/admin/siswa/${deleteId}`, { method: 'DELETE' })
      showToast('Siswa berhasil dihapus')
      setDeleteId(null)
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    if (!resetId) return
    setSaving(true)
    try {
      await apiRequest(`/api/admin/siswa/${resetId}/reset-password`, { method: 'POST' })
      showToast('Password berhasil direset ke NIS')
      setResetId(null)
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal reset', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── EXPORT ──────────────────────────────────────────────────────────────
  async function handleExport() {
    try {
      showToast('Mengekspor data siswa...')
      const params = new URLSearchParams({
        page: '1',
        per_page: '99999',
        ...(search && { search }),
        ...(filterKelas && { kelas: filterKelas }),
      })
      const res = await apiRequest<{ data: Siswa[]; total: number }>(`/api/admin/siswa?${params}`)

      const rows = res.data.map((s, i) => ({
        No: i + 1,
        NIS: s.nis,
        'Nama Siswa': s.nama,
        Kelas: s.kelas,
        'Jenis Kelamin': s.jenis_kelamin ?? '',
        'Tempat Lahir': s.tempat_lahir ?? '',
        'Tanggal Lahir': s.tanggal_lahir ? s.tanggal_lahir.slice(0, 10) : '',
        Status: s.status,
        'Last Login': s.last_login ? formatDate(s.last_login) : 'Belum pernah',
      }))

      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = [
        { wch: 5 }, { wch: 15 }, { wch: 30 }, { wch: 12 },
        { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 10 }, { wch: 20 },
      ]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Data Siswa')
      XLSX.writeFile(wb, `data-siswa-${new Date().toISOString().slice(0, 10)}.xlsx`)
      showToast(`${res.data.length} data siswa berhasil diekspor`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal ekspor', 'error')
    }
  }

  // ── DOWNLOAD TEMPLATE ───────────────────────────────────────────────────
  function handleDownloadTemplate() {
    const templateRows = [
      {
        NIS: '12345',
        'Nama Siswa': 'Contoh Nama Siswa',
        Kelas: 'X-A',
        'Jenis Kelamin': 'LAKI-LAKI',
        'Tempat Lahir': 'Manado',
        'Tanggal Lahir': '2008-01-15',
        Status: 'AKTIF',
      },
      {
        NIS: '12346',
        'Nama Siswa': 'Contoh Nama Siswi',
        Kelas: 'X-B',
        'Jenis Kelamin': 'PEREMPUAN',
        'Tempat Lahir': 'Bitung',
        'Tanggal Lahir': '2008-03-20',
        Status: 'AKTIF',
      },
    ]

    const ws = XLSX.utils.json_to_sheet(templateRows)
    ws['!cols'] = [
      { wch: 15 }, { wch: 30 }, { wch: 12 },
      { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 10 },
    ]

    XLSX.utils.sheet_add_aoa(ws, [
      [''],
      ['PETUNJUK PENGISIAN:'],
      ['- NIS: wajib diisi, unik'],
      ['- Nama Siswa: wajib diisi'],
      ['- Kelas: wajib diisi (sesuai nama kelas yang ada)'],
      ['- Jenis Kelamin: LAKI-LAKI atau PEREMPUAN'],
      ['- Tanggal Lahir: format YYYY-MM-DD'],
      ['- Status: AKTIF atau NONAKTIF (default: AKTIF)'],
      ['- Hapus baris contoh sebelum mengimpor'],
    ], { origin: `A${templateRows.length + 3}` })

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Template Import')
    XLSX.writeFile(wb, 'template-import-siswa.xlsx')
    showToast('Template berhasil diunduh')
  }

  // ── IMPORT: read file ───────────────────────────────────────────────────
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws)

        const parsed: Partial<Siswa>[] = rows
          .filter(r => r['NIS'] && r['Nama Siswa'])
          .map(r => ({
            nis: String(r['NIS']).trim(),
            nama: String(r['Nama Siswa']).trim(),
            kelas: String(r['Kelas'] ?? '').trim(),
            jenis_kelamin: r['Jenis Kelamin']
              ? String(r['Jenis Kelamin']).trim().toUpperCase()
              : undefined,
            tempat_lahir: r['Tempat Lahir'] ? String(r['Tempat Lahir']).trim() : undefined,
            tanggal_lahir: r['Tanggal Lahir'] ? String(r['Tanggal Lahir']).trim() : undefined,
            status: r['Status'] ? String(r['Status']).trim().toUpperCase() : 'AKTIF',
          }))

        if (parsed.length === 0) {
          showToast('Tidak ada data valid ditemukan. Pastikan kolom NIS dan Nama Siswa terisi.', 'error')
          return
        }

        setImportData(parsed)
        setImportOpen(true)
      } catch {
        showToast('Gagal membaca file. Pastikan format file Excel (.xlsx) sudah benar.', 'error')
      }
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  // ── IMPORT: submit via SSE streaming ───────────────────────────────────
  async function handleImportSubmit() {
    if (importData.length === 0) return
    setImporting(true)

    setImportProgress({ phase: 'running', current: 0, total: importData.length, inserted: 0, skipped: 0, errors: [], recentItems: [] })

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') ?? '' : ''

    try {
      // Step 1: POST data → dapat jobId
      const postRes = await fetch('/api/admin/siswa/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ data: importData }),
      })
      if (!postRes.ok) throw new Error('Gagal mengirim data ke server')
      const { jobId } = await postRes.json() as { jobId: string }

      // Step 2: GET SSE stream
      const abortCtrl = new AbortController()
      importAbortRef.current = abortCtrl

      const sseRes = await fetch(`/api/admin/siswa/import?jobId=${jobId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: abortCtrl.signal,
      })
      if (!sseRes.ok || !sseRes.body) throw new Error('Gagal membuka stream')

      const reader = sseRes.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6)) as {
              type: string
              current?: number
              total?: number
              nis?: string
              nama?: string
              ok?: boolean
              inserted?: number
              skipped?: number
              errors?: string[]
            }

            if (evt.type === 'progress') {
              setImportProgress(prev => ({
                ...prev,
                current: evt.current ?? prev.current,
                recentItems: [
                  { nis: evt.nis ?? '', nama: evt.nama ?? '', ok: evt.ok ?? true },
                  ...prev.recentItems,
                ].slice(0, 8),
              }))
            } else if (evt.type === 'done') {
              setImportProgress(prev => ({
                ...prev,
                phase: 'done',
                inserted: evt.inserted ?? 0,
                skipped: evt.skipped ?? 0,
                errors: evt.errors ?? [],
              }))
              showToast(`Import selesai: ${evt.inserted} berhasil, ${evt.skipped} dilewati`)
              load()
            }
          } catch { /* skip malformed event */ }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      showToast(err instanceof Error ? err.message : 'Gagal import', 'error')
      setImportProgress(prev => ({ ...prev, phase: 'idle' }))
    } finally {
      setImporting(false)
    }
  }

  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Data Siswa</h1>
          <p className="page-subtitle">{total} siswa terdaftar</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleDownloadTemplate}
            className="btn-secondary btn-sm"
            title="Unduh template Excel untuk import"
          >
            <FileDown className="w-4 h-4" /> Template
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn-secondary btn-sm"
          >
            <Upload className="w-4 h-4" /> Import
          </button>
          <button onClick={handleExport} className="btn-secondary btn-sm">
            <Download className="w-4 h-4" /> Export
          </button>
          <button onClick={openAdd} className="btn-primary btn-sm">
            <Plus className="w-4 h-4" /> Tambah Siswa
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card py-4 flex gap-3 flex-wrap">
        <SearchInput
          value={search}
          onChange={v => { setSearch(v); setPage(1) }}
          placeholder="Cari nama atau NIS..."
          className="flex-1 min-w-[200px]"
        />
        <select
          value={filterKelas}
          onChange={e => { setFilterKelas(e.target.value); setPage(1) }}
          className="select w-full sm:w-40"
        >
          <option value="">Semua Kelas</option>
          {kelas.map(k => (
            <option key={k.id} value={k.nama}>{k.nama}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="table-wrapper">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Spinner size="lg" />
            </div>
          ) : siswa.length === 0 ? (
            <EmptyState message="Tidak ada siswa ditemukan" icon={Search} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>NIS</th>
                  <th>Nama Siswa</th>
                  <th>Kelas</th>
                  <th>Jenis Kelamin</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {siswa.map((s, i) => (
                  <tr key={s.nis}>
                    <td className="text-slate-400 text-xs">{(page - 1) * PER_PAGE + i + 1}</td>
                    <td className="font-mono text-xs text-slate-600">{s.nis}</td>
                    <td>
                      <div className="font-medium text-slate-800">{s.nama}</div>
                      {s.tempat_lahir && (
                        <div className="text-xs text-slate-400">{s.tempat_lahir}</div>
                      )}
                    </td>
                    <td>
                      <span className="badge-blue">{s.kelas}</span>
                    </td>
                    <td className="text-slate-600 text-xs">{s.jenis_kelamin ?? '-'}</td>
                    <td><StatusBadge status={s.status} /></td>
                    <td className="text-xs text-slate-400">{s.last_login ? formatDate(s.last_login) : 'Belum pernah'}</td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(s)}
                          className="btn-ghost btn-icon btn-sm text-blue-600 hover:bg-blue-50"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setResetId(s.nis)}
                          className="btn-ghost btn-icon btn-sm text-amber-600 hover:bg-amber-50"
                          title="Reset Password"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteId(s.nis)}
                          className="btn-ghost btn-icon btn-sm text-red-600 hover:bg-red-50"
                          title="Hapus"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-4 py-2 border-t border-slate-100">
          <Pagination page={page} totalPages={totalPages} onPage={setPage} total={total} perPage={PER_PAGE} />
        </div>
      </div>

      {/* Modal Form Tambah/Edit */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editData?.nis ? 'Edit Data Siswa' : 'Tambah Siswa Baru'}
        footer={
          <>
            <button onClick={() => setModalOpen(false)} className="btn-secondary" disabled={saving}>Batal</button>
            <button form="siswa-form" type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : (editData?.nis ? 'Simpan Perubahan' : 'Tambah Siswa')}
            </button>
          </>
        }
      >
        <form id="siswa-form" onSubmit={handleSave} className="space-y-4">
          {!editData?.nis && (
            <div>
              <label className="label">NIS *</label>
              <input name="nis" className="input" placeholder="Nomor Induk Siswa" required defaultValue={editData?.nis} />
            </div>
          )}
          <div>
            <label className="label">Nama Lengkap *</label>
            <input name="nama" className="input" placeholder="Nama lengkap siswa" required defaultValue={editData?.nama} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Kelas *</label>
              {kelasMode === 'pilih' ? (
                <div className="space-y-1.5">
                  <select
                    name="kelas"
                    className="select"
                    required={kelasMode === 'pilih'}
                    defaultValue={editData?.kelas ?? ''}
                  >
                    <option value="">-- Pilih Kelas --</option>
                    {kelas.map(k => (
                      <option key={k.id} value={k.nama}>{k.nama}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="text-xs text-brand-600 hover:underline"
                    onClick={() => { setKelasMode('baru'); setKelasBaruInput('') }}
                  >
                    + Tambah kelas baru
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <input
                    name="kelas"
                    className="input"
                    placeholder="Contoh: X-C, XI IPA 2"
                    required
                    autoFocus
                    value={kelasBaruInput}
                    onChange={e => setKelasBaruInput(e.target.value)}
                  />
                  <button
                    type="button"
                    className="text-xs text-slate-500 hover:underline"
                    onClick={() => setKelasMode('pilih')}
                  >
                    ← Pilih dari daftar
                  </button>
                </div>
              )}
            </div>
            <div>
              <label className="label">Jenis Kelamin</label>
              <select name="jenis_kelamin" className="select" defaultValue={editData?.jenis_kelamin ?? ''}>
                <option value="">Pilih</option>
                <option value="LAKI-LAKI">Laki-laki</option>
                <option value="PEREMPUAN">Perempuan</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Tempat Lahir</label>
              <input name="tempat_lahir" className="input" defaultValue={editData?.tempat_lahir ?? ''} />
            </div>
            <div>
              <label className="label">Tanggal Lahir</label>
              <input name="tanggal_lahir" type="date" className="input" defaultValue={editData?.tanggal_lahir?.slice(0, 10) ?? ''} />
            </div>
          </div>
          <div>
            <label className="label">Status</label>
            <select name="status" className="select" defaultValue={editData?.status ?? 'AKTIF'}>
              <option value="AKTIF">Aktif</option>
              <option value="NONAKTIF">Nonaktif</option>
            </select>
          </div>
          {!editData?.nis && (
            <div className="alert-info text-xs">
              Password default: NIS siswa. Siswa dapat menggantinya setelah login pertama.
            </div>
          )}
        </form>
      </Modal>

      {/* Modal Preview Import */}
      <Modal
        open={importOpen}
        onClose={() => {
          if (importing) return // jangan tutup saat proses berlangsung
          setImportOpen(false)
          setImportData([])
          setImportProgress({ phase: 'idle', current: 0, total: 0, inserted: 0, skipped: 0, errors: [], recentItems: [] })
        }}
        title={
          importProgress.phase === 'idle'
            ? `Preview Import Siswa (${importData.length} data)`
            : importProgress.phase === 'running'
            ? '⚡ Sedang Mengimpor Siswa...'
            : '✅ Import Selesai!'
        }
        footer={
          importProgress.phase === 'idle' ? (
            <>
              <button
                onClick={() => { setImportOpen(false); setImportData([]) }}
                className="btn-secondary"
              >
                Batal
              </button>
              <button onClick={handleImportSubmit} className="btn-primary">
                Import {importData.length} Siswa
              </button>
            </>
          ) : importProgress.phase === 'done' ? (
            <button
              onClick={() => {
                setImportOpen(false)
                setImportData([])
                setImportProgress({ phase: 'idle', current: 0, total: 0, inserted: 0, skipped: 0, errors: [], recentItems: [] })
              }}
              className="btn-primary"
            >
              Tutup
            </button>
          ) : null
        }
      >
        {/* ── PHASE: PREVIEW ── */}
        {importProgress.phase === 'idle' && (
          <div className="space-y-3">
            <div className="alert-info text-xs">
              Periksa data berikut sebelum mengimpor. Siswa dengan NIS yang sudah ada akan diperbarui (upsert).
            </div>
            <div className="max-h-80 overflow-y-auto">
              <table className="table text-xs w-full">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>NIS</th>
                    <th>Nama</th>
                    <th>Kelas</th>
                    <th>JK</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {importData.map((s, i) => (
                    <tr key={i}>
                      <td className="text-slate-400">{i + 1}</td>
                      <td className="font-mono">{s.nis}</td>
                      <td>{s.nama}</td>
                      <td>{s.kelas}</td>
                      <td>{s.jenis_kelamin === 'LAKI-LAKI' ? 'L' : s.jenis_kelamin === 'PEREMPUAN' ? 'P' : '-'}</td>
                      <td>{s.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── PHASE: RUNNING ── */}
        {importProgress.phase === 'running' && (
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <div className="flex justify-between text-sm font-medium text-slate-700">
                <span>Memproses siswa...</span>
                <span className="tabular-nums text-brand-600">
                  {importProgress.current} / {importProgress.total}
                </span>
              </div>
              <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                <div
                  className="h-full rounded-full transition-all duration-300 ease-out"
                  style={{
                    width: `${importProgress.total > 0 ? Math.round((importProgress.current / importProgress.total) * 100) : 0}%`,
                    background: 'linear-gradient(90deg, #6366f1 0%, #8b5cf6 50%, #06b6d4 100%)',
                    boxShadow: '0 0 12px rgba(99,102,241,0.5)',
                  }}
                />
              </div>
              <div className="text-center text-xs text-slate-500">
                {importProgress.total > 0
                  ? `${Math.round((importProgress.current / importProgress.total) * 100)}% selesai`
                  : 'Memulai...'}
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Siswa Terbaru</p>
              <div className="space-y-1 max-h-52 overflow-hidden">
                {importProgress.recentItems.map((item, i) => (
                  <div
                    key={`${item.nis}-${i}`}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm"
                    style={{
                      opacity: 1 - i * 0.12,
                      background: i === 0
                        ? item.ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)'
                        : 'rgba(148,163,184,0.05)',
                      border: i === 0
                        ? `1px solid ${item.ok ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`
                        : '1px solid transparent',
                      transition: 'all 0.3s ease',
                    }}
                  >
                    <span className={`text-base ${i === 0 ? (item.ok ? 'text-emerald-500' : 'text-red-500') : 'text-slate-300'}`}>
                      {item.ok ? '✓' : '✗'}
                    </span>
                    <span className={`font-mono text-xs ${i === 0 ? 'text-slate-600' : 'text-slate-400'}`}>
                      {item.nis}
                    </span>
                    <span className={`flex-1 truncate ${i === 0 ? 'text-slate-700 font-medium' : 'text-slate-400'}`}>
                      {item.nama}
                    </span>
                    {i === 0 && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${item.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {item.ok ? 'OK' : 'Skip'}
                      </span>
                    )}
                  </div>
                ))}
                {importProgress.recentItems.length === 0 && (
                  <div className="text-center py-6 text-slate-400 text-sm">
                    <Spinner size="sm" /> Menyiapkan data...
                  </div>
                )}
              </div>
            </div>

            <p className="text-xs text-center text-slate-400 animate-pulse">
              Mohon tunggu, jangan tutup halaman ini...
            </p>
          </div>
        )}

        {/* ── PHASE: DONE ── */}
        {importProgress.phase === 'done' && (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
                <p className="text-3xl font-bold text-emerald-600">{importProgress.inserted.toLocaleString('id')}</p>
                <p className="text-sm text-emerald-700 mt-1">Siswa berhasil diimpor</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                <p className="text-3xl font-bold text-amber-600">{importProgress.skipped.toLocaleString('id')}</p>
                <p className="text-sm text-amber-700 mt-1">Dilewati / error</p>
              </div>
            </div>

            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: '100%',
                  background: 'linear-gradient(90deg, #10b981 0%, #06b6d4 100%)',
                }}
              />
            </div>

            {importProgress.errors.length > 0 && (
              <details className="text-xs">
                <summary className="text-red-600 cursor-pointer font-medium">
                  {importProgress.errors.length} error — klik untuk lihat
                </summary>
                <ul className="mt-2 space-y-1 bg-red-50 rounded-lg p-3 max-h-32 overflow-y-auto">
                  {importProgress.errors.map((e, i) => (
                    <li key={i} className="text-red-600">• {e}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </Modal>

      {/* Confirm Delete */}
      <Confirm
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Hapus Siswa"
        message="Apakah Anda yakin ingin menghapus siswa ini? Data nilai dan jawaban juga akan ikut terhapus."
        confirmLabel="Ya, Hapus"
        loading={saving}
      />

      {/* Confirm Reset */}
      <Confirm
        open={!!resetId}
        onClose={() => setResetId(null)}
        onConfirm={handleReset}
        title="Reset Password"
        message="Password siswa akan direset ke NIS-nya. Lanjutkan?"
        confirmLabel="Reset Password"
        variant="primary"
        loading={saving}
      />
    </div>
  )
}
