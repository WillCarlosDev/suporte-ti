
// Modelo padrão — llama-3.3-70b-versatile é o mais capaz gratuitamente
const GROQ_MODEL   = 'llama-3.3-70b-versatile';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY não configurada no servidor' });
  }

  try {
    const { system, messages, max_tokens } = req.body;

    // Groq usa formato OpenAI — montar messages array
    const groqMessages = [];

    // System prompt vira uma mensagem com role "system"
    if (system) {
      groqMessages.push({ role: 'system', content: system });
    }

    // Adicionar mensagens da conversa
    if (Array.isArray(messages)) {
      groqMessages.push(...messages);
    }

    const groqBody = {
      model:       GROQ_MODEL,
      messages:    groqMessages,
      max_tokens:  max_tokens || 1000,
      temperature: 0.4, // mais consistente para suporte técnico
    };

    const upstream = await fetch(GROQ_API_URL, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(groqBody),
    });

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      console.error('[groq-proxy] erro:', err);
      return res.status(upstream.status).json({
        error: err.error?.message || `Groq HTTP ${upstream.status}`
      });
    }

    const groqData = await upstream.json();

    // Converter resposta do Groq (formato OpenAI) para formato Anthropic
    // O painel espera: { content: [{ type: 'text', text: '...' }] }
    const texto = groqData.choices?.[0]?.message?.content || '';

    return res.status(200).json({
      content: [{ type: 'text', text: texto }],
      // Manter info de uso para debug
      usage: groqData.usage,
    });

  } catch (e) {
    console.error('[groq-proxy] erro interno:', e.message);
    return res.status(500).json({ error: 'Erro interno no proxy' });
  }
}
