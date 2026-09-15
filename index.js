// Baan Hub Discord Bot - 24/7 Member Counter & Real-Time Honeypot Anti-Spam
const http = require('http');

const TOKEN = process.env.BAAN_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID || "1541653103982419988";
const HONEY_CHANNEL_ID = process.env.HONEY_CHANNEL_ID || "1544393321420558489";
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

function fmt(n) {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 1 : 2).replace(/\.0+$/, '') + 'K';
    return String(n);
}

// 1. Health-Check Web Server (keeps cloud hosting awake)
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

// 3. Honeypot Action: Delete message & Ban spammer
async function handleHoneypot(msg) {
    const author = msg.author;
    if (!author || author.id === botUserId || author.bot) return;

    console.log(`\n🚨 [HONEYPOT TRIGGERED] User: ${author.username}#${author.discriminator || '0'} (${author.id})`);
    console.log(`Message ID: ${msg.id} | Content: ${msg.content || "[Embeds/Attachments]"}`);

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
        if (banRes.ok) console.log(`🔨 BANNED spammer: ${author.username} (${author.id})`);
    } catch (e) {
        console.error("Error banning user:", e.message);
    }
}

// 4. Discord Gateway WebSocket Connection
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
                    console.log(`🍯 Honeypot active on channel ID: ${HONEY_CHANNEL_ID}`);
                    console.log(`========================================`);
                } else if (t === "MESSAGE_CREATE") {
                    if (d.channel_id === HONEY_CHANNEL_ID) {
                        handleHoneypot(d);
                    }
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
