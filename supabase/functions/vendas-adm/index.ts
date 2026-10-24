// vendas-adm — liga as vendas registradas no Sistema ADM às receitas da clínica e gera a conversão.
// Lê o ADM (só leitura, OS do tipo venda/hora/contato) e grava na clínica:
//   • telefone + nome conferem, mesma loja, venda até 30 dias após o exame → conversão automática (origem ADM)
//   • só telefone ou só nome confere → sugestão "Para conferir" (Pré-Vendas confirma ou descarta)
//   • OS cancelada no ADM → a conversão é desfeita
//   • 30 dias sem venda → "Não convertido" (origem PRAZO)
// Conversão registrada à mão (origem MANUAL ou vazia) nunca é alterada aqui.
// Ações: { acao: 'sincronizar' } (padrão; também chamada pelo agendador a cada 15 min)
//        { acao: 'confirmar' | 'descartar', id }  → só Pré-Vendas, supervisor e diretor
import { createClient } from 'npm:@supabase/supabase-js@2'

// Chave pública do ADM (a mesma que está no site do ADM). Se o ADM ganhar proteção por linha,
// trocar pelo secret ADM_KEY com uma chave de leitura.
const ADM_URL = Deno.env.get('ADM_URL') || 'https://xxmrdadnchxdsfinvzsp.supabase.co'
const ADM_KEY = Deno.env.get('ADM_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4bXJkYWRuY2h4ZHNmaW52enNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MzI2NDgsImV4cCI6MjA5OTAwODY0OH0.vq3SGXJjmqJ68rcl-nplayx4L_xhy7VMtOAkbvlsep8'

const PRAZO_DIAS = 30
const INICIO_INTEGRACAO = '2026-10-22'          // primeiro dia do sistema da clínica em produção
const TIPOS = ['venda', 'hora', 'contato']      // Venda — Pedido / Hora / Lentes de contato
const ROTULO_TIPO: Record<string, string> = { venda: 'PEDIDO', hora: 'HORA', contato: 'LENTES DE CONTATO' }
const LOJA_ADM: Record<string, string> = { saovicente: 'SÃO VICENTE', campinas: 'CAMPINAS', sorocaba: 'SOROCABA', piracicaba: 'PIRACICABA' }

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const hojeSP = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)
const somaDias = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const tel8 = (t: unknown) => { const d = String(t ?? '').replace(/\D/g, ''); return d.length >= 8 ? d.slice(-8) : '' }
const LIGA = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E'])
const tokens = (s: unknown) => String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(t => t.length >= 2 && !LIGA.has(t))
// Nome confere: mesmo primeiro nome e, quando os dois têm sobrenome, pelo menos um sobrenome em comum.
// A OS pode ter dois nomes ("FULANA / CICLANA"): basta um deles conferir.
function nomeConfere(paciente: unknown, cliente: unknown) {
  const p = tokens(paciente)
  if (!p.length) return false
  return String(cliente ?? '').split('/').some(parte => {
    const c = tokens(parte)
    if (!c.length || c[0] !== p[0]) return false
    if (p.length === 1 || c.length === 1) return true
    return p.slice(1).some(t => c.slice(1).includes(t))
  })
}
const novoId = () => Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'[b % 34]).join('')

type Venda = { id: string, os: string, tipo: string, loja: string, dt: string, cliente: string, tel: string, valor: number, cancelada: boolean }

async function vendasDoADM(desde: string): Promise<Venda[]> {
  const out: Venda[] = []
  for (let de = 0; ; de += 1000) {
    const url = `${ADM_URL}/rest/v1/os_cards?select=id,os,tipo,unidade,dt_venda,cliente,telefone,valor_venda,cancelado_em` +
      `&tipo=in.(${TIPOS.join(',')})&dt_venda=gte.${desde}&order=dt_venda.asc,id.asc`
    const r = await fetch(url, { headers: { apikey: ADM_KEY, Authorization: `Bearer ${ADM_KEY}`, Range: `${de}-${de + 999}` } })
    if (!r.ok) throw new Error(`ADM respondeu ${r.status}`)
    const lote = await r.json()
    for (const v of lote) {
      const loja = LOJA_ADM[String(v.unidade || '').toLowerCase()]
      if (!loja || !v.dt_venda) continue
      out.push({ id: String(v.id), os: String(v.os ?? ''), tipo: v.tipo, loja, dt: v.dt_venda, cliente: v.cliente || '',
        tel: tel8(v.telefone), valor: Number(v.valor_venda) || 0, cancelada: v.cancelado_em != null })
    }
    if (lote.length < 1000) break
  }
  return out
}

async function sincronizar(admin: any) {
  const hoje = hojeSP()
  const desde = [INICIO_INTEGRACAO, somaDias(hoje, -(PRAZO_DIAS + 30))].sort()[1]

  const { data: receitas, error: e1 } = await admin.from('receitas')
    .select('id,data,unidade,paciente_nome,opto_nome,agenda:agenda_id(paciente_nome,paciente_telefone,paciente_id)')
    .gte('data', desde).order('data').order('id')
  if (e1) throw new Error('receitas: ' + e1.message)
  const pacIds = [...new Set((receitas || []).map((r: any) => r.agenda?.paciente_id).filter(Boolean))]
  const telPac: Record<string, string> = {}
  if (pacIds.length) {
    const { data: ps } = await admin.from('pacientes').select('id,telefone').in('id', pacIds)
    for (const p of ps || []) telPac[p.id] = p.telefone
  }
  const ids = (receitas || []).map((r: any) => r.id)
  const { data: convs } = ids.length ? await admin.from('conversoes').select('*').in('receita_id', ids) : { data: [] }
  const convDe: Record<string, any> = {}; for (const c of convs || []) convDe[c.receita_id] = c
  const { data: sugs } = ids.length ? await admin.from('vendas_sugestoes').select('*').in('receita_id', ids) : { data: [] }

  const vendas = await vendasDoADM(desde)
  const vendaPorId: Record<string, Venda> = {}; for (const v of vendas) vendaPorId[v.id] = v

  // OS já presas a uma receita: conversões manuais/automáticas e sugestões confirmadas
  const ocupada: Record<string, string> = {}
  for (const c of convs || []) for (const v of (Array.isArray(c.venda_ids) ? c.venda_ids : [])) if (v?.id) ocupada[v.id] = c.receita_id
  for (const s of sugs || []) if (s.status === 'CONFIRMADA') ocupada[s.os_id] = s.receita_id

  const res = { receitas: (receitas || []).length, vendas_adm: vendas.length, convertidas: 0, desfeitas: 0, nao_convertidas: 0, sugestoes_novas: 0 }

  for (const r of receitas || []) {
    const conv = convDe[r.id]
    const origem = String(conv?.origem || '').toUpperCase()
    if (conv && !['ADM', 'PRAZO'].includes(origem)) continue   // registro manual: não mexe
    const loja = String(r.unidade || '').toUpperCase()
    const nome = r.paciente_nome || r.agenda?.paciente_nome
    const tel = tel8(r.agenda?.paciente_telefone) || tel8(telPac[r.agenda?.paciente_id])
    const fim = somaDias(r.data, PRAZO_DIAS)
    const noPrazo = (v: Venda) => v.loja === loja && v.dt >= r.data && v.dt <= fim && v.valor > 0
    const livre = (v: Venda) => !ocupada[v.id] || ocupada[v.id] === r.id

    // vendas ligadas: automáticas (telefone + nome) e sugestões confirmadas
    const confirmadas = (sugs || []).filter((s: any) => s.receita_id === r.id && s.status === 'CONFIRMADA').map((s: any) => vendaPorId[s.os_id]).filter(Boolean)
    const automaticas = vendas.filter(v => noPrazo(v) && !v.cancelada && livre(v) && tel && v.tel === tel && nomeConfere(nome, v.cliente))
    const ligadas = [...new Map([...automaticas, ...confirmadas].filter(v => !v.cancelada).map(v => [v.id, v])).values()]
    for (const v of ligadas) ocupada[v.id] = r.id

    if (ligadas.length) {
      const valor = Math.round(ligadas.reduce((s, v) => s + v.valor, 0) * 100) / 100
      const venda_ids = ligadas.map(v => ({ id: v.id, os: v.os, tipo: v.tipo, data: v.dt, valor: v.valor }))
      const igual = conv?.converteu && origem === 'ADM' && Number(conv.valor_venda) === valor &&
        JSON.stringify((conv.venda_ids || []).map((x: any) => x.id).sort()) === JSON.stringify(venda_ids.map(x => x.id).sort())
      if (!igual) {
        const row = {
          id: conv?.id || novoId(), receita_id: r.id, paciente_nome: nome, opto_nome: r.opto_nome,
          data: ligadas.map(v => v.dt).sort().pop(), converteu: true, valor_venda: valor,
          produto: [...new Set(ligadas.map(v => ROTULO_TIPO[v.tipo] || v.tipo))].join(' + '),
          prevenda_id: null, prevenda_nome: 'AUTOMÁTICO (ADM)', unidade: loja, origem: 'ADM', venda_ids,
        }
        const { error } = await admin.from('conversoes').upsert(row, { onConflict: 'receita_id' })
        if (error) throw new Error('conversão: ' + error.message)
        res.convertidas++
      }
      continue
    }

    // nada ligado: desfaz conversão automática (OS cancelada) e, passado o prazo, marca não convertido
    if (conv && origem === 'ADM') {
      await admin.from('conversoes').delete().eq('id', conv.id)
      res.desfeitas++
    }
    if (hoje > fim && !(conv && origem === 'PRAZO')) {
      await admin.from('conversoes').upsert({
        id: (conv && origem === 'ADM') ? novoId() : (conv?.id || novoId()), receita_id: r.id, paciente_nome: nome, opto_nome: r.opto_nome,
        data: fim, converteu: false, valor_venda: 0, produto: '', prevenda_id: null, prevenda_nome: 'AUTOMÁTICO (PRAZO)',
        unidade: loja, origem: 'PRAZO', venda_ids: [],
      }, { onConflict: 'receita_id' })
      res.nao_convertidas++
    } else if (conv && origem === 'PRAZO' && hoje <= fim) {
      await admin.from('conversoes').delete().eq('id', conv.id)
    }

    // sugestões "Para conferir": só telefone ou só nome confere
    const jaSugeridas = new Set((sugs || []).filter((s: any) => s.receita_id === r.id).map((s: any) => s.os_id))
    for (const v of vendas) {
      if (!noPrazo(v) || v.cancelada || !livre(v) || jaSugeridas.has(v.id)) continue
      const telOk = !!tel && v.tel === tel, nomeOk = nomeConfere(nome, v.cliente)
      if (telOk === nomeOk) continue  // os dois (já tratado acima) ou nenhum
      const { error } = await admin.from('vendas_sugestoes').insert({
        receita_id: r.id, unidade: loja, paciente_nome: nome, os_id: v.id, os_numero: v.os, os_tipo: ROTULO_TIPO[v.tipo] || v.tipo,
        cliente: v.cliente, telefone_fim: v.tel.slice(-4), dt_venda: v.dt, valor: v.valor,
        motivo: telOk ? 'TELEFONE_IGUAL_NOME_DIFERENTE' : 'NOME_IGUAL_TELEFONE_DIFERENTE',
      })
      if (!error) res.sugestoes_novas++
    }
  }

  // sugestões pendentes que perderam sentido: OS cancelada ou já ligada a outra receita
  for (const s of (sugs || []).filter((s: any) => s.status === 'PENDENTE')) {
    const v = vendaPorId[s.os_id]
    if (!v || v.cancelada || (ocupada[s.os_id] && ocupada[s.os_id] !== s.receita_id)) {
      await admin.from('vendas_sugestoes').update({ status: 'CANCELADA', decidido_em: new Date().toISOString() }).eq('id', s.id)
    }
  }
  // receita convertida não precisa mais de sugestão pendente
  const convertidas = Object.values(ocupada)
  if (convertidas.length) await admin.from('vendas_sugestoes').update({ status: 'CANCELADA', decidido_em: new Date().toISOString() })
    .eq('status', 'PENDENTE').in('receita_id', [...new Set(convertidas)])

  await admin.from('integracao_adm').update({ ultima_execucao: new Date().toISOString(), resumo: res }).eq('id', 1)
  return res
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const body = await req.json().catch(() => ({}))
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const acao = body?.acao || 'sincronizar'

  if (acao === 'confirmar' || acao === 'descartar') {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: au } = await admin.auth.getUser(jwt)
    const { data: eu } = au?.user ? await admin.from('usuarios').select('id,nome,perfil,ativo').eq('auth_id', au.user.id).maybeSingle() : { data: null }
    if (!eu?.ativo || !['prevenda', 'supervisor', 'diretor'].includes(eu.perfil)) return json({ ok: false, erro: 'Sem permissão.' }, 403)
    const { data: s } = await admin.from('vendas_sugestoes').select('*').eq('id', Number(body.id)).maybeSingle()
    if (!s) return json({ ok: false, erro: 'Sugestão não encontrada.' }, 404)
    if (s.status !== 'PENDENTE') return json({ ok: false, erro: 'Esta sugestão já foi resolvida.' }, 409)
    const { data: conv } = await admin.from('conversoes').select('origem').eq('receita_id', s.receita_id).maybeSingle()
    if (acao === 'confirmar' && conv && !['ADM', 'PRAZO'].includes(String(conv.origem || '').toUpperCase()))
      return json({ ok: false, erro: 'Esta receita já tem conversão registrada à mão.' }, 409)
    await admin.from('vendas_sugestoes').update({
      status: acao === 'confirmar' ? 'CONFIRMADA' : 'DESCARTADA', decidido_por: eu.nome, decidido_em: new Date().toISOString(),
    }).eq('id', s.id)
  }

  try {
    const resumo = await sincronizar(admin)
    return json({ ok: true, resumo })
  } catch (e) {
    console.error(e)
    return json({ ok: false, erro: 'Não foi possível buscar as vendas do ADM agora.' }, 502)
  }
})
