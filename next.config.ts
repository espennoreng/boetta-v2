import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  experimental: {
    // Raised from the 10MB default so byggesøknad PDFs (often 15–20MB with
    // drawings) are not silently truncated by the proxy buffer. Must stay in
    // sync with MAX_REQUEST_BODY_BYTES in app/api/chat/route.ts.
    proxyClientMaxBodySize: "25mb",
  },
};

export default nextConfig;
