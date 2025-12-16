const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;

const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_FILE = path.join(DATA_DIR, "db.json");

// Estrutura na memória
let db = {
  users: []
};

// Sessões em memória: token -> userId
const sessions = {};

// ---------- Funções utilitárias ----------

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, "utf8");
      db = JSON.parse(content || "{}");
      if (!db.users) db.users = [];
    } else {
      db = { users: [] };
      saveDB();
    }
  } catch (err) {
    console.error("Erro ao carregar db.json:", err);
    db = { users: [] };
  }
}

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (err) {
    console.error("Erro ao salvar db.json:", err);
  }
}

function gerarToken() {
  return crypto.randomBytes(24).toString("hex");
}

function getMesKey(ano, mes) {
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

// Retorna usuário pelo ID
function findUserById(id) {
  return db.users.find(u => u.id === id);
}

// ---------- Middlewares ----------

const allowed = (process.env.FRONTEND_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: allowed.length ? allowed : true,
  methods: ["GET","POST","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
}));

app.use(express.json());

app.get("/", (req, res) => {
  res.send("API do Controle de Pagamentos está no ar 🚀");
});



// Carrega DB na inicialização
loadDB();

// Middleware de autenticação
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || "";
  const [tipo, token] = auth.split(" ");

  if (tipo !== "Bearer" || !token) {
    return res.status(401).json({ error: "Token ausente ou inválido" });
  }

  const userId = sessions[token];
  if (!userId) {
    return res.status(401).json({ error: "Sessão inválida ou expirada" });
  }

  const user = findUserById(userId);
  if (!user) {
    return res.status(401).json({ error: "Usuário não encontrado" });
  }

  req.user = user;
  req.token = token;
  next();
}

// ---------- Rotas ----------

// 1) Login
// - Se NÃO houver usuário cadastrado ainda, cria o primeiro com o e-mail/senha enviados.
// - Se já houver, valida e-mail/senha.
app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Informe email e password" });
  }

  loadDB(); // recarrega para garantir consistência

  if (db.users.length === 0) {
    // Cria primeiro usuário
    const newUser = {
      id: crypto.randomUUID(),
      email,
      // OBS: em produção, use hash (bcrypt). Aqui é só para uso pessoal.
      password,
      tema: "dark",
      bancos: ["Caixa", "Itaú", "Bradesco", "Santander", "Nubank", "C6 Bank"],
      categorias: ["Assinatura", "Cartão de crédito", "Conta básica", "Outros"],
      dadosPorMes: {} // { "2025-11": { contas: [...], saldos: {...} } }
    };
    db.users.push(newUser);
    saveDB();

    const token = gerarToken();
    sessions[token] = newUser.id;

    return res.json({
      token,
      user: {
        email: newUser.email,
        tema: newUser.tema,
        bancos: newUser.bancos,
        categorias: newUser.categorias
      }
    });
  }

  // Já existe pelo menos um usuário: acha por e-mail
  const user = db.users.find(u => u.email === email);
  if (!user) {
    return res.status(401).json({ error: "Usuário não encontrado" });
  }
  if (user.password !== password) {
    return res.status(401).json({ error: "Senha inválida" });
  }

  const token = gerarToken();
  sessions[token] = user.id;

  return res.json({
    token,
    user: {
      email: user.email,
      tema: user.tema,
      bancos: user.bancos,
      categorias: user.categorias
    }
  });
});

// 2) Obter dados de um mês
// GET /api/data/:ano/:mes
app.get("/api/data/:ano/:mes", authMiddleware, (req, res) => {
  const { ano, mes } = req.params;
  const user = req.user;

  if (!user.dadosPorMes) {
    user.dadosPorMes = {};
  }

  const chave = getMesKey(ano, mes);
  if (!user.dadosPorMes[chave]) {
    // se não existir ainda, cria vazio
    user.dadosPorMes[chave] = {
      contas: [],
      saldos: {}
    };
    saveDB();
  }

  const regMes = user.dadosPorMes[chave];

  return res.json({
    ano: Number(ano),
    mes: Number(mes),
    contas: regMes.contas || [],
    saldos: regMes.saldos || {},
    bancos: user.bancos || [],
    categorias: user.categorias || [],
    tema: user.tema || "dark"
  });
});

// 3) Salvar dados de um mês
// PUT /api/data/:ano/:mes
// body: { contas: [...], saldos: {...} }
app.put("/api/data/:ano/:mes", authMiddleware, (req, res) => {
  const { ano, mes } = req.params;
  const { contas, saldos } = req.body || {};
  const user = req.user;

  if (!user.dadosPorMes) {
    user.dadosPorMes = {};
  }

  const chave = getMesKey(ano, mes);
  user.dadosPorMes[chave] = {
    contas: Array.isArray(contas) ? contas : [],
    saldos: saldos && typeof saldos === "object" ? saldos : {}
  };

  saveDB();

  return res.json({ ok: true });
});

// 4) Atualizar configurações (bancos, categorias, tema)
// PUT /api/settings
// body: { bancos?: string[], categorias?: string[], tema?: "dark"|"light" }
app.put("/api/settings", authMiddleware, (req, res) => {
  const { bancos, categorias, tema } = req.body || {};
  const user = req.user;

  if (Array.isArray(bancos)) {
    user.bancos = bancos;
  }
  if (Array.isArray(categorias)) {
    user.categorias = categorias;
  }
  if (tema === "dark" || tema === "light") {
    user.tema = tema;
  }

  saveDB();

  return res.json({
    email: user.email,
    tema: user.tema,
    bancos: user.bancos,
    categorias: user.categorias
  });
});

// 5) Obter informações básicas do usuário logado
// GET /api/me
app.get("/api/me", authMiddleware, (req, res) => {
  const user = req.user;
  return res.json({
    email: user.email,
    tema: user.tema,
    bancos: user.bancos,
    categorias: user.categorias
  });
});

// ---------- Início do servidor ----------

app.listen(PORT, "0.0.0.0", () => console.log("API on", PORT));
