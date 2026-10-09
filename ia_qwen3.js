const fs = require("fs");
const path = require("path");

// Modelo local via Ollama. Troque com a variável de ambiente OLLAMA_MODEL
// se a tag puxada for outra (ex.: qwen3:8b).
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:1.7b";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 60000);

// Janela enviada ao modelo: últimas 10 mensagens do contato
// (as que ele mandou e as respostas da IA, nessa ordem).
const HISTORICO_MAX = 10;
const HISTORICO_PATH = path.join(__dirname, "historico_contatos.json");

const WHATSAPP_PACKAGES = new Set(["com.whatsapp", "com.whatsapp.w4b"]);

const SYSTEM_PROMPT = `Você conversa pelo WhatsApp em português do Brasil.
Responda de forma curta, natural e direta, como uma mensagem de chat.
Não use markdown, listas longas nem blocos de código, a menos que a pessoa peça.
Use somente o histórico recente deste contato para manter o contexto.
Se não souber algo, diga isso com clareza em vez de inventar.`;

/** @type {Map<string, {role: "user" | "assistant", content: string}[]>} */
const historico = new Map();

/** @type {Map<string, Promise<unknown>>} */
const filas = new Map();

let gravacao = Promise.resolve();

function carregarHistorico() {
  if (!fs.existsSync(HISTORICO_PATH)) return;

  const bruto = fs.readFileSync(HISTORICO_PATH, "utf8");
  if (!bruto.trim()) return;

  const dados = JSON.parse(bruto);
  for (const [contato, mensagens] of Object.entries(dados)) {
    if (!Array.isArray(mensagens)) continue;
    historico.set(
      contato,
      mensagens
        .filter(
          (item) =>
            item &&
            (item.role === "user" || item.role === "assistant") &&
            typeof item.content === "string"
        )
        .slice(-HISTORICO_MAX)
    );
  }
}

function salvarHistorico() {
  gravacao = gravacao
    .then(() => {
      const snapshot = JSON.stringify(Object.fromEntries(historico), null, 2);
      return fs.promises.writeFile(HISTORICO_PATH, snapshot, "utf8");
    })
    .catch((err) => {
      console.error("Falha ao salvar histórico:", err.message);
    });
}

function chaveContato({ sender, isGroup, groupParticipant }) {
  if (isGroup && groupParticipant) {
    return `${sender}::${groupParticipant}`;
  }
  return String(sender);
}

function limitar(mensagens) {
  while (mensagens.length > HISTORICO_MAX) {
    mensagens.shift();
  }
  return mensagens;
}

function adicionarMensagem(chave, role, content) {
  const mensagens = historico.get(chave) || [];
  mensagens.push({ role, content });
  historico.set(chave, limitar(mensagens));
  salvarHistorico();
}

function enfileirar(chave, tarefa) {
  const anterior = filas.get(chave) || Promise.resolve();
  const atual = anterior.then(tarefa, tarefa);
  filas.set(
    chave,
    atual.catch(() => {})
  );
  return atual;
}

function limparResposta(texto) {
  return String(texto || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim()
    .slice(0, 4000);
}

async function chamarOllama(mensagens, instrucao) {
  const resposta = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      think: false,
      messages: [{ role: "system", content: instrucao }, ...mensagens],
    }),
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
  });

  if (!resposta.ok) {
    const detalhe = await resposta.text();
    throw new Error(`Ollama respondeu ${resposta.status}: ${detalhe}`);
  }

  const json = await resposta.json();
  const texto = limparResposta(json.message && json.message.content);
  if (!texto) {
    throw new Error("Ollama devolveu uma resposta vazia.");
  }
  return texto;
}

function instrucaoDoContato({ sender, isGroup, groupParticipant }) {
  if (isGroup) {
    const quem = groupParticipant || "um participante";
    return `${SYSTEM_PROMPT}\nVocê está no grupo "${sender}". Quem enviou esta mensagem é ${quem}.`;
  }
  return `${SYSTEM_PROMPT}\nVocê está conversando no privado com "${sender}".`;
}

/**
 * Recebe uma mensagem já validada pelo AutoResponder e devolve o texto
 * que deve ser enviado de volta ao WhatsApp.
 * Retorna null quando a mensagem não veio do WhatsApp.
 */
async function gerarResposta(dados) {
  const {
    messengerPackageName,
    sender,
    message,
    isGroup,
    groupParticipant,
    isTestMessage,
  } = dados;

  if (!WHATSAPP_PACKAGES.has(messengerPackageName)) {
    return null;
  }

  const chave = chaveContato({ sender, isGroup, groupParticipant });
  const texto = String(message).trim();
  if (!texto) return null;

  return enfileirar(chave, async () => {
    adicionarMensagem(chave, "user", texto);
    const mensagens = historico.get(chave).map((item) => ({ ...item }));

    console.log(
      `[${isTestMessage ? "teste" : "whatsapp"}] ${chave}: ${texto.slice(0, 80)}`
    );

    const resposta = await chamarOllama(
      mensagens,
      instrucaoDoContato({ sender, isGroup, groupParticipant })
    );

    adicionarMensagem(chave, "assistant", resposta);
    return resposta;
  });
}

carregarHistorico();

module.exports = {
  gerarResposta,
  HISTORICO_MAX,
  OLLAMA_MODEL,
};
