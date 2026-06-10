/** @type {import('next').NextConfig} */
const nextConfig = {
  // Slim, self-contained server output for the container image.
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
  // The vendored upstream app + Convex `_generated` drift can produce
  // type/lint noise that isn't worth blocking the image build over.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
