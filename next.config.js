/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['ws', 'bufferutil']
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...config.externals, 'ws', 'bufferutil']
    }
    return config
  },
  logging: {
    fetches: {
      fullUrl: true,
    },
  }
}

module.exports = nextConfig 