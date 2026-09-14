require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Groq } = require('groq-sdk');
const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

let qrCodeData = null;
let botAttivo = true; // <-- INTERRUTTORE
let sock = null;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ["Bot Render", "Chrome", "1.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCodeData = qr;
            console.log(`[${new Date().toLocaleTimeString()}] Nuovo QR generato - vai su /qr`);
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`Connessione chiusa. Riconnetto: ${shouldReconnect}`);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log(`✅ BOT CONNESSO! Attivo: ${botAttivo}`);
            qrCodeData = null;
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const jid = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        if (!text) return;

        const nome = jid.split('@')[0];
        
        // --- COMANDI SOLO TU (messaggi inviati da te) ---
        if (msg.key.fromMe) {
            if (text.toLowerCase() === '!pausa') {
                botAttivo = false;
                console.log(`⏸️ BOT MESSO IN PAUSA da te`);
                await sock.sendMessage(jid, { text: '⏸️ Bot in pausa. Ora puoi parlare tu. Scrivi !attiva per riattivarmi.' });
                return;
            }
            if (text.toLowerCase() === '!attiva') {
                botAttivo = true;
                console.log(`▶️ BOT RIATTIVATO da te`);
                await sock.sendMessage(jid, { text: '▶️ Bot riattivato! Rispondo io di nuovo.' });
                return;
            }
            return; // Se scrivi tu altro, il bot non risponde mai (evita doppie risposte)
        }

        // --- LOG ---
        console.log(`[${new Date().toLocaleTimeString()}] Messaggio da ${nome}: ${text} | Bot attivo: ${botAttivo}`);

        if (!botAttivo) {
            console.log(` -> Ignorato perché in PAUSA`);
            return;
        }

        // --- RISPOSTA GROQ ---
        try {
            await sock.sendPresenceUpdate('composing', jid);
            const completion = await groq.chat.completions.create({
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: "Sei un assistente utile su WhatsApp. Rispondi breve, cordiale, in italiano." },
                    { role: "user", content: text }
                ]
            });
            const risposta = completion.choices[0].message.content;
            await sock.sendMessage(jid, { text: risposta });
            console.log(` -> Risposto a ${nome}`);
        } catch (e) {
            console.log(`ERRORE Groq/Baileys:`, e.message);
            await sock.sendMessage(jid, { text: "Al momento ho un piccolo problema, riprova tra un attimo 🙏" });
        }
    });
}

// --- WEB SERVER PER RENDER E QR ---
app.get('/', (req, res) => res.send(`Bot ${botAttivo ? 'ATTIVO ✅' : 'IN PAUSA ⏸️'} - Vai su /qr per collegarlo`));

app.get('/qr', async (req, res) => {
    if (!qrCodeData) return res.send('<h1>Bot già connesso! ✅</h1><p>Se vuoi ricollegarlo, vai su WhatsApp > Dispositivi collegati > Disconnetti e riavvia il servizio su Render.</p>');
    const qrImage = await QRCode.toDataURL(qrCodeData);
    res.send(`<div style="text-align:center; margin-top:20px;"><h1>Scannerizza questo QR</h1><img src="${qrImage}" style="width:350px;"><p>WhatsApp > Dispositivi collegati > Collega dispositivo</p><p>Comandi: <b>!pausa</b> e <b>!attiva</b> (scrivili tu in chat)</p></div>`);
});

app.listen(PORT, () => console.log(`Server web attivo su porta ${PORT}`));

// Anti-sleep log
setInterval(() => console.log(`[KeepAlive] Bot ${botAttivo ? 'attivo' : 'in pausa'} - ${new Date().toLocaleTimeString()}`), 1000 * 60 * 5);

startBot();
