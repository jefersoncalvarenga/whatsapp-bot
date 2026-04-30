const express = require('express');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ─── Configurações ───────────────────────────────────────────
const ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN    = process.env.TWILIO_AUTH_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const TWILIO_NUMBER = 'whatsapp:+14155238886';
const MEU_NUMERO    = 'whatsapp:+5512997001840'; // Seu número

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

// ─── Fila de aprovações pendentes ────────────────────────────
// { id: { from, message, draft, timestamp } }
const pendentes = {};

// ─── System prompt do Claude ─────────────────────────────────
const SYSTEM_PROMPT = `Você é o assistente do Pastor Jeferson Alvarenga da Igreja Presbiteriana Aquarius (IPAquarius) em São José dos Campos, SP.

Sua função é redigir rascunhos de resposta para mensagens recebidas via WhatsApp, de forma:
- Cordial e acolhedora
- Objetiva e clara
- Com tom pastoral quando apropriado
- Em português brasileiro

IMPORTANTE:
- Nunca tome decisões pastorais sensíveis por conta própria
- Para assuntos de aconselhamento profundo, sugira agendar conversa com o pastor
- Para assuntos administrativos da igreja, oriente a contactar a secretaria
- Mantenha respostas concisas (máximo 3 parágrafos)`;

// ─── Webhook principal ────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const from = req.body.From;  // ex: whatsapp:+5511999999999
  const body = req.body.Body?.trim();

  if (!from || !body) {
    return res.send('<Response></Response>');
  }

  try {
    // ── É Jeferson respondendo uma aprovação? ──
    if (from === MEU_NUMERO) {
      const ids = Object.keys(pendentes);

      if (ids.length === 0) {
        // Sem pendências — Jeferson está iniciando conversa normal
        return res.send('<Response></Response>');
      }

      // Pega o mais antigo pendente
      const id = ids[0];
      const pendente = pendentes[id];

      let textoFinal;
      if (body.toLowerCase() === 'ok') {
        textoFinal = pendente.draft;
      } else if (body.toLowerCase().startsWith('ignorar')) {
        // Jeferson quer ignorar essa mensagem
        delete pendentes[id];
        await client.messages.create({
          from: TWILIO_NUMBER,
          to: MEU_NUMERO,
          body: `✅ Mensagem de ${pendente.from.replace('whatsapp:', '')} ignorada.`
        });
        return res.send('<Response></Response>');
      } else {
        // Jeferson escreveu sua própria resposta
        textoFinal = body;
      }

      // Envia para o remetente original
      await client.messages.create({
        from: TWILIO_NUMBER,
        to: pendente.from,
        body: textoFinal
      });

      delete pendentes[id];

      // Confirma para Jeferson
      const restantes = Object.keys(pendentes).length;
      let confirmacao = `✅ Resposta enviada para ${pendente.from.replace('whatsapp:', '')}.`;
      if (restantes > 0) {
        const proximo = pendentes[Object.keys(pendentes)[0]];
        confirmacao += `\n\n📬 Próxima mensagem pendente:\n\n📩 *De:* ${proximo.from.replace('whatsapp:', '')}\n\n*Mensagem:*\n${proximo.message}\n\n💬 *Sugestão:*\n${proximo.draft}\n\n✅ Responda *ok*, envie sua versão ou *ignorar*.`;
      } else {
        confirmacao += '\n\n📭 Nenhuma mensagem pendente.';
      }

      await client.messages.create({
        from: TWILIO_NUMBER,
        to: MEU_NUMERO,
        body: confirmacao
      });

      return res.send('<Response></Response>');
    }

    // ── Mensagem de outro usuário — gera rascunho com Claude ──
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: body }]
      })
    });

    const claudeData = await claudeRes.json();
    const draft = claudeData.content?.[0]?.text || 'Não foi possível gerar rascunho.';

    // Armazena pendência
    const id = Date.now().toString();
    pendentes[id] = { from, message: body, draft, timestamp: new Date() };

    // Notifica Jeferson
    await client.messages.create({
      from: TWILIO_NUMBER,
      to: MEU_NUMERO,
      body: `📩 *De:* ${from.replace('whatsapp:', '')}\n\n*Mensagem:*\n${body}\n\n💬 *Sugestão de resposta:*\n${draft}\n\n─────────────────\n✅ *ok* → envia a sugestão\n✏️ Escreva outra coisa → envia seu texto\n🚫 *ignorar* → descarta`
    });

    // Resposta vazia para o remetente (Jeferson vai responder depois)
    res.send('<Response></Response>');

  } catch (err) {
    console.error('Erro:', err);
    res.send('<Response></Response>');
  }
});

// ─── Health check ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    pendentes: Object.keys(pendentes).length
  });
});

// ─── Inicia servidor ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Bot WhatsApp rodando na porta ${PORT}`);
});
