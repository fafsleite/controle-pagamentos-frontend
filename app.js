<script>
    // ========= CONFIG BACKEND / AUTH =========
    const API_BASE_URL      = "https://controle-pagamentos-backend-765c.onrender.com";
    const AUTH_TOKEN_KEY    = "controle_pagamentos_token";
    const AUTH_EMAIL_KEY    = "controle_pagamentos_email";
    const CONFIG_KEY        = "controle_pagamentos_config_v1";

    // ========= ESTADO GLOBAL =========
    let authToken = null;
    let userEmail = null;

    let dadosPorMes = {}; // { "2025-11": {contas:[], saldos:{}} }
    let bancos      = [];
    let categorias  = [];
    let anoAtual;
    let mesAtual;

    let ordenacaoCampo   = "nenhum";
    let ordenacaoDirecao = "asc";

    let graficoBanco     = null;
    let graficoCategoria = null;
    let graficoPeriodo   = null;

    let temaAtual = "dark";

    // ========= UTILITÁRIOS =========
    function hojeZero() {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    }
    function keyMes(ano, mes) {
      return `${ano}-${String(mes).padStart(2, "0")}`;
    }
    function formatarData(iso) {
      if (!iso) return "";
      return String(iso).slice(0, 10);
    }
    function dataLocalDeIso(iso) {
      if (!iso) return null;
      const partes = String(iso).split("-");
      if (partes.length < 3) return null;
      const ano = Number(partes[0]);
      const mes = Number(partes[1]);
      const dia = Number(partes[2]);
      if (!ano || !mes || !dia) return null;
      return new Date(ano, mes - 1, dia);
    }
    function diaDe(iso) {
      const d = dataLocalDeIso(iso);
      if (!d) return null;
      return d.getDate();
    }
    function gerarDataVencimento(ano, mes, dia) {
      if (!dia) dia = 1;
      const d = new Date(ano, mes - 1, dia);
      if (d.getMonth() !== mes - 1) {
        const ultimoDia = new Date(ano, mes, 0).getDate();
        return new Date(ano, mes - 1, ultimoDia).toISOString().slice(0, 10);
      }
      return d.toISOString().slice(0, 10);
    }
    function formatarValor(v) {
      if (v == null || isNaN(v)) v = 0;
      return Number(v).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }
    function parseValor(str) {
      if (!str) return 0;
      str = String(str).replace(/\./g, "").replace(",", ".");
      const n = Number(str);
      return isNaN(n) ? 0 : n;
    }

    // ========= API =========
    async function apiFetch(path, options = {}) {
      const opts = { ...options };
      opts.headers = { ...(opts.headers || {}) };
      if (opts.body && !opts.headers["Content-Type"]) {
        opts.headers["Content-Type"] = "application/json";
      }
      if (authToken) {
        opts.headers["Authorization"] = "Bearer " + authToken;
      }
      const res = await fetch(API_BASE_URL + path, opts);
      if (!res.ok) {
        let msg = "Erro de API: " + res.status;
        try {
          const body = await res.json();
          if (body && body.error) msg = body.error;
        } catch (_) {}
        throw new Error(msg);
      }
      const contentType = res.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        return res.json();
      }
      return res.text();
    }

    // ========= TEMA =========
    function obterCoresTema() {
      const isLight = document.body.classList.contains("light-theme");
      return { text: isLight ? "#020617" : "#e5e7eb" };
    }
    function aplicarTema(tema) {
      temaAtual = tema === "light" ? "light" : "dark";
      document.body.classList.toggle("light-theme", temaAtual === "light");
      document.body.classList.toggle("dark-theme", temaAtual === "dark");
      const btn = document.getElementById("btnTema");
      if (btn) {
        if (temaAtual === "dark") {
          btn.textContent = "🌙";
          btn.title = "Modo escuro (clique para modo claro)";
        } else {
          btn.textContent = "☀️";
          btn.title = "Modo claro (clique para modo escuro)";
        }
      }
      atualizarGraficos();
      atualizarVisaoPeriodo();
    }
    function alternarTema() {
      const novo = temaAtual === "dark" ? "light" : "dark";
      aplicarTema(novo);
      if (authToken) {
        apiFetch("/api/settings", {
          method: "PUT",
          body: JSON.stringify({ tema: novo })
        }).catch(err => console.error("Erro ao salvar tema:", err));
      }
    }

    // ========= STATUS =========
    function calcularStatus(pagamento) {
      if (pagamento.pago) {
        return { texto: "Pago", classe: "status-pago" };
      }
      if (!pagamento.vencimento) {
        return { texto: "Em aberto", classe: "status-aberto" };
      }

      const hoje = hojeZero();
      const dataVenc = dataLocalDeIso(pagamento.vencimento);
      if (!dataVenc) {
        return { texto: "Em aberto", classe: "status-aberto" };
      }
      dataVenc.setHours(0, 0, 0, 0);

      const diffMs = dataVenc.getTime() - hoje.getTime();
      const diaMs = 1000 * 60 * 60 * 24;
      const diffDias = Math.floor(diffMs / diaMs);

      if (diffDias < 0) {
        return { texto: "Vencida", classe: "status-vencido" };
      } else if (diffDias === 0) {
        return { texto: "Vence hoje", classe: "status-perto" };
      } else if (diffDias <= 5) {
        return { texto: `Vence em ${diffDias} dia(s)`, classe: "status-perto" };
      } else {
        return { texto: "Em aberto", classe: "status-aberto" };
      }
    }

    // ========= CATEGORIA AUTOMÁTICA =========
    function inferirCategoriaPorConta(nome) {
      if (!nome) return "";
      const n = nome.toLowerCase();

      if (n.includes("água") || n.includes("agua") || n.includes("sabesp") || n.includes("saae"))
        return "Conta básica";
      if (n.includes("luz") || n.includes("energia") || n.includes("enel") || n.includes("cpfl"))
        return "Conta básica";
      if (n.includes("gás") || n.includes("gas"))
        return "Conta básica";

      if (n.includes("cartão") || n.includes("cartao") ||
          n.includes("visa") || n.includes("master") ||
          n.includes("nubank") || n.includes("c6") || n.includes("inter"))
        return "Cartão de crédito";

      if (n.includes("netflix") || n.includes("spotify") || n.includes("prime") || n.includes("disney"))
        return "Assinatura";

      return "";
    }

    // ========= SALVAR NO BACKEND =========
    function salvarDadosMesAtual() {
      if (!authToken || anoAtual == null || mesAtual == null) return;
      const chave = keyMes(anoAtual, mesAtual);
      const reg = dadosPorMes[chave];
      if (!reg) return;

      const corpo = {
        contas: reg.contas || [],
        saldos: reg.saldos || {}
      };
      apiFetch(`/api/data/${anoAtual}/${mesAtual}`, {
        method: "PUT",
        body: JSON.stringify(corpo)
      }).catch(err => console.error("Erro ao salvar dados do mês:", err));
    }
    function salvarBancos() {
      if (!authToken) return;
      apiFetch("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ bancos })
      }).catch(err => console.error("Erro ao salvar bancos:", err));
    }
    function salvarCategorias() {
      if (!authToken) return;
      apiFetch("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ categorias })
      }).catch(err => console.error("Erro ao salvar categorias:", err));
    }

    // ========= RESUMO / TABELAS (igual antes, usando dadosPorMes) =========
    function atualizarResumo() {
      const chave = keyMes(anoAtual, mesAtual);
      const reg = dadosPorMes[chave] || { contas: [], saldos: {} };
      const lista = reg.contas || [];

      const totalMes = lista.reduce((acc, p) => acc + (Number(p.valor) || 0), 0);
      const totalPago = lista
        .filter(p => p.pago)
        .reduce((acc, p) => acc + (Number(p.valor) || 0), 0);
      const totalAberto = Math.max(0, totalMes - totalPago);

      document.getElementById("totalMes").textContent    = "R$ " + formatarValor(totalMes);
      document.getElementById("totalPago").textContent   = "R$ " + formatarValor(totalPago);
      document.getElementById("totalAberto").textContent = "R$ " + formatarValor(totalAberto);
    }

    function renderizarResumoBancos() {
      const corpo = document.getElementById("tabelaResumoBancos");
      corpo.innerHTML = "";

      const chave = keyMes(anoAtual, mesAtual);
      const reg = dadosPorMes[chave] || { contas: [], saldos: {} };
      const lista = reg.contas || [];
      const saldos = reg.saldos || {};

      let somaSaldoFinal = 0;

      bancos.forEach(b => {
        const tr = document.createElement("tr");

        const tdBanco = document.createElement("td");
        tdBanco.textContent = b;
        tr.appendChild(tdBanco);

        const tdSaldoIni = document.createElement("td");
        const inpSaldoIni = document.createElement("input");
        inpSaldoIni.type = "text";
        inpSaldoIni.className = "small-money";
        const valorSaldoIni = saldos[b] != null ? saldos[b] : 0;
        inpSaldoIni.value = formatarValor(valorSaldoIni);
        inpSaldoIni.addEventListener("change", () => {
          saldos[b] = parseValor(inpSaldoIni.value);
          reg.saldos = saldos;
          salvarDadosMesAtual();
          renderizarResumoBancos();
          atualizarGraficos();
          atualizarVisaoPeriodo();
        });
        tdSaldoIni.appendChild(inpSaldoIni);
        tr.appendChild(tdSaldoIni);

        const totalPagoBanco = lista
          .filter(p => p.pago && p.banco === b)
          .reduce((acc, p) => acc + (Number(p.valor) || 0), 0);

        const tdTotalPago = document.createElement("td");
        tdTotalPago.textContent = "R$ " + formatarValor(totalPagoBanco);
        tr.appendChild(tdTotalPago);

        const totalAbertoBanco = lista
          .filter(p => !p.pago && p.banco === b)
          .reduce((acc, p) => acc + (Number(p.valor) || 0), 0);

        const tdAberto = document.createElement("td");
        tdAberto.textContent = "R$ " + formatarValor(totalAbertoBanco);
        tr.appendChild(tdAberto);

        const saldoFinal = valorSaldoIni - totalPagoBanco;
        somaSaldoFinal += saldoFinal;

        const tdSaldoFinal = document.createElement("td");
        tdSaldoFinal.textContent = "R$ " + formatarValor(saldoFinal);
        tr.appendChild(tdSaldoFinal);

        corpo.appendChild(tr);
      });

      document.getElementById("saldoTotalBancos").textContent = "R$ " + formatarValor(somaSaldoFinal);
    }

    function renderizarResumoCategorias() {
      const corpo = document.getElementById("tabelaResumoCategorias");
      corpo.innerHTML = "";

      const chave = keyMes(anoAtual, mesAtual);
      const reg = dadosPorMes[chave] || { contas: [], saldos: {} };
      const lista = reg.contas || [];

      const mapa = {};
      lista.forEach(p => {
        if (!p.categoria) return;
        const cat = p.categoria;
        if (!mapa[cat]) mapa[cat] = { total: 0, pago: 0, aberto: 0 };
        const valor = Number(p.valor) || 0;
        mapa[cat].total += valor;
        if (p.pago) mapa[cat].pago += valor;
        else mapa[cat].aberto += valor;
      });

      Object.keys(mapa)
        .sort((a, b) => a.localeCompare(b, "pt-BR"))
        .forEach(cat => {
          const tr = document.createElement("tr");
          const tdCat = document.createElement("td");
          tdCat.textContent = cat;
          tr.appendChild(tdCat);

          const tdTot = document.createElement("td");
          tdTot.textContent = "R$ " + formatarValor(mapa[cat].total);
          tr.appendChild(tdTot);

          const tdPago = document.createElement("td");
          tdPago.textContent = "R$ " + formatarValor(mapa[cat].pago);
          tr.appendChild(tdPago);

          const tdAberto = document.createElement("td");
          tdAberto.textContent = "R$ " + formatarValor(mapa[cat].aberto);
          tr.appendChild(tdAberto);

          corpo.appendChild(tr);
        });
    }

    function renderizarTopContasMes() {
      const corpo = document.getElementById("tabelaTopContas");
      corpo.innerHTML = "";

      const chave = keyMes(anoAtual, mesAtual);
      const reg = dadosPorMes[chave] || { contas: [], saldos: {} };
      const lista = reg.contas || [];

      const mapa = {};
      lista.forEach(p => {
        if (!p.conta) return;
        const chave = p.conta.toLowerCase();
        if (!mapa[chave]) {
          mapa[chave] = {
            nome: p.conta,
            categoria: p.categoria || "",
            bancos: new Set(),
            valorTotal: 0,
            statusList: []
          };
        }
        mapa[chave].valorTotal += Number(p.valor) || 0;
        if (p.banco) mapa[chave].bancos.add(p.banco);
        const st = calcularStatus(p);
        mapa[chave].statusList.push(st.classe);
        if (!mapa[chave].categoria && p.categoria) {
          mapa[chave].categoria = p.categoria;
        }
      });

      const agregados = Object.values(mapa)
        .filter(x => x.valorTotal > 0)
        .sort((a, b) => b.valorTotal - a.valorTotal)
        .slice(0, 5);

      agregados.forEach(item => {
        const tr = document.createElement("tr");

        const tdConta = document.createElement("td");
        tdConta.textContent = item.nome;
        tr.appendChild(tdConta);

        const tdCat = document.createElement("td");
        tdCat.textContent = item.categoria || "";
        tr.appendChild(tdCat);

        const tdBanco = document.createElement("td");
        const bancosArr = Array.from(item.bancos);
        tdBanco.textContent = bancosArr.length > 1 ? "Vários" : (bancosArr[0] || "");
        tr.appendChild(tdBanco);

        const tdValor = document.createElement("td");
        tdValor.textContent = "R$ " + formatarValor(item.valorTotal);
        tr.appendChild(tdValor);

        const tdStatus = document.createElement("td");
        let classeFinal = "status-aberto";
        let textoFinal = "Em aberto";
        if (item.statusList.every(c => c === "status-pago")) {
          classeFinal = "status-pago";
          textoFinal = "Pago";
        } else if (item.statusList.some(c => c === "status-vencido")) {
          classeFinal = "status-vencido";
          textoFinal = "Vencida";
        } else if (item.statusList.some(c => c === "status-perto")) {
          classeFinal = "status-perto";
          textoFinal = "Vence em breve";
        }
        tdStatus.textContent = textoFinal;
        tdStatus.className = classeFinal;
        tr.appendChild(tdStatus);

        corpo.appendChild(tr);
      });
    }

    // ========= SELECTS DE BANCOS / CATEGORIAS =========
    function renderizarBancosSelects() {
      const selModelo = document.getElementById("selectBancoModelo");
      const selFiltro = document.getElementById("filtroBanco");

      selModelo.innerHTML = "";
      selFiltro.innerHTML = "";

      const optTodos = document.createElement("option");
      optTodos.value = "";
      optTodos.textContent = "Todos";
      selFiltro.appendChild(optTodos);

      bancos.forEach(b => {
        const opt1 = document.createElement("option");
        opt1.value = b;
        opt1.textContent = b;
        selModelo.appendChild(opt1);

        const opt2 = document.createElement("option");
        opt2.value = b;
        opt2.textContent = b;
        selFiltro.appendChild(opt2);
      });
    }

    function renderizarCategoriasSelects() {
      const selModelo = document.getElementById("selectCategoriaModelo");
      const selFiltro = document.getElementById("filtroCategoria");

      selModelo.innerHTML = "";
      selFiltro.innerHTML = "";

      const optTodos = document.createElement("option");
      optTodos.value = "";
      optTodos.textContent = "Todas";
      selFiltro.appendChild(optTodos);

      const ordenadas = [...categorias].sort((a, b) => a.localeCompare(b, "pt-BR"));
      ordenadas.forEach(c => {
        const opt1 = document.createElement("option");
        opt1.value = c;
        opt1.textContent = c;
        selModelo.appendChild(opt1);

        const opt2 = document.createElement("option");
        opt2.value = c;
        opt2.textContent = c;
        selFiltro.appendChild(opt2);
      });
    }

    // ========= ORDENACAO =========
    function aplicarOrdenacao(lista) {
      if (ordenacaoCampo === "nenhum") return lista;
      const dir = ordenacaoDirecao === "asc" ? 1 : -1;
      const copia = [...lista];

      copia.sort((a, b) => {
        let va, vb;
        switch (ordenacaoCampo) {
          case "vencimento":
            va = dataLocalDeIso(a.vencimento) || new Date(2100, 0, 1);
            vb = dataLocalDeIso(b.vencimento) || new Date(2100, 0, 1);
            if (va < vb) return -1 * dir;
            if (va > vb) return 1 * dir;
            return 0;
          case "categoria":
            va = (a.categoria || "").toLowerCase();
            vb = (b.categoria || "").toLowerCase();
            break;
          case "conta":
            va = (a.conta || "").toLowerCase();
            vb = (b.conta || "").toLowerCase();
            break;
          case "banco":
            va = (a.banco || "").toLowerCase();
            vb = (b.banco || "").toLowerCase();
            break;
          case "valor":
            va = Number(a.valor) || 0;
            vb = Number(b.valor) || 0;
            break;
          default:
            va = 0; vb = 0;
        }
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });

      return copia;
    }

    // ========= CONFIG (FILTROS LOCAIS) =========
    function salvarConfig() {
      const cfg = {
        filtroStatus:    document.getElementById("filtroStatus").value,
        ordenarPor:      document.getElementById("ordenarPor").value,
        ordenarDirecao:  document.getElementById("ordenarDirecao").value,
        filtroBanco:     document.getElementById("filtroBanco").value,
        filtroCategoria: document.getElementById("filtroCategoria").value,
        filtroBusca:     document.getElementById("filtroBusca").value
      };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    }
    function aplicarConfigSalvaSeExistir() {
      const salvo = localStorage.getItem(CONFIG_KEY);
      if (!salvo) return;
      try {
        const cfg = JSON.parse(salvo);
        if (cfg.filtroStatus != null)
          document.getElementById("filtroStatus").value = cfg.filtroStatus;
        if (cfg.ordenarPor != null)
          document.getElementById("ordenarPor").value = cfg.ordenarPor;
        if (cfg.ordenarDirecao != null)
          document.getElementById("ordenarDirecao").value = cfg.ordenarDirecao;
        if (cfg.filtroBanco != null)
          document.getElementById("filtroBanco").value = cfg.filtroBanco;
        if (cfg.filtroCategoria != null)
          document.getElementById("filtroCategoria").value = cfg.filtroCategoria;
        if (cfg.filtroBusca != null)
          document.getElementById("filtroBusca").value = cfg.filtroBusca;

        ordenacaoCampo   = document.getElementById("ordenarPor").value;
        ordenacaoDirecao = document.getElementById("ordenarDirecao").value;
      } catch (e) {
        console.error("Erro ao aplicar config", e);
      }
    }

    // ========= TABELA PRINCIPAL =========
    function renderizarTabela() {
      if (anoAtual == null || mesAtual == null) return;

      const corpo = document.getElementById("tabelaPagamentos");
      corpo.innerHTML = "";

      const filtroStatus    = document.getElementById("filtroStatus").value;
      const filtroBanco     = document.getElementById("filtroBanco").value;
      const filtroCategoria = document.getElementById("filtroCategoria").value;
      const textoBusca      = document.getElementById("filtroBusca").value.toLowerCase().trim();

      const chave = keyMes(anoAtual, mesAtual);
      const reg = dadosPorMes[chave] || { contas: [], saldos: {} };
      const lista = reg.contas || [];

      let filtrados = lista.filter(p => {
        const st = calcularStatus(p);

        if (filtroStatus === "pagos"   && st.classe !== "status-pago")     return false;
        if (filtroStatus === "abertos" && st.classe === "status-pago")     return false;
        if (filtroStatus === "vencidos" && st.classe !== "status-vencido") return false;

        if (filtroBanco && p.banco !== filtroBanco)             return false;
        if (filtroCategoria && p.categoria !== filtroCategoria) return false;

        if (textoBusca) {
          const texto = [
            p.conta || "",
            p.categoria || "",
            p.banco || ""
          ].join(" ").toLowerCase();
          if (!texto.includes(textoBusca)) return false;
        }

        return true;
      });

      filtrados = aplicarOrdenacao(filtrados);

      filtrados.forEach(p => {
        const tr = document.createElement("tr");

        const tdConta = document.createElement("td");
        const inpConta = document.createElement("input");
        inpConta.type = "text";
        inpConta.value = p.conta || "";
        inpConta.className = "small-input";
        inpConta.addEventListener("change", () => {
          p.conta = inpConta.value;
          if (!p.categoria) {
            const catAuto = inferirCategoriaPorConta(p.conta);
            if (catAuto) {
              p.categoria = catAuto;
              if (!categorias.includes(catAuto)) {
                categorias.push(catAuto);
                salvarCategorias();
                renderizarCategoriasSelects();
              }
            }
          }
          salvarDadosMesAtual();
          atualizarResumo();
          renderizarResumoBancos();
          renderizarResumoCategorias();
          renderizarTopContasMes();
          atualizarGraficos();
          atualizarVisaoPeriodo();
        });
        tdConta.appendChild(inpConta);

        const tdCategoria = document.createElement("td");
        const selCategoria = document.createElement("select");
        selCategoria.className = "small-select";

        const optVazioCat = document.createElement("option");
        optVazioCat.value = "";
        optVazioCat.textContent = "";
        selCategoria.appendChild(optVazioCat);

        const ordenadasCat = [...categorias].sort((a, b) => a.localeCompare(b, "pt-BR"));
        ordenadasCat.forEach(c => {
          const opt = document.createElement("option");
          opt.value = c;
          opt.textContent = c;
          selCategoria.appendChild(opt);
        });

        selCategoria.value = p.categoria || "";
        selCategoria.addEventListener("change", () => {
          p.categoria = selCategoria.value;
          salvarDadosMesAtual();
          renderizarResumoCategorias();
          renderizarTopContasMes();
          atualizarGraficos();
          atualizarVisaoPeriodo();
        });
        tdCategoria.appendChild(selCategoria);

        const tdTipo = document.createElement("td");
        const selTipo = document.createElement("select");
        selTipo.className = "small-select";
        ["fixo", "variavel"].forEach(tipo => {
          const opt = document.createElement("option");
          opt.value = tipo;
          opt.textContent = tipo === "fixo" ? "Fixo" : "Variável";
          selTipo.appendChild(opt);
        });
        selTipo.value = p.tipo || "variavel";
        selTipo.addEventListener("change", () => {
          p.tipo = selTipo.value;
          salvarDadosMesAtual();
        });
        tdTipo.appendChild(selTipo);

        const tdVenc = document.createElement("td");
        const inpVenc = document.createElement("input");
        inpVenc.type = "date";
        inpVenc.value = formatarData(p.vencimento);
        inpVenc.className = "small-date";
        inpVenc.addEventListener("change", () => {
          p.vencimento = inpVenc.value || null;
          salvarDadosMesAtual();
          const st = calcularStatus(p);
          tdStatus.textContent = st.texto;
          tdStatus.className = st.classe;
          atualizarResumo();
          renderizarResumoBancos();
          renderizarTopContasMes();
          atualizarGraficos();
          atualizarVisaoPeriodo();
        });
        tdVenc.appendChild(inpVenc);

        const tdValor = document.createElement("td");
        const inpValor = document.createElement("input");
        inpValor.type = "text";
        inpValor.value = p.valor != null ? formatarValor(p.valor) : "";
        inpValor.className = "small-money";
        inpValor.addEventListener("change", () => {
          const v = parseValor(inpValor.value);
          p.valor = v;
          inpValor.value = formatarValor(v);
          salvarDadosMesAtual();
          atualizarResumo();
          renderizarResumoBancos();
          renderizarResumoCategorias();
          renderizarTopContasMes();
          atualizarGraficos();
          atualizarVisaoPeriodo();
        });
        tdValor.appendChild(inpValor);

        const tdBanco = document.createElement("td");
        const selBanco = document.createElement("select");
        selBanco.className = "small-select";

        const optVazioBanco = document.createElement("option");
        optVazioBanco.value = "";
        optVazioBanco.textContent = "";
        selBanco.appendChild(optVazioBanco);

        bancos.forEach(b => {
          const opt = document.createElement("option");
          opt.value = b;
          opt.textContent = b;
          selBanco.appendChild(opt);
        });

        selBanco.value = p.banco || "";
        selBanco.addEventListener("change", () => {
          p.banco = selBanco.value;
          salvarDadosMesAtual();
          renderizarResumoBancos();
          renderizarTopContasMes();
          atualizarGraficos();
          atualizarVisaoPeriodo();
        });
        tdBanco.appendChild(selBanco);

        const tdStatus = document.createElement("td");
        const st = calcularStatus(p);
        tdStatus.textContent = st.texto;
        tdStatus.className = st.classe;

        const tdAcao = document.createElement("td");

        const btnAcao = document.createElement("button");
        btnAcao.textContent = p.pago ? "Estornar" : "Registrar pagamento";
        btnAcao.style.marginRight = "4px";
        btnAcao.addEventListener("click", () => {
          const bancoSel = p.banco || selBanco.value;
          if (!bancoSel) {
            alert("Selecione um banco antes de registrar o pagamento.");
            return;
          }

          const chaveMes = keyMes(anoAtual, mesAtual);
          const regAll = dadosPorMes[chaveMes];

          if (p.pago) {
            const conf = confirm("Deseja estornar este pagamento?");
            if (!conf) return;
            p.pago = false;
            salvarDadosMesAtual();
            const st2 = calcularStatus(p);
            tdStatus.textContent = st2.texto;
            tdStatus.className = st2.classe;
            btnAcao.textContent = "Registrar pagamento";
            atualizarResumo();
            renderizarResumoBancos();
            renderizarResumoCategorias();
            renderizarTopContasMes();
            atualizarGraficos();
            atualizarVisaoPeriodo();
            return;
          }

          const total = Number(p.valor) || 0;
          if (total <= 0) {
            alert("Defina um valor da conta maior que zero antes de pagar.");
            return;
          }

          const padrao = formatarValor(total);
          const entrada = prompt(`Valor a pagar agora (total R$ ${formatarValor(total)}):`, padrao);
          if (entrada === null) return;
          const valorParcial = parseValor(entrada);
          if (valorParcial <= 0) {
            alert("Informe um valor maior que zero.");
            return;
          }

          const tol = 0.01;

          if (valorParcial >= total - tol) {
            p.banco = bancoSel;
            p.pago = true;
            salvarDadosMesAtual();
            const st2 = calcularStatus(p);
            tdStatus.textContent = st2.texto;
            tdStatus.className = st2.classe;
            btnAcao.textContent = "Estornar";
            atualizarResumo();
            renderizarResumoBancos();
            renderizarResumoCategorias();
            renderizarTopContasMes();
            atualizarGraficos();
            atualizarVisaoPeriodo();
            return;
          }

          const resto = total - valorParcial;

          p.banco = bancoSel;
          p.valor = valorParcial;
          p.pago = true;

          const nova = {
            conta: p.conta,
            categoria: p.categoria,
            tipo: p.tipo,
            vencimento: p.vencimento,
            valor: resto,
            banco: "",
            pago: false
          };

          const idx = regAll.contas.indexOf(p);
          if (idx >= 0) {
            regAll.contas.splice(idx + 1, 0, nova);
          } else {
            regAll.contas.push(nova);
          }

          salvarDadosMesAtual();
          renderizarTabela();
        });

        const btnDuplicar = document.createElement("button");
        btnDuplicar.textContent = "Duplicar";
        btnDuplicar.style.marginLeft = "2px";
        btnDuplicar.addEventListener("click", () => {
          const chaveMes = keyMes(anoAtual, mesAtual);
          const regAll = dadosPorMes[chaveMes];
          const nova = {
            conta:     p.conta,
            categoria: p.categoria,
            tipo:      p.tipo,
            vencimento: p.vencimento,
            valor:     p.valor,
            banco:     p.banco,
            pago:      false
          };
          regAll.contas.unshift(nova);
          salvarDadosMesAtual();
          renderizarTabela();
        });

        const btnExcluir = document.createElement("button");
        btnExcluir.textContent = "Excluir";
        btnExcluir.style.marginLeft = "2px";
        btnExcluir.addEventListener("click", () => {
          const chaveMes = keyMes(anoAtual, mesAtual);
          const regAll = dadosPorMes[chaveMes];
          const idx = regAll.contas.indexOf(p);
          if (idx >= 0) {
            const conf = confirm("Tem certeza que deseja excluir esta conta?");
            if (!conf) return;
            regAll.contas.splice(idx, 1);
            salvarDadosMesAtual();
            renderizarTabela();
          }
        });

        tdAcao.appendChild(btnAcao);
        tdAcao.appendChild(btnDuplicar);
        tdAcao.appendChild(btnExcluir);

        tr.appendChild(tdConta);
        tr.appendChild(tdCategoria);
        tr.appendChild(tdTipo);
        tr.appendChild(tdVenc);
        tr.appendChild(tdValor);
        tr.appendChild(tdBanco);
        tr.appendChild(tdStatus);
        tr.appendChild(tdAcao);

        corpo.appendChild(tr);
      });

      atualizarResumo();
      renderizarResumoBancos();
      renderizarResumoCategorias();
      renderizarTopContasMes();
      atualizarGraficos();
      atualizarVisaoPeriodo();
      salvarConfig();
    }

    // ========= MESES / ANO =========
    function preencherSelectsMesAno() {
      const selAno = document.getElementById("selectAno");
      const selMes = document.getElementById("selectMes");
      selAno.innerHTML = "";
      selMes.innerHTML = "";

      const hoje = new Date();
      const anoAtualLocal = hoje.getFullYear();
      const mesAtualLocal = hoje.getMonth() + 1;

      const totalMeses = 60;
      const anos = new Set();

      for (let i = 0; i < totalMeses; i++) {
        const d = new Date(anoAtualLocal, mesAtualLocal - 1 - i, 1);
        anos.add(d.getFullYear());
      }

      const anosOrdenados = Array.from(anos).sort((a, b) => b - a);
      anosOrdenados.forEach(a => {
        const opt = document.createElement("option");
        opt.value = a;
        opt.textContent = a;
        selAno.appendChild(opt);
      });

      const nomesMeses = [
        "01 - Janeiro", "02 - Fevereiro", "03 - Março", "04 - Abril",
        "05 - Maio", "06 - Junho", "07 - Julho", "08 - Agosto",
        "09 - Setembro", "10 - Outubro", "11 - Novembro", "12 - Dezembro"
      ];
      nomesMeses.forEach((nome, idx) => {
        const opt = document.createElement("option");
        opt.value = idx + 1;
        opt.textContent = nome;
        selMes.appendChild(opt);
      });

      anoAtual = anoAtualLocal;
      mesAtual = mesAtualLocal;
      selAno.value = anoAtual;
      selMes.value = mesAtual;
    }

    async function carregarMesDoServidor(ano, mes) {
      if (!authToken) return;
      const data = await apiFetch(`/api/data/${ano}/${mes}`, { method: "GET" });
      bancos = data.bancos || bancos;
      categorias = data.categorias || categorias;
      aplicarTema(data.tema || temaAtual);

      const chave = keyMes(ano, mes);
      dadosPorMes[chave] = {
        contas: data.contas || [],
        saldos: data.saldos || {}
      };
    }

    async function trocarMes() {
      const selAno = document.getElementById("selectAno");
      const selMes = document.getElementById("selectMes");
      anoAtual = Number(selAno.value);
      mesAtual = Number(selMes.value);
      await carregarMesDoServidor(anoAtual, mesAtual);
      renderizarBancosSelects();
      renderizarCategoriasSelects();
      aplicarConfigSalvaSeExistir();
      renderizarTabela();
    }

    async function gerarProximoMes() {
      let ano = anoAtual;
      let mes = mesAtual + 1;
      if (mes === 13) {
        mes = 1;
        ano += 1;
      }
      const selAno = document.getElementById("selectAno");
      const selMes = document.getElementById("selectMes");
      anoAtual = ano;
      mesAtual = mes;
      selAno.value = ano;
      selMes.value = mes;

      // se já existir no servidor, carrega; se não, cria local vazio baseado no mês anterior
      const chave = keyMes(ano, mes);
      if (!dadosPorMes[chave]) {
        // base no mês anterior
        let anoPrev = ano;
        let mesPrev = mes - 1;
        if (mesPrev === 0) {
          mesPrev = 12;
          anoPrev = ano - 1;
        }
        const chavePrev = keyMes(anoPrev, mesPrev);
        const prev = dadosPorMes[chavePrev];
        let novasContas = [];
        let novosSaldos = {};
        if (prev) {
          novasContas = (prev.contas || []).map(p => {
            const dia = diaDe(p.vencimento) || 1;
            const novoVenc = gerarDataVencimento(ano, mes, dia);
            return {
              conta:     p.conta,
              categoria: p.categoria || "",
              tipo:      p.tipo || "variavel",
              vencimento: novoVenc,
              valor:     (p.tipo === "fixo") ? p.valor : 0,
              banco:     p.banco || "",
              pago:      false
            };
          });
          const saldosPrev = prev.saldos || {};
          const resultado = {};
          bancos.forEach(b => {
            const saldoInicial = saldosPrev[b] || 0;
            const totalPago = (prev.contas || [])
              .filter(p => p.pago && p.banco === b)
              .reduce((acc, p) => acc + (Number(p.valor) || 0), 0);
            resultado[b] = saldoInicial - totalPago;
          });
          novosSaldos = resultado;
        }
        dadosPorMes[chave] = {
          contas: novasContas,
          saldos: novosSaldos
        };
        salvarDadosMesAtual();
      } else {
        await carregarMesDoServidor(ano, mes);
      }

      renderizarBancosSelects();
      renderizarCategoriasSelects();
      aplicarConfigSalvaSeExistir();
      renderizarTabela();
    }

    function adicionarConta() {
      const chave = keyMes(anoAtual, mesAtual);
      if (!dadosPorMes[chave]) {
        dadosPorMes[chave] = { contas: [], saldos: {} };
      }
      const reg = dadosPorMes[chave];
      const hoje = hojeZero();
      const primeiraCategoria = categorias.length
        ? [...categorias].sort((a, b) => a.localeCompare(b, "pt-BR"))[0]
        : "";
      const novo = {
        conta: "",
        categoria: primeiraCategoria,
        tipo: "variavel",
        vencimento: gerarDataVencimento(anoAtual, mesAtual, hoje.getDate()),
        valor: 0,
        banco: "",
        pago: false
      };
      reg.contas.unshift(novo);
      salvarDadosMesAtual();
      renderizarTabela();
    }

    // ========= BANCOS / CATEGORIAS (adicionar/remover) =========
    function adicionarBanco() {
      const inp = document.getElementById("novoBanco");
      const valor = inp.value.trim();
      if (!valor) return;
      if (!bancos.includes(valor)) {
        bancos.push(valor);
        salvarBancos();
        renderizarBancosSelects();
        renderizarTabela();
      }
      inp.value = "";
    }

    function removerBanco() {
      const sel = document.getElementById("selectBancoModelo");
      const valor = sel.value;
      if (!valor) return;
      if (!confirm(`Remover o banco "${valor}" da lista?`)) return;

      bancos = bancos.filter(b => b !== valor);
      salvarBancos();

      for (const chave in dadosPorMes) {
        const reg = dadosPorMes[chave];
        if (!reg) continue;
        if (reg.saldos && Object.prototype.hasOwnProperty.call(reg.saldos, valor)) {
          delete reg.saldos[valor];
        }
        if (reg.contas) {
          reg.contas.forEach(p => {
            if (p.banco === valor) p.banco = "";
          });
        }
      }
      salvarDadosMesAtual();
      renderizarBancosSelects();
      renderizarTabela();
    }

    function adicionarCategoria() {
      const inp = document.getElementById("novaCategoria");
      const valor = inp.value.trim();
      if (!valor) return;
      if (!categorias.includes(valor)) {
        categorias.push(valor);
        salvarCategorias();
        renderizarCategoriasSelects();
        renderizarTabela();
      }
      inp.value = "";
    }

    function removerCategoria() {
      const sel = document.getElementById("selectCategoriaModelo");
      const valor = sel.value;
      if (!valor) return;
      if (!confirm(`Remover a categoria "${valor}" da lista?`)) return;

      categorias = categorias.filter(c => c !== valor);
      salvarCategorias();

      for (const chave in dadosPorMes) {
        const reg = dadosPorMes[chave];
        if (!reg) continue;
        if (reg.contas) {
          reg.contas.forEach(p => {
            if (p.categoria === valor) p.categoria = "";
          });
        }
      }
      salvarDadosMesAtual();
      renderizarCategoriasSelects();
      renderizarTabela();
    }

    // ========= IMPORTAÇÃO / EXPORTAÇÃO =========
    function csvParaRegistros(texto) {
      const linhas = texto.split(/\r?\n/).filter(l => l.trim() !== "");
      if (linhas.length === 0) return [];

      const cabecalho = linhas[0].includes(";")
        ? linhas[0].split(";")
        : linhas[0].split(",");

      const idx = {};
      cabecalho.forEach((nome, i) => {
        const n = nome.trim().toLowerCase();
        idx[n] = i;
      });

      function getCampo(col, partes) {
        const i = idx[col];
        if (i == null) return "";
        return (partes[i] || "").trim();
      }

      const registros = [];
      for (let i = 1; i < linhas.length; i++) {
        const partes = linhas[i].includes(";")
          ? linhas[i].split(";")
          : linhas[i].split(",");

        if (partes.length === 1 && partes[0].trim() === "") continue;

        const conta = getCampo("conta", partes) || getCampo("conta de pagamento", partes);
        const categoria = getCampo("categoria", partes);
        const tipo = (getCampo("tipo", partes) || "variavel").toLowerCase();
        const venc = getCampo("vencimento", partes) || getCampo("data de vencimento", partes);
        const valorStr = getCampo("valor", partes);
        const banco = getCampo("banco", partes);
        const pagoStr = (getCampo("pago", partes) || "").toLowerCase();

        const pago = ["sim", "s", "true", "1", "pago"].includes(pagoStr);

        registros.push({
          conta,
          categoria,
          tipo: (tipo === "fixo" ? "fixo" : "variavel"),
          vencimento: venc ? venc.substring(0,10) : null,
          valor: parseValor(valorStr),
          banco,
          pago
        });
      }
      return registros;
    }

    function aplicarImportacaoRegistros(registros, modo) {
      if (!Array.isArray(registros) || registros.length === 0) {
        alert("Nenhum registro reconhecido para importar.");
        return;
      }
      const chave = keyMes(anoAtual, mesAtual);
      if (!dadosPorMes[chave]) {
        dadosPorMes[chave] = { contas: [], saldos: {} };
      }
      const reg = dadosPorMes[chave];

      if (modo === "substituir") {
        reg.contas = registros;
      } else {
        reg.contas = reg.contas.concat(registros);
      }

      salvarDadosMesAtual();
      renderizarTabela();
      alert("Importação concluída.");
    }

    function importarArquivo() {
      const input = document.getElementById("arquivoImportacao");
      const file = input.files && input.files[0];
      if (!file) return;

      const modo = document.getElementById("modoImportacao").value;
      const reader = new FileReader();
      reader.onload = e => {
        const texto = e.target.result;
        let registros = [];
        let isJson = false;
        try {
          const obj = JSON.parse(texto);
          isJson = true;
          if (Array.isArray(obj)) {
            registros = obj;
          } else if (obj && Array.isArray(obj.contas)) {
            registros = obj.contas;
          } else {
            alert("JSON não reconhecido. Esperado array de contas ou objeto {contas:[]}");
            return;
          }
        } catch (_) {
          isJson = false;
        }

        if (!isJson) {
          registros = csvParaRegistros(texto);
        }
        aplicarImportacaoRegistros(registros, modo);
      };
      reader.readAsText(file, "utf-8");
    }

    function exportarCSV() {
      const chave = keyMes(anoAtual, mesAtual);
      const reg = dadosPorMes[chave] || { contas: [], saldos: {} };
      const contas = reg.contas || [];
      const linhas = [];
      linhas.push("conta;categoria;tipo;vencimento;valor;banco;pago");

      contas.forEach(p => {
        const conta = (p.conta || "").replace(/;/g, ",");
        const categoria = (p.categoria || "").replace(/;/g, ",");
        const tipo = p.tipo || "variavel";
        const venc = p.vencimento ? String(p.vencimento).slice(0,10) : "";
        const valorStr = formatarValor(p.valor || 0);
        const banco = (p.banco || "").replace(/;/g, ",");
        const pagoStr = p.pago ? "Sim" : "Não";
        linhas.push(`${conta};${categoria};${tipo};${venc};${valorStr};${banco};${pagoStr}`);
      });

      const csv = linhas.join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pagamentos_${anoAtual}-${String(mesAtual).padStart(2,"0")}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function exportarJSON() {
      const chave = keyMes(anoAtual, mesAtual);
      const reg = dadosPorMes[chave] || { contas: [], saldos: {} };
      const contas = reg.contas || [];
      const json = JSON.stringify(contas, null, 2);
      const blob = new Blob([json], { type: "application/json;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pagamentos_${anoAtual}-${String(mesAtual).padStart(2,"0")}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    // ========= GRÁFICOS =========
    function atualizarGraficos() {
      if (anoAtual == null || mesAtual == null) return;
      const chave = keyMes(anoAtual, mesAtual);
      const reg = dadosPorMes[chave] || { contas: [], saldos: {} };
      const lista = reg.contas || [];
      const cores = obterCoresTema();

      const somaBanco = {};
      lista.forEach(p => {
        if (!p.pago || !p.banco) return;
        somaBanco[p.banco] = (somaBanco[p.banco] || 0) + (Number(p.valor) || 0);
      });

      const labelsBanco = Object.keys(somaBanco);
      const dataBanco   = labelsBanco.map(b => somaBanco[b]);

      const ctxBanco = document.getElementById("graficoPorBanco").getContext("2d");
      if (graficoBanco) graficoBanco.destroy();
      graficoBanco = new Chart(ctxBanco, {
        type: "bar",
        data: {
          labels: labelsBanco,
          datasets: [{
            label: "Total pago por banco",
            data: dataBanco,
            backgroundColor: "rgba(129,140,248,0.9)"
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              display: true,
              labels: { color: cores.text }
            }
          },
          scales: {
            x: { ticks: { color: cores.text } },
            y: {
              beginAtZero: true,
              ticks: { color: cores.text }
            }
          }
        }
      });

      const somaCat = {};
      lista.forEach(p => {
        const c = p.categoria || "Sem categoria";
        somaCat[c] = (somaCat[c] || 0) + (Number(p.valor) || 0);
      });
      const labelsCat = Object.keys(somaCat);
      const dataCat = labelsCat.map(c => somaCat[c]);

      const ctxCat = document.getElementById("graficoPorCategoria").getContext("2d");
      if (graficoCategoria) graficoCategoria.destroy();
      graficoCategoria = new Chart(ctxCat, {
        type: "pie",
        data: {
          labels: labelsCat,
          datasets: [{
            label: "Total por categoria",
            data: dataCat,
            backgroundColor: [
              "rgba(129,140,248,0.9)",
              "rgba(56,189,248,0.9)",
              "rgba(244,114,182,0.9)",
              "rgba(45,212,191,0.9)",
              "rgba(250,204,21,0.9)",
              "rgba(248,113,113,0.9)"
            ]
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              labels: { color: cores.text }
            },
            datalabels: {
              color: "#020617",
              textStrokeColor: "rgba(255,255,255,0.9)",
              textStrokeWidth: 2,
              font: { weight: "bold", size: 11 },
              formatter: (value) => {
                return "R$ " + value.toLocaleString("pt-BR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                });
              }
            }
          }
        }
      });
    }

    function atualizarVisaoPeriodo() {
      if (!authToken) return;
      const nMeses = parseInt(document.getElementById("selectPeriodoMeses").value || "3", 10);
      const chaves = Object.keys(dadosPorMes).sort();
      const cores = obterCoresTema();

      if (chaves.length === 0) return;

      const chaveAtual = keyMes(anoAtual, mesAtual);
      const idxAtual = chaves.indexOf(chaveAtual);
      if (idxAtual === -1) return;

      const inicio = Math.max(0, idxAtual - (nMeses - 1));
      const selecionadas = chaves.slice(inicio, idxAtual + 1);

      const labels = [];
      const valores = [];
      const mapaCategoriasPeriodo = {};

      selecionadas.forEach(ch => {
        const reg = dadosPorMes[ch];
        if (!reg || !reg.contas) return;
        const partes = ch.split("-");
        const ano = partes[0];
        const mes = partes[1];
        labels.push(`${mes}/${ano.slice(-2)}`);

        const totalPagoMes = reg.contas
          .filter(p => p.pago)
          .reduce((acc, p) => acc + (Number(p.valor) || 0), 0);
        valores.push(totalPagoMes);

        reg.contas.forEach(p => {
          if (!p.pago) return;
          const cat = p.categoria || "Sem categoria";
          mapaCategoriasPeriodo[cat] = (mapaCategoriasPeriodo[cat] || 0) + (Number(p.valor) || 0);
        });
      });

      const ctx = document.getElementById("graficoPeriodoMeses").getContext("2d");
      if (graficoPeriodo) graficoPeriodo.destroy();
      graficoPeriodo = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [{
            label: "Total pago",
            data: valores,
            tension: 0.3,
            fill: false,
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { labels: { color: cores.text } }
          },
          scales: {
            x: { ticks: { color: cores.text } },
            y: {
              beginAtZero: true,
              ticks: { color: cores.text }
            }
          }
        }
      });

      const corpo = document.getElementById("tabelaTopCategoriasPeriodo");
      corpo.innerHTML = "";
      const listaCats = Object.entries(mapaCategoriasPeriodo)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      listaCats.forEach(([cat, total]) => {
        if (!cat || cat === "Sem categoria") return;
        const tr = document.createElement("tr");
        const tdCat = document.createElement("td");
        tdCat.textContent = cat;
        tr.appendChild(tdCat);

        const tdTot = document.createElement("td");
        tdTot.textContent = "R$ " + formatarValor(total);
        tr.appendChild(tdTot);

        corpo.appendChild(tr);
      });
    }

    // ========= EVENTOS GERAIS (wire-up) =========
    function initEventos() {
      if (window.ChartDataLabels) {
        Chart.register(window.ChartDataLabels);
      }

      const btnTema = document.getElementById("btnTema");
      if (btnTema) {
        btnTema.addEventListener("click", alternarTema);
      }

      document.getElementById("filtroStatus")
        .addEventListener("change", () => { salvarConfig(); renderizarTabela(); });

      document.getElementById("btnTrocarMes")
        .addEventListener("click", () => { trocarMes(); });

      document.getElementById("btnProximoMes")
        .addEventListener("click", () => { gerarProximoMes(); });

      document.getElementById("btnAdicionarConta")
        .addEventListener("click", () => { adicionarConta(); });

      document.getElementById("btnAdicionarBanco")
        .addEventListener("click", () => { adicionarBanco(); });

      document.getElementById("btnRemoverBanco")
        .addEventListener("click", () => { removerBanco(); });

      document.getElementById("btnAdicionarCategoria")
        .addEventListener("click", () => { adicionarCategoria(); });

      document.getElementById("btnRemoverCategoria")
        .addEventListener("click", () => { removerCategoria(); });

      document.getElementById("btnAplicarOrdenacao")
        .addEventListener("click", () => {
          ordenacaoCampo   = document.getElementById("ordenarPor").value;
          ordenacaoDirecao = document.getElementById("ordenarDirecao").value;
          salvarConfig();
          renderizarTabela();
        });

      document.getElementById("filtroBanco")
        .addEventListener("change", () => { salvarConfig(); renderizarTabela(); });
      document.getElementById("filtroCategoria")
        .addEventListener("change", () => { salvarConfig(); renderizarTabela(); });
      document.getElementById("filtroBusca")
        .addEventListener("input", () => { salvarConfig(); renderizarTabela(); });

      document.getElementById("btnImportar")
        .addEventListener("click", importarArquivo);
      document.getElementById("btnExportarCSV")
        .addEventListener("click", exportarCSV);
      document.getElementById("btnExportarJSON")
        .addEventListener("click", exportarJSON);

      document.getElementById("btnAtualizarPeriodo")
        .addEventListener("click", atualizarVisaoPeriodo);
    }

    // ========= LOGIN =========
    async function realizarLoginManual() {
      const email = document.getElementById("loginEmail").value.trim();
      const senha = document.getElementById("loginSenha").value.trim();
      const erroEl = document.getElementById("loginErro");
      erroEl.textContent = "";

      if (!email || !senha) {
        erroEl.textContent = "Informe e-mail e senha.";
        return;
      }

      try {
        const resp = await apiFetch("/api/login", {
          method: "POST",
          body: JSON.stringify({ email, password: senha })
        });

        authToken = resp.token;
        userEmail = resp.user.email;
        bancos    = resp.user.bancos || [];
        categorias = resp.user.categorias || [];
        aplicarTema(resp.user.tema || "dark");

        localStorage.setItem(AUTH_TOKEN_KEY, authToken);
        localStorage.setItem(AUTH_EMAIL_KEY, userEmail);

        await iniciarAppPosLogin();
      } catch (e) {
        console.error(e);
        erroEl.textContent = e.message || "Erro ao fazer login.";
      }
    }

    async function tentarLoginAutomatico() {
      const tokenSalvo = localStorage.getItem(AUTH_TOKEN_KEY);
      const emailSalvo = localStorage.getItem(AUTH_EMAIL_KEY);
      if (!tokenSalvo) return;

      authToken = tokenSalvo;
      try {
        const resp = await apiFetch("/api/me", { method: "GET" });
        userEmail = resp.email;
        bancos = resp.bancos || [];
        categorias = resp.categorias || [];
        aplicarTema(resp.tema || "dark");
        const emailInput = document.getElementById("loginEmail");
        if (emailInput && emailSalvo) emailInput.value = emailSalvo;
        await iniciarAppPosLogin();
      } catch (e) {
        console.warn("Token inválido, limpando...", e);
        authToken = null;
        localStorage.removeItem(AUTH_TOKEN_KEY);
      }
    }

    async function iniciarAppPosLogin() {
      document.getElementById("loginContainer").style.display = "none";
      document.getElementById("appContainer").style.display = "block";

      preencherSelectsMesAno();
      await carregarMesDoServidor(anoAtual, mesAtual);
      renderizarBancosSelects();
      renderizarCategoriasSelects();
      aplicarConfigSalvaSeExistir();
      renderizarTabela();
      atualizarVisaoPeriodo();
    }

    function initLogin() {
      const btnLogin = document.getElementById("btnLogin");
      btnLogin.addEventListener("click", () => { realizarLoginManual(); });

      const emailInput = document.getElementById("loginEmail");
      const senhaInput = document.getElementById("loginSenha");

      const emailSalvo = localStorage.getItem(AUTH_EMAIL_KEY);
      if (emailSalvo) emailInput.value = emailSalvo;

      senhaInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") realizarLoginManual();
      });
      emailInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") realizarLoginManual();
      });

      tentarLoginAutomatico();
    }

    // ========= INICIALIZAÇÃO =========
    function init() {
      aplicarTema("dark");   // tema padrão antes do login
      initEventos();
      initLogin();
    }

    init();
  </script>