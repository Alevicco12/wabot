require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Groq } = require('groq-sdk');
const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

console.log("--- DEBUG AVVIO ---");
console.log("GROQ_API_KEY presente?",!!process.env.GROQ_API_KEY);
console.log("Inizia con:", process.env.GROQ_API_KEY?.substring(0, 7));

if (!process.env.GROQ_API_KEY) {
    console.error("❌ ERRORE: GROQ_API_KEY MANCANTE SU RENDER! Vai su Environment e aggiungila.");
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

let qrCodeData = null;
let botAttivo = true;
let sock = null;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    sock = makeWASocket({ auth: state, logger: pino({ level: 'silent' }), browser: ["Bot Render", "Chrome", "1.0"] });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) { qrCodeData = qr; console.log(`[${new Date().toLocaleTimeString()}] Nuovo QR - /qr`); }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') { console.log(`✅ BOT CONNESSO!`); qrCodeData = null; }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
        const jid = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        if (!text) return;

        // Comandi tuoi
        if (msg.key.fromMe) {
            if (text.toLowerCase() === '!pausa') { botAttivo = false; await sock.sendMessage(jid, { text: '⏸️ Bot in pausa. Scrivi!attiva per riattivarmi.' }); return; }
            if (text.toLowerCase() === '!attiva') { botAttivo = true; await sock.sendMessage(jid, { text: '▶️ Bot riattivato!' }); return; }
            return;
        }

        console.log(`Messaggio da ${jid}: ${text} | Attivo: ${botAttivo}`);
        if (!botAttivo) return;

        try {
            await sock.sendPresenceUpdate('composing', jid);
            const completion = await groq.chat.completions.create({
                model: "openai/gpt-oss-20b",
                messages: [
                    { role: "system", content: "Sei un assistente utile su WhatsApp. Rispondi breve, cordiale, in italiano." },
                    { role: "user", content: text }
                ]
            });
            const risposta = completion.choices[0].message.content;
            await sock.sendMessage(jid, { text: risposta });
        } catch (e) {
            console.log(`❌ ERRORE GROQ VERO:`, e.status, e.message, JSON.stringify(e.error || {}));
            await sock.sendMessage(jid, { text: `Errore debug: ${e.message}` });
        }
    });
}

app.get('/', (req, res) => res.send(`Bot ${botAttivo? 'ATTIVO ✅' : 'IN PAUSA ⏸️'} | Key Groq: ${process.env.GROQ_API_KEY? 'OK ✅' : 'MANCANTE ❌'} - Vai su /qr`));
app.get('/qr', async (req, res) => {
    if (!qrCodeData) return res.send('<h1>Bot già connesso! ✅</h1>');
    const qrImage = await QRCode.toDataURL(qrCodeData);
    res.send(`<div style="text-align:center"><h1>QR</h1><img src="${qrImage}" style="width:350px"><p>!pausa e!attiva</p></div>`);
});
app.get('/debug', (req, res) => res.json({ groqKeyPresente:!!process.env.GROQ_API_KEY, inizioChiave: process.env.GROQ_API_KEY?.substring(0,10), botAttivo }));

app.listen(PORT, () => console.log(`Server su ${PORT}`));
startBot();
