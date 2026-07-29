require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    PermissionFlagsBits,
    ChannelType,
    REST,
    Routes
} = require('discord.js');
const express = require('express');

// ---------------------------------------------------------------------------
// CONFIG / ENV
// ---------------------------------------------------------------------------
// Set GUILD_ID in .env to register slash commands instantly to one server
// while testing. Global commands (no GUILD_ID) can take up to an hour to
// show up / update in Discord clients — this is a Discord limitation, not a bug.
const GUILD_ID = process.env.GUILD_ID || null;

// ---------------------------------------------------------------------------
// PERSISTENCE
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
const ARCHIVE_FILE = path.join(DATA_DIR, 'archivedTickets.json');
const CONFIG_FILE = path.join(DATA_DIR, 'guildConfigs.json');
const SITE_CONFIG_FILE = path.join(DATA_DIR, 'siteConfig.json');
const BLOCKLIST_FILE = path.join(DATA_DIR, 'blockedGuilds.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// OWNER-ONLY BLOCK SYSTEM
// ---------------------------------------------------------------------------
// /block and /unblock are registered ONLY to OWNER_GUILD_ID (your own private server) —
// they never appear in the command list of any other server, including client servers.
// They also only run for OWNER_USER_ID, as a second, independent check.
// DISCLOSURE MATTERS: this is only a legitimate safeguard if whoever you deploy this bot
// for has been told, in writing (invoice/contract), that access can be suspended for
// non-payment. Using it as a hidden, undisclosed backdoor is a different thing entirely
// and not something to do quietly.
const OWNER_GUILD_ID = process.env.OWNER_GUILD_ID || null; // your private server's ID
const OWNER_USER_ID = process.env.OWNER_USER_ID || null;   // your Discord user ID

let blockedGuilds = {};
try {
    if (fs.existsSync(BLOCKLIST_FILE)) {
        blockedGuilds = JSON.parse(fs.readFileSync(BLOCKLIST_FILE, 'utf8'));
    }
} catch (err) {
    console.error('Could not load block list, starting fresh:', err);
}
function saveBlocklist() {
    try {
        fs.writeFileSync(BLOCKLIST_FILE, JSON.stringify(blockedGuilds, null, 2));
    } catch (err) {
        console.error('Failed to save block list:', err);
    }
}

function isOwnerContext(interaction) {
    return Boolean(
        OWNER_USER_ID && OWNER_GUILD_ID &&
        interaction.user.id === OWNER_USER_ID &&
        interaction.guild && interaction.guild.id === OWNER_GUILD_ID
    );
}

function defaultSiteConfig() {
    return {
        password: process.env.ARCHIVE_PASSWORD || '5314',
        siteTitle: 'Redfield Archives',
        bannerText: '',
        accentColor: '#d69a4e',
        footerNote: ''
    };
}

let siteConfig = defaultSiteConfig();
try {
    if (fs.existsSync(SITE_CONFIG_FILE)) {
        siteConfig = { ...defaultSiteConfig(), ...JSON.parse(fs.readFileSync(SITE_CONFIG_FILE, 'utf8')) };
    }
} catch (err) {
    console.error('Could not load site config, using defaults:', err);
}
function saveSiteConfig() {
    try {
        fs.writeFileSync(SITE_CONFIG_FILE, JSON.stringify(siteConfig, null, 2));
    } catch (err) {
        console.error('Failed to save site config:', err);
    }
}

function computeAuthToken(password) {
    return crypto.createHash('sha256').update(`redfield-ticket-archive-${password}`).digest('hex');
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Serves index.html/transcript.html with the admin-configurable title, accent
// color, and banner injected — the two view files just contain matching
// {{TOKEN}} placeholders.
function renderTemplate(filePath) {
    let html = fs.readFileSync(filePath, 'utf8');
    const validAccent = /^#[0-9A-Fa-f]{6}$/.test(siteConfig.accentColor) ? siteConfig.accentColor : '#d69a4e';
    const bannerHtml = siteConfig.bannerText ? `<div class="site-banner">📢 ${escapeHtml(siteConfig.bannerText)}</div>` : '';
    const footerHtml = siteConfig.footerNote ? `<div class="footer-note">${escapeHtml(siteConfig.footerNote)}</div>` : '';
    return html
        .replace(/{{SITE_TITLE}}/g, escapeHtml(siteConfig.siteTitle))
        .replace(/{{ACCENT_COLOR}}/g, validAccent)
        .replace(/{{BANNER_HTML}}/g, bannerHtml)
        .replace(/{{FOOTER_NOTE_HTML}}/g, footerHtml);
}

let archivedTickets = new Map();
try {
    if (fs.existsSync(ARCHIVE_FILE)) {
        archivedTickets = new Map(Object.entries(JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8'))));
    }
} catch (err) {
    console.error('Could not load archived tickets, starting fresh:', err);
}
function saveArchive() {
    try {
        fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(Object.fromEntries(archivedTickets), null, 2));
    } catch (err) {
        console.error('Failed to save archived tickets:', err);
    }
}

let guildConfigs = {};
try {
    if (fs.existsSync(CONFIG_FILE)) {
        guildConfigs = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
} catch (err) {
    console.error('Could not load guild configs, starting fresh:', err);
}
function saveConfigs() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(guildConfigs, null, 2));
    } catch (err) {
        console.error('Failed to save guild configs:', err);
    }
}

function defaultConfig() {
    return {
        panels: {
            REDFIELD: {
                title: 'Redfield Assistance',
                description: 'This panel is for assistance required on Redfield!\n\nOnly open a ticket if you require the following:\n• Have an enquiry\n• Have a player report\n\n**Do not** open this ticket to ask for mod.',
                buttonLabel: 'Redfield Support',
                emoji: '🛡️',
                style: 'Success',
                color: 0x2ecc71,
                promptLabel: 'What do you need help with?'
            },
            MANAGEMENT: {
                title: 'Management',
                description: 'This panel is for assistance required by Management!\n\nOnly open a ticket if you require the following:\n• Have a staff report (reporting a moderator)\n\n**Do not** open this ticket to ask for mod or to report players.',
                buttonLabel: 'Management Support',
                emoji: '📋',
                style: 'Primary',
                color: 0x5865f2,
                promptLabel: 'Describe the situation you want to report'
            },
            BUG: {
                title: 'Bug Report',
                description: 'This panel is for reporting bugs found on Redfield!\n\nOnly open a ticket if you require the following:\n• Reporting a bug\n\n**Do not** open this ticket to ask for mod.',
                buttonLabel: 'Bug Report',
                emoji: '🐛',
                style: 'Secondary',
                color: 0xf1c40f,
                promptLabel: 'Describe the bug (steps to reproduce)'
            }
        },
        maxTicketsPerUser: 3,
        closeDelaySeconds: 60,
        archiveAction: 'lock', // 'delete' or 'lock' — locked by default: channel stays, renamed "closed-...", opener loses send perms
        allowOpenerClose: false,
        ticketsPaused: false,
        pausedMessage: 'Ticket creation is temporarily paused. Please try again later.',
        blacklistedUsers: {}, // { userId: { tag, reason, blacklistedAt, blacklistedBy } }
        staffRoleIds: [],
        logChannelId: null
    };
}

// Deep-merges saved config over the defaults, field by field, so a config
// file missing a newer field (e.g. from an older bot version) never leaves
// something like panel.promptLabel undefined, which used to crash modals.
function getGuildConfig(guildId) {
    const saved = guildConfigs[guildId] || {};
    const def = defaultConfig();
    const merged = { ...def, ...saved };

    merged.panels = {};
    for (const key of Object.keys(def.panels)) {
        merged.panels[key] = { ...def.panels[key], ...((saved.panels && saved.panels[key]) || {}) };
    }
    merged.staffRoleIds = Array.isArray(saved.staffRoleIds) ? saved.staffRoleIds : def.staffRoleIds;

    guildConfigs[guildId] = merged;
    saveConfigs();
    return merged;
}

const STYLE_MAP = {
    Primary: ButtonStyle.Primary,
    Secondary: ButtonStyle.Secondary,
    Success: ButtonStyle.Success,
    Danger: ButtonStyle.Danger
};

// In-memory map of OPEN tickets, keyed by channel ID.
const openTickets = new Map();
// Prevents duplicate-click race conditions while a ticket channel is being created.
const pendingCreations = new Set();

// ---------------------------------------------------------------------------
// EXPRESS WEB SERVER — password gated, search/filter capable
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

function parseCookies(req) {
    const header = req.headers.cookie;
    const cookies = {};
    if (!header) return cookies;
    header.split(';').forEach(pair => {
        const idx = pair.indexOf('=');
        if (idx === -1) return;
        cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    });
    return cookies;
}

const SESSION_SECONDS = 10 * 60; // auto-logout after 10 minutes

function lockPageHtml(error, returnTo) {
    const accent = /^#[0-9A-Fa-f]{6}$/.test(siteConfig.accentColor) ? siteConfig.accentColor : '#d69a4e';
    // JSON.stringify safely embeds this as a JS string literal (handles escaping) rather than
    // splicing raw user/path data into HTML, which would be an injection risk.
    const safeReturn = JSON.stringify((returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')) ? returnTo : '/');
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(siteConfig.siteTitle)} — Locked</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Special+Elite&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --amber: ${accent}; }
  * { box-sizing: border-box; }
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at top, #1a1e22, #14171a);font-family:'IBM Plex Mono',monospace;color:#d9d5c9;padding:20px;}
  .box{background:#1c2023;border:1px solid #2a2f33;border-left:4px solid var(--amber);border-radius:6px;padding:36px 32px;width:300px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.4);}
  .lock-icon{font-size:28px;margin-bottom:10px;}
  h1{font-family:'Special Elite',monospace;font-size:19px;color:#e8e2d0;margin:0 0 6px;letter-spacing:.5px;}
  p{font-size:12px;color:#7d8489;margin:0 0 20px;line-height:1.5;}
  input{width:100%;box-sizing:border-box;background:#14171a;border:1px solid #2a2f33;color:#e8e2d0;padding:12px;border-radius:4px;font-family:inherit;font-size:15px;margin-bottom:12px;letter-spacing:0.3em;text-align:center;transition:border-color .15s;}
  input:focus{outline:none;border-color:var(--amber);}
  button{width:100%;background:var(--amber);border:none;color:#14171a;font-weight:600;padding:11px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:13px;letter-spacing:.05em;text-transform:uppercase;transition:opacity .15s;}
  button:hover{opacity:.9;}
  .err{color:#e05a3a;font-size:11.5px;margin-top:12px;font-weight:600;}
  .hint{font-size:10.5px;color:#4d5257;margin-top:18px;}
</style></head>
<body>
  <div class="box">
    <div class="lock-icon">🔒</div>
    <h1>${escapeHtml(siteConfig.siteTitle)}</h1>
    <p>This archive is restricted. Enter the access code from staff to continue.</p>
    <form id="f">
      <input id="pw" type="password" placeholder="ACCESS CODE" autofocus autocomplete="off" />
      <button type="submit">Unlock Archive</button>
      ${error ? '<div class="err">⚠ Incorrect code — try again.</div>' : ''}
    </form>
    <div class="hint">Sessions auto-expire after 10 minutes for security.</div>
  </div>
  <script>
    const returnTo = ${safeReturn};
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('pw').value;
      const res = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ password }) });
      if (res.ok) { window.location.href = returnTo; } else { window.location.href = returnTo + (returnTo.includes('?') ? '&' : '?') + 'err=1'; }
    });
  </script>
</body></html>`;
}

function requireAuth(req, res, next) {
    const cookies = parseCookies(req);
    if (cookies.ticketAuth === computeAuthToken(siteConfig.password)) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
    return res.send(lockPageHtml(req.query.err, req.path));
}

app.post('/api/login', (req, res) => {
    const { password } = req.body || {};
    if (password === siteConfig.password) {
        const expiresAt = Date.now() + SESSION_SECONDS * 1000;
        res.setHeader('Set-Cookie', [
            `ticketAuth=${computeAuthToken(siteConfig.password)}; HttpOnly; Path=/; Max-Age=${SESSION_SECONDS}`,
            // Not HttpOnly on purpose — the page's countdown/logout timer needs to read this one.
            `sessionExpires=${expiresAt}; Path=/; Max-Age=${SESSION_SECONDS}`
        ]);
        return res.json({ success: true, expiresAt });
    }
    return res.status(401).json({ success: false });
});

// A single GET route that clears cookies and redirects in ONE response, instead of a
// fetch() call followed by a separate reload — removes any possible timing gap between
// "cookie cleared" and "page re-checked" and works even if JS fails for any reason.
// Expires is included alongside Max-Age=0 since some browsers only honor one or the other.
function clearAuthCookies(res) {
    res.setHeader('Set-Cookie', [
        'ticketAuth=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'sessionExpires=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
    ]);
}

app.get('/logout', (req, res) => {
    clearAuthCookies(res);
    res.redirect('/');
});

// Kept for any script-based use, but the button itself now uses /logout directly.
app.post('/api/logout', (req, res) => {
    clearAuthCookies(res);
    res.json({ success: true });
});

// Block direct static access to the raw html files so the auth gate can't be bypassed
// by requesting /index.html or /transcript.html directly (express.static would otherwise serve them).
app.use((req, res, next) => {
    if (req.path === '/index.html' || req.path === '/transcript.html') return res.status(403).send('Forbidden');
    next();
});
app.use(express.static('views', { index: false }));

// Lets a ticket opener view their OWN closed transcript via a per-ticket token (sent by DM)
// without needing the staff site password — but grants access to that one transcript only,
// never the full archive list or other tickets' data.
function requireAuthOrTicketToken(req, res, next) {
    const cookies = parseCookies(req);
    if (cookies.ticketAuth === computeAuthToken(siteConfig.password)) return next();

    const ticket = archivedTickets.get(req.params.id);
    if (ticket && ticket.accessToken && req.query.token && req.query.token === ticket.accessToken) {
        return next();
    }
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
    return res.send(lockPageHtml(req.query.err, req.path));
}

app.get('/', requireAuth, (req, res) => res.send(renderTemplate(path.join(__dirname, 'views', 'index.html'))));
app.get('/transcript/:id', requireAuthOrTicketToken, (req, res) => res.send(renderTemplate(path.join(__dirname, 'views', 'transcript.html'))));
app.get('/api/tickets', requireAuth, (req, res) => res.json(Array.from(archivedTickets.values())));
app.get('/api/tickets/:id', requireAuthOrTicketToken, (req, res) => {
    const ticket = archivedTickets.get(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Not found' });
    res.json(ticket);
});
// Staff only — deliberately requireAuth (not requireAuthOrTicketToken), so a token link
// DMed to a ticket opener can never be used to delete an archive record.
app.delete('/api/tickets/:id', requireAuth, (req, res) => {
    if (!archivedTickets.has(req.params.id)) return res.status(404).json({ error: 'Not found' });
    archivedTickets.delete(req.params.id);
    saveArchive();
    res.json({ success: true });
});

app.listen(process.env.PORT || 3000, () => {
    console.log(`🌐 Web Dashboard running at ${process.env.WEBSITE_URL || 'http://localhost:3000'} (locked with access code)`);
});

// ---------------------------------------------------------------------------
// DISCORD BOT
// ---------------------------------------------------------------------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Discord hard-limits component/embed text lengths client-side (builders throw if exceeded).
// Clamping here means a too-long custom panel title/label can never crash ticket creation again.
function clamp(str, max) {
    if (!str) return str;
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function sanitizeForChannelName(input) {
    return input.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'user';
}

function isStaff(member, guildConfig) {
    if (!member) return false;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    return guildConfig.staffRoleIds.some(roleId => member.roles.cache.has(roleId));
}

function isValidEmoji(emoji) {
    try {
        new ButtonBuilder().setCustomId('test').setLabel('t').setStyle(ButtonStyle.Secondary).setEmoji(emoji);
        return true;
    } catch {
        return false;
    }
}

function findExistingTicket(guildId, userId, typeKey) {
    for (const [channelId, data] of openTickets.entries()) {
        if (data.guildId === guildId && data.userId === userId && data.type === typeKey) return channelId;
    }
    return null;
}

function countUserTickets(guildId, userId) {
    let count = 0;
    for (const data of openTickets.values()) {
        if (data.guildId === guildId && data.userId === userId) count++;
    }
    return count;
}

function recoverTicketFromTopic(channel) {
    const match = (channel.topic || '').match(/Ticket for (.+?) · Type: (\w+)/);
    if (!match) return null;
    return {
        guildId: channel.guild.id,
        userId: null,
        username: null,
        userTag: match[1],
        type: match[2],
        reason: 'Unknown (bot restarted after this ticket was opened)',
        robloxUsername: null,
        openedAt: null,
        claimedBy: null,
        closing: false
    };
}

function buildTicketButtons(claimed) {
    const row1 = new ActionRowBuilder();
    if (claimed) {
        row1.addComponents(new ButtonBuilder().setCustomId('unclaim_ticket').setLabel('Unclaim').setStyle(ButtonStyle.Secondary).setEmoji('↩️'));
    } else {
        row1.addComponents(new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim Ticket').setStyle(ButtonStyle.Primary).setEmoji('🙋'));
    }
    row1.addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'));

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('force_close_ticket').setLabel('Force Close').setStyle(ButtonStyle.Danger).setEmoji('⛔'),
        new ButtonBuilder().setCustomId('request_close_ticket').setLabel('Request Close').setStyle(ButtonStyle.Secondary).setEmoji('📨')
    );

    return [row1, row2];
}

async function fetchAllMessages(channel, maxMessages = 2000) {
    let all = [];
    let before;
    while (all.length < maxMessages) {
        const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        if (batch.size === 0) break;
        all.push(...batch.values());
        before = batch.last().id;
        if (batch.size < 100) break;
    }
    return all.reverse().map(m => ({
        author: m.author.tag,
        content: m.content || '',
        attachments: Array.from(m.attachments.values()).map(a => ({ url: a.url, contentType: a.contentType || '' })),
        embedImages: m.embeds.map(e => (e.image && e.image.url) || (e.thumbnail && e.thumbnail.url) || null).filter(Boolean),
        timestamp: m.createdAt
    }));
}

async function finalizeTicketClose(channel, guild, guildConfig, closedByTag) {
    try {
        const messagesArray = await fetchAllMessages(channel);
        const meta = openTickets.get(channel.id) || {};
        const accessToken = crypto.randomBytes(12).toString('hex');
        const websiteUrl = process.env.WEBSITE_URL || 'http://localhost:3000';

        archivedTickets.set(channel.id, {
            id: channel.id,
            channelName: channel.name,
            type: meta.type || channel.name.split('-')[0].toUpperCase(),
            openedBy: meta.userTag || 'Unknown user',
            openedById: meta.userId || null,
            robloxUsername: meta.robloxUsername || null,
            reason: meta.reason || 'No reason provided',
            claimedBy: meta.claimedBy ? meta.claimedBy.tag : null,
            closedBy: closedByTag,
            openedAt: meta.openedAt || null,
            closedAt: new Date().toISOString(),
            accessToken,
            messages: messagesArray
        });
        saveArchive();

        if (guildConfig.logChannelId) {
            const logChannel = await guild.channels.fetch(guildConfig.logChannelId).catch(() => null);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('Ticket Closed')
                    .setColor(0xe74c3c)
                    .addFields(
                        { name: 'Channel', value: channel.name, inline: true },
                        { name: 'Type', value: meta.type || 'Unknown', inline: true },
                        { name: 'Opened by', value: meta.userTag || 'Unknown', inline: true },
                        { name: 'Closed by', value: closedByTag, inline: true },
                        { name: 'Transcript', value: `${websiteUrl}/transcript/${channel.id}` }
                    )
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] });
            }
        }

        // DM the opener their own special transcript link — no site password needed, and it
        // only ever unlocks this one transcript, never the staff archive or other tickets.
        if (meta.userId) {
            try {
                const openerUser = await guild.client.users.fetch(meta.userId);
                const dmEmbed = new EmbedBuilder()
                    .setColor(0x5865f2)
                    .setTitle('Your ticket has been closed')
                    .setDescription(`Your **${meta.type || 'support'}** ticket (\`${channel.name}\`) was closed by ${closedByTag}.\n\nHere's a copy of the conversation.`)
                    .setTimestamp();
                const dmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setLabel('View My Transcript').setStyle(ButtonStyle.Link).setURL(`${websiteUrl}/transcript/${channel.id}?token=${accessToken}`).setEmoji('📄')
                );
                await openerUser.send({ embeds: [dmEmbed], components: [dmRow] });
            } catch (err) {
                // DMs can fail (blocked/closed DMs) — not fatal, just log it.
                console.error(`Could not DM transcript link to ${meta.userTag || meta.userId}:`, err.message);
            }
        }

        openTickets.delete(channel.id);

        if (guildConfig.archiveAction === 'lock') {
            await channel.setName(`closed-${channel.name}`.slice(0, 100)).catch(() => {});
            if (meta.userId) {
                await channel.permissionOverwrites.edit(meta.userId, { SendMessages: false }).catch(() => {});
            }
            await channel.send('🔒 This ticket is archived on the website and locked. It will not be deleted.').catch(() => {});
        } else {
            await channel.delete().catch(() => {});
        }
    } catch (error) {
        console.error('Error archiving ticket channel:', error);
    }
}

async function createTicketChannel(guild, user, typeKey, reason, robloxUsername, guildConfig) {
    const panel = guildConfig.panels[typeKey];

    let ticketCategory;
    try {
        ticketCategory = guild.channels.cache.find(c => c.name.toUpperCase() === 'TICKETS' && c.type === ChannelType.GuildCategory);
        if (!ticketCategory) {
            ticketCategory = await guild.channels.create({ name: 'TICKETS', type: ChannelType.GuildCategory });
        }
    } catch (err) {
        throw new Error(`Could not create/find the TICKETS category — check the bot has "Manage Channels" permission. (${err.message})`);
    }

    const validStaffRoleIds = guildConfig.staffRoleIds.filter(id => guild.roles.cache.has(id));

    const permissionOverwrites = [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
    ];
    for (const roleId of validStaffRoleIds) {
        permissionOverwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    }

    const channelName = `${typeKey.toLowerCase()}-${sanitizeForChannelName(user.username)}`;

    let ticketChannel;
    try {
        ticketChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: ticketCategory.id,
            topic: `Ticket for ${user.tag} · Type: ${typeKey}`,
            permissionOverwrites
        });
    } catch (err) {
        throw new Error(`Could not create the ticket channel — check the bot's permissions in the TICKETS category. (${err.message})`);
    }

    openTickets.set(ticketChannel.id, {
        guildId: guild.id,
        userId: user.id,
        username: user.username,
        userTag: user.tag,
        type: typeKey,
        reason: reason || 'No reason provided',
        robloxUsername: robloxUsername || null,
        openedAt: new Date().toISOString(),
        claimedBy: null,
        closing: false,
        welcomeMessageId: null
    });

    const staffMention = validStaffRoleIds.map(id => `<@&${id}>`).join(' ');
    const welcomeEmbed = new EmbedBuilder()
        .setColor(panel.color)
        .setTitle(`${panel.buttonLabel} · Ticket Opened`)
        .setThumbnail(user.displayAvatarURL())
        .setDescription(`<@${user.id}>, staff will be with you soon.\n\n**Reason given:**\n${reason || '*No reason provided*'}`)
        .addFields(
            { name: 'Opened by', value: `<@${user.id}>`, inline: true },
            { name: 'Type', value: panel.buttonLabel, inline: true },
            { name: 'Status', value: '🟢 Open', inline: true },
            ...(robloxUsername ? [{ name: 'Roblox Username', value: robloxUsername, inline: true }] : [])
        )
        .setFooter({ text: `Ticket ID: ${ticketChannel.id}` })
        .setTimestamp();

    const welcomeMessage = await ticketChannel.send({
        content: `${staffMention ? staffMention + ' — ' : ''}<@${user.id}>`,
        embeds: [welcomeEmbed],
        components: buildTicketButtons(false)
    });

    // Stored so /claim and /unclaim (slash commands, which have no "interaction.message" of
    // their own) can find and update the same embed the Claim/Unclaim buttons edit.
    const ticketRecord = openTickets.get(ticketChannel.id);
    if (ticketRecord) ticketRecord.welcomeMessageId = welcomeMessage.id;

    return ticketChannel;
}

async function sendTicketPanels(channel, guildConfig) {
    for (const [typeKey, panel] of Object.entries(guildConfig.panels)) {
        const embed = new EmbedBuilder().setTitle(clamp(panel.title, 256)).setDescription(clamp(panel.description, 4096)).setColor(panel.color);
        const button = new ButtonBuilder()
            .setCustomId(`open_ticket_${typeKey}`)
            .setLabel(clamp(panel.buttonLabel, 80))
            .setStyle(STYLE_MAP[panel.style] || ButtonStyle.Secondary);
        if (panel.emoji && isValidEmoji(panel.emoji)) button.setEmoji(panel.emoji);
        await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
    }
}

function ticketModal(typeKey, panel) {
    // Modal titles and text-input labels are capped at 45 chars by Discord — separate limit from
    // the button label itself (80 chars), so both need their own clamp at the point of use.
    const modal = new ModalBuilder().setCustomId(`ticket_modal_${typeKey}`).setTitle(clamp(panel.buttonLabel, 45));
    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('reason').setLabel(clamp(panel.promptLabel, 45)).setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('robloxUsername').setLabel('Roblox username (optional)').setStyle(TextInputStyle.Short).setMaxLength(50).setRequired(false)
        )
    );
    return modal;
}

function configMainMenu() {
    const select = new StringSelectMenuBuilder()
        .setCustomId('config_menu')
        .setPlaceholder('Choose what to configure...')
        .addOptions(
            { label: 'Redfield Panel', value: 'panel_REDFIELD', emoji: '🛡️' },
            { label: 'Management Panel', value: 'panel_MANAGEMENT', emoji: '📋' },
            { label: 'Bug Report Panel', value: 'panel_BUG', emoji: '🐛' },
            { label: 'General Settings (max tickets, close delay)', value: 'general', emoji: '⚙️' },
            { label: 'Archive Behavior (lock vs delete)', value: 'archiveaction', emoji: '🗄️' },
            { label: 'Can openers close their own ticket?', value: 'openerclose', emoji: '🔑' },
            { label: 'Staff Roles', value: 'staffroles', emoji: '🧑‍💼' },
            { label: 'Log Channel', value: 'logchannel', emoji: '📜' }
        );
    return new ActionRowBuilder().addComponents(select);
}

function configSummaryEmbed(guildConfig) {
    return new EmbedBuilder()
        .setTitle('🔧 Ticket Bot Configuration')
        .setColor(0x5865f2)
        .setDescription('Pick a setting below to edit it.')
        .addFields(
            { name: 'Max tickets per user', value: `${guildConfig.maxTicketsPerUser}`, inline: true },
            { name: 'Close delay', value: `${guildConfig.closeDelaySeconds}s`, inline: true },
            { name: 'Archive behavior', value: guildConfig.archiveAction, inline: true },
            { name: 'Openers can close?', value: guildConfig.allowOpenerClose ? 'Yes' : 'No', inline: true },
            { name: 'Tickets paused?', value: guildConfig.ticketsPaused ? 'Yes ⏸️' : 'No', inline: true },
            { name: 'Staff roles', value: guildConfig.staffRoleIds.length ? guildConfig.staffRoleIds.map(id => `<@&${id}>`).join(', ') : '*None set — only Administrators count as staff*' },
            { name: 'Log channel', value: guildConfig.logChannelId ? `<#${guildConfig.logChannelId}>` : '*Not set*' }
        );
}

function siteMainMenu() {
    const select = new StringSelectMenuBuilder()
        .setCustomId('sitesettings_menu')
        .setPlaceholder('Choose a website setting...')
        .addOptions(
            { label: 'Website Access Password', value: 'password', emoji: '🔑' },
            { label: 'Ticket Auto-Delete Delay', value: 'autodelete', emoji: '⏱️' },
            { label: 'Website Announcement Banner', value: 'banner', emoji: '📢' },
            { label: 'Website Header Title', value: 'sitetitle', emoji: '🏷️' },
            { label: 'Primary Theme Accent Color', value: 'accentcolor', emoji: '🎨' },
            { label: 'Pause/Resume Ticket Creation', value: 'pausetickets', emoji: '⏸️' },
            { label: 'Website Footer Note (Bonus)', value: 'footernote', emoji: '✨' }
        );
    return new ActionRowBuilder().addComponents(select);
}

function siteSummaryEmbed(guildConfig) {
    return new EmbedBuilder()
        .setTitle('🌐 Website & Ticket Settings')
        .setColor(0x5865f2)
        .setDescription('Pick a setting below to edit it. These affect the public archive website.')
        .addFields(
            { name: 'Website title', value: siteConfig.siteTitle, inline: true },
            { name: 'Accent color', value: siteConfig.accentColor, inline: true },
            { name: 'Auto-delete delay', value: `${Math.round(guildConfig.closeDelaySeconds / 60)} min`, inline: true },
            { name: 'Banner', value: siteConfig.bannerText || '*None*' },
            { name: 'Footer note', value: siteConfig.footerNote || '*None*' },
            { name: 'Tickets paused?', value: guildConfig.ticketsPaused ? `Yes — "${guildConfig.pausedMessage}"` : 'No' }
        );
}

client.once('ready', async () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);

    const commands = [
        { name: 'sendpanels', description: 'Sends all support panels into the current channel' },
        {
            name: 'setup',
            description: 'Creates a working test ticket channel automatically',
            options: [
                {
                    name: 'type',
                    description: 'Which panel type to test',
                    type: 3,
                    required: false,
                    choices: [
                        { name: 'Redfield', value: 'REDFIELD' },
                        { name: 'Management', value: 'MANAGEMENT' },
                        { name: 'Bug Report', value: 'BUG' }
                    ]
                }
            ]
        },
        { name: 'configure', description: 'Configure ticket panels, staff roles, limits, and archive behavior (staff only)' },
        { name: 'config-site', description: 'Configure the archive website, auto-delete delay, and ticket pause mode (staff only)' },
        { name: 'claim', description: 'Claim the ticket in this channel (staff only)' },
        { name: 'unclaim', description: 'Unclaim the ticket in this channel (staff only)' },
        { name: 'close', description: 'Close the ticket in this channel' },
        { name: 'request-close', description: "Ask the ticket opener to close their own ticket (staff only)" },
        {
            name: 'blacklist',
            description: 'Block a user from opening tickets (staff only)',
            options: [
                { name: 'user', description: 'User to blacklist', type: 6, required: true },
                { name: 'reason', description: 'Reason', type: 3, required: false }
            ]
        },
        {
            name: 'unblacklist',
            description: 'Remove a user from the ticket blacklist (staff only)',
            options: [
                { name: 'user', description: 'User to unblacklist', type: 6, required: true }
            ]
        }
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        if (GUILD_ID) {
            await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
            console.log(`✅ Commands registered INSTANTLY to guild ${GUILD_ID}: ${commands.map(c => '/' + c.name).join(', ')}`);
        } else {
            await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
            console.log(`✅ Global commands registered: ${commands.map(c => '/' + c.name).join(', ')} (can take up to 1 hour to appear everywhere)`);
        }

        if (OWNER_GUILD_ID) {
            const ownerCommands = [
                {
                    name: 'block',
                    description: 'Owner only: block the bot from a server',
                    options: [
                        { name: 'server', description: 'Search by name or paste a server ID', type: 3, required: true, autocomplete: true },
                        { name: 'reason', description: 'Reason for blocking', type: 3, required: false }
                    ]
                },
                {
                    name: 'unblock',
                    description: 'Owner only: unblock a previously blocked server',
                    options: [
                        { name: 'server', description: 'Pick from currently blocked servers', type: 3, required: true, autocomplete: true }
                    ]
                }
            ];
            // If your private server also happens to be GUILD_ID above, merge instead of
            // overwriting — a guild's command list is fully replaced by each PUT call.
            const body = GUILD_ID === OWNER_GUILD_ID ? [...commands, ...ownerCommands] : ownerCommands;
            await rest.put(Routes.applicationGuildCommands(client.user.id, OWNER_GUILD_ID), { body });
            console.log(`✅ Owner-only commands (/block, /unblock) registered ONLY to server ${OWNER_GUILD_ID}`);
        }
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
});

// If the bot is ever re-added to a blocked server, leave immediately without responding
// to anything in the meantime.
client.on('guildCreate', async (guild) => {
    if (blockedGuilds[guild.id]) {
        console.log(`Auto-leaving blocked server ${guild.name} (${guild.id})`);
        await guild.leave().catch(err => console.error('Could not leave blocked guild:', err));
    }
});

client.on('interactionCreate', async (interaction) => {
    // Blocked guilds get silently ignored entirely — belt-and-suspenders alongside the
    // guildCreate auto-leave, in case leave() hasn't completed yet.
    if (interaction.guild && blockedGuilds[interaction.guild.id]) return;

    // Autocomplete for /block and /unblock's "server" option — only ever reachable from
    // OWNER_GUILD_ID since that's the only place these commands are registered.
    if (interaction.isAutocomplete()) {
        if (interaction.commandName !== 'block' && interaction.commandName !== 'unblock') return;
        if (!isOwnerContext(interaction)) return interaction.respond([]);

        const focused = interaction.options.getFocused().toLowerCase();
        const pool = interaction.commandName === 'unblock'
            ? Object.entries(blockedGuilds).map(([id, info]) => ({ id, name: info.name || id }))
            : client.guilds.cache.map(g => ({ id: g.id, name: g.name }));

        const filtered = pool
            .filter(g => g.name.toLowerCase().includes(focused) || g.id.includes(focused))
            .slice(0, 25);

        return interaction.respond(filtered.map(g => ({ name: `${g.name} (${g.id})`.slice(0, 100), value: g.id })));
    }

    if (interaction.isChatInputCommand() && (interaction.commandName === 'block' || interaction.commandName === 'unblock')) {
        if (!isOwnerContext(interaction)) {
            // Deliberately vague — these commands should never be visible outside your
            // private server anyway, but don't confirm/deny anything if that ever changes.
            return interaction.reply({ content: '❌ Unknown command.', ephemeral: true });
        }

        const targetId = interaction.options.getString('server');
        const targetGuild = client.guilds.cache.get(targetId);

        if (interaction.commandName === 'block') {
            const reason = interaction.options.getString('reason') || 'No reason given';
            blockedGuilds[targetId] = {
                name: targetGuild ? targetGuild.name : 'Unknown (bot not currently in this server)',
                blockedAt: new Date().toISOString(),
                reason
            };
            saveBlocklist();

            let note = '';
            if (targetGuild) {
                await targetGuild.leave().catch(err => console.error('Failed to leave guild:', err));
                note = ' The bot has left that server.';
            } else {
                note = " The bot isn't currently in that server — it'll auto-leave if it's ever re-added.";
            }
            return interaction.reply({ content: `🚫 Blocked **${blockedGuilds[targetId].name}** (\`${targetId}\`). Reason: ${reason}.${note}`, ephemeral: true });
        }

        if (interaction.commandName === 'unblock') {
            if (!blockedGuilds[targetId]) {
                return interaction.reply({ content: 'That server is not currently blocked.', ephemeral: true });
            }
            const name = blockedGuilds[targetId].name;
            delete blockedGuilds[targetId];
            saveBlocklist();
            return interaction.reply({ content: `✅ Unblocked **${name}** (\`${targetId}\`). It can be re-added and used normally again.`, ephemeral: true });
        }
        return;
    }

    try {
        const guildConfig = interaction.guild ? getGuildConfig(interaction.guild.id) : null;

        // -----------------------------------------------------------------
        // SLASH COMMANDS
        // -----------------------------------------------------------------
        if (interaction.isChatInputCommand()) {
            const { commandName, channel, guild, user, member } = interaction;

            if (commandName === 'sendpanels') {
                await sendTicketPanels(channel, guildConfig);
                return interaction.reply({ content: '✅ Panels sent to this channel!', ephemeral: true });
            }

            if (commandName === 'setup') {
                const typeKey = interaction.options.getString('type') || 'REDFIELD';
                try {
                    const testTicket = await createTicketChannel(guild, user, typeKey, 'Automated test ticket from /setup', null, guildConfig);
                    await testTicket.send(`🤖 **[TEST BOT]**: This is an automatically created working test ticket.`);
                    await testTicket.send(`👤 **${user.username}**: Testing ticket messages and web archiving system!`);
                    return interaction.reply({ content: `✅ Test ticket channel created: ${testTicket}.`, ephemeral: true });
                } catch (err) {
                    console.error('[/setup] failed:', err);
                    return interaction.reply({ content: `❌ Could not create the test ticket: ${err.message}`, ephemeral: true });
                }
            }

            if (commandName === 'configure') {
                if (!isStaff(member, guildConfig)) {
                    return interaction.reply({ content: '❌ Only staff can use this command.', ephemeral: true });
                }
                return interaction.reply({ embeds: [configSummaryEmbed(guildConfig)], components: [configMainMenu()], ephemeral: true });
            }

            if (commandName === 'config-site') {
                if (!isStaff(member, guildConfig)) {
                    return interaction.reply({ content: '❌ Only staff can use this command.', ephemeral: true });
                }
                return interaction.reply({ embeds: [siteSummaryEmbed(guildConfig)], components: [siteMainMenu()], ephemeral: true });
            }

            // Slash-command equivalents of the ticket buttons — same rules, same permission
            // checks, so it doesn't matter whether staff use the buttons or type the command.
            if (commandName === 'claim') {
                if (!openTickets.has(channel.id)) return interaction.reply({ content: "This isn't an open ticket channel.", ephemeral: true });
                if (!isStaff(member, guildConfig)) return interaction.reply({ content: '❌ Only staff can claim tickets.', ephemeral: true });

                const ticket = openTickets.get(channel.id);
                if (ticket.claimedBy) {
                    return interaction.reply({ content: `❌ Already claimed by **${ticket.claimedBy.tag}**. They need to /unclaim first.`, ephemeral: true });
                }
                ticket.claimedBy = { id: user.id, tag: user.tag };

                if (ticket.welcomeMessageId) {
                    try {
                        const msg = await channel.messages.fetch(ticket.welcomeMessageId);
                        const updatedEmbed = EmbedBuilder.from(msg.embeds[0]).setFields(
                            msg.embeds[0].fields.map(f => f.name === 'Status' ? { name: 'Status', value: `🟡 Claimed by ${user.tag}`, inline: true } : f)
                        );
                        await msg.edit({ embeds: [updatedEmbed], components: buildTicketButtons(true) });
                    } catch (err) {
                        console.error('Could not update ticket embed on /claim:', err.message);
                    }
                }
                return interaction.reply(`🙋 **${user.tag}** is handling this ticket now.`);
            }

            if (commandName === 'unclaim') {
                if (!openTickets.has(channel.id)) return interaction.reply({ content: "This isn't an open ticket channel.", ephemeral: true });
                if (!isStaff(member, guildConfig)) return interaction.reply({ content: '❌ Only staff can unclaim tickets.', ephemeral: true });

                const ticket = openTickets.get(channel.id);
                if (!ticket.claimedBy) return interaction.reply({ content: '⚠️ This ticket is not currently claimed.', ephemeral: true });
                if (ticket.claimedBy.id !== user.id && !member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.reply({ content: `❌ Only **${ticket.claimedBy.tag}** (or an Administrator) can unclaim this.`, ephemeral: true });
                }
                ticket.claimedBy = null;

                if (ticket.welcomeMessageId) {
                    try {
                        const msg = await channel.messages.fetch(ticket.welcomeMessageId);
                        const updatedEmbed = EmbedBuilder.from(msg.embeds[0]).setFields(
                            msg.embeds[0].fields.map(f => f.name === 'Status' ? { name: 'Status', value: '🟢 Open', inline: true } : f)
                        );
                        await msg.edit({ embeds: [updatedEmbed], components: buildTicketButtons(false) });
                    } catch (err) {
                        console.error('Could not update ticket embed on /unclaim:', err.message);
                    }
                }
                return interaction.reply(`↩️ **${user.tag}** unclaimed this ticket.`);
            }

            if (commandName === 'close') {
                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                if (!ticket) return interaction.reply({ content: "This isn't an open ticket channel.", ephemeral: true });

                const canClose = isStaff(member, guildConfig) || (guildConfig.allowOpenerClose && ticket.userId === user.id);
                if (!canClose) return interaction.reply({ content: '❌ You are not allowed to close this ticket.', ephemeral: true });

                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('confirm_close').setLabel('Confirm Close').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('cancel_close').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                );
                return interaction.reply({ content: `⚠️ Close this ticket? It will archive to the website and ${guildConfig.archiveAction === 'lock' ? 'lock' : 'delete'} in ${guildConfig.closeDelaySeconds}s.`, components: [confirmRow] });
            }

            if (commandName === 'request-close') {
                if (!isStaff(member, guildConfig)) return interaction.reply({ content: '❌ Only staff can request a close.', ephemeral: true });

                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                if (!ticket || !ticket.userId) {
                    return interaction.reply({ content: "⚠️ Could not identify the ticket opener — either this isn't a ticket channel, or the bot restarted since it opened. Use /close instead.", ephemeral: true });
                }

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('opener_close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
                    new ButtonBuilder().setCustomId('opener_keep_open_ticket').setLabel('Keep Open').setStyle(ButtonStyle.Secondary).setEmoji('↩️')
                );
                return interaction.reply({ content: `📨 <@${ticket.userId}>, staff has requested this ticket be closed. Only you can respond below.`, components: [row] });
            }

            if (commandName === 'blacklist') {
                if (!isStaff(member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
                const targetUser = interaction.options.getUser('user');
                const reason = interaction.options.getString('reason') || 'No reason given';
                guildConfig.blacklistedUsers[targetUser.id] = { tag: targetUser.tag, reason, blacklistedAt: new Date().toISOString(), blacklistedBy: user.tag };
                saveConfigs();
                return interaction.reply({ content: `🚫 Blacklisted **${targetUser.tag}** from opening tickets. Reason: ${reason}`, ephemeral: true });
            }

            if (commandName === 'unblacklist') {
                if (!isStaff(member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
                const targetUser = interaction.options.getUser('user');
                if (!guildConfig.blacklistedUsers[targetUser.id]) {
                    return interaction.reply({ content: 'That user is not currently blacklisted.', ephemeral: true });
                }
                delete guildConfig.blacklistedUsers[targetUser.id];
                saveConfigs();
                return interaction.reply({ content: `✅ Removed **${targetUser.tag}** from the ticket blacklist.`, ephemeral: true });
            }
            return;
        }

        // -----------------------------------------------------------------
        // MAIN /config-site SELECT MENU
        // -----------------------------------------------------------------
        if (interaction.isStringSelectMenu() && interaction.customId === 'sitesettings_menu') {
            if (!isStaff(interaction.member, guildConfig)) {
                return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
            }
            const value = interaction.values[0];

            if (value === 'password') {
                const modal = new ModalBuilder().setCustomId('sitecfg_password_modal').setTitle('Website Access Password');
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('password').setLabel('New password').setStyle(TextInputStyle.Short).setValue(siteConfig.password).setRequired(true).setMaxLength(64)
                ));
                return interaction.showModal(modal);
            }

            if (value === 'autodelete') {
                const modal = new ModalBuilder().setCustomId('sitecfg_autodelete_modal').setTitle('Ticket Auto-Delete Delay');
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('minutes').setLabel('Minutes before a closed ticket archives').setStyle(TextInputStyle.Short).setValue(`${Math.max(1, Math.round(guildConfig.closeDelaySeconds / 60))}`).setRequired(true)
                ));
                return interaction.showModal(modal);
            }

            if (value === 'banner') {
                const modal = new ModalBuilder().setCustomId('sitecfg_banner_modal').setTitle('Website Announcement Banner');
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('bannerText').setLabel('Banner text (blank = hidden)').setStyle(TextInputStyle.Short).setValue(siteConfig.bannerText || '').setRequired(false).setMaxLength(200)
                ));
                return interaction.showModal(modal);
            }

            if (value === 'sitetitle') {
                const modal = new ModalBuilder().setCustomId('sitecfg_title_modal').setTitle('Website Header Title');
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('siteTitle').setLabel('Site title').setStyle(TextInputStyle.Short).setValue(siteConfig.siteTitle).setRequired(true).setMaxLength(100)
                ));
                return interaction.showModal(modal);
            }

            if (value === 'accentcolor') {
                const modal = new ModalBuilder().setCustomId('sitecfg_accent_modal').setTitle('Primary Theme Accent Color');
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('accentColor').setLabel('Hex color, e.g. #2ecc71').setStyle(TextInputStyle.Short).setValue(siteConfig.accentColor).setRequired(true).setMaxLength(7)
                ));
                return interaction.showModal(modal);
            }

            if (value === 'footernote') {
                const modal = new ModalBuilder().setCustomId('sitecfg_footer_modal').setTitle('Website Footer Note (Bonus)');
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('footerNote').setLabel('Extra footer line (blank = hidden)').setStyle(TextInputStyle.Short).setValue(siteConfig.footerNote || '').setRequired(false).setMaxLength(150)
                ));
                return interaction.showModal(modal);
            }

            if (value === 'pausetickets') {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('sitecfg_pause_enable').setLabel('Pause Ticket Creation').setStyle(guildConfig.ticketsPaused ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('sitecfg_pause_disable').setLabel('Resume Ticket Creation').setStyle(!guildConfig.ticketsPaused ? ButtonStyle.Success : ButtonStyle.Secondary)
                );
                return interaction.update({
                    content: guildConfig.ticketsPaused
                        ? `⏸️ Tickets are currently **paused**. Message shown: "${guildConfig.pausedMessage}"`
                        : '▶️ Tickets are currently open. Pausing does NOT close existing tickets — it only blocks new ones and shows your message instead.',
                    embeds: [], components: [row]
                });
            }
            return;
        }

        // -----------------------------------------------------------------
        // /config-site BUTTONS (pause/resume)
        // -----------------------------------------------------------------
        if (interaction.isButton() && (interaction.customId === 'sitecfg_pause_enable' || interaction.customId === 'sitecfg_pause_disable')) {
            if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });

            if (interaction.customId === 'sitecfg_pause_disable') {
                guildConfig.ticketsPaused = false;
                saveConfigs();
                return interaction.update({ content: '▶️ Ticket creation resumed. Panel buttons work normally again.', components: [] });
            }

            const modal = new ModalBuilder().setCustomId('sitecfg_pause_modal').setTitle('Pause Message');
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('pausedMessage').setLabel('Message shown when someone opens a ticket').setStyle(TextInputStyle.Paragraph).setValue(guildConfig.pausedMessage).setRequired(true).setMaxLength(300)
            ));
            return interaction.showModal(modal);
        }


        // -----------------------------------------------------------------
        if (interaction.isStringSelectMenu() && interaction.customId === 'config_menu') {
            if (!isStaff(interaction.member, guildConfig)) {
                return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
            }
            const value = interaction.values[0];

            if (value.startsWith('panel_')) {
                const typeKey = value.replace('panel_', '');
                const panel = guildConfig.panels[typeKey];
                const modal = new ModalBuilder().setCustomId(`config_panel_modal_${typeKey}`).setTitle(`Edit ${typeKey} Panel`);
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Panel title').setStyle(TextInputStyle.Short).setValue(panel.title).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Panel description').setStyle(TextInputStyle.Paragraph).setValue(panel.description).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('buttonLabel').setLabel('Button text').setStyle(TextInputStyle.Short).setValue(panel.buttonLabel).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('emoji').setLabel('Button emoji (e.g. 🛡️ or blank)').setStyle(TextInputStyle.Short).setValue(panel.emoji || '').setRequired(false)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('promptLabel').setLabel('Question asked in the ticket modal').setStyle(TextInputStyle.Short).setValue(panel.promptLabel).setRequired(true))
                );
                return interaction.showModal(modal);
            }

            if (value === 'general') {
                const modal = new ModalBuilder().setCustomId('config_general_modal').setTitle('General Settings');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('maxTickets').setLabel('Max open tickets per user (1-20)').setStyle(TextInputStyle.Short).setValue(`${guildConfig.maxTicketsPerUser}`).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('closeDelay').setLabel('Seconds to wait before archiving').setStyle(TextInputStyle.Short).setValue(`${guildConfig.closeDelaySeconds}`).setRequired(true))
                );
                return interaction.showModal(modal);
            }

            if (value === 'archiveaction') {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('config_archive_delete').setLabel('Delete channel after archiving').setStyle(guildConfig.archiveAction === 'delete' ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('config_archive_lock').setLabel('Lock channel instead of deleting').setStyle(guildConfig.archiveAction === 'lock' ? ButtonStyle.Success : ButtonStyle.Secondary)
                );
                return interaction.update({ content: 'Choose what happens to a ticket channel after it archives to the website:', embeds: [], components: [row] });
            }

            if (value === 'openerclose') {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('config_openerclose_yes').setLabel('Yes, openers can close').setStyle(guildConfig.allowOpenerClose ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('config_openerclose_no').setLabel('No, staff only').setStyle(!guildConfig.allowOpenerClose ? ButtonStyle.Success : ButtonStyle.Secondary)
                );
                return interaction.update({ content: 'Should the person who opened a ticket be able to press "Close Ticket" themselves?', embeds: [], components: [row] });
            }

            if (value === 'staffroles') {
                const row = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder().setCustomId('config_staffroles_select').setPlaceholder('Select staff roles').setMinValues(0).setMaxValues(10)
                );
                return interaction.update({ content: 'Select the role(s) that count as staff:', embeds: [], components: [row] });
            }

            if (value === 'logchannel') {
                const row = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder().setCustomId('config_logchannel_select').setPlaceholder('Select a log channel').addChannelTypes(ChannelType.GuildText)
                );
                return interaction.update({ content: 'Select the channel where closed-ticket logs should be posted:', embeds: [], components: [row] });
            }
            return;
        }

        // -----------------------------------------------------------------
        // ROLE / CHANNEL SELECT MENUS
        // -----------------------------------------------------------------
        if (interaction.isRoleSelectMenu() && interaction.customId === 'config_staffroles_select') {
            if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
            guildConfig.staffRoleIds = interaction.values;
            saveConfigs();
            return interaction.update({ content: `✅ Staff roles updated: ${interaction.values.map(id => `<@&${id}>`).join(', ') || 'none'}`, components: [] });
        }

        if (interaction.isChannelSelectMenu() && interaction.customId === 'config_logchannel_select') {
            if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
            guildConfig.logChannelId = interaction.values[0];
            saveConfigs();
            return interaction.update({ content: `✅ Log channel set to <#${interaction.values[0]}>`, components: [] });
        }

        // -----------------------------------------------------------------
        // BUTTONS
        // -----------------------------------------------------------------
        if (interaction.isButton()) {
            const { customId, guild, user, member, channel } = interaction;

            if (customId === 'config_archive_delete' || customId === 'config_archive_lock') {
                if (!isStaff(member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
                guildConfig.archiveAction = customId === 'config_archive_delete' ? 'delete' : 'lock';
                saveConfigs();
                return interaction.update({ content: `✅ Archive behavior set to **${guildConfig.archiveAction}**.`, components: [] });
            }

            if (customId === 'config_openerclose_yes' || customId === 'config_openerclose_no') {
                if (!isStaff(member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
                guildConfig.allowOpenerClose = customId === 'config_openerclose_yes';
                saveConfigs();
                return interaction.update({ content: `✅ Ticket openers ${guildConfig.allowOpenerClose ? 'CAN now' : 'can NOT'} close their own tickets.`, components: [] });
            }

            if (customId.startsWith('open_ticket_')) {
                const typeKey = customId.replace('open_ticket_', '');
                const panel = guildConfig.panels[typeKey];
                if (!panel) return;

                if (guildConfig.blacklistedUsers[user.id]) {
                    return interaction.reply({ content: `🚫 You're blocked from opening tickets. Reason: ${guildConfig.blacklistedUsers[user.id].reason}`, ephemeral: true });
                }

                if (guildConfig.ticketsPaused) {
                    return interaction.reply({ content: `⏸️ ${guildConfig.pausedMessage}`, ephemeral: true });
                }

                const existingId = findExistingTicket(guild.id, user.id, typeKey);
                if (existingId) {
                    return interaction.reply({ content: `You already have an open ${panel.buttonLabel} ticket: <#${existingId}>`, ephemeral: true });
                }
                if (countUserTickets(guild.id, user.id) >= guildConfig.maxTicketsPerUser) {
                    return interaction.reply({ content: `❌ You've reached the max of ${guildConfig.maxTicketsPerUser} open tickets. Close one before opening another.`, ephemeral: true });
                }

                try {
                    return await interaction.showModal(ticketModal(typeKey, panel));
                } catch (err) {
                    console.error(`[showModal failed] type=${typeKey}:`, err);
                    return interaction.reply({ content: `❌ Couldn't open the ticket form: ${err.message}`, ephemeral: true });
                }
            }

            if (customId === 'claim_ticket') {
                if (!isStaff(member, guildConfig)) return interaction.reply({ content: '❌ Only staff can claim tickets.', ephemeral: true });

                let ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                if (!ticket) return interaction.reply({ content: "⚠️ Could not find this ticket's data.", ephemeral: true });
                openTickets.set(channel.id, ticket);

                if (ticket.claimedBy) {
                    return interaction.reply({ content: `❌ Already claimed by **${ticket.claimedBy.tag}**. They need to Unclaim first.`, ephemeral: true });
                }

                ticket.claimedBy = { id: user.id, tag: user.tag };
                const oldEmbed = interaction.message.embeds[0];
                const updatedEmbed = EmbedBuilder.from(oldEmbed).setFields(
                    oldEmbed.fields.map(f => f.name === 'Status' ? { name: 'Status', value: `🟡 Claimed by ${user.tag}`, inline: true } : f)
                );
                await interaction.update({ embeds: [updatedEmbed], components: buildTicketButtons(true) });
                return channel.send(`🙋 **${user.tag}** is handling this ticket now.`);
            }

            if (customId === 'unclaim_ticket') {
                if (!isStaff(member, guildConfig)) return interaction.reply({ content: '❌ Only staff can unclaim tickets.', ephemeral: true });

                const ticket = openTickets.get(channel.id);
                if (!ticket || !ticket.claimedBy) {
                    return interaction.reply({ content: '⚠️ This ticket is not currently claimed.', ephemeral: true });
                }
                if (ticket.claimedBy.id !== user.id && !member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.reply({ content: `❌ Only **${ticket.claimedBy.tag}** (or an Administrator) can unclaim this.`, ephemeral: true });
                }

                ticket.claimedBy = null;
                const oldEmbed = interaction.message.embeds[0];
                const updatedEmbed = EmbedBuilder.from(oldEmbed).setFields(
                    oldEmbed.fields.map(f => f.name === 'Status' ? { name: 'Status', value: '🟢 Open', inline: true } : f)
                );
                await interaction.update({ embeds: [updatedEmbed], components: buildTicketButtons(false) });
                return channel.send(`↩️ **${user.tag}** unclaimed this ticket.`);
            }

            // Normal close — staff always allowed; opener allowed only if configured.
            if (customId === 'close_ticket') {
                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                const canClose = isStaff(member, guildConfig) || (guildConfig.allowOpenerClose && ticket && ticket.userId === user.id);
                if (!canClose) {
                    return interaction.reply({ content: '❌ You are not allowed to close this ticket.', ephemeral: true });
                }

                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('confirm_close').setLabel('Confirm Close').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('cancel_close').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                );
                return interaction.reply({ content: `⚠️ Close this ticket? It will archive to the website and ${guildConfig.archiveAction === 'lock' ? 'lock' : 'delete'} in ${guildConfig.closeDelaySeconds}s.`, components: [confirmRow] });
            }

            if (customId === 'cancel_close') {
                return interaction.update({ content: '✅ Close cancelled — this ticket stays open.', components: [] });
            }

            if (customId === 'confirm_close') {
                let ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                const canClose = isStaff(member, guildConfig) || (guildConfig.allowOpenerClose && ticket && ticket.userId === user.id);
                if (!canClose) return interaction.reply({ content: '❌ You are not allowed to close this ticket.', ephemeral: true });

                if (ticket && ticket.closing) return interaction.reply({ content: '⏳ Already closing.', ephemeral: true });
                if (ticket) { ticket.closing = true; openTickets.set(channel.id, ticket); }

                await interaction.update({ content: `🔒 Closing in ${guildConfig.closeDelaySeconds}s. Saved to the website only.`, components: [] });
                setTimeout(() => finalizeTicketClose(channel, guild, guildConfig, user.tag), guildConfig.closeDelaySeconds * 1000);
                return;
            }

            // Force Close — staff only, no confirmation, immediate.
            if (customId === 'force_close_ticket') {
                if (!isStaff(member, guildConfig)) return interaction.reply({ content: '❌ Only staff can force close a ticket.', ephemeral: true });

                let ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                if (ticket && ticket.closing) return interaction.reply({ content: '⏳ Already closing.', ephemeral: true });
                if (ticket) { ticket.closing = true; openTickets.set(channel.id, ticket); }

                await interaction.reply({ content: `⛔ **${user.tag}** force-closed this ticket. Archiving now...` });
                await finalizeTicketClose(channel, guild, guildConfig, user.tag);
                return;
            }

            // Request Close — staff only. Posts a button only the ORIGINAL OPENER can press.
            if (customId === 'request_close_ticket') {
                if (!isStaff(member, guildConfig)) return interaction.reply({ content: '❌ Only staff can request a close.', ephemeral: true });

                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                if (!ticket || !ticket.userId) {
                    return interaction.reply({ content: '⚠️ Could not identify the original ticket opener (bot may have restarted). Use Force Close instead.', ephemeral: true });
                }

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('opener_close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
                    new ButtonBuilder().setCustomId('opener_keep_open_ticket').setLabel('Keep Open').setStyle(ButtonStyle.Secondary).setEmoji('↩️')
                );
                return interaction.reply({ content: `📨 <@${ticket.userId}>, staff has requested this ticket be closed. Only you can respond below.`, components: [row] });
            }

            // Both buttons shown by Request Close — opener only, staff blocked on purpose.
            if (customId === 'opener_keep_open_ticket') {
                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                if (!ticket || ticket.userId !== user.id) {
                    return interaction.reply({ content: '❌ Only the ticket opener can respond to this request.', ephemeral: true });
                }
                return interaction.update({ content: `↩️ **${user.tag}** chose to keep this ticket open.`, components: [] });
            }

            if (customId === 'opener_close_ticket') {
                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                if (!ticket || ticket.userId !== user.id) {
                    return interaction.reply({ content: '❌ Only the ticket opener can respond to this request.', ephemeral: true });
                }
                if (ticket.closing) return interaction.reply({ content: '⏳ Already closing.', ephemeral: true });
                ticket.closing = true;
                openTickets.set(channel.id, ticket);

                await interaction.update({ content: `🔒 Closing in ${guildConfig.closeDelaySeconds}s. Saved to the website only.`, components: [] });
                setTimeout(() => finalizeTicketClose(channel, guild, guildConfig, user.tag), guildConfig.closeDelaySeconds * 1000);
                return;
            }
        }

        // -----------------------------------------------------------------
        // MODAL SUBMIT
        // -----------------------------------------------------------------
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'sitecfg_password_modal') {
                if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
                const newPassword = interaction.fields.getTextInputValue('password').trim();
                if (!newPassword) return interaction.reply({ content: '❌ Password cannot be blank.', ephemeral: true });
                siteConfig.password = newPassword;
                saveSiteConfig();
                return interaction.reply({ content: '✅ Website password updated. Anyone already logged in stays logged in until their cookie expires (24h) or they clear it.', ephemeral: true });
            }

            if (interaction.customId === 'sitecfg_autodelete_modal') {
                if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
                const minutes = parseInt(interaction.fields.getTextInputValue('minutes'), 10);
                if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
                    return interaction.reply({ content: '❌ Must be a whole number of minutes between 1 and 1440 (24 hours).', ephemeral: true });
                }
                guildConfig.closeDelaySeconds = minutes * 60;
                saveConfigs();
                return interaction.reply({ content: `✅ Closed tickets now auto-archive after ${minutes} minute(s).`, ephemeral: true });
            }

            if (interaction.customId === 'sitecfg_banner_modal') {
                if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
                siteConfig.bannerText = interaction.fields.getTextInputValue('bannerText').trim();
                saveSiteConfig();
                return interaction.reply({ content: siteConfig.bannerText ? `✅ Banner set: "${siteConfig.bannerText}"` : '✅ Banner cleared.', ephemeral: true });
            }

            if (interaction.customId === 'sitecfg_title_modal') {
                if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
                const title = interaction.fields.getTextInputValue('siteTitle').trim();
                if (!title) return interaction.reply({ content: '❌ Title cannot be blank.', ephemeral: true });
                siteConfig.siteTitle = title;
                saveSiteConfig();
                return interaction.reply({ content: `✅ Website title set to "${title}".`, ephemeral: true });
            }

            if (interaction.customId === 'sitecfg_accent_modal') {
                if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
                const color = interaction.fields.getTextInputValue('accentColor').trim();
                if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
                    return interaction.reply({ content: '❌ Must be a 6-digit hex color like #2ecc71. Not saved.', ephemeral: true });
                }
                siteConfig.accentColor = color;
                saveSiteConfig();
                return interaction.reply({ content: `✅ Accent color set to ${color}.`, ephemeral: true });
            }

            if (interaction.customId === 'sitecfg_footer_modal') {
                if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
                siteConfig.footerNote = interaction.fields.getTextInputValue('footerNote').trim();
                saveSiteConfig();
                return interaction.reply({ content: siteConfig.footerNote ? `✅ Footer note set: "${siteConfig.footerNote}"` : '✅ Footer note cleared.', ephemeral: true });
            }

            if (interaction.customId === 'sitecfg_pause_modal') {
                if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
                const pausedMessage = interaction.fields.getTextInputValue('pausedMessage').trim();
                if (!pausedMessage) return interaction.reply({ content: '❌ Message cannot be blank.', ephemeral: true });
                guildConfig.ticketsPaused = true;
                guildConfig.pausedMessage = pausedMessage;
                saveConfigs();
                return interaction.reply({ content: `⏸️ Ticket creation paused. Anyone clicking a panel button now sees: "${pausedMessage}"`, ephemeral: true });
            }

            if (interaction.customId.startsWith('ticket_modal_')) {
                const typeKey = interaction.customId.replace('ticket_modal_', '');
                const panel = guildConfig.panels[typeKey];
                if (!panel) return;

                if (guildConfig.blacklistedUsers[interaction.user.id]) {
                    return interaction.reply({ content: `🚫 You're blocked from opening tickets. Reason: ${guildConfig.blacklistedUsers[interaction.user.id].reason}`, ephemeral: true });
                }

                const reason = interaction.fields.getTextInputValue('reason');
                let robloxUsername = '';
                try { robloxUsername = interaction.fields.getTextInputValue('robloxUsername'); } catch { /* optional field */ }

                const lockKey = `${interaction.guild.id}:${interaction.user.id}:${typeKey}`;
                if (pendingCreations.has(lockKey) || findExistingTicket(interaction.guild.id, interaction.user.id, typeKey)) {
                    return interaction.reply({ content: '⚠️ A ticket is already open or being created for you. Please wait.', ephemeral: true });
                }
                if (countUserTickets(interaction.guild.id, interaction.user.id) >= guildConfig.maxTicketsPerUser) {
                    return interaction.reply({ content: `❌ You've reached the max of ${guildConfig.maxTicketsPerUser} open tickets.`, ephemeral: true });
                }

                pendingCreations.add(lockKey);
                try {
                    const ticketChannel = await createTicketChannel(interaction.guild, interaction.user, typeKey, reason, robloxUsername, guildConfig);
                    await interaction.reply({ content: `✅ Ticket created: ${ticketChannel}`, ephemeral: true });
                } catch (err) {
                    console.error(`[ticket creation failed] type=${typeKey} user=${interaction.user.tag}:`, err);
                    await interaction.reply({ content: `❌ Couldn't create your ticket: ${err.message}\n\nPlease tell staff so they can check the bot's permissions.`, ephemeral: true });
                } finally {
                    pendingCreations.delete(lockKey);
                }
                return;
            }

            if (interaction.customId.startsWith('config_panel_modal_')) {
                if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
                const typeKey = interaction.customId.replace('config_panel_modal_', '');
                const emoji = interaction.fields.getTextInputValue('emoji').trim();

                if (emoji && !isValidEmoji(emoji)) {
                    return interaction.reply({ content: `❌ "${emoji}" isn't a valid emoji — not saved. Try a standard emoji or one from this server.`, ephemeral: true });
                }

                const promptLabel = interaction.fields.getTextInputValue('promptLabel');
                const buttonLabel = interaction.fields.getTextInputValue('buttonLabel');
                // These two hit Discord's actual field-length limits when the ticket modal opens —
                // reject up front instead of saving something that breaks ticket creation later.
                if (promptLabel.length > 45) {
                    return interaction.reply({ content: `❌ The modal question must be 45 characters or fewer (yours is ${promptLabel.length}). Not saved.`, ephemeral: true });
                }
                if (buttonLabel.length > 80) {
                    return interaction.reply({ content: `❌ Button text must be 80 characters or fewer (yours is ${buttonLabel.length}). Not saved.`, ephemeral: true });
                }

                guildConfig.panels[typeKey] = {
                    ...guildConfig.panels[typeKey],
                    title: clamp(interaction.fields.getTextInputValue('title'), 256),
                    description: clamp(interaction.fields.getTextInputValue('description'), 4096),
                    buttonLabel,
                    emoji,
                    promptLabel
                };
                saveConfigs();
                return interaction.reply({ content: `✅ ${typeKey} panel updated. Run /sendpanels again to repost it.`, ephemeral: true });
            }

            if (interaction.customId === 'config_general_modal') {
                if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
                const maxTickets = parseInt(interaction.fields.getTextInputValue('maxTickets'), 10);
                const closeDelay = parseInt(interaction.fields.getTextInputValue('closeDelay'), 10);

                if (!Number.isInteger(maxTickets) || maxTickets < 1 || maxTickets > 20) {
                    return interaction.reply({ content: '❌ Max tickets per user must be a whole number between 1 and 20.', ephemeral: true });
                }
                if (!Number.isInteger(closeDelay) || closeDelay < 5 || closeDelay > 86400) {
                    return interaction.reply({ content: '❌ Close delay must be a whole number of seconds between 5 and 86400 (24 hours).', ephemeral: true });
                }

                guildConfig.maxTicketsPerUser = maxTickets;
                guildConfig.closeDelaySeconds = closeDelay;
                saveConfigs();
                return interaction.reply({ content: `✅ Max tickets per user: ${maxTickets}. Close delay: ${closeDelay}s.`, ephemeral: true });
            }
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Something went wrong. Please try again or contact staff.', ephemeral: true }).catch(() => {});
        }
    }
});

client.login(process.env.DISCORD_TOKEN);