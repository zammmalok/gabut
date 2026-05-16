const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs-extra');
const path = require('path');

let sock;
let currentSession = 'default';
let isActive = false;
let DELAY_MS = 1500;

const PREFIX = ".";
const OWNER_NUMBER = "628xxxxxxxxxx"; // GANTI DENGAN NOMOR KAMU (tanpa +)

async function connectWhatsApp(sessionName = 'default') {
    currentSession = sessionName;
    const sessionFolder = `./sessions/${sessionName}`;

    fs.ensureDirSync(sessionFolder);

    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['WA Warmer', 'Chrome', '6.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log(`\nQR muncul untuk session: ${sessionName}`);
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log(`✅ Session ${sessionName} Terhubung!`);
        }

        if (connection === 'close') {
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => connectWhatsApp(sessionName), 5000);
            }
        }
    });

    // Command Handler
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message) return;

        const from = m.key.remoteJid;
        const text = (m.message.conversation || m.message.extendedTextMessage?.text || '').trim();

        if (!text.startsWith(PREFIX)) return;

        const cmdText = text.slice(1).trim();
        const cmd = cmdText.split(' ')[0].toLowerCase();
        const args = cmdText.split(' ').slice(1).join(' ');

        // Hanya owner
        if (!from.includes(OWNER_NUMBER)) return;

        if (cmd === 'help') {
            await sock.sendMessage(from, { text: 
`🌡️ *WA WARMER MULTI JADIBOT*

.help
.active
.status
.delay <ms>
.send1 <nomor> <pesan>
.jadibot <nomor>   ← contoh: .jadibot 6281234567890
` });
        }

        if (cmd === 'active') {
            isActive = true;
            await sock.sendMessage(from, { text: '🔥 WARMER *ACTIVE*! Siap nembak tanpa batas.' });
        }

        if (cmd === 'status') {
            await sock.sendMessage(from, { text: `Session: ${currentSession}\nActive: ${isActive ? '🟢 YA' : '🔴 TIDAK'}\nDelay: ${DELAY_MS}ms` });
        }

        if (cmd === 'delay') {
            const newD = parseInt(args);
            if (!isNaN(newD)) {
                DELAY_MS = newD;
                await sock.sendMessage(from, { text: `⏱️ Delay diubah jadi ${DELAY_MS}ms` });
            }
        }

        // Kirim ke nomor
        if (cmd === 'send1') {
            if (!isActive) return await sock.sendMessage(from, { text: 'Ketik .active dulu bro!' });
            const parts = args.split(' ');
            const number = parts[0].replace(/[^0-9]/g, '');
            const pesan = parts.slice(1).join(' ') || 'Warming up 🔥';

            if (!number) return await sock.sendMessage(from, { text: 'Format salah: .send1 628xx pesan' });

            const target = number + '@s.whatsapp.net';
            await sendWithDelay(target, pesan, from);
        }

        // === JADIBOT PAIRING CODE ===
        if (cmd === 'jadibot') {
            let phoneNumber = args.replace(/[^0-9]/g, '');
            if (!phoneNumber.startsWith('62')) phoneNumber = '62' + phoneNumber;

            if (phoneNumber.length < 10) {
                return await sock.sendMessage(from, { text: '❌ Nomor tidak valid. Contoh: .jadibot 6281234567890' });
            }

            const sessionNew = `bot_${phoneNumber}`;
            await sock.sendMessage(from, { text: `🔄 Membuat bot baru untuk nomor: +${phoneNumber}\nMohon tunggu...` });

            // Buat session baru
            connectNewBot(phoneNumber, sessionNew, from);
        }
    });
}

async function connectNewBot(phoneNumber, sessionName, from) {
    const sessionFolder = `./sessions/${sessionName}`;
    fs.ensureDirSync(sessionFolder);

    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
    const { version } = await fetchLatestBaileysVersion();

    const newSock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['WA Warmer', 'Chrome', '6.0'],
    });

    newSock.ev.on('creds.update', saveCreds);

    newSock.ev.on('connection.update', async (update) => {
        const { connection, qr } = update;

        if (qr) {
            console.log(`QR untuk ${phoneNumber}`);
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'connecting' || connection === 'open') {
            try {
                if (!newSock.authState.creds.registered) {
                    const code = await newSock.requestPairingCode(phoneNumber);
                    const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;

                    console.log(`\n🔑 Pairing Code untuk ${phoneNumber}: ${formattedCode}`);

                    // Kirim code ke kamu
                    await sock.sendMessage(from, { 
                        text: `✅ *Pairing Code Berhasil Dibuat!*\n\n` +
                              `Nomor: +${phoneNumber}\n` +
                              `Session: ${sessionName}\n\n` +
                              `Kode: *${formattedCode}*\n\n` +
                              `Buka WhatsApp di nomor tersebut → Linked Devices → Link with Phone Number → Masukkan kode di atas.` 
                    });
                }
            } catch (e) {
                await sock.sendMessage(from, { text: `❌ Gagal request pairing code: ${e.message}` });
            }
        }

        if (connection === 'open') {
            await sock.sendMessage(from, { text: `🎉 Bot baru *${phoneNumber}* berhasil terhubung!` });
        }
    });

    // Biar tetap jalan
    setTimeout(() => {}, 60000); // keep process alive
}

async function sendWithDelay(jid, text, from) {
    try {
        await sock.sendMessage(jid, { text });
        await sock.sendMessage(from, { text: `✅ Terkirim ke ${jid.split('@')[0]}` });
        await new Promise(r => setTimeout(r, DELAY_MS));
    } catch (err) {
        await sock.sendMessage(from, { text: `❌ Gagal kirim ke ${jid.split('@')[0]}` });
    }
}

// ============= START =============
console.log(`
╔══════════════════════════════════════╗
║     WA WARMER + JADIBOT PAIRING      ║
║          .jadibot 628xx              ║
╚══════════════════════════════════════╝
`);

connectWhatsApp('default');
