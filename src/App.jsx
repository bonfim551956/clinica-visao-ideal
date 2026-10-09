
import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';

/* ── helpers ── */
const pad = n => String(n).padStart(2,'0');
const today = () => { const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const fmtDate = iso => { if(!iso) return ''; const [y,m,d]=iso.split('-'); return `${d}/${m}/${y}`; };
const uid = () => Math.random().toString(36).slice(2,10).toUpperCase();
const fmtMoney = v => Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

/* ── design tokens ── */
const C = {
  teal:'#16AFA3', tealD:'#0d8f8a', tealL:'#55BDB5', tealBg:'#e8f8f7',
  orange:'#F47700', orangeD:'#d96800', orangeBg:'#fff3e6',
  navy:'#173D43', bg:'#F8F8F5', white:'#fff',
  success:'#28A745', danger:'#DC3545', warn:'#FFC107',
  gray:'#6c757d', grayL:'#f0f0ee', border:'#dee2e6',
  text:'#173D43', textSm:'#555'
};

const HORARIOS = (() => {
  const h = [];
  for (let t = 8*60; t <= 18*60+45; t += 15) {
    h.push(`${pad(Math.floor(t/60))}:${pad(t%60)}`);
  }
  return h;
})();

const PROCEDIMENTOS = ['Consulta','Retorno'];
const MEIOS_CONTATO = ['Loja','Visão Ideal'];
const SPH = ['Plano','+0,25','+0,50','+0,75','+1,00','+1,25','+1,50','+1,75','+2,00','+2,25','+2,50',
  '+2,75','+3,00','+3,50','+4,00','+4,50','+5,00','+5,50','+6,00',
  '-0,25','-0,50','-0,75','-1,00','-1,25','-1,50','-1,75','-2,00','-2,25','-2,50',
  '-2,75','-3,00','-3,50','-4,00','-4,50','-5,00','-5,50','-6,00','-7,00','-8,00'];
const CYL = ['Plano','-0,25','-0,50','-0,75','-1,00','-1,25','-1,50','-1,75','-2,00','-2,50','-3,00'];
const AXIS = Array.from({length:180},(_,i)=>String(i+1));
const ADD_VALS = ['N/A','+0,75','+1,00','+1,25','+1,50','+1,75','+2,00','+2,25','+2,50','+2,75','+3,00'];
const DNP_VALS = ['N/A','28','29','30','31','32','33','34','35','36','37','38','39','40'];

const PERFIS = {
  opto:      { label:'Optometrista', cor:C.teal,    nav:['inicio','agenda','agendamentos','atendimento','receitas'] },
  comercial: { label:'Comercial',    cor:'#E91E8C',  nav:['inicio','agendamentos','atendimento','receitas'] },
  prevenda:  { label:'Pré-Venda',    cor:'#6F42C1',  nav:['inicio','conversao','noshow','receitas'] },
  gerente:   { label:'Gerente',      cor:C.orange,   nav:['inicio','agenda','agendamentos','atendimento','receitas','conversao','noshow','relatorios'] },
  supervisor:{ label:'Supervisor',   cor:'#007BFF',  nav:['inicio','agenda','agendamentos','atendimento','receitas','conversao','noshow','relatorios','usuarios'] },
  diretor:   { label:'Diretor',      cor:C.navy,     nav:['inicio','agenda','agendamentos','atendimento','receitas','conversao','noshow','relatorios','usuarios'] },
};

const UNIDADES = ['São Vicente','Piracicaba','Sorocaba','Campinas'];

// Endereços por unidade — para cabeçalho da receita e rodapé
const ENDERECOS_UNIDADES = {
  'São Vicente': 'Av. Antônio Emerich, 477 - Vila Melo – São Vicente – SP',
  'Piracicaba':  'Rua Benjamin Constant, 1379 - Centro – Piracicaba – SP',
  'Sorocaba':    'R. Comendador Hermelino Matarazzo, 468 - Vila Santana – Sorocaba – SP',
  'Campinas':    'Rua Conceição, 233, Sala 604 - Centro – Campinas – SP',
};

// Perfis que veem os KPIs comerciais (Conversões, Faturamento, No-Show, Taxa Conv.)
const PERFIS_COMERCIAL = ['prevenda','supervisor','diretor','gerente'];

const NAV_ITEMS = [
  { id:'inicio',       label:'Início'       },
  { id:'agenda',       label:'Agenda'       },
  { id:'agendamentos', label:'Agendamentos' },
  { id:'atendimento',  label:'Atendimento'  },
  { id:'receitas',     label:'Receitas'     },
  { id:'conversao',    label:'Conversão'    },
  { id:'noshow',       label:'No-Show'      },
  { id:'relatorios',   label:'Relatórios'   },
  { id:'usuarios',     label:'Usuários'     },
];

/* ── CSS global ── */
const GLOBAL_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',sans-serif;background:${C.bg};color:${C.text};font-size:14px}
button{cursor:pointer;border:none;outline:none;font-family:inherit}
input,select,textarea{font-family:inherit;outline:none}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:#f1f1f1}
::-webkit-scrollbar-thumb{background:#ccc;border-radius:3px}
.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.resp-grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.resp-grid-2{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.resp-grid-main{display:grid;grid-template-columns:1fr 300px;gap:16px}
@media(max-width:767px){
  .resp-grid-4{grid-template-columns:1fr 1fr;gap:10px}
  .resp-grid-2{grid-template-columns:1fr}
  .resp-grid-main{grid-template-columns:1fr}
  .hide-mobile{display:none!important}
}
`;

function useIsMobile(){ const [m,setM]=useState(window.innerWidth<768); useEffect(()=>{const h=()=>setM(window.innerWidth<768);window.addEventListener('resize',h);return()=>window.removeEventListener('resize',h)},[]);return m; }

/* ── primitives ── */
const Btn = ({children,onClick,color=C.teal,outline=false,size='md',style:sx={},...p}) => {
  const pad = size==='sm'?'6px 14px':size==='lg'?'12px 28px':'9px 20px';
  const fs = size==='sm'?'13px':'14px';
  return <button onClick={onClick} style={{background:outline?'transparent':color,color:outline?color:C.white,border:`2px solid ${color}`,borderRadius:24,padding:pad,fontSize:fs,fontWeight:600,transition:'all .15s',...sx}} {...p}>{children}</button>;
};
const Card = ({children,style:sx={}}) => <div style={{background:C.white,borderRadius:16,padding:20,boxShadow:'0 2px 8px rgba(0,0,0,.06)',...sx}}>{children}</div>;
const Badge = ({children,color=C.teal}) => <span style={{background:color+'22',color,borderRadius:20,padding:'2px 10px',fontSize:12,fontWeight:600}}>{children}</span>;
const Input = ({label,style:sx={},...p}) => <div style={{display:'flex',flexDirection:'column',gap:4,...sx}}>{label&&<label style={{fontSize:12,fontWeight:600,color:C.textSm}}>{label}</label>}<input style={{border:`1.5px solid ${C.border}`,borderRadius:8,padding:'8px 12px',fontSize:14,background:C.white}} {...p}/></div>;
const Select = ({label,options=[],style:sx={},...p}) => <div style={{display:'flex',flexDirection:'column',gap:4,...sx}}><label style={{fontSize:12,fontWeight:600,color:C.textSm}}>{label}</label><select style={{border:`1.5px solid ${C.border}`,borderRadius:8,padding:'8px 12px',fontSize:14,background:C.white}} {...p}>{options.map(o=><option key={o.value??o} value={o.value??o}>{o.label??o}</option>)}</select></div>;
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
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('nome', user)
      .eq('senha', pass)
      .eq('ativo', true)
      .single();
    setLoading(false);
    if (error || !data) { setErr('Usuário ou senha incorretos'); return; }
    onLogin(data);
  };

  return (
    <div style={{minHeight:'100vh',display:'flex',background:C.bg}}>
      <style>{GLOBAL_CSS}</style>
      {/* Left panel */}
      <div className="hide-mobile" style={{width:420,background:`linear-gradient(160deg,${C.navy} 0%,${C.teal} 100%)`,display:'flex',flexDirection:'column',justifyContent:'center',padding:56,color:C.white}}>
        <img src="/logo-clinica.png" alt="Clínica Visão Ideal" style={{width:180,marginBottom:32,filter:'brightness(0) invert(1)'}}/>
        <div style={{fontSize:15,opacity:.8,marginBottom:40}}>Sistema de Gestão Clínica</div>
        {['Agenda inteligente por optometrista','Fluxo completo de atendimento','Controle de conversão e no-show','Relatórios e indicadores em tempo real'].map(t=>(
          <div key={t} style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,fontSize:14,opacity:.9}}>
            <span style={{width:8,height:8,borderRadius:'50%',background:C.orange,flexShrink:0}}/>
            {t}
          </div>
        ))}
      </div>
      {/* Right form */}
      <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
        <div style={{width:'100%',maxWidth:380}}>
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
function Layout({ user, tab, setTab, onLogout, children }) {
  const isMobile = useIsMobile();
  const [drawer, setDrawer] = useState(false);
  const navItems = NAV_ITEMS.filter(n => PERFIS[user.perfil]?.nav.includes(n.id));
  const perfil = PERFIS[user.perfil];

  const SideNav = ({ onItemClick }) => (
    <nav style={{display:'flex',flexDirection:'column',gap:2,padding:'8px 0'}}>
      {navItems.map(n => (
        <button key={n.id} onClick={()=>{setTab(n.id);onItemClick&&onItemClick();}}
          style={{display:'flex',alignItems:'center',gap:10,padding:'10px 16px',borderRadius:10,margin:'0 8px',
            background:tab===n.id?C.teal+'22':'transparent',color:tab===n.id?C.teal:C.text,
            fontWeight:tab===n.id?700:400,fontSize:14,border:'none',cursor:'pointer',textAlign:'left'}}>
          {n.label}
        </button>
      ))}
      <div style={{borderTop:`1px solid ${C.border}`,margin:'8px 16px',paddingTop:8}}>
        <button onClick={onLogout} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 8px',color:C.danger,background:'none',border:'none',cursor:'pointer',fontSize:14,width:'100%'}}>
          Sair
        </button>
      </div>
    </nav>
  );

  if (isMobile) return (
    <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',background:C.bg}}>
      <style>{GLOBAL_CSS}</style>
      {/* Mobile header */}
      <div style={{position:'fixed',top:0,left:0,right:0,height:52,background:C.white,borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 16px',zIndex:200}}>
        <button onClick={()=>setDrawer(true)} style={{background:'none',fontSize:22,color:C.navy,border:'none',fontWeight:700}}>&#9776;</button>
        <img src="/logo-clinica.png" alt="Clínica Visão Ideal" style={{height:30,objectFit:'contain'}}/>
        <Badge color={perfil?.cor||C.teal}>{perfil?.label}</Badge>
      </div>
      {/* Drawer */}
      {drawer && <>
        <div onClick={()=>setDrawer(false)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:300}}/>
        <div style={{position:'fixed',top:0,left:0,bottom:0,width:260,background:C.white,zIndex:400,overflowY:'auto',boxShadow:'4px 0 16px rgba(0,0,0,.1)'}}>
          <div style={{padding:'16px',background:`linear-gradient(135deg,${C.navy},${C.teal})`,color:C.white,display:'flex',flexDirection:'column',alignItems:'center',gap:8}}>
            <img src="/logo-clinica.png" alt="Clínica Visão Ideal" style={{width:120,filter:'brightness(0) invert(1)'}}/>
            <div style={{fontSize:12,opacity:.8}}>{user.nome} · {perfil?.label}</div>
          </div>
          <SideNav onItemClick={()=>setDrawer(false)}/>
        </div>
      </>}
      {/* Content */}
      <div style={{flex:1,marginTop:52,padding:'16px 12px 80px'}}>
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

  return (
    <div style={{minHeight:'100vh',display:'flex',background:C.bg}}>
      <style>{GLOBAL_CSS}</style>
      {/* Sidebar */}
      <div style={{width:200,background:C.white,borderRight:`1px solid ${C.border}`,position:'fixed',top:0,left:0,bottom:0,overflowY:'auto',display:'flex',flexDirection:'column'}}>
        <div style={{padding:'16px',background:`linear-gradient(135deg,${C.navy},${C.teal})`,color:C.white,display:'flex',flexDirection:'column',alignItems:'center'}}>
          <img src="/logo-clinica.png" alt="Clínica Visão Ideal" style={{width:140,filter:'brightness(0) invert(1)'}}/>
        </div>
        <div style={{flex:1,overflowY:'auto'}}><SideNav/></div>
        <div style={{padding:'12px 16px',borderTop:`1px solid ${C.border}`,fontSize:12}}>
          <div style={{fontWeight:600,color:C.navy}}>{user.nome}</div>
          <Badge color={perfil?.cor||C.teal} style={{marginTop:4}}>{perfil?.label}</Badge>
          {user.unidade && <div style={{color:C.teal,marginTop:4,fontWeight:600,fontSize:11}}>📍 {user.unidade}</div>}
          {user.cro && <div style={{color:C.gray,marginTop:2}}>CRO: {user.cro}</div>}
        </div>
      </div>
      {/* Main */}
      <div style={{marginLeft:200,flex:1,display:'flex',flexDirection:'column',minHeight:'100vh'}}>
        <div style={{height:52,background:C.white,borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 24px',position:'sticky',top:0,zIndex:100}}>
          <h1 style={{fontSize:16,fontWeight:700,color:C.navy}}>{NAV_ITEMS.find(n=>n.id===tab)?.label}</h1>
          <span style={{color:C.gray,fontSize:13}}>{fmtDate(today())}</span>
        </div>
        <div style={{flex:1,padding:24,maxWidth:1200}}>{children}</div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════════════ */
function Dashboard({ user }) {
  const [stats, setStats] = useState({ agendados:0, compareceu:0, naoComp:0, receitas:0, conversoes:0, valorTotal:0, noshow:0 });
  const [loading, setLoading] = useState(true);
  const [proximos, setProximos] = useState([]);

  useEffect(() => {
    const load = async () => {
      const [ag, rec, conv, prox] = await Promise.all([
        supabase.from('agenda').select('status').gte('data', today()),
        supabase.from('receitas').select('id').gte('data', today()),
        supabase.from('conversoes').select('converteu,valor_venda'),
        supabase.from('agenda').select('*').eq('data', today()).eq('status','Agendado').order('hora').limit(8),
      ]);
      const agenda = ag.data || [];
      const cvs = conv.data || [];
      const totalConv = cvs.filter(c=>c.converteu).length;
      const valorTotal = cvs.filter(c=>c.converteu).reduce((s,c)=>s+Number(c.valor_venda||0),0);
      const naoComp = agenda.filter(a=>a.status==='Não Compareceu').length;
      const total = agenda.length || 1;
      setStats({
        agendados: agenda.filter(a=>a.status==='Agendado').length,
        compareceu: agenda.filter(a=>a.status==='Compareceu').length,
        naoComp,
        receitas: (rec.data||[]).length,
        conversoes: totalConv,
        valorTotal,
        noshow: Math.round((naoComp/total)*100),
        taxaConv: cvs.length ? Math.round((totalConv/cvs.length)*100) : 0,
      });
      setProximos(prox.data||[]);
      setLoading(false);
    };
    load();
  }, []);

  const KPI = ({label, value, sub, color=C.teal}) => (
    <Card style={{textAlign:'center'}}>
      <div style={{fontSize:28,fontWeight:800,color}}>{value}</div>
      <div style={{fontSize:13,fontWeight:600,color:C.navy,marginTop:4}}>{label}</div>
      {sub && <div style={{fontSize:11,color:C.gray,marginTop:2}}>{sub}</div>}
    </Card>
  );

  const verComercial = PERFIS_COMERCIAL.includes(user.perfil);

  if (loading) return <Spinner/>;
  return (
    <div>
      <h2 style={{fontSize:20,fontWeight:700,color:C.navy,marginBottom:16}}>Olá, {user.nome.split(' ')[0]}!</h2>
      <div className="resp-grid-4" style={{marginBottom:20}}>
        <KPI label="Agendados Hoje" value={stats.agendados} color={C.teal}/>
        <KPI label="Compareceram" value={stats.compareceu} color={C.success}/>
        <KPI label="Não Compareceu" value={stats.naoComp} color={C.danger}/>
        <KPI label="Receitas Hoje" value={stats.receitas} color='#6F42C1'/>
        {verComercial && <KPI label="Conversões" value={stats.conversoes} color={C.orange}/>}
        {verComercial && <KPI label="Faturamento" value={fmtMoney(stats.valorTotal)} color={C.teal}/>}
        {verComercial && <KPI label="Taxa No-Show" value={`${stats.noshow}%`} color={C.danger}/>}
        {verComercial && <KPI label="Taxa Conversão" value={`${stats.taxaConv||0}%`} color={C.success}/>}
      </div>
      <Card>
        <h3 style={{fontSize:15,fontWeight:700,marginBottom:14,color:C.navy}}>Proximas Consultas Hoje</h3>
        {proximos.length === 0 ? <p style={{color:C.gray,textAlign:'center',padding:20}}>Nenhum agendamento encontrado</p> : (
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead>
                <tr style={{background:C.teal,color:C.white}}>
                  {['Hora','Paciente','Optometrista','Procedimento','Status'].map(h=>(
                    <th key={h} style={{padding:'8px 12px',textAlign:'left'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {proximos.map((a,i)=>(
                  <tr key={a.id} style={{background:i%2===0?C.white:C.bg}}>
                    <td style={{padding:'8px 12px',fontWeight:600,color:C.teal}}>{a.hora}</td>
                    <td style={{padding:'8px 12px'}}>{a.paciente_nome}</td>
                    <td style={{padding:'8px 12px'}}>{a.opto_nome}</td>
                    <td style={{padding:'8px 12px'}}>{a.procedimento}</td>
                    <td style={{padding:'8px 12px'}}><Badge color={C.success}>{a.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   AGENDA
══════════════════════════════════════════════════════ */
function Agenda({ user }) {
  const [slots, setSlots] = useState([]);
  const [optos, setOptos] = useState([]);
  const [selOpto, setSelOpto] = useState('');
  const [selData, setSelData] = useState(today());
  const [modal, setModal] = useState(null); // null | { hora, existing }
  const [pacientes, setPacientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  useEffect(() => {
    supabase.from('usuarios').select('*').eq('perfil','opto').eq('ativo',true).then(({data})=>{
      setOptos(data||[]);
      const first = data?.[0];
      if (first) setSelOpto(first.id);
    });
    supabase.from('pacientes').select('*').order('nome').then(({data})=>setPacientes(data||[]));
  }, []);

  const loadSlots = async (opto, data) => {
    if (!opto || !data) return;
    // Busca agendamentos do opto selecionado + agendamentos da IA (opto_id null) na mesma data
    const [res1, res2] = await Promise.all([
      supabase.from('agenda').select('*').eq('opto_id', opto).eq('data', data),
      supabase.from('agenda').select('*').is('opto_id', null).eq('data', data)
    ]);
    const combined = [...(res1.data||[]), ...(res2.data||[])];
    // Deduplica por id e ordena por hora
    const seen = new Set();
    const unique = combined.filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; });
    unique.sort((a,b) => a.hora.localeCompare(b.hora));
    return unique;
  };

  useEffect(() => {
    if (!selOpto || !selData) return;
    setLoading(true);
    loadSlots(selOpto, selData).then(data => { setSlots(data||[]); setLoading(false); });
  }, [selOpto, selData]);

  // Realtime: atualiza slots automaticamente
  useRealtime('agenda', () => {
    if (!selOpto || !selData) return;
    loadSlots(selOpto, selData).then(data => setSlots(data||[]));
  });

  // Auto-update: agendamentos da data atual com mais de 1h sem atendimento → Não Compareceu
  useEffect(()=>{
    const checkNoshow = async () => {
      const now = new Date();
      const dd = today();
      const { data: agendados } = await supabase.from('agenda')
        .select('id,hora,data').eq('status','Agendado').eq('data',dd);
      if (!agendados?.length) return;
      const vencidos = agendados.filter(a => {
        const [h,m] = a.hora.split(':').map(Number);
        const agendadoMs = new Date(dd+'T'+a.hora+':00').getTime();
        return now.getTime() - agendadoMs > 60*60*1000; // mais de 1 hora
      });
      if (!vencidos.length) return;
      await Promise.all(vencidos.map(a =>
        supabase.from('agenda').update({status:'Não Compareceu'}).eq('id',a.id)
      ));
      // Recarrega slots se a data exibida for hoje
      if (selData === dd && selOpto) {
        loadSlots(selOpto, dd).then(data => setSlots(data||[]));
      }
    };
    checkNoshow();
    const interval = setInterval(checkNoshow, 5*60*1000); // verifica a cada 5 min
    return () => clearInterval(interval);
  }, [selOpto, selData]);

  const getSlot = hora => slots.find(s=>s.hora===hora);

  const handleSave = async (form) => {
    const pac = pacientes.find(p=>p.id===form.pacienteId)||{nome:form.pacienteNome};
    const opto = optos.find(o=>o.id===selOpto);
    const row = { id:uid(), paciente_id:form.pacienteId||null, paciente_nome:pac?.nome||form.pacienteNome,
      paciente_telefone:form.telefone||'',
      opto_id:selOpto, opto_nome:opto?.nome, data:form.data||selData, hora:form.hora,
      procedimento:form.procedimento, meio_contato:form.meioContato, status:'Agendado', observacoes:form.obs||'',
      agendado_por: user?.nome||'', unidade: opto?.unidade||'' };
    if (modal.existing) {
      await supabase.from('agenda').update(row).eq('id',modal.existing.id);
    } else {
      await supabase.from('agenda').insert(row);
    }
    loadSlots(selOpto, selData).then(data => setSlots(data||[]));
    setModal(null);
    showToast('Agendamento salvo!');
  };

  const handleDelete = async (id) => {
    await supabase.from('agenda').delete().eq('id',id);
    setSlots(s=>s.filter(x=>x.id!==id));
    setModal(null);
    showToast('Agendamento removido.');
  };

  return (
    <div>
      <Toast msg={toast}/>
      <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'flex-end',marginBottom:20}}>
        <Select label="Optometrista" value={selOpto} onChange={e=>setSelOpto(e.target.value)}
          options={optos.map(o=>({value:o.id,label:o.nome}))} style={{minWidth:200}}/>
        <Input label="Data" type="date" value={selData} onChange={e=>setSelData(e.target.value)}/>
        <Btn onClick={()=>setModal({hora:HORARIOS[0]})} color={C.orange}>+ Novo Agendamento</Btn>
      </div>
      {loading ? <Spinner/> : (
        <Card>
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead>
                <tr style={{background:C.teal,color:C.white}}>
                  {['Horário','Paciente','Procedimento','Contato','Status',''].map(h=>(
                    <th key={h} style={{padding:'9px 12px',textAlign:'left'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {HORARIOS.map((hora,i) => {
                  const horaSlots = slots.filter(s => s.hora === hora);
                  if (horaSlots.length === 0) {
                    return (
                      <tr key={hora} style={{background:i%2===0?C.white:C.bg,borderBottom:`1px solid ${C.border}`}}>
                        <td style={{padding:'8px 12px',fontWeight:600,color:C.teal,whiteSpace:'nowrap'}}>{hora}</td>
                        <td style={{padding:'8px 12px'}}><span style={{color:C.border}}>—</span></td>
                        <td style={{padding:'8px 12px'}}></td>
                        <td style={{padding:'8px 12px'}}></td>
                        <td style={{padding:'8px 12px'}}></td>
                        <td style={{padding:'8px 12px'}}>
                          <Btn size="sm" color={C.orange} outline onClick={()=>setModal({hora})}>+ Agendar</Btn>
                        </td>
                      </tr>
                    );
                  }
                  return horaSlots.map((slot, si) => (
                    <tr key={slot.id} style={{background:i%2===0?C.white:C.bg,borderBottom:si===horaSlots.length-1?`1px solid ${C.border}`:'none'}}>
                      <td style={{padding:'8px 12px',fontWeight:600,color:C.teal,whiteSpace:'nowrap'}}>{si===0?hora:''}</td>
                      <td style={{padding:'8px 12px'}}>
                        {slot.paciente_nome}
                        {slot.agendado_por==='IA' && <span style={{marginLeft:6,fontSize:10,background:C.orangeBg,color:C.orange,borderRadius:4,padding:'1px 5px'}}>IA</span>}
                      </td>
                      <td style={{padding:'8px 12px'}}>{slot.procedimento||''}</td>
                      <td style={{padding:'8px 12px'}}>{slot.meio_contato||''}</td>
                      <td style={{padding:'8px 12px'}}><Badge color={slot.status==='Compareceu'?C.success:slot.status==='Não Compareceu'?C.danger:C.teal}>{slot.status}</Badge></td>
                      <td style={{padding:'8px 12px'}}>
                        <Btn size="sm" color={C.teal} outline onClick={()=>setModal({hora,existing:slot})}>Editar</Btn>
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {modal && <AgendaModal hora={modal.hora} existing={modal.existing} pacientes={pacientes} optos={optos}
        onSave={handleSave} onDelete={handleDelete} onClose={()=>setModal(null)}/>}
    </div>
  );
}

function AgendaModal({ hora, existing, pacientes, optos, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({
    hora: existing?.hora||hora,
    data: existing?.data||today(),
    pacienteId: existing?.paciente_id||'',
    pacienteNome: existing?.paciente_nome||'',
    telefone: existing?.paciente_telefone||'',
    dataNasc: '',
    procedimento: existing?.procedimento||PROCEDIMENTOS[0],
    meioContato: existing?.meio_contato||MEIOS_CONTATO[0],
    obs: existing?.observacoes||'',
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
      if (!error && pacData) {
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
          <Select label="Horário" value={form.hora} onChange={e=>set('hora',e.target.value)} options={HORARIOS}/>
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
                  onChange={e=>handleBusca(e.target.value)}
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
                style={{background:C.orange,color:C.white,border:'none',borderRadius:8,
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
                <div style={{fontWeight:700,color:C.tealD}}>{form.pacienteNome}</div>
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
          <div style={{background:'#fff8f0',border:`1.5px solid ${C.orange}`,borderRadius:12,padding:16}}>
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
                <input value={form.pacienteNome} onChange={e=>set('pacienteNome',e.target.value)}
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

/* ══════════════════════════════════════════════════════
   AGENDAMENTOS (lista filtrada)
══════════════════════════════════════════════════════ */
function Agendamentos({ user, onAtender }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtros, setFiltros] = useState({ data: today(), opto:'', status:'', proc:'', agendadoPor:'', unidade:'' });
  const [optos, setOptos] = useState([]);
  const [prevs, setPrevs] = useState([]);
  const [toast, setToast] = useState('');
  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  useEffect(()=>{
    supabase.from('usuarios').select('*').eq('perfil','opto').then(({data})=>setOptos(data||[]));
    // Carrega pré-vendas + IA para o filtro de responsável
    supabase.from('usuarios').select('nome').in('perfil',['prevenda','supervisor','diretor','gerente'])
      .then(({data})=>{
        const nomes = (data||[]).map(u=>u.nome);
        if (!nomes.includes('IA')) nomes.push('IA');
        setPrevs(nomes.sort());
      });
  },[]);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('agenda').select('*').order('hora');
    if (filtros.data) q = q.eq('data', filtros.data);
    if (filtros.opto) q = q.eq('opto_id', filtros.opto);
    if (filtros.status) q = q.eq('status', filtros.status);
    if (filtros.proc) q = q.eq('procedimento', filtros.proc);
    if (filtros.agendadoPor) q = q.eq('agendado_por', filtros.agendadoPor);
    if (filtros.unidade) q = q.eq('unidade', filtros.unidade);
    const {data} = await q;
    setRows(data||[]);
    setLoading(false);
  }, [filtros]);

  useEffect(()=>{ load(); },[load]);

  const setStatus = async (id, status) => {
    await supabase.from('agenda').update({status}).eq('id',id);
    showToast(`Status atualizado: ${status}`);
    load();
  };

  return (
    <div>
      <Toast msg={toast}/>
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
          <Select label="Unidade" value={filtros.unidade} onChange={e=>setFiltros(f=>({...f,unidade:e.target.value}))}
            options={[{value:'',label:'Todas'},...UNIDADES.map(u=>({value:u,label:u}))]}/>
        </div>
      </Card>
      {loading ? <Spinner/> : (
        <Card>
          <p style={{fontSize:13,color:C.gray,marginBottom:12}}>{rows.length} registro(s)</p>
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead>
                <tr style={{background:C.teal,color:C.white}}>
                  {['Data','Hora','Paciente','Opto','Procedimento','Contato','Agendado por','Status','Ações'].map(h=>(
                    <th key={h} style={{padding:'9px 12px',textAlign:'left',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((a,i)=>(
                  <tr key={a.id} style={{background:i%2===0?C.white:C.bg,borderBottom:`1px solid ${C.border}`}}>
                    <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>{fmtDate(a.data)}</td>
                    <td style={{padding:'8px 12px',fontWeight:600,color:C.teal}}>{a.hora}</td>
                    <td style={{padding:'8px 12px'}}>{a.paciente_nome}</td>
                    <td style={{padding:'8px 12px'}}>{a.opto_nome}</td>
                    <td style={{padding:'8px 12px'}}>{a.procedimento}</td>
                    <td style={{padding:'8px 12px'}}>{a.meio_contato}</td>
                    <td style={{padding:'8px 12px'}}>
                      {a.agendado_por
                        ? <span style={{
                            display:'inline-block',padding:'2px 10px',borderRadius:20,fontSize:12,fontWeight:600,
                            background: a.agendado_por==='IA' ? C.orangeBg : C.tealBg,
                            color: a.agendado_por==='IA' ? C.orange : C.teal
                          }}>{a.agendado_por}</span>
                        : <span style={{color:C.gray,fontSize:12}}>—</span>}
                    </td>
                    <td style={{padding:'8px 12px'}}>
                      <Badge color={a.status==='Compareceu'?C.success:a.status==='Não Compareceu'?C.danger:a.status==='Cancelado'?C.gray:C.teal}>{a.status}</Badge>
                    </td>
                    <td style={{padding:'8px 12px'}}>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        {a.status==='Agendado' && <>
                          <Btn size="sm" color={C.success} onClick={()=>setStatus(a.id,'Compareceu')}>Comp.</Btn>
                          <Btn size="sm" color={C.danger} outline onClick={()=>setStatus(a.id,'Não Compareceu')}>N. Comp.</Btn>
                        </>}
                        {a.status==='Compareceu' && PERFIS[user.perfil]?.nav.includes('atendimento') &&
                          <Btn size="sm" color={C.teal} onClick={()=>onAtender(a)}>Atender</Btn>}
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
   ATENDIMENTO
══════════════════════════════════════════════════════ */
function Atendimento({ user, agendaItem, clearAgendaItem }) {
  const [fila, setFila] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);
  const [tabAte, setTabAte] = useState('anamnese');
  const [form, setForm] = useState({ anamnese:'', queixa:'', medicamentos:'',
    od_esf:'Plano',od_cil:'Plano',od_eixo:'90',od_add:'N/A',od_dnp:'N/A',
    oe_esf:'Plano',oe_cil:'Plano',oe_eixo:'90',oe_add:'N/A',oe_dnp:'N/A' });
  const [receita, setReceita] = useState(null);
  const [toast, setToast] = useState('');
  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };
  const setF = (k,v) => setForm(f=>({...f,[k]:v}));

  const loadFila = useCallback(() => {
    supabase.from('agenda').select('*').eq('data',today()).eq('status','Compareceu').order('hora')
      .then(({data})=>{ setFila(data||[]); setLoading(false); });
  }, []);

  useEffect(()=>{ loadFila(); },[loadFila]);

  // Realtime: fila atualiza quando status muda
  useRealtime('agenda', loadFila);

  // Quando chegar item de Agendamentos: selecionar diretamente
  useEffect(()=>{
    if (!agendaItem) return;
    setSel(agendaItem);
    setTabAte('anamnese');
    setForm({ anamnese:'', queixa:'', medicamentos:'',
      od_esf:'Plano',od_cil:'Plano',od_eixo:'90',od_add:'N/A',od_dnp:'N/A',
      oe_esf:'Plano',oe_cil:'Plano',oe_eixo:'90',oe_add:'N/A',oe_dnp:'N/A' });
    setReceita(null);
    clearAgendaItem();
  },[agendaItem]);

  useEffect(()=>{
    if (!sel) return;
    supabase.from('receitas').select('*').eq('agenda_id',sel.id).single()
      .then(({data})=>{ if(data) setReceita(data); });
  },[sel]);

  const iniciarAtendimento = (a) => {
    setSel(a);
    setTabAte('anamnese');
    setForm({ anamnese:'', queixa:'', medicamentos:'',
      od_esf:'Plano',od_cil:'Plano',od_eixo:'90',od_add:'N/A',od_dnp:'N/A',
      oe_esf:'Plano',oe_cil:'Plano',oe_eixo:'90',oe_add:'N/A',oe_dnp:'N/A' });
    setReceita(null);
  };

  const gerarReceita = async () => {
    const opto = user;
    const agora = new Date();
    const dataHora = `${agora.getFullYear()}-${pad(agora.getMonth()+1)}-${pad(agora.getDate())} ${pad(agora.getHours())}:${pad(agora.getMinutes())}`;
    const row = {
      id:uid(), agenda_id:sel.id, paciente_nome:sel.paciente_nome,
      paciente_telefone:sel.paciente_telefone||'',
      opto_id:opto.id, opto_nome:opto.nome, opto_cro:opto.cro||'', opto_unidade:opto.unidade||'',
      opto_endereco:opto.endereco||ENDERECOS_UNIDADES[opto.unidade]||'',
      data:today(), data_hora_atendimento: dataHora,
      meio_contato: sel.meio_contato||'', agendado_por: sel.agendado_por||'',
      unidade: opto.unidade||'',
      od_esf:form.od_esf, od_cil:form.od_cil, od_eixo:form.od_eixo, od_adicao:form.od_add, od_dnp:form.od_dnp,
      oe_esf:form.oe_esf, oe_cil:form.oe_cil, oe_eixo:form.oe_eixo, oe_adicao:form.oe_add, oe_dnp:form.oe_dnp,
      observacoes:form.anamnese,
    };
    const {data} = await supabase.from('receitas').insert(row).select().single();
    setReceita(data);
    showToast('Receita gerada! Pre-venda ja pode registrar a conversao.');
    setTabAte('receita');
  };

  const RxField = ({label,fk,opts}) => (
    <td style={{padding:'6px 8px'}}>
      <select value={form[fk]} onChange={e=>setF(fk,e.target.value)}
        style={{border:`1px solid ${C.border}`,borderRadius:6,padding:'4px 6px',fontSize:12,width:'100%',background:C.white}}>
        {opts.map(o=><option key={o}>{o}</option>)}
      </select>
    </td>
  );

  if (!sel) return (
    <div>
      <Toast msg={toast}/>
      <h3 style={{fontSize:16,fontWeight:700,marginBottom:16,color:C.navy}}>Fila do Dia — {fmtDate(today())}</h3>
      {loading ? <Spinner/> : fila.length===0 ? (
        <Card><p style={{textAlign:'center',color:C.gray,padding:20}}>Nenhum paciente aguardando atendimento</p></Card>
      ) : (
        <Card>
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr style={{background:C.teal,color:C.white}}>
                {['Hora','Paciente','Procedimento','Contato',''].map(h=><th key={h} style={{padding:'9px 12px',textAlign:'left'}}>{h}</th>)}
              </tr></thead>
              <tbody>{fila.map((a,i)=>(
                <tr key={a.id} style={{background:i%2===0?C.white:C.bg,borderBottom:`1px solid ${C.border}`}}>
                  <td style={{padding:'8px 12px',fontWeight:600,color:C.teal}}>{a.hora}</td>
                  <td style={{padding:'8px 12px',fontWeight:500}}>{a.paciente_nome}</td>
                  <td style={{padding:'8px 12px'}}>{a.procedimento}</td>
                  <td style={{padding:'8px 12px'}}>{a.meio_contato||'—'}</td>
                  <td style={{padding:'8px 12px'}}>
                    <Btn size="sm" color={C.teal} onClick={()=>iniciarAtendimento(a)}>Atender</Btn>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );

  const tabs = [
    {id:'anamnese',label:'Anamnese'},
    {id:'refracao',label:'Refracao'},
    {id:'receita',label:'Receita',disabled:!receita},
  ];

  return (
    <div>
      <Toast msg={toast}/>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20}}>
        <Btn size="sm" color={C.gray} outline onClick={()=>{setSel(null);setReceita(null);setTabAte('anamnese');}}>Voltar</Btn>
        <div>
          <h3 style={{fontSize:16,fontWeight:700,color:C.navy}}>{sel.paciente_nome}</h3>
          <p style={{fontSize:12,color:C.gray}}>{sel.procedimento} · {sel.hora} · {fmtDate(sel.data)}</p>
        </div>
      </div>
      {/* Tabs */}
      <div style={{display:'flex',gap:4,marginBottom:16,borderBottom:`2px solid ${C.border}`,paddingBottom:0}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>!t.disabled&&setTabAte(t.id)} disabled={t.disabled}
            style={{padding:'10px 20px',border:'none',background:'none',fontWeight:tabAte===t.id?700:400,
              color:t.disabled?C.border:tabAte===t.id?C.teal:C.text,borderBottom:tabAte===t.id?`3px solid ${C.teal}`:'3px solid transparent',cursor:t.disabled?'default':'pointer',fontSize:14}}>
            {t.label}
          </button>
        ))}
      </div>

      {tabAte==='anamnese' && (
        <Card>
          <h4 style={{marginBottom:16,color:C.navy}}>Anamnese</h4>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div><label style={{fontSize:12,fontWeight:600,color:C.textSm,display:'block',marginBottom:4}}>Queixa principal</label>
              <textarea value={form.queixa} onChange={e=>setF('queixa',e.target.value)} rows={3}
                style={{width:'100%',border:`1.5px solid ${C.border}`,borderRadius:8,padding:'8px 12px',fontSize:14,resize:'vertical'}}/></div>
            <div><label style={{fontSize:12,fontWeight:600,color:C.textSm,display:'block',marginBottom:4}}>Medicamentos em uso</label>
              <textarea value={form.medicamentos} onChange={e=>setF('medicamentos',e.target.value)} rows={2}
                style={{width:'100%',border:`1.5px solid ${C.border}`,borderRadius:8,padding:'8px 12px',fontSize:14,resize:'vertical'}}/></div>
            <div><label style={{fontSize:12,fontWeight:600,color:C.textSm,display:'block',marginBottom:4}}>Observações adicionais</label>
              <textarea value={form.anamnese} onChange={e=>setF('anamnese',e.target.value)} rows={3}
                style={{width:'100%',border:`1.5px solid ${C.border}`,borderRadius:8,padding:'8px 12px',fontSize:14,resize:'vertical'}}/></div>
            <div style={{textAlign:'right'}}><Btn color={C.teal} onClick={()=>setTabAte('refracao')}>Proximo: Refracao</Btn></div>
          </div>
        </Card>
      )}

      {tabAte==='refracao' && (
        <Card>
          <h4 style={{marginBottom:16,color:C.navy}}>Refracao</h4>
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{background:C.teal,color:C.white}}>
                <th style={{padding:'8px 12px',textAlign:'left'}}>Olho</th>
                {['Esf','Cil','Eixo','Adicao','DNP'].map(h=><th key={h} style={{padding:'8px 12px',textAlign:'left'}}>{h}</th>)}
              </tr></thead>
              <tbody>
                <tr style={{background:C.bg}}>
                  <td style={{padding:'8px 12px',fontWeight:700,color:C.teal}}>OD</td>
                  <RxField fk="od_esf" opts={SPH}/><RxField fk="od_cil" opts={CYL}/><RxField fk="od_eixo" opts={AXIS}/>
                  <RxField fk="od_add" opts={ADD_VALS}/><RxField fk="od_dnp" opts={DNP_VALS}/>
                </tr>
                <tr>
                  <td style={{padding:'8px 12px',fontWeight:700,color:C.tealL}}>OE</td>
                  <RxField fk="oe_esf" opts={SPH}/><RxField fk="oe_cil" opts={CYL}/><RxField fk="oe_eixo" opts={AXIS}/>
                  <RxField fk="oe_add" opts={ADD_VALS}/><RxField fk="oe_dnp" opts={DNP_VALS}/>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',marginTop:16,flexWrap:'wrap',gap:8}}>
            <Btn color={C.gray} outline onClick={()=>setTabAte('anamnese')}>Anamnese</Btn>
            {!receita && <Btn color={C.orange} onClick={gerarReceita}>Gerar Receita</Btn>}
            {receita && <Badge color={C.success}>Receita gerada — disponivel para conversao</Badge>}
          </div>
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
                {['Esferico','Cilindrico','Eixo','Adicao','DNP'].map(h=><th key={h} style={{padding:'8px 12px'}}>{h}</th>)}
              </tr></thead>
              <tbody>
                {[['OD','od_esf','od_cil','od_eixo','od_adicao','od_dnp'],
                  ['OE','oe_esf','oe_cil','oe_eixo','oe_adicao','oe_dnp']].map(([lbl,...fields])=>(
                  <tr key={lbl} style={{textAlign:'center'}}>
                    <td style={{padding:'8px 12px',fontWeight:700,color:C.teal}}>{lbl}</td>
                    {fields.map(f=><td key={f} style={{padding:'8px 12px'}}>{receita[f]||'—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{textAlign:'right',marginTop:16}}>
            <Btn color={C.teal} onClick={()=>{
              const logoUrl = window.location.origin + '/logo-clinica.png';
              // Formata a data/hora do atendimento
              const dtAtend = receita.data_hora_atendimento
                ? (() => { const [d,t]=(receita.data_hora_atendimento||'').split(' '); return fmtDate(d)+(t?' às '+t:''); })()
                : fmtDate(receita.data);
              // Monta cidade + data por extenso
              const dtExtenso = (() => {
                const d=new Date(receita.data+'T12:00:00');
                return 'São Vicente, '+d.toLocaleDateString('pt-BR',{day:'numeric',month:'long',year:'numeric'});
              })();
              const w=window.open('','_blank');
              w.document.write(`<!DOCTYPE html><html><head><title>Prescrição de Óculos</title>
                <meta charset="utf-8"/>
                <style>
                  *{box-sizing:border-box;margin:0;padding:0}
                  body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#173D43;padding:20mm 22mm 16mm 22mm;width:210mm;min-height:297mm;position:relative}
                  /* HEADER */
                  .header{display:flex;align-items:center;gap:20px;padding-bottom:14px;border-bottom:3px solid #16AFA3;margin-bottom:22px}
                  .logo{height:58px;object-fit:contain}
                  .titulo{font-size:18px;font-weight:800;color:#173D43;letter-spacing:.5px;text-transform:uppercase}
                  .subtitulo{font-size:12px;color:#16AFA3;font-weight:600;margin-top:3px;letter-spacing:.3px}
                  /* PACIENTE BOX */
                  .section-box{border:1.5px solid #e0e0e0;border-radius:8px;padding:12px 16px;margin-bottom:20px;background:#fafaf8}
                  .field-row{display:flex;gap:24px;flex-wrap:wrap}
                  .field{display:flex;flex-direction:column;gap:2px;flex:1}
                  .label{font-size:10px;font-weight:700;color:#16AFA3;text-transform:uppercase;letter-spacing:.5px}
                  .value{font-size:14px;font-weight:600;color:#173D43;border-bottom:1px solid #d0d0d0;padding-bottom:4px;margin-top:2px;min-height:22px}
                  /* SECTION TITLE */
                  .section-title{font-size:11px;font-weight:700;color:#16AFA3;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px}
                  /* TABELA */
                  table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:22px}
                  table th{background:#173D43;color:#fff;padding:10px 12px;text-align:center;font-size:12px;font-weight:700;letter-spacing:.3px}
                  table th:first-child{border-radius:6px 0 0 0}
                  table th:last-child{border-radius:0 6px 0 0}
                  table td{border:1px solid #e0e0e0;padding:10px 12px;text-align:center;font-size:13px}
                  table tbody tr:nth-child(even){background:#f7fffe}
                  .olho{font-weight:800;color:#173D43;font-size:14px;background:#e8f8f7!important}
                  .adicao-row td{background:#fff8f0!important;color:#F47700;font-weight:700;font-size:13px}
                  /* OBS */
                  .obs-box{font-size:13px;line-height:1.6;color:#333;background:#fafaf8;border:1px solid #e0e0e0;border-radius:6px;padding:10px 14px;margin-bottom:22px}
                  /* ASSINATURA */
                  .assinatura-area{display:flex;align-items:flex-end;justify-content:space-between;margin-top:28px;margin-bottom:20px;gap:24px}
                  .assinatura-col{display:flex;flex-direction:column;align-items:center;gap:4px}
                  .assinatura-linha{border-top:1.5px solid #173D43;width:220px;margin-bottom:6px}
                  .assinatura-nome{font-size:13px;font-weight:700;color:#173D43;text-align:center}
                  .assinatura-cargo{font-size:11px;color:#555;text-align:center}
                  .data-local{font-size:13px;color:#173D43;text-align:right;flex:1}
                  /* DISCLAIMER */
                  .disclaimer{font-size:10px;color:#666;line-height:1.6;text-align:justify;border:1px solid #ddd;padding:10px 14px;background:#fafafa;border-radius:6px;margin-bottom:18px}
                  /* INFO META */
                  .info-meta{font-size:10px;color:#888;border-top:1px solid #eee;padding-top:8px;display:flex;gap:20px;flex-wrap:wrap;margin-bottom:16px}
                  .info-meta b{color:#555}
                  /* FOOTER */
                  .footer{border-top:1px solid #ddd;padding-top:10px;font-size:10px;color:#999;text-align:center}
                  @media print{
                    html,body{width:210mm;height:297mm;margin:0;padding:0}
                    body{padding:18mm 20mm 14mm 20mm}
                    @page{size:A4 portrait;margin:0}
                    .no-print{display:none}
                  }
                </style>
              </head><body>
                <!-- CABEÇALHO -->
                <div class="header">
                  <img src="${logoUrl}" alt="Clínica Visão Ideal" class="logo" onerror="this.style.display='none'"/>
                  <div>
                    <div class="titulo">PRESCRIÇÃO DE ÓCULOS</div>
                    <div class="subtitulo">Clínica Visão Ideal</div>
                  </div>
                </div>

                <!-- PACIENTE -->
                <div class="section-box">
                  <div class="field-row">
                    <div class="field"><span class="label">Paciente</span><span class="value">${receita.paciente_nome}</span></div>
                    <div class="field" style="flex:0 0 auto;min-width:180px"><span class="label">Data do Atendimento</span><span class="value">${dtAtend}</span></div>
                  </div>
                </div>

                <!-- TABELA DE GRAU -->
                <div class="section-title">Grau de Correção Visual</div>
                <table>
                  <thead>
                    <tr>
                      <th style="width:60px"></th>
                      <th>Esférico</th>
                      <th>Cilíndrico</th>
                      <th>Eixo</th>
                      <th>AV</th>
                      <th>DNP (mm)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td class="olho">OD</td>
                      <td>${receita.od_esf||'—'}</td>
                      <td>${receita.od_cil||'—'}</td>
                      <td>${receita.od_eixo&&receita.od_eixo!=='—'?receita.od_eixo+'°':'—'}</td>
                      <td></td>
                      <td>${receita.od_dnp&&receita.od_dnp!=='N/A'?receita.od_dnp:'—'}</td>
                    </tr>
                    <tr>
                      <td class="olho">OE</td>
                      <td>${receita.oe_esf||'—'}</td>
                      <td>${receita.oe_cil||'—'}</td>
                      <td>${receita.oe_eixo&&receita.oe_eixo!=='—'?receita.oe_eixo+'°':'—'}</td>
                      <td></td>
                      <td>${receita.oe_dnp&&receita.oe_dnp!=='N/A'?receita.oe_dnp:'—'}</td>
                    </tr>
                    ${(receita.od_adicao&&receita.od_adicao!=='N/A')||(receita.oe_adicao&&receita.oe_adicao!=='N/A') ? `
                    <tr class="adicao-row">
                      <td class="olho" colspan="2">Adição</td>
                      <td colspan="4" style="text-align:left;padding-left:16px">OD: ${receita.od_adicao||'—'} &nbsp;&nbsp; OE: ${receita.oe_adicao||'—'}</td>
                    </tr>` : ''}
                  </tbody>
                </table>

                ${receita.observacoes ? `
                <div class="section-title">Observações</div>
                <div class="obs-box">${receita.observacoes}</div>` : ''}

                <!-- ÁREA DE ASSINATURA -->
                <div class="assinatura-area">
                  <div class="assinatura-col">
                    <div class="assinatura-linha"></div>
                    <div class="assinatura-nome">${receita.opto_nome}</div>
                    <div class="assinatura-cargo">Optometrista${receita.opto_cro?' · CRO-SP '+receita.opto_cro:''}</div>
                  </div>
                  <div class="data-local">${dtExtenso}</div>
                </div>

                <!-- DISCLAIMER -->
                <div class="disclaimer">
                  O presente exame efetuado pelo optometrista tem por finalidade a correção dos defeitos refrativos, a avaliação sensorial e motora, através da indicação de lentes corretivas refrativas e/ou exercícios ortópticos. O diagnóstico de doenças oculares e seu tratamento são de competência do profissional médico.
                </div>

                <!-- INFO META (interno) -->
                <div class="info-meta">
                  <span><b>Profissional:</b> ${receita.opto_nome}</span>
                  ${receita.meio_contato?`<span><b>Canal:</b> ${receita.meio_contato}</span>`:''}
                  ${receita.agendado_por?`<span><b>Agendado por:</b> ${receita.agendado_por}</span>`:''}
                </div>

                <!-- RODAPÉ -->
                <div class="footer">
                  <div>Clínica Visão Ideal &nbsp;·&nbsp; ${receita.opto_endereco||ENDERECOS_UNIDADES[receita.opto_unidade]||'Av. Antônio Emerich, 477 - Vila Melo – São Vicente – SP'}</div>
                </div>

                <script>window.onload=()=>{ setTimeout(()=>window.print(),200); };</script>
              </body></html>`);
              w.document.close();
            }}>Imprimir Receita</Btn>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   CONVERSÃO
══════════════════════════════════════════════════════ */
function Conversao({ user }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [filtro, setFiltro] = useState({ de: today(), ate: today() });
  const [toast, setToast] = useState('');
  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  // Realtime: nova receita ou conversão aparece automaticamente
  useRealtime('receitas', () => load());
  useRealtime('conversoes', () => load());

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('receitas').select('*,agenda(*)').order('data',{ascending:false});
    if (filtro.de) q = q.gte('data', filtro.de);
    if (filtro.ate) q = q.lte('data', filtro.ate);
    const {data: receitas} = await q;
    // buscar conversoes para cada receita
    const {data: convs} = await supabase.from('conversoes').select('*');
    const convMap = {};
    (convs||[]).forEach(c=>{ convMap[c.receita_id]=c; });
    setRows((receitas||[]).map(r=>({...r, conversao: convMap[r.id]||null})));
    setLoading(false);
  }, [filtro]);

  useEffect(()=>{ load(); },[load]);

  const handleSalvar = async (receitaId, pacienteNome, optoNome, dados) => {
    const existing = rows.find(r=>r.id===receitaId)?.conversao;
    const row = {
      id: existing?.id||uid(), receita_id:receitaId, paciente_nome:pacienteNome,
      opto_nome:optoNome, data:today(), converteu:dados.converteu,
      valor_venda:dados.valor||0, produto:dados.produto||'',
      prevenda_id:user.id, prevenda_nome:user.nome,
    };
    if (existing) await supabase.from('conversoes').update(row).eq('id',existing.id);
    else await supabase.from('conversoes').insert(row);
    showToast(dados.converteu ? 'Conversão registrada!' : 'Marcado como não convertido.');
    setModal(null);
    load();
  };

  const convTotal = rows.filter(r=>r.conversao?.converteu).length;
  const valorTotal = rows.filter(r=>r.conversao?.converteu).reduce((s,r)=>s+Number(r.conversao?.valor_venda||0),0);
  const pendentes = rows.filter(r=>!r.conversao).length;

  return (
    <div>
      <Toast msg={toast}/>
      <div className="resp-grid-4" style={{marginBottom:20}}>
        <Card style={{textAlign:'center'}}><div style={{fontSize:24,fontWeight:800,color:C.teal}}>{rows.length}</div><div style={{fontSize:12,color:C.navy,fontWeight:600}}>Receitas no período</div></Card>
        <Card style={{textAlign:'center'}}><div style={{fontSize:24,fontWeight:800,color:C.success}}>{convTotal}</div><div style={{fontSize:12,color:C.navy,fontWeight:600}}>Convertidas</div></Card>
        <Card style={{textAlign:'center'}}><div style={{fontSize:24,fontWeight:800,color:C.orange}}>{fmtMoney(valorTotal)}</div><div style={{fontSize:12,color:C.navy,fontWeight:600}}>Valor vendido</div></Card>
        <Card style={{textAlign:'center'}}><div style={{fontSize:24,fontWeight:800,color:C.warn}}>{pendentes}</div><div style={{fontSize:12,color:C.navy,fontWeight:600}}>Pendentes</div></Card>
      </div>
      <Card style={{marginBottom:16}}>
        <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'flex-end'}}>
          <Input label="De" type="date" value={filtro.de} onChange={e=>setFiltro(f=>({...f,de:e.target.value}))}/>
          <Input label="Até" type="date" value={filtro.ate} onChange={e=>setFiltro(f=>({...f,ate:e.target.value}))}/>
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
                {rows.map((r,i)=>(
                  <tr key={r.id} style={{background:i%2===0?C.white:C.bg,borderBottom:`1px solid ${C.border}`}}>
                    <td style={{padding:'8px 12px'}}>{fmtDate(r.data)}</td>
                    <td style={{padding:'8px 12px',fontWeight:500}}>{r.paciente_nome}</td>
                    <td style={{padding:'8px 12px'}}>{r.opto_nome}</td>
                    <td style={{padding:'8px 12px'}}>{r.od_esf}</td>
                    <td style={{padding:'8px 12px'}}>{r.oe_esf}</td>
                    <td style={{padding:'8px 12px'}}>
                      {r.conversao
                        ? <Badge color={r.conversao.converteu?C.success:C.danger}>{r.conversao.converteu?'Convertido':'Não Convertido'}</Badge>
                        : <Badge color={C.warn}>Pendente</Badge>}
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
        <button onClick={()=>setConverteu(true)} style={{flex:1,padding:'20px',border:`3px solid ${converteu===true?C.success:C.border}`,borderRadius:12,background:converteu===true?C.success+'11':C.white,color:converteu===true?C.success:C.gray,fontWeight:700,fontSize:16,cursor:'pointer'}}>
          SIM
        </button>
        <button onClick={()=>setConverteu(false)} style={{flex:1,padding:'20px',border:`3px solid ${converteu===false?C.danger:C.border}`,borderRadius:12,background:converteu===false?C.danger+'11':C.white,color:converteu===false?C.danger:C.gray,fontWeight:700,fontSize:16,cursor:'pointer'}}>
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
function NoShow({ user }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState({ de:'', ate:'' });
  const [toast, setToast] = useState('');
  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  useRealtime('agenda', () => load());
  useRealtime('conversoes', () => load());

  const load = useCallback(async () => {
    setLoading(true);
    // 1. Agendamentos não compareceram
    let q1 = supabase.from('agenda').select('*').eq('status','Não Compareceu');
    if (filtro.de) q1 = q1.gte('data', filtro.de);
    if (filtro.ate) q1 = q1.lte('data', filtro.ate);
    const {data: agNComp} = await q1;

    // 2. Conversões não convertidas
    let q2 = supabase.from('conversoes').select('*').eq('converteu',false);
    if (filtro.de) q2 = q2.gte('data', filtro.de);
    if (filtro.ate) q2 = q2.lte('data', filtro.ate);
    const {data: convNao} = await q2;

    const r1 = (agNComp||[]).map(a=>({...a, tipo:'Não Compareceu', paciente:a.paciente_nome, opto:a.opto_nome, dtRef:a.data}));
    const r2 = (convNao||[]).map(c=>({...c, tipo:'Não Converteu', paciente:c.paciente_nome, opto:c.opto_nome, dtRef:c.data}));
    setRows([...r1,...r2].sort((a,b)=>b.dtRef.localeCompare(a.dtRef)));
    setLoading(false);
  }, [filtro]);

  useEffect(()=>{ load(); },[load]);

  const reagendar = async (row) => {
    showToast(`${row.paciente} adicionado para reagendamento!`);
  };

  return (
    <div>
      <Toast msg={toast}/>
      <div style={{background:C.danger+'11',border:`1.5px solid ${C.danger}33`,borderRadius:12,padding:'12px 16px',marginBottom:20,fontSize:13,color:C.danger}}>
        Lista unificada: pacientes que não compareceram + pacientes que não converteram a compra após a consulta.
      </div>
      <Card style={{marginBottom:16}}>
        <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'flex-end'}}>
          <Input label="De" type="date" value={filtro.de} onChange={e=>setFiltro(f=>({...f,de:e.target.value}))}/>
          <Input label="Até" type="date" value={filtro.ate} onChange={e=>setFiltro(f=>({...f,ate:e.target.value}))}/>
        </div>
      </Card>
      {loading ? <Spinner/> : (
        <Card>
          <p style={{fontSize:13,color:C.gray,marginBottom:12}}>{rows.length} paciente(s) para reagendar</p>
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr style={{background:C.danger,color:C.white}}>
                {['Data','Paciente','Optometrista','Motivo',''].map(h=>(
                  <th key={h} style={{padding:'9px 12px',textAlign:'left'}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rows.length===0 && <tr><td colSpan={5} style={{padding:24,textAlign:'center',color:C.gray}}>Nenhum no-show no período</td></tr>}
                {rows.map((r,i)=>(
                  <tr key={r.id+r.tipo} style={{background:i%2===0?C.white:C.bg,borderBottom:`1px solid ${C.border}`}}>
                    <td style={{padding:'8px 12px'}}>{fmtDate(r.dtRef)}</td>
                    <td style={{padding:'8px 12px',fontWeight:500}}>{r.paciente}</td>
                    <td style={{padding:'8px 12px'}}>{r.opto}</td>
                    <td style={{padding:'8px 12px'}}><Badge color={r.tipo==='Não Compareceu'?C.danger:C.orange}>{r.tipo}</Badge></td>
                    <td style={{padding:'8px 12px'}}><Btn size="sm" color={C.teal} onClick={()=>reagendar(r)}>Reagendar</Btn></td>
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
function Relatorios() {
  const [optos, setOptos] = useState([]);
  const [stats, setStats] = useState([]);
  const [statsPrev, setStatsPrev] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState({ de:'', ate:'' });

  const load = useCallback(async () => {
    setLoading(true);
    const [oRes, agRes, recRes, convRes] = await Promise.all([
      supabase.from('usuarios').select('*').eq('perfil','opto').eq('ativo',true),
      supabase.from('agenda').select('*'),
      supabase.from('receitas').select('*'),
      supabase.from('conversoes').select('*'),
    ]);
    const os = oRes.data||[];
    const ag = agRes.data||[];
    const rec = recRes.data||[];
    const conv = convRes.data||[];

    setOptos(os);
    setStats(os.map(o=>{
      const mAg = ag.filter(a=>a.opto_id===o.id && (!filtro.de||a.data>=filtro.de) && (!filtro.ate||a.data<=filtro.ate));
      const mRec = rec.filter(r=>r.opto_id===o.id && (!filtro.de||r.data>=filtro.de) && (!filtro.ate||r.data<=filtro.ate));
      const recIds = new Set(mRec.map(r=>r.id));
      const mConv = conv.filter(c=>recIds.has(c.receita_id));
      const convertidas = mConv.filter(c=>c.converteu);
      const valor = convertidas.reduce((s,c)=>s+Number(c.valor_venda||0),0);
      const comp = mAg.filter(a=>a.status==='Compareceu').length;
      const naoComp = mAg.filter(a=>a.status==='Não Compareceu').length;
      return {
        nome: o.nome, cro: o.cro,
        agendados: mAg.length, compareceu: comp, naoComp,
        receitas: mRec.length, conversoes: convertidas.length, totalConv: mConv.length,
        taxaShow: mAg.length ? Math.round((comp/mAg.length)*100) : 0,
        taxaConv: mConv.length ? Math.round((convertidas.length/mConv.length)*100) : 0,
        valorTotal: valor,
      };
    }));

    // Ranking por Pré-Venda (agendado_por)
    const agFiltrado = ag.filter(a=>(!filtro.de||a.data>=filtro.de)&&(!filtro.ate||a.data<=filtro.ate));
    const prevMap = {};
    agFiltrado.forEach(a=>{
      const nome = a.agendado_por||'(sem responsável)';
      if (!prevMap[nome]) prevMap[nome] = {nome, agendados:0, compareceu:0, naoComp:0};
      prevMap[nome].agendados++;
      if (a.status==='Compareceu') prevMap[nome].compareceu++;
      if (a.status==='Não Compareceu') prevMap[nome].naoComp++;
    });
    const rankPrev = Object.values(prevMap)
      .sort((a,b)=>b.agendados-a.agendados);
    setStatsPrev(rankPrev);

    setLoading(false);
  }, [filtro]);

  useEffect(()=>{ load(); },[load]);

  const totais = stats.reduce((acc,s)=>({
    agendados:acc.agendados+s.agendados,
    compareceu:acc.compareceu+s.compareceu,
    receitas:acc.receitas+s.receitas,
    conversoes:acc.conversoes+s.conversoes,
    valorTotal:acc.valorTotal+s.valorTotal,
  }),{agendados:0,compareceu:0,receitas:0,conversoes:0,valorTotal:0});

  return (
    <div>
      <Card style={{marginBottom:16}}>
        <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'flex-end'}}>
          <Input label="De" type="date" value={filtro.de} onChange={e=>setFiltro(f=>({...f,de:e.target.value}))}/>
          <Input label="Até" type="date" value={filtro.ate} onChange={e=>setFiltro(f=>({...f,ate:e.target.value}))}/>
        </div>
      </Card>

      <div className="resp-grid-4" style={{marginBottom:20}}>
        {[
          {label:'Agendamentos',value:totais.agendados,color:C.teal},
          {label:'Comparecimentos',value:totais.compareceu,color:C.success},
          {label:'Receitas Geradas',value:totais.receitas,color:'#6F42C1'},
          {label:'Conversões',value:totais.conversoes,color:C.orange},
        ].map(k=>(
          <Card key={k.label} style={{textAlign:'center'}}>
            <div style={{fontSize:28,fontWeight:800,color:k.color}}>{k.value}</div>
            <div style={{fontSize:12,color:C.navy,fontWeight:600,marginTop:4}}>{k.label}</div>
          </Card>
        ))}
      </div>

      {loading ? <Spinner/> : (<>
        {/* RANKING PRÉ-VENDAS */}
        <Card style={{marginBottom:20}}>
          <h3 style={{fontSize:15,fontWeight:700,marginBottom:4,color:C.navy}}>Ranking por Responsável pelo Agendamento</h3>
          <p style={{fontSize:12,color:C.gray,marginBottom:14}}>Inclui pré-vendas, gerentes e IA</p>
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr style={{background:C.orange,color:C.white}}>
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
                    <td style={{padding:'8px 12px',fontWeight:800,color:i===0?C.orange:C.gray,fontSize:i===0?16:13}}>{i+1}°</td>
                    <td style={{padding:'8px 12px'}}>
                      <span style={{
                        display:'inline-block',padding:'2px 10px',borderRadius:20,fontSize:12,fontWeight:700,
                        background: isIA?C.orangeBg:C.tealBg,
                        color: isIA?C.orange:C.teal
                      }}>{s.nome}</span>
                    </td>
                    <td style={{padding:'8px 12px',fontWeight:700,color:C.navy}}>{s.agendados}</td>
                    <td style={{padding:'8px 12px',color:C.success,fontWeight:600}}>{s.compareceu}</td>
                    <td style={{padding:'8px 12px',color:C.danger}}>{s.naoComp}</td>
                    <td style={{padding:'8px 12px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{flex:1,height:6,background:C.grayL,borderRadius:3,overflow:'hidden'}}>
                          <div style={{height:'100%',width:`${taxaShow}%`,background:taxaShow>=70?C.success:taxaShow>=50?C.warn:C.danger,borderRadius:3,transition:'width .3s'}}/>
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
              <thead><tr style={{background:C.navy,color:C.white}}>
                {['Optometrista','CRO','Agend.','Comp.','No-Show','Receitas','Conversões','% Conv','Faturamento'].map(h=>(
                  <th key={h} style={{padding:'9px 12px',textAlign:'left',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {stats.map((s,i)=>(
                  <tr key={s.nome} style={{background:i%2===0?C.white:C.bg,borderBottom:`1px solid ${C.border}`}}>
                    <td style={{padding:'8px 12px',fontWeight:600}}>{s.nome}</td>
                    <td style={{padding:'8px 12px',fontSize:11,color:C.gray}}>{s.cro||'—'}</td>
                    <td style={{padding:'8px 12px'}}>{s.agendados}</td>
                    <td style={{padding:'8px 12px',color:C.success,fontWeight:600}}>{s.compareceu}</td>
                    <td style={{padding:'8px 12px',color:C.danger}}>{s.naoComp}</td>
                    <td style={{padding:'8px 12px'}}>{s.receitas}</td>
                    <td style={{padding:'8px 12px'}}>{s.conversoes}</td>
                    <td style={{padding:'8px 12px'}}><Badge color={s.taxaConv>=60?C.success:s.taxaConv>=40?C.warn:C.danger}>{s.taxaConv}%</Badge></td>
                    <td style={{padding:'8px 12px',fontWeight:700,color:C.teal}}>{fmtMoney(s.valorTotal)}</td>
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
   USUÁRIOS
══════════════════════════════════════════════════════ */
function Usuarios() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  const load = async () => {
    const {data} = await supabase.from('usuarios').select('*').order('nome');
    setRows(data||[]);
    setLoading(false);
  };
  useEffect(()=>{ load(); },[]);

  const handleSave = async (form) => {
    if (form.id) {
      await supabase.from('usuarios').update(form).eq('id',form.id);
    } else {
      await supabase.from('usuarios').insert({...form,id:uid()});
    }
    showToast('Usuário salvo!');
    setModal(null);
    load();
  };

  const toggleAtivo = async (u) => {
    await supabase.from('usuarios').update({ativo:!u.ativo}).eq('id',u.id);
    load();
  };

  return (
    <div>
      <Toast msg={toast}/>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:16}}>
        <Btn color={C.orange} onClick={()=>setModal({perfil:'opto',ativo:true,cro:'',senha:''})}>+ Novo Usuário</Btn>
      </div>
      {loading ? <Spinner/> : (
        <Card>
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr style={{background:C.navy,color:C.white}}>
                {['Nome','Perfil','Unidade','CRO','Senha','Status',''].map(h=>(
                  <th key={h} style={{padding:'9px 12px',textAlign:'left'}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rows.map((u,i)=>(
                  <tr key={u.id} style={{background:i%2===0?C.white:C.bg,borderBottom:`1px solid ${C.border}`,opacity:u.ativo?1:.5}}>
                    <td style={{padding:'8px 12px',fontWeight:600}}>{u.nome}</td>
                    <td style={{padding:'8px 12px'}}><Badge color={PERFIS[u.perfil]?.cor||C.gray}>{PERFIS[u.perfil]?.label||u.perfil}</Badge></td>
                    <td style={{padding:'8px 12px',fontSize:12,color:C.teal,fontWeight:600}}>{u.unidade||'—'}</td>
                    <td style={{padding:'8px 12px',fontSize:11,color:C.gray}}>{u.cro||'—'}</td>
                    <td style={{padding:'8px 12px',fontFamily:'monospace'}}>{u.senha}</td>
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
    senha:user.senha||'', cro:user.cro||'', ativo:user.ativo??true,
    unidade:user.unidade||'', endereco:user.endereco||'',
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

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
        <Select label="Unidade" value={form.unidade} onChange={e=>handleUnidade(e.target.value)}
          options={[{value:'',label:'Selecionar unidade'},...UNIDADES.map(u=>({value:u,label:u}))]}/>
        <Input label="Endereço da Unidade" value={form.endereco} onChange={e=>set('endereco',e.target.value)}
          placeholder="Endereço completo da clínica"/>
        {form.perfil==='opto' && <Input label="CRO" value={form.cro} onChange={e=>set('cro',e.target.value)} placeholder="CRO-SP 12345"/>}
        <Input label="Senha" value={form.senha} onChange={e=>set('senha',e.target.value)} placeholder="Senha de acesso"/>
        <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:8}}>
          <Btn color={C.gray} outline onClick={onClose}>Cancelar</Btn>
          <Btn color={C.teal} onClick={()=>form.nome&&form.senha&&onSave(form)}>Salvar</Btn>
        </div>
      </div>
    </Modal>
  );
}


/* ══════════════════════════════════════════════════════
   RECEITAS
══════════════════════════════════════════════════════ */
function Receitas({ user }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState({ de:'', ate:'' });
  const [detalhe, setDetalhe] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('receitas').select('*').order('data',{ascending:false});
    if (filtro.de) q = q.gte('data', filtro.de);
    if (filtro.ate) q = q.lte('data', filtro.ate);
    if (user.perfil === 'opto') q = q.eq('opto_id', user.id);
    const { data } = await q;
    setRows(data || []);
    setLoading(false);
  }, [filtro, user]);

  useEffect(() => { load(); }, [load]);
  useRealtime('receitas', () => load());

  const fmtOlho = (r, pref) => {
    const esf = r[pref+'_esf']; const cil = r[pref+'_cil'];
    const eixo = r[pref+'_eixo']; const add = r[pref+'_adicao'];
    const parts = [];
    if (esf && esf !== 'Plano') parts.push(`Esf ${esf}`);
    if (cil && cil !== 'Plano') parts.push(`Cil ${cil}`);
    if (eixo) parts.push(`Eixo ${eixo}`);
    if (add && add !== 'N/A') parts.push(`Add ${add}`);
    return parts.length ? parts.join(' / ') : (esf === 'Plano' ? 'Plano' : '—');
  };

  return (
    <div>
      <Card style={{marginBottom:16}}>
        <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'flex-end'}}>
          <Input label="De" type="date" value={filtro.de} onChange={e=>setFiltro(f=>({...f,de:e.target.value}))}/>
          <Input label="Até" type="date" value={filtro.ate} onChange={e=>setFiltro(f=>({...f,ate:e.target.value}))}/>
        </div>
      </Card>
      {loading ? <Spinner/> : (
        <Card>
          <p style={{fontSize:13,color:C.gray,marginBottom:12}}>{rows.length} receita(s) encontrada(s)</p>
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr style={{background:C.teal,color:C.white}}>
                {['Data','Paciente','Optometrista','OD (resumo)','OE (resumo)',''].map(h=>(
                  <th key={h} style={{padding:'9px 12px',textAlign:'left'}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rows.length===0 && <tr><td colSpan={6} style={{padding:24,textAlign:'center',color:C.gray}}>Nenhuma receita no período</td></tr>}
                {rows.map((r,i)=>(
                  <tr key={r.id} style={{background:i%2===0?C.white:C.bg,borderBottom:`1px solid ${C.border}`}}>
                    <td style={{padding:'8px 12px'}}>{fmtDate(r.data)}</td>
                    <td style={{padding:'8px 12px',fontWeight:600}}>{r.paciente_nome}</td>
                    <td style={{padding:'8px 12px'}}>{r.opto_nome}</td>
                    <td style={{padding:'8px 12px',fontSize:12,color:C.textSm}}>{fmtOlho(r,'od')}</td>
                    <td style={{padding:'8px 12px',fontSize:12,color:C.textSm}}>{fmtOlho(r,'oe')}</td>
                    <td style={{padding:'8px 12px'}}>
                      <Btn size="sm" color={C.teal} outline onClick={()=>setDetalhe(r)}>Ver</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {detalhe && (
        <Modal title="Receita" onClose={()=>setDetalhe(null)} width={580}>
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
                  {['Esférico','Cilíndrico','Eixo','Adição','DNP'].map(h=><th key={h} style={{padding:'8px 12px',textAlign:'center'}}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {[['OD','od'],['OE','oe']].map(([lbl,p],i)=>(
                    <tr key={lbl} style={{background:i%2===0?C.white:C.bg,borderBottom:`1px solid ${C.border}`}}>
                      <td style={{padding:'8px 12px',fontWeight:700,color:C.teal}}>{lbl}</td>
                      <td style={{padding:'8px 12px',textAlign:'center'}}>{detalhe[p+'_esf']||'—'}</td>
                      <td style={{padding:'8px 12px',textAlign:'center'}}>{detalhe[p+'_cil']||'—'}</td>
                      <td style={{padding:'8px 12px',textAlign:'center'}}>{detalhe[p+'_eixo']||'—'}</td>
                      <td style={{padding:'8px 12px',textAlign:'center'}}>{detalhe[p+'_adicao']||'—'}</td>
                      <td style={{padding:'8px 12px',textAlign:'center'}}>{detalhe[p+'_dnp']||'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detalhe.observacoes && <div style={{background:C.orangeBg,borderLeft:`3px solid ${C.orange}`,borderRadius:'0 8px 8px 0',padding:'10px 14px',fontSize:13}}><strong>Observações:</strong> {detalhe.observacoes}</div>}
            <div style={{textAlign:'right',paddingTop:4}}>
              <Btn size="sm" color={C.teal} onClick={()=>{ /* dispara o mesmo print da aba Atendimento */
                const logoUrl = window.location.origin + '/logo-clinica.png';
                const dtAtend = detalhe.data_hora_atendimento
                  ? (()=>{ const [d,t]=(detalhe.data_hora_atendimento||'').split(' '); return fmtDate(d)+(t?' às '+t:''); })()
                  : fmtDate(detalhe.data);
                const dtExtenso = (()=>{ const d=new Date(detalhe.data+'T12:00:00'); return 'São Vicente, '+d.toLocaleDateString('pt-BR',{day:'numeric',month:'long',year:'numeric'}); })();
                const w=window.open('','_blank');
                w.document.write(`<!DOCTYPE html><html><head><title>Prescrição de Óculos</title><meta charset="utf-8"/>
                <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#173D43;padding:40px 48px;max-width:800px;margin:0 auto}.header{display:flex;align-items:center;justify-content:space-between;padding-bottom:16px;border-bottom:2px solid #16AFA3;margin-bottom:24px}.logo{height:64px;object-fit:contain}.titulo{font-size:16px;font-weight:700;color:#173D43;text-align:center;letter-spacing:.5px}.paciente-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:20px}.paciente-nome{font-size:14px}.paciente-nome b{font-size:15px}table{width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px}table th,table td{border:1px solid #ccc;padding:9px 12px;text-align:center}table thead tr{background:#f5f5f5}table thead th{font-weight:700;font-size:13px}.obs-row{font-size:13px;margin-bottom:20px;line-height:1.5}.info-meta{font-size:12px;color:#555;margin-bottom:24px;border-top:1px solid #eee;border-bottom:1px solid #eee;padding:10px 0;display:flex;gap:24px;flex-wrap:wrap}.info-meta span b{color:#173D43}.disclaimer{font-size:11px;color:#555;line-height:1.5;margin-bottom:32px;text-align:justify;border:1px solid #ddd;padding:12px 14px;background:#fafafa;border-radius:4px}.assinatura{display:flex;flex-direction:column;align-items:center;margin-bottom:20px}.assinatura .linha{border-top:1px solid #173D43;width:240px;margin-bottom:6px}.assinatura p{font-size:13px;color:#173D43;text-align:center}.footer{border-top:1px solid #ddd;padding-top:10px;font-size:11px;color:#888;text-align:center}.data-local{text-align:center;font-size:13px;margin-bottom:24px;color:#173D43}@media print{body{padding:20px 28px}@page{margin:1cm}}</style>
                </head><body>
                <div class="header"><img src="${logoUrl}" alt="Clínica Visão Ideal" class="logo"/><div class="titulo">PRESCRIÇÃO DE ÓCULOS</div><div style="width:100px"></div></div>
                <div class="paciente-row"><div class="paciente-nome"><b>Paciente:</b> ${detalhe.paciente_nome}</div><div>Idade:</div></div>
                <table><thead><tr><th></th><th>Esférico</th><th>Cilíndrico</th><th>Eixo</th><th>AV</th><th>DNP</th></tr></thead>
                <tbody>
                  <tr><td><b>OD</b></td><td>${detalhe.od_esf||'—'}</td><td>${detalhe.od_cil||'—'}</td><td>${detalhe.od_eixo||'—'}°</td><td></td><td>${detalhe.od_dnp&&detalhe.od_dnp!=='N/A'?detalhe.od_dnp:''}</td></tr>
                  <tr><td><b>OE</b></td><td>${detalhe.oe_esf||'—'}</td><td>${detalhe.oe_cil||'—'}</td><td>${detalhe.oe_eixo||'—'}°</td><td></td><td>${detalhe.oe_dnp&&detalhe.oe_dnp!=='N/A'?detalhe.oe_dnp:''}</td></tr>
                  ${(detalhe.od_adicao&&detalhe.od_adicao!=='N/A')||(detalhe.oe_adicao&&detalhe.oe_adicao!=='N/A')?`<tr><td><b>Adição</b></td><td colspan="5">${detalhe.od_adicao||detalhe.oe_adicao||''}</td></tr>`:''}
                </tbody></table>
                ${detalhe.observacoes?`<div class="obs-row"><b>Observações:</b> ${detalhe.observacoes}</div>`:''}
                <div class="info-meta"><span><b>Profissional:</b> ${detalhe.opto_nome}</span>${detalhe.meio_contato?`<span><b>Meio de contato:</b> ${detalhe.meio_contato}</span>`:''}${detalhe.agendado_por?`<span><b>Agendado por:</b> ${detalhe.agendado_por}</span>`:''}<span><b>Atendimento:</b> ${dtAtend}</span></div>
                <div class="assinatura"><div class="linha"></div><p>${detalhe.opto_nome}</p><p>Optometrista</p></div>
                <div class="data-local">${dtExtenso}</div>
                <div class="disclaimer">O presente exame efetuado pelo optometrista, tem por finalidade a correção dos defeitos refrativos, a avaliação sensorial e motora, através da indicação de lentes corretivas refrativas e/ou exercícios ortópticos. O diagnóstico de doenças oculares e seu tratamento são de competência do profissional médico.</div>
                <div class="footer">Clínica Visão Ideal · Avenida Antonio Emerick, São Vicente</div>
                <script>window.onload=()=>window.print();</script></body></html>`);
                w.document.close();
              }}>Imprimir Receita</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   HOOK REALTIME — escuta mudanças em tempo real
══════════════════════════════════════════════════════ */
function useRealtime(table, onchange) {
  useEffect(() => {
    const ch = supabase
      .channel(`rt_${table}_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, onchange)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [table]);
}

/* ══════════════════════════════════════════════════════
   APP ROOT
══════════════════════════════════════════════════════ */
export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [tab, setTab] = useState('inicio');
  const [agendaItem, setAgendaItem] = useState(null);

  const handleAtender = (item) => {
    setAgendaItem(item);
    setTab('atendimento');
  };

  if (!usuario) return <Login onLogin={u => { setUsuario(u); const nav=PERFIS[u.perfil]?.nav||[]; setTab(nav[0]||'inicio'); }}/>;

  const navPerm = PERFIS[usuario.perfil]?.nav || [];
  if (!navPerm.includes(tab)) return (
    <Layout user={usuario} tab={tab} setTab={setTab} onLogout={()=>setUsuario(null)}>
      <Card><p style={{textAlign:'center',padding:40,color:C.gray}}>Sem permissão para acessar esta seção.</p></Card>
    </Layout>
  );

  const pages = {
    inicio:       <Dashboard user={usuario}/>,
    agenda:       <Agenda user={usuario}/>,
    agendamentos: <Agendamentos user={usuario} onAtender={handleAtender}/>,
    atendimento:  <Atendimento user={usuario} agendaItem={agendaItem} clearAgendaItem={()=>setAgendaItem(null)}/>,
    receitas:     <Receitas user={usuario}/>,
    conversao:    <Conversao user={usuario}/>,
    noshow:       <NoShow user={usuario}/>,
    relatorios:   <Relatorios/>,
    usuarios:     <Usuarios/>,
  };

  return (
    <Layout user={usuario} tab={tab} setTab={setTab} onLogout={()=>setUsuario(null)}>
      {pages[tab] || <div>Página não encontrada</div>}
    </Layout>
  );
}
