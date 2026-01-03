import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.podbean.com',
      },
      {
        protocol: 'https',
        hostname: 'www.podbean.com',
      },
    ],
  },
};

export default nextConfig;
