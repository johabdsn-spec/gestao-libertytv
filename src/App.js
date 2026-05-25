import { useState, useEffect } from "react";
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, onSnapshot, query, orderBy
} from "firebase/firestore";
import { db } from "./firebase";

// ── helpers ───────────────────────────────────────────────────
const todayISO  = () => new Date().toISOString().split("T")[0];
const fmt       = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const initial   = (n) => (n || "?").charAt(0).toUpperCase();
const ptDate    = (iso) => iso ? new Date(iso + "T12:00").toLocaleDateString("pt-BR") : "—";
const mesAno    = () => new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

// Adiciona dias a uma data ISO
const addDias = (iso, dias) => {
  const d = new Date(iso + "T12:00");
  d.setDate(d.getDate() + dias);
  return d.toISOString().split("T")[0];
};

// Dias entre hoje e uma data ISO (positivo = futuro, negativo = passado)
const diffDias = (iso) => {
  if (!iso) return -999;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const alvo = new Date(iso + "T12:00"); alvo.setHours(0,0,0,0);
  return Math.round((alvo - hoje) / 86400000);
};

// Periodicidade → dias
const perioDias = (p) => p === "semestral" ? 180 : p === "trimestral" ? 90 : 30;

// Valor mensal equivalente conforme periodicidade
const valorMensal = (valor, perio) => {
  if (perio === "trimestral") return valor / 3;
  if (perio === "semestral")  return valor / 6;
  return valor;
};

// Verifica se existe pagamento cobrindo o ciclo ATUAL
// O ciclo atual começa no vencimento anterior (exclusive) e vai até o vencimento atual
function getPagamentoStatus(client) {
  const pags = client.pagamentos || [];
  if (pags.length === 0) return "pendente";
  const venc = client.vencimento;
  if (!venc) return "pendente";
  const dias      = perioDias(client.periodicidade || "mensal");
  // Vencimento anterior = vencimento atual - periodicidade
  const prevVenc  = addDias(venc, -dias);
  const prevD     = new Date(prevVenc + "T12:00");
  // Verifica se algum pagamento foi feito DEPOIS do vencimento anterior
  // (ou seja, pertence ao ciclo atual)
  const temPagoNoCiclo = pags.some(p => {
    const pagoD = new Date(p.data + "T12:00");
    return pagoD > prevD; // estritamente depois do vencimento anterior
  });
  return temPagoNoCiclo ? "pago" : "pendente";
}

function getStatus(client) {
  const venc = client.vencimento;
  if (!venc) return "atrasado";
  const diff = diffDias(venc);
  // Passou do vencimento
  if (diff < 0) {
    // Se tem pagamento cobrindo o ciclo atual → pago
    if (getPagamentoStatus(client) === "pago") return "pago";
    return "atrasado";
  }
  // Ainda não passou do vencimento → sempre pago (em dia)
  return "pago";
}
const maskTel = (v) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3").replace(/-$/, "");
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3").replace(/-$/, "");
};
const maskMac = (v) => {
  const d = v.replace(/[^0-9a-fA-F]/g, "").slice(0, 12).toUpperCase();
  return d.match(/.{1,2}/g)?.join(":") || d;
};
const maskValor = (v) => {
  const d = v.replace(/\D/g, "");
  if (!d) return "";
  const n = (parseInt(d) / 100).toFixed(2);
  return Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};
const unMaskValor = (v) => parseFloat(v.replace(/[^\d,]/g, "").replace(",", ".")) || 0;

// ── Paleta Liberty TV ─────────────────────────────────────────
const C = {
  bg:         "#020b2e",
  bgCard:     "#071040",
  bgCard2:    "#040d35",
  bgHeader:   "#030e38",
  border:     "#1a3580",
  border2:    "#0d2060",
  blue:       "#1a4fd8",
  blueBright: "#2d6aff",
  blueLight:  "#4da6ff",
  blueDark:   "#0f30a0",
  blueGlow:   "#1a4fd840",
  white:      "#ffffff",
  textLight:  "#e8f0ff",   // mais claro — melhor contraste
  textMuted:  "#8fb0e0",   // era #6a90cc — mais legível
  textDim:    "#5a7ab0",   // era #2a4080 — muito escuro, agora legível
  success:    "#00d68f",
  warning:    "#ffb020",
  danger:     "#ff5c5c",
};


const STATUS = {
  pago:     { bg: "#002a1a", text: "#00d68f", border: "#00d68f30", label: "Pago" },
  atrasado: { bg: "#2a0a0a", text: "#ff5c5c", border: "#ff5c5c30", label: "Atrasado" },
};

const isDueToday = (c) => diffDias(c.vencimento) === 0;
const isDueSoon  = (c) => { const d = diffDias(c.vencimento); return d > 0 && d <= 3; };

const S = {
  page:    { fontFamily: "'Roboto', sans-serif", background: C.bg, minHeight: "100vh", color: C.white },
  card:    { background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12 },
  input:   { width: "100%", background: C.bgCard2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", color: C.white, fontSize: 15, outline: "none", boxSizing: "border-box", fontFamily: "'Roboto', sans-serif" },
  btnPri:  { background: `linear-gradient(135deg, ${C.blueBright}, ${C.blueDark})`, color: "#fff", border: "none", borderRadius: 8, padding: "12px 20px", fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "'Roboto', sans-serif" },
  btnSec:  { background: C.bgCard2, color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 20px", fontSize: 14, cursor: "pointer", fontFamily: "'Roboto', sans-serif" },
  btnSm:   { background: C.bgCard2, border: `1px solid ${C.border2}`, borderRadius: 6, padding: "6px 12px", fontSize: 12, color: C.textMuted, cursor: "pointer", fontFamily: "'Roboto', sans-serif" },
  btnWarn: { background: "#2a1a00", border: `1px solid ${C.warning}40`, borderRadius: 6, padding: "6px 12px", fontSize: 12, color: C.warning, cursor: "pointer", fontFamily: "'Roboto', sans-serif" },
  btnWa:   { background: "#003d1a", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12, color: "#25d366", cursor: "pointer", fontFamily: "'Roboto', sans-serif" },
  overlay: { position: "fixed", inset: 0, background: "#00000099", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 200, padding: 0, pointerEvents: "all" },
};

// ── WhatsApp ──────────────────────────────────────────────────
function enviarWhatsApp(client, pagamento, tipo = "comprovante") {
  const tel = (client.telefone || "").replace(/\D/g, "");
  if (!tel) { alert("Cliente sem telefone cadastrado!"); return; }

  let msg = "";
  if (tipo === "comprovante") {
    msg = "Seu pagamento foi confirmado e seu acesso renovado. Obrigado!";
  } else {
    const diff = diffDias(client.vencimento);
    let quando = "";
    if (diff < 0)        quando = `*dia ${ptDate(client.vencimento)}*`;
    else if (diff === 0) quando = `*hoje*`;
    else if (diff === 1) quando = `*amanhã*`;
    else                 quando = `*em ${diff} dias*`;
    msg = `Olá! Passando para lembrar que o seu vencimento é ${quando}. Vamos renovar?`;
  }
  window.open(`https://wa.me/55${tel}?text=${encodeURIComponent(msg)}`, "_blank");
}

// ── FORM padrão cliente ───────────────────────────────────────
const emptyForm = () => ({
  nome: "", usuario: "", senha: "", servidorId: "", servidorNome: "",
  planoId: "", planoNome: "", periodicidade: "mensal", valor: "",
  telefone: "", vencimento: "",
  isMac: false, mac: "", code: "", appNome: "", obs: ""
});

// ── Componentes fora do App (evita remount a cada render) ────
const Label = ({ children }) => (
  <label style={{ fontSize: 11, fontWeight: 500, color: C.textMuted, display: "block", marginBottom: 5, textTransform: "uppercase", letterSpacing: 1 }}>{children}</label>
);

const BottomSheet = ({ children, onClose }) => (
  <div style={S.overlay}>
    <div style={{
      ...S.card, width: "100%", maxWidth: 560, borderRadius: "20px 20px 0 0",
      padding: "8px 0 0", maxHeight: "93vh", overflowY: "auto",
      animation: "slideUp 0.25s ease"
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px 12px" }}>
        <div style={{ width: 40, height: 4, background: C.border, borderRadius: 2 }} />
        <button onClick={onClose} style={{ background: C.bgCard2, border: `1px solid ${C.border}`, borderRadius: "50%", width: 30, height: 30, color: C.textMuted, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>×</button>
      </div>
      <div style={{ padding: "0 20px 36px" }}>{children}</div>
    </div>
  </div>
);

// ════════════════════════════════════════════════════════════════
export default function App() {
  const [clients,       setClients]       = useState([]);
  const [servidores,    setServidores]    = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [view,          setView]          = useState("dashboard");
  const [search,        setSearch]        = useState("");
  const [filterStatus,  setFilterStatus]  = useState("todos");
  const [showForm,      setShowForm]      = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [selectedId,    setSelectedId]    = useState(null);
  const [payModal,      setPayModal]      = useState(null);
  const [showPass,      setShowPass]      = useState({});
  const [saving,        setSaving]        = useState(false);
  const [lastPay,       setLastPay]       = useState(null);
  const [form,          setForm]          = useState(emptyForm());
  const [payForm,       setPayForm]       = useState({ valor: "", data: todayISO(), obs: "" });

  // Servidores form
  const [showServForm,  setShowServForm]  = useState(false);
  const [editingServ,   setEditingServ]   = useState(null);
  const [servForm,      setServForm]      = useState({ nome: "", creditoValor: "", planos: [] });
  const [newPlano,      setNewPlano]      = useState({ nome: "", valor: "", periodicidade: "mensal" });
  const [renovModal,    setRenovModal]    = useState(null); // { client, novoVenc }

  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" ? window.innerWidth < 640 : true);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // ── Firebase ─────────────────────────────────────────────
  useEffect(() => {
    const q1 = query(collection(db, "clientes"),   orderBy("nome"));
    const q2 = query(collection(db, "servidores"), orderBy("nome"));
    const u1 = onSnapshot(q1, s => { setClients(s.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); });
    const u2 = onSnapshot(q2, s => setServidores(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { u1(); u2(); };
  }, []);

  // ── computed ──────────────────────────────────────────────
  const ativos        = clients.filter(c => c.ativo !== false);
  const dueToday      = ativos.filter(isDueToday);
  const dueSoon       = ativos.filter(isDueSoon);
  const totalPago     = ativos.filter(c => getStatus(c) === "pago").length;
  const totalAtrasado = ativos.filter(c => getStatus(c) === "atrasado").length;
  const totalPendente = dueToday.length + dueSoon.length;
  const receitaTotal  = ativos.reduce((s, c) => s + valorMensal(Number(c.valor || 0), c.periodicidade), 0);
  const receitaPaga   = ativos.filter(c => getStatus(c) === "pago").reduce((s, c) => s + valorMensal(Number(c.valor || 0), c.periodicidade), 0);
  const alertCount    = dueToday.length + dueSoon.length + totalAtrasado;

  const filtered = clients
    .filter(c => {
      const ms = (c.nome + c.usuario + (c.servidorNome || "")).toLowerCase().includes(search.toLowerCase());
      const fs = filterStatus === "todos" || getStatus(c) === filterStatus;
      return ms && fs;
    })
    .sort((a, b) => {
      // Atrasados primeiro, depois por vencimento mais próximo
      const sa = getStatus(a), sb = getStatus(b);
      if (sa === "atrasado" && sb !== "atrasado") return -1;
      if (sb === "atrasado" && sa !== "atrasado") return 1;
      return new Date(a.vencimento) - new Date(b.vencimento);
    });

  // ── cliente CRUD ──────────────────────────────────────────
  const openForm = (client = null) => {
    setEditingClient(client);
    if (client) {
      setForm({
        nome: client.nome || "", usuario: client.usuario || "", senha: client.senha || "",
        servidorId: client.servidorId || "", servidorNome: client.servidorNome || "",
        planoId: client.planoId || "", planoNome: client.planoNome || "",
        periodicidade: client.periodicidade || "mensal",
        valor: client.valor ? maskValor(String(Math.round(client.valor * 100))) : "",
        telefone: client.telefone || "", vencimento: client.vencimento || "",
        isMac: client.isMac || false, mac: client.mac || "", code: client.code || "",
        appNome: client.appNome || "", obs: client.obs || ""
      });
    } else {
      setForm(emptyForm());
    }
    setShowForm(true);
  };

  const saveForm = async () => {
    if (!form.nome || !form.usuario || !form.vencimento) return;
    setSaving(true);
    const data = {
      ...form,
      valor: unMaskValor(form.valor),
      telefone: form.telefone.replace(/\D/g, ""),
    };
    if (editingClient) await updateDoc(doc(db, "clientes", editingClient.id), data);
    else await addDoc(collection(db, "clientes"), { ...data, pagamentos: [], ativo: true, criadoEm: todayISO() });
    setSaving(false);
    setShowForm(false);
  };

  const registrarPagamento = async () => {
    if (!payForm.valor || !payForm.data) return;
    setSaving(true);
    const c    = clients.find(x => x.id === payModal.id);
    const novo = { valor: unMaskValor(payForm.valor), data: payForm.data, obs: payForm.obs };
    let novoVenc = c.vencimento;
    let renovado = false;

    if (payForm.renovar) {
      const diff = diffDias(c.vencimento);
      const dias = perioDias(c.periodicidade || "mensal");
      if (diff <= 0) {
        // Atrasado ou no dia: conta da data do pagamento
        novoVenc = addDias(payForm.data, dias);
      } else {
        // Antes do vencimento: conta do vencimento atual
        novoVenc = addDias(c.vencimento, dias);
      }
      renovado = true;
    }

    await updateDoc(doc(db, "clientes", payModal.id), {
      pagamentos: [...(c.pagamentos || []), novo],
      vencimento: novoVenc,
    });
    setSaving(false);
    setLastPay({ client: { ...c, vencimento: novoVenc }, pagamento: novo, renovado });
    setPayModal(null);
    setPayForm({ valor: "", data: todayISO(), obs: "", renovar: false });
  };

  // Abre modal de renovação com data pré-calculada mas editável
  const confirmarRenovacao = (c) => {
    const diff     = diffDias(c.vencimento);
    const dias     = perioDias(c.periodicidade || "mensal");
    const base     = diff <= 0 ? todayISO() : c.vencimento;
    const novoVenc = addDias(base, dias);
    setRenovModal({ client: c, novoVenc });
  };

  // Executa a renovação com a data confirmada
  const executarRenovacao = async () => {
    if (!renovModal) return;
    setSaving(true);
    await updateDoc(doc(db, "clientes", renovModal.client.id), { vencimento: renovModal.novoVenc });
    setSaving(false);
    setRenovModal(null);
  };

  const desfazerPagamento = async (id) => {
    const c = clients.find(x => x.id === id);
    const pags = [...(c.pagamentos || [])]; pags.pop();
    await updateDoc(doc(db, "clientes", id), { pagamentos: pags });
  };
  const toggleAtivo  = async (id, ativo) => updateDoc(doc(db, "clientes", id), { ativo: !ativo });
  const deleteClient = async (id) => { if (window.confirm("Remover cliente?")) await deleteDoc(doc(db, "clientes", id)); };
  const openPay = (c) => {
    setPayModal(c);
    setPayForm({ valor: c.valor ? maskValor(String(Math.round(c.valor * 100))) : "", data: todayISO(), obs: "", renovar: false });
  };

  // ── servidor CRUD ─────────────────────────────────────────
  const openServForm = (serv = null) => {
    setEditingServ(serv);
    setServForm(serv
      ? { nome: serv.nome, creditoValor: serv.creditoValor ? maskValor(String(Math.round(serv.creditoValor * 100))) : "", planos: serv.planos || [] }
      : { nome: "", creditoValor: "", planos: [] }
    );
    setNewPlano({ nome: "", valor: "", periodicidade: "mensal" });
    setShowServForm(true);
  };

  const addPlano = () => {
    if (!newPlano.nome) return;
    setServForm(f => ({ ...f, planos: [...f.planos, { id: Date.now().toString(), nome: newPlano.nome, valor: unMaskValor(newPlano.valor), periodicidade: newPlano.periodicidade || "mensal" }] }));
    setNewPlano({ nome: "", valor: "", periodicidade: "mensal" });
  };

  const removePlano = (id) => setServForm(f => ({ ...f, planos: f.planos.filter(p => p.id !== id) }));

  const saveServForm = async () => {
    if (!servForm.nome) return;
    setSaving(true);
    const data = { nome: servForm.nome, creditoValor: unMaskValor(servForm.creditoValor), planos: servForm.planos };
    if (editingServ) await updateDoc(doc(db, "servidores", editingServ.id), data);
    else await addDoc(collection(db, "servidores"), data);
    setSaving(false);
    setShowServForm(false);
  };

  const deleteServ = async (id) => { if (window.confirm("Remover servidor?")) await deleteDoc(doc(db, "servidores", id)); };

  // ── quando muda servidor no form cliente ──────────────────
  const handleServChange = (servId) => {
    const serv = servidores.find(s => s.id === servId);
    setForm(f => ({ ...f, servidorId: servId, servidorNome: serv?.nome || "", planoId: "", planoNome: "", valor: "" }));
  };

  const handlePlanoChange = (planoId) => {
    const serv  = servidores.find(s => s.id === form.servidorId);
    const plano = serv?.planos?.find(p => p.id === planoId);
    setForm(f => ({
      ...f, planoId, planoNome: plano?.nome || "",
      periodicidade: plano?.periodicidade || "mensal",
      valor: plano?.valor ? maskValor(String(Math.round(plano.valor * 100))) : f.valor
    }));
  };

  if (loading) return (
    <div style={{ ...S.page, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, minHeight: "100vh" }}>
      <img src="/logo.jpg" alt="Liberty TV" style={{ width: 140, borderRadius: 16 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 18, height: 18, border: `2px solid ${C.blueLight}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <span style={{ color: C.textMuted, fontSize: 14 }}>Carregando...</span>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );



  const navItems = [
    { key: "dashboard",  icon: "📊", label: "Dashboard" },
    { key: "clientes",   icon: "👥", label: "Clientes" },
    { key: "alertas",    icon: "🔔", label: `Alertas${alertCount > 0 ? ` (${alertCount})` : ""}` },
    { key: "servidores", icon: "🖥️", label: "Servidores" },
  ];

  return (
    <div style={S.page}>
      <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700;900&display=swap" rel="stylesheet" />
      <style>{`
        *{margin:0;padding:0;box-sizing:border-box}
        body{background:${C.bg};overscroll-behavior:none}
        input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.5) sepia(1) saturate(2) hue-rotate(190deg)}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:${C.bg}}
        ::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        .fin{animation:fadeIn 0.2s ease both}
        select option{background:${C.bgCard};color:${C.white}}
        input::placeholder{color:${C.textDim}}
        button:active{opacity:0.75}
        /* desktop: esconde bottom nav, mostra top nav */
        @media(min-width:640px){
          .bottom-nav{display:none!important}
          .top-nav{display:flex!important}
          .fab{bottom:24px!important}
          .main-content{padding-bottom:24px!important}
        }
        /* mobile: esconde top nav */
        @media(max-width:639px){
          .top-nav{display:none!important}
        }
      `}</style>

      {/* ══ HEADER ══ */}
      <header style={{ background: C.bgHeader, borderBottom: `1px solid ${C.border}`, padding: "0 16px", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 58 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src="/logo.jpg" alt="Liberty TV" style={{ height: 38, borderRadius: 7, objectFit: "cover" }} />
            <div style={{ borderLeft: `1px solid ${C.border}`, paddingLeft: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: C.white, letterSpacing: 1 }}>LIBERTY TV</div>
              <div style={{ fontSize: 9, color: C.textMuted, fontStyle: "italic" }}>entretenimento, sem limites</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Top nav — só desktop */}
            {!isMobile && (
              <nav style={{ display: "flex", gap: 2 }}>
                {navItems.map(t => (
                  <button key={t.key} onClick={() => setView(t.key)} style={{
                    padding: "7px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12,
                    fontWeight: view === t.key ? 700 : 400,
                    background: view === t.key ? C.blue : "transparent",
                    color: view === t.key ? "#fff" : C.textMuted,
                    fontFamily: "'Roboto',sans-serif", transition: "all .15s"
                  }}>{t.icon} {t.label}</button>
                ))}
              </nav>
            )}
          </div>
        </div>
      </header>

      {/* ══ MAIN ══ */}
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: isMobile ? "20px 16px 90px" : "20px 16px 24px" }}>

        {/* ══ DASHBOARD ══ */}
        {view === "dashboard" && (
          <div className="fin">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h2 style={{ fontSize: 19, fontWeight: 700 }}>VISÃO GERAL</h2>
              <span style={{ fontSize: 11, color: C.textMuted }}>{new Date().toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" })}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 20 }}>
              {[
                { label: "Clientes ativos", value: ativos.length,     icon: "👥", color: C.blueLight },
                { label: "Receita mensal",  value: fmt(receitaTotal), icon: "💰", color: C.success },
                { label: "Recebido",        value: fmt(receitaPaga),  icon: "✅", color: C.success },
                { label: "Em dia",          value: totalPago,         icon: "✔",  color: C.success },
                { label: "Vencendo em breve", value: totalPendente,   icon: "⏳", color: C.warning },
                { label: "Atrasados",       value: totalAtrasado,     icon: "⚠",  color: C.danger },
              ].map(card => (
                <div key={card.label} style={{ ...S.card, padding: "14px 16px", borderTop: `3px solid ${card.color}` }}>
                  <div style={{ fontSize: 18, marginBottom: 8 }}>{card.icon}</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: card.color }}>{card.value}</div>
                  <div style={{ fontSize: 11, color: C.textDim, marginTop: 3 }}>{card.label}</div>
                </div>
              ))}
            </div>

            {/* Bloco único de alertas */}
            {(() => {
              const vencendoHoje   = ativos.filter(c => diffDias(c.vencimento) === 0);
              const vencendoAmanha = ativos.filter(c => diffDias(c.vencimento) === 1);
              const atrasados      = ativos.filter(c => getStatus(c) === "atrasado");
              const totalAlertas   = vencendoHoje.length + vencendoAmanha.length + atrasados.length;

              if (totalAlertas === 0) return (
                <div style={{ ...S.card, padding: "20px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🎉</div>
                  <div style={{ fontWeight: 600, fontSize: 15, color: C.white }}>Tudo em dia!</div>
                  <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>Nenhum vencimento para hoje ou amanhã</div>
                </div>
              );

              const lista = [
                ...vencendoHoje.map(c   => ({ ...c, _tag: "hoje" })),
                ...vencendoAmanha.map(c => ({ ...c, _tag: "amanha" })),
                ...atrasados.map(c      => ({ ...c, _tag: "atrasado" })),
              ];

              return (
                <div style={{ ...S.card, borderColor: atrasados.length > 0 ? `${C.danger}60` : `${C.warning}60`, overflow: "hidden" }}>
                  <div style={{ background: atrasados.length > 0 ? `${C.danger}15` : `${C.warning}15`, padding: "14px 16px", borderBottom: `1px solid ${C.border2}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: atrasados.length > 0 ? C.danger : C.warning }}>
                          {atrasados.length > 0 ? "⚠ Atenção necessária" : "🔔 Vencimentos próximos"}
                        </div>
                        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>
                          {[
                            vencendoHoje.length   > 0 && `${vencendoHoje.length} vence(m) hoje`,
                            vencendoAmanha.length > 0 && `${vencendoAmanha.length} vence(m) amanhã`,
                            atrasados.length      > 0 && `${atrasados.length} em atraso`,
                          ].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <button onClick={() => setView("alertas")} style={{ ...S.btnPri, padding: "8px 14px", fontSize: 12, flexShrink: 0 }}>
                        Ver alertas
                      </button>
                    </div>
                  </div>
                  <div style={{ padding: "10px 16px 14px" }}>
                    {lista.slice(0, 4).map(c => {
                      const temPagamento = getPagamentoStatus(c) === "pago";
                      return (
                        <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.border2}` }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 34, height: 34, borderRadius: "50%", background: `${C.blue}25`, border: `1px solid ${C.blue}40`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: C.white, fontSize: 14, flexShrink: 0 }}>{initial(c.nome)}</div>
                            <div>
                              <div style={{ fontWeight: 500, fontSize: 14 }}>{c.nome}</div>
                              <div style={{ fontSize: 11, color: c._tag === "atrasado" ? C.danger : c._tag === "hoje" && temPagamento ? C.success : C.warning }}>
                                {c._tag === "atrasado" ? `Em atraso desde ${ptDate(c.vencimento)}` :
                                 c._tag === "hoje" && temPagamento  ? "Vence hoje — pagamento já realizado ✅" :
                                 c._tag === "hoje" && !temPagamento ? "Vence hoje — pagamento pendente ⏳" :
                                 "Vence amanhã"} · {fmt(c.valor)}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {totalAlertas > 4 && (
                      <div style={{ fontSize: 12, color: C.textMuted, textAlign: "center", paddingTop: 10 }}>
                        +{totalAlertas - 4} mais na aba Alertas
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ══ CLIENTES ══ */}
        {view === "clientes" && (
          <div className="fin">
            <h2 style={{ fontSize: 19, fontWeight: 700, marginBottom: 16 }}>Clientes</h2>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente..." style={{ ...S.input, flex: 1 }} />
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...S.input, width: "auto", cursor: "pointer", paddingLeft: 10, paddingRight: 10 }}>
                <option value="todos">Todos</option>
                <option value="pago">Pagos</option>
                <option value="atrasado">Atrasados</option>
              </select>
            </div>

            {filtered.length === 0 && <div style={{ color: C.textDim, padding: "30px 0", textAlign: "center" }}>Nenhum cliente encontrado</div>}

            {filtered.map(c => {
              const st   = getStatus(c);
              const sc   = STATUS[st] || STATUS.atrasado;
              const last = (c.pagamentos || []).slice(-1)[0];
              const exp  = selectedId === c.id;
              return (
                <div key={c.id} style={{ ...S.card, marginBottom: 10, opacity: c.ativo === false ? 0.45 : 1, borderLeft: `3px solid ${sc.text}60`, overflow: "hidden" }}>
                  <div style={{ padding: "14px 16px", cursor: "pointer" }} onClick={() => setSelectedId(exp ? null : c.id)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ width: 44, height: 44, borderRadius: "50%", background: `${C.blue}25`, border: `1px solid ${C.blue}50`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: C.white, fontSize: 18, flexShrink: 0 }}>{initial(c.nome)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                          <div style={{ fontWeight: 500, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.nome}</div>
                          <span style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}`, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 500, flexShrink: 0 }}>{sc.label}</span>
                        </div>
                        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>@{c.usuario} · Vence {ptDate(c.vencimento)} · {fmt(c.valor)}</div>
                        {c.servidorNome && <div style={{ fontSize: 11, color: C.textDim, marginTop: 1 }}>{c.servidorNome}{c.planoNome ? ` · ${c.planoNome}` : ""}</div>}
                        {last && <div style={{ fontSize: 11, color: C.success, marginTop: 2 }}>Ult. pgto: {fmt(last.valor)} em {ptDate(last.data)}</div>}
                      </div>
                      <div style={{ color: C.textDim, fontSize: 14, flexShrink: 0 }}>{exp ? "▲" : "▼"}</div>
                    </div>
                  </div>

                  {/* Ações */}
                  <div style={{ padding: "0 16px 14px", display: "flex", gap: 8, flexWrap: "wrap" }}>

                    {/* Registrar pagamento — sempre visível */}
                    <button onClick={() => openPay(c)} style={{ ...S.btnPri, padding: "9px 14px", fontSize: 12, flex: 1 }}>
                      Registrar pagamento
                    </button>

                    {/* Renovar — sempre visível */}
                    <button onClick={() => confirmarRenovacao(c)} style={{ ...S.btnPri, padding: "9px 14px", fontSize: 12, flex: 1, background: `linear-gradient(135deg,${C.success},#059669)` }}>
                      Renovar
                    </button>

                    {/* Enviar cobrança — sempre visível */}
                    <button onClick={() => enviarWhatsApp(c, null, "cobranca")} style={{ ...S.btnWarn, padding: "9px 14px", fontSize: 12, flex: 1 }}>
                      Enviar cobrança
                    </button>

                    {/* Comprovante WA — ícone, só se tiver telefone e pagamento */}
                    {last && c.telefone && (
                      <button onClick={() => enviarWhatsApp(c, last, "comprovante")} title="Enviar comprovante via WhatsApp" style={{ ...S.btnWa, padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#25d366" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                        </svg>
                      </button>
                    )}

                    {/* Desfazer pagamento — só se tiver pagamento */}
                    {last && (
                      <button onClick={() => desfazerPagamento(c.id)} title="Desfazer último pagamento" style={{ ...S.btnSm, padding: "8px 10px", color: C.warning, borderColor: `${C.warning}40`, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.warning} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                          <path d="M3 3v5h5"/>
                        </svg>
                      </button>
                    )}

                    {/* Editar */}
                    <button onClick={() => openForm(c)} title="Editar" style={{ ...S.btnSm, padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>

                    {/* Bloquear/Desbloquear */}
                    <button onClick={() => toggleAtivo(c.id, c.ativo !== false)} title={c.ativo !== false ? "Bloquear" : "Desbloquear"} style={{ ...S.btnSm, padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {c.ativo !== false ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.success} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
                        </svg>
                      )}
                    </button>

                    {/* Excluir */}
                    <button onClick={() => deleteClient(c.id)} title="Excluir" style={{ ...S.btnSm, padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "center", borderColor: `${C.danger}40` }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.danger} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                        <path d="M10 11v6M14 11v6"/>
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                      </svg>
                    </button>
                  </div>

                  {/* Detalhes */}
                  {exp && (
                    <div style={{ borderTop: `1px solid ${C.border2}`, padding: "14px 16px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                        {[
                          { label: "USUARIO",       val: c.usuario },
                          { label: "TELEFONE",      val: c.telefone ? maskTel(c.telefone) : "—" },
                          { label: "SERVIDOR",      val: c.servidorNome || "—" },
                          { label: "PLANO",         val: c.planoNome || "—" },
                          { label: "PERIODICIDADE", val: c.periodicidade === "trimestral" ? "Trimestral" : c.periodicidade === "semestral" ? "Semestral" : "Mensal" },
                          { label: "VENCIMENTO",    val: ptDate(c.vencimento) },
                          { label: "APP",           val: c.appNome || "—" },
                          { label: "SENHA",         val: null },
                        ].map(f => (
                          <div key={f.label} style={{ background: C.bgCard2, borderRadius: 8, padding: "10px 12px", border: `1px solid ${C.border2}`, gridColumn: f.label === "SENHA" ? "1 / -1" : "auto" }}>
                            <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4, letterSpacing: 1 }}>{f.label}</div>
                            {f.label === "SENHA"
                              ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ fontSize: 14, fontFamily: "monospace", color: C.white }}>{showPass[c.id] ? c.senha : "••••••••"}</span>
                                  <button onClick={() => setShowPass(p => ({ ...p, [c.id]: !p[c.id] }))} style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: 16 }}>{showPass[c.id] ? "hide" : "show"}</button>
                                </div>
                              : <div style={{ fontSize: 13, color: C.white }}>{f.val}</div>
                            }
                          </div>
                        ))}
                        {c.isMac && (
                          <>
                            <div style={{ background: C.bgCard2, borderRadius: 8, padding: "10px 12px", border: `1px solid ${C.border2}` }}>
                              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4, letterSpacing: 1 }}>MAC</div>
                              <div style={{ fontSize: 13, color: C.white, fontFamily: "monospace" }}>{c.mac || "—"}</div>
                            </div>
                            <div style={{ background: C.bgCard2, borderRadius: 8, padding: "10px 12px", border: `1px solid ${C.border2}` }}>
                              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4, letterSpacing: 1 }}>CODE</div>
                              <div style={{ fontSize: 13, color: C.white, fontFamily: "monospace" }}>{c.code || "—"}</div>
                            </div>
                          </>
                        )}
                        {c.obs && (
                          <div style={{ background: C.bgCard2, borderRadius: 8, padding: "10px 12px", border: `1px solid ${C.border2}`, gridColumn: "1 / -1" }}>
                            <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4, letterSpacing: 1 }}>OBSERVACOES</div>
                            <div style={{ fontSize: 13, color: C.white }}>{c.obs}</div>
                          </div>
                        )}
                      </div>

                      <div style={{ fontSize: 11, fontWeight: 500, color: C.textDim, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Historico ({(c.pagamentos || []).length})</div>
                      {(c.pagamentos || []).length === 0
                        ? <div style={{ color: C.textDim, fontSize: 13 }}>Nenhum pagamento registrado</div>
                        : [...(c.pagamentos || [])].reverse().map((p, i) => (
                          <div key={i} style={{ background: C.bgCard2, borderRadius: 8, padding: "10px 12px", marginBottom: 6, border: `1px solid ${C.border2}` }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: p.obs ? 6 : 0 }}>
                              <span style={{ fontWeight: 700, color: C.success, fontSize: 15 }}>{fmt(p.valor)}</span>
                              <span style={{ fontSize: 12, color: C.textMuted }}>{ptDate(p.data)}</span>
                            </div>
                            {p.obs && <div style={{ fontSize: 12, color: C.textMuted }}>{p.obs}</div>}
                          </div>
                        ))
                      }
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{ height: 20 }} />
          </div>
        )}

        {/* ══ ALERTAS ══ */}
        {view === "alertas" && (
          <div className="fin">
            <h2 style={{ fontSize: 19, fontWeight: 700, marginBottom: 20 }}>Alertas</h2>
            {[
              { title: "Vence hoje",       color: C.warning,   border: `${C.warning}40`, list: ativos.filter(c => diffDias(c.vencimento) === 0) },
              { title: "Vence amanhã",     color: C.blueLight, border: `${C.blue}50`,    list: ativos.filter(c => diffDias(c.vencimento) === 1) },
              { title: "Próximos 5 dias",  color: C.textMuted, border: C.border,         list: ativos.filter(c => { const d = diffDias(c.vencimento); return d >= 2 && d <= 5; }) },
              { title: "Atrasados",        color: C.danger,    border: `${C.danger}40`,  list: ativos.filter(c => getStatus(c) === "atrasado") },
            ].map(group => group.list.length > 0 && (
              <div key={group.title} style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: group.color, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>{group.title} ({group.list.length})</div>
                {group.list.map(c => {
                  const temPagamento = getPagamentoStatus(c) === "pago";
                  const venceHoje    = diffDias(c.vencimento) === 0;
                  return (
                    <div key={c.id} style={{ ...S.card, borderColor: group.border, padding: "14px 16px", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                        <div style={{ width: 40, height: 40, borderRadius: "50%", background: `${C.blue}25`, border: `1px solid ${C.blue}40`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: C.white, fontSize: 16, flexShrink: 0 }}>{initial(c.nome)}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                            <div style={{ fontWeight: 500 }}>{c.nome}</div>
                            <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20,
                              background: temPagamento ? `${C.success}20` : `${C.warning}20`,
                              color: temPagamento ? C.success : C.warning, flexShrink: 0
                            }}>
                              {temPagamento ? "Pago ✓" : "Pendente"}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>@{c.usuario} · Vence {ptDate(c.vencimento)} · {fmt(c.valor)}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        {venceHoje && temPagamento ? (
                          <button onClick={() => confirmarRenovacao(c)} style={{ ...S.btnPri, flex: 1, padding: "10px", fontSize: 13, background: `linear-gradient(135deg,${C.success},#059669)` }}>
                            ✓ Confirmar renovação
                          </button>
                        ) : (
                          <button onClick={() => openPay(c)} style={{ ...S.btnPri, flex: 1, padding: "10px", fontSize: 13 }}>Registrar pagamento</button>
                        )}
                        <button onClick={() => enviarWhatsApp(c, null, "cobranca")} style={{ ...S.btnWarn, flex: 1, padding: "10px", fontSize: 13 }}>Enviar cobrança</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            {alertCount === 0 && (
              <div style={{ textAlign: "center", padding: "60px 0", color: C.textDim }}>
                <div style={{ fontSize: 48, marginBottom: 14 }}>🎉</div>
                <div style={{ fontSize: 16, fontWeight: 500 }}>Tudo em dia!</div>
              </div>
            )}
          </div>
        )}

        {/* ══ SERVIDORES ══ */}
        {view === "servidores" && (
          <div className="fin">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ fontSize: 19, fontWeight: 700 }}>Servidores</h2>
              <button onClick={() => openServForm()} style={S.btnPri}>+ Novo servidor</button>
            </div>

            {servidores.length === 0 && <div style={{ color: C.textDim, padding: "30px 0", textAlign: "center" }}>Nenhum servidor cadastrado</div>}

            {servidores.map(s => (
              <div key={s.id} style={{ ...S.card, padding: "16px", marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{s.nome}</div>
                    <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>Custo de compra: <span style={{ color: C.warning }}>{fmt(s.creditoValor)}</span></div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => openServForm(s)} style={{ ...S.btnSm, padding: "6px 10px" }}>✏</button>
                    <button onClick={() => deleteServ(s.id)} style={{ ...S.btnSm, padding: "6px 10px" }}>🗑</button>
                  </div>
                </div>
                {(s.planos || []).length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Planos</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {s.planos.map(p => (
                        <div key={p.id} style={{ background: C.bgCard2, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "6px 12px", fontSize: 12 }}>
                          <span style={{ color: C.white }}>{p.nome}</span>
                          <span style={{ color: C.success, marginLeft: 8, fontWeight: 700 }}>{fmt(p.valor)}</span>
                          <span style={{ color: C.textMuted, marginLeft: 6, fontSize: 10, background: C.bgCard, padding: "1px 6px", borderRadius: 8 }}>
                            {p.periodicidade === "trimestral" ? "Trim." : p.periodicidade === "semestral" ? "Sem." : "Mens."}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* ══ BOTTOM NAV — só mobile ══ */}
      {isMobile && (
        <nav style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100,
          background: C.bgHeader, borderTop: `1px solid ${C.border}`,
          display: "flex", justifyContent: "space-around", alignItems: "center", height: 62, padding: "0 4px"
        }}>
          {navItems.map(t => (
            <button key={t.key} onClick={() => setView(t.key)} style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 2, background: view === t.key ? `${C.blue}30` : "none", border: "none", cursor: "pointer", padding: "6px 4px", borderRadius: 10,
              color: view === t.key ? "#ffffff" : "rgba(255,255,255,0.45)", fontFamily: "'Roboto',sans-serif", transition: "all .15s"
            }}>
              <span style={{ fontSize: 22 }}>{t.icon}</span>
              <span style={{ fontSize: 10, fontWeight: view === t.key ? 700 : 400 }}>{t.label}</span>
              {view === t.key && <div style={{ width: 20, height: 2, background: C.blueBright, borderRadius: 1 }} />}
            </button>
          ))}
        </nav>
      )}

      {/* ══ FAB ══ */}
      {view === "clientes" && (
        <button onClick={() => openForm()} style={{
          position: "fixed", bottom: isMobile ? 74 : 24, right: 18, zIndex: 99,
          width: 54, height: 54, borderRadius: "50%", border: "none", cursor: "pointer",
          background: `linear-gradient(135deg, ${C.blueBright}, ${C.blueDark})`,
          color: "#fff", fontSize: 28, boxShadow: `0 4px 20px ${C.blueGlow}`,
          display: "flex", alignItems: "center", justifyContent: "center"
        }}>+</button>
      )}

      {/* ══ MODAL CLIENTE ══ */}
      {showForm && (
        <BottomSheet onClose={() => setShowForm(false)}>
          <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 18 }}>{editingClient ? "Editar cliente" : "Novo cliente"}</h3>

          {[
            { label: "Nome *", key: "nome", placeholder: "Ex: Joao Silva" },
            { label: "Usuario *", key: "usuario", placeholder: "Ex: joaosilva" },
            { label: "Senha *", key: "senha", placeholder: "Senha do cliente" },
          ].map(f => (
            <div key={f.key} style={{ marginBottom: 12 }}>
              <Label>{f.label}</Label>
              <input value={form[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder} style={S.input} />
            </div>
          ))}

          {/* Servidor */}
          <div style={{ marginBottom: 12 }}>
            <Label>Servidor</Label>
            <select value={form.servidorId} onChange={e => handleServChange(e.target.value)} style={{ ...S.input, cursor: "pointer" }}>
              <option value="">-- Selecione --</option>
              {servidores.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </div>

          {/* Plano */}
          {form.servidorId && (
            <div style={{ marginBottom: 12 }}>
              <Label>Plano</Label>
              <select value={form.planoId} onChange={e => handlePlanoChange(e.target.value)} style={{ ...S.input, cursor: "pointer" }}>
                <option value="">-- Selecione --</option>
                {(servidores.find(s => s.id === form.servidorId)?.planos || []).map(p => (
                  <option key={p.id} value={p.id}>
                    {p.nome} — {fmt(p.valor)} ({p.periodicidade === "trimestral" ? "Trimestral" : p.periodicidade === "semestral" ? "Semestral" : "Mensal"})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Periodicidade (readonly, vem do plano) */}
          {form.planoId && (
            <div style={{ marginBottom: 12, background: C.bgCard2, borderRadius: 8, padding: "10px 14px", border: `1px solid ${C.border2}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: C.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Periodicidade</span>
              <span style={{ fontSize: 13, color: C.blueLight, fontWeight: 600 }}>
                {form.periodicidade === "trimestral" ? "Trimestral (+90 dias)" : form.periodicidade === "semestral" ? "Semestral (+180 dias)" : "Mensal (+30 dias)"}
              </span>
            </div>
          )}

          {/* Valor */}
          <div style={{ marginBottom: 12 }}>
            <Label>Valor mensal *</Label>
            <input inputMode="numeric" value={form.valor}
              onChange={e => setForm(p => ({ ...p, valor: maskValor(e.target.value) }))}
              placeholder="R$ 0,00" style={S.input} />
          </div>

          {/* Telefone */}
          <div style={{ marginBottom: 12 }}>
            <Label>Telefone / WhatsApp</Label>
            <input inputMode="numeric" value={form.telefone}
              onChange={e => setForm(p => ({ ...p, telefone: maskTel(e.target.value) }))}
              placeholder="(87) 99999-9999" style={S.input} />
          </div>

          {/* Vencimento */}
          <div style={{ marginBottom: 12 }}>
            <Label>Data de vencimento *</Label>
            <input type="date" value={form.vencimento}
              onChange={e => setForm(p => ({ ...p, vencimento: e.target.value }))}
              style={S.input} />
          </div>

          {/* App */}
          <div style={{ marginBottom: 12 }}>
            <Label>App que usara</Label>
            <input value={form.appNome} onChange={e => setForm(p => ({ ...p, appNome: e.target.value }))} placeholder="Ex: IPTV Smarters" style={S.input} />
          </div>

          {/* MAC checkbox */}
          <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
            <input type="checkbox" id="isMac" checked={form.isMac} onChange={e => setForm(p => ({ ...p, isMac: e.target.checked, mac: "", code: "" }))}
              style={{ width: 18, height: 18, accentColor: C.blue, cursor: "pointer" }} />
            <label htmlFor="isMac" style={{ fontSize: 14, color: C.textLight, cursor: "pointer", fontWeight: 500 }}>App via MAC</label>
          </div>

          {form.isMac && (
            <>
              <div style={{ marginBottom: 12 }}>
                <Label>MAC</Label>
                <input inputMode="numeric" value={form.mac}
                  onChange={e => setForm(p => ({ ...p, mac: maskMac(e.target.value) }))}
                  placeholder="00:00:00:00:00:00" style={{ ...S.input, fontFamily: "monospace" }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <Label>Code</Label>
                <input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value.replace(/\D/g, "") }))}
                  placeholder="Codigo de ativacao" style={{ ...S.input, fontFamily: "monospace" }} />
              </div>
            </>
          )}

          {/* Observações */}
          <div style={{ marginBottom: 12 }}>
            <Label>Observacoes</Label>
            <textarea value={form.obs} onChange={e => setForm(p => ({ ...p, obs: e.target.value }))}
              placeholder="Alguma observacao sobre o cliente..."
              rows={3} style={{ ...S.input, resize: "vertical", lineHeight: 1.5 }} />
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button onClick={() => setShowForm(false)} style={{ ...S.btnSec, flex: 1 }}>Cancelar</button>
            <button onClick={saveForm} disabled={saving} style={{ ...S.btnPri, flex: 1 }}>{saving ? "Salvando..." : "Salvar"}</button>
          </div>
        </BottomSheet>
      )}

      {/* ══ MODAL SERVIDOR ══ */}
      {showServForm && (
        <BottomSheet onClose={() => setShowServForm(false)}>
          <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 18 }}>{editingServ ? "Editar servidor" : "Novo servidor"}</h3>

          <div style={{ marginBottom: 12 }}>
            <Label>Nome do servidor *</Label>
            <input value={servForm.nome} onChange={e => setServForm(f => ({ ...f, nome: e.target.value }))} placeholder="Ex: NetMax" style={S.input} />
          </div>

          <div style={{ marginBottom: 18 }}>
            <Label>Custo de compra (seu custo)</Label>
            <input inputMode="numeric" value={servForm.creditoValor}
              onChange={e => setServForm(f => ({ ...f, creditoValor: maskValor(e.target.value) }))}
              placeholder="R$ 0,00" style={S.input} />
          </div>

          {/* Planos */}
          <div style={{ marginBottom: 12 }}>
            <Label>Planos</Label>
            {servForm.planos.map(p => (
              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.bgCard2, borderRadius: 8, padding: "10px 12px", marginBottom: 6, border: `1px solid ${C.border2}` }}>
                <div>
                  <span style={{ fontSize: 14, color: C.white }}>{p.nome}</span>
                  <span style={{ color: C.success, marginLeft: 8, fontWeight: 700 }}>{fmt(p.valor)}</span>
                  <span style={{ color: C.textMuted, marginLeft: 8, fontSize: 12, background: C.bgCard, padding: "2px 8px", borderRadius: 10, border: `1px solid ${C.border2}` }}>
                    {p.periodicidade === "trimestral" ? "Trimestral" : p.periodicidade === "semestral" ? "Semestral" : "Mensal"}
                  </span>
                </div>
                <button onClick={() => removePlano(p.id)} style={{ background: "none", border: "none", color: C.danger, cursor: "pointer", fontSize: 18, flexShrink: 0 }}>×</button>
              </div>
            ))}

            {/* Adicionar novo plano */}
            <div style={{ background: C.bgCard2, borderRadius: 10, padding: "12px", marginTop: 10, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Novo plano</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input value={newPlano.nome} onChange={e => setNewPlano(p => ({ ...p, nome: e.target.value }))} placeholder="Nome do plano" style={{ ...S.input, flex: 2 }} />
                <input inputMode="numeric" value={newPlano.valor}
                  onChange={e => setNewPlano(p => ({ ...p, valor: maskValor(e.target.value) }))}
                  placeholder="R$ 0,00" style={{ ...S.input, flex: 1 }} />
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select value={newPlano.periodicidade} onChange={e => setNewPlano(p => ({ ...p, periodicidade: e.target.value }))}
                  style={{ ...S.input, flex: 1, cursor: "pointer" }}>
                  <option value="mensal">Mensal</option>
                  <option value="trimestral">Trimestral</option>
                  <option value="semestral">Semestral</option>
                </select>
                <button onClick={addPlano} style={{ ...S.btnPri, padding: "12px 20px", fontSize: 14, flexShrink: 0 }}>+ Adicionar</button>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button onClick={() => setShowServForm(false)} style={{ ...S.btnSec, flex: 1 }}>Cancelar</button>
            <button onClick={saveServForm} disabled={saving} style={{ ...S.btnPri, flex: 1 }}>{saving ? "Salvando..." : "Salvar"}</button>
          </div>
        </BottomSheet>
      )}

      {/* ══ MODAL PAGAMENTO ══ */}
      {payModal && (
        <BottomSheet onClose={() => setPayModal(null)}>
          <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Registrar pagamento</h3>
          <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 18 }}>{payModal.nome}</div>
          <div style={{ marginBottom: 12 }}>
            <Label>Valor recebido *</Label>
            <input inputMode="numeric" value={payForm.valor}
              onChange={e => setPayForm(p => ({ ...p, valor: maskValor(e.target.value) }))}
              placeholder="R$ 0,00" style={S.input} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <Label>Data do pagamento *</Label>
            <input type="date" value={payForm.data} onChange={e => setPayForm(p => ({ ...p, data: e.target.value }))} style={S.input} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <Label>Observação (opcional)</Label>
            <input value={payForm.obs} onChange={e => setPayForm(p => ({ ...p, obs: e.target.value }))} placeholder="Ex: Pix, boleto..." style={S.input} />
          </div>

          {/* Checkbox renovar */}
          <div onClick={() => setPayForm(p => ({ ...p, renovar: !p.renovar }))}
            style={{ display: "flex", alignItems: "center", gap: 12, background: payForm.renovar ? `${C.success}18` : C.bgCard2, border: `1px solid ${payForm.renovar ? C.success + "60" : C.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 20, cursor: "pointer", transition: "all .2s" }}>
            <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${payForm.renovar ? C.success : C.border}`, background: payForm.renovar ? C.success : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all .2s" }}>
              {payForm.renovar && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: payForm.renovar ? C.success : C.textLight }}>Renovar acesso</div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                {payForm.renovar
                  ? `Próx. vencimento: ${ptDate((() => { const c = clients.find(x => x.id === payModal.id); const diff = diffDias(c?.vencimento); const dias = perioDias(c?.periodicidade || "mensal"); return diff <= 0 ? addDias(payForm.data, dias) : addDias(c?.vencimento, dias); })())}`
                  : "Marque para renovar o vencimento junto com o pagamento"}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setPayModal(null)} style={{ ...S.btnSec, flex: 1 }}>Cancelar</button>
            <button onClick={registrarPagamento} disabled={saving} style={{ background: `linear-gradient(135deg,${C.success},#059669)`, color: "#fff", border: "none", borderRadius: 8, padding: 14, flex: 1, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Roboto',sans-serif" }}>
              {saving ? "Salvando..." : "Confirmar"}
            </button>
          </div>
        </BottomSheet>
      )}

      {/* ══ MODAL POS-PAGAMENTO ══ */}
      {lastPay && (
        <BottomSheet onClose={() => setLastPay(null)}>
          <div style={{ textAlign: "center", paddingTop: 8 }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>✅</div>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Pagamento registrado!</h3>
            <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 8 }}>{lastPay.client.nome}</div>
            <div style={{ fontSize: 30, fontWeight: 900, color: C.success, marginBottom: 12 }}>{fmt(lastPay.pagamento.valor)}</div>
            {lastPay.renovado
              ? <div style={{ fontSize: 13, color: C.success, background: `${C.success}15`, borderRadius: 8, padding: "8px 14px", marginBottom: 20 }}>
                  Renovação aplicada · Próx. vencimento: {ptDate(lastPay.client.vencimento)}
                </div>
              : <div style={{ fontSize: 13, color: C.warning, background: `${C.warning}15`, borderRadius: 8, padding: "8px 14px", marginBottom: 20 }}>
                  Pagamento registrado. Renovação será aplicada no vencimento ({ptDate(lastPay.client.vencimento)}).
                </div>
            }
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {lastPay.client.telefone && (
                <button onClick={() => { enviarWhatsApp(lastPay.client, lastPay.pagamento, "comprovante"); setLastPay(null); }}
                  style={{ ...S.btnPri, width: "100%", padding: 14, background: "linear-gradient(135deg,#128c3e,#075e29)" }}>
                  Enviar comprovante via WhatsApp
                </button>
              )}
              <button onClick={() => setLastPay(null)} style={{ ...S.btnSec, width: "100%", padding: 14 }}>Fechar</button>
            </div>
          </div>
        </BottomSheet>
      )}
      {/* ══ MODAL RENOVAÇÃO ══ */}
      {renovModal && (
        <div style={S.overlay}>
          <div style={{
            ...S.card, width: "100%", maxWidth: 560, borderRadius: "20px 20px 0 0",
            padding: "8px 0 0", maxHeight: "93vh", overflowY: "auto",
            animation: "slideUp 0.25s ease"
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px 12px" }}>
              <div style={{ width: 40, height: 4, background: C.border, borderRadius: 2 }} />
              <button onClick={() => setRenovModal(null)} style={{ background: C.bgCard2, border: `1px solid ${C.border}`, borderRadius: "50%", width: 30, height: 30, color: C.textMuted, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            </div>
            <div style={{ padding: "0 20px 36px" }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Renovar acesso</h3>
              <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 20 }}>{renovModal.client.nome}</div>

              <div style={{ background: C.bgCard2, borderRadius: 10, padding: "12px 14px", marginBottom: 18, border: `1px solid ${C.border2}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: C.textMuted }}>Vencimento atual</span>
                  <span style={{ fontSize: 13, color: C.white, fontWeight: 500 }}>{ptDate(renovModal.client.vencimento)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: C.textMuted }}>Periodicidade</span>
                  <span style={{ fontSize: 13, color: C.blueLight, fontWeight: 500 }}>
                    {renovModal.client.periodicidade === "trimestral" ? "Trimestral" : renovModal.client.periodicidade === "semestral" ? "Semestral" : "Mensal"}
                  </span>
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <Label>Novo vencimento</Label>
                <input type="date" value={renovModal.novoVenc}
                  onChange={e => setRenovModal(r => ({ ...r, novoVenc: e.target.value }))}
                  style={S.input} />
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>
                  Calculado automaticamente. Altere se necessário.
                </div>
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setRenovModal(null)} style={{ ...S.btnSec, flex: 1 }}>Cancelar</button>
                <button onClick={executarRenovacao} disabled={saving} style={{ ...S.btnPri, flex: 1, background: `linear-gradient(135deg,${C.success},#059669)`, padding: 14, fontSize: 14, fontWeight: 700 }}>
                  {saving ? "Salvando..." : "✓ Confirmar renovação"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
