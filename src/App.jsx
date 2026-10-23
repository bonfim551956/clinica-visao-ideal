
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, entrar, usuarioDaSessao, gerirUsuario, sair, listarUsuarios, listarUnidades, usuariosEmCache } from './supabase';

/* ── helpers ── */
const pad = n => String(n).padStart(2,'0');
const today = () => { const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const fmtDate = iso => { if(!iso) return ''; const [y,m,d]=iso.split('-'); return `${d}/${m}/${y}`; };
const uid = () => Math.random().toString(36).slice(2,10).toUpperCase();
const fmtMoney = v => Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

/* ── design tokens ── */
// Paleta tirada da logo Visão Ideal: verde-água (#4DA6A4) → azul (#2A5790).
// "teal" é o tom intermediário, escurecido o suficiente para texto branco legível (contraste AA);
// "orange" (nome mantido por compatibilidade) agora é o azul da logo — cor das ações principais.
const C = {
  teal:'#357F96', tealD:'#2B6A7E', tealL:'#4DA6A4', tealBg:'#EAF4F4',
  orange:'#2A5790', orangeD:'#22477A', orangeBg:'#E9EEF6',
  navy:'#1F1F1F', bg:'#F5F7F8', white:'#fff',
  gradiente:'linear-gradient(135deg,#4DA6A4 0%,#2A5790 100%)',
  success:'#28A745', danger:'#DC3545', warn:'#FFC107',
  gray:'#6c757d', grayL:'#f0f0ee', border:'#dee2e6',
  text:'#1F1F1F', textSm:'#5A5A5A'
};

const HORARIOS = (() => {
  const h = [];
  for (let t = 8*60; t <= 18*60+45; t += 15) {
    h.push(`${pad(Math.floor(t/60))}:${pad(t%60)}`);
  }
  return h;
})();

const PROCEDIMENTOS = ['CONSULTA','RETORNO'];
const MEIOS_CONTATO = ['LOJA','VISÃO IDEAL'];
/* ── Refração digitada: regras e formatação ──
   Esférico: -30 a +30, de 0,25 em 0,25 (0 = "PLANO")
   Cilíndrico: sempre negativo (positivo é convertido), 0 a -10, de 0,25 em 0,25
   Eixo: inteiro de 0 a 180 — obrigatório quando há cilíndrico
   Adição: +0,25 a +4,00, de 0,25 em 0,25 (vazio = "N/A")
   DNP: 20 a 40 mm (aceita meio milímetro; vazio = "N/A") */
const numRx = v => { const t = String(v ?? '').trim().replace(',', '.').replace(/^\+/, ''); if (t === '' ) return null; if (/^plano$/i.test(t)) return 0; return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN; };
const quarto = n => Math.abs(n * 4 - Math.round(n * 4)) < 1e-9;
const fmtDiop = n => n === 0 ? 'PLANO' : (n > 0 ? '+' : '-') + Math.abs(n).toFixed(2).replace('.', ',');
const REGRAS_RX = {
  esf: v => { const n = numRx(v); if (n === null) return { valor: 'PLANO' };
    if (isNaN(n) || !quarto(n) || n < -30 || n > 30) return { erro: 'Esférico: de -30 a +30, em passos de 0,25' };
    return { valor: fmtDiop(n) }; },
  cil: v => { let n = numRx(v); if (n === null) return { valor: 'PLANO' };
    if (isNaN(n)) return { erro: 'Cilíndrico inválido' };
    n = -Math.abs(n); // cilíndrico sempre negativo
    if (!quarto(n) || n < -10) return { erro: 'Cilíndrico: de 0 a -10, em passos de 0,25' };
    return { valor: fmtDiop(n) }; },
  eixo: v => { const t = String(v ?? '').trim().replace('°', ''); if (t === '') return { valor: '' };
    if (!/^\d{1,3}$/.test(t) || Number(t) > 180) return { erro: 'Eixo: número inteiro de 0 a 180' };
    return { valor: String(Number(t)) }; },
  add: v => { const t = String(v ?? '').trim(); if (t === '' || /^n\/?a$/i.test(t)) return { valor: 'N/A' };
    const n = numRx(t); if (isNaN(n) || n === null || !quarto(n) || n <= 0 || n > 4) return { erro: 'Adição: de +0,25 a +4,00, em passos de 0,25' };
    return { valor: fmtDiop(n) }; },
  // AV (acuidade visual): opcional, texto curto como 20/20, 20/25, 1,0 ou CD
  av: v => { const t = String(v ?? '').trim().toUpperCase().replace(/\s+/g, ''); if (t === '') return { valor: '' };
    if (!/^[0-9A-Z/,.+-]{1,10}$/.test(t)) return { erro: 'AV: use o formato 20/20 ou decimal (1,0)' };
    return { valor: t }; },
  dnp: v => { const t = String(v ?? '').trim(); if (t === '' || /^n\/?a$/i.test(t)) return { valor: 'N/A' };
    const n = numRx(t); if (isNaN(n) || n === null || n < 20 || n > 40 || Math.abs(n * 2 - Math.round(n * 2)) > 1e-9) return { erro: 'DNP: de 20 a 40 mm' };
    return { valor: String(n).replace('.', ',') }; },
};
const CAMPOS_RX = ['esf','cil','eixo','av','add','dnp'];
// Tratamentos sugeridos na receita (antirreflexo já vem marcado)
const TRATAMENTOS = [
  { id:'AR', label:'ANTIRREFLEXO (AR)', desc:'Reduz reflexos e melhora a nitidez' },
  { id:'BLUE', label:'FILTRO DE LUZ AZUL (BLUE)', desc:'Para quem usa telas por muitas horas' },
  { id:'FOTOCROMÁTICO', label:'FOTOCROMÁTICO', desc:'Escurece no sol e clareia em ambientes internos' },
];
const TRAT_PADRAO = ['AR'];
// Tipo de lente sugerido (escolha obrigatória na anamnese)
const TIPOS_LENTE = [
  { id:'MONOFOCAL',   label:'MONOFOCAL',   desc:'Um único grau: para longe ou para perto' },
  { id:'MULTIFOCAL',  label:'MULTIFOCAL',  desc:'Longe, intermediário e perto, sem linha' },
  { id:'BIFOCAL',     label:'BIFOCAL',     desc:'Longe e perto, com divisão visível' },
  { id:'OCUPACIONAL', label:'OCUPACIONAL', desc:'Perto e meia distância: tela e leitura' },
];
const nomeTrat = id => TRATAMENTOS.find(t=>t.id===String(id).toUpperCase())?.label || String(id).toUpperCase();
const validarRx = form => {
  const erros = {}, valores = {};
  for (const olho of ['od','oe']) {
    for (const c of CAMPOS_RX) { const r = REGRAS_RX[c](form[`${olho}_${c}`]); if (r.erro) erros[`${olho}_${c}`] = r.erro; else valores[`${olho}_${c}`] = r.valor; }
    const cil = valores[`${olho}_cil`];
    if (cil && cil.toUpperCase() !== 'PLANO' && !valores[`${olho}_eixo`] && !erros[`${olho}_eixo`]) erros[`${olho}_eixo`] = 'Informe o eixo (há cilíndrico)';
    // sem cilíndrico o eixo não vale: não sai na receita nem trava a geração
    if (cil && cil.toUpperCase() === 'PLANO') { valores[`${olho}_eixo`] = ''; delete erros[`${olho}_eixo`]; }
  }
  return { erros, valores };
};

const SPH = ['PLANO','+0,25','+0,50','+0,75','+1,00','+1,25','+1,50','+1,75','+2,00','+2,25','+2,50',
  '+2,75','+3,00','+3,50','+4,00','+4,50','+5,00','+5,50','+6,00',
  '-0,25','-0,50','-0,75','-1,00','-1,25','-1,50','-1,75','-2,00','-2,25','-2,50',
  '-2,75','-3,00','-3,50','-4,00','-4,50','-5,00','-5,50','-6,00','-7,00','-8,00'];
const CYL = ['PLANO','-0,25','-0,50','-0,75','-1,00','-1,25','-1,50','-1,75','-2,00','-2,50','-3,00'];
const AXIS = Array.from({length:180},(_,i)=>String(i+1));
const ADD_VALS = ['N/A','+0,75','+1,00','+1,25','+1,50','+1,75','+2,00','+2,25','+2,50','+2,75','+3,00'];
const DNP_VALS = ['N/A','28','29','30','31','32','33','34','35','36','37','38','39','40'];

const PERFIS = {
  opto:      { label:'Optometrista', cor:C.teal,    nav:['inicio','agenda','atendimento','receitas','manual'] },
  comercial: { label:'Comercial',    cor:'#4DA6A4',  nav:['inicio','agenda','atendimento','receitas','manual'] },
  prevenda:  { label:'Pré-Venda',    cor:'#3F6FA0',  nav:['inicio','agenda','conversao','noshow','receitas','manual'] },
  gerente:   { label:'Gerente',      cor:C.orange,   nav:['inicio','agenda','atendimento','receitas','manual'] },
  supervisor:{ label:'Supervisor',   cor:'#2A5790',  nav:['inicio','agenda','atendimento','receitas','conversao','noshow','relatorios','usuarios','lojas','manual'] },
  diretor:   { label:'Diretor',      cor:C.navy,     nav:['inicio','agenda','atendimento','receitas','conversao','noshow','relatorios','usuarios','lojas','manual'] },
};

// Lojas ativas — carregadas da tabela public.unidades ao entrar (tela "Lojas"); os valores abaixo são só o ponto de partida
const UNIDADES = ['SÃO VICENTE','PIRACICABA','SOROCABA','CAMPINAS'];

// Endereços por unidade — para cabeçalho da receita e rodapé
const ENDERECOS_UNIDADES = {
  'SÃO VICENTE': 'AV. ANTÔNIO EMERICH, 477 - VILA MELO – SÃO VICENTE – SP',
  'PIRACICABA':  'RUA BENJAMIN CONSTANT, 1379 - CENTRO – PIRACICABA – SP',
  'SOROCABA':    'R. COMENDADOR HERMELINO MATARAZZO, 468 - VILA SANTANA – SOROCABA – SP',
  'CAMPINAS':    'RUA CONCEIÇÃO, 233, SALA 604 - CENTRO – CAMPINAS – SP',
};

// Atualiza as listas de lojas usadas pelo sistema todo a partir do banco
const aplicarUnidades = lista => {
  if (!lista || !lista.length) return; // sem resposta do banco: mantém a lista atual
  const ativas = lista.filter(u => u.ativa);
  UNIDADES.splice(0, UNIDADES.length, ...ativas.map(u => u.nome));
  Object.keys(ENDERECOS_UNIDADES).forEach(k => delete ENDERECOS_UNIDADES[k]);
  lista.forEach(u => { if (u.endereco) ENDERECOS_UNIDADES[u.nome] = u.endereco; });
};

// Perfis que veem os KPIs comerciais (Conversões, Faturamento, No-Show, Taxa Conv.)
const PERFIS_COMERCIAL = ['prevenda','supervisor','diretor'];

const NAV_ITEMS = [
  { id:'inicio',       label:'Início'        },
  { id:'agenda',       label:'Agenda'        },
  { id:'atendimento',  label:'Atendimentos'  },
  { id:'receitas',     label:'Receitas'      },
  { id:'conversao',    label:'Conversão'     },
  { id:'noshow',       label:'No-Show'       },
  { id:'relatorios',   label:'Relatórios'    },
  { id:'usuarios',     label:'Usuários'      },
  { id:'lojas',        label:'Lojas'         },
  { id:'manual',       label:'Manual'        },
];

/* ── CSS global ── */
const GLOBAL_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Plus Jakarta Sans','Inter',sans-serif;-webkit-font-smoothing:antialiased;background:${C.bg};color:${C.text};font-size:14px}
button{cursor:pointer;border:none;outline:none;font-family:inherit}
input,select,textarea{font-family:inherit;outline:none}
input:disabled,textarea:disabled{background:#F5F5F5 !important;color:#5A5A5A;cursor:not-allowed}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:#f1f1f1}
::-webkit-scrollbar-thumb{background:#ccc;border-radius:3px}
.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.resp-grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.resp-grid-2{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
.resp-grid-main{display:grid;grid-template-columns:1fr 300px;gap:16px}
.nav-item{transition:all .15s;border-radius:12px}
.btn:not(:disabled):hover{filter:brightness(.92);box-shadow:0 2px 6px rgba(30,58,95,.18)}
.btn:disabled{cursor:default}
.cel-semana:hover{background:#F2F8F8 !important}
.btn-sec:not(:disabled):hover{filter:none;background:${C.tealBg} !important;border-color:${C.tealL} !important;box-shadow:none}
.nav-item:not(.ativo):hover{background:${C.teal}11 !important}
@media(max-width:767px){
  .resp-grid-4{grid-template-columns:1fr 1fr;gap:10px}
  .resp-grid-2{grid-template-columns:1fr}
  .resp-grid-main{grid-template-columns:1fr}
  .hide-mobile{display:none!important}
  .so-mobile{display:block!important}
}
.so-mobile{display:none}
`;

function useIsMobile(){ const [m,setM]=useState(window.innerWidth<768); useEffect(()=>{const h=()=>setM(window.innerWidth<768);window.addEventListener('resize',h);return()=>window.removeEventListener('resize',h)},[]);return m; }

/* ── primitives ── */
const Btn = ({children,onClick,color=C.teal,outline=false,size='md',style:sx={},...p}) => {
  const pad = size==='sm'?'6px 14px':size==='lg'?'12px 28px':'9px 20px';
  const fs = size==='sm'?'13px':'14px';
  // Principal: fundo cheio (turquesa) com texto branco. Secundário (outline): fundo branco, borda suave
  const sec = outline;
  const corTexto = sec ? ([C.teal, C.gray, C.orange].includes(color) ? C.navy : color) : C.white;
  return <button className={sec ? 'btn btn-sec' : 'btn'} onClick={onClick} style={{background:sec?C.white:color,color:corTexto,border:`1px solid ${sec?C.border:color}`,borderRadius:6,padding:pad,fontSize:fs,fontWeight:600,display:'inline-flex',alignItems:'center',justifyContent:'center',gap:8,transition:'filter .15s, box-shadow .15s, background .15s',opacity:p.disabled?.6:1,...sx}} {...p}>{children}</button>;
};
const Card = ({children,style:sx={}}) => <div style={{background:C.white,borderRadius:16,padding:20,boxShadow:'0 2px 8px rgba(0,0,0,.06)',...sx}}>{children}</div>;
const Badge = ({children,color=C.teal}) => <span style={{whiteSpace:'nowrap',background:color+'22',color,borderRadius:20,padding:'2px 10px',fontSize:12,fontWeight:600}}>{children}</span>;
// Regra da casa: tudo que é digitado vira MAIÚSCULO (o banco também garante). Cursor fica onde estava.
const maiusc = e => {
  const el = e.target; const up = String(el.value).toUpperCase();
  if (up !== el.value) { const a = el.selectionStart, b = el.selectionEnd; el.value = up; try { el.setSelectionRange(a, b); } catch {} }
  return e;
};
const TIPOS_TEXTO = [undefined, 'text', 'search', 'tel'];
const Input = ({label,style:sx={},livre,...p}) => {
  if (!livre && p.onChange && TIPOS_TEXTO.includes(p.type)) { const fn = p.onChange; p = { ...p, onChange: e => fn(maiusc(e)) }; }
  return <div style={{display:'flex',flexDirection:'column',gap:4,...sx}}>{label&&<label style={{fontSize:12,fontWeight:600,color:C.textSm}}>{label}</label>}<input style={{border:`1.5px solid ${sx['--borda']||C.border}`,borderRadius:8,padding:'8px 12px',fontSize:14,background:C.white}} {...p}/></div>;
};
// Seletor padrão do sistema: caixa com a lista de opções no estilo da marca (substitui o <select> nativo)
const Select = ({label,options=[],style:sx={},value,onChange,disabled}) => {
  const ops = options.map(o => typeof o === 'object' ? { value: String(o.value ?? ''), label: o.label ?? o.value } : { value: String(o), label: o });
  const atual = ops.find(o => o.value === String(value ?? ''));
  const [aberto, setAberto] = useState(false);
  const [foco, setFoco] = useState(-1);
  const [pos, setPos] = useState(null);
  const btn = useRef(null), lista = useRef(null);
  const abrir = () => {
    if (disabled) return;
    const r = btn.current.getBoundingClientRect();
    const alturaMax = 264, abaixo = window.innerHeight - r.bottom - 8;
    const paraCima = abaixo < Math.min(alturaMax, ops.length * 40 + 8) && r.top > abaixo;
    setPos({ left: r.left, width: Math.max(r.width, 180), top: paraCima ? undefined : r.bottom + 4,
      bottom: paraCima ? window.innerHeight - r.top + 4 : undefined, maxH: Math.min(alturaMax, paraCima ? r.top - 8 : abaixo) });
    setFoco(Math.max(0, ops.findIndex(o => o.value === String(value ?? ''))));
    setAberto(true);
  };
  const escolher = o => { setAberto(false); if (o && o.value !== String(value ?? '')) onChange?.({ target: { value: o.value } }); btn.current?.focus(); };
  useEffect(() => {
    if (!aberto) return;
    const fora = e => { if (!btn.current?.contains(e.target) && !lista.current?.contains(e.target)) setAberto(false); };
    const fechar = e => { if (!lista.current?.contains(e.target)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    window.addEventListener('scroll', fechar, true);
    window.addEventListener('resize', fechar);
    return () => { document.removeEventListener('mousedown', fora); window.removeEventListener('scroll', fechar, true); window.removeEventListener('resize', fechar); };
  }, [aberto]);
  useEffect(() => { if (aberto) lista.current?.children[foco]?.scrollIntoView({ block: 'nearest' }); }, [aberto, foco]);
  const tecla = e => {
    if (!aberto) { if (['ArrowDown','ArrowUp','Enter',' '].includes(e.key)) { e.preventDefault(); abrir(); } return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setFoco(f => Math.min(ops.length - 1, f + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFoco(f => Math.max(0, f - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); escolher(ops[foco]); }
    else if (e.key === 'Escape' || e.key === 'Tab') setAberto(false);
  };
  const vazio = !atual || atual.value === '';
  return (
    <div style={{display:'flex',flexDirection:'column',gap:4,...sx}}>
      {label && <label style={{fontSize:12,fontWeight:600,color:C.textSm}}>{label}</label>}
      <button type="button" ref={btn} className="seletor" onClick={() => aberto ? setAberto(false) : abrir()} onKeyDown={tecla} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={aberto}
        style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,minWidth:140,textAlign:'left',
          border:`1.5px solid ${aberto ? C.teal : C.border}`,borderRadius:8,padding:'8px 12px',fontSize:14,background:C.white,
          color: vazio && atual?.label?.match?.(/^(Selecionar|Selecione)/) ? C.gray : C.text, cursor: disabled ? 'default' : 'pointer',
          boxShadow: aberto ? `0 0 0 3px ${C.tealBg}` : 'none', opacity: disabled ? .6 : 1, transition:'border-color .15s, box-shadow .15s'}}>
        <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{atual ? atual.label : 'Selecionar'}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" style={{flexShrink:0,transform:aberto?'rotate(180deg)':'none',transition:'transform .15s'}}>
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke={C.gray} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      {aberto && pos && (
        <div ref={lista} role="listbox" className="seletor-lista"
          style={{position:'fixed',left:pos.left,top:pos.top,bottom:pos.bottom,minWidth:pos.width,maxHeight:pos.maxH,overflowY:'auto',zIndex:2000,
            background:C.white,border:`1px solid ${C.border}`,borderRadius:12,boxShadow:'0 8px 24px rgba(30,58,95,.14)',padding:4}}>
          {ops.map((o, k) => {
            const sel = o.value === String(value ?? '');
            return <div key={o.value + k} role="option" aria-selected={sel} onMouseEnter={() => setFoco(k)} onMouseDown={e => e.preventDefault()} onClick={() => escolher(o)}
              style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'8px 12px',borderRadius:8,fontSize:14,cursor:'pointer',
                background: k === foco ? C.tealBg : 'transparent', color: sel ? C.teal : C.text, fontWeight: sel ? 700 : 400, whiteSpace:'nowrap'}}>
              {o.label}
              {sel && <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 7.5 5.8 10 11 4.5" fill="none" stroke={C.teal} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </div>;
          })}
        </div>
      )}
    </div>
  );
};
const Modal = ({title,onClose,children,width=500}) => <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16}}><div style={{background:C.white,borderRadius:20,width:'100%',maxWidth:width,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 8px 32px rgba(0,0,0,.2)'}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'18px 24px',borderBottom:`1px solid ${C.border}`}}><h3 style={{fontSize:16,fontWeight:700,color:C.navy}}>{title}</h3><button onClick={onClose} style={{background:'none',fontSize:20,color:C.gray}}>×</button></div><div style={{padding:24}}>{children}</div></div></div>;
const Spinner = () => <div style={{display:'flex',justifyContent:'center',padding:40}}><div style={{width:32,height:32,border:`3px solid ${C.tealL}`,borderTopColor:C.teal,borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>;
const Toast = ({msg,type='success'}) => msg?<div style={{position:'fixed',bottom:24,right:24,background:type==='error'?C.danger:C.success,color:C.white,padding:'12px 20px',borderRadius:12,fontWeight:600,zIndex:9999,boxShadow:'0 4px 12px rgba(0,0,0,.2)'}}>{msg}</div>:null;

/* ══════════════════════════════════════════════════════
   LOGIN
══════════════════════════════════════════════════════ */
function Login({ onLogin }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setErr(''); setLoading(true);
    const r = await entrar(user, pass);
    setLoading(false);
    if (r.erro) { setErr(r.erro); return; }
    onLogin(r.usuario);
  };

  return (
    <div style={{minHeight:'100vh',display:'flex',background:C.bg}}>
      <style>{GLOBAL_CSS}</style>
      {/* Left panel */}
      <div className="hide-mobile" style={{width:420,background:C.gradiente,display:'flex',flexDirection:'column',justifyContent:'center',padding:56,color:C.white}}>
        <img src="/logo-visao-ideal.png" alt="Visão Ideal" style={{width:200,marginBottom:32,filter:'brightness(0) invert(1)'}}/>
        <div style={{fontSize:15,opacity:.8,marginBottom:40}}>Sistema de Gestão Clínica</div>
        {['Agenda inteligente por loja','Fluxo completo de atendimento','Controle de conversão e no-show','Relatórios e indicadores em tempo real'].map(t=>(
          <div key={t} style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,fontSize:14,opacity:.9}}>
            <span style={{width:8,height:8,borderRadius:'50%',background:'rgba(255,255,255,.85)',flexShrink:0}}/>
            {t}
          </div>
        ))}
      </div>
      {/* Right form */}
      <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
        <div style={{width:'100%',maxWidth:380}}>
          <img src="/logo-visao-ideal.png" alt="Visão Ideal" className="so-mobile" style={{width:160,margin:'0 auto 32px'}}/>
          <h2 style={{fontSize:24,fontWeight:800,color:C.navy,marginBottom:6}}>Entrar</h2>
          <p style={{color:C.gray,fontSize:14,marginBottom:32}}>Acesse o sistema com suas credenciais</p>
          <Input label="Usuário" value={user} onChange={e=>setUser(e.target.value)} placeholder="Seu nome de usuário" style={{marginBottom:16}}/>
          <Input label="Senha" type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••" onKeyDown={e=>e.key==='Enter'&&handleLogin()} style={{marginBottom:8}}/>
          {err && <p style={{color:C.danger,fontSize:13,marginBottom:12}}>{err}</p>}
          <Btn onClick={handleLogin} color={C.teal} style={{width:'100%',marginTop:16,padding:'12px'}} disabled={loading}>
            {loading ? 'Entrando...' : 'Entrar'}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   LAYOUT
══════════════════════════════════════════════════════ */
function Layout({ user, tab, setTab, onLogout, selectedUnidade, setSelectedUnidade, children }) {
  const isMobile = useIsMobile();
  const [drawer, setDrawer] = useState(false);
  const navItems = NAV_ITEMS.filter(n => PERFIS[user.perfil]?.nav.includes(n.id));
  const perfil = PERFIS[user.perfil];

  const podeVerTodasUnidades = ['diretor','supervisor','prevenda'].includes(user.perfil);
  // Seletor de loja no mesmo padrão das listas do sistema (só para quem vê todas as unidades)
  const unidadeFilter = () => !podeVerTodasUnidades ? null : (
    <Select value={selectedUnidade} onChange={e=>setSelectedUnidade(e.target.value)} style={{minWidth:200}}
      options={[{value:'',label:'Todas as unidades'},...UNIDADES.map(u=>({value:u,label:u}))]}/>
  );

  const SideNav = ({ onItemClick }) => (
    <nav style={{display:'flex',flexDirection:'column',gap:1,padding:'8px 0'}}>
      {navItems.map(n => {
        const active = tab===n.id;
        return (
          <button key={n.id} onClick={()=>{setTab(n.id);onItemClick&&onItemClick();}}
            className={active ? 'nav-item ativo' : 'nav-item'}
            style={{display:'flex',alignItems:'center',gap:10,padding:'10px 16px',borderRadius:12,margin:'0 8px',
              background:active?C.teal:'transparent',color:active?C.white:C.text,
              fontWeight:active?700:500,fontSize:13.5,border:'none',cursor:'pointer',textAlign:'left',position:'relative'}}>
            {n.label}
          </button>
        );
      })}
      <div style={{borderTop:`1px solid ${C.border}`,margin:'8px 16px',paddingTop:8}}>
        <button onClick={onLogout}
          className="nav-item"
          style={{display:'flex',alignItems:'center',gap:10,padding:'10px 8px',color:C.danger,background:'none',border:'none',cursor:'pointer',fontSize:13.5,width:'100%'}}>
          Sair
        </button>
      </div>
    </nav>
  );

  if (isMobile) return (
    <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',background:C.bg}}>
      <style>{GLOBAL_CSS}</style>
      {/* Mobile header */}
      <div style={{position:'fixed',top:0,left:0,right:0,background:C.white,borderBottom:`1px solid ${C.border}`,zIndex:200}}>
      <div style={{height:52,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 16px'}}>
        <button onClick={()=>setDrawer(true)} style={{background:'none',fontSize:22,color:C.navy,border:'none',fontWeight:700}}>&#9776;</button>
        <img src="/logo-visao-ideal.png" alt="Visão Ideal" style={{height:36,objectFit:'contain'}}/>
        <Badge color={perfil?.cor||C.teal}>{perfil?.label}</Badge>
      </div>
      {podeVerTodasUnidades && (
      <div style={{padding:'6px 12px 8px',overflowX:'auto',display:'flex',gap:6,borderTop:`1px solid ${C.border}11`}}>
        {unidadeFilter()}
      </div>
      )}
      </div>
      {/* Drawer */}
      {drawer && <>
        <div onClick={()=>setDrawer(false)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:300}}/>
        <div style={{position:'fixed',top:0,left:0,bottom:0,width:260,background:C.white,zIndex:400,overflowY:'auto',boxShadow:'4px 0 16px rgba(0,0,0,.1)'}}>
          <div style={{padding:'16px',background:C.gradiente,color:C.white,display:'flex',flexDirection:'column',alignItems:'center',gap:8}}>
            <img src="/logo-visao-ideal.png" alt="Visão Ideal" style={{width:120,filter:'brightness(0) invert(1)'}}/>
            <div style={{fontSize:12,opacity:.8}}>{user.nome} · {perfil?.label}</div>
          </div>
          <SideNav onItemClick={()=>setDrawer(false)}/>
        </div>
      </>}
      {/* Content */}
      <div style={{flex:1,minWidth:0,marginTop:podeVerTodasUnidades?88:52,padding:'16px 12px 80px'}}>
        {children}
      </div>
      {/* Bottom nav */}
      <div style={{position:'fixed',bottom:0,left:0,right:0,background:C.white,borderTop:`1px solid ${C.border}`,display:'flex',justifyContent:'space-around',padding:'6px 0',zIndex:200}}>
        {navItems.slice(0,5).map(n=>(
          <button key={n.id} onClick={()=>setTab(n.id)} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2,background:'none',border:'none',cursor:'pointer',padding:'4px 8px',color:tab===n.id?C.teal:C.gray}}>
            <span style={{fontSize:10,fontWeight:tab===n.id?700:400}}>{n.label}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const sideW = 220;
  // Altura do cabeçalho (linha principal + barra de unidade) — o bloco da logo acompanha a mesma linha
  const TOPO_H = 64;
  // Cabeçalho único para todos os perfis (o seletor de loja fica na mesma linha, à direita)
  const alturaTopo = TOPO_H + 1;
  const currentNav = NAV_ITEMS.find(n=>n.id===tab);

  return (
    <div style={{minHeight:'100vh',display:'flex',background:C.bg}}>
      <style>{GLOBAL_CSS}</style>
      {/* Sidebar */}
      <div style={{width:sideW,background:C.white,borderRight:`1px solid ${C.border}`,position:'fixed',top:0,left:0,bottom:0,overflowY:'auto',display:'flex',flexDirection:'column',boxShadow:'2px 0 8px rgba(0,0,0,.04)'}}>
        <div style={{height:alturaTopo,boxSizing:'border-box',flexShrink:0,background:C.white,borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'center',padding:'8px 16px'}}>
          <img src="/logo-visao-ideal.png" alt="Visão Ideal" style={{height:'100%',maxHeight:48,width:'auto',objectFit:'contain'}}/>
        </div>
        <div style={{flex:1,overflowY:'auto',paddingTop:6}}><SideNav/></div>
        <div style={{padding:'14px 16px',borderTop:`1px solid ${C.border}`,background:C.bg}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:34,height:34,borderRadius:'50%',background:C.gradiente,display:'flex',alignItems:'center',justifyContent:'center',color:C.white,fontWeight:700,fontSize:13,flexShrink:0}}>
              {user.nome?.charAt(0)?.toUpperCase()}
            </div>
            <div style={{minWidth:0}}>
              <div style={{fontWeight:700,color:C.navy,fontSize:12,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{user.nome}</div>
              <div style={{fontSize:10,color:C.gray,fontWeight:600,marginTop:1}}>{perfil?.label}</div>
              {user.unidade && <div style={{color:C.gray,fontSize:10,marginTop:1}}>{user.unidade}</div>}
            </div>
          </div>
        </div>
      </div>
      {/* Main */}
      <div style={{marginLeft:sideW,flex:1,minWidth:0,display:'flex',flexDirection:'column',minHeight:'100vh'}}>
        <div style={{background:C.white,borderBottom:`1px solid ${C.border}`,position:'sticky',top:0,zIndex:100,boxShadow:'0 2px 8px rgba(0,0,0,.04)'}}>
          <div style={{height:TOPO_H,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 28px'}}>
            <div>
              <div style={{fontSize:11,color:C.gray,fontWeight:600,letterSpacing:'0.5px',textTransform:'uppercase',marginBottom:1}}>
                {currentNav?.label}
              </div>
              <div style={{fontSize:13,fontWeight:600,color:C.navy}}>
                {(() => { const d = new Date(today()+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long'}); return d.charAt(0).toUpperCase()+d.slice(1); })()}, {fmtDate(today())}
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <Badge color={perfil?.cor||C.teal}>{perfil?.label}</Badge>
              {podeVerTodasUnidades ? unidadeFilter() : user.unidade && <span style={{fontSize:12,color:C.gray}}>{user.unidade}</span>}
            </div>
          </div>
        </div>
        <div style={{flex:1,padding:28,maxWidth:1300,minWidth:0}}>{children}</div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════════════ */
// Período do painel: hoje, semana (seg–dom), mês ou personalizado → { de, ate } em YYYY-MM-DD
/* ── Jornada do paciente: agendado → compareceu/não → comprou/não comprou ── */
// Liga cada agendamento à receita e à conversão (a conversão vem do PDV ou da pré-venda)
async function anexarCompras(rows) {
  const ids = (rows||[]).filter(a=>a.status==='Compareceu').map(a=>a.id);
  if (!ids.length) return rows||[];
  // receita + conversões numa única ida ao banco
  const { data: recs } = await supabase.from('receitas').select('id,agenda_id,conversoes(converteu,valor_venda)').in('agenda_id', ids);
  const porAgenda = {};
  (recs||[]).forEach(r => (r.conversoes||[]).forEach(c => { if (!porAgenda[r.agenda_id] || c.converteu) porAgenda[r.agenda_id] = c; }));
  return rows.map(a => a.status==='Compareceu' ? { ...a, _compra: porAgenda[a.id] || null } : a);
}
const jornada = a => {
  if (a.status === 'Compareceu') return a._compra?.converteu ? { label:'Comprou', cor:C.success, valor:a._compra.valor_venda } : { label:'Não comprou', cor:C.orange };
  if (a.status === 'Não Compareceu') return { label:'Não compareceu', cor:C.danger };
  if (a.status === 'Cancelado') return { label:'Cancelado', cor:C.gray };
  return { label:'Agendado', cor:C.teal };
};
const StatusJornada = ({ a }) => {
  const j = jornada(a);
  return <span style={{display:'inline-flex',flexDirection:'column',gap:2}}>
    <Badge color={j.cor}>{j.label}</Badge>
    {j.valor > 0 && <span style={{fontSize:11,color:C.gray,paddingLeft:10}}>{fmtMoney(j.valor)}</span>}
  </span>;
};

const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const periodoDatas = (tipo, de, ate) => {
  const h = new Date(); h.setHours(12,0,0,0);
  if (tipo === 'semana') {
    const ini = new Date(h); ini.setDate(h.getDate() - ((h.getDay() + 6) % 7));
    const fim = new Date(ini); fim.setDate(ini.getDate() + 6);
    return { de: ymd(ini), ate: ymd(fim) };
  }
  if (tipo === 'mes') return { de: ymd(new Date(h.getFullYear(), h.getMonth(), 1)), ate: ymd(new Date(h.getFullYear(), h.getMonth()+1, 0)) };
  if (tipo === 'personalizado') return { de: de || today(), ate: ate || de || today() };
  return { de: today(), ate: today() };
};

function Dashboard({ user, selectedUnidade='' }) {
  const [stats, setStats] = useState({ agendados:0, compareceu:0, naoComp:0, receitas:0, conversoes:0, valorTotal:0, noshow:0 });
  const [loading, setLoading] = useState(true);
  const [proximos, setProximos] = useState([]);
  const [periodo, setPeriodo] = useState('hoje');
  const [custom, setCustom] = useState({ de: today(), ate: today() });
  const [dia, setDia] = useState(today());
  const { de, ate } = periodo === 'dia' ? { de: dia, ate: dia } : periodoDatas(periodo, custom.de, custom.ate);
  const textoPeriodo = de === ate ? fmtDate(de) : `${fmtDate(de)} a ${fmtDate(ate)}`;

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const applyU = q => selectedUnidade ? q.eq('unidade', selectedUnidade) : q;
      const noPeriodo = q => q.gte('data', de).lte('data', ate);
      const [ag, rec, conv, prox] = await Promise.all([
        applyU(noPeriodo(supabase.from('agenda').select('status'))),
        applyU(noPeriodo(supabase.from('receitas').select('id'))),
        applyU(noPeriodo(supabase.from('conversoes').select('converteu,valor_venda'))),
        // Próximas: sempre a partir de agora (independe do período), mais cedo primeiro
        applyU(supabase.from('agenda').select('*').eq('status','Agendado')
          .gte('data', today()).order('data').order('hora').limit(40)),
      ]);
      const agenda = (ag.data || []).filter(a => a.status !== 'Cancelado');
      const cvs = conv.data || [];
      const totalConv = cvs.filter(c=>c.converteu).length;
      const valorTotal = cvs.filter(c=>c.converteu).reduce((s,c)=>s+Number(c.valor_venda||0),0);
      const naoComp = agenda.filter(a=>a.status==='Não Compareceu').length;
      const total = agenda.length || 1;
      setStats({
        agendados: agenda.length,
        compareceu: agenda.filter(a=>a.status==='Compareceu').length,
        naoComp,
        receitas: (rec.data||[]).length,
        conversoes: totalConv,
        valorTotal,
        noshow: Math.round((naoComp/total)*100),
        taxaConv: cvs.length ? Math.round((totalConv/cvs.length)*100) : 0,
      });
      const agora = new Date(); const hhmm = `${String(agora.getHours()).padStart(2,'0')}:${String(agora.getMinutes()).padStart(2,'0')}`;
      setProximos((prox.data||[]).filter(a => a.data > today() || String(a.hora||'').slice(0,5) >= hhmm).slice(0,10));
      setLoading(false);
    };
    load();
  }, [selectedUnidade, de, ate]);

  const KPI = ({label, value, sub}) => (
    <Card style={{padding:'20px 18px'}}>
      <div style={{fontSize:28,fontWeight:800,color:C.navy,lineHeight:1}}>{value}</div>
      <div style={{fontSize:12,fontWeight:600,color:C.navy,marginTop:4}}>{label}</div>
      {sub && <div style={{fontSize:10,color:C.gray,marginTop:2}}>{sub}</div>}
    </Card>
  );

  const verComercial = PERFIS_COMERCIAL.includes(user.perfil);

  const PERIODOS = [['hoje','Hoje'],['semana','Semana'],['mes','Mês'],['personalizado','Personalizado']];
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',gap:16,flexWrap:'wrap',marginBottom:20}}>
        <div>
          <h2 style={{fontSize:22,fontWeight:800,color:C.navy}}>Visão Geral</h2>
          <p style={{color:C.gray,fontSize:13,marginTop:2}}>{periodo === 'dia' ? 'Data específica' : PERIODOS.find(p=>p[0]===periodo)[1]} · {textoPeriodo}</p>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'flex-end'}}>
          {periodo === 'personalizado' && <>
            <Input label="De" type="date" value={custom.de} onChange={e=>setCustom(c=>({...c,de:e.target.value, ate: c.ate < e.target.value ? e.target.value : c.ate}))}/>
            <Input label="Até" type="date" value={custom.ate} min={custom.de} onChange={e=>setCustom(c=>({...c,ate:e.target.value}))}/>
          </>}
          {/* Seletor de data separado: escolhe um dia específico direto */}
          <Input label="Data" type="date" value={periodo === 'dia' ? dia : ''}
            onChange={e=>{ if (e.target.value) { setDia(e.target.value); setPeriodo('dia'); } }}/>
          <div style={{display:'flex',gap:6}}>
            {PERIODOS.map(([id,label])=>{
              const ativo = periodo === id;
              return <button key={id} onClick={()=>setPeriodo(id)}
                style={{padding:'8px 14px',borderRadius:999,fontSize:13,fontWeight:600,cursor:'pointer',
                  border:`1.5px solid ${ativo?C.teal:C.border}`,background:ativo?C.teal:C.white,color:ativo?C.white:C.textSm}}>{label}</button>;
            })}
          </div>
        </div>
      </div>
      {loading ? <Spinner/> : <>
      <div className="resp-grid-4" style={{marginBottom:24}}>
        <KPI label="Agendados" value={stats.agendados}/>
        <KPI label="Compareceram" value={stats.compareceu}/>
        <KPI label="Não Compareceram" value={stats.naoComp}/>
        <KPI label="Receitas" value={stats.receitas}/>
        {verComercial && <KPI label="Conversões" value={stats.conversoes}/>}
        {verComercial && <KPI label="Faturamento" value={fmtMoney(stats.valorTotal)}/>}
        {verComercial && <KPI label="Taxa No-Show" value={`${stats.noshow}%`}/>}
        {verComercial && <KPI label="Taxa Conversão" value={`${stats.taxaConv||0}%`}/>}
      </div>
      <Card style={{padding:24}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
          <h3 style={{fontSize:15,fontWeight:700,color:C.navy}}>Próximas Consultas</h3>
        </div>
        {proximos.length === 0 ? <p style={{color:C.gray,textAlign:'center',padding:20}}>Nenhum agendamento encontrado</p> : (
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead>
                <tr style={{background:C.teal,color:C.white}}>
                  {['Data','Hora','Paciente','Unidade','Optometrista','Procedimento'].map(h=>(
                    <th key={h} style={{padding:'8px 12px',textAlign:'left'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {proximos.map((a,i)=>(
                  <tr key={a.id} style={{background:i%2===0?C.white:C.bg}}>
                    <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>{a.data === today() ? 'Hoje' : fmtDate(a.data)}</td>
                    <td style={{padding:'8px 12px',fontWeight:700,color:C.text}}>{String(a.hora||'').slice(0,5)}</td>
                    <td style={{padding:'8px 12px'}}>{a.paciente_nome}</td>
                    <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>{a.unidade}</td>
                    <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>{a.opto_nome}</td>
                    <td style={{padding:'8px 12px'}}>{a.procedimento}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      </>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   AGENDA
══════════════════════════════════════════════════════ */
function Agenda({ user, selectedUnidade='' }) {
  const [slots, setSlots] = useState([]);
  const [optos, setOptos] = useState([]);
  const [selOpto, setSelOpto] = useState('');
  const per = usePeriodo('hoje');
  // Setas de navegação no Hoje (dia a dia), na Semana (grade seg a sáb) e no Mês
  const [semOff, setSemOff] = useState(0);
  useEffect(() => { setSemOff(0); }, [per.periodo]);
  const modoSemana = per.periodo === 'semana';
  const navegavel = ['hoje','semana','mes'].includes(per.periodo);
  const { de: dataDe, ate: dataAte } = (() => {
    if (!navegavel || !semOff) return per;
    const base = new Date(per.de + 'T12:00:00');
    if (per.periodo === 'hoje') { base.setDate(base.getDate() + semOff); return { de: ymd(base), ate: ymd(base) }; }
    if (per.periodo === 'semana') { base.setDate(base.getDate() + semOff * 7); const fim = new Date(base); fim.setDate(base.getDate() + 6); return { de: ymd(base), ate: ymd(fim) }; }
    const ini = new Date(base.getFullYear(), base.getMonth() + semOff, 1, 12), fim = new Date(base.getFullYear(), base.getMonth() + semOff + 1, 0, 12);
    return { de: ymd(ini), ate: ymd(fim) };
  })();
  const NAV_TXT = { hoje:['Dia anterior','Hoje','Próximo dia'], semana:['Semana anterior','Esta semana','Próxima semana'], mes:['Mês anterior','Este mês','Próximo mês'] }[per.periodo] || [];
  const umDia = dataDe === dataAte;
  const selData = dataDe;
  const [modal, setModal] = useState(null); // null | { hora, existing }
  const [pacientes, setPacientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  useEffect(() => {
    // Optometristas ativos (cada loja tem o seu); usado para preencher o opto do agendamento
    listarUsuarios().then(todos => setOptos(todos.filter(u => u.perfil === 'opto' && u.ativo)));
    supabase.from('pacientes').select('*').order('nome').then(({data})=>setPacientes(data||[]));
  }, []);

  const loadSlots = useCallback(async () => {
    // Todos os perfis: busca agendamentos por unidade (inclui IA e todos os optos da loja)
    const unidade = user.unidade || selectedUnidade;
    let q = supabase.from('agenda').select('*').gte('data', dataDe).lte('data', dataAte).neq('status', 'Cancelado');
    if (unidade) q = q.eq('unidade', unidade);
    const { data: res } = await q;
    return anexarCompras((res||[]).sort((a,b) => (a.data + a.hora).localeCompare(b.data + b.hora)));
  }, [user, selectedUnidade, dataDe, dataAte]);

  useEffect(() => {
    setLoading(true);
    loadSlots().then(data => { setSlots(data||[]); setLoading(false); });
  }, [loadSlots]);

  // Realtime: atualiza slots automaticamente
  useRealtime('agenda', () => { loadSlots().then(data => setSlots(data||[])); });

  // "Não Compareceu" automático roda no servidor (pg_cron, a cada 5 min)

  const getSlot = hora => slots.find(s=>s.hora===hora);

  const handleSave = async (form) => {
    const pac = pacientes.find(p=>p.id===form.pacienteId)||{nome:form.pacienteNome};
    // Loja do agendamento: a do usuário, a do filtro global ou a escolhida no formulário
    const unidadeAlvo = user.unidade || selectedUnidade || form.unidade || modal?.existing?.unidade || '';
    if (!unidadeAlvo) { alert('Selecione a unidade do agendamento.'); return; }
    // Opto do agendamento: quem está logado (se for opto) ou o opto ativo da loja
    const opto = user.perfil === 'opto' ? user : optos.find(o => o.unidade === unidadeAlvo);
    const horaFinal = form.hora || modal?.hora;
    const dataFinal = form.data || modal?.data || selData;
    const rowData = {
      paciente_id: form.pacienteId||null,
      paciente_nome: pac?.nome||form.pacienteNome,
      paciente_telefone: form.telefone||'',
      opto_id: opto?.id || null,
      opto_nome: opto?.nome || '',
      data: dataFinal,
      hora: horaFinal,
      procedimento: form.procedimento,
      meio_contato: form.meioContato,
      status: 'Agendado',
      observacoes: form.obs||'',
      // mantém "IA" e quem agendou originalmente ao editar
      agendado_por: modal?.existing?.agendado_por || user?.nome || '',
      unidade: unidadeAlvo
    };
    let err;
    if (modal.existing) {
      // Editar existente (se for da IA e mudou dia/hora, a sincronização move o evento no Google)
      const ex = modal.existing;
      const mudouHorario = ex.data !== rowData.data || ex.hora !== rowData.hora;
      const extra = ex.google_event_id && mudouHorario ? { google_sync_pendente: true } : {};
      const { error } = await supabase.from('agenda').update({ ...rowData, ...extra }).eq('id', ex.id);
      err = error;
    } else {
      // Novo agendamento manual: verifica se existe slot da IA *vazio* (sem paciente) nesse horário
      const slotIAVazio = slots.find(s =>
        s.data === dataFinal && s.hora === horaFinal &&
        (s.agendado_por === 'IA' || !s.opto_id) &&
        !s.paciente_id && !s.paciente_nome
      );
      if (slotIAVazio) {
        // Aproveita o slot da IA vazio preenchendo com os dados manuais
        const { error } = await supabase.from('agenda').update(rowData).eq('id', slotIAVazio.id);
        err = error;
      } else {
        // Slot da IA já preenchido ou não existe — cria novo registro
        const { error } = await supabase.from('agenda').insert({ id: uid(), ...rowData });
        err = error;
      }
    }
    if (err) { alert('Erro ao salvar agendamento: ' + err.message); return; }
    loadSlots().then(data => setSlots(data||[]));
    setModal(null);
    showToast('Agendamento salvo!');
  };

  // Tabela da agenda: células e botões de ação com o mesmo tamanho e alinhamento
  const celAg = { padding:'10px 16px', verticalAlign:'middle', height:52 };
  const btnAcao = { width:112, padding:'7px 0', textAlign:'center' };
  const acoesAg = { display:'flex', gap:8, justifyContent:'flex-end', alignItems:'center' };
  const unidadeFixa = user.unidade || selectedUnidade;

  const handleDelete = async (id) => {
    const item = slots.find(x => x.id === id);
    const { error } = item?.google_event_id
      ? await supabase.from('agenda').update({ status: 'Cancelado' }).eq('id', id)
      : await supabase.from('agenda').delete().eq('id', id);
    if (error) { alert('Erro ao remover: ' + error.message); return; }
    setSlots(s=>s.filter(x=>x.id!==id));
    setModal(null);
    showToast('Agendamento removido.');
  };

  return (
    <div>
      <Toast msg={toast}/>
      <TopoTela titulo="Agenda" subtitulo={`${textoPeriodo(dataDe, dataAte)} · ${slots.length} agendamento(s)`}>
        <FiltroPeriodo p={per}/>
      </TopoTela>
      <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'flex-end',marginBottom:20}}>
        <Btn onClick={()=>setModal({hora:HORARIOS[0], data: dataDe < today() ? today() : dataDe})} color={C.teal}>+ Novo Agendamento</Btn>
        {navegavel && <div style={{display:'flex',alignItems:'center',gap:6,marginLeft:'auto'}}>
          <Btn outline size="sm" onClick={()=>setSemOff(o=>o-1)} aria-label={NAV_TXT[0]} title={NAV_TXT[0]}>‹</Btn>
          <Btn outline size="sm" onClick={()=>setSemOff(0)} disabled={semOff===0}>{NAV_TXT[1]}</Btn>
          <Btn outline size="sm" onClick={()=>setSemOff(o=>o+1)} aria-label={NAV_TXT[2]} title={NAV_TXT[2]}>›</Btn>
        </div>}
        {!umDia && !modoSemana && per.periodo !== 'mes' && <span style={{fontSize:12,color:C.gray}}>Para ver a grade de horários, escolha "Hoje", "Semana" ou um único dia em "Personalizado".</span>}
      </div>
      {loading ? <Spinner/> : modoSemana ? (
        <GradeSemana de={dataDe} slots={slots} mostrarLoja={!unidadeFixa}
          onAbrir={slot=>setModal({hora:slot.hora,existing:slot})}
          onNovo={(data,hora)=>setModal({hora,data})}/>
      ) : !umDia ? (
        <Card>
          {slots.length === 0 && <p style={{textAlign:'center',color:C.gray,padding:20}}>Nenhum agendamento no período</p>}
          {slots.length > 0 && <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead>
                <tr style={{background:C.teal,color:C.white}}>
                  {[['Horário',90],['Paciente',null],['Procedimento',150],['Contato',130],['Status',170],['',264]].map(([h,w])=>(
                    <th key={h} style={{padding:'10px 16px',textAlign:'left',width:w||undefined}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...new Set(slots.map(x=>x.data))].map(dia => {
                  const doDia = slots.filter(x=>x.data===dia);
                  const r0 = new Date(dia+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'2-digit'}); const rotulo = r0.charAt(0).toUpperCase() + r0.slice(1);
                  return [
                    <tr key={'h'+dia}><td colSpan={6} style={{padding:'14px 16px 8px',background:C.tealBg,fontWeight:700,color:C.navy}}>
                      {rotulo} <span style={{fontWeight:500,color:C.gray}}>· {doDia.length} agendamento(s)</span>
                    </td></tr>,
                    ...doDia.map((slot,i)=>(
                      <tr key={slot.id} style={{background:i%2===0?C.white:C.bg,borderBottom:`1px solid ${C.border}`}}>
                        <td style={{...celAg,fontWeight:700,color:C.text,whiteSpace:'nowrap'}}>{slot.hora}</td>
                        <td style={celAg}>
                          <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                            <span>{slot.paciente_nome}</span>
                            {slot.agendado_por==='IA' && <span style={{fontSize:10,fontWeight:700,background:C.orangeBg,color:C.orange,borderRadius:4,padding:'2px 6px'}}>IA</span>}
                            {!unidadeFixa && slot.unidade && <span style={{fontSize:11,color:C.gray}}>{slot.unidade}</span>}
                          </div>
                        </td>
                        <td style={celAg}>{slot.procedimento||''}</td>
                        <td style={celAg}>{slot.meio_contato||''}</td>
                        <td style={celAg}><StatusJornada a={slot}/></td>
                        <td style={celAg}>
                          <div style={acoesAg}>
                            <Btn outline size="sm" color={C.teal} style={btnAcao} onClick={()=>setModal({hora:slot.hora,existing:slot})}>Editar</Btn>
                            <Btn outline size="sm" color={C.teal} style={btnAcao} onClick={()=>setModal({hora:slot.hora, data:dia})}>+ Agendar</Btn>
                          </div>
                        </td>
                      </tr>
                    )),
                  ];
                })}
              </tbody>
            </table>
          </div>}
        </Card>
      ) : (
        <Card>
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead>
                <tr style={{background:C.teal,color:C.white}}>
                  {[['Horário',90],['Paciente',null],['Procedimento',150],['Contato',130],['Status',170],['',264]].map(([h,w])=>(
                    <th key={h} style={{padding:'10px 16px',textAlign:'left',width:w||undefined}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...new Set([...HORARIOS, ...slots.map(s => s.hora).filter(Boolean)])].sort().map((hora,i) => {
                  const horaSlots = slots.filter(s => s.hora === hora);
                  if (horaSlots.length === 0) {
                    return (
                      <tr key={hora} style={{background:i%2===0?C.white:C.bg,borderBottom:`1px solid ${C.border}`}}>
                        <td style={{...celAg,fontWeight:700,color:C.text,whiteSpace:'nowrap'}}>{hora}</td>
                        <td style={celAg}><span style={{color:C.border}}>—</span></td>
                        <td style={celAg}></td>
                        <td style={celAg}></td>
                        <td style={celAg}></td>
                        <td style={celAg}>
                          <div style={acoesAg}>
                            <span style={{width:btnAcao.width}}/>
                            <Btn outline size="sm" color={C.teal} style={btnAcao} onClick={()=>setModal({hora, data:dataDe})}>+ Agendar</Btn>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  return [
                    ...horaSlots.map((slot, si) => {
                      return (
                      <tr key={slot.id} style={{background:i%2===0?C.white:C.bg,borderBottom:`1px solid ${C.border}`}}>
                        <td style={{...celAg,fontWeight:700,color:C.text,whiteSpace:'nowrap'}}>{si===0?hora:''}</td>
                        <td style={celAg}>
                          <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                            <span>{slot.paciente_nome}</span>
                            {slot.agendado_por==='IA' && <span style={{fontSize:10,fontWeight:700,background:C.orangeBg,color:C.orange,borderRadius:4,padding:'2px 6px'}}>IA</span>}
                            {!unidadeFixa && slot.unidade && <span style={{fontSize:11,color:C.gray}}>{slot.unidade}</span>}
                          </div>
                        </td>
                        <td style={celAg}>{slot.procedimento||''}</td>
                        <td style={celAg}>{slot.meio_contato||''}</td>
                        <td style={celAg}><StatusJornada a={slot}/></td>
                        <td style={celAg}>
                          <div style={acoesAg}>
                            <Btn outline size="sm" color={C.teal} style={btnAcao} onClick={()=>setModal({hora,existing:slot})}>Editar</Btn>
                            <Btn outline size="sm" color={C.teal} style={btnAcao} onClick={()=>setModal({hora, data:dataDe})}>+ Agendar</Btn>
                          </div>
                        </td>
                      </tr>
                      );
                    }),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {modal && <AgendaModal hora={modal.hora} data={modal.data} existing={modal.existing} encaixe={modal.encaixe} pacientes={pacientes} optos={optos}
        pedirUnidade={!(user.unidade || selectedUnidade)}
        onSave={handleSave} onDelete={handleDelete} onClose={()=>setModal(null)}/>}
    </div>
  );
}

/* Grade semanal: colunas de segunda a sábado (domingo só aparece se tiver agendamento), linhas de 30 em 30 min */
const DIAS_SEMANA = ['DOM','SEG','TER','QUA','QUI','SEX','SÁB'];
const corJornada = a => {
  const j = jornada(a);
  return { Comprou:['#E7F4EC','#1E7A3C'], 'Não comprou':['#FFF1E2','#9A5200'], 'Não compareceu':['#FDECEE','#B02A37'], Cancelado:['#F0F0EE','#5A5A5A'] }[j.label] || ['#E6F2F4','#1F5F70'];
};
function GradeSemana({ de, slots, mostrarLoja, onAbrir, onNovo }) {
  const dias = Array.from({length:7},(_,i)=>{ const d=new Date(de+'T12:00:00'); d.setDate(d.getDate()+i); return ymd(d); });
  const visiveis = dias.filter((d,i) => i < 6 || slots.some(s=>s.data===d));
  const meia = h => { const [hh,mm] = String(h||'').slice(0,5).split(':').map(Number); return `${pad(hh)}:${mm<30?'00':'30'}`; };
  const linhas = [];
  const horas = slots.map(s=>meia(s.hora)).filter(h=>/^\d\d:\d\d$/.test(h));
  const ini = horas.reduce((m,h)=>h<m?h:m,'08:00'), fim = horas.reduce((m,h)=>h>m?h:m,'18:30');
  for (let t = Number(ini.slice(0,2))*60+Number(ini.slice(3)); t <= Number(fim.slice(0,2))*60+Number(fim.slice(3)); t += 30) linhas.push(`${pad(Math.floor(t/60))}:${pad(t%60)}`);
  const hoje = today();
  return (
    <Card style={{padding:0,overflow:'hidden'}}>
      <div className="tbl-wrap">
        <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed',minWidth:760}}>
          <colgroup><col style={{width:64}}/>{visiveis.map(d=><col key={d}/>)}</colgroup>
          <thead>
            <tr>
              <th style={{background:C.bg,borderBottom:`1px solid ${C.border}`}}/>
              {visiveis.map(d=>{
                const dt = new Date(d+'T12:00:00'); const n = slots.filter(s=>s.data===d).length;
                return <th key={d} style={{padding:'12px 8px',background:d===hoje?C.tealBg:C.bg,borderBottom:`1px solid ${C.border}`,borderLeft:`1px solid ${C.border}`,textAlign:'center'}}>
                  <div style={{fontSize:12,fontWeight:700,color:d===hoje?C.teal:C.textSm,letterSpacing:.5}}>{DIAS_SEMANA[dt.getDay()]} {pad(dt.getDate())}/{pad(dt.getMonth()+1)}</div>
                  <div style={{fontSize:11,color:C.gray,fontWeight:500,marginTop:2}}>{n} agend.</div>
                </th>;
              })}
            </tr>
          </thead>
          <tbody>
            {linhas.map(h=>(
              <tr key={h}>
                <td style={{padding:'6px 8px',fontSize:12,fontWeight:600,color:C.textSm,verticalAlign:'top',textAlign:'right',borderTop:`1px solid ${C.grayL}`}}>{h}</td>
                {visiveis.map(d=>{
                  const doSlot = slots.filter(s=>s.data===d && meia(s.hora)===h);
                  const passado = d < hoje;
                  return (
                    <td key={d} className="cel-semana" onClick={()=>{ if (!doSlot.length && !passado) onNovo(d, h); }}
                      title={!doSlot.length && !passado ? `Agendar ${fmtDate(d)} às ${h}` : undefined}
                      style={{verticalAlign:'top',padding:4,height:48,borderTop:`1px solid ${C.grayL}`,borderLeft:`1px solid ${C.border}`,
                        background:d===hoje?'#F7FBFB':C.white,cursor:!doSlot.length&&!passado?'pointer':'default'}}>
                      <div style={{display:'flex',flexDirection:'column',gap:4}}>
                        {doSlot.map(a=>{
                          const [bg,fg] = corJornada(a);
                          return (
                            <button key={a.id} onClick={e=>{e.stopPropagation(); onAbrir(a);}} title={`${a.hora} · ${a.paciente_nome} · ${jornada(a).label}`}
                              style={{display:'block',width:'100%',textAlign:'left',background:bg,color:fg,borderLeft:`3px solid ${fg}`,borderRadius:6,padding:'4px 6px',fontSize:12,lineHeight:1.3,cursor:'pointer'}}>
                              <div style={{fontWeight:700}}>{String(a.hora).slice(0,5)}{a.agendado_por==='IA' && <span style={{marginLeft:6,fontSize:10,opacity:.8}}>IA</span>}</div>
                              <div style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',color:C.text}}>{a.paciente_nome}</div>
                              {mostrarLoja && a.unidade && <div style={{fontSize:10,color:C.gray,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{a.unidade}</div>}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{display:'flex',gap:16,flexWrap:'wrap',padding:'12px 16px',borderTop:`1px solid ${C.border}`,fontSize:12,color:C.textSm}}>
        {[['Agendado',{status:'Agendado'}],['Não compareceu',{status:'Não Compareceu'}],['Compareceu e não comprou',{status:'Compareceu'}],['Comprou',{status:'Compareceu',_compra:{converteu:true}}]].map(([l,a])=>{
          const [bg,fg] = corJornada(a);
          return <span key={l} style={{display:'inline-flex',alignItems:'center',gap:6}}><span style={{width:12,height:12,borderRadius:3,background:bg,borderLeft:`3px solid ${fg}`}}/>{l}</span>;
        })}
        <span style={{marginLeft:'auto',color:C.gray}}>Clique num horário vazio para agendar</span>
      </div>
    </Card>
  );
}

function AgendaModal({ hora, data: dataInicial, existing, encaixe, pacientes, optos, pedirUnidade, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({
    hora: existing?.hora||hora,
    data: existing?.data||dataInicial||today(),
    pacienteId: existing?.paciente_id||'',
    pacienteNome: existing?.paciente_nome||'',
    telefone: existing?.paciente_telefone||'',
    dataNasc: '',
    procedimento: existing?.procedimento||PROCEDIMENTOS[0],
    meioContato: existing?.meio_contato||MEIOS_CONTATO[0],
    obs: existing?.observacoes||'',
    unidade: existing?.unidade||'',
  });
  const [busca, setBusca] = useState(existing?.paciente_nome||'');
  const [sugestoes, setSugestoes] = useState([]);
  const [showSug, setShowSug] = useState(false);
  const [novoCliente, setNovoCliente] = useState(false);
  const [salvandoPac, setSalvandoPac] = useState(false);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const handleBusca = (val) => {
    setBusca(val);
    set('pacienteNome', val);
    set('pacienteId', '');
    setNovoCliente(false);
    if (val.length >= 2) {
      const filtrados = pacientes.filter(p => p.nome.toLowerCase().includes(val.toLowerCase()));
      setSugestoes(filtrados.slice(0, 8));
      setShowSug(true);
    } else {
      setSugestoes([]);
      setShowSug(false);
    }
  };

  const selecionarPaciente = (p) => {
    setBusca(p.nome);
    set('pacienteId', p.id);
    set('pacienteNome', p.nome);
    if (p.telefone) set('telefone', p.telefone);
    if (p.data_nascimento) set('dataNasc', p.data_nascimento);
    setSugestoes([]);
    setShowSug(false);
    setNovoCliente(false);
  };

  const abrirCadastro = () => {
    setShowSug(false);
    setNovoCliente(true);
    set('pacienteNome', busca);
    set('telefone', '');
    set('dataNasc', '');
  };

  const handleSalvar = async () => {
    if (!form.pacienteNome.trim()) { alert('Informe o nome do paciente.'); return; }
    if (!form.telefone.trim()) { alert('WhatsApp é obrigatório.'); return; }
    if (pedirUnidade && !form.unidade) { alert('Selecione a unidade.'); return; }

    let pacId = form.pacienteId;

    // Se é novo cliente, cadastra na tabela pacientes antes
    if (novoCliente && !form.pacienteId) {
      setSalvandoPac(true);
      const novoPac = {
        id: uid(),
        nome: form.pacienteNome.trim(),
        telefone: form.telefone.trim(),
        data_nascimento: form.dataNasc || null,
      };
      const { data: pacData, error } = await supabase.from('pacientes').insert(novoPac).select().single();
      setSalvandoPac(false);
      if (error) {
        alert('Erro ao cadastrar paciente: ' + error.message);
        return;
      }
      if (pacData) {
        pacId = pacData.id;
        set('pacienteId', pacId);
      }
    }

    onSave({ ...form, pacienteId: pacId });
  };

  const inputStyle = (val, obrig=false) => ({
    width:'100%', padding:'8px 12px',
    border:`1px solid ${obrig && !val ? C.danger : C.border}`,
    borderRadius:8, fontSize:14, color:C.text, background:C.white,
    boxSizing:'border-box', outline:'none'
  });

  return (
    <Modal title={existing?'Editar Agendamento':'Novo Agendamento'} onClose={onClose}>
      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <Input label="Data" type="date" value={form.data} onChange={e=>set('data',e.target.value)}/>
          {encaixe
            ? <Input label="Horário (Encaixe)" type="time" value={form.hora} onChange={e=>set('hora',e.target.value)}/>
            : <Select label="Horário" value={form.hora} onChange={e=>set('hora',e.target.value)} options={HORARIOS}/>}
        </div>

        {/* Seção paciente: duas opções lado a lado */}
        {!novoCliente && !form.pacienteId && (
          <div>
            <label style={{display:'block',fontSize:12,fontWeight:600,color:C.navy,marginBottom:8}}>
              Paciente <span style={{color:C.danger}}>*</span>
            </label>
            <div style={{display:'flex',gap:8,marginBottom:8}}>
              <div style={{position:'relative',flex:1}}>
                <input
                  value={busca}
                  onChange={e=>handleBusca(maiusc(e).target.value)}
                  onFocus={()=>busca.length>=2&&setShowSug(true)}
                  onBlur={()=>setTimeout(()=>setShowSug(false),180)}
                  placeholder="Buscar paciente cadastrado..."
                  style={inputStyle(busca)}
                />
                {showSug && (
                  <div style={{position:'absolute',top:'calc(100% + 2px)',left:0,right:0,background:C.white,
                    border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 16px rgba(0,0,0,0.12)',
                    zIndex:999,maxHeight:200,overflowY:'auto'}}>
                    {sugestoes.length > 0 ? sugestoes.map(p=>(
                      <div key={p.id} onMouseDown={()=>selecionarPaciente(p)}
                        style={{padding:'8px 12px',cursor:'pointer',fontSize:14,color:C.text,
                          borderBottom:`1px solid ${C.grayL}`,display:'flex',justifyContent:'space-between'}}
                        onMouseEnter={e=>e.currentTarget.style.background=C.tealBg}
                        onMouseLeave={e=>e.currentTarget.style.background=C.white}>
                        <span>{p.nome}</span>
                        {p.telefone && <span style={{color:C.gray,fontSize:12}}>{p.telefone}</span>}
                      </div>
                    )) : (
                      <div style={{padding:'10px 12px',fontSize:13,color:C.gray}}>Nenhum paciente encontrado</div>
                    )}
                  </div>
                )}
              </div>
              <button onClick={abrirCadastro}
                style={{background:C.teal,color:C.white,border:'none',borderRadius:6,
                  padding:'8px 14px',fontSize:13,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>
                + Cadastrar
              </button>
            </div>
          </div>
        )}

        {/* Paciente selecionado via busca — badge */}
        {form.pacienteId && !novoCliente && (
          <div>
            <label style={{display:'block',fontSize:12,fontWeight:600,color:C.navy,marginBottom:6}}>Paciente</label>
            <div style={{background:C.tealBg,borderRadius:8,padding:'10px 14px',display:'flex',
              justifyContent:'space-between',alignItems:'center',fontSize:13}}>
              <div>
                <div style={{fontWeight:700,color:C.text}}>{form.pacienteNome}</div>
                {form.telefone && <div style={{fontSize:12,color:C.gray,marginTop:2}}>{form.telefone}</div>}
              </div>
              <span style={{color:C.gray,cursor:'pointer',fontSize:12,textDecoration:'underline'}} onClick={()=>{
                setBusca(''); set('pacienteId',''); set('pacienteNome',''); set('telefone',''); set('dataNasc','');
              }}>Trocar</span>
            </div>
          </div>
        )}

        {/* Mini-cadastro de novo paciente */}
        {novoCliente && (
          <div style={{background:'#E9EEF6',border:`1.5px solid ${C.orange}`,borderRadius:12,padding:16}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <span style={{fontSize:13,fontWeight:700,color:C.orange}}>Novo Paciente</span>
              <span style={{fontSize:12,color:C.gray,cursor:'pointer',textDecoration:'underline'}}
                onClick={()=>{setNovoCliente(false);setBusca('');set('pacienteNome','');set('telefone','');set('dataNasc','');}}>
                Cancelar
              </span>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              <div>
                <label style={{display:'block',fontSize:12,fontWeight:600,color:C.navy,marginBottom:4}}>
                  Nome completo <span style={{color:C.danger}}>*</span>
                </label>
                <input value={form.pacienteNome} onChange={e=>set('pacienteNome',maiusc(e).target.value)}
                  placeholder="Nome completo do paciente" style={inputStyle(form.pacienteNome, true)}/>
              </div>
              <div>
                <label style={{display:'block',fontSize:12,fontWeight:600,color:C.navy,marginBottom:4}}>
                  WhatsApp <span style={{color:C.danger}}>*</span>
                </label>
                <input value={form.telefone} onChange={e=>set('telefone',e.target.value)}
                  placeholder="(00) 00000-0000" style={inputStyle(form.telefone, true)}/>
              </div>
              <div>
                <label style={{display:'block',fontSize:12,fontWeight:600,color:C.navy,marginBottom:4}}>
                  Data de Nascimento
                </label>
                <input type="date" value={form.dataNasc} onChange={e=>set('dataNasc',e.target.value)}
                  style={inputStyle(form.dataNasc)}/>
              </div>
            </div>
            <div style={{fontSize:11,color:C.gray,marginTop:10}}>
              Paciente sera cadastrado automaticamente ao salvar o agendamento.
            </div>
          </div>
        )}

        {pedirUnidade && (
          <Select label="Unidade" value={form.unidade} onChange={e=>set('unidade',e.target.value)}
            options={[{value:'',label:'Selecionar unidade'},...UNIDADES.map(u=>({value:u,label:u}))]}/>
        )}
        <Select label="Procedimento" value={form.procedimento} onChange={e=>set('procedimento',e.target.value)} options={PROCEDIMENTOS}/>
        <Select label="Meio de Contato" value={form.meioContato} onChange={e=>set('meioContato',e.target.value)} options={MEIOS_CONTATO}/>
        <Input label="Observações" value={form.obs} onChange={e=>set('obs',e.target.value)} placeholder="Opcional"/>

        <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:8}}>
          {existing && <Btn color={C.danger} outline onClick={()=>onDelete(existing.id)}>Remover</Btn>}
          <Btn color={C.gray} outline onClick={onClose}>Cancelar</Btn>
          <Btn color={C.teal} onClick={handleSalvar} disabled={salvandoPac}>
            {salvandoPac ? 'Salvando...' : 'Salvar'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}


/* ── Reagendar: escolhe nova data e horário ── */
function ReagendarModal({ item, onSave, onClose }) {
  const [data, setData] = useState(item.data >= today() ? item.data : today());
  const [hora, setHora] = useState(HORARIOS.includes(item.hora) ? item.hora : HORARIOS[0]);
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    if (!data || !hora) { alert('Escolha a nova data e o horário.'); return; }
    setSalvando(true); await onSave({ data, hora }); setSalvando(false);
  };
  return (
    <Modal title="Reagendar paciente" onClose={onClose} width={420}>
      <div style={{display:'flex',flexDirection:'column',gap:16}}>
        <div style={{background:C.tealBg,borderRadius:8,padding:'12px 16px'}}>
          <div style={{fontWeight:700,color:C.navy}}>{item.paciente_nome}</div>
          <div style={{fontSize:12,color:C.gray,marginTop:4}}>Atual: {fmtDate(item.data)} às {item.hora}{item.unidade ? ` · ${item.unidade}` : ''}</div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <Input label="Nova data" type="date" value={data} min={today()} onChange={e=>setData(e.target.value)}/>
          <Select label="Novo horário" value={hora} onChange={e=>setHora(e.target.value)} options={HORARIOS}/>
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <Btn outline color={C.gray} onClick={onClose}>Cancelar</Btn>
          <Btn color={C.teal} onClick={salvar} disabled={salvando}>{salvando ? 'Salvando...' : 'Confirmar'}</Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════
   AGENDAMENTOS (lista filtrada)
══════════════════════════════════════════════════════ */
// Lista única de agendamentos e atendimentos (filtros + reagendar + atender)
function ListaAtendimentos({ user, onAtender, selectedUnidade='' }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtros, setFiltros] = useState({ data: today(), opto:'', status:'', proc:'', agendadoPor:'', unidade:'' });
  const [optos, setOptos] = useState([]);
  const [prevs, setPrevs] = useState([]);
  const [toast, setToast] = useState('');
  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  useEffect(()=>{
    listarUsuarios().then(todos => setOptos(todos.filter(u=>u.perfil==='opto')));
    // Carrega pré-vendas + IA para o filtro de responsável
    supabase.from('usuarios').select('nome').in('perfil',['prevenda','supervisor','diretor','gerente'])
      .then(({data})=>{
        const nomes = (data||[]).map(u=>u.nome);
        if (!nomes.includes('IA')) nomes.push('IA');
        setPrevs(nomes.sort());
      });
  },[]);

  const load = useCallback(async () => {
    let q = supabase.from('agenda').select('*').order('data').order('hora');
    if (filtros.data) q = q.eq('data', filtros.data);
    if (filtros.opto) q = q.eq('opto_id', filtros.opto);
    if (filtros.status) q = q.eq('status', filtros.status);
    if (filtros.proc) q = q.eq('procedimento', filtros.proc);
    if (filtros.agendadoPor) q = q.eq('agendado_por', filtros.agendadoPor);
    // Global unit filter takes priority over local unidade filter
    const unidadeFilter = user.unidade || selectedUnidade || filtros.unidade;
    if (unidadeFilter) q = q.eq('unidade', unidadeFilter);
    const {data} = await q;
    setRows(await anexarCompras(data||[]));
    setLoading(false);
  }, [filtros, selectedUnidade]);

  useEffect(()=>{ load(); },[load]);
  useRealtime('agenda', load);

  const [reagendar, setReagendar] = useState(null);
  // Encaixe: agenda o paciente agora e já abre o atendimento
  const [encaixe, setEncaixe] = useState(null);
  const [pacientes, setPacientes] = useState([]);
  const abrirEncaixe = async () => {
    const n = new Date();
    setEncaixe({ hora: `${pad(n.getHours())}:${pad(n.getMinutes())}` });
    const { data } = await supabase.from('pacientes').select('*').order('nome');
    setPacientes(data || []);
  };
  const salvarEncaixe = async (form) => {
    const unidadeAlvo = user.unidade || selectedUnidade || form.unidade || '';
    if (!unidadeAlvo) { alert('Selecione a unidade do agendamento.'); return; }
    const ativos = (await listarUsuarios()).filter(u => u.perfil === 'opto' && u.ativo);
    const opto = user.perfil === 'opto' ? user : ativos.find(o => o.unidade === unidadeAlvo);
    const pac = pacientes.find(p => p.id === form.pacienteId);
    const row = {
      id: uid(), paciente_id: form.pacienteId || null, paciente_nome: pac?.nome || form.pacienteNome,
      paciente_telefone: form.telefone || '', opto_id: opto?.id || null, opto_nome: opto?.nome || '',
      data: today(), hora: form.hora || encaixe.hora, procedimento: form.procedimento, meio_contato: form.meioContato,
      status: 'Agendado', observacoes: form.obs || '', agendado_por: user.nome || '', unidade: unidadeAlvo,
    };
    const { error } = await supabase.from('agenda').insert(row);
    if (error) { alert('Erro ao salvar o encaixe: ' + error.message); return; }
    setEncaixe(null);
    showToast('Encaixe criado. Abrindo o atendimento…');
    onAtender(row);
  };
  const conta = st => rows.filter(a=>a.status===st).length;
  const comprou = rows.filter(a=>a._compra?.converteu).length;
  const resumo = `${rows.length} registro(s) · ${conta('Agendado')} aguardando · ${conta('Não Compareceu')} não compareceu · ${conta('Compareceu')} atendido(s), ${comprou} comprou`;
  const podeAtender = PERFIS[user.perfil]?.nav.includes('atendimento');
  const salvarReagendamento = async ({ data, hora }) => {
    const a = reagendar;
    const { error } = await supabase.from('agenda').update({
      data, hora, status: 'Agendado', calendar_updated: false,
      // agendamento da IA: a sincronização move o evento no Google Agenda
      ...(a.google_event_id ? { google_sync_pendente: true } : {}),
    }).eq('id', a.id);
    if (error) { alert('Erro ao reagendar: ' + error.message); return; }
    setReagendar(null);
    showToast(`Reagendado para ${fmtDate(data)} às ${hora}`);
    load();
  };

  return (
    <div>
      <Toast msg={toast}/>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',gap:12,flexWrap:'wrap',marginBottom:16}}>
        <div>
          <h2 style={{fontSize:22,fontWeight:800,color:C.navy}}>Atendimentos</h2>
          <p style={{color:C.gray,fontSize:13,marginTop:2}}>{filtros.data ? (filtros.data===today() ? 'Hoje · ' : '') + fmtDate(filtros.data) : 'Todas as datas'} · {resumo}</p>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {filtros.data !== today() && <Btn outline size="sm" color={C.teal} onClick={()=>setFiltros(f=>({...f,data:today()}))}>Voltar para hoje</Btn>}
          {podeAtender && <Btn color={C.teal} onClick={abrirEncaixe}>+ Encaixe</Btn>}
        </div>
      </div>
      {encaixe && <AgendaModal hora={encaixe.hora} data={today()} encaixe pacientes={pacientes} optos={[]}
        pedirUnidade={!(user.unidade || selectedUnidade)} onSave={salvarEncaixe} onDelete={()=>{}} onClose={()=>setEncaixe(null)}/>}
      <Card style={{marginBottom:16}}>
        <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'flex-end'}}>
          <Input label="Data" type="date" value={filtros.data} onChange={e=>setFiltros(f=>({...f,data:e.target.value}))}/>
          <Select label="Optometrista" value={filtros.opto} onChange={e=>setFiltros(f=>({...f,opto:e.target.value}))}
            options={[{value:'',label:'Todos'},...optos.map(o=>({value:o.id,label:o.nome}))]}/>
          <Select label="Status" value={filtros.status} onChange={e=>setFiltros(f=>({...f,status:e.target.value}))}
            options={[{value:'',label:'Todos'},{value:'Agendado',label:'Agendado'},{value:'Compareceu',label:'Compareceu'},{value:'Não Compareceu',label:'Não Compareceu'},{value:'Cancelado',label:'Cancelado'}]}/>
          <Select label="Procedimento" value={filtros.proc} onChange={e=>setFiltros(f=>({...f,proc:e.target.value}))}
            options={[{value:'',label:'Todos'},...PROCEDIMENTOS.map(p=>({value:p,label:p}))]}/>
          <Select label="Agendado por" value={filtros.agendadoPor} onChange={e=>setFiltros(f=>({...f,agendadoPor:e.target.value}))}
            options={[{value:'',label:'Todos'},...prevs.map(n=>({value:n,label:n}))]}/>
          {!user.unidade && !selectedUnidade && <Select label="Unidade" value={filtros.unidade} onChange={e=>setFiltros(f=>({...f,unidade:e.target.value}))}
            options={[{value:'',label:'Todas'},...UNIDADES.map(u=>({value:u,label:u}))]}/>}
        </div>
      </Card>
      {reagendar && <ReagendarModal item={reagendar} onSave={salvarReagendamento} onClose={()=>setReagendar(null)}/>}
      {loading ? <Spinner/> : (
        <Card>
          {rows.length===0 && <p style={{textAlign:'center',color:C.gray,padding:20}}>Nenhum agendamento encontrado</p>}
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead>
                <tr style={{background:C.teal,color:C.white}}>
                  {['Data','Hora','Paciente','Opto','Procedimento','Contato','Agendado por','Status','Ações'].filter(h=>rows.length && (h!=='Data' || !filtros.data)).map(h=>(
                    <th key={h} style={{padding:'9px 12px',textAlign:'left',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((a,i)=>(
                  <tr key={a.id} style={{background:i%2===0?C.white:C.bg,borderBottom:`1px solid ${C.border}`}}>
                    {!filtros.data && <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>{fmtDate(a.data)}</td>}
                    <td style={{padding:'8px 12px',fontWeight:700,color:C.text}}>{a.hora}</td>
                    <td style={{padding:'8px 12px'}}>{a.paciente_nome}</td>
                    <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>{a.opto_nome}</td>
                    <td style={{padding:'8px 12px'}}>{a.procedimento}</td>
                    <td style={{padding:'8px 12px'}}>{a.meio_contato}</td>
                    <td style={{padding:'8px 12px'}}>
                      {a.agendado_por
                        ? <span style={{
                            display:'inline-block',padding:'2px 10px',borderRadius:20,fontSize:12,fontWeight:600,whiteSpace:'nowrap',
                            background: a.agendado_por==='IA' ? C.orangeBg : C.tealBg,
                            color: a.agendado_por==='IA' ? C.orange : C.teal
                          }}>{a.agendado_por}</span>
                        : <span style={{color:C.gray,fontSize:12}}>—</span>}
                    </td>
                    <td style={{padding:'8px 12px'}}>
                      <StatusJornada a={a}/>
                    </td>
                    <td style={{padding:'8px 12px'}}>
                      <div style={{display:'flex',gap:6}}>
                        {/* Atender: pacientes do dia (inclusive quem chegou atrasado). Atendidos: abre a ficha/receita em qualquer data */}
                        {/* Os dois botões ficam sempre no lugar; quando não se aplicam, aparecem desabilitados */}
                        {podeAtender && (() => {
                          const pode = a.status==='Compareceu' || (a.data===today() && a.status!=='Cancelado');
                          const motivo = a.status==='Cancelado' ? 'Agendamento cancelado' : 'Só é possível atender no dia do agendamento';
                          return <Btn size="sm" color={C.teal} disabled={!pode} title={pode ? '' : motivo}
                            style={{width:112,padding:'7px 0',...(pode?{}:{background:C.grayL,borderColor:C.grayL,color:C.gray,opacity:1})}}
                            onClick={()=>pode && onAtender(a)}>{a.status==='Compareceu'?'Ver ficha':'Atender'}</Btn>;
                        })()}
                        <Btn outline size="sm" color={C.teal} disabled={a.status==='Compareceu'} title={a.status==='Compareceu' ? 'Paciente já atendido' : ''}
                          style={{width:112,padding:'7px 0'}} onClick={()=>a.status!=='Compareceu' && setReagendar(a)}>Reagendar</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}


/* ══════════════════════════════════════════════════════
   RECEITA IMPRESSA (única para Atendimento e Receitas)
══════════════════════════════════════════════════════ */
const idadeEm = (nasc, ref) => {
  if (!nasc) return '';
  const n = new Date(String(nasc).slice(0,10)+'T12:00:00');
  const r = ref ? new Date(String(ref).slice(0,10)+'T12:00:00') : new Date();
  if (isNaN(n) || isNaN(r)) return '';
  let a = r.getFullYear() - n.getFullYear();
  if (r.getMonth() < n.getMonth() || (r.getMonth() === n.getMonth() && r.getDate() < n.getDate())) a--;
  return a >= 0 ? `${a} ${a === 1 ? 'ano' : 'anos'}` : '';
};
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// Nome e registro do optometrista exatamente como estão no cadastro (sem acrescentar nada); se o cadastro não estiver carregado, usa o que ficou gravado na receita
const cadastroOpto = r => {
  const u = usuariosEmCache().find(x => x.id === r.opto_id);
  return { nome: (u?.nome || r.opto_nome || '').trim(), registro: String((u ? u.cro : r.opto_cro) || '').trim() };
};

function imprimirReceita(r) {
  const logoUrl = window.location.origin + '/logo-visao-ideal.png';
  const [dAt, tAt] = String(r.data_hora_atendimento || '').split(' ');
  const dtAtend = dAt ? fmtDate(dAt) + (tAt ? ' às ' + tAt : '') : fmtDate(r.data);
  const unidade = r.unidade || r.opto_unidade || 'SÃO VICENTE';
  const dtExtenso = unidade + ', ' + new Date((r.data || today()) + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const idade = idadeEm(r.paciente_data_nascimento, dAt || r.data);
  const { nome: nomeOpto, registro: cro } = cadastroOpto(r);
  const endereco = r.opto_endereco || ENDERECOS_UNIDADES[unidade] || ENDERECOS_UNIDADES['SÃO VICENTE'];
  const eixo = v => v && v !== '—' ? esc(v) + '°' : '—';
  const dnp = v => v && v !== 'N/A' ? esc(v) : '—';
  const temAdicao = (r.od_adicao && r.od_adicao !== 'N/A') || (r.oe_adicao && r.oe_adicao !== 'N/A');
  const w = window.open('', '_blank');
  if (!w) { alert('Permita popups neste site para imprimir a receita.'); return; }
  w.document.write(`<!DOCTYPE html><html><head><title>Prescrição de Óculos</title><meta charset="utf-8"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#1A1A1A;padding:20mm 22mm 16mm 22mm;width:210mm;min-height:297mm}
    .header{display:flex;align-items:center;gap:20px;padding-bottom:14px;border-bottom:1.5px solid #1A1A1A;margin-bottom:22px}
    .logo{height:58px;object-fit:contain}
    .titulo{font-size:18px;font-weight:800;letter-spacing:.5px;text-transform:uppercase}
    .subtitulo{font-size:12px;color:#555;font-weight:600;margin-top:3px}
    .section-box{border:1px solid #bbb;border-radius:8px;padding:12px 16px;margin-bottom:20px;background:#fff}
    .field-row{display:flex;gap:24px;flex-wrap:wrap}
    .field{display:flex;flex-direction:column;gap:2px;flex:1}
    .label{font-size:10px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.5px}
    .value{font-size:14px;font-weight:600;border-bottom:1px solid #bbb;padding-bottom:4px;margin-top:2px;min-height:22px}
    .section-title{font-size:11px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px}
    table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:22px}
    table th{background:#fff;color:#1A1A1A;border:1px solid #999;padding:10px 12px;text-align:center;font-size:12px;font-weight:700}
    table th:first-child{border-radius:6px 0 0 0} table th:last-child{border-radius:0 6px 0 0}
    table td{border:1px solid #999;padding:10px 12px;text-align:center}
    table tbody tr:nth-child(even){background:#fff}
    .olho{font-weight:800;font-size:14px;background:#fff!important}
    .adicao-row td{background:#fff!important;color:#1A1A1A;font-weight:700}
    .sugestoes{display:flex;gap:40px;flex-wrap:wrap;margin-bottom:22px}
    .sug-valor{font-size:14px;font-weight:700;color:#1A1A1A;line-height:1.5}
    .obs-box{font-size:13px;line-height:1.6;color:#1A1A1A;background:#fff;border:1px solid #bbb;border-radius:6px;padding:10px 14px;margin-bottom:22px}
    .assinatura-area{display:flex;align-items:flex-end;justify-content:space-between;margin:28px 0 20px;gap:24px}
    .assinatura-col{display:flex;flex-direction:column;align-items:center;gap:4px}
    .assinatura-img{height:100px;max-width:260px;object-fit:contain;margin-bottom:-16px}
    .assinatura-linha{border-top:1.5px solid #1A1A1A;width:220px;margin-bottom:6px}
    .assinatura-nome{font-size:13px;font-weight:700;text-align:center}
    .assinatura-cro{font-size:11px;color:#555;text-align:center}
    .data-local{font-size:13px;text-align:right;flex:1}
    .lembrete{font-size:11px;color:#333;line-height:1.6;border-left:3px solid #999;padding:10px 14px;background:#fff;border-radius:0 6px 6px 0;margin-bottom:18px}
    .lembrete b{color:#1A1A1A}
    .footer{border-top:1px solid #bbb;padding-top:10px;font-size:10px;color:#666;text-align:center}
    @media print{html,body{width:210mm;height:297mm}body{padding:18mm 20mm 14mm 20mm}@page{size:A4 portrait;margin:0}}
  </style></head><body>
    <div class="header">
      <img src="${logoUrl}" alt="Clínica Visão Ideal" class="logo" onerror="this.style.display='none'"/>
      <div><div class="titulo">Prescrição de Óculos</div><div class="subtitulo">Clínica Visão Ideal</div></div>
    </div>
    <div class="section-box"><div class="field-row">
      <div class="field"><span class="label">Paciente</span><span class="value">${esc(r.paciente_nome)}</span></div>
      <div class="field" style="flex:0 0 auto;min-width:90px"><span class="label">Idade</span><span class="value">${idade || '&nbsp;'}</span></div>
      <div class="field" style="flex:0 0 auto;min-width:180px"><span class="label">Data do atendimento</span><span class="value">${dtAtend}</span></div>
    </div></div>
    <div class="section-title">Grau de correção visual</div>
    <table>
      <thead><tr><th style="width:60px"></th><th>Esférico</th><th>Cilíndrico</th><th>Eixo</th><th>AV</th><th>DNP (mm)</th></tr></thead>
      <tbody>
        <tr><td class="olho">OD</td><td>${esc(r.od_esf)||'—'}</td><td>${esc(r.od_cil)||'—'}</td><td>${eixo(r.od_eixo)}</td><td>${esc(r.od_av)||''}</td><td>${dnp(r.od_dnp)}</td></tr>
        <tr><td class="olho">OE</td><td>${esc(r.oe_esf)||'—'}</td><td>${esc(r.oe_cil)||'—'}</td><td>${eixo(r.oe_eixo)}</td><td>${esc(r.oe_av)||''}</td><td>${dnp(r.oe_dnp)}</td></tr>
        ${temAdicao ? (r.od_adicao === r.oe_adicao
          ? `<tr class="adicao-row"><td class="olho" colspan="2">Adição</td><td colspan="4" style="text-align:left;padding-left:16px">AO (ambos os olhos): ${esc(r.od_adicao)}</td></tr>`
          : `<tr class="adicao-row"><td class="olho" colspan="2">Adição</td><td colspan="4" style="text-align:left;padding-left:16px">OD: ${esc(r.od_adicao)||'—'} &nbsp;&nbsp; OE: ${esc(r.oe_adicao)||'—'}</td></tr>`) : ''}
      </tbody>
    </table>
    ${r.tipo_lente || (r.tratamentos_sugeridos||[]).length ? `<div class="sugestoes">
      ${r.tipo_lente ? `<div><div class="section-title">Tipo de lente sugerido</div><div class="sug-valor">${esc(r.tipo_lente)}</div></div>` : ''}
      ${(r.tratamentos_sugeridos||[]).length ? `<div><div class="section-title">Tratamentos sugeridos</div><div class="sug-valor">${r.tratamentos_sugeridos.map(t=>esc(nomeTrat(t))).join(' &nbsp;·&nbsp; ')}</div></div>` : ''}
    </div>` : ''}
    ${r.observacoes ? `<div class="section-title">Observações</div><div class="obs-box">${esc(r.observacoes)}</div>` : ''}
    <div class="assinatura-area">
      <div class="assinatura-col">
        ${imgAssinatura(r.opto_id, 'assinatura-img')}
        <div class="assinatura-linha"></div>
        <div class="assinatura-nome">${esc(nomeOpto)}</div>
        ${cro ? `<div class="assinatura-cro">${esc(cro)}</div>` : ''}
      </div>
      <div class="data-local">${esc(dtExtenso)}</div>
    </div>
    <div class="lembrete">
      <b>Cuide da sua visão todo ano.</b> A visão muda com o tempo, muitas vezes sem que a gente perceba.
      Refaça seu exame de acuidade visual com um especialista uma vez por ano, mesmo que esteja enxergando bem,
      e procure antes se notar qualquer mudança. Esta prescrição não substitui a avaliação médica para diagnóstico
      e tratamento de doenças oculares.
    </div>
    <div class="footer">Clínica Visão Ideal &nbsp;·&nbsp; ${esc(endereco)}</div>
    <script>window.onload=()=>{ setTimeout(()=>window.print(),200); };</script>
  </body></html>`);
  w.document.close();
}

// Assinaturas digitalizadas por optometrista (id do usuário → imagem em /public/assinaturas)
const ASSINATURAS = { AHAH8YRN: '/assinaturas/AHAH8YRN.png', BE9D3DPW: '/assinaturas/BE9D3DPW.png' };
const imgAssinatura = (optoId, classe) => ASSINATURAS[optoId]
  ? `<img src="${window.location.origin}${ASSINATURAS[optoId]}" class="${classe}" alt="Assinatura" onerror="this.style.display='none'"/>` : '';

/* ══════════════════════════════════════════════════════
   DECLARAÇÃO DE COMPARECIMENTO
══════════════════════════════════════════════════════ */
const soDigitos = v => String(v||'').replace(/\D/g,'');
const fmtCPF = v => { const d = soDigitos(v).slice(0,11); return d.replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})\.(\d{3})(\d)/,'$1.$2.$3').replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/,'$1.$2.$3-$4'); };
const cpfValido = v => {
  const d = soDigitos(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = n => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
};
const horaMais = (h, min) => { const [a,b] = String(h||'00:00').split(':').map(Number); const t = (a*60 + b + min + 1440) % 1440; return `${pad(Math.floor(t/60))}:${pad(t%60)}`; };

function imprimirDeclaracao(r, { cpf, inicio, fim }) {
  const logoUrl = window.location.origin + '/logo-visao-ideal.png';
  const dAt = String(r.data_hora_atendimento || '').split(' ')[0] || r.data || today();
  const unidade = r.unidade || r.opto_unidade || 'SÃO VICENTE';
  const endereco = r.opto_endereco || ENDERECOS_UNIDADES[unidade] || ENDERECOS_UNIDADES['SÃO VICENTE'];
  const dataEmissao = new Date(dAt + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const { nome: nomeOpto, registro: cro } = cadastroOpto(r);
  const w = window.open('', '_blank');
  if (!w) { alert('Permita popups neste site para imprimir a declaração.'); return; }
  w.document.write(`<!DOCTYPE html><html><head><title>Declaração de Comparecimento</title><meta charset="utf-8"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#1A1A1A;padding:22mm 24mm 16mm 24mm;width:210mm;min-height:297mm;display:flex;flex-direction:column}
    .header{display:flex;align-items:center;gap:20px;padding-bottom:14px;border-bottom:1.5px solid #1A1A1A;margin-bottom:48px}
    .logo{height:58px;object-fit:contain}
    .titulo{font-size:18px;font-weight:800;letter-spacing:.5px;text-transform:uppercase}
    .subtitulo{font-size:12px;color:#555;font-weight:600;margin-top:3px}
    h1{font-size:20px;font-weight:800;text-align:center;letter-spacing:1.5px;margin-bottom:40px}
    .texto{font-size:15px;line-height:2;text-align:justify}
    .texto b{font-weight:700}
    .local{font-size:15px;margin-top:40px;text-align:right}
    .assinatura-img{height:96px;max-width:280px;object-fit:contain;margin-bottom:-16px}
    .assinatura{margin-top:80px;display:flex;flex-direction:column;align-items:center;gap:4px}
    .linha{border-top:1.5px solid #1A1A1A;width:300px;margin-bottom:8px}
    .nome{font-size:14px;font-weight:700}
    .reg{font-size:12px;color:#555}
    .carimbo{font-size:11px;color:#999;margin-top:10px}
    .footer{margin-top:auto;border-top:1px solid #bbb;padding-top:10px;font-size:10px;color:#666;text-align:center}
    @media print{html,body{width:210mm;height:297mm}body{padding:20mm 22mm 14mm 22mm}@page{size:A4 portrait;margin:0}}
  </style></head><body>
    <div class="header">
      <img src="${logoUrl}" alt="Clínica Visão Ideal" class="logo" onerror="this.style.display='none'"/>
      <div><div class="titulo">Clínica Visão Ideal</div><div class="subtitulo">Unidade ${esc(unidade)}</div></div>
    </div>
    <h1>DECLARAÇÃO DE COMPARECIMENTO</h1>
    <p class="texto">Declaro, para os devidos fins, que o(a) Sr.(a) <b>${esc(r.paciente_nome)}</b>, portador(a) do CPF nº <b>${esc(fmtCPF(cpf))}</b>,
    compareceu a este estabelecimento (<b>Clínica Visão Ideal – ${esc(unidade)}</b>), localizado em ${esc(endereco)},
    no dia <b>${esc(fmtDate(dAt))}</b>, no período das <b>${esc(inicio)}</b> às <b>${esc(fim)}</b> horas,
    para a realização de avaliação visual / atendimento optométrico.</p>
    <p class="local">${esc(unidade)}/SP, ${esc(dataEmissao)}.</p>
    <div class="assinatura">
      ${imgAssinatura(r.opto_id, 'assinatura-img')}
      <div class="linha"></div>
      <div class="nome">${esc(nomeOpto)}</div>
      ${cro ? `<div class="reg">${esc(cro)}</div>` : ''}
      <div class="carimbo">Carimbo e assinatura</div>
    </div>
    <div class="footer">Clínica Visão Ideal &nbsp;·&nbsp; ${esc(endereco)}</div>
    <script>window.onload=()=>{ setTimeout(()=>window.print(),200); };</script>
  </body></html>`);
  w.document.close();
}

// Pede o CPF (obrigatório) e o horário antes de gerar a declaração. O CPF não é gravado no sistema.
function DeclaracaoModal({ receita, horaAgenda, onClose }) {
  const fimPadrao = String(receita.data_hora_atendimento || '').split(' ')[1]?.slice(0,5) || `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
  const [cpf, setCpf] = useState('');
  const [inicio, setInicio] = useState(horaAgenda && horaAgenda < fimPadrao ? horaAgenda.slice(0,5) : horaMais(fimPadrao, -30));
  const [fim, setFim] = useState(fimPadrao);
  const [erro, setErro] = useState('');
  const gerar = () => {
    if (!soDigitos(cpf)) return setErro('Informe o CPF do paciente.');
    if (!cpfValido(cpf)) return setErro('CPF inválido. Confira os números.');
    if (!inicio || !fim || inicio >= fim) return setErro('O horário de saída precisa ser depois da chegada.');
    setErro('');
    imprimirDeclaracao(receita, { cpf, inicio, fim });
    onClose();
  };
  return (
    <Modal title="Declaração de comparecimento" onClose={onClose} width={460}>
      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        <div style={{background:C.tealBg,borderRadius:12,padding:'12px 16px'}}>
          <div style={{fontWeight:700,color:C.navy}}>{receita.paciente_nome}</div>
          <div style={{fontSize:12,color:C.gray,marginTop:2}}>{fmtDate(String(receita.data_hora_atendimento||'').split(' ')[0] || receita.data)} · {receita.unidade || 'Clínica Visão Ideal'} · {receita.opto_nome}</div>
        </div>
        <div>
          <Input label={<>CPF do paciente <span style={{color:C.danger}}>*</span></>} value={cpf} inputMode="numeric" placeholder="000.000.000-00" autoFocus
            onChange={e=>{ setCpf(fmtCPF(e.target.value)); setErro(''); }} onKeyDown={e=>e.key==='Enter'&&gerar()}
            style={erro.startsWith('CPF') || erro.startsWith('Informe') ? {['--borda']:C.danger} : {}}/>
          <div style={{fontSize:11,color:C.gray,marginTop:4}}>Usado só nesta declaração; não fica gravado no sistema.</div>
        </div>
        <div style={{display:'flex',gap:12}}>
          <Input label="Chegada" type="time" value={inicio} onChange={e=>{ setInicio(e.target.value); setErro(''); }} style={{flex:1}}/>
          <Input label="Saída" type="time" value={fim} onChange={e=>{ setFim(e.target.value); setErro(''); }} style={{flex:1}}/>
        </div>
        {erro && <div style={{fontSize:12,color:C.danger,fontWeight:600}}>{erro}</div>}
        <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:4}}>
          <Btn outline color={C.gray} onClick={onClose}>Cancelar</Btn>
          <Btn color={C.teal} onClick={gerar}>Gerar declaração</Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════
   ATENDIMENTO
══════════════════════════════════════════════════════ */
function Atendimento({ user, selectedUnidade='' }) {
  const [sel, setSel] = useState(null);
  const [tabAte, setTabAte] = useState('anamnese');
  const [form, setForm] = useState({ anamnese:'', queixa:'', medicamentos:'', nasc:'', trat:TRAT_PADRAO, tipoLente:'',
    od_esf:'',od_cil:'',od_eixo:'',od_av:'',od_add:'',od_dnp:'',
    oe_esf:'',oe_cil:'',oe_eixo:'',oe_av:'',oe_add:'',oe_dnp:'' });
  const [receita, setReceita] = useState(null);
  const [declaracao, setDeclaracao] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };
  const setF = (k,v) => setForm(f=>({...f,[k]:v}));

  useEffect(()=>{
    if (!sel) return;
    supabase.from('receitas').select('*').eq('agenda_id',sel.id).maybeSingle()
      .then(({data})=>{ if(data){ setReceita(data); if (data.paciente_data_nascimento) setForm(f=>({...f, nasc: f.nasc || data.paciente_data_nascimento})); } });
    if (sel.paciente_id) {
      supabase.from('pacientes').select('data_nascimento').eq('id', sel.paciente_id).maybeSingle()
        .then(({data})=>{ if (data?.data_nascimento) setForm(f=>({...f, nasc: f.nasc || data.data_nascimento})); });
    }
  },[sel]);

  const iniciarAtendimento = (a) => {
    setSel(a); setErroNasc('');
    setTabAte('anamnese');
    setForm({ anamnese:'', queixa:'', medicamentos:'', nasc:'', trat:TRAT_PADRAO, tipoLente:'',
      od_esf:'',od_cil:'',od_eixo:'',od_av:'',od_add:'',od_dnp:'',
      oe_esf:'',oe_cil:'',oe_eixo:'',oe_av:'',oe_add:'',oe_dnp:'' });
    setReceita(null);
  };

  // Data de nascimento é obrigatória (vem do cadastro quando já existe)
  const [erroNasc, setErroNasc] = useState('');
  const [erroTipo, setErroTipo] = useState('');
  const conferirTipo = () => {
    if (form.tipoLente) { setErroTipo(''); return true; }
    setErroTipo('Escolha o tipo de lente sugerido.'); setTabAte('anamnese'); alert('Escolha o tipo de lente sugerido.'); return false;
  };
  const conferirNasc = () => {
    const n = form.nasc;
    let msg = '';
    if (!n) msg = 'Informe a data de nascimento do paciente.';
    else if (n > today() || n < '1900-01-01') msg = 'Data de nascimento inválida.';
    setErroNasc(msg);
    if (msg) { setTabAte('anamnese'); alert(msg); return false; }
    return true;
  };
  const salvarNascNoCadastro = async () => {
    if (form.nasc && sel?.paciente_id) await supabase.from('pacientes').update({ data_nascimento: form.nasc }).eq('id', sel.paciente_id).is('data_nascimento', null);
  };

  // Regra: só usuário com perfil de optometrista gera (ou altera) receita — o banco também bloqueia
  const podeReceita = user.perfil === 'opto';
  // Anamnese e refração: só o optometrista preenche, e nada muda depois da receita gerada
  const soLeitura = !podeReceita || !!receita;
  const gerarReceita = async () => {
    if (!podeReceita) { alert('Somente optometristas podem gerar receitas.'); return; }
    if (!conferirNasc() || !conferirTipo()) return;
    const { erros, valores: rx } = validarRx(form);
    if (Object.keys(erros).length) { setErrosRx(erros); setTabAte('refracao'); alert('Confira os campos da refração marcados em vermelho.'); return; }
    // A receita sai no nome (e CRO) do optometrista. Se quem atende não é opto (ex.: gerente), usa o opto do agendamento.
    let opto = user;
    if (user.perfil !== 'opto' && sel.opto_id) {
      const doAgendamento = (await listarUsuarios()).find(u => u.id === sel.opto_id);
      if (doAgendamento) opto = doAgendamento;
    }
    const agora = new Date();
    const dataHora = `${agora.getFullYear()}-${pad(agora.getMonth()+1)}-${pad(agora.getDate())} ${pad(agora.getHours())}:${pad(agora.getMinutes())}`;
    const row = {
      id:uid(), agenda_id:sel.id, paciente_nome:sel.paciente_nome,
      paciente_telefone:sel.paciente_telefone||'',
      opto_id:opto.id, opto_nome:opto.nome, opto_cro:opto.cro||'', opto_unidade:opto.unidade||'',
      opto_endereco:opto.endereco||ENDERECOS_UNIDADES[sel.unidade||opto.unidade]||'',
      data:today(), data_hora_atendimento: dataHora,
      meio_contato: sel.meio_contato||'', agendado_por: sel.agendado_por||'',
      unidade: sel.unidade||opto.unidade||'',
      paciente_data_nascimento: form.nasc || null,
      od_esf:rx.od_esf, od_cil:rx.od_cil, od_eixo:rx.od_eixo, od_av:rx.od_av, od_adicao:rx.od_add, od_dnp:rx.od_dnp,
      oe_esf:rx.oe_esf, oe_cil:rx.oe_cil, oe_eixo:rx.oe_eixo, oe_av:rx.oe_av, oe_adicao:rx.oe_add, oe_dnp:rx.oe_dnp,
      observacoes:form.anamnese,
      tratamentos_sugeridos: TRATAMENTOS.map(t=>t.id).filter(id=>(form.trat||[]).includes(id)),
      tipo_lente: form.tipoLente,
    };
    const {data, error} = await supabase.from('receitas').insert(row).select().single();
    if (error) { alert('Erro ao gerar a receita: ' + error.message); return; }
    // guarda a data de nascimento no cadastro do paciente, se ainda não tiver
    // gerou receita = compareceu (o banco também garante isso); as duas gravações vão juntas
    await Promise.all([salvarNascNoCadastro(), supabase.from('agenda').update({ status: 'Compareceu' }).eq('id', sel.id)]);
    setSel(x => x ? { ...x, status: 'Compareceu' } : x);
    setReceita(data);
    showToast('Receita gerada! A pré-venda já pode registrar a conversão.');
    setTabAte('receita');
  };

  const [finalizando, setFinalizando] = useState(false);
  const finalizarAtendimento = async () => {
    if (!conferirNasc()) return;
    setFinalizando(true);
    await salvarNascNoCadastro();
    const { error } = await supabase.from('agenda').update({ status: 'Compareceu' }).eq('id', sel.id);
    setFinalizando(false);
    if (error) { alert('Erro ao finalizar: ' + error.message); return; }
    showToast(`Atendimento de ${sel.paciente_nome} finalizado.`);
    setSel(null); setReceita(null); setTabAte('anamnese');
  };

  const [errosRx, setErrosRx] = useState({});
  const PLACEHOLDER_RX = { esf:'PLANO', cil:'PLANO', eixo:'0 a 180', av:'20/20', add:'N/A', dnp:'N/A' };
  // Ao sair do campo: confere a regra e formata (ex.: "1.25" → "+1,25"; cilíndrico "0,75" → "-0,75")
  const formatarRx = fk => {
    const tipo = fk.slice(3), olho = fk.slice(0,2);
    const bruto = form[fk];
    if (String(bruto ?? '').trim() === '') { setErrosRx(e => { const n = {...e}; delete n[fk]; return n; }); return; }
    const r = REGRAS_RX[tipo](bruto);
    setErrosRx(e => { const n = {...e}; if (r.erro) n[fk] = r.erro; else delete n[fk];
      if (tipo === 'cil') delete n[`${olho}_eixo`]; // cilíndrico mudou: reavalia o aviso de eixo na validação final
      return n; });
    if (!r.erro) { setF(fk, r.valor); if (fk === 'od_add') setF('oe_add', r.valor); }
  };
  // Adição é uma só para os dois olhos (AO): um campo que grava em OD e OE
  const rxCell = (fk, extra = {}) => (
    <td key={fk} {...extra} style={{padding:'6px 8px',verticalAlign:extra.rowSpan?'middle':'top',...(extra.rowSpan?{background:C.tealBg}:{})}}>
      {extra.rowSpan && <div style={{fontSize:11,fontWeight:700,color:C.text,textAlign:'center',marginBottom:4}}>AO (ambos os olhos)</div>}
      <input disabled={!podeReceita || !!receita} value={form[fk]} onChange={e=>{ const v=e.target.value; setF(fk,v); if (fk==='od_add') setF('oe_add',v); }} onBlur={()=>formatarRx(fk)}
        placeholder={PLACEHOLDER_RX[fk.slice(3)]} inputMode={fk.endsWith('_av') ? 'text' : 'decimal'}
        style={{border:`1.5px solid ${errosRx[fk]?C.danger:C.border}`,borderRadius:6,padding:'7px 8px',fontSize:13,width:'100%',background:C.white,textAlign:'center'}}/>
      {errosRx[fk] && <div style={{color:C.danger,fontSize:11,marginTop:4,lineHeight:1.3}}>{errosRx[fk]}</div>}
    </td>
  );

  if (!sel) return (
    <div>
      <Toast msg={toast}/>
      <ListaAtendimentos user={user} selectedUnidade={selectedUnidade} onAtender={iniciarAtendimento}/>
    </div>
  );

  const tabs = [
    {id:'anamnese',label:'Anamnese'},
    {id:'refracao',label:'Refração'},
    {id:'receita',label:'Receita',disabled:!receita},
  ];

  return (
    <div>
      <Toast msg={toast}/>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20,flexWrap:'wrap'}}>
        <Btn outline size="sm" color={C.gray} onClick={()=>{setSel(null);setReceita(null);setTabAte('anamnese');}}>Voltar</Btn>
        <div style={{flex:1,minWidth:180}}>
          <h3 style={{fontSize:16,fontWeight:700,color:C.navy}}>{sel.paciente_nome}</h3>
          <p style={{fontSize:12,color:C.gray}}>{sel.procedimento} · {sel.hora} · {fmtDate(sel.data)}</p>
        </div>
        {sel.status === 'Compareceu'
          ? <Badge color={C.success}>Atendimento finalizado</Badge>
          : <Btn color={C.teal} onClick={finalizarAtendimento} disabled={finalizando}>{finalizando ? 'Finalizando...' : 'Finalizar atendimento'}</Btn>}
      </div>
      {/* Tabs */}
      <div style={{display:'flex',gap:4,marginBottom:16,borderBottom:`2px solid ${C.border}`,paddingBottom:0}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>!t.disabled&&setTabAte(t.id)} disabled={t.disabled}
            style={{padding:'10px 20px',border:'none',background:'none',fontWeight:tabAte===t.id?700:400,
              color:t.disabled?C.border:tabAte===t.id?C.text:C.gray,borderBottom:tabAte===t.id?`3px solid ${C.teal}`:'3px solid transparent',cursor:t.disabled?'default':'pointer',fontSize:14}}>
            {t.label}
          </button>
        ))}
      </div>

      {tabAte==='anamnese' && (
        <Card>
          <h4 style={{marginBottom:16,color:C.navy}}>Anamnese</h4>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div style={{maxWidth:280}}>
              <Input label={<>Data de nascimento <span style={{color:C.danger}}>*</span></>} type="date" max={today()} value={form.nasc} disabled={soLeitura}
                onChange={e=>{ setF('nasc',e.target.value); setErroNasc(''); }}
                style={erroNasc ? {['--borda']:C.danger} : {}}/>
              {erroNasc ? <div style={{fontSize:11,color:C.danger,marginTop:4,fontWeight:600}}>{erroNasc}</div>
                : <div style={{fontSize:11,color:C.gray,marginTop:4}}>Obrigatória · sai a idade na receita</div>}
            </div>
            <div><label style={{fontSize:12,fontWeight:600,color:C.textSm,display:'block',marginBottom:4}}>Queixa principal</label>
              <textarea disabled={soLeitura} value={form.queixa} onChange={e=>setF('queixa',maiusc(e).target.value)} rows={3}
                style={{width:'100%',border:`1.5px solid ${C.border}`,borderRadius:8,padding:'8px 12px',fontSize:14,resize:'vertical'}}/></div>
            <div><label style={{fontSize:12,fontWeight:600,color:C.textSm,display:'block',marginBottom:4}}>Medicamentos em uso</label>
              <textarea disabled={soLeitura} value={form.medicamentos} onChange={e=>setF('medicamentos',maiusc(e).target.value)} rows={2}
                style={{width:'100%',border:`1.5px solid ${C.border}`,borderRadius:8,padding:'8px 12px',fontSize:14,resize:'vertical'}}/></div>
            <div><label style={{fontSize:12,fontWeight:600,color:C.textSm,display:'block',marginBottom:4}}>Observações adicionais</label>
              <textarea disabled={soLeitura} value={form.anamnese} onChange={e=>setF('anamnese',maiusc(e).target.value)} rows={3}
                style={{width:'100%',border:`1.5px solid ${C.border}`,borderRadius:8,padding:'8px 12px',fontSize:14,resize:'vertical'}}/></div>
            <div>
              <label style={{fontSize:12,fontWeight:600,color:C.textSm,display:'block',marginBottom:8}}>Tipo de lente sugerido <span style={{color:C.danger}}>*</span></label>
              <div role="radiogroup" style={{display:'flex',gap:12,flexWrap:'wrap'}}>
                {TIPOS_LENTE.map(t=>{
                  const on = form.tipoLente === t.id;
                  return (
                    <button key={t.id} type="button" role="radio" aria-checked={on}
                      disabled={soLeitura} onClick={()=>{ if (!soLeitura) { setF('tipoLente', t.id); setErroTipo(''); } }}
                      style={{flex:'1 1 160px',display:'flex',alignItems:'flex-start',gap:12,textAlign:'left',padding:'14px 16px',borderRadius:12,cursor:soLeitura?'default':'pointer',opacity:soLeitura&&!on?.6:1,
                        border:`1.5px solid ${on?C.teal:(erroTipo?C.danger:C.border)}`,background:on?C.tealBg:C.white,transition:'all .15s'}}>
                      <span style={{flexShrink:0,width:20,height:20,borderRadius:'50%',marginTop:1,display:'flex',alignItems:'center',justifyContent:'center',
                        border:`1.5px solid ${on?C.teal:C.border}`,background:C.white}}>
                        {on && <span style={{width:10,height:10,borderRadius:'50%',background:C.teal}}/>}
                      </span>
                      <span>
                        <span style={{display:'block',fontSize:14,fontWeight:700,color:C.navy}}>{t.label}</span>
                        <span style={{display:'block',fontSize:12,color:C.gray,marginTop:2}}>{t.desc}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {erroTipo ? <div style={{fontSize:11,color:C.danger,marginTop:6,fontWeight:600}}>{erroTipo}</div>
                : <div style={{fontSize:11,color:C.gray,marginTop:6}}>Obrigatório · sai na receita como sugestão</div>}
            </div>
            <div>
              <label style={{fontSize:12,fontWeight:600,color:C.textSm,display:'block',marginBottom:8}}>Tratamentos sugeridos para as lentes</label>
              <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
                {TRATAMENTOS.map(t=>{
                  const on = (form.trat||[]).includes(t.id);
                  return (
                    <button key={t.id} type="button" role="checkbox" aria-checked={on}
                      disabled={soLeitura} onClick={()=>!soLeitura && setF('trat', on ? form.trat.filter(x=>x!==t.id) : [...(form.trat||[]), t.id])}
                      style={{flex:'1 1 200px',display:'flex',alignItems:'flex-start',gap:12,textAlign:'left',padding:'14px 16px',borderRadius:12,cursor:soLeitura?'default':'pointer',opacity:soLeitura&&!on?.6:1,
                        border:`1.5px solid ${on?C.teal:C.border}`,background:on?C.tealBg:C.white,transition:'all .15s'}}>
                      <span style={{flexShrink:0,width:20,height:20,borderRadius:6,marginTop:1,display:'flex',alignItems:'center',justifyContent:'center',
                        border:`1.5px solid ${on?C.teal:C.border}`,background:on?C.teal:C.white}}>
                        {on && <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </span>
                      <span>
                        <span style={{display:'block',fontSize:14,fontWeight:700,color:C.navy}}>{t.label}</span>
                        <span style={{display:'block',fontSize:12,color:C.gray,marginTop:2}}>{t.desc}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div style={{fontSize:11,color:C.gray,marginTop:6}}>Os marcados saem na receita como recomendação.</div>
            </div>
            <div style={{textAlign:'right'}}>{!podeReceita && <span style={{fontSize:13,color:C.gray,fontWeight:600,marginRight:12}}>Somente o optometrista pode preencher a anamnese e a receita.</span>}
              <Btn color={C.teal} onClick={()=>{ if (soLeitura || (conferirNasc() && conferirTipo())) setTabAte('refracao'); }}>Próximo: Refração</Btn></div>
          </div>
        </Card>
      )}

      {tabAte==='refracao' && (
        <Card>
          <h4 style={{marginBottom:16,color:C.navy}}>Refração</h4>
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{background:C.teal,color:C.white}}>
                <th style={{padding:'8px 12px',textAlign:'left'}}>Olho</th>
                {['Esférico','Cilíndrico (−)','Eixo (0–180)','AV','Adição (AO)','DNP (mm)'].map(h=><th key={h} style={{padding:'8px 12px',textAlign:'center'}}>{h}</th>)}
              </tr></thead>
              <tbody>
                <tr style={{background:C.bg}}>
                  <td style={{padding:'8px 12px',fontWeight:700,color:C.text}}>OD</td>
                  {CAMPOS_RX.map(c => c === 'add' ? rxCell('od_add', { rowSpan: 2 }) : rxCell(`od_${c}`))}
                </tr>
                <tr>
                  <td style={{padding:'8px 12px',fontWeight:700,color:C.text}}>OE</td>
                  {CAMPOS_RX.filter(c => c !== 'add').map(c => rxCell(`oe_${c}`))}
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',marginTop:16,flexWrap:'wrap',gap:8}}>
            <Btn color={C.gray} outline onClick={()=>setTabAte('anamnese')}>Anamnese</Btn>
            {!receita && podeReceita && <Btn color={C.teal} onClick={gerarReceita}>Gerar Receita</Btn>}
            {!receita && !podeReceita && <span style={{fontSize:13,color:C.gray,fontWeight:600,alignSelf:'center'}}>Somente o optometrista pode preencher e gerar a receita.</span>}
            {receita && <Badge color={C.success}>Receita gerada — disponível para conversão</Badge>}
          </div>
          <p style={{fontSize:12,color:C.gray,marginTop:12}}>
            Digite os valores (vírgula ou ponto). O cilíndrico é sempre negativo, o eixo vai de 0 a 180 e é obrigatório quando há cilíndrico. A adição é única para os dois olhos (AO). Campos vazios saem como "Plano" ou "N/A".
          </p>
        </Card>
      )}

      {tabAte==='receita' && receita && (
        <Card>
          <h4 style={{marginBottom:4,color:C.navy}}>Receita — {receita.paciente_nome}</h4>
          <p style={{fontSize:12,color:C.gray,marginBottom:16}}>Emitida em {fmtDate(receita.data)} · {receita.opto_nome}</p>
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:14,border:`1px solid ${C.border}`}}>
              <thead><tr style={{background:C.teal,color:C.white}}>
                <th style={{padding:'8px 12px'}}>Olho</th>
                {['Esférico','Cilíndrico','Eixo','AV','Adição','DNP'].map(h=><th key={h} style={{padding:'8px 12px'}}>{h}</th>)}
              </tr></thead>
              <tbody>
                {[['OD','od_esf','od_cil','od_eixo','od_av','od_adicao','od_dnp'],
                  ['OE','oe_esf','oe_cil','oe_eixo','oe_av','oe_adicao','oe_dnp']].map(([lbl,...fields],i)=>{
                  const ao = receita.od_adicao === receita.oe_adicao;
                  return (
                  <tr key={lbl} style={{textAlign:'center'}}>
                    <td style={{padding:'8px 12px',fontWeight:700,color:C.text}}>{lbl}</td>
                    {fields.map(f=>{
                      if (f.endsWith('_adicao') && ao) return i===0 ? <td key={f} rowSpan={2} style={{padding:'8px 12px',background:C.tealBg}}><div style={{fontSize:11,fontWeight:700,color:C.text}}>AO</div>{receita.od_adicao||'—'}</td> : null;
                      return <td key={f} style={{padding:'8px 12px'}}>{receita[f]||'—'}</td>;
                    })}
                  </tr>
                );})}
              </tbody>
            </table>
          </div>
          {(receita.tratamentos_sugeridos||[]).length > 0 && (
            <div style={{marginTop:14,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
              <span style={{fontSize:12,fontWeight:700,color:C.textSm}}>Tratamentos recomendados:</span>
              {receita.tratamentos_sugeridos.map(t=><Badge key={t} color={C.teal}>{nomeTrat(t)}</Badge>)}
            </div>
          )}
          <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:16,flexWrap:'wrap'}}>
            <Btn outline color={C.teal} onClick={()=>setDeclaracao(true)}>Declaração de comparecimento</Btn>
            <Btn color={C.teal} onClick={()=>imprimirReceita(receita)}>Imprimir Receita</Btn>
          </div>
          {declaracao && <DeclaracaoModal receita={receita} horaAgenda={sel.hora} onClose={()=>setDeclaracao(false)}/>}
        </Card>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   CONVERSÃO
══════════════════════════════════════════════════════ */
function Conversao({ user, selectedUnidade='' }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const per = usePeriodo('hoje');
  const [filtros, setFiltros] = useState({ status:'', opto:'', busca:'' });
  const [toast, setToast] = useState('');
  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  // Realtime: nova receita ou conversão aparece automaticamente
  useRealtime('receitas', () => load());
  useRealtime('conversoes', () => load());

  const load = useCallback(async () => {
    let q = supabase.from('receitas').select('*,agenda(*)').order('data',{ascending:false});
    if (per.de) q = q.gte('data', per.de).lte('data', per.ate);
    if (selectedUnidade) q = q.eq('unidade', selectedUnidade);
    const {data: receitas} = await q;
    // buscar conversoes para cada receita
    // conversões ligadas às receitas da lista (pela receita, não pela unidade)
    const ids = (receitas||[]).map(r=>r.id);
    const {data: convs} = ids.length ? await supabase.from('conversoes').select('*').in('receita_id', ids) : { data: [] };
    const convMap = {};
    (convs||[]).forEach(c=>{ convMap[c.receita_id]=c; });
    setRows((receitas||[]).map(r=>({...r, conversao: convMap[r.id]||null})));
    setLoading(false);
  }, [per.de, per.ate, selectedUnidade]);

  useEffect(()=>{ load(); },[load]);

  const handleSalvar = async (receitaId, pacienteNome, optoNome, dados) => {
    const existing = rows.find(r=>r.id===receitaId)?.conversao;
    const row = {
      id: existing?.id||uid(), receita_id:receitaId, paciente_nome:pacienteNome,
      opto_nome:optoNome, data:today(), converteu:dados.converteu,
      valor_venda:dados.valor||0, produto:dados.produto||'',
      prevenda_id:user.id, prevenda_nome:user.nome,
      unidade: rows.find(r=>r.id===receitaId)?.unidade || existing?.unidade || null,
    };
    if (existing) await supabase.from('conversoes').update(row).eq('id',existing.id);
    else await supabase.from('conversoes').insert(row);
    showToast(dados.converteu ? 'Conversão registrada!' : 'Marcado como não convertido.');
    setModal(null);
    load();
  };

  const situacao = r => !r.conversao ? 'Pendente' : r.conversao.converteu ? 'Convertido' : 'Não convertido';
  const optosC = [...new Set(rows.map(r=>r.opto_nome).filter(Boolean))].sort();
  const lista = rows.filter(r => (!filtros.status || situacao(r) === filtros.status) && (!filtros.opto || r.opto_nome === filtros.opto) && casaNome(r.paciente_nome, filtros.busca));
  const convTotal = lista.filter(r=>r.conversao?.converteu).length;
  const valorTotal = lista.filter(r=>r.conversao?.converteu).reduce((s,r)=>s+Number(r.conversao?.valor_venda||0),0);
  const pendentes = lista.filter(r=>!r.conversao).length;

  return (
    <div>
      <Toast msg={toast}/>
      <TopoTela titulo="Conversão" subtitulo={textoPeriodo(per.de, per.ate)}>
        <FiltroPeriodo p={per} comTudo/>
      </TopoTela>
      <div className="resp-grid-4" style={{marginBottom:16}}>
        {[['Receitas no período', lista.length],['Convertidas', convTotal],['Valor vendido', fmtMoney(valorTotal)],['Pendentes', pendentes]].map(([l,v])=>(
          <Card key={l} style={{padding:'20px 18px'}}><div style={{fontSize:28,fontWeight:800,color:C.navy,lineHeight:1}}>{v}</div><div style={{fontSize:12,color:C.navy,fontWeight:600,marginTop:4}}>{l}</div></Card>
        ))}
      </div>
      <Card style={{marginBottom:16}}>
        <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'flex-end'}}>
          <Busca value={filtros.busca} onChange={v=>setFiltros(f=>({...f,busca:v}))}/>
          <Select label="Situação" value={filtros.status} onChange={e=>setFiltros(f=>({...f,status:e.target.value}))}
            options={[{value:'',label:'Todas'},{value:'Pendente',label:'Pendente'},{value:'Convertido',label:'Convertido'},{value:'Não convertido',label:'Não convertido'}]}/>
          <Select label="Optometrista" value={filtros.opto} onChange={e=>setFiltros(f=>({...f,opto:e.target.value}))}
            options={[{value:'',label:'Todos'},...optosC.map(n=>({value:n,label:n}))]}/>
        </div>
      </Card>
      {loading ? <Spinner/> : (
        <Card>
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr style={{background:C.teal,color:C.white}}>
                {['Data','Paciente','Optometrista','OD Esf','OE Esf','Status','Valor',''].map(h=>(
                  <th key={h} style={{padding:'9px 12px',textAlign:'left',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {lista.length===0 && <tr><td colSpan={8} style={{padding:24,textAlign:'center',color:C.gray}}>Nenhuma receita no período</td></tr>}
                {lista.map((r,i)=>(
                  <tr key={r.id} style={{background:i%2===0?C.white:C.bg,borderBottom:`1px solid ${C.border}`}}>
                    <td style={{padding:'8px 12px'}}>{fmtDate(r.data)}</td>
                    <td style={{padding:'8px 12px',fontWeight:500}}>{r.paciente_nome}</td>
                    <td style={{padding:'8px 12px'}}>{r.opto_nome}</td>
                    <td style={{padding:'8px 12px'}}>{r.od_esf}</td>
                    <td style={{padding:'8px 12px'}}>{r.oe_esf}</td>
                    <td style={{padding:'8px 12px'}}>
                      {r.conversao
                        ? <Badge color={r.conversao.converteu?C.success:C.orange}>{r.conversao.converteu?'Convertido':'Não convertido'}</Badge>
                        : <Badge color={C.gray}>Pendente</Badge>}
                    </td>
                    <td style={{padding:'8px 12px'}}>{r.conversao?.converteu ? fmtMoney(r.conversao.valor_venda) : '—'}</td>
                    <td style={{padding:'8px 12px'}}>
                      <Btn size="sm" color={C.teal} onClick={()=>setModal(r)}>
                        {r.conversao ? 'Editar' : 'Registrar'}
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {modal && <ConvModal receita={modal} onSave={handleSalvar} onClose={()=>setModal(null)}/>}
    </div>
  );
}

function ConvModal({ receita, onSave, onClose }) {
  const conv = receita.conversao;
  const [converteu, setConverteu] = useState(conv?.converteu ?? null);
  const [valor, setValor] = useState(conv?.valor_venda||'');
  const [produto, setProduto] = useState(conv?.produto||'');
  return (
    <Modal title="Registrar Conversão" onClose={onClose} width={480}>
      <div style={{marginBottom:20}}>
        <p style={{fontWeight:600,color:C.navy,marginBottom:4}}>{receita.paciente_nome}</p>
        <p style={{fontSize:12,color:C.gray}}>OD: {receita.od_esf} / OE: {receita.oe_esf} · {fmtDate(receita.data)}</p>
      </div>
      <p style={{fontWeight:600,marginBottom:12,color:C.navy}}>Converteu a venda?</p>
      <div style={{display:'flex',gap:12,marginBottom:20}}>
        <button onClick={()=>setConverteu(true)} style={{flex:1,padding:'20px',border:`3px solid ${converteu===true?C.success:C.border}`,borderRadius:16,background:converteu===true?C.success+'11':C.white,color:converteu===true?C.success:C.gray,fontWeight:700,fontSize:16,cursor:'pointer'}}>
          SIM
        </button>
        <button onClick={()=>setConverteu(false)} style={{flex:1,padding:'20px',border:`3px solid ${converteu===false?C.danger:C.border}`,borderRadius:16,background:converteu===false?C.danger+'11':C.white,color:converteu===false?C.danger:C.gray,fontWeight:700,fontSize:16,cursor:'pointer'}}>
          NÃO
        </button>
      </div>
      {converteu===true && <>
        <Input label="Valor da venda (R$)" type="number" value={valor} onChange={e=>setValor(e.target.value)} placeholder="0,00" style={{marginBottom:12}}/>
        <Input label="Produto vendido" value={produto} onChange={e=>setProduto(e.target.value)} placeholder="Ex: Oculos completo, lente de contato..." style={{marginBottom:12}}/>
      </>}
      {converteu===false && <div style={{background:C.orangeBg,borderRadius:10,padding:12,marginBottom:12,fontSize:13,color:C.orange}}>Este paciente sera listado no No-Show para reagendamento.</div>}
      <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:8}}>
        <Btn color={C.gray} outline onClick={onClose}>Cancelar</Btn>
        <Btn color={C.teal} onClick={()=>converteu!==null&&onSave(receita.id,receita.paciente_nome,receita.opto_nome,{converteu,valor,produto})} disabled={converteu===null}>Salvar</Btn>
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════
   NO-SHOW
══════════════════════════════════════════════════════ */
function NoShow({ user, selectedUnidade='' }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const per = usePeriodo('hoje');
  const [filtros, setFiltros] = useState({ motivo:'', opto:'', resp:'', busca:'' });
  const [reagendar, setReagendar] = useState(null);
  const [toast, setToast] = useState('');
  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  const load = useCallback(async () => {
    // Não compareceu + compareceu e não comprou (mesma regra da Agenda)
    let q = supabase.from('agenda').select('*').in('status', ['Não Compareceu','Compareceu']).order('data',{ascending:false}).order('hora');
    if (per.de) q = q.gte('data', per.de).lte('data', per.ate);
    const unidade = user.unidade || selectedUnidade;
    if (unidade) q = q.eq('unidade', unidade);
    const { data } = await q;
    const comCompra = await anexarCompras(data||[]);
    setRows(comCompra.filter(a => a.status === 'Não Compareceu' || (a.status === 'Compareceu' && !a._compra?.converteu)));
    setLoading(false);
  }, [per.de, per.ate, selectedUnidade, user]);

  useEffect(()=>{ load(); },[load]);
  useRealtime('agenda', () => load());
  useRealtime('conversoes', () => load());

  const salvarReagendamento = async ({ data, hora }) => {
    const a = reagendar;
    const { error } = await supabase.from('agenda').update({
      data, hora, status: 'Agendado', calendar_updated: false,
      ...(a.google_event_id ? { google_sync_pendente: true } : {}),
    }).eq('id', a.id);
    if (error) { alert('Erro ao reagendar: ' + error.message); return; }
    setReagendar(null);
    showToast(`${a.paciente_nome} reagendado para ${fmtDate(data)} às ${hora}`);
    load();
  };

  const optos = [...new Set(rows.map(r=>r.opto_nome).filter(Boolean))].sort();
  const resps = [...new Set(rows.map(r=>r.agendado_por||'(sem responsável)'))].sort();
  const lista = rows.filter(r =>
    (!filtros.motivo || jornada(r).label === filtros.motivo) &&
    (!filtros.opto || r.opto_nome === filtros.opto) &&
    (!filtros.resp || (r.agendado_por||'(sem responsável)') === filtros.resp) &&
    casaNome(r.paciente_nome, filtros.busca));
  const nNao = lista.filter(r=>r.status==='Não Compareceu').length;

  return (
    <div>
      <Toast msg={toast}/>
      {reagendar && <ReagendarModal item={reagendar} onSave={salvarReagendamento} onClose={()=>setReagendar(null)}/>}
      <TopoTela titulo="No-Show" subtitulo={`${textoPeriodo(per.de, per.ate)} · ${nNao} não compareceu · ${lista.length - nNao} compareceu e não comprou`}>
        <FiltroPeriodo p={per} comTudo/>
      </TopoTela>
      <Card style={{marginBottom:16}}>
        <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'flex-end'}}>
          <Busca value={filtros.busca} onChange={v=>setFiltros(f=>({...f,busca:v}))}/>
          <Select label="Motivo" value={filtros.motivo} onChange={e=>setFiltros(f=>({...f,motivo:e.target.value}))}
            options={[{value:'',label:'Todos'},{value:'Não compareceu',label:'Não compareceu'},{value:'Não comprou',label:'Compareceu e não comprou'}]}/>
          <Select label="Optometrista" value={filtros.opto} onChange={e=>setFiltros(f=>({...f,opto:e.target.value}))}
            options={[{value:'',label:'Todos'},...optos.map(n=>({value:n,label:n}))]}/>
          <Select label="Agendado por" value={filtros.resp} onChange={e=>setFiltros(f=>({...f,resp:e.target.value}))}
            options={[{value:'',label:'Todos'},...resps.map(n=>({value:n,label:n}))]}/>
        </div>
      </Card>
      {loading ? <Spinner/> : (
        <Card>
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr style={{background:C.teal,color:C.white}}>
                {['Data','Hora','Paciente','Telefone','Optometrista','Agendado por','Situação',''].map(h=>(
                  <th key={h} style={{padding:'9px 12px',textAlign:'left',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {lista.length===0 && <tr><td colSpan={8} style={{padding:24,textAlign:'center',color:C.gray}}>Nenhum paciente no período</td></tr>}
                {lista.map((r,i)=>(
                  <tr key={r.id} style={{background:i%2===0?C.white:C.bg,borderBottom:`1px solid ${C.border}`}}>
                    <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>{fmtDate(r.data)}</td>
                    <td style={{padding:'8px 12px',fontWeight:700,color:C.text}}>{r.hora}</td>
                    <td style={{padding:'8px 12px',fontWeight:500}}>{r.paciente_nome}</td>
                    <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>{r.paciente_telefone||'—'}</td>
                    <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>{r.opto_nome||'—'}</td>
                    <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>{r.agendado_por||'—'}</td>
                    <td style={{padding:'8px 12px'}}><StatusJornada a={r}/></td>
                    <td style={{padding:'8px 12px'}}>
                      {r.status==='Não Compareceu' && <Btn outline size="sm" color={C.teal} style={{width:112,padding:'7px 0'}} onClick={()=>setReagendar(r)}>Reagendar</Btn>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   RELATÓRIOS
══════════════════════════════════════════════════════ */
/* ── Filtro de período padrão (Hoje / Semana / Mês / Personalizado / Tudo) ── */
function usePeriodo(inicial='hoje') {
  const [periodo, setPeriodo] = useState(inicial);
  const [custom, setCustom] = useState({ de: today(), ate: today() });
  const { de, ate } = periodo === 'tudo' ? { de:'', ate:'' } : periodoDatas(periodo, custom.de, custom.ate);
  return { periodo, setPeriodo, custom, setCustom, de, ate };
}
const textoPeriodo = (de, ate) => !de ? 'Todo o período' : de === ate ? fmtDate(de) : `${fmtDate(de)} a ${fmtDate(ate)}`;
const FiltroPeriodo = ({ p, comTudo }) => {
  const ops = [['hoje','Hoje'],['semana','Semana'],['mes','Mês'],['personalizado','Personalizado'], ...(comTudo ? [['tudo','Tudo']] : [])];
  return (
    <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'flex-end'}}>
      {p.periodo === 'personalizado' && <>
        <Input label="De" type="date" value={p.custom.de} onChange={e=>{ const v=e.target.value; p.setCustom(c=>({...c,de:v, ate: c.ate < v ? v : c.ate})); }}/>
        <Input label="Até" type="date" value={p.custom.ate} min={p.custom.de} onChange={e=>{ const v=e.target.value; p.setCustom(c=>({...c,ate:v})); }}/>
      </>}
      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
        {ops.map(([id,label])=>{
          const ativo = p.periodo === id;
          return <button key={id} onClick={()=>p.setPeriodo(id)}
            style={{padding:'8px 14px',borderRadius:999,fontSize:13,fontWeight:600,cursor:'pointer',
              border:`1.5px solid ${ativo?C.teal:C.border}`,background:ativo?C.teal:C.white,color:ativo?C.white:C.textSm}}>{label}</button>;
        })}
      </div>
    </div>
  );
};
// Cabeçalho padrão das telas com filtro de período
const TopoTela = ({ titulo, subtitulo, children }) => (
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',gap:16,flexWrap:'wrap',marginBottom:16}}>
    <div>
      <h2 style={{fontSize:22,fontWeight:800,color:C.navy}}>{titulo}</h2>
      {subtitulo && <p style={{color:C.gray,fontSize:13,marginTop:2}}>{subtitulo}</p>}
    </div>
    {children}
  </div>
);
const Busca = ({ value, onChange }) => <Input label="Paciente" placeholder="Buscar pelo nome" value={value} onChange={e=>onChange(e.target.value)} style={{minWidth:200}}/>;
const casaNome = (nome, busca) => !busca || String(nome||'').toLowerCase().includes(busca.trim().toLowerCase());
// Variação compacta (para tabelas)
const Mini = ({ atual, anterior, inverso }) => {
  const dif = (atual||0) - (anterior||0);
  if (!dif) return <span style={{fontSize:11,color:C.gray,marginLeft:6}}>=</span>;
  const bom = inverso ? dif < 0 : dif > 0;
  return <span title={`Período anterior: ${anterior||0}`} style={{fontSize:11,fontWeight:700,marginLeft:6,color:bom?C.success:C.danger}}>{dif>0?'▲':'▼'}{Math.abs(dif)}</span>;
};

// Período anterior equivalente (mês → mês anterior; demais → mesmo nº de dias imediatamente antes)
const periodoAnterior = (tipo, de, ate) => {
  const d = x => new Date(x + 'T12:00:00');
  if (tipo === 'mes') { const ini = d(de); return { de: ymd(new Date(ini.getFullYear(), ini.getMonth()-1, 1)), ate: ymd(new Date(ini.getFullYear(), ini.getMonth(), 0)) }; }
  const dias = Math.round((d(ate) - d(de)) / 864e5) + 1;
  const fim = d(de); fim.setDate(fim.getDate() - 1);
  const ini = new Date(fim); ini.setDate(fim.getDate() - dias + 1);
  return { de: ymd(ini), ate: ymd(fim) };
};

// Funil da Visão Ideal a partir dos agendamentos do período (cancelados ficam fora)
const montarFunil = (ag, rec, conv) => {
  const lista = ag.filter(a => a.status !== 'Cancelado');
  const recPorAgenda = {}; rec.forEach(r => { if (r.agenda_id) recPorAgenda[r.agenda_id] = r.id; });
  const convPorReceita = {}; conv.forEach(c => { if (!convPorReceita[c.receita_id] || c.converteu) convPorReceita[c.receita_id] = c; });
  const compareceu = lista.filter(a => a.status === 'Compareceu');
  const compras = compareceu.map(a => convPorReceita[recPorAgenda[a.id]]).filter(c => c?.converteu);
  return {
    agendados: lista.length,
    aguardando: lista.filter(a => a.status === 'Agendado').length,
    compareceu: compareceu.length,
    naoCompareceu: lista.filter(a => a.status === 'Não Compareceu').length,
    comprou: compras.length,
    naoComprou: compareceu.length - compras.length,
    faturamento: compras.reduce((s, c) => s + Number(c.valor_venda || 0), 0),
  };
};
const pct = (a, b) => b ? Math.round((a / b) * 100) : 0;

function Relatorios({ selectedUnidade='' }) {
  const [optos, setOptos] = useState([]);
  const [stats, setStats] = useState([]);
  const [statsPrev, setStatsPrev] = useState([]);
  const [funil, setFunil] = useState(null);
  const [funilAnt, setFunilAnt] = useState(null);
  const [loading, setLoading] = useState(true);
  const per = usePeriodo('hoje');
  const { periodo, de, ate } = per;
  const ant = periodoAnterior(periodo, de, ate);
  const [filtros, setFiltros] = useState({ opto:'', resp:'', proc:'', contato:'' });
  const [opcoes, setOpcoes] = useState({ resp:[], proc:[], contato:[] });
  const texto = (x, y) => x === y ? fmtDate(x) : `${fmtDate(x)} a ${fmtDate(y)}`;

  const load = useCallback(async () => {
    setLoading(true);
    const applyU = q => selectedUnidade ? q.eq('unidade', selectedUnidade) : q;
    const entre = q => q.gte('data', ant.de).lte('data', ate);
    const [oLista, agRes, recRes, convRes] = await Promise.all([
      listarUsuarios(),
      applyU(entre(supabase.from('agenda').select('id,data,status,opto_id,agendado_por,unidade,procedimento,meio_contato'))),
      applyU(supabase.from('receitas').select('id,agenda_id,opto_id,data,unidade')),
      supabase.from('conversoes').select('receita_id,converteu,valor_venda'),
    ]);
    try {
    const os = (oLista||[]).filter(u=>u.perfil==='opto'&&u.ativo);
    const rec = recRes.data||[];
    const conv = convRes.data||[];
    const agBruto = agRes.data||[];
    const uniq = k => [...new Set(agBruto.map(a=>a[k]||'').filter(Boolean))].sort();
    setOpcoes({ resp: [...new Set(agBruto.map(a=>a.agendado_por||'(sem responsável)'))].sort(), proc: uniq('procedimento'), contato: uniq('meio_contato') });
    const agTudo = agBruto.filter(a =>
      (!filtros.opto || a.opto_id === filtros.opto) &&
      (!filtros.resp || (a.agendado_por||'(sem responsável)') === filtros.resp) &&
      (!filtros.proc || a.procedimento === filtros.proc) &&
      (!filtros.contato || a.meio_contato === filtros.contato));
    const noPer = (x, y) => agTudo.filter(a=>a.data>=x && a.data<=y);
    const ag = noPer(de, ate), agAnt = noPer(ant.de, ant.ate);
    setFunil(montarFunil(ag, rec, conv));
    setFunilAnt(montarFunil(agAnt, rec, conv));
    setOptos(os);

    // Por optometrista (período atual e anterior)
    const porOpto = (agP, x, y) => {
      const recP = rec.filter(r=>r.data>=x && r.data<=y);
      const m = {};
      os.forEach(o=>{
        const mAg = agP.filter(a=>a.opto_id===o.id && a.status!=='Cancelado');
        const mRec = recP.filter(r=>r.opto_id===o.id);
        const recIds = new Set(mRec.map(r=>r.id));
        const conv1 = conv.filter(c=>recIds.has(c.receita_id) && c.converteu);
        const comp = mAg.filter(a=>a.status==='Compareceu').length;
        m[o.id] = { nome:o.nome, cro:o.cro, agendados:mAg.length, compareceu:comp,
          naoComp:mAg.filter(a=>a.status==='Não Compareceu').length, receitas:mRec.length,
          conversoes:conv1.length, taxaConv:pct(conv1.length, mRec.length),
          valorTotal:conv1.reduce((t,c)=>t+Number(c.valor_venda||0),0) };
      });
      return m;
    };
    const oAt = porOpto(ag, de, ate), oAn = porOpto(agAnt, ant.de, ant.ate);
    setStats(os.filter(o=>!filtros.opto || o.id===filtros.opto).map(o=>({ ...oAt[o.id], ant: oAn[o.id] })));

    // Ranking por responsável (período atual e anterior)
    const porResp = agP => {
      const m = {};
      agP.filter(a=>a.status!=='Cancelado').forEach(a=>{
        const nome = a.agendado_por||'(sem responsável)';
        if (!m[nome]) m[nome] = {nome, agendados:0, compareceu:0, naoComp:0};
        m[nome].agendados++;
        if (a.status==='Compareceu') m[nome].compareceu++;
        if (a.status==='Não Compareceu') m[nome].naoComp++;
      });
      return m;
    };
    const rAt = porResp(ag), rAn = porResp(agAnt);
    setStatsPrev(Object.values(rAt).map(r=>({ ...r, ant: rAn[r.nome] || {agendados:0,compareceu:0,naoComp:0} })).sort((a,b)=>b.agendados-a.agendados));
    } catch (e) { console.error('relatorio', e); }
    setLoading(false);
  }, [de, ate, ant.de, ant.ate, selectedUnidade, filtros]);

  useEffect(()=>{ load(); },[load]);

  const f = funil || {}, fa = funilAnt || {};

  // Variação contra o período anterior
  const Delta = ({ atual, anterior, dinheiro, inverso }) => {
    if (!anterior && !atual) return <span style={{fontSize:12,color:C.gray}}>sem dados no período anterior</span>;
    const dif = (atual||0) - (anterior||0);
    const varPct = anterior ? Math.round((dif / anterior) * 100) : null;
    const bom = inverso ? dif < 0 : dif > 0;
    const cor = dif === 0 ? C.gray : bom ? C.success : C.danger;
    return <span style={{fontSize:12,color:C.gray}}>
      <span style={{color:cor,fontWeight:700}}>{dif > 0 ? '▲' : dif < 0 ? '▼' : '='} {varPct !== null ? `${Math.abs(varPct)}%` : (dif > 0 ? 'novo' : '')}</span>
      {' '}vs {dinheiro ? fmtMoney(anterior) : (anterior||0)} antes
    </span>;
  };

  // Etapa do funil
  const Etapa = ({ titulo, valor, base, cor=C.teal, anterior, inverso, pendente, children }) => (
    <div style={{flex:1,minWidth:150,background:cor+'0F',borderRadius:14,padding:'16px 20px',
      border:`2px solid ${pendente?C.border:cor}`,opacity:pendente?.75:1}}>
      <div style={{fontSize:12,fontWeight:700,color:cor,textTransform:'uppercase',letterSpacing:.4}}>{titulo}</div>
      <div style={{display:'flex',alignItems:'baseline',gap:8,marginTop:6}}>
        <span style={{fontSize:32,fontWeight:800,color:C.navy,lineHeight:1.1}}>{pendente ? '—' : valor}</span>
        {base !== undefined && !pendente && <span style={{fontSize:13,fontWeight:700,color:cor}}>{pct(valor, base)}%</span>}
      </div>
      <div style={{marginTop:6}}>{pendente ? <span style={{fontSize:12,color:C.gray}}>{pendente}</span> : <Delta atual={valor} anterior={anterior} inverso={inverso}/>}</div>
      {children}
    </div>
  );
  const Seta = () => <div style={{display:'flex',justifyContent:'center',color:C.gray,fontSize:18,lineHeight:1,padding:'6px 0'}}>↓</div>;

  return (
    <div>
      <TopoTela titulo="Funil Visão Ideal" subtitulo={`${texto(de, ate)} · comparado com ${texto(ant.de, ant.ate)}`}>
        <FiltroPeriodo p={per}/>
      </TopoTela>
      <Card style={{marginBottom:16}}>
        <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'flex-end'}}>
          <Select label="Optometrista" value={filtros.opto} onChange={e=>setFiltros(f=>({...f,opto:e.target.value}))}
            options={[{value:'',label:'Todos'},...optos.map(o=>({value:o.id,label:o.nome}))]}/>
          <Select label="Agendado por" value={filtros.resp} onChange={e=>setFiltros(f=>({...f,resp:e.target.value}))}
            options={[{value:'',label:'Todos'},...opcoes.resp.map(n=>({value:n,label:n}))]}/>
          <Select label="Procedimento" value={filtros.proc} onChange={e=>setFiltros(f=>({...f,proc:e.target.value}))}
            options={[{value:'',label:'Todos'},...opcoes.proc.map(n=>({value:n,label:n}))]}/>
          <Select label="Meio de contato" value={filtros.contato} onChange={e=>setFiltros(f=>({...f,contato:e.target.value}))}
            options={[{value:'',label:'Todos'},...opcoes.contato.map(n=>({value:n,label:n}))]}/>
          {Object.values(filtros).some(Boolean) && <Btn outline size="sm" color={C.gray} onClick={()=>setFiltros({ opto:'', resp:'', proc:'', contato:'' })}>Limpar filtros</Btn>}
        </div>
      </Card>

      {loading || !funil ? <Spinner/> : (
        <Card style={{marginBottom:20,padding:24}}>
          {/* 1. Agendados */}
          <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
            <Etapa titulo="Agendados" valor={f.agendados} anterior={fa.agendados} cor={C.teal}>
              {f.aguardando > 0 && <div style={{fontSize:12,color:C.gray,marginTop:4}}>{f.aguardando} ainda por vir</div>}
            </Etapa>
          </div>
          <Seta/>
          {/* 2. Compareceu x Não compareceu */}
          <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
            <Etapa titulo="Compareceu" valor={f.compareceu} base={f.agendados} anterior={fa.compareceu} cor={C.teal}/>
            <Etapa titulo="Não compareceu" valor={f.naoCompareceu} base={f.agendados} anterior={fa.naoCompareceu} cor={C.danger} inverso/>
          </div>
          <Seta/>
          {/* 3. Comprou x Não comprou */}
          <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
            <Etapa titulo="Comprou" valor={f.comprou} base={f.compareceu} anterior={fa.comprou} cor={C.success}>
              <div style={{fontSize:14,fontWeight:700,color:C.navy,marginTop:8}}>{fmtMoney(f.faturamento)}</div>
              <Delta atual={f.faturamento} anterior={fa.faturamento} dinheiro/>
            </Etapa>
            <Etapa titulo="Não comprou" valor={f.naoComprou} base={f.compareceu} anterior={fa.naoComprou} cor={C.orange} inverso/>
          </div>
          <p style={{fontSize:12,color:C.gray,marginTop:16,lineHeight:1.5}}>
            Os percentuais são sobre a etapa anterior. "Comprou" vem da venda no PDV ligada à receita do exame (ou do registro da pré-venda). Cancelados ficam fora do funil.
          </p>
        </Card>
      )}

      {loading ? <Spinner/> : (<>
        {/* RANKING PRÉ-VENDAS */}
        <Card style={{marginBottom:20}}>
          <h3 style={{fontSize:15,fontWeight:700,marginBottom:4,color:C.navy}}>Ranking por Responsável pelo Agendamento</h3>
          <p style={{fontSize:12,color:C.gray,marginBottom:14}}>Inclui pré-vendas, gerentes e IA · ▲▼ = diferença para o período anterior</p>
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr style={{background:C.teal,color:C.white}}>
                {['#','Responsável','Agendamentos','Comparecimentos','No-Show','% Comparecimento'].map(h=>(
                  <th key={h} style={{padding:'9px 12px',textAlign:'left',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {statsPrev.map((s,i)=>{
                  const taxaShow = s.agendados ? Math.round((s.compareceu/s.agendados)*100) : 0;
                  const isIA = s.nome==='IA';
                  return (
                  <tr key={s.nome} style={{background:i%2===0?C.white:C.bg,borderBottom:`1px solid ${C.border}`}}>
                    <td style={{padding:'8px 12px',fontWeight:800,color:i===0?C.navy:C.gray,fontSize:i===0?16:13}}>{i+1}°</td>
                    <td style={{padding:'8px 12px'}}>
                      <span style={{
                        display:'inline-block',padding:'2px 10px',borderRadius:20,fontSize:12,fontWeight:700,
                        background: isIA?C.orangeBg:C.tealBg,
                        color: isIA?C.orange:C.teal
                      }}>{s.nome}</span>
                    </td>
                    <td style={{padding:'8px 12px',fontWeight:700,color:C.navy,whiteSpace:'nowrap'}}>{s.agendados}<Mini atual={s.agendados} anterior={s.ant.agendados}/></td>
                    <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>{s.compareceu}<Mini atual={s.compareceu} anterior={s.ant.compareceu}/></td>
                    <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>{s.naoComp}<Mini atual={s.naoComp} anterior={s.ant.naoComp} inverso/></td>
                    <td style={{padding:'8px 12px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{flex:1,height:6,background:C.grayL,borderRadius:3,overflow:'hidden'}}>
                          <div style={{height:'100%',width:`${taxaShow}%`,background:C.teal,borderRadius:3,transition:'width .3s'}}/>
                        </div>
                        <span style={{fontSize:12,fontWeight:600,minWidth:32}}>{taxaShow}%</span>
                      </div>
                    </td>
                  </tr>
                )})}
                {statsPrev.length===0 && <tr><td colSpan={6} style={{padding:20,textAlign:'center',color:C.gray}}>Nenhum dado no período</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        {/* POR OPTOMETRISTA */}
        <Card>
          <h3 style={{fontSize:15,fontWeight:700,marginBottom:14,color:C.navy}}>Por Optometrista</h3>
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr style={{background:C.teal,color:C.white}}>
                {['Optometrista','CRO','Agend.','Comp.','No-Show','Receitas','Conversões','% Conv','Faturamento'].map(h=>(
                  <th key={h} style={{padding:'9px 12px',textAlign:'left',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {stats.map((s,i)=>(
                  <tr key={s.nome} style={{background:i%2===0?C.white:C.bg,borderBottom:`1px solid ${C.border}`}}>
                    <td style={{padding:'8px 12px',fontWeight:600}}>{s.nome}</td>
                    <td style={{padding:'8px 12px',fontSize:11,color:C.gray}}>{s.cro||'—'}</td>
                    <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>{s.agendados}<Mini atual={s.agendados} anterior={s.ant?.agendados}/></td>
                    <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>{s.compareceu}<Mini atual={s.compareceu} anterior={s.ant?.compareceu}/></td>
                    <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>{s.naoComp}<Mini atual={s.naoComp} anterior={s.ant?.naoComp} inverso/></td>
                    <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>{s.receitas}<Mini atual={s.receitas} anterior={s.ant?.receitas}/></td>
                    <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>{s.conversoes}<Mini atual={s.conversoes} anterior={s.ant?.conversoes}/></td>
                    <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>{s.taxaConv}%<Mini atual={s.taxaConv} anterior={s.ant?.taxaConv}/></td>
                    <td style={{padding:'8px 12px',fontWeight:700,color:C.navy,whiteSpace:'nowrap'}}>{fmtMoney(s.valorTotal)}<div style={{fontSize:11,color:C.gray,fontWeight:400}}>antes {fmtMoney(s.ant?.valorTotal)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </>)}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   LOJAS (cadastro de unidades e da agenda do Google de cada uma)
══════════════════════════════════════════════════════ */
function Lojas({ onAlterar }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [testes, setTestes] = useState({});
  const [toast, setToast] = useState('');
  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  const load = useCallback(async () => {
    const lista = await listarUnidades();
    setRows(lista || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const testar = async (loja) => {
    if (!loja.calendario_google) return;
    setTestes(t => ({ ...t, [loja.id]: { carregando: true } }));
    const r = await testarAgenda(loja.calendario_google);
    setTestes(t => ({ ...t, [loja.id]: r }));
  };

  const salvar = async (form) => {
    const dados = { nome: form.nome.trim(), endereco: form.endereco.trim(), calendario_google: form.calendario_google.trim() || null, ativa: form.ativa };
    const { error } = form.id
      ? await supabase.from('unidades').update({ endereco: dados.endereco, calendario_google: dados.calendario_google, ativa: dados.ativa }).eq('id', form.id)
      : await supabase.from('unidades').insert({ ...dados, ordem: rows.length + 1 });
    if (error) return error.code === '23505' ? 'Já existe uma loja com esse nome.' : 'Erro ao salvar: ' + error.message;
    setModal(null);
    showToast('Loja salva! A agenda passa a ser lida na próxima sincronização (até 5 min).');
    await load();
    onAlterar?.();
    return null;
  };

  return (
    <div>
      <Toast msg={toast}/>
      <TopoTela titulo="Lojas" subtitulo="Cada loja e a agenda do Google onde a IA grava os agendamentos dela">
        <Btn color={C.teal} onClick={()=>setModal({ nome:'', endereco:'', calendario_google:'', ativa:true })}>+ Nova loja</Btn>
      </TopoTela>
      {loading ? <Spinner/> : (
        <Card>
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr style={{background:C.teal,color:C.white}}>
                {['Loja','Endereço','Agenda do Google','Situação',''].map(h=><th key={h} style={{padding:'9px 12px',textAlign:'left',whiteSpace:'nowrap'}}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((u,i)=>{
                  const t = testes[u.id];
                  return (
                    <tr key={u.id} style={{background:i%2===0?C.white:C.bg,borderBottom:`1px solid ${C.border}`,opacity:u.ativa?1:.6}}>
                      <td style={{padding:'10px 12px',fontWeight:700,whiteSpace:'nowrap'}}>{u.nome}</td>
                      <td style={{padding:'10px 12px',fontSize:12,color:C.textSm}}>{u.endereco||'—'}</td>
                      <td style={{padding:'10px 12px',fontSize:12,maxWidth:280}}>
                        {u.calendario_google
                          ? <span title={u.calendario_google} style={{display:'block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:C.textSm}}>{u.calendario_google}</span>
                          : <span style={{color:C.danger,fontWeight:600}}>Sem agenda — a IA não entra no sistema</span>}
                        {t && !t.carregando && (t.ok
                          ? <div style={{color:C.success,fontWeight:600,marginTop:4}}>✓ Agenda "{t.nome_agenda}" lida · {t.eventos_ia} agendamento(s) da IA nos próximos 21 dias</div>
                          : <div style={{color:C.danger,fontWeight:600,marginTop:4}}>✗ {t.erro}{t.conta_servico ? ` Compartilhe a agenda com ${t.conta_servico}.` : ''}</div>)}
                        {t?.carregando && <div style={{color:C.gray,marginTop:4}}>Testando…</div>}
                      </td>
                      <td style={{padding:'10px 12px'}}><Badge color={u.ativa?C.success:C.gray}>{u.ativa?'Ativa':'Inativa'}</Badge></td>
                      <td style={{padding:'10px 12px'}}>
                        <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
                          <Btn outline size="sm" color={C.teal} disabled={!u.calendario_google || t?.carregando} style={{width:120,padding:'7px 0'}} onClick={()=>testar(u)}>Testar agenda</Btn>
                          <Btn outline size="sm" color={C.teal} style={{width:90,padding:'7px 0'}} onClick={()=>setModal({ ...u, calendario_google: u.calendario_google||'' })}>Editar</Btn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Card style={{marginTop:16,background:C.tealBg,boxShadow:'none'}}>
        <h4 style={{color:C.navy,marginBottom:8}}>Como ligar a agenda de uma loja nova</h4>
        <ol style={{fontSize:13,color:C.textSm,lineHeight:1.8,paddingLeft:18}}>
          <li>No Google Agenda, passe o mouse na agenda da loja → <b>⋮ → Configurações e compartilhamento</b>.</li>
          <li>Em <b>Integrar agenda</b>, copie o <b>ID da agenda</b> (algo como <i>…@group.calendar.google.com</i>).</li>
          <li>Em <b>Compartilhar com pessoas específicas</b>, adicione a conta de serviço do sistema com permissão <b>"Fazer alterações nos eventos"</b> (o e-mail aparece ao clicar em "Testar agenda").</li>
          <li>Aqui, clique em <b>+ Nova loja</b> (ou Editar), cole o ID e clique em <b>Testar agenda</b> antes de salvar.</li>
        </ol>
      </Card>
      {modal && <LojaModal loja={modal} onSave={salvar} onClose={()=>setModal(null)}/>}
    </div>
  );
}

// Testa a leitura de uma agenda pela conta de serviço (só supervisor/diretor)
async function testarAgenda(calendarioId) {
  const { data, error } = await supabase.functions.invoke('calendar-sync', { body: { testar: calendarioId } });
  if (!error && data) return data;
  let r = { ok: false, erro: 'Não foi possível testar agora.' };
  try { r = { ...r, ...(await error?.context?.json()) }; } catch {}
  return r;
}

function LojaModal({ loja, onSave, onClose }) {
  const [form, setForm] = useState(loja);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [teste, setTeste] = useState(null);
  const set = (k,v) => { setForm(f=>({...f,[k]:v})); setErro(''); if (k==='calendario_google') setTeste(null); };
  const novo = !loja.id;
  const salvar = async () => {
    if (form.nome.trim().length < 2) return setErro('Informe o nome da loja.');
    setSalvando(true);
    const e = await onSave(form);
    setSalvando(false);
    if (e) setErro(e);
  };
  const testar = async () => { setTeste({ carregando:true }); setTeste(await testarAgenda(form.calendario_google.trim())); };
  return (
    <Modal title={novo ? 'Nova loja' : `Editar loja — ${loja.nome}`} onClose={onClose} width={560}>
      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        <div>
          <Input label="Nome da loja" value={form.nome} disabled={!novo} onChange={e=>set('nome',e.target.value)} placeholder="Ex.: Santos"/>
          {!novo && <div style={{fontSize:11,color:C.gray,marginTop:4}}>O nome não muda depois de criado, porque os agendamentos ficam ligados a ele.</div>}
        </div>
        <Input label="Endereço (sai na receita e na declaração)" value={form.endereco} onChange={e=>set('endereco',e.target.value)} placeholder="Rua, número - Bairro – Cidade – UF"/>
        <div>
          <Input livre label="ID da agenda do Google" value={form.calendario_google} onChange={e=>set('calendario_google',e.target.value)} placeholder="…@group.calendar.google.com"/>
          <div style={{display:'flex',alignItems:'center',gap:10,marginTop:8,flexWrap:'wrap'}}>
            <Btn outline size="sm" color={C.teal} disabled={!form.calendario_google.trim() || teste?.carregando} onClick={testar}>{teste?.carregando ? 'Testando…' : 'Testar agenda'}</Btn>
            {teste && !teste.carregando && (teste.ok
              ? <span style={{fontSize:12,color:C.success,fontWeight:600}}>✓ "{teste.nome_agenda}" · {teste.eventos_ia} agendamento(s) da IA nos próximos 21 dias</span>
              : <span style={{fontSize:12,color:C.danger,fontWeight:600}}>✗ {teste.erro}</span>)}
          </div>
          {teste && !teste.carregando && !teste.ok && teste.conta_servico && (
            <div style={{fontSize:12,color:C.textSm,marginTop:6,lineHeight:1.5}}>Compartilhe a agenda com <b>{teste.conta_servico}</b> ("Fazer alterações nos eventos") e teste de novo.</div>
          )}
        </div>
        <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,fontWeight:600,color:C.textSm,cursor:'pointer'}}>
          <input type="checkbox" checked={form.ativa} onChange={e=>set('ativa',e.target.checked)}/> Loja ativa (aparece no sistema e tem a agenda sincronizada)
        </label>
        {erro && <div style={{fontSize:12,color:C.danger,fontWeight:600}}>{erro}</div>}
        <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
          <Btn outline color={C.gray} onClick={onClose}>Cancelar</Btn>
          <Btn color={C.teal} disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar'}</Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════
   USUÁRIOS
══════════════════════════════════════════════════════ */
function Usuarios({ selectedUnidade='' }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [verInativos, setVerInativos] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  const load = useCallback(async () => {
    const todos = await listarUsuarios(true);
    setRows(selectedUnidade ? todos.filter(u => u.unidade === selectedUnidade) : todos);
    setLoading(false);
  }, [selectedUnidade]);
  useEffect(()=>{ load(); },[load]);

  const handleSave = async (form) => {
    const r = await gerirUsuario('salvar', form);
    if (r?.erro) return r.erro;
    showToast('Usuário salvo!');
    setModal(null);
    load();
    return null;
  };

  const toggleAtivo = async (u) => {
    const r = await gerirUsuario('ativo', { id: u.id, ativo: !u.ativo });
    if (r?.erro) showToast(r.erro);
    load();
  };

  return (
    <div>
      <Toast msg={toast}/>
      <TopoTela titulo="Usuários" subtitulo={`${rows.filter(u=>u.ativo).length} ativo(s) · ${rows.filter(u=>!u.ativo).length} inativo(s)`}>
        <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
          <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,fontWeight:600,color:C.textSm,cursor:'pointer',userSelect:'none'}}>
            <span role="switch" aria-checked={verInativos} onClick={()=>setVerInativos(v=>!v)}
              style={{width:36,height:20,borderRadius:999,background:verInativos?C.teal:C.border,position:'relative',transition:'background .15s',display:'inline-block'}}>
              <span style={{position:'absolute',top:2,left:verInativos?18:2,width:16,height:16,borderRadius:'50%',background:C.white,transition:'left .15s',boxShadow:'0 1px 2px rgba(0,0,0,.2)'}}/>
            </span>
            <span onClick={()=>setVerInativos(v=>!v)}>Mostrar inativos</span>
          </label>
          <Btn color={C.teal} onClick={()=>setModal({perfil:'opto',ativo:true,cro:''})}>+ Novo Usuário</Btn>
        </div>
      </TopoTela>
      {loading ? <Spinner/> : (
        <Card>
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr style={{background:C.teal,color:C.white}}>
                {['Nome','Perfil','Unidade','CRO','Senha','Status',''].map(h=>(
                  <th key={h} style={{padding:'9px 12px',textAlign:'left'}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rows.filter(u => verInativos || u.ativo).map((u,i)=>(
                  <tr key={u.id} style={{background:i%2===0?C.white:C.bg,borderBottom:`1px solid ${C.border}`,opacity:u.ativo?1:.5}}>
                    <td style={{padding:'8px 12px',fontWeight:600}}>{u.nome}</td>
                    <td style={{padding:'8px 12px'}}><Badge color={PERFIS[u.perfil]?.cor||C.gray}>{PERFIS[u.perfil]?.label||u.perfil}</Badge></td>
                    <td style={{padding:'8px 12px',fontSize:12,color:C.textSm,fontWeight:600}}>{u.unidade||'—'}</td>
                    <td style={{padding:'8px 12px',fontSize:11,color:C.gray}}>{u.cro||'—'}</td>
                    <td style={{padding:'8px 12px',color:C.gray}}>••••••</td>
                    <td style={{padding:'8px 12px'}}><Badge color={u.ativo?C.success:C.danger}>{u.ativo?'Ativo':'Inativo'}</Badge></td>
                    <td style={{padding:'8px 12px'}}>
                      <div style={{display:'flex',gap:6}}>
                        <Btn size="sm" color={C.teal} outline onClick={()=>setModal(u)}>Editar</Btn>
                        <Btn size="sm" color={u.ativo?C.danger:C.success} outline onClick={()=>toggleAtivo(u)}>{u.ativo?'Desativar':'Ativar'}</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {modal && <UsuarioModal user={modal} onSave={handleSave} onClose={()=>setModal(null)}/>}
    </div>
  );
}

function UsuarioModal({ user, onSave, onClose }) {
  const [form, setForm] = useState({
    id:user.id||null, nome:user.nome||'', perfil:user.perfil||'opto',
    senha:'', cro:user.cro||'', ativo:user.ativo??true,
    unidade:user.unidade||'', endereco:user.endereco||'',
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    setErro('');
    if (!form.nome.trim()) { setErro('Informe o nome.'); return; }
    if (!user.id && !form.senha) { setErro('Defina uma senha.'); return; }
    if (form.senha && form.senha.length < 6) { setErro('A senha precisa ter pelo menos 6 caracteres.'); return; }
    setSalvando(true);
    const e = await onSave(form);
    setSalvando(false);
    if (e) setErro(e);
  };

  // Ao selecionar unidade, preenche endereço automaticamente se vazio ou padrão
  const handleUnidade = (val) => {
    set('unidade', val);
    if (val && (!form.endereco || ENDERECOS_UNIDADES[form.unidade]===form.endereco)) {
      set('endereco', ENDERECOS_UNIDADES[val]||'');
    }
  };

  return (
    <Modal title={user.id?'Editar Usuário':'Novo Usuário'} onClose={onClose}>
      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        <Input label="Nome" value={form.nome} onChange={e=>set('nome',e.target.value)} placeholder="Nome completo"/>
        <Select label="Perfil" value={form.perfil} onChange={e=>set('perfil',e.target.value)}
          options={Object.entries(PERFIS).map(([v,p])=>({value:v,label:p.label}))}/>
        {!['diretor','supervisor','prevenda'].includes(form.perfil) && (<>
          <Select label="Unidade" value={form.unidade} onChange={e=>handleUnidade(e.target.value)}
            options={[{value:'',label:'Selecionar unidade'},...UNIDADES.map(u=>({value:u,label:u}))]}/>
          <Input label="Endereço da Unidade" value={form.endereco} onChange={e=>set('endereco',e.target.value)}
            placeholder="Endereço completo da clínica"/>
        </>)}
        {form.perfil==='opto' && <Input label="CRO" value={form.cro} onChange={e=>set('cro',e.target.value)} placeholder="CRO-SP 12345"/>}
        <Input label={user.id?'Nova senha (deixe em branco para manter)':'Senha'} type="password" autoComplete="new-password" value={form.senha} onChange={e=>set('senha',e.target.value)} placeholder="Mínimo 6 caracteres"/>
        {erro && <p style={{color:C.danger,fontSize:13}}>{erro}</p>}
        <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:8}}>
          <Btn color={C.gray} outline onClick={onClose}>Cancelar</Btn>
          <Btn color={C.teal} disabled={salvando} onClick={salvar}>{salvando?'Salvando...':'Salvar'}</Btn>
        </div>
      </div>
    </Modal>
  );
}


/* ══════════════════════════════════════════════════════
   RECEITAS
══════════════════════════════════════════════════════ */
/* Edição de receita já gerada: só o optometrista. Motivo obrigatório; cada alteração fica no histórico (antes → depois). */
const CAMPOS_EDITAVEIS = [
  ['od_esf','OD Esférico'],['od_cil','OD Cilíndrico'],['od_eixo','OD Eixo'],['od_av','OD AV'],['od_dnp','OD DNP'],
  ['oe_esf','OE Esférico'],['oe_cil','OE Cilíndrico'],['oe_eixo','OE Eixo'],['oe_av','OE AV'],['oe_dnp','OE DNP'],
  ['od_adicao','Adição'],['tipo_lente','Tipo de lente'],['tratamentos_sugeridos','Tratamentos'],['observacoes','Observações'],
];
const valorHist = v => Array.isArray(v) ? (v.length ? v.map(nomeTrat).join(', ') : '—') : (v === null || v === undefined || v === '' ? '—' : String(v));
function EditarReceita({ receita, user, onSalvo, onCancelar }) {
  const [f, setF2] = useState({
    od_esf:receita.od_esf||'', od_cil:receita.od_cil||'', od_eixo:receita.od_eixo||'', od_av:receita.od_av||'', od_add:receita.od_adicao==='N/A'?'':(receita.od_adicao||''), od_dnp:receita.od_dnp==='N/A'?'':(receita.od_dnp||''),
    oe_esf:receita.oe_esf||'', oe_cil:receita.oe_cil||'', oe_eixo:receita.oe_eixo||'', oe_av:receita.oe_av||'', oe_add:receita.oe_adicao==='N/A'?'':(receita.oe_adicao||''), oe_dnp:receita.oe_dnp==='N/A'?'':(receita.oe_dnp||''),
    trat: receita.tratamentos_sugeridos||[], obs: receita.observacoes||'', tipo: receita.tipo_lente||'', motivo:'' });
  const [erros, setErros] = useState({});
  const [salvando, setSalvando] = useState(false);
  const set = (k,v) => setF2(x => ({ ...x, [k]: v, ...(k==='od_add' ? { oe_add: v } : {}) }));
  const salvar = async () => {
    const { erros: e, valores: rx } = validarRx(f);
    if (!f.motivo.trim()) e.motivo = 'Informe o motivo da alteração.';
    setErros(e);
    if (Object.keys(e).length) return;
    const novo = {
      od_esf:rx.od_esf, od_cil:rx.od_cil, od_eixo:rx.od_eixo, od_av:rx.od_av, od_adicao:rx.od_add, od_dnp:rx.od_dnp,
      oe_esf:rx.oe_esf, oe_cil:rx.oe_cil, oe_eixo:rx.oe_eixo, oe_av:rx.oe_av, oe_adicao:rx.oe_add, oe_dnp:rx.oe_dnp,
      tratamentos_sugeridos: TRATAMENTOS.map(t=>t.id).filter(id=>f.trat.includes(id)),
      observacoes: f.obs,
      tipo_lente: f.tipo || null,
    };
    const mudou = Object.keys(novo).some(k => JSON.stringify(novo[k] ?? '') !== JSON.stringify(receita[k] ?? ''));
    if (!mudou) { setErros({ motivo: 'Nada foi alterado na receita.' }); return; }
    setSalvando(true);
    const { data, error } = await supabase.from('receitas')
      .update({ ...novo, motivo_edicao: f.motivo.trim(), editado_por_id: user.id, editado_por_nome: user.nome })
      .eq('id', receita.id).select().single();
    setSalvando(false);
    if (error) { alert('Não foi possível salvar: ' + error.message); return; }
    onSalvo(data);
  };
  const cel = (k) => (
    <td style={{padding:4}}>
      <input value={f[k]} onChange={e=>set(k, e.target.value)} aria-label={k}
        style={{width:'100%',minWidth:64,border:`1.5px solid ${erros[k]?C.danger:C.border}`,borderRadius:8,padding:'7px 8px',fontSize:13,textAlign:'center',background:C.white}}/>
    </td>);
  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div className="tbl-wrap">
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead><tr style={{background:C.teal,color:C.white}}>
            {['Olho','Esférico','Cilíndrico','Eixo','AV','Adição (AO)','DNP'].map(h=><th key={h} style={{padding:'8px 10px',textAlign:'center'}}>{h}</th>)}
          </tr></thead>
          <tbody>
            <tr><td style={{padding:'8px 10px',fontWeight:700}}>OD</td>{cel('od_esf')}{cel('od_cil')}{cel('od_eixo')}{cel('od_av')}<td rowSpan={2} style={{padding:4,verticalAlign:'middle'}}><input value={f.od_add} onChange={e=>set('od_add',e.target.value)} aria-label="adição" style={{width:'100%',minWidth:64,border:`1.5px solid ${erros.od_add?C.danger:C.border}`,borderRadius:8,padding:'7px 8px',fontSize:13,textAlign:'center'}}/></td>{cel('od_dnp')}</tr>
            <tr><td style={{padding:'8px 10px',fontWeight:700}}>OE</td>{cel('oe_esf')}{cel('oe_cil')}{cel('oe_eixo')}{cel('oe_av')}{cel('oe_dnp')}</tr>
          </tbody>
        </table>
      </div>
      {Object.keys(erros).filter(k=>k!=='motivo').length > 0 && <div style={{fontSize:12,color:C.danger,fontWeight:600}}>{Object.entries(erros).filter(([k])=>k!=='motivo').map(([,v])=>v).filter((v,i,a)=>a.indexOf(v)===i).join(' · ')}</div>}
      <div>
        <label style={{fontSize:12,fontWeight:600,color:C.textSm,display:'block',marginBottom:6}}>Tipo de lente sugerido</label>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {TIPOS_LENTE.map(t => { const on = f.tipo === t.id; return (
            <button key={t.id} type="button" role="radio" aria-checked={on} onClick={()=>set('tipo', t.id)}
              style={{padding:'8px 12px',borderRadius:10,fontSize:13,fontWeight:700,cursor:'pointer',border:`1.5px solid ${on?C.teal:C.border}`,background:on?C.tealBg:C.white,color:C.navy}}>
              {on ? '● ' : ''}{t.label}</button>); })}
        </div>
      </div>
      <div>
        <label style={{fontSize:12,fontWeight:600,color:C.textSm,display:'block',marginBottom:6}}>Tratamentos sugeridos</label>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {TRATAMENTOS.map(t => { const on = f.trat.includes(t.id); return (
            <button key={t.id} type="button" role="checkbox" aria-checked={on} onClick={()=>set('trat', on ? f.trat.filter(x=>x!==t.id) : [...f.trat, t.id])}
              style={{padding:'8px 12px',borderRadius:10,fontSize:13,fontWeight:700,cursor:'pointer',border:`1.5px solid ${on?C.teal:C.border}`,background:on?C.tealBg:C.white,color:C.navy}}>
              {on ? '✓ ' : ''}{t.label}</button>); })}
        </div>
      </div>
      <div>
        <label style={{fontSize:12,fontWeight:600,color:C.textSm,display:'block',marginBottom:6}}>Observações</label>
        <textarea value={f.obs} onChange={e=>set('obs', maiusc(e).target.value)} rows={2} style={{width:'100%',border:`1.5px solid ${C.border}`,borderRadius:8,padding:'8px 12px',fontSize:14,resize:'vertical'}}/>
      </div>
      <div>
        <label style={{fontSize:12,fontWeight:600,color:C.textSm,display:'block',marginBottom:6}}>Motivo da alteração <span style={{color:C.danger}}>*</span></label>
        <textarea value={f.motivo} onChange={e=>{ set('motivo', maiusc(e).target.value); setErros(x=>({...x, motivo:undefined})); }} rows={2} placeholder="Ex.: ERRO DE DIGITAÇÃO NO EIXO DO OE"
          style={{width:'100%',border:`1.5px solid ${erros.motivo?C.danger:C.border}`,borderRadius:8,padding:'8px 12px',fontSize:14,resize:'vertical'}}/>
        {erros.motivo && <div style={{fontSize:11,color:C.danger,marginTop:4,fontWeight:600}}>{erros.motivo}</div>}
      </div>
      <div style={{fontSize:12,color:C.gray}}>A alteração fica registrada no histórico com seu nome, data e hora, e o motivo.</div>
      <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
        <Btn size="sm" outline onClick={onCancelar}>Cancelar</Btn>
        <Btn size="sm" color={C.teal} onClick={salvar} disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar alteração'}</Btn>
      </div>
    </div>
  );
}
function HistoricoReceita({ receitaId, versao }) {
  const [itens, setItens] = useState(null);
  useEffect(() => {
    supabase.from('receitas_historico').select('*').eq('receita_id', receitaId).order('alterado_em', { ascending:false })
      .then(({ data }) => setItens(data || []));
  }, [receitaId, versao]);
  if (!itens || !itens.length) return null;
  return (
    <div style={{borderTop:`1px solid ${C.border}`,paddingTop:12}}>
      <div style={{fontSize:12,fontWeight:700,color:C.textSm,marginBottom:8,textTransform:'uppercase',letterSpacing:'.5px'}}>Histórico de alterações</div>
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {itens.map(h => {
          const dt = new Date(h.alterado_em);
          const quando = `${pad(dt.getDate())}/${pad(dt.getMonth()+1)}/${dt.getFullYear()} às ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
          return (
            <div key={h.id} style={{background:C.bg,borderRadius:10,padding:'10px 12px',fontSize:13}}>
              <div style={{fontWeight:700,color:C.text}}>{quando} · {h.alterado_por_nome}</div>
              <div style={{color:C.textSm,marginTop:2}}>Motivo: {h.motivo}</div>
              <ul style={{margin:'6px 0 0',paddingLeft:18,color:C.text}}>
                {CAMPOS_EDITAVEIS.filter(([k]) => JSON.stringify((h.antes||{})[k] ?? '') !== JSON.stringify((h.depois||{})[k] ?? '')).map(([k,l]) => (
                  <li key={k}>{l}: <span style={{textDecoration:'line-through',color:C.gray}}>{valorHist((h.antes||{})[k])}</span> → <strong>{valorHist((h.depois||{})[k])}</strong></li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Receitas({ user, selectedUnidade='' }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const per = usePeriodo('tudo');
  const [filtros, setFiltros] = useState({ opto:'', busca:'' });
  const [detalhe, setDetalhe] = useState(null);
  const [declaracao, setDeclaracao] = useState(null);
  const [editando, setEditando] = useState(false);
  const [versaoHist, setVersaoHist] = useState(0);

  const load = useCallback(async () => {
    let q = supabase.from('receitas').select('*').order('data',{ascending:false});
    if (per.de) q = q.gte('data', per.de).lte('data', per.ate);
    if (user.perfil === 'opto') q = q.eq('opto_id', user.id);
    const unidade = user.unidade || selectedUnidade;
    if (unidade) q = q.eq('unidade', unidade);
    const { data } = await q;
    setRows(data || []);
    setLoading(false);
  }, [per.de, per.ate, user, selectedUnidade]);
  const optosR = [...new Set(rows.map(r=>r.opto_nome).filter(Boolean))].sort();
  const lista = rows.filter(r => (!filtros.opto || r.opto_nome === filtros.opto) && casaNome(r.paciente_nome, filtros.busca));

  useEffect(() => { load(); }, [load]);
  useRealtime('receitas', () => load());

  const fmtOlho = (r, pref) => {
    const P = v => String(v||'').toUpperCase() === 'PLANO';
    const esf = r[pref+'_esf']; const cil = r[pref+'_cil'];
    const eixo = r[pref+'_eixo']; const add = r[pref+'_adicao'];
    const parts = [];
    if (esf && !P(esf)) parts.push(`ESF ${esf}`);
    if (cil && !P(cil)) parts.push(`CIL ${cil}`);
    if (eixo) parts.push(`EIXO ${eixo}`);
    if (add && add !== 'N/A') parts.push(`ADD ${add}`);
    return parts.length ? parts.join(' / ') : (P(esf) ? 'PLANO' : '—');
  };

  return (
    <div>
      <TopoTela titulo="Receitas" subtitulo={`${textoPeriodo(per.de, per.ate)} · ${lista.length} receita(s)`}>
        <FiltroPeriodo p={per} comTudo/>
      </TopoTela>
      <Card style={{marginBottom:16}}>
        <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'flex-end'}}>
          <Busca value={filtros.busca} onChange={v=>setFiltros(f=>({...f,busca:v}))}/>
          {user.perfil !== 'opto' && <Select label="Optometrista" value={filtros.opto} onChange={e=>setFiltros(f=>({...f,opto:e.target.value}))}
            options={[{value:'',label:'Todos'},...optosR.map(n=>({value:n,label:n}))]}/>}
        </div>
      </Card>
      {loading ? <Spinner/> : (
        <Card>
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr style={{background:C.teal,color:C.white}}>
                {['Data','Paciente','Optometrista','OD (resumo)','OE (resumo)',''].map(h=>(
                  <th key={h} style={{padding:'9px 12px',textAlign:'left'}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {lista.length===0 && <tr><td colSpan={6} style={{padding:24,textAlign:'center',color:C.gray}}>Nenhuma receita no período</td></tr>}
                {lista.map((r,i)=>(
                  <tr key={r.id} style={{background:i%2===0?C.white:C.bg,borderBottom:`1px solid ${C.border}`}}>
                    <td style={{padding:'8px 12px'}}>{fmtDate(r.data)}</td>
                    <td style={{padding:'8px 12px',fontWeight:600}}>{r.paciente_nome}</td>
                    <td style={{padding:'8px 12px'}}>{r.opto_nome}</td>
                    <td style={{padding:'8px 12px',fontSize:12,color:C.textSm}}>{fmtOlho(r,'od')}</td>
                    <td style={{padding:'8px 12px',fontSize:12,color:C.textSm}}>{fmtOlho(r,'oe')}</td>
                    <td style={{padding:'8px 12px'}}>
                      <Btn size="sm" color={C.teal} outline onClick={()=>{ setEditando(false); setDetalhe(r); }}>Ver</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {declaracao && <DeclaracaoModal receita={declaracao.receita} horaAgenda={declaracao.hora} onClose={()=>setDeclaracao(null)}/>}
      {detalhe && !declaracao && (
        <Modal title={editando ? 'Editar receita' : 'Receita'} onClose={()=>{ setDetalhe(null); setEditando(false); }} width={620}>
          {editando ? <EditarReceita receita={detalhe} user={user} onCancelar={()=>setEditando(false)}
            onSalvo={nova=>{ setDetalhe(nova); setEditando(false); setVersaoHist(v=>v+1); load(); }}/> :
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            {/* Cabeçalho */}
            <div style={{display:'flex',gap:16,flexWrap:'wrap',paddingBottom:12,borderBottom:`1px solid ${C.border}`}}>
              <div><span style={{fontSize:11,color:C.gray,textTransform:'uppercase',fontWeight:600}}>Paciente</span><div style={{fontWeight:700,fontSize:15,color:C.navy}}>{detalhe.paciente_nome}</div></div>
              <div><span style={{fontSize:11,color:C.gray,textTransform:'uppercase',fontWeight:600}}>Data</span><div style={{fontWeight:600}}>{fmtDate(detalhe.data)}</div></div>
              <div><span style={{fontSize:11,color:C.gray,textTransform:'uppercase',fontWeight:600}}>Optometrista</span><div style={{fontWeight:600}}>{detalhe.opto_nome}</div></div>
              {detalhe.meio_contato && <div><span style={{fontSize:11,color:C.gray,textTransform:'uppercase',fontWeight:600}}>Meio contato</span><div style={{fontWeight:600}}>{detalhe.meio_contato}</div></div>}
              {detalhe.agendado_por && <div><span style={{fontSize:11,color:C.gray,textTransform:'uppercase',fontWeight:600}}>Agendado por</span><div style={{fontWeight:600}}>{detalhe.agendado_por}</div></div>}
            </div>
            {/* Tabela de prescrição */}
            <div className="tbl-wrap">
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead><tr style={{background:C.teal,color:C.white}}>
                  <th style={{padding:'8px 12px',textAlign:'left'}}>Olho</th>
                  {['Esférico','Cilíndrico','Eixo','AV','Adição','DNP'].map(h=><th key={h} style={{padding:'8px 12px',textAlign:'center'}}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {[['OD','od'],['OE','oe']].map(([lbl,p],i)=>(
                    <tr key={lbl} style={{background:i%2===0?C.white:C.bg,borderBottom:`1px solid ${C.border}`}}>
                      <td style={{padding:'8px 12px',fontWeight:700,color:C.text}}>{lbl}</td>
                      <td style={{padding:'8px 12px',textAlign:'center'}}>{detalhe[p+'_esf']||'—'}</td>
                      <td style={{padding:'8px 12px',textAlign:'center'}}>{detalhe[p+'_cil']||'—'}</td>
                      <td style={{padding:'8px 12px',textAlign:'center'}}>{detalhe[p+'_eixo']||'—'}</td>
                      <td style={{padding:'8px 12px',textAlign:'center'}}>{detalhe[p+'_av']||'—'}</td>
                      {detalhe.od_adicao === detalhe.oe_adicao
                        ? (i===0 && <td rowSpan={2} style={{padding:'8px 12px',textAlign:'center',background:C.tealBg}}><div style={{fontSize:11,fontWeight:700,color:C.text}}>AO</div>{detalhe.od_adicao||'—'}</td>)
                        : <td style={{padding:'8px 12px',textAlign:'center'}}>{detalhe[p+'_adicao']||'—'}</td>}
                      <td style={{padding:'8px 12px',textAlign:'center'}}>{detalhe[p+'_dnp']||'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detalhe.tipo_lente && <div style={{fontSize:13}}><span style={{fontSize:12,fontWeight:700,color:C.textSm}}>Tipo de lente sugerido:</span> <strong style={{color:C.navy}}>{detalhe.tipo_lente}</strong></div>}
            {(detalhe.tratamentos_sugeridos||[]).length > 0 && (
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                <span style={{fontSize:12,fontWeight:700,color:C.textSm}}>Tratamentos recomendados:</span>
                {detalhe.tratamentos_sugeridos.map(t=><Badge key={t} color={C.teal}>{nomeTrat(t)}</Badge>)}
              </div>
            )}
            {detalhe.observacoes && <div style={{background:C.orangeBg,borderLeft:`3px solid ${C.orange}`,borderRadius:'0 8px 8px 0',padding:'10px 14px',fontSize:13}}><strong>Observações:</strong> {detalhe.observacoes}</div>}
            <div style={{display:'flex',gap:10,justifyContent:'flex-end',paddingTop:4,flexWrap:'wrap'}}>
              <Btn size="sm" outline color={C.teal} onClick={async ()=>{
                const { data } = detalhe.agenda_id ? await supabase.from('agenda').select('hora').eq('id', detalhe.agenda_id).maybeSingle() : { data: null };
                setDeclaracao({ receita: detalhe, hora: data?.hora || '' });
              }}>Declaração de comparecimento</Btn>
              {user.perfil === 'opto' && <Btn size="sm" outline color={C.teal} onClick={()=>setEditando(true)}>Editar receita</Btn>}
              <Btn size="sm" color={C.teal} onClick={()=>imprimirReceita(detalhe)}>Imprimir Receita</Btn>
            </div>
            <HistoricoReceita receitaId={detalhe.id} versao={versaoHist}/>
          </div>}
        </Modal>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   MANUAL — guia de uso dentro do sistema, filtrado pelo perfil de quem está logado
══════════════════════════════════════════════════════ */
const TODOS = ['opto','comercial','gerente','prevenda','supervisor','diretor'];
const GESTAO = ['supervisor','diretor'];
const MANUAL = [
  { id:'acesso', perfis:TODOS, rotulo:'Primeiro passo', titulo:'Como entrar',
    intro:'Cada pessoa tem o próprio usuário. Não compartilhe a senha: tudo o que é feito no sistema fica registrado no nome de quem está logado.',
    cards:[
      { t:'Entrar', d:'Acesse agenda.clinicavisaoideal.com, digite seu nome de usuário e sua senha e clique em Entrar.' },
      { t:'Sair', d:'Use o botão Sair no menu ao terminar o turno, principalmente em computadores compartilhados.' },
      { t:'Esqueceu a senha?', d:'Fale com o supervisor ou o diretor. Eles redefinem a senha na tela Usuários.' },
    ] },
  { id:'inicio', perfis:TODOS, rotulo:'Tela Início', titulo:'A visão geral do dia',
    intro:'É a primeira tela depois do login. Mostra os números da loja e quem vem a seguir.',
    cards:[
      { t:'Período', d:'Escolha Hoje, Semana, Mês ou Personalizado. As telas começam sempre em Hoje.' },
      { t:'Números', d:'Agendados, compareceram, não compareceram e receitas do período.' },
      { t:'Próximas consultas', d:'Os próximos pacientes a partir de agora, com data, hora e optometrista.' },
    ] },
  { id:'agenda', perfis:TODOS, rotulo:'Tela Agenda', titulo:'Marcar e organizar horários',
    intro:'Os agendamentos feitos pela IA entram aqui sozinhos, a cada 5 minutos, com a etiqueta IA e o meio de contato VISÃO IDEAL.',
    cards:[
      { t:'Novo agendamento', lista:['Clique em + Novo Agendamento.','Busque o paciente pelo nome ou cadastre um novo (nome e telefone).','Escolha data, horário, procedimento e meio de contato e salve.'] },
      { t:'Visão Semana', d:'Mostra segunda a sábado em colunas. As setas trocam a semana. Clique num horário vazio para agendar ou num paciente para editar.', cores:true },
      { t:'Editar ou remarcar', d:'Abra o agendamento, mude data ou horário e salve. Se foi a IA que marcou, o horário também muda no Google Agenda.' },
    ] },
  { id:'atendimentos', perfis:['opto','comercial','gerente','supervisor','diretor'], rotulo:'Tela Atendimentos', titulo:'A fila do dia',
    intro:'Lista os pacientes da loja com filtros por data, optometrista, status, procedimento e quem agendou.',
    cards:[
      { t:'Atender', d:'Abre o atendimento do paciente: anamnese, refração e receita.' },
      { t:'+ Encaixe', d:'Para quem chegou sem horário. Agenda e já abre o atendimento na mesma hora.' },
      { t:'Reagendar', d:'Muda o dia e o horário sem precisar ir até a Agenda.' },
      { t:'Ver ficha', d:'Mostra a receita de quem já foi atendido. Agendamentos cancelados ficam com os botões desativados.' },
    ] },
  { id:'passo', perfis:['opto','comercial','gerente','supervisor','diretor'], rotulo:'Optometrista', titulo:'Atendimento passo a passo',
    intro:'Só o optometrista preenche a anamnese e a refração e gera a receita. Os outros perfis veem as telas apenas para consulta.',
    passos:[
      { t:'Anamnese', d:'Preencha o que o paciente relatar.', lista:['Data de nascimento é obrigatória: a idade sai na receita.','Queixa principal, medicamentos em uso e observações.','Tipo de lente sugerido é obrigatório: Monofocal, Multifocal, Bifocal ou Ocupacional.','Tratamentos sugeridos: Antirreflexo já vem marcado. Marque Filtro de luz azul ou Fotocromático se indicar.'] },
      { t:'Refração', d:'Digite os valores com vírgula ou ponto. O sistema formata sozinho.', lista:['Cilíndrico é sempre negativo. Se digitar positivo, ele converte.','Eixo vai de 0 a 180 e é obrigatório quando há cilíndrico.','AV (acuidade visual) de cada olho, no formato 20/20 ou decimal. É opcional.','A adição é uma só para os dois olhos (AO).','Campo vazio sai como PLANO ou N/A.'] },
      { t:'Gerar receita', d:'Confere os campos, salva a receita e marca o paciente como Compareceu.' },
      { t:'Imprimir', d:'Imprima a receita, já com a assinatura do optometrista. Se o paciente pedir, gere a Declaração de comparecimento: o CPF é pedido na hora e não fica guardado.' },
      { t:'Finalizar atendimento', d:'Volta para a lista e libera o próximo paciente.' },
    ] },
  { id:'receitas', perfis:TODOS, rotulo:'Tela Receitas', titulo:'Consultar, corrigir e reimprimir', tituloConsulta:'Consultar e reimprimir',
    intro:'Abre em Tudo, para achar qualquer receita da loja. Busque pelo nome do paciente ou filtre por optometrista e período. Em Ver, dá para imprimir de novo a receita ou a declaração.',
    cards:[
      { t:'Editar receita', tag:'Só optometrista', d:'Corrige grau, adição, DNP, tipo de lente, tratamentos e observações de uma receita já gerada. O motivo da alteração é obrigatório.', perfis:['opto','supervisor','diretor'] },
      { t:'Histórico de alterações', d:'Cada correção fica registrada com data, hora, quem alterou, o motivo e o valor antes e depois.' },
      { t:'Impressão', d:'A receita impressa sai sempre com os dados atuais. As correções ficam só no histórico do sistema.' },
    ] },
  { id:'resultados', perfis:['prevenda','supervisor','diretor'], rotulo:'Resultados', titulo:'Acompanhar resultados',
    cards:[
      { t:'Conversão', d:'Pacientes atendidos e quem comprou depois do exame. As vendas do PDV aparecem aqui sozinhas.' },
      { t:'No-Show', d:'Quem não compareceu, para a equipe retomar o contato e remarcar.' },
      { t:'Relatórios', d:'Funil Visão Ideal: agendados, comparecimentos, receitas e vendas, comparados com o período anterior.', perfis:GESTAO },
    ] },
  { id:'gestao', perfis:GESTAO, rotulo:'Supervisor e diretor', titulo:'Usuários e lojas',
    cards:[
      { t:'Usuários', d:'Cadastre pessoas com perfil e loja, redefina senhas e desative quem saiu. Inativos ficam escondidos.' },
      { t:'Lojas', d:'Adicione lojas com endereço e a agenda do Google. O botão Testar confere se a agenda está ligada.' },
      { t:'Quem vê o quê', d:'Optometrista, comercial e gerente veem só a própria loja. Pré-venda, supervisor e diretor veem todas. Só o optometrista gera e edita receitas.' },
    ] },
  { id:'automatico', perfis:TODOS, rotulo:'O sistema faz sozinho', titulo:'Regras automáticas',
    regras:[
      ['5 min','Agenda da IA','Novos horários marcados pela IA entram na agenda a cada 5 minutos.'],
      ['1 h','Não compareceu','Uma hora depois do horário, quem não tem receita vira Não compareceu.'],
      ['✓','Compareceu','Gerar a receita marca o paciente como Compareceu na hora.'],
      ['ABC','Maiúsculas','Nomes, endereços e observações são salvos sempre em letras maiúsculas.'],
    ] },
  { id:'duvidas', perfis:TODOS, rotulo:'Dúvidas frequentes', titulo:'Perguntas comuns',
    faq:[
      ['O sistema não deixa avançar para a refração.','Falta a data de nascimento ou o tipo de lente sugerido na anamnese. Preencha e clique de novo em Próximo.', ['opto']],
      ['Errei a receita depois de gerar. E agora?','Abra a receita em Receitas, clique em Editar receita, corrija e informe o motivo. A alteração fica no histórico.', ['opto','supervisor','diretor']],
      ['Não aparece o botão Gerar Receita.','Só o optometrista gera receitas. Confira se você entrou com o seu próprio usuário.', TODOS],
      ['Um paciente da IA não apareceu na agenda.','Aguarde até 5 minutos e recarregue a página. Se continuar faltando, avise o supervisor.', TODOS],
      ['A impressão não abre.','O navegador bloqueou a janela. Libere as janelas pop-up para agenda.clinicavisaoideal.com e tente de novo.', TODOS],
    ] },
];
const CORES_SEMANA = [['Agendado',{status:'Agendado'}],['Não compareceu',{status:'Não Compareceu'}],['Veio e não comprou',{status:'Compareceu'}],['Comprou',{status:'Compareceu',_compra:{converteu:true}}]];
function Manual({ user }) {
  const p = user.perfil;
  const vale = x => !x.perfis || x.perfis.includes(p);
  const editaReceita = ['opto','supervisor','diretor'].includes(p);
  const secoes = MANUAL.filter(vale).map(x => x.tituloConsulta && !editaReceita ? { ...x, titulo: x.tituloConsulta } : x);
  const telas = NAV_ITEMS.filter(n => PERFIS[p]?.nav.includes(n.id) && n.id !== 'manual').map(n => n.label);
  const ir = id => document.getElementById('man-'+id)?.scrollIntoView({ behavior:'smooth', block:'start' });
  const rotulo = t => <div style={{fontSize:12,fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',color:C.teal,marginBottom:4}}>{t}</div>;
  const cardBase = { background:C.white, borderRadius:16, padding:20, display:'flex', flexDirection:'column', gap:6, minWidth:0, border:`1px solid ${C.border}` };
  return (
    <div style={{maxWidth:960}}>
      <div style={{background:C.teal,color:C.white,borderRadius:20,padding:'28px 32px',marginBottom:20,display:'flex',flexDirection:'column',gap:8}}>
        <div style={{fontSize:12,fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase',opacity:.9}}>Manual do sistema</div>
        <h2 style={{fontSize:28,fontWeight:800,lineHeight:1.2}}>Como usar a agenda da Visão Ideal</h2>
        <p style={{fontSize:14,opacity:.95,maxWidth:640}}>Este manual mostra o que vale para o seu perfil: <strong>{PERFIS[p]?.label}</strong>{user.unidade ? <> · loja <strong>{user.unidade}</strong></> : ' · todas as lojas'}.</p>
        <div style={{fontSize:13,opacity:.95}}>Suas telas: {telas.join(' · ')}</div>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
        {secoes.map(x => <button key={x.id} onClick={()=>ir(x.id)} className="btn-sec"
          style={{padding:'7px 14px',borderRadius:999,fontSize:13,fontWeight:600,border:`1.5px solid ${C.border}`,background:C.white,color:C.textSm}}>{x.titulo}</button>)}
      </div>
      {secoes.map(x => (
        <section key={x.id} id={'man-'+x.id} style={{paddingTop:28,scrollMarginTop:80}}>
          {rotulo(x.rotulo)}
          <h3 style={{fontSize:22,fontWeight:800,color:C.navy,marginBottom:x.intro?6:14}}>{x.titulo}</h3>
          {x.intro && <p style={{fontSize:14,color:C.textSm,maxWidth:680,marginBottom:14,lineHeight:1.6}}>{x.intro}</p>}
          {x.cards && <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12}}>
            {x.cards.filter(vale).map(c => (
              <div key={c.t} style={cardBase}>
                {c.tag && <span style={{alignSelf:'flex-start',fontSize:11,fontWeight:700,borderRadius:999,padding:'2px 10px',background:C.tealBg,color:C.teal}}>{c.tag}</span>}
                <div style={{fontSize:15,fontWeight:800,color:C.navy}}>{c.t}</div>
                {c.d && <p style={{fontSize:13,color:C.textSm,lineHeight:1.55}}>{c.d}</p>}
                {c.lista && <ul style={{margin:0,paddingLeft:18,fontSize:13,color:C.textSm,lineHeight:1.55}}>{c.lista.map(l=><li key={l}>{l}</li>)}</ul>}
                {c.cores && <div style={{display:'flex',flexWrap:'wrap',gap:'6px 14px',marginTop:4}}>{CORES_SEMANA.map(([l,a]) => { const [bg,fg]=corJornada(a); return <span key={l} style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12,color:C.textSm}}><span style={{width:12,height:12,borderRadius:3,background:bg,borderLeft:`3px solid ${fg}`}}/>{l}</span>; })}</div>}
              </div>))}
          </div>}
          {x.passos && <ol style={{listStyle:'none',margin:0,padding:0,display:'flex',flexDirection:'column',gap:10}}>
            {x.passos.map((c,i) => (
              <li key={c.t} style={{...cardBase,flexDirection:'row',gap:16,alignItems:'flex-start'}}>
                <span style={{flexShrink:0,width:32,height:32,borderRadius:'50%',background:C.tealBg,color:C.teal,fontWeight:800,fontSize:14,display:'flex',alignItems:'center',justifyContent:'center'}}>{i+1}</span>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:15,fontWeight:800,color:C.navy}}>{c.t}</div>
                  <p style={{fontSize:13,color:C.textSm,lineHeight:1.55,marginTop:2}}>{c.d}</p>
                  {c.lista && <ul style={{margin:'6px 0 0',paddingLeft:18,fontSize:13,color:C.textSm,lineHeight:1.55}}>{c.lista.map(l=><li key={l}>{l}</li>)}</ul>}
                </div>
              </li>))}
          </ol>}
          {x.regras && <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:12}}>
            {x.regras.map(([n,t,d]) => (
              <div key={t} style={cardBase}>
                <div style={{fontSize:26,fontWeight:800,color:C.teal,lineHeight:1}}>{n}</div>
                <div style={{fontSize:14,fontWeight:800,color:C.navy,marginTop:4}}>{t}</div>
                <p style={{fontSize:13,color:C.textSm,lineHeight:1.55}}>{d}</p>
              </div>))}
          </div>}
          {x.faq && <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {x.faq.filter(([, , ps]) => ps.includes(p)).map(([q,a]) => (
              <details key={q} style={{...cardBase,display:'block',padding:'14px 18px'}}>
                <summary style={{fontWeight:700,fontSize:14,color:C.navy,cursor:'pointer'}}>{q}</summary>
                <p style={{fontSize:13,color:C.textSm,marginTop:8,lineHeight:1.55}}>{a}</p>
              </details>))}
          </div>}
        </section>
      ))}
      <p style={{fontSize:12,color:C.gray,padding:'32px 0 8px'}}>Dúvidas sobre o sistema: fale com o supervisor da sua loja.</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   HOOK REALTIME — escuta mudanças em tempo real
══════════════════════════════════════════════════════ */
function useRealtime(table, onchange) {
  // Usa ref para sempre chamar a versão mais atual do callback
  // sem precisar recriar a subscription a cada render
  const cbRef = useRef(onchange);
  useEffect(() => { cbRef.current = onchange; });
  useEffect(() => {
    let espera = null;
    const ch = supabase
      .channel(`rt_${table}_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, (...args) => {
        // várias alterações em sequência (ex.: sincronização do Google) viram uma recarga só
        clearTimeout(espera);
        espera = setTimeout(() => cbRef.current(...args), 400);
      })
      .subscribe();
    return () => { clearTimeout(espera); supabase.removeChannel(ch); };
  }, [table]);
}

/* ══════════════════════════════════════════════════════
   APP ROOT
══════════════════════════════════════════════════════ */
const SESSION_KEY = 'vi_session';

export default function App() {
  // Recupera sessão salva no localStorage
  const [usuario, setUsuario] = useState(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [tab, setTab] = useState(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (saved) {
        const u = JSON.parse(saved);
        return PERFIS[u.perfil]?.nav?.[0] || 'inicio';
      }
    } catch {}
    return 'inicio';
  });
  const [selectedUnidade, setSelectedUnidade] = useState(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      return saved ? (JSON.parse(saved).unidade || '') : '';
    } catch { return ''; }
  });

  const handleLogin = (u) => {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(u)); } catch {}
    setUsuario(u);
    const nav = PERFIS[u.perfil]?.nav || [];
    setTab(nav[0] || 'inicio');
    setSelectedUnidade(u.unidade || '');
  };

  // Confere a sessão do Supabase ao abrir o app. Sem sessão válida (ou usuário desativado),
  // volta para o login — os dados só respondem com sessão.
  const [verificando, setVerificando] = useState(() => {
    try { return !!localStorage.getItem(SESSION_KEY); } catch { return false; }
  });
  useEffect(() => {
    let vivo = true;
    usuarioDaSessao().then((u) => {
      if (!vivo) return;
      if (u) {
        try { localStorage.setItem(SESSION_KEY, JSON.stringify(u)); } catch {}
        setUsuario((atual) => (atual ? { ...atual, ...u } : u));
      } else {
        try { localStorage.removeItem(SESSION_KEY); } catch {}
        setUsuario(null);
      }
      setVerificando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT') {
        try { localStorage.removeItem(SESSION_KEY); } catch {}
        setUsuario(null);
      }
    });
    return () => { vivo = false; sub?.subscription?.unsubscribe(); };
  }, []);

  // Lojas do banco: carregadas ao entrar e recarregadas quando a tela Lojas salva algo
  const [lojasProntas, setLojasProntas] = useState(false);
  const recarregarLojas = useCallback(async () => {
    const lista = await listarUnidades();
    aplicarUnidades(lista);
    setLojasProntas(true);
    return lista;
  }, []);
  const usuarioId = usuario?.id;
  useEffect(() => { if (usuarioId) { recarregarLojas(); listarUsuarios(); } else setLojasProntas(false); }, [usuarioId, recarregarLojas]);

  const handleLogout = () => {
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    sair();
    setUsuario(null);
    setTab('inicio');
    setSelectedUnidade('');
  };


  if (verificando) return <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:C.bg}}><style>{GLOBAL_CSS}</style><Spinner/></div>;
  if (!usuario) return <Login onLogin={handleLogin}/>;
  if (!lojasProntas) return <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:C.bg}}><style>{GLOBAL_CSS}</style><Spinner/></div>;

  const navPerm = PERFIS[usuario.perfil]?.nav || [];
  // Quem não vê todas as lojas (opto, comercial, gerente) fica sempre preso à própria loja
  const veTodas = ['diretor','supervisor','prevenda'].includes(usuario.perfil);
  const lojaEfetiva = veTodas ? selectedUnidade : (usuario.unidade || '__sem_loja__');
  if (!navPerm.includes(tab)) return (
    <Layout user={usuario} tab={tab} setTab={setTab} onLogout={handleLogout} selectedUnidade={selectedUnidade} setSelectedUnidade={setSelectedUnidade}>
      <Card><p style={{textAlign:'center',padding:40,color:C.gray}}>Sem permissão para acessar esta seção.</p></Card>
    </Layout>
  );

  const pages = {
    inicio:       <Dashboard user={usuario} selectedUnidade={lojaEfetiva}/>,
    agenda:       <Agenda user={usuario} selectedUnidade={lojaEfetiva}/>,
    atendimento:  <Atendimento user={usuario} selectedUnidade={lojaEfetiva}/>,
    receitas:     <Receitas user={usuario} selectedUnidade={lojaEfetiva}/>,
    conversao:    <Conversao user={usuario} selectedUnidade={lojaEfetiva}/>,
    noshow:       <NoShow user={usuario} selectedUnidade={lojaEfetiva}/>,
    relatorios:   <Relatorios selectedUnidade={lojaEfetiva}/>,
    usuarios:     <Usuarios selectedUnidade={lojaEfetiva}/>,
    lojas:        <Lojas onAlterar={recarregarLojas}/>,
    manual:       <Manual user={usuario}/>,
  };

  return (
    <Layout user={usuario} tab={tab} setTab={setTab} onLogout={handleLogout} selectedUnidade={selectedUnidade} setSelectedUnidade={setSelectedUnidade}>
      {pages[tab] || <div>Página não encontrada</div>}
    </Layout>
  );
}
