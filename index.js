import express from "express";
import dotenv from "dotenv";
import session from "express-session";
import admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, doc, setDoc, getDoc } from "firebase-admin/firestore";
import { v4 as uuidv4 } from "uuid";
import bodyParser from "body-parser";
import { Client, GatewayIntentBits } from "discord.js";
import fetch from "node-fetch";
import cookieParser from "cookie-parser";
import { URLSearchParams } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "keyboard cat",
    resave: false,
    saveUninitialized: true,
  })
);

// Firebase initialization
const firebaseConfig = {
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_ADMIN_SDK)),
};
admin.initializeApp(firebaseConfig);
const db = getFirestore();
app.get("/login", (req, res) => {
  const state = uuidv4();
  req.session.state = state;

  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify guilds",
    state,
  });

  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

app.get("/callback", async (req, res) => {
  const { code, state } = req.query;

  if (state !== req.session.state) {
    return res.status(403).send("Invalid state");
  }

  const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI,
      scope: "identify guilds",
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const tokenData = await tokenResponse.json();
  const userResponse = await fetch("https://discord.com/api/users/@me", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  });

  const userData = await userResponse.json();
  req.session.user = userData;
  res.redirect("/dashboard");
});
const getGuildConfig = async (guildId) => {
  if (!client.db || !client.appId) {
    console.error("Firestore not initialized yet when getGuildConfig was called.");
    return null;
  }

  const configRef = doc(client.db, `artifacts/${client.appId}/public/data/guilds/${guildId}/configs`, "settings");
  const configSnap = await getDoc(configRef);

  if (configSnap.exists()) {
    return configSnap.data();
  } else {
    const defaultConfig = {
      modRoleId: null,
      adminRoleId: null,
      moderationLogChannelId: null,
      messageLogChannelId: null,
      modAlertChannelId: null,
      modPingRoleId: null,
      memberLogChannelId: null,
      adminLogChannelId: null,
      joinLeaveLogChannelId: null,
      boostLogChannelId: null,
      countingChannelId: null,
      currentCount: 0,
      lastCountMessageId: null,
      caseNumber: 0,
    };
    await setDoc(configRef, defaultConfig);
    return defaultConfig;
  }
};

const saveGuildConfig = async (guildId, newConfig) => {
  if (!client.db || !client.appId) {
    console.error("Firestore not initialized yet when saveGuildConfig was called.");
    return;
  }

  const configRef = doc(client.db, `artifacts/${client.appId}/public/data/guilds/${guildId}/configs`, "settings");
  await setDoc(configRef, newConfig, { merge: true });
};
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.db = db;
client.appId = process.env.FIREBASE_APP_ID;

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.content === "!ping") {
    return message.reply("Pong!");
  }

  if (message.content === "!count") {
    const config = await getGuildConfig(message.guild.id);
    return message.reply(`Current count: ${config.currentCount}`);
  }
});
client.login(process.env.DISCORD_BOT_TOKEN);

app.get("/dashboard", async (req, res) => {
  if (!req.session.user) {
    return res.redirect("/login");
  }

  res.send(`<h1>Welcome, ${req.session.user.username}</h1>`);
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
