import { createClient } from '@supabase/supabase-js';
const URL = 'https://gnqokiwxbamiegjrfacv.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImducW9raXd4YmFtaWVnanJmYWN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MDM3NzYsImV4cCI6MjEwNjE3OTc3Nn0.RkPkZiw7EOsnuKfYc-2tjFLUmcJDeoX4tRYizUuga1o';
export const supabase = createClient(URL, KEY, {
  realtime: { params: { eventsPerSecond: 10 } }
});

// Login via Edge Function — retorna usuário direto, sem depender do Supabase Auth
export async function entrar(nome, senha) {
  const { data, error } = await supabase.functions.invoke('agenda-acesso', {
    body: { acao: 'entrar', nome: nome.trim(), senha }
  });
  if (error) return { erro: 'Usuário ou senha incorretos' };
  if (data?.erro) return { erro: data.erro };
  if (data?.usuario) return { usuario: data.usuario };
  return { erro: 'Usuário ou senha incorretos' };
}

export async function usuarioDaSessao() {
  // Sessão salva no localStorage pelo login
  try {
    const s = localStorage.getItem('agenda_session');
    if (!s) return null;
    const u = JSON.parse(s);
    return u?.id ? u : null;
  } catch { return null; }
}

export async function gerirUsuario(op, usuario) {
  let gestorId = '';
  try { const s = localStorage.getItem('vi_session'); gestorId = s ? JSON.parse(s)?.id || '' : ''; } catch {}
  const { data, error } = await supabase.functions.invoke('agenda-acesso', {
    body: { acao: 'gerir', op, usuario, gestor_id: gestorId }
  });
  if (!error && data) return data;
  let msg = 'Não foi possível salvar.';
  try { msg = (await error?.context?.json())?.erro || msg; } catch {}
  return { erro: msg };
}
