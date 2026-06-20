/** @type {import('next').NextConfig} */
const nextConfig = {
  // Kompres response dengan gzip/brotli — mengurangi ukuran JS/HTML ~70%
  compress: true,

  // Hilangkan header "X-Powered-By: Next.js" — sedikit lebih kecil per response
  poweredByHeader: false,

  images: {
    domains: ['drive.google.com', 'res.cloudinary.com'],
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
    // Format modern — WebP/AVIF lebih kecil dari PNG/JPEG
    formats: ['image/avif', 'image/webp'],
  },

  serverExternalPackages: ['bcryptjs'],

  // Header keamanan + cache statis
  async headers() {
    return [
      {
        // Aset statis Next.js sudah hash di nama file — aman cache 1 tahun
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        // Semua halaman — security headers dasar
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
