// ── Lamp Intro: penentu "lampu tampil atau tidak" (jalan SEBELUM React) ──────
//
// File ini sengaja BUKAN 'use client' supaya bisa diimpor oleh RootLayout
// (server component) untuk dipasang sebagai <script> inline di awal <body>.
// Script itu jalan sebelum halaman pertama kali digambar, jadi:
//   - kalau lampu HARUS tampil hari ini → <html data-lamp="1"> sudah terpasang
//     dan layar gelap langsung menutupi halaman (tidak ada kilatan login);
//   - kalau sudah tampil hari ini → tidak terjadi apa-apa, tidak ada layar
//     gelap sama sekali (tidak ada kedipan di kunjungan berikutnya).
//
// Aturan "lampu jatuh tempo hari ini":
//   1. Alamat yang dibuka adalah /login, atau "/" (alamat yang selalu dibuka
//      APK Android, lalu diteruskan ke /login oleh src/app/page.tsx).
//   2. Tanggal hari ini (jam perangkat) belum tercatat di localStorage.
//      Tanggal dicatat saat tali DITARIK (bukan saat lampu muncul), jadi kalau
//      aplikasi ditutup sebelum tali ditarik, lampu muncul lagi.
//   3. Khusus "/": dilewati kalau perangkat masih menyimpan login (ada
//      `token`). Di APK, "/" bisa langsung meneruskan siswa ke /siswa/ujian
//      untuk pemulihan ujian — jangan sampai ada lampu yang menghalangi.

export const LAMP_KEY = 'lampuLogin:terakhirTampil'

// Layar sambutan "EXAMFLOW" milik halaman login tampil sekali per sesi tab
// (sessionStorage 'examflow_splash_shown'). Pada hari lampu tampil, urutan
// yang diminta adalah: lampu → langsung halaman login. Karena itu, saat lampu
// jatuh tempo, kunci splash ditandai sudah tampil supaya splash tidak muncul
// setelah lampu. Ubah ke `false` kalau splash EXAMFLOW tetap ingin tampil
// sesudah lampu. File login/page.tsx tidak disentuh sama sekali.
export const LAMP_REPLACES_SPLASH = true
export const SPLASH_SEEN_KEY = 'examflow_splash_shown'

export const LAMP_GATE_SCRIPT = `(function(){try{
var p=location.pathname;if(p.length>1&&p.charAt(p.length-1)==='/')p=p.slice(0,-1);
if(p!=='/login'&&p!=='/')return;
var d=new Date(),t=d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
try{
if(localStorage.getItem('${LAMP_KEY}')===t)return;
if(p==='/'&&localStorage.getItem('token'))return;
}catch(e){}
document.documentElement.setAttribute('data-lamp','1');
${LAMP_REPLACES_SPLASH ? `try{sessionStorage.setItem('${SPLASH_SEEN_KEY}','1')}catch(e){}` : ''}
}catch(e){}})();`
