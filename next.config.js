/** @type {import('next').NextConfig} */
const nextConfig = {
  // pg and grammy are server-only; keeping them external stops the bundler
  // trying to follow their native/optional requires.
  serverExternalPackages: ["pg", "grammy", "bcryptjs"],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};
export default nextConfig;
