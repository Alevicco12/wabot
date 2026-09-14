const express = require('express');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
let ultimoQR = null;

app.get('/', (req,res)=> res.send('Bot attivo. Vai su /qr per vedere il QR'));
app.get('/qr', async (req,res)=>{
  if(!ultimoQR) return res.send('In attesa di QR... ricarica tra 5 sec <script>setTimeout(()=>location.reload(),3000)</script>');
  const qrImg = await qrcode.toDataURL(ultimoQR);
  res.send(`<h1>Scannerizza questo QR</h1><img src="${qrImg}" style="width:300px"><script>setTimeout(()=>location.reload(),10000)</script>`);
});
app.listen(process.env.PORT || 3000, ()=>console.log('Server web attivo'));

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] }
});

client.on('qr', qr => {
    ultimoQR = qr;
    console.log('QR AGGIORNATO - Vai su /qr');
});
client.on('ready', ()=> console.log('Client is ready! BOT ONLINE'));
client.initialize();

// Qui sotto lascia la tua parte di IA Groq che avevi già
