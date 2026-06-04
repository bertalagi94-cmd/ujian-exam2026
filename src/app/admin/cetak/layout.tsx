// Layout kosong untuk halaman cetak — tidak ada sidebar, tidak ada navbar
// Halaman ini akan langsung trigger window.print()
export default function CetakLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body style={{ margin: 0, background: '#fff' }}>
        {children}
      </body>
    </html>
  )
}
