// api/twilio-webhook.js
// Webhook para Twilio WhatsApp Sandbox
// Recebe mensagens, consulta IA (Groq) e responde via TwiML

export default async function handler(req, res) {
  // Twilio sempre envia POST
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const from    = req.body?.From || '';   // ex: whatsapp:+5531999990000
  const body    = req.body?.Body || '';   // texto da mensagem
  const phone   = from.replace('whatsapp:', '');

  // Variáveis de ambiente
  const GROQ_KEY   = process.env.GROQ_API_KEY;
  const SUPA_URL   = process.env.SUPABASE_URL   || 'https://civxugoribdwlnghbzbx.supabase.co';
  const SUPA_KEY   = process.env.SUPABASE_ANON_KEY;
  const AGENT_NAME = process.env.WA_AGENT_NAME  || 'Suporte TI';
  const WELCOME    = process.env.WA_WELCOME_MSG  ||
    'Olá! Sou o assistente de suporte da Acesso e Ponto.\n\nPara iniciar, informe:\n• Seu nome\n• Razão social da empresa\n• CNPJ\n• Sistema utilizado (RHID, iPonto ou Atecsoft)';

  // ── Helpers Supabase ─────────────────────────────────────────────────────────
  async function sbGet(path) {
    const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
      headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
    });
    return r.ok ? r.json() : null;
  }

  async function sbPost(path, data, prefer = '') {
    await fetch(`${SUPA_URL}/rest/v1/${path}`, {
      method: 'POST',
      headers: {
        'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`,
        'Content-Type': 'application/json',
        ...(prefer ? { 'Prefer': prefer } : {})
      },
      body: JSON.stringify(data)
    });
  }

  async function sbPatch(path, data) {
    await fetch(`${SUPA_URL}/rest/v1/${path}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  }

  // ── Carrega conversa do Supabase ─────────────────────────────────────────────
  let conversa = null;
  try {
    const rows = await sbGet(`wa_conversations?phone=eq.${encodeURIComponent(phone)}&limit=1`);
    if (rows && rows.length > 0) conversa = rows[0];
  } catch(e) { console.error('Erro ao carregar conversa:', e); }

  const historico  = conversa?.messages || [];
  const primeiraVez = historico.length === 0;
  let clienteCNPJ  = conversa?.cnpj    || null;
  let clienteEmpresa = conversa?.empresa || null;

  // Extrai CNPJ da mensagem se presente
  const cnpjMatch = body.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/);
  if (cnpjMatch) clienteCNPJ = cnpjMatch[0].replace(/\D/g, '');

  // ── Monta resposta ────────────────────────────────────────────────────────────
  let replyText = '';

  if (primeiraVez) {
    // Primeira mensagem: envia boas-vindas + processa com IA
    replyText = WELCOME;
  } else {
    // Consulta IA (Groq)
    try {
      const messages = [
        ...historico.slice(-10),
        { role: 'user', content: body }
      ];

      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_KEY}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 600,
          messages: [
            {
              role: 'system',
              content: `Você é ${AGENT_NAME}, assistente de suporte técnico da Acesso e Ponto (RHID, iPonto, Atecsoft) via WhatsApp.
Sempre colete: nome, razão social, CNPJ e sistema ao iniciar.
${clienteCNPJ ? `CNPJ identificado: ${clienteCNPJ}` : ''}
${clienteEmpresa ? `Empresa identificada: ${clienteEmpresa}` : ''}
Prioridades: Contrato > Garantia > Avulso.
Use linguagem simples, sem termos técnicos desnecessários.
Responda de forma concisa e amigável para WhatsApp — mensagens curtas.
Se identificar um novo chamado ao final, adicione exatamente:
CHAMADO: <categoria>|<sistema>|<n1 ou n2>|<empresa>|<cnpj>|<nome do cliente>`
            },
            ...messages
          ]
        })
      });

      const groqData = await groqRes.json();
      const fullText = groqData.choices?.[0]?.message?.content || '';

      // Extrai linha de chamado
      const lines = fullText.split('\n');
      const chamadoLine = lines.find(l => l.startsWith('CHAMADO:'));
      replyText = lines.filter(l => !l.startsWith('CHAMADO:')).join('\n').trim();

      // Extrai empresa/cnpj da linha de chamado se existir
      if (chamadoLine) {
        const parts = chamadoLine.replace('CHAMADO:', '').trim().split('|');
        const [cat, sis, niv, emp, cnpj, nomeCliente] = parts;
        if (emp?.trim()) clienteEmpresa = emp.trim();
        if (cnpj?.trim()) clienteCNPJ = cnpj.trim().replace(/\D/g, '');

        // Cria chamado no Supabase
        const novoId = '#WA' + Date.now().toString().slice(-4);
        await sbPost('chamados', {
          id: novoId,
          nome: nomeCliente?.trim() || phone,
          empresa: clienteEmpresa || 'Via WhatsApp',
          cnpj: clienteCNPJ ? clienteCNPJ.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : '—',
          sistema: sis?.trim().toLowerCase() || 'rhid',
          prioridade: 'avulso',
          categoria: cat?.trim() || 'outro',
          nivel: niv?.trim() || 'n1',
          status: 'aberto',
          descricao: body,
          from_whatsapp: true,
          whatsapp_phone: phone,
          replies: [],
          created_at: new Date().toISOString()
        }, 'resolution=merge-duplicates,return=minimal');
      }

    } catch(e) {
      console.error('Erro IA:', e);
      replyText = 'Desculpe, tivemos um problema. Por favor tente novamente em instantes.';
    }
  }

  // ── Salva histórico ───────────────────────────────────────────────────────────
  const novoHistorico = [
    ...historico,
    { role: 'user',      content: body      },
    { role: 'assistant', content: replyText }
  ].slice(-20);

  try {
    if (conversa) {
      await sbPatch(
        `wa_conversations?phone=eq.${encodeURIComponent(phone)}`,
        { messages: novoHistorico, cnpj: clienteCNPJ, empresa: clienteEmpresa, updated_at: new Date().toISOString() }
      );
    } else {
      await sbPost('wa_conversations', {
        phone, cnpj: clienteCNPJ, empresa: clienteEmpresa,
        messages: novoHistorico,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      });
    }
  } catch(e) { console.error('Erro salvar conversa:', e); }

  // ── Responde com TwiML ────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${replyText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</Message>
</Response>`);
}
