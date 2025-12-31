// frontend_build.mjs
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// repo root (onde está este arquivo)
const ROOT = __dirname;

const FRONTEND_DIR = path.join(ROOT, "frontend");
const FRONTEND_PKG = path.join(FRONTEND_DIR, "package.json");
const FRONTEND_DIST = path.join(FRONTEND_DIR, "dist");

// destino que o backend (no Render com Root Directory = backend) espera:
// /opt/render/project/src/backend/frontend/index.html
const BACKEND_DIR = path.join(ROOT, "backend");
const BACKEND_FRONTEND_DIR = path.join(BACKEND_DIR, "frontend");

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: "inherit", shell: true });
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} falhou (code ${code})`));
    });
  });
}

async function main() {
  console.log("== frontend_build.mjs ==");
  console.log("ROOT:", ROOT);
  console.log("FRONTEND_DIR:", FRONTEND_DIR);
  console.log("BACKEND_FRONTEND_DIR:", BACKEND_FRONTEND_DIR);

  if (!existsSync(FRONTEND_PKG)) {
    console.log("⚠️  Não encontrei frontend/package.json.");
    console.log("➡️  Sem Vite para buildar. Vou apenas garantir backend/frontend/ existe (sem build).");
    await mkdir(BACKEND_FRONTEND_DIR, { recursive: true });
    return;
  }

  // 1) instala deps do frontend
  console.log("\n[1/3] Instalando dependências do frontend (npm ci)...");
  await run("npm", ["ci"], FRONTEND_DIR);

  // 2) build do frontend
  console.log("\n[2/3] Buildando frontend (npm run build)...");
  await run("npm", ["run", "build"], FRONTEND_DIR);

  if (!existsSync(FRONTEND_DIST)) {
    throw new Error("Build terminou, mas não achei frontend/dist. Verifique vite.config.ts (outDir) e o build.");
  }

  // 3) copia dist -> backend/frontend
  console.log("\n[3/3] Copiando dist para backend/frontend ...");
  await rm(BACKEND_FRONTEND_DIR, { recursive: true, force: true });
  await mkdir(BACKEND_FRONTEND_DIR, { recursive: true });

  // copia o conteúdo do dist para backend/frontend (index.html deve ficar direto ali)
  await cp(FRONTEND_DIST, BACKEND_FRONTEND_DIR, { recursive: true });

  console.log("\n✅ OK: frontend/dist -> backend/frontend");
  console.log("✅ Arquivo esperado:", path.join(BACKEND_FRONTEND_DIR, "index.html"));
}

main().catch((err) => {
  console.error("\n❌ Erro no frontend_build.mjs:", err.message);
  process.exit(1);
});
