import type { NextConfig } from "next";

// cacheComponents desligado no MVP: o painel é 100% dinâmico (hora simulada, sessão),
// e renderização dinâmica comum evita exigir <Suspense> em toda leitura de cookie.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
