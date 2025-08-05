require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { WebSocketServer } = require("ws");
const twilio = require("twilio");
const mediaHandler = require("./mediaHandler");

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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
  const grant = new VoiceGrant({
    outgoingApplicationSid: process.env.TWIML_APP_SID,
    incomingAllow: true,
  });
  token.addGrant(grant);
  res.json({ token: token.toJwt() });
});

app.post("/twiml/stream", (req, res) => {
  console.log("📨 Incoming webhook /twiml/stream");
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const vr = new VoiceResponse();
  vr.say("Connected to AI. You can start speaking now.");
  vr.connect().stream({ url: `wss://${req.headers.host}/media` });
  vr.say("Goodbye.");
  res.type("text/xml").send(vr.toString());
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/media") {
    console.log(`🔀 WS upgrade request for ${req.url}`);
    wss.handleUpgrade(req, socket, head, (ws) => {
      console.log("✅ Media WebSocket connected");
      mediaHandler(ws);
    });
  } else {
    socket.destroy();
  }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Listening on port ${PORT}`));
