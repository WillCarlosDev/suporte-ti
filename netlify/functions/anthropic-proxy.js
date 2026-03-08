exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: { message: 'GROQ_API_KEY não configurada nas variáveis de ambiente do Netlify.' } }),
      };
    }

    // Converte o modelo para um compatível com Groq
    const groqBody = {
      ...body,
      model: 'llama-3.3-70b-versatile',
    };

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: groqBody.model,
        max_tokens: groqBody.max_tokens || 1024,
        messages: [
          ...(groqBody.system ? [{ role: 'system', content: groqBody.system }] : []),
          ...groqBody.messages,
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: { message: data.error?.message || `HTTP ${response.status}` } }),
      };
    }

    // Converte resposta do Groq para o formato Anthropic que o frontend espera
    const anthropicFormat = {
      content: [{ type: 'text', text: data.choices?.[0]?.message?.content || '' }],
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(anthropicFormat),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: { message: err.message } }),
    };
  }
};
