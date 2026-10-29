// Q&A / Bantuan di beranda login — DIKELOMPOKKAN PER PERAN supaya pembaca
// langsung menemukan pertanyaan yang sesuai dengan akunnya (Siswa, Guru,
// Kepala Sekolah, Admin). Tab "Umum" hanya berisi hal yang berlaku untuk semua.
//
// Catatan isi:
//   - Pengawas, Wali Kelas, dan Admin Kelas BUKAN akun terpisah: itu tugas
//     tambahan akun Guru, jadi pertanyaannya ada di tab Guru.
//   - "Admin" di sini = Super Admin (pengelola sistem sekolah/yayasan).
//
// PERF: data diekstrak dari src/app/login/page.tsx dan di-lazy-load lewat TentangModal (tab Q&A).
import type { ReactNode } from 'react'
import { Info, GraduationCap, Users, UserCheck, Shield } from 'lucide-react'

export interface QaEntry {
  q: string
  a: string
}

export interface QaGroup {
  category: string
  items: QaEntry[]
}

export type QaRoleId = 'umum' | 'siswa' | 'guru' | 'kepsek' | 'admin'

export interface QaRole {
  id: QaRoleId
  label: string
  /** Kalimat "untuk siapa" yang tampil di atas daftar pertanyaan. */
  untuk: string
  icon: ReactNode
  text: string
  bg: string
  border: string
  gradient: string
  groups: QaGroup[]
}

export const QA_ROLES: QaRole[] = [
  // ───────────────────────────── UMUM ─────────────────────────────
  {
    id: 'umum',
    label: 'Umum',
    untuk: 'Berlaku untuk semua pengguna, apa pun peran Anda.',
    icon: <Info className="w-4 h-4" />,
    text: 'text-slate-700',
    bg: 'bg-slate-50',
    border: 'border-slate-200',
    gradient: 'from-slate-500 to-slate-700',
    groups: [
      {
        category: 'Tentang SmartExam',
        items: [
          {
            q: 'Apa itu SmartExam?',
            a: 'SmartExam adalah sistem ujian berbasis komputer (CBT) untuk berbagai sekolah dan jenjang — bisa dikerjakan lewat HP maupun laptop/komputer. Guru membuat soal dan paket soal, admin memvalidasi dan menjadwalkan ujian, dan siswa mengerjakan ujian secara online dengan pengawasan real-time.',
          },
          {
            q: 'Ada peran apa saja, dan saya termasuk yang mana?',
            a: 'Ada empat jenis akun: (1) Siswa — login dengan NISN. (2) Guru — membuat soal, memeriksa essay, dan bisa merangkap tugas tambahan. (3) Kepala Sekolah — memantau ujian dan hasilnya. (4) Admin (Super Admin) — pengelola sistem sekolah. Pengawas, Wali Kelas, dan Admin Kelas bukan akun terpisah: itu tugas tambahan yang diberikan admin kepada akun Guru, dan menunya muncul otomatis di sidebar guru tersebut. Pilih tab peran Anda di atas untuk melihat pertanyaan yang sesuai.',
          },
          {
            q: 'Browser apa yang direkomendasikan?',
            a: 'Kebanyakan siswa mengerjakan ujian lewat HP, jadi gunakan Chrome versi terbaru di Android atau Safari versi terbaru di iPhone/iPad. Di laptop/komputer, gunakan Google Chrome atau Mozilla Firefox versi terbaru. Hindari browser lama, dan pastikan JavaScript aktif.',
          },
          {
            q: 'Apakah bisa digunakan di HP?',
            a: 'Bisa, dan justru inilah cara paling umum siswa mengerjakan ujian — tampilan dan sistem anti-kecurangan (layar penuh, deteksi pindah aplikasi, dll) sudah dirancang untuk HP. Pastikan baterai cukup, HP tidak dalam mode hemat baterai/data yang agresif, dan notifikasi lain di-silent dulu supaya tidak terpicu pindah aplikasi.',
          },
        ],
      },
      {
        category: 'Bantuan Umum',
        items: [
          {
            q: 'Halaman error atau tidak bisa dibuka, apa yang harus dilakukan?',
            a: 'Coba muat ulang halaman (F5 atau tarik layar ke bawah di HP). Jika masih error, tunggu beberapa menit lalu coba lagi. Siswa: beri tahu pengawas ruangan. Guru dan Kepala Sekolah: beri tahu admin sekolah. Admin: lihat pertanyaan di tab Admin.',
          },
          {
            q: 'Masalah saya tidak ada di daftar ini',
            a: 'Hubungi Admin sekolah Anda. Siswa cukup menyampaikan ke pengawas atau guru, yang akan meneruskannya ke admin.',
          },
        ],
      },
    ],
  },

  // ───────────────────────────── SISWA ─────────────────────────────
  {
    id: 'siswa',
    label: 'Siswa',
    untuk: 'Untuk siswa yang login memakai NISN.',
    icon: <GraduationCap className="w-4 h-4" />,
    text: 'text-orange-700',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    gradient: 'from-orange-500 to-amber-500',
    groups: [
      {
        category: 'Login & Akun',
        items: [
          {
            q: 'Username dan password saya apa?',
            a: 'Username Anda adalah NISN (Nomor Induk Siswa Nasional). Password awalnya biasanya juga NISN Anda. Setelah masuk, sebaiknya ganti sendiri lewat menu Profil Saya.',
          },
          {
            q: 'Saya lupa password, bagaimana cara reset?',
            a: 'Kalau Anda masih ingat password lama, ganti sendiri lewat menu Profil Saya (cukup masukkan password lama). Kalau benar-benar lupa, minta guru atau admin sekolah untuk mereset passwordnya.',
          },
        ],
      },
      {
        category: 'Sebelum Ujian',
        items: [
          {
            q: 'Bagaimana saya tahu ujian sudah dibuka oleh pengawas?',
            a: 'Setelah pengawas membuka sesi, muncul angka kecil berwarna merah pada menu Beranda dan Mulai Ujian selama Anda belum menyelesaikan ujian tersebut. Jika sesi sudah terbuka saat Anda login, tampil juga pemberitahuan satu kali. Untuk memulai, buka menu Mulai Ujian dan masukkan kode ujian dari pengawas.',
          },
          {
            q: 'Menu Mulai Ujian tidak ada, kenapa?',
            a: 'Menu Mulai Ujian hanya muncul kalau Anda punya ujian yang bisa diikuti: ujian yang dijadwalkan hari ini, atau sesi (termasuk susulan) yang sedang dibuka pengawas dan belum Anda ikuti. Cek menu Jadwal untuk melihat jadwal Anda. Kalau seharusnya ada ujian tetapi menunya tidak muncul, beri tahu pengawas atau guru.',
          },
          {
            q: 'Siswa tidak muncul di daftar peserta ujian',
            a: 'Beri tahu pengawas atau guru. Penyebab umumnya: Anda belum terdaftar di kelas yang dijadwalkan, atau baru ditambahkan setelah sesi dibuat. Admin yang akan memeriksa data kelas Anda.',
          },
        ],
      },
      {
        category: 'Saat Ujian',
        items: [
          {
            q: 'Apakah jawaban tersimpan otomatis?',
            a: 'Ya, setiap jawaban yang dipilih langsung tersimpan otomatis. Tidak perlu khawatir jika koneksi terputus sebentar — jawaban yang sudah dijawab tetap aman.',
          },
          {
            q: 'Apa yang dimaksud dengan pelanggaran?',
            a: 'Sistem mendeteksi jika Anda berpindah tab, meminimalkan jendela browser, keluar dari layar penuh, atau membuka aplikasi lain. Setiap deteksi langsung menghentikan ujian Anda sementara (status RESET). Untuk lanjut, Anda perlu kode 7 karakter dari pengawas. Jumlah pelanggaran yang melebihi batas dari admin dipakai pengawas untuk memutuskan apakah akun perlu dikunci permanen.',
          },
          {
            q: 'Status ujian saya "RESET" / saya diminta kode, apa yang harus dilakukan?',
            a: 'Angkat tangan atau hubungi pengawas ruangan dan minta kode 7 karakter. Masukkan kode itu untuk melanjutkan dari soal terakhir. Kalau pelanggaran sudah melebihi batas, pengawas bisa mengunci akun Anda secara permanen untuk sesi itu.',
          },
          {
            q: 'Kenapa ujian harus dalam mode layar penuh (fullscreen)?',
            a: 'Ini bagian dari sistem anti-kecurangan — keluar dari layar penuh dihitung sama seperti berpindah tab/aplikasi, yaitu sebagai pelanggaran. Di HP, membuka Kontrol Cepat/Notifikasi, mengganti WiFi, membalas chat, atau menekan tombol Home langsung tercatat sebagai pelanggaran. Jika perangkat Anda tidak mendukung layar penuh sama sekali (beberapa browser di iPhone/iPad), beri tahu pengawas sebelum ujian dimulai.',
          },
          {
            q: 'Internet saya putus saat ujian, bagaimana?',
            a: 'Jangan panik, dan JANGAN keluar dari layar ujian untuk membuka pengaturan WiFi/data — itu akan tercatat sebagai pelanggaran. Cukup tetap di halaman ujian: jawaban yang sudah dijawab tersimpan di perangkat Anda dan otomatis terkirim begitu koneksi kembali. Kalau koneksi tidak kunjung pulih dan Anda terpaksa membuka pengaturan HP, beri tahu pengawas DULU sebelum melakukannya.',
          },
          {
            q: 'Saya tidak sengaja menutup tab saat ujian, bagaimana?',
            a: 'Buka kembali browser, login ulang, lalu masuk lagi ke halaman ujian. Ini tercatat sebagai pelanggaran dan ujian dihentikan sementara — minta kode 7 karakter ke pengawas untuk melanjutkan dari soal terakhir.',
          },
          {
            q: 'Bisakah saya mengerjakan ujian yang sama di HP dan laptop sekaligus?',
            a: 'Tidak. Satu sesi ujian hanya boleh aktif di satu perangkat. Kalau Anda login ke ujian yang sama di perangkat kedua, sesi di perangkat pertama otomatis terputus. Gunakan satu perangkat sampai ujian selesai.',
          },
          {
            q: 'Internet mati total dan soal essay belum sempat dibuka, apa yang harus dilakukan?',
            a: 'Tetap tenang dan tetap di layar ujian. Minta "kode darurat" ke pengawas ruangan — kode ini dibacakan langsung atau ditulis di papan, bukan dikirim lewat internet — lalu masukkan untuk membuka soal essay secara offline. Begitu internet pulih, jawaban dan waktu pengerjaan Anda otomatis disinkronkan.',
          },
          {
            q: 'Ada menu "Pengiriman Tertunda", itu untuk apa?',
            a: 'Menu ini hanya muncul kalau ada jawaban atau paket ujian Anda yang belum berhasil terkirim (biasanya karena internet sempat putus). Sistem terus mencoba mengirim ulang otomatis; Anda juga bisa menekan "Kirim Sekarang" untuk mencoba lebih cepat. Jawaban yang sudah tersimpan tidak akan hilang.',
          },
          {
            q: 'Listrik atau HP mati di tengah ujian, apa yang harus dilakukan?',
            a: 'Beri tahu pengawas segera. Jawaban sebelum mati tetap tersimpan. Jika Anda tidak bisa melanjutkan, guru pengawas atau admin dapat memberi kesempatan ujian susulan dengan kode akses baru.',
          },
        ],
      },
      {
        category: 'Setelah Ujian & Nilai',
        items: [
          {
            q: 'Nilai tidak muncul setelah ujian selesai',
            a: 'Pastikan Anda benar-benar menekan "Selesai Ujian", bukan hanya menutup browser. Lalu coba muat ulang halaman Nilai Saya. Untuk mata pelajaran yang punya soal essay, nilai total baru tampil setelah guru selesai memeriksa essay dan merilis nilainya.',
          },
          {
            q: 'Akun saya dikunci permanen oleh pengawas, bagaimana dengan nilai saya?',
            a: 'Kunci permanen berarti ujian Anda pada sesi itu dihentikan dan nilainya ditetapkan 0 (terkunci = gugur), kecuali nilai yang sudah terlanjur dikirim ke wali kelas. Kalau menurut Anda ini terjadi karena kendala teknis, bicarakan dengan pengawas dan guru mata pelajaran; kesempatan ujian susulan hanya bisa diberikan oleh guru pengawas atau admin.',
          },
          {
            q: 'Soal essay dikerjakan dengan diketik atau di kertas?',
            a: 'Tergantung pengaturan guru untuk ujian itu: bisa digital (diketik di sistem) atau kertas. Pengawas akan menjelaskan sebelum essay dimulai. Essay baru bisa dikerjakan setelah pengawas membuka aksesnya.',
          },
        ],
      },
    ],
  },

  // ───────────────────────────── GURU ─────────────────────────────
  {
    id: 'guru',
    label: 'Guru',
    untuk: 'Untuk guru, termasuk guru yang merangkap Pengawas, Wali Kelas, atau Admin Kelas.',
    icon: <Users className="w-4 h-4" />,
    text: 'text-emerald-700',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    gradient: 'from-emerald-500 to-teal-600',
    groups: [
      {
        category: 'Akun & Tugas Tambahan',
        items: [
          {
            q: 'Username dan password guru dari mana? Lupa password bagaimana?',
            a: 'Username dan password awal dibuat oleh Admin di menu Data Pengguna. Kalau lupa password, minta Admin mereset lewat menu yang sama.',
          },
          {
            q: 'Menu Jadwal Mengawas Saya, Wali Kelas, atau Admin Kelas tidak muncul di sidebar saya',
            a: 'Menu itu muncul hanya kalau Admin menugaskan Anda: Jadwal Mengawas Saya untuk guru yang punya jadwal jaga, Wali Kelas untuk guru yang ditunjuk wali kelas, dan Admin Kelas untuk guru yang ditunjuk memvalidasi soal (dan hanya bila fitur Admin Kelas diaktifkan). Minta Admin memeriksa penugasan Anda.',
          },
          {
            q: 'Satu guru mengajar di lebih dari satu sekolah/jenjang, apakah bisa?',
            a: 'Bisa. Admin dapat menautkan satu akun guru ke lebih dari satu sekolah di menu Data Pengguna, sehingga Anda melihat kelas dan kisi-kisi dari semua sekolah yang diampu dalam satu akun.',
          },
        ],
      },
      {
        category: 'Membuat Soal & Mengirim Paket',
        items: [
          {
            q: 'Bagaimana cara mengimpor soal dari Word?',
            a: 'Buka menu Buat Soal, lalu klik "Impor dari Word" (untuk essay: "Impor Soal dari Word"). Unduh template, isi satu tabel per nomor soal di Word, lalu unggah file .docx. Periksa pratinjau, kemudian klik Impor. Tidak ada soal yang tersimpan sebelum tombol Impor ditekan. Isi hanya kolom kuning dan jangan ubah kolom biru (nama baris). Teks soal dan gambar soal ditulis di sel yang sama: klik di dalam sel Soal, lalu Sisipkan ▸ Gambar (satu gambar per sel). Cara yang sama berlaku untuk opsi jawaban bergambar. Tabel oranye di awal template hanyalah contoh dan tidak ikut diimpor.',
          },
          {
            q: 'Mengapa setelah impor selesai, form menampilkan nomor soal berikutnya?',
            a: 'Form pada halaman Buat Soal selalu dipakai untuk menambah soal berikutnya. Setelah 5 soal berhasil diimpor, form menampilkan "Soal ke-6". Seluruh soal hasil impor tersimpan dan dapat dilihat di bagian "Soal yang sudah dibuat" di bawah form, tempat setiap soal bisa diedit atau dihapus. Kalau jumlah soal sudah cukup, form tidak perlu diisi; lanjutkan ke tahap kirim paket.',
          },
          {
            q: 'Saya tidak sengaja mengimpor file yang sama dua kali, apakah soalnya jadi ganda?',
            a: 'Tidak. Sebelum mengimpor, sistem membandingkan teks soal, teks pilihan jawaban, dan kunci dengan soal yang sudah ada di paket. Soal yang sama persis ditandai kuning di pratinjau dan dilewati; untuk essay yang dibandingkan adalah teks soalnya. Gambar tidak ikut dibandingkan, jadi dua soal dengan teks, opsi, dan kunci yang sama tetapi gambar berbeda dianggap kembar. Jika itu soal yang memang berbeda, tambahkan lewat form "Soal ke-N".',
          },
          {
            q: 'Soal saya ditandai merah di pratinjau impor, apa artinya?',
            a: 'Ada isian yang perlu diperbaiki. Alasannya tertulis di bawah soal tersebut, misalnya: soal atau opsi belum diisi, kunci kosong atau tidak sesuai (kunci harus satu huruf dalam rentang opsi, mis. A–D), atau bobot essay belum diisi atau bukan angka lebih dari 0. Perbaiki di file Word lalu unggah ulang, atau centang "Lewati soal yang bermasalah" untuk mengimpor soal yang sudah benar saja.',
          },
          {
            q: 'Gambar atau rumus di soal Word saya tidak terbaca, bagaimana?',
            a: 'Gunakan gambar berformat PNG atau JPG yang disisipkan lewat Sisipkan ▸ Gambar. Format EMF/WMF/SVG tidak didukung, dan diagram, bentuk, atau kotak teks Word bukan gambar sehingga tidak ikut terimpor. Cara termudah: jadikan gambar lalu sisipkan ulang. Hanya satu gambar per sel yang dipakai, dan gambar yang terlalu besar dikecilkan otomatis.',
          },
          {
            q: 'Muncul pesan paket terkunci atau jumlah opsi tidak sama',
            a: 'Soal hanya bisa ditambah, diedit, atau dihapus selama paket berstatus draft atau ditolak. Paket yang sudah dikirim atau disetujui terkunci, begitu pula bila sesi ujian mapel dan kelas itu sudah dimulai. Semua soal dalam satu paket harus memakai jumlah opsi yang sama (4 atau 5); jika paket sudah berisi soal 4 opsi, unduh template dengan 4 opsi. Bila admin mengunci jumlah opsi, jumlah opsi mengikuti pengaturan admin dan tidak bisa diganti per soal.',
          },
          {
            q: 'Paket tidak bisa dikirim: muncul pesan "minimal ... soal, saat ini baru ..."',
            a: 'Admin menetapkan batas minimal jumlah soal untuk mata pelajaran Anda (misalnya 30 soal PG atau 5 soal essay). Pengiriman ditolak sampai jumlah soal di paket mencapai batas itu; pesannya menyebutkan angka batas dan jumlah soal Anda saat ini. Tambahkan soal yang kurang (bisa lewat Impor dari Word), lalu kirim ulang. Batas ini hanya berlaku untuk pengiriman baru, jadi paket yang sudah dikirim atau disetujui tidak terpengaruh. Kalau Anda merasa angkanya tidak sesuai, hubungi Admin.',
          },
          {
            q: 'Kalau saya kirim paket PG, apakah paket Essay ikut terkirim (dan sebaliknya)?',
            a: 'Setelah Anda menekan Kirim, sistem akan menanyakan apakah paket pasangannya (mata pelajaran dan kelas yang sama) ikut dikirim sekaligus. Pasangan yang jumlah soalnya masih kurang dari batas minimal tidak ikut terkirim; Anda akan diberi tahu alasannya, dan paket itu bisa dikirim sendiri setelah soalnya cukup. Admin tetap memvalidasi paket PG dan Essay secara terpisah.',
          },
          {
            q: 'Paket saya ditolak admin, apa yang harus dilakukan?',
            a: 'Buka paket yang berstatus ditolak, baca catatan dari admin, perbaiki soal yang dimaksud (soal pada paket ditolak boleh diedit), lalu kirim ulang. Paket yang sudah dikirim dan masih menunggu validasi juga bisa ditarik kembali bila Anda ingin mengubahnya.',
          },
          {
            q: 'Apakah soal bisa digunakan ulang untuk ujian berikutnya?',
            a: 'Soal PG dan essay dibuat langsung di dalam satu paket lewat menu Buat Soal, jadi tidak ada bank soal terpisah yang dipakai lintas paket. Yang bisa dilakukan: duplikasi paket yang sudah ada untuk ujian susulan atau semester berikutnya. Untuk soal baru dalam jumlah banyak, gunakan Impor dari Word.',
          },
          {
            q: 'Siapa yang menentukan durasi soal essay?',
            a: 'Anda bisa mengusulkan durasi essay di pengaturan essay, tetapi keputusan akhir diisi oleh Admin pada jadwal ujian. Jika Admin mengosongkannya, jadwal mengikuti usulan Anda.',
          },
        ],
      },
      {
        category: 'Penilaian',
        items: [
          {
            q: 'Di mana saya memeriksa essay dan merilis nilai?',
            a: 'Menu Penilaian punya tiga tab: Periksa Jawaban Essay (koreksi manual), Rekap Nilai (nilai gabungan PG + essay per siswa), dan Kirim Nilai ke Wali Kelas. Untuk mata pelajaran dengan essay, nilai total siswa baru tampil setelah Anda selesai memeriksa dan merilis nilainya.',
          },
          {
            q: 'Siswa bilang nilainya tidak muncul, apa yang perlu saya cek?',
            a: 'Pastikan siswa menekan "Selesai Ujian" (bukan hanya menutup browser). Lalu cek tab Rekap Nilai di menu Penilaian apakah datanya sudah masuk. Jika mapel punya essay, pastikan essay sudah diperiksa dan nilainya dirilis.',
          },
        ],
      },
      {
        category: 'Mengawas Ujian (Pengawas)',
        items: [
          {
            q: 'Bagaimana membuka sesi dan memantau siswa?',
            a: 'Buka menu Jadwal Mengawas Saya lalu pilih tab Mode Pengawas. Di sana Anda membuka sesi (kode ujian dibagikan ke siswa), memantau peserta secara real-time, mereset siswa yang kena pelanggaran, membuka atau menutup akses mulai soal essay, dan menutup sesi. Jika ada ujian yang sedang berlangsung, halaman ini langsung terbuka di Mode Pengawas.',
          },
          {
            q: 'Siswa kena pelanggaran dan minta kode, apa yang saya lakukan?',
            a: 'Setiap pelanggaran menghentikan ujian siswa sementara. Reset siswa tersebut di Mode Pengawas untuk memberi kode lanjut 7 karakter. Kalau jumlah pelanggarannya sudah melebihi batas dari Admin, Anda bisa memilih mengunci akunnya secara permanen untuk sesi itu; nilai siswa pada sesi itu ditetapkan 0 (terkunci = gugur), jadi gunakan hanya bila memang perlu.',
          },
          {
            q: 'Internet mati total saat ujian, bagaimana pengawas harus bertindak?',
            a: 'Untuk soal pilihan ganda tidak perlu tindakan khusus — jawaban siswa tersimpan di perangkat masing-masing dan terkirim otomatis begitu internet kembali. Untuk essay, buka Mode Pengawas lalu tekan "Tampilkan Kode Darurat", dan bacakan atau tuliskan kode itu di papan tulis (jangan lewat grup chat/internet) agar siswa bisa membuka soal essay secara offline. Begitu koneksi pulih, sistem otomatis menyinkronkan data essay siswa.',
          },
          {
            q: 'Listrik mati atau siswa tidak sempat ujian, bagaimana memberi susulan?',
            a: 'Catat kejadiannya dan laporkan ke Admin. Guru pengawas atau Admin dapat membuka ujian susulan dengan kode akses baru lewat fitur Susulan. Jawaban sebelum gangguan tetap tersimpan.',
          },
          {
            q: 'Kenapa Layar Pantau meminta izin Admin?',
            a: 'Layar Pantau adalah tampilan papan nilai ujian secara live untuk layar besar/TV, dan khusus dibuka lewat laptop atau komputer. Akun Guru wajib mendapat persetujuan Admin dulu (menu Izin Layar Pantau di akun Admin); izin berlaku selama 10 jam, lalu perlu diajukan lagi. Papan baru menampilkan data saat ada ujian yang berjalan.',
          },
        ],
      },
      {
        category: 'Admin Kelas & Wali Kelas',
        items: [
          {
            q: 'Apa itu Admin Kelas dan apa tugasnya?',
            a: 'Admin Kelas adalah guru yang ditunjuk Admin untuk memvalidasi paket soal pada kelas tertentu. Menu Admin Kelas muncul di sidebar Anda hanya bila fitur ini diaktifkan Admin dan Anda ditunjuk. Anda hanya melihat paket dari kelas yang menjadi tanggung jawab Anda; kelas lain tetap divalidasi Admin. Validasi memeriksa kelayakan paket yang dikirim guru, sedangkan batas minimal jumlah soal sudah dijaga otomatis saat paket dikirim.',
          },
          {
            q: 'Apa tugas Wali Kelas di sistem ini?',
            a: 'Menu Wali Kelas muncul untuk guru yang ditunjuk sebagai wali kelas. Di sana Anda memantau dan menerima kiriman nilai siswa di kelas yang Anda ampu, yang dikirim guru mata pelajaran lewat tab Kirim Nilai ke Wali Kelas.',
          },
        ],
      },
    ],
  },

  // ───────────────────────────── KEPALA SEKOLAH ─────────────────────────────
  {
    id: 'kepsek',
    label: 'Kepala Sekolah',
    untuk: 'Untuk Kepala Sekolah. Akun ini untuk memantau; data tidak bisa diubah.',
    icon: <UserCheck className="w-4 h-4" />,
    text: 'text-blue-700',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    gradient: 'from-blue-500 to-cyan-600',
    groups: [
      {
        category: 'Login & Akun',
        items: [
          {
            q: 'Username dan password Kepala Sekolah dari mana? Lupa password bagaimana?',
            a: 'Akun dibuat oleh Admin di menu Data Pengguna. Kalau lupa password, minta Admin mereset lewat menu yang sama.',
          },
        ],
      },
      {
        category: 'Memantau Ujian & Hasil',
        items: [
          {
            q: 'Apa saja yang bisa saya lihat di akun Kepala Sekolah?',
            a: 'Dashboard ringkasan ujian, Monitoring Ujian (sesi yang sedang berlangsung, siapa yang sudah/belum mengerjakan, dan pelanggaran), Hasil Ujian (rekap nilai per kelas, mapel, dan siswa), Jadwal Ujian, Kisi-kisi, Data Kelas, serta Guru & Mapel. Akun ini hanya untuk melihat, bukan mengubah data.',
          },
          {
            q: 'Kelas, guru, atau ujian di akun saya kosong / tidak muncul',
            a: 'Kepala Sekolah hanya melihat data sekolahnya sendiri. Jika semuanya kosong, kemungkinan akun Anda belum dikaitkan dengan sekolah. Minta Admin mengatur sekolah untuk akun Anda di menu Data Pengguna. Bila baru ada jadwal yang belum dimulai, data nilainya juga memang belum ada.',
          },
          {
            q: 'Nilai suatu mapel belum lengkap di Hasil Ujian',
            a: 'Untuk mata pelajaran yang punya soal essay, nilai total baru lengkap setelah guru selesai memeriksa essay dan merilis nilainya. Jika sudah lama belum lengkap, tanyakan ke guru mapel yang bersangkutan.',
          },
          {
            q: 'Bagaimana membuka Layar Pantau?',
            a: 'Layar Pantau menampilkan papan nilai ujian secara live dan hanya dibuka lewat laptop atau komputer (menu muncul di beranda login). Kepala Sekolah tidak perlu izin Admin; cukup login. Papan baru menampilkan data saat ada ujian yang sedang berjalan.',
          },
        ],
      },
    ],
  },

  // ───────────────────────────── ADMIN ─────────────────────────────
  {
    id: 'admin',
    label: 'Admin',
    untuk: 'Untuk Admin (Super Admin) yang mengelola sistem sekolah atau yayasan.',
    icon: <Shield className="w-4 h-4" />,
    text: 'text-violet-700',
    bg: 'bg-violet-50',
    border: 'border-violet-200',
    gradient: 'from-violet-500 to-purple-600',
    groups: [
      {
        category: 'Akun & Data Master',
        items: [
          {
            q: 'Saya lupa password Admin, bagaimana?',
            a: 'Hubungi pengelola sistem (developer) atau reset melalui database Supabase. Admin tidak bisa mereset passwordnya sendiri dari halaman login.',
          },
          {
            q: 'Bagaimana mereset password guru, kepala sekolah, dan siswa?',
            a: 'Guru dan Kepala Sekolah: menu Data Pengguna. Siswa: menu Data Siswa (guru juga bisa membantu mereset siswa). Password setelah reset kembali ke bawaan, lalu pemilik akun bisa menggantinya sendiri.',
          },
          {
            q: 'Bagaimana cara import data siswa massal?',
            a: 'Gunakan tombol import di halaman Data Siswa (bukan menu terpisah). Unduh template Excel di sana, isi data siswa sesuai format (NISN, nama, kelas, dll), lalu unggah kembali. Sistem memvalidasi dan memasukkan datanya secara otomatis. Buat kelas dan mata pelajaran terlebih dahulu sebelum import.',
          },
          {
            q: 'Satu guru mengajar di lebih dari satu sekolah/jenjang, apakah bisa?',
            a: 'Bisa. Tautkan satu akun guru ke lebih dari satu sekolah di menu Data Pengguna, sehingga guru melihat kelas dan kisi-kisi dari semua sekolah yang diampu dalam satu akun.',
          },
          {
            q: 'Siswa tidak muncul di daftar sesi ujian',
            a: 'Kemungkinan penyebab: (1) siswa belum terdaftar di kelas yang dijadwalkan, (2) kelas siswa tidak sesuai dengan jadwal ujian, (3) siswa baru ditambahkan setelah sesi dibuat. Periksa data siswa dan kelasnya di menu Data Siswa dan Jadwal Ujian.',
          },
          {
            q: 'Apa itu fitur "Lihat Sebagai"?',
            a: 'Fitur ini memungkinkan Admin masuk sementara sebagai akun guru, kepala sekolah, atau siswa tertentu untuk mengecek atau memperbaiki masalah dari sudut pandang mereka tanpa perlu tahu passwordnya. Sesi otomatis berakhir setelah 2 jam, dan pemilik akun melihat banner bahwa akunnya sedang dilihat oleh Admin.',
          },
        ],
      },
      {
        category: 'Soal, Validasi & Pengaturan Ujian',
        items: [
          {
            q: 'Bagaimana mengatur batas minimal jumlah soal per mata pelajaran?',
            a: 'Buka Pengaturan, tab Pengaturan Ujian, kartu "Batas Minimal Jumlah Soal". Aktifkan saklarnya (bawaan mati). Untuk PG dan Essay masing-masing, klik "Tambah kelompok", isi angka minimalnya (misalnya 30), lalu centang mata pelajaran yang masuk kelompok itu. Buat kelompok lain untuk angka lain (misalnya 35). Satu mapel hanya bisa di satu kelompok, dan mapel yang tidak dicentang tetap memakai aturan bawaan (minimal 1 soal). Pengecekan dilakukan saat guru mengirim paket, jadi paket yang sudah dikirim atau disetujui tidak terpengaruh. Jangan lupa tekan Simpan Batas Soal.',
          },
          {
            q: 'Apa itu Admin Kelas dan bagaimana mengaktifkannya?',
            a: 'Admin Kelas adalah guru yang Anda tunjuk untuk memvalidasi paket soal pada kelas tertentu, supaya beban validasi tidak semuanya di Admin. Buka menu Admin Kelas, aktifkan fiturnya (bawaan mati), lalu tunjuk guru untuk tiap kelas (satu kelas satu Admin Kelas). Kelas tanpa Admin Kelas tetap Anda validasi sendiri di menu Validasi Soal. Mematikan fitur ini tidak menghapus penugasan, hanya menghentikan pemberlakuannya.',
          },
          {
            q: 'Apa yang bisa diatur di tab Pengaturan Ujian?',
            a: 'Batas pelanggaran (sebelum siswa bisa dikunci), jumlah opsi jawaban default beserta opsi untuk mengunci jumlah opsi supaya guru tidak bisa mengubahnya, waktu minimal submit (siswa baru bisa mengirim jawaban setelah durasi tertentu), batas durasi essay, dan batas minimal jumlah soal per mapel. Waktu minimal submit tidak bisa diubah saat ada sesi ujian yang sedang berjalan; tunggu sampai semua sesi selesai.',
          },
          {
            q: 'Siapa yang menentukan durasi soal essay?',
            a: 'Guru boleh mengusulkan durasi essay, dan usulan itu tampil di form jadwal. Keputusan akhir Anda isi di jadwal ujian; jika dikosongkan, jadwal mengikuti usulan guru.',
          },
        ],
      },
      {
        category: 'Saat Ujian Berlangsung',
        items: [
          {
            q: 'Guru meminta izin Layar Pantau, bagaimana menyetujuinya?',
            a: 'Buka menu Izin Layar Pantau. Di sana Anda melihat permintaan guru, lalu bisa menyetujui, menolak, atau mencabut izin. Izin berlaku selama 10 jam sejak disetujui. Admin dan Kepala Sekolah tidak perlu izin. Layar Pantau hanya bisa dibuka lewat laptop atau komputer.',
          },
          {
            q: 'Bagaimana memberi ujian susulan, mis. karena listrik mati?',
            a: 'Di menu Jadwal Ujian, buka ujian susulan untuk jadwal tersebut dan pilih guru yang menjadi pengawasnya. Sistem akan menolak bila jadwal itu sudah punya sesi yang sedang berjalan, supaya tidak bentrok. Guru pengawas juga bisa membuka susulan dari akunnya.',
          },
          {
            q: 'Ada siswa yang dikunci permanen oleh pengawas, bagaimana nilainya?',
            a: 'Aturannya terkunci = gugur: pada sesi itu siswa tidak bisa melanjutkan dan nilainya ditetapkan 0, kecuali nilai yang sudah terlanjur dikirim ke wali kelas. Jika kunci terjadi karena gangguan teknis, Anda bisa memberi kesempatan lewat ujian susulan.',
          },
          {
            q: 'Nilai tidak muncul setelah ujian selesai',
            a: 'Pastikan siswa menekan "Selesai Ujian", bukan hanya menutup browser. Cek menu Rekap Nilai apakah datanya sudah masuk. Untuk mapel yang punya essay, nilai total baru tampil setelah guru memeriksa essay dan merilis nilainya di menu Penilaian.',
          },
        ],
      },
      {
        category: 'Teknis & Pemeliharaan',
        items: [
          {
            q: 'Berapa banyak siswa yang bisa menggunakan sistem bersamaan?',
            a: 'Bergantung pada paket Supabase yang digunakan. Paket gratis mendukung hingga ratusan koneksi bersamaan. Untuk jumlah siswa yang besar, pertimbangkan upgrade ke paket berbayar untuk performa optimal.',
          },
          {
            q: 'Server error / halaman tidak bisa diakses',
            a: 'Coba muat ulang halaman. Jika masih error, tunggu beberapa menit dan coba lagi. Cek status server di Supabase Dashboard, dan pastikan tidak ada proses berat seperti import data besar yang sedang berjalan. Untuk masalah teknis kritis, hubungi pengelola sistem.',
          },
          {
            q: 'Data sekolah hilang setelah reset',
            a: 'Jika reset "Semua Data" dilakukan, semua pengaturan termasuk data dan logo setiap sekolah ikut terhapus. Isi kembali di halaman Informasi Sekolah (dibuka lewat kartu di atas tab Pengaturan). Selalu lakukan backup di tab Backup & Restore sebelum reset apa pun.',
          },
        ],
      },
    ],
  },
]
