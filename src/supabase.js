import { createClient } from '@supabase/supabase-js';
const URL = 'https://gnqokiwxbamiegjrfacv.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImducW9raXd4YmFtaWVnanJmYWN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MDM3NzYsImV4cCI6MjEwNjE3OTc3Nn0.RkPkZiw7EOsnuKfYc-2tjFLUmcJDeoX4tRYizUuga1o';
export const supabase = createClient(URL, KEY, {
  realtime: { params: { eventsPerSecond: 10 } }
});

// Login pelo Supabase Auth. O prefixo mantém válidas as senhas curtas antigas (o Auth exige 6+ caracteres).
export const senhaAuth = (s) => `vi-${s}`;
const CAMPOS_USUARIO = 'id,nome,perfil,cro,ativo,unidade,endereco,auth_id';

export async function entrar(nome, senha) {
  const { data, error } = await supabase.functions.invoke('agenda-acesso', { body: { acao: 'entrar', nome: nome.trim(), senha } });
  if (error) {
    const status = error.context?.status;
    if (status === 401) return { erro: 'Usuário ou senha incorretos' };
    // Contingência: se a função de acesso estiver fora, usa o login antigo
    const { data: u } = await supabase.from('usuarios').select(CAMPOS_USUARIO).eq('nome', nome.trim()).eq('senha', senha).eq('ativo', true).maybeSingle();
    return u ? { usuario: u } : { erro: 'Não foi possível entrar agora. Tente de novo.' };
  }
  if (!data?.email) return { erro: 'Usuário ou senha incorretos' };
  const { data: s, error: e2 } = await supabase.auth.signInWithPassword({ email: data.email, password: senhaAuth(senha) });
  if (e2 || !s?.user) {
    // Auth existe mas senha está incompatível (migração manual via SQL). Pede para a Edge Function recriar.
    await supabase.functions.invoke('agenda-acesso', { body: { acao: 'entrar', nome: nome.trim(), senha, forcarRecriacao: true } });
    const { data: s2, error: e3 } = await supabase.auth.signInWithPassword({ email: data.email, password: senhaAuth(senha) });
    if (e3 || !s2?.user) return { erro: 'Usuário ou senha incorretos' };
    const { data: u2 } = await supabase.from('usuarios').select(CAMPOS_USUARIO).eq('auth_id', s2.user.id).eq('ativo', true).maybeSingle();
    if (!u2) { await supabase.auth.signOut(); return { erro: 'Usuário inativo' }; }
    return { usuario: u2 };
  }
  const { data: u } = await supabase.from('usuarios').select(CAMPOS_USUARIO).eq('auth_id', s.user.id).eq('ativo', true).maybeSingle();
  if (!u) { await supabase.auth.signOut(); return { erro: 'Usuário inativo' }; }
  return { usuario: u };
}

export async function usuarioDaSessao() {
  const { data } = await supabase.auth.getSession();
  const id = data?.session?.user?.id;
  if (!id) return null;
  const { data: u } = await supabase.from('usuarios').select(CAMPOS_USUARIO).eq('auth_id', id).eq('ativo', true).maybeSingle();
  return u || null;
}

export async function gerirUsuario(op, usuario) {
  const { data, error } = await supabase.functions.invoke('agenda-acesso', { body: { acao: 'gerir', op, usuario } });
  if (error) {
    let msg = 'Não foi possível salvar.';
    try { msg = (await error.context.json()).erro || msg; } catch {}
    return { erro: msg };
  }
  return data;
}
