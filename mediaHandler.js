require("dotenv").config();
const WebSocket = require("ws");
const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");

const API_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID;

if (!API_KEY || !AGENT_ID) {
  console.error(" Missing KEY");
  process.exit(1);
}

const client = new ElevenLabsClient({ apiKey: API_KEY });

module.exports = function mediaHandler(ws) {
  console.log("Starting Twilio media stream ");

  let session;

  const startAgentSession = async () => {
    try {
      const agent = await client.conversationalAi.agents.create({
        conversationConfig: {},
      });
      session = await agent.startSession({
        agentId: AGENT_ID,
        voiceId: VOICE_ID,
        model: "eleven_multilingual_v2",
        voiceTemperature: 0.5,
        enablePunctuation: true,
        onStart: () => console.log("ElevenLabs session started"),
        onText: (text) => console.log(" Final transcript:", text),
        onToken: (tok) => console.log(" Partial token:", tok),
        onAudio: (chunk) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                event: "media",
                media: { payload: chunk.toString("base64") },
              })
            );
          }
        },
        onError: (err) => {
          console.error(" ElevenLabs error:", err);
          ws.close();
        },
        onEnd: () => console.log(" ElevenLabs stream ended"),
      });
    } catch (err) {
      console.error(" Failed to start agent session:", err);
      ws.close();
    }
  };

  ws.on("message", async (data) => {
    const msg = JSON.parse(data);

    switch (msg.event) {
      case "start":
        console.log(" Twilio 'start' event received");
        await startAgentSession();
        break;

      case "media":
        if (!session) {
          console.warn(" Received media before session start");
          break;
        }
        const audioPayload = Buffer.from(msg.media.payload, "base64");
        await session.sendAudio(audioPayload);
        break;

      case "stop":
        console.log(" Twilio 'stop' event received");
        if (session) {
          await session.end();
        }
        ws.close();
        break;

      default:
        console.warn(" Unknown Twilio event:", msg.event);
    }
  });

  ws.on("close", () => {
    console.log(" Twilio media socket closed");
    if (session) session.end();
  });

  ws.on("error", (err) => {
    console.error(" WebSocket error:", err);
    if (session) session.end();
  });
};
