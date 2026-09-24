// PERF: data panduan role diekstrak dari src/app/login/page.tsx agar
// file utama halaman login lebih ringkas dan bisa di-lazy-load lewat GuideModal.
import type { ReactNode } from 'react'
import {
  Shield, GraduationCap, Users, UserCheck,
  BookMarked, LayoutDashboard, ClipboardList, BarChart2, Settings,
  Eye, User, Radio,
} from 'lucide-react'

export interface RoleStep {
  title: string
  icon: ReactNode
  detail: string
}

export interface RoleData {
  id: string
  label: string
  color: string
  bgLight: string
  border: string
  text: string
  icon: ReactNode
  badge: string
  desc: string
  steps: RoleStep[]
}

export const ROLES: RoleData[] = [
  {
    id: 'admin',
    label: 'Admin',
    color: 'from-violet-500 to-purple-600',
    bgLight: 'bg-violet-50',
    border: 'border-violet-200',
    text: 'text-violet-700',
    icon: <Shield className="w-5 h-5" />,
    badge: 'bg-violet-100 text-violet-700',
    desc: 'Pengelola sistem secara keseluruhan. Memiliki akses penuh ke semua fitur.',
    steps: [
      {
        title: 'Login & Dashboard',
        icon: <LayoutDashboard className="w-4 h-4" />,
        detail: 'Login menggunakan username dan password admin. Dashboard menampilkan statistik total siswa, guru, soal, jadwal aktif, dan rata-rata nilai ujian.',
      },
      {
        title: 'Informasi Sekolah',
        icon: <Settings className="w-4 h-4" />,
        detail: 'Isi nama sekolah, NPSN, nama kepala sekolah, alamat, dan upload logo di halaman Informasi Sekolah (dibuka lewat kartu di atas tab Pengaturan). Sistem mendukung lebih dari satu sekolah.',
      },
      {
        title: 'Kelola Kelas & Mata Pelajaran',
        icon: <BookMarked className="w-4 h-4" />,
        detail: 'Buat kelas (contoh: VII-A, VIII-B) dan mata pelajaran terlebih dahulu sebelum menambahkan data lainnya. Ini menjadi fondasi data siswa dan jadwal ujian.',
      },
      {
        title: 'Kelola Siswa & Data Pengguna',
        icon: <GraduationCap className="w-4 h-4" />,
        detail: 'Tambah siswa satu per satu atau via import Excel (tombol import + template Excel ada di halaman Data Siswa). Buat akun guru dan kepala sekolah di menu Data Pengguna. Password default bisa di-reset kapan saja.',
      },
      {
        title: 'Jadwal, Validasi Soal & Pelanggaran',
        icon: <ClipboardList className="w-4 h-4" />,
        detail: 'Buat jadwal ujian dan tentukan paket soal yang digunakan. Validasi paket soal yang diajukan guru di menu Validasi Soal sebelum bisa dipakai. Pantau daftar pelanggaran siswa di menu Pelanggaran, dan lihat rekap nilai di menu Rekap Nilai / Analisis Ujian / Laporan Lengkap.',
      },
      {
        title: 'Pengaturan Ujian, Maintenance & Backup',
        icon: <BarChart2 className="w-4 h-4" />,
        detail: 'Tab Pengaturan Ujian mengatur batas pelanggaran dan jumlah opsi jawaban. Tab Maintenance mengaktifkan mode perbaikan. Lakukan backup rutin di tab Backup & Restore sebelum tahun ajaran baru atau sebelum reset. Reset data per kategori dilakukan di tab Reset Data.',
      },
      {
        title: 'Lihat Sebagai & Cetak Kartu Siswa',
        icon: <Eye className="w-4 h-4" />,
        detail: 'Tombol "Lihat Sebagai" di halaman Data Siswa/Data Pengguna memungkinkan admin masuk sebagai guru, kepala sekolah, atau siswa tertentu untuk membantu troubleshooting — otomatis kembali ke akun Admin setelah 2 jam, dan akun yang sedang "dilihat" akan melihat banner pemberitahuan. Menu Cetak (kartu ujian/kartu siswa) ada di halaman Pengaturan untuk mencetak kartu peserta ujian.',
      },
    ],
  },
  {
    id: 'kepsek',
    label: 'Kepala Sekolah',
    color: 'from-blue-500 to-cyan-600',
    bgLight: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-700',
    icon: <UserCheck className="w-5 h-5" />,
    badge: 'bg-blue-100 text-blue-700',
    desc: 'Akses monitoring dan laporan. Tidak dapat mengubah data operasional.',
    steps: [
      {
        title: 'Dashboard Kepala Sekolah',
        icon: <LayoutDashboard className="w-4 h-4" />,
        detail: 'Lihat ringkasan statistik ujian sekolah: jumlah ujian, rata-rata nilai, tingkat kelulusan, dan perkembangan per mata pelajaran.',
      },
      {
        title: 'Monitoring Ujian',
        icon: <ClipboardList className="w-4 h-4" />,
        detail: 'Pantau sesi ujian yang sedang berlangsung secara real-time — siapa yang sudah mengerjakan, siapa yang belum, dan siapa yang terkena pelanggaran.',
      },
      {
        title: 'Hasil Ujian',
        icon: <BarChart2 className="w-4 h-4" />,
        detail: 'Akses rekap nilai per kelas, per mata pelajaran, dan per siswa. Lihat analisis distribusi nilai dan persentase kelulusan untuk pengambilan keputusan.',
      },
      {
        title: 'Jadwal Ujian',
        icon: <BookMarked className="w-4 h-4" />,
        detail: 'Lihat daftar jadwal ujian yang telah dibuat — tanggal, mata pelajaran, kelas yang terlibat, dan status (belum dimulai / sedang berlangsung / selesai).',
      },
      {
        title: 'Data Kelas, Guru & Mapel, Kisi-kisi',
        icon: <BookMarked className="w-4 h-4" />,
        detail: 'Lihat daftar kelas, daftar guru beserta mata pelajaran yang diampu, dan kisi-kisi soal yang sudah dibuat guru untuk setiap mata pelajaran.',
      },
    ],
  },
  {
    id: 'guru',
    label: 'Guru',
    color: 'from-emerald-500 to-teal-600',
    bgLight: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-700',
    icon: <Users className="w-5 h-5" />,
    badge: 'bg-emerald-100 text-emerald-700',
    desc: 'Membuat soal, paket soal, dan memantau ujian mata pelajaran yang diampu.',
    steps: [
      {
        title: 'Kisi-Kisi',
        icon: <BarChart2 className="w-4 h-4" />,
        detail: 'Buat dan kelola kisi-kisi soal sebagai panduan pembuatan soal sesuai kompetensi dasar. Kisi-kisi juga bisa diakses siswa sebagai bahan belajar.',
      },
      {
        title: 'Buat Soal',
        icon: <ClipboardList className="w-4 h-4" />,
        detail: 'Menu "Buat Soal" menggantikan Bank Soal + Paket Soal yang terpisah — sekarang jadi satu tempat. Buat soal pilihan ganda dan soal essay langsung di dalam paket, tentukan jumlah soal, urutan tampil, dan waktu pengerjaan, lalu kirim, tarik, atau duplikasi paket dari halaman yang sama. Paket perlu divalidasi admin sebelum bisa dipakai.',
      },
      {
        title: 'Penilaian',
        icon: <BarChart2 className="w-4 h-4" />,
        detail: 'Satu menu dengan tiga tab: Periksa Jawaban Essay (koreksi manual jawaban essay), Rekap Nilai (nilai gabungan PG + essay per siswa), dan Kirim Nilai ke Wali Kelas.',
      },
      {
        title: 'Analisis Ujian',
        icon: <BarChart2 className="w-4 h-4" />,
        detail: 'Lihat analisis butir soal — soal mana yang mudah atau sulit, dan distribusi pilihan jawaban siswa — untuk evaluasi kualitas soal.',
      },
      {
        title: 'Wali Kelas',
        icon: <Users className="w-4 h-4" />,
        detail: 'Muncul di sidebar hanya untuk guru yang ditugaskan sebagai wali kelas. Digunakan untuk memantau dan menerima kiriman nilai siswa di kelas yang diampu.',
      },
      {
        title: 'Jadwal Pengawasan & Mode Pengawas',
        icon: <Shield className="w-4 h-4" />,
        detail: 'Muncul di sidebar hanya untuk guru yang punya jadwal jaga. "Jadwal Pengawasan" menampilkan sesi yang akan diawasi. "Mode Pengawas" dipakai untuk membuka sesi, memantau peserta secara real-time, mereset siswa yang kena pelanggaran (memberi kode lanjut), membuka/menutup akses mulai soal essay, dan menutup sesi.',
      },
      {
        title: 'Mengawasi Ujian saat Internet Mati (Mode Offline)',
        icon: <Radio className="w-4 h-4" />,
        detail: 'Kalau internet sekolah mati total, jawaban pilihan ganda siswa tetap aman — tersimpan dulu di perangkat siswa dan otomatis terkirim begitu koneksi kembali, jadi pengawas tidak perlu tindakan khusus untuk PG. Untuk soal essay, tombol "Tampilkan Kode Darurat" di Mode Pengawas akan menampilkan kode khusus per sesi — bacakan atau tuliskan kode ini di papan tulis (JANGAN lewat chat/internet) supaya siswa bisa membuka soal essay secara offline tanpa menunggu server. Begitu internet pulih, sistem otomatis menyinkronkan waktu mulai dan jawaban essay siswa yang tadinya offline.',
      },
    ],
  },
  {
    id: 'siswa',
    label: 'Siswa',
    color: 'from-orange-500 to-amber-500',
    bgLight: 'bg-orange-50',
    border: 'border-orange-200',
    text: 'text-orange-700',
    icon: <GraduationCap className="w-5 h-5" />,
    badge: 'bg-orange-100 text-orange-700',
    desc: 'Mengikuti ujian online dan melihat nilai hasil ujian.',
    steps: [
      {
        title: 'Login Siswa',
        icon: <User className="w-4 h-4" />,
        detail: 'Gunakan NIS (Nomor Induk Siswa) sebagai username. Password default biasanya adalah NIS Anda. Hubungi admin/guru jika lupa password.',
      },
      {
        title: 'Dashboard & Jadwal',
        icon: <LayoutDashboard className="w-4 h-4" />,
        detail: 'Lihat jadwal ujian yang akan datang. Ujian hanya bisa diakses sesuai jadwal yang ditetapkan — tidak bisa dikerjakan sebelum atau sesudah waktu yang ditentukan.',
      },
      {
        title: 'Mengerjakan Ujian',
        icon: <ClipboardList className="w-4 h-4" />,
        detail: 'Klik "Mulai Ujian" saat jadwal aktif. Ujian otomatis berjalan dalam mode layar penuh (fullscreen) — jangan keluar dari mode ini, menutup tab, atau berpindah aplikasi karena bisa tercatat sebagai pelanggaran. Kerjakan soal pilihan ganda dalam waktu yang tersedia; jawaban tersimpan otomatis di server. Ujian hanya boleh dibuka di satu perangkat pada satu waktu — kalau Anda login ujian yang sama di perangkat/browser lain, sesi di perangkat pertama akan otomatis terputus.',
      },
      {
        title: 'Jika Internet Terputus (Mode Offline)',
        icon: <Radio className="w-4 h-4" />,
        detail: 'Jawaban pilihan ganda tetap tersimpan di perangkat Anda dan otomatis terkirim ulang begitu koneksi kembali — status pengiriman bisa dipantau atau dipicu manual lewat menu "Pengiriman Tertunda" (muncul di sidebar hanya saat ada antrean). Untuk soal essay, jika internet mati total sebelum akses essay dibuka, minta "kode darurat" ke pengawas ruangan (dibacakan langsung, bukan lewat internet) untuk membuka soal essay secara offline; begitu internet pulih, jawaban dan waktu pengerjaan akan otomatis disinkronkan ke server.',
      },
      {
        title: 'Soal Essay (jika ada)',
        icon: <ClipboardList className="w-4 h-4" />,
        detail: 'Setelah soal pilihan ganda selesai, jika mata pelajaran punya soal essay akan ada tahap info essay terlebih dulu, lalu tahap mengerjakan essay. Essay bisa dalam mode digital (diketik di sistem) atau kertas, tergantung pengaturan guru. Mengerjakan essay baru bisa dimulai setelah pengawas membuka akses (atau lewat kode darurat jika offline).',
      },
      {
        title: 'Melihat Nilai',
        icon: <BarChart2 className="w-4 h-4" />,
        detail: 'Setelah ujian selesai dan nilai diproses, Anda bisa melihat nilai dan status kelulusan di menu Nilai. Jika mata pelajaran punya soal essay, nilai total baru muncul setelah guru selesai memeriksa essay dan merilis nilainya. Kisi-kisi soal juga tersedia sebagai panduan belajar.',
      },
      {
        title: 'Profil Saya',
        icon: <User className="w-4 h-4" />,
        detail: 'Menu "Profil Saya" menampilkan biodata lengkap Anda (kelas, wali kelas, tempat/tanggal lahir, dll) dan memungkinkan Anda mengganti password sendiri kapan saja tanpa perlu minta admin, cukup dengan memasukkan password lama.',
      },
    ],
  },
]
