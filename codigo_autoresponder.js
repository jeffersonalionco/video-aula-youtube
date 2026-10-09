const http = require("http");
const { gerarResposta } = require("./ia_qwen3");

const dotenv = require("dotenv");
dotenv.config();

// Adicione este arquivo ao seu servidor e informe a URL completa no AutoResponder
// (ex.: https://www.example.com/codigo_autoresponder.js ou http://SEU_IP:3000)
//
// Para aceitar somente requisições autorizadas, configure autenticação Basic Auth
// no seu servidor e use a opção Basic Auth no AutoResponder.

const PORT = process.env.PORT;

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=UTF-8",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "3600",
    "Access-Control-Allow-Headers":
      "Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With",
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, {
      replies: [{ message: "Method not allowed. Use POST." }],
    });
    return;
  }

  // Cabeçalho personalizado adicionado na regra do AutoResponder.
  // Troque xxxxxx-xxxx pelo nome do cabeçalho (Node.js já entrega em minúsculas).
  const myheader = req.headers["xxxxxx-xxxx"];

  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });

  req.on("end", async () => {
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (err) {
      sendJson(res, 400, {
        replies: [
          { message: "Error ❌" },
          { message: "JSON inválido. A requisição foi enviada pelo AutoResponder?" },
        ],
      });
      return;
    }

    const query = data.query || {};

    if (
      !query ||
      !data.appPackageName ||
      !data.messengerPackageName ||
      !query.sender ||
      !query.message
    ) {
      sendJson(res, 400, {
        replies: [
          { message: "Error ❌" },
          {
            message:
              "JSON data is incomplete. Was the request sent by AutoResponder?",
          },
        ],
      });
      return;
    }

    // Nome do pacote do AutoResponder (de qual app veio a mensagem)
    const appPackageName = data.appPackageName;
    // Nome do pacote do mensageiro (WhatsApp, Telegram, etc.)
    const messengerPackageName = data.messengerPackageName;
    // Nome/número de quem enviou (como aparece na notificação do Android)
    const sender = query.sender;
    // Texto da mensagem recebida
    const message = query.message;
    // O remetente é um grupo? true ou false
    const isGroup = query.isGroup;
    // Nome/número do participante do grupo, ou vazio se não for grupo
    const groupParticipant = query.groupParticipant;
    // ID da regra do AutoResponder que disparou a requisição
    const ruleId = query.ruleId;
    // É uma mensagem de teste do AutoResponder? true ou false
    const isTestMessage = query.isTestMessage;

    // appPackageName, ruleId e myheader ficam disponíveis para regras futuras.
    void appPackageName;
    void ruleId;
    void myheader;

    try {
      const resposta = await gerarResposta({
        messengerPackageName,
        sender,
        message,
        isGroup,
        groupParticipant,
        isTestMessage,
      });

      if (!resposta) {
        sendJson(res, 200, { replies: [] });
        return;
      }

      sendJson(res, 200, {
        replies: [{ message: resposta }],
      });
    } catch (err) {
      console.error("Falha ao gerar resposta:", err.message);
      sendJson(res, 200, {
        replies: [
          {
            message:
              "Não consegui responder agora. Tente de novo em instantes.",
          },
        ],
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`AutoResponder ouvindo em http://localhost:${PORT}`);
});
