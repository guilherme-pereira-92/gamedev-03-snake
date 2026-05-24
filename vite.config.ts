import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/gamedev-03-snake/" : "/",
  server: { port: 5175, open: true },
  build: { target: "es2020" },
}));
