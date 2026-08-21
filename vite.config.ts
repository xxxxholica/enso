import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    // ファイル名にハッシュを含めない。dist/ を配布先へ上書きコピーするだけで
    // 更新できるようにするため（ハッシュ付きだとビルドの度にファイル名が変わり、
    // 古いファイルを消せない環境では配布先にゴミが溜まってしまう）。
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
