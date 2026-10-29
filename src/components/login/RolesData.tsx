// PERF: data panduan role diekstrak dari src/app/login/page.tsx agar
// file utama halaman login lebih ringkas dan bisa di-lazy-load lewat TentangModal (tab Panduan).
//
// Bahasa sengaja dibuat sederhana dan sehari-hari: tidak semua pengguna paham
// istilah IT. Nama menu ditulis persis seperti yang tampil di aplikasi.
import type { ReactNode } from 'react'
import {
  Shield, GraduationCap, Users, UserCheck,
  BookMarked, LayoutDashboard, ClipboardList, BarChart2, Settings,
  Eye, User, Radio, CalendarDays, FileUp,
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
    desc: 'Pengelola aplikasi (Super Admin) untuk semua sekolah atau jenjang di akun Anda. Bisa memakai semua fitur.',
    steps: [
      {
        title: 'Masuk & Halaman Depan',
        icon: <LayoutDashboard className="w-4 h-4" />,
        detail: 'Masuk memakai username dan password admin. Halaman depan menampilkan ringkasan: jumlah siswa, guru, soal, jadwal yang aktif, dan rata-rata nilai ujian.',
      },
      {
        title: 'Informasi Sekolah',
        icon: <Settings className="w-4 h-4" />,
        detail: 'Buka Informasi Sekolah lewat kartu di atas tab Pengaturan. Tambahkan setiap sekolah atau jenjang yang Anda kelola, lalu isi nama sekolah, NPSN, nama kepala sekolah, alamat, dan logo. Satu akun bisa mengelola lebih dari satu sekolah.',
      },
      {
        title: 'Atur Kelas & Mata Pelajaran',
        icon: <BookMarked className="w-4 h-4" />,
        detail: 'Buat kelas lebih dulu sesuai penamaan di sekolah Anda (contoh: VII-A, X TKJ 1, XI IPA 2), lalu mata pelajaran. Keduanya jadi dasar untuk data siswa dan jadwal ujian.',
      },
      {
        title: 'Atur Siswa & Akun Pengguna',
        icon: <GraduationCap className="w-4 h-4" />,
        detail: 'Tambah siswa satu per satu, atau sekaligus lewat file Excel (tombol dan contoh formatnya ada di halaman Data Siswa). Akun guru dan kepala sekolah dibuat di menu Data Pengguna. Password bisa dikembalikan ke password awal kapan saja.',
      },
      {
        title: 'Jadwal, Persetujuan Soal & Pelanggaran',
        icon: <ClipboardList className="w-4 h-4" />,
        detail: 'Buat jadwal ujian dan pilih paket soalnya. Lama waktu essay Anda yang menentukan di jadwal; guru hanya memberi usulan. Paket soal dari guru harus Anda setujui dulu di menu Validasi Soal sebelum bisa dipakai. Daftar pelanggaran siswa ada di menu Pelanggaran. Nilai bisa dilihat di menu Rekap Nilai, Analisis Ujian, dan Laporan Lengkap.',
      },
      {
        title: 'Pengaturan Ujian & Cadangan Data',
        icon: <BarChart2 className="w-4 h-4" />,
        detail: 'Di tab Pengaturan Ujian Anda bisa mengatur: batas pelanggaran, jumlah pilihan jawaban (bisa dikunci supaya guru tidak mengubahnya), waktu paling cepat siswa boleh mengirim jawaban, batas lama essay, dan jumlah soal minimal untuk tiap mata pelajaran. Waktu paling cepat mengirim jawaban tidak bisa diubah selama ada ujian yang sedang berjalan. Buat cadangan data secara rutin di tab Backup & Restore, terutama sebelum tahun ajaran baru atau sebelum menghapus data. Penghapusan data per kategori ada di tab Reset Data.',
      },
      {
        title: 'Jumlah Soal Minimal (pilihan)',
        icon: <ClipboardList className="w-4 h-4" />,
        detail: 'Di Pengaturan ▸ Pengaturan Ujian ada kartu "Batas Minimal Jumlah Soal" (awalnya mati). Fungsinya memastikan paket soal cukup banyak sebelum guru mengirimnya. Nyalakan, lalu untuk PG dan Essay buat kelompok batas (misalnya 30 soal dan 35 soal) dan centang mata pelajaran yang masuk tiap kelompok. Mata pelajaran yang tidak dicentang tetap minimal 1 soal. Aturan ini dicek saat guru menekan Kirim, jadi paket yang sudah terkirim atau disetujui tidak terpengaruh.',
      },
      {
        title: 'Admin Kelas (pilihan)',
        icon: <UserCheck className="w-4 h-4" />,
        detail: 'Di menu Admin Kelas, nyalakan fitur ini (awalnya mati), lalu pilih seorang guru untuk menyetujui paket soal di kelas tertentu (satu kelas satu Admin Kelas). Kelas yang belum punya Admin Kelas tetap Anda periksa sendiri di menu Validasi Soal. Mematikan fitur ini tidak menghapus penunjukan yang sudah dibuat.',
      },
      {
        title: 'Izin Layar Pantau & Ujian Susulan',
        icon: <Radio className="w-4 h-4" />,
        detail: 'Guru yang ingin membuka Layar Pantau (papan nilai langsung untuk layar besar, hanya di laptop/komputer) perlu izin Anda di menu Izin Layar Pantau. Izin bisa disetujui, ditolak, atau dicabut, dan berlaku 10 jam. Untuk siswa yang terhalang (misalnya listrik mati), buka ujian susulan dari menu Jadwal Ujian lalu pilih guru pengawasnya. Susulan tidak bisa dibuka kalau jadwal itu masih punya ujian yang sedang berjalan.',
      },
      {
        title: 'Lihat Sebagai & Cetak Kartu Siswa',
        icon: <Eye className="w-4 h-4" />,
        detail: 'Tombol "Lihat Sebagai" di halaman Data Siswa atau Data Pengguna membuat Anda bisa masuk sementara sebagai guru, kepala sekolah, atau siswa tertentu untuk membantu mencari masalah. Setelah 2 jam Anda otomatis kembali ke akun Admin, dan pemilik akun melihat pemberitahuan bahwa akunnya sedang dilihat. Kartu peserta ujian dicetak lewat menu Cetak di halaman Pengaturan.',
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
    desc: 'Memantau ujian dan melihat laporan. Tidak bisa mengubah data.',
    steps: [
      {
        title: 'Halaman Depan Kepala Sekolah',
        icon: <LayoutDashboard className="w-4 h-4" />,
        detail: 'Lihat ringkasan ujian sekolah: jumlah ujian, rata-rata nilai, berapa persen siswa yang lulus, dan perkembangan tiap mata pelajaran.',
      },
      {
        title: 'Memantau Ujian',
        icon: <ClipboardList className="w-4 h-4" />,
        detail: 'Pantau ujian yang sedang berjalan secara langsung: siapa yang sudah mengerjakan, siapa yang belum, dan siapa yang melanggar aturan.',
      },
      {
        title: 'Hasil Ujian',
        icon: <BarChart2 className="w-4 h-4" />,
        detail: 'Lihat rekap nilai per kelas, per mata pelajaran, dan per siswa, termasuk sebaran nilai dan persentase kelulusan sebagai bahan mengambil keputusan.',
      },
      {
        title: 'Jadwal Ujian',
        icon: <BookMarked className="w-4 h-4" />,
        detail: 'Lihat daftar jadwal ujian: tanggal, mata pelajaran, kelas yang ikut, dan statusnya (belum mulai, sedang berjalan, atau selesai).',
      },
      {
        title: 'Data Kelas, Guru & Mapel, Kisi-kisi',
        icon: <BookMarked className="w-4 h-4" />,
        detail: 'Lihat daftar kelas, daftar guru beserta mata pelajaran yang diajarnya, dan kisi-kisi soal buatan guru. Anda hanya melihat data sekolah Anda sendiri. Kalau datanya kosong, minta Admin menghubungkan akun Anda dengan sekolah.',
      },
      {
        title: 'Layar Pantau',
        icon: <Radio className="w-4 h-4" />,
        detail: 'Tombol Layar Pantau di beranda login (hanya muncul di laptop/komputer) menampilkan papan nilai ujian secara langsung untuk layar besar. Kepala Sekolah tidak perlu izin Admin, cukup masuk. Papan baru berisi data kalau ada ujian yang sedang berjalan.',
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
    desc: 'Membuat soal dan paket soal, serta memantau ujian mata pelajaran yang Anda ajar.',
    steps: [
      {
        title: 'Kisi-Kisi',
        icon: <BarChart2 className="w-4 h-4" />,
        detail: 'Buat dan kelola kisi-kisi sebagai pegangan dalam membuat soal sesuai kompetensi dasar. Siswa juga bisa membukanya untuk belajar.',
      },
      {
        title: 'Buat Soal',
        icon: <ClipboardList className="w-4 h-4" />,
        detail: 'Menu "Buat Soal" menyatukan Bank Soal dan Paket Soal yang dulu terpisah. Buat soal pilihan ganda dan essay langsung di dalam paket, atur jumlah soal, urutan tampil, dan waktu pengerjaan. Paket juga bisa dikirim, ditarik kembali, atau digandakan dari halaman yang sama. Paket harus disetujui admin sebelum bisa dipakai. Setelah paket dikirim atau disetujui, soal di dalamnya terkunci: tidak bisa ditambah, diubah, atau dihapus. Kalau Admin menyalakan batas minimal jumlah soal, paket yang soalnya kurang tidak bisa dikirim (pesannya menyebut batas dan jumlah soal Anda saat ini). Saat Anda mengirim paket PG atau Essay, aplikasi bertanya apakah pasangannya (mata pelajaran dan kelas yang sama) ikut dikirim; pasangan yang soalnya masih kurang tidak ikut terkirim. Paket yang ditolak bisa diperbaiki lalu dikirim lagi.',
      },
      {
        title: 'Masukkan Soal dari Word',
        icon: <FileUp className="w-4 h-4" />,
        detail: 'Punya banyak soal? Klik tombol "Impor dari Word" di halaman Buat Soal (untuk PG maupun Essay). (1) Unduh contoh format Word, lalu tentukan jumlah tabel soal (dan 4 atau 5 pilihan jawaban untuk PG). (2) Isi satu tabel untuk tiap nomor soal, hanya di kolom kuning; kolom biru (nama baris) jangan diubah. Tulisan soal dan gambar soal ditaruh di kotak yang sama: klik di dalam kotak Soal, lalu Sisipkan ▸ Gambar (satu gambar per kotak, format PNG atau JPG; caranya sama untuk pilihan jawaban bergambar). Tabel oranye di bagian awal hanya contoh dan otomatis diabaikan. (3) Unggah file .docx, lalu periksa tampilan awalnya: soal yang bermasalah ditandai merah beserta alasannya, dan soal yang persis sama dengan yang sudah ada di paket ditandai kuning dan tidak dimasukkan lagi, jadi aman kalau file yang sama tidak sengaja terunggah dua kali. (4) Klik Impor. Tidak ada soal yang tersimpan sebelum tombol Impor ditekan. Soal essay wajib diberi bobot, dan maksimal 200 soal sekali impor. Setelah berhasil, soal muncul di daftar "Soal yang sudah dibuat", sedangkan form di atasnya untuk soal berikutnya (misalnya "Soal ke-6" setelah memasukkan 5 soal).',
      },
      {
        title: 'Jadwal Mapel Saya',
        icon: <CalendarDays className="w-4 h-4" />,
        detail: 'Daftar jadwal ujian untuk mata pelajaran yang Anda ajar (berbeda dengan tugas mengawas). Berguna untuk memastikan paket soal sudah disetujui dan siap sebelum hari ujian.',
      },
      {
        title: 'Penilaian',
        icon: <BarChart2 className="w-4 h-4" />,
        detail: 'Satu menu dengan tiga tab: Periksa Jawaban Essay (menilai jawaban essay sendiri), Rekap Nilai (nilai gabungan PG dan essay tiap siswa), dan Kirim Nilai ke Wali Kelas.',
      },
      {
        title: 'Analisis Ujian',
        icon: <BarChart2 className="w-4 h-4" />,
        detail: 'Lihat soal mana yang mudah atau sulit, dan jawaban apa yang paling banyak dipilih siswa, untuk menilai mutu soal Anda.',
      },
      {
        title: 'Jadwal Mengawas Saya',
        icon: <Shield className="w-4 h-4" />,
        detail: 'Muncul di menu samping hanya untuk guru yang punya jadwal jaga. Ada 2 tab: "Jadwal Mengawas" berisi ujian yang akan Anda awasi, dan "Mode Pengawas" untuk membuka ujian, memantau peserta secara langsung, mengaktifkan kembali siswa yang kena pelanggaran (dengan memberi kode lanjut), membuka atau menutup izin mulai soal essay, dan menutup ujian. Kalau ada ujian yang sedang berjalan, halaman ini langsung terbuka di tab Mode Pengawas.',
      },
      {
        title: 'Mengawasi Saat Internet Mati',
        icon: <Radio className="w-4 h-4" />,
        detail: 'Kalau internet sekolah mati total, jawaban pilihan ganda siswa tetap aman: disimpan dulu di HP atau laptop siswa dan terkirim sendiri begitu internet kembali, jadi pengawas tidak perlu berbuat apa-apa untuk soal PG. Untuk soal essay, tombol "Tampilkan Kode Darurat" di Mode Pengawas menampilkan kode khusus untuk ujian itu. Bacakan atau tulis kode ini di papan tulis (JANGAN lewat chat atau internet) supaya siswa bisa membuka soal essay tanpa internet. Begitu internet pulih, waktu mulai dan jawaban essay siswa otomatis terkirim.',
      },
      {
        title: 'Wali Kelas',
        icon: <Users className="w-4 h-4" />,
        detail: 'Muncul di menu samping hanya untuk guru yang ditunjuk sebagai wali kelas. Dipakai untuk memantau dan menerima nilai siswa yang dikirim guru mata pelajaran.',
      },
      {
        title: 'Admin Kelas (jika ditunjuk)',
        icon: <UserCheck className="w-4 h-4" />,
        detail: 'Muncul di menu samping hanya untuk guru yang ditunjuk Admin, dan hanya kalau fitur Admin Kelas dinyalakan. Anda menyetujui atau menolak paket soal untuk kelas yang jadi tanggung jawab Anda; kelas lain tetap diperiksa Admin.',
      },
      {
        title: 'Layar Pantau (perlu izin Admin)',
        icon: <Radio className="w-4 h-4" />,
        detail: 'Papan nilai ujian secara langsung untuk layar besar atau TV, dibuka lewat tombol Layar Pantau di beranda login (hanya di laptop/komputer). Guru harus mendapat izin Admin lebih dulu; izin berlaku 10 jam, setelah itu ajukan lagi.',
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
    desc: 'Mengerjakan ujian online dan melihat nilai.',
    steps: [
      {
        title: 'Masuk sebagai Siswa',
        icon: <User className="w-4 h-4" />,
        detail: 'Gunakan NISN (Nomor Induk Siswa Nasional) sebagai username. Password awal biasanya juga NISN Anda. Kalau lupa password, hubungi admin atau guru.',
      },
      {
        title: 'Beranda & Jadwal',
        icon: <LayoutDashboard className="w-4 h-4" />,
        detail: 'Lihat jadwal ujian yang akan datang. Ujian hanya bisa dibuka sesuai jadwal: tidak bisa dikerjakan sebelum atau sesudah waktunya. Saat pengawas sudah membuka ujian dan Anda belum mengikutinya, muncul pemberitahuan setelah Anda masuk, serta angka kecil pada menu Beranda dan Mulai Ujian. Buka menu Mulai Ujian untuk masuk.',
      },
      {
        title: 'Mengerjakan Ujian',
        icon: <ClipboardList className="w-4 h-4" />,
        detail: 'Klik "Mulai Ujian" saat jadwal sudah aktif. Ujian otomatis berjalan dalam layar penuh. Jangan keluar dari layar penuh, menutup halaman, atau pindah ke aplikasi lain, karena langsung dicatat sebagai pelanggaran dan ujian Anda berhenti sementara. Untuk lanjut, minta kode 7 karakter ke pengawas. Kerjakan soal pilihan ganda dalam waktu yang tersedia; jawaban tersimpan otomatis. Ujian hanya bisa dibuka di satu perangkat dalam satu waktu: kalau Anda masuk ke ujian yang sama di perangkat lain, ujian di perangkat pertama otomatis terputus.',
      },
      {
        title: 'Kalau Internet Terputus',
        icon: <Radio className="w-4 h-4" />,
        detail: 'Jawaban pilihan ganda tetap tersimpan di perangkat Anda dan terkirim ulang sendiri begitu internet kembali. Status pengiriman bisa dilihat, atau dikirim manual, lewat menu "Pengiriman Tertunda" (hanya muncul di menu samping kalau ada yang menunggu). Untuk soal essay, kalau internet mati total sebelum essay dibuka, minta "kode darurat" ke pengawas (dibacakan langsung, bukan lewat internet) agar soal essay bisa dibuka tanpa internet. Begitu internet pulih, jawaban dan waktu pengerjaan Anda terkirim otomatis.',
      },
      {
        title: 'Soal Essay (jika ada)',
        icon: <ClipboardList className="w-4 h-4" />,
        detail: 'Setelah soal pilihan ganda selesai, kalau mata pelajaran itu punya essay, akan ada halaman penjelasan essay dulu, lalu tahap mengerjakan essay. Essay bisa diketik di layar atau ditulis di kertas, tergantung pilihan guru. Essay baru bisa dimulai setelah pengawas membukanya (atau lewat kode darurat kalau tidak ada internet).',
      },
      {
        title: 'Melihat Nilai',
        icon: <BarChart2 className="w-4 h-4" />,
        detail: 'Setelah ujian selesai dan nilai diproses, lihat nilai dan keterangan lulus di menu Nilai Saya. Kalau mata pelajaran punya essay, nilai total baru muncul setelah guru selesai memeriksa essay dan mengumumkan nilainya. Kisi-kisi soal juga bisa dibuka sebagai bahan belajar.',
      },
      {
        title: 'Profil Saya',
        icon: <User className="w-4 h-4" />,
        detail: 'Menu "Profil Saya" menampilkan data diri Anda (kelas, wali kelas, tempat dan tanggal lahir, dll). Di sini Anda juga bisa mengganti password sendiri kapan saja tanpa minta admin, cukup dengan memasukkan password lama.',
      },
    ],
  },
]
