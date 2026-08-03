require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.static(__dirname));

const server = http.createServer(app);

// Attach WebSocket to the HTTP server to share a single port (Required for Render)
const wss = new WebSocket.Server({ server });

wss.on('connection', () => {
    console.log('🔌 Overlay client connected to WebSocket!');
});

function broadcast(data) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// Keywords that will block any channel containing them
const IGNORED_KEYWORDS = [
    'admin-stuff',
    'mod-stuff',
    'gh-chat',
    'gh-noti',
    'notes',
    'server-updates',
    'sapphire-templates',
    'giveaway-logs',
    'logs'
];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message]
});

client.on('ready', () => {
    console.log(`🤖 Discord Bot logged in as ${client.user.tag}`);
});

async function fetchAsBase64(url, useAuth = false) {
    try {
        const headers = {
            'User-Agent': 'DiscordBot (https://github.com/CirillionGH, 1.0.0)'
        };
        if (useAuth) {
            headers['Authorization'] = `Bot ${process.env.DISCORD_TOKEN}`;
        }

        const response = await fetch(url, { headers });
        if (!response.ok) return null;

        const contentType = response.headers.get('content-type') || 'image/png';
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch (err) {
        return null;
    }
}

async function fetchStickerAsBase64(stickerId) {
    const candidateUrls = [
        `https://cdn.discordapp.com/stickers/${stickerId}.gif`,
        `https://media.discordapp.net/stickers/${stickerId}.gif`,
        `https://cdn.discordapp.com/stickers/${stickerId}.png`,
        `https://cdn.discordapp.com/stickers/${stickerId}.webp`,
        `https://media.discordapp.net/stickers/${stickerId}.png`
    ];

    for (const url of candidateUrls) {
        const result = await fetchAsBase64(url, true);
        if (result) return result;
        const resultNoAuth = await fetchAsBase64(url, false);
        if (resultNoAuth) return resultNoAuth;
    }
    return null;
}

async function extractMessageData(message) {
    let extractedMediaUrl = null;
    let lottieData = null;

    let rawContent = (message.content || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

    // 1. Check Discord Stickers via client.fetchSticker for complete metadata & valid URL
    const stickerItem = message.stickerItems?.first() || message.stickers?.first();

    if (stickerItem) {
        try {
            const fullSticker = await message.client.fetchSticker(stickerItem.id);
            if (fullSticker.format === 3 || fullSticker.url.endsWith('.json')) {
                const res = await fetch(fullSticker.url, {
                    headers: {
                        'Authorization': `Bot ${process.env.DISCORD_TOKEN}`,
                        'User-Agent': 'DiscordBot (https://github.com/CirillionGH, 1.0.0)'
                    }
                });
                if (res.ok) {
                    lottieData = await res.json();
                }
            } else {
                extractedMediaUrl = await fetchAsBase64(fullSticker.url, true);
                if (!extractedMediaUrl) {
                    extractedMediaUrl = await fetchStickerAsBase64(stickerItem.id);
                }
            }
        } catch (err) {
            extractedMediaUrl = await fetchStickerAsBase64(stickerItem.id);
        }
    }

    // 2. Custom Discord Emojis
    if (!extractedMediaUrl && !lottieData && rawContent) {
        const customEmojiMatch = rawContent.match(/\\?<(a)?:?([a-zA-Z0-9_-]+):(\d+)>/i);
        if (customEmojiMatch) {
            const isAnimated = customEmojiMatch[1] === 'a';
            const emojiId = customEmojiMatch[3];
            const rawUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${isAnimated ? 'gif' : 'png'}`;
            extractedMediaUrl = await fetchAsBase64(rawUrl, true);
        }
    }

    // 3. Catch direct Discord CDN links in text content
    if (!extractedMediaUrl && !lottieData && rawContent) {
        const cdnMatch = rawContent.match(/(https?:\/\/(?:cdn|media)\.discordapp\.(?:com|net)\/stickers\/(\d+)\.(?:png|gif|apng|json))/i);
        if (cdnMatch) {
            const stickerId = cdnMatch[2];
            try {
                const fullSticker = await message.client.fetchSticker(stickerId);
                if (fullSticker.format === 3 || fullSticker.url.endsWith('.json')) {
                    const res = await fetch(fullSticker.url, { headers: { 'Authorization': `Bot ${process.env.DISCORD_TOKEN}` } });
                    if (res.ok) lottieData = await res.json();
                } else {
                    extractedMediaUrl = await fetchAsBase64(fullSticker.url, true);
                }
            } catch (e) {
                extractedMediaUrl = await fetchStickerAsBase64(stickerId);
            }
        }
    }

    // 4. File Attachments & Embeds
    if (!extractedMediaUrl && !lottieData && message.attachments && message.attachments.size > 0) {
        const attachment = message.attachments.first();
        if (attachment.contentType?.startsWith('image/')) {
            extractedMediaUrl = await fetchAsBase64(attachment.url, true);
        }
    }

    if (!extractedMediaUrl && !lottieData && message.embeds && message.embeds.length > 0) {
        for (const embed of message.embeds) {
            const rawUrl = embed.image?.url || embed.thumbnail?.url;
            if (rawUrl) {
                extractedMediaUrl = await fetchAsBase64(rawUrl, false);
                break;
            }
        }
    }

    if (!extractedMediaUrl && !lottieData && rawContent) {
        const directImageMatch = rawContent.match(/(https?:\/\/[^\s]+(?:\.gif|\.png|\.jpg|\.webp))/i);
        if (directImageMatch) {
            extractedMediaUrl = await fetchAsBase64(directImageMatch[1], false);
        }
    }

    // Clean raw syntax out of chat bubble text
    let cleanContent = rawContent
        .replace(/\\?<(a)?:?[a-zA-Z0-9_-]+:\d+>/gi, '')
        .replace(/(https?:\/\/[^\s]+(?:\.gif|\.png|\.jpg|\.webp|\.json))/gi, '')
        .trim();

    return {
        type: 'MESSAGE',
        userId: message.author.id,
        user: message.author.username,
        avatarUrl: message.author.displayAvatarURL({ extension: 'png', size: 128 }),
        channel: message.channel ? (message.channel.name || message.channel.id) : 'default',
        content: cleanContent,
        mediaUrl: extractedMediaUrl,
        lottieData: lottieData
    };
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    let channel = message.channel;
    if (channel && !channel.name && typeof channel.fetch === 'function') {
        try {
            channel = await channel.fetch();
        } catch (err) { }
    }

    const channelName = channel?.name ? channel.name.toLowerCase().trim() : '';
    const parentName = channel?.parent?.name ? channel.parent.name.toLowerCase().trim() : '';
    const channelId = channel?.id || '';

    console.log(`🔍 [INCOMING] ID: ${channelId} | Name: "${channelName}" | Parent: "${parentName}" | Author: ${message.author.username}`);

    const isIgnored = IGNORED_KEYWORDS.some(keyword =>
        channelName.includes(keyword) || parentName.includes(keyword)
    );

    if (isIgnored) {
        console.log(`🚫 BLOCKED message from restricted channel: ${channelName || channelId}`);
        return;
    }

    const payload = await extractMessageData(message);
    console.log(`💬 [#${payload.channel}] ${payload.user}: ${payload.content}`);
    broadcast(payload);
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (newMessage.author?.bot) return;

    let channel = newMessage.channel;
    if (channel && !channel.name && typeof channel.fetch === 'function') {
        try {
            channel = await channel.fetch();
        } catch (err) { }
    }

    const channelName = channel?.name ? channel.name.toLowerCase().trim() : '';
    const parentName = channel?.parent?.name ? channel.parent.name.toLowerCase().trim() : '';

    const isIgnored = IGNORED_KEYWORDS.some(keyword =>
        channelName.includes(keyword) || parentName.includes(keyword)
    );

    if (isIgnored) return;

    const payload = await extractMessageData(newMessage);
    if (payload.mediaUrl || payload.lottieData) {
        broadcast(payload);
    }
});

server.listen(PORT, () => {
    console.log(`🌐 Overlay Web Server and WebSocket running on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);