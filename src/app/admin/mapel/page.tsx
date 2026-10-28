'use client'

import type * as XLSXType from 'xlsx'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Pencil, Trash2, BookOpen, Search, Upload, Download } from 'lucide-react'
import { Modal, Confirm, EmptyState, Spinner, Toast, SearchInput } from '@/components/ui'
import { apiRequest } from '@/lib/utils'
import { Mapel, User, Kelas } from '@/types'

interface ImportMapelRow {
  nama: string
  guru: string
  kelas: string
  kkm: string
}
interface ImportResult {
  inserted: number
  skipped: number
  errors: string[]
  warnings: string[]
}

// Judul kolom template impor. Dipakai bersama oleh pembuat template dan
// pembaca file, supaya keduanya tidak bisa saling tidak cocok.
const IMPORT_COLS = {
  nama: 'Nama Mata Pelajaran',
  guru: 'Username Guru',
  kelas: 'Kelas',
  kkm: 'KKM',
} as const
const IMPORT_MAX_ROWS = 200
// Baris contoh di template diawali penanda ini dan otomatis diabaikan saat impor.
const PENANDA_CONTOH = '(contoh)'

export default function AdminMapelPage() {
  const [mapel, setMapel] = useState<Mapel[]>([])
  const [sekolahList, setSekolahList] = useState<import('@/types').Sekolah[]>([])
  const [kelasSekolahMap, setKelasSekolahMap] = useState<Record<string, string>>({}) // nama kelas → label sekolah
  const [users, setUsers] = useState<User[]>([])
  const [kelas, setKelas] = useState<Kelas[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editData, setEditData] = useState<Partial<Mapel> | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  // kelas_list checkboxes state
  const [selectedKelas, setSelectedKelas] = useState<string[]>([])
  // Impor mapel dari Excel
  const [importOpen, setImportOpen] = useState(false)
  const [importRows, setImportRows] = useState<ImportMapelRow[]>([])
  const [importFileName, setImportFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const importFileRef = useRef<HTMLInputElement>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ data: Mapel[] }>('/api/admin/mapel')
      setMapel(res.data)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal memuat data', 'error')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    apiRequest<{ data: User[] }>('/api/admin/users?all=true')
      .then(r => setUsers(r.data.filter(u => u.role === 'GURU')))
      .catch(() => {})
    apiRequest<{ data: import('@/types').Kelas[] }>('/api/admin/kelas?all=true')
      .then(r => {
        setKelas(r.data)
        const map: Record<string, string> = {}
        for (const k of r.data) {
          if (k.nama && k.sekolah?.label) map[k.nama] = k.sekolah.label
        }
        setKelasSekolahMap(map)
      })
      .catch(() => {})
  }, [])

  function openAdd() {
    setEditData({})
    setSelectedKelas([])
    setModalOpen(true)
  }

  function openEdit(m: Mapel) {
    setEditData(m)
    setSelectedKelas(m.kelas_list ? m.kelas_list.split(',').map(s => s.trim()).filter(Boolean) : [])
    setModalOpen(true)
  }

  function toggleKelas(nama: string) {
    setSelectedKelas(prev =>
      prev.includes(nama) ? prev.filter(k => k !== nama) : [...prev, nama]
    )
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const payload: Record<string, unknown> = Object.fromEntries(form.entries())
    payload.kkm = Number(payload.kkm) || 75
    payload.kelas_list = selectedKelas.join(',')

    setSaving(true)
    try {
      if (editData?.id) {
        await apiRequest('/api/admin/mapel', { method: 'PUT', body: JSON.stringify({ id: editData.id, ...payload }) })
        showToast('Mata pelajaran berhasil diperbarui')
      } else {
        await apiRequest('/api/admin/mapel', { method: 'POST', body: JSON.stringify(payload) })
        showToast('Mata pelajaran berhasil ditambahkan')
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
      await apiRequest('/api/admin/mapel', { method: 'DELETE', body: JSON.stringify({ id: deleteId }) })
      showToast('Mata pelajaran berhasil dihapus')
      setDeleteId(null)
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── IMPOR MAPEL ────────────────────────────────────────────────────────
  function openImport() {
    setImportRows([])
    setImportFileName('')
    setImportResult(null)
    setImportOpen(true)
  }

  function closeImport() {
    if (importing) return
    setImportOpen(false)
    if (importResult && importResult.inserted > 0) load()
  }

  async function handleDownloadTemplate() {
    const XLSX = await import('xlsx')
    const C = IMPORT_COLS
    const header = [C.nama, C.guru, C.kelas, C.kkm]
    const contohGuru = users[0]?.username ?? 'username_guru'
    const contohKelas = kelas.slice(0, 2).map(k => String(k.nama)).join(', ') || '10, 11'
    const contoh = [
      [`${PENANDA_CONTOH} MATEMATIKA`, contohGuru, contohKelas, 75],
      [`${PENANDA_CONTOH} SENI BUDAYA`, '', '', ''],
    ]
    const ws = XLSX.utils.aoa_to_sheet([header, ...contoh])
    // Kolom Nama, Username Guru, dan Kelas bertipe TEKS supaya nilai seperti
    // "07" atau "10" tidak diubah Excel menjadi angka. KKM tetap angka.
    // Baris kosong sampai batas impor diformat teks.
    const kolomTeks = [0, 1, 2]
    for (let r = contoh.length + 1; r <= IMPORT_MAX_ROWS; r++) {
      for (const c of kolomTeks) {
        ws[XLSX.utils.encode_cell({ r, c })] = { t: 's', v: '', z: '@' }
      }
    }
    for (let r = 1; r <= contoh.length; r++) {
      for (const c of kolomTeks) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })]
        if (cell) cell.z = '@'
      }
    }
    ws['!ref'] = XLSX.utils.encode_range({ r: 0, c: 0 }, { r: IMPORT_MAX_ROWS, c: header.length - 1 })
    ws['!cols'] = [{ wch: 32 }, { wch: 22 }, { wch: 28 }, { wch: 8 }]

    const petunjuk = XLSX.utils.aoa_to_sheet([
      ['PETUNJUK PENGISIAN'],
      [''],
      ['Isi data pada sheet "Template Mapel" (baris 1 adalah judul kolom, jangan diubah).'],
      [`${C.nama}: wajib. Otomatis disimpan HURUF BESAR.`],
      [`${C.guru}: opsional. Isi username guru (lihat sheet "Daftar Guru"). Kosong = guru belum ditentukan.`],
      [`${C.kelas}: opsional. Isi nama kelas persis seperti di sheet "Daftar Kelas". Beberapa kelas dipisah koma, contoh: 10, 11.`],
      [`${C.kkm}: opsional, bilangan bulat 0 sampai 100. Kosong = 75.`],
      [''],
      ['ATURAN'],
      ['Mapel dengan nama dan guru yang sama tidak boleh ditulis dua kali. Gabungkan kelasnya dalam satu baris.'],
      ['Mapel bernama sama tidak boleh diampu guru berbeda pada kelas yang sama (mis. KIMIA kelas 12 hanya boleh satu guru).'],
      ['Mapel yang sudah ada di sistem dilewati dan tidak ditimpa. Untuk mengubahnya, pakai tombol Edit.'],
      ['Jumlah opsi jawaban diatur di Pengaturan > Pengaturan Ujian, bukan di file ini.'],
      [''],
      [`Baris contoh (nama diawali "${PENANDA_CONTOH}") otomatis diabaikan saat impor.`],
      [`Maksimal ${IMPORT_MAX_ROWS} baris per file.`],
    ])
    petunjuk['!cols'] = [{ wch: 115 }]

    const daftarGuru = XLSX.utils.aoa_to_sheet([
      ['Username (isi ke kolom Username Guru)', 'Nama Guru'],
      ...users.map(u => [u.username, u.nama]),
    ])
    daftarGuru['!cols'] = [{ wch: 38 }, { wch: 36 }]

    const daftarKelas = XLSX.utils.aoa_to_sheet([
      ['Kelas (isi ke kolom Kelas)', 'Sekolah'],
      ...kelas.map(k => [String(k.nama), k.sekolah?.label ?? '']),
    ])
    daftarKelas['!cols'] = [{ wch: 28 }, { wch: 24 }]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Template Mapel')
    XLSX.utils.book_append_sheet(wb, petunjuk, 'Petunjuk')
    XLSX.utils.book_append_sheet(wb, daftarGuru, 'Daftar Guru')
    XLSX.utils.book_append_sheet(wb, daftarKelas, 'Daftar Kelas')
    XLSX.writeFile(wb, 'template-import-mapel.xlsx')
    showToast('Template berhasil diunduh')
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // izinkan memilih file yang sama lagi
    if (!file) return
    setImportResult(null)
    try {
      const XLSX: typeof XLSXType = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
      const C = IMPORT_COLS
      const str = (v: unknown) => String(v ?? '').trim()
      const parsed: ImportMapelRow[] = raw
        .map(r => ({
          nama: str(r[C.nama]),
          guru: str(r[C.guru]),
          kelas: str(r[C.kelas]),
          kkm: str(r[C.kkm]),
        }))
        // Lewati baris kosong dan baris contoh bawaan template.
        .filter(r => (r.nama || r.guru || r.kelas || r.kkm) && !r.nama.toLowerCase().startsWith(PENANDA_CONTOH))

      if (parsed.length === 0) {
        showToast('Tidak ada data ditemukan. Pastikan memakai template dan kolom Nama Mata Pelajaran terisi.', 'error')
        return
      }
      if (parsed.length > IMPORT_MAX_ROWS) {
        showToast(`Maksimal ${IMPORT_MAX_ROWS} baris per impor (file berisi ${parsed.length}).`, 'error')
        return
      }
      setImportRows(parsed)
      setImportFileName(file.name)
    } catch {
      showToast('Gagal membaca file. Pastikan formatnya Excel (.xlsx).', 'error')
    }
  }

  async function handleImportSubmit() {
    if (importRows.length === 0) return
    setImporting(true)
    try {
      const res = await apiRequest<ImportResult>('/api/admin/mapel/import', {
        method: 'POST',
        body: JSON.stringify({ data: importRows }),
      })
      setImportResult(res)
      setImportRows([])
      setImportFileName('')
      if (res.inserted > 0) {
        showToast(`Impor selesai: ${res.inserted} mata pelajaran ditambahkan${res.skipped ? `, ${res.skipped} dilewati` : ''}`)
        load()
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal impor', 'error')
    } finally { setImporting(false) }
  }

  const filtered = mapel.filter(m =>
    !search || m.nama.toLowerCase().includes(search.toLowerCase()) ||
    (m.nama_guru ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Mata Pelajaran</h1>
          <p className="page-subtitle">{mapel.length} mata pelajaran terdaftar</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openImport} className="btn-secondary btn-sm">
            <Upload className="w-4 h-4" /> Impor
          </button>
          <button onClick={openAdd} className="btn-primary btn-sm">
            <Plus className="w-4 h-4" /> Tambah Mapel
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="card py-4">
        <SearchInput
          value={search}
          onChange={v => setSearch(v)}
          placeholder="Cari nama mapel atau guru..."
          className="max-w-sm"
        />
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="table-wrapper">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Spinner size="lg" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState message="Tidak ada mata pelajaran ditemukan" icon={search ? Search : BookOpen} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nama Mapel</th>
                  <th>Guru Pengampu</th>
                  <th>Kelas</th>
                  <th>KKM</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m, i) => (
                  <tr key={m.id}>
                    <td className="text-slate-400 text-xs">{i + 1}</td>
                    <td>
                      <div className="font-semibold text-slate-800">{m.nama}</div>
                      <div className="text-xs text-slate-400 font-mono">{m.id}</div>
                    </td>
                    <td className="text-slate-600">
                      {m.nama_guru
                        ? <span>{m.nama_guru}</span>
                        : <span className="text-slate-400 text-xs">Belum ditentukan</span>
                      }
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {m.kelas_list
                          ? (() => {
                              const kelasList = m.kelas_list.split(',').map((k: string) => k.trim()).filter(Boolean)
                              // Cari label sekolah unik dari kelas-kelas yang diampu
                              const labels = [...new Set(kelasList.map((k: string) => kelasSekolahMap[k]).filter(Boolean))]
                              return (
                                <>
                                  {kelasList.map((k: string) => (
                                    <span key={k} className="badge-blue">{k}</span>
                                  ))}
                                  {labels.map((label: string) => (
                                    <span key={label} className="badge badge-purple ml-1">{label}</span>
                                  ))}
                                </>
                              )
                            })()
                          : <span className="text-slate-400 text-xs">-</span>
                        }
                      </div>
                    </td>
                    <td>
                      <span className={`font-semibold text-sm ${m.kkm >= 75 ? 'text-green-600' : 'text-amber-600'}`}>
                        {m.kkm}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(m)}
                          className="btn-ghost btn-icon btn-sm text-blue-600 hover:bg-blue-50"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteId(m.id)}
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
      </div>

      {/* Modal Form */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editData?.id ? 'Edit Mata Pelajaran' : 'Tambah Mata Pelajaran'}
        footer={
          <>
            <button onClick={() => setModalOpen(false)} className="btn-secondary" disabled={saving}>Batal</button>
            <button form="mapel-form" type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : (editData?.id ? 'Simpan Perubahan' : 'Tambah Mapel')}
            </button>
          </>
        }
      >
        <form id="mapel-form" onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="label">Nama Mata Pelajaran *</label>
            <input
              name="nama"
              className="input"
              placeholder="Contoh: MATEMATIKA"
              required
              defaultValue={editData?.nama ?? ''}
            />
          </div>
          <div>
            <label className="label">Guru Pengampu</label>
            <select name="guru_id" className="select" defaultValue={editData?.guru_id ?? ''}>
              <option value="">-- Pilih Guru --</option>
              {users.map(u => (
                <option key={u.username} value={u.username}>{u.nama}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Kelas yang Diajar</label>
            {kelas.length === 0 ? (
              <p className="text-xs text-slate-400">Belum ada kelas. Tambahkan kelas terlebih dahulu.</p>
            ) : (
              <div className="flex flex-wrap gap-2 mt-1">
                {kelas.map(k => (
                  <label
                    key={k.id}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-sm transition-colors
                      ${selectedKelas.includes(String(k.nama))
                        ? 'bg-brand-50 border-brand-400 text-brand-700 font-medium'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={selectedKelas.includes(String(k.nama))}
                      onChange={() => toggleKelas(String(k.nama))}
                    />
                    Kelas {k.nama}
                  </label>
                ))}
              </div>
            )}
          </div>
          {/* FIX (konsolidasi jumlah opsi): field "Jumlah Opsi Jawaban" per
              mapel dihapus dari sini. Jumlah opsi sekarang cuma diatur satu
              tempat: menu Pengaturan > Pengaturan Ujian > Jumlah Opsi Jawaban
              Default (bisa dikunci admin supaya guru tidak bisa mengubahnya
              sendiri saat membuat soal). */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">KKM</label>
              <input
                name="kkm"
                type="number"
                className="input"
                placeholder="75"
                min={0}
                max={100}
                defaultValue={editData?.kkm ?? 75}
              />
            </div>
          </div>
        </form>
      </Modal>

      {/* Modal Impor Mapel */}
      <Modal open={importOpen} onClose={closeImport} title="Impor Mata Pelajaran" size="lg"
        footer={
          <>
            <button onClick={closeImport} className="btn-secondary" disabled={importing}>
              {importResult ? 'Tutup' : 'Batal'}
            </button>
            <button onClick={handleImportSubmit} className="btn-primary"
              disabled={importing || importRows.length === 0}>
              {importing ? <Spinner size="sm" /> : `Impor ${importRows.length || ''} Mapel`}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm">
              <div className="font-medium text-slate-800">1. Unduh template Excel</div>
              <p className="text-xs text-slate-500 mt-0.5">Berisi kolom, contoh isian, petunjuk, daftar guru, dan daftar kelas.</p>
            </div>
            <button onClick={handleDownloadTemplate} className="btn-secondary btn-sm">
              <Download className="w-4 h-4" /> Unduh Template
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 px-3 py-3 space-y-2">
            <div className="text-sm font-medium text-slate-800">2. Pilih file yang sudah diisi</div>
            <input ref={importFileRef} type="file" accept=".xlsx,.xls"
              onChange={handleImportFile} className="hidden" />
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={() => importFileRef.current?.click()} className="btn-secondary btn-sm" disabled={importing}>
                <Upload className="w-4 h-4" /> Pilih File
              </button>
              <span className="text-xs text-slate-500">{importFileName || 'Belum ada file dipilih'}</span>
            </div>
            <p className="text-xs text-slate-400">
              Nama mapel otomatis huruf besar. Mapel yang sudah ada dilewati. Mapel dengan nama yang sama tidak boleh
              diampu guru berbeda pada kelas yang sama. KKM kosong = 75. Maks. {IMPORT_MAX_ROWS} baris.
            </p>
          </div>

          {importRows.length > 0 && (
            <div>
              <div className="text-sm font-medium text-slate-800 mb-1.5">
                Pratinjau: {importRows.length} baris siap diimpor
              </div>
              <div className="border border-slate-200 rounded-lg overflow-auto max-h-56">
                <table className="table">
                  <thead>
                    <tr><th>Nama Mapel</th><th>Guru</th><th>Kelas</th><th>KKM</th></tr>
                  </thead>
                  <tbody>
                    {importRows.slice(0, 50).map((r, i) => (
                      <tr key={i}>
                        <td className="text-xs font-medium">{r.nama}</td>
                        <td className="font-mono text-xs">{r.guru || '—'}</td>
                        <td className="text-xs">{r.kelas || '—'}</td>
                        <td className="text-xs">{r.kkm || '75'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {importRows.length > 50 && (
                <p className="text-xs text-slate-400 mt-1">Menampilkan 50 baris pertama dari {importRows.length}.</p>
              )}
            </div>
          )}

          {importResult && (
            <div className="space-y-2">
              <div className={importResult.inserted > 0 ? 'alert-success text-sm' : 'alert-info text-sm'}>
                {importResult.inserted} mata pelajaran berhasil ditambahkan, {importResult.skipped} dilewati.
              </div>
              {importResult.errors.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <div className="text-xs font-medium text-red-700 mb-1">Baris yang dilewati:</div>
                  <ul className="text-xs text-red-600 space-y-0.5 max-h-40 overflow-y-auto list-disc pl-4">
                    {importResult.errors.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                </div>
              )}
              {importResult.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <div className="text-xs font-medium text-amber-700 mb-1">Perlu perhatian:</div>
                  <ul className="text-xs text-amber-700 space-y-0.5 max-h-32 overflow-y-auto list-disc pl-4">
                    {importResult.warnings.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* Confirm Delete */}
      <Confirm
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Hapus Mata Pelajaran"
        message="Apakah Anda yakin ingin menghapus mata pelajaran ini? Data soal dan jadwal terkait juga akan terpengaruh."
        confirmLabel="Ya, Hapus"
        loading={saving}
      />
    </div>
  )
}
