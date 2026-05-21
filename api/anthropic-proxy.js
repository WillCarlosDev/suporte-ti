
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: {
        message: 'GROQ_API_KEY não configurada. No Vercel: Settings → Environment Variables → adicione GROQ_API_KEY com sua chave do Groq.'
      }
    });
  }

  try {
    const body = req.body;

    // Groq usa o mesmo formato da API OpenAI
    // Converte o formato Anthropic (system + messages) para OpenAI (messages[])
    const messages = [];
    if (body.system) {
      messages.push({ role: 'system', content: body.system });
    }
    if (Array.isArray(body.messages)) {
      body.messages.forEach(m => {
        const content = Array.isArray(m.content)
          ? m.content.map(b => b.text || '').join('')
          : m.content;
        messages.push({ role: m.role, content });
      });
    }

    const groqBody = {
      model:       body.model || 'llama-3.3-70b-versatile',
      max_tokens:  body.max_tokens || 1024,
      temperature: body.temperature ?? 0.7,
      messages,
    };

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(groqBody),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: { message: data.error?.message || `Groq API error ${response.status}` }
      });
    }

    // Converter resposta Groq (OpenAI format) de volta para formato Anthropic
    // para compatibilidade com o código do painel
    const groqText = data.choices?.[0]?.message?.content || '';
    const anthropicCompatible = {
      id:      data.id,
      type:    'message',
      role:    'assistant',
      model:   groqBody.model,
      content: [{ type: 'text', text: groqText }],
      usage:   {
        input_tokens:  data.usage?.prompt_tokens     || 0,
        output_tokens: data.usage?.completion_tokens || 0,
      },
      stop_reason: data.choices?.[0]?.finish_reason || 'end_turn',
    };

    return res.status(200).json(anthropicCompatible);

  } catch (err) {
    return res.status(500).json({
      error: { message: err.message || 'Erro interno no proxy' }
    });
  }
}
