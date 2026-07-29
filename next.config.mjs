/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Phones and tablets open Hyzr Chat through this machine's LAN address. Next's
  // development client otherwise rejects that origin, including the HMR
  // transport needed to hydrate client components.
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "192.168.*.*",
    "10.*.*.*",
    "172.*.*.*",
  ],
  // The dedicated preview route reads a user workspace chosen at runtime.
  // Next's conservative tracer otherwise copies every source and test file
  // into that route's deployment manifest. Runtime code is already bundled.
  outputFileTracingExcludes: {
    "/api/preview-server": [
      "./app/**/*",
      "./lib/**/*",
      "./scripts/**/*",
      "./tests/**/*",
      "./docs/**/*",
      "./README.md",
      "./SECURITY.md",
      "./playwright.config.ts",
      "./tsconfig*.json",
      "./*.tsbuildinfo",
      "./next.config.mjs",
    ],
  },
};

export default nextConfig;
