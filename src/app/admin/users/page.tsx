'use client'

import type * as XLSXType from 'xlsx'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Pencil, Trash2, RotateCcw, Building2, Eye, Upload, Download, Lock } from 'lucide-react'
import { Modal, Confirm, StatusBadge, SearchInput, EmptyState, Spinner, Toast } from '@/components/ui'
import { apiRequest, formatDateTime } from '@/lib/utils'
import { User, Mapel, Sekolah } from '@/types'
import { mulaiLihatSebagai } from '@/lib/lihat-sebagai'

// Role "Pengawas" SENGAJA tidak ada di sini. Pengawas bukan role akun yang
// berdiri sendiri — kapabilitas mengawasi ujian otomatis aktif di akun GURU
// ketika admin menugaskannya lewat menu Jadwal Ujian (kolom jadwal.pengawas
// diisi username guru tersebut). Lihat src/app/guru/mode-pengawas.
const ALL_ROLES = ['ADMIN', 'GURU', 'KEPSEK'] as const
const ROLE_TABS = [
  { value: '', label: 'Semua' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'GURU', label: 'Guru' },
  { value: 'KEPSEK', label: 'Kepsek' },
]
const roleColors: Record<string, string> = {
  ADMIN: 'badge-red',
  GURU: 'badge-blue',
  KEPSEK: 'badge-purple',
}

interface ImportUserRow {
  username: string
  nama: string
  role: string
  password: string
  nip: string
  no_hp: string
  status: string
  sekolah: string
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
  username: 'Username',
  nama: 'Nama Lengkap',
  role: 'Role',
  password: 'Password',
  nip: 'NIP',
  no_hp: 'No WhatsApp',
  status: 'Status',
  sekolah: 'Sekolah',
} as const
const IMPORT_MAX_ROWS = 200

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [mapelList, setMapelList] = useState<Mapel[]>([])
  const [sekolahList, setSekolahList] = useState<Sekolah[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState('')
  // Tab "Akun Reguler" / "Akun Tester". Akun tester ditandai is_tester = 'YES'
  // dan dikecualikan dari maintenance mode (lihat api/auth/login/route.ts).
  const [accountTab, setAccountTab] = useState<'reguler' | 'tester'>('reguler')
  const [modalOpen, setModalOpen] = useState(false)
  const [editData, setEditData] = useState<Partial<User> | null>(null)
  const [formRole, setFormRole] = useState<string>('GURU')
  const [formNip, setFormNip] = useState('')
  const [formSekolahId, setFormSekolahId] = useState('')
  // Guru bisa mengajar di lebih dari satu sekolah/jenjang, jadi dipilih
  // lewat checkbox (multi) — beda dengan Kepsek yang tetap dropdown tunggal.
  const [formSekolahIds, setFormSekolahIds] = useState<string[]>([])
  const [formIsTester, setFormIsTester] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [resetId, setResetId] = useState<string | null>(null)
  const [viewAsUser, setViewAsUser] = useState<User | null>(null)
  const [saving, setSaving] = useState(false)
  // Impor pengguna dari Excel
  const [importOpen, setImportOpen] = useState(false)
  const [importRows, setImportRows] = useState<ImportUserRow[]>([])
  const [importFileName, setImportFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const importFileRef = useRef<HTMLInputElement>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // Akun yang sedang diedit adalah ADMIN -> role terkunci.
  const roleTerkunci = !!editData?.username && editData.role === 'ADMIN'

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [usersRes, sekolahRes] = await Promise.all([
        apiRequest<{ data: User[] }>(`/api/admin/users${accountTab === 'tester' ? '?tester=true' : ''}`),
        apiRequest<{ data: Sekolah[] }>('/api/admin/sekolah'),
      ])
      setUsers(usersRes.data)
      setSekolahList(sekolahRes.data)
    } finally { setLoading(false) }
  }, [accountTab])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    apiRequest<{ data: Mapel[] }>('/api/admin/mapel').then(r => setMapelList(r.data))
  }, [])

  const filtered = users.filter(u => {
    const matchSearch = !search ||
      u.nama.toLowerCase().includes(search.toLowerCase()) ||
      u.username.toLowerCase().includes(search.toLowerCase())
    const matchRole = !filterRole || u.role === filterRole
    return matchSearch && matchRole
  })

  function openAdd() {
    setEditData({})
    setFormRole('GURU')
    setFormNip('')
    setFormSekolahId('')
    setFormSekolahIds([])
    setFormIsTester(false)
    setModalOpen(true)
  }

  function openEdit(u: User) {
    setEditData(u)
    setFormRole(u.role)
    setFormNip(u.nip ?? '')
    setFormSekolahId(u.sekolah_id ?? '')
    setFormSekolahIds(u.sekolah_ids ?? [])
    setFormIsTester(u.is_tester === 'YES')
    setModalOpen(true)
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const payload = {
      ...Object.fromEntries(fd.entries()),
      // Role selalu diambil dari state (bukan FormData) karena untuk akun
      // ADMIN kolom role terkunci dan tidak ikut terkirim lewat form.
      role: formRole,
      nip: formNip,
      // Kepsek: satu sekolah (dropdown tunggal). Guru: bisa lebih dari satu
      // sekolah/jenjang sekaligus, jadi dikirim sebagai array sekolah_ids
      // (disimpan di tabel relasi guru_sekolah, lihat migrasi 24).
      sekolah_id: formRole === 'KEPSEK' ? (formSekolahId || null) : null,
      sekolah_ids: formRole === 'GURU' ? formSekolahIds : [],
      // Hanya kirim saat edit (bukan tambah baru) — kolom checkbox cuma
      // muncul di form edit.
      ...(editData?.username ? { is_tester: formIsTester ? 'YES' : 'NO' } : {}),
    }
    setSaving(true)
    try {
      if (editData?.username) {
        await apiRequest(`/api/admin/users/${editData.username}`, { method: 'PUT', body: JSON.stringify(payload) })
        showToast('Data pengguna berhasil diperbarui')
      } else {
        await apiRequest('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) })
        showToast('Pengguna berhasil ditambahkan')
      }
      setModalOpen(false)
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error')
    } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!deleteId) return
    setSaving(true)
    try {
      await apiRequest(`/api/admin/users/${deleteId}`, { method: 'DELETE' })
      showToast('Pengguna berhasil dihapus')
      setDeleteId(null)
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus', 'error')
    } finally { setSaving(false) }
  }

  async function handleReset() {
    if (!resetId) return
    setSaving(true)
    try {
      await apiRequest(`/api/admin/users/${resetId}/reset-password`, { method: 'POST' })
      showToast('Password berhasil direset ke username')
      setResetId(null)
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal reset', 'error')
    } finally { setSaving(false) }
  }

  // ── IMPOR PENGGUNA ─────────────────────────────────────────────────────
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
    const header = [C.username, C.nama, C.role, C.password, C.nip, C.no_hp, C.status, C.sekolah]
    const contoh = [
      ['contoh_guru', 'Contoh Nama Guru', 'GURU', 'password123', '198501012010011001', '6281234567890', 'AKTIF', 'SMP, SMA'],
      ['contoh_kepsek', 'Contoh Nama Kepsek', 'KEPSEK', '', '197001012000031002', '', 'AKTIF', 'SMP'],
    ]
    const ws = XLSX.utils.aoa_to_sheet([header, ...contoh])
    // Kolom yang berisi angka panjang (NIP, No WA) / bisa diawali 0 harus
    // bertipe TEKS, kalau tidak Excel membulatkannya (mis. NIP 18 digit
    // berubah jadi 1.98E+17). Baris kosong sampai batas impor diformat teks.
    const kolomTeks = [0, 3, 4, 5]
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
    ws['!cols'] = [{ wch: 18 }, { wch: 28 }, { wch: 10 }, { wch: 16 }, { wch: 22 }, { wch: 18 }, { wch: 12 }, { wch: 20 }]

    const petunjuk = XLSX.utils.aoa_to_sheet([
      ['PETUNJUK PENGISIAN'],
      [''],
      ['Isi data pada sheet "Template Pengguna" (baris 1 adalah judul kolom, jangan diubah).'],
      [`${C.username}: wajib, unik, tanpa spasi. Username yang sudah ada akan dilewati (tidak menimpa).`],
      [`${C.nama}: wajib.`],
      [`${C.role}: wajib, isi GURU atau KEPSEK. Role ADMIN tidak bisa diimpor.`],
      [`${C.password}: opsional, minimal 6 karakter. Jika kosong, password = username.`],
      [`${C.nip}: wajib untuk KEPSEK, opsional untuk GURU. Biarkan format sel sebagai Teks.`],
      [`${C.no_hp}: opsional, format internasional tanpa tanda "+", contoh 6281234567890.`],
      [`${C.status}: AKTIF atau NONAKTIF (kosong = AKTIF).`],
      [`${C.sekolah}: isi Label sekolah (lihat sheet "Daftar Sekolah"). KEPSEK wajib satu sekolah. GURU boleh lebih dari satu, pisahkan dengan koma, contoh: SMP, SMA.`],
      [''],
      ['Baris contoh (username diawali "contoh_") otomatis diabaikan saat impor.'],
      [`Maksimal ${IMPORT_MAX_ROWS} baris per file.`],
    ])
    petunjuk['!cols'] = [{ wch: 110 }]

    const daftarSekolah = XLSX.utils.aoa_to_sheet([
      ['Label (isi ke kolom Sekolah)', 'Nama Sekolah'],
      ...sekolahList.map(sk => [sk.label, sk.nama_sekolah]),
    ])
    daftarSekolah['!cols'] = [{ wch: 28 }, { wch: 40 }]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Template Pengguna')
    XLSX.utils.book_append_sheet(wb, petunjuk, 'Petunjuk')
    XLSX.utils.book_append_sheet(wb, daftarSekolah, 'Daftar Sekolah')
    XLSX.writeFile(wb, 'template-import-pengguna.xlsx')
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
      const parsed: ImportUserRow[] = raw
        .map(r => ({
          username: str(r[C.username]),
          nama: str(r[C.nama]),
          role: str(r[C.role]).toUpperCase(),
          password: str(r[C.password]),
          nip: str(r[C.nip]),
          no_hp: str(r[C.no_hp]),
          status: str(r[C.status]).toUpperCase(),
          sekolah: str(r[C.sekolah]),
        }))
        // Lewati baris kosong dan baris contoh bawaan template.
        .filter(r => (r.username || r.nama) && !r.username.toLowerCase().startsWith('contoh_'))

      if (parsed.length === 0) {
        showToast('Tidak ada data ditemukan. Pastikan memakai template dan kolom Username & Nama Lengkap terisi.', 'error')
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
      const res = await apiRequest<ImportResult>('/api/admin/users/import', {
        method: 'POST',
        body: JSON.stringify({ data: importRows }),
      })
      setImportResult(res)
      setImportRows([])
      setImportFileName('')
      if (res.inserted > 0) {
        showToast(`Impor selesai: ${res.inserted} pengguna ditambahkan${res.skipped ? `, ${res.skipped} dilewati` : ''}`)
        load()
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal impor', 'error')
    } finally { setImporting(false) }
  }

  async function handleLihatSebagai() {
    if (!viewAsUser) return
    setSaving(true)
    try {
      await mulaiLihatSebagai({ tipe: 'USER', id: viewAsUser.username })
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal memulai mode Lihat-sebagai', 'error')
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Data Pengguna</h1>
          <p className="page-subtitle">{users.length} pengguna terdaftar</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openImport} className="btn-secondary btn-sm">
            <Upload className="w-4 h-4" /> Impor
          </button>
          <button onClick={openAdd} className="btn-primary btn-sm">
            <Plus className="w-4 h-4" /> Tambah Pengguna
          </button>
        </div>
      </div>

      {/* Tab Akun Reguler / Akun Tester */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => setAccountTab('reguler')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            accountTab === 'reguler' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Akun Reguler
        </button>
        <button
          onClick={() => setAccountTab('tester')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            accountTab === 'tester' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          🧪 Akun Tester
        </button>
      </div>
      {accountTab === 'tester' && (
        <div className="alert-info text-xs">
          Akun tester tetap bisa login walau maintenance mode aktif. Gunakan untuk keperluan pengujian/QA, bukan akun guru/kepsek aktif sehari-hari.
        </div>
      )}

      {/* Filter */}
      <div className="card py-3 flex gap-3 flex-wrap items-center">
        <SearchInput value={search} onChange={setSearch} placeholder="Cari nama atau username..." className="flex-1 min-w-[200px]" />
        {/* Tab role */}
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
          {ROLE_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setFilterRole(tab.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                filterRole === tab.value
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
              <span className="ml-1 text-slate-400">
                ({tab.value ? users.filter(u => u.role === tab.value).length : users.length})
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="table-wrapper">
          {loading ? (
            <div className="flex justify-center py-20"><Spinner size="lg" /></div>
          ) : filtered.length === 0 ? (
            <EmptyState message="Tidak ada pengguna ditemukan" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Username</th>
                  <th>Nama</th>
                  <th>Role</th>
                  <th>Sekolah</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u, i) => (
                  <tr key={u.username}>
                    <td className="text-slate-400 text-xs">{i + 1}</td>
                    <td className="font-mono text-xs text-slate-600">{u.username}</td>
                    <td>
                      <div className="font-medium text-slate-800 flex items-center gap-1.5">
                        {u.nama}
                        {u.is_tester === 'YES' && (
                          <span className="badge text-xs bg-purple-100 text-purple-700">🧪 TESTER</span>
                        )}
                      </div>
                      {u.nip && <div className="text-xs text-slate-400">NIP: {u.nip}</div>}
                    </td>
                    <td>
                      <span className={`badge ${roleColors[u.role] ?? 'badge-slate'}`}>{u.role}</span>
                    </td>
                    <td>
                      {u.role === 'KEPSEK' && (
                        u.sekolah ? (
                          <span className="badge badge-blue">{u.sekolah.label}</span>
                        ) : (
                          <span className="text-xs text-amber-600">Belum diset</span>
                        )
                      )}
                      {u.role === 'GURU' && (
                        u.sekolah_list && u.sekolah_list.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {u.sekolah_list.map(s => (
                              <span key={s.id} className="badge badge-blue">{s.label}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-amber-600">Belum diset</span>
                        )
                      )}
                      {u.role !== 'KEPSEK' && u.role !== 'GURU' && (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                    <td><StatusBadge status={u.status} /></td>
                    <td className="text-xs text-slate-400">
                      {u.last_login ? formatDateTime(u.last_login) : 'Belum pernah'}
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(u)}
                          className="btn-ghost btn-icon btn-sm text-blue-600 hover:bg-blue-50">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {(u.role === 'GURU' || u.role === 'KEPSEK') && (
                          <button onClick={() => setViewAsUser(u)} title="Lihat sebagai (hanya-baca)"
                            className="btn-ghost btn-icon btn-sm text-emerald-600 hover:bg-emerald-50">
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button onClick={() => setResetId(u.username)}
                          className="btn-ghost btn-icon btn-sm text-amber-600 hover:bg-amber-50">
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDeleteId(u.username)}
                          className="btn-ghost btn-icon btn-sm text-red-600 hover:bg-red-50">
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

      {/* Form Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={editData?.username ? 'Edit Pengguna' : 'Tambah Pengguna Baru'}
        footer={
          <>
            <button onClick={() => setModalOpen(false)} className="btn-secondary" disabled={saving}>Batal</button>
            <button form="user-form" type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : (editData?.username ? 'Simpan' : 'Tambah')}
            </button>
          </>
        }
      >
        <form id="user-form" onSubmit={handleSave} className="space-y-4">
          {!editData?.username && (
            <div>
              <label className="label">Username *</label>
              <input name="username" className="input" required placeholder="username unik" />
            </div>
          )}
          <div>
            <label className="label">Nama Lengkap *</label>
            <input name="nama" className="input" required defaultValue={editData?.nama} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label flex items-center gap-1">
                Role *
                {roleTerkunci && <Lock className="w-3 h-3 text-slate-400" />}
              </label>
              {roleTerkunci ? (
                <>
                  {/* Akun ADMIN: role terkunci, tidak ada pilihan ubah. */}
                  <div className="input bg-slate-50 text-slate-600 cursor-not-allowed select-none" aria-readonly="true">
                    ADMIN
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Role akun admin tidak dapat diubah.</p>
                </>
              ) : (
                <select
                  name="role"
                  className="select"
                  required
                  value={formRole}
                  onChange={e => {
                    const nextRole = e.target.value
                    setFormRole(nextRole)
                    if (nextRole !== 'KEPSEK') setFormSekolahId('')
                    if (nextRole !== 'GURU') setFormSekolahIds([])
                  }}
                >
                  {ALL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
            </div>
            <div>
              <label className="label">Status</label>
              <select name="status" className="select" defaultValue={editData?.status ?? 'AKTIF'}>
                <option value="AKTIF">Aktif</option>
                <option value="NONAKTIF">Nonaktif</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Nomor WhatsApp</label>
            <input
              name="no_hp"
              className="input"
              placeholder="contoh: 6281234567890"
              defaultValue={editData?.no_hp ?? ''}
            />
            <p className="text-xs text-slate-400 mt-1">Format internasional tanpa tanda "+", dipakai untuk notifikasi WA.</p>
          </div>

          {/* NIP — tampil untuk semua role, wajib untuk Kepsek */}
          <div>
            <label className="label">NIP{formRole === 'KEPSEK' ? ' *' : ''}</label>
            <input
              className="input"
              placeholder="Nomor Induk Pegawai"
              value={formNip}
              onChange={e => setFormNip(e.target.value)}
              required={formRole === 'KEPSEK'}
            />
            {formRole === 'KEPSEK' && (
              <p className="text-xs text-slate-400 mt-1">NIP Kepsek digunakan otomatis di dokumen cetak (kop surat).</p>
            )}
          </div>

          {/* Sekolah — Kepsek (satu sekolah yang diawasi, dropdown tunggal)
              vs Guru (bisa lebih dari satu sekolah/jenjang sekaligus, mis.
              guru yang mengajar di SMP dan SMA yayasan yang sama — jadi
              dipilih lewat checkbox, disimpan di tabel relasi
              guru_sekolah). */}
          {formRole === 'KEPSEK' && (
            <div>
              <label className="label flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5" />
                Sekolah yang Diawasi *
              </label>
              {sekolahList.length > 0 ? (
                <select
                  className="select"
                  value={formSekolahId}
                  onChange={e => setFormSekolahId(e.target.value)}
                  required
                >
                  <option value="">-- Pilih Sekolah --</option>
                  {sekolahList.map(s => (
                    <option key={s.id} value={s.id}>{s.label} — {s.nama_sekolah}</option>
                  ))}
                </select>
              ) : (
                <div className="input bg-slate-50 text-slate-400">
                  Belum ada sekolah — tambahkan di Pengaturan → Sekolah &amp; Jenjang
                </div>
              )}
              <p className="text-xs text-slate-400 mt-1">
                Kepsek hanya dapat melihat data kelas yang terdaftar di sekolah ini.
              </p>
            </div>
          )}

          {formRole === 'GURU' && (
            <div>
              <label className="label flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5" />
                Sekolah (boleh pilih lebih dari satu)
              </label>
              {sekolahList.length > 0 ? (
                <div className="space-y-1.5 border border-slate-200 rounded-lg p-2.5 max-h-40 overflow-y-auto">
                  {sekolahList.map(s => (
                    <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formSekolahIds.includes(s.id)}
                        onChange={e => {
                          setFormSekolahIds(prev =>
                            e.target.checked ? [...prev, s.id] : prev.filter(id => id !== s.id)
                          )
                        }}
                      />
                      <span>{s.label} — {s.nama_sekolah}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="input bg-slate-50 text-slate-400">
                  Belum ada sekolah — tambahkan di Pengaturan → Sekolah &amp; Jenjang
                </div>
              )}
              <p className="text-xs text-slate-400 mt-1">
                Guru hanya dapat melihat/membuat kisi-kisi dan data lain untuk kelas di sekolah-sekolah yang dicentang. Centang lebih dari satu jika guru mengajar di beberapa jenjang. Wajib diisi minimal satu agar fitur kisi-kisi dan sejenisnya berfungsi.
              </p>
            </div>
          )}

          {/* Mapel yang diampu (tampil-only saat edit guru) */}
          {formRole === 'GURU' && editData?.username && (
            <div>
              <label className="label">Mata Pelajaran yang Diampu</label>
              <div className="flex flex-wrap gap-1.5 border border-slate-200 rounded-lg px-3 py-2.5 bg-slate-50 min-h-[42px]">
                {mapelList.filter(m => m.guru_id === editData?.username).length === 0 ? (
                  <span className="text-xs text-slate-400">Belum mengampu mapel apa pun</span>
                ) : (
                  mapelList.filter(m => m.guru_id === editData?.username).map(m => (
                    <span key={m.id} className="badge-blue text-xs">
                      {m.nama}{m.kelas_list ? ` (${m.kelas_list})` : ''}
                    </span>
                  ))
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Diatur dari menu <span className="font-medium">Mata Pelajaran</span>.
              </p>
            </div>
          )}

          {!editData?.username && (
            <div>
              <label className="label">Password *</label>
              <input name="password" type="password" className="input" required placeholder="Password awal" />
            </div>
          )}

          {/* Status tester — hanya bisa diubah lewat edit, bukan saat tambah baru */}
          {editData?.username && (
            <div className="rounded-lg border border-purple-200 bg-purple-50/50 px-3 py-2.5">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={formIsTester}
                  onChange={e => setFormIsTester(e.target.checked)}
                />
                <span>
                  <span className="text-sm font-medium text-purple-800">🧪 Jadikan Akun Tester</span>
                  <p className="text-xs text-purple-600 mt-0.5">
                    Akun tester tetap bisa login walau maintenance mode aktif, dan disembunyikan dari daftar &amp; statistik pengguna reguler.
                  </p>
                </span>
              </label>
            </div>
          )}
        </form>
      </Modal>

      {/* Modal Impor Pengguna */}
      <Modal open={importOpen} onClose={closeImport} title="Impor Data Pengguna" size="lg"
        footer={
          <>
            <button onClick={closeImport} className="btn-secondary" disabled={importing}>
              {importResult ? 'Tutup' : 'Batal'}
            </button>
            <button onClick={handleImportSubmit} className="btn-primary"
              disabled={importing || importRows.length === 0}>
              {importing ? <Spinner size="sm" /> : `Impor ${importRows.length || ''} Pengguna`}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm">
              <div className="font-medium text-slate-800">1. Unduh template Excel</div>
              <p className="text-xs text-slate-500 mt-0.5">Berisi kolom, contoh isian, petunjuk, dan daftar sekolah.</p>
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
              Hanya role GURU dan KEPSEK. Username yang sudah ada dilewati. Password kosong = sama dengan username. Maks. {IMPORT_MAX_ROWS} baris.
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
                    <tr><th>Username</th><th>Nama</th><th>Role</th><th>Sekolah</th></tr>
                  </thead>
                  <tbody>
                    {importRows.slice(0, 50).map((r, i) => (
                      <tr key={i}>
                        <td className="font-mono text-xs">{r.username}</td>
                        <td className="text-xs">{r.nama}</td>
                        <td className="text-xs">{r.role}</td>
                        <td className="text-xs">{r.sekolah || '—'}</td>
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
                {importResult.inserted} pengguna berhasil ditambahkan, {importResult.skipped} dilewati.
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

      <Confirm open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete}
        title="Hapus Pengguna" message="Pengguna ini akan dihapus permanen. Lanjutkan?"
        confirmLabel="Ya, Hapus" loading={saving} />
      <Confirm open={!!viewAsUser} onClose={() => setViewAsUser(null)} onConfirm={handleLihatSebagai}
        title="Lihat sebagai" message={`Anda akan melihat aplikasi sebagai ${viewAsUser?.nama ?? ''} (hanya-baca, maksimal 2 jam, tercatat di log). Lanjutkan?`}
        confirmLabel="Lihat" variant="primary" loading={saving} />
      <Confirm open={!!resetId} onClose={() => setResetId(null)} onConfirm={handleReset}
        title="Reset Password" message="Password akan direset ke username. Lanjutkan?"
        confirmLabel="Reset" variant="primary" loading={saving} />
    </div>
  )
}
