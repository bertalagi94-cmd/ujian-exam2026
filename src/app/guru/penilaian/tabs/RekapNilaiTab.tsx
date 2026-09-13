'use client'

import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { Download, BarChart3, Trophy, TrendingUp, Users, CheckCircle, AlertTriangle, ShieldCheck, Pencil, Save, Lock } from 'lucide-react'
import { PageLoader, EmptyState, SearchInput, StatCard, Modal, Toast } from '@/components/ui'
import { apiRequest, formatDateTime, nilaiColor } from '@/lib/utils'
import { Nilai as NilaiBase, Mapel } from '@/types'
import { terjemahJenisPelanggaran, labelStatusPelanggaran, warnaStatusPelanggaran } from '@/lib/pelanggaran-shared'

// true kalau siswa ini belum sama sekali mengerjakan ujian mapel ini —
// ditambahkan oleh /api/guru/nilai dari roster jadwal, bukan dari tabel nilai.
type Nilai = NilaiBase & { belum_ujian?: boolean }

interface Stats {
  total: number
  rataRata: number
  tertinggi: number
  terendah: number
  lulus: number
  tidakLulus: number
}

// Isi tab "Rekap Nilai" di menu Penilaian (/guru/penilaian). Sebelumnya
// halaman sendiri (/guru/nilai) — logikanya tidak diubah, cuma dipindah
// jadi salah satu tab dan header halamannya disederhanakan (judul besar
// sudah diwakili oleh nama tab di atasnya).
//
// KEPUTUSAN DESAIN (hapus dualisme tab Rekap Nilai vs Kirim Nilai): dulu
// nilai remedial (`nilai_edit`) hanya bisa diinput dari tab "Kirim Nilai ke
// Wali Kelas", sedangkan tab ini (Rekap Nilai) menampilkan nilai asli murni
// dan tidak pernah ikut berubah walau nilai remedial sudah disimpan — dua
// tab menampilkan angka berbeda untuk siswa yang sama. Sekarang input nilai
// remedial dipindah ke SINI (tombol pensil per baris → modal), dan tab
// Kirim Nilai jadi murni konfirmasi/kirim (read-only). Logika bisnis nilai
// akhir (nilai_edit override nilai_efektif, dipakai final saat dikirim ke
// wali kelas) tidak berubah — lihat hitungNilaiFinal() di
// api/guru/kirim-nilai/route.ts, dipakai bareng oleh kedua tab.
export function RekapNilaiTab({ onDataChanged }: { onDataChanged?: () => void } = {}) {
  const [nilaiList, setNilaiList] = useState<Nilai[]>([])
  const [mapelList, setMapelList] = useState<Mapel[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterMapel, setFilterMapel] = useState('')
  const [filterKelas, setFilterKelas] = useState('')
  const [search, setSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  // FITUR BARU (riwayat pelanggaran untuk guru pengampu): baris nilai yang
  // sedang dibuka modal riwayat pelanggarannya, null kalau modal tertutup.
  const [pelanggaranModal, setPelanggaranModal] = useState<Nilai | null>(null)
  // FITUR BARU (input nilai remedial dipindah ke tab ini): baris nilai yang
  // sedang dibuka modal edit-nya, null kalau modal tertutup.
  const [editTarget, setEditTarget] = useState<Nilai | null>(null)
  const [editNilaiStr, setEditNilaiStr] = useState('')
  const [editCatatan, setEditCatatan] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        ...(filterMapel && { mapel_id: filterMapel }),
        ...(filterKelas && { kelas: filterKelas }),
      })
      const res = await apiRequest<{ data: Nilai[]; stats: Stats; mapelList: Mapel[] }>(
        `/api/guru/nilai?${params}`
      )
      setNilaiList(res.data ?? [])
      setStats(res.stats)
      if (res.mapelList?.length) setMapelList(res.mapelList)
    } finally {
      setLoading(false)
    }
  }, [filterMapel, filterKelas])

  useEffect(() => { load() }, [load])

  // FITUR BARU (input nilai remedial dipindah ke tab ini): baris yang sudah
  // dikirim ke wali kelas dan BELUM dikembalikan tidak boleh diedit lagi —
  // sama seperti aturan lama di tab Kirim Nilai — supaya nilai yang sudah
  // resmi diterima wali kelas tidak berubah diam-diam di belakang mereka.
  function terkunci(n: Nilai) {
    return !!n.dikirim_ke_wali && !n.dikembalikan
  }

  function openEdit(n: Nilai) {
    setEditTarget(n)
    setEditNilaiStr(n.nilai_edit != null ? String(n.nilai_edit) : '')
    setEditCatatan(n.catatan_guru ?? '')
  }

  async function simpanNilaiEdit() {
    if (!editTarget) return
    setSavingEdit(true)
    try {
      const nilai_edit = editNilaiStr.trim() === '' ? null : parseFloat(editNilaiStr)
      await apiRequest('/api/guru/kirim-nilai', {
        method: 'PATCH',
        body: JSON.stringify({
          aksi: 'simpan_edit',
          id: editTarget.id,
          nilai_edit,
          catatan_guru: editCatatan.trim() || null,
        }),
      })
      setToast({ msg: 'Nilai remedial berhasil disimpan', type: 'success' })
      setEditTarget(null)
      await load()
      // BUG FIX (badge "Siswa di Bawah KKM" di tab bar tidak ikut update):
      // `load()` di atas hanya me-refresh data tabel INI (tab Rekap Nilai
      // sendiri). Halaman induk (/guru/penilaian) menghitung ringkasan
      // badge tab bar dari fetch-nya sendiri yang terpisah, jadi tanpa
      // baris ini badge tetap menampilkan angka lama sampai guru me-refresh
      // browser. `onDataChanged` memberi tahu halaman induk untuk menghitung
      // ulang ringkasan itu sekarang juga.
      onDataChanged?.()
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Gagal menyimpan nilai', type: 'error' })
    } finally {
      setSavingEdit(false)
    }
  }

  const kelasList = [...new Set(nilaiList.map(n => n.kelas))].sort()

  const filtered = nilaiList.filter(n =>
    !search || (n.nama_siswa ?? '').toLowerCase().includes(search.toLowerCase())
  )

  // GANTI: sebelumnya export CSV satu lembar yang mencampur semua mata pelajaran
  // jadi satu tabel besar — membingungkan kalau guru mengampu beberapa mapel.
  // Sekarang export ke Excel (.xlsx) dengan SATU SHEET PER MAPEL yang diampu
  // guru ini (judul sheet = nama mapel), termasuk mapel yang belum punya nilai
  // sama sekali (ditampilkan sebagai pesan, bukan dihilangkan begitu saja).
  async function exportExcel() {
    if (!mapelList.length) return
    setExporting(true)
    try {
      // Selalu ambil data LENGKAP (tanpa filter mapel/kelas yang sedang aktif di
      // tabel) supaya setiap sheet mapel berisi rekap penuh, bukan cuma sebagian
      // yang kebetulan sedang tersaring di tampilan.
      let semuaNilai: Nilai[] = nilaiList
      try {
        const res = await apiRequest<{ data: Nilai[] }>('/api/guru/nilai')
        semuaNilai = res.data ?? []
      } catch {
        // Kalau gagal refetch, tetap lanjut pakai data yang sudah tampil di halaman
      }

      const wb = XLSX.utils.book_new()
      const namaSheetTerpakai = new Set<string>()

      for (const mapel of mapelList) {
        // Export hanya nilai yang benar-benar sudah ujian — baris "belum ujian"
        // (placeholder dari roster jadwal) tidak relevan untuk rekap nilai Excel.
        const nilaiMapel = semuaNilai.filter(n => n.mapel_id === mapel.id && !n.belum_ujian)

        // BUG FIX (rekap nilai guru belum menyesuaikan fitur essay): kolom
        // export sebelumnya hanya berisi nilai PG ('Nilai'/'Grade'/'Status')
        // — untuk mapel yang punya essay aktif, nilai akhir gabungan
        // (nilai_total) yang sebenarnya dirilis ke siswa tidak pernah ikut
        // ter-export. Ditambahkan 3 kolom essay di akhir, sama seperti
        // export admin, kosong ('-') untuk mapel yang memang PG-only.
        const rows = nilaiMapel.map((n, i) => ({
          'No': i + 1,
          'Nama Siswa': n.nama_siswa ?? n.nis,
          'Kelas': n.kelas,
          'Nilai PG': n.nilai,
          'Grade': n.grade,
          'Benar': n.benar,
          'Total Soal': n.total,
          'KKM': n.kkm,
          // BUG FIX (Status export pakai n.lulus mentah — sama seperti bug di
          // tabel tampilan): sebelumnya kolom ini tidak ikut berubah walau
          // nilai remedial (nilai_edit) sudah disimpan, jadi siswa yang lolos
          // KKM lewat remedial tetap tercatat "Tidak Lulus" di file Excel.
          // Sekarang pakai lulus_final, konsisten dengan Nilai Akhir final
          // yang sebenarnya dikirim ke wali kelas.
          'Nilai Akhir Final': n.nilai_final ?? n.nilai,
          'Status': (n.lulus_final ?? n.lulus) ? 'Lulus' : 'Tidak Lulus',
          'Tanggal': formatDateTime(n.timestamp),
          'Nilai Essay': n.essay_aktif ? (n.nilai_essay ?? '-') : '-',
          'Nilai Akhir (PG+Essay)': n.essay_aktif ? (n.nilai_total ?? '-') : '-',
          'Status Essay': !n.essay_aktif ? '-' : n.dirilis ? 'Dirilis' : (n.nilai_essay !== null && n.nilai_essay !== undefined) ? 'Sudah dinilai (belum dirilis)' : 'Belum dinilai',
          // FITUR BARU (riwayat pelanggaran untuk guru pengampu): supaya
          // rekap Excel juga mencerminkan kondisi siswa selama ujian, bukan
          // cuma nilai akhirnya.
          'Jumlah Pelanggaran': n.jumlah_pelanggaran ?? 0,
          'Rincian Pelanggaran': (n.pelanggaran ?? []).length
            ? n.pelanggaran!.map(p => `#${p.level} ${terjemahJenisPelanggaran(p.jenis)} (${formatDateTime(p.created_at)})`).join('; ')
            : '-',
        }))

        const ws = rows.length
          ? XLSX.utils.json_to_sheet(rows)
          : XLSX.utils.aoa_to_sheet([[
              'Mapel belum ujian atau tidak memiliki jadwal ujian. Hubungi admin jika Anda merasa ini keliru.',
            ]])

        ws['!cols'] = rows.length
          ? [{ wch: 5 }, { wch: 26 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 14 }, { wch: 13 }, { wch: 20 }, { wch: 10 }, { wch: 20 }, { wch: 24 }, { wch: 10 }, { wch: 50 }]
          : [{ wch: 90 }]

        // Nama sheet Excel maksimal 31 karakter & tidak boleh berisi \ / ? * [ ] :
        // Tambahkan juga pengaman kalau ada 2 mapel dengan nama sama (mis. mapel
        // yang sama diampu untuk kelas berbeda dengan mapel_id berbeda).
        let sheetName = (mapel.nama || 'Mapel').replace(/[\\/?*[\]:]/g, '').slice(0, 31)
        if (namaSheetTerpakai.has(sheetName)) {
          let i = 2
          let kandidat = `${sheetName} (${i})`.slice(0, 31)
          while (namaSheetTerpakai.has(kandidat)) { i++; kandidat = `${sheetName} (${i})`.slice(0, 31) }
          sheetName = kandidat
        }
        namaSheetTerpakai.add(sheetName)

        XLSX.utils.book_append_sheet(wb, ws, sheetName)
      }

      XLSX.writeFile(wb, `rekap-nilai-guru-${Date.now()}.xlsx`)
    } finally {
      setExporting(false)
    }
  }

  if (loading) return <PageLoader />

  const persenLulus = stats && stats.total > 0
    ? Math.round((stats.lulus / stats.total) * 100)
    : 0

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && (
        <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />
      )}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm text-slate-500">Nilai siswa dari mata pelajaran yang Anda ampu</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Perlu remedial? Tekan ikon <Pencil className="w-3 h-3 inline" /> di baris siswa untuk input nilai —
            akan langsung dipakai sebagai Nilai Akhir di sini dan saat dikirim ke wali kelas.
          </p>
        </div>
        {mapelList.length > 0 && (
          <button onClick={exportExcel} disabled={exporting} className="btn-secondary btn-sm">
            {exporting ? (
              <span className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {exporting ? 'Menyiapkan Excel...' : 'Export Excel'}
          </button>
        )}
      </div>

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Ujian" value={stats.total} icon={Users} color="bg-brand-500" />
          <StatCard label="Rata-rata Nilai" value={stats.rataRata} icon={BarChart3} color="bg-emerald-500" />
          <StatCard label="Nilai Tertinggi" value={stats.tertinggi} icon={Trophy} color="bg-amber-500" />
          <StatCard label="Persentase Lulus" value={`${persenLulus}%`} icon={CheckCircle} color="bg-cyan-500" />
        </div>
      )}

      {/* Filter */}
      <div className="card py-4 flex gap-3 flex-wrap">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Cari nama siswa..."
          className="flex-1 min-w-[180px]"
        />
        <select
          value={filterMapel}
          onChange={e => setFilterMapel(e.target.value)}
          className="select w-44"
        >
          <option value="">Semua Mapel</option>
          {mapelList.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
        </select>
        <select
          value={filterKelas}
          onChange={e => setFilterKelas(e.target.value)}
          className="select w-36"
        >
          <option value="">Semua Kelas</option>
          {kelasList.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>

      <div className="card p-0 overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState message="Belum ada data nilai" icon={BarChart3} />
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nama Siswa</th>
                  <th>Kelas</th>
                  <th>Mata Pelajaran</th>
                  <th>Nilai PG</th>
                  <th>Grade</th>
                  <th>Benar/Total</th>
                  {/* FITUR BARU: kolom nilai Essay berdiri sendiri (di samping
                      Nilai PG), supaya guru bisa lihat komponen PG & Essay
                      terpisah sebelum melihat status lulus/tidak di kolom
                      Status (yang sudah mencakup total gabungannya). */}
                  <th>Nilai Essay</th>
                  <th>KKM</th>
                  {/* FITUR BARU (hapus dualisme tab Rekap Nilai vs Kirim
                      Nilai): kolom ini menampilkan nilai_final — sudah
                      termasuk nilai remedial (nilai_edit) kalau guru pernah
                      menginputnya lewat tombol pensil di kolom Aksi. Ini
                      angka yang SAMA persis dengan yang akan dikirim ke
                      wali kelas. */}
                  <th>Nilai Akhir</th>
                  {/* BUG FIX (Status memakai n.lulus mentah — sebelum remedial):
                      kolom "Status" sekarang memakai lulus_final (konsisten
                      dengan Nilai Akhir di sebelah kirinya), bukan n.lulus
                      mentah yang tidak ikut berubah waktu nilai remedial
                      disimpan. Sebelumnya siswa yang sudah lulus KKM lewat
                      remedial masih tampil "Tidak Lulus" di sini. Kolom ini
                      juga dipindah ke SETELAH "Nilai Akhir" (bukan sebelum)
                      supaya urutannya logis: lihat angka dulu, baru status
                      simpulannya — dan info "Nilai Akhir (PG + Essay)"
                      (rincian gabungan sebelum nilai_edit) ikut pindah ke sini. */}
                  <th>Status</th>
                  <th>Tanggal</th>
                  {/* FITUR BARU: riwayat pelanggaran (kecurangan) selama
                      ujian, supaya guru pengampu tahu kondisi siswa selama
                      ujian, bukan cuma nilai akhirnya. */}
                  <th>Pelanggaran</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((n, i) => (
                  <tr key={n.id} className={n.belum_ujian ? 'bg-slate-50/60' : ''}>
                    <td className="text-slate-400 text-xs">{i + 1}</td>
                    <td className="font-medium text-slate-800">{n.nama_siswa}</td>
                    <td><span className="badge-blue text-xs">{n.kelas}</span></td>
                    <td className="text-sm text-slate-600">{n.nama_mapel}</td>
                    {n.belum_ujian ? (
                      <>
                        <td className="text-slate-400 text-sm" colSpan={5}>—</td>
                        <td>
                          <span className="badge bg-slate-100 text-slate-500">Belum Ujian</span>
                        </td>
                        <td className="text-xs text-slate-300 text-center">—</td>
                        <td className="text-xs text-slate-400">—</td>
                        <td className="text-xs text-slate-300 text-center">—</td>
                        <td className="text-xs text-slate-300 text-center">—</td>
                      </>
                    ) : (
                      <>
                        <td>
                          <span className={`text-lg font-bold ${nilaiColor(n.nilai)}`}>{n.nilai}</span>
                        </td>
                        <td>
                          <span className={`badge font-bold ${
                            n.grade === 'A' ? 'badge-green' :
                            n.grade === 'B' ? 'badge-blue' :
                            n.grade === 'C' ? 'badge-yellow' : 'badge-red'
                          }`}>{n.grade}</span>
                        </td>
                        <td className="text-slate-600 text-sm">{n.benar}/{n.total}</td>
                        <td>
                          {!n.essay_aktif ? (
                            <span className="text-slate-300 text-xs">— PG saja —</span>
                          ) : n.nilai_essay !== null && n.nilai_essay !== undefined ? (
                            <span className={`text-sm font-bold ${nilaiColor(n.nilai_essay)}`}>{n.nilai_essay}</span>
                          ) : (
                            <span className="badge-red text-xs">Belum dinilai</span>
                          )}
                        </td>
                        <td className="text-slate-500 text-sm">{n.kkm}</td>
                        {/* FITUR BARU (hapus dualisme tab Rekap Nilai vs Kirim
                            Nilai): nilai_final sudah termasuk nilai_edit
                            (remedial) kalau pernah diinput — persis angka
                            yang akan dikirim ke wali kelas. */}
                        <td className="text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`text-lg font-bold ${nilaiColor(n.nilai_final ?? n.nilai)}`}>
                              {n.nilai_final ?? n.nilai}
                            </span>
                            <span className={`badge text-xs font-bold ${
                              n.grade_final === 'A' ? 'badge-green' :
                              n.grade_final === 'B' ? 'badge-blue' :
                              n.grade_final === 'C' ? 'badge-yellow' : 'badge-red'
                            }`}>{n.grade_final ?? n.grade}</span>
                            {n.ada_remedial && (
                              <span
                                className="badge bg-indigo-50 text-indigo-600 text-[10px]"
                                title={`Nilai sebelum remedial: ${n.nilai_efektif}`}
                              >
                                Diremedial (awal: {n.nilai_efektif})
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="flex flex-col gap-1">
                            {/* BUG FIX (Status memakai n.lulus mentah — belum
                                menghitung remedial): sebelumnya badge ini
                                selalu memakai n.lulus (status dari nilai
                                sebelum nilai_edit disimpan), jadi bisa beda
                                dengan badge di kolom Nilai Akhir untuk siswa
                                yang sudah diremedial sampai lolos KKM. Sekarang
                                pakai lulus_final — sama persis dengan yang
                                menentukan grade_final di kolom sebelah. */}
                            <span className={`badge ${(n.lulus_final ?? n.lulus) ? 'badge-green' : 'badge-red'}`}>
                              {(n.lulus_final ?? n.lulus) ? '✓ Lulus' : '✗ Tidak Lulus'}
                            </span>
                            {/* BUG FIX (nilai remedial salah tampil sebagai nilai PG
                                mentah — laporan guru): sebelumnya baris ini
                                MENYEMBUNYIKAN angka nilai_total ("belum dirilis")
                                selama essay belum dirilis ke siswa, walau nilai
                                itu sudah final untuk keperluan internal guru
                                (lulus di atas juga sudah memakainya). Ini bikin
                                guru mengira Nilai Akhir "belum ada" padahal sudah
                                ada, cuma belum boleh dilihat SISWA. Sekarang
                                angkanya selalu ditampilkan; status rilis ke
                                siswa jadi catatan terpisah, bukan penyembunyi
                                angka. */}
                            {n.essay_aktif && (
                              n.nilai_total != null ? (
                                <span className="text-xs text-slate-400">
                                  Nilai Akhir (PG + Essay): <span className={`font-bold ${nilaiColor(n.nilai_total)}`}>{n.nilai_total}</span>
                                  {!n.dirilis && <span className="text-indigo-500"> (belum dirilis ke siswa)</span>}
                                </span>
                              ) : (
                                <span className="text-xs text-red-500">Essay belum dinilai</span>
                              )
                            )}
                          </div>
                        </td>
                        <td className="text-xs text-slate-400">{formatDateTime(n.timestamp)}</td>
                        <td>
                          {(n.jumlah_pelanggaran ?? 0) > 0 ? (
                            <button
                              type="button"
                              onClick={() => setPelanggaranModal(n)}
                              className="badge-red text-xs inline-flex items-center gap-1 hover:opacity-80 transition cursor-pointer"
                              title="Lihat riwayat pelanggaran"
                            >
                              <AlertTriangle className="w-3 h-3" /> {n.jumlah_pelanggaran}
                            </button>
                          ) : (
                            <span className="badge bg-emerald-50 text-emerald-600 text-xs inline-flex items-center gap-1">
                              <ShieldCheck className="w-3 h-3" /> Bersih
                            </span>
                          )}
                        </td>
                        {/* FITUR BARU: tombol input nilai remedial — pindah
                            dari tab Kirim Nilai. Terkunci kalau nilainya
                            sudah dikirim ke wali kelas & belum dikembalikan,
                            supaya tidak berubah diam-diam di belakang wali
                            kelas (aturan sama seperti sebelumnya). */}
                        <td className="text-center">
                          <button
                            type="button"
                            onClick={() => openEdit(n)}
                            disabled={terkunci(n)}
                            className="btn-ghost btn-icon disabled:opacity-40 disabled:cursor-not-allowed"
                            title={terkunci(n)
                              ? 'Sudah dikirim ke wali kelas — tidak bisa diedit sampai dikembalikan'
                              : 'Input/ubah nilai remedial'}
                          >
                            {terkunci(n) ? <Lock className="w-4 h-4 text-slate-400" /> : <Pencil className="w-4 h-4 text-slate-500" />}
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* FITUR BARU: modal riwayat pelanggaran per siswa. Data pelanggaran
          sudah ikut terbawa di response /api/guru/nilai (lihat kolom
          `pelanggaran` per baris), jadi tidak perlu fetch tambahan saat
          modal dibuka. */}
      <Modal
        open={!!pelanggaranModal}
        onClose={() => setPelanggaranModal(null)}
        title={`Riwayat Pelanggaran — ${pelanggaranModal?.nama_siswa ?? ''}`}
        size="md"
      >
        {pelanggaranModal && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              {pelanggaranModal.nama_mapel} · Kelas {pelanggaranModal.kelas} · Ujian {formatDateTime(pelanggaranModal.timestamp)}
            </p>
            {(pelanggaranModal.pelanggaran ?? []).length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">Tidak ada riwayat pelanggaran selama ujian.</p>
            ) : (
              <ul className="space-y-2 max-h-96 overflow-y-auto">
                {pelanggaranModal.pelanggaran!.map(p => (
                  <li key={p.id} className="border border-slate-100 rounded-lg p-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-800 text-sm">
                        Pelanggaran ke-{p.level}: {terjemahJenisPelanggaran(p.jenis)}
                      </p>
                      {p.detail && <p className="text-xs text-slate-500 mt-0.5">{p.detail}</p>}
                      <p className="text-xs text-slate-400 mt-1">{formatDateTime(p.created_at)}</p>
                    </div>
                    <span className={`badge text-xs shrink-0 ${warnaStatusPelanggaran(p.status)}`}>
                      {labelStatusPelanggaran(p.status)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>

      {/* FITUR BARU (hapus dualisme tab Rekap Nilai vs Kirim Nilai): modal
          input nilai remedial — sebelumnya ini ada sebagai kolom input
          langsung di tabel tab Kirim Nilai. Setelah disimpan di sini, angka
          ini langsung tampil di kolom "Nilai Akhir" tabel Rekap Nilai DAN
          jadi nilai yang dipakai saat guru menekan "Kirim ke Wali Kelas"
          di tab sebelah — tidak ada logika baru, cuma dipindah tempatnya. */}
      <Modal
        open={!!editTarget}
        onClose={() => !savingEdit && setEditTarget(null)}
        title={`Input Nilai Remedial — ${editTarget?.nama_siswa ?? ''}`}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setEditTarget(null)} disabled={savingEdit}>
              Batal
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={simpanNilaiEdit} disabled={savingEdit}>
              {savingEdit ? (
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Simpan
            </button>
          </div>
        }
      >
        {editTarget && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              {editTarget.nama_mapel} · Kelas {editTarget.kelas}
            </p>
            {/* BUG FIX (nilai remedial salah tampil sebagai nilai PG mentah):
                sebelumnya modal ini cuma menunjukkan satu angka ambigu
                ("Nilai saat ini") yang untuk mapel ber-essay bisa berarti
                nilai PG doang — membuat guru salah kira siswa "sudah 80"
                padahal Nilai Akhir gabungannya di bawah KKM. Sekarang
                rinciannya ditampilkan eksplisit (PG, Essay kalau ada, Nilai
                Akhir gabungan) plus status Lulus/Tidak yang sebenarnya,
                supaya guru tidak salah menilai perlu-tidaknya remedial. */}
            <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5 text-sm space-y-1">
              {editTarget.essay_aktif ? (
                <>
                  <div className="flex justify-between text-slate-600">
                    <span>Nilai PG</span>
                    <span className="font-medium text-slate-700">{editTarget.nilai}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Nilai Essay</span>
                    <span className="font-medium text-slate-700">
                      {editTarget.nilai_essay != null ? editTarget.nilai_essay : 'Belum dinilai'}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-800 border-t border-slate-200 pt-1 mt-1">
                    <span className="font-medium">Nilai Akhir (PG + Essay)</span>
                    <span className="font-bold">{editTarget.nilai_efektif ?? editTarget.nilai}</span>
                  </div>
                  {editTarget.essay_belum_dirilis && (
                    <p className="text-xs text-indigo-500 pt-0.5">Belum dirilis ke siswa — tapi status di bawah sudah final.</p>
                  )}
                </>
              ) : (
                <div className="flex justify-between text-slate-800">
                  <span className="font-medium">Nilai Saat Ini</span>
                  <span className="font-bold">{editTarget.nilai_efektif ?? editTarget.nilai}</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-1">
                <span className="text-slate-500">Status</span>
                <span className={`badge text-xs font-bold ${
                  (editTarget.lulus_final ?? editTarget.lulus) ? 'badge-green' : 'badge-red'
                }`}>
                  {(editTarget.lulus_final ?? editTarget.lulus) ? '✓ Lulus' : '✗ Tidak Lulus'}
                </span>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Nilai Remedial</label>
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                placeholder="Kosongkan untuk hapus nilai remedial"
                value={editNilaiStr}
                onChange={e => setEditNilaiStr(e.target.value)}
                className="input w-full"
                autoFocus
              />
              <p className="text-xs text-slate-400 mt-1">
                Dikosongkan artinya kembali memakai nilai asli/nilai akhir hasil ujian.
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Catatan (opsional)</label>
              <input
                type="text"
                placeholder="Catatan untuk wali kelas..."
                value={editCatatan}
                onChange={e => setEditCatatan(e.target.value)}
                className="input w-full"
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
