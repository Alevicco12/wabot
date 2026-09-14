const express = require('express');
const app = express();
app.get('/', (req,res)=>res.send('Bot WhatsApp Online'));
app.listen(process.env.PORT || 3000, ()=>console.log('Server web finto attivo'));
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const qrcode = require('qrcode-terminal')
const Groq = require('groq-sdk')
require('dotenv').config()
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth')
    const sock = makeWASocket({ auth: state, browser: ["Mac OS", "Chrome", "14.4.1"] })
    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update
        if(qr){
            console.log("SCANSIONA QUESTO QR CON WHATSAPP:")
            qrcode.generate(qr, { small: true })
        }
        if(connection === 'close'){
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode!== DisconnectReason.loggedOut
            if(shouldReconnect) startBot()
        } else if(connection === 'open'){
            console.log('BOT CONNESSO!')
        }
    })
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0]
        if(!msg.message || msg.key.fromMe) return
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text
        if(!text) return
        const jid = msg.key.remoteJid
        try {
            await sock.sendPresenceUpdate('composing', jid)
            const completion = await groq.chat.completions.create({
                messages: [{ role: "system", content: "Sei un assistente utile su WhatsApp. Rispondi in italiano, breve." }, { role: "user", content: text }],
                model: "openai/gpt-oss-20b"
            })
            await sock.sendMessage(jid, { text: completion.choices[0].message.content })
        } catch(e){ 
            console.log("ERRORE GROQ:", e) 
            await sock.sendMessage(jid, { text: "Errore API: " + e.message })
        }
    })
}
startBot()
