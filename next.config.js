/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['drive.google.com', 'res.cloudinary.com'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  // Pindah dari experimental ke root level (Next.js 14.1+)
  serverExternalPackages: ['bcryptjs'],
}

module.exports = nextConfig
