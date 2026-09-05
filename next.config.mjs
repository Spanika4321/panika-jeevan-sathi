/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Native modules must stay external to the server bundle (App Router + libsql).
  experimental: {
    serverComponentsExternalPackages: ["@libsql/client"],
  },
  poweredByHeader: false,
};

export default nextConfig;
