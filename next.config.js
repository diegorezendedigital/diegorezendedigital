const { version } = require("./package.json");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // Endereço antigo da aba Publicidade
  async redirects() {
    return [{ source: "/dashboard/ads", destination: "/dashboard/publicidade", permanent: true }];
  },
  // Versão e data/hora da publicação (fixadas no momento do build)
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};

module.exports = nextConfig;
