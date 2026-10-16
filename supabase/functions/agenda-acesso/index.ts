// agenda-acesso — login e gestão de usuários do sistema da Clínica Visão Ideal
// - entrar: confere nome + senha (hash bcrypt em agenda_priv.senhas) e devolve uma sessão do Supabase Auth.
//   Com a sessão, o app passa pelo RLS das tabelas (agenda, pacientes, receitas, conversoes, usuarios).
//   Cada usuário tem um login técnico no Auth (<id>@agenda.idealize) com senha derivada no servidor;
//   a senha real do usuário nunca vai para o Auth nem fica em texto puro.
// - gerir: identifica quem chama pelo token da sessão (Authorization). Listar: qualquer usuário ativo.
//   Criar/editar/ativar: só supervisor e diretor.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const GESTORES = ['supervisor', 'diretor']
const PERFIS = ['opto', 'comercial', 'prevenda', 'gerente', 'supervisor', 'diretor']
const SEM_UNIDADE = ['diretor', 'supervisor', 'prevenda']
const CAMPOS = 'id,nome,perfil,cro,ativo,unidade,endereco,auth_id'
const DOMINIO_AUTH = 'agenda.idealize'

const URL = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const resp = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const erro = (mensagem: string, status = 400) => resp({ erro: mensagem }, status)
const novoId = () => Array.from(crypto.getRandomValues(new Uint8Array(8))).map((b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('')
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Senha técnica do login no Auth: HMAC(service key, id). Só o servidor consegue gerar.
async function senhaTecnica(id: string) {
  const enc = new TextEncoder()
  const k = await crypto.subtle.importKey('raw', enc.encode(SERVICE), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode('agenda-auth:' + id)))
  return 'ag$' + Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Garante o login técnico no Auth e devolve uma sessão para o usuário
async function abrirSessao(admin: any, u: { id: string; auth_id: string | null }) {
  const senha = await senhaTecnica(u.id)
  let authId = u.auth_id
  let email = ''

  if (authId) {
    const { data } = await admin.auth.admin.getUserById(authId)
    email = data?.user?.email || ''
    if (!email) authId = null // login técnico foi apagado: recria
  }
  if (!authId) {
    email = `${u.id.toLowerCase()}@${DOMINIO_AUTH}`
    const { data, error } = await admin.auth.admin.createUser({
      email, password: senha, email_confirm: true, user_metadata: { usuario_id: u.id },
    })
    if (error) {
      // já existe um login com esse e-mail: reaproveita
      const { data: lista } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const achou = lista?.users?.find((x: any) => x.email === email)
      if (!achou) throw new Error('Não foi possível preparar o acesso: ' + error.message)
      authId = achou.id
    } else {
      authId = data.user.id
    }
    await admin.from('usuarios').update({ auth_id: authId }).eq('id', u.id)
  }

  const pub = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  let { data: s, error } = await pub.auth.signInWithPassword({ email, password: senha })
  if (error || !s?.session) {
    // senha técnica antiga (ex.: login criado pelo fluxo anterior): atualiza e tenta de novo
    await admin.auth.admin.updateUserById(authId, { password: senha, email_confirm: true })
    ;({ data: s, error } = await pub.auth.signInWithPassword({ email, password: senha }))
  }
  if (error || !s?.session) throw new Error('Não foi possível abrir a sessão.')
  const { access_token, refresh_token, expires_at } = s.session
  return { access_token, refresh_token, expires_at }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return erro('Método não permitido', 405)

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
  let body: Record<string, any>
  try { body = await req.json() } catch { return erro('Requisição inválida.') }

  try {
    // ── LOGIN ──────────────────────────────────────────────
    if (body.acao === 'entrar') {
      const nome = String(body.nome || '').trim().toLowerCase()
      const senha = String(body.senha || '')
      if (!nome || !senha) return erro('Usuário ou senha incorretos', 401)

      const { data: ativos } = await admin.from('usuarios').select(CAMPOS).eq('ativo', true)
      const u = (ativos || []).find((x: any) => String(x.nome || '').trim().toLowerCase() === nome)
      const { data: ok } = u
        ? await admin.rpc('agenda_verificar_senha', { p_id: u.id, p_senha: senha })
        : { data: false }
      if (!u || !ok) { await espera(600); return erro('Usuário ou senha incorretos', 401) }

      const sessao = await abrirSessao(admin, u)
      const { data: usuario } = await admin.from('usuarios').select(CAMPOS).eq('id', u.id).single()
      return resp({ usuario, sessao })
    }

    // ── GERENCIAR USUÁRIOS ─────────────────────────────────
    if (body.acao === 'gerir') {
      const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
      const { data: au } = await admin.auth.getUser(jwt)
      if (!au?.user) return erro('Sessão expirada. Entre novamente.', 401)
      const { data: eu } = await admin.from('usuarios').select('id, perfil, ativo').eq('auth_id', au.user.id).maybeSingle()
      if (!eu?.ativo) return erro('Sessão expirada. Entre novamente.', 401)

      // LISTAR — qualquer usuário ativo (usado para nomes de optometristas, relatórios etc.)
      if (body.op === 'listar') {
        let q = admin.from('usuarios').select(CAMPOS).order('nome')
        if (body.usuario?.unidade) q = q.eq('unidade', body.usuario.unidade)
        const { data, error } = await q
        if (error) return erro(error.message)
        return resp({ usuarios: data || [] })
      }

      if (!GESTORES.includes(eu.perfil)) return erro('Seu perfil não pode gerenciar usuários.', 403)
      const f = body.usuario || {}

      if (body.op === 'ativo') {
        if (f.id === eu.id) return erro('Você não pode desativar o seu próprio usuário.')
        const { error } = await admin.from('usuarios').update({ ativo: !!f.ativo }).eq('id', f.id)
        return error ? erro(error.message) : resp({ ok: true })
      }

      const perfil = String(f.perfil || '')
      const dados = {
        nome: String(f.nome || '').trim(),
        perfil,
        unidade: SEM_UNIDADE.includes(perfil) ? null : (f.unidade || null),
        endereco: SEM_UNIDADE.includes(perfil) ? null : (f.endereco || null),
        cro: f.cro || null,
      }
      if (dados.nome.length < 2) return erro('Informe o nome.')
      if (!PERFIS.includes(dados.perfil)) return erro('Perfil inválido.')
      if (!SEM_UNIDADE.includes(perfil) && !dados.unidade) return erro('Selecione a unidade.')
      if (f.senha && String(f.senha).length < 4) return erro('A senha precisa ter pelo menos 4 caracteres.')

      const { data: todos } = await admin.from('usuarios').select('id, nome')
      const repetido = (todos || []).some((x: any) => x.id !== f.id && String(x.nome).trim().toLowerCase() === dados.nome.toLowerCase())
      if (repetido) return erro('Já existe um usuário com esse nome.')

      if (!f.id) {
        if (!f.senha) return erro('Defina uma senha.')
        const id = novoId()
        const { error } = await admin.from('usuarios').insert({ id, ...dados, ativo: true })
        if (error) return erro(error.message)
        const { error: e2 } = await admin.rpc('agenda_definir_senha', { p_id: id, p_senha: String(f.senha) })
        if (e2) return erro(e2.message)
        return resp({ ok: true, id })
      }

      const { error } = await admin.from('usuarios').update(dados).eq('id', f.id)
      if (error) return erro(error.message)
      if (f.senha) {
        const { error: e2 } = await admin.rpc('agenda_definir_senha', { p_id: f.id, p_senha: String(f.senha) })
        if (e2) return erro(e2.message)
      }
      return resp({ ok: true })
    }

    return erro('Ação desconhecida.')
  } catch (e) {
    return erro((e as Error).message, 500)
  }
})
