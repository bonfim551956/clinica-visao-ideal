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
  // 1) Tenta via Edge Function (migra senha para Auth se necessário)
  const { data, error } = await supabase.functions.invoke('agenda-acesso', { body: { acao: 'entrar', nome: nome.trim(), senha } });
  if (!error && data?.email) {
    // Edge Function ok — tenta signIn
    const { data: s } = await supabase.auth.signInWithPassword({ email: data.email, password: senhaAuth(senha) });
    if (s?.user) {
      // Força recriação da senha Auth se necessário
      if (!s.user) {
        await supabase.functions.invoke('agenda-acesso', { body: { acao: 'entrar', nome: nome.trim(), senha, forcarRecriacao: true } });
        const { data: s2 } = await supabase.auth.signInWithPassword({ email: data.email, password: senhaAuth(senha) });
        if (s2?.user) {
          const { data: u2 } = await supabase.from('usuarios').select(CAMPOS_USUARIO).eq('auth_id', s2.user.id).eq('ativo', true).maybeSingle();
          if (u2) return { usuario: u2 };
        }
      } else {
        const { data: u } = await supabase.from('usuarios').select(CAMPOS_USUARIO).eq('auth_id', s.user.id).eq('ativo', true).maybeSingle();
        if (u) return { usuario: u };
      }
    }
  }
  if (error?.context?.status === 401) return { erro: 'Usuário ou senha incorretos' };

  // 2) Fallback direto: verifica senha na tabela (para usuários sem Auth ou quando Edge Function falha)
  const { data: u } = await supabase.from('usuarios').select(CAMPOS_USUARIO).eq('nome', nome.trim()).eq('senha', senha).eq('ativo', true).maybeSingle();
  if (u) return { usuario: u };

  return { erro: 'Usuário ou senha incorretos' };
}

export async function usuarioDaSessao() {
  const { data } = await supabase.auth.getSession();
  const id = data?.session?.user?.id;
  if (!id) return null;
  const { data: u } = await supabase.from('usuarios').select(CAMPOS_USUARIO).eq('auth_id', id).eq('ativo', true).maybeSingle();
  return u || null;
}

export async function gerirUsuario(op, usuario) {
  // Tenta via Edge Function (requer sessão Auth válida)
  const { data, error } = await supabase.functions.invoke('agenda-acesso', { body: { acao: 'gerir', op, usuario } });
  if (!error) return data;

  // Fallback direto no banco para diretores/supervisores sem sessão Auth
  const status = error.context?.status;
  if (status === 401 || status === 403) {
    // Operação de ativar/desativar
    if (op === 'ativo') {
      const { error: e } = await supabase.from('usuarios').update({ ativo: !!usuario.ativo }).eq('id', usuario.id);
      return e ? { erro: e.message } : { ok: true };
    }
    // Salvar/criar usuário
    const dados = {
      nome: usuario.nome?.trim(),
      perfil: usuario.perfil,
      unidade: usuario.unidade || null,
      endereco: usuario.endereco || null,
      cro: usuario.cro || null,
    };
    if (usuario.id) {
      const { error: e } = await supabase.from('usuarios').update(dados).eq('id', usuario.id);
      if (e) return { erro: e.message };
      // Atualiza senha na tabela se fornecida
      if (usuario.senha) await supabase.from('usuarios').update({ senha: usuario.senha }).eq('id', usuario.id);
      return { ok: true };
    } else {
      // Novo usuário — gera ID e insere
      const id = Math.random().toString(36).slice(2, 10).toUpperCase();
      const { error: e } = await supabase.from('usuarios').insert({ id, ...dados, senha: usuario.senha || '', ativo: true });
      if (e) return { erro: e.message };
      return { ok: true, id };
    }
  }

  let msg = 'Não foi possível salvar.';
  try { msg = (await error.context.json()).erro || msg; } catch {}
  return { erro: msg };
}
