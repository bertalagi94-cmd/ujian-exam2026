'use client'

import type * as XLSXType from 'xlsx'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
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

// ── Satu mapel, banyak pengampu ────────────────────────────────────────────
// Di database, satu pengampu = satu baris tabel `mapel` (nama sama, guru_id &
// kelas_list berbeda). Halaman ini hanya MENGELOMPOKKAN baris bernama sama
// menjadi satu entri, supaya admin melihat satu "MATEMATIKA" dengan daftar
// guru & kelasnya. Struktur data dan API tidak berubah.
interface GrupMapel {
  nama: string
  items: Mapel[]
}

const normNama = (s: string | null | undefined) => String(s ?? '').trim().toUpperCase()

const daftarKelas = (m: Mapel): string[] =>
  (m.kelas_list ?? '').split(',').map(s => s.trim()).filter(Boolean)

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
  // Isian form yang perlu dipantau: nama (untuk mendeteksi mapel yang sudah ada
  // dan menonaktifkan kelas/guru yang sudah terpakai) dan KKM.
  const [namaForm, setNamaForm] = useState('')
  const [kkmForm, setKkmForm] = useState('75')
  // true saat membuka "+ Guru" pada mapel yang sudah ada: nama dikunci.
  const [kunciNama, setKunciNama] = useState(false)
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
    setNamaForm('')
    setKkmForm('75')
    setKunciNama(false)
    setModalOpen(true)
  }

  // "+ Guru": tambah pengampu baru ke mapel yang sudah ada (nama & KKM mengikuti mapel).
  function openTambahGuru(g: GrupMapel) {
    setEditData({})
    setSelectedKelas([])
    setNamaForm(g.nama)
    setKkmForm(String(g.items[0]?.kkm ?? 75))
    setKunciNama(true)
    setModalOpen(true)
  }

  function openEdit(m: Mapel) {
    setEditData(m)
    setSelectedKelas(daftarKelas(m))
    setNamaForm(m.nama)
    setKkmForm(String(m.kkm ?? 75))
    setKunciNama(false)
    setModalOpen(true)
  }

  function toggleKelas(nama: string) {
    if (kelasDiambil.has(nama)) return // sudah diampu guru lain pada mapel ini
    setSelectedKelas(prev =>
      prev.includes(nama) ? prev.filter(k => k !== nama) : [...prev, nama]
    )
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const payload: Record<string, unknown> = Object.fromEntries(form.entries())
    const namaBaru = normNama(String(payload.nama ?? ''))
    const kkmBaru = Number(payload.kkm) || 75
    payload.nama = namaBaru
    payload.kkm = kkmBaru
    payload.kelas_list = kelasEfektif.join(',')

    setSaving(true)
    try {
      if (editData?.id) {
        await apiRequest('/api/admin/mapel', { method: 'PUT', body: JSON.stringify({ id: editData.id, ...payload }) })

        // Satu mapel = satu nama & satu KKM. Kalau nama/KKM diubah di sini, samakan
        // juga pada pengampu lain dari mapel yang sama.
        const grupLama = grup.find(g => g.items.some(m => m.id === editData.id))
        const perluSama = (grupLama?.items ?? []).filter(
          m => m.id !== editData.id && (normNama(m.nama) !== namaBaru || m.kkm !== kkmBaru)
        )
        const gagal: string[] = []
        for (const m of perluSama) {
          try {
            await apiRequest('/api/admin/mapel', {
              method: 'PUT',
              body: JSON.stringify({
                id: m.id, nama: namaBaru, guru_id: m.guru_id ?? '', kelas_list: m.kelas_list ?? '', kkm: kkmBaru,
              }),
            })
          } catch {
            gagal.push(m.nama_guru || m.id)
          }
        }
        if (gagal.length > 0) {
          showToast(`Tersimpan, tetapi pengampu lain belum ikut disesuaikan: ${gagal.join(', ')}. Edit satu per satu.`, 'error')
        } else {
          showToast('Mata pelajaran berhasil diperbarui')
        }
      } else {
        await apiRequest('/api/admin/mapel', { method: 'POST', body: JSON.stringify(payload) })
        showToast(grupForm ? 'Guru pengampu berhasil ditambahkan' : 'Mata pelajaran berhasil ditambahkan')
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

  // Kelompokkan baris bernama sama menjadi satu mapel dengan banyak pengampu.
  const grup = useMemo<GrupMapel[]>(() => {
    const peta = new Map<string, Mapel[]>()
    for (const m of mapel) {
      const k = normNama(m.nama)
      const arr = peta.get(k)
      if (arr) arr.push(m)
      else peta.set(k, [m])
    }
    return [...peta.entries()]
      .map(([nama, items]) => ({
        nama,
        items: [...items].sort((a, b) => (a.nama_guru ?? '').localeCompare(b.nama_guru ?? '', 'id')),
      }))
      .sort((a, b) => a.nama.localeCompare(b.nama, 'id'))
  }, [mapel])

  const q = search.trim().toLowerCase()
  const grupTampil = q
    ? grup.filter(g => g.nama.toLowerCase().includes(q) || g.items.some(m => (m.nama_guru ?? '').toLowerCase().includes(q)))
    : grup

  // Mapel (nama) yang sedang diisi di form, kalau sudah ada di daftar.
  const grupForm = grup.find(g => g.nama === normNama(namaForm))

  // Pada mapel yang sama: kelas yang sudah diampu guru lain TIDAK boleh dipilih
  // lagi, dan guru yang sudah mengampu tidak perlu dipilih dua kali. (Server
  // tetap menolak tabrakan; ini hanya supaya admin tidak perlu menebak.)
  const { kelasDiambil, guruTerpakai } = useMemo(() => {
    const kelasMap = new Map<string, string>()
    const guruSet = new Set<string>()
    const g = grup.find(x => x.nama === normNama(namaForm))
    if (g) {
      for (const m of g.items) {
        if (m.id === editData?.id || !m.guru_id) continue
        guruSet.add(m.guru_id)
        for (const k of daftarKelas(m)) kelasMap.set(k, m.nama_guru || m.guru_id)
      }
    }
    return { kelasDiambil: kelasMap, guruTerpakai: guruSet }
  }, [grup, namaForm, editData?.id])

  const kelasEfektif = selectedKelas.filter(k => !kelasDiambil.has(k))

  // Menambah pengampu ke mapel yang sudah ada: KKM mengikuti mapel tersebut.
  const kkmTerkunci = !editData?.id && !!grupForm
  useEffect(() => {
    if (modalOpen && !editData?.id && grupForm) setKkmForm(String(grupForm.items[0]?.kkm ?? 75))
  }, [modalOpen, editData?.id, grupForm])

  // Teks konfirmasi hapus: bedakan "hapus satu pengampu" vs "hapus mapel".
  const mapelDihapus = mapel.find(m => m.id === deleteId)
  const jumlahPengampuDihapus = mapelDihapus
    ? mapel.filter(m => normNama(m.nama) === normNama(mapelDihapus.nama)).length
    : 0

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Mata Pelajaran</h1>
          <p className="page-subtitle">
            {grup.length} mata pelajaran terdaftar{mapel.length !== grup.length ? ` · ${mapel.length} penugasan guru` : ''}
          </p>
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
          ) : grupTampil.length === 0 ? (
            <EmptyState message="Tidak ada mata pelajaran ditemukan" icon={search ? Search : BookOpen} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Mata Pelajaran</th>
                  <th>Guru Pengampu &amp; Kelas</th>
                  <th>KKM</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {grupTampil.map((g, i) => {
                  const kkmUnik = [...new Set(g.items.map(m => m.kkm))].sort((a, b) => a - b)
                  return (
                    <tr key={g.nama}>
                      <td className="text-slate-400 text-xs align-top">{i + 1}</td>
                      <td className="align-top">
                        <div className="font-semibold text-slate-800">{g.nama}</div>
                        <div className="text-xs text-slate-400">{g.items.length} pengampu</div>
                      </td>
                      <td>
                        <div className="divide-y divide-slate-100">
                          {g.items.map(m => {
                            const kelasList = daftarKelas(m)
                            // Label sekolah/jenjang unik dari kelas-kelas yang diampu
                            const labels = [...new Set(kelasList.map(k => kelasSekolahMap[k]).filter(Boolean))]
                            return (
                              <div key={m.id} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-slate-700">
                                    {m.nama_guru
                                      ? m.nama_guru
                                      : <span className="text-slate-400 text-xs font-normal">Belum ditentukan</span>}
                                  </div>
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {kelasList.length > 0
                                      ? (
                                        <>
                                          {kelasList.map(k => (
                                            <span key={k} className="badge-blue">{k}</span>
                                          ))}
                                          {labels.map(label => (
                                            <span key={label} className="badge badge-purple ml-1">{label}</span>
                                          ))}
                                        </>
                                      )
                                      : <span className="text-slate-400 text-xs">Belum ada kelas</span>}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    onClick={() => openEdit(m)}
                                    className="btn-ghost btn-icon btn-sm text-blue-600 hover:bg-blue-50"
                                    title="Edit pengampu"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => setDeleteId(m.id)}
                                    className="btn-ghost btn-icon btn-sm text-red-600 hover:bg-red-50"
                                    title="Hapus pengampu"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </td>
                      <td className="align-top">
                        <span className={`font-semibold text-sm ${kkmUnik.length > 1 ? 'text-amber-600' : kkmUnik[0] >= 75 ? 'text-green-600' : 'text-amber-600'}`}>
                          {kkmUnik.length > 1 ? `${kkmUnik[0]}–${kkmUnik[kkmUnik.length - 1]}` : kkmUnik[0]}
                        </span>
                        {kkmUnik.length > 1 && (
                          <div className="text-[11px] text-amber-600">beda antar guru</div>
                        )}
                      </td>
                      <td className="align-top">
                        <button onClick={() => openTambahGuru(g)} className="btn-secondary btn-sm" title="Tambah guru pengampu lain untuk mapel ini">
                          <Plus className="w-4 h-4" /> Guru
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal Form */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editData?.id ? 'Edit Pengampu Mapel' : kunciNama ? `Tambah Guru — ${namaForm}` : 'Tambah Mata Pelajaran'}
        footer={
          <>
            <button onClick={() => setModalOpen(false)} className="btn-secondary" disabled={saving}>Batal</button>
            <button form="mapel-form" type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : (editData?.id ? 'Simpan Perubahan' : kunciNama ? 'Tambah Guru' : 'Tambah Mapel')}
            </button>
          </>
        }
      >
        <form id="mapel-form" onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="label">Nama Mata Pelajaran *</label>
            <input
              name="nama"
              className={`input ${kunciNama ? 'bg-slate-50 text-slate-500' : ''}`}
              placeholder="Contoh: MATEMATIKA"
              required
              value={namaForm}
              onChange={e => setNamaForm(e.target.value)}
              readOnly={kunciNama}
            />
            {!editData?.id && !kunciNama && grupForm && (
              <p className="text-xs text-amber-600 mt-1">
                Mapel ini sudah ada ({grupForm.items.length} pengampu). Yang Anda simpan akan ditambahkan sebagai
                guru pengampu tambahan, dengan kelas yang berbeda dari pengampu lain.
              </p>
            )}
            {editData?.id && grupForm && grupForm.items.length > 1 && (
              <p className="text-xs text-slate-500 mt-1">
                Nama dan KKM berlaku untuk semua guru pengampu mapel ini.
              </p>
            )}
          </div>
          <div>
            <label className="label">Guru Pengampu{kunciNama ? ' *' : ''}</label>
            <select name="guru_id" className="select" defaultValue={editData?.guru_id ?? ''} required={kunciNama}>
              <option value="">-- Pilih Guru --</option>
              {users.map(u => (
                <option key={u.username} value={u.username} disabled={guruTerpakai.has(u.username)}>
                  {u.nama}{guruTerpakai.has(u.username) ? ' (sudah mengampu mapel ini)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Kelas yang Diajar</label>
            {kelasDiambil.size > 0 && (
              <p className="text-xs text-slate-500 mb-1">
                Kelas yang sudah diampu guru lain pada mapel ini tidak bisa dipilih.
              </p>
            )}
            {kelas.length === 0 ? (
              <p className="text-xs text-slate-400">Belum ada kelas. Tambahkan kelas terlebih dahulu.</p>
            ) : (
              <div className="flex flex-wrap gap-2 mt-1">
                {kelas.map(k => {
                  const nama = String(k.nama)
                  const diambil = kelasDiambil.get(nama)
                  return (
                    <label
                      key={k.id}
                      title={diambil ? `Sudah diampu ${diambil}` : undefined}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors
                        ${diambil
                          ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'
                          : kelasEfektif.includes(nama)
                            ? 'bg-brand-50 border-brand-400 text-brand-700 font-medium cursor-pointer'
                            : 'border-slate-200 text-slate-600 hover:border-slate-300 cursor-pointer'
                        }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        disabled={!!diambil}
                        checked={kelasEfektif.includes(nama)}
                        onChange={() => toggleKelas(nama)}
                      />
                      Kelas {k.nama}
                      {diambil && <span className="text-[11px]">· {diambil}</span>}
                    </label>
                  )
                })}
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
                value={kkmForm}
                onChange={e => setKkmForm(e.target.value)}
                readOnly={kkmTerkunci}
              />
              {kkmTerkunci && (
                <p className="text-xs text-slate-500 mt-1">Mengikuti KKM mapel ini.</p>
              )}
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
        title={jumlahPengampuDihapus > 1 ? 'Hapus Guru Pengampu' : 'Hapus Mata Pelajaran'}
        message={
          jumlahPengampuDihapus > 1
            ? `Hapus ${mapelDihapus?.nama_guru || 'pengampu ini'} dari mapel ${mapelDihapus?.nama}? Guru pengampu lain tidak terpengaruh. Soal dan jadwal milik guru ini pada mapel ini juga akan terpengaruh.`
            : 'Apakah Anda yakin ingin menghapus mata pelajaran ini? Data soal dan jadwal terkait juga akan terpengaruh.'
        }
        confirmLabel="Ya, Hapus"
        loading={saving}
      />
    </div>
  )
}
