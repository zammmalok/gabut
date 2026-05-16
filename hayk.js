const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs-extra');
const readline = require('readline-sync');

let sock;
let isActive = false;
let DELAY_MS = 1500;
const PREFIX = ".";

// ================== CONFIG ==================
let OWNER_NUMBER = "22670204049"; // GANTI NOMOR KAMU
// ===========================================

async function startBot() {
    console.log("🚀 WA Warmer - Pairing Code Mode");

    // Tanya nomor pertama kali kalau belum ada session
    const sessionFolder = `./sessions/default`;
    fs.ensureDirSync(sessionFolder);

    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,        // Matikan QR
        browser: ['WA Warmer', 'Chrome', '6.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log('✅ Bot berhasil terhubung dengan Pairing Code!');
            await sock.sendMessage(OWNER_NUMBER + '@s.whatsapp.net', { text: '🔥 *WA Warmer Pairing Code Active!*' });
        }

        if (connection === 'close') {
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                console.log('Reconnecting...');
                setTimeout(startBot, 5000);
            }
        }
    });

    // Request Pairing Code otomatis kalau belum login
    sock.ev.on('connection.update', async (update) => {
        if (!sock.authState?.creds?.registered && (update.connection === 'connecting' || update.qr)) {
            try {
                console.log("⏳ Meminta Pairing Code...");
                const code = await sock.requestPairingCode(OWNER_NUMBER.replace(/[^0-9]/g, ''));
                const formatted = code?.match(/.{1,4}/g)?.join('-') || code;

                console.log(`\n🔑 PAIRING CODE: ${formatted}`);
                console.log(`\nMasukkan kode ini di WhatsApp nomor ${OWNER_NUMBER} → Linked Devices → Link with Phone Number`);

                // Kirim juga ke nomor owner
                await sock.sendMessage(OWNER_NUMBER + '@s.whatsapp.net', {
                    text: `✅ *Pairing Code*\n\nKode: *${formatted}*\n\nMasukkan di Linked Devices.`
                });
            } catch (e) {
                console.log("Gagal request pairing code:", e.message);
            }
        }
    });

    // ================= COMMAND =================
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message) return;

        const from = m.key.remoteJid;
        const text = (m.message.conversation || m.message.extendedTextMessage?.text || '').trim();

        if (!text.startsWith(PREFIX)) return;
        if (!from.includes(OWNER_NUMBER)) return;

        const cmdText = text.slice(1).trim();
        const cmd = cmdText.split(' ')[0].toLowerCase();
        const args = cmdText.split(' ').slice(1).join(' ');

        if (cmd === 'help') {
            await sock.sendMessage(from, { text: `🌡️ *WA WARMER - PAIRING CODE*\n\n.active\n.status\n.delay <ms>\n.send1 <628xx> <pesan>\n.jadibot <628xx>` });
        }

        if (cmd === 'active') {
            isActive = true;
            await sock.sendMessage(from, { text: '🔥 WARMER *ACTIVE* - Jalankan tanpa batas!' });
        }

        if (cmd === 'status') {
            await sock.sendMessage(from, { text: `Status: ${isActive ? '🟢 ACTIVE' : '🔴 OFF'}\nDelay: ${DELAY_MS}ms` });
        }

        if (cmd === 'delay') {
            const nd = parseInt(args);
            if (!isNaN(nd)) {
                DELAY_MS = nd;
                await sock.sendMessage(from, { text: `⏱️ Delay diubah jadi ${DELAY_MS}ms` });
            }
        }

        if (cmd === 'send1') {
            if (!isActive) return await sock.sendMessage(from, { text: 'Ketik .active dulu!' });
            const parts = args.split(' ');
            const number = parts[0].replace(/[^0-9]/g, '');
            const pesan = parts.slice(1).join(' ') || 'Warming up 🔥';
            const target = number + '@s.whatsapp.net';
            await sendWithDelay(target, pesan, from);
        }

        if (cmd === 'jadibot') {
            let num = args.replace(/[^0-9]/g, '');
            if (!num.startsWith('62')) num = '62' + num;
            if (num.length < 10) return await sock.sendMessage(from, { text: '❌ Nomor salah!' });

            await sock.sendMessage(from, { text: `🔄 Membuat bot baru untuk +${num}...` });
            createNewBot(num, from);
        }
    });
}

async function sendWithDelay(jid, text, from) {
    try {
        await sock.sendMessage(jid, { text });
        await sock.sendMessage(from, { text: `✅ Terkirim ke ${jid.split('@')[0]}` });
        await new Promise(r => setTimeout(r, DELAY_MS));
    } catch (e) {
        console.error(e);
    }
}

async function createNewBot(phoneNumber, from) {
    // Bisa dikembangkan nanti untuk multi session full
    await sock.sendMessage(from, { text: `Fitur .jadibot multi session masih dalam pengembangan.\nSekarang pakai pairing code utama dulu.` });
}

// ================= START =================
console.log(`
╔════════════════════════════════╗
║   WA WARMER - PAIRING CODE     ║
║         NO QR CODE LAGI        ║
╚════════════════════════════════╝
`);

startBot().catch(console.error);
