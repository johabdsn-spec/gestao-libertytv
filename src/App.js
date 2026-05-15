import { useState, useEffect, useCallback } from "react";
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

function getStatus(client) {
  const venc = client.vencimento; // agora é ISO "YYYY-MM-DD"
  if (!venc) return "pendente";
  const diff = diffDias(venc);
  // Verifica se pagou este "ciclo" (último pagamento depois do penúltimo vencimento)
  const pags = client.pagamentos || [];
  if (pags.length > 0) {
    const last  = pags[pags.length - 1];
    const lastD = new Date(last.data + "T12:00");
    const vencD = new Date(venc + "T12:00");
    const dias  = perioDias(client.periodicidade || "mensal");
    const prevVenc = new Date(vencD); prevVenc.setDate(prevVenc.getDate() - dias);
    if (lastD >= prevVenc) return "pago";
  }
  if (diff < 0) return "atrasado";
  return "pendente";
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

function getStatus(client) {
  const pags = client.pagamentos || [];
  if (pags.length > 0) {
    const last  = pags[pags.length - 1];
    const lastD = new Date(last.data);
    const now   = new Date();
    if (lastD.getMonth() === now.getMonth() && lastD.getFullYear() === now.getFullYear())
      return "pago";
  }
  return todayDay() > client.vencimento ? "atrasado" : "pendente";
}

const STATUS = {
  pago:     { bg: "#002a1a", text: "#00d68f", border: "#00d68f30", label: "Pago" },
  pendente: { bg: "#2a1a00", text: "#ffb020", border: "#ffb02030", label: "Pendente" },
  atrasado: { bg: "#2a0a0a", text: "#ff5c5c", border: "#ff5c5c30", label: "Atrasado" },
};

const isDueToday = (c) => { const d = diffDias(c.vencimento); return d >= 0 && d <= 2 && getStatus(c) !== "pago"; };
const isDueSoon  = (c) => { const d = diffDias(c.vencimento); return d > 0 && d <= 3 && getStatus(c) !== "pago"; };

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
  const nome = client.nome.split(" ")[0];
  let msg = "";
  if (tipo === "comprovante") {
    msg =
      `Ola ${nome}!\n\n` +
      `Seu pagamento foi confirmado.\n\n` +
      `Liberty TV\n` +
      `Valor: ${fmt(pagamento.valor)}\n` +
      `Data: ${ptDate(pagamento.data)}\n` +
      `Referencia: ${mesAno()}\n` +
      `Prox. vencimento: Dia ${client.vencimento}\n\n` +
      `Obrigado pela preferencia!`;
  } else {
    msg =
      `Ola ${nome}!\n\n` +
      `Passando para lembrar que sua mensalidade da Liberty TV ` +
      `no valor de ${fmt(client.valor)} vence dia ${client.vencimento}.\n\n` +
      `Contamos com voce! Qualquer duvida estamos a disposicao.`;
  }
  window.open(`https://wa.me/55${tel}?text=${encodeURIComponent(msg)}`, "_blank");
}

// ── Notificações ──────────────────────────────────────────────
function useNotifications(clients) {
  const [notifStatus, setNotifStatus] = useState(Notification?.permission || "default");
  const dispararNotificacoes = useCallback((cls) => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const ativos    = cls.filter(c => c.ativo !== false);
    const hoje      = ativos.filter(isDueToday);
    const atrasados = ativos.filter(c => getStatus(c) === "atrasado");
    if (hoje.length > 0)
      new Notification("Liberty TV - Vencimentos hoje", { body: hoje.map(c => `${c.nome} - ${fmt(c.valor)}`).join("\n") });
    if (atrasados.length > 0)
      new Notification(`Liberty TV - ${atrasados.length} cliente(s) em atraso`, { body: atrasados.map(c => `${c.nome} - dia ${c.vencimento}`).join("\n") });
  }, []);
  const requestPermission = useCallback(async () => {
    if (!("Notification" in window)) return;
    const perm = await Notification.requestPermission();
    setNotifStatus(perm);
    if (perm === "granted") dispararNotificacoes(clients);
  }, [clients, dispararNotificacoes]);
  useEffect(() => {
    if (clients.length > 0 && Notification?.permission === "granted") dispararNotificacoes(clients);
  }, [clients.length]);
  return { notifStatus, requestPermission };
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

  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" ? window.innerWidth < 640 : true);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const { notifStatus, requestPermission } = useNotifications(clients);

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
  const totalPendente = ativos.filter(c => getStatus(c) === "pendente").length;
  const totalAtrasado = ativos.filter(c => getStatus(c) === "atrasado").length;
  const receitaTotal  = ativos.reduce((s, c) => s + valorMensal(Number(c.valor || 0), c.periodicidade), 0);
  const receitaPaga   = ativos.filter(c => getStatus(c) === "pago").reduce((s, c) => s + valorMensal(Number(c.valor || 0), c.periodicidade), 0);
  const alertCount    = dueToday.length + dueSoon.length + totalAtrasado;

  const filtered = clients.filter(c => {
    const ms = (c.nome + c.usuario + (c.servidorNome || "")).toLowerCase().includes(search.toLowerCase());
    const fs = filterStatus === "todos" || getStatus(c) === filterStatus;
    return ms && fs;
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
    const dias = perioDias(c.periodicidade || "mensal");
    // Novo vencimento: a partir da data do pagamento + periodicidade
    const novoVenc = addDias(payForm.data, dias);
    await updateDoc(doc(db, "clientes", payModal.id), {
      pagamentos: [...(c.pagamentos || []), novo],
      vencimento: novoVenc,
    });
    setSaving(false);
    setLastPay({ client: { ...c, vencimento: novoVenc }, pagamento: novo });
    setPayModal(null);
    setPayForm({ valor: "", data: todayISO(), obs: "" });
  };

  const desfazerPagamento = async (id) => {
    const c = clients.find(x => x.id === id);
    const pags = [...(c.pagamentos || [])]; pags.pop();
    await updateDoc(doc(db, "clientes", id), { pagamentos: pags });
  };
  const toggleAtivo  = async (id, ativo) => updateDoc(doc(db, "clientes", id), { ativo: !ativo });
  const deleteClient = async (id) => { if (window.confirm("Remover cliente?")) await deleteDoc(doc(db, "clientes", id)); };
  const openPay      = (c) => {
    setPayModal(c);
    setPayForm({ valor: c.valor ? maskValor(String(Math.round(c.valor * 100))) : "", data: todayISO(), obs: "" });
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
            {notifStatus !== "granted"
              ? <button onClick={requestPermission} style={{ background: `${C.warning}18`, border: `1px solid ${C.warning}40`, borderRadius: 6, padding: "5px 10px", fontSize: 11, color: C.warning, cursor: "pointer", fontFamily: "'Roboto',sans-serif" }}>🔔 Notificações</button>
              : <span style={{ fontSize: 11, color: C.success, background: `${C.success}15`, padding: "4px 10px", borderRadius: 6 }}>🔔 Notificações ativas</span>
            }
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
                { label: "Pagos",           value: totalPago,         icon: "✔",  color: C.success },
                { label: "Pendentes",       value: totalPendente,     icon: "⏳", color: C.warning },
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
              const hoje    = new Date(); hoje.setHours(0,0,0,0);
              const amanha  = new Date(); amanha.setDate(amanha.getDate()+1); amanha.setHours(0,0,0,0);
              const vencendoHoje   = ativos.filter(c => { const d = diffDias(c.vencimento); return d === 0 && getStatus(c) !== "pago"; });
              const vencendoAmanha = ativos.filter(c => { const d = diffDias(c.vencimento); return d === 1 && getStatus(c) !== "pago"; });
              const atrasados      = ativos.filter(c => getStatus(c) === "atrasado");
              const totalAlertas   = vencendoHoje.length + vencendoAmanha.length + atrasados.length;

              if (totalAlertas === 0) return (
                <div style={{ ...S.card, padding: "20px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🎉</div>
                  <div style={{ fontWeight: 600, fontSize: 15, color: C.white }}>Tudo em dia!</div>
                  <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>Nenhum vencimento para hoje ou amanhã</div>
                </div>
              );

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
                    {[
                      ...vencendoHoje.map(c   => ({ ...c, _tag: "hoje" })),
                      ...vencendoAmanha.map(c => ({ ...c, _tag: "amanha" })),
                      ...atrasados.map(c      => ({ ...c, _tag: "atrasado" })),
                    ].slice(0, 4).map(c => (
                      <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.border2}` }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 34, height: 34, borderRadius: "50%", background: `${C.blue}25`, border: `1px solid ${C.blue}40`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: C.white, fontSize: 14, flexShrink: 0 }}>{initial(c.nome)}</div>
                          <div>
                            <div style={{ fontWeight: 500, fontSize: 14 }}>{c.nome}</div>
                            <div style={{ fontSize: 11, color: c._tag === "atrasado" ? C.danger : c._tag === "hoje" ? C.warning : C.textMuted }}>
                              {c._tag === "atrasado" ? `Em atraso desde ${ptDate(c.vencimento)}` : c._tag === "hoje" ? "Vence hoje" : "Vence amanhã"} · {fmt(c.valor)}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
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
                <option value="pendente">Pendentes</option>
                <option value="atrasado">Atrasados</option>
              </select>
            </div>

            {filtered.length === 0 && <div style={{ color: C.textDim, padding: "30px 0", textAlign: "center" }}>Nenhum cliente encontrado</div>}

            {filtered.map(c => {
              const st   = getStatus(c);
              const sc   = STATUS[st];
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
                    {st !== "pago" && <button onClick={() => openPay(c)} style={{ ...S.btnPri, padding: "9px 14px", fontSize: 13, flex: 1 }}>Registrar pagamento</button>}
                    <button onClick={() => enviarWhatsApp(c, null, "cobranca")} style={{ ...S.btnWarn, padding: "9px 14px", fontSize: 12, flex: 1 }}>Enviar cobrança</button>
                    {st === "pago" && last && c.telefone && <button onClick={() => enviarWhatsApp(c, last, "comprovante")} style={{ ...S.btnWa, padding: "9px 12px" }}>Comprovante WA</button>}
                    {st === "pago" && <button onClick={() => desfazerPagamento(c.id)} style={{ ...S.btnSm, padding: "9px 10px" }}>↩</button>}
                    <button onClick={() => openForm(c)} style={{ ...S.btnSm, padding: "9px 10px" }}>✏</button>
                    <button onClick={() => toggleAtivo(c.id, c.ativo !== false)} style={{ ...S.btnSm, padding: "9px 10px" }}>{c.ativo !== false ? "🔒" : "🔓"}</button>
                    <button onClick={() => deleteClient(c.id)} style={{ ...S.btnSm, padding: "9px 10px" }}>🗑</button>
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
              { title: "Vencendo hoje",    color: C.blueLight, border: `${C.blue}50`,    list: ativos.filter(c => diffDias(c.vencimento) === 0 && getStatus(c) !== "pago") },
              { title: "Vence amanhã",     color: C.warning,   border: `${C.warning}40`, list: ativos.filter(c => diffDias(c.vencimento) === 1 && getStatus(c) !== "pago") },
              { title: "Próximos 5 dias",  color: C.textMuted, border: `${C.border}`,    list: ativos.filter(c => { const d = diffDias(c.vencimento); return d >= 2 && d <= 5 && getStatus(c) !== "pago"; }) },
              { title: "Atrasados",        color: C.danger,    border: `${C.danger}40`,  list: ativos.filter(c => getStatus(c) === "atrasado") },
            ].map(group => group.list.length > 0 && (
              <div key={group.title} style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: group.color, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>{group.title} ({group.list.length})</div>
                {group.list.map(c => (
                  <div key={c.id} style={{ ...S.card, borderColor: group.border, padding: "14px 16px", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <div style={{ width: 40, height: 40, borderRadius: "50%", background: `${C.blue}25`, border: `1px solid ${C.blue}40`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: C.white, fontSize: 16, flexShrink: 0 }}>{initial(c.nome)}</div>
                      <div>
                        <div style={{ fontWeight: 500 }}>{c.nome}</div>
                        <div style={{ fontSize: 12, color: C.textMuted }}>@{c.usuario} · Vence {ptDate(c.vencimento)} · {fmt(c.valor)}</div>
                        <div style={{ fontSize: 11, color: C.textDim, marginTop: 1 }}>{c.planoNome || ""}{c.periodicidade && c.periodicidade !== "mensal" ? ` · ${c.periodicidade === "trimestral" ? "Trimestral" : "Semestral"}` : ""}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => openPay(c)} style={{ ...S.btnPri, flex: 1, padding: "10px", fontSize: 13 }}>Registrar pagamento</button>
                      <button onClick={() => enviarWhatsApp(c, null, "cobranca")} style={{ ...S.btnWarn, flex: 1, padding: "10px", fontSize: 13 }}>Enviar cobrança</button>
                    </div>
                  </div>
                ))}
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
          <div style={{ marginBottom: 12 }}>
            <Label>Observacao (opcional)</Label>
            <input value={payForm.obs} onChange={e => setPayForm(p => ({ ...p, obs: e.target.value }))} placeholder="Ex: Pix, boleto..." style={S.input} />
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
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
            <div style={{ fontSize: 30, fontWeight: 900, color: C.success, marginBottom: 24 }}>{fmt(lastPay.pagamento.valor)}</div>
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
    </div>
  );
}
