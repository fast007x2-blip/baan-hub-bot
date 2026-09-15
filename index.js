// Baan Hub Discord Bot - 24/7 Member Counter, Welcome System & Honeypot Ban Logs
const http = require('http');

const TOKEN = process.env.BAAN_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID || "1541653103982419988";
const HONEY_CHANNEL_ID = process.env.HONEY_CHANNEL_ID || "1544393321420558489";
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || "1544393317179981854";
const BAN_LOGS_CHANNEL_ID = process.env.BAN_LOGS_CHANNEL_ID || "1549553360099737712";
const NEW_GAME_CHANNEL_ID = process.env.NEW_GAME_CHANNEL_ID || "1545031053742448700";
const ONLINE_ID = process.env.ONLINE_CHANNEL_ID || "1544396402958925937";
const HUMANS_ID = process.env.HUMANS_CHANNEL_ID || "1544396405257412659";
const PORT = process.env.PORT || 3000;

if (!TOKEN) {
    console.error("[FATAL] Missing BAAN_BOT_TOKEN environment variable!");
    process.exit(1);
}

let botUserId = null;
let heartbeatTimer = null;
let lastSequence = null;
let ws = null;
let lastUpdate = 0;
let lastMemberCount = 0;

function fmt(n) {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 1 : 2).replace(/\.0+$/, '') + 'K';
    return String(n);
}

// 1. Health-Check Web Server (keeps free cloud hosting awake)
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'online',
        botConnected: botUserId !== null,
        lastUpdate: lastUpdate ? new Date(lastUpdate).toISOString() : 'pending',
        timestamp: new Date().toISOString()
    }));
});

server.listen(PORT, () => {
    console.log(`[HTTP] Cloud Health Server running on port ${PORT}`);
});

// 2. Member Counter Loop (Safe from Discord Rate Limits: 2 renames per 10 mins)
async function updateMemberCounts() {
    try {
        const gRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}?with_counts=true`, {
            headers: { Authorization: `Bot ${TOKEN}` }
        });
        if (!gRes.ok) {
            console.log("[Counter] Guild fetch failed:", gRes.status);
            return;
        }
        const g = await gRes.json();
        const online = g.approximate_presence_count ?? g.approximate_member_count ?? 0;
        const humans = g.approximate_member_count ?? 0;
        lastMemberCount = humans;
        const onlineName = `🔒 Online Members: ${fmt(online)}`;
        const humansName = `🔒 Humans: ${fmt(humans)}`;

        for (const [id, name] of [[ONLINE_ID, onlineName], [HUMANS_ID, humansName]]) {
            const r = await fetch(`https://discord.com/api/v10/channels/${id}`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bot ${TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name })
            });
            if (r.ok) {
                console.log(`[Counter] Successfully updated: ${name}`);
            } else {
                console.log(`[Counter] Patch status for ${id}: ${r.status}`);
            }
            await new Promise(res => setTimeout(res, 2000));
        }
        lastUpdate = Date.now();
    } catch (e) {
        console.error("[Counter] Error updating counts:", e.message);
    }
}

// 3. Welcome Message System (#🔑·welcome)
const welcomedUsers = new Set();

async function sendWelcomeMessage(user) {
    if (!user || user.bot) return;
    if (welcomedUsers.has(user.id)) return;
    welcomedUsers.add(user.id);
    setTimeout(() => welcomedUsers.delete(user.id), 60000); // 1-minute deduplication

    console.log(`[Welcome] Sending welcome card for: ${user.username} (${user.id})`);

    const avatarUrl = user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`
        : 'https://raw.githubusercontent.com/fast007x2-blip/baan-hub/main/baan-hub-logo.png';

    const embed = {
        title: '🎉 Welcome to Baan Hub! ยินดีต้อนรับสู่ Baan Hub',
        description: `สวัสดี <@${user.id}> ยินดีต้อนรับสู่ครอบครัว **Baan Hub** 🏠✨\n\n⚡ **เริ่มต้นใช้งานง่ายๆ**:\n• รับสคริปต์ฟรี Keyless ทุกเกมได้ที่ห้อง <#${NEW_GAME_CHANNEL_ID}>\n• อ่านกฎและข้อปฏิบัติที่ห้อง <#1544393333974245518>\n• ดูข่าวสารและการอัปเดตใหม่ๆ ที่ห้อง <#1544393338122141746>\n• แลกเปลี่ยนและพูดคุยได้ที่ห้อง <#1546462933603590184>\n\nขอให้สนุกกับการเล่นเกมและฟาร์มอย่างปลอดภัยครับ! 🚀`,
        color: 5268720,
        thumbnail: { url: avatarUrl },
        image: { url: 'https://raw.githubusercontent.com/fast007x2-blip/baan-hub/main/baan-hub-cover.png' },
        footer: { text: `Baan Hub • Official Community${lastMemberCount ? ' • Member #' + lastMemberCount : ''}` },
        timestamp: new Date().toISOString()
    };

    const components = [
        {
            type: 1,
            components: [
                {
                    type: 2,
                    style: 5,
                    label: '🏀 รับสคริปต์ฟรี (Get Scripts)',
                    url: `https://discord.com/channels/${GUILD_ID}/${NEW_GAME_CHANNEL_ID}`
                },
                {
                    type: 2,
                    style: 5,
                    label: '⭐ GitHub Repository',
                    url: 'https://github.com/fast007x2-blip/baan-hub'
                }
            ]
        }
    ];

    try {
        const res = await fetch(`https://discord.com/api/v10/channels/${WELCOME_CHANNEL_ID}/messages`, {
            method: 'POST',
            headers: {
                Authorization: `Bot ${TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content: `👋 ยินดีต้อนรับ <@${user.id}> เข้าสู่ **Baan Hub**!`,
                embeds: [embed],
                components: components
            })
        });
        if (res.ok) {
            console.log(`✅ Welcome card sent for ${user.username}`);
        } else {
            console.log(`❌ Failed to send welcome card: ${res.status}`);
        }
    } catch (e) {
        console.error("Error sending welcome message:", e.message);
    }
}

// 4. Honeypot Action & Ban Log System (#🔨·ban-logs)
async function handleHoneypot(msg) {
    const author = msg.author;
    if (!author || author.id === botUserId || author.bot) return;

    console.log(`\n🚨 [HONEYPOT TRIGGERED] User: ${author.username}#${author.discriminator || '0'} (${author.id})`);
    console.log(`Message ID: ${msg.id} | Content: ${msg.content || "[Embeds/Attachments]"}`);

    const spamContent = msg.content || (msg.attachments && msg.attachments.length > 0 ? "[File/Image Attachment]" : "[Embed/Empty Content]");

    // Step A: Delete message immediately
    try {
        const delRes = await fetch(`https://discord.com/api/v10/channels/${msg.channel_id}/messages/${msg.id}`, {
            method: 'DELETE',
            headers: {
                Authorization: `Bot ${TOKEN}`,
                'X-Audit-Log-Reason': 'Baan Hub Honeypot: Sent message in #honey'
            }
        });
        if (delRes.ok) console.log(`✅ Deleted spam message: ${msg.id}`);
    } catch (e) {
        console.error("Error deleting message:", e.message);
    }

    // Step B: Ban user and purge last 7 days of messages
    let banSuccess = false;
    try {
        const banRes = await fetch(`https://discord.com/api/v10/guilds/${msg.guild_id}/bans/${author.id}`, {
            method: 'PUT',
            headers: {
                Authorization: `Bot ${TOKEN}`,
                'Content-Type': 'application/json',
                'X-Audit-Log-Reason': 'Baan Hub Honeypot: Sent message in #honey'
            },
            body: JSON.stringify({ delete_message_seconds: 604800 })
        });
        if (banRes.ok) {
            console.log(`🔨 BANNED spammer: ${author.username} (${author.id})`);
            banSuccess = true;
        } else {
            console.log(`❌ Failed to ban user: ${banRes.status}`);
        }
    } catch (e) {
        console.error("Error banning user:", e.message);
    }

    // Step C: Send Ban Log to #🔨·ban-logs
    try {
        const banLogEmbed = {
            title: '🚨 Honeypot Trap: Spammer Banned!',
            description: `ตรวจพบและจัดการแบนผู้ใช้ที่ส่งข้อความในห้อง <#${HONEY_CHANNEL_ID}> เรียบร้อยแล้ว`,
            color: 15548997, // Red
            thumbnail: {
                url: author.avatar
                    ? `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png?size=128`
                    : 'https://raw.githubusercontent.com/fast007x2-blip/baan-hub/main/baan-hub-logo.png'
            },
            fields: [
                { name: '👤 ผู้ใช้ (User)', value: `<@${author.id}> (\`${author.username}#${author.discriminator || '0'}\`)`, inline: true },
                { name: '🆔 User ID', value: `\`${author.id}\``, inline: true },
                { name: '🔨 สถานะการแบน', value: banSuccess ? '✅ สำเร็จ (Purged 7 Days)' : '⚠️ ข้อผิดพลาดในการแบน', inline: true },
                { name: '💬 ข้อความที่สแปม', value: '```\n' + spamContent.substring(0, 950) + '\n```', inline: false }
            ],
            footer: { text: 'Baan Hub Anti-Spam Security System' },
            timestamp: new Date().toISOString()
        };

        await fetch(`https://discord.com/api/v10/channels/${BAN_LOGS_CHANNEL_ID}/messages`, {
            method: 'POST',
            headers: {
                Authorization: `Bot ${TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ embeds: [banLogEmbed] })
        });
        console.log(`📋 Log sent to #🔨·ban-logs`);
    } catch (e) {
        console.error("Error logging to ban-logs channel:", e.message);
    }
}

// 5. Discord Gateway WebSocket Connection
function connectGateway() {
    console.log("[Gateway] Connecting to Discord Gateway...");
    ws = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");

    ws.onopen = () => {
        console.log("[Gateway] WebSocket connected.");
    };

    ws.onmessage = (event) => {
        try {
            const payload = JSON.parse(event.data);
            const { op, d, s, t } = payload;
            if (s !== null) lastSequence = s;

            if (op === 10) {
                const interval = d.heartbeat_interval;
                if (heartbeatTimer) clearInterval(heartbeatTimer);
                heartbeatTimer = setInterval(() => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ op: 1, d: lastSequence }));
                    }
                }, interval);

                ws.send(JSON.stringify({
                    op: 2,
                    d: {
                        token: TOKEN,
                        intents: 513,
                        properties: {
                            os: "linux",
                            browser: "baan-hub-bot",
                            device: "baan-hub-bot"
                        }
                    }
                }));
            }

            if (op === 0) {
                if (t === "READY") {
                    botUserId = d.user.id;
                    console.log(`========================================`);
                    console.log(`🤖 Baan Hub Bot is ONLINE! Logged in as: ${d.user.username}#${d.user.discriminator || '0'} (${botUserId})`);
                    console.log(`🍯 Honeypot active on: ${HONEY_CHANNEL_ID}`);
                    console.log(`🎉 Welcome active on: ${WELCOME_CHANNEL_ID}`);
                    console.log(`🔨 Ban logs active on: ${BAN_LOGS_CHANNEL_ID}`);
                    console.log(`========================================`);
                } else if (t === "MESSAGE_CREATE") {
                    if (d.channel_id === HONEY_CHANNEL_ID) {
                        handleHoneypot(d);
                    } else if (d.channel_id === WELCOME_CHANNEL_ID && d.type === 7) {
                        // Discord system join message in welcome channel
                        sendWelcomeMessage(d.author);
                    }
                } else if (t === "GUILD_MEMBER_ADD") {
                    sendWelcomeMessage(d.user);
                }
            }
        } catch (e) {
            console.error("[Gateway] Message parse error:", e);
        }
    };

    ws.onclose = (e) => {
        console.log(`[Gateway] Disconnected (code: ${e.code}, reason: ${e.reason}). Reconnecting in 5s...`);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        setTimeout(connectGateway, 5000);
    };

    ws.onerror = (err) => {
        console.error("[Gateway] WebSocket error:", err.message || err);
    };
}

connectGateway();
updateMemberCounts();
setInterval(updateMemberCounts, 6 * 60 * 1000);
