// calendar-sync — substitui os workflows n8n "Clínica | Calendar → Sistema" e "Sistema → Calendar"
// 1) Lê os 4 Google Agendas (hoje até +20 dias) e insere na tabela `agenda` os eventos novos (agendado_por = 'IA')
// 2) Agendamentos com status "Não Compareceu" e google_event_id → pinta o evento de Flamingo (colorId 4) no Google
// Disparado pelo pg_cron a cada 5 minutos. Credencial: secret GOOGLE_SERVICE_ACCOUNT (JSON da conta de serviço).
import { createClient } from 'npm:@supabase/supabase-js@2'

const CALENDARIOS: Record<string, string> = {
  'São Vicente': 'gerencia.callcenter.idealize@gmail.com',
  'Campinas': 'agendavicampinas@gmail.com',
  'Sorocaba': 'agendavisorocaba@gmail.com',
  'Piracicaba': 'agendavipiracicaba@gmail.com',
}
const TZ = 'America/Sao_Paulo'
const COR_NAO_COMPARECEU = '4' // Flamingo

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

Deno.serve(async () => {
  const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT')
  if (!raw) return json({ ok: false, erro: 'Secret GOOGLE_SERVICE_ACCOUNT não configurado' }, 500)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let inseridos = 0, marcados = 0
  const erros: string[] = []

  let token: string
  try { token = await googleToken(JSON.parse(raw)) } catch (e) { return json({ ok: false, erro: String(e) }, 500) }
  const gHeaders = { Authorization: `Bearer ${token}` }

  // ── 1) Google Calendar → Sistema ───────────────────────────
  const hoje = hojeSP()
  const timeMin = new Date(`${hoje}T00:00:00-03:00`).toISOString()
  const timeMax = new Date(Date.now() + 21 * 86400000).toISOString()

  for (const [unidade, calId] of Object.entries(CALENDARIOS)) {
    try {
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`)
      url.search = new URLSearchParams({
        timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '500', timeZone: TZ,
      }).toString()
      const r = await fetch(url, { headers: gHeaders })
      if (!r.ok) { erros.push(`${unidade}: ${r.status} ${await r.text()}`); continue }
      const eventos = ((await r.json()).items || []).filter((e: any) => e.status !== 'cancelled')
      if (!eventos.length) continue

      const ids = eventos.map((e: any) => e.id)
      const { data: existentes, error } = await admin.from('agenda').select('google_event_id').in('google_event_id', ids)
      if (error) { erros.push(`${unidade}: ${error.message}`); continue }
      const jaTem = new Set((existentes || []).map(x => x.google_event_id))

      const novos = eventos.filter((e: any) => !jaTem.has(e.id)).map((e: any) => montarLinha(e, unidade))
      if (novos.length) {
        const { error: insErr } = await admin.from('agenda').insert(novos)
        if (insErr) erros.push(`${unidade} insert: ${insErr.message}`)
        else inseridos += novos.length
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

  return json({ ok: erros.length === 0, inseridos, marcados_nao_compareceu: marcados, erros })
})
