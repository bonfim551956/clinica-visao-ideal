import { createClient } from '@supabase/supabase-js';
const URL = 'https://gnqokiwxbamiegjrfacv.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImducW9raXd4YmFtaWVnanJmYWN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MDM3NzYsImV4cCI6MjEwNjE3OTc3Nn0.RkPkZiw7EOsnuKfYc-2tjFLUmcJDeoX4tRYizUuga1o';
export const supabase = createClient(URL, KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 10 } }
});

const CAMPOS_USUARIO = 'id,nome,perfil,cro,ativo,unidade,endereco,auth_id';

// Login: a função agenda-acesso confere a senha e devolve uma sessão do Supabase Auth.
// A sessão é o que libera o acesso aos dados (RLS) — sem ela as tabelas não respondem.
export async function entrar(nome, senha) {
  const { data, error } = await supabase.functions.invoke('agenda-acesso', {
    body: { acao: 'entrar', nome: nome.trim(), senha }
  });
  if (error) {
    const status = error.context?.status;
    if (status === 401) return { erro: 'Usuário ou senha incorretos' };
    let msg = 'Não foi possível entrar agora. Tente de novo.';
    try { msg = (await error.context.json())?.erro || msg; } catch {}
    return { erro: msg };
  }
  if (!data?.usuario || !data?.sessao) return { erro: data?.erro || 'Usuário ou senha incorretos' };
  const { error: e2 } = await supabase.auth.setSession({
    access_token: data.sessao.access_token,
    refresh_token: data.sessao.refresh_token,
  });
  if (e2) return { erro: 'Não foi possível abrir a sessão. Tente de novo.' };
  return { usuario: data.usuario };
}

// Usuário da sessão atual (null se não houver sessão válida ou se o usuário foi desativado)
export async function usuarioDaSessao() {
  const { data } = await supabase.auth.getSession();
  const id = data?.session?.user?.id;
  if (!id) return null;
  const { data: u } = await supabase.from('usuarios').select(CAMPOS_USUARIO).eq('auth_id', id).eq('ativo', true).maybeSingle();
  return u || null;
}

export async function sair() {
  try { await supabase.auth.signOut(); } catch {}
}

// Gestão de usuários: a função identifica quem chama pelo token da sessão
export async function gerirUsuario(op, usuario) {
  const { data, error } = await supabase.functions.invoke('agenda-acesso', {
    body: { acao: 'gerir', op, usuario }
  });
  if (!error && data) return data;
  let msg = 'Não foi possível salvar.';
  try { msg = (await error?.context?.json())?.erro || msg; } catch {}
  return { erro: msg };
}
