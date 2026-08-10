require('dotenv').config();
const BUILD_VERSION = String(Date.now());
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { Server } = require('socket.io');
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
const { Redis } = require('@upstash/redis');

// Initialize Upstash Redis if environment variables are set
let redis = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
        redis = Redis.fromEnv();
        console.log('⚡ Connected to Upstash Cloud Redis');
    } catch (err) {
        console.error('Failed to initialize Upstash Redis:', err.message);
    }
}

// ---------------------------------------------------------------------------
// CONFIG / ENV
// ---------------------------------------------------------------------------
const GUILD_ID = process.env.GUILD_ID || null;

function getWebsiteUrl() {
    const url = process.env.WEBSITE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3002';
    return url.replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// PERSISTENCE & DATA FILES
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
const ARCHIVE_FILE = path.join(DATA_DIR, 'archivedTickets.json');
const CONFIG_FILE = path.join(DATA_DIR, 'guildConfigs.json');
const SITE_CONFIG_FILE = path.join(DATA_DIR, 'siteConfig.json');
const BLOCKLIST_FILE = path.join(DATA_DIR, 'blockedGuilds.json');
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.json');
const QUICKWORDS_FILE = path.join(DATA_DIR, 'quickWords.json');
const AUDIT_LOG_FILE = path.join(DATA_DIR, 'auditLog.json');
const APPLICATIONS_FILE = path.join(DATA_DIR, 'applications.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Shift Storage Data Structure
let shiftData = {}; // { userId: { tag, onDuty: boolean, shiftStarted: ISO, totalHours: float } }

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
async function saveFeedback() {
    try {
        if (redis) await redis.set('feedbackData', JSON.stringify(feedbackData));
        fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(feedbackData, null, 2));
    } catch (err) {
        console.error('Failed to save feedback:', err);
    }
}

// Applications Persistence
let applicationsData = [];
try {
    if (fs.existsSync(APPLICATIONS_FILE)) {
        applicationsData = JSON.parse(fs.readFileSync(APPLICATIONS_FILE, 'utf8'));
    }
} catch (err) {
    console.error('Could not load applications, starting fresh:', err);
}
async function saveApplications() {
    try {
        if (redis) await redis.set('applicationsData', JSON.stringify(applicationsData));
        fs.writeFileSync(APPLICATIONS_FILE, JSON.stringify(applicationsData, null, 2));
    } catch (err) {
        console.error('Failed to save applications:', err);
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
async function saveQuickWords() {
    try {
        if (redis) await redis.set('quickWordsData', JSON.stringify(quickWordsData));
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
        maintenanceMessage: "We're doing some maintenance on the portal. Back shortly."
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
    
    // Global Footer with Copyright
    const footerHtml = `
      <div class="footer-note" style="margin-top: 30px; padding-top: 20px; border-top: 1px solid var(--border, #262b3a); text-align: center; font-size: 12px; color: var(--muted, #9199a8); line-height: 1.6;">
        <p style="margin: 0; opacity: 0.8;">© 2026 Redfield Archives. All Rights Reserved.</p>
      </div>
    `;
    
    // Inject version tracking scripts
    const versionScript = `<script>window.APP_BUILD_VERSION = "${BUILD_VERSION}";</script><script src="/version-check.js"></script>`;
    if (html.includes('</body>')) {
        html = html.replace('</body>', `${versionScript}\n</body>`);
    } else {
        html += versionScript;
    }

    return html
        .replace(/{{SITE_TITLE}}/g, escapeHtml(siteConfig.siteTitle))
        .replace(/{{ACCENT_COLOR}}/g, validAccent)
        .replace(/{{BANNER_HTML}}/g, bannerHtml)
        .replace(/{{FOOTER_NOTE_HTML}}/g, footerHtml);
}

function sendTemplate(req, res, filePath) {
    if (!fs.existsSync(filePath)) {
        console.error(`[view missing] ${filePath} does not exist`);
        return res.status(500).send(
            `<pre style="font-family:monospace;padding:24px;color:#e05a3a;white-space:pre-wrap;">` +
            `Missing view file: ${escapeHtml(filePath)}\n\nCheck your views/ directory.` +
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
async function saveArchive() {
    try {
        if (redis) await redis.set('archivedTickets', JSON.stringify(Object.fromEntries(archivedTickets)));
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
async function saveConfigs() {
    try {
        if (redis) await redis.set('guildConfigs', JSON.stringify(guildConfigs));
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(guildConfigs, null, 2));
    } catch (err) {
        console.error('Failed to save guild configs:', err);
    }
}

// ---------------------------------------------------------------------------
// PER-COMMAND ENABLE / RESTRICT SETTINGS
// ---------------------------------------------------------------------------
// Every slash command can be individually turned off, or restricted to a
// minimum tier ('everyone' | 'staff' | 'admin') from the website. New
// commands ship with sensible defaults below; an Administrator can loosen or
// tighten any of them from the Bot Commands settings page.
function defaultCommandSettings() {
    return {
        ping: { enabled: true, minTier: 'everyone' },
        id: { enabled: true, minTier: 'everyone' },
        permissionlevel: { enabled: true, minTier: 'everyone' },
        new: { enabled: true, minTier: 'everyone' },
        add: { enabled: true, minTier: 'staff' },
        remove: { enabled: true, minTier: 'staff' },
        rename: { enabled: true, minTier: 'staff' },
        transcript: { enabled: true, minTier: 'staff' },
        purge: { enabled: true, minTier: 'admin' },
        claim: { enabled: true, minTier: 'staff' },
        unclaim: { enabled: true, minTier: 'staff' },
        close: { enabled: true, minTier: 'staff' },
        closerequest: { enabled: true, minTier: 'staff' },
        transfer: { enabled: true, minTier: 'staff' },
        priority: { enabled: true, minTier: 'staff' },
        tag: { enabled: true, minTier: 'staff' },
        blacklist: { enabled: true, minTier: 'staff' },
        unblacklist: { enabled: true, minTier: 'staff' },
        duty: { enabled: true, minTier: 'staff' },
        sendpanels: { enabled: true, minTier: 'staff' },
        setup: { enabled: true, minTier: 'staff' },
        configure: { enabled: true, minTier: 'staff' },
        'config-site': { enabled: true, minTier: 'staff' }
    };
}
const COMMAND_TIER_RANK = { everyone: 0, staff: 1, admin: 2 };
function getCommandSetting(guildConfig, name) {
    return (guildConfig.commandSettings && guildConfig.commandSettings[name]) || { enabled: true, minTier: 'staff' };
}
function memberCommandTier(member, guildConfig) {
    if (isAdmin(member, guildConfig)) return 'admin';
    if (isStaff(member, guildConfig)) return 'staff';
    return 'everyone';
}
function checkCommandAccess(interaction, guildConfig, name) {
    const setting = getCommandSetting(guildConfig, name);
    if (!setting.enabled) return { ok: false, reason: 'disabled' };
    const tier = memberCommandTier(interaction.member, guildConfig);
    if ((COMMAND_TIER_RANK[tier] ?? 1) < (COMMAND_TIER_RANK[setting.minTier] ?? 1)) return { ok: false, reason: 'restricted' };
    return { ok: true };
}
function commandAccessDeniedReply(access) {
    return access.reason === 'disabled'
        ? '❌ This command has been disabled by an Administrator.'
        : "❌ You don't have permission to use this command.";
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
                restrictToTeamOnly: false,
                postChannelId: null
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
                restrictToTeamOnly: false,
                postChannelId: null
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
                restrictToTeamOnly: false,
                postChannelId: null
            }
        },
        maxTicketsPerUser: 3,
        closeDelaySeconds: 60,
        archiveAction: 'delete',
        allowOpenerClose: false,
        ticketsPaused: false,
        pausedMessage: 'Ticket creation is temporarily paused. Please try again later.',
        blacklistedUsers: {},
        staffRestrictions: {},
        staffRoleIds: [],
        adminRoleIds: [],
        logChannelId: null,
        tags: [],
        staffPermissions: {
            allowedTabs: ['archive', 'tickets', 'panels', 'tags', 'feedback', 'auditlog', 'moderation', 'lookup', 'blacklist', 'shiftroster', 'quickwords', 'settings'],
            canModerate: true
        }
    };
}

function getGuildConfig(guildId) {
    const saved = guildConfigs[guildId] || {};
    const def = defaultConfig();
    const merged = { ...def, ...saved };
    const savedPanels = saved.panels || {};

    merged.panels = {};
    // Built-in panels: merge each with whatever's been saved for it.
    for (const key of Object.keys(def.panels)) {
        merged.panels[key] = { ...def.panels[key], ...(savedPanels[key] || {}) };
        if (!Array.isArray(merged.panels[key].teamRoleIds)) merged.panels[key].teamRoleIds = [];
    }
    // Custom panels created via the website aren't in def.panels, so the loop
    // above never touches them — without this they were being dropped and
    // re-saved without them on literally every request after creation.
    for (const key of Object.keys(savedPanels)) {
        if (merged.panels[key]) continue;
        merged.panels[key] = { ...savedPanels[key] };
        if (!Array.isArray(merged.panels[key].teamRoleIds)) merged.panels[key].teamRoleIds = [];
    }

    merged.staffRoleIds = Array.isArray(saved.staffRoleIds) ? saved.staffRoleIds : def.staffRoleIds;
    merged.adminRoleIds = Array.isArray(saved.adminRoleIds) ? saved.adminRoleIds : def.adminRoleIds;
    merged.tags = Array.isArray(saved.tags) ? saved.tags : def.tags;
    merged.staffRestrictions = saved.staffRestrictions || {};

    const defCmdSettings = defaultCommandSettings();
    const savedCmdSettings = saved.commandSettings || {};
    merged.commandSettings = {};
    for (const key of Object.keys(defCmdSettings)) {
        merged.commandSettings[key] = { ...defCmdSettings[key], ...(savedCmdSettings[key] || {}) };
    }
    for (const key of Object.keys(savedCmdSettings)) {
        if (merged.commandSettings[key]) continue;
        merged.commandSettings[key] = savedCmdSettings[key];
    }

    if (!saved.staffPermissions) {
        merged.staffPermissions = def.staffPermissions;
    }

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

const OPEN_TICKETS_FILE = path.join(DATA_DIR, 'openTickets.json');
let openTickets = new Map();
try {
    if (fs.existsSync(OPEN_TICKETS_FILE)) {
        openTickets = new Map(Object.entries(JSON.parse(fs.readFileSync(OPEN_TICKETS_FILE, 'utf8'))));
    }
} catch (err) {
    console.error('Could not load open tickets, starting fresh:', err);
}
async function saveOpenTickets() {
    try {
        if (redis) await redis.set('openTickets', JSON.stringify(Object.fromEntries(openTickets)));
        fs.writeFileSync(OPEN_TICKETS_FILE, JSON.stringify(Object.fromEntries(openTickets), null, 2));
    } catch (err) {
        console.error('Failed to save open tickets:', err);
    }
}
const pendingCreations = new Set();
const closeRequestTimers = new Map();

const MOD_NOTES_FILE = path.join(DATA_DIR, 'moderationNotes.json');
let moderationNotes = new Map();
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

// Restore All Permanent Data from Upstash Redis on Startup
async function loadAllFromRedis() {
    if (!redis) return;
    try {
        const savedConfigs = await redis.get('guildConfigs');
        if (savedConfigs) guildConfigs = typeof savedConfigs === 'string' ? JSON.parse(savedConfigs) : savedConfigs;

        const savedArchive = await redis.get('archivedTickets');
        if (savedArchive) {
            const parsed = typeof savedArchive === 'string' ? JSON.parse(savedArchive) : savedArchive;
            archivedTickets = new Map(Object.entries(parsed));
        }

        const savedOpen = await redis.get('openTickets');
        if (savedOpen) {
            const parsed = typeof savedOpen === 'string' ? JSON.parse(savedOpen) : savedOpen;
            openTickets = new Map(Object.entries(parsed));
        }

        const savedQw = await redis.get('quickWordsData');
        if (savedQw) quickWordsData = typeof savedQw === 'string' ? JSON.parse(savedQw) : savedQw;

        const savedFb = await redis.get('feedbackData');
        if (savedFb) feedbackData = typeof savedFb === 'string' ? JSON.parse(savedFb) : savedFb;

        const savedApps = await redis.get('applicationsData');
        if (savedApps) applicationsData = typeof savedApps === 'string' ? JSON.parse(savedApps) : savedApps;

        console.log('✅ All data successfully restored from Upstash Cloud Redis!');
    } catch (err) {
        console.error('Error loading data from Upstash Redis:', err);
    }
}
loadAllFromRedis();

function resolveActorName(req) {
    if (req.authUser && req.authUser.id) return req.authUser.name;
    return String(req.body?.byName || '').trim().slice(0, 40) || 'Staff (via Website)';
}

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

async function sendModerationDM(member, subject, message) {
    if (!member || !member.user) return;
    try {
        const dm = await member.createDM();
        await dm.send({ content: `**${subject}**\n\n${message}` });
    } catch (err) {
        console.error('Could not send moderation DM:', err.message);
    }
}

// ---------------------------------------------------------------------------
// PERMISSION CHECK MIDDLEWARE
// ---------------------------------------------------------------------------
function getViewerContext(req, guild, guildConfig) {
    const ALL_TABS = ['archive', 'tickets', 'panels', 'tags', 'feedback', 'auditlog', 'moderation', 'lookup', 'blacklist', 'shiftroster', 'quickwords', 'settings'];
    const authUser = req.authUser;
    
    // 1. Not authenticated at all
    if (!authUser) return { tier: 'none', allowedTabs: [], canModerate: false };

    // 2. Access Code Login or Master
    if (!authUser.id) return { tier: 'master', allowedTabs: ALL_TABS, canModerate: true };

    // 3. Discord OAuth User
    const member = guild ? guild.members.cache.get(authUser.id) : null;
    
    if (isAdmin(member, guildConfig)) {
        return { tier: 'admin', allowedTabs: ALL_TABS, canModerate: true };
    }

    if (isStaff(member, guildConfig)) {
        const allowed = (guildConfig.staffPermissions && Array.isArray(guildConfig.staffPermissions.allowedTabs) && guildConfig.staffPermissions.allowedTabs.length)
            ? guildConfig.staffPermissions.allowedTabs 
            : ALL_TABS;

        return { 
            tier: 'staff', 
            allowedTabs: allowed, 
            canModerate: Boolean(guildConfig.staffPermissions?.canModerate ?? true) 
        };
    }

    // 4. Anyone who is authenticated but isn't recognized as staff/admin (including a
    // guild-member cache miss) gets NO access — never fall back to granting staff
    // permissions. A cache miss is not the same thing as being staff.
    return { tier: 'none', allowedTabs: [], canModerate: false };
}

function requireTabPermission(tabName) {
    return async (req, res, next) => {
        const guild = getTargetGuild();
        if (!guild) return res.status(503).send('Bot is not currently in any server');
        const guildConfig = getGuildConfig(guild.id);
        const ctx = getViewerContext(req, guild, guildConfig);

        if (ctx.tier === 'master' || ctx.tier === 'admin') return next();
        if (ctx.tier === 'staff' && ctx.allowedTabs.includes(tabName)) return next();

        if (req.path.startsWith('/api/')) {
            return res.status(403).json({ error: 'Access denied: Tab restricted by an Administrator.' });
        }
        
        return res.redirect('/login');
    };
}

function requireModerationCapability(req, res, next) {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server' });
    const guildConfig = getGuildConfig(guild.id);
    const ctx = getViewerContext(req, guild, guildConfig);

    if (req.authUser && req.authUser.id) {
        const restriction = getStaffRestriction(guildConfig, req.authUser.id);
        if (isModerationBanned(restriction)) {
            return res.status(403).json({ error: 'An Administrator has banned you from performing moderation actions.' });
        }
    }

if (ctx.tier === 'master' || ctx.tier === 'admin') return next();
    if (ctx.tier === 'staff' && ctx.allowedTabs.includes('moderation') && ctx.canModerate) return next();

    return res.status(403).json({ error: 'Moderation actions are disabled for your Staff role by an Administrator.' });
}

// ---------------------------------------------------------------------------
// EXPRESS WEB SERVER & SOCKET.IO SETUP
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

io.on('connection', (socket) => {
    socket.on('join_ticket', (channelId) => {
        socket.join(`ticket_${channelId}`);
    });
    socket.on('leave_ticket', (channelId) => {
        socket.leave(`ticket_${channelId}`);
    });
});

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

function isRequestAuthed(req) {
    const cookies = parseCookies(req);
    if (cookies.ticketAuth === computeAuthToken(siteConfig.password)) return { name: 'Staff (access code)' };
    const session = verifyDiscordSession(cookies.discordAuth);
    if (session) return { id: session.id, name: session.tag };
    return null;
}

function requireAuth(req, res, next) {
    const authUser = isRequestAuthed(req);
    if (authUser) {
        if (authUser.id) {
            const guild = getTargetGuild();
            const guildConfig = guild ? getGuildConfig(guild.id) : null;
            if (guildConfig) {
                const restriction = getStaffRestriction(guildConfig, authUser.id);
                if (isSiteBanned(restriction) || isLoginBlocked(restriction)) {
                    clearAuthCookies(res);
                    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Your access to this website has been suspended by an Administrator.' });
                    return res.status(403).send('<h2 style="font-family:sans-serif;color:#ef4444;padding:40px;text-align:center;background:#0a0c11;min-height:100vh;margin:0;">🔒 Your access to this website has been suspended by an Administrator.</h2>');
                }
            }
        }
        req.authUser = authUser;
        return next();
    }
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
    return res.redirect('/login');
}

function maintenanceGate(req, res, next) {
    if (!siteConfig.maintenanceMode) return next();
    if (isRequestAuthed(req)) return next();
    if (req.path.startsWith('/api/')) return res.status(503).json({ error: 'Under maintenance' });
    return res.status(503).send('<h2>System under maintenance.</h2>');
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

// Demo Route for Presentation
app.get('/demo', (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'demo-index.html')));

app.get('/auth/discord', (req, res) => {
    if (!DISCORD_LOGIN_CONFIGURED) return res.status(503).send('Discord login is not configured.');

    let returnTo = req.query.returnTo;
    if (!returnTo && req.headers.referer) {
        try {
            const parsed = new URL(req.headers.referer);
            returnTo = parsed.pathname + parsed.search;
        } catch (e) {}
    }

    const safeReturnTo = (returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')) ? returnTo : '/';
    const state = crypto.randomBytes(16).toString('hex');

    res.setHeader('Set-Cookie', [
        `oauthState=${state}; HttpOnly; Path=/; Max-Age=300; SameSite=Lax`,
        `oauthReturnTo=${encodeURIComponent(safeReturnTo)}; HttpOnly; Path=/; Max-Age=300; SameSite=Lax`
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
    const rawReturnTo = cookies.oauthReturnTo ? decodeURIComponent(cookies.oauthReturnTo) : '/';
    const returnTo = (rawReturnTo && rawReturnTo.startsWith('/') && !rawReturnTo.startsWith('//')) ? rawReturnTo : '/';

    if (oauthError) return res.redirect('/login?error=discord_denied');
    if (!DISCORD_LOGIN_CONFIGURED) return res.status(503).send('Discord login is not configured.');
    if (!code || !state || state !== cookies.oauthState) return res.redirect('/login?error=discord_failed');

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
        const tokenData = await tokenRes.json();

        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const discordUser = await userRes.json();

        const guild = getTargetGuild();
        const member = guild ? await guild.members.fetch(discordUser.id).catch(() => null) : null;
        const guildConfig = guild ? getGuildConfig(guild.id) : defaultConfig();
        const staff = Boolean(member && isStaff(member, guildConfig));

        // Always issue a session, staff or not — the routes that actually need
        // to be staff-only (dashboard tabs via requireTabPermission) already
        // enforce that correctly on their own, and requireDiscordOrTicketToken
        // already has its own opener-or-staff check for transcripts. Bouncing
        // every non-staff login to /coming-soon here, before any of that ever
        // ran, was breaking transcript access for ticket openers — they aren't
        // staff, but they ARE allowed to see their own transcript.
        const expiresAt = Date.now() + SESSION_SECONDS * 1000;
        const session = signDiscordSession({ id: discordUser.id, tag: member ? member.user.tag : discordUser.username, exp: expiresAt });
        res.setHeader('Set-Cookie', [
            `discordAuth=${session}; HttpOnly; Path=/; Max-Age=${SESSION_SECONDS}; SameSite=Lax`,
            `sessionExpires=${expiresAt}; Path=/; Max-Age=${SESSION_SECONDS}; SameSite=Lax`,
            'oauthState=; Path=/; Max-Age=0',
            'oauthReturnTo=; Path=/; Max-Age=0'
        ]);
        logAudit('DISCORD_LOGIN', discordUser.username, `Logged in via Discord OAuth2`);

        // A generic sign-in with nowhere specific to go (no transcript, no
        // particular page) from someone who isn't staff has no dashboard page
        // they can actually see — send them to coming-soon instead of a page
        // they'd immediately get turned away from. Anyone headed somewhere
        // specific (a transcript link, etc.) goes there and lets that route's
        // own permission check decide.
        if (!staff && returnTo === '/') {
            return res.redirect('/coming-soon?notStaff=1');
        }
        res.redirect(returnTo);
    } catch (err) {
        console.error('[discord oauth] failed:', err);
        res.redirect('/login?error=discord_failed');
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
    res.redirect('/login');
});

app.post('/api/logout', (req, res) => {
    clearAuthCookies(res);
    res.json({ success: true });
});

app.use((req, res, next) => {
    if (req.path === '/index.html' || req.path === '/transcript.html' || req.path === '/settings.html') return res.status(403).send('Forbidden');
    next();
});

app.get('/theme.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'theme.js'));
});

app.get('/version-check.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'version-check.js'));
});

app.use(express.static(path.join(__dirname, 'views'), { index: false }));

function requireDiscordOrTicketToken(req, res, next) {
    // Staff who are already signed in — whether via the shared access code or
    // an already-staff Discord session — have full dashboard access and
    // shouldn't need a *separate* Discord login just to open a transcript
    // link. Only fall back to requiring one when nobody's authenticated yet.
    const authed = isRequestAuthed(req);
    if (authed) {
        if (authed.id) {
            const guild = getTargetGuild();
            const guildConfig = guild ? getGuildConfig(guild.id) : defaultConfig();
            const restriction = getStaffRestriction(guildConfig, authed.id);
            if (isSiteBanned(restriction) || isLoginBlocked(restriction)) {
                clearAuthCookies(res);
                if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Your access to website transcripts has been banned by an Administrator.' });
                return res.status(403).send('🔒 Your access to transcripts has been suspended.');
            }
            const member = guild ? guild.members.cache.get(authed.id) : null;
            if (member && isStaff(member, guildConfig)) {
                req.authUser = authed;
                return next();
            }
            // Discord session but not staff — only their own ticket is allowed.
            const ticket = archivedTickets.get(req.params.id);
            if (!ticket) {
                if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Transcript not found.' });
                return res.status(404).send('Transcript not found.');
            }
            if (ticket.openedById === authed.id) {
                req.authUser = authed;
                return next();
            }
            if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Access denied: You do not have permission to view this transcript.' });
            return res.status(403).send('<h2 style="font-family:sans-serif;color:#ef4444;padding:40px;text-align:center;background:#0a0c11;min-height:100vh;margin:0;">🔒 Access Denied: You do not have permission to view this transcript.</h2>');
        }
        // Access-code ("master") login — full access, no extra check needed.
        req.authUser = authed;
        return next();
    }

    // Not authenticated at all yet — a valid transcript token in the URL
    // (the link DMed to the opener when their ticket closed) works without
    // any login; otherwise send them to sign in with Discord.
    const ticket = archivedTickets.get(req.params.id);
    if (ticket && ticket.accessToken && req.query.token && req.query.token === ticket.accessToken) {
        return next();
    }

    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized: Discord sign-in required.' });
    return res.redirect(`/auth/discord?returnTo=${encodeURIComponent(req.path)}`);
}

// ---------------------------------------------------------------------------
// VIEW ROUTES
// ---------------------------------------------------------------------------
app.get('/login', (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'login.html')));
app.get('/coming-soon', (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'coming-soon.html')));

app.get('/', maintenanceGate, requireAuth, requireTabPermission('archive'), (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'index.html')));
app.get('/tickets', maintenanceGate, requireAuth, requireTabPermission('tickets'), (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'tickets.html')));
app.get('/tickets/:channelId', maintenanceGate, requireAuth, requireTabPermission('tickets'), (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'live-ticket.html')));
app.get('/panels', maintenanceGate, requireAuth, requireTabPermission('panels'), (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'panels.html')));
app.get('/tags', maintenanceGate, requireAuth, requireTabPermission('tags'), (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'tags.html')));

app.get('/quickwords', maintenanceGate, requireAuth, requireTabPermission('quickwords'), (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'quickwords.html')));

app.get('/api/quickwords', maintenanceGate, requireAuth, (req, res) => {
    const userId = req.authUser?.id;
    const myPersonal = (userId && quickWordsData.personal[userId]) ? quickWordsData.personal[userId] : [];
    return res.json({
        global: quickWordsData.global || [],
        personal: myPersonal,
        myPersonal
    });
});

app.post('/api/quickwords', maintenanceGate, requireAuth, (req, res) => {
    const { label, text, isGlobal } = req.body || {};
    if (!label || !text) return res.status(400).json({ error: 'Label and text are required.' });

    const guild = getTargetGuild();
    const guildConfig = guild ? getGuildConfig(guild.id) : defaultConfig();
    const ctx = getViewerContext(req, guild, guildConfig);

    if (isGlobal && ctx.tier === 'staff') {
        return res.status(403).json({ error: 'Only Administrators can create Global canned responses.' });
    }

    const userId = req.authUser?.id;
    if (!isGlobal && !userId) {
        return res.status(400).json({ error: 'You must be signed in with Discord to save Personal canned responses.' });
    }

    const entry = { id: crypto.randomBytes(4).toString('hex'), label: label.trim(), text: text.trim() };
    const actor = resolveActorName(req);

    if (isGlobal) {
        quickWordsData.global.push(entry);
        logAudit('CREATE_QUICKWORD_GLOBAL', actor, `Created Global canned response: "${label}" (id: ${entry.id})`);
    } else {
        if (!quickWordsData.personal[userId]) quickWordsData.personal[userId] = [];
        quickWordsData.personal[userId].push(entry);
        logAudit('CREATE_QUICKWORD_PERSONAL', actor, `Created Personal canned response: "${label}" (id: ${entry.id})`);
    }
    saveQuickWords();
    res.json({ success: true, entry });
});

app.delete('/api/quickwords/:id', maintenanceGate, requireAuth, (req, res) => {
    const { id } = req.params;
    const guild = getTargetGuild();
    const guildConfig = guild ? getGuildConfig(guild.id) : defaultConfig();
    const ctx = getViewerContext(req, guild, guildConfig);
    const actor = resolveActorName(req);

    const isGlobalWord = quickWordsData.global.some(q => q.id === id);
    if (isGlobalWord && ctx.tier === 'staff') {
        return res.status(403).json({ error: 'Only Administrators can delete Global canned responses.' });
    }

    let removed = false;
    if (isGlobalWord) {
        quickWordsData.global = quickWordsData.global.filter(q => q.id !== id);
        removed = true;
        logAudit('DELETE_QUICKWORD_GLOBAL', actor, `Deleted Global canned response ID ${id}`);
    } else {
        const userId = req.authUser?.id;
        if (userId && quickWordsData.personal[userId]) {
            quickWordsData.personal[userId] = quickWordsData.personal[userId].filter(q => q.id !== id);
            removed = true;
            logAudit('DELETE_QUICKWORD_PERSONAL', actor, `Deleted Personal canned response ID ${id}`);
        }
    }

    saveQuickWords();
    res.json({ success: removed });
});

app.get('/feedback', maintenanceGate, requireAuth, requireTabPermission('feedback'), (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'feedback.html')));
app.get('/moderation', maintenanceGate, requireAuth, requireTabPermission('moderation'), (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'moderation.html')));
app.get('/moderation/:userId', maintenanceGate, requireAuth, requireTabPermission('moderation'), (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'member-detail.html')));
app.get('/blacklist', maintenanceGate, requireAuth, requireTabPermission('blacklist'), (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'blacklist.html')));
app.get('/lookup', maintenanceGate, requireAuth, requireTabPermission('lookup'), (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'lookup.html')));
app.get('/shift-roster', maintenanceGate, requireAuth, requireTabPermission('shiftroster'), (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'shift-roster.html')));

app.get('/audit-log', maintenanceGate, requireAuth, requireTabPermission('auditlog'), (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'audit-log.html')));
app.get('/settings', maintenanceGate, requireAuth, requireTabPermission('settings'), (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'settings.html')));
app.get('/account', maintenanceGate, requireAuth, (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'account.html')));
app.get('/bot-commands', maintenanceGate, requireAuth, requireTabPermission('settings'), (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'bot-commands.html')));
app.get('/transcript/:id', maintenanceGate, requireDiscordOrTicketToken, (req, res) => sendTemplate(req, res, path.join(__dirname, 'views', 'transcript.html')));

app.get('/api/tickets/:id', maintenanceGate, requireDiscordOrTicketToken, (req, res) => {
    const ticket = archivedTickets.get(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Transcript not found.' });
    res.json(ticket);
});

// User Context API — used by the sidebar nav on every page, and by the
// account page. Previously only handled a Discord session; a shared
// access-code ("master") login just got a bare 401 with no way for the
// account page to show anything sensible for that case.
app.get('/api/me', (req, res) => {
    const cookies = parseCookies(req);

    if (cookies.ticketAuth === computeAuthToken(siteConfig.password)) {
        return res.json({
            master: true,
            tag: 'Staff (access code)',
            displayName: 'Staff (access code)',
            avatarURL: null,
            tier: 'master',
            isStaff: true,
            isAdmin: true
        });
    }

    const session = verifyDiscordSession(cookies.discordAuth);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });

    const guild = getTargetGuild();
    const guildConfig = guild ? getGuildConfig(guild.id) : defaultConfig();
    const member = guild ? guild.members.cache.get(session.id) : null;
    const admin = Boolean(member && isAdmin(member, guildConfig));
    const staff = Boolean(member && isStaff(member, guildConfig));

    res.json({
        id: session.id,
        tag: session.tag,
        displayName: member ? member.displayName : session.tag,
        avatarURL: member ? member.displayAvatarURL({ size: 64 }) : null,
        isStaff: staff,
        isAdmin: admin,
        tier: admin ? 'admin' : (staff ? 'staff' : 'member')
    });
});

// ---------------------------------------------------------------------------
// SHIFT & DUTY API
// ---------------------------------------------------------------------------
app.get('/api/shifts', maintenanceGate, requireAuth, (req, res) => {
    const userId = req.authUser?.id;
    const roster = Object.entries(shiftData).map(([id, info]) => ({
        userId: id,
        ...info
    }));
    res.json({
        myStatus: userId ? shiftData[userId] || { onDuty: false } : { onDuty: false },
        roster
    });
});

app.post('/api/shifts/toggle', maintenanceGate, requireAuth, (req, res) => {
    const userId = req.authUser?.id || 'master';
    const tag = req.authUser?.name || 'Staff User';
    
    if (!shiftData[userId]) {
        shiftData[userId] = { tag, onDuty: false, shiftStarted: null, totalHours: 0 };
    }

    const current = shiftData[userId];
    current.onDuty = !current.onDuty;
    
    if (current.onDuty) {
        current.shiftStarted = new Date().toISOString();
        logAudit('DUTY_ON', tag, 'Clocked on duty');
    } else {
        if (current.shiftStarted) {
            const durationHrs = (Date.now() - new Date(current.shiftStarted).getTime()) / 3600000;
            current.totalHours = parseFloat(((current.totalHours || 0) + durationHrs).toFixed(1));
        }
        current.shiftStarted = null;
        logAudit('DUTY_OFF', tag, 'Clocked off duty');
    }

    res.json({ success: true, status: current });
});

// ---------------------------------------------------------------------------
// API ROUTES
// ---------------------------------------------------------------------------
app.get('/api/version', (req, res) => {
    res.json({ version: BUILD_VERSION });
});

app.get('/api/tickets', maintenanceGate, requireAuth, requireTabPermission('archive'), (req, res) => res.json(Array.from(archivedTickets.values())));

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

app.get('/api/feedback', maintenanceGate, requireAuth, requireTabPermission('feedback'), (req, res) => res.json(feedbackData));
app.get('/api/audit-log', maintenanceGate, requireAuth, requireTabPermission('auditlog'), (req, res) => res.json(auditLogs));

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
        const ctx = getViewerContext(req, guild, guildConfig);

        const roles = guild.roles.cache
            .filter(r => r.id !== guild.id)
            .sort((a, b) => b.position - a.position)
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? null : r.hexColor, memberCount: r.members.size }));

        const categories = guild.channels.cache
            .filter(c => c.type === ChannelType.GuildCategory)
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const channels = guild.channels.cache
            .filter(c => c.type === ChannelType.GuildText)
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
            channels,
            staffRoleIds: guildConfig.staffRoleIds,
            adminRoleIds: guildConfig.adminRoleIds,
            staffPermissions: guildConfig.staffPermissions,
            viewerTier: ctx.tier,
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
                restrictToTeamOnly: Boolean(p.restrictToTeamOnly),
                postChannelId: p.postChannelId || null
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
    const validTabs = ['archive', 'tickets', 'panels', 'tags', 'feedback', 'moderation', 'lookup', 'blacklist', 'shiftroster', 'quickwords', 'auditlog', 'settings'];

    guildConfig.staffPermissions = {
        allowedTabs: Array.isArray(allowedTabs) ? allowedTabs.filter(t => validTabs.includes(t)) : (guildConfig.staffPermissions?.allowedTabs || []),
        canModerate: typeof canModerate === 'boolean' ? canModerate : defaultConfig().staffPermissions.canModerate
    };

    saveConfigs();
    logAudit('UPDATE_PERMISSIONS', actor, `Updated staff dashboard permissions`);
    res.json({ success: true, staffPermissions: guildConfig.staffPermissions });
});

app.post('/api/guild/panels', maintenanceGate, requireAuth, requireTabPermission('panels'), (req, res) => {
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
        const postChannelId = (edit.postChannelId && guild.channels.cache.has(edit.postChannelId)) ? edit.postChannelId : null;

        if (!title || title.length > 256) errors.push(`${typeKey}: title must be 1-256 characters`);
        if (!description || description.length > 4096) errors.push(`${typeKey}: description must be 1-4096 characters`);
        if (!buttonLabel || buttonLabel.length > 80) errors.push(`${typeKey}: button text must be 1-80 characters`);
        if (!promptLabel || promptLabel.length > 45) errors.push(`${typeKey}: modal question must be 1-45 characters`);
        if (emoji && !isValidEmoji(emoji)) errors.push(`${typeKey}: "${emoji}" isn't a valid emoji`);
        if (!colorHex) errors.push(`${typeKey}: color must be a hex value like #2ecc71`);
        if (restrictToTeamOnly && !teamRoleIds.length) errors.push(`${typeKey}: pick at least one team role before restricting to team-only`);

        validated[typeKey] = { title, description, buttonLabel, promptLabel, emoji, style, colorHex, teamRoleIds, restrictToTeamOnly, postChannelId };
    }

    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    for (const [typeKey, v] of Object.entries(validated)) {
        guildConfig.panels[typeKey] = {
            ...guildConfig.panels[typeKey],
            title: v.title, description: v.description, buttonLabel: v.buttonLabel,
            promptLabel: v.promptLabel, emoji: v.emoji, style: v.style,
            color: parseInt(v.colorHex.slice(1), 16),
            teamRoleIds: v.teamRoleIds,
            restrictToTeamOnly: v.restrictToTeamOnly,
            postChannelId: v.postChannelId
        };
    }
    saveConfigs();
    logAudit('UPDATE_PANELS', resolveActorName(req), `Updated support panels`);
    res.json({ success: true });
});

app.post('/api/guild/panels/create', maintenanceGate, requireAuth, requireTabPermission('panels'), (req, res) => {
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
        restrictToTeamOnly: false,
        postChannelId: null
    };
    saveConfigs();
    logAudit('CREATE_PANEL', resolveActorName(req), `Created panel "${name}" (${typeKey})`);
    res.json({ success: true, typeKey, panel: guildConfig.panels[typeKey] });
});

// Posts a single panel's embed + open-ticket button into a chosen text channel,
// so panels no longer require running /sendpanels in Discord at all — staff can
// configure and (re)post them entirely from this page.
app.post('/api/guild/panels/:typeKey/post', maintenanceGate, requireAuth, requireTabPermission('panels'), async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const guildConfig = getGuildConfig(guild.id);
    const { typeKey } = req.params;
    const panel = guildConfig.panels[typeKey];
    if (!panel) return res.status(404).json({ error: 'Panel not found.' });

    const channelId = String(req.body?.channelId || panel.postChannelId || '').trim();
    if (!channelId) return res.status(400).json({ error: 'Choose a channel to post this panel to first.' });

    try {
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildText) {
            return res.status(400).json({ error: 'That channel could not be found or is not a text channel.' });
        }

        const embed = new EmbedBuilder().setTitle(clamp(panel.title, 256)).setDescription(clamp(panel.description, 4096)).setColor(panel.color);
        const button = new ButtonBuilder().setCustomId(`open_ticket_${typeKey}`).setLabel(clamp(panel.buttonLabel, 80)).setStyle(STYLE_MAP[panel.style] || ButtonStyle.Secondary);
        if (panel.emoji && isValidEmoji(panel.emoji)) button.setEmoji(panel.emoji);
        await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });

        panel.postChannelId = channelId;
        saveConfigs();
        logAudit('POST_PANEL', resolveActorName(req), `Posted panel "${typeKey}" to #${channel.name}`);
        res.json({ success: true });
    } catch (err) {
        console.error('[post panel] failed:', err);
        res.status(500).json({ error: `Could not post the panel. (${err.message})` });
    }
});

// Posts every configured panel as a single "Open A Ticket" dropdown message
// instead of one embed+button per panel — players pick a type from the list
// rather than scrolling past several separate panel messages.
app.post('/api/guild/panels/post-dropdown', maintenanceGate, requireAuth, requireTabPermission('panels'), async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const guildConfig = getGuildConfig(guild.id);

    const channelId = String(req.body?.channelId || '').trim();
    if (!channelId) return res.status(400).json({ error: 'Choose a channel first.' });
    const messageText = String(req.body?.message || '').trim().slice(0, 1900);

    const panelEntries = Object.entries(guildConfig.panels);
    if (!panelEntries.length) return res.status(400).json({ error: 'No panels configured yet.' });
    if (panelEntries.length > 25) return res.status(400).json({ error: 'Discord dropdowns support at most 25 options, and you have more panels than that — post some individually instead.' });

    try {
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildText) {
            return res.status(400).json({ error: 'That channel could not be found or is not a text channel.' });
        }

        const select = new StringSelectMenuBuilder()
            .setCustomId('open_ticket_select')
            .setPlaceholder('Open A Ticket')
            .addOptions(panelEntries.map(([typeKey, p]) => {
                const opt = { label: clamp(p.buttonLabel || typeKey, 100) || typeKey, value: typeKey, description: clamp(p.title || '', 100) || undefined };
                if (p.emoji && isValidEmoji(p.emoji)) opt.emoji = p.emoji;
                return opt;
            }));

        await channel.send({ content: messageText || undefined, components: [new ActionRowBuilder().addComponents(select)] });

        logAudit('POST_PANEL_DROPDOWN', resolveActorName(req), `Posted combined panel dropdown (${panelEntries.length} panels) to #${channel.name}`);
        res.json({ success: true });
    } catch (err) {
        console.error('[post panel dropdown] failed:', err);
        res.status(500).json({ error: `Could not post the dropdown. (${err.message})` });
    }
});

// ---------------------------------------------------------------------------
// BOT COMMANDS (enable/disable + restrict per command)
// ---------------------------------------------------------------------------
app.get('/api/guild/commands', maintenanceGate, requireAuth, requireTabPermission('settings'), (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const guildConfig = getGuildConfig(guild.id);
    res.json({ commandSettings: guildConfig.commandSettings });
});

app.post('/api/guild/commands', maintenanceGate, requireAuth, requireTabPermission('settings'), (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const guildConfig = getGuildConfig(guild.id);

    const updates = req.body?.commandSettings || {};
    const validTiers = new Set(['everyone', 'staff', 'admin']);
    const errors = [];

    for (const [name, val] of Object.entries(updates)) {
        if (!guildConfig.commandSettings[name]) continue;
        const enabled = typeof val?.enabled === 'boolean' ? val.enabled : guildConfig.commandSettings[name].enabled;
        const minTier = validTiers.has(val?.minTier) ? val.minTier : guildConfig.commandSettings[name].minTier;
        guildConfig.commandSettings[name] = { enabled, minTier };
    }

    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    saveConfigs();
    logAudit('UPDATE_COMMAND_SETTINGS', resolveActorName(req), 'Updated bot command enable/restrict settings');
    res.json({ success: true, commandSettings: guildConfig.commandSettings });
});

app.delete('/api/guild/panels/:typeKey', maintenanceGate, requireAuth, requireTabPermission('panels'), (req, res) => {
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

app.get('/api/open-tickets', maintenanceGate, requireAuth, requireTabPermission('tickets'), (req, res) => {
    const guild = getTargetGuild();
    const list = Array.from(openTickets.entries()).map(([channelId, t]) => ({
        channelId,
        guildId: t.guildId,
        type: t.type,
        userTag: t.userTag,
        robloxUsername: t.robloxUsername,
        reason: t.reason,
        priority: t.priority || 'normal',
        claimedBy: t.claimedBy ? t.claimedBy.tag : null,
        openedAt: t.openedAt,
        closing: Boolean(t.closing),
        tags: Array.isArray(t.tags) ? t.tags : [],
        discordUrl: t.guildId ? `https://discord.com/channels/${t.guildId}/${channelId}` : (guild ? `https://discord.com/channels/${guild.id}/${channelId}` : null)
    }));
    res.json(list);
});

app.post('/api/open-tickets/:channelId/tags', maintenanceGate, requireAuth, requireTabPermission('tickets'), (req, res) => {
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

app.post('/api/open-tickets/:channelId/priority', maintenanceGate, requireAuth, requireTabPermission('tickets'), async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const ticket = openTickets.get(req.params.channelId);
    if (!ticket) return res.status(404).json({ error: 'That ticket is no longer open.' });

    const priority = String(req.body?.priority || '').toLowerCase();
    if (!PRIORITY_LEVELS.includes(priority)) return res.status(400).json({ error: `Priority must be one of: ${PRIORITY_LEVELS.join(', ')}.` });

    if (req.authUser && req.authUser.id) {
        const guildConfig = getGuildConfig(guild.id);
        if (isTicketsSuspended(getStaffRestriction(guildConfig, req.authUser.id))) {
            return res.status(403).json({ error: 'An Administrator has suspended you from working on tickets.' });
        }
    }

    ticket.priority = priority;
    openTickets.set(req.params.channelId, ticket);
    saveOpenTickets();

    try {
        const channel = await client.channels.fetch(req.params.channelId).catch(() => null);
        if (channel) {
            await syncTicketChannelName(channel, ticket);
            await updateTicketPriorityEmbed(channel, ticket, priority);
        }
    } catch (err) {
        console.error('[priority sync] failed:', err.message);
    }

    res.json({ success: true, priority });
});

app.get('/api/open-tickets/:channelId/messages', maintenanceGate, requireAuth, requireTabPermission('tickets'), async (req, res) => {
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
                priority: ticket.priority || 'normal',
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

app.post('/api/open-tickets/:channelId/messages', maintenanceGate, requireAuth, requireTabPermission('tickets'), async (req, res) => {
    const ticket = openTickets.get(req.params.channelId);
    if (!ticket) return res.status(404).json({ error: 'This ticket is no longer open.' });

    const guild = getTargetGuild();
    if (req.authUser && req.authUser.id) {
        const guildConfig = guild ? getGuildConfig(guild.id) : null;
        if (guildConfig && isTicketsSuspended(getStaffRestriction(guildConfig, req.authUser.id))) {
            return res.status(403).json({ error: 'An Administrator has suspended you from working on tickets.' });
        }
    }

    const content = String(req.body?.content || '').trim();
    const asName = String(req.body?.asName || '').trim().slice(0, 40);
    if (!content) return res.status(400).json({ error: 'Message cannot be blank.' });
    if (content.length > 1900) return res.status(400).json({ error: 'Message is too long (max 1900 characters).' });

    try {
        const channel = await client.channels.fetch(req.params.channelId).catch(() => null);
        if (!channel) return res.status(404).json({ error: "Could not find channel in Discord." });

        const senderName = asName || ticket.claimedBy?.tag || 'Staff (via Website)';
        await sendTicketMessage(channel, content, senderName);

        const messageData = {
            author: senderName,
            isBot: false,
            content,
            attachments: [],
            timestamp: new Date().toISOString()
        };

        io.to(`ticket_${req.params.channelId}`).emit('ticket_message', messageData);

        res.json({ success: true });
    } catch (err) {
        console.error('[open-ticket send] failed:', err);
        res.status(500).json({ error: 'Could not send the message.' });
    }
});

app.post('/api/open-tickets/:channelId/close', maintenanceGate, requireAuth, requireTabPermission('tickets'), async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const ticket = openTickets.get(req.params.channelId);
    if (!ticket) return res.status(404).json({ error: 'This ticket is already closed.' });
    if (ticket.closing) return res.status(409).json({ error: 'Already closing.' });

    const guildConfigForCheck = getGuildConfig(guild.id);
    if (req.authUser && req.authUser.id && isTicketsSuspended(getStaffRestriction(guildConfigForCheck, req.authUser.id))) {
        return res.status(403).json({ error: 'An Administrator has suspended you from working on tickets.' });
    }

    const asName = String(req.body?.asName || '').trim().slice(0, 40) || 'Staff (via Website)';

   try {
        const channel = await client.channels.fetch(req.params.channelId).catch(() => null);
        if (!channel) return res.status(404).json({ error: "Could not find channel in Discord." });

        ticket.closing = true;
        openTickets.set(req.params.channelId, ticket);
        saveOpenTickets();

        const guildConfig = getGuildConfig(guild.id);
        await channel.send(`⛔ **${asName}** closed this ticket from the website. Archiving now...`).catch(() => {});
        clearCloseRequestTimer(channel.id);
        
        // Archive the transcript and delete the channel immediately — finalizeTicketClose
        // handles the delete itself, there is no "keep it around locked" option anymore.
        await finalizeTicketClose(channel, guild, guildConfig, asName);

        res.json({ success: true });
    } catch (err) {
        console.error('[open-ticket close] failed:', err);
        res.status(500).json({ error: 'Could not close the ticket.' });
    }
});

app.post('/api/guild/tags', maintenanceGate, requireAuth, requireTabPermission('tags'), (req, res) => {
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

app.delete('/api/guild/tags/:tagId', maintenanceGate, requireAuth, requireTabPermission('tags'), (req, res) => {
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

app.post('/api/guild/roles', maintenanceGate, requireAuth, async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const { staffRoleIds, adminRoleIds } = req.body || {};
    if (!Array.isArray(staffRoleIds) || !Array.isArray(adminRoleIds)) {
        return res.status(400).json({ error: 'staffRoleIds and adminRoleIds must be arrays.' });
    }

    const guildConfig = getGuildConfig(guild.id);
    guildConfig.staffRoleIds = staffRoleIds;
    guildConfig.adminRoleIds = adminRoleIds;
    saveConfigs();
    logAudit('UPDATE_ROLES', resolveActorName(req), 'Updated staff & admin role assignments');
    res.json({ success: true });
});

app.post('/api/guild/categories', maintenanceGate, requireAuth, async (req, res) => {
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
    logAudit('UPDATE_CATEGORIES', resolveActorName(req), 'Updated ticket categories');
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
// ROBLOX & USER LOOKUP ROUTES
// ---------------------------------------------------------------------------
app.get('/api/roblox/lookup/:query', maintenanceGate, requireAuth, async (req, res) => {
    const query = String(req.params.query || '').trim();
    if (!query) return res.status(400).json({ error: 'Query required' });

    try {
        let userId = query;
        let username = query;

        const headers = { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Content-Type': 'application/json'
        };

        if (isNaN(query)) {
            const exactRes = await fetch('https://users.roblox.com/v1/usernames/users', {
                method: 'POST',
                headers,
                body: JSON.stringify({ usernames: [query], excludeBannedUsers: false })
            });
            const exactData = await exactRes.json();

            if (exactData.data && exactData.data.length > 0) {
                userId = exactData.data[0].id;
                username = exactData.data[0].name;
            } else {
                const searchRes = await fetch(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(query)}&limit=1`, { headers });
                const searchData = await searchRes.json();
                if (!searchData.data || !searchData.data.length) return res.status(404).json({ error: 'Roblox user not found' });
                userId = searchData.data[0].id;
                username = searchData.data[0].name;
            }
        } else {
            const userRes = await fetch(`https://users.roblox.com/v1/users/${userId}`, { headers });
            if (!userRes.ok) return res.status(404).json({ error: 'Roblox user not found' });
            const userData = await userRes.json();
            username = userData.name;
        }

        const thumbRes = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`, { headers });
        const thumbData = await thumbRes.json();
        const avatarUrl = thumbData.data?.[0]?.imageUrl || '';

        res.json({ id: userId, username, avatarUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/lookup/:query', maintenanceGate, requireAuth, requireTabPermission('lookup'), async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const query = String(req.params.query || '').trim().toLowerCase();

    try {
        let member = await guild.members.fetch(query).catch(() => null);
        if (!member) {
            const searchResult = await guild.members.fetch({ query, limit: 1 });
            member = searchResult.first() || null;
        }
        if (!member) return res.status(404).json({ error: 'Member not found' });

        const openCount = Array.from(openTickets.values()).filter(t => t.userId === member.id).length;
        const archives = Array.from(archivedTickets.values()).filter(t => t.openedById === member.id);
        const notes = moderationNotes.get(member.id) || [];

        res.json({
            user: {
                id: member.id,
                tag: member.user.tag,
                displayName: member.displayName,
                avatarURL: member.displayAvatarURL({ size: 128 }),
                roles: member.roles.cache.filter(r => r.id !== guild.id).map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? null : r.hexColor }))
            },
            ticketStats: {
                openCount,
                archiveCount: archives.length,
                archives
            },
            notes
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// MODERATION API
// ---------------------------------------------------------------------------
function serializeMember(guild, m, guildConfig) {
    const notes = moderationNotes.get(m.id) || [];
    const restriction = guildConfig ? getStaffRestriction(guildConfig, m.id) : null;
    return {
        id: m.id,
        tag: m.user.tag,
        displayName: m.displayName,
        joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
        roles: m.roles.cache.filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position).map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? null : r.hexColor, isAdmin: r.permissions.has(PermissionFlagsBits.Administrator) })),
        isTimedOut: Boolean(m.communicationDisabledUntil && m.communicationDisabledUntil.getTime() > Date.now()),
        isOwner: m.id === guild.ownerId,
        noteCount: notes.length,
        warningCount: notes.filter(n => n.type === 'warning').length,
        restricted: Boolean(restriction)
    };
}

app.get('/api/moderation/members', maintenanceGate, requireAuth, requireTabPermission('moderation'), async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const query = (req.query.query || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const after = req.query.after || undefined;
    const guildConfig = getGuildConfig(guild.id);

    try {
        let members = query ? await guild.members.fetch({ query, limit }) : await guild.members.list({ limit, after });
        const list = members.map(m => serializeMember(guild, m, guildConfig));
        const nextAfter = (!query && members.size === limit) ? members.last().id : null;
        res.json({ members: list, nextAfter, totalMemberCount: guild.memberCount });
    } catch (err) {
        console.error('[moderation members] failed:', err);
        res.status(500).json({ error: 'Could not fetch members from Discord.' });
    }
});

app.get('/api/moderation/members/:userId', maintenanceGate, requireAuth, requireTabPermission('moderation'), async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    try {
        const member = await guild.members.fetch(req.params.userId).catch(() => null);
        if (!member) return res.status(404).json({ error: 'That member is no longer in the server.' });
        const guildConfig = getGuildConfig(guild.id);
        res.json({
            ...serializeMember(guild, member, guildConfig),
            avatarURL: member.displayAvatarURL({ size: 64 }),
            createdAt: member.user.createdAt.toISOString(),
            timeoutUntil: member.communicationDisabledUntil ? member.communicationDisabledUntil.toISOString() : null,
            notes: moderationNotes.get(req.params.userId) || [],
            allGuildRoles: guild.roles.cache.filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position).map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? null : r.hexColor, isAdmin: r.permissions.has(PermissionFlagsBits.Administrator) })),
            isStaff: isStaff(member, guildConfig),
            staffRoleIds: guildConfig.staffRoleIds || [],
            adminRoleIds: guildConfig.adminRoleIds || [],
            restriction: getStaffRestriction(guildConfig, req.params.userId)
        });
    } catch (err) {
        console.error('[moderation member detail] failed:', err);
        res.status(500).json({ error: 'Could not fetch that member.' });
    }
});

app.post('/api/moderation/members/:userId/notes', maintenanceGate, requireAuth, requireTabPermission('moderation'), requireModerationCapability, async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const actorIsAdmin = isCurrentActorAdmin(req, guild, getGuildConfig(guild.id));
    const targetMember = await guild.members.fetch(req.params.userId).catch(() => null);
    if (isModerationTargetRestricted(actorIsAdmin, targetMember, getGuildConfig(guild.id))) {
        return res.status(403).json({ error: 'Only Administrators can moderate Staff or Admin members.' });
    }
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

    if (targetMember) {
        const subject = type === 'warning' ? 'You received a warning' : 'You received a note';
        const body = `A staff member (${byName}) added a ${type} to your record on **${guild.name}**.\n\n${content}`;
        sendModerationDM(targetMember, subject, body);
    }

    res.json({ success: true, note });
});

app.delete('/api/moderation/members/:userId/notes/:noteId', maintenanceGate, requireAuth, requireTabPermission('moderation'), requireModerationCapability, (req, res) => {
    const list = moderationNotes.get(req.params.userId) || [];
    const filtered = list.filter(n => n.id !== req.params.noteId);
    if (filtered.length === list.length) return res.status(404).json({ error: 'Note not found.' });
    if (filtered.length) moderationNotes.set(req.params.userId, filtered);
    else moderationNotes.delete(req.params.userId);
    saveModerationNotes();
    logAudit('DELETE_NOTE', resolveActorName(req), `Deleted note ID ${req.params.noteId} for user ${req.params.userId}`);
    res.json({ success: true });
});

app.post('/api/moderation/members/:userId/nickname', maintenanceGate, requireAuth, requireTabPermission('moderation'), requireModerationCapability, async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const nickname = String(req.body?.nickname || '').trim().slice(0, 32);
    const byName = resolveActorName(req);
    const guildConfig = getGuildConfig(guild.id);
    const actorIsAdmin = isCurrentActorAdmin(req, guild, guildConfig);
    const member = await guild.members.fetch(req.params.userId).catch(() => null);
    if (!member) return res.status(404).json({ error: 'That member is no longer in the server.' });
    if (isModerationTargetRestricted(actorIsAdmin, member, guildConfig)) {
        return res.status(403).json({ error: 'Only Administrators can moderate Staff or Admin members.' });
    }
    if (member.id === guild.ownerId) return res.status(400).json({ error: "Can't change the server owner's nickname." });

    try {
        await member.setNickname(nickname || null, `Changed from website by ${byName}`);
        res.json({ success: true, nickname: nickname || null });
    } catch (err) {
        console.error('[moderation nickname] failed:', err);
        res.status(500).json({ error: `Could not change nickname. (${err.message})` });
    }
});

app.post('/api/moderation/members/:userId/roles', maintenanceGate, requireAuth, requireTabPermission('moderation'), requireModerationCapability, async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const guildConfig = getGuildConfig(guild.id);
    const addRoleId = req.body?.add;
    const removeRoleId = req.body?.remove;
    const byName = resolveActorName(req);
    if (!addRoleId && !removeRoleId) return res.status(400).json({ error: 'Nothing to change.' });

    const actorMember = req.authUser?.id ? await guild.members.fetch(req.authUser.id).catch(() => null) : null;
    const actorIsAdmin = actorMember && isAdmin(actorMember, guildConfig);
    const protectedRoleIds = new Set([...(guildConfig.staffRoleIds || []), ...(guildConfig.adminRoleIds || [])]);

    try {
        const member = await guild.members.fetch(req.params.userId).catch(() => null);
        if (!member) return res.status(404).json({ error: 'That member is no longer in the server.' });

        const targetIsAdmin = isAdmin(member, guildConfig);
        const targetIsStaff = isStaff(member, guildConfig) && !targetIsAdmin;

        if (!actorIsAdmin && (targetIsAdmin || targetIsStaff)) {
            return res.status(403).json({ error: 'Only Administrators can change roles for Staff or Admin members.' });
        }

        if (!actorIsAdmin) {
            if (addRoleId && protectedRoleIds.has(addRoleId)) {
                return res.status(403).json({ error: 'Only Administrators can assign Staff or Admin roles.' });
            }
            if (removeRoleId && protectedRoleIds.has(removeRoleId)) {
                return res.status(403).json({ error: 'Only Administrators can remove Staff or Admin roles.' });
            }
            if (removeRoleId) {
                const role = guild.roles.cache.get(removeRoleId);
                if (role && role.permissions.has(PermissionFlagsBits.Administrator)) {
                    return res.status(403).json({ error: 'Only Administrators can remove roles with Administrator permissions.' });
                }
            }
            if (addRoleId) {
                const role = guild.roles.cache.get(addRoleId);
                if (role && role.permissions.has(PermissionFlagsBits.Administrator)) {
                    return res.status(403).json({ error: 'Only Administrators can assign roles with Administrator permissions.' });
                }
            }
        }

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

app.post('/api/moderation/members/:userId/timeout', maintenanceGate, requireAuth, requireTabPermission('moderation'), requireModerationCapability, async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const guildConfig = getGuildConfig(guild.id);
    const actorIsAdmin = isCurrentActorAdmin(req, guild, guildConfig);
    const minutes = Number.isFinite(req.body?.minutes) ? req.body.minutes : null;
    const reason = String(req.body?.reason || '').trim().slice(0, 400);
    const byName = resolveActorName(req);

    try {
        const member = await guild.members.fetch(req.params.userId).catch(() => null);
        if (!member) return res.status(404).json({ error: 'That member is no longer in the server.' });
        if (isModerationTargetRestricted(actorIsAdmin, member, guildConfig)) {
            return res.status(403).json({ error: 'Only Administrators can moderate Staff or Admin members.' });
        }
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

app.post('/api/moderation/members/:userId/kick', maintenanceGate, requireAuth, requireTabPermission('moderation'), requireModerationCapability, async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const guildConfig = getGuildConfig(guild.id);
    const actorIsAdmin = isCurrentActorAdmin(req, guild, guildConfig);
    const reason = String(req.body?.reason || '').trim();
    const byName = resolveActorName(req);
    if (!reason) return res.status(400).json({ error: 'A reason is required.' });

    try {
        const member = await guild.members.fetch(req.params.userId).catch(() => null);
        if (!member) return res.status(404).json({ error: 'That member is no longer in the server.' });
        if (isModerationTargetRestricted(actorIsAdmin, member, guildConfig)) {
            return res.status(403).json({ error: 'Only Administrators can moderate Staff or Admin members.' });
        }
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

app.post('/api/moderation/members/:userId/ban', maintenanceGate, requireAuth, requireTabPermission('moderation'), requireModerationCapability, async (req, res) => {
    const guild = getTargetGuild();
    if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
    const guildConfig = getGuildConfig(guild.id);
    const actorIsAdmin = isCurrentActorAdmin(req, guild, guildConfig);
    const reason = String(req.body?.reason || '').trim();
    const byName = resolveActorName(req);
    const deleteMessageDays = Math.min(Math.max(parseInt(req.body?.deleteMessageDays, 10) || 0, 0), 7);
    if (!reason) return res.status(400).json({ error: 'A reason is required.' });
    if (req.params.userId === guild.ownerId) return res.status(400).json({ error: "Can't ban the server owner." });

    try {
        let tag = req.params.userId;
        const member = await guild.members.fetch(req.params.userId).catch(() => null);
        if (member) {
            if (isModerationTargetRestricted(actorIsAdmin, member, guildConfig)) {
                return res.status(403).json({ error: 'Only Administrators can moderate Staff or Admin members.' });
            }
            tag = member.user.tag;
        }
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

app.get('/api/moderation/bans', maintenanceGate, requireAuth, requireTabPermission('moderation'), async (req, res) => {
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

app.delete('/api/moderation/bans/:userId', maintenanceGate, requireAuth, requireTabPermission('moderation'), requireModerationCapability, async (req, res) => {
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

app.get('/api/moderation/log', maintenanceGate, requireAuth, requireTabPermission('moderation'), (req, res) => {
    res.json(moderationLog.slice(0, 100));
});

// ---------------------------------------------------------------------------
// STAFF ACCESS RESTRICTIONS
// ---------------------------------------------------------------------------
app.post('/api/moderation/members/:userId/restrictions', maintenanceGate, requireAuth, requireTabPermission('moderation'), async (req, res) => {
    try {
        const guild = getTargetGuild();
        if (!guild) return res.status(503).json({ error: 'Bot is not currently in any server.' });
        const guildConfig = getGuildConfig(guild.id);
        if (!guildConfig.staffRestrictions) guildConfig.staffRestrictions = {};

        const actorIsAdmin = isCurrentActorAdmin(req, guild, guildConfig);
        if (!actorIsAdmin) return res.status(403).json({ error: 'Only Administrators can manage staff access restrictions.' });

        const targetId = req.params.userId;
        if (targetId === guild.ownerId) return res.status(400).json({ error: "Can't restrict the server owner." });
        if (req.authUser && req.authUser.id === targetId) return res.status(400).json({ error: "Can't restrict your own account." });

        const targetMember = await guild.members.fetch(targetId).catch(() => null);
        if (targetMember && isAdmin(targetMember, guildConfig) && req.authUser && req.authUser.id) {
            return res.status(403).json({ error: "Can't restrict another Administrator." });
        }

        const byName = resolveActorName(req);
        const body = req.body || {};
        const reason = String(body.reason || '').trim().slice(0, 300);
        const existing = guildConfig.staffRestrictions[targetId] || {};

        const next = {
            loginBlocked: typeof body.loginBlocked === 'boolean' ? body.loginBlocked : Boolean(existing.loginBlocked),
            siteBanned: typeof body.siteBanned === 'boolean' ? body.siteBanned : Boolean(existing.siteBanned),
            moderationBanned: typeof body.moderationBanned === 'boolean' ? body.moderationBanned : Boolean(existing.moderationBanned),
            ticketsSuspended: typeof body.ticketsSuspended === 'boolean' ? body.ticketsSuspended : Boolean(existing.ticketsSuspended),
            bannedUntil: existing.bannedUntil || null,
            reason: reason || existing.reason || '',
            byName,
            at: new Date().toISOString()
        };

        if (body.clearTempBan) next.bannedUntil = null;
        if (Number.isFinite(body.tempBanMinutes) && body.tempBanMinutes > 0) {
            const cappedMinutes = Math.min(body.tempBanMinutes, 129600); // cap at 90 days
            next.bannedUntil = new Date(Date.now() + cappedMinutes * 60000).toISOString();
        }

        const isNoop = !next.loginBlocked && !next.siteBanned && !next.moderationBanned && !next.ticketsSuspended && !next.bannedUntil;
        if (isNoop) {
            delete guildConfig.staffRestrictions[targetId];
        } else {
            guildConfig.staffRestrictions[targetId] = next;
        }
        saveConfigs();

        const targetTag = targetMember ? targetMember.user.tag : targetId;
        const summary = isNoop
            ? `Cleared all access restrictions for ${targetTag}`
            : `Updated access restrictions for ${targetTag} (login:${next.loginBlocked ? 'blocked' : 'ok'}, site:${next.siteBanned ? 'banned' : 'ok'}, mod:${next.moderationBanned ? 'banned' : 'ok'}, tickets:${next.ticketsSuspended ? 'suspended' : 'ok'}${next.bannedUntil ? `, tempBanUntil:${next.bannedUntil}` : ''})`;
        logAudit('UPDATE_STAFF_RESTRICTIONS', byName, summary);
        logModerationAction('restrict', targetId, targetTag, reason || (isNoop ? 'Cleared restrictions' : null), byName);

        if (targetMember && !isNoop) {
            sendModerationDM(targetMember, 'Your dashboard access has changed', `An Administrator (${byName}) updated your staff access restrictions on **${guild.name}**.${reason ? `\nReason: ${reason}` : ''}`);
        }

        res.json({ success: true, restriction: guildConfig.staffRestrictions[targetId] || null });
    } catch (err) {
        console.error('[staff restrictions save error]:', err);
        res.status(500).json({ error: err.message || 'Error saving staff restrictions.' });
    }
});

app.post('/api/guild/blacklist', maintenanceGate, requireAuth, requireTabPermission('blacklist'), (req, res) => {
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

app.delete('/api/guild/blacklist/:userId', maintenanceGate, requireAuth, requireTabPermission('blacklist'), (req, res) => {
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

// Public Terms of Service Route
app.get('/terms', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(siteConfig.siteTitle)} — Terms of Service</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root { --accent: ${siteConfig.accentColor || '#d69a4e'}; --bg: #0a0c11; --panel: #141722; --border: #262b3a; --ink: #e7e9ee; --muted: #9199a8; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px 20px; background: var(--bg); color: var(--ink); font-family: 'Inter', sans-serif; display: flex; justify-content: center; min-height: 100vh; }
  .container { max-width: 680px; width: 100%; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 30px; }
  .title { font-size: 24px; font-weight: 800; margin: 0; }
  .btn-home { background: var(--panel); border: 1px solid var(--border); color: var(--ink); text-decoration: none; padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; transition: border-color .15s; }
  .btn-home:hover { border-color: var(--accent); color: var(--accent); }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 28px; line-height: 1.65; font-size: 14px; }
  h2 { font-size: 16px; font-weight: 700; color: var(--accent); margin: 20px 0 8px; }
  h2:first-of-type { margin-top: 0; }
  p { color: var(--muted); margin: 0 0 12px; }
</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="title">Terms of Service</h1>
      <a href="/login" class="btn-home">← Return Home</a>
    </div>
    <div class="card">
      <h2>1. Service Acceptance</h2>
      <p>By accessing or using ${escapeHtml(siteConfig.siteTitle)}, you agree to comply with these terms. You agree not to abuse support ticket features, attempt unauthorized administrative access, or spam ticket commands.</p>

      <h2>2. Contractor Bug-Fixing & Maintenance Policy</h2>
      <p>If the bot or system experiences technical issues, bugs, or outages, maintenance and repairs will be performed by the developer under the condition that they are granted the designated <strong>Contractor</strong> role within the Discord server.</p>

      <h2>3. Limitations & Disclaimers</h2>
      <p>This service is provided "as-is" without explicit warranties. Administrators reserve the right to revoke user access or suspend system features if abuse or unauthorized behavior is detected.</p>
    </div>
  </div>
</body>
</html>`);
});

// Public Privacy Policy Route
app.get('/privacy', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(siteConfig.siteTitle)} — Privacy Policy</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root { --accent: ${siteConfig.accentColor || '#d69a4e'}; --bg: #0a0c11; --panel: #141722; --border: #262b3a; --ink: #e7e9ee; --muted: #9199a8; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px 20px; background: var(--bg); color: var(--ink); font-family: 'Inter', sans-serif; display: flex; justify-content: center; min-height: 100vh; }
  .container { max-width: 680px; width: 100%; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 30px; }
  .title { font-size: 24px; font-weight: 800; margin: 0; }
  .btn-home { background: var(--panel); border: 1px solid var(--border); color: var(--ink); text-decoration: none; padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; transition: border-color .15s; }
  .btn-home:hover { border-color: var(--accent); color: var(--accent); }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 28px; line-height: 1.65; font-size: 14px; }
  h2 { font-size: 16px; font-weight: 700; color: var(--accent); margin: 20px 0 8px; }
  h2:first-of-type { margin-top: 0; }
  p { color: var(--muted); margin: 0 0 12px; }
  ul { color: var(--muted); margin: 0 0 12px; padding-left: 20px; }
  li { margin-bottom: 6px; }
</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="title">Privacy Policy</h1>
      <a href="/login" class="btn-home">← Return Home</a>
    </div>
    <div class="card">
      <h2>1. Data We Collect</h2>
      <p>We store basic data required to archive tickets and maintain operational logs, including:</p>
      <ul>
        <li>Discord User IDs &amp; User Tags</li>
        <li>Channel IDs and ticket transcript message history</li>
        <li>Moderation action records and staff audit logs</li>
      </ul>

      <h2>2. How We Use Data</h2>
      <p>Data is processed strictly to generate web-based support transcripts and enable staff dashboard management features.</p>

      <h2>3. Retention &amp; Deletion</h2>
      <p>Data is stored securely. Server administrators may request transcript or log purges at any time.</p>
    </div>
  </div>
</body>
</html>`);
});

// ---------------------------------------------------------------------------
// 404 HANDLER (DIRECTLY BEFORE server.listen)
// ---------------------------------------------------------------------------
app.use((req, res) => {
    res.status(404);
    if (req.accepts('html')) {
        return sendTemplate(req, res, path.join(__dirname, 'views', '404.html'));
    }
    res.json({ error: 'Page Not Found' });
});

// ✅ Real-Time HTTP & Socket.io Server
server.listen(process.env.PORT || 3002, () => {
    console.log(`🌐 Real-time Web Dashboard running at ${getWebsiteUrl()}`);
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

function isCurrentActorAdmin(req, guild, guildConfig) {
    if (!req.authUser) return false;
    if (!req.authUser.id) return true;
    const member = guild.members.cache.get(req.authUser.id);
    return member && isAdmin(member, guildConfig);
}

function isModerationTargetRestricted(actorIsAdmin, targetMember, guildConfig) {
    if (actorIsAdmin) return false;
    if (!targetMember) return false;
    return isAdmin(targetMember, guildConfig) || (isStaff(targetMember, guildConfig) && !isAdmin(targetMember, guildConfig));
}

// ---------------------------------------------------------------------------
// STAFF ACCESS RESTRICTIONS — helpers
// ---------------------------------------------------------------------------
function getStaffRestriction(guildConfig, userId) {
    return (guildConfig.staffRestrictions && guildConfig.staffRestrictions[userId]) || null;
}
function isTempBanActive(restriction) {
    return Boolean(restriction && restriction.bannedUntil && new Date(restriction.bannedUntil).getTime() > Date.now());
}
function isSiteBanned(restriction) {
    return Boolean(restriction && (restriction.siteBanned || isTempBanActive(restriction)));
}
function isLoginBlocked(restriction) {
    return Boolean(restriction && (restriction.loginBlocked || isSiteBanned(restriction)));
}
function isModerationBanned(restriction) {
    return Boolean(restriction && (restriction.moderationBanned || isSiteBanned(restriction)));
}
function isTicketsSuspended(restriction) {
    return Boolean(restriction && (restriction.ticketsSuspended || isSiteBanned(restriction)));
}
function isSuspendedFromTickets(guildConfig, userId) {
    return isTicketsSuspended(getStaffRestriction(guildConfig, userId));
}

// ---------------------------------------------------------------------------
// TICKET PRIORITY — helpers
// ---------------------------------------------------------------------------
const PRIORITY_LEVELS = ['low', 'normal', 'high', 'urgent'];
const PRIORITY_EMOJI = { low: '🟢', normal: '⚪', high: '🟠', urgent: '🔴' };
const PRIORITY_LABEL = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
const PRIORITY_COLOR = { low: 0x2ecc71, normal: null, high: 0xf39c12, urgent: 0xe74c3c };

function buildTicketChannelName(ticket) {
    // Only tickets created after this feature shipped have a stored base name —
    // older in-flight tickets are left alone rather than guessed at.
    if (!ticket.baseChannelName) return null;
    const claimedSuffix = ticket.claimedBy ? '-claimed' : '';
    const priority = ticket.priority || 'normal';
    const priorityPrefix = priority !== 'normal' ? `${PRIORITY_EMOJI[priority]}-` : '';
    return `${priorityPrefix}${ticket.baseChannelName}${claimedSuffix}`.slice(0, 100);
}

async function syncTicketChannelName(channel, ticket) {
    const desired = buildTicketChannelName(ticket);
    if (!desired || channel.name === desired) return;
    // Discord allows only 2 channel renames per 10 minutes — failures here
    // (rapid claim/unclaim/priority toggling) are logged and otherwise ignored.
    await channel.setName(desired).catch(err => console.error('[ticket rename] failed:', err.message));
}

async function updateTicketPriorityEmbed(channel, ticket, priority) {
    if (!ticket.welcomeMessageId) return;
    try {
        const msg = await channel.messages.fetch(ticket.welcomeMessageId);
        const oldEmbed = msg.embeds[0];
        if (!oldEmbed) return;
        const fields = (oldEmbed.fields || []).filter(f => f.name !== 'Priority');
        fields.push({ name: 'Priority', value: `${PRIORITY_EMOJI[priority]} ${PRIORITY_LABEL[priority]}`, inline: true });
        const updatedEmbed = EmbedBuilder.from(oldEmbed).setFields(fields);
        if (PRIORITY_COLOR[priority]) updatedEmbed.setColor(PRIORITY_COLOR[priority]);
        await msg.edit({ embeds: [updatedEmbed] });
    } catch (err) {
        console.error('[priority embed update] failed:', err.message);
    }
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

async function getTicketWebhook(channel) {
    try {
        const hooks = await channel.fetchWebhooks();
        let webhook = hooks.find(h => h.name === 'RedField Ticket Webhook');
        if (!webhook) {
            webhook = await channel.createWebhook({ name: 'RedField Ticket Webhook', avatar: client.user.displayAvatarURL({ format: 'png' }) });
        }
        return webhook;
    } catch (err) {
        return null;
    }
}

async function sendTicketMessage(channel, content, username, avatarURL) {
    if (!username) return channel.send(content);
    const webhook = await getTicketWebhook(channel);
    if (!webhook) return channel.send(`${username}: ${content}`);
    return webhook.send({
        content,
        username: username.slice(0, 80),
        avatarURL: avatarURL || client.user.displayAvatarURL({ format: 'png' }),
        allowedMentions: { parse: ['users', 'roles'] }
    });
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
        new ButtonBuilder().setCustomId('ticket_priority_menu').setLabel('Priority').setStyle(ButtonStyle.Secondary).setEmoji('🚩')
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
    clearCloseRequestTimer(channel.id);
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
            priority: meta.priority || 'normal',
            claimedBy: meta.claimedBy ? meta.claimedBy.tag : null,
            closedBy: closedByTag,
            openedAt: meta.openedAt || null,
            closedAt: new Date().toISOString(),
            accessToken,
            messages: messagesArray,
            tags: Array.isArray(meta.tags) ? meta.tags : []
        });
        saveArchive();

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
                { name: '🚩 Priority', value: `${PRIORITY_EMOJI[meta.priority || 'normal']} ${PRIORITY_LABEL[meta.priority || 'normal']}`, inline: true },
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

        // Transcript is already saved on the website — the Discord channel itself is
        // deleted immediately on close. No "lock and keep as an archive category"
        // option anymore.
        await channel.delete().catch(() => {});
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
        reason: reason || 'No reason provided', robloxUsername: robloxUsername || null, priority: 'normal',
        baseChannelName: channelName, openedAt: new Date().toISOString(), claimedBy: null, closing: false, welcomeMessageId: null, tags: []
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
            { name: 'Priority', value: `${PRIORITY_EMOJI.normal} ${PRIORITY_LABEL.normal}`, inline: true },
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

function ticketModal(typeKey, panel) {
    const modal = new ModalBuilder().setCustomId(`ticket_modal_${typeKey}`).setTitle(clamp(panel.buttonLabel || 'Open Ticket', 45));
    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('reason')
                .setLabel(clamp(panel.promptLabel || 'Reason', 45))
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(1000)
                .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('robloxUsername')
                .setLabel('Roblox username (optional)')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(50)
                .setRequired(false)
        )
    );
    return modal;
}

async function sendTicketPanels(channel, guildConfig) {
    for (const [typeKey, panel] of Object.entries(guildConfig.panels)) {
        const embed = new EmbedBuilder().setTitle(clamp(panel.title, 256)).setDescription(clamp(panel.description, 4096)).setColor(panel.color);
        const button = new ButtonBuilder().setCustomId(`open_ticket_${typeKey}`).setLabel(clamp(panel.buttonLabel, 80)).setStyle(STYLE_MAP[panel.style] || ButtonStyle.Secondary);
        if (panel.emoji && isValidEmoji(panel.emoji)) button.setEmoji(panel.emoji);
        await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
    }
}

client.once('ready', async () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);
    const commands = [
        { name: 'sendpanels', description: 'Sends all support panels into the current channel' },
        { name: 'setup', description: 'Creates a working test ticket channel automatically', options: [{ name: 'type', description: 'Which panel type', type: 3, required: false }] },
        { name: 'configure', description: 'Configure ticket panels and staff roles' },
        { name: 'config-site', description: 'Configure website settings' },
        { name: 'claim', description: 'Claim the ticket' },
        { name: 'unclaim', description: 'Unclaim the ticket' },
        { name: 'close', description: 'Close the ticket' },
        { name: 'closerequest', description: 'Request close', options: [{ name: 'reason', description: 'Why', type: 3, required: true }, { name: 'close_delay', description: 'Hours', type: 4, required: false }] },
        { name: 'transfer', description: 'Transfer ticket', options: [{ name: 'user', description: 'Staff member', type: 6, required: true }] },
        { name: 'blacklist', description: 'Blacklist user', options: [{ name: 'user', description: 'User', type: 6, required: true }, { name: 'reason', description: 'Reason', type: 3, required: false }] },
        { name: 'unblacklist', description: 'Remove user from blacklist', options: [{ name: 'user', description: 'User', type: 6, required: true }] },
        { name: 'duty', description: 'Toggle your staff duty status on or off' },
        { name: 'priority', description: 'Set this ticket\'s priority', options: [{ name: 'level', description: 'Priority level', type: 3, required: true, choices: [
            { name: 'Low', value: 'low' }, { name: 'Normal', value: 'normal' }, { name: 'High', value: 'high' }, { name: 'Urgent', value: 'urgent' }
        ] }] },
        { name: 'tag', description: 'Send a canned response by its ID (configured on the website)', options: [{ name: 'id', description: 'The response ID from the website', type: 3, required: true }] },
        { name: 'ping', description: "Replies with the bot's current latency" },
        { name: 'id', description: 'Get the ID of a user, role, or channel', options: [
            { name: 'user', description: 'User to look up', type: 6, required: false },
            { name: 'role', description: 'Role to look up', type: 8, required: false },
            { name: 'channel', description: 'Channel to look up', type: 7, required: false }
        ] },
        { name: 'permissionlevel', description: 'Display your current permission level' },
        { name: 'new', description: 'Open a new support ticket' },
        { name: 'add', description: 'Add a user or role to this ticket', options: [
            { name: 'user', description: 'User to add', type: 6, required: false },
            { name: 'role', description: 'Role to add', type: 8, required: false }
        ] },
        { name: 'remove', description: 'Remove a user or role from this ticket', options: [
            { name: 'user', description: 'User to remove', type: 6, required: false },
            { name: 'role', description: 'Role to remove', type: 8, required: false }
        ] },
        { name: 'rename', description: 'Rename the current ticket channel', options: [{ name: 'name', description: 'New name', type: 3, required: true }] },
        { name: 'transcript', description: 'Generate a transcript of this ticket without closing it' },
        { name: 'purge', description: '[Admin] Close and archive every open ticket in this server' }
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        if (GUILD_ID) await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
        else await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    } catch (error) { console.error('Error registering commands:', error); }
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isAutocomplete()) return;

    try {
        const guildConfig = interaction.guild ? getGuildConfig(interaction.guild.id) : defaultConfig();

        if (interaction.isChatInputCommand()) {
            const { commandName, channel, guild, user, member } = interaction;

            if (commandName === 'duty') {
                const access = checkCommandAccess(interaction, guildConfig, 'duty');
                if (!access.ok) return interaction.reply({ content: commandAccessDeniedReply(access), ephemeral: true });
                const userId = user.id;
                if (!shiftData[userId]) {
                    shiftData[userId] = { tag: user.tag, onDuty: false, shiftStarted: null, totalHours: 0 };
                }
                const current = shiftData[userId];
                current.onDuty = !current.onDuty;
                if (current.onDuty) {
                    current.shiftStarted = new Date().toISOString();
                    return interaction.reply({ content: `🟢 **${user.tag}** is now **On Duty**!`, ephemeral: false });
                } else {
                    if (current.shiftStarted) {
                        const durationHrs = (Date.now() - new Date(current.shiftStarted).getTime()) / 3600000;
                        current.totalHours = parseFloat(((current.totalHours || 0) + durationHrs).toFixed(1));
                    }
                    current.shiftStarted = null;
                    return interaction.reply({ content: `🔴 **${user.tag}** is now **Off Duty**.`, ephemeral: false });
                }
            }

            if (commandName === 'sendpanels') {
                const access = checkCommandAccess(interaction, guildConfig, 'sendpanels');
                if (!access.ok) return interaction.reply({ content: commandAccessDeniedReply(access), ephemeral: true });
                await sendTicketPanels(channel, guildConfig);
                return interaction.reply({ content: '✅ Panels sent to this channel!', ephemeral: true });
            }

            if (commandName === 'setup') {
                const access = checkCommandAccess(interaction, guildConfig, 'setup');
                if (!access.ok) return interaction.reply({ content: commandAccessDeniedReply(access), ephemeral: true });
                const typeKey = interaction.options.getString('type') || 'REDFIELD';
                await interaction.deferReply({ ephemeral: true });
                const testTicket = await createTicketChannel(guild, user, typeKey, 'Test Ticket', null, guildConfig);
                return interaction.editReply({ content: `✅ Test ticket channel created: ${testTicket}.` });
            }

            if (commandName === 'configure') {
                const access = checkCommandAccess(interaction, guildConfig, 'configure');
                if (!access.ok) return interaction.reply({ content: commandAccessDeniedReply(access), ephemeral: true });
                return interaction.reply({ content: `⚙️ Panel and staff-role configuration now lives on the website — visit **${getWebsiteUrl()}/panels** for panels and **${getWebsiteUrl()}/settings** for roles.`, ephemeral: true });
            }

            if (commandName === 'config-site') {
                const access = checkCommandAccess(interaction, guildConfig, 'config-site');
                if (!access.ok) return interaction.reply({ content: commandAccessDeniedReply(access), ephemeral: true });
                return interaction.reply({ content: `⚙️ Website appearance and access settings now live at **${getWebsiteUrl()}/settings**.`, ephemeral: true });
            }

            if (commandName === 'priority') {
                const access = checkCommandAccess(interaction, guildConfig, 'priority');
                if (!access.ok) return interaction.reply({ content: commandAccessDeniedReply(access), ephemeral: true });
                if (!openTickets.has(channel.id)) return interaction.reply({ content: "This isn't an open ticket channel.", ephemeral: true });
                if (isSuspendedFromTickets(guildConfig, user.id)) return interaction.reply({ content: '❌ An Administrator has suspended you from working on tickets.', ephemeral: true });

                const priority = interaction.options.getString('level');
                const ticket = openTickets.get(channel.id);
                ticket.priority = priority;
                openTickets.set(channel.id, ticket);
                saveOpenTickets();
                // Acknowledge the command first — renaming the channel and editing the
                // pinned embed are each slow/rate-limited Discord calls that can blow
                // past the 3-second interaction window, which is what was causing
                // "the application did not respond" even though the priority did save.
                await interaction.reply(`🚩 Priority set to **${PRIORITY_EMOJI[priority]} ${PRIORITY_LABEL[priority]}** by **${user.tag}**.`);
                syncTicketChannelName(channel, ticket).catch(err => console.error('[priority] rename failed:', err.message));
                updateTicketPriorityEmbed(channel, ticket, priority).catch(err => console.error('[priority] embed update failed:', err.message));
                return;
            }

            if (commandName === 'tag') {
                if (!isStaff(member, guildConfig)) return interaction.reply({ content: '❌ Only staff can use this.', ephemeral: true });
                if (openTickets.has(channel.id) && isSuspendedFromTickets(guildConfig, user.id)) {
                    return interaction.reply({ content: '❌ An Administrator has suspended you from working on tickets.', ephemeral: true });
                }
                const id = interaction.options.getString('id');
                const globalWords = quickWordsData.global || [];
                const personalWords = quickWordsData.personal[user.id] || [];
                const found = globalWords.find(w => w.id === id) || personalWords.find(w => w.id === id);
                if (!found) {
                    return interaction.reply({ content: `❌ No canned response found with ID \`${id}\`. Configure these at **${getWebsiteUrl()}/quickwords**.`, ephemeral: true });
                }
                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                const senderName = ticket?.claimedBy?.tag || user.tag;
                await sendTicketMessage(channel, found.text, senderName);
                return interaction.reply({ content: `✅ Sent "${found.label}".`, ephemeral: true });
            }

            if (commandName === 'ping') {
                const access = checkCommandAccess(interaction, guildConfig, 'ping');
                if (!access.ok) return interaction.reply({ content: commandAccessDeniedReply(access), ephemeral: true });
                const sent = Date.now();
                await interaction.reply({ content: '🏓 Pinging…' });
                const roundTrip = Date.now() - sent;
                return interaction.editReply(`🏓 Pong! Roundtrip: **${roundTrip}ms** · Websocket: **${Math.round(client.ws.ping)}ms**`);
            }

            if (commandName === 'id') {
                const access = checkCommandAccess(interaction, guildConfig, 'id');
                if (!access.ok) return interaction.reply({ content: commandAccessDeniedReply(access), ephemeral: true });
                const targetUser = interaction.options.getUser('user');
                const targetRole = interaction.options.getRole('role');
                const targetChannel = interaction.options.getChannel('channel');
                const lines = [];
                if (targetUser) lines.push(`👤 **${targetUser.tag}**: \`${targetUser.id}\``);
                if (targetRole) lines.push(`🎭 **${targetRole.name}**: \`${targetRole.id}\``);
                if (targetChannel) lines.push(`# **${targetChannel.name}**: \`${targetChannel.id}\``);
                if (!lines.length) {
                    lines.push(`👤 **You**: \`${user.id}\``);
                    lines.push(`# **This channel**: \`${channel.id}\``);
                    lines.push(`🏠 **This server**: \`${guild.id}\``);
                }
                return interaction.reply({ content: lines.join('\n'), ephemeral: true });
            }

            if (commandName === 'permissionlevel') {
                const access = checkCommandAccess(interaction, guildConfig, 'permissionlevel');
                if (!access.ok) return interaction.reply({ content: commandAccessDeniedReply(access), ephemeral: true });
                const tier = memberCommandTier(member, guildConfig);
                const labels = { admin: '🔴 Administrator', staff: '🟡 Staff', everyone: '⚪ Member (no staff access)' };
                return interaction.reply({ content: `Your permission level: **${labels[tier]}**`, ephemeral: true });
            }

            if (commandName === 'new') {
                const access = checkCommandAccess(interaction, guildConfig, 'new');
                if (!access.ok) return interaction.reply({ content: commandAccessDeniedReply(access), ephemeral: true });
                const panelEntries = Object.entries(guildConfig.panels);
                if (!panelEntries.length) return interaction.reply({ content: '⚠️ No ticket panels are configured yet.', ephemeral: true });
                if (panelEntries.length === 1) {
                    const [typeKey, panel] = panelEntries[0];
                    try {
                        return await interaction.showModal(ticketModal(typeKey, panel));
                    } catch (err) {
                        return interaction.reply({ content: `⚠️ Could not open the ticket form: ${err.message}`, ephemeral: true });
                    }
                }
                const select = new StringSelectMenuBuilder()
                    .setCustomId('open_ticket_select')
                    .setPlaceholder('Open A Ticket')
                    .addOptions(panelEntries.map(([typeKey, p]) => {
                        const opt = { label: clamp(p.buttonLabel || typeKey, 100) || typeKey, value: typeKey, description: clamp(p.title || '', 100) || undefined };
                        if (p.emoji && isValidEmoji(p.emoji)) opt.emoji = p.emoji;
                        return opt;
                    }));
                return interaction.reply({ content: 'Choose a ticket type:', components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
            }

            if (commandName === 'add') {
                const access = checkCommandAccess(interaction, guildConfig, 'add');
                if (!access.ok) return interaction.reply({ content: commandAccessDeniedReply(access), ephemeral: true });
                if (!openTickets.has(channel.id)) return interaction.reply({ content: "This isn't an open ticket channel.", ephemeral: true });
                const targetUser = interaction.options.getUser('user');
                const targetRole = interaction.options.getRole('role');
                if (!targetUser && !targetRole) return interaction.reply({ content: '⚠️ Specify a user or a role to add.', ephemeral: true });
                try {
                    if (targetUser) await channel.permissionOverwrites.edit(targetUser.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
                    if (targetRole) await channel.permissionOverwrites.edit(targetRole.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
                    const who = [targetUser ? `<@${targetUser.id}>` : null, targetRole ? `<@&${targetRole.id}>` : null].filter(Boolean).join(' and ');
                    return interaction.reply(`✅ Added ${who} to this ticket.`);
                } catch (err) {
                    return interaction.reply({ content: `⚠️ Could not update permissions: ${err.message}`, ephemeral: true });
                }
            }

            if (commandName === 'remove') {
                const access = checkCommandAccess(interaction, guildConfig, 'remove');
                if (!access.ok) return interaction.reply({ content: commandAccessDeniedReply(access), ephemeral: true });
                if (!openTickets.has(channel.id)) return interaction.reply({ content: "This isn't an open ticket channel.", ephemeral: true });
                const targetUser = interaction.options.getUser('user');
                const targetRole = interaction.options.getRole('role');
                if (!targetUser && !targetRole) return interaction.reply({ content: '⚠️ Specify a user or a role to remove.', ephemeral: true });
                const ticket = openTickets.get(channel.id);
                if (targetUser && ticket && ticket.userId === targetUser.id) {
                    return interaction.reply({ content: "⚠️ Can't remove the ticket opener — close the ticket instead.", ephemeral: true });
                }
                try {
                    if (targetUser) await channel.permissionOverwrites.delete(targetUser.id);
                    if (targetRole) await channel.permissionOverwrites.delete(targetRole.id);
                    const who = [targetUser ? `<@${targetUser.id}>` : null, targetRole ? `<@&${targetRole.id}>` : null].filter(Boolean).join(' and ');
                    return interaction.reply(`✅ Removed ${who} from this ticket.`);
                } catch (err) {
                    return interaction.reply({ content: `⚠️ Could not update permissions: ${err.message}`, ephemeral: true });
                }
            }

            if (commandName === 'rename') {
                const access = checkCommandAccess(interaction, guildConfig, 'rename');
                if (!access.ok) return interaction.reply({ content: commandAccessDeniedReply(access), ephemeral: true });
                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                if (!ticket) return interaction.reply({ content: "This isn't an open ticket channel.", ephemeral: true });
                const newBase = sanitizeForChannelName(interaction.options.getString('name'));
                ticket.baseChannelName = newBase;
                openTickets.set(channel.id, ticket);
                saveOpenTickets();
                await interaction.reply(`✏️ Renaming ticket…`);
                syncTicketChannelName(channel, ticket).catch(err => console.error('[rename] failed:', err.message));
                return;
            }

            if (commandName === 'transcript') {
                const access = checkCommandAccess(interaction, guildConfig, 'transcript');
                if (!access.ok) return interaction.reply({ content: commandAccessDeniedReply(access), ephemeral: true });
                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                if (!ticket) return interaction.reply({ content: "This isn't an open ticket channel.", ephemeral: true });
                await interaction.deferReply({ ephemeral: true });
                try {
                    const messagesArray = await fetchAllMessages(channel);
                    const accessToken = crypto.randomBytes(12).toString('hex');
                    const websiteUrl = getWebsiteUrl();
                    archivedTickets.set(channel.id, {
                        id: channel.id,
                        channelName: channel.name,
                        type: ticket.type || channel.name.split('-')[0].toUpperCase(),
                        openedBy: ticket.userTag || 'Unknown user',
                        openedById: ticket.userId || null,
                        robloxUsername: ticket.robloxUsername || null,
                        reason: ticket.reason || 'No reason provided',
                        priority: ticket.priority || 'normal',
                        claimedBy: ticket.claimedBy ? ticket.claimedBy.tag : null,
                        closedBy: null,
                        openedAt: ticket.openedAt || null,
                        closedAt: null,
                        accessToken,
                        messages: messagesArray,
                        tags: Array.isArray(ticket.tags) ? ticket.tags : []
                    });
                    saveArchive();
                    return interaction.editReply(`📁 Transcript generated (the ticket is still open): ${websiteUrl}/transcript/${channel.id}?token=${accessToken}`);
                } catch (err) {
                    return interaction.editReply(`⚠️ Could not generate transcript: ${err.message}`);
                }
            }

            if (commandName === 'purge') {
                const access = checkCommandAccess(interaction, guildConfig, 'purge');
                if (!access.ok) return interaction.reply({ content: commandAccessDeniedReply(access), ephemeral: true });
                const guildTickets = Array.from(openTickets.entries()).filter(([, t]) => t.guildId === guild.id);
                if (!guildTickets.length) return interaction.reply({ content: 'There are no open tickets to purge.', ephemeral: true });
                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('purge_confirm').setLabel(`Delete all ${guildTickets.length} tickets`).setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('purge_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                );
                return interaction.reply({ content: `⚠️ This will close, archive, and delete **${guildTickets.length}** open ticket${guildTickets.length === 1 ? '' : 's'} in this server. This can't be undone. Confirm?`, components: [confirmRow] });
            }

            if (commandName === 'claim') {
                const access = checkCommandAccess(interaction, guildConfig, 'claim');
                if (!access.ok) return interaction.reply({ content: commandAccessDeniedReply(access), ephemeral: true });
                if (!openTickets.has(channel.id)) return interaction.reply({ content: "This isn't an open ticket channel.", ephemeral: true });
                if (isSuspendedFromTickets(guildConfig, user.id)) return interaction.reply({ content: '❌ An Administrator has suspended you from working on tickets.', ephemeral: true });

                const ticket = openTickets.get(channel.id);
                if (ticket.claimedBy) return interaction.reply({ content: `❌ Already claimed by **${ticket.claimedBy.tag}**.`, ephemeral: true });
                ticket.claimedBy = { id: user.id, tag: user.tag };
                saveOpenTickets();
                await interaction.reply(`🙋 **${user.tag}** is handling this ticket now.`);
                syncTicketChannelName(channel, ticket).catch(err => console.error('[claim] rename failed:', err.message));
                return;
            }

            if (commandName === 'unclaim') {
                const access = checkCommandAccess(interaction, guildConfig, 'unclaim');
                if (!access.ok) return interaction.reply({ content: commandAccessDeniedReply(access), ephemeral: true });
                if (!openTickets.has(channel.id)) return interaction.reply({ content: "This isn't an open ticket channel.", ephemeral: true });

                const ticket = openTickets.get(channel.id);
                if (!ticket.claimedBy) return interaction.reply({ content: '⚠️ This ticket is not currently claimed.', ephemeral: true });
                ticket.claimedBy = null;
                saveOpenTickets();
                await interaction.reply(`↩️ **${user.tag}** unclaimed this ticket.`);
                syncTicketChannelName(channel, ticket).catch(err => console.error('[unclaim] rename failed:', err.message));
                return;
            }

            if (commandName === 'close') {
                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                if (!ticket) return interaction.reply({ content: "This isn't an open ticket channel.", ephemeral: true });

                const isOpener = ticket.userId === user.id;
                const access = checkCommandAccess(interaction, guildConfig, 'close');
                const canClose = access.ok || (isOpener && guildConfig.allowOpenerClose);
                if (!canClose) return interaction.reply({ content: access.ok === false && access.reason === 'disabled' ? commandAccessDeniedReply(access) : '❌ You are not allowed to close this ticket.', ephemeral: true });
                if (isStaff(member, guildConfig) && isSuspendedFromTickets(guildConfig, user.id)) {
                    return interaction.reply({ content: '❌ An Administrator has suspended you from working on tickets.', ephemeral: true });
                }

                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('confirm_close').setLabel('Confirm Close').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('cancel_close').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                );
                return interaction.reply({ content: `⚠️ Close this ticket? This deletes the channel instantly — the transcript is saved to the website first.`, components: [confirmRow] });
            }

            if (commandName === 'closerequest') {
                const access = checkCommandAccess(interaction, guildConfig, 'closerequest');
                if (!access.ok) return interaction.reply({ content: commandAccessDeniedReply(access), ephemeral: true });
                if (isSuspendedFromTickets(guildConfig, user.id)) return interaction.reply({ content: '❌ An Administrator has suspended you from working on tickets.', ephemeral: true });
                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                if (!ticket || !ticket.userId) return interaction.reply({ content: "⚠️ Could not identify ticket opener.", ephemeral: true });

                const reason = interaction.options.getString('reason');
                const closeDelayHours = interaction.options.getInteger('close_delay');

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('closerequest_accept').setLabel('Accept & Close').setStyle(ButtonStyle.Success).setEmoji('✅'),
                    new ButtonBuilder().setCustomId('closerequest_deny').setLabel('Deny & Keep Open').setStyle(ButtonStyle.Danger).setEmoji('❌')
                );
                // It's staff asking the opener whether they're OK with closing —
                // the wording previously had this backwards, saying the opener
                // themselves had requested it.
                const closeRequestEmbed = new EmbedBuilder()
                    .setColor(0x5865f2)
                    .setTitle('Close Request')
                    .setDescription(`**${user.tag}** has requested to close this ticket. Reason:\n\`\`\`${reason}\`\`\`\n<@${ticket.userId}>, click **Accept & Close** below if that's okay, or **Deny & Keep Open** if you still need help.`);

                if (closeDelayHours) scheduleCloseRequestAutoClose(channel, guild, guildConfig, closeDelayHours, user.tag);

                return interaction.reply({ content: `<@${ticket.userId}>`, embeds: [closeRequestEmbed], components: [row] });
            }

            if (commandName === 'transfer') {
                const access = checkCommandAccess(interaction, guildConfig, 'transfer');
                if (!access.ok) return interaction.reply({ content: commandAccessDeniedReply(access), ephemeral: true });
                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                if (!ticket) return interaction.reply({ content: "This isn't an open ticket channel.", ephemeral: true });

                const targetUser = interaction.options.getUser('user');
                await interaction.deferReply();
                const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
                if (!targetMember) return interaction.editReply('⚠️ Could not find that member in this server.');

                ticket.claimedBy = { id: targetMember.id, tag: targetMember.user.tag };
                openTickets.set(channel.id, ticket);
                saveOpenTickets();

                await interaction.editReply(`🔁 Transferred to **${targetMember.user.tag}** by **${user.tag}**.`);
                syncTicketChannelName(channel, ticket).catch(err => console.error('[transfer] rename failed:', err.message));
                return;
            }

            if (commandName === 'blacklist') {
                const access = checkCommandAccess(interaction, guildConfig, 'blacklist');
                if (!access.ok) return interaction.reply({ content: commandAccessDeniedReply(access), ephemeral: true });
                const targetUser = interaction.options.getUser('user');
                const reason = interaction.options.getString('reason') || 'No reason given';
                guildConfig.blacklistedUsers[targetUser.id] = { tag: targetUser.tag, reason, blacklistedAt: new Date().toISOString(), blacklistedBy: user.tag };
                saveConfigs();
                return interaction.reply({ content: `🚫 Blacklisted **${targetUser.tag}**.`, ephemeral: true });
            }

            if (commandName === 'unblacklist') {
                const access = checkCommandAccess(interaction, guildConfig, 'unblacklist');
                if (!access.ok) return interaction.reply({ content: commandAccessDeniedReply(access), ephemeral: true });
                const targetUser = interaction.options.getUser('user');
                delete guildConfig.blacklistedUsers[targetUser.id];
                saveConfigs();
                return interaction.reply({ content: `✅ Removed **${targetUser.tag}** from blacklist.`, ephemeral: true });
            }
        }

        if (interaction.isButton()) {
            const { customId, channel, user, member } = interaction;

            if (customId.startsWith('feedback_')) {
                const parts = customId.split('_');
                const rating = parseInt(parts[1], 10);
                const ticketId = parts[2];

                feedbackData.unshift({ ticketId, rating, userTag: user.tag, userId: user.id, at: new Date().toISOString() });
                saveFeedback();
                return interaction.reply({ content: `⭐ Thank you for rating your support experience **${rating}/5 stars**!`, ephemeral: true });
            }

            if (customId === 'ticket_priority_menu') {
                if (!isStaff(member, guildConfig)) return interaction.reply({ content: '❌ Only staff can set ticket priority.', ephemeral: true });
                if (isSuspendedFromTickets(guildConfig, user.id)) return interaction.reply({ content: '❌ An Administrator has suspended you from working on tickets.', ephemeral: true });

                const select = new StringSelectMenuBuilder()
                    .setCustomId('ticket_priority_select')
                    .setPlaceholder('Set ticket priority…')
                    .addOptions(
                        { label: 'Low', value: 'low', emoji: '🟢' },
                        { label: 'Normal', value: 'normal', emoji: '⚪' },
                        { label: 'High', value: 'high', emoji: '🟠' },
                        { label: 'Urgent', value: 'urgent', emoji: '🔴' }
                    );
                return interaction.reply({ content: 'Set this ticket\'s priority:', components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
            }

            if (customId === 'claim_ticket') {
                if (!isStaff(member, guildConfig)) return interaction.reply({ content: '❌ Only staff can claim tickets.', ephemeral: true });
                if (isSuspendedFromTickets(guildConfig, user.id)) return interaction.reply({ content: '❌ An Administrator has suspended you from working on tickets.', ephemeral: true });

                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                if (!ticket) return interaction.reply({ content: "⚠️ Could not find this ticket's data.", ephemeral: true });
                openTickets.set(channel.id, ticket);

                if (ticket.claimedBy) {
                    return interaction.reply({ content: `❌ Already claimed by **${ticket.claimedBy.tag}**. They need to Unclaim first.`, ephemeral: true });
                }

                ticket.claimedBy = { id: user.id, tag: user.tag };
                openTickets.set(channel.id, ticket);
                saveOpenTickets();

                const oldEmbed = interaction.message.embeds[0];
                const updatedEmbed = EmbedBuilder.from(oldEmbed).setFields(
                    oldEmbed.fields.map(f => f.name === 'Status' ? { name: 'Status', value: `🟡 Claimed by ${user.tag}`, inline: true } : f)
                );
                // Acknowledge the click (this IS the button/embed swap) before the
                // channel rename — renaming is a separate, slower Discord call that
                // must not sit in front of the response or the click times out.
                await interaction.update({ embeds: [updatedEmbed], components: buildTicketButtons(true) });
                await channel.send(`🙋 **${user.tag}** is handling this ticket now.`);
                syncTicketChannelName(channel, ticket).catch(err => console.error('[claim] rename failed:', err.message));
                return;
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
                openTickets.set(channel.id, ticket);
                saveOpenTickets();

                const oldEmbed = interaction.message.embeds[0];
                const updatedEmbed = EmbedBuilder.from(oldEmbed).setFields(
                    oldEmbed.fields.map(f => f.name === 'Status' ? { name: 'Status', value: '🟢 Open', inline: true } : f)
                );
                await interaction.update({ embeds: [updatedEmbed], components: buildTicketButtons(false) });
                await channel.send(`↩️ **${user.tag}** unclaimed this ticket.`);
                syncTicketChannelName(channel, ticket).catch(err => console.error('[unclaim] rename failed:', err.message));
                return;
            }

            if (customId === 'ticket_close') {
                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                const isOpener = Boolean(ticket && ticket.userId === user.id);
                const canClose = isStaff(member, guildConfig) || (isOpener && guildConfig.allowOpenerClose);
                if (!canClose) return interaction.reply({ content: '❌ You are not allowed to close this ticket.', ephemeral: true });

                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('confirm_close').setLabel('Confirm Close').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('cancel_close').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                );
                return interaction.reply({ content: `⚠️ Close this ticket? This deletes the channel instantly — the transcript is saved to the website first.`, components: [confirmRow] });
            }

            if (customId === 'ticket_close_with_reason') {
                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                const isOpener = Boolean(ticket && ticket.userId === user.id);
                const canClose = isStaff(member, guildConfig) || (isOpener && guildConfig.allowOpenerClose);
                if (!canClose) return interaction.reply({ content: '❌ You are not allowed to close this ticket.', ephemeral: true });
                if (isStaff(member, guildConfig) && isSuspendedFromTickets(guildConfig, user.id)) {
                    return interaction.reply({ content: '❌ An Administrator has suspended you from working on tickets.', ephemeral: true });
                }
                const modal = new ModalBuilder().setCustomId('close_reason_modal').setTitle('Close Ticket With Reason');
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('closeReason').setLabel('Reason for closing').setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(true)
                ));
                return interaction.showModal(modal);
            }

            if (customId === 'confirm_close') {
                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                const isOpener = Boolean(ticket && ticket.userId === user.id);
                const canClose = isStaff(member, guildConfig) || (isOpener && guildConfig.allowOpenerClose);
                if (!canClose) return interaction.update({ content: '❌ You are not allowed to close this ticket.', components: [] });
                if (isStaff(member, guildConfig) && isSuspendedFromTickets(guildConfig, user.id)) {
                    return interaction.update({ content: '❌ An Administrator has suspended you from working on tickets.', components: [] });
                }
                await interaction.update({ content: '🔒 Closing ticket...', components: [] });
                await finalizeTicketClose(channel, interaction.guild, guildConfig, user.tag);
            }

            if (customId === 'cancel_close') {
                return interaction.update({ content: '✅ Close cancelled — this ticket stays open.', components: [] });
            }

            if (customId === 'purge_confirm') {
                if (!isAdmin(member, guildConfig)) return interaction.reply({ content: '❌ Only Administrators can confirm a purge.', ephemeral: true });
                await interaction.update({ content: '🧹 Purging all open tickets… this may take a moment.', components: [] });
                const guildTickets = Array.from(openTickets.entries()).filter(([, t]) => t.guildId === interaction.guild.id);
                let count = 0;
                for (const [channelId] of guildTickets) {
                    const ch = await interaction.guild.channels.fetch(channelId).catch(() => null);
                    if (ch) {
                        await finalizeTicketClose(ch, interaction.guild, guildConfig, `${user.tag} (purge)`).catch(err => console.error('[purge] failed for', channelId, err.message));
                        count++;
                    } else {
                        openTickets.delete(channelId);
                    }
                }
                saveOpenTickets();
                logAudit('PURGE_TICKETS', user.tag, `Purged ${count} open ticket(s)`);
                return interaction.followUp({ content: `✅ Purged ${count} ticket${count === 1 ? '' : 's'}.`, ephemeral: true });
            }

            if (customId === 'purge_cancel') {
                return interaction.update({ content: '✅ Purge cancelled.', components: [] });
            }

            if (customId === 'closerequest_accept') {
                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                const isOpener = Boolean(ticket && ticket.userId === user.id);
                // The whole point of this button is for the OPENER to respond —
                // staff-only here meant the person being asked could never
                // actually answer their own close request. Staff can still act
                // on it too (e.g. following up if the opener goes quiet).
                if (!isOpener && !isStaff(member, guildConfig)) {
                    return interaction.reply({ content: '❌ Only the ticket opener or staff can respond to this close request.', ephemeral: true });
                }
                if (isStaff(member, guildConfig) && isSuspendedFromTickets(guildConfig, user.id)) {
                    return interaction.reply({ content: '❌ An Administrator has suspended you from working on tickets.', ephemeral: true });
                }
                await interaction.update({ content: `🔒 **${user.tag}** accepted the close request — closing ticket...`, components: [] });
                await finalizeTicketClose(channel, interaction.guild, guildConfig, user.tag);
                return;
            }

            if (customId === 'closerequest_deny') {
                const ticket = openTickets.get(channel.id) || recoverTicketFromTopic(channel);
                const isOpener = Boolean(ticket && ticket.userId === user.id);
                if (!isOpener && !isStaff(member, guildConfig)) {
                    return interaction.reply({ content: '❌ Only the ticket opener or staff can respond to this close request.', ephemeral: true });
                }
                clearCloseRequestTimer(channel.id);
                return interaction.update({ content: `❌ **${user.tag}** denied the close request — ticket stays open.`, components: [] });
            }

            if (customId.startsWith('open_ticket_')) {
                const typeKey = customId.replace('open_ticket_', '');
                const panel = guildConfig.panels[typeKey];
                if (!panel) {
                    return interaction.reply({ content: '⚠️ This ticket type is no longer available.', ephemeral: true });
                }
                try {
                    const modal = ticketModal(typeKey, panel);
                    return await interaction.showModal(modal);
                } catch (err) {
                    console.error('[showModal failed] type=%s error=%s stack=%s', typeKey, err.message, err.stack);
                    return interaction.reply({ content: `⚠️ Could not open the ticket form: ${err.message}`, ephemeral: true });
                }
            }
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'open_ticket_select') {
            const typeKey = interaction.values[0];
            const panel = guildConfig.panels[typeKey];
            if (!panel) {
                return interaction.reply({ content: '⚠️ This ticket type is no longer available.', ephemeral: true });
            }
            try {
                const modal = ticketModal(typeKey, panel);
                return await interaction.showModal(modal);
            } catch (err) {
                console.error('[showModal failed - dropdown] type=%s error=%s', typeKey, err.message);
                return interaction.reply({ content: `⚠️ Could not open the ticket form: ${err.message}`, ephemeral: true });
            }
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_priority_select') {
            if (!isStaff(member, guildConfig)) return interaction.update({ content: '❌ Only staff can set ticket priority.', components: [] });
            if (isSuspendedFromTickets(guildConfig, interaction.user.id)) {
                return interaction.update({ content: '❌ An Administrator has suspended you from working on tickets.', components: [] });
            }
            const priority = interaction.values[0];
            const ticket = openTickets.get(interaction.channel.id) || recoverTicketFromTopic(interaction.channel);
            if (!ticket) return interaction.update({ content: '⚠️ Could not find this ticket.', components: [] });
            ticket.priority = priority;
            openTickets.set(interaction.channel.id, ticket);
            saveOpenTickets();

            // Acknowledge the select first — this was the exact cause of the
            // "didn't respond in time" error: the channel rename and embed edit
            // below are separate, slower Discord calls and must never sit in
            // front of the interaction response.
            await interaction.update({ content: `✅ Priority set to ${PRIORITY_EMOJI[priority]} ${PRIORITY_LABEL[priority]}.`, components: [] });
            await interaction.channel.send(`🚩 **${interaction.user.tag}** set this ticket's priority to **${PRIORITY_EMOJI[priority]} ${PRIORITY_LABEL[priority]}**.`);
            syncTicketChannelName(interaction.channel, ticket).catch(err => console.error('[priority] rename failed:', err.message));
            updateTicketPriorityEmbed(interaction.channel, ticket, priority).catch(err => console.error('[priority] embed update failed:', err.message));
            return;
        }

        if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('ticket_modal_')) {
                const typeKey = interaction.customId.replace('ticket_modal_', '');
                const reason = interaction.fields.getTextInputValue('reason');
                let robloxUsername = '';
                try { robloxUsername = interaction.fields.getTextInputValue('robloxUsername'); } catch (e) {}

                await interaction.deferReply({ ephemeral: true });
                try {
                    const ticketChannel = await createTicketChannel(interaction.guild, interaction.user, typeKey, reason, robloxUsername, guildConfig);
                    return await interaction.editReply({ content: `✅ Ticket created: ${ticketChannel}` });
                } catch (err) {
                    console.error('[ticket modal submit] failed:', err);
                    return await interaction.editReply({ content: `⚠️ Could not create ticket: ${err.message}` });
                }
            }

            if (interaction.customId === 'close_reason_modal') {
                const reason = interaction.fields.getTextInputValue('closeReason');
                const ticket = openTickets.get(interaction.channel.id) || recoverTicketFromTopic(interaction.channel);
                if (ticket) {
                    ticket.reason = reason;
                    openTickets.set(interaction.channel.id, ticket);
                    saveOpenTickets();
                }
                await interaction.reply({ content: `🔒 Closing with reason: ${reason}` });
                await finalizeTicketClose(interaction.channel, interaction.guild, guildConfig, interaction.user.tag);
                return;
            }
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
    }
});

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
client.login(process.env.DISCORD_TOKEN);