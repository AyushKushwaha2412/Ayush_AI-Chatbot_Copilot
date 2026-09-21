/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow the hosted preview / proxied dev hosts to talk to the dev server.
  allowedDevOrigins: [
    '*.e2b.app',
    '*.e2b.dev',
    '*.arena.ai',
    'localhost',
    '127.0.0.1',
  ],
  serverExternalPackages: ['@prisma/client', 'prisma'],
  typescript: { ignoreBuildErrors: false },
  experimental: {
    // keep server actions payloads sane for long chat histories
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default nextConfig;
