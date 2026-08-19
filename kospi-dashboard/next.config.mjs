/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  trailingSlash: false,
  reactStrictMode: true,
  // Allow large data files to be imported
  experimental: {
    largePageDataBytes: 128 * 1024 * 1024,
  },
};

export default nextConfig;
