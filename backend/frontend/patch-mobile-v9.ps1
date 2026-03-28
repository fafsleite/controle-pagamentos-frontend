# patch-mobile-v9.ps1
$Index = Join-Path (Get-Location) "index.html"
if (!(Test-Path $Index)) { throw "index.html não encontrado em: $Index" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $Index "$Index.bak.$stamp" -Force

$html = Get-Content $Index -Raw -Encoding UTF8

if ($html -match "MOBILE_V9_PATCH") {
  Write-Host "MOBILE_V9_PATCH já existe. Nada a fazer." -ForegroundColor Yellow
  exit 0
}

$css = @'
<style id="mobileV9Styles">
/* MOBILE_V9_PATCH */
@media (max-width: 860px){
  /* garante que nada “vaze” para os lados */
  html, body { max-width: 100%; overflow-x: hidden; }

  /* espaço pro menu de rodapé */
  body { padding-bottom: 78px !important; }

  /* menu inferior */
  #mobileBottomNavV9{
    position: fixed;
    left: 10px; right: 10px; bottom: 10px;
    height: 58px;
    border-radius: 18px;
    display: flex;
    justify-content: space-around;
    align-items: center;
    gap: 6px;
    z-index: 99999;
    backdrop-filter: blur(10px);
    background: rgba(20,20,20,.88);
    border: 1px solid rgba(255,255,255,.12);
  }
  body[data-theme="light"] #mobileBottomNavV9{
    background: rgba(255,255,255,.92);
    border: 1px solid rgba(0,0,0,.08);
  }
  #mobileBottomNavV9 button{
    all: unset;
    cursor: pointer;
    user-select: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 10px;
    border-radius: 14px;
    font-size: 12px;
    min-width: 58px;
  }
  #mobileBottomNavV9 button .i{ font-size: 16px; line-height: 16px; }
  #mobileBottomNavV9 button.active{
    outline: 2px solid rgba(255,255,255,.18);
  }
  body[data-theme="light"] #mobileBottomNavV9 button.active{
    outline: 2px solid rgba(0,0,0,.10);
  }

  /* “cards” de Pagamentos via CSS (sem destruir sua lógica JS) */
  /* a tabela vira blocos empilhados */
  #tblPagamentosV9 thead { display: none !important; }
  #tblPagamentosV9 { width: 100% !important; border-collapse: separate !important; border-spacing: 0 12px !important; }
  #tblPagamentosV9 tbody tr{
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
    grid-template-areas:
      "conta conta"
      "categoria banco"
      "tipo status"
      "venc valor"
      "acoes acoes";
    gap: 10px 12px !important;
    padding: 12px !important;
    border-radius: 16px !important;
    border: 1px solid rgba(255,255,255,.12) !important;
    background: rgba(255,255,255,.04) !important;
  }
  body[data-theme="light"] #tblPagamentosV9 tbody tr{
    border: 1px solid rgba(0,0,0,.08) !important;
    background: rgba(0,0,0,.02) !important;
  }

  #tblPagamentosV9 tbody td{ display: flex !important; flex-direction: column !important; gap: 6px !important; }
  #tblPagamentosV9 tbody td:nth-child(1){ grid-area: conta; }
  #tblPagamentosV9 tbody td:nth-child(2){ grid-area: categoria; }
  #tblPagamentosV9 tbody td:nth-child(3){ grid-area: tipo; }
  #tblPagamentosV9 tbody td:nth-child(4){ grid-area: venc; }
  #tblPagamentosV9 tbody td:nth-child(5){ grid-area: valor; }
  #tblPagamentosV9 tbody td:nth-child(6){ grid-area: banco; }
  #tblPagamentosV9 tbody td:nth-child(7){ grid-area: status; }
  #tblPagamentosV9 tbody td:nth-child(8){ grid-area: acoes; }

  #tblPagamentosV9 tbody td:nth-child(1)::before{ content:"Conta"; opacity:.75; font-size:12px; }
  #tblPagamentosV9 tbody td:nth-child(2)::before{ content:"Categoria"; opacity:.75; font-size:12px; }
  #tblPagamentosV9 tbody td:nth-child(3)::before{ content:"Tipo"; opacity:.75; font-size:12px; }
  #tblPagamentosV9 tbody td:nth-child(4)::before{ content:"Vencimento"; opacity:.75; font-size:12px; }
  #tblPagamentosV9 tbody td:nth-child(5)::before{ content:"Valor"; opacity:.75; font-size:12px; }
  #tblPagamentosV9 tbody td:nth-child(6)::before{ content:"Banco"; opacity:.75; font-size:12px; }
  #tblPagamentosV9 tbody td:nth-child(7)::before{ content:"Status"; opacity:.75; font-size:12px; }
  #tblPagamentosV9 tbody td:nth-child(8)::before{ content:"Ações"; opacity:.75; font-size:12px; }

  /* inputs e combobox “tamanho de dedo”, não de formiga */
  #tblPagamentosV9 select,
  #tblPagamentosV9 input,
  #tblPagamentosV9 button{
    font-size: 16px !important;
    padding: 10px 12px !important;
    border-radius: 12px !important;
  }

  /* por view: o JS controla data-mobile-view e a gente só esconde/mostra */
  body[data-mobile-mode="1"] .top-bar,
  body[data-mobile-mode="1"] .resumo,
  body[data-mobile-mode="1"] #secRow1,
  body[data-mobile-mode="1"] #secRow2,
  body[data-mobile-mode="1"] #importExportBarV9,
  body[data-mobile-mode="1"] #rightToolsV9,
  body[data-mobile-mode="1"] #tblPagamentosV9 { display:none !important; }

  body[data-mobile-mode="1"][data-mobile-view="pagamentos"] .top-bar,
  body[data-mobile-mode="1"][data-mobile-view="pagamentos"] #tblPagamentosV9 { display:block !important; }

  body[data-mobile-mode="1"][data-mobile-view="resumo"] .resumo,
  body[data-mobile-mode="1"][data-mobile-view="resumo"] #secRow1 { display:block !important; }

  body[data-mobile-mode="1"][data-mobile-view="bancos"] #secRow1 { display:block !important; }
  body[data-mobile-mode="1"][data-mobile-view="graficos"] #secRow1,
  body[data-mobile-mode="1"][data-mobile-view="graficos"] #secRow2 { display:block !important; }

  body[data-mobile-mode="1"][data-mobile-view="mais"] #importExportBarV9,
  body[data-mobile-mode="1"][data-mobile-view="mais"] #rightToolsV9 { display:block !important; }

  /* filtros empilhados no mobile */
  body[data-mobile-mode="1"] .top-bar .top-bar-left{
    display:flex !important;
    flex-direction:column !important;
    align-items:stretch !important;
    gap:10px !important;
  }
  body[data-mobile-mode]()
