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

// Strips any trailing slash(es) so links built as `${getWebsiteUrl()}/transcript/...` never
// end up with a double slash (which Express's router treats as an unmatched path).
function getWebsiteUrl() {
    // Render automatically sets RENDER_EXTERNAL_URL to the service's real public URL — using
    // it as a fallback means transcript links still work correctly even if WEBSITE_URL never
    // got set manually, instead of silently defaulting to localhost.
    const url = process.env.WEBSITE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3002';
    return url.replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// PERSISTENCE
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
const ARCHIVE_FILE = path.join(DATA_DIR, 'archivedTickets.json');
const CONFIG_FILE = path.join(DATA_DIR, 'guildConfigs.json');
const SITE_CONFIG_FILE = path.join(DATA_DIR, 'siteConfig.json');
const BLOCKLIST_FILE = path.join(DATA_DIR, 'blockedGuilds.json');
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.json');
const QUICKWORDS_FILE = path.join(DATA_DIR, 'quickWords.json');
const AUDIT_LOG_FILE = path.join(DATA_DIR, 'auditLog.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Audit Logging System
let auditLogs = [];
try {
    if (fs.existsSync(AUDIT_LOG_FILE)) {
        auditLogs = JSON.parse(fs.readFileSync(AUDIT_LOG_FILE, 'utf8'));
    }
} catch (err) {
    console.error('Could not load audit log, starting fresh:', err);
}
function logAudit(action, actor, details) {
    auditLogs.unshift({
        id: crypto.randomBytes(6).toString('hex'),
        action,
        actor,
        details,
        timestamp: new Date().toISOString()
    });
    if (auditLogs.length > 500) auditLogs.length = 500;
    try {
        fs.writeFileSync(AUDIT_LOG_FILE, JSON.stringify(auditLogs, null, 2));
    } catch (err) {
        console.error('Failed to save audit log:', err);
    }
}

// Feedback Persistence
let feedbackData = [];
try {
    if (fs.existsSync(FEEDBACK_FILE)) {
        feedbackData = JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8'));
    }
} catch (err) {
    console.error('Could not load feedback, starting fresh:', err);
}
function saveFeedback() {
    try {
        fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(feedbackData, null, 2));
    } catch (err) {
        console.error('Failed to save feedback:', err);
    }
}

// Quick Words Persistence
let quickWordsData = { global: [], personal: {} };
try {
    if (fs.existsSync(QUICKWORDS_FILE)) {
        quickWordsData = JSON.parse(fs.readFileSync(QUICKWORDS_FILE, 'utf8'));
    }
} catch (err) {
    console.error('Could not load quick words, starting fresh:', err);
}
function saveQuickWords() {
    try {
        fs.writeFileSync(QUICKWORDS_FILE, JSON.stringify(quickWordsData, null, 2));
    } catch (err) {
        console.error('Failed to save quick words:', err);
    }
}

// ---------------------------------------------------------------------------
// OWNER-ONLY BLOCK SYSTEM
// ---------------------------------------------------------------------------
const OWNER_GUILD_ID = process.env.OWNER_GUILD_ID || null;
const OWNER_USER_ID = process.env.OWNER_USER_ID || null;

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
        footerNote: '',
        maintenanceMode: false,
        maintenanceMessage: "We're doing some maintenance on the ticket archive. Back shortly."
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

// Wraps a page route so a missing/misnamed view file produces a plain-English
// message ("settings.html not found — did you upload it to views/?") instead
// of a bare {"error":"Internal Server Error"} with no clue what broke.
function sendTemplate(req, res, filePath) {
    if (!fs.existsSync(filePath)) {
        console.error(`[view missing] ${filePath} does not exist`);
        return res.status(500).send(
            `<pre style="font-family:monospace;padding:24px;color:#e05a3a;white-space:pre-wrap;">` +
            `Missing view file: ${escapeHtml(filePath)}\n\n` +
            `This page can't render because that file isn't on the server. Check:\n` +
            `  1. The file actually exists in your views/ folder\n` +
            `  2. The filename is lowercase and spelled exactly right (Linux is case-sensitive)\n` +
            `  3. You restarted the bot process after adding/replacing it` +
            `</pre>`
        );
    }
    try {
        res.send(renderTemplate(filePath));
    } catch (err) {
        console.error(`[view render error] ${filePath}:`, err);
        res.status(500).send(`<pre style="font-family:monospace;padding:24px;color:#e05a3a;white-space:pre-wrap;">Error rendering ${escapeHtml(filePath)}:\n${escapeHtml(err.message)}</pre>`);
    }
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
                promptLabel: 'What do you need help with?',
                categoryName: 'GENERAL TICKETS',
                teamRoleIds: [],
                restrictToTeamOnly: false
            },
            MANAGEMENT: {
                title: 'Management',
                description: 'This panel is for assistance required by Management!\n\nOnly open a ticket if you require the following:\n• Have a staff report (reporting a moderator)\n\n**Do not** open this ticket to ask for mod or to report players.',
                buttonLabel: 'Management Support',
                emoji: '📋',
                style: 'Primary',
                color: 0x5865f2,
                promptLabel: 'Describe the situation you want to report',
                categoryName: 'MANAGEMENT TICKETS',
                teamRoleIds: [],
                restrictToTeamOnly: false
            },
            BUG: {
                title: 'Bug Report',
                description: 'This panel is for reporting bugs found on Redfield!\n\nOnly open a ticket if you require the following:\n• Reporting a bug\n\n**Do not** open this ticket to ask for mod.',
                buttonLabel: 'Bug Report',
                emoji: '🐛',
                style: 'Secondary',
                color: 0xf1c40f,
                promptLabel: 'Describe the bug (steps to reproduce)',
                categoryName: 'BUG TICKETS',
                teamRoleIds: [],
                restrictToTeamOnly: false
            }
        },
        maxTicketsPerUser: 3,
        closeDelaySeconds: 60,
        archiveAction: 'lock',
        allowOpenerClose: false,
        ticketsPaused: false,
        pausedMessage: 'Ticket creation is temporarily paused. Please try again later.',
        blacklistedUsers: {},
        staffRoleIds: [],
        adminRoleIds: [],
        logChannelId: null,
        tags: [],
        staffPermissions: {
            allowedTabs: ['archive', 'tickets', 'panels', 'tags', 'moderation', 'blacklist'],
            canModerate: true
        }
    };
}

function getGuildConfig(guildId) {
    const saved = guildConfigs[guildId] || {};
    const def = defaultConfig();
    const merged = { ...def, ...saved };

    merged.panels = {};
    for (const key of Object.keys(def.panels)) {
        merged.panels[key] = { ...def.panels[key], ...((saved.panels && saved.panels[key]) || {}) };
        if (!Array.isArray(merged.panels[key].teamRoleIds)) merged.panels[key].teamRoleIds = [];
    }
    merged.staffRoleIds = Array.isArray(saved.staffRoleIds) ? saved.staffRoleIds : def.staffRoleIds;
    merged.adminRoleIds = Array.isArray(saved.adminRoleIds) ? saved.adminRoleIds : def.adminRoleIds;
    merged.tags = Array.isArray(saved.tags) ? saved.tags : def.tags;

    const savedPerms = saved.staffPermissions || {};
    merged.staffPermissions = {
        allowedTabs: Array.isArray(savedPerms.allowedTabs) ? savedPerms.allowedTabs : def.staffPermissions.allowedTabs,
        canModerate: typeof savedPerms.canModerate === 'boolean' ? savedPerms.canModerate : def.staffPermissions.canModerate
    };

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

// Persisted the same way archivedTickets is — a bot restart used to wipe
// this entirely, silently defeating max-tickets-per-user and orphaning the
// opener-ID tracking that Close, Close With Reason, and /closerequest all depend on.
const OPEN_TICKETS_FILE = path.join(DATA_DIR, 'openTickets.json');
let openTickets = new Map();
try {
    if (fs.existsSync(OPEN_TICKETS_FILE)) {
        openTickets = new Map(Object.entries(JSON.parse(fs.readFileSync(OPEN_TICKETS_FILE, 'utf8'))));
    }
} catch (err) {
    console.error('Could not load open tickets, starting fresh:', err);
}
function saveOpenTickets() {
    try {
        fs.writeFileSync(OPEN_TICKETS_FILE, JSON.stringify(Object.fromEntries(openTickets), null, 2));
    } catch (err) {
        console.error('Failed to save open tickets:', err);
    }
}
const pendingCreations = new Set();
// Tracks the auto-close timer for a pending /closerequest, keyed by channel
// ID, so an opener's Accept/Deny response (or a new /closerequest) can
// cancel the previous timer. In-memory only — like openTickets, a bot
// restart forgets any pending auto-close and it just won't fire.
const closeRequestTimers = new Map();

// Moderation notes/warnings — persisted per-user, independent of Discord's
// own audit log (which the bot can't write custom entries into anyway).
const MOD_NOTES_FILE = path.join(DATA_DIR, 'moderationNotes.json');
let moderationNotes = new Map(); // userId -> [{ id, type, content, byName, at }]
try {
    if (fs.existsSync(MOD_NOTES_FILE)) {
        moderationNotes = new Map(Object.entries(JSON.parse(fs.readFileSync(MOD_NOTES_FILE, 'utf8'))));
    }
} catch (err) {
    console.error('Could not load moderation notes, starting fresh:', err);
}
function saveModerationNotes() {
    try {
        fs.writeFileSync(MOD_NOTES_FILE, JSON.stringify(Object.fromEntries(moderationNotes), null, 2));
    } catch (err) {
        console.error('Failed to save moderation notes:', err);
    }
}

// Rolling log of moderation actions taken FROM THE WEBSITE (timeout/kick/ban/
// unban) — there's no per-staff login here, only the shared site password,
// so "byName" is a typed label like the live-ticket sender name: informal,
// not a verified identity. This log exists so at least there's *some*
// visibility into who claimed to do what, even without real accounts.
const MOD_LOG_FILE = path.join(DATA_DIR, 'moderationLog.json');
const MOD_LOG_MAX_ENTRIES = 500;
let moderationLog = [];
try {
    if (fs.existsSync(MOD_LOG_FILE)) {
        moderationLog = JSON.parse(fs.readFileSync(MOD_LOG_FILE, 'utf8'));
    }
} catch (err) {
    console.error('Could not load moderation log, starting fresh:', err);
}
function logModerationAction(action, targetId, targetTag, reason, byName) {
    moderationLog.unshift({ id: crypto.randomBytes(6).toString('hex'), action, targetId, targetTag, reason: reason || null, byName: byName || 'Unknown (via Website)', at: new Date().toISOString() });
    if (moderationLog.length > MOD_LOG_MAX_ENTRIES) moderationLog.length = MOD_LOG_MAX_ENTRIES;
    try {
        fs.writeFileSync(MOD_LOG_FILE, JSON.stringify(moderationLog, null, 2));
    } catch (err) {
        console.error('Failed to save moderation log:', err);
    }
}

// Prefers the verified Discord identity from req.authUser (set by
// requireAuth when logged in via "Sign in with Discord") over whatever name
// the client typed in — real accountability when it's available, informal
// label when it isn't (password login has no per-user identity to fall back on).
function resolveActorName(req) {
    if (req.authUser && req.authUser.id) return req.authUser.name;
    return String(req.body?.byName || '').trim().slice(0, 40) || 'Staff (via Website)';
}

// If the person just kicked/banned/timed-out has a ticket open right now,
// let staff in that channel know immediately rather than have them find out
// later (or not at all) that the person they're helping just got moderated.
async function notifyTicketOfModerationAction(guild, targetUserId, action, reason, byName) {
    const actionLabel = { timeout: 'timed out', kick: 'kicked', ban: 'banned' }[action] || action;
    for (const [channelId, ticket] of openTickets.entries()) {
        if (ticket.userId !== targetUserId || ticket.guildId !== guild.id) continue;
        try {
            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (!channel) continue;
            await channel.send(`⚠️ **Moderation notice:** This ticket's opener was just **${actionLabel}** by **${byName}** (via website).${reason ? `\nReason: ${reason}` : ''}`);
        } catch (err) {
            console.error('Could not notify ticket of moderation action:', err.message);
        }
    }
}

// ---------------------------------------------------------------------------
// EXPRESS WEB SERVER
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

const SESSION_SECONDS = 10 * 60;

// Signs/verifies Discord-login sessions without needing a session store or
// database — the cookie carries its own HMAC, keyed by a secret generated
// once and persisted to disk. This exists purely to support "Sign in with
// Discord" as an ALTERNATIVE to the shared access code, not a replacement —
// the password login still works exactly as before, so a misconfigured
// Discord app can't lock anyone out.
const SESSION_SECRET_FILE = path.join(DATA_DIR, 'sessionSecret.txt');
let SESSION_SECRET;
try {
    if (fs.existsSync(SESSION_SECRET_FILE)) SESSION_SECRET = fs.readFileSync(SESSION_SECRET_FILE, 'utf8').trim();
} catch (err) {
    console.error('Could not read session secret:', err);
}
if (!SESSION_SECRET) {
    SESSION_SECRET = crypto.randomBytes(32).toString('hex');
    try { fs.writeFileSync(SESSION_SECRET_FILE, SESSION_SECRET); } catch (err) { console.error('Could not persist session secret:', err); }
}
function signDiscordSession(payload) {
    const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url');
    return `${b64}.${sig}`;
}
function verifyDiscordSession(token) {
    if (!token || !token.includes('.')) return null;
    const [b64, sig] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url');
    if (sig !== expectedSig) return null;
    try {
        const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
        if (!payload.exp || payload.exp < Date.now()) return null;
        return payload;
    } catch {
        return null;
    }
}
const DISCORD_LOGIN_CONFIGURED = Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);

function lockPageHtml(error, returnTo) {
    const accent = /^#[0-9A-Fa-f]{6}$/.test(siteConfig.accentColor) ? siteConfig.accentColor : '#d69a4e';
    const safeReturn = JSON.stringify((returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')) ? returnTo : '/');
    const errorMessages = {
        1: 'Incorrect code — try again.',
        discord_denied: 'Discord login was cancelled.',
        discord_notstaff: "That Discord account isn't staff on this server.",
        discord_failed: 'Discord login failed — try again or use the access code.'
    };
    const errorText = errorMessages[error] || (error ? errorMessages['1'] : null);
    const discordSection = DISCORD_LOGIN_CONFIGURED ? `
    <a class="discord-btn" href="/auth/discord?returnTo=${encodeURIComponent((returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')) ? returnTo : '/')}">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M20.3 4.4A19.7 19.7 0 0 0 15.6 3l-.3.6a14 14 0 0 1 4 1.6c-2.9-1.4-6.7-1.4-9.6 0a10 10 0 0 1 4-1.6L13.4 3a19.7 19.7 0 0 0-4.7 1.4C5.6 8.6 4.8 12.7 5.2 16.7a19.9 19.9 0 0 0 5.1 2.5l.7-1.1a13 13 0 0 1-2-1c.2-.1.3-.2.5-.3a14 14 0 0 0 11 0l.5.3c-.6.4-1.3.7-2 1l.7 1.1a19.8 19.8 0 0 0 5.1-2.5c.5-4.6-.7-8.7-2.9-12.3ZM9.7 14.3c-.8 0-1.5-.8-1.5-1.7 0-1 .7-1.7 1.5-1.7s1.5.8 1.5 1.7c0 1-.7 1.7-1.5 1.7Zm5.6 0c-.8 0-1.5-.8-1.5-1.7 0-1 .7-1.7 1.5-1.7s1.5.8 1.5 1.7c0 1-.7 1.7-1.5 1.7Z"/></svg>
      Sign in with Discord
    </a>
    <button type="button" class="alt-toggle" id="altToggle">Use access code instead</button>` : '';
    const codeFormOpenStyle = DISCORD_LOGIN_CONFIGURED ? 'display:none;' : '';
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
  button[type=submit]{width:100%;background:var(--amber);border:none;color:#14171a;font-weight:600;padding:11px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:13px;letter-spacing:.05em;text-transform:uppercase;transition:opacity .15s;}
  button[type=submit]:hover{opacity:.9;}
  .err{color:#e05a3a;font-size:11.5px;margin-top:12px;font-weight:600;}
  .hint{font-size:10.5px;color:#4d5257;margin-top:18px;}
  .discord-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;box-sizing:border-box;background:#5865F2;color:#fff;font-weight:600;padding:12px;border-radius:4px;text-decoration:none;font-size:13.5px;margin-bottom:12px;transition:opacity .15s;}
  .discord-btn:hover{opacity:.9;}
  .alt-toggle{display:block;width:100%;background:none;border:none;color:#5b6272;font-family:inherit;font-size:11px;text-decoration:underline;cursor:pointer;padding:4px;margin-bottom:4px;}
  .alt-toggle:hover{color:#9199a8;}
</style></head>
<body>
  <div class="box">
    <div class="lock-icon">🔒</div>
    <h1>${escapeHtml(siteConfig.siteTitle)}</h1>
    <p>This archive is restricted.</p>
    ${discordSection}
    <form id="f" style="${codeFormOpenStyle}">
      <input id="pw" type="password" placeholder="ACCESS CODE" autocomplete="off" />
      <button type="submit">Unlock Archive</button>
    </form>
    ${errorText ? `<div class="err">⚠ ${escapeHtml(errorText)}</div>` : ''}
    <div class="hint">Sessions auto-expire after 10 minutes for security.</div>
  </div>
  <script>
    const toggle = document.getElementById('altToggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const form = document.getElementById('f');
        const showing = form.style.display !== 'none';
        form.style.display = showing ? 'none' : 'block';
        toggle.textContent = showing ? 'Use access code instead' : 'Hide access code';
        if (!showing) document.getElementById('pw').focus();
      });
    }
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

function isRequestAuthed(req) {
    const cookies = parseCookies(req);
    if (cookies.ticketAuth === computeAuthToken(siteConfig.password)) return { name: 'Staff (access code)' };
    const session = verifyDiscordSession(cookies.discordAuth);
    if (session) return { id: session.id, name: session.tag };
    return null;
}

function requireAuth(req, res, next) {
    const authUser = isRequestAuthed(req);
    if (authUser) { req.authUser = authUser; return next(); }
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
    return res.send(lockPageHtml(req.query.err, req.path));
}

function maintenancePageHtml() {
    const accent = /^#[0-9A-Fa-f]{6}$/.test(siteConfig.accentColor) ? siteConfig.accentColor : '#d69a4e';
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(siteConfig.siteTitle)} — Maintenance</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Special+Elite&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --amber: ${accent}; }
  * { box-sizing: border-box; }
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at top, #1a1e22, #14171a);font-family:'IBM Plex Mono',monospace;color:#d9d5c9;padding:20px;}
  .box{background:#1c2023;border:1px solid #2a2f33;border-left:4px solid var(--amber);border-radius:6px;padding:36px 32px;width:320px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.4);}
  .icon{font-size:28px;margin-bottom:10px;}
  h1{font-family:'Special Elite',monospace;font-size:19px;color:#e8e2d0;margin:0 0 12px;letter-spacing:.5px;}
  p{font-size:13px;color:#9ba1a6;margin:0 0 18px;line-height:1.6;}
  input{width:100%;box-sizing:border-box;background:#14171a;border:1px solid #2a2f33;color:#e8e2d0;padding:11px;border-radius:4px;font-family:inherit;font-size:14px;margin-bottom:10px;letter-spacing:0.3em;text-align:center;}
  input:focus{outline:none;border-color:var(--amber);}
  button{width:100%;background:#2a2f33;border:1px solid #3a4045;color:#9ba1a6;font-weight:600;padding:9px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;}
  button:hover{border-color:var(--amber);color:#e8e2d0;}
  .err{color:#e05a3a;font-size:11px;margin-top:10px;}
  .staff-hint{font-size:10px;color:#4d5257;margin-top:16px;}
</style></head>
<body>
  <div class="box">
    <div class="icon">🛠️</div>
    <h1>${escapeHtml(siteConfig.siteTitle)}</h1>
    <p>${escapeHtml(siteConfig.maintenanceMessage)}</p>
    <form id="f">
      <input id="pw" type="password" placeholder="STAFF ACCESS CODE" autocomplete="off" />
      <button type="submit">Staff Login</button>
    </form>
    <div class="staff-hint">Not staff? Nothing to do here — check back soon.</div>
  </div>
  <script>
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('pw').value;
      const res = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ password }) });
      window.location.reload();
    });
  </script>
</body></html>`;
}

function maintenanceGate(req, res, next) {
    if (!siteConfig.maintenanceMode) return next();
    if (isRequestAuthed(req)) return next();
    if (req.path.startsWith('/api/')) return res.status(503).json({ error: 'Under maintenance' });
    return res.status(503).send(maintenancePageHtml());
}

app.post('/api/login', (req, res) => {
    const { password } = req.body || {};
    if (password === siteConfig.password) {
        const expiresAt = Date.now() + SESSION_SECONDS * 1000;
        res.setHeader('Set-Cookie', [
            `ticketAuth=${computeAuthToken(siteConfig.password)}; HttpOnly; Path=/; Max-Age=${SESSION_SECONDS}`,
            `sessionExpires=${expiresAt}; Path=/; Max-Age=${SESSION_SECONDS}`
        ]);
        logAudit('LOGIN', 'Staff User', 'Logged in via access code');
        return res.json({ success: true, expiresAt });
    }
    return res.status(401).json({ success: false });
});

app.get('/auth/discord', (req, res) => {
    if (!DISCORD_LOGIN_CONFIGURED) return res.status(503).send('Discord login is not configured — set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in .env.');
    const returnTo = (req.query.returnTo && req.query.returnTo.startsWith('/') && !req.query.returnTo.startsWith('//')) ? req.query.returnTo : '/';
    const state = crypto.randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', [
        `oauthState=${state}; HttpOnly; Path=/; Max-Age=300`,
        `oauthReturnTo=${encodeURIComponent(returnTo)}; HttpOnly; Path=/; Max-Age=300`
    ]);
    const params = new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        redirect_uri: `${getWebsiteUrl()}/auth/discord/callback`,
        response_type: 'code',
        scope: 'identify',
        state
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

app.get('/auth/discord/callback', async (req, res) => {
    const cookies = parseCookies(req);
    const { code, state, error: oauthError } = req.query;
    const returnTo = cookies.oauthReturnTo ? decodeURIComponent(cookies.oauthReturnTo) : '/';

    if (oauthError) return res.send(lockPageHtml('discord_denied', returnTo));
    if (!DISCORD_LOGIN_CONFIGURED) return res.status(503).send('Discord login is not configured.');
    if (!code || !state || state !== cookies.oauthState) return res.send(lockPageHtml('discord_failed', returnTo));

    try {
        const redirectUri = `${getWebsiteUrl()}/auth/discord/callback`;
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.DISCORD_CLIENT_ID,
                client_secret: process.env.DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri
            })
        });
        if (!tokenRes.ok) throw new Error(`Discord token exchange returned ${tokenRes.status}`);
        const tokenData = await tokenRes.json();

        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        if (!userRes.ok) throw new Error(`Discord user lookup returned ${userRes.status}`);
        const discordUser = await userRes.json();

        const guild = getTargetGuild();
        if (!guild) throw new Error('Bot is not currently in any server');
        const member = await guild.members.fetch(discordUser.id).catch(err => {
            console.error(`[discord oauth] Failed to fetch member ${discordUser.id}:`, err.message);
            return null;
        });
        const guildConfig = getGuildConfig(guild.id);
        if (!member || !isStaff(member, guildConfig)) {
            console.warn(`[discord oauth] Login denied for ${discordUser.username || discordUser.tag} (${discordUser.id}) in guild ${guild.name}`);
            return res.send(lockPageHtml('discord_notstaff', returnTo));
        }

        const expiresAt = Date.now() + SESSION_SECONDS * 1000;
        const session = signDiscordSession({ id: discordUser.id, tag: member.user.tag, exp: expiresAt });
        res.setHeader('Set-Cookie', [
            `discordAuth=${session}; HttpOnly; Path=/; Max-Age=${SESSION_SECONDS}`,
            `sessionExpires=${expiresAt}; Path=/; Max-Age=${SESSION_SECONDS}`,
            'oauthState=; Path=/; Max-Age=0',
            'oauthReturnTo=; Path=/; Max-Age=0'
        ]);
        logAudit('DISCORD_LOGIN', member.user.tag, `Logged in via Discord OAuth2`);
        res.redirect(returnTo);
    } catch (err) {
        console.error('[discord oauth] failed:', err);
        res.send(lockPageHtml('discord_failed', returnTo));
    }
});

function clearAuthCookies(res) {
    res.setHeader('Set-Cookie', [
        'ticketAuth=; Path=/; Max-Age=0',
        'discordAuth=; Path=/; Max-Age=0',
        'sessionExpires=; Path=/; Max-Age=0'
    ]);
}

app.get('/logout', (req, res) => {
    clearAuthCookies(res);
    res.redirect('/');
});

app.post('/api/logout', (req, res) => {
    clearAuthCookies(res);
    res.json({ success: true });
});

app.use((req, res, next) => {
    if (req.path === '/index.html' || req.path === '/transcript.html' || req.path === '/settings.html') return res.status(403).send('Forbidden');
    next();
});
app.use(express.static(path.join(__dirname, 'views'), { index: false }));

function requireAuthOrTicketToken(req, res, next) {
    if (isRequestAuthed(req)) return next();

    const ticket = archivedTickets.get(req.params.id);
    if (ticket && ticket.accessToken && req.query.token && req.query.token === ticket.accessToken) {
        return next();
    }
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
    return res.send(lockPageHtml(req.query.err, req.path));
}

app.get('/', maintenanceGate, requireAuth, (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'index.html')));
app.get('/settings', maintenanceGate, requireAuth, (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'settings.html')));
app.get('/tickets', maintenanceGate, requireAuth, (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'tickets.html')));
app.get('/tickets/:channelId', maintenanceGate, requireAuth, (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'live-ticket.html')));
app.get('/panels', maintenanceGate, requireAuth, (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'panels.html')));
app.get('/blacklist', maintenanceGate, requireAuth, (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'blacklist.html')));
app.get('/tags', maintenanceGate, requireAuth, (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'tags.html')));
app.get('/moderation', maintenanceGate, requireAuth, (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'moderation.html')));
app.get('/moderation/:userId', maintenanceGate, requireAuth, (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'member-detail.html')));
app.get('/transcript/:id', maintenanceGate, requireAuthOrTicketToken, (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'transcript.html')));

app.get('/feedback', maintenanceGate, requireAuth, (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'feedback.html')));
app.get('/quickwords', maintenanceGate, requireAuth, (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'quickwords.html')));
app.get('/audit-log', maintenanceGate, requireAuth, (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'audit-log.html')));

app.get('/api/tickets', maintenanceGate, requireAuth, (req, res) => res.json(Array.from(archivedTickets.values())));
app.get('/api/tickets/:id', maintenanceGate, requireAuthOrTicketToken, (req, res) => {
    const ticket = archivedTickets.get(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Not found' });
    res.json(ticket);
});
app.delete('/api/tickets/:id', requireAuth, (req, res) => {
    if (!archivedTickets.has(req.params.id)) return res.status(404).json({ error: 'Not found' });
    archivedTickets.delete(req.params.id);
    saveArchive();
    logAudit('DELETE_ARCHIVE', resolveActorName(req), `Deleted archive transcript ${req.params.id}`);
    res.json({ success: true });
});

app.post('/api/tickets/:id/tags', maintenanceGate, requireAuth, (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const ticket = archivedTickets.get(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Not found' });

    const guildConfig = getGuildConfig(guild.id);
    const validTagIds = new Set(guildConfig.tags.map(t => t.id));
    const tagIds = Array.isArray(req.body?.tagIds) ? req.body.tagIds.filter(id => validTagIds.has(id)) : [];

    ticket.tags = tagIds;
    archivedTickets.set(req.params.id, ticket);
    saveArchive();
    res.json({ success: true, tags: tagIds });
});

app.get('/api/feedback', maintenanceGate, requireAuth, (req, res) => res.json(feedbackData));
app.get('/api/audit-log', maintenanceGate, requireAuth, (req, res) => res.json(auditLogs));

app.get('/api/quickwords', maintenanceGate, requireAuth, (req, res) => res.json(quickWordsData));
app.post('/api/quickwords', maintenanceGate, requireAuth, (req, res) => {
    const { label, text, isGlobal, userId } = req.body || {};
    if (!label || !text) return res.status(400).json({ error: 'Label and text are required.' });
    
    const entry = { id: crypto.randomBytes(4).toString('hex'), label: label.trim(), text: text.trim() };
    const actor = resolveActorName(req);

    if (isGlobal) {
        quickWordsData.global.push(entry);
        logAudit('CREATE_QUICKWORD_GLOBAL', actor, `Created Global Quick Word: "${label}"`);
    } else if (userId) {
        if (!quickWordsData.personal[userId]) quickWordsData.personal[userId] = [];
        quickWordsData.personal[userId].push(entry);
        logAudit('CREATE_QUICKWORD_PERSONAL', actor, `Created Personal Quick Word: "${label}"`);
    }
    saveQuickWords();
    res.json({ success: true, entry });
});

app.delete('/api/quickwords/:id', maintenanceGate, requireAuth, (req, res) => {
    const { id } = req.params;
    const { userId } = req.body || {};
    const actor = resolveActorName(req);

    let removed = false;
    const origGlobalCount = quickWordsData.global.length;
    quickWordsData.global = quickWordsData.global.filter(q => q.id !== id);
    if (quickWordsData.global.length < origGlobalCount) {
        removed = true;
        logAudit('DELETE_QUICKWORD_GLOBAL', actor, `Deleted Global Quick Word ID ${id}`);
    }

    if (userId && quickWordsData.personal[userId]) {
        quickWordsData.personal[userId] = quickWordsData.personal[userId].filter(q => q.id !== id);
        removed = true;
    }

    saveQuickWords();
    res.json({ success: removed });
});

function getTargetGuild() {
    if (GUILD_ID) {
        const g = client.guilds.cache.get(GUILD_ID);
        if (g) return g;
    }
    return client.guilds.cache.first() || null;
}

app.get('/api/guild', maintenanceGate, requireAuth, async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });

    try {
        await guild.members.fetch(guild.ownerId).catch(() => {});
        const guildConfig = getGuildConfig(guild.id);

        const roles = guild.roles.cache
            .filter(r => r.id !== guild.id)
            .sort((a, b) => b.position - a.position)
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? null : r.hexColor, memberCount: r.members.size }));

        const categories = guild.channels.cache
            .filter(c => c.type === ChannelType.GuildCategory)
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const owner = await guild.fetchOwner().catch(() => null);

        res.json({
            guildId: guild.id,
            guildName: guild.name,
            ownerId: guild.ownerId,
            ownerTag: owner ? owner.user.tag : null,
            roles,
            categories,
            staffRoleIds: guildConfig.staffRoleIds,
            adminRoleIds: guildConfig.adminRoleIds,
            staffPermissions: guildConfig.staffPermissions,
            panels: Object.fromEntries(Object.entries(guildConfig.panels).map(([k, p]) => [k, {
                title: p.title,
                description: p.description,
                buttonLabel: p.buttonLabel,
                emoji: p.emoji || '',
                style: p.style,
                color: '#' + (p.color || 0).toString(16).padStart(6, '0'),
                promptLabel: p.promptLabel,
                categoryName: p.categoryName,
                teamRoleIds: p.teamRoleIds || [],
                restrictToTeamOnly: Boolean(p.restrictToTeamOnly)
            }])),
            blacklistedUsers: guildConfig.blacklistedUsers,
            tags: guildConfig.tags
        });
    } catch (err) {
        console.error('[/api/guild] failed:', err);
        res.status(500).json({ error: 'Could not load server data.' });
    }
});

app.post('/api/guild/permissions', maintenanceGate, requireAuth, (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const guildConfig = getGuildConfig(guild.id);
    const actor = resolveActorName(req);

    if (req.authUser && req.authUser.id) {
        const member = guild.members.cache.get(req.authUser.id);
        if (member && !isAdmin(member, guildConfig)) {
            return res.status(403).json({ error: 'Only Administrators can change staff permissions.' });
        }
    }

    const { allowedTabs, canModerate } = req.body || {};
    const validTabs = ['archive', 'tickets', 'panels', 'tags', 'moderation', 'blacklist'];

    guildConfig.staffPermissions = {
        allowedTabs: Array.isArray(allowedTabs) ? allowedTabs.filter(t => validTabs.includes(t)) : guildConfig.staffPermissions.allowedTabs,
        canModerate: Boolean(canModerate)
    };

    saveConfigs();
    logAudit('UPDATE_PERMISSIONS', actor, `Updated staff dashboard permissions`);
    res.json({ success: true, staffPermissions: guildConfig.staffPermissions });
});

app.post('/api/guild/panels', maintenanceGate, requireAuth, (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const guildConfig = getGuildConfig(guild.id);
    const updates = req.body || {};
    const errors = [];
    const validated = {};

    for (const [typeKey, edit] of Object.entries(updates)) {
        if (!guildConfig.panels[typeKey]) continue;

        const title = String(edit.title || '').trim();
        const description = String(edit.description || '').trim();
        const buttonLabel = String(edit.buttonLabel || '').trim();
        const promptLabel = String(edit.promptLabel || '').trim();
        const emoji = String(edit.emoji || '').trim();
        const style = STYLE_MAP[edit.style] ? edit.style : 'Secondary';
        const colorHex = /^#[0-9A-Fa-f]{6}$/.test(edit.color) ? edit.color : null;
        const teamRoleIds = Array.isArray(edit.teamRoleIds) ? edit.teamRoleIds.filter(id => guild.roles.cache.has(id)) : [];
        const restrictToTeamOnly = Boolean(edit.restrictToTeamOnly);

        if (!title || title.length > 256) errors.push(`${typeKey}: title must be 1-256 characters`);
        if (!description || description.length > 4096) errors.push(`${typeKey}: description must be 1-4096 characters`);
        if (!buttonLabel || buttonLabel.length > 80) errors.push(`${typeKey}: button text must be 1-80 characters`);
        if (!promptLabel || promptLabel.length > 45) errors.push(`${typeKey}: modal question must be 1-45 characters`);
        if (emoji && !isValidEmoji(emoji)) errors.push(`${typeKey}: "${emoji}" isn't a valid emoji`);
        if (!colorHex) errors.push(`${typeKey}: color must be a hex value like #2ecc71`);
        if (restrictToTeamOnly && !teamRoleIds.length) errors.push(`${typeKey}: pick at least one team role before restricting to team-only`);

        validated[typeKey] = { title, description, buttonLabel, promptLabel, emoji, style, colorHex, teamRoleIds, restrictToTeamOnly };
    }

    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    for (const [typeKey, v] of Object.entries(validated)) {
        guildConfig.panels[typeKey] = {
            ...guildConfig.panels[typeKey],
            title: v.title, description: v.description, buttonLabel: v.buttonLabel,
            promptLabel: v.promptLabel, emoji: v.emoji, style: v.style,
            color: parseInt(v.colorHex.slice(1), 16),
            teamRoleIds: v.teamRoleIds,
            restrictToTeamOnly: v.restrictToTeamOnly
        };
    }
    saveConfigs();
    logAudit('UPDATE_PANELS', resolveActorName(req), `Updated support panels`);
    res.json({ success: true });
});

app.post('/api/guild/panels/create', maintenanceGate, requireAuth, (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const guildConfig = getGuildConfig(guild.id);

    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 40) return res.status(400).json({ error: 'Panel name must be 1-40 characters.' });

    const existingKeys = new Set(Object.keys(guildConfig.panels));
    const typeKey = slugifyTypeKey(name, existingKeys);

    guildConfig.panels[typeKey] = {
        title: name,
        description: 'By clicking the button, a ticket will be opened for you.',
        buttonLabel: name,
        emoji: '',
        style: 'Secondary',
        color: 0x5865f2,
        promptLabel: 'What do you need help with?',
        categoryName: 'TICKETS',
        teamRoleIds: [],
        restrictToTeamOnly: false
    };
    saveConfigs();
    logAudit('CREATE_PANEL', resolveActorName(req), `Created panel "${name}" (${typeKey})`);
    res.json({ success: true, typeKey, panel: guildConfig.panels[typeKey] });
});

app.delete('/api/guild/panels/:typeKey', maintenanceGate, requireAuth, (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const guildConfig = getGuildConfig(guild.id);
    const { typeKey } = req.params;

    if (!guildConfig.panels[typeKey]) return res.status(404).json({ error: 'Panel not found.' });
    if (Object.keys(guildConfig.panels).length <= 1) return res.status(400).json({ error: "Can't delete the last remaining panel." });

    delete guildConfig.panels[typeKey];
    saveConfigs();
    logAudit('DELETE_PANEL', resolveActorName(req), `Deleted panel ${typeKey}`);
    res.json({ success: true });
});

app.get('/api/open-tickets', maintenanceGate, requireAuth, (req, res) => {
    const guild = getTargetGuild();
    const list = Array.from(openTickets.entries()).map(([channelId, t]) => ({
        channelId,
        guildId: t.guildId,
        type: t.type,
        userTag: t.userTag,
        robloxUsername: t.robloxUsername,
        reason: t.reason,
        claimedBy: t.claimedBy ? t.claimedBy.tag : null,
        openedAt: t.openedAt,
        closing: Boolean(t.closing),
        tags: Array.isArray(t.tags) ? t.tags : [],
        discordUrl: t.guildId ? `https://discord.com/channels/${t.guildId}/${channelId}` : (guild ? `https://discord.com/channels/${guild.id}/${channelId}` : null)
    }));
    res.json(list);
});

app.post('/api/open-tickets/:channelId/tags', maintenanceGate, requireAuth, (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const ticket = openTickets.get(req.params.channelId);
    if (!ticket) return res.status(404).json({ error: 'That ticket is no longer open.' });

    const guildConfig = getGuildConfig(guild.id);
    const validTagIds = new Set(guildConfig.tags.map(t => t.id));
    const tagIds = Array.isArray(req.body?.tagIds) ? req.body.tagIds.filter(id => validTagIds.has(id)) : [];

    ticket.tags = tagIds;
    openTickets.set(req.params.channelId, ticket);
    saveOpenTickets();
    res.json({ success: true, tags: tagIds });
});

app.get('/api/open-tickets/:channelId/messages', maintenanceGate, requireAuth, async (req, res) => {
    const ticket = openTickets.get(req.params.channelId);
    if (!ticket) return res.status(404).json({ error: 'This ticket is no longer open.' });

    try {
        const channel = await client.channels.fetch(req.params.channelId).catch(() => null);
        if (!channel) return res.status(404).json({ error: "Could not find that channel in Discord." });

        const batch = await channel.messages.fetch({ limit: 100 });
        const messages = Array.from(batch.values()).reverse().map(m => ({
            author: m.author.tag,
            isBot: m.author.bot,
            content: m.content || '',
            attachments: Array.from(m.attachments.values()).map(a => ({ url: a.url, contentType: a.contentType || '' })),
            embedImages: m.embeds.map(e => (e.image && e.image.url) || (e.thumbnail && e.thumbnail.url) || null).filter(Boolean),
            timestamp: m.createdAt
        }));

        res.json({
            ticket: {
                guildId: ticket.guildId || channel.guild?.id || null,
                type: ticket.type,
                userTag: ticket.userTag,
                robloxUsername: ticket.robloxUsername,
                reason: ticket.reason,
                claimedBy: ticket.claimedBy ? ticket.claimedBy.tag : null,
                openedAt: ticket.openedAt,
                closing: Boolean(ticket.closing),
                tags: Array.isArray(ticket.tags) ? ticket.tags : []
            },
            messages
        });
    } catch (err) {
        console.error('[open-ticket messages] failed:', err);
        res.status(500).json({ error: 'Could not fetch messages from Discord.' });
    }
});

app.post('/api/open-tickets/:channelId/messages', maintenanceGate, requireAuth, async (req, res) => {
    const ticket = openTickets.get(req.params.channelId);
    if (!ticket) return res.status(404).json({ error: 'This ticket is no longer open.' });

    const content = String(req.body?.content || '').trim();
    const asName = String(req.body?.asName || '').trim().slice(0, 40);
    if (!content) return res.status(400).json({ error: 'Message cannot be blank.' });
    if (content.length > 1900) return res.status(400).json({ error: 'Message is too long (max 1900 characters).' });

    try {
        const channel = await client.channels.fetch(req.params.channelId).catch(() => null);
        if (!channel) return res.status(404).json({ error: "Could not find channel in Discord." });

        const label = asName ? `**${asName} (via Website):**` : `**Staff (via Website):**`;
        await channel.send(`${label} ${content}`);
        res.json({ success: true });
    } catch (err) {
        console.error('[open-ticket send] failed:', err);
        res.status(500).json({ error: 'Could not send the message.' });
    }
});

app.post('/api/open-tickets/:channelId/close', maintenanceGate, requireAuth, async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const ticket = openTickets.get(req.params.channelId);
    if (!ticket) return res.status(404).json({ error: 'This ticket is already closed.' });
    if (ticket.closing) return res.status(409).json({ error: 'Already closing.' });

    const asName = String(req.body?.asName || '').trim().slice(0, 40) || 'Staff (via Website)';

    try {
        const channel = await client.channels.fetch(req.params.channelId).catch(() => null);
        if (!channel) return res.status(404).json({ error: "Could not find channel in Discord." });

        ticket.closing = true;
        openTickets.set(req.params.channelId, ticket);
        saveOpenTickets();

        const guildConfig = getGuildConfig(guild.id);
        await channel.send(`⛔ **${asName}** closed this ticket from the website. Archiving now...`).catch(() => {});
        await finalizeTicketClose(channel, guild, guildConfig, asName);
        res.json({ success: true });
    } catch (err) {
        console.error('[open-ticket close] failed:', err);
        res.status(500).json({ error: 'Could not close the ticket.' });
    }
});

app.post('/api/guild/tags', maintenanceGate, requireAuth, (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const guildConfig = getGuildConfig(guild.id);

    const name = String(req.body?.name || '').trim();
    const color = /^#[0-9A-Fa-f]{6}$/.test(req.body?.color) ? req.body.color : '#a78bfa';
    if (!name || name.length > 30) return res.status(400).json({ error: 'Tag name must be 1-30 characters.' });
    if (guildConfig.tags.some(t => t.name.toLowerCase() === name.toLowerCase())) {
        return res.status(400).json({ error: `A tag named "${name}" already exists.` });
    }

    const tag = { id: crypto.randomBytes(5).toString('hex'), name, color };
    guildConfig.tags.push(tag);
    saveConfigs();
    logAudit('CREATE_TAG', resolveActorName(req), `Created tag "${name}"`);
    res.json({ success: true, tag });
});

app.delete('/api/guild/tags/:tagId', maintenanceGate, requireAuth, (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const guildConfig = getGuildConfig(guild.id);
    const { tagId } = req.params;

    if (!guildConfig.tags.some(t => t.id === tagId)) return res.status(404).json({ error: 'Tag not found.' });
    guildConfig.tags = guildConfig.tags.filter(t => t.id !== tagId);
    saveConfigs();

    let openChanged = false;
    for (const [channelId, t] of openTickets.entries()) {
        if (Array.isArray(t.tags) && t.tags.includes(tagId)) {
            t.tags = t.tags.filter(id => id !== tagId);
            openTickets.set(channelId, t);
            openChanged = true;
        }
    }
    if (openChanged) saveOpenTickets();

    let archiveChanged = false;
    for (const [ticketId, t] of archivedTickets.entries()) {
        if (Array.isArray(t.tags) && t.tags.includes(tagId)) {
            t.tags = t.tags.filter(id => id !== tagId);
            archivedTickets.set(ticketId, t);
            archiveChanged = true;
        }
    }
    if (archiveChanged) saveArchive();
    logAudit('DELETE_TAG', resolveActorName(req), `Deleted tag ID ${tagId}`);

    res.json({ success: true });
});

app.post('/api/guild/roles', maintenanceGate, requireAuth, (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const { staffRoleIds, adminRoleIds } = req.body || {};
    if (!Array.isArray(staffRoleIds) || !Array.isArray(adminRoleIds)) {
        return res.status(400).json({ error: 'staffRoleIds and adminRoleIds must be arrays.' });
    }
    const guildConfig = getGuildConfig(guild.id);
    guildConfig.staffRoleIds = staffRoleIds.filter(id => guild.roles.cache.has(id));
    guildConfig.adminRoleIds = adminRoleIds.filter(id => guild.roles.cache.has(id));
    saveConfigs();
    logAudit('UPDATE_ROLES', resolveActorName(req), `Updated staff & admin role assignments`);
    res.json({ success: true });
});

app.post('/api/guild/categories', maintenanceGate, requireAuth, (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const guildConfig = getGuildConfig(guild.id);
    const updates = req.body || {};
    for (const [typeKey, categoryName] of Object.entries(updates)) {
        if (!guildConfig.panels[typeKey]) continue;
        const trimmed = String(categoryName || '').trim().toUpperCase();
        if (trimmed) guildConfig.panels[typeKey].categoryName = trimmed;
    }
    saveConfigs();
    logAudit('UPDATE_CATEGORIES', resolveActorName(req), `Updated ticket categories`);
    res.json({ success: true });
});

app.get('/api/guild/members', maintenanceGate, requireAuth, async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const query = (req.query.query || '').toLowerCase().trim();
    if (query.length < 2) return res.json([]);
    try {
        const found = await guild.members.fetch({ query, limit: 10 });
        res.json(found.map(m => ({ id: m.id, tag: m.user.tag, displayName: m.displayName })));
    } catch (err) {
        res.json([]);
    }
});

// ---------------------------------------------------------------------------
// MODERATION API
// ---------------------------------------------------------------------------
function serializeMember(guild, m) {
    const notes = moderationNotes.get(m.id) || [];
    return {
        id: m.id,
        tag: m.user.tag,
        displayName: m.displayName,
        joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
        roles: m.roles.cache.filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position).map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? null : r.hexColor, isAdmin: r.permissions.has(PermissionFlagsBits.Administrator) })),
        isTimedOut: Boolean(m.communicationDisabledUntil && m.communicationDisabledUntil.getTime() > Date.now()),
        isOwner: m.id === guild.ownerId,
        noteCount: notes.length,
        warningCount: notes.filter(n => n.type === 'warning').length
    };
}

app.get('/api/moderation/members', maintenanceGate, requireAuth, async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const query = (req.query.query || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const after = req.query.after || undefined;

    try {
        let members = query ? await guild.members.fetch({ query, limit }) : await guild.members.list({ limit, after });
        const list = members.map(m => serializeMember(guild, m));
        const nextAfter = (!query && members.size === limit) ? members.last().id : null;
        res.json({ members: list, nextAfter, totalMemberCount: guild.memberCount });
    } catch (err) {
        console.error('[moderation members] failed:', err);
        res.status(500).json({ error: 'Could not fetch members from Discord.' });
    }
});

app.get('/api/moderation/members/:userId', maintenanceGate, requireAuth, async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    try {
        const member = await guild.members.fetch(req.params.userId).catch(() => null);
        if (!member) return res.status(404).json({ error: 'That member is no longer in the server.' });
        const guildConfig = getGuildConfig(guild.id);
        res.json({
            ...serializeMember(guild, member),
            avatarURL: member.displayAvatarURL({ size: 64 }),
            createdAt: member.user.createdAt.toISOString(),
            timeoutUntil: member.communicationDisabledUntil ? member.communicationDisabledUntil.toISOString() : null,
            notes: moderationNotes.get(req.params.userId) || [],
            allGuildRoles: guild.roles.cache.filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position).map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? null : r.hexColor, isAdmin: r.permissions.has(PermissionFlagsBits.Administrator) })),
            isStaff: isStaff(member, guildConfig),
            staffRoleIds: guildConfig.staffRoleIds || [],
            adminRoleIds: guildConfig.adminRoleIds || []
        });
    } catch (err) {
        console.error('[moderation member detail] failed:', err);
        res.status(500).json({ error: 'Could not fetch that member.' });
    }
});

app.post('/api/moderation/members/:userId/notes', maintenanceGate, requireAuth, (req, res) => {
    const type = req.body?.type === 'warning' ? 'warning' : 'note';
    const content = String(req.body?.content || '').trim();
    const byName = resolveActorName(req);
    if (!content || content.length > 500) return res.status(400).json({ error: 'Note must be 1-500 characters.' });
    const list = moderationNotes.get(req.params.userId) || [];
    const note = { id: crypto.randomBytes(5).toString('hex'), type, content, byName, at: new Date().toISOString() };
    list.push(note);
    moderationNotes.set(req.params.userId, list);
    saveModerationNotes();
    logAudit('ADD_NOTE', byName, `Added ${type} to user ID ${req.params.userId}`);
    res.json({ success: true, note });
});

app.delete('/api/moderation/members/:userId/notes/:noteId', maintenanceGate, requireAuth, (req, res) => {
    const list = moderationNotes.get(req.params.userId) || [];
    const filtered = list.filter(n => n.id !== req.params.noteId);
    if (filtered.length === list.length) return res.status(404).json({ error: 'Note not found.' });
    if (filtered.length) moderationNotes.set(req.params.userId, filtered);
    else moderationNotes.delete(req.params.userId);
    saveModerationNotes();
    logAudit('DELETE_NOTE', resolveActorName(req), `Deleted note ID ${req.params.noteId} for user ${req.params.userId}`);
    res.json({ success: true });
});

app.post('/api/moderation/members/:userId/nickname', maintenanceGate, requireAuth, async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const nickname = String(req.body?.nickname || '').trim().slice(0, 32);
    const byName = resolveActorName(req);

    try {
        const member = await guild.members.fetch(req.params.userId).catch(() => null);
        if (!member) return res.status(404).json({ error: 'That member is no longer in the server.' });
        if (member.id === guild.ownerId) return res.status(400).json({ error: "Can't change the server owner's nickname." });
        await member.setNickname(nickname || null, `Changed from website by ${byName}`);
        res.json({ success: true, nickname: nickname || null });
    } catch (err) {
        console.error('[moderation nickname] failed:', err);
        res.status(500).json({ error: `Could not change nickname. (${err.message})` });
    }
});

app.post('/api/moderation/members/:userId/roles', maintenanceGate, requireAuth, async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const addRoleId = req.body?.add;
    const removeRoleId = req.body?.remove;
    const byName = resolveActorName(req);
    if (!addRoleId && !removeRoleId) return res.status(400).json({ error: 'Nothing to change.' });

    try {
        const member = await guild.members.fetch(req.params.userId).catch(() => null);
        if (!member) return res.status(404).json({ error: 'That member is no longer in the server.' });

        if (addRoleId) {
            if (!guild.roles.cache.has(addRoleId)) return res.status(400).json({ error: 'That role no longer exists.' });
            await member.roles.add(addRoleId, `Added from website by ${byName}`);
        }
        if (removeRoleId) {
            await member.roles.remove(removeRoleId, `Removed from website by ${byName}`);
        }
        res.json({ success: true, roles: member.roles.cache.filter(r => r.id !== guild.id).map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? null : r.hexColor })) });
    } catch (err) {
        console.error('[moderation roles] failed:', err);
        res.status(500).json({ error: `Could not update roles. (${err.message})` });
    }
});

app.post('/api/moderation/members/:userId/timeout', maintenanceGate, requireAuth, async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const minutes = Number.isFinite(req.body?.minutes) ? req.body.minutes : null;
    const reason = String(req.body?.reason || '').trim().slice(0, 400);
    const byName = resolveActorName(req);

    try {
        const member = await guild.members.fetch(req.params.userId).catch(() => null);
        if (!member) return res.status(404).json({ error: 'That member is no longer in the server.' });
        if (member.id === guild.ownerId) return res.status(400).json({ error: "Can't timeout the server owner." });

        const ms = minutes ? Math.min(Math.max(minutes, 1), 40320) * 60 * 1000 : null;
        await member.timeout(ms, reason || undefined);
        logModerationAction(ms ? 'timeout' : 'timeout_clear', member.id, member.user.tag, reason, byName);
        logAudit('TIMEOUT', byName, `${ms ? `Timed out` : 'Cleared timeout for'} ${member.user.tag} (${minutes || 0}m)`);
        if (ms) notifyTicketOfModerationAction(guild, member.id, 'timeout', reason, byName);
        res.json({ success: true });
    } catch (err) {
        console.error('[moderation timeout] failed:', err);
        res.status(500).json({ error: `Could not update timeout. (${err.message})` });
    }
});

app.post('/api/moderation/members/:userId/kick', maintenanceGate, requireAuth, async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const reason = String(req.body?.reason || '').trim();
    const byName = resolveActorName(req);
    if (!reason) return res.status(400).json({ error: 'A reason is required.' });

    try {
        const member = await guild.members.fetch(req.params.userId).catch(() => null);
        if (!member) return res.status(404).json({ error: 'That member is no longer in the server.' });
        if (member.id === guild.ownerId) return res.status(400).json({ error: "Can't kick the server owner." });
        const tag = member.user.tag;
        await member.kick(reason);
        logModerationAction('kick', req.params.userId, tag, reason, byName);
        logAudit('KICK', byName, `Kicked ${tag} (Reason: ${reason})`);
        notifyTicketOfModerationAction(guild, req.params.userId, 'kick', reason, byName);
        res.json({ success: true });
    } catch (err) {
        console.error('[moderation kick] failed:', err);
        res.status(500).json({ error: `Could not kick member. (${err.message})` });
    }
});

app.post('/api/moderation/members/:userId/ban', maintenanceGate, requireAuth, async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const reason = String(req.body?.reason || '').trim();
    const byName = resolveActorName(req);
    const deleteMessageDays = Math.min(Math.max(parseInt(req.body?.deleteMessageDays, 10) || 0, 0), 7);
    if (!reason) return res.status(400).json({ error: 'A reason is required.' });
    if (req.params.userId === guild.ownerId) return res.status(400).json({ error: "Can't ban the server owner." });

    try {
        let tag = req.params.userId;
        const member = await guild.members.fetch(req.params.userId).catch(() => null);
        if (member) tag = member.user.tag;
        await guild.members.ban(req.params.userId, { reason, deleteMessageSeconds: deleteMessageDays * 86400 });
        logModerationAction('ban', req.params.userId, tag, reason, byName);
        logAudit('BAN', byName, `Banned ${tag} (Reason: ${reason})`);
        notifyTicketOfModerationAction(guild, req.params.userId, 'ban', reason, byName);
        res.json({ success: true });
    } catch (err) {
        console.error('[moderation ban] failed:', err);
        res.status(500).json({ error: `Could not ban member. (${err.message})` });
    }
});

app.get('/api/moderation/bans', maintenanceGate, requireAuth, async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    try {
        const bans = await guild.bans.fetch();
        res.json(bans.map(b => ({ id: b.user.id, tag: b.user.tag, reason: b.reason || null })));
    } catch (err) {
        console.error('[moderation bans list] failed:', err);
        res.status(500).json({ error: 'Could not fetch the ban list.' });
    }
});

app.delete('/api/moderation/bans/:userId', maintenanceGate, requireAuth, async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const reason = String(req.body?.reason || '').trim();
    const byName = resolveActorName(req);
    try {
        await guild.members.unban(req.params.userId, reason || undefined);
        logModerationAction('unban', req.params.userId, req.params.userId, reason, byName);
        logAudit('UNBAN', byName, `Unbanned user ${req.params.userId}`);
        res.json({ success: true });
    } catch (err) {
        console.error('[moderation unban] failed:', err);
        res.status(500).json({ error: `Could not unban: ${err.message}` });
    }
});

app.get('/api/moderation/log', maintenanceGate, requireAuth, (req, res) => {
    res.json(moderationLog.slice(0, 100));
});

app.post('/api/guild/blacklist', maintenanceGate, requireAuth, (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const { userId, tag, reason } = req.body || {};
    if (!userId || !tag) return res.status(400).json({ error: 'userId and tag are required.' });
    const guildConfig = getGuildConfig(guild.id);
    guildConfig.blacklistedUsers[userId] = { tag, reason: reason || 'No reason given', blacklistedAt: new Date().toISOString(), blacklistedBy: 'Website' };
    saveConfigs();
    logAudit('BLACKLIST_USER', resolveActorName(req), `Blacklisted ${tag} (${userId})`);
    res.json({ success: true });
});

app.delete('/api/guild/blacklist/:userId', maintenanceGate, requireAuth, (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const guildConfig = getGuildConfig(guild.id);
    if (!guildConfig.blacklistedUsers[req.params.userId]) return res.status(404).json({ error: 'Not found' });
    delete guildConfig.blacklistedUsers[req.params.userId];
    saveConfigs();
    logAudit('UNBLACKLIST_USER', resolveActorName(req), `Unblacklisted ${req.params.userId}`);
    res.json({ success: true });
});

app.use((err, req, res, next) => {
    console.error(`[web error] ${req.method} ${req.path}:`, err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(process.env.PORT || 3002, () => {
    console.log(`🌐 Web Dashboard running at ${getWebsiteUrl()} (locked with access code)`);
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

function clamp(str, max) { if (!str) return str; return str.length > max ? str.slice(0, max - 1) + '…' : str; }
function sanitizeForChannelName(input) { return input.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'user'; }
function slugifyTypeKey(name, existingKeys) {
    let base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'PANEL';
    let key = base; let n = 2;
    while (existingKeys.has(key)) { key = `${base}_${n}`.slice(0, 24); n++; }
    return key;
}

function isAdmin(member, guildConfig) {
    if (!member) return false;
    if (member.guild && member.id === member.guild.ownerId) return true;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    return guildConfig.adminRoleIds.some(roleId => member.roles.cache.has(roleId));
}

function isStaff(member, guildConfig) {
    if (!member) return false;
    if (isAdmin(member, guildConfig)) return true;
    return guildConfig.staffRoleIds.some(roleId => member.roles.cache.has(roleId));
}

function isValidEmoji(emoji) {
    try {
        new ButtonBuilder().setCustomId('test').setLabel('t').setStyle(ButtonStyle.Secondary).setEmoji(emoji);
        return true;
    } catch { return false; }
}

function findExistingTicket(guildId, userId, typeKey) {
    for (const [channelId, data] of openTickets.entries()) {
        if (data.guildId === guildId && data.userId === userId && data.type === typeKey) return channelId;
    }
    return null;
}

function countUserTickets(guildId, userId) {
    let count = 0;
    for (const data of openTickets.values()) { if (data.guildId === guildId && data.userId === userId) count++; }
    return count;
}

function recoverTicketFromTopic(channel) {
    const withId = (channel.topic || '').match(/Ticket for (.+?) \((\d+)\) · Type: (\w+)/);
    if (withId) {
        return { guildId: channel.guild.id, userId: withId[2], username: null, userTag: withId[1], type: withId[3], reason: 'Unknown', robloxUsername: null, openedAt: null, claimedBy: null, closing: false };
    }
    const legacy = (channel.topic || '').match(/Ticket for (.+?) · Type: (\w+)/);
    if (!legacy) return null;
    return { guildId: channel.guild.id, userId: null, username: null, userTag: legacy[1], type: legacy[2], reason: 'Unknown', robloxUsername: null, openedAt: null, claimedBy: null, closing: false };
}

function buildTicketButtons(claimed) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
        new ButtonBuilder().setCustomId('ticket_close_with_reason').setLabel('Close With Reason').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
        new ButtonBuilder().setCustomId('ticket_quickwords').setLabel('Quick Words').setStyle(ButtonStyle.Secondary).setEmoji('⚡')
    );
    if (claimed) {
        row.addComponents(new ButtonBuilder().setCustomId('unclaim_ticket').setLabel('Unclaim').setStyle(ButtonStyle.Secondary).setEmoji('↩️'));
    } else {
        row.addComponents(new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success).setEmoji('🎫'));
    }
    return [row];
}

function withUpdatedClaimRow(existingComponents, claimed) {
    const [freshRow] = buildTicketButtons(claimed);
    const rest = Array.isArray(existingComponents) ? existingComponents.slice(1) : [];
    return [freshRow, ...rest];
}

async function fetchAllMessages(channel, maxMessages = 2000) {
    let all = []; let before;
    while (all.length < maxMessages) {
        const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        if (batch.size === 0) break;
        all.push(...batch.values());
        before = batch.last().id;
        if (batch.size < 100) break;
    }
    return all.reverse().map(m => ({
        author: m.author.tag, content: m.content || '',
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
        const websiteUrl = getWebsiteUrl();

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
            messages: messagesArray,
            tags: Array.isArray(meta.tags) ? meta.tags : []
        });
        saveArchive();

        // Exact Close Embed Matching Reference Layout
        const closeEmbed = new EmbedBuilder()
            .setAuthor({ name: guild.name, iconURL: guild.iconURL() })
            .setTitle('Ticket Closed')
            .setColor(0x2ecc71)
            .addFields(
                { name: '# Ticket ID', value: `${channel.id.slice(-6)}`, inline: true },
                { name: '✅ Opened By', value: `<@${meta.userId || '0'}>`, inline: true },
                { name: '🚫 Closed By', value: `${closedByTag}`, inline: true },
                { name: '⏰ Open Time', value: meta.openedAt ? new Date(meta.openedAt).toLocaleString() : 'Recently', inline: true },
                { name: '👤 Claimed By', value: meta.claimedBy ? `<@${meta.claimedBy.id}>` : 'Unclaimed', inline: true },
                { name: '❓ Reason', value: meta.reason || 'User has been handled, thank you for reporting!' }
            )
            .setFooter({ text: new Date().toLocaleString() });

        const transcriptRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel('View Online Transcript').setStyle(ButtonStyle.Link).setURL(`${websiteUrl}/transcript/${channel.id}?token=${accessToken}`).setEmoji('📁')
        );

        const feedbackRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`feedback_1_${channel.id}`).setLabel('1').setStyle(ButtonStyle.Danger).setEmoji('⭐'),
            new ButtonBuilder().setCustomId(`feedback_2_${channel.id}`).setLabel('2').setStyle(ButtonStyle.Danger).setEmoji('⭐'),
            new ButtonBuilder().setCustomId(`feedback_3_${channel.id}`).setLabel('3').setStyle(ButtonStyle.Primary).setEmoji('⭐'),
            new ButtonBuilder().setCustomId(`feedback_4_${channel.id}`).setLabel('4').setStyle(ButtonStyle.Success).setEmoji('⭐'),
            new ButtonBuilder().setCustomId(`feedback_5_${channel.id}`).setLabel('5').setStyle(ButtonStyle.Success).setEmoji('⭐')
        );

        if (guildConfig.logChannelId) {
            const logChannel = await guild.channels.fetch(guildConfig.logChannelId).catch(() => null);
            if (logChannel) await logChannel.send({ embeds: [closeEmbed], components: [transcriptRow, feedbackRow] });
        }

        if (meta.userId) {
            try {
                const user = await client.users.fetch(meta.userId);
                await user.send({ embeds: [closeEmbed], components: [transcriptRow, feedbackRow] });
            } catch (e) {}
        }

        openTickets.delete(channel.id);
        saveOpenTickets();

        if (guildConfig.archiveAction === 'lock') {
            await channel.setName(`closed-${channel.name}`.slice(0, 100)).catch(() => {});
            if (meta.userId) await channel.permissionOverwrites.edit(meta.userId, { SendMessages: false }).catch(() => {});
            await channel.send('🔒 This ticket is archived on the website and locked. It will not be deleted.').catch(() => {});
        } else {
            await channel.delete().catch(() => {});
        }
    } catch (error) {
        console.error('Error archiving ticket channel:', error);
    }
}

function clearCloseRequestTimer(channelId) {
    const existing = closeRequestTimers.get(channelId);
    if (existing) { clearTimeout(existing); closeRequestTimers.delete(channelId); }
}

function scheduleCloseRequestAutoClose(channel, guild, guildConfig, hours, requestedByTag) {
    clearCloseRequestTimer(channel.id);
    const ms = hours * 60 * 60 * 1000;
    const timer = setTimeout(async () => {
        closeRequestTimers.delete(channel.id);
        const ticket = openTickets.get(channel.id);
        if (!ticket || ticket.closing) return;
        ticket.closing = true;
        openTickets.set(channel.id, ticket);
        saveOpenTickets();
        await channel.send(`⏱️ No response after ${hours} hour${hours === 1 ? '' : 's'} — auto-closing per **${requestedByTag}**'s close request.`).catch(() => {});
        await finalizeTicketClose(channel, guild, guildConfig, `Auto-close (requested by ${requestedByTag})`);
    }, ms);
    closeRequestTimers.set(channel.id, timer);
}

async function createTicketChannel(guild, user, typeKey, reason, robloxUsername, guildConfig) {
    const panel = guildConfig.panels[typeKey];
    const categoryName = (panel.categoryName || 'TICKETS').toUpperCase();

    let ticketCategory = guild.channels.cache.find(c => c.name.toUpperCase() === categoryName && c.type === ChannelType.GuildCategory);
    if (!ticketCategory) ticketCategory = await guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory });

    const validStaffRoleIds = guildConfig.staffRoleIds.filter(id => guild.roles.cache.has(id));
    const validPanelTeamRoleIds = (panel.teamRoleIds || []).filter(id => guild.roles.cache.has(id));
    const pingAndAccessRoleIds = panel.restrictToTeamOnly ? validPanelTeamRoleIds : [...new Set([...validStaffRoleIds, ...validPanelTeamRoleIds])];

    const permissionOverwrites = [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
    ];
    for (const roleId of pingAndAccessRoleIds) {
        permissionOverwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    }

    const channelName = `${typeKey.toLowerCase()}-${sanitizeForChannelName(user.username)}`;
    const ticketChannel = await guild.channels.create({
        name: channelName, type: ChannelType.GuildText, parent: ticketCategory.id,
        topic: `Ticket for ${user.tag} (${user.id}) · Type: ${typeKey}`, permissionOverwrites
    });

    openTickets.set(ticketChannel.id, {
        guildId: guild.id, userId: user.id, username: user.username, userTag: user.tag, type: typeKey,
        reason: reason || 'No reason provided', robloxUsername: robloxUsername || null, openedAt: new Date().toISOString(), claimedBy: null, closing: false, welcomeMessageId: null, tags: []
    });

    const staffMention = pingAndAccessRoleIds.map(id => `<@&${id}>`).join(' ');
    const welcomeEmbed = new EmbedBuilder()
        .setColor(panel.color)
        .setTitle(`${panel.buttonLabel} · Ticket Opened`)
        .setThumbnail(user.displayAvatarURL())
        .setDescription(`Thank you for contacting support.\nPlease describe your issue and wait for a response.\n\n**Reason given:**\n${reason || '*No reason provided*'}`)
        .addFields(
            { name: 'Opened by', value: `<@${user.id}>`, inline: true },
            { name: 'Type', value: panel.buttonLabel, inline: true },
            { name: 'Status', value: '🟢 Open', inline: true },
            ...(robloxUsername ? [{ name: 'Roblox Username', value: robloxUsername, inline: true }] : [])
        )
        .setFooter({ text: `Ticket ID: ${ticketChannel.id}` })
        .setTimestamp();

    const welcomeMessage = await ticketChannel.send({
        content: `${staffMention ? staffMention + ' — ' : ''}<@${user.id}>`, embeds: [welcomeEmbed], components: buildTicketButtons(false)
    });

    const ticketRecord = openTickets.get(ticketChannel.id);
    if (ticketRecord) ticketRecord.welcomeMessageId = welcomeMessage.id;
    saveOpenTickets();

    return ticketChannel;
}

async function sendTicketPanels(channel, guildConfig) {
    for (const [typeKey, panel] of Object.entries(guildConfig.panels)) {
        const embed = new EmbedBuilder().setTitle(clamp(panel.title, 256)).setDescription(clamp(panel.description, 4096)).setColor(panel.color);
        const button = new ButtonBuilder().setCustomId(`open_ticket_${typeKey}`).setLabel(clamp(panel.buttonLabel, 80)).setStyle(STYLE_MAP[panel.style] || ButtonStyle.Secondary);
        if (panel.emoji && isValidEmoji(panel.emoji)) button.setEmoji(panel.emoji);
        await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
    }
}

function ticketModal(typeKey, panel) {
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
            { label: 'General Settings', value: 'general', emoji: '⚙️' },
            { label: 'Archive Behavior', value: 'archiveaction', emoji: '🗄️' },
            { label: 'Staff Roles', value: 'staffroles', emoji: '🧑‍💼' },
            { label: 'Admin Roles', value: 'adminroles', emoji: '👑' },
            { label: 'Log Channel', value: 'logchannel', emoji: '📜' },
            { label: 'Ticket Categories', value: 'categories', emoji: '🗂️' }
        );
    return new ActionRowBuilder().addComponents(select);
}

function configSummaryEmbed(guildConfig) {
    return new EmbedBuilder()
        .setTitle('🔧 Ticket Bot Configuration')
        .setColor(0x5865f2)
        .setDescription('Pick a setting below to edit it. This can also be managed from the website Settings tab.')
        .addFields(
            { name: 'Max tickets per user', value: `${guildConfig.maxTicketsPerUser}`, inline: true },
            { name: 'Close delay', value: `${guildConfig.closeDelaySeconds}s`, inline: true },
            { name: 'Archive behavior', value: guildConfig.archiveAction, inline: true },
            { name: 'Tickets paused?', value: guildConfig.ticketsPaused ? 'Yes ⏸️' : 'No', inline: true },
            { name: 'Admin roles', value: guildConfig.adminRoleIds.length ? guildConfig.adminRoleIds.map(id => `<@&${id}>`).join(', ') : '*None set*' },
            { name: 'Staff roles', value: guildConfig.staffRoleIds.length ? guildConfig.staffRoleIds.map(id => `<@&${id}>`).join(', ') : '*None set*' },
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
            { label: 'Website Maintenance Mode', value: 'maintenance', emoji: '🛠️' },
            { label: 'Website Footer Note', value: 'footernote', emoji: '✨' }
        );
    return new ActionRowBuilder().addComponents(select);
}

function siteSummaryEmbed(guildConfig) {
    return new EmbedBuilder()
        .setTitle('🌐 Website & Ticket Settings')
        .setColor(0x5865f2)
        .addFields(
            { name: 'Website title', value: siteConfig.siteTitle, inline: true },
            { name: 'Accent color', value: siteConfig.accentColor, inline: true },
            { name: 'Auto-delete delay', value: `${Math.round(guildConfig.closeDelaySeconds / 60)} min`, inline: true },
            { name: 'Banner', value: siteConfig.bannerText || '*None*' },
            { name: 'Footer note', value: siteConfig.footerNote || '*None*' },
            { name: 'Tickets paused?', value: guildConfig.ticketsPaused ? `Yes` : 'No' },
            { name: 'Website maintenance mode?', value: siteConfig.maintenanceMode ? `Yes` : 'No' }
        );
}

client.once('ready', async () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);

    if (!process.env.WEBSITE_URL && !process.env.RENDER_EXTERNAL_URL) {
        console.warn(`⚠️  WEBSITE_URL is not set in .env — DM'd transcript links and log-channel links will point to ${getWebsiteUrl()}, which nobody outside this machine can open. Set WEBSITE_URL to your real public URL.`);
    }

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
        { name: 'close', description: 'Close the ticket in this channel (opener or staff)' },
        {
            name: 'closerequest',
            description: 'Ask the ticket opener to close their own ticket (staff only)',
            options: [
                { name: 'reason', description: 'Why the ticket should close', type: 3, required: true },
                { name: 'close_delay', description: 'Hours to auto-close the ticket in if the user does not respond', type: 4, required: false, min_value: 1, max_value: 168 }
            ]
        },
        {
            name: 'transfer',
            description: 'Transfer this ticket to another staff member (staff only)',
            options: [
                { name: 'user', description: 'Staff member to hand the ticket to', type: 6, required: true }
            ]
        },
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
            console.log(`✅ Global commands registered: ${commands.map(c => '/' + c.name).join(', ')}`);
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
            const body = GUILD_ID === OWNER_GUILD_ID ? [...commands, ...ownerCommands] : ownerCommands;
            await rest.put(Routes.applicationGuildCommands(client.user.id, OWNER_GUILD_ID), { body });
            console.log(`✅ Owner-only commands registered ONLY to server ${OWNER_GUILD_ID}`);
        }
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
});

client.on('error', (err) => {
    console.error('Discord client error (recovered, bot keeps running):', err);
});

client.on('guildCreate', async (guild) => {
    if (blockedGuilds[guild.id]) {
        console.log(`Auto-leaving blocked server ${guild.name} (${guild.id})`);
        await guild.leave().catch(err => console.error('Could not leave blocked guild:', err));
    }
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.guild && blockedGuilds[interaction.guild.id]) return;

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

        if (interaction.isChatInputCommand()) {
            const { commandName, channel, guild, user, member } = interaction;

            if (commandName === 'sendpanels') {
                await sendTicketPanels(channel, guildConfig);
                return interaction.reply({ content: '✅ Panels sent to this channel!', ephemeral: true });
            }

            if (commandName === 'setup') {
                if (!isStaff(member, guildConfig)) {
                    return interaction.reply({ content: '❌ Only staff can use /setup.', ephemeral: true });
                }
                const typeKey = interaction.options.getString('type') || 'REDFIELD';
                if (guildConfig.blacklistedUsers[user.id]) {
                    return interaction.reply({ content: `🚫 You're blocked from opening tickets. Reason: ${guildConfig.blacklistedUsers[user.id].reason}`, ephemeral: true });
                }
                if (guildConfig.ticketsPaused) {
                    return interaction.reply({ content: `⏸️ ${guildConfig.pausedMessage}`, ephemeral: true });
                }
                if (countUserTickets(guild.id, user.id) >= guildConfig.maxTicketsPerUser) {
                    return interaction.reply({ content: `❌ You've reached the max of ${guildConfig.maxTicketsPerUser} open tickets. Close one before opening another.`, ephemeral: true });
                }
                await interaction.deferReply({ ephemeral: true });
                try {
                    const testTicket = await createTicketChannel(guild, user, typeKey, 'Automated test ticket from /setup', null, guildConfig);
                    await testTicket.send(`🤖 **[TEST BOT]**: This is an automatically created working test ticket.`);
                    await testTicket.send(`👤 **${user.username}**: Testing ticket messages and web archiving system!`);
                    return interaction.editReply({ content: `✅ Test ticket channel created: ${testTicket}.` });
                } catch (err) {
                    console.error('[/setup] failed:', err);
                    return interaction.editReply({ content: `❌ Could not create the test ticket: ${err.message}` }).catch(fallbackErr => {
                        console.error('[/setup] fallback reply also failed:', fallbackErr.message);
                    });
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
                        await msg.edit({ embeds: [updatedEmbed], components: withUpdatedClaimRow(msg.components, true) });
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
                        await msg.edit({ embeds: [updatedEmbed], components: withUpdatedClaimRow(msg.components, false) });
                    } catch (err) {
                        console.error('Could not update ticket embed on /unclaim:', err.message);
                    }
                }
                return interaction.reply(`↩️ **${user.tag}** unclaimed this ticket.`);
            }

            if (commandName === 'close') {
                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                if (!ticket) return interaction.reply({ content: "This isn't an open ticket channel.", ephemeral: true });

                const isOpener = ticket.userId === user.id;
                if (!isOpener && !isStaff(member, guildConfig)) {
                    return interaction.reply({ content: '❌ You are not allowed to close this ticket.', ephemeral: true });
                }

                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('confirm_close').setLabel('Confirm Close').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('cancel_close').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                );
                return interaction.reply({ content: `⚠️ Close this ticket? It will archive to the website and ${guildConfig.archiveAction === 'lock' ? 'lock' : 'delete'} in ${guildConfig.closeDelaySeconds}s.`, components: [confirmRow] });
            }

            if (commandName === 'closerequest') {
                if (!isStaff(member, guildConfig)) return interaction.reply({ content: '❌ Only staff can request a close.', ephemeral: true });

                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                if (!ticket || !ticket.userId) {
                    return interaction.reply({ content: "⚠️ Could not identify the ticket opener — either this isn't a ticket channel, or the bot restarted since it opened. Use /close instead.", ephemeral: true });
                }

                const reason = interaction.options.getString('reason');
                const closeDelayHours = interaction.options.getInteger('close_delay');

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('closerequest_accept').setLabel('Accept & Close').setStyle(ButtonStyle.Success).setEmoji('✅'),
                    new ButtonBuilder().setCustomId('closerequest_deny').setLabel('Deny & Keep Open').setStyle(ButtonStyle.Danger).setEmoji('❌')
                );
                const closeRequestEmbed = new EmbedBuilder()
                    .setColor(0x5865f2)
                    .setTitle('Close Request')
                    .setDescription(`<@${ticket.userId}> has requested to close this ticket. Reason:\n\`\`\`${reason}\`\`\`\n\nPlease accept or deny using the buttons below.${closeDelayHours ? `\n\n⏱️ This will auto-close in **${closeDelayHours} hour${closeDelayHours === 1 ? '' : 's'}** if there's no response.` : ''}`);

                if (closeDelayHours) scheduleCloseRequestAutoClose(channel, guild, guildConfig, closeDelayHours, user.tag);

                return interaction.reply({ content: `<@${ticket.userId}>`, embeds: [closeRequestEmbed], components: [row] });
            }

            if (commandName === 'transfer') {
                if (!isStaff(member, guildConfig)) return interaction.reply({ content: '❌ Only staff can transfer tickets.', ephemeral: true });

                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                if (!ticket) return interaction.reply({ content: "This isn't an open ticket channel.", ephemeral: true });

                const targetUser = interaction.options.getUser('user');
                if (targetUser.bot) return interaction.reply({ content: '❌ Cannot transfer a ticket to a bot.', ephemeral: true });

                await interaction.deferReply();

                const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
                if (!targetMember || !isStaff(targetMember, guildConfig)) {
                    return interaction.editReply({ content: `❌ **${targetUser.tag}** isn't staff — pick someone with a Staff or Admin role.` });
                }

                if (ticket.claimedBy && ticket.claimedBy.id !== user.id && !member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.editReply({ content: `❌ This ticket is claimed by **${ticket.claimedBy.tag}** — only they (or an Administrator) can transfer it.` });
                }

                const previousClaimerTag = ticket.claimedBy ? ticket.claimedBy.tag : null;
                ticket.claimedBy = { id: targetMember.id, tag: targetMember.user.tag };
                openTickets.set(channel.id, ticket);
                saveOpenTickets();

                await channel.permissionOverwrites.edit(targetMember.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});

                if (ticket.welcomeMessageId) {
                    try {
                        const msg = await channel.messages.fetch(ticket.welcomeMessageId);
                        const updatedEmbed = EmbedBuilder.from(msg.embeds[0]).setFields(
                            msg.embeds[0].fields.map(f => f.name === 'Status' ? { name: 'Status', value: `🟡 Claimed by ${targetMember.user.tag}`, inline: true } : f)
                        );
                        await msg.edit({ embeds: [updatedEmbed], components: withUpdatedClaimRow(msg.components, true) });
                    } catch (err) {
                        console.error('Could not update ticket embed on /transfer:', err.message);
                    }
                }

                return interaction.editReply(`🔁 ${previousClaimerTag ? `Transferred from **${previousClaimerTag}** to` : 'Transferred to'} **${targetMember.user.tag}** by **${user.tag}**.`);
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

            if (value === 'maintenance') {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('sitecfg_maintenance_enable').setLabel('Enable Maintenance Mode').setStyle(siteConfig.maintenanceMode ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('sitecfg_maintenance_disable').setLabel('Disable Maintenance Mode').setStyle(!siteConfig.maintenanceMode ? ButtonStyle.Success : ButtonStyle.Secondary)
                );
                return interaction.update({
                    content: siteConfig.maintenanceMode
                        ? `🛠️ The website is currently in **maintenance mode**. Message shown: "${siteConfig.maintenanceMessage}"\n\nStaff with the site password can still log in through it — this only blocks everyone else, including ticket-opener transcript links.`
                        : '🌐 The website is live. Enabling maintenance mode blocks all visitors and ticket-opener links — staff can still log in through it.',
                    embeds: [], components: [row]
                });
            }
            return;
        }

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

        if (interaction.isButton() && (interaction.customId === 'sitecfg_maintenance_enable' || interaction.customId === 'sitecfg_maintenance_disable')) {
            if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });

            if (interaction.customId === 'sitecfg_maintenance_disable') {
                siteConfig.maintenanceMode = false;
                saveSiteConfig();
                return interaction.update({ content: '🌐 Maintenance mode disabled. The website is live again.', components: [] });
            }

            const modal = new ModalBuilder().setCustomId('sitecfg_maintenance_modal').setTitle('Maintenance Message');
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('maintenanceMessage').setLabel('Message shown to visitors').setStyle(TextInputStyle.Paragraph).setValue(siteConfig.maintenanceMessage).setRequired(true).setMaxLength(300)
            ));
            return interaction.showModal(modal);
        }

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

            if (value === 'staffroles') {
                const row = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder().setCustomId('config_staffroles_select').setPlaceholder('Select staff roles').setMinValues(0).setMaxValues(10)
                );
                return interaction.update({ content: 'Select the role(s) that count as staff:', embeds: [], components: [row] });
            }

            if (value === 'adminroles') {
                const row = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder().setCustomId('config_adminroles_select').setPlaceholder('Select admin roles').setMinValues(0).setMaxValues(10)
                );
                return interaction.update({ content: 'Select the role(s) that count as admins (admins are automatically staff too):', embeds: [], components: [row] });
            }

            if (value === 'logchannel') {
                const row = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder().setCustomId('config_logchannel_select').setPlaceholder('Select a log channel').addChannelTypes(ChannelType.GuildText)
                );
                return interaction.update({ content: 'Select the channel where closed-ticket logs should be posted:', embeds: [], components: [row] });
            }

            if (value === 'categories') {
                const summary = Object.entries(guildConfig.panels)
                    .map(([key, p]) => `**${key}** → \`${p.categoryName || 'TICKETS'}\``)
                    .join('\n');
                const typeSelect = new StringSelectMenuBuilder()
                    .setCustomId('config_category_type_select')
                    .setPlaceholder('Which ticket type?')
                    .addOptions(Object.keys(guildConfig.panels).map(key => ({ label: key, value: key })));
                return interaction.update({
                    content: `Current categories:\n${summary}\n\nPick a type to change which Discord category its tickets get created under:`,
                    embeds: [], components: [new ActionRowBuilder().addComponents(typeSelect)]
                });
            }
            return;
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'config_category_type_select') {
            if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
            const typeKey = interaction.values[0];
            const panel = guildConfig.panels[typeKey];
            if (!panel) return;

            const modal = new ModalBuilder().setCustomId(`config_category_modal_${typeKey}`).setTitle(`${typeKey} Category`);
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('categoryName').setLabel('Discord category name').setStyle(TextInputStyle.Short).setValue(panel.categoryName || 'TICKETS').setRequired(true).setMaxLength(90)
            ));
            return interaction.showModal(modal);
        }

        if (interaction.isRoleSelectMenu() && interaction.customId === 'config_staffroles_select') {
            if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
            guildConfig.staffRoleIds = interaction.values;
            saveConfigs();
            return interaction.update({ content: `✅ Staff roles updated: ${interaction.values.map(id => `<@&${id}>`).join(', ') || 'none'}`, components: [] });
        }

        if (interaction.isRoleSelectMenu() && interaction.customId === 'config_adminroles_select') {
            if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
            guildConfig.adminRoleIds = interaction.values;
            saveConfigs();
            return interaction.update({ content: `✅ Admin roles updated: ${interaction.values.map(id => `<@&${id}>`).join(', ') || 'none'}`, components: [] });
        }

        if (interaction.isChannelSelectMenu() && interaction.customId === 'config_logchannel_select') {
            if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
            guildConfig.logChannelId = interaction.values[0];
            saveConfigs();
            return interaction.update({ content: `✅ Log channel set to <#${interaction.values[0]}>`, components: [] });
        }

        if (interaction.isButton()) {
            const { customId, guild, user, member, channel } = interaction;

            if (customId.startsWith('feedback_')) {
                const parts = customId.split('_');
                const rating = parseInt(parts[1], 10);
                const ticketId = parts[2];

                feedbackData.unshift({ ticketId, rating, userTag: user.tag, userId: user.id, at: new Date().toISOString() });
                saveFeedback();
                return interaction.reply({ content: `⭐ Thank you for rating your support experience **${rating}/5 stars**!`, ephemeral: true });
            }

            if (customId === 'ticket_quickwords') {
                const globalWords = quickWordsData.global || [];
                const personalWords = quickWordsData.personal[user.id] || [];
                const combined = [...globalWords.map(w => ({ ...w, type: 'Global' })), ...personalWords.map(w => ({ ...w, type: 'Personal' }))];

                if (!combined.length) return interaction.reply({ content: '❌ No Quick Words configured yet! Add them on the web dashboard.', ephemeral: true });

                const select = new StringSelectMenuBuilder()
                    .setCustomId('quickword_select')
                    .setPlaceholder('Choose a Quick Word response...')
                    .addOptions(combined.slice(0, 25).map(q => ({ label: `${q.label} (${q.type})`, value: q.text, description: q.text.slice(0, 50) })));

                return interaction.reply({ content: '⚡ Select a pre-set response to post instantly:', components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
            }

            if (customId === 'config_archive_delete' || customId === 'config_archive_lock') {
                if (!isStaff(member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
                guildConfig.archiveAction = customId === 'config_archive_delete' ? 'delete' : 'lock';
                saveConfigs();
                return interaction.update({ content: `✅ Archive behavior set to **${guildConfig.archiveAction}**.`, components: [] });
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
                    return interaction.reply({ content: `❌ Couldn't open the ticket form: ${err.message}`, ephemeral: true }).catch(fallbackErr => {
                        console.error('[showModal failed] fallback reply also failed:', fallbackErr.message);
                    });
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
                saveOpenTickets();
                const oldEmbed = interaction.message.embeds[0];
                const updatedEmbed = EmbedBuilder.from(oldEmbed).setFields(
                    oldEmbed.fields.map(f => f.name === 'Status' ? { name: 'Status', value: `🟡 Claimed by ${user.tag}`, inline: true } : f)
                );
                await interaction.update({ embeds: [updatedEmbed], components: withUpdatedClaimRow(interaction.message.components, true) });
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
                saveOpenTickets();
                const oldEmbed = interaction.message.embeds[0];
                const updatedEmbed = EmbedBuilder.from(oldEmbed).setFields(
                    oldEmbed.fields.map(f => f.name === 'Status' ? { name: 'Status', value: '🟢 Open', inline: true } : f)
                );
                await interaction.update({ embeds: [updatedEmbed], components: withUpdatedClaimRow(interaction.message.components, false) });
                return channel.send(`↩️ **${user.tag}** unclaimed this ticket.`);
            }

            if (customId === 'cancel_close') {
                return interaction.update({ content: '✅ Close cancelled — this ticket stays open.', components: [] });
            }

            if (customId === 'confirm_close') {
                let ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                const allowed = ticket && (ticket.userId === user.id || isStaff(member, guildConfig));
                if (!allowed) return interaction.reply({ content: '❌ You are not allowed to close this ticket.', ephemeral: true });

                if (ticket.closing) return interaction.reply({ content: '⏳ Already closing.', ephemeral: true });
                ticket.closing = true;
                openTickets.set(channel.id, ticket);
                saveOpenTickets();
                clearCloseRequestTimer(channel.id);

                await interaction.update({ content: `🔒 Closing in ${guildConfig.closeDelaySeconds}s. Saved to the website only.`, components: [] });
                setTimeout(() => finalizeTicketClose(channel, guild, guildConfig, user.tag), guildConfig.closeDelaySeconds * 1000);
                return;
            }

            if (customId === 'ticket_close' || customId === 'force_close_ticket' || customId === 'opener_close_own_ticket') {
                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                const allowed = ticket && (ticket.userId === user.id || isStaff(member, guildConfig));
                if (!allowed) {
                    return interaction.reply({ content: '❌ You are not allowed to close this ticket.', ephemeral: true });
                }
                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('confirm_close').setLabel('Confirm Close').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('cancel_close').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                );
                return interaction.reply({ content: `⚠️ Close this ticket? It will archive to the website and ${guildConfig.archiveAction === 'lock' ? 'lock' : 'delete'} in ${guildConfig.closeDelaySeconds}s.`, components: [confirmRow] });
            }

            if (customId === 'request_close_ticket') {
                if (!isStaff(member, guildConfig)) return interaction.reply({ content: '❌ Only staff can request a close.', ephemeral: true });
                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                if (!ticket || !ticket.userId) {
                    return interaction.reply({ content: '⚠️ Could not identify the ticket opener (bot may have restarted). Use /close instead.', ephemeral: true });
                }
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('closerequest_accept').setLabel('Accept & Close').setStyle(ButtonStyle.Success).setEmoji('✅'),
                    new ButtonBuilder().setCustomId('closerequest_deny').setLabel('Deny & Keep Open').setStyle(ButtonStyle.Danger).setEmoji('❌')
                );
                const closeRequestEmbed = new EmbedBuilder()
                    .setColor(0x5865f2)
                    .setTitle('Close Request')
                    .setDescription(`<@${ticket.userId}> has requested to close this ticket. Reason:\n\`\`\`Staff requested this ticket be closed.\`\`\`\n\nPlease accept or deny using the buttons below.`);
                return interaction.reply({ content: `<@${ticket.userId}>`, embeds: [closeRequestEmbed], components: [row] });
            }

            if (customId === 'ticket_close_with_reason') {
                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                const allowed = ticket && (ticket.userId === user.id || isStaff(member, guildConfig));
                if (!allowed) {
                    return interaction.reply({ content: '❌ You are not allowed to close this ticket.', ephemeral: true });
                }
                if (ticket.closing) return interaction.reply({ content: '⏳ Already closing.', ephemeral: true });

                const modal = new ModalBuilder().setCustomId('close_with_reason_modal').setTitle('Close With Reason');
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('closeReason').setLabel('Reason for closing').setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(true)
                ));
                return interaction.showModal(modal);
            }

            if (customId === 'closerequest_deny' || customId === 'opener_respond_keep_open') {
                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                if (!ticket || ticket.userId !== user.id) {
                    return interaction.reply({ content: '❌ Only the ticket opener can respond to this request.', ephemeral: true });
                }
                clearCloseRequestTimer(channel.id);
                return interaction.update({ content: `❌ **${user.tag}** denied the close request — this ticket stays open.`, embeds: [], components: [] });
            }

            if (customId === 'closerequest_accept' || customId === 'opener_respond_close') {
                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                if (!ticket || ticket.userId !== user.id) {
                    return interaction.reply({ content: '❌ Only the ticket opener can respond to this request.', ephemeral: true });
                }
                if (ticket.closing) return interaction.reply({ content: '⏳ Already closing.', ephemeral: true });
                clearCloseRequestTimer(channel.id);
                ticket.closing = true;
                openTickets.set(channel.id, ticket);
                saveOpenTickets();

                await interaction.update({ content: `🔒 **${user.tag}** accepted — closing in ${guildConfig.closeDelaySeconds}s.`, embeds: [], components: [] });
                setTimeout(() => finalizeTicketClose(channel, guild, guildConfig, user.tag), guildConfig.closeDelaySeconds * 1000);
                return;
            }
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'quickword_select') {
            const selectedText = interaction.values[0];
            await interaction.channel.send(`**${interaction.user.username}:** ${selectedText}`);
            return interaction.update({ content: '✅ Quick Word sent!', components: [] });
        }

        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'close_with_reason_modal') {
                const ticket = openTickets.get(interaction.channel.id) || recoverTicketFromTopic(interaction.channel);
                const allowed = ticket && (ticket.userId === interaction.user.id || isStaff(interaction.member, guildConfig));
                if (!allowed) return interaction.reply({ content: '❌ You are not allowed to close this ticket.', ephemeral: true });
                if (ticket.closing) return interaction.reply({ content: '⏳ Already closing.', ephemeral: true });

                const closeReason = interaction.fields.getTextInputValue('closeReason');
                ticket.closing = true;
                openTickets.set(interaction.channel.id, ticket);
                saveOpenTickets();
                clearCloseRequestTimer(interaction.channel.id);

                await interaction.reply({ content: `🔒 **${interaction.user.tag}** closed this ticket.\n**Reason:** ${closeReason}\n\nArchiving now...` });
                await finalizeTicketClose(interaction.channel, interaction.guild, guildConfig, interaction.user.tag);
                return;
            }

            if (interaction.customId === 'sitecfg_password_modal') {
                if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
                const newPassword = interaction.fields.getTextInputValue('password').trim();
                if (!newPassword) return interaction.reply({ content: '❌ Password cannot be blank.', ephemeral: true });
                siteConfig.password = newPassword;
                saveSiteConfig();
                return interaction.reply({ content: '✅ Website password updated.', ephemeral: true });
            }

            if (interaction.customId === 'sitecfg_autodelete_modal') {
                if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
                const minutes = parseInt(interaction.fields.getTextInputValue('minutes'), 10);
                if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
                    return interaction.reply({ content: '❌ Must be a whole number of minutes between 1 and 1440.', ephemeral: true });
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
                    return interaction.reply({ content: '❌ Must be a 6-digit hex color like #2ecc71.', ephemeral: true });
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

            if (interaction.customId === 'sitecfg_maintenance_modal') {
                if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
                const maintenanceMessage = interaction.fields.getTextInputValue('maintenanceMessage').trim();
                if (!maintenanceMessage) return interaction.reply({ content: '❌ Message cannot be blank.', ephemeral: true });
                siteConfig.maintenanceMode = true;
                siteConfig.maintenanceMessage = maintenanceMessage;
                saveSiteConfig();
                return interaction.reply({ content: `🛠️ Maintenance mode enabled. Visitors now see: "${maintenanceMessage}"`, ephemeral: true });
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
                await interaction.deferReply({ ephemeral: true });
                try {
                    const ticketChannel = await createTicketChannel(interaction.guild, interaction.user, typeKey, reason, robloxUsername, guildConfig);
                    await interaction.editReply({ content: `✅ Ticket created: ${ticketChannel}` });
                } catch (err) {
                    console.error(`[ticket creation failed] type=${typeKey} user=${interaction.user.tag}:`, err);
                    await interaction.editReply({ content: `❌ Couldn't create your ticket: ${err.message}` });
                } finally {
                    pendingCreations.delete(lockKey);
                }
                return;
            }

            if (interaction.customId.startsWith('config_category_modal_')) {
                if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
                const typeKey = interaction.customId.replace('config_category_modal_', '');
                if (!guildConfig.panels[typeKey]) return;

                const categoryName = interaction.fields.getTextInputValue('categoryName').trim().toUpperCase();
                if (!categoryName) return interaction.reply({ content: '❌ Category name cannot be blank.', ephemeral: true });

                guildConfig.panels[typeKey].categoryName = categoryName;
                saveConfigs();
                return interaction.reply({ content: `✅ ${typeKey} tickets will now be created under **${categoryName}**.`, ephemeral: true });
            }

            if (interaction.customId.startsWith('config_panel_modal_')) {
                if (!isStaff(interaction.member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
                const typeKey = interaction.customId.replace('config_panel_modal_', '');
                const emoji = interaction.fields.getTextInputValue('emoji').trim();

                if (emoji && !isValidEmoji(emoji)) {
                    return interaction.reply({ content: `❌ "${emoji}" isn't a valid emoji.`, ephemeral: true });
                }

                const promptLabel = interaction.fields.getTextInputValue('promptLabel');
                const buttonLabel = interaction.fields.getTextInputValue('buttonLabel');

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
                    return interaction.reply({ content: '❌ Close delay must be a whole number of seconds between 5 and 86400.', ephemeral: true });
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

process.on('unhandledRejection', (err) => {
    console.error('Unhandled promise rejection (recovered, bot keeps running):', err);
});

client.login(process.env.DISCORD_TOKEN);