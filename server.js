/**
 * Controle de Pagamentos V3 - servidor local (porta 10000)
 * - db.json único na raiz
 * - Cria usuário automaticamente no primeiro login
 * - Compatível com password em texto OU bcrypt (migra para bcrypt no login)
 * - JWT + /api/me
 * - Dados por mês: /api/data/:ano/:mes
 * - Config do usuário: /api/settings (tema/paleta/bancos/categorias)
 * - Troca de senha (usuário): /api/password
 * - Admin: listar/criar/apagar/reset senha
 */

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 10000);
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, "db.json");

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "flavioleiteconsultoria@gmail.com").trim().toLowerCase();

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// ---------- DB helpers ----------
function safeJsonParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function ensureDbFile() {
  if (!fs.existsSync(DB_PATH)) {
    const init = { users: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2), "utf-8");
  }
}

function readDb() {
  ensureDbFile();
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  const db = safeJsonParse(raw, { users: [] });
  if (!db || typeof db !== "object") return { users: [] };
  if (!Array.isArray(db.users)) db.users = [];
  // normaliza
  db.users.forEach(u => {
    if (!u.id) u.id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
    u.email = String(u.email || "").trim().toLowerCase();
    const r = String(u.role || "USER").trim().toUpperCase();
    u.role = (r === "ADMIN") ? "ADMIN" : "USER";
    if (!u.data || typeof u.data !== "object") u.data = {};
    if (!Array.isArray(u.bancos)) u.bancos = [];
    if (!Array.isArray(u.categorias)) u.categorias = [];
    if (!u.tema) u.tema = "dark";
    if (!u.paleta) u.paleta = "azul";
  });
  return db;
}

function writeDb(db) {
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf-8");
  fs.renameSync(tmp, DB_PATH);
}

function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isBcryptHash(s) {
  const v = String(s || "");
  return /^\$2[aby]\$\d{2}\$/.test(v);
}

function uniqStrings(arr) {
  const out = [];
  const seen = new Set();
  (arr || []).forEach(x => {
    const s = String(x || "").trim();
    if (!s) return;
    const k = s.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(s);
  });
  return out;
}

function assertStrongPassword(pw) {
  const p = String(pw || "");
  if (p.length < 8) return "A senha deve ter no mínimo 8 caracteres.";
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return "Use letras e números na senha.";
  return null;
}

// ---------- Auth ----------
function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "Sem token" });

  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    const db = readDb();
    const user = db.users.find(u => u.id === payload.sub) || db.users.find(u => u.email === normEmail(payload.email));
    if (!user) return res.status(401).json({ error: "Usuário não encontrado" });
    req.user = user;
    req._db = db; // opcional: reutilizar em rotas
    next();
  } catch (e) {
    return res.status(401).json({ error: "Token inválido" });
  }
}

function adminOnly(req, res, next) {
  const role = String(req.user?.role || "USER").toUpperCase();
  if (role !== "ADMIN") return res.status(403).json({ error: "Acesso restrito (ADMIN)" });
  next();
}

// ---------- API ----------
app.post("/api/login", async (req, res) => {
  const email = normEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (!email || !password) return res.status(400).json({ error: "Informe e-mail e senha" });

  const db = readDb();
  let user = db.users.find(u => u.email === email);

  // cria no primeiro login
  if (!user) {
    const role = (email === ADMIN_EMAIL) ? "ADMIN" : "USER";
    const hash = await bcrypt.hash(password, 10);
    user = {
      id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
      email,
      password: hash,
      role,
      tema: "dark",
      paleta: "azul",
      bancos: [],
      categorias: [],
      data: {}
    };
    db.users.push(user);
    writeDb(db);
  } else {
    // Se o usuário existe mas não tem password (db simplificado), define no 1º login
    if (!user.password) {
      const hash = await bcrypt.hash(password, 10);
      user.password = hash;
      // normalize role
      user.role = (String(user.role || "USER").toUpperCase() === "ADMIN") ? "ADMIN" : "USER";
      writeDb(db);
    } else {
      // valida password (bcrypt OU texto puro)
      let ok = false;
      if (isBcryptHash(user.password)) {
        ok = await bcrypt.compare(password, user.password);
      } else {
        ok = (String(user.password) === password);
      }
      if (!ok) return res.status(401).json({ error: "Senha inválida" });

      // migra password em texto para bcrypt
      if (!isBcryptHash(user.password)) {
        user.password = await bcrypt.hash(password, 10);
        writeDb(db);
      }
      // normalize role
      user.role = (String(user.role || "USER").toUpperCase() === "ADMIN") ? "ADMIN" : "USER";
    }
  }

  const token = signToken(user);
  return res.json({
    token,
    user: {
      email: user.email,
      role: user.role,
      tema: user.tema || "dark",
      paleta: user.paleta || "azul",
      bancos: user.bancos || [],
      categorias: user.categorias || []
    }
  });
});

app.get("/api/me", auth, (req, res) => {
  const u = req.user;
  res.json({
    email: u.email,
    role: u.role,
    tema: u.tema || "dark",
    paleta: u.paleta || "azul",
    bancos: u.bancos || [],
    categorias: u.categorias || []
  });
});

app.put("/api/settings", auth, (req, res) => {
  const db = req._db || readDb();
  const user = db.users.find(x => x.id === req.user.id);
  if (!user) return res.status(401).json({ error: "Usuário não encontrado" });

  const tema = req.body?.tema;
  const paleta = req.body?.paleta;

  if (tema === "dark" || tema === "light") user.tema = tema;
  if (typeof paleta === "string" && paleta.trim()) user.paleta = paleta.trim();

  if (Array.isArray(req.body?.bancos)) user.bancos = uniqStrings(req.body.bancos);
  if (Array.isArray(req.body?.categorias)) user.categorias = uniqStrings(req.body.categorias);

  writeDb(db);
  res.json({ ok: true });
});

function monthKey(ano, mes) {
  const a = String(ano);
  const m = String(mes).padStart(2, "0");
  return `${a}-${m}`;
}

app.get("/api/data/:ano/:mes", auth, (req, res) => {
  const ano = Number(req.params.ano);
  const mes = Number(req.params.mes);
  if (!ano || !mes || mes < 1 || mes > 12) return res.status(400).json({ error: "Ano/mês inválidos" });

  const db = req._db || readDb();
  const user = db.users.find(x => x.id === req.user.id);
  if (!user) return res.status(401).json({ error: "Usuário não encontrado" });

  const k = monthKey(ano, mes);
  if (!user.data[k]) user.data[k] = { contas: [], saldos: {} };

  writeDb(db);
  res.json({
    contas: user.data[k].contas || [],
    saldos: user.data[k].saldos || {},
    bancos: user.bancos || [],
    categorias: user.categorias || []
  });
});

app.put("/api/data/:ano/:mes", auth, (req, res) => {
  const ano = Number(req.params.ano);
  const mes = Number(req.params.mes);
  if (!ano || !mes || mes < 1 || mes > 12) return res.status(400).json({ error: "Ano/mês inválidos" });

  const contas = Array.isArray(req.body?.contas) ? req.body.contas : [];
  const saldos = (req.body?.saldos && typeof req.body.saldos === "object") ? req.body.saldos : {};

  const db = req._db || readDb();
  const user = db.users.find(x => x.id === req.user.id);
  if (!user) return res.status(401).json({ error: "Usuário não encontrado" });

  const k = monthKey(ano, mes);
  if (!user.data[k]) user.data[k] = { contas: [], saldos: {} };

  user.data[k].contas = contas;
  user.data[k].saldos = saldos;

  writeDb(db);
  res.json({ ok: true });
});

app.put("/api/password", auth, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");

  const err = assertStrongPassword(newPassword);
  if (err) return res.status(400).json({ error: err });

  const db = req._db || readDb();
  const user = db.users.find(x => x.id === req.user.id);
  if (!user) return res.status(401).json({ error: "Usuário não encontrado" });

  // valida atual (compat)
  let ok = false;
  if (!user.password) ok = false;
  else if (isBcryptHash(user.password)) ok = await bcrypt.compare(currentPassword, user.password);
  else ok = (String(user.password) === currentPassword);

  if (!ok) return res.status(401).json({ error: "Senha atual incorreta" });

  user.password = await bcrypt.hash(newPassword, 10);
  writeDb(db);
  res.json({ ok: true });
});

// ---------- ADMIN ----------
app.get("/api/admin/users", auth, adminOnly, (req, res) => {
  const db = req._db || readDb();
  const out = db.users
    .map(u => ({ email: u.email, role: u.role }))
    .sort((a, b) => a.email.localeCompare(b.email, "pt-BR"));
  res.json(out);
});

app.post("/api/admin/users", auth, adminOnly, async (req, res) => {
  const email = normEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const roleRaw = String(req.body?.role || "USER").toUpperCase();
  const role = (roleRaw === "ADMIN") ? "ADMIN" : "USER";

  if (!email || !password) return res.status(400).json({ error: "Informe e-mail e senha" });

  const err = assertStrongPassword(password);
  if (err) return res.status(400).json({ error: err });

  const db = req._db || readDb();
  if (db.users.some(u => u.email === email)) return res.status(400).json({ error: "Usuário já existe" });

  const hash = await bcrypt.hash(password, 10);
  db.users.push({
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
    email,
    password: hash,
    role: (email === ADMIN_EMAIL) ? "ADMIN" : role,
    tema: "dark",
    paleta: "azul",
    bancos: [],
    categorias: [],
    data: {}
  });
  writeDb(db);
  res.json({ ok: true });
});

app.delete("/api/admin/users/:email", auth, adminOnly, (req, res) => {
  const target = normEmail(req.params.email);
  const self = normEmail(req.user.email);

  if (!target) return res.status(400).json({ error: "E-mail inválido" });
  if (target === self) return res.status(400).json({ error: "Não pode apagar o usuário logado" });

  const db = req._db || readDb();
  const idx = db.users.findIndex(u => u.email === target);
  if (idx < 0) return res.status(404).json({ error: "Usuário não encontrado" });

  const role = String(db.users[idx].role || "USER").toUpperCase();
  if (role === "ADMIN") return res.status(400).json({ error: "Não apago ADMIN pelo painel" });

  db.users.splice(idx, 1);
  writeDb(db);
  res.json({ ok: true });
});

app.put("/api/admin/users/:email/password", auth, adminOnly, async (req, res) => {
  const target = normEmail(req.params.email);
  const password = String(req.body?.password || "");

  if (!target || !password) return res.status(400).json({ error: "Informe e-mail e senha" });

  const err = assertStrongPassword(password);
  if (err) return res.status(400).json({ error: err });

  const db = req._db || readDb();
  const user = db.users.find(u => u.email === target);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado" });

  user.password = await bcrypt.hash(password, 10);
  writeDb(db);
  res.json({ ok: true });
});

// ---------- Static frontend ----------
const FRONT_DIR = path.join(__dirname, "frontend");
if (fs.existsSync(FRONT_DIR)) {
  app.use(express.static(FRONT_DIR));
  app.get("/", (req, res) => res.sendFile(path.join(FRONT_DIR, "index.html")));
  app.get("/index.html", (req, res) => res.sendFile(path.join(FRONT_DIR, "index.html")));
} else {
  console.warn("Pasta ./frontend não encontrada. Crie 'frontend/index.html' para servir a interface.");
  app.get("/", (req, res) => res.send("Frontend não encontrado. Crie a pasta ./frontend com index.html"));
}

app.listen(PORT, () => {
  console.log("API on", PORT);
  console.log("DB:", DB_PATH);
  console.log("ADMIN_EMAIL:", ADMIN_EMAIL);
});
