// calendar-sync — substitui os workflows n8n "Clínica | Calendar → Sistema" e "Sistema → Calendar"
// 1) Lê os 4 Google Agendas (hoje até +21 dias), só eventos "IAW - ...", e espelha na tabela `agenda`:
//    novos → insere (agendado_por = 'IA'); remarcados → atualiza data/hora; apagados → status "Cancelado"
// 0) Reagendados no sistema (google_sync_pendente) → move o evento no Google antes da leitura
// 2) Agendamentos com status "Não Compareceu" e google_event_id → pinta o evento de Flamingo (colorId 4) no Google
// Disparado pelo pg_cron a cada 5 minutos. Credencial: secret GOOGLE_SERVICE_ACCOUNT (JSON da conta de serviço).
import { createClient } from 'npm:@supabase/supabase-js@2'

const CALENDARIOS: Record<string, string> = {
  'São Vicente': 'gerencia.callcenter.idealize@gmail.com',
  // Agendas "<Loja> - Visão Ideal" (onde a IA da Strong grava os agendamentos de cada loja)
  'Campinas': '2ab789af72d8528a3b3b6edc4688a6f776b93ec5c664ad396e19fb6f82c13094@group.calendar.google.com',
  'Sorocaba': 'b199cc51bf81eb66eb2220d57ee3f16f9d8f7459793506f5f894ec03025c24c8@group.calendar.google.com',
  'Piracicaba': 'aa156e0a3aa3bb86fc2cc386b4b6af0c6921fe60cd978bfdd9bc30a99d6066c3@group.calendar.google.com',
}
const TZ = 'America/Sao_Paulo'
const COR_NAO_COMPARECEU = '4' // Flamingo
const COR_IA = '7' // Pavão (cor padrão dos eventos da IA)

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

const b64url = (buf: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof buf === 'string' ? new TextEncoder().encode(buf) : new Uint8Array(buf as ArrayBuffer)
  let s = ''
  bytes.forEach(b => (s += String.fromCharCode(b)))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function googleToken(sa: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/calendar.events',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }))
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claim}`))
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${b64url(sig)}`,
    }),
  })
  const d = await r.json()
  if (!d.access_token) throw new Error('Falha ao autenticar no Google: ' + JSON.stringify(d))
  return d.access_token as string
}

// Data de hoje em São Paulo (YYYY-MM-DD)
const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())

function montarLinha(ev: any, unidade: string) {
  const startRaw: string = ev.start?.dateTime || ev.start?.date || ''
  let data = '', hora = '09:00'
  const m = startRaw.match(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  if (m) { data = m[1]; hora = m[2] } else { const d = startRaw.match(/\d{4}-\d{2}-\d{2}/); if (d) data = d[0] }
  const summary = String(ev.summary || '').trim()
  const nome = summary.replace(/^IAW\s*[-–]?\s*/i, '').trim() || summary || 'Sem nome'
  const desc = String(ev.description || '')
  const tel = desc.match(/wa\.me\/(\d{10,13})/)?.[1] || ''
  return {
    id: crypto.randomUUID(),
    google_event_id: ev.id,
    paciente_nome: nome,
    paciente_telefone: tel,
    opto_id: null,
    opto_nome: '',
    data, hora,
    procedimento: 'Consulta',
    meio_contato: 'WhatsApp',
    agendado_por: 'IA',
    status: 'Agendado',
    observacoes: desc,
    unidade,
    calendar_updated: false,
  }
}

Deno.serve(async (req: Request) => {
  const body = await req.json().catch(() => ({}))
  const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT')
  if (!raw) return json({ ok: false, erro: 'Secret GOOGLE_SERVICE_ACCOUNT não configurado' }, 500)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let inseridos = 0, marcados = 0, atualizados = 0, canceladosN = 0
  const erros: string[] = []

  let token: string
  try { token = await googleToken(JSON.parse(raw)) } catch (e) { return json({ ok: false, erro: String(e) }, 500) }
  const gHeaders = { Authorization: `Bearer ${token}` }
  const eventosPorUnidade: Record<string, number> = {}

  // Diagnóstico: lista os calendários que a conta de serviço enxerga
  if (body?.debug) {
    const out: Record<string, unknown> = {}
    for (const [unidade, calId] of Object.entries(CALENDARIOS)) {
      const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}`, { headers: gHeaders })
      const ev = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?maxResults=5&orderBy=updated&timeMin=${encodeURIComponent(new Date(Date.now() - 30 * 86400000).toISOString())}`, { headers: gHeaders })
      const evj = await ev.json()
      out[unidade] = {
        calendario: r.status, eventos_status: ev.status,
        recentes: (evj.items || []).map((e: any) => ({ s: e.summary, ini: e.start?.dateTime || e.start?.date, st: e.status })),
      }
    }
    const lista = await (await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', { headers: gHeaders })).json()
    out.calendarList = (lista.items || []).map((c: any) => ({ id: c.id, nome: c.summary, acesso: c.accessRole }))
    try { out.conta_servico = JSON.parse(raw).client_email } catch { /* */ }
    return json(out)
  }

  // ── 0) Sistema → Google: reagendamentos feitos no sistema movem o evento no Google ──
  // (assim a IA vê o horário novo livre/ocupado corretamente e a leitura abaixo não desfaz a mudança)
  const { data: pendentes, error: pErr } = await admin.from('agenda')
    .select('id, google_event_id, unidade, data, hora')
    .eq('google_sync_pendente', true).not('google_event_id', 'is', null).limit(100)
  if (pErr) erros.push('busca reagendados: ' + pErr.message)
  let reagendados = 0
  for (const a of pendentes || []) {
    const calId = CALENDARIOS[a.unidade as string] || CALENDARIOS['São Vicente']
    try {
      const ini = new Date(`${a.data}T${String(a.hora).slice(0, 5)}:00-03:00`)
      const fim = new Date(ini.getTime() + 30 * 60000)
      const fmt = (d: Date) => new Date(d.getTime() - 3 * 3600000).toISOString().slice(0, 19)
      const r = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(a.google_event_id)}`,
        { method: 'PATCH', headers: { ...gHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ start: { dateTime: fmt(ini), timeZone: TZ }, end: { dateTime: fmt(fim), timeZone: TZ }, colorId: COR_IA }) },
      )
      if (r.ok || r.status === 404 || r.status === 410) {
        await admin.from('agenda').update({ google_sync_pendente: false, calendar_updated: false }).eq('id', a.id)
        if (r.ok) reagendados++
      } else erros.push(`reagendar ${a.google_event_id}: ${r.status} ${await r.text()}`)
    } catch (e) { erros.push(`reagendar ${a.google_event_id}: ${String(e)}`) }
  }

  // ── 1) Google Calendar → Sistema ───────────────────────────
  const hoje = hojeSP()
  const timeMin = new Date(`${hoje}T00:00:00-03:00`).toISOString()
  const timeMax = new Date(Date.now() + 21 * 86400000).toISOString()

  for (const [unidade, calId] of Object.entries(CALENDARIOS)) {
    try {
      // Lê todas as páginas de eventos do período (inclui apagados)
      const items: any[] = []
      let pageToken = '', falhaGoogle = false
      do {
        const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`)
        const params: Record<string, string> = {
          timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250', timeZone: TZ,
          showDeleted: 'true',
        }
        if (pageToken) params.pageToken = pageToken
        url.search = new URLSearchParams(params).toString()
        const r = await fetch(url, { headers: gHeaders })
        if (!r.ok) { erros.push(`${unidade}: ${r.status} ${await r.text()}`); falhaGoogle = true; break }
        const j = await r.json()
        items.push(...(j.items || []))
        pageToken = j.nextPageToken || ''
      } while (pageToken)
      if (falhaGoogle) continue
      // Só eventos criados pela IA (título "IAW - Nome"); reuniões e outros compromissos ficam de fora
      // (apagados podem vir sem título; esses são casados só pelo id com o que já está no sistema)
      const ativos = items.filter((e: any) => e.status !== 'cancelled' && /^IAW\b/i.test(String(e.summary || '').trim()))
      const cancelados = items.filter((e: any) => e.status === 'cancelled')
      const todos = [...ativos, ...cancelados]
      eventosPorUnidade[unidade] = ativos.length
      if (!todos.length) continue

      // Busca o que já existe no sistema, em lotes de 100 ids (evita URL longa demais)
      const ids: string[] = todos.map((e: any) => e.id)
      const existentes: any[] = []
      let falhou = false
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await admin.from('agenda')
          .select('id, google_event_id, data, hora, status, google_sync_pendente').in('google_event_id', ids.slice(i, i + 100))
        if (error) { erros.push(`${unidade}: ${error.message}`); falhou = true; break }
        existentes.push(...(data || []))
      }
      if (falhou) continue
      const porEvento = new Map(existentes.map(x => [x.google_event_id, x]))

      // Novos → insere
      const novos = ativos.filter((e: any) => !porEvento.has(e.id)).map((e: any) => montarLinha(e, unidade))
      if (novos.length) {
        const { error: insErr } = await admin.from('agenda').insert(novos)
        if (insErr) erros.push(`${unidade} insert: ${insErr.message}`)
        else inseridos += novos.length
      }

      // Remarcados no Google (data/hora mudou) → atualiza, só se ainda estiver "Agendado"
      for (const e of ativos) {
        const row = porEvento.get(e.id)
        if (!row || row.status !== 'Agendado' || row.google_sync_pendente) continue
        const l = montarLinha(e, unidade)
        if (row.data !== l.data || row.hora !== l.hora) {
          const { error: upErr } = await admin.from('agenda')
            .update({ data: l.data, hora: l.hora }).eq('id', row.id)
          if (upErr) erros.push(`${unidade} update: ${upErr.message}`); else atualizados++
        }
      }

      // Apagados no Google → status "Cancelado", só se ainda estiver "Agendado"
      for (const e of cancelados) {
        const row = porEvento.get(e.id)
        if (!row || row.status !== 'Agendado') continue
        const { error: cErr } = await admin.from('agenda').update({ status: 'Cancelado' }).eq('id', row.id)
        if (cErr) erros.push(`${unidade} cancel: ${cErr.message}`); else canceladosN++
      }
    } catch (e) { erros.push(`${unidade}: ${String(e)}`) }
  }

  // ── 2) Sistema → Google Calendar (Não Compareceu) ──────────
  const { data: faltas, error: fErr } = await admin.from('agenda')
    .select('id, google_event_id, unidade')
    .eq('status', 'Não Compareceu')
    .not('google_event_id', 'is', null)
    .or('calendar_updated.is.null,calendar_updated.eq.false')
    .limit(100)
  if (fErr) erros.push('busca faltas: ' + fErr.message)

  for (const f of faltas || []) {
    const calId = CALENDARIOS[f.unidade as string] || CALENDARIOS['São Vicente']
    try {
      const r = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(f.google_event_id)}`,
        { method: 'PATCH', headers: { ...gHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ colorId: COR_NAO_COMPARECEU }) },
      )
      // 404/410 = evento apagado no Google → marca como resolvido para não tentar de novo
      if (r.ok || r.status === 404 || r.status === 410) {
        await admin.from('agenda').update({ calendar_updated: true }).eq('id', f.id)
        if (r.ok) marcados++
      } else erros.push(`cor ${f.google_event_id}: ${r.status} ${await r.text()}`)
    } catch (e) { erros.push(`cor ${f.google_event_id}: ${String(e)}`) }
  }

  return json({ ok: erros.length === 0, eventos_no_google: eventosPorUnidade, reagendados_no_google: reagendados, inseridos, atualizados, cancelados: canceladosN, marcados_nao_compareceu: marcados, erros })
})
