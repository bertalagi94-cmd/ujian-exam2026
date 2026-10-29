// Isi tab "Fitur" di jendela Tentang (beranda login).
//
// Ditulis dengan bahasa sehari-hari — tidak semua pengguna paham istilah IT.
// Hindari kata seperti server, sinkron, real-time, browser, dsb. di sini.
'use client'

import type { ReactNode } from 'react'
import {
  Smartphone, WifiOff, Save, ShieldCheck, FileText, FileUp, Calculator,
  Activity, Monitor, RotateCcw, ClipboardCheck, BarChart3, Printer,
  Building2, BookOpen, KeyRound, Users, School,
} from 'lucide-react'

interface Fitur {
  icon: ReactNode
  judul: string
  isi: string
}

interface KelompokFitur {
  judul: string
  keterangan: string
  warna: string      // gradien ikon
  teks: string       // warna judul kelompok
  latar: string      // latar kartu
  garis: string      // garis kartu
  daftar: Fitur[]
}

const ic = 'w-4 h-4'

const KELOMPOK: KelompokFitur[] = [
  {
    judul: 'Untuk Siswa',
    keterangan: 'Mengerjakan ujian dengan nyaman dan tenang.',
    warna: 'from-orange-500 to-amber-500',
    teks: 'text-orange-700',
    latar: 'bg-orange-50',
    garis: 'border-orange-200',
    daftar: [
      {
        icon: <Smartphone className={ic} />,
        judul: 'Bisa lewat HP maupun laptop',
        isi: 'Ujian bisa dikerjakan dari HP atau laptop, tanpa perlu memasang aplikasi tambahan. Cukup buka halaman ini dan masuk.',
      },
      {
        icon: <Save className={ic} />,
        judul: 'Jawaban tersimpan sendiri',
        isi: 'Setiap kali Anda memilih jawaban, jawaban itu langsung disimpan. Tidak ada tombol simpan yang perlu ditekan, dan tidak perlu cemas kalau layar sempat berhenti sebentar.',
      },
      {
        icon: <WifiOff className={ic} />,
        judul: 'Tetap aman walau sinyal hilang',
        isi: 'Kalau internet tiba-tiba putus, jawaban pilihan ganda Anda disimpan dulu di HP atau laptop, lalu dikirim sendiri begitu sinyal kembali. Untuk soal essay, pengawas bisa memberi "kode darurat" supaya soal tetap bisa dibuka.',
      },
      {
        icon: <BookOpen className={ic} />,
        judul: 'Kisi-kisi untuk belajar',
        isi: 'Kisi-kisi soal dari guru bisa dibuka kapan saja sebagai bahan belajar sebelum ujian.',
      },
      {
        icon: <BarChart3 className={ic} />,
        judul: 'Lihat nilai sendiri',
        isi: 'Setelah ujian selesai dan nilai sudah diproses, nilai dan keterangan lulus atau belumnya bisa dilihat di menu Nilai Saya.',
      },
    ],
  },
  {
    judul: 'Untuk Guru & Pengawas',
    keterangan: 'Menyiapkan soal, mengawasi, dan menilai jadi lebih ringan.',
    warna: 'from-emerald-500 to-teal-600',
    teks: 'text-emerald-700',
    latar: 'bg-emerald-50',
    garis: 'border-emerald-200',
    daftar: [
      {
        icon: <FileText className={ic} />,
        judul: 'Soal pilihan ganda dan essay',
        isi: 'Guru bisa membuat soal pilihan ganda maupun essay dalam satu tempat. Essay bisa dijawab dengan diketik di layar atau ditulis di kertas, sesuai pilihan guru.',
      },
      {
        icon: <FileUp className={ic} />,
        judul: 'Masukkan banyak soal dari Word',
        isi: 'Sudah punya soal di dokumen Word? Tidak perlu mengetik ulang. Isi format yang disediakan, unggah, lalu soalnya masuk sekaligus. Soal yang kembar atau salah isi akan ditandai lebih dulu supaya bisa diperbaiki.',
      },
      {
        icon: <Calculator className={ic} />,
        judul: 'Nilai dihitung otomatis',
        isi: 'Nilai pilihan ganda langsung dihitung begitu siswa selesai. Guru tinggal memeriksa essay, lalu nilai gabungannya muncul sendiri.',
      },
      {
        icon: <Activity className={ic} />,
        judul: 'Pantau peserta saat ujian',
        isi: 'Pengawas bisa melihat siapa yang sedang mengerjakan, siapa yang belum mulai, dan siapa yang melanggar aturan, tanpa harus berkeliling ruangan terus-menerus.',
      },
      {
        icon: <RotateCcw className={ic} />,
        judul: 'Ujian susulan',
        isi: 'Kalau ada siswa yang terhalang, misalnya listrik padam, pengawas atau admin bisa membukakan ujian susulan dengan kode baru. Jawaban yang sudah terisi sebelumnya tidak hilang.',
      },
      {
        icon: <Users className={ic} />,
        judul: 'Kirim nilai ke wali kelas',
        isi: 'Guru mata pelajaran bisa mengirim nilai langsung ke wali kelas, jadi tidak perlu rekap manual.',
      },
      {
        icon: <BarChart3 className={ic} />,
        judul: 'Tahu soal mana yang sulit',
        isi: 'Ada analisis yang menunjukkan soal mana yang terlalu mudah atau terlalu sulit, supaya guru bisa memperbaiki soal untuk ujian berikutnya.',
      },
    ],
  },
  {
    judul: 'Untuk Kepala Sekolah & Admin',
    keterangan: 'Memantau, mengatur, dan menjaga semuanya tetap rapi.',
    warna: 'from-violet-500 to-purple-600',
    teks: 'text-violet-700',
    latar: 'bg-violet-50',
    garis: 'border-violet-200',
    daftar: [
      {
        icon: <ClipboardCheck className={ic} />,
        judul: 'Soal diperiksa dulu sebelum dipakai',
        isi: 'Soal yang dikirim guru diperiksa admin (atau guru yang ditunjuk) lebih dulu. Admin juga bisa menetapkan jumlah soal minimal supaya paket soal tidak terlalu sedikit.',
      },
      {
        icon: <Building2 className={ic} />,
        judul: 'Kelola jadwal, kelas, dan data',
        isi: 'Jadwal ujian, kelas, mata pelajaran, data siswa, dan akun guru diatur dari satu tempat. Data siswa bisa dimasukkan sekaligus dari file Excel.',
      },
      {
        icon: <BarChart3 className={ic} />,
        judul: 'Laporan dan rekap nilai',
        isi: 'Nilai bisa dilihat per kelas, per mata pelajaran, atau per siswa, lengkap dengan gambaran berapa banyak yang lulus. Kepala Sekolah hanya melihat, tidak bisa mengubah data.',
      },
      {
        icon: <Monitor className={ic} />,
        judul: 'Layar Pantau untuk layar besar',
        isi: 'Papan nilai ujian yang bisa ditampilkan di TV atau proyektor, dan terus diperbarui selama ujian berjalan. Dibuka lewat laptop atau komputer.',
      },
      {
        icon: <Printer className={ic} />,
        judul: 'Cetak kartu peserta',
        isi: 'Kartu ujian untuk siswa bisa dicetak langsung dari aplikasi.',
      },
      {
        icon: <KeyRound className={ic} />,
        judul: 'Bantu pengguna yang kesulitan',
        isi: 'Admin bisa melihat tampilan akun guru atau siswa untuk membantu menyelesaikan masalah, tanpa perlu tahu password mereka. Admin juga bisa mengatur ulang password pengguna yang lupa.',
      },
      {
        icon: <Save className={ic} />,
        judul: 'Cadangan data',
        isi: 'Data bisa dicadangkan dan dipulihkan lagi bila diperlukan, jadi aman saat pergantian tahun ajaran.',
      },
      {
        icon: <School className={ic} />,
        judul: 'Satu akun untuk beberapa sekolah',
        isi: 'Satu akun admin bisa mengelola lebih dari satu sekolah atau jenjang, dan satu guru bisa mengajar di beberapa sekolah memakai satu akun saja.',
      },
    ],
  },
  {
    judul: 'Penjaga Kejujuran Ujian',
    keterangan: 'Berlaku untuk semua peserta agar ujian tetap adil.',
    warna: 'from-sky-500 to-blue-600',
    teks: 'text-sky-700',
    latar: 'bg-sky-50',
    garis: 'border-sky-200',
    daftar: [
      {
        icon: <ShieldCheck className={ic} />,
        judul: 'Layar penuh dan pengingat pelanggaran',
        isi: 'Ujian berjalan dalam layar penuh. Kalau siswa berpindah aplikasi, membuka halaman lain, atau keluar dari layar penuh, ujiannya berhenti sementara dan baru bisa dilanjutkan dengan kode dari pengawas. Ini menjaga agar semua siswa diperlakukan sama.',
      },
      {
        icon: <Smartphone className={ic} />,
        judul: 'Satu ujian, satu perangkat',
        isi: 'Satu ujian hanya bisa dibuka di satu HP atau laptop dalam satu waktu, sehingga tidak bisa dikerjakan bergantian di dua perangkat.',
      },
    ],
  },
]

export default function FiturPanel() {
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <h3 className="font-bold text-sm text-slate-800">Apa itu SmartExam?</h3>
        <p className="text-sm text-slate-600 leading-relaxed mt-1">
          SmartExam adalah aplikasi ujian di layar HP atau laptop. Guru membuat soal, admin menjadwalkan,
          siswa mengerjakan, dan nilai langsung diolah. Berikut hal-hal yang bisa dilakukan aplikasi ini.
        </p>
      </div>

      {KELOMPOK.map(k => (
        <section key={k.judul}>
          <div className="flex items-center gap-2.5 mb-3">
            <span className={`w-1.5 h-8 rounded-full bg-gradient-to-b ${k.warna}`} />
            <div>
              <h3 className={`font-bold text-sm sm:text-base ${k.teks}`}>{k.judul}</h3>
              <p className="text-xs text-slate-500">{k.keterangan}</p>
            </div>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {k.daftar.map(f => (
              <div key={f.judul} className={`rounded-xl border ${k.garis} ${k.latar} p-3.5`}>
                <div className="flex items-start gap-3">
                  <span className={`w-8 h-8 rounded-lg bg-gradient-to-br ${k.warna} text-white flex items-center justify-center flex-shrink-0`}>
                    {f.icon}
                  </span>
                  <div className="min-w-0">
                    <h4 className={`font-semibold text-sm ${k.teks}`}>{f.judul}</h4>
                    <p className="text-[13px] text-slate-600 leading-relaxed mt-0.5">{f.isi}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
