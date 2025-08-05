require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const WebSocket = require("ws");
const twilio = require("twilio");

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 4000;

const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

app.get("/token", (req, res) => {
  const identity = req.query.identity || `user_${Date.now()}`;
  console.log(`🎫 Generating token for identity: ${identity}`);

  const token = new AccessToken(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_API_KEY,
    process.env.TWILIO_API_SECRET,
    { identity }
  );

  token.addGrant(
    new VoiceGrant({
      outgoingApplicationSid: process.env.TWIML_APP_SID,
      incomingAllow: true,
    })
  );

  res.json({ token: token.toJwt(), identity });
});

app.post("/twiml", (req, res) => {
  res.type("text/xml");
  res.send(`
    <Response>
      <Connect>
        <Stream url="wss://${req.headers.host}/media-stream" />
      </Connect>
    </Response>
  `);
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

const getSignedUrl = async () => {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${process.env.ELEVENLABS_AGENT_ID}`,
    {
      method: "GET",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
      },
    }
  );

  const data = await response.json();
  return data.signed_url;
};

wss.on("connection", async (twilioWs, req) => {
  console.log("[Twilio] Client connected to /media-stream");

  let streamSid = null;
  let elevenLabsWs = null;

  try {
    const signedUrl = await getSignedUrl();
    elevenLabsWs = new WebSocket(signedUrl);

    elevenLabsWs.on("open", () => {
      console.log("[ElevenLabs] Connected");

      const initMessage = {
        type: "conversation_initiation_client_data",
        conversation_config_override: {
          agent: {
            prompt: {
              prompt:
                "You're Gary, a friendly AI assistant for a phone company. Be helpful and empathetic.",
            },
          },
        },
      };

      elevenLabsWs.send(JSON.stringify(initMessage));
      console.log("[ElevenLabs] Sent initial prompt & message");
    });

    elevenLabsWs.on("message", (data) => {
      const msg = JSON.parse(data);
      console.log("ElevenLabs WS Message:", msg);
      if (msg.type === "audio" && msg.audio_event?.audio_base_64) {
        const toTwilio = {
          event: "media",
          streamSid,
          media: { payload: msg.audio_event.audio_base_64 },
        };
        twilioWs.send(JSON.stringify(toTwilio));
      }
    });

    twilioWs.on("message", (message) => {
      // console.log("Twilio WS Message:", message);
      const msg = JSON.parse(message);
      if (msg.event === "start") {
        streamSid = msg.start.streamSid;
        console.log(`[Twilio] Started stream: ${streamSid}`);
      } else if (
        msg.event === "media" &&
        elevenLabsWs?.readyState === WebSocket.OPEN
      ) {
        console.log("in here........");
        elevenLabsWs.send(
          JSON.stringify({
            user_audio_chunk: Buffer.from(msg.media.payload, "base64").toString(
              "base64"
            ),
          })
        );
        console.log("[Twilio] Received media");
      } else if (msg.event === "stop") {
        console.log("[Twilio] Call ended");
        elevenLabsWs?.close();
      }
    });

    twilioWs.on("close", () => {
      console.log("[Twilio] WebSocket closed");
      elevenLabsWs?.close();
    });
  } catch (err) {
    console.error("[ERROR]", err);
    if (elevenLabsWs) elevenLabsWs.close();
    twilioWs.close();
  }
});

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/media-stream") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
