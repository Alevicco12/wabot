const express = require('express');
const QRCode = require('qrcode');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const Groq = require('groq-sdk');
require('dotenv').config();
const pino = require('pino');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const app = express();
let ultimoQR = null;
let statoBot = "Avvio in corso...";

app.get('/', (req,res)=> res.send(`Bot: ${statoBot} - Vai su /qr per il QR`));
app.get('/qr', async (req,res)=>{
  if(!ultimoQR) return res.send(`<h1>${statoBot}</h1><p>Aspetto QR... ricarico</p><script>setTimeout(()=>location.reload(),3000)</script>`);
  const img = await QRCode.toDataURL(ultimoQR);
  res.send(`<h1>SCANNERIZZA QUESTO QR CON WHATSAPP</h1><img src="${img}" style="width:350px"><p>Si aggiorna ogni 10 sec</p><script>setTimeout(()=>location.reload(),10000)</script>`);
});
app.listen(process.env.PORT || 3000, ()=>console.log('Server web per Render attivo'));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth');
    const sock = makeWASocket({
        auth: state,
        logger: pino({level: "silent"}),
        browser: ["Mac OS", "Chrome", "14.4.1"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if(qr){
            ultimoQR = qr;
            statoBot = "QR Pronto! Vai su /qr";
            console.log("Nuovo QR generato - vai su /qr");
        }
        if(connection === 'close'){
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode!== DisconnectReason.loggedOut;
            statoBot = "Disconnesso, riconnessione...";
            console.log("Connessione chiusa, riconnessione:", shouldReconnect);
            if(shouldReconnect) startBot();
        } else if(connection === 'open'){
            statoBot = "BOT CONNESSO! ONLINE";
            ultimoQR = null;
            console.log('BOT CONNESSO!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if(!msg.message || msg.key.fromMe) return;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if(!text) return;
        const jid = msg.key.remoteJid;
        try {
            await sock.sendPresenceUpdate('composing', jid);
            const completion = await groq.chat.completions.create({
                messages: [{ role: "system", content: "Sei un assistente utile su WhatsApp. Rispondi in italiano, breve." }, { role: "user", content: text }],
                model: "openai/gpt-oss-20b"
            });
            await sock.sendMessage(jid, { text: completion.choices[0].message.content });
        } catch(e){
            console.log("ERRORE GROQ:", e);
            await sock.sendMessage(jid, { text: "Errore API: " + e.message });
        }
    });
}
startBot();
